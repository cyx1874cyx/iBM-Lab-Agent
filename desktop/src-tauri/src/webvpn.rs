//! WebVPN 软件内浏览器：单例 WebView 窗口、专属 WebView2 profile、导航策略与
//! 事件记录。
//!
//! 本模块**不读取、不导出、不记录**任何账号、密码、Cookie、Local Storage 内容
//! 或 SSO ticket：
//!   - profile 目录只交给 WebView2 使用，不参与备份/诊断/同步；
//!   - 日志只写脱敏后的 URL、host 与错误类别（见 `redact_for_log`）；
//!   - 探测记录存在内存中，由 UI 主动拉取，落盘内容与日志同源。
//!
//! 阶段划分（见 docs/WEBVPN_IN_APP_BROWSER_DEVELOPMENT_PLAN.md）：
//!   - 阶段 0（探测）：`webvpn_probe_*`，**仅 debug 构建可用**，导航策略为
//!     只记录不拦截——否则无法发现学校 SSO 的真实域名集合。
//!   - 阶段 1（单例窗口）：`webvpn_open` / `webvpn_hide` / `webvpn_clear_session`，
//!     策略为白名单拦截。
//!   - 阶段 2（下载捕获）：把单个待捕获下载写入应用临时目录，再上传到现有
//!     一次性捕获端点。认证材料始终留在 WebView2 profile 内。

use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use aes::Aes128;
use cfb_mode::cipher::{AsyncStreamCipher, KeyIvInit};
use serde::Serialize;
use tauri::{
    utils::config::WebviewUrl,
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder},
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, Webview,
};

use crate::runtime::WebVpnConfig;

#[cfg(windows)]
use webview2_com::{
    take_pwstr, CoTaskMemPWSTR, ExecuteScriptCompletedHandler,
    SaveAsUIShowingEventHandler, ShowSaveAsUICompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_25, COREWEBVIEW2_SAVE_AS_UI_RESULT_SUCCESS,
    },
};
#[cfg(windows)]
use windows::core::{Interface, PWSTR};


/// 窗口 label。单例判定的唯一依据，不要用标题或 URL 判断。
pub const WINDOW_LABEL: &str = "webvpn";

/// 专属 WebView2 profile 目录名（位于应用数据根目录下）。
const PROFILE_DIR_NAME: &str = "webvpn-webview2";

/// 探测记录落盘文件名（写入现有 logs 目录）。
const LOG_FILE: &str = "webvpn.log";

/// 内存中保留的最大事件数，防止长时间探测把内存吃满。
const MAX_EVENTS: usize = 800;

/// 被拦截域名最多记住多少个，供 UI 提供"放行"入口。
const MAX_DENIED_HOSTS: usize = 50;

/// 单条 URL 值允许写入日志的最大长度。
const MAX_LOGGED_VALUE: usize = 300;

const WRD_KEY: &[u8; 16] = b"wrdvpnisthebest!";
const CAPTURE_TTL: Duration = Duration::from_secs(20 * 60);
const DOWNLOAD_DIR_NAME: &str = "webvpn-downloads";
const CAPTURE_MAX_BYTES: u64 = 100 * 1024 * 1024;

/// 注入到 WebVPN 子 WebView 的完整浏览器壳。它不读取 Cookie 或页面正文，只
/// 使用浏览器自己的 history/location 实现标签栏、地址栏、前进、后退、刷新和
/// 关闭。页面每次导航后都会重新注入。
const WEBVPN_CHROME_SCRIPT: &str = r#"
(() => {
  const reportAuthenticatedPortal = () => {
    if (window.__ibmWebVpnAuthenticated) return;
    const inputs = Array.from(document.querySelectorAll('input'));
    const hasPassword = inputs.some((input) => input.type === 'password' && input.getClientRects().length > 0);
    const hasAddressInput = inputs.some((input) => {
      if (input.type === 'password' || input.getClientRects().length === 0) return false;
      const hint = [input.placeholder, input.getAttribute('aria-label'), input.value].filter(Boolean).join(' ');
      return /https?:\/\/|网址|网站|地址|url/i.test(hint);
    });
    const pageText = String(document.body?.innerText || '').slice(0, 2500);
    const isForwardedPage = /^\/https?\/[0-9a-f]{16,}(?:\/|$)/i.test(location.pathname);
    const isPortalHome = hasAddressInput && /webvpn/i.test(pageText);
    if (!hasPassword && (isPortalHome || isForwardedPage)) {
      window.__ibmWebVpnAuthenticated = true;
      location.href = 'ibm-webvpn://session/ready';
    }
  };
  const CHROME_HEIGHT = 76;
  /**
   * 页面位移：**只在识别出全屏 PDF 预览器时**才注入。
   *
   * 对 `html` 施加 transform 会让它成为 `position:fixed` 后代的包含块。出版社的
   * HTML PDF 预览器正是 `position:fixed;inset:0` 的整屏容器，不位移就会被我们
   * 76px 的工具栏盖住「保存/下载」按钮。
   *
   * 但同一个 transform 也会重定位按视口垂直居中的验证组件（Cloudflare Turnstile
   * 一类），把 html 高度改小后组件的测量值与实际位置每帧互相纠正，验证框会在应出现
   * 的位置上下抖动、始终渲染不出来（2026-09-23 ScienceDirect + iWAN 真机反馈，外部
   * Edge 正常）。所以默认不位移，由 Rust 在确认进入 PDF 预览器后调用
   * `window.__ibmWebVpnSetPageOffset(true)` 打开；看门狗会在 2.5s 后自动撤销，
   * 宁可盖住预览器工具栏也不把页面变成打不开的样子。
   */
  const applyPageOffset = () => {
    if (document.getElementById('__ibm_webvpn_offset')) return true;
    try {
      const style = document.createElement('style');
      style.id = '__ibm_webvpn_offset';
      style.textContent = `html{transform:translateY(${CHROME_HEIGHT}px) !important;height:calc(100% - ${CHROME_HEIGHT}px) !important;overflow:auto !important}`;
      (document.head || document.documentElement).appendChild(style);
      return true;
    } catch {
      return false;
    }
  };
  const removePageOffset = () => {
    const style = document.getElementById('__ibm_webvpn_offset');
    if (!style) return false;
    style.remove();
    return true;
  };
  /** 工具栏自身用等量反向位移抵消页面位移；没有页面位移时不偏移。 */
  const syncChromeShift = () => {
    const existing = document.getElementById('__ibm_webvpn_chrome');
    if (!existing) return;
    existing.style.transform = document.getElementById('__ibm_webvpn_offset')
      ? `translateY(-${CHROME_HEIGHT}px)`
      : '';
  };
  /** 位移后页面仍无可见内容（被固定遮罩盖住）时判定白屏。 */
  const looksBlank = () => {
    if (String(document.contentType || '').includes('pdf')) return false;
    const body = document.body;
    if (!body) return false;
    if (String(body.innerText || '').trim().length > 0) return false;
    if (body.querySelector('img,svg,canvas,video,iframe,embed,object')) return false;
    return !Array.from(body.children).some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 4 && rect.height > 4;
    });
  };
  let offsetWatchdog = null;
  /**
   * 开关页面位移。开启后 2.5s 检查一次：若仍白屏则撤销，并把结果送回壳记录。
   */
  window.__ibmWebVpnSetPageOffset = (enabled) => {
    if (offsetWatchdog) { clearTimeout(offsetWatchdog); offsetWatchdog = null; }
    if (!enabled) {
      const removed = removePageOffset();
      syncChromeShift();
      return removed;
    }
    const applied = applyPageOffset();
    syncChromeShift();
    if (applied) {
      offsetWatchdog = setTimeout(() => {
        offsetWatchdog = null;
        if (!document.getElementById('__ibm_webvpn_offset') || !looksBlank()) return;
        removePageOffset();
        syncChromeShift();
        location.href = 'ibm-webvpn://offset-reverted/';
      }, 2500);
    }
    return applied;
  };
  /**
   * 捕获状态小球：手动/自动文献捕获期间浮在右下角，点一下终止本次捕获。
   * 状态由壳经 `window.__ibmWebVpnCapture(payload)` 推进来；`null` 表示隐藏。
   */
  let captureBall = null;
  const mountCaptureBall = () => {
    if (document.getElementById('__ibm_webvpn_capture')) return;
    const host = document.createElement('div');
    host.id = '__ibm_webvpn_capture';
    // 页面根元素在 PDF 预览页会被施加 transform（见 __ibmWebVpnSetPageOffset），
    // 它会让 position:fixed 的后代改以 html 为包含块——小球因此会跟着页面滚动、
    // 贴在文档里而不是窗口上。
    // popover 的 top layer 不受祖先 transform 影响，正好用来跳出那个包含块。
    // 拿不到 popover 的旧引擎退回普通 fixed 层：位置仍是左下角，只是会随页面滚动。
    const canPopover = typeof host.showPopover === 'function';
    if (canPopover) host.setAttribute('popover', 'manual');
    host.style.cssText = 'all:initial;display:block;position:fixed;left:16px;bottom:16px;top:auto;right:auto;margin:0;padding:0;border:0;background:transparent;width:auto;height:auto;max-width:none;max-height:none;overflow:visible;z-index:2147483646;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .ball{all:initial;box-sizing:border-box;display:none;max-width:300px;padding:9px 14px;border-radius:999px;background:#0f172a;color:#f8fafc;font:600 12px/1.35 "Segoe UI","Microsoft YaHei",sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.38);cursor:pointer;align-items:center;gap:8px}
      .ball[data-visible="true"]{display:inline-flex}
      .ball[data-phase="armed"],.ball[data-phase="waiting"],.ball[data-phase="opening"],.ball[data-phase="searching"],.ball[data-phase="clicked"]{background:#b45309}
      .ball[data-phase="manual"],.ball[data-phase="verification"]{background:#9a3412}
      .ball[data-phase="downloading"],.ball[data-phase="saving"]{background:#1d4ed8}
      .ball[data-phase="uploading"],.ball[data-phase="completed"]{background:#047857}
      .ball[data-phase="error"]{background:#b91c1c}
      .ball:disabled{cursor:default}
      .dot{width:8px;height:8px;flex:none;border-radius:50%;background:#fde68a;box-shadow:0 0 0 3px rgba(253,230,138,.25)}
      .ball[data-phase="downloading"] .dot{background:#bfdbfe;box-shadow:0 0 0 3px rgba(191,219,254,.25);animation:ibm-ball-pulse 1.1s ease-in-out infinite}
      .ball[data-phase="uploading"] .dot{background:#a7f3d0;box-shadow:0 0 0 3px rgba(167,243,208,.25)}
      .hint{opacity:.72;font-weight:500}
      @keyframes ibm-ball-pulse{50%{opacity:.3}}
      @media (prefers-reduced-motion: reduce){.ball .dot{animation:none}}
    </style><button class="ball" type="button"><i class="dot" aria-hidden="true"></i><span class="text">文献捕获</span><span class="hint">点击终止</span></button>`;
    const ball = root.querySelector('.ball');
    ball.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      location.href = 'ibm-webvpn://cancel-capture/';
    });
    (document.documentElement || document.body).appendChild(host);
    // showPopover 必须在入 DOM 之后调用；重复调用会抛，用 :popover-open 先判。
    if (canPopover) {
      try { if (!host.matches(':popover-open')) host.showPopover(); } catch { /* 引擎不支持：留在普通层 */ }
    }
    captureBall = ball;
  };
  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };
  window.__ibmWebVpnCapture = (payload) => {
    if (!captureBall || !captureBall.isConnected) mountCaptureBall();
    if (!captureBall) return;
    if (!payload || !payload.phase) {
      captureBall.dataset.visible = 'false';
      return;
    }
    if (['downloading', 'saving', 'uploading', 'completed', 'error'].includes(payload.phase))
      window.__ibmWebVpnDownloadStarted = true;
    // A local click is observable before WebView2 emits DownloadStarting. Do
    // not repaint it as searching during the short response window.
    if (payload.phase === 'searching' && Date.now() - (window.__ibmWebVpnLocalClickAt || 0) < 15000)
      payload = { ...payload, phase: 'clicked' };
    const kind = payload.kind === 'si' ? '补充材料' : '正文';
    const size = formatBytes(payload.bytes);
    const text = payload.phase === 'saving'
      ? '正在保存原生 PDF'
      : payload.phase === 'downloading'
      ? '正在下载' + kind + (size ? ' · ' + size : '')
      : payload.phase === 'uploading'
        ? '正在归档' + kind + (size ? ' · ' + size : '')
        : payload.phase === 'searching' ? '正在查找' + kind + '下载入口'
        : payload.phase === 'clicked' ? '已点击' + kind + '入口，等待下载响应'
        : payload.phase === 'verification' ? '页面验证中，通过后继续查找下载入口'
        : payload.phase === 'manual' ? '未确认自动入口，请手动保存' + kind
        : payload.phase === 'opening' ? '正在打开出版社页面'
        : payload.phase === 'completed' ? kind + '已归档'
        : payload.phase === 'error' ? kind + '下载或归档失败，请重试'
        : '等待' + kind + '下载入口';
    const finished = payload.phase === 'completed' || payload.phase === 'error';
    captureBall.disabled = finished;
    captureBall.querySelector('.hint').textContent = finished ? '' : '点击终止';
    captureBall.querySelector('.text').textContent = text;
    captureBall.dataset.phase = payload.phase;
    captureBall.dataset.visible = 'true';
    captureBall.setAttribute('title', finished ? text : text + '；点击终止本次捕获');
  };
  const mount = () => {
    mountCaptureBall();
    const existing = document.getElementById('__ibm_webvpn_chrome');
    if (existing) { syncChromeShift(); return; }
    const host = document.createElement('div');
    host.id = '__ibm_webvpn_chrome';
    host.style.cssText = `all:initial;position:fixed;inset:0 0 auto 0;z-index:2147483647;height:${CHROME_HEIGHT}px;`;
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      *{box-sizing:border-box}
      .shell{height:76px;background:#f8fafc;color:#0f172a;border-bottom:1px solid #cbd5e1;box-shadow:0 2px 10px rgba(15,23,42,.18);font:13px/1.2 "Segoe UI","Microsoft YaHei",sans-serif}
      .tabs{height:30px;display:flex;align-items:end;padding:4px 7px 0;background:#e2e8f0;gap:5px}
      .tabs-list{display:flex;align-items:end;gap:4px;min-width:0;overflow:hidden}
      .tab{height:26px;min-width:82px;max-width:190px;display:flex;align-items:center;gap:5px;padding:0 6px 0 9px;border-radius:7px 7px 0 0;background:#d7dee8;border:1px solid #cbd5e1;font-weight:600;cursor:pointer}
      .tab[data-active="true"]{background:#fff;border-bottom-color:#fff}
      .tab-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
      .tab-close,.window-close{border:0;background:transparent;color:#475569;cursor:pointer;border-radius:5px}
      .tab-close:hover,.window-close:hover{background:#e81123;color:#fff}
      .bar{height:46px;display:flex;align-items:center;gap:6px;padding:7px;background:#fff}
      button{all:initial;box-sizing:border-box;width:31px;height:31px;border-radius:7px;color:#334155;font:600 17px/31px "Segoe UI",sans-serif;text-align:center;cursor:pointer;user-select:none}
      button:hover{background:#e2e8f0}
      button:focus-visible,input:focus-visible{outline:2px solid #2563eb;outline-offset:1px}
      form{display:flex;flex:1;min-width:0}
      input{all:initial;box-sizing:border-box;width:100%;height:32px;padding:0 12px;border:1px solid #cbd5e1;border-radius:16px;background:#f1f5f9;color:#0f172a;font:12px/32px "Segoe UI","Microsoft YaHei",sans-serif}
      input:focus{background:#fff;border-color:#60a5fa}
      .new-tab,.tab-close,.window-close{width:26px;height:25px;font:17px/25px "Segoe UI",sans-serif;text-align:center;flex:0 0 auto}
      .window-close{margin-left:auto}
    </style>
    <div class="shell">
      <div class="tabs"><div class="tabs-list"></div><button class="new-tab" type="button" title="新建标签页" aria-label="新建标签页">＋</button><button class="window-close" type="button" title="关闭浏览器" aria-label="关闭浏览器">×</button></div>
      <div class="bar">
        <button data-action="back" type="button" title="后退" aria-label="后退">←</button>
        <button data-action="forward" type="button" title="前进" aria-label="前进">→</button>
        <button data-action="reload" type="button" title="刷新" aria-label="刷新">↻</button>
        <form><input type="text" spellcheck="false" aria-label="网址" /></form>
      </div>
    </div>`;
    const input = root.querySelector('input');
    const tabsList = root.querySelector('.tabs-list');
    const stateKey = '__ibm_lab_browser_tabs__';
    const freshTab = () => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, url: location.href, title: document.title || location.hostname || '文献浏览器' });
    let tabState;
    try {
      tabState = JSON.parse(sessionStorage.getItem(stateKey) || 'null');
    } catch { tabState = null; }
    if (!tabState?.tabs?.length) {
      const tab = freshTab();
      tabState = { active: tab.id, tabs: [tab] };
    }
    const activeTab = () => tabState.tabs.find((tab) => tab.id === tabState.active) || tabState.tabs[0];
    const persistTabs = () => { try { sessionStorage.setItem(stateKey, JSON.stringify(tabState)); } catch {} };
    const openTab = (tab) => {
      tabState.active = tab.id;
      persistTabs();
      if (tab.url) location.assign(tab.url);
      else { renderTabs(); input.value = ''; input.focus(); }
    };
    const closeTab = (tab, event) => {
      event.stopPropagation();
      if (tabState.tabs.length === 1) { location.href = 'ibm-webvpn://close/'; return; }
      const wasActive = tab.id === tabState.active;
      tabState.tabs = tabState.tabs.filter((item) => item.id !== tab.id);
      if (wasActive) tabState.active = tabState.tabs.at(-1).id;
      persistTabs();
      if (wasActive) openTab(activeTab());
      else renderTabs();
    };
    function renderTabs() {
      tabsList.replaceChildren(...tabState.tabs.map((tab) => {
        const element = document.createElement('div');
        element.className = 'tab';
        element.dataset.active = tab.id === tabState.active ? 'true' : 'false';
        element.title = tab.url || '新标签页';
        const label = document.createElement('span');
        label.className = 'tab-title';
        label.textContent = tab.title || '新标签页';
        const close = document.createElement('button');
        close.className = 'tab-close';
        close.type = 'button';
        close.title = '关闭标签页';
        close.setAttribute('aria-label', '关闭标签页');
        close.textContent = '×';
        close.addEventListener('click', (event) => closeTab(tab, event));
        element.append(label, close);
        element.addEventListener('click', () => { if (tab.id !== tabState.active) openTab(tab); });
        return element;
      }));
    }
    const sync = () => {
      const tab = activeTab();
      if (!tab.url) { input.value = ''; renderTabs(); return; }
      tab.url = location.href;
      tab.title = document.title || location.hostname || '文献浏览器';
      input.value = location.href;
      host.title = location.href;
      persistTabs();
      renderTabs();
    };
    root.querySelector('[data-action="back"]').addEventListener('click', () => history.back());
    root.querySelector('[data-action="forward"]').addEventListener('click', () => history.forward());
    root.querySelector('[data-action="reload"]').addEventListener('click', () => location.reload());
    root.querySelector('.window-close').addEventListener('click', () => { location.href = 'ibm-webvpn://close/'; });
    root.querySelector('.new-tab').addEventListener('click', () => {
      const tab = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, url: '', title: '新标签页' };
      tabState.tabs.push(tab);
      tabState.active = tab.id;
      persistTabs();
      renderTabs();
      input.value = '';
      input.focus();
    });
    root.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      let target = input.value.trim();
      if (!target) return;
      if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) target = `https://${target}`;
      const tab = activeTab();
      tab.url = target;
      tab.title = target;
      persistTabs();
      location.assign(target);
    });
    (document.documentElement || document.body).appendChild(host);
    syncChromeShift();
    sync();
    const titleNode = document.querySelector('title');
    if (titleNode) new MutationObserver(sync).observe(titleNode, { childList: true, subtree: true });
    reportAuthenticatedPortal();
    const observer = new MutationObserver(reportAuthenticatedPortal);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    setTimeout(reportAuthenticatedPortal, 800);
    setTimeout(() => observer.disconnect(), 30000);
  };
  /**
   * 工具栏必须尽早出现，不能只等 DOMContentLoaded。
   *
   * 验证页、被反爬拦下的空文档、以及长时间停在 loading 的页面都不会（或很晚才）
   * 触发 DOMContentLoaded。只等它会让整个侧栏看起来是白屏：用户既看不到页面，
   * 也看不到地址栏和关闭按钮，连手动绕过都做不到（2026-09-25 实测，Cloudflare
   * 插页 + science.org）。
   */
  const mountNow = () => {
    try { mount(); } catch { /* documentElement 尚未建立：等下一次重试 */ }
    return Boolean(document.getElementById('__ibm_webvpn_chrome'));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountNow, { once: true });
  mountNow();
  [250, 1200, 4000].forEach((delay) => setTimeout(mountNow, delay));
})();
"#;

