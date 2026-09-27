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
    take_pwstr, CoTaskMemPWSTR, ExecuteScriptCompletedHandler, NavigationCompletedEventHandler,
    SaveAsUIShowingEventHandler, ShowSaveAsUICompletedHandler, SourceChangedEventHandler,
    WebResourceResponseReceivedEventHandler, WebResourceResponseViewGetContentCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_2, ICoreWebView2_25, COREWEBVIEW2_SAVE_AS_UI_RESULT_SUCCESS,
    },
};
#[cfg(windows)]
use windows::core::{Interface, PCWSTR, PWSTR};
#[cfg(windows)]
use windows::core::BOOL;
#[cfg(windows)]
use windows::Win32::System::Com::IStream;


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
  // 初始化脚本会在**每个 frame** 里执行。publisher 页面常有同源 iframe，各挂一套壳
  // 就会出现"多个地址栏 + 前进后退横条"（2026-09-27 实测）。只在最外层文档挂。
  if (window.top !== window.self) return;
  /**
   * 把内部状态送回壳。
   *
   * **绝不能用 `location.href`**：那在 WebView2 里是一次真实导航，会把正在加载的
   * 出版社页面打成"JS 还活着、却一个像素都不画"的白屏——注入的工具栏也一起消失
   * （2026-09-25 science.org 实测：文档、标题、脚本都还在，表面却是纯白一片）。
   * `window.open` 只触发宿主的新窗口请求，当前文档完全不受影响；壳一律拒绝该窗口，
   * 并从 URL 里读回命令（见 webvpn.rs 的 handle_internal_command）。
   */
  const notifyShell = (target) => {
    try { window.open(`ibm-webvpn://${target}`, '_blank'); return true; } catch { return false; }
  };
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
      notifyShell('session/ready');
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
        notifyShell('offset-reverted/');
      }, 2500);
    }
    return applied;
  };
  /**
   * 捕获状态小球：手动/自动文献捕获期间浮在右下角，点一下终止本次捕获。
   * 状态由壳经 `window.__ibmWebVpnCapture(payload)` 推进来；`null` 表示隐藏。
   */
  let captureBall = null;
  let captureQueueNode = null;
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
      .ball{all:initial;box-sizing:border-box;display:none;max-width:320px;padding:9px 14px;border-radius:14px;background:#0f172a;color:#f8fafc;font:600 12px/1.35 "Segoe UI","Microsoft YaHei",sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.38);cursor:pointer;align-items:center;gap:8px}
      .ball[data-visible="true"]{display:inline-flex}
      /* 队列：小球里直接看到排队序列，每条可单独删除（删的是队列，不是当前任务）。 */
      .queue{all:initial;display:block;margin:6px 0 0;padding:6px 0 0;border-top:1px solid rgba(148,163,184,.35);max-height:150px;overflow:auto}
      .queue[hidden]{display:none}
      .queue-item{all:initial;display:flex;align-items:center;gap:6px;padding:2px 0;color:#e2e8f0;font:500 11px/1.3 "Segoe UI","Microsoft YaHei",sans-serif}
      .queue-item .label{all:initial;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 11px/1.3 "Segoe UI","Microsoft YaHei",sans-serif;color:#e2e8f0}
      .queue-item .kill{all:initial;box-sizing:border-box;width:18px;height:18px;border-radius:5px;text-align:center;font:600 12px/18px "Segoe UI",sans-serif;color:#cbd5e1;cursor:pointer}
      .queue-item .kill:hover{background:#e81123;color:#fff}
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
      /* C19：失去接管/停滞时给出的「重建」入口。 */
      .redo{all:initial;box-sizing:border-box;padding:1px 7px;border-radius:8px;background:rgba(248,250,252,.22);color:#f8fafc;font:600 11px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;cursor:pointer}
      .redo[hidden]{display:none}
      .redo:hover{background:rgba(248,250,252,.38)}
      @keyframes ibm-ball-pulse{50%{opacity:.3}}
      @media (prefers-reduced-motion: reduce){.ball .dot{animation:none}}
    </style><button class="ball" type="button"><i class="dot" aria-hidden="true"></i><span class="text">文献捕获</span><span class="hint">点击终止</span><span class="redo" hidden>重建</span></button><div class="queue" hidden></div>`;
    const ball = root.querySelector('.ball');
    const queueNode = root.querySelector('.queue');
    captureQueueNode = queueNode;
    ball.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      // C19：灰色小球（失去接管/停滞）上的「重建」优先于终止。
      const redo = event.target && event.target.closest ? event.target.closest('.redo') : null;
      if (redo && ball.dataset.canRecreate === 'true' && ball.dataset.pendingId) {
        notifyShell('recreate-task/' + encodeURIComponent(ball.dataset.pendingId));
        return;
      }
      // 结束态下这一下是"关闭小球"；进行中才是"终止本次捕获"。
      if (ball.dataset.settled === 'true') {
        notifyShell('notice-dismiss/');
        host.style.display = 'none';
        return;
      }
      notifyShell('cancel-capture/');
    });
    // 逐条删除：只把 id 交给壳，真正的取消由插件执行（壳会校验 id 在不在队列里）。
    queueNode.addEventListener('click', (event) => {
      const kill = event.target && event.target.closest ? event.target.closest('.kill') : null;
      if (!kill) return;
      event.preventDefault();
      event.stopPropagation();
      const id = kill.dataset.taskId || '';
      if (!id) return;
      notifyShell('cancel-task/' + encodeURIComponent(id));
      const row = kill.closest('.queue-item');
      if (row) row.remove();
      syncQueueVisibility();
    });
    const syncQueueVisibility = () => {
      if (!queueNode) return;
      queueNode.hidden = queueNode.children.length === 0;
    };
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
        : payload.phase === 'verification' ? '需要人机验证：请在页面点一下验证框'
        : payload.phase === 'manual' ? '未确认自动入口，请手动保存' + kind
        : payload.phase === 'opening' ? '正在打开出版社页面'
        : payload.phase === 'completed' ? kind + '已归档'
        : payload.phase === 'error' ? kind + '下载或归档失败，请重试'
        : payload.phase === 'idle' ? '队列中还有任务等待捕获'
        : '等待' + kind + '下载入口';
    // 结束后**不隐藏**：用户要能看到结果与队列，点一下小球才关闭（2026-09-26 反馈）。
    // C20：插件推导的文案与色调优先。壳只在客户端还没上报过这条任务时兜底，
    // 这样「工具说 queued、小球说失败」的双源矛盾就不可能再出现。
    const stalled = payload.stalled === true;
    const finished = payload.phase === 'completed' || payload.phase === 'error'
      || payload.phase === 'heartbeat-lost' || payload.phase === 'orphaned' || stalled;
    const tone = typeof payload.ballTone === 'string' && payload.ballTone ? payload.ballTone : '';
    const toneBackground = tone === 'error' ? '#b91c1c'
      : tone === 'complete' ? '#047857'
      : tone === 'busy' ? '#1d4ed8'
      : '';
    if (toneBackground) captureBall.style.background = toneBackground;
    captureBall.dataset.settled = finished ? 'true' : 'false';
    captureBall.dataset.canRecreate = payload.canRecreate === true ? 'true' : 'false';
    captureBall.dataset.pendingId = String(payload.pendingId || '');
    captureBall.querySelector('.hint').textContent = finished ? '点击关闭' : '点击终止';
    const redo = captureBall.querySelector('.redo');
    if (redo) redo.hidden = !(payload.canRecreate === true);
    captureBall.querySelector('.text').textContent =
      typeof payload.ballText === 'string' && payload.ballText ? payload.ballText : text;
    // 队列：显示排队序列与各自状态；"正在跑的那条"不给删除按钮。
    const entries = Array.isArray(payload.queue) ? payload.queue : [];
    if (captureQueueNode) {
      const rows = entries.map((entry) => {
        const row = document.createElement('div');
        row.className = 'queue-item';
        const running = Boolean(entry.id) && entry.id === payload.pendingId;
        const label = document.createElement('span');
        label.className = 'label';
        const kindText = entry.kind === 'si' ? '补充材料' : '正文';
        const statusText = {
          armed: '排队中', running: '进行中', completed: '已完成', failed: '失败',
          cancelled: '已取消', expired: '已过期'
        }[entry.status] ?? String(entry.status || '');
        label.textContent = (running ? '▶ ' : '') + kindText + ' · ' + statusText;
        row.appendChild(label);
        if (!running) {
          const kill = document.createElement('button');
          kill.type = 'button';
          kill.className = 'kill';
          kill.dataset.taskId = entry.id;
          kill.title = '从队列删除该任务';
          kill.setAttribute('aria-label', '从队列删除该任务');
          kill.textContent = '×';
          row.appendChild(kill);
        }
        return row;
      });
      captureQueueNode.replaceChildren(...rows);
      captureQueueNode.hidden = rows.length === 0;
    }
    captureBall.dataset.phase = payload.phase;
    captureBall.dataset.visible = 'true';
    captureBall.setAttribute('title', finished ? text + '；点击关闭' : text + '；点击终止本次捕获');
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
      if (tabState.tabs.length === 1) { notifyShell('close/'); return; }
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
    root.querySelector('.window-close').addEventListener('click', () => { notifyShell('close/'); });
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
  /** 同 WEBVPN_CHROME_SCRIPT：只能走 window.open，导航会打白页面。 */
  const signal = (result) => {
    try { window.open(`ibm-webvpn://automation/${result}`, '_blank'); } catch { /* 弹窗被拒：本次状态不上报，页面照常 */ }
  };
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
    // 1) 挑战插页的**标题**是强特征：正常文章页不会是「请稍候…／Just a moment…」。
    const title = clean(document.title);
    if (/just a moment|请稍候|attention required|checking your browser|ddos protection|正在验证|人机验证|verify (?:you are )?human/.test(title)) return true;
    const bodyText = clean((document.body?.innerText || '').slice(0, 4000));
    // 2) 文章页优先。有 citation 元数据、或正文已经足够长时，后面那些"验证"字样只可能是
    //    站点自带的文案（页脚合规声明、Cloudflare 注入脚本），不是挑战插页。
    const articleLike = Boolean(document.querySelector('meta[name="citation_doi"],meta[name="citation_title"],meta[name="dc.identifier"]'))
      || bodyText.length > 1200;
    if (articleLike) return false;
    if (/正在进行安全验证|请验证您是真人|verify you are human|security check|unusual traffic|机器人验证|captcha/.test(bodyText)) return true;
    // 3) 只有**可见的**验证组件才算。仅仅存在 challenge-platform / challenges.cloudflare.com
    //    这类脚本或资源**不算**：Cloudflare 保护的普通文章页同样会带它们。
    //    2026-09-25 实测：文章页被这些标记误判成验证页，扫描器于是永远停在"等待验证"，
    //    再也不会去找下载入口（nextAction 一直是 wait-and-poll，任务卡死）。
    const markers = [
      'iframe[src*="challenges.cloudflare.com"]',
      'input[name="cf-turnstile-response"]',
      '#challenge-form',
      '#challenge-running',
      '#cf-challenge-running'
    ];
    return markers.some((selector) => {
      try {
        const element = document.querySelector(selector);
        if (!element) return false;
        const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
        if (!rect) return false;
        return rect.width > 40 && rect.height > 40;
      } catch { return false; }
    });
  };
  /**
   * 文档还在加载、或正文里还没有任何可交互内容时，它不构成「已确认的出版社文章页」。
   *
   * 挑战插页、被反爬拦下的空文档、以及解析被卡住的页面都属于这一类：此时消耗尝试
   * 次数只会在 12 秒后得出「已进入 PDF 预览器」这种错误结论，并把普通文章页当成
   * 整屏预览器去做页面位移。所以这种情况只等待，不计数。
   */
  /**
   * 文档是否**已经加载完**。动手（点入口 / 触发下载）之前必须为真。
   *
   * 2026-09-26 实测：预览器/大 PDF 还在加载时就触发下载，拿到的文件根本还没落盘
   * （日志里是 `downloadRequested` 紧接 `系统找不到指定的文件`）。而"第几次扫描"
   * 与页面就绪无关——它等价于一个固定延时，正是问题来源。所以改成事件驱动：
   * 只有 `readyState === 'complete'` 才动手。
   */
  const documentLoaded = () => document.readyState === 'complete';
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
    // 空白、没加载完、或还没到 complete 的文档一律只等待：挑战页、被拦页面、
    // 以及"大 PDF 还在拉"的预览器都属于这一类。超过约 30 秒仍没就绪才退回人工，
    // 避免任务永远停在"正在查找入口"，也避免在没就绪的页面上动手。
    if (!publisherContentReady() || !documentLoaded()) {
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
  /**
   * 候选必须带"能区分彼此"的目标信息：Science 文章页上 PDF / Download PDF / 三个
   * DOWNLOAD 同名同 role，却在下载完全不同的东西（2026-09-27 实测：三个 DOWNLOAD 分别是
   * sm.pdf 与 tables zip）。只给 label 时调用方只能盲点、再从日志反查 URL。
   *
   * 同时**不能把带票据的 URL 送进模型上下文**：只保留少数"说明这是哪个入口"的参数，
   * 其余（ticket/token/session/code 等）一律丢弃。
   */
  const KEEP_PARAMS = ['file', 'filename', 'name', 'type', 'format', 'download', 'isdtmredir', 'doi'];
  const safeTarget = (raw) => {
    try {
      const url = new URL(raw, location.href);
      const kept = [...url.searchParams.entries()]
        .filter(([key]) => KEEP_PARAMS.includes(key.toLowerCase()))
        .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value).slice(0, 80)));
      return (url.host + url.pathname + (kept.length ? '?' + kept.join('&') : '')).slice(0, 180);
    } catch { return ''; }
  };
  const safeFileName = (raw) => {
    try {
      const url = new URL(raw, location.href);
      const fromQuery = url.searchParams.get('file') || url.searchParams.get('filename') || '';
      const base = String(fromQuery || url.pathname).split('/').pop() || '';
      return /^[\w.\- ]{1,60}$/.test(base) ? base : '';
    } catch { return ''; }
  };
  const rows = [];
  const elements = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll('a[href],button,[role="button"]')) {
      if (!visible(el)) continue;
      const label = String(el.getAttribute('aria-label') || el.innerText || el.textContent || '')
        .replace(/\s+/g, ' ').trim().slice(0, 100);
      // 历史下载气泡（"Downloads: 981,"）与本次下载无关，却总占候选首位且看着像进度。
      if (/^downloads?:?\s*\d/i.test(label)) continue;
      const href = el.closest('a[href]')?.getAttribute('href') || '';
      // scope=download 只给下载相关入口（旧行为）；scope=all 给整页可交互元素，
      // 供 AI 主导流程自己判断该点哪里（2026-09-27 需求：提高 AI 主动性）。
      if (__OBSERVE_SCOPE__ === 'download'
        && !/pdf|download|supplement|supporting|附件|补充|下载|保存|全文|article/i.test(label + ' ' + href)) continue;
      const id = 'e' + (rows.length + 1);
      elements.push(el);
      // C12：入口可判别。「点了会直接下载」和「点了只进预览器」必须能区分，
      // 否则同名入口（Science 的 PDF / Download PDF）只能靠 AI 从 URL 里猜。
      const autoDownloadable = (() => {
        const raw = String(href || '');
        if (!raw) return false;
        if (/download\s*=\s*true/i.test(raw)) return true;
        if (el.hasAttribute && el.hasAttribute('download')) return true;
        return /\.(?:pdf|zip|docx?)(?:[?#]|$)/i.test(raw);
      })();
      rows.push({ id, role: el.tagName.toLowerCase(), label,
        target: safeTarget(href), file: safeFileName(href), autoDownloadable,
        likely: /supplement|supporting|附件|补充/i.test(label + ' ' + href) ? 'si' : 'pdf' });
      if (rows.length >= 30) break;
    }
    if (rows.length >= 30) break;
  }
  const observationId = crypto.randomUUID().replace(/-/g, '');
  // 记下当时的 URL：页面一变，元素引用就失效（比单纯靠 TTL 更准）。
  window.__ibmAgentObservation = { observationId, at: Date.now(), href: location.href, elements };
  // 页面摘要：AI 主导流程要先知道"这是哪一页、处于什么阶段"，再决定点哪里。
  const bodyText = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  return { observationId, host: location.hostname.slice(0, 100),
    documentType: document.contentType || '',
    readyState: document.readyState,
    url: location.href.split('?')[0].slice(0, 200),
    title: String(document.title || '').slice(0, 160),
    text: bodyText.slice(0, 1200),
    scroll: { y: Math.round(window.scrollY || 0), height: Math.round(document.documentElement?.scrollHeight || 0) },
    candidates: rows };
})()
"#;