/// 已适配出版社页面内自动寻找下载入口。脚本只在页面能由 DOI 或站点域名
/// 确认出版社时运行；只把固定结果码送回 Rust，不读取或传出正文、Cookie、
/// 登录信息。每次导航都会重新执行，因此可覆盖“文章页 → PDF 预览器 → 保存”。
const PUBLISHER_DOWNLOAD_AUTOMATION: &str = r#"
(() => {
  const kind = '__IBM_CAPTURE_KIND__';
  const publisher = '__IBM_PUBLISHER__';
  const runKey = `__ibm_publisher_download_${publisher}_${kind}`;
  if (window[runKey]) return;
  window[runKey] = true;
  const WILEY_HUMAN_CHECK_MS = 10000;
  const wileyReadyAt = Date.now() + WILEY_HUMAN_CHECK_MS;
  let attempts = 0;
  let stalledTicks = 0;
  let expanded = false;
  let reportedSearch = false;
  let reportedChallenge = false;
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = (element) => {
    if (!element || element.nodeType !== 1) return false;
    const style = element.ownerDocument?.defaultView?.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const description = (element) => clean([
    element.innerText, element.textContent, element.getAttribute('aria-label'),
    element.getAttribute('title'), element.getAttribute('data-track-action')
  ].filter(Boolean).join(' '));
  const hrefOf = (element) => {
    const owner = element.closest?.('a[href]') || (element.matches?.('a[href]') ? element : null);
    return clean(owner?.href || element.getAttribute?.('href'));
  };
  const clickTarget = (element) => element.closest?.('a[href],button,[role="button"]') || element;
  const signal = (result) => { location.href = `ibm-webvpn://automation/${result}`; };
  const confirmedPublisherPage = () => {
    const host = clean(location.hostname);
    const doi = clean(document.querySelector('meta[name="citation_doi"],meta[name="dc.identifier"]')?.content);
    const canonical = clean(document.querySelector('link[rel="canonical"]')?.href);
    const evidence = `${host} ${doi} ${canonical}`;
    const forwarded = /^\/https?\/[0-9a-f]{16,}(?:\/|$)/i.test(location.pathname);
    const patterns = {
      nature: /nature\.com|10\.1038\//,
      springer: /springer(?:link)?\.com|10\.1007\//,
      science: /science\.org|10\.1126\//,
      elsevier: /sciencedirect\.com|elsevier\.com|10\.1016\//,
      acs: /pubs\.acs\.org|10\.1021\//,
      rsc: /pubs\.rsc\.org|10\.1039\//,
      ieee: /ieeexplore\.ieee\.org|10\.1109\//,
      wiley: /(?:onlinelibrary\.)?wiley\.com|10\.(?:1002|1111)\//
    };
    return forwarded || patterns[publisher]?.test(evidence) === true;
  };
  const challengePresent = () => {
    const sample = clean(`${document.title} ${(document.body?.innerText || '').slice(0, 5000)}`);
    if (/captcha|verify you are human|security check|unusual traffic|机器人验证|安全验证|访问验证/.test(sample)) return true;
    // Cloudflare 插页的正文在挑战脚本注入之前是空的，标题却已经是「请稍候…」/
    // 「Just a moment...」。只看正文关键词会把这种页面当成文章页：16 次尝试全打在
    // 挑战页上，最后谎报「已进入 PDF 预览器」（2026-09-25 science.org 实测）。
    const title = clean(document.title);
    if (/just a moment|请稍候|attention required|checking your browser|ddos protection|正在验证|人机验证|verify human/.test(title)) return true;
    // 标题也可能被站点改写，所以再认一次挑战脚本/组件本身。
    const markers = [
      'script[src*="challenge-platform"]',
      'script[src*="challenges.cloudflare.com"]',
      'iframe[src*="challenges.cloudflare.com"]',
      'input[name="cf-turnstile-response"]',
      '#challenge-form',
      '#challenge-running',
      '#cf-challenge-running',
      '[class*="cf-chl"]'
    ];
    return markers.some((selector) => {
      try { return Boolean(document.querySelector(selector)); } catch { return false; }
    });
  };
  /**
   * 文档还在加载、或正文里还没有任何可交互内容时，它不构成「已确认的出版社文章页」。
   *
   * 挑战插页、被反爬拦下的空文档、以及解析被卡住的页面都属于这一类：此时消耗尝试
   * 次数只会在 12 秒后得出「已进入 PDF 预览器」这种错误结论，并把普通文章页当成
   * 整屏预览器去做页面位移。所以这种情况只等待，不计数。
   */
  const publisherContentReady = () => {
    if (document.readyState === 'loading') return false;
    const body = document.body;
    if (!body) return false;
    if (String(body.innerText || '').trim().length > 0) return true;
    return Boolean(body.querySelector?.('img,svg,canvas,video,iframe,embed,object,a[href],button'));
  };
  const automationRoots = () => {
    const roots = [document];
    const visit = (root) => {
      for (const element of root.querySelectorAll?.('*') || []) {
        if (element.shadowRoot) { roots.push(element.shadowRoot); visit(element.shadowRoot); }
        if (element.matches?.('iframe,frame')) {
          try {
            if (element.contentDocument) { roots.push(element.contentDocument); visit(element.contentDocument); }
          } catch { /* WebVPN 转发后的跨源 frame 由其自己的页面加载回调处理。 */ }
        }
      }
    };
    visit(document);
    return roots;
  };
  const candidates = () => automationRoots()
    .flatMap((root) => [...(root.querySelectorAll?.('a[href],button,[role="button"]') || [])])
    .filter(visible)
    .map((element) => ({ element: clickTarget(element), text: description(element), href: hrefOf(element) }));
  const attempted = new Set();
  let lastClickAt = 0;
  const candidateKey = (item) => item.href + '|' + item.text;
  const markClicked = (item) => {
    if (item) attempted.add(candidateKey(item));
    lastClickAt = Date.now();
    window.__ibmWebVpnLocalClickAt = lastClickAt;
    window.__ibmWebVpnCapture?.({ phase: 'clicked', kind });
  };
  const forceDownload = (href) => {
    if (!href || window[runKey + '_forced']) return false;
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.style.display = 'none';
    document.documentElement.appendChild(anchor);
    window[runKey + '_forced'] = true;
    markClicked();
    anchor.click();
    setTimeout(() => anchor.remove(), 1000);
    return true;
  };
  const previewDownloadUrl = () => {
    // Wiley 的正文和 SI 都会先进入 PDF 预览页。SI 预览页同样要把实际
    // PDF 地址交给下载捕获器，避免再生成一份浏览器默认下载副本。
    if (kind !== 'pdf' && publisher !== 'wiley') return '';
    const current = new URL(location.href);
    const path = current.pathname;
    const wileyPreviewPage = publisher === 'wiley'
      && (/\/doi\/pdf(?:direct)?\//i.test(path)
        || /\/action\/downloadsupplement|\/suppinfo\/|\/asset\//i.test(path)
        || /\.pdf(?:[/?#]|$)/i.test(path));
    if (kind === 'pdf' || wileyPreviewPage) {
      for (const root of automationRoots()) {
        for (const element of root.querySelectorAll?.('iframe[src],embed[src],object[data]') || []) {
          const raw = element.getAttribute('src') || element.getAttribute('data');
          if (!raw) continue;
          const resolved = new URL(raw, location.href);
          if (/\/stampPDF\/getPDF\.jsp|\/doi\/pdf\/|\/pdfft(?:[/?#]|$)|\/content\/pdf\/|\.pdf(?:[?#]|$)/i.test(resolved.href)) {
            if (/\/pdfft(?:[/?#]|$)/i.test(resolved.pathname)) resolved.searchParams.set('download', 'true');
            return resolved.href;
          }
        }
      }
    }
    if (wileyPreviewPage) {
      if (current.searchParams.get('download') === 'true') return '';
      current.searchParams.set('download', 'true');
      return current.href;
    }
    if (publisher === 'ieee' && /\/stamp\/stamp\.jsp$/i.test(path)) {
      current.pathname = path.replace(/\/stamp\/stamp\.jsp$/i, '/stampPDF/getPDF.jsp');
      return current.href;
    }
    if ((publisher === 'science' || publisher === 'acs') && /\/doi\/(?:reader|epdf)\//i.test(path)) {
      current.pathname = path.replace(/\/doi\/(?:reader|epdf)\//i, '/doi/pdf/');
      current.searchParams.set('download', 'true');
      return current.href;
    }
    if (publisher === 'elsevier' && /\/pdfft(?:\/|$)/i.test(path)) {
      current.searchParams.set('download', 'true');
      current.searchParams.set('isDTMRedir', 'true');
      return current.href;
    }
    return '';
  };
  const pdfScore = ({ text, href }) => {
    if (/supplement|supporting|supp[\s._-]|additional file|source data|methods?|moesm|mediaobjects/.test(`${text} ${href}`)) return -100;
    let score = 0;
    if (/download pdf|view pdf|article pdf|全文\s*pdf|下载\s*pdf/.test(text)) score += 10;
    if (/open pdf|read pdf|pdf full text/.test(text)) score += 10;
    if (/download|save|保存|下载/.test(text) && /pdf|viewer|epdf|pdfft/.test(clean(location.href))) score += 12;
    if (/\bpdf\b/.test(text)) score += 3;
    if (/\/articles?\/[^?#/]+\.pdf(?:[?#]|$)|\/content\/pdf\/|articlepdf|downloadpdf/.test(href)) score += 9;
    if (/\.pdf(?:[?#]|$)/.test(href)) score += 5;
    return score;
  };
  const siScore = ({ text, href }) => {
    const combined = `${text} ${href}`;
    if (/source data/.test(combined)) return -20;
    let score = 0;
    if (/supplementary methods?|supplemental methods?|supplyment methods?/.test(text)) score += 14;
    if (/supplementary information|supporting information|supplementary material|supporting material/.test(text)) score += 12;
    if (/supplement|supporting|supp[\s._-]|additional file|\besm\b/.test(text)) score += 6;
    if (/supplement|suppl|moesm|mediaobjects|additional[-_ ]file|static-content\.springer/.test(href)) score += 8;
    if (/download|下载/.test(text)) score += 3;
    if (/\.pdf(?:[?#]|$)|\bpdf\b/.test(`${href} ${text}`)) score += 5;
    if (/\.(?:docx?|zip)(?:[?#]|$)/.test(href)) score += 7;
    return score;
  };
  const clickWileySupportingInformation = (items) => {
    if (publisher !== 'wiley' || kind !== 'si') return false;

    // Wiley 的 Supporting Information 是折叠区标题，不是文件下载入口。
    // 先只展开折叠区，再从带有 Filename 表头的区域中选择真实文件链接。
    const expander = items.find(({ element, text, href }) =>
      /supporting information/.test(text)
      && (element.matches('button,[role="button"]')
        || element.hasAttribute('aria-expanded')
        || /^#/.test(element.getAttribute('href') || '')
        || /#.*support/i.test(href)));
    if (expander && !expanded) {
      expanded = true;
      if (expander.element.getAttribute('aria-expanded') !== 'true') expander.element.click();
      return true;
    }
    expanded = true;

    const filenameLink = items.find(({ element, text, href }) => {
      const anchor = element.closest?.('a[href]') || (element.matches?.('a[href]') ? element : null);
      if (!anchor || !href || /^#|^javascript:/i.test(href) || attempted.has(candidateKey({ text, href }))) return false;
      const row = anchor.closest?.('tr');
      const table = anchor.closest?.('table');
      const region = anchor.closest?.('section,article,[role="region"],div');
      const context = clean(`${text} ${row?.innerText || ''} ${table?.innerText || ''} ${region?.innerText || ''}`);
      return /\bfilename\b/.test(context)
        && !/^supporting information$/i.test(String(anchor.innerText || '').trim());
    });
    if (!filenameLink) return false;
    markClicked(filenameLink);
    // 正常进入 Wiley 的 PDF 预览页；下一次页面加载会注入本脚本并捕获保存。
    filenameLink.element.click();
    return true;
  };
  const scan = () => {
    if (window.__ibmWebVpnDownloadStarted) { clearInterval(timer); return; }
    if (!confirmedPublisherPage()) return;
    if (!reportedSearch) { reportedSearch = true; signal('searching'); }
    const previewUrl = previewDownloadUrl();
    // Wiley 首次进入文章页时为自动验证预留至少 10 秒。验证未完成时继续
    // 等待，不消耗自动化重试次数，也不提前把任务判为失败。
    if (publisher === 'wiley' && !previewUrl && Date.now() < wileyReadyAt) return;
    if (challengePresent()) {
      if (!reportedChallenge) { reportedChallenge = true; signal('challenge'); }
      return;
    }
    if (reportedChallenge) { reportedChallenge = false; signal('searching'); }
    // 空白或还没加载完的文档先等：挑战页/被拦页面不应该消耗自动化重试次数。
    // 超过约 30 秒仍无内容才退回人工处理，避免任务永远停在"正在查找入口"。
    if (!publisherContentReady()) {
      stalledTicks += 1;
      if (stalledTicks >= 40) { clearInterval(timer); signal(kind === 'si' ? 'si-manual' : 'pdf-manual'); }
      return;
    }
    stalledTicks = 0;
    if (lastClickAt && Date.now() - lastClickAt < 4000) return;
    attempts += 1;
    if (attempts >= 2 && forceDownload(previewUrl)) return;
    const items = candidates();
    if (clickWileySupportingInformation(items)) return;
    const scored = items.filter((item) => !attempted.has(candidateKey(item)))
      .map((item) => ({ ...item, score: kind === 'pdf' ? pdfScore(item) : siScore(item) }))
      .sort((a, b) => b.score - a.score);
    const threshold = kind === 'pdf' ? 8 : 10;
    if (scored[0]?.score >= threshold) {
      markClicked(scored[0]);
      scored[0].element.click();
      return;
    }
    if (kind === 'si' && !expanded) {
      const expander = items.find(({ element, text }) =>
        /supplementary information|supporting information|supplementary methods?|supplyment methods?/.test(text)
        && (element.matches('button,[role="button"]') || element.getAttribute('aria-expanded') === 'false'));
      if (expander) { expanded = true; expander.element.click(); return; }
    }
    // 原生 PDF 查看器的工具栏不属于网页 DOM，脚本无法替用户点击。此时只上报
    // “等待人工保存”，不能清除捕获任务；用户随后点击保存仍由 on_download 接管。
    if (attempts >= 16) { clearInterval(timer); signal(kind === 'si' ? 'si-manual' : 'pdf-manual'); }
  };
  const timer = setInterval(scan, 750);
  scan();
})();
"#;

/// 主窗口的 label（由 `tauri.conf.json` 的 `app.windows[0]` 定义）。
/// Agent 只观察候选下载入口，不读整页正文、Cookie 或表单值。
const AGENT_OBSERVE_SCRIPT: &str = r#"
(() => {
  if (document.querySelector('input[type="password"]')) return { error: '登录页请由用户操作' };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const roots = [document];
  for (let i = 0; i < roots.length && roots.length < 20; i++) {
    for (const el of roots[i].querySelectorAll('*')) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
      if (roots.length >= 20) break;
    }
  }
  const rows = [];
  const elements = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll('a[href],button,[role="button"]')) {
      if (!visible(el)) continue;
      const label = String(el.getAttribute('aria-label') || el.innerText || el.textContent || '')
        .replace(/\s+/g, ' ').trim().slice(0, 100);
      const href = el.closest('a[href]')?.getAttribute('href') || '';
      if (!/pdf|download|supplement|supporting|附件|补充|下载|保存|全文|article/i.test(label + ' ' + href)) continue;
      const id = 'e' + (rows.length + 1);
      elements.push(el);
      rows.push({ id, role: el.tagName.toLowerCase(), label,
        likely: /supplement|supporting|附件|补充/i.test(label + ' ' + href) ? 'si' : 'pdf' });
      if (rows.length >= 30) break;
    }
    if (rows.length >= 30) break;
  }
  const observationId = crypto.randomUUID().replace(/-/g, '');
  window.__ibmAgentObservation = { observationId, at: Date.now(), elements };
  return { observationId, host: location.hostname.slice(0, 100),
    documentType: document.contentType || '', candidates: rows };
})()
"#;

const AGENT_CLICK_SCRIPT: &str = r#"
(() => {
  const snapshot = window.__ibmAgentObservation;
  if (!snapshot || snapshot.observationId !== __OBSERVATION_ID__ || Date.now() - snapshot.at > 15000)
    return { error: '页面观察已过期，请重新观察' };
  const index = Number(String(__ELEMENT_ID__).slice(1)) - 1;
  const element = snapshot.elements[index];
  if (!element || !element.isConnected) return { error: '入口已变化，请重新观察' };
  const r = element.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { error: '入口已不可见，请重新观察' };
  window.__ibmAgentObservation = null;
  element.click();
  return { clicked: true, elementId: __ELEMENT_ID__ };
})()
"#;

const MAIN_WINDOW_LABEL: &str = "main";

/// 出现这些参数名时一律脱敏。长度 <= 2 的按全等匹配，其余按包含匹配——
/// 否则 "t" 会命中 "target" 之类的正常参数名，把有用的信息也一起抹掉。
const SENSITIVE_PARAM_HINTS: &[&str] = &[
    "token",
    "ticket",
    "sso",
    "session",
    "auth",
    "code",
    "state",
    "password",
    "passwd",
    "secret",
    "key",
    "signature",
    "sig",
    "nonce",
    "sid",
    "jsessionid",
    "assertion",
    "saml",
    "t",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebVpnEvent {
    /// navigation | newWindow | downloadRequested | downloadFinished | denied | error
    pub kind: String,
    /// 已脱敏的 URL。可能是空串（例如无法解析的输入）。
    pub url: String,
    pub host: String,
    pub detail: String,
}

/// 会话状态（计划 §4.2）。UI 只依据这个枚举决策，**不根据 URL 文案猜测**登录是否成功。
///
/// 阶段 2 的捕获相关状态（waiting-download / uploading / expired）届时再补，
/// 现在定义会让它们处于"永不构造"状态。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WebVpnSessionState {
    /// 尚未创建窗口。
    #[default]
    Closed,
    /// 正在创建或加载门户。
    Opening,
    /// 门户已打开，等待用户完成统一身份认证。
    WaitingLogin,
    /// 用户已确认可用，允许发起跳转。
    Ready,
    /// 正在转发目标页。
    Navigating,
    /// 已到目标页；Nature 自动查找下载入口，其他出版社等待用户点击。
    WaitingDownload,
    /// 用户已点击下载，WebView2 正在下载文件。
    Downloading,
    /// 下载完成，正在上传到本地捕获端点。
    Uploading,
    /// 待捕获任务已经过期。
    Expired,
    /// 导航、加载或配置失败。
    Error,
}

impl WebVpnSessionState {
    /// 状态机允许的迁移。把所有迁移收在一处，避免 UI 与 shell 各自猜测合法顺序。
    pub fn can_transition_to(self, next: Self) -> bool {
        use WebVpnSessionState::*;
        match (self, next) {
            // 同态自转（例如重复点"打开"）总是允许，幂等。
            (a, b) if a == b => true,
            (Closed, Opening) => true,
            (Opening, WaitingLogin) => true,
            // 门户加载过程中用户可能直接点了"我已登录"。
            (Opening, Ready) => true,
            (WaitingLogin, Ready) => true,
            (WaitingLogin, Navigating) => true,
            (Ready, Navigating) => true,
            (Navigating, Ready) => true,
            (Navigating, WaitingDownload) => true,
            (WaitingDownload, Downloading) => true,
            (Downloading, Uploading) => true,
            (WaitingDownload, Uploading) => true,
            (Uploading, Ready) => true,
            (WaitingDownload, Ready) => true,
            (Downloading, Ready) => true,
            (Expired, Ready) => true,
            // 任何非关闭态都可能失败或需要重开。
            (_, Error) => true,
            (Error, Opening) => true,
            (Error, Closed) => true,
            (_, Closed) => true,
            _ => false,
        }
    }
}

/// 导航策略。阶段 0 探测 `enforce = false`；阶段 1 起由配置决定。
#[derive(Debug, Clone, Default)]
pub struct WebVpnPolicy {
    pub enforce: bool,
    pub allowed_hosts: Vec<String>,
}

impl WebVpnPolicy {
    /// 白名单匹配：host 与规则全等，或为其子域。`example.com` 命中
    /// `example.com` 与 `a.example.com`，但不命中 `notexample.com`。
    pub fn allows(&self, host: &str) -> bool {
        let host = host.to_ascii_lowercase();
        if host.is_empty() {
            return false;
        }
        self.allowed_hosts.iter().any(|rule| {
            let rule = rule.trim().trim_start_matches('.').to_ascii_lowercase();
            !rule.is_empty() && (host == rule || host.ends_with(&format!(".{rule}")))
        })
    }

    /// 由配置构造策略。**门户自身的 host 始终放行**——它是用户配置的入口，
    /// 不放行就连登录页都进不去。
    pub fn from_config(portal_url: &str, extra_hosts: &[String], enforce: bool) -> Self {
        let mut allowed: Vec<String> = url::Url::parse(portal_url.trim())
            .ok()
            .and_then(|url| url.host_str().map(|host| host.to_ascii_lowercase()))
            .into_iter()
            .collect();
        allowed.extend(
            extra_hosts
                .iter()
                .map(|host| host.trim().trim_start_matches('.').to_ascii_lowercase())
                .filter(|host| !host.is_empty()),
        );
        allowed.sort();
        allowed.dedup();
        Self {
            enforce,
            allowed_hosts: allowed,
        }
    }

    /// 探测专用策略：只记录不拦截。
    pub fn record_only() -> Self {
        Self {
            enforce: false,
            allowed_hosts: Vec::new(),
        }
    }
}

/// Nature Portfolio 的补充材料通常由公开的 Springer Nature 静态域名提供。
/// 这里只接受明确的 SI + 10.1038 DOI/Nature 页面组合，避免客户端借 directAccess
/// 把受控侧栏变成任意网页浏览器。
pub fn is_nature_article(target: &url::Url) -> bool {
    let host = target.host_str().unwrap_or_default().to_ascii_lowercase();
    let path = target.path().to_ascii_lowercase();
    (host == "doi.org" && (path.starts_with("/10.1038/") || path.starts_with("/10.1038%2f")))
        || host == "nature.com"
        || host.ends_with(".nature.com")
}

/// 直接以 `.pdf` 结尾的文档地址：WebView2 内置查看器会占满窗口，其顶部工具栏
/// 会被我们的 76px 工具栏盖住，因此这类页面需要开启页面位移。
pub fn is_pdf_document_url(target: &url::Url) -> bool {
    target.path().to_ascii_lowercase().ends_with(".pdf")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublisherAdapter {
    Nature,
    Springer,
    Science,
    Elsevier,
    Acs,
    Rsc,
    Ieee,
    WileyPaused,
    Other,
}

impl PublisherAdapter {
    pub fn from_target(target: &url::Url) -> Self {
        let host = target.host_str().unwrap_or_default().to_ascii_lowercase();
        let path = target.path().to_ascii_lowercase();
        let matches_doi = |prefix: &str| {
            host == "doi.org"
                && (path.starts_with(&format!("/{prefix}/"))
                    || path.starts_with(&format!("/{}%2f", prefix)))
        };
        if is_nature_article(target) {
            Self::Nature
        } else if matches_doi("10.1007") || host.contains("springer.com") {
            Self::Springer
        } else if matches_doi("10.1126") || host.ends_with("science.org") {
            Self::Science
        } else if matches_doi("10.1016")
            || host.ends_with("sciencedirect.com")
            || host.ends_with("elsevier.com")
        {
            Self::Elsevier
        } else if matches_doi("10.1021") || host.ends_with("acs.org") {
            Self::Acs
        } else if matches_doi("10.1039") || host.ends_with("rsc.org") {
            Self::Rsc
        } else if matches_doi("10.1109") || host.ends_with("ieee.org") {
            Self::Ieee
        } else if matches_doi("10.1002") || matches_doi("10.1111") || host.ends_with("wiley.com") {
            Self::WileyPaused
        } else {
            Self::Other
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::Nature => "nature",
            Self::Springer => "springer",
            Self::Science => "science",
            Self::Elsevier => "elsevier",
            Self::Acs => "acs",
            Self::Rsc => "rsc",
            Self::Ieee => "ieee",
            Self::WileyPaused => "wiley",
            Self::Other => "other",
        }
    }

    fn supports_automation(self) -> bool {
        !matches!(self, Self::Other)
    }

    pub fn direct_si(self, kind: &str) -> bool {
        kind == "si" && matches!(self, Self::Nature | Self::Springer)
    }
}

pub fn is_direct_springer_family_si(kind: &str, target: &url::Url) -> bool {
    PublisherAdapter::from_target(target).direct_si(kind)
}

pub fn allow_direct_nature_si_hosts(policy: &mut WebVpnPolicy) {
    policy.allowed_hosts.extend([
        "doi.org".to_string(),
        "nature.com".to_string(),
        "springernature.com".to_string(),
        "static-content.springer.com".to_string(),
    ]);
    policy.allowed_hosts.sort();
    policy.allowed_hosts.dedup();
}

/// 会话内部状态。所有字段共用一个 Mutex，避免多锁的加锁顺序问题。
#[derive(Debug, Default)]
struct Session {
    state: WebVpnSessionState,
    /// WebVPN 门户是否已显示登录后的网址转发界面。与下载生命周期分开记录。
    authenticated: bool,
    /// 子 WebView 是否正在主窗口右侧显示。隐藏时 WebView 仍存在，以保留登录态。
    sidebar_visible: bool,
    /// DSH 右侧栏是否已接管布局。**只置位，不清除。**
    ///
    /// 收到过任意一条 `webvpn_set_rect` 即为真（即使那一条上报的是「不可见」）。
    /// 置位后 `layout_sidebar` 这条按比例分栏的老路径彻底停用，主 WebView 不再收窄，
    /// 让位交给 DSH 右侧栏自己的 push presentation。
    client_layout: bool,
    /// DSH 右侧栏上报的「文献浏览器」tab 正文矩形（x, y, width, height，逻辑像素）。
    ///
    /// 仅在客户端明确上报「可见且尺寸足够」时写入；`None` 表示 tab 当前没有可用区域，
    /// 此时 `show_sidebar` 只隐藏子 WebView，不猜位置。
    client_rect: Option<(f64, f64, f64, f64)>,
    policy: WebVpnPolicy,
    /// 最近一次由应用主动转发的目标 host。
    target_host: Option<String>,
    /// 被白名单拦下、尚未放行的 host。这是「白名单漏域名导致登录被锁死」
    /// 的逃生阀：UI 据此提示用户是否放行，而不是让用户面对一个静默空白页。
    denied_hosts: Vec<String>,
    last_error: Option<String>,
    pending: Option<PendingCapture>,
    capture_notice: Option<CaptureNotice>,
    generation: u64,
}

#[derive(Debug, Clone)]
struct CaptureNotice {
    kind: String,
    phase: &'static str,
    expires_at: Instant,
}

#[derive(Debug, Clone)]
struct PendingCapture {
    generation: u64,
    task_id: String,
    kind: String,
    publisher: PublisherAdapter,
    /// Agent 任务自动点击；面板任务只布防捕获并交给用户手动操作。
    automate: bool,
    /// 只描述自动化已观察到的阶段；不把点击冒充为下载已开始。
    automation_stage: String,
    native_saving: bool,
    /// 仅在未启用 iWAN 时，对公开的 Nature/Springer SI 预览链接使用后端直取。
    /// iWAN 全部路由模式必须让 WebView2 自己直连并触发下载，避免 reqwest 与
    /// 系统代理/认证路径不一致造成“页面能开、附件直取失败”。
    intercept_direct_si: bool,
    upload_url: url::Url,
    temp_path: PathBuf,
    expires_at: Instant,
    download_started_at: Option<Instant>,
    /// WebView2 可能为同一次点击连续发出多个 Requested。只允许第一个请求
    /// 占用捕获目标，后续请求直接取消，避免多个下载同时写同一个文件。
    download_claimed: bool,
    /// 取消重复 Requested 后，WebView2 仍可能补发 success=false 的 Finished。
    /// 这些回调不能误伤仍在进行的首个下载。
    duplicate_failures_to_ignore: u32,
}

#[derive(Debug, PartialEq, Eq)]
enum DownloadDecision {
    Capture(PathBuf),
    Duplicate,
    PassThrough,
}

#[derive(Debug, Clone)]
pub struct PendingUpload {
    generation: u64,
    pub task_id: String,
    pub kind: String,
    pub upload_url: url::Url,
    pub path: PathBuf,
}

#[derive(Default)]
pub struct WebVpnState {
    events: Mutex<Vec<WebVpnEvent>>,
    session: Mutex<Session>,
}

/// 供 UI 渲染的完整状态。配置与窗口存在性由命令层补进来。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebVpnStatus {
    pub state: WebVpnSessionState,
    pub authenticated: bool,
    pub portal_url: String,
    /// **当前会话实际生效**的白名单（含门户自身；探测模式下为空）。
    pub allowed_hosts: Vec<String>,
    /// **当前会话实际生效**的拦截开关（探测模式下恒为 `false`）。
    pub enforce_navigation: bool,
    /// 配置里保存的额外放行域名（**用户意图**，不含门户自身）。
    ///
    /// 与 `allowed_hosts` 必须分开：探测模式下生效策略只记录不拦截，而配置
    /// 里的意图可能是"已启用"。UI 若把两者混为一谈，就无法既回填表单又如实
    /// 反映实际拦截行为。
    pub configured_allowed_hosts: Vec<String>,
    /// 配置里保存的拦截开关（**用户意图**）。
    pub configured_enforce_navigation: bool,
    pub target_host: Option<String>,
    pub denied_hosts: Vec<String>,
    pub last_error: Option<String>,
    pub pending_task_id: Option<String>,
    pub pending_kind: Option<String>,
    /// 自动化找入口的可观察阶段；点击并不代表下载已开始。
    pub automation_stage: Option<String>,
    /// 当前下载目标文件已经写入的字节数。WebView2 不提供总大小，因此该值
    /// 用于显示真实接收量与不确定进度条，不伪造百分比。
    pub downloaded_bytes: Option<u64>,
    /// 自 DownloadEvent::Requested 起经过的毫秒数。
    pub download_elapsed_ms: Option<u64>,
    /// WebVPN 窗口当前是否已创建（隐藏也算已创建）。
    pub window_open: bool,
    /// WebVPN 子 WebView 当前是否在主窗口右侧可见。
    pub sidebar_visible: bool,
    /// 探测模式是否可用（仅 debug 构建为 true）。
    pub probe_available: bool,
}

impl WebVpnState {
    pub fn record(&self, event: WebVpnEvent) {
        let Ok(mut events) = self.events.lock() else {
            return;
        };
        events.push(event);
        if events.len() > MAX_EVENTS {
            let overflow = events.len() - MAX_EVENTS;
            events.drain(0..overflow);
        }
    }

    pub fn snapshot(&self) -> Vec<WebVpnEvent> {
        self.events
            .lock()
            .map(|events| events.clone())
            .unwrap_or_default()
    }

    pub fn clear(&self) {
        if let Ok(mut events) = self.events.lock() {
            events.clear();
        }
    }

    /// 状态迁移。非法迁移返回 `Err` 而不静默改写，避免 UI 与 shell 对当前
    /// 状态的理解漂移。
    pub fn transition(&self, next: WebVpnSessionState) -> Result<WebVpnSessionState, String> {
        let Ok(mut session) = self.session.lock() else {
            return Err("WebVPN 状态不可用".to_string());
        };
        if !session.state.can_transition_to(next) {
            return Err(format!(
                "WebVPN 状态不允许从 {:?} 变为 {:?}",
                session.state, next
            ));
        }
        let previous = session.state;
        session.state = next;
        if next == WebVpnSessionState::Ready
            && matches!(
                previous,
                WebVpnSessionState::Opening | WebVpnSessionState::WaitingLogin
            )
        {
            session.authenticated = true;
        } else if next == WebVpnSessionState::Closed {
            session.authenticated = false;
        }
        if next != WebVpnSessionState::Error {
            session.last_error = None;
        }
        Ok(next)
    }

    /// 记录一次由应用主动发起的转发，并进入 `Navigating`。
    ///
    /// 阶段 1 尚无调用方：**转发规则正是阶段 0 要测得的东西**（计划明确禁止
    /// "按截图猜测转发规则"），在此之前不允许把目标 URL 拼成 WebVPN 链接。
    /// 阶段 2/3 由 `webvpn_open_target` 接入；此处保留并有单测覆盖。
    #[allow(dead_code)]
    pub fn begin_navigation(&self, target_host: &str) -> Result<(), String> {
        let Ok(mut session) = self.session.lock() else {
            return Err("WebVPN 状态不可用".to_string());
        };
        if !session
            .state
            .can_transition_to(WebVpnSessionState::Navigating)
        {
            return Err(format!("当前状态 {:?} 不允许发起转发", session.state));
        }
        session.state = WebVpnSessionState::Navigating;
        session.target_host = Some(target_host.to_ascii_lowercase());
        session.last_error = None;
        Ok(())
    }

    pub fn prepare_capture(
        &self,
        task_id: &str,
        kind: &str,
        target_host: &str,
        publisher: PublisherAdapter,
        automate: bool,
        intercept_direct_si: bool,
        upload_url: url::Url,
        temp_path: PathBuf,
    ) -> Result<u64, String> {
        let Ok(mut session) = self.session.lock() else {
            return Err("WebVPN 状态不可用".to_string());
        };
        if matches!(
            session.state,
            WebVpnSessionState::Downloading | WebVpnSessionState::Uploading
        ) {
            return Err("已有文献正在下载或归档，请完成后再试".to_string());
        }
        if matches!(
            session.state,
            WebVpnSessionState::Closed | WebVpnSessionState::Opening
        ) {
            return Err("WebVPN 侧栏尚未准备好，请稍后重试".to_string());
        }
        // 新捕获总是替换旧 pending：客户端在发起新捕获前已通过 createCaptureTask
        // 作废旧任务（服务端旧令牌立即失效）。旧 pending 若不替换，会留下一个
        // 「导航被弹回、永远等不到下载」的僵尸捕获——它既挡住重试，又会在用户
        // 稍后手动下载时用已作废的令牌上传 → 409 → 文件被静默删除
        // （本次「点下载没反应」的根因）。
        if let Some(active) = session.pending.take() {
            let _ = fs::remove_file(&active.temp_path);
        }
        session.generation = session.generation.wrapping_add(1).max(1);
        let generation = session.generation;
        session.capture_notice = None;
        session.pending = Some(PendingCapture {
            generation,
            task_id: task_id.to_string(),
            kind: kind.to_string(),
            publisher,
            automate,
            automation_stage: if automate { "opening" } else { "manual" }.to_string(),
            native_saving: false,
            intercept_direct_si,
            upload_url,
            temp_path,
            expires_at: Instant::now() + CAPTURE_TTL,
            download_started_at: None,
            download_claimed: false,
            duplicate_failures_to_ignore: 0,
        });
        session.state = WebVpnSessionState::Navigating;
        session.target_host = Some(target_host.to_ascii_lowercase());
        session.last_error = None;
        Ok(generation)
    }

    fn pending_automation(&self) -> Option<(String, PublisherAdapter)> {
        self.session
            .lock()
            .ok()?
            .pending
            .as_ref()
            .and_then(|pending| {
                (pending.automate
                    && pending.publisher.supports_automation()
                    && !pending.download_claimed)
                    .then(|| (pending.kind.clone(), pending.publisher))
            })
    }

    fn set_automation_stage(&self, stage: &str) {
        if !matches!(stage, "searching" | "clicked" | "manual" | "verification") {
            return;
        }
        if let Ok(mut session) = self.session.lock() {
            if let Some(pending) = session.pending.as_mut() {
                if pending.automate && !pending.download_claimed {
                    pending.automation_stage = stage.to_string();
                }
            }
        }
    }

    fn should_capture_direct_si_preview(&self, target: &url::Url) -> bool {
        let Ok(session) = self.session.lock() else {
            return false;
        };
        let Some(pending) = session.pending.as_ref() else {
            return false;
        };
        pending.automate
            && pending.intercept_direct_si
            && pending.publisher.direct_si(&pending.kind)
            && !pending.download_claimed
            && is_springer_family_si_url(target)
    }

    fn claim_download_destination(&self) -> DownloadDecision {
        let Ok(mut session) = self.session.lock() else {
            return DownloadDecision::PassThrough;
        };
        let expired = session
            .pending
            .as_ref()
            .map(|pending| pending.expires_at <= Instant::now())
            .unwrap_or(false);
        if expired {
            let path = session.pending.take().map(|pending| pending.temp_path);
            session.state = WebVpnSessionState::Expired;
            session.last_error = Some("文献捕获任务已过期，请重新发起".to_string());
            drop(session);
            if let Some(path) = path {
                let _ = fs::remove_file(path);
            }
            return DownloadDecision::PassThrough;
        }
        let Some(pending) = session.pending.as_mut() else {
            return DownloadDecision::PassThrough;
        };
        if pending.download_claimed {
            pending.duplicate_failures_to_ignore =
                pending.duplicate_failures_to_ignore.saturating_add(1);
            return DownloadDecision::Duplicate;
        }
        pending.download_claimed = true;
        pending.download_started_at = Some(Instant::now());
        let destination = pending.temp_path.clone();
        // 用户已点击下载：从「等待下载」进入「下载中」，让 UI 能给出
        // 「正在下载」的阶段提示，而不是一直停在「请点击下载」。
        session.state = WebVpnSessionState::Downloading;
        DownloadDecision::Capture(destination)
    }

    fn claim_native_save_destination(&self, task_id: &str) -> Result<PathBuf, String> {
        let Ok(mut session) = self.session.lock() else {
            return Err("文献浏览器状态不可用".to_string());
        };
        let Some(pending) = session.pending.as_mut() else {
            return Err("没有待保存的文献任务".to_string());
        };
        if pending.task_id != task_id || pending.kind != "pdf" || pending.download_claimed {
            return Err("当前任务不允许保存原生 PDF".to_string());
        }
        pending.download_claimed = true;
        pending.native_saving = true;
        pending.automation_stage = "saving".to_string();
        pending.download_started_at = Some(Instant::now());
        let path = pending.temp_path.clone();
        session.state = WebVpnSessionState::Downloading;
        Ok(path)
    }

    fn should_ignore_failed_finish(&self) -> bool {
        let Ok(mut session) = self.session.lock() else {
            return false;
        };
        let Some(pending) = session.pending.as_mut() else {
            return false;
        };
        if pending.duplicate_failures_to_ignore == 0 {
            return false;
        }
        pending.duplicate_failures_to_ignore -= 1;
        true
    }

    fn begin_upload(&self, path: &Path) -> Option<PendingUpload> {
        let Ok(mut session) = self.session.lock() else {
            return None;
        };
        let pending = session.pending.as_ref()?;
        if pending.temp_path != path || pending.expires_at <= Instant::now() {
            return None;
        }
        let upload = PendingUpload {
            generation: pending.generation,
            task_id: pending.task_id.clone(),
            kind: pending.kind.clone(),
            upload_url: pending.upload_url.clone(),
            path: path.to_path_buf(),
        };
        session.state = WebVpnSessionState::Uploading;
        session.last_error = None;
        Some(upload)
    }

    pub fn finish_upload(&self, generation: u64, result: Result<(), String>) {
        let Ok(mut session) = self.session.lock() else {
            return;
        };
        if session.pending.as_ref().map(|pending| pending.generation) != Some(generation) {
            return;
        }
        let kind = session.pending.as_ref().map(|pending| pending.kind.clone()).unwrap_or_default();
        session.capture_notice = Some(CaptureNotice {
            kind,
            phase: if result.is_ok() { "completed" } else { "error" },
            expires_at: Instant::now() + Duration::from_secs(8),
        });
        session.pending = None;
        match result {
            Ok(()) => {
                session.state = WebVpnSessionState::Ready;
                session.last_error = None;
            }
            Err(error) => {
                session.state = WebVpnSessionState::Error;
                session.last_error = Some(error);
            }
        }
    }

    fn fail_pending_download(&self, message: &str) {
        let path = {
            let Ok(mut session) = self.session.lock() else {
                return;
            };
            let pending = session.pending.take();
            if let Some(ref pending) = pending {
                session.capture_notice = Some(CaptureNotice {
                    kind: pending.kind.clone(),
                    phase: "error",
                    expires_at: Instant::now() + Duration::from_secs(8),
                });
            }
            let path = pending.map(|pending| pending.temp_path);
            if path.is_some() {
                session.state = WebVpnSessionState::Error;
                session.last_error = Some(message.to_string());
            }
            path
        };
        if let Some(path) = path {
            let _ = fs::remove_file(path);
        }
    }

    pub fn cancel_capture(&self, task_id: &str) -> Result<(), String> {
        let Ok(mut session) = self.session.lock() else {
            return Err("WebVPN 状态不可用".to_string());
        };
        if let Some(pending) = session.pending.as_ref() {
            if pending.task_id != task_id {
                return Err("当前 WebVPN 捕获任务与请求不匹配".to_string());
            }
            let path = pending.temp_path.clone();
            session.pending = None;
            session.capture_notice = None;
            session.state = WebVpnSessionState::Ready;
            session.last_error = None;
            let _ = fs::remove_file(path);
        }
        Ok(())
    }

    /// 当前待捕获任务的 id；没有任务时为 `None`。
    pub fn pending_task_id(&self) -> Option<String> {
        self.session
            .lock()
            .ok()
            .and_then(|session| session.pending.as_ref().map(|pending| pending.task_id.clone()))
    }

    /// 取消当前待捕获任务，不管它的 id 是什么（页面里的小球只知道「有一个任务在跑」）。
    pub fn cancel_pending_capture(&self) -> Result<(), String> {
        match self.pending_task_id() {
            Some(task_id) => self.cancel_capture(&task_id),
            None => Ok(()),
        }
    }

    /// 页面里捕获小球要用的状态，已序列化成 JSON；`null` 表示没有任务、小球应隐藏。
    ///
    /// 只暴露阶段、类别与已接收字节——不含任务令牌、临时路径或任何页面内容。
    pub fn capture_ball_json(&self) -> String {
        let Ok(session) = self.session.lock() else {
            return "null".to_string();
        };
        let Some(pending) = session.pending.as_ref() else {
            return session.capture_notice.as_ref()
                .filter(|notice| notice.expires_at > Instant::now())
                .map(|notice| serde_json::json!({
                    "phase": notice.phase,
                    "kind": notice.kind,
                }).to_string())
                .unwrap_or_else(|| "null".to_string());
        };
        let bytes = pending
            .download_started_at
            .and_then(|_| fs::metadata(&pending.temp_path).ok().map(|meta| meta.len()));
        let phase = match session.state {
            WebVpnSessionState::Downloading if pending.native_saving => "saving",
            WebVpnSessionState::Downloading => "downloading",
            WebVpnSessionState::Uploading => "uploading",
            WebVpnSessionState::WaitingDownload => pending.automation_stage.as_str(),
            WebVpnSessionState::Navigating => "opening",
            _ => "waiting",
        };
        serde_json::json!({
            "phase": phase,
            "kind": pending.kind,
            "bytes": bytes,
        })
        .to_string()
    }

    pub fn fail(&self, message: &str) {
        if let Ok(mut session) = self.session.lock() {
            session.state = WebVpnSessionState::Error;
            session.last_error = Some(message.to_string());
        }
    }

    /// 当前会话状态。窗口存在性等外部事实不在这里判断。
    pub fn state(&self) -> WebVpnSessionState {
        self.session
            .lock()
            .map(|session| session.state)
            .unwrap_or_default()
    }

    /// 复用已有窗口时的状态归位。
    ///
    /// 已经确认过登录（Ready / Navigating）就保持不动：无条件回到
    /// `WaitingLogin` 会把用户已确认的会话降级，逼他每点一次"打开"就再确认一次。
    pub fn enter_reused_session(&self) {
        let Ok(mut session) = self.session.lock() else {
            return;
        };
        if session.authenticated {
            session.last_error = None;
            if matches!(
                session.state,
                WebVpnSessionState::Ready | WebVpnSessionState::Navigating
            ) {
                return;
            }
            if session.pending.is_none() {
                session.state = WebVpnSessionState::Ready;
            }
            return;
        }
        session.state = WebVpnSessionState::WaitingLogin;
        session.last_error = None;
    }

    pub fn mark_closed(&self) {
        if let Ok(mut session) = self.session.lock() {
            session.state = WebVpnSessionState::Closed;
            session.authenticated = false;
            session.sidebar_visible = false;
            session.target_host = None;
            session.pending = None;
            session.capture_notice = None;
        }
    }

    /// 登录后的门户首页包含网址转发输入框。注入脚本只上报这一布尔事实，
    /// 不读取账号、Cookie 或页面内容；下载状态保持不变。
    pub fn mark_authenticated(&self) {
        if let Ok(mut session) = self.session.lock() {
            session.authenticated = true;
            if matches!(
                session.state,
                WebVpnSessionState::Opening | WebVpnSessionState::WaitingLogin
            ) {
                session.state = WebVpnSessionState::Ready;
            }
            session.last_error = None;
        }
    }

    pub fn set_sidebar_visible(&self, visible: bool) {
        if let Ok(mut session) = self.session.lock() {
            session.sidebar_visible = visible;
        }
    }

    pub fn sidebar_visible(&self) -> bool {
        self.session
            .lock()
            .map(|session| session.sidebar_visible)
            .unwrap_or(false)
    }

    /// 标记 DSH 右侧栏已接管布局（幂等，只置位不清除）。
    pub fn mark_client_layout(&self) {
        if let Ok(mut session) = self.session.lock() {
            session.client_layout = true;
        }
    }

    /// 是否已由 DSH 右侧栏接管布局。接管后 `layout_sidebar` 不再执行。
    pub fn client_layout(&self) -> bool {
        self.session
            .lock()
            .map(|session| session.client_layout)
            .unwrap_or(false)
    }

    /// 记录 DSH 右侧栏上报的 tab 正文矩形。
    pub fn set_client_rect(&self, rect: (f64, f64, f64, f64)) {
        if let Ok(mut session) = self.session.lock() {
            session.client_rect = Some(rect);
        }
    }

    /// 最近一次上报的可用矩形；`None` 表示 tab 当前没有可显示区域。
    pub fn client_rect(&self) -> Option<(f64, f64, f64, f64)> {
        self.session
            .lock()
            .ok()
            .and_then(|session| session.client_rect)
    }

    pub fn apply_policy(&self, policy: WebVpnPolicy) {
        if let Ok(mut session) = self.session.lock() {
            session.policy = policy;
        }
    }

    /// 放行一个此前被拦下的域名（用户确认后调用），并写回配置。
    /// 返回更新后的完整白名单。
    pub fn allow_host(&self, host: &str) -> Result<Vec<String>, String> {
        let host = host.trim().trim_start_matches('.').to_ascii_lowercase();
        if host.is_empty() || host.contains('/') || host.contains(' ') {
            return Err("域名格式无效".to_string());
        }
        let Ok(mut session) = self.session.lock() else {
            return Err("WebVPN 状态不可用".to_string());
        };
        session.denied_hosts.retain(|candidate| candidate != &host);
        if !session.policy.allows(&host) {
            session.policy.allowed_hosts.push(host);
            session.policy.allowed_hosts.sort();
            session.policy.allowed_hosts.dedup();
        }
        Ok(session.policy.allowed_hosts.clone())
    }

    /// 导航判定 + 记录被拦域名。之所以合成一个方法：`on_navigation` 是同步闭包，
    /// 分两次加锁既啰嗦又容易让状态与记录不一致。
    ///
    /// 加锁失败时返回 `false`（拦截）：导航策略要 fail-closed。
    pub fn decide_navigation(&self, host: &str) -> bool {
        let Ok(mut session) = self.session.lock() else {
            return false;
        };
        let host_lower = host.to_ascii_lowercase();
        if session.policy.enforce && !session.policy.allows(&host_lower) {
            if !session.denied_hosts.iter().any(|item| item == &host_lower) {
                session.denied_hosts.push(host_lower);
                if session.denied_hosts.len() > MAX_DENIED_HOSTS {
                    session.denied_hosts.remove(0);
                }
            }
            return false;
        }
        // 转发落地：存在捕获任务时进入下载入口查找/等待阶段。
        if session.state == WebVpnSessionState::Navigating {
            session.state = if session.pending.is_some() {
                WebVpnSessionState::WaitingDownload
            } else {
                WebVpnSessionState::Ready
            };
        }
        true
    }

    pub fn status(&self, config: &WebVpnConfig, window_open: bool) -> WebVpnStatus {
        let session = self
            .session
            .lock()
            .map(|session| Session {
                state: session.state,
                authenticated: session.authenticated,
                sidebar_visible: session.sidebar_visible,
                client_layout: session.client_layout,
                client_rect: session.client_rect,
                policy: session.policy.clone(),
                target_host: session.target_host.clone(),
                denied_hosts: session.denied_hosts.clone(),
                last_error: session.last_error.clone(),
                pending: session.pending.clone(),
                capture_notice: session.capture_notice.clone(),
                generation: session.generation,
            })
            .unwrap_or_default();
        let downloaded_bytes = session.pending.as_ref().and_then(|pending| {
            pending
                .download_started_at
                .and_then(|_| fs::metadata(&pending.temp_path).ok().map(|meta| meta.len()))
        });
        let download_elapsed_ms = session.pending.as_ref().and_then(|pending| {
            pending
                .download_started_at
                .map(|started| started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64)
        });
        WebVpnStatus {
            state: session.state,
            authenticated: window_open && session.authenticated,
            portal_url: config.portal_url.clone(),
            allowed_hosts: session.policy.allowed_hosts.clone(),
            enforce_navigation: session.policy.enforce,
            configured_allowed_hosts: config.allowed_hosts.clone(),
            configured_enforce_navigation: config.enforce_navigation,
            target_host: session.target_host,
            denied_hosts: session.denied_hosts,
            last_error: session.last_error,
            pending_task_id: session
                .pending
                .as_ref()
                .map(|pending| pending.task_id.clone()),
            pending_kind: session.pending.as_ref().map(|pending| pending.kind.clone()),
            automation_stage: session.pending.as_ref().map(|pending| pending.automation_stage.clone()),
            downloaded_bytes,
            download_elapsed_ms,
            window_open,
            sidebar_visible: window_open && session.sidebar_visible,
            probe_available: Self::probe_available(),
        }
    }

    /// 探测模式是否可用。release 构建必须为 false：探测期不拦截导航，
    /// 若泄漏到正式包就等于把桌面客户端变成任意网页启动器。
    pub fn probe_available() -> bool {
        cfg!(debug_assertions)
    }
}

type Aes128CfbEnc = cfb_mode::Encryptor<Aes128>;

fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 构造网瑞达 WebVPN 的代理 URL。阶段 0 已用 USTC Nature、ACS、ScienceDirect
/// 实测确认：AES-128-CFB 加密目标 host，key/IV 均为 `wrdvpnisthebest!`，
/// 路径与 query 原样附在密文 host 之后。
pub fn build_wrd_proxy_url(portal: &str, target: &url::Url) -> Result<url::Url, String> {
    let portal = validate_target(portal)?;
    let host = target
        .host_str()
        .ok_or_else(|| "目标地址缺少主机名".to_string())?;
    let mut encrypted = host.as_bytes().to_vec();
    Aes128CfbEnc::new(WRD_KEY.into(), WRD_KEY.into()).encrypt(&mut encrypted);
    let encoded_host = format!("{}{}", hex_bytes(WRD_KEY), hex_bytes(&encrypted));
    let mut proxy = format!(
        "{}/{}/{encoded_host}{}",
        portal.origin().ascii_serialization(),
        target.scheme(),
        target.path()
    );
    if let Some(query) = target.query() {
        proxy.push('?');
        proxy.push_str(query);
    }
    url::Url::parse(&proxy).map_err(|_| "无法构造 WebVPN 转发地址".to_string())
}

pub fn capture_temp_path(data_root: &Path, task_id: &str, kind: &str) -> Result<PathBuf, String> {
    if !task_id.starts_with("capture-")
        || !task_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        || !matches!(kind, "pdf" | "si")
    {
        return Err("文献捕获任务参数无效".to_string());
    }
    let dir = data_root.join(DOWNLOAD_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建 WebVPN 下载临时目录: {error}"))?;
    Ok(dir.join(format!("{task_id}-{kind}.pdf")))
}

fn is_springer_family_si_url(target: &url::Url) -> bool {
    if target.scheme() != "https" {
        return false;
    }
    let host = target.host_str().unwrap_or_default().to_ascii_lowercase();
    let path = target.path().to_ascii_lowercase();
    let trusted_host = host == "nature.com"
        || host.ends_with(".nature.com")
        || host == "springer.com"
        || host.ends_with(".springer.com")
        || host == "springernature.com"
        || host.ends_with(".springernature.com");
    trusted_host
        && (path.ends_with(".pdf")
            || path.ends_with(".docx")
            || path.ends_with(".zip")
            || path.contains("/mediaobjects/"))
}

/// Nature/Springer SI 链接可能以内嵌预览方式打开。这里在预览导航发生前拦截
/// 公开附件地址，直接写入当前捕获任务的唯一临时文件；归档成功后 upload_capture
/// 会删除临时文件，因此不会在系统下载目录留下第二份副本。
fn download_springer_family_si_direct(app: AppHandle, target: url::Url, destination: PathBuf) {
    let outcome = (|| -> Result<(), String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(120))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 || !is_springer_family_si_url(attempt.url()) {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .build()
            .map_err(|error| format!("无法创建 Springer 系 SI 下载请求: {error}"))?;
        let mut response = client
            .get(target)
            .header(
                reqwest::header::USER_AGENT,
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 iBM-Lab-Agent/0.4.4",
            )
            .header(
                reqwest::header::ACCEPT,
                "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip,application/octet-stream;q=0.9,*/*;q=0.1",
            )
            .send()
            .map_err(|_| "Springer 系 SI 直连下载失败".to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "Springer 系 SI 下载失败（HTTP {}）",
                response.status()
            ));
        }
        if response
            .content_length()
            .is_some_and(|size| size > CAPTURE_MAX_BYTES)
        {
            return Err("Springer 系 SI 超过 100 MB 捕获上限".to_string());
        }
        let mut file = fs::File::create(&destination)
            .map_err(|error| format!("无法创建 Springer 系 SI 临时文件: {error}"))?;
        let mut received = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = response
                .read(&mut buffer)
                .map_err(|_| "Springer 系 SI 下载过程中连接中断".to_string())?;
            if count == 0 {
                break;
            }
            received = received.saturating_add(count as u64);
            if received > CAPTURE_MAX_BYTES {
                return Err("Springer 系 SI 超过 100 MB 捕获上限".to_string());
            }
            file.write_all(&buffer[..count])
                .map_err(|error| format!("无法写入 Springer 系 SI 临时文件: {error}"))?;
        }
        file.flush()
            .map_err(|error| format!("无法完成 Springer 系 SI 临时文件: {error}"))?;
        Ok(())
    })();

    match outcome {
        Ok(()) => {
            let upload = app
                .try_state::<WebVpnState>()
                .and_then(|state| state.begin_upload(&destination));
            if let Some(upload) = upload {
                upload_capture(app, upload);
            } else if let Some(state) = app.try_state::<WebVpnState>() {
                state.fail_pending_download("Springer 系 SI 下载与当前捕获任务不匹配，请重试");
            }
        }
        Err(message) => {
            if let Some(state) = app.try_state::<WebVpnState>() {
                state.fail_pending_download(&message);
            }
            record(&app, "error", "", &message);
        }
    }
}

pub fn upload_capture(app: AppHandle, upload: PendingUpload) {
    let body = fs::read(&upload.path).map_err(|error| format!("无法读取 WebVPN 下载文件: {error}"));
    let result = body.and_then(|body| {
        let extension = if body.starts_with(b"%PDF-") {
            "pdf"
        } else if upload.kind == "si" && body.starts_with(b"PK") {
            let is_docx = body.windows(5).any(|window| window == b"word/")
                && body
                    .windows(19)
                    .any(|window| window == b"[Content_Types].xml");
            if is_docx {
                "docx"
            } else {
                "zip"
            }
        } else {
            "bin"
        };
        let content_type = match extension {
            "pdf" => "application/pdf",
            "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "zip" => "application/zip",
            _ => "application/octet-stream",
        };
        let response = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(120))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("无法创建捕获上传请求: {error}"))?
            .put(upload.upload_url.clone())
            .header("content-type", content_type)
            .header(
                "x-file-name",
                format!("{}-{}.{}", upload.task_id, upload.kind, extension),
            )
            .body(body)
            .send()
            // reqwest 的错误显示可能包含完整请求 URL；该 URL 带一次性 token，
            // 因此这里只返回固定文案，详细 URL 永不进入日志或 UI。
            .map_err(|_| "WebVPN 下载已完成，但上传失败".to_string())?;
        if !response.status().is_success() {
            return Err(format!("捕获服务拒绝了文件（HTTP {}）", response.status()));
        }
        Ok(())
    });
    // 上传失败时不要把用户的 PDF 静默删除：改名保留在下载目录，并把保留路径写进
    // 错误信息——否则用户只会看到「点下载没反应」，文件却凭空消失。
    let detail = match &result {
        Ok(()) => {
            let _ = fs::remove_file(&upload.path);
            "归档完成".to_string()
        }
        Err(error) => {
            let preserved = preserve_failed_download(&upload.path, &upload.task_id, &upload.kind);
            format!("{error}；文件已保留在 {}", preserved.display())
        }
    };
    let outcome = result.map(|_| ()).map_err(|_| detail.clone());
    if let Some(state) = app.try_state::<WebVpnState>() {
        state.finish_upload(upload.generation, outcome);
        if let Some(webview) = app.get_webview(WINDOW_LABEL) {
            let _ = push_capture_ball(&app, &webview);
        }
    }
    record(
        &app,
        if detail == "归档完成" {
            "captureCompleted"
        } else {
            "error"
        },
        "",
        &detail,
    );
}

/// 上传失败时把已下载的 PDF 改名保留（而非删除），返回保留后的路径。
///
/// 改名失败时退回原路径（文件仍在原地，只是没改成带标记的名字），
/// 无论如何都不主动删除用户的下载。
fn preserve_failed_download(path: &Path, task_id: &str, kind: &str) -> PathBuf {
    let preserved = path.with_file_name(format!("{task_id}-{kind}-未归档.pdf"));
    if fs::rename(path, &preserved).is_ok() {
        preserved
    } else {
        path.to_path_buf()
    }
}

/// 位置脱敏：去掉 fragment 与用户凭据，并按参数名/取值特征对 query 脱敏。
///
/// fragment 必须整体去掉——现有捕获链路把一次性令牌放在 `#t=` 里，
/// 而历史 URL 很容易在后续导航中再次出现。
///
/// 用户凭据也要清掉：`validate_target` 已经拒绝带凭据的目标地址，但这个
/// 函数会被用在**任意**导航事件上，不能依赖上游先过滤一遍。
pub fn redact_for_log(raw: &str) -> String {
    let Ok(mut url) = url::Url::parse(raw) else {
        return String::new();
    };
    url.set_fragment(None);
    let _ = url.set_username("");
    let _ = url.set_password(None);
    let pairs = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    if pairs.is_empty() {
        return url.to_string();
    }
    url.set_query(None);
    {
        let mut serializer = url.query_pairs_mut();
        for (key, value) in pairs {
            if is_sensitive_name(&key) || looks_like_opaque_secret(&value) {
                serializer.append_pair(&key, "REDACTED");
            } else {
                serializer.append_pair(
                    &key,
                    &value.chars().take(MAX_LOGGED_VALUE).collect::<String>(),
                );
            }
        }
    }
    url.to_string()
}

fn is_sensitive_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    SENSITIVE_PARAM_HINTS.iter().any(|hint| {
        if hint.len() <= 2 {
            name == *hint
        } else {
            name.contains(hint)
        }
    })
}

/// 长且只含 URL 安全字符的取值，形态上就是一次性令牌，不看参数名也要脱敏。
fn looks_like_opaque_secret(value: &str) -> bool {
    if value.len() > 400 {
        return true;
    }
    value.len() >= 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~'))
}

pub fn host_of(raw: &str) -> String {
    url::Url::parse(raw)
        .ok()
        .and_then(|url| url.host_str().map(|host| host.to_ascii_lowercase()))
        .unwrap_or_default()
}

/// 校验要交给 WebVPN 导航的目标地址。
///
/// 这是**目标地址**的策略（用户/文献条目提供），与「导航白名单」是两件事：
/// 前者限制"我们允许把什么交给浏览器"，后者限制"浏览器可以走到哪里"。
pub fn validate_target(raw: &str) -> Result<url::Url, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("请输入要打开的 https 地址".to_string());
    }
    if trimmed.len() > 2048 {
        return Err("地址过长".to_string());
    }
    let parsed = url::Url::parse(trimmed).map_err(|_| "无法解析该地址".to_string())?;
    if parsed.scheme() != "https" {
        return Err("WebVPN 只接受 https 地址".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("地址不能包含用户名或密码".to_string());
    }
    let host = parsed.host_str().unwrap_or_default();
    if host.is_empty() {
        return Err("地址缺少主机名".to_string());
    }
    if is_private_host(host) {
        return Err("WebVPN 不打开本机或内网地址".to_string());
    }
    Ok(parsed)
}

/// 拒绝 loopback、链路本地与私网地址。桌面客户端不能被当作访问本机
/// 服务或内网的跳板。
fn is_private_host(host: &str) -> bool {
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host == "::1" || host == "0.0.0.0" {
        return true;
    }
    let Ok(address) = host.parse::<std::net::IpAddr>() else {
        // 非 IP 字面量：交给 DNS，不在这里做黑名单猜测。
        return false;
    };
    match address {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
        }
        std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
    }
}

/// 解析专属 profile 目录，并确认它严格位于应用数据根目录内。
///
/// 目前目录名是常量，但仍然做这一步：一旦将来目录名改为可配置，
/// 目录逃逸就会变成"清空用户任意目录"级别的缺陷。
pub fn resolve_profile_dir(data_root: &Path) -> Result<PathBuf, String> {
    let candidate = data_root.join(PROFILE_DIR_NAME);
    ensure_strictly_inside(data_root, &candidate)?;
    Ok(candidate)
}

/// 词法路径包含检查，不访问文件系统（目录可能尚不存在）。
/// 逐段比较而非字符串前缀，避免 `C:\data` 误判 `C:\data2`。
fn ensure_strictly_inside(root: &Path, candidate: &Path) -> Result<(), String> {
    let mut root_parts = root
        .components()
        .filter(|c| matches!(c, Component::Normal(_)));
    let candidate_parts = candidate
        .components()
        .filter(|c| matches!(c, Component::Normal(_)))
        .collect::<Vec<_>>();
    let root_parts_vec = root_parts.by_ref().collect::<Vec<_>>();
    if root_parts_vec.is_empty() || candidate_parts.len() <= root_parts_vec.len() {
        return Err("WebVPN profile 路径不在应用数据目录内".to_string());
    }
    if !candidate_parts.starts_with(&root_parts_vec) {
        return Err("WebVPN profile 路径不在应用数据目录内".to_string());
    }
    // 只允许根目录下**一层**子目录，防止多级相对路径穿透。
    if candidate_parts.len() != root_parts_vec.len() + 1 {
        return Err("WebVPN profile 路径层级异常".to_string());
    }
    Ok(())
}

fn record(app: &AppHandle, kind: &str, raw_url: &str, detail: &str) {
    let url = redact_for_log(raw_url);
    let host = host_of(raw_url);
    if let Some(state) = app.try_state::<WebVpnState>() {
        state.record(WebVpnEvent {
            kind: kind.to_string(),
            url: url.clone(),
            host: host.clone(),
            detail: detail.to_string(),
        });
    }
    if let Some(manager) = app.try_state::<crate::AppState>() {
        let _ = manager.0.logger().write(
            LOG_FILE,
            &format!("kind={kind} host={host} url={url} detail={detail}"),
        );
    }
}

/// 回收创建失败后残留的 WebVPN 子 WebView（能拿到就关闭）。
fn destroy_orphan_webview(app: &AppHandle) {
    if let Some(webview) = app.get_webview(WINDOW_LABEL) {
        let _ = webview.close();
    }
}

/// 为主 WebView 与右侧文献浏览器计算同窗布局。正常窗口中浏览器固定占可用宽度
/// 的三分之一；窄窗口下保证浏览器可操作，并尽量给主界面留下阅读空间。
fn sidebar_layout(width: f64, height: f64) -> ((f64, f64), (f64, f64, f64, f64)) {
    const MIN_MAIN_WIDTH: f64 = 480.0;
    const MIN_BROWSER_WIDTH: f64 = 360.0;
    let available = (width - MIN_MAIN_WIDTH).max(0.0);
    let sidebar_width = (width / 3.0)
        .max(MIN_BROWSER_WIDTH.min(width))
        .min(available.max(MIN_BROWSER_WIDTH.min(width)));
    let main_width = (width - sidebar_width).max(0.0);
    (
        (main_width, height),
        (main_width, 0.0, sidebar_width, height),
    )
}

fn main_inner_logical(app: &AppHandle) -> Result<(f64, f64), String> {
    let main = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "主窗口不可用".to_string())?;
    let scale = main.scale_factor().map_err(|error| error.to_string())?;
    let size = main.inner_size().map_err(|error| error.to_string())?;
    Ok((size.width as f64 / scale, size.height as f64 / scale))
}

fn bounds(x: f64, y: f64, width: f64, height: f64) -> Rect {
    Rect {
        position: Position::Logical(LogicalPosition::new(x, y)),
        size: Size::Logical(LogicalSize::new(width, height)),
    }
}

/// 把主 WebView 与 WebVPN 子 WebView 排成同一原生窗口内的左右两栏。
///
/// **仅在 DSH 右侧栏未接管布局时使用**（旧路径）。接管后由 `apply_client_rect`
/// 直接按客户端上报的矩形摆放，主 WebView 保持全宽。
pub fn layout_sidebar(app: &AppHandle, webview: &Webview) -> Result<(), String> {
    let (width, height) = main_inner_logical(app)?;
    let ((main_width, main_height), (x, y, sidebar_width, sidebar_height)) =
        sidebar_layout(width, height);
    let main = app
        .get_webview(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "主界面 WebView 不可用".to_string())?;
    main.set_bounds(bounds(0.0, 0.0, main_width, main_height))
        .map_err(|error| error.to_string())?;
    if let Err(error) = webview.set_bounds(bounds(x, y, sidebar_width, sidebar_height)) {
        let _ = main.set_bounds(bounds(0.0, 0.0, width, height));
        return Err(error.to_string());
    }
    Ok(())
}

/// 校验并规整客户端上报的矩形。
///
/// 返回 `None` 表示「没有可显示区域」——不可见、非有限值、或尺寸低于可操作下限；
/// 三者都按不可见处理，绝不用一个坏矩形去 `set_bounds`（NaN 会让窗口系统行为未定义）。
fn sanitize_client_rect(
    visible: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Option<(f64, f64, f64, f64)> {
    const MIN_WIDTH: f64 = 160.0;
    const MIN_HEIGHT: f64 = 120.0;
    if !visible || ![x, y, width, height].iter().all(|value| value.is_finite()) {
        return None;
    }
    if width < MIN_WIDTH || height < MIN_HEIGHT {
        return None;
    }
    Some((x.max(0.0), y.max(0.0), width, height))
}

/// DSH 右侧栏上报「文献浏览器」tab 正文矩形时的入口。
///
/// 与旧的 `show_sidebar` 的关键差别：**主 WebView 的宽度完全不动**。让位由 DSH
/// 右侧栏自己的 push presentation 完成，这里只把原生子 WebView 贴到 tab 正文上。
///
/// 首次收到消息即标记 `client_layout`——即使那一条是「不可见」，也说明客户端具备
/// 上报能力，此后不该再回到按比例分栏。
pub fn apply_client_rect(
    app: &AppHandle,
    visible: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let Some(state) = app.try_state::<WebVpnState>() else {
        return Err("WebVPN 状态不可用".to_string());
    };
    state.mark_client_layout();
    let Some(rect) = sanitize_client_rect(visible, x, y, width, height) else {
        if let Some(webview) = app.get_webview(WINDOW_LABEL) {
            webview.hide().map_err(|error| error.to_string())?;
        }
        state.set_sidebar_visible(false);
        return Ok(());
    };
    state.set_client_rect(rect);
    // 浏览器尚未创建（用户还没点开过 WebVPN）：只记布局，等 open_window 时按它摆放。
    let Some(webview) = app.get_webview(WINDOW_LABEL) else {
        return Ok(());
    };
    webview
        .set_bounds(bounds(rect.0, rect.1, rect.2, rect.3))
        .map_err(|error| error.to_string())?;
    webview.show().map_err(|error| error.to_string())?;
    state.set_sidebar_visible(true);
    Ok(())
}

pub fn show_sidebar(app: &AppHandle, webview: &Webview) -> Result<(), String> {
    let state = app.try_state::<WebVpnState>();
    if state.as_ref().map(|state| state.client_layout()).unwrap_or(false) {
        // DSH 右侧栏接管布局：只按最近一次上报的矩形显示，绝不改动主 WebView 宽度。
        let Some(rect) = state.as_ref().and_then(|state| state.client_rect()) else {
            // tab 尚未量出可用区域（未打开或已收起）：先不显示，等它上报。
            webview.hide().map_err(|error| error.to_string())?;
            if let Some(state) = state.as_ref() {
                state.set_sidebar_visible(false);
            }
            return Ok(());
        };
        webview
            .set_bounds(bounds(rect.0, rect.1, rect.2, rect.3))
            .map_err(|error| error.to_string())?;
        webview.show().map_err(|error| error.to_string())?;
        webview.set_focus().map_err(|error| error.to_string())?;
        if let Some(state) = state.as_ref() {
            state.set_sidebar_visible(true);
        }
        return Ok(());
    }
    layout_sidebar(app, webview)?;
    webview.show().map_err(|error| error.to_string())?;
    webview.set_focus().map_err(|error| error.to_string())?;
    if let Some(state) = app.try_state::<WebVpnState>() {
        state.set_sidebar_visible(true);
    }
    Ok(())
}

/// 收起侧栏。子 WebView 不销毁，因此登录态仍在。
///
/// 旧路径下同时把主 WebView 恢复全宽；右侧栏接管后主 WebView 从头到尾就是全宽，
/// 这里只隐藏子 WebView。
pub fn hide_sidebar(app: &AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(WINDOW_LABEL) {
        webview.hide().map_err(|error| error.to_string())?;
    }
    let client_layout = app
        .try_state::<WebVpnState>()
        .map(|state| state.client_layout())
        .unwrap_or(false);
    if !client_layout {
        let (width, height) = main_inner_logical(app)?;
        if let Some(main) = app.get_webview(MAIN_WINDOW_LABEL) {
            main.set_bounds(bounds(0.0, 0.0, width, height))
                .map_err(|error| error.to_string())?;
        }
    }
    if let Some(state) = app.try_state::<WebVpnState>() {
        state.set_sidebar_visible(false);
    }
    Ok(())
}

/// 终止当前捕获并关闭载体。
///
/// WebView2 没有向 Tauri 暴露「取消当前下载」句柄，销毁这一枚子 WebView 才能保证
/// 网络传输立即停止；专属 profile 保留，因此下次点击正文/SI 时登录态仍可复用。
///
/// `task_id` 为 `None` 时取消当前待捕获任务——页面里的捕获小球只知道「有一个任务在跑」。
pub fn cancel_capture_and_close(app: &AppHandle, task_id: Option<&str>) -> Result<(), String> {
    let state = app.try_state::<WebVpnState>();
    if let Some(state) = state.as_ref() {
        match task_id {
            Some(id) => state.cancel_capture(id)?,
            None => state.cancel_pending_capture()?,
        }
    }
    if let Some(webview) = app.get_webview(WINDOW_LABEL) {
        webview.close().map_err(|error| error.to_string())?;
    }
    hide_sidebar(app)?;
    if let Some(state) = state.as_ref() {
        state.mark_closed();
    }
    Ok(())
}

#[cfg(windows)]
async fn eval_agent_script(webview: &Webview, script: String) -> Result<serde_json::Value, String> {
    let (sender, receiver) = std::sync::mpsc::channel::<Result<String, String>>();
    webview
        .with_webview(move |platform| {
            let core = match unsafe { platform.controller().CoreWebView2() } {
                Ok(core) => core,
                Err(error) => {
                    let _ = sender.send(Err(error.to_string()));
                    return;
                }
            };
            let completed_sender = sender.clone();
            let handler = ExecuteScriptCompletedHandler::create(Box::new(move |status, result| {
                let result = status.map(|_| result).map_err(|error| error.to_string());
                let _ = completed_sender.send(result);
                Ok(())
            }));
            let code = CoTaskMemPWSTR::from(script.as_str());
            if let Err(error) = unsafe { core.ExecuteScript(*code.as_ref().as_pcwstr(), &handler) } {
                let _ = sender.send(Err(error.to_string()));
            }
        })
        .map_err(|error| error.to_string())?;
    let response = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_secs(10))
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|_| "页面操作超时".to_string())??;
    serde_json::from_str(&response).map_err(|_| "页面操作返回值无效".to_string())
}

#[cfg(windows)]
async fn save_current_pdf(
    app: &AppHandle,
    task_id: &str,
    webview: &Webview,
) -> Result<serde_json::Value, String> {
    let state = app.try_state::<WebVpnState>().ok_or("文献浏览器状态不可用")?;
    let destination = state.claim_native_save_destination(task_id)?;
    let path_text = destination.to_string_lossy().to_string();
    let app_for_save = app.clone();
    let (sender, receiver) = std::sync::mpsc::channel::<Result<(), String>>();
    webview.with_webview(move |platform| {
        let setup = (|| -> Result<(), String> {
            let core = unsafe { platform.controller().CoreWebView2() }
                .map_err(|error| error.to_string())?;
            let core25: ICoreWebView2_25 = core.cast().map_err(|error| error.to_string())?;
            let showing_path = path_text.clone();
            let showing = SaveAsUIShowingEventHandler::create(Box::new(move |_sender, args| {
                if let Some(args) = args {
                    let mut mime_ptr = PWSTR::null();
                    unsafe { args.ContentMimeType(&mut mime_ptr)?; }
                    let mime = take_pwstr(mime_ptr);
                    if mime.eq_ignore_ascii_case("application/pdf") {
                        let path = CoTaskMemPWSTR::from(showing_path.as_str());
                        unsafe {
                            args.SetSaveAsFilePath(*path.as_ref().as_pcwstr())?;
                            args.SetAllowReplace(false)?;
                            args.SetSuppressDefaultDialog(true)?;
                        }
                    } else {
                        unsafe { args.SetCancel(true)?; }
                    }
                }
                Ok(())
            }));
            let mut event_token = 0_i64;
            unsafe { core25.add_SaveAsUIShowing(&showing, &mut event_token) }
                .map_err(|error| error.to_string())?;
            let completion_core = core25.clone();
            let completion_app = app_for_save.clone();
            let completion_path = destination.clone();
            let completed = ShowSaveAsUICompletedHandler::create(Box::new(move |status, result| {
                let _ = unsafe { completion_core.remove_SaveAsUIShowing(event_token) };
                let completion_app = completion_app.clone();
                let completion_path = completion_path.clone();
                if status.is_ok() && result == COREWEBVIEW2_SAVE_AS_UI_RESULT_SUCCESS {
                    tauri::async_runtime::spawn_blocking(move || {
                        if let Some(state) = completion_app.try_state::<WebVpnState>() {
                            if let Some(upload) = state.begin_upload(&completion_path) {
                                upload_capture(completion_app, upload);
                            } else {
                                state.fail_pending_download("原生 PDF 保存与当前捕获任务不匹配");
                            }
                        }
                    });
                } else if let Some(state) = completion_app.try_state::<WebVpnState>() {
                    state.fail_pending_download("原生 PDF 保存未完成；请在侧栏手动保存或重试");
                }
                Ok(())
            }));
            if let Err(error) = unsafe { core25.ShowSaveAsUI(&completed) } {
                let _ = unsafe { core25.remove_SaveAsUIShowing(event_token) };
                return Err(error.to_string());
            }
            Ok(())
        })();
        let _ = sender.send(setup);
    }).map_err(|error| error.to_string())?;
    let setup = tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(10)))
        .await.map_err(|error| error.to_string())?
        .map_err(|_| "原生 PDF 保存启动超时".to_string())?;
    if let Err(error) = setup {
        state.fail_pending_download(&error);
        return Err(error);
    }
    let _ = push_capture_ball(app, webview);
    Ok(serde_json::json!({ "started": true, "phase": "saving" }))
}

#[cfg(not(windows))]
async fn save_current_pdf(
    _app: &AppHandle,
    _task_id: &str,
    _webview: &Webview,
) -> Result<serde_json::Value, String> {
    Err("原生 PDF 保存仅在 Windows 桌面端可用".to_string())
}

pub async fn browser_action(
    app: &AppHandle,
    task_id: &str,
    action: &str,
    observation_id: &str,
    element_id: &str,
) -> Result<serde_json::Value, String> {
    let state = app.try_state::<WebVpnState>().ok_or("文献浏览器状态不可用")?;
    if state.pending_task_id().as_deref() != Some(task_id) {
        return Err("浏览器动作与当前文献任务不匹配".to_string());
    }
    let webview = app.get_webview(WINDOW_LABEL).ok_or("文献浏览器尚未打开")?;
    match action {
        "observe" | "click" => {
            #[cfg(windows)]
            {
                let script = if action == "observe" {
                    AGENT_OBSERVE_SCRIPT.to_string()
                } else {
                    if !observation_id.bytes().all(|byte| byte.is_ascii_alphanumeric())
                        || !element_id.starts_with('e')
                        || !element_id[1..].bytes().all(|byte| byte.is_ascii_digit())
                    {
                        return Err("页面元素引用无效".to_string());
                    }
                    AGENT_CLICK_SCRIPT
                        .replace("__OBSERVATION_ID__", &serde_json::json!(observation_id).to_string())
                        .replace("__ELEMENT_ID__", &serde_json::json!(element_id).to_string())
                };
                let value = eval_agent_script(&webview, script).await?;
                if let Some(error) = value.get("error").and_then(|item| item.as_str()) {
                    return Err(error.to_string());
                }
                if action == "click" && value.get("clicked").and_then(|item| item.as_bool()) == Some(true) {
                    state.set_automation_stage("clicked");
                    let _ = push_capture_ball(app, &webview);
                }
                Ok(value)
            }
            #[cfg(not(windows))]
            {
                let _ = (webview, observation_id, element_id);
                Err("文献浏览器页面操作仅在 Windows 桌面端可用".to_string())
            }
        }
        "save-pdf" => save_current_pdf(app, task_id, &webview).await,
        _ => Err("不支持的浏览器动作".to_string()),
    }
}

/// 把当前捕获状态推给页面里的捕获小球。
///
/// 页面每次导航都会重新注入脚本，小球也随之重建，所以页面加载完成后必须再推一次。
/// 这里不做轮询：节奏由壳的 `webvpn_sync_capture_ball` 决定。
pub fn push_capture_ball(app: &AppHandle, webview: &Webview) -> Result<(), String> {
    let payload = app
        .try_state::<WebVpnState>()
        .map(|state| state.capture_ball_json())
        .unwrap_or_else(|| "null".to_string());
    webview
        .eval(format!(
            "window.__ibmWebVpnCapture && window.__ibmWebVpnCapture({payload});"
        ))
        .map_err(|error| error.to_string())
}

/// 主窗口缩放时更新当前可见侧栏；隐藏状态不改变。
///
/// 右侧栏接管后这里直接返回：窗口尺寸变化会先反映到 DSH 的布局上，再由 tab 正文的
/// ResizeObserver 重新上报矩形。若在这里按旧比例抢先挪一次，反而会和客户端打架。
pub fn resize_sidebar(app: &AppHandle) {
    let state = app.try_state::<WebVpnState>();
    if state.as_ref().map(|state| state.client_layout()).unwrap_or(false) {
        return;
    }
    let visible = state
        .as_ref()
        .map(|state| state.sidebar_visible())
        .unwrap_or(false);
    if visible {
        if let Some(webview) = app.get_webview(WINDOW_LABEL) {
            let _ = layout_sidebar(app, &webview);
        }
    }
}

/// 创建（或复用）WebVPN 单例子 WebView。
pub fn open_window(
    app: &AppHandle,
    data_root: &Path,
    target: &url::Url,
    policy: WebVpnPolicy,
) -> Result<Webview, String> {
    let profile_dir = resolve_profile_dir(data_root)?;
    // 策略最先应用：复用与新建两条路径的导航判定都必须按最新配置执行。
    if let Some(state) = app.try_state::<WebVpnState>() {
        state.apply_policy(policy);
    }

    if let Some(webview) = app.get_webview(WINDOW_LABEL) {
        webview
            .navigate(target.clone())
            .map_err(|error| error.to_string())?;
        show_sidebar(app, &webview)?;
        if let Some(state) = app.try_state::<WebVpnState>() {
            // 复用已有会话：登录态在 WebView2 profile 里，已确认过的会话不重置。
            state.enter_reused_session();
        }
        return Ok(webview);
    }

    let navigation_app = app.clone();
    let window_app = app.clone();
    let download_app = app.clone();
    let page_app = app.clone();

    if let Some(state) = app.try_state::<WebVpnState>() {
        // 窗口不存在 ⇒ 会话不可能处于打开态（例如 WebView2 进程崩溃后重建）。
        // 先归零再走合法的 Opening 路径，否则 `Ready → Opening` 这类非法迁移
        // 会把"重新打开"永久卡死。
        if state.state() != WebVpnSessionState::Closed {
            state.mark_closed();
        }
        state.transition(WebVpnSessionState::Opening)?;
    }

    let main_window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "主窗口不可用".to_string())?;
    let (window_width, window_height) = main_inner_logical(app)?;
    let (_, (x, y, width, height)) = sidebar_layout(window_width, window_height);
    let builder = WebviewBuilder::new(WINDOW_LABEL, WebviewUrl::External(target.clone()))
        .data_directory(profile_dir)
        .initialization_script(WEBVPN_CHROME_SCRIPT)
        .on_page_load(move |webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                // 直接落到 .pdf（WebView2 内置查看器）时也开启位移，避免查看器
                // 自带的保存/下载工具栏被我们的 76px 工具栏盖住。
                if webview
                    .url()
                    .map(|url| is_pdf_document_url(&url))
                    .unwrap_or(false)
                {
                    let _ = webview.eval(
                        "window.__ibmWebVpnSetPageOffset && window.__ibmWebVpnSetPageOffset(true)",
                    );
                }
                start_pending_publisher_automation(&page_app, &webview);
                // 脚本每次导航都会重新注入，小球随之重建：必须再推一次状态。
                let _ = push_capture_ball(&page_app, &webview);
            }
        })
        .on_navigation(move |url| {
            if url.scheme() == "ibm-webvpn"
                && url.host_str() == Some("session")
                && url.path() == "/ready"
            {
                if let Some(state) = navigation_app.try_state::<WebVpnState>() {
                    state.mark_authenticated();
                }
                record(&navigation_app, "session", "", "已识别登录后的 WebVPN 门户");
                return false;
            }
            if url.scheme() == "ibm-webvpn" && url.host_str() == Some("cancel-capture") {
                // 与 close 同理：不在导航回调栈里销毁自身，调度到主线程的下一拍。
                let scheduled_app = navigation_app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(10));
                    let action_app = scheduled_app.clone();
                    let _ = scheduled_app.run_on_main_thread(move || {
                        let _ = cancel_capture_and_close(&action_app, None);
                    });
                });
                record(&navigation_app, "capture", "", "用户从捕获小球终止了本次捕获");
                return false;
            }
            if url.scheme() == "ibm-webvpn" && url.host_str() == Some("close") {
                // 避免在 WebView 导航回调栈中直接隐藏自身；调度到主线程的下一拍。
                let scheduled_app = navigation_app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(10));
                    let action_app = scheduled_app.clone();
                    let _ = scheduled_app.run_on_main_thread(move || {
                        let _ = hide_sidebar(&action_app);
                    });
                });
                return false;
            }
            let direct_si = navigation_app
                .try_state::<WebVpnState>()
                .map(|state| state.should_capture_direct_si_preview(url))
                .unwrap_or(false);
            if direct_si {
                let decision = navigation_app
                    .try_state::<WebVpnState>()
                    .map(|state| state.claim_download_destination())
                    .unwrap_or(DownloadDecision::PassThrough);
                if let DownloadDecision::Capture(destination) = decision {
                    let download_app = navigation_app.clone();
                    let target = url.clone();
                    std::thread::spawn(move || {
                        download_springer_family_si_direct(download_app, target, destination)
                    });
                    record(
                        &navigation_app,
                        "automation",
                        url.as_str(),
                        "已拦截 SI 预览导航并直接捕获附件",
                    );
                    return false;
                }
            }
            if url.scheme() == "ibm-webvpn" && url.host_str() == Some("offset-reverted") {
                // 页面位移的看门狗判定白屏并自行撤销（见 WEBVPN_CHROME_SCRIPT）。
                record(
                    &navigation_app,
                    "offset",
                    "",
                    "页面疑似被整屏固定遮罩盖住，已自动撤销 html 位移",
                );
                return false;
            }
            if url.scheme() == "ibm-webvpn" && url.host_str() == Some("automation") {
                let result = url.path().trim_matches('/');
                let stage = match result {
                    "searching" => Some("searching"),
                    "clicked" => Some("clicked"),
                    "si-manual" | "pdf-manual" => Some("manual"),
                    "challenge" => Some("verification"),
                    _ => None,
                };
                if let Some(stage) = stage {
                    if let Some(state) = navigation_app.try_state::<WebVpnState>() {
                        state.set_automation_stage(stage);
                    }
                    if let Some(webview) = navigation_app.get_webview(WINDOW_LABEL) {
                        let _ = push_capture_ball(&navigation_app, &webview);
                    }
                }
                // `pdf-manual` 只代表扫描若干轮没找到入口——它并不证明页面是预览器。
                // 页面位移只对「整屏 fixed 的预览器/原生 PDF 查看器」有意义，据此给
                // 普通文章页加 transform 正是两次白屏的成因（2026-09-23 ScienceDirect、
                // 2026-09-25 science.org），所以这里要求正向证据：只有顶层文档确实
                // 是 PDF 才开位移，否则只如实报告"没找到入口"。
                if result == "pdf-manual" {
                    let pdf_document = navigation_app
                        .get_webview(WINDOW_LABEL)
                        .and_then(|webview| webview.url().ok())
                        .map(|url| is_pdf_document_url(&url))
                        .unwrap_or(false);
                    if pdf_document {
                        if let Some(webview) = navigation_app.get_webview(WINDOW_LABEL) {
                            let _ = webview.eval(
                                "window.__ibmWebVpnSetPageOffset && window.__ibmWebVpnSetPageOffset(true)",
                            );
                        }
                        record(
                            &navigation_app,
                            "automation",
                            "",
                            "已进入 PDF 预览器并保持捕获；可手动点击右上角保存",
                        );
                    } else {
                        record(
                            &navigation_app,
                            "automation",
                            "",
                            "未能自动识别正文下载入口；捕获仍有效，请在页面中手动打开并保存",
                        );
                    }
                    return false;
                }
                if result == "si-manual" {
                    record(
                        &navigation_app,
                        "automation",
                        "",
                        "自动入口暂未识别，捕获任务保持有效；可在页面手动点击补充材料",
                    );
                    return false;
                }
                if result == "challenge" {
                    let message = "出版社页面正在验证访问；捕获仍有效，通过后自动继续查找入口";
                    record(&navigation_app, "automation", "", message);
                }
                return false;
            }
            let host = host_of(url.as_str());
            let allowed = navigation_app
                .try_state::<WebVpnState>()
                .map(|state| state.decide_navigation(&host))
                .unwrap_or(false);
            if !allowed {
                record(&navigation_app, "denied", url.as_str(), "不在导航白名单内");
                return false;
            }
            record(&navigation_app, "navigation", url.as_str(), "");
            true
        })
        .on_new_window(move |url, _features| {
            // Some download buttons open about:blank first and assign the real URL
            // later. Navigating our only WebView to that placeholder strands both
            // the PDF task and the queued SI task on a white page.
            if !matches!(url.scheme(), "http" | "https") {
                record(&window_app, "newWindow", url.as_str(), "忽略空白或非网页弹窗，保留当前文献页面");
                if let Some(state) = window_app.try_state::<WebVpnState>() {
                    state.set_automation_stage("manual");
                }
                return NewWindowResponse::Deny;
            }
            // USTC 快速跳转和部分出版社链接会请求新窗口。统一收敛回单例窗口，
            // 避免额外窗口脱离下载处理器与专属会话状态机。
            record(
                &window_app,
                "newWindow",
                url.as_str(),
                "收敛到 WebVPN 单例窗口",
            );
            if let Some(webview) = window_app.get_webview(WINDOW_LABEL) {
                let _ = webview.navigate(url.clone());
            }
            NewWindowResponse::Deny
        })
        .on_download(move |webview, event| {
            let mut allow = true;
            match event {
                DownloadEvent::Requested { url, destination } => {
                    match download_app
                        .try_state::<WebVpnState>()
                        .map(|state| state.claim_download_destination())
                        .unwrap_or(DownloadDecision::PassThrough)
                    {
                        DownloadDecision::Capture(path) => *destination = path,
                        DownloadDecision::Duplicate => allow = false,
                        // WebVPN 子 WebView 是受控捕获面板，不向系统下载目录放行
                        // 非当前任务的下载。这样自动点击产生的迟到/重复请求也不会
                        // 在“课题归档文件”之外留下第二份浏览器下载副本。
                        DownloadDecision::PassThrough => allow = false,
                    }
                    record(
                        &download_app,
                        "downloadRequested",
                        url.as_str(),
                        &format!("defaultDestination={}", destination.display()),
                    );
                }
                DownloadEvent::Finished { url, path, success } => {
                    let detail = match path.as_deref() {
                        Some(path) => format!("success={success} path={}", path.display()),
                        // path 为 None 不必然代表失败（tauri 官方文档明示），
                        // 必须与 success 联合判断，不能当成成功去读文件。
                        None => format!("success={success} path=<unreported>"),
                    };
                    record(&download_app, "downloadFinished", url.as_str(), &detail);
                    let state = download_app.try_state::<WebVpnState>();
                    if !success {
                        if let Some(state) = state {
                            if !state.should_ignore_failed_finish() {
                                state.fail_pending_download("WebVPN 页面下载失败，请重新发起捕获");
                            }
                        }
                    } else if let Some(path) = path.as_deref() {
                        if let Some(upload) = state.and_then(|state| state.begin_upload(path)) {
                            let upload_app = download_app.clone();
                            std::thread::spawn(move || upload_capture(upload_app, upload));
                        } else if let Some(state) = download_app.try_state::<WebVpnState>() {
                            state.fail_pending_download(
                                "WebVPN 下载文件与当前捕获任务不匹配，请重试",
                            );
                        }
                    } else if let Some(state) = state {
                        state
                            .fail_pending_download("WebVPN 下载完成，但系统未返回文件路径，请重试");
                    }
                }
                _ => {}
            }
            // `on_download` hands the closure an owned `Webview`, while the helper
            // borrows one; pass a reference instead of moving the handle in.
            let _ = push_capture_ball(&download_app, &webview);
            allow
        });
    let webview = main_window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|error| {
            destroy_orphan_webview(app);
            record(
                app,
                "error",
                target.as_str(),
                &format!("侧栏创建失败: {error}"),
            );
            if let Some(state) = app.try_state::<WebVpnState>() {
                state.fail(&format!("无法创建 WebVPN 侧栏: {error}"));
            }
            error.to_string()
        })?;

    if let Err(error) = show_sidebar(app, &webview) {
        let _ = webview.close();
        let _ = hide_sidebar(app);
        record(
            app,
            "error",
            target.as_str(),
            &format!("侧栏布局失败: {error}"),
        );
        if let Some(state) = app.try_state::<WebVpnState>() {
            state.fail(&format!("无法显示 WebVPN 侧栏: {error}"));
        }
        return Err(error);
    }
    record(app, "webviewCreated", target.as_str(), "同窗侧栏已创建");
    if let Some(state) = app.try_state::<WebVpnState>() {
        // 门户正在加载，等待用户完成统一身份认证。
        let _ = state.transition(WebVpnSessionState::WaitingLogin);
    }
    Ok(webview)
}

/// 在当前文档中启动 Nature 下载入口扫描。页面脚本自身还会检查 citation DOI，
/// 因而 DOI 跳转页、WebVPN 门户和登录页都不会被误点。
pub fn start_pending_publisher_automation(app: &AppHandle, webview: &Webview) {
    let pending = app
        .try_state::<WebVpnState>()
        .and_then(|state| state.pending_automation());
    let Some((kind, publisher)) = pending.filter(|(kind, _)| kind == "pdf" || kind == "si") else {
        return;
    };
    let script = PUBLISHER_DOWNLOAD_AUTOMATION
        .replace("__IBM_CAPTURE_KIND__", &kind)
        .replace("__IBM_PUBLISHER__", publisher.key());
    if let Err(error) = webview.eval(script) {
        record(
            app,
            "automation",
            "",
            &format!("页面下载入口扫描启动失败: {error}"),
        );
    }
}

/// 由命令层调用的状态组装：补上"窗口是否存在"与配置。
///
/// 窗口隐藏也算存在——隐藏正是"保留会话"的实现方式，UI 需要区分
/// "已创建但隐藏"与"从未创建"。
pub fn status_of(app: &AppHandle, config: &WebVpnConfig) -> WebVpnStatus {
    let window_open = app.get_webview(WINDOW_LABEL).is_some();
    match app.try_state::<WebVpnState>() {
        Some(state) => state.status(config, window_open),
        None => WebVpnState::default().status(config, window_open),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn policy(hosts: &[&str]) -> WebVpnPolicy {
        WebVpnPolicy {
            enforce: true,
            allowed_hosts: hosts.iter().map(|host| host.to_string()).collect(),
        }
    }

    #[test]
    fn pdf_document_urls_are_recognized_for_page_offset() {
        let pdf = url::Url::parse("https://www.example.org/a/b/paper.PDF?download=1").unwrap();
        assert!(is_pdf_document_url(&pdf));
        let landing = url::Url::parse("https://www.sciencedirect.com/science/article/pii/S1")
            .unwrap();
        assert!(!is_pdf_document_url(&landing));
        let doi = url::Url::parse("https://doi.org/10.1016/j.rpth.2024.102373").unwrap();
        assert!(!is_pdf_document_url(&doi));
    }

    /// 回归护栏（2026-09-23 ScienceDirect 偶发白屏）：`html` 位移只能由
    /// `window.__ibmWebVpnSetPageOffset(true)` 在确认进入 PDF 预览器后打开，
    /// `mount()` 不得对所有页面无条件注入 transform。
    #[test]
    fn chrome_script_does_not_offset_pages_by_default() {
        assert!(WEBVPN_CHROME_SCRIPT.contains("__ibmWebVpnSetPageOffset"));
        assert!(WEBVPN_CHROME_SCRIPT.contains("looksBlank"));
        assert!(WEBVPN_CHROME_SCRIPT.contains("ibm-webvpn://offset-reverted/"));
        assert!(!WEBVPN_CHROME_SCRIPT.contains("ensurePageOffset"));
        let mount_body = WEBVPN_CHROME_SCRIPT
            .split("const mount = () => {")
            .nth(1)
            .and_then(|rest| rest.split("if (document.readyState").next())
            .expect("mount body");
        assert!(
            !mount_body.contains("applyPageOffset"),
            "mount() must not apply the page offset unconditionally"
        );
    }

    #[test]
    fn fragment_is_never_logged() {
        // 捕获链路把一次性令牌放在 fragment 里，必须整体丢弃。
        let redacted = redact_for_log("https://doi.org/10.1038/abc#t=one-time-secret");
        assert_eq!(redacted, "https://doi.org/10.1038/abc");
        assert!(!redacted.contains("one-time-secret"), "{redacted}");
    }

    #[test]
    fn sensitive_query_names_are_redacted_but_business_params_survive() {
        let redacted = redact_for_log(
            "https://idp.example.edu/login?ticket=ST-123456&service=https%3A%2F%2Fdoi.org%2F10.1038%2Fabc&doi=10.1038%2Fabc",
        );
        assert!(redacted.contains("ticket=REDACTED"), "{redacted}");
        assert!(redacted.contains("doi=10.1038%2Fabc"), "{redacted}");
        assert!(!redacted.contains("ST-123456"), "{redacted}");
    }

    #[test]
    fn short_hints_match_exactly_so_real_params_are_not_collateral_damage() {
        // "t" 是敏感提示词，但不能因此把 "target" 也抹掉。
        let redacted =
            redact_for_log("https://webvpn.example.edu/https/doi.org/x?target=nature&t=abc123");
        assert!(redacted.contains("t=REDACTED"), "{redacted}");
        assert!(redacted.contains("target=nature"), "{redacted}");
    }

    #[test]
    fn opaque_long_values_are_redacted_even_with_an_innocent_name() {
        let secret = "A".repeat(48);
        let redacted = redact_for_log(&format!("https://webvpn.example.edu/go?url={secret}"));
        assert!(redacted.contains("url=REDACTED"), "{redacted}");
        assert!(!redacted.contains(&secret), "{redacted}");
    }

    #[test]
    fn unparsable_and_credential_urls_degrade_safely() {
        assert_eq!(redact_for_log("not a url"), "");
        // user:password@ 形式即使可解析也不能把口令写进日志。
        let redacted = redact_for_log("https://user:sup3rsecret@example.edu/portal");
        assert!(!redacted.contains("sup3rsecret"), "{redacted}");
    }

    #[test]
    fn host_matching_is_suffix_safe() {
        let policy = policy(&["doi.org", "webvpn.example.edu"]);
        assert!(policy.allows("doi.org"));
        assert!(policy.allows("www.doi.org"));
        assert!(policy.allows("DOI.ORG"));
        assert!(!policy.allows("notdoi.org"));
        assert!(!policy.allows("evildoi.org"));
        assert!(!policy.allows(""));
        assert!(!policy.allows("example.edu"));
    }

    #[test]
    fn direct_access_is_limited_to_nature_and_springer_supporting_information() {
        let doi = validate_target("https://doi.org/10.1038/s41551-023-01022-4").unwrap();
        let encoded_doi = validate_target("https://doi.org/10.1038%2Fs41551-023-01022-4").unwrap();
        let nature = validate_target("https://www.nature.com/articles/s41551-023-01022-4").unwrap();
        let springer = validate_target("https://doi.org/10.1007/s00125-026-01234-5").unwrap();
        let unrelated = validate_target("https://example.com/10.1038/fake").unwrap();
        assert!(is_direct_springer_family_si("si", &doi));
        assert!(is_direct_springer_family_si("si", &encoded_doi));
        assert!(is_direct_springer_family_si("si", &nature));
        assert!(is_direct_springer_family_si("si", &springer));
        assert!(!is_direct_springer_family_si("pdf", &doi));
        assert!(!is_direct_springer_family_si("si", &unrelated));

        let mut policy = WebVpnPolicy::from_config("https://wvpn.ustc.edu.cn/", &[], true);
        allow_direct_nature_si_hosts(&mut policy);
        assert!(policy.allows("media.springernature.com"));
        assert!(policy.allows("www.nature.com"));
        assert!(!policy.allows("example.com"));
    }

    #[test]
    fn publisher_adapter_classifies_supported_doi_prefixes() {
        for (doi, expected) in [
            ("10.1038/example", PublisherAdapter::Nature),
            ("10.1007/example", PublisherAdapter::Springer),
            ("10.1126/example", PublisherAdapter::Science),
            ("10.1016/example", PublisherAdapter::Elsevier),
            ("10.1021/example", PublisherAdapter::Acs),
            ("10.1039/example", PublisherAdapter::Rsc),
            ("10.1109/example", PublisherAdapter::Ieee),
            ("10.1002/example", PublisherAdapter::WileyPaused),
        ] {
            let target = validate_target(&format!("https://doi.org/{doi}")).unwrap();
            assert_eq!(PublisherAdapter::from_target(&target), expected, "{doi}");
        }
    }

    #[test]
    fn springer_family_si_capture_accepts_only_trusted_attachment_hosts() {
        for accepted in [
            "https://static-content.springer.com/esm/art%3A10.1038/file/MediaObjects/test.pdf",
            "https://www.nature.com/articles/example/supplementary.pdf",
            "https://static-content.springer.com/esm/test/supplement.docx",
            "https://static-content.springer.com/esm/test/resources.zip",
        ] {
            assert!(is_springer_family_si_url(
                &url::Url::parse(accepted).unwrap()
            ));
        }
        for rejected in [
            "https://evil.example/supplementary.pdf",
            "http://static-content.springer.com/MediaObjects/test.pdf",
            "https://www.nature.com/articles/example",
        ] {
            assert!(!is_springer_family_si_url(
                &url::Url::parse(rejected).unwrap()
            ));
        }
    }

    #[test]
    fn iwan_style_capture_does_not_intercept_direct_si_navigation() {
        let state = WebVpnState::default();
        state.transition(WebVpnSessionState::Opening).unwrap();
        state.transition(WebVpnSessionState::Ready).unwrap();
        let upload = url::Url::parse(
            "http://127.0.0.1:3080/api/lab-capture-upload?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDE",
        )
        .unwrap();
        let target = url::Url::parse(
            "https://static-content.springer.com/esm/art%3A10.1038/file/MediaObjects/test.pdf",
        )
        .unwrap();
        state
            .prepare_capture(
                "capture-iwan-si",
                "si",
                "doi.org",
                PublisherAdapter::Nature,
                true,
                false,
                upload,
                std::env::temp_dir().join("capture-iwan-si.pdf"),
            )
            .unwrap();
        assert!(
            !state.should_capture_direct_si_preview(&target),
            "iWAN 模式应让 WebView2 原生直连 SI，不得交给 reqwest 拦截器"
        );
    }

    #[test]
    fn empty_policy_allows_nothing_when_enforced() {
        let policy = policy(&[]);
        assert!(!policy.allows("doi.org"));
    }

    #[test]
    fn profile_dir_stays_inside_the_data_root() {
        let root = PathBuf::from(r"C:\Users\admin\AppData\Local\iBM-Lab-Agent");
        let resolved = resolve_profile_dir(&root).expect("常量目录名必定合法");
        assert!(resolved.ends_with(PROFILE_DIR_NAME));
        assert!(resolved.starts_with(&root));
    }

    #[test]
    fn prefix_lookalike_roots_do_not_count_as_containment() {
        // 逐段比较而非字符串前缀：C:\data2 不能被当成 C:\data 的子目录。
        let error = ensure_strictly_inside(Path::new(r"C:\data"), Path::new(r"C:\data2\x"));
        assert!(error.is_err(), "前缀相似但不包含，必须拒绝");
    }

    #[test]
    fn nested_and_shallow_candidates_are_rejected() {
        let root = Path::new(r"C:\data");
        assert!(
            ensure_strictly_inside(root, root).is_err(),
            "根目录自身不是子目录"
        );
        assert!(
            ensure_strictly_inside(root, Path::new(r"C:\data\a\b")).is_err(),
            "只允许一层子目录"
        );
        assert!(ensure_strictly_inside(root, Path::new(r"C:\data\webvpn-webview2")).is_ok());
    }

    #[test]
    fn probe_is_unavailable_in_release_builds() {
        if cfg!(debug_assertions) {
            assert!(WebVpnState::probe_available());
        } else {
            assert!(!WebVpnState::probe_available());
        }
    }

    #[test]
    fn event_log_keeps_the_newest_entries() {
        let state = WebVpnState::default();
        for index in 0..(MAX_EVENTS + 25) {
            state.record(WebVpnEvent {
                kind: "navigation".to_string(),
                url: format!("https://example.edu/{index}"),
                host: "example.edu".to_string(),
                detail: String::new(),
            });
        }
        let events = state.snapshot();
        assert_eq!(events.len(), MAX_EVENTS);
        assert_eq!(
            events.last().expect("非空").url,
            format!("https://example.edu/{}", MAX_EVENTS + 24),
            "最新的记录必须保留"
        );
        assert_eq!(
            events.first().expect("非空").url,
            format!("https://example.edu/{}", 25),
            "最旧的记录应被丢弃"
        );
        state.clear();
        assert!(state.snapshot().is_empty());
    }

    #[test]
    fn target_accepts_only_plain_https_urls() {
        assert!(validate_target("https://doi.org/10.1038/abc").is_ok());
        for rejected in [
            "",
            "   ",
            "http://doi.org/10.1038/abc",
            "file:///C:/secret.pdf",
            "data:text/html,<script/>",
            "javascript:alert(1)",
            "blob:https://doi.org/abc",
            "https://user:pass@doi.org/abc",
            "https://doi.org/abc#frag-only-after-parse",
        ] {
            if rejected == "https://doi.org/abc#frag-only-after-parse" {
                // fragment 不是拒绝理由，只要求不写进日志。
                assert!(validate_target(rejected).is_ok());
                continue;
            }
            assert!(validate_target(rejected).is_err(), "应拒绝: {rejected}");
        }
        assert!(validate_target(&format!("https://doi.org/{}", "a".repeat(2048))).is_err());
    }

    #[test]
    fn target_refuses_loopback_and_private_hosts() {
        for rejected in [
            "https://localhost/admin",
            "https://127.0.0.1:8080/api",
            "https://[::1]/api",
            "https://0.0.0.0/",
            "https://10.0.0.5/",
            "https://192.168.1.1/",
            "https://172.16.9.9/",
            "https://169.254.1.1/",
        ] {
            assert!(validate_target(rejected).is_err(), "应拒绝: {rejected}");
        }
        // 公网域名照常放行；不做 DNS 解析，避免引入网络依赖。
        assert!(validate_target("https://webvpn.ustc.edu.cn/").is_ok());
    }

    #[test]
    fn policy_from_config_always_admits_the_portal_itself() {
        // 门户是用户配置的入口：不放行它就连登录页都进不去。
        let policy = WebVpnPolicy::from_config(
            "https://webvpn.example.edu/portal",
            &["idp.example.edu".to_string()],
            true,
        );
        assert!(policy.allows("webvpn.example.edu"));
        assert!(policy.allows("idp.example.edu"));
        assert!(!policy.allows("doi.org"), "未列举的域名不得放行");

        // 空配置 + 空门户：什么都进不去，这是期望的 fail-closed 行为。
        let empty = WebVpnPolicy::from_config("", &[], true);
        assert!(empty.allowed_hosts.is_empty());
        assert!(!empty.allows("webvpn.example.edu"));
    }

    #[test]
    fn probe_policy_records_without_blocking() {
        let policy = WebVpnPolicy::record_only();
        assert!(!policy.enforce, "阶段 0 必须只记录不拦截");
        let state = WebVpnState::default();
        state.apply_policy(policy);
        assert!(state.decide_navigation("unknown-idp.example.edu"));
        assert!(state.decide_navigation("doi.org"));
        let status = state.status(&WebVpnConfig::default(), false);
        assert!(status.denied_hosts.is_empty(), "只记录模式不应产生被拦域名");
    }

    #[test]
    fn denied_hosts_are_remembered_so_the_ui_can_offer_to_allow_them() {
        let state = WebVpnState::default();
        state.apply_policy(WebVpnPolicy::from_config(
            "https://webvpn.example.edu/",
            &[],
            true,
        ));
        assert!(!state.decide_navigation("sso.unknown.edu"));
        assert!(
            !state.decide_navigation("sso.unknown.edu"),
            "重复拦截应去重"
        );
        let status = state.status(&WebVpnConfig::default(), true);
        assert_eq!(status.denied_hosts, vec!["sso.unknown.edu".to_string()]);

        // 用户放行后该域名离开待放行列表，并进入白名单。
        let allowed = state.allow_host("sso.unknown.edu").expect("放行应成功");
        assert!(allowed.contains(&"sso.unknown.edu".to_string()));
        assert!(state.decide_navigation("sso.unknown.edu"));
        assert!(state
            .status(&WebVpnConfig::default(), true)
            .denied_hosts
            .is_empty());
    }

    #[test]
    fn allow_host_rejects_malformed_domains() {
        let state = WebVpnState::default();
        for bad in ["", "   ", "https://doi.org", "doi.org/path", "a b.com"] {
            assert!(state.allow_host(bad).is_err(), "应拒绝: {bad:?}");
        }
        // 前导点代表"含子域"，应被规范化掉后接受。
        assert_eq!(
            state.allow_host(".doi.org").expect("应接受"),
            vec!["doi.org".to_string()]
        );
    }

    #[test]
    fn session_state_machine_rejects_illegal_transitions() {
        use WebVpnSessionState::*;
        // 合法路径：关闭 → 打开门户 → 等待登录 → 已确认 → 转发 → 回到已确认。
        for (from, to) in [
            (Closed, Opening),
            (Opening, WaitingLogin),
            (WaitingLogin, Ready),
            (Ready, Navigating),
            (Navigating, Ready),
            (Ready, Error),
            (Error, Opening),
            (Navigating, Closed),
            (WaitingDownload, Downloading),
            (Downloading, Uploading),
        ] {
            assert!(from.can_transition_to(to), "{from:?} → {to:?} 应允许");
        }
        // 非法：尚未打开就要求已确认/转发，门户还在加载就转发，或从已确认退回等待登录。
        for (from, to) in [
            (Closed, Ready),
            (Closed, Navigating),
            (Closed, WaitingLogin),
            (Opening, Navigating),
            (Ready, WaitingLogin),
        ] {
            assert!(!from.can_transition_to(to), "{from:?} → {to:?} 应被拒绝");
        }
        // 销毁窗口（清除登录状态）从任何状态都可能发生。
        for state in [Closed, Opening, WaitingLogin, Ready, Navigating, Error] {
            assert!(
                state.can_transition_to(Closed),
                "{state:?} → Closed 应允许（销毁窗口路径）"
            );
        }
        // 同态自转必须幂等允许（重复点"打开"很常见）。
        for state in [Closed, Opening, WaitingLogin, Ready, Navigating, Error] {
            assert!(state.can_transition_to(state), "{state:?} 自转应允许");
        }
    }

    #[test]
    fn state_transitions_and_failures_are_observable_through_status() {
        let state = WebVpnState::default();
        let config = WebVpnConfig {
            portal_url: "https://webvpn.example.edu/".to_string(),
            allowed_hosts: Vec::new(),
            enforce_navigation: true,
        };
        assert_eq!(
            state.status(&config, false).state,
            WebVpnSessionState::Closed
        );

        state
            .transition(WebVpnSessionState::Opening)
            .expect("关闭态可以打开");
        // 非法迁移必须报错而不是静默改写——否则 UI 与 shell 的状态理解会漂移。
        assert!(state.transition(WebVpnSessionState::Navigating).is_err());

        state
            .transition(WebVpnSessionState::WaitingLogin)
            .expect("加载完成进入等待登录");
        state
            .transition(WebVpnSessionState::Ready)
            .expect("用户确认登录");
        assert!(state.status(&config, true).authenticated);
        state.begin_navigation("doi.org").expect("已确认后可以转发");
        let navigating = state.status(&config, true);
        assert_eq!(navigating.state, WebVpnSessionState::Navigating);
        assert_eq!(navigating.target_host.as_deref(), Some("doi.org"));

        // 转发落地后回到 Ready，并清除目标。
        assert!(state.decide_navigation("doi.org"));
        assert_eq!(state.status(&config, true).state, WebVpnSessionState::Ready);

        state.fail("导航失败");
        let failed = state.status(&config, true);
        assert_eq!(failed.state, WebVpnSessionState::Error);
        assert_eq!(failed.last_error.as_deref(), Some("导航失败"));
        // 成功的迁移应清掉上一次的错误，避免 UI 残留旧报错。
        state
            .transition(WebVpnSessionState::Opening)
            .expect("错误态可以重开");
        assert!(state.status(&config, true).last_error.is_none());

        state.mark_closed();
        let closed = state.status(&config, false);
        assert_eq!(closed.state, WebVpnSessionState::Closed);
        assert!(!closed.authenticated);
        assert!(closed.target_host.is_none());
        // 配置始终如实透出，便于 UI 判断"未配置门户"。
        assert_eq!(closed.portal_url, "https://webvpn.example.edu/");
        assert!(
            closed.configured_enforce_navigation,
            "配置里的拦截意图必须如实透出"
        );
        // 本用例从未 apply_policy，因此**生效**策略仍是默认的只记录。
        assert!(
            !closed.enforce_navigation,
            "未 apply_policy 时生效策略应为默认的只记录"
        );
    }

    #[test]
    fn status_reports_config_separately_from_session_state() {
        // 配置是权威来源；探测模式下策略只记录，但 UI 仍需看到配置里的 enforce 意图。
        // 两者混为一谈会导致 UI 无法既回填表单又如实反映实际拦截行为。
        let state = WebVpnState::default();
        state.apply_policy(WebVpnPolicy::record_only());
        let config = WebVpnConfig {
            portal_url: "https://webvpn.example.edu/".to_string(),
            allowed_hosts: vec!["idp.example.edu".to_string()],
            enforce_navigation: true,
        };
        let status = state.status(&config, false);
        assert_eq!(status.portal_url, "https://webvpn.example.edu/");
        assert!(!status.enforce_navigation, "探测模式实际生效的是只记录策略");
        assert!(
            status.allowed_hosts.is_empty(),
            "只记录策略下生效白名单为空"
        );
        // 用户意图与实际生效必须同时可见。
        assert!(
            status.configured_enforce_navigation,
            "配置里的拦截开关为 true"
        );
        assert_eq!(
            status.configured_allowed_hosts,
            vec!["idp.example.edu".to_string()]
        );
        assert_eq!(
            status.probe_available,
            cfg!(debug_assertions),
            "探测可用性必须与构建类型一致"
        );
    }

    #[test]
    fn reused_session_keeps_a_confirmed_login() {
        let state = WebVpnState::default();
        // 尚未确认时复用窗口：应落在等待登录。
        state
            .transition(WebVpnSessionState::Opening)
            .expect("关闭态可打开");
        state.enter_reused_session();
        assert_eq!(state.state(), WebVpnSessionState::WaitingLogin);

        // 用户确认后再次复用：不能把已确认的会话打回等待登录，
        // 否则每点一次"打开"都要重新确认一次。
        state
            .transition(WebVpnSessionState::Ready)
            .expect("确认登录");
        state.enter_reused_session();
        assert_eq!(state.state(), WebVpnSessionState::Ready);

        // 转发进行中复用同理，不应被重置。
        state.begin_navigation("doi.org").expect("已确认可转发");
        state.enter_reused_session();
        assert_eq!(state.state(), WebVpnSessionState::Navigating);

        // 下载/导航错误不等于登录失效；复用时恢复为已登录可用态。
        state.fail("上一次导航失败");
        state.enter_reused_session();
        assert_eq!(state.state(), WebVpnSessionState::Ready);
        assert!(state.status(&WebVpnConfig::default(), true).authenticated);
        assert!(state
            .status(&WebVpnConfig::default(), true)
            .last_error
            .is_none());
    }

    #[test]
    fn portal_detection_marks_authenticated_session_ready() {
        let state = WebVpnState::default();
        let config = WebVpnConfig::default();
        state
            .transition(WebVpnSessionState::Opening)
            .expect("关闭态可打开");
        state
            .transition(WebVpnSessionState::WaitingLogin)
            .expect("进入登录页");
        state.mark_authenticated();
        let ready = state.status(&config, true);
        assert!(ready.authenticated);
        assert_eq!(ready.state, WebVpnSessionState::Ready);
    }

    #[test]
    fn any_state_can_be_reset_and_reopened() {
        use WebVpnSessionState::*;
        // open_window 的新建分支 = 「若非 Closed 则归零」+「→ Opening」。
        // 只要这两步对任意起点都合法，"重新打开"就不可能被卡死。
        for from in [
            Closed,
            Opening,
            WaitingLogin,
            Ready,
            Navigating,
            WaitingDownload,
            Uploading,
            Expired,
            Error,
        ] {
            assert!(from.can_transition_to(Closed), "{from:?} 必须能归零");
        }
        assert!(Closed.can_transition_to(Opening), "归零后必须能重新打开");

        // 具体走一遍用户最可能遇到的路径：已确认登录 → 窗口被销毁 → 重新打开。
        let state = WebVpnState::default();
        state.transition(Opening).expect("打开");
        state.transition(WaitingLogin).expect("加载完成");
        state.transition(Ready).expect("确认登录");
        // 直接 Ready → Opening 是非法的（防止 UI 与 shell 的状态理解漂移）……
        assert!(state.transition(Opening).is_err());
        // ……所以必须走归零路径，这一步正是 open_window 新建分支所做的。
        state.mark_closed();
        assert_eq!(state.state(), Closed);
        state.transition(Opening).expect("归零后重开不得被卡死");
        state.transition(WaitingLogin).expect("重新进入等待登录");
        assert_eq!(state.state(), WaitingLogin);
    }

    #[test]
    fn ustc_proxy_url_matches_the_observed_nature_route() {
        let target =
            validate_target("https://www.nature.com/articles/s41551-023-01022-4?preview=1#secret")
                .unwrap();
        let proxy = build_wrd_proxy_url("https://wvpn.ustc.edu.cn/", &target).unwrap();
        assert_eq!(
            proxy.as_str(),
            "https://wvpn.ustc.edu.cn/https/77726476706e69737468656265737421e7e056d229317c456c0dc7af9758/articles/s41551-023-01022-4?preview=1"
        );
    }

    #[test]
    fn proxy_url_preserves_a_configured_portal_port() {
        let target = validate_target("https://pubs.acs.org/").unwrap();
        let proxy = build_wrd_proxy_url("https://vpn.example.edu:8443/", &target).unwrap();
        assert_eq!(proxy.scheme(), "https");
        assert_eq!(proxy.host_str(), Some("vpn.example.edu"));
        assert_eq!(proxy.port(), Some(8443));
    }

    /// 客户端接管布局后，坏矩形必须被规整为 None，绝不用 NaN/负尺寸去 set_bounds。
    #[test]
    fn sanitize_client_rect_rejects_unusable_input() {
        // 正常矩形原样通过。
        assert_eq!(
            sanitize_client_rect(true, 840.0, 68.0, 400.0, 652.0),
            Some((840.0, 68.0, 400.0, 652.0))
        );
        // 负坐标夹到 0。
        assert_eq!(
            sanitize_client_rect(true, -12.0, -3.0, 400.0, 652.0),
            Some((0.0, 0.0, 400.0, 652.0))
        );
        // 不可见 / 非有限值 / 尺寸低于可操作下限：一律 None（按隐藏处理）。
        assert_eq!(sanitize_client_rect(false, 840.0, 68.0, 400.0, 652.0), None);
        assert_eq!(sanitize_client_rect(true, f64::NAN, 0.0, 400.0, 652.0), None);
        assert_eq!(sanitize_client_rect(true, 0.0, f64::INFINITY, 400.0, 652.0), None);
        assert_eq!(sanitize_client_rect(true, 0.0, 0.0, 12.0, 652.0), None);
        assert_eq!(sanitize_client_rect(true, 0.0, 0.0, 400.0, 9.0), None);
    }

    /// client_layout 只置位不清除：这条保证「上报过矩形」之后不再回落到按比例分栏。
    #[test]
    fn client_layout_flag_latches_once_set() {
        let state = WebVpnState::default();
        assert!(!state.client_layout());
        assert_eq!(state.client_rect(), None);
        state.mark_client_layout();
        state.set_client_rect((10.0, 20.0, 400.0, 600.0));
        assert!(state.client_layout());
        assert_eq!(state.client_rect(), Some((10.0, 20.0, 400.0, 600.0)));
        // 状态重置（关闭会话）不解除布局接管。
        state.mark_closed();
        assert!(state.client_layout());
    }

    #[test]
    fn sidebar_layout_uses_one_third_for_the_browser() {
        let ((main_width, main_height), (x, y, sidebar_width, sidebar_height)) =
            sidebar_layout(1_200.0, 720.0);
        assert_eq!((main_width, main_height), (800.0, 720.0));
        assert_eq!(
            (x, y, sidebar_width, sidebar_height),
            (800.0, 0.0, 400.0, 720.0)
        );

        // 窄窗口中仍给浏览器保留可操作的 360px。
        let ((main_width, _), (_, _, sidebar_width, _)) = sidebar_layout(960.0, 640.0);
        assert_eq!(main_width, 600.0);
        assert_eq!(sidebar_width, 360.0);
    }

    #[test]
    fn capture_state_replaces_previous_capture_and_ignores_stale_completion() {
        let state = WebVpnState::default();
        state.transition(WebVpnSessionState::Opening).unwrap();
        state.transition(WebVpnSessionState::Ready).unwrap();
        let upload = url::Url::parse(
            "http://127.0.0.1:3080/api/lab-capture-upload?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDE",
        )
        .unwrap();
        let first = std::env::temp_dir().join("capture-one.pdf");
        let second = std::env::temp_dir().join("capture-two.pdf");
        let generation = state
            .prepare_capture(
                "capture-abc123",
                "pdf",
                "www.nature.com",
                PublisherAdapter::Nature,
                true,
                false,
                upload.clone(),
                first.clone(),
            )
            .unwrap();
        // 模拟第一次捕获的导航被弹回（Nature 授权失败回门户首页）：进入
        // WaitingDownload，但 pending 仍挂着。
        assert!(state.decide_navigation("wvpn.ustc.edu.cn"));
        assert_eq!(state.state(), WebVpnSessionState::WaitingDownload);
        // 用户重新点击另一篇文献时，新任务可以直接替换等待中的旧任务。
        state.transition(WebVpnSessionState::Ready).unwrap();
        // 新的捕获意图必须替换旧 pending（客户端会先作废旧任务），否则旧僵尸
        // pending 会挡住重试，并在稍后手动下载时用已作废令牌上传 → 409。
        let second_generation = state
            .prepare_capture(
                "capture-other",
                "si",
                "pubs.acs.org",
                PublisherAdapter::Acs,
                false,
                false,
                upload,
                second.clone(),
            )
            .expect("新捕获应替换旧 pending 而不是被拒绝");
        assert_ne!(second_generation, generation);
        assert!(state.decide_navigation("wvpn.ustc.edu.cn"));
        assert_eq!(state.state(), WebVpnSessionState::WaitingDownload);
        assert_eq!(
            state.claim_download_destination(),
            DownloadDecision::Capture(second.clone())
        );
        assert_eq!(
            state.state(),
            WebVpnSessionState::Downloading,
            "点击下载后应从「等待下载」进入「下载中」"
        );
        std::fs::write(&second, vec![0_u8; 1_234]).unwrap();
        let download_status = state.status(&WebVpnConfig::default(), true);
        assert_eq!(download_status.downloaded_bytes, Some(1_234));
        assert!(download_status.download_elapsed_ms.is_some());
        assert_eq!(
            state.claim_download_destination(),
            DownloadDecision::Duplicate,
            "重复下载请求不能再次占用同一个目标文件"
        );
        assert!(state.should_ignore_failed_finish());
        let pending = state.begin_upload(&second).expect("匹配下载应开始上传");
        assert_eq!(pending.generation, second_generation);
        state.finish_upload(second_generation.wrapping_add(1), Ok(()));
        assert_eq!(state.state(), WebVpnSessionState::Uploading);
        state.finish_upload(second_generation, Ok(()));
        assert_eq!(state.state(), WebVpnSessionState::Ready);
        assert!(state
            .status(&WebVpnConfig::default(), true)
            .pending_task_id
            .is_none());
        let _ = std::fs::remove_file(&second);
    }

    #[test]
    fn failed_upload_preserves_the_pdf_instead_of_deleting_it() {
        let dir = std::env::temp_dir().join("ibm-webvpn-preserve-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("capture-xyz-pdf.pdf");
        std::fs::write(&path, b"%PDF-1.4 fake").unwrap();
        let preserved = preserve_failed_download(&path, "capture-xyz", "pdf");
        assert!(!path.exists(), "原临时文件不应残留");
        assert!(preserved.exists(), "下载文件应被保留而非删除");
        assert_eq!(
            preserved.file_name().unwrap().to_str().unwrap(),
            "capture-xyz-pdf-未归档.pdf"
        );
        std::fs::remove_file(&preserved).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn failed_download_clears_pending_capture_and_enters_error() {
        let state = WebVpnState::default();
        state.transition(WebVpnSessionState::Opening).unwrap();
        state.transition(WebVpnSessionState::Ready).unwrap();
        let path = std::env::temp_dir().join("ibm-webvpn-failed-download.pdf");
        std::fs::write(&path, b"partial").unwrap();
        state
            .prepare_capture(
                "capture-failed",
                "pdf",
                "www.nature.com",
                PublisherAdapter::Nature,
                true,
                false,
                url::Url::parse("http://127.0.0.1:3080/api/lab-capture-upload?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDE").unwrap(),
                path.clone(),
            )
            .unwrap();
        state.fail_pending_download("下载失败");
        let status = state.status(&WebVpnConfig::default(), true);
        assert_eq!(status.state, WebVpnSessionState::Error);
        assert_eq!(status.last_error.as_deref(), Some("下载失败"));
        assert!(status.pending_task_id.is_none());
        assert!(!path.exists());
    }
}