const AGENT_CLICK_SCRIPT: &str = r#"
(() => {
  const snapshot = window.__ibmAgentObservation;
  // 15 秒对"模型一次工具往返"太紧（实测经常来不及点）。延长到 2 分钟，并额外要求
  // 页面 URL 没变 —— 变了说明元素引用已经失效，这比单看时间更准。
  if (!snapshot || snapshot.observationId !== __OBSERVATION_ID__ || Date.now() - snapshot.at > 120000
    || snapshot.href !== location.href)
    return { error: '页面观察已过期（页面已变化或超时），请重新观察' };
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

/// 顶层文档就是原生 PDF 的地址：WebView2 内置查看器会占满窗口，其顶部工具栏
/// 会被我们的 76px 工具栏盖住，因此这类页面需要开启页面位移；同时也是"该调保存
/// 工具、而不是继续找入口"的判据。
pub fn is_pdf_document_url(target: &url::Url) -> bool {
    let path = target.path().to_ascii_lowercase();
    if path.ends_with(".pdf") {
        return true;
    }
    // 出版社把原生 PDF 挂在这些端点上，路径并不以 .pdf 结尾：Science 的
    // `/doi/pdf/10.1126/…`、Elsevier 的 `/pdfft`、IEEE 的 `/stampPDF/getPDF.jsp`。
    // 判据与页面脚本 previewDownloadUrl() 用的那一组保持一致。
    path.contains("/doi/pdf")
        || path.contains("/pdfft")
        || path.contains("/content/pdf/")
        || path.contains("/stamppdf/getpdf.jsp")
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

/// 队列条目：由 DSH 右侧栏客户端上报，**仅用于捕获小球的展示与逐条删除**。
///
/// 任务调度的真源在插件（manual-capture 存储）里，这里只是一份只读快照；
/// 删除请求会原样转回客户端，由插件真正取消。
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureQueueEntry {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub requested_by: String,
    /// 插件推导好的小球相位/文案/色调（C20）。小球直接渲染这些，不再自己按
    /// `state` 猜一遍 —— 「工具说 queued、小球说失败」的双源矛盾就此消失。
    pub ball_phase: String,
    pub ball_text: String,
    pub ball_tone: String,
    pub ball_stalled: bool,
    pub ball_can_recreate: bool,
    pub ball_can_cancel: bool,
}

/// 页面级事实快照（C2）。每次导航/加载完成更新一次，`seq` 单调递增，
/// 让上层的 `wait` 能把「页面跳了」当成状态变化而不是「没有变化」。
#[derive(Debug, Clone)]
struct PageSnapshot {
    url: String,
    document_type: Option<String>,
    http_status: Option<u16>,
    ready_state: String,
    content_length: Option<u64>,
    seq: u64,
}

/// 原生 PDF 的响应体载荷（C1/R2.2）。
///
/// 原来只有宿主文档的 `readyState`，无法回答「PDF 字节流到底加载完了没有」；
/// 这里在响应层把 `application/pdf` 的响应体流式写入本任务的暂存路径，
/// 于是「载荷是否就绪」和「保存不走 viewer UI」变成同一个事实。
#[derive(Debug, Clone)]
struct PdfPayload {
    /// 响应头声明的总长度（WebView2 不保证给，缺省即为 None）。
    content_length: Option<u64>,
    /// 已落盘字节数。
    received_bytes: u64,
    path: PathBuf,
    complete: bool,
    error: Option<String>,
}

/// 一次捕获的终态结果（C4）。保存类操作等它，才能给出终态返回值。
#[derive(Debug, Clone)]
struct CaptureOutcome {
    generation: u64,
    ok: bool,
    path: Option<PathBuf>,
    bytes: Option<u64>,
    sha256: Option<String>,
    error: Option<String>,
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
    /// DSH 右侧栏上报的队列快照（小球据此显示排队序列并允许逐条删除）。
    capture_queue: Vec<CaptureQueueEntry>,
    /// 主文档页面事件快照（C2）。
    page: Option<PageSnapshot>,
    /// 接管关系（C3）：最后一次被谁接管、何时、为什么交还。
    ///
    /// 「没接管过」和「接管过又交还」是两种处境：前者还在排队，后者任务已经死了。
    /// 只靠心跳超时被动表达，上层就只能把两者都猜成 `queued`。
    last_pending_task_id: Option<String>,
    release_reason: Option<String>,
    taken_over_at: Option<String>,
    /// 最近一次捕获的终态（C4）。
    last_outcome: Option<CaptureOutcome>,
    /// 停滞检测的采样点（C17）：上次看到的字节数与时刻。
    progress_sample: Option<ProgressSample>,
    generation: u64,
}

#[derive(Debug, Clone)]
struct ProgressSample {
    bytes: u64,
    at: Instant,
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
    /// 响应层捕获到的 PDF 载荷（C1）；只有它 complete 才允许归档。
    pdf_payload: Option<PdfPayload>,
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
    /// 单次捕获的体积上限（字节）。调用方据此在下载前/中判断会不会白跑一趟 ——
    /// 超过它只会在最后的上传阶段被 413 拒绝（2026-09-27 实测 107 MB 的 SI）。
    pub max_capture_bytes: u64,
    /// WebVPN 窗口当前是否已创建（隐藏也算已创建）。
    pub window_open: bool,
    /// WebVPN 子 WebView 当前是否在主窗口右侧可见。
    pub sidebar_visible: bool,
    /// 探测模式是否可用（仅 debug 构建为 true）。
    pub probe_available: bool,
    /// 当前主文档 URL（C2）。已按既有规则脱敏：不含 query/fragment 里的票据。
    pub page_url: Option<String>,
    /// `application/pdf` / `text/html` …（取自响应头或 URL 推断）。
    pub document_type: Option<String>,
    pub http_status: Option<u16>,
    /// `loading` / `interactive` / `complete`。
    pub ready_state: Option<String>,
    /// 页面事件序号：每次导航/加载完成 +1。上层 `wait` 的指纹据此变化。
    pub page_seq: u64,
    /// 主文档响应头里的 content-length（C2/R2.2）。
    pub content_length: Option<u64>,
    /// PDF 响应体载荷的就绪情况（C1/R2.2）。
    pub pdf_payload: Option<PdfPayloadStatus>,
    /// 接管关系（C3）。
    pub last_pending_task_id: Option<String>,
    pub release_reason: Option<String>,
    pub taken_over_at: Option<String>,
    /// 下载/保存期间「无字节增长」的毫秒数（C17）。
    pub stalled_ms: Option<u64>,
}

/// 供 UI/插件读取的 PDF 载荷状态（不含任何路径）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPayloadStatus {
    pub ready: bool,
    pub complete: bool,
    pub content_length: Option<u64>,
    pub received_bytes: u64,
    pub error: Option<String>,
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
            Self::remove_pending_files(&active);
        }
        session.generation = session.generation.wrapping_add(1).max(1);
        let generation = session.generation;
        session.capture_notice = None;
        // C3：显式记录接管关系。旧任务若还没交还，先如实写下交还原因，
        // 这样上层能区分「从未被接管」与「接管过又被换掉」。
        if let Some(previous) = session.pending.as_ref().map(|pending| pending.task_id.clone()) {
            session.last_pending_task_id = Some(previous);
            session.release_reason = Some("新的捕获任务替换了它".to_string());
        }
        session.last_pending_task_id = Some(task_id.to_string());
        session.taken_over_at = Some(now_rfc3339());
        session.release_reason = None;
        session.last_outcome = None;
        session.progress_sample = None;
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
            pdf_payload: None,
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
            let pending = session.pending.take();
            session.state = WebVpnSessionState::Expired;
            session.last_error = Some("文献捕获任务已过期，请重新发起".to_string());
            drop(session);
            if let Some(pending) = pending.as_ref() {
                Self::remove_pending_files(pending);
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

    pub fn finish_upload(&self, generation: u64, result: Result<(), String>, archived_bytes: Option<u64>) {
        let Ok(mut session) = self.session.lock() else {
            return;
        };
        if session.pending.as_ref().map(|pending| pending.generation) != Some(generation) {
            return;
        }
        let kind = session.pending.as_ref().map(|pending| pending.kind.clone()).unwrap_or_default();
        // C4：把终态记下来。保存类操作靠它给出 {path, bytes}，而不是「已开始」之后失联。
        // 尺寸必须由调用方在删除临时文件**之前**量好传进来：成功归档后文件已经不在，
        // 那时再 stat 只会得到 None，产物信息就丢了（R5.2）。
        let (path, bytes) = session
            .pending
            .as_ref()
            .map(|pending| (Some(pending.temp_path.clone()), archived_bytes))
            .unwrap_or((None, None));
        let task_id = session.pending.as_ref().map(|pending| pending.task_id.clone());
        let sha256 = if result.is_ok() {
            path.as_deref().and_then(sha256_of_file)
        } else {
            None
        };
        session.last_outcome = Some(CaptureOutcome {
            generation,
            ok: result.is_ok(),
            // 归档成功后临时文件已被删除，路径只作为「它曾经在哪」的记录；
            // 真正的归档路径在插件任务行里。
            path,
            bytes,
            sha256,
            error: result.as_ref().err().cloned(),
        });
        // C3：任务结束即交还。
        if let Some(task_id) = task_id {
            session.last_pending_task_id = Some(task_id);
        }
        session.release_reason = Some(match &result {
            Ok(()) => "归档完成".to_string(),
            Err(error) => error.clone(),
        });
        session.progress_sample = None;
        session.capture_notice = Some(CaptureNotice {
            kind,
            phase: if result.is_ok() { "completed" } else { "error" },
            expires_at: Instant::now() + Duration::from_secs(30 * 60),
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

    /// 等一次捕获到达终态（C4）。保存类操作用它把「保存中」变成确定的成功/失败。
    fn wait_for_outcome(&self, generation: u64, timeout: Duration) -> Option<CaptureOutcome> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Ok(session) = self.session.lock() {
                match session.last_outcome.as_ref() {
                    Some(outcome) if outcome.generation == generation => return Some(outcome.clone()),
                    // 任务已经不是这一代了（被取消/被替换），也不该继续等。
                    _ if session.pending.as_ref().map(|pending| pending.generation) != Some(generation)
                        && session.last_outcome.as_ref().map(|outcome| outcome.generation) != Some(generation) =>
                    {
                        return session.last_outcome.clone();
                    }
                    _ => {}
                }
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }

    /// 记录一次页面事件（C2）。返回新的序号。
    pub fn record_page_event(&self, url: &str, ready_state: &str) -> u64 {
        let Ok(mut session) = self.session.lock() else {
            return 0;
        };
        let seq = session.page.as_ref().map(|page| page.seq).unwrap_or(0) + 1;
        let document_type = document_type_for(url, session.page.as_ref().and_then(|page| page.document_type.clone()));
        let http_status = session.page.as_ref().and_then(|page| page.http_status);
        let content_length = session.page.as_ref().and_then(|page| page.content_length);
        session.page = Some(PageSnapshot {
            url: url.to_string(),
            document_type,
            http_status,
            ready_state: ready_state.to_string(),
            content_length,
            seq,
        });
        seq
    }

    /// 记录主文档响应头（C2）：content-type → document_type，content-length 用于判断 PDF 载荷。
    pub fn record_document_response(
        &self,
        url: &str,
        content_type: Option<&str>,
        content_length: Option<u64>,
        http_status: Option<u16>,
    ) {
        let Ok(mut session) = self.session.lock() else {
            return;
        };
        let document_type = content_type
            .map(|value| value.split(';').next().unwrap_or(value).trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty())
            .or_else(|| document_type_for(url, None));
        // get_or_insert_with 只借一次，避免「match 里改同一个字段」的借用冲突。
        let page = session.page.get_or_insert_with(|| PageSnapshot {
            url: url.to_string(),
            document_type: None,
            http_status: None,
            ready_state: "loading".to_string(),
            content_length: None,
            seq: 1,
        });
        if page.url.is_empty() || page.url == url {
            page.document_type = document_type;
            page.content_length = content_length;
            page.http_status = http_status;
        }
    }

    /// 开始接收 PDF 响应体（C1）：登记目标路径与总长度。
    pub fn begin_pdf_payload(&self, task_id: &str, path: PathBuf, content_length: Option<u64>) -> bool {
        let Ok(mut session) = self.session.lock() else {
            return false;
        };
        let Some(pending) = session.pending.as_mut() else {
            return false;
        };
        if pending.task_id != task_id || pending.kind != "pdf" {
            return false;
        }
        if pending
            .pdf_payload
            .as_ref()
            .map(|payload| payload.complete && payload.received_bytes > 0)
            .unwrap_or(false)
        {
            // 已经拿到完整载荷：不要用第二个响应覆盖它。
            return false;
        }
        pending.pdf_payload = Some(PdfPayload {
            content_length,
            received_bytes: 0,
            path,
            complete: false,
            error: None,
        });
        true
    }

    pub fn note_pdf_payload_progress(&self, task_id: &str, received_bytes: u64) {
        if let Ok(mut session) = self.session.lock() {
            if let Some(pending) = session.pending.as_mut() {
                if pending.task_id == task_id {
                    if let Some(payload) = pending.pdf_payload.as_mut() {
                        payload.received_bytes = received_bytes;
                    }
                }
            }
        }
    }

    pub fn finish_pdf_payload(&self, task_id: &str, result: Result<u64, String>) {
        if let Ok(mut session) = self.session.lock() {
            if let Some(pending) = session.pending.as_mut() {
                if pending.task_id == task_id {
                    if let Some(payload) = pending.pdf_payload.as_mut() {
                        match result {
                            Ok(bytes) => {
                                payload.received_bytes = bytes;
                                payload.complete = bytes > 0;
                                payload.error = None;
                            }
                            Err(error) => {
                                payload.complete = false;
                                payload.error = Some(error);
                            }
                        }
                    }
                }
            }
        }
    }

    /// 供响应层拿「当前是否需要一个 PDF 载荷」以及载荷暂存路径。
    ///
    /// 载荷**不与下载共用文件**：下载路径写 `temp_path`，响应层写 `*.payload.pdf`。
    /// 两个写入者共用一个文件会在「响应既是文档体又触发下载事件」时互相截断，
    /// 归档出一个损坏的 PDF；分成两个文件后两条路互不影响。
    fn pending_pdf_target(&self) -> Option<(String, PathBuf)> {
        let session = self.session.lock().ok()?;
        let pending = session.pending.as_ref()?;
        if pending.kind != "pdf" {
            return None;
        }
        Some((
            pending.task_id.clone(),
            pdf_payload_path(&pending.temp_path),
        ))
    }

    /// PDF 载荷是否已完整落盘（C1/R2.2）。
    pub fn pdf_payload_ready(&self, task_id: &str) -> Option<PathBuf> {
        let session = self.session.lock().ok()?;
        let pending = session.pending.as_ref()?;
        if pending.task_id != task_id {
            return None;
        }
        let payload = pending.pdf_payload.as_ref()?;
        (payload.complete && payload.received_bytes > 0).then(|| payload.path.clone())
    }

    /// PDF 载荷的接收进度：`(是否完整, 已收字节, 错误)`。
    ///
    /// `None` 表示这个任务还没有任何载荷。保存类操作靠它区分「还没开始」与
    /// 「正在收」，而不是两者都当成「再等等」。
    #[allow(dead_code)]
    pub fn pdf_payload_progress(&self, task_id: &str) -> Option<(bool, u64, Option<String>)> {
        let session = self.session.lock().ok()?;
        let pending = session.pending.as_ref()?;
        if pending.task_id != task_id {
            return None;
        }
        let payload = pending.pdf_payload.as_ref()?;
        Some((payload.complete, payload.received_bytes, payload.error.clone()))
    }

    /// 当前捕获的世代号（C4：终态等待按世代对齐，避免读到上一次的结果）。
    #[allow(dead_code)]
    pub fn pending_generation(&self, task_id: &str) -> Option<u64> {
        let session = self.session.lock().ok()?;
        let pending = session.pending.as_ref()?;
        (pending.task_id == task_id).then_some(pending.generation)
    }

    /// 把响应层落盘的 PDF 载荷交给归档流程（C1）。
    ///
    /// 与 `begin_upload` 的区别：这条路是「保存原生 PDF」，所以同时把阶段标成
    /// `saving`，小球与状态工具才会显示「正在保存/归档」。
    #[allow(dead_code)]
    pub fn begin_native_upload(&self, task_id: &str, path: &Path) -> Option<PendingUpload> {
        let Ok(mut session) = self.session.lock() else {
            return None;
        };
        let pending = session.pending.as_ref()?;
        let owned_by_task = pending.temp_path == path
            || pending
                .pdf_payload
                .as_ref()
                .map(|payload| payload.path == path)
                .unwrap_or(false);
        if pending.task_id != task_id || !owned_by_task || pending.expires_at <= Instant::now() {
            return None;
        }
        let upload = PendingUpload {
            generation: pending.generation,
            task_id: pending.task_id.clone(),
            kind: pending.kind.clone(),
            upload_url: pending.upload_url.clone(),
            path: path.to_path_buf(),
        };
        if let Some(pending) = session.pending.as_mut() {
            pending.native_saving = true;
            pending.automation_stage = "saving".to_string();
            if pending.download_started_at.is_none() {
                pending.download_started_at = Some(Instant::now());
            }
        }
        session.state = WebVpnSessionState::Uploading;
        session.last_error = None;
        Some(upload)
    }

    fn fail_pending_download(&self, message: &str) {
        let pending = {
            let Ok(mut session) = self.session.lock() else {
                return;
            };
            let pending = session.pending.take();
            if let Some(ref pending) = pending {
                // C4/C3：失败也是终态，必须能被等待方读到，并如实记录交还原因。
                session.last_outcome = Some(CaptureOutcome {
                    generation: pending.generation,
                    ok: false,
                    path: Some(pending.temp_path.clone()),
                    bytes: fs::metadata(&pending.temp_path).ok().map(|meta| meta.len()),
                    sha256: None,
                    error: Some(message.to_string()),
                });
                session.last_pending_task_id = Some(pending.task_id.clone());
                session.release_reason = Some(message.to_string());
                session.progress_sample = None;
                session.capture_notice = Some(CaptureNotice {
                    kind: pending.kind.clone(),
                    phase: "error",
                    expires_at: Instant::now() + Duration::from_secs(30 * 60),
                });
            }
            let had_pending = pending.is_some();
            if had_pending {
                session.state = WebVpnSessionState::Error;
                session.last_error = Some(message.to_string());
            }
            pending
        };
        if let Some(pending) = pending.as_ref() {
            Self::remove_pending_files(pending);
        }
    }

    /// 覆盖队列快照。调用方已做长度/字段清洗，这里只负责落库。
    pub fn set_capture_queue(&self, entries: Vec<CaptureQueueEntry>) {
        if let Ok(mut session) = self.session.lock() {
            session.capture_queue = entries;
        }
    }

    /// 该 id 是否在当前队列快照里（小球发来的删除请求必须据此校验，页面不可信）。
    pub fn queue_contains(&self, task_id: &str) -> bool {
        self.session
            .lock()
            .map(|session| session.capture_queue.iter().any(|entry| entry.id == task_id))
            .unwrap_or(false)
    }

    /// 清掉完成/失败提示（小球上的"关闭"按钮）。
    pub fn dismiss_capture_notice(&self) {
        if let Ok(mut session) = self.session.lock() {
            session.capture_notice = None;
        }
    }

    pub fn cancel_capture(&self, task_id: &str) -> Result<(), String> {
        let Ok(mut session) = self.session.lock() else {
            return Err("WebVPN 状态不可用".to_string());
        };
        // 先把需要的字段取出来，再改 session：同一个不可变借用里改 `session.pending`
        // 会被借用检查器拒绝，而先克隆代价只有一个小结构体。
        let facts = session.pending.as_ref().map(|pending| {
            (
                pending.task_id.clone(),
                pending.generation,
                pending.temp_path.clone(),
            )
        });
        if let Some((pending_task, generation, path)) = facts {
            if pending_task != task_id {
                return Err("当前 WebVPN 捕获任务与请求不匹配".to_string());
            }
            // C3/C4：取消也是终态，并把交还原因写清楚（上层据此显示「已取消」而不是
            // 把任务当成「还在排队」）。
            session.last_outcome = Some(CaptureOutcome {
                generation,
                ok: false,
                path: Some(path.clone()),
                bytes: fs::metadata(&path).ok().map(|meta| meta.len()),
                sha256: None,
                error: Some("捕获任务已被取消".to_string()),
            });
            session.last_pending_task_id = Some(pending_task);
            session.release_reason = Some("捕获任务已被取消".to_string());
            session.progress_sample = None;
            session.pending = None;
            session.capture_notice = None;
            session.state = WebVpnSessionState::Ready;
            session.last_error = None;
            let _ = fs::remove_file(&path);
            let _ = fs::remove_file(pdf_payload_path(&path));
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
        let queue: Vec<serde_json::Value> = session
            .capture_queue
            .iter()
            .map(|entry| {
                serde_json::json!({
                    "id": entry.id,
                    "kind": entry.kind,
                    "status": entry.status,
                    "requestedBy": entry.requested_by,
                    "ballPhase": entry.ball_phase,
                    "ballText": entry.ball_text,
                    "ballTone": entry.ball_tone,
                    "ballStalled": entry.ball_stalled,
                    "canRecreate": entry.ball_can_recreate,
                    "canCancel": entry.ball_can_cancel,
                })
            })
            .collect();
        let Some(pending) = session.pending.as_ref() else {
            // 没有在跑的任务：提示保留（小球"下载完就消失"是实测反馈的问题），
            // 只要还有排队任务也不隐藏，便于用户看到队列并逐条删除。
            if let Some(notice) = session
                .capture_notice
                .as_ref()
                .filter(|notice| notice.expires_at > Instant::now())
            {
                return serde_json::json!({
                    "phase": notice.phase,
                    "kind": notice.kind,
                    "queue": queue,
                })
                .to_string();
            }
            if queue.is_empty() {
                return "null".to_string();
            }
            return serde_json::json!({ "phase": "idle", "kind": "", "queue": queue }).to_string();
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
        // C20：当前任务的小球文案直接取插件推导的结果（同一条队列快照里），
        // 壳不再自己按 state 猜一遍，双源矛盾就没有来源了。壳自己的 phase 仅在
        // 客户端还没上报过这条任务时兜底。
        let active = session
            .capture_queue
            .iter()
            .find(|entry| entry.id == pending.task_id)
            .filter(|entry| !entry.ball_text.is_empty());
        let stalled = active.map(|entry| entry.ball_stalled).unwrap_or(false);
        let can_recreate = active.map(|entry| entry.ball_can_recreate).unwrap_or(false);
        let payload_ready = pending
            .pdf_payload
            .as_ref()
            .map(|payload| payload.complete && payload.received_bytes > 0)
            .unwrap_or(false);
        serde_json::json!({
            "phase": active.map(|entry| entry.ball_phase.as_str()).filter(|phase| !phase.is_empty()).unwrap_or(phase),
            "kind": pending.kind,
            "bytes": bytes,
            "queue": queue,
            "pendingId": pending.task_id,
            "ballText": active.map(|entry| entry.ball_text.clone()),
            "ballTone": active.map(|entry| entry.ball_tone.clone()),
            "stalled": stalled,
            "canRecreate": can_recreate,
            "canCancel": active.map(|entry| entry.ball_can_cancel).unwrap_or(true),
            "payloadReady": payload_ready,
        })
        .to_string()
    }

    /// 清掉一个捕获任务的全部落盘文件（下载目标 + 响应层载荷）。
    fn remove_pending_files(pending: &PendingCapture) {
        let _ = fs::remove_file(&pending.temp_path);
        if let Some(payload) = pending.pdf_payload.as_ref() {
            let _ = fs::remove_file(&payload.path);
        }
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
                capture_queue: session.capture_queue.clone(),
                page: session.page.clone(),
                last_pending_task_id: session.last_pending_task_id.clone(),
                release_reason: session.release_reason.clone(),
                taken_over_at: session.taken_over_at.clone(),
                last_outcome: session.last_outcome.clone(),
                progress_sample: session.progress_sample.clone(),
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
        // C17：停滞检测。下载/保存期间字节数长时间不动，就该显示成异常，
        // 而不是永远「正在保存」。
        let stalled_ms = self.stalled_ms_now(downloaded_bytes);
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
            max_capture_bytes: CAPTURE_MAX_BYTES,
            window_open,
            sidebar_visible: window_open && session.sidebar_visible,
            probe_available: Self::probe_available(),
            // 页面级事实（C2）。URL 走既有脱敏规则：票据类参数一律剥掉，
            // 但 DOI / ?download=true 这类业务参数必须留下，否则上层无法判别入口。
            page_url: session.page.as_ref().map(|page| redact_for_log(&page.url)),
            document_type: session.page.as_ref().and_then(|page| page.document_type.clone()),
            http_status: session.page.as_ref().and_then(|page| page.http_status),
            ready_state: session.page.as_ref().map(|page| page.ready_state.clone()),
            page_seq: session.page.as_ref().map(|page| page.seq).unwrap_or(0),
            content_length: session.page.as_ref().and_then(|page| page.content_length),
            pdf_payload: session
                .pending
                .as_ref()
                .and_then(|pending| pending.pdf_payload.as_ref())
                .map(|payload| PdfPayloadStatus {
                    ready: payload.complete && payload.received_bytes > 0,
                    complete: payload.complete,
                    content_length: payload.content_length,
                    received_bytes: payload.received_bytes,
                    error: payload.error.clone(),
                }),
            last_pending_task_id: session.last_pending_task_id,
            release_reason: session.release_reason,
            taken_over_at: session.taken_over_at,
            stalled_ms,
        }
    }

    /// 下载/保存期间「无字节增长」的毫秒数（C17）。非长耗时阶段返回 None。
    fn stalled_ms_now(&self, downloaded_bytes: Option<u64>) -> Option<u64> {
        let Ok(mut session) = self.session.lock() else {
            return None;
        };
        if !matches!(session.state, WebVpnSessionState::Downloading)
            && !matches!(session.state, WebVpnSessionState::Uploading)
        {
            session.progress_sample = None;
            return None;
        }
        let bytes = downloaded_bytes.unwrap_or(0);
        let unchanged_since = session
            .progress_sample
            .as_ref()
            .filter(|sample| sample.bytes == bytes)
            .map(|sample| sample.at);
        let Some(unchanged_since) = unchanged_since else {
            session.progress_sample = Some(ProgressSample {
                bytes,
                at: Instant::now(),
            });
            return Some(0);
        };
        Some(unchanged_since.elapsed().as_millis().min(u128::from(u64::MAX)) as u64)
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

/// 文件的 SHA-256（C4/R5.2：产物的可核验信息）。读不到就返回 None，不伪造。
fn sha256_of_file(path: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    let body = fs::read(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(&body);
    Some(hex_bytes(&hasher.finalize()))
}

/// 当前时间的 ISO-8601（UTC）表示。只用于「何时接管」这类展示字段，
/// 不引入额外的时间依赖：由 Unix 秒做 civil-from-days 换算。
fn now_rfc3339() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    // Howard Hinnant 的 civil_from_days：把「距 1970-01-01 的天数」换成公历日期。
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

/// 从 URL/响应头推断文档类型（C2）。
fn document_type_for(url: &str, known: Option<String>) -> Option<String> {
    if let Some(known) = known.filter(|value| !value.is_empty()) {
        return Some(known);
    }
    match url::Url::parse(url) {
        Ok(parsed) => {
            if is_pdf_document_url(&parsed) {
                Some("application/pdf".to_string())
            } else {
                Some("text/html".to_string())
            }
        }
        Err(_) => None,
    }
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

/// 响应层 PDF 载荷的暂存路径（与下载目标同目录、不同文件）。
///
/// 分开是必须的：`DownloadEvent::Requested` 把同一个 `temp_path` 交给 WebView2 写，
/// 如果响应层也往它里面写，两个写入者会互相截断，最后归档出一个损坏的 PDF。
fn pdf_payload_path(temp_path: &Path) -> PathBuf {
    let stem = temp_path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "capture".to_string());
    temp_path.with_file_name(format!("{stem}.payload.pdf"))
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

/// 等文件真正落盘再读。
///
/// WebView2 报下载完成后，文件仍可能由下载进程延迟写出——紧接着 `fs::read` 会得到
/// `系统找不到指定的文件 (os error 2)`，整次捕获因此失败（2026-09-26 实测）。
/// 这里按**存在性**轮询而不是固定 sleep：文件一出现就读，正常路径不引入额外延时。
fn read_captured_file(path: &Path) -> Result<Vec<u8>, String> {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        match fs::read(path) {
            Ok(body) => return Ok(body),
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound && Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(format!("无法读取 WebVPN 下载文件: {error}")),
        }
    }
}

pub fn upload_capture(app: AppHandle, upload: PendingUpload) {
    let body = read_captured_file(&upload.path);
    // 归档成功后临时文件会被删除，尺寸必须现在量（R5.2：产物要可核验）。
    let measured_bytes = body.as_ref().ok().map(|body| body.len() as u64);
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
        state.finish_upload(upload.generation, outcome, measured_bytes);
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


/// 安装「页面事件 + 响应层」观察器（C1/C2）。
///
/// 两个能力共用同一套 WebView2 事件：
///   * `SourceChanged` / `NavigationCompleted` → 页面级事实（url/readyState），
///     让上层的 `wait` 能把「页面跳了」当成状态变化；
///   * `WebResourceResponseReceived` → 主文档的 content-type/content-length，
///     以及 `application/pdf` 的**响应体**。拿到响应体才谈得上「PDF 载荷就绪」，
///     也才能不依赖查看器的「另存为」界面完成归档。
///
/// 这里只消费 WebView2 自己那次请求的响应；**不读、不导出、不缓存任何 Cookie**，
/// 认证材料始终留在 WebView2 profile 内（见文件头纪律）。
#[cfg(windows)]
pub fn install_capture_observers(webview: &Webview, app: &AppHandle) -> Result<(), String> {
    let events_app = app.clone();
    let response_app = app.clone();
    webview
        .with_webview(move |platform| {
            let core = match unsafe { platform.controller().CoreWebView2() } {
                Ok(core) => core,
                Err(_) => return,
            };
            let source_app = events_app.clone();
            let source = SourceChangedEventHandler::create(Box::new(move |_sender, _args| {
                note_page_event(&source_app, "loading");
                Ok(())
            }));
            let mut source_token = 0_i64;
            let _ = unsafe { core.add_SourceChanged(&source, &mut source_token) };

            let navigation_app = events_app.clone();
            let navigation = NavigationCompletedEventHandler::create(Box::new(move |_sender, args| {
                let success = args
                    .as_ref()
                    .and_then(|args| {
                        let mut success = BOOL::default();
                        unsafe { args.IsSuccess(&mut success) }.ok()?;
                        Some(success.as_bool())
                    })
                    .unwrap_or(false);
                note_page_event(&navigation_app, if success { "complete" } else { "failed" });
                Ok(())
            }));
            let mut navigation_token = 0_i64;
            let _ = unsafe { core.add_NavigationCompleted(&navigation, &mut navigation_token) };

            let Ok(core2) = core.cast::<ICoreWebView2_2>() else {
                return;
            };
            let response = WebResourceResponseReceivedEventHandler::create(Box::new(move |_sender, args| {
                if let Some(args) = args {
                    handle_response_received(&response_app, &args);
                }
                Ok(())
            }));
            let mut response_token = 0_i64;
            let _ = unsafe { core2.add_WebResourceResponseReceived(&response, &mut response_token) };
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
pub fn install_capture_observers(_webview: &Webview, _app: &AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn note_page_event(app: &AppHandle, ready_state: &str) {
    let Some(webview) = app.get_webview(WINDOW_LABEL) else {
        return;
    };
    let Ok(url) = webview.url() else {
        return;
    };
    if let Some(state) = app.try_state::<WebVpnState>() {
        state.record_page_event(url.as_str(), ready_state);
    }
    // 刻意不在这里 push 小球：页面事件只更新事实，客户端 1.8 秒的轮询会取走它。
    // 在 WebView2 事件回调里多做一次 eval 只会增加白屏风险，换不来任何信息。
}

#[cfg(windows)]
fn handle_response_received(
    app: &AppHandle,
    args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebResourceResponseReceivedEventArgs,
) {
    let Some(state) = app.try_state::<WebVpnState>() else {
        return;
    };
    let Ok(request) = (unsafe { args.Request() }) else {
        return;
    };
    let mut uri = PWSTR::null();
    if unsafe { request.Uri(&mut uri) }.is_err() {
        return;
    }
    let url = take_pwstr(uri);
    let Ok(response) = (unsafe { args.Response() }) else {
        return;
    };
    let content_type = response_header(&response, "content-type");
    let content_length = response_header(&response, "content-length")
        .and_then(|value| value.trim().parse::<u64>().ok());
    // 附件型响应（Content-Disposition: attachment）会走 WebView2 的下载事件，
    // 那条路已经拥有暂存文件；响应层不要同时插手。
    let attachment = response_header(&response, "content-disposition")
        .map(|value| value.to_ascii_lowercase().contains("attachment"))
        .unwrap_or(false);
    let status = {
        let mut code = 0_i32;
        let _ = unsafe { response.StatusCode(&mut code) };
        (code > 0).then_some(code as u16)
    };
    // 主文档的响应头 → 页面级事实（C2）。
    let lowered = content_type
        .as_deref()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if lowered.contains("text/html") || lowered.contains("application/pdf") {
        state.record_document_response(&url, content_type.as_deref(), content_length, status);
    }
    if !lowered.contains("application/pdf") || attachment {
        return;
    }
    let Some((task_id, path)) = state.pending_pdf_target() else {
        return;
    };
    if !state.begin_pdf_payload(&task_id, path.clone(), content_length) {
        return;
    }
    let payload_app = app.clone();
    let payload_task = task_id.clone();
    let payload_path = path.clone();
    let content = WebResourceResponseViewGetContentCompletedHandler::create(Box::new(
        move |error, stream| {
            let Some(stream) = stream.filter(|_| error.is_ok()) else {
                // 第一个参数在 webview2-com 的封装里已经是 Result<()>，不是裸 HRESULT。
                let code = error
                    .as_ref()
                    .err()
                    .map(|error| error.code().0 as u32)
                    .unwrap_or(0);
                if let Some(state) = payload_app.try_state::<WebVpnState>() {
                    state.finish_pdf_payload(
                        &payload_task,
                        Err(format!("WebView2 未提供 PDF 响应体（0x{code:08X}）")),
                    );
                }
                return Ok(());
            };
            // 就地读取，不丢到别的线程：`IStream` 不是 Send（内部是裸指针），
            // 而 `GetContent` 的回调只在响应体**已经收完**之后才触发，所以这里
            // 读的是本地内存/临时文件，不是网络；再叠加 CAPTURE_MAX_BYTES 上限，
            // 阻塞时间是可控的。
            let result = write_stream_to_file(&stream, &payload_path, &payload_task, &payload_app);
            if let Some(state) = payload_app.try_state::<WebVpnState>() {
                state.finish_pdf_payload(&payload_task, result);
            }
            Ok(())
        },
    ));
    let _ = unsafe { response.GetContent(&content) };
}

#[cfg(windows)]
fn response_header(
    response: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebResourceResponseView,
    name: &str,
) -> Option<String> {
    let headers = unsafe { response.Headers() }.ok()?;
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let mut value = PWSTR::null();
    unsafe { headers.GetHeader(PCWSTR(wide.as_ptr()), &mut value) }.ok()?;
    let text = take_pwstr(value);
    (!text.is_empty()).then_some(text)
}

/// 把 WebView2 给的响应体流写到本任务的暂存路径（C1）。
///
/// 与上传端同一条判据（只认 `%PDF-`），并且受 `CAPTURE_MAX_BYTES` 约束：
/// 超过上限立刻中止并如实报错，而不是先写满磁盘再在 413 上失败。
#[cfg(windows)]
fn write_stream_to_file(
    stream: &IStream,
    path: &Path,
    task_id: &str,
    app: &AppHandle,
) -> Result<u64, String> {
    let limit = CAPTURE_MAX_BYTES;
    let mut buffer: Vec<u8> = Vec::new();
    let mut chunk = vec![0_u8; 64 * 1024];
    loop {
        let mut read: u32 = 0;
        let hr = unsafe {
            stream.Read(
                chunk.as_mut_ptr() as *mut core::ffi::c_void,
                chunk.len() as u32,
                Some(&mut read),
            )
        };
        if hr.is_err() {
            return Err(format!("读取 PDF 响应体失败（0x{:08X}）", hr.0 as u32));
        }
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read as usize]);
        if buffer.len() as u64 > limit {
            return Err(format!(
                "PDF 超过 {} MB 捕获上限，已中止保存",
                limit / 1024 / 1024
            ));
        }
        if let Some(state) = app.try_state::<WebVpnState>() {
            state.note_pdf_payload_progress(task_id, buffer.len() as u64);
        }
    }
    if buffer.is_empty() {
        return Err("PDF 响应体为空，未保存任何内容".to_string());
    }
    fs::write(path, &buffer).map_err(|error| format!("写入 PDF 暂存文件失败: {error}"))?;
    Ok(buffer.len() as u64)
}

#[cfg(windows)]
async fn save_current_pdf(
    app: &AppHandle,
    task_id: &str,
    webview: &Webview,
) -> Result<serde_json::Value, String> {
    let state = app.try_state::<WebVpnState>().ok_or("文献浏览器状态不可用")?;
    // C1/R5.1：优先用**响应层已经落盘的载荷**归档。这条路不依赖 PDF 查看器的
    // 「另存为」界面，也不读、不导出任何 Cookie —— 字节是 WebView2 自己那次请求
    // 的响应体，我们只是把它写到本任务的暂存路径上。
    // 快速失败：既不在 PDF 上、也没有任何载荷时，等 45 秒再报错毫无意义。
    let is_pdf_document = webview
        .url()
        .ok()
        .map(|url| is_pdf_document_url(&url))
        .unwrap_or(false);
    if !is_pdf_document && state.pdf_payload_progress(task_id).is_none() {
        return Err(
            "当前文档不是原生 PDF，也没有取到 PDF 字节流；请先进入正文 PDF，或改用带 ?download=true 的下载入口重新进入"
                .to_string(),
        );
    }
    let deadline = Instant::now() + Duration::from_secs(45);
    let mut reissued = false;
    loop {
        if let Some(path) = state.pdf_payload_ready(task_id) {
            return finalize_native_save(app, &state, task_id, &path, webview).await;
        }
        match state.pdf_payload_progress(task_id) {
            // 载荷正在接收：等它写完。
            Some((false, _received, None)) => {
                if Instant::now() >= deadline {
                    break;
                }
                sleep_ms(200).await;
            }
            Some((false, _received, Some(error))) => {
                record(app, "automation", "", &format!("PDF 载荷捕获失败: {error}"));
                break;
            }
            _ => {
                if reissued {
                    break;
                }
                // 还没有载荷：用同一个 WebView2 会话重新请求这个 PDF，让响应层再拿到
                // 一次响应体。认证材料由浏览器引擎自己带着。
                let target = webview.url().ok().filter(is_pdf_document_url);
                let Some(target) = target else { break };
                reissued = true;
                if let Err(error) = webview.navigate(target) {
                    record(app, "automation", "", &format!("重新请求 PDF 失败: {error}"));
                    break;
                }
                sleep_ms(600).await;
            }
        }
    }
    // 响应层拿不到载荷：退回查看器的「另存为」老机制，但**仍然等到终态**，
    // 绝不再返回 {started:true} 之后失联（现场静默卡死就是这个形状）。
    save_pdf_via_viewer(app, &state, task_id, webview).await
}

#[cfg(windows)]
async fn sleep_ms(milliseconds: u64) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_millis(milliseconds))
    })
    .await;
}

/// 把已经落盘的 PDF 载荷归档到课题，并等到终态（C4）。
#[cfg(windows)]
async fn finalize_native_save(
    app: &AppHandle,
    state: &WebVpnState,
    task_id: &str,
    path: &Path,
    webview: &Webview,
) -> Result<serde_json::Value, String> {
    // 不允许把 HTML 冒充原文：与上传端同一判据，只认 %PDF-。
    let head = fs::read(path).map_err(|error| format!("无法读取已落盘的 PDF: {error}"))?;
    if !head.starts_with(b"%PDF-") {
        let reason = "响应体不是 PDF（页面可能只是 HTML 预览），不能作为原文归档".to_string();
        state.fail_pending_download(&reason);
        return Err(reason);
    }
    let bytes = head.len() as u64;
    let sha256 = sha256_of_file(path);
    let generation = state
        .pending_generation(task_id)
        .ok_or("当前文献任务已经结束，无法归档")?;
    let upload = state
        .begin_native_upload(task_id, path)
        .ok_or("当前文献任务不允许归档该文件")?;
    let upload_app = app.clone();
    std::thread::spawn(move || upload_capture(upload_app, upload));
    let _ = push_capture_ball(app, webview);
    let wait_app = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        wait_app
            .try_state::<WebVpnState>()
            .and_then(|state| state.wait_for_outcome(generation, Duration::from_secs(100)))
    })
    .await
    .map_err(|error| error.to_string())?;
    match outcome {
        Some(outcome) if outcome.ok => Ok(serde_json::json!({
            "status": "completed",
            "phase": "completed",
            "path": path.to_string_lossy().to_string(),
            "bytes": bytes,
            "sha256": sha256,
        })),
        Some(outcome) => Err(outcome.error.unwrap_or_else(|| "归档失败".to_string())),
        None => Err(format!(
            "归档未在时限内完成（已取到 {bytes} 字节的 PDF）；可用 lab_publisher_browser_download_status 查看任务状态"
        )),
    }
}

/// 查看器「另存为」兜底（老机制），同样等到终态才返回（C4）。
#[cfg(windows)]
async fn save_pdf_via_viewer(
    app: &AppHandle,
    state: &WebVpnState,
    task_id: &str,
    webview: &Webview,
) -> Result<serde_json::Value, String> {
    let is_pdf = webview.url().ok().map(|url| is_pdf_document_url(&url)).unwrap_or(false);
    if !is_pdf {
        return Err(
            "当前文档不是原生 PDF，也没有取到 PDF 字节流；请改用带 ?download=true 的下载入口重新进入".to_string(),
        );
    }
    let destination = state.claim_native_save_destination(task_id)?;
    let generation = state.pending_generation(task_id).ok_or("当前文献任务已经结束")?;
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
                    state.fail_pending_download("原生 PDF 保存未完成；请改用带 ?download=true 的下载入口重试");
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
    let wait_app = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        wait_app
            .try_state::<WebVpnState>()
            .and_then(|state| state.wait_for_outcome(generation, Duration::from_secs(100)))
    })
    .await
    .map_err(|error| error.to_string())?;
    match outcome {
        Some(outcome) if outcome.ok => Ok(serde_json::json!({
            "status": "completed",
            "phase": "completed",
            "path": outcome.path.map(|path| path.to_string_lossy().to_string()),
            "bytes": outcome.bytes,
            "sha256": outcome.sha256,
        })),
        Some(outcome) => Err(outcome.error.unwrap_or_else(|| "原生 PDF 保存失败".to_string())),
        None => Err("原生 PDF 保存未在时限内完成；可用 lab_publisher_browser_download_status 查看任务状态".to_string()),
    }
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
    scope: &str,
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
                    AGENT_OBSERVE_SCRIPT
                        .replace("__OBSERVE_SCOPE__", if scope == "download" { "'download'" } else { "'all'" })
                        .to_string()
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
                let _ = (webview, observation_id, element_id, scope);
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

/// 侧栏已打开时把最新状态推给捕获小球；没打开就什么也不做。
pub fn push_capture_ball_if_open(app: &AppHandle) {
    if let Some(webview) = app.get_webview(WINDOW_LABEL) {
        let _ = push_capture_ball(app, &webview);
    }
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

/// 处理文献载体页面发回的内部命令（`ibm-webvpn://…`）。
///
/// 返回 `true` 表示这条 URL 是一条内部命令并已处理，调用方必须拒绝这次导航/弹窗。
///
/// **页面绝不能再用 `location.href` 发这些命令**：在 WebView2 里那是一次真实导航，
/// 会把正在加载的出版社页面打成"JS 还活着、却一个像素都不画"的白屏，注入的工具栏
/// 也一起消失（2026-09-25 science.org 实测：document 是真的文章页、标题正确、脚本
/// 照常执行，可表面就是纯白）。所以页面改用 `window.open`，命令经 `on_new_window`
/// 到达这里；`on_navigation` 仍调用同一实现，作为其它路径的兜底。
fn handle_internal_command(app: &AppHandle, url: &url::Url) -> bool {
    if url.scheme() != "ibm-webvpn" {
        return false;
    }
    if url.host_str() == Some("session") && url.path() == "/ready" {
        if let Some(state) = app.try_state::<WebVpnState>() {
            state.mark_authenticated();
        }
        record(app, "session", "", "已识别登录后的 WebVPN 门户");
        return true;
    }
    if url.host_str() == Some("cancel-capture") {
        // 与 close 同理：不在回调栈里销毁自身，调度到主线程的下一拍。
        let scheduled_app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(10));
            let action_app = scheduled_app.clone();
            let _ = scheduled_app.run_on_main_thread(move || {
                let _ = cancel_capture_and_close(&action_app, None);
            });
        });
        record(app, "capture", "", "用户从捕获小球终止了本次捕获");
        return true;
    }
    if url.host_str() == Some("close") {
        // 避免在 WebView 回调栈中直接隐藏自身；调度到主线程的下一拍。
        let scheduled_app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(10));
            let action_app = scheduled_app.clone();
            let _ = scheduled_app.run_on_main_thread(move || {
                let _ = hide_sidebar(&action_app);
            });
        });
        return true;
    }
    if url.host_str() == Some("offset-reverted") {
        // 页面位移的看门狗判定白屏并自行撤销（见 WEBVPN_CHROME_SCRIPT）。
        record(
            app,
            "offset",
            "",
            "页面疑似被整屏固定遮罩盖住，已自动撤销 html 位移",
        );
        return true;
    }
    if url.host_str() == Some("cancel-task") {
        // 小球上的逐条删除。页面是远端内容、不可信：只接受**当前队列快照里存在**的 id，
        // 其余一律忽略；真正的取消由插件执行，这里只负责转交给客户端。
        let task_id = url.path().trim_matches('/').to_string();
        if task_id.is_empty() || !app.try_state::<WebVpnState>().map(|state| state.queue_contains(&task_id)).unwrap_or(false) {
            return true;
        }
        record(app, "capture", "", "用户从捕获小球请求删除队列中的任务");
        if let Some(main) = app.get_webview(MAIN_WINDOW_LABEL) {
            let script = format!(
                "window.__ibmBallCancelTask && window.__ibmBallCancelTask({})",
                serde_json::to_string(&task_id).unwrap_or_else(|_| "\"\"".to_string())
            );
            let _ = main.eval(script);
        }
        return true;
    }
    if url.host_str() == Some("recreate-task") {
        // 小球上的「重建任务」（C19）。与逐条删除同理：页面不可信，只接受当前
        // 队列快照里存在的 id；真正的重建由插件执行，这里只转交给客户端。
        let task_id = url.path().trim_matches('/').to_string();
        if task_id.is_empty() || !app.try_state::<WebVpnState>().map(|state| state.queue_contains(&task_id)).unwrap_or(false) {
            return true;
        }
        record(app, "capture", "", "用户从捕获小球请求重建该项获取任务");
        if let Some(main) = app.get_webview(MAIN_WINDOW_LABEL) {
            let script = format!(
                "window.__ibmBallRecreateTask && window.__ibmBallRecreateTask({})",
                serde_json::to_string(&task_id).unwrap_or_else(|_| "\"\"".to_string())
            );
            let _ = main.eval(script);
        }
        return true;
    }
    if url.host_str() == Some("notice-dismiss") {
        if let Some(state) = app.try_state::<WebVpnState>() {
            state.dismiss_capture_notice();
        }
        if let Some(webview) = app.get_webview(WINDOW_LABEL) {
            let _ = push_capture_ball(app, &webview);
        }
        return true;
    }
    if url.host_str() == Some("automation") {
        let result = url.path().trim_matches('/');
        let stage = match result {
            "searching" => Some("searching"),
            "clicked" => Some("clicked"),
            "si-manual" | "pdf-manual" => Some("manual"),
            "challenge" => Some("verification"),
            _ => None,
        };
        if let Some(stage) = stage {
            if let Some(state) = app.try_state::<WebVpnState>() {
                state.set_automation_stage(stage);
            }
            if let Some(webview) = app.get_webview(WINDOW_LABEL) {
                let _ = push_capture_ball(app, &webview);
            }
        }
        // `pdf-manual` 只代表扫描若干轮没找到入口——它并不证明页面是预览器。
        // 页面位移只对「整屏 fixed 的预览器/原生 PDF 查看器」有意义，据此给
        // 普通文章页加 transform 正是两次白屏的成因（2026-09-23 ScienceDirect、
        // 2026-09-25 science.org），所以这里要求正向证据：只有顶层文档确实
        // 是 PDF 才开位移，否则只如实报告"没找到入口"。
        if result == "pdf-manual" {
            let pdf_document = app
                .get_webview(WINDOW_LABEL)
                .and_then(|webview| webview.url().ok())
                .map(|url| is_pdf_document_url(&url))
                .unwrap_or(false);
            if pdf_document {
                if let Some(webview) = app.get_webview(WINDOW_LABEL) {
                    let _ = webview.eval(
                        "window.__ibmWebVpnSetPageOffset && window.__ibmWebVpnSetPageOffset(true)",
                    );
                }
                record(
                    app,
                    "automation",
                    "",
                    "已进入 PDF 预览器并保持捕获；可手动点击右上角保存",
                );
            } else {
                record(
                    app,
                    "automation",
                    "",
                    "未能自动识别正文下载入口；捕获仍有效，请在页面中手动打开并保存",
                );
            }
            return true;
        }
        if result == "si-manual" {
            record(
                app,
                "automation",
                "",
                "自动入口暂未识别，捕获任务保持有效；可在页面手动点击补充材料",
            );
            return true;
        }
        if result == "challenge" {
            let message = "出版社页面正在验证访问；捕获有效，通过后自动继续查找入口";
            record(app, "automation", "", message);
        }
        return true;
    }
    false
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
                let pdf_document = webview
                    .url()
                    .map(|url| is_pdf_document_url(&url))
                    .unwrap_or(false);
                if pdf_document {
                    // 原生 PDF 查看器**不是网页 DOM**：注入的工具栏不会执行，页面上也
                    // 没有可点的元素。必须把阶段切到 manual，让状态工具返回
                    // nextAction=observe-or-save-pdf，Agent 才会去调
                    // lab_browser_save_current_pdf（内部用 ShowSaveAsUI +
                    // SetSuppressDefaultDialog 直接存到归档路径，不弹对话框）。
                    // 少了这一步，状态会停在 clicked/wait-and-poll，用户只能右键另存。
                    if let Some(state) = page_app.try_state::<WebVpnState>() {
                        state.set_automation_stage("manual");
                    }
                    record(
                        &page_app,
                        "automation",
                        "",
                        "已进入原生 PDF 预览器；可直接调用保存工具归档，无需右键另存",
                    );
                    // 位移：避免查看器自带的保存/下载工具栏被我们的 76px 工具栏盖住。
                    let _ = webview.eval(
                        "window.__ibmWebVpnSetPageOffset && window.__ibmWebVpnSetPageOffset(true)",
                    );
                }
                start_pending_publisher_automation(&page_app, &webview);
                // C2：页面每次加载完成都落一个快照，上层的 wait 才有「页面跳了」
                // 这个信号（旧指纹里导航不改变任何一项，于是永远报「没有变化」）。
                if let Some(state) = page_app.try_state::<WebVpnState>() {
                    if let Ok(url) = webview.url() {
                        // document_type 由 URL 推断；真正的 content-type 会由响应层
                        // 在下一次事件里覆盖它。
                        state.record_page_event(url.as_str(), "complete");
                    }
                }
                // 脚本每次导航都会重新注入，小球随之重建：必须再推一次状态。
                let _ = push_capture_ball(&page_app, &webview);
            }
        })
        .on_navigation(move |url| {
            if handle_internal_command(&navigation_app, &url) {
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
            // 页面用 window.open 送回内部命令（不能用 location.href：那会把正在加载
            // 的出版社页面打成白屏）。命中内部命令就按命令处理，并拒绝这个窗口。
            if handle_internal_command(&window_app, &url) {
                return NewWindowResponse::Deny;
            }
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

    // C1/C2：装上页面事件与响应层观察器。失败不致命（页面事件会退化成只有
    // 「加载完成」一个采样点，PDF 保存会退回查看器兜底），但必须留下记录。
    if let Err(error) = install_capture_observers(&webview, app) {
        record(
            app,
            "error",
            target.as_str(),
            &format!("页面事件观察器安装失败: {error}"),
        );
    }
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
        // 出版社的原生 PDF 端点不以 .pdf 结尾，也必须认出来（Science 实测地址）。
        let science_pdf =
            url::Url::parse("https://www.science.org/doi/pdf/10.1126/science.aeg4791?download=true")
                .unwrap();
        assert!(is_pdf_document_url(&science_pdf));
        let elsevier_pdfft = url::Url::parse("https://www.sciencedirect.com/science/article/pii/S1/pdfft?isDTMRedir=true").unwrap();
        assert!(is_pdf_document_url(&elsevier_pdfft));
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
        assert!(WEBVPN_CHROME_SCRIPT.contains("notifyShell('offset-reverted/')"));
        // 内部命令必须走 window.open；导航会把正在加载的出版社页面打成白屏。
        assert!(!WEBVPN_CHROME_SCRIPT.contains("location.href = 'ibm-webvpn"));
        assert!(!WEBVPN_CHROME_SCRIPT.contains("location.href = `ibm-webvpn"));
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
        state.finish_upload(second_generation.wrapping_add(1), Ok(()), None);
        assert_eq!(state.state(), WebVpnSessionState::Uploading);
        state.finish_upload(second_generation, Ok(()), None);
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
