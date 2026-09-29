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
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
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
    take_pwstr, CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR,
    ExecuteScriptCompletedHandler, NavigationCompletedEventHandler,
    SaveAsUIShowingEventHandler, ShowSaveAsUICompletedHandler,
    SourceChangedEventHandler,
    WebResourceResponseReceivedEventHandler, WebResourceResponseViewGetContentCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_2, ICoreWebView2_25,
        COREWEBVIEW2_SAVE_AS_KIND_DEFAULT, COREWEBVIEW2_SAVE_AS_UI_RESULT_SUCCESS,
    },
};
#[cfg(windows)]
use windows::core::{Interface, PCWSTR, PWSTR};
#[cfg(windows)]
use windows::core::BOOL;
#[cfg(windows)]
use windows::Win32::System::Com::IStream;
#[cfg(windows)]
use windows::Win32::System::Com::Marshal::CoMarshalInterThreadInterfaceInStream;
#[cfg(windows)]
use windows::Win32::System::Com::StructuredStorage::CoGetInterfaceAndReleaseStream;
#[cfg(windows)]
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
#[cfg(windows)]


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
/// 响应体流「多少秒没有新字节」就不再等（之后如实报未收全）。
const PDF_STREAM_STALL_TIMEOUT: Duration = Duration::from_secs(5);
/// 单次载荷读取的总上限，防止一个不结束的流把保存永远挂住。
const PDF_STREAM_MAX_WAIT: Duration = Duration::from_secs(180);
/// 退化成"在 UI 线程上读"时的总上限：宁可少拿一点字节，也不能把界面冻住几分钟。
const INLINE_STREAM_MAX_WAIT: Duration = Duration::from_secs(20);
/// 等下载文件写完的上限（下载事件说 success 时文件可能还在写）。
const CAPTURE_READ_TIMEOUT: Duration = Duration::from_secs(30);
/// 正文 PDF 的最小可信体积（与插件端 `CAPTURE_PDF_MIN_BYTES` 保持一致）。
const CAPTURE_PDF_MIN_BYTES: u64 = 8 * 1024;

/// 注入到 WebVPN 子 WebView 的完整浏览器壳。它不读取 Cookie 或页面正文，只
/// 使用浏览器自己的 history/location 实现地址栏、前进、后退和刷新。
/// 标签切换由 DSH 侧栏负责。页面每次导航后都会重新注入。
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
  const CHROME_HEIGHT = 42;
  /**
   * 页面位移：**只在识别出全屏 PDF 预览器时**才注入。
   *
   * 对 `html` 施加 transform 会让它成为 `position:fixed` 后代的包含块。出版社的
   * HTML PDF 预览器正是 `position:fixed;inset:0` 的整屏容器，不位移就会被我们
   * 导航栏盖住「保存/下载」按钮。
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
  /**
   * 右下角「保存到课题」浮层。与小球同一套机制（壳注入 + 壳推送 + 内部命令），
   * 但它解决的是"人在预览器上够不到保存"这件事：原生 PDF 的查看器 UI 不在文档
   * DOM 里，没有任何可点元素，所以由壳自己给一个按钮。
   *
   * 只在存在 PDF 捕获任务时出现；载荷没被证明收全前它是禁用的（并显示进度），
   * 因此它不可能引诱用户去归档一个还没下完的文件。
   */
  let captureSaveButton = null;
  const mountCaptureSaveButton = () => {
    if (document.getElementById('__ibm_webvpn_save')) return;
    const host = document.createElement('div');
    host.id = '__ibm_webvpn_save';
    // 与小球同一个理由：PDF 预览页会被施加 html transform（见 __ibmWebVpnSetPageOffset），
    // 那会让 position:fixed 的后代改以 html 为包含块，按钮就跟着页面滚走。用 popover 的
    // top layer 跳出来，位置才真的是"相对窗口固定在右下角"。
    const canPopover = typeof host.showPopover === 'function';
    if (canPopover) host.setAttribute('popover', 'manual');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .save{all:initial;box-sizing:border-box;display:block;padding:10px 16px;border-radius:12px;background:#0f172a;color:#f8fafc;font:600 12.5px/1.35 "Segoe UI","Microsoft YaHei",sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.38);cursor:pointer;max-width:280px;text-align:center}
      .save[data-tone="busy"]{background:#1d4ed8;cursor:default}
      .save[data-tone="complete"]{background:#047857;cursor:default}
      .save[data-tone="error"]{background:#b91c1c;cursor:default}
      .save[data-tone="waiting"]{background:#475569;cursor:default}
    </style><button class="save" type="button" data-tone="waiting">保存到课题</button>`;
    const button = root.querySelector('.save');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      // 一次性：点过之后不再放开，避免重复触发第二次归档。
      button.dataset.busy = 'true';
      button.disabled = true;
      button.textContent = '正在下载并归档…';
      button.dataset.tone = 'busy';
      notifyShell('viewer-download/');
    });
    // 定位在右下角：与左下角的小球分开，且避开查看器顶部的工具栏。
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;left:auto;top:auto;margin:0;padding:0;border:0;background:transparent;width:auto;height:auto;max-width:none;max-height:none;overflow:visible;z-index:2147483646;';
    (document.documentElement || document.body).appendChild(host);
    if (canPopover) {
      try { if (!host.matches(':popover-open')) host.showPopover(); } catch { /* 引擎不支持：留在普通层 */ }
    }
    captureSaveButton = button;
  };
  /** 用与小球同一份载荷更新保存按钮；`null`/非 PDF 时隐藏。 */
  const syncCaptureSaveButton = (payload) => {
    const wanted = Boolean(payload) && ['pdf', 'si'].includes(payload.kind)
      && payload.pendingId
      && (payload.documentType === 'application/pdf' || payload.payloadComplete === true)
      && !['completed', 'idle'].includes(payload.phase);
    if (!wanted) {
      if (captureSaveButton) captureSaveButton.parentNode.host.style.display = 'none';
      return;
    }
    if (!captureSaveButton || !captureSaveButton.isConnected) mountCaptureSaveButton();
    if (!captureSaveButton) return;
    const host = captureSaveButton.parentNode.host;
    host.style.display = 'block';
    const bytes = (n) => (Number.isFinite(n) && n > 0 ? (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB') : '');
    const received = Number(payload.downloadBytes) || 0;
    const total = Number(payload.downloadTotalBytes) || 0;
    if (captureSaveButton.dataset.busy === 'true') {
      // 已经点过了：只更新进度文案，绝不重新启用。
      captureSaveButton.disabled = true;
      captureSaveButton.dataset.tone = 'busy';
      captureSaveButton.textContent = payload.phase === 'uploading' ? '正在归档到课题…'
        : `正在下载 ${bytes(received) || '0 KB'}${total > 0 ? ' / ' + bytes(total) : '（总量未知）'}…`;
      return;
    }
    if (payload.phase === 'uploading' || payload.phase === 'saving') {
      captureSaveButton.disabled = true;
      captureSaveButton.dataset.tone = 'busy';
      captureSaveButton.textContent = '正在归档到课题…';
    } else if (payload.documentType === 'application/pdf' || payload.payloadComplete === true) {
      captureSaveButton.disabled = false;
      captureSaveButton.dataset.tone = '';
      captureSaveButton.textContent = '下载并归档 PDF';
    } else {
      captureSaveButton.disabled = true;
      captureSaveButton.dataset.tone = 'waiting';
      captureSaveButton.textContent = '请点击页面的 Download PDF';
    }
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
      syncCaptureSaveButton(null);
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
    syncCaptureSaveButton(payload);
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
      .shell{height:42px;background:#fff;color:#202124;border-bottom:1px solid #e4e7eb;font:13px/1.2 "Segoe UI","Microsoft YaHei",sans-serif}
      .bar{height:42px;display:flex;align-items:center;gap:4px;padding:5px 8px;background:#fff}
      button{all:initial;box-sizing:border-box;width:28px;height:28px;border-radius:7px;color:#5f6368;font:500 16px/28px "Segoe UI",sans-serif;text-align:center;cursor:pointer;user-select:none;flex:none}
      button:hover{background:#f1f3f5;color:#202124}
      button:focus-visible,input:focus-visible{outline:2px solid #4f83e8;outline-offset:1px}
      form{display:flex;flex:1;min-width:0}
      input{all:initial;box-sizing:border-box;width:100%;height:30px;padding:0 11px;border:1px solid #e4e7eb;border-radius:9px;background:#f7f8fa;color:#2b3036;font:12px/30px "Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden;text-overflow:ellipsis}
      input:focus{background:#fff;border-color:#9ab8f0}
      /* 收起后只留一枚把手：出版社预览器的保存按钮常在右上角，被我们的固定条压住
         （2026-09-28 现场：Wiley 预览页"工具栏渲染不出来"）。收起而不是给页面加位移，
         免得重演 transform 引发的白屏。 */
      .collapse{margin-left:2px;font-size:14px}
    </style>
    <div class="shell">
      <div class="bar">
        <button data-action="back" type="button" title="后退" aria-label="后退">←</button>
        <button data-action="forward" type="button" title="前进" aria-label="前进">→</button>
        <button data-action="reload" type="button" title="刷新" aria-label="刷新">↻</button>
        <form><input type="text" spellcheck="false" aria-label="网址" /></form>
        <button class="collapse" type="button" title="收起导航栏，让出网页顶部控件" aria-label="收起导航栏">⌃</button>
      </div>
    </div>`;
    // 收起/展开我们的工具栏。收起只影响我们自己的 DOM，不给页面加任何 transform。
    const shellNode = root.querySelector('.shell');
    const collapseButton = root.querySelector('.collapse');
    document.getElementById('__ibm_webvpn_restore')?.remove();
    const restoreChip = document.createElement('button');
    restoreChip.id = '__ibm_webvpn_restore';
    restoreChip.type = 'button';
    restoreChip.textContent = '导航栏 ⌄';
    // 此按钮在 Shadow DOM 外，样式也必须写在自身；否则 shadow 内的规则不会生效。
    restoreChip.style.cssText = 'all:initial;box-sizing:border-box;position:fixed;top:0;left:0;z-index:2147483647;display:none;padding:3px 9px;border-radius:0 0 8px 0;background:#fff;color:#4b5563;border:1px solid #e4e7eb;font:500 11px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;cursor:pointer;box-shadow:0 2px 7px rgba(15,23,42,.12)';
    document.documentElement.appendChild(restoreChip);
    const setCollapsed = (collapsed) => {
      shellNode.style.display = collapsed ? 'none' : '';
      // 收起时同步清空固定层高度，避免透明区域挡住网页控件。
      host.style.height = collapsed ? '0' : `${CHROME_HEIGHT}px`;
      host.style.pointerEvents = collapsed ? 'none' : 'auto';
      restoreChip.style.display = collapsed ? 'block' : 'none';
      syncChromeShift();
    };
    window.__ibmWebVpnSetChromeCollapsed = setCollapsed;
    collapseButton.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      setCollapsed(true);
    });
    restoreChip.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      setCollapsed(false);
    });
    const input = root.querySelector('input');
    const sync = () => {
      if (root.activeElement !== input) input.value = location.href;
      input.title = location.href;
    };
    root.querySelector('[data-action="back"]').addEventListener('click', () => history.back());
    root.querySelector('[data-action="forward"]').addEventListener('click', () => history.forward());
    root.querySelector('[data-action="reload"]').addEventListener('click', () => location.reload());
    input.addEventListener('blur', sync);
    root.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      let target = input.value.trim();
      if (!target) return;
      if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) target = `https://${target}`;
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
   * 也看不到地址栏和导航按钮，连手动绕过都做不到（2026-09-25 实测，Cloudflare
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

/// 主窗口的 label（由 `tauri.conf.json` 的 `app.windows[0]` 定义）。
/// Agent 只观察候选下载入口，不读整页正文、Cookie 或表单值。
const AGENT_OBSERVE_SCRIPT: &str = r#"
(() => {
  if (document.querySelector('input[type="password"]')) return { error: '登录页请由用户操作' };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el) || getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const inViewport = (el) => {
    const r = el.getBoundingClientRect();
    let top = Number(r.top) || 0;
    let left = Number(r.left) || 0;
    let frame = el.ownerDocument?.defaultView?.frameElement;
    while (frame) {
      const parent = frame.getBoundingClientRect();
      top += Number(parent.top) || 0;
      left += Number(parent.left) || 0;
      frame = frame.ownerDocument?.defaultView?.frameElement;
    }
    const width = window.innerWidth || 1280;
    const height = window.innerHeight || 800;
    return top < height && top + r.height > 0 && left < width && left + r.width > 0;
  };
  const roots = [document];
  for (let i = 0; i < roots.length && roots.length < 20; i++) {
    for (const el of roots[i].querySelectorAll('*')) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
      if (el.matches?.('iframe,frame')) {
        try { if (el.contentDocument) roots.push(el.contentDocument); }
        catch { /* A cross-origin frame is not readable from its parent. */ }
      }
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
  const found = [];
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
      // C12：入口可判别。「点了会直接下载」和「点了只进预览器」必须能区分，
      // 否则同名入口（Science 的 PDF / Download PDF）只能靠 AI 从 URL 里猜。
      const autoDownloadable = (() => {
        const raw = String(href || '');
        if (!raw) return false;
        if (/download\s*=\s*true/i.test(raw)) return true;
        if (el.hasAttribute && el.hasAttribute('download')) return true;
        return /\.(?:pdf|zip|docx?)(?:[?#]|$)/i.test(raw);
      })();
      const target = safeTarget(href);
      const downloadHint = /pdf|download|supplement|supporting|moesm|mediaobjects|\.docx?|\.zip|附件|补充|下载|全文/i
        .test(label + ' ' + target);
      found.push({ el, role: el.tagName.toLowerCase(), label, target,
        file: safeFileName(href), autoDownloadable,
        likely: /supplement|supporting|moesm|mediaobjects|附件|补充/i.test(label + ' ' + target) ? 'si' : 'pdf',
        viewport: inViewport(el), downloadHint });
    }
  }
  // 长文章的导航和作者链接会占满 DOM 前 30 项。优先给当前视口内的下载入口，
  // 其次给其他位置的下载入口；没有入口时才给当前视口内的普通元素。
  found.sort((a, b) => {
    const rank = (item) => item.downloadHint ? item.viewport ? 0 : 1 : item.viewport ? 2 : 3;
    return rank(a) - rank(b);
  });
  const selected = found.slice(0, 30);
  const elements = selected.map((item) => item.el);
  const rows = selected.map((item, index) => ({
    id: 'e' + (index + 1), role: item.role, label: item.label, target: item.target,
    file: item.file, autoDownloadable: item.autoDownloadable, likely: item.likely,
    inViewport: item.viewport
  }));
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
    candidateCount: found.length, truncated: found.length > 30, candidates: rows };
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
/// 会被我们的导航栏盖住，因此这类页面需要开启页面位移；同时也是"该调保存
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
    /// 声明的总长度（`Content-Range` 的 total 或 200 的 Content-Length）。
    content_length: Option<u64>,
    /// 已落盘字节数（**区间的并集**，不是某一次响应的长度）。
    received_bytes: u64,
    /// 已经写进文件的区间，半开 `[start, end)`。
    ///
    /// 2026-09-28 现场（Wiley `btm2.10616`）：这份 PDF 是 4,594,707 字节，浏览器的
    /// PDF 查看器用 **18 个 256 KiB 的 Range 请求**把它拉下来。β16 为了避免"256 KiB
    /// 被当成整份"而把所有 206 响应丢掉了 —— 结果是载荷永远收不全、状态永远停在
    /// "正在接收"，只能退回查看器保存，而查看器保存交出的是页面（≈1 KB）而不是 PDF。
    /// 分段不是要丢弃的东西，是要**装配**的东西。
    segments: Vec<(u64, u64)>,
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
    /// 只描述 Agent 操作后的阶段；不把点击冒充为下载已开始。
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
    /// 每个任务最多尝试一次 Science 的受限备用入口。
    fallback_navigation_attempted: bool,
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
    /// 仅下载事件目标文件的字节数；与响应层载荷分别上报，避免混算。
    pub download_event_bytes: Option<u64>,
    /// 原生 PDF 查看器已声明的文件大小；普通页面下载未知时不编造百分比。
    pub download_total_bytes: Option<u64>,
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
    /// 最近一次失败的原因，以及（若适用）已经保住的那份产物（R4）。
    ///
    /// 以前这类信息只进 `webvpn.log`：调用方看不到，只能自己去读盘推断。
    pub last_failure: Option<FailureNotice>,
}

/// 一次失败的可见描述：原因 + 可救回的产物。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailureNotice {
    pub message: String,
    /// 失败时保留下来的完整文件（`*-未归档.pdf`）。本地文件完整时才有。
    pub salvaged_path: Option<String>,
    pub salvaged_bytes: Option<u64>,
    pub salvaged_sha256: Option<String>,
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
        intercept_direct_si: bool,
        upload_url: url::Url,
        temp_path: PathBuf,
    ) -> Result<u64, String> {
        cleanup_stale_html_viewer_payloads(&temp_path);
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
            automation_stage: "manual".to_string(),
            native_saving: false,
            intercept_direct_si,
            upload_url,
            temp_path,
            pdf_payload: None,
            expires_at: Instant::now() + CAPTURE_TTL,
            download_started_at: None,
            download_claimed: false,
            fallback_navigation_attempted: false,
            duplicate_failures_to_ignore: 0,
        });
        session.state = WebVpnSessionState::Navigating;
        session.target_host = Some(target_host.to_ascii_lowercase());
        session.last_error = None;
        Ok(generation)
    }

    fn set_automation_stage(&self, stage: &str) {
        if !matches!(stage, "searching" | "clicked" | "manual" | "verification") {
            return;
        }
        if let Ok(mut session) = self.session.lock() {
            if let Some(pending) = session.pending.as_mut() {
                if !pending.download_claimed {
                    pending.automation_stage = stage.to_string();
                }
            }
        }
    }

    fn verification_pending(&self) -> bool {
        self.session.lock().ok().and_then(|session| session.pending.as_ref()
            .map(|pending| pending.automation_stage == "verification")).unwrap_or(false)
    }

    fn should_capture_direct_si_preview(&self, target: &url::Url) -> bool {
        let Ok(session) = self.session.lock() else {
            return false;
        };
        let Some(pending) = session.pending.as_ref() else {
            return false;
        };
        pending.intercept_direct_si
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

    fn begin_viewer_save_action(&self, task_id: &str) -> Result<(), String> {
        let Ok(mut session) = self.session.lock() else {
            return Err("文献浏览器状态不可用".to_string());
        };
        let Some(pending) = session.pending.as_mut() else {
            return Err("没有待保存的文献任务".to_string());
        };
        if pending.task_id != task_id || !matches!(pending.kind.as_str(), "pdf" | "si")
            || pending.download_claimed || pending.expires_at <= Instant::now() {
            return Err("当前任务不允许保存原生 PDF".to_string());
        }
        pending.native_saving = true;
        pending.automation_stage = "saving".to_string();
        Ok(())
    }

    fn viewer_save_destination(&self, task_id: &str) -> Result<PathBuf, String> {
        let session = self.session.lock().map_err(|_| "文献浏览器状态不可用")?;
        let pending = session.pending.as_ref().ok_or("没有待保存的文献任务")?;
        if pending.task_id != task_id || !pending.native_saving || pending.download_claimed {
            return Err("当前任务不允许保存原生 PDF".to_string());
        }
        Ok(pending.temp_path.clone())
    }

    fn mark_viewer_save_started(&self, task_id: &str) {
        if let Ok(mut session) = self.session.lock() {
            if let Some(pending) = session.pending.as_mut() {
                if pending.task_id == task_id && pending.native_saving {
                    pending.download_started_at.get_or_insert_with(Instant::now);
                    session.state = WebVpnSessionState::Downloading;
                }
            }
        }
    }

    /// 查看器按钮未引发下载时撤销动作标记，保留人工 Ctrl+S 的下载认领机会。
    fn clear_viewer_save_action(&self, task_id: &str) {
        if let Ok(mut session) = self.session.lock() {
            if session.state == WebVpnSessionState::Uploading { return; }
            if let Some(pending) = session.pending.as_mut() {
                if pending.task_id == task_id && !pending.download_claimed {
                    pending.native_saving = false;
                    pending.automation_stage = "manual".to_string();
                    pending.download_started_at = None;
                    session.state = WebVpnSessionState::WaitingDownload;
                }
            }
        }
    }

    fn download_claimed_for(&self, task_id: &str) -> bool {
        self.session.lock().ok().and_then(|session| session.pending.as_ref()
            .map(|pending| pending.task_id == task_id && pending.download_claimed)).unwrap_or(false)
    }

    fn claim_native_saved_file(&self, task_id: &str) -> bool {
        let Ok(mut session) = self.session.lock() else { return false; };
        let Some(pending) = session.pending.as_mut() else { return false; };
        if pending.task_id != task_id || !pending.native_saving || pending.download_claimed { return false; }
        pending.download_claimed = true;
        pending.download_started_at.get_or_insert_with(Instant::now);
        true
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
        // 归档成功后响应层缓存只是暂存物。尤其 HTML 查看器的 348 B 空壳
        // 不能继续留在 webvpn-downloads，也不能被误作后续任务的 PDF。
        if result.is_ok() {
            if let Some(payload) = session.pending.as_ref().and_then(|pending| pending.pdf_payload.as_ref()) {
                let _ = fs::remove_file(&payload.path);
            }
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
        let same_document = session.page.as_ref().is_some_and(|page| page.url == url);
        let document_type = document_type_for(url, if same_document { session.page.as_ref().and_then(|page| page.document_type.clone()) } else { None });
        let http_status = if same_document { session.page.as_ref().and_then(|page| page.http_status) } else { None };
        let content_length = if same_document { session.page.as_ref().and_then(|page| page.content_length) } else { None };
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
    /// 确保这个任务有一个载荷文件可以写，并登记声明总长。
    ///
    /// 与旧版不同：**允许多个响应同时写**（分段装配的前提）。每个写入者写自己的
    /// 偏移，落定后由 `finish_pdf_segment` 合并区间。
    pub fn ensure_pdf_payload(&self, task_id: &str, path: PathBuf, total_hint: Option<u64>) -> bool {
        let Ok(mut session) = self.session.lock() else {
            return false;
        };
        let Some(pending) = session.pending.as_mut() else {
            return false;
        };
        if pending.task_id != task_id || pending.kind != "pdf" {
            return false;
        }
        match pending.pdf_payload.as_mut() {
            Some(payload) => {
                // 总长以"新知道的"为准；已经完整的载荷不再接受新段。
                if payload.content_length.is_none() {
                    payload.content_length = total_hint;
                }
                !payload.complete
            }
            None => {
                pending.pdf_payload = Some(PdfPayload {
                    content_length: total_hint,
                    received_bytes: 0,
                    segments: Vec::new(),
                    path,
                    complete: false,
                    error: None,
                });
                true
            }
        }
    }

    /// 读取过程中的粗粒度进度（只增不减，供状态显示）。
    pub fn note_pdf_payload_progress(&self, task_id: &str, received_bytes: u64) {
        if let Ok(mut session) = self.session.lock() {
            if let Some(pending) = session.pending.as_mut() {
                if pending.task_id == task_id {
                    if let Some(payload) = pending.pdf_payload.as_mut() {
                        if received_bytes > payload.received_bytes {
                            payload.received_bytes = received_bytes;
                        }
                    }
                }
            }
        }
    }

    /// 落定**一段**载荷：把它并入已覆盖区间，并重算完整性。
    ///
    /// 完整性判据（正向证明，二者取一）：
    ///   * 声明总长已知 → 区间并集从 0 连续覆盖到总长；
    ///   * 声明总长未知（chunked / `*`）→ 由读取器给出的结构证据决定（尾部 `%%EOF`）。
    pub fn finish_pdf_segment(
        &self,
        task_id: &str,
        start: u64,
        bytes: u64,
        body_complete_hint: bool,
        note: String,
    ) {
        if let Ok(mut session) = self.session.lock() {
            if let Some(pending) = session.pending.as_mut() {
                if pending.task_id == task_id {
                    if let Some(payload) = pending.pdf_payload.as_mut() {
                        if bytes > 0 {
                            payload.segments.push((start, start.saturating_add(bytes)));
                            // 上限保护：区间过多说明响应异常，只留最近的若干段。
                            if payload.segments.len() > 4096 {
                                payload.segments.drain(0..1024);
                            }
                        }
                        let covered = covered_bytes(&payload.segments);
                        if covered > payload.received_bytes {
                            payload.received_bytes = covered;
                        }
                        payload.complete = match payload.content_length {
                            Some(total) => covers_from_zero(&payload.segments, total),
                            None => body_complete_hint && covered > 0,
                        };
                        payload.error = if !note.is_empty() && !payload.complete {
                            Some(note)
                        } else {
                            None
                        };
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
    fn pending_pdf_target(&self, response_url: &str) -> Option<(String, PathBuf)> {
        let session = self.session.lock().ok()?;
        let pending = session.pending.as_ref()?;
        if pending.kind == "si" {
            let target = url::Url::parse(response_url).ok()?;
            if !pending.publisher.direct_si("si") || !is_springer_family_si_url(&target)
                || !target.path().to_ascii_lowercase().ends_with(".pdf") {
                return None;
            }
        } else if pending.kind != "pdf" {
            return None;
        }
        Some((
            pending.task_id.clone(),
            pdf_payload_path(&pending.temp_path),
        ))
    }

    fn is_current_pdf_document(&self, task_id: &str, current: &url::Url) -> bool {
        self.session.lock().ok().and_then(|session| {
            let pending = session.pending.as_ref()?;
            let page = session.page.as_ref()?;
            Some(pending.task_id == task_id && page.url == current.as_str()
                && page.document_type.as_deref().is_some_and(|kind| kind.starts_with("application/pdf")))
        }).unwrap_or(false)
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

    /// 载荷声明的总长度（D1/D2：归档前据此核对大小）。
    #[allow(dead_code)]
    pub fn pdf_payload_total(&self, task_id: &str) -> Option<u64> {
        let session = self.session.lock().ok()?;
        let pending = session.pending.as_ref()?;
        if pending.task_id != task_id {
            return None;
        }
        pending.pdf_payload.as_ref()?.content_length
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
        // 已经在归档就别再起一次：侧栏按钮可能在浮层之后被按下。
        if pending.task_id != task_id
            || !owned_by_task
            || pending.expires_at <= Instant::now()
            || matches!(session.state, WebVpnSessionState::Uploading)
        {
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

    /// 把当前捕获判为失败——但**先验产物**（B2/B5）。
    ///
    /// 2026-09-27 现场：`capture-mujvdn4aa999ea` 报 `failed`，而盘上文件其实是完整的
    /// 2,716,662 B（`%PDF-1.4` + `%%EOF` + 可解析 8 页）。调用方无法区分"失败但文件
    /// 完整"与"失败且文件残缺"，而失败路径还会把完整文件删掉——那次没丢件纯属运气
    /// （磁盘上恰好还有一份更早的副本）。所以：
    ///
    ///   1. 文件已经是完整 PDF → **归档它**，不报失败；
    ///   2. 确实不完整 → 保留成 `*-未归档.pdf`（不删），并把确切原因与路径写进状态。
    fn fail_pending_download(&self, app: &AppHandle, message: &str) {
        let pending = {
            let Ok(mut session) = self.session.lock() else {
                return;
            };
            session.pending.take()
        };
        let Some(pending) = pending else {
            // 没有待捕获任务：这句失败没有对象，不要污染会话状态。
            return;
        };

        if let Some(payload) = pending.pdf_payload.as_ref() {
            if payload.error.as_deref().is_some_and(|error| error.starts_with("wrong-object-html:")) {
                let _ = fs::remove_file(&payload.path);
            }
        }

        // 1) 产物完整 → 归档，而不是失败。
        if file_is_whole(&pending.temp_path) {
            if let Some(upload) = self.begin_upload(&pending.temp_path) {
                record(
                    app,
                    "automation",
                    "",
                    &format!("{message}；但盘上文件已完整，改为直接归档"),
                );
                upload_capture(app.clone(), upload);
                return;
            }
        }

        // 2) 保留证据文件（B5）：失败时默认不删，并把路径写进原因。
        let preserved = preserve_failed_download(&pending.temp_path, &pending.task_id, &pending.kind);
        let detail = format!("{message}；文件已保留在 {}", preserved.display());
        let bytes = fs::metadata(&preserved).ok().map(|meta| meta.len());
        if let Ok(mut session) = self.session.lock() {
            session.last_outcome = Some(CaptureOutcome {
                generation: pending.generation,
                ok: false,
                path: Some(preserved),
                bytes,
                sha256: None,
                error: Some(detail.clone()),
            });
            session.last_pending_task_id = Some(pending.task_id.clone());
            session.release_reason = Some(detail.clone());
            session.progress_sample = None;
            session.capture_notice = Some(CaptureNotice {
                kind: pending.kind.clone(),
                phase: "error",
                expires_at: Instant::now() + Duration::from_secs(30 * 60),
            });
            session.state = WebVpnSessionState::Error;
            session.last_error = Some(detail.clone());
        }
        record(app, "error", "", &detail);
    }

    /// 仅供测试/无 AppHandle 场景：与 `fail_pending_download` 同样的语义，
    /// 但没有 app 就没法归档，直接走"保留证据 + 失败"。
    #[cfg(test)]
    fn fail_pending_download_without_app(&self, message: &str) {
        let pending = {
            let Ok(mut session) = self.session.lock() else {
                return;
            };
            session.pending.take()
        };
        let Some(pending) = pending else {
            return;
        };
        let preserved = preserve_failed_download(&pending.temp_path, &pending.task_id, &pending.kind);
        let detail = format!("{message}；文件已保留在 {}", preserved.display());
        let bytes = fs::metadata(&preserved).ok().map(|meta| meta.len());
        if let Ok(mut session) = self.session.lock() {
            session.last_outcome = Some(CaptureOutcome {
                generation: pending.generation,
                ok: false,
                path: Some(preserved),
                bytes,
                sha256: None,
                error: Some(detail.clone()),
            });
            session.last_pending_task_id = Some(pending.task_id);
            session.release_reason = Some(detail.clone());
            session.progress_sample = None;
            session.state = WebVpnSessionState::Error;
            session.last_error = Some(detail);
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

    /// 备用入口只能从状态工具刚报告的页面发起，且同一任务只尝试一次。
    fn claim_science_fallback(&self, task_id: &str, expected_page_seq: u64, current: &url::Url) -> Result<(), String> {
        let mut session = self.session.lock().map_err(|_| "文献浏览器状态不可用")?;
        let page = session.page.as_ref().ok_or("尚未观察到当前页面")?;
        if page.seq != expected_page_seq || page.url != current.as_str() {
            return Err("备用入口已失效，请重新查询任务状态".to_string());
        }
        if !matches!(session.state, WebVpnSessionState::WaitingDownload | WebVpnSessionState::Navigating) {
            return Err("当前正在下载或归档，不能切换入口".to_string());
        }
        let pending = session.pending.as_mut().ok_or("没有待捕获的文献任务")?;
        if pending.task_id != task_id || pending.kind != "pdf" || pending.publisher != PublisherAdapter::Science {
            return Err("当前任务不支持此备用入口".to_string());
        }
        if pending.download_claimed || pending.fallback_navigation_attempted {
            return Err("当前任务已开始下载或已尝试备用入口".to_string());
        }
        pending.fallback_navigation_attempted = true;
        pending.pdf_payload = None;
        session.state = WebVpnSessionState::Navigating;
        Ok(())
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
        let bytes = pending_progress_bytes(pending);
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
            "payloadComplete": payload_ready,
            "documentType": session.page.as_ref().and_then(|page| page.document_type.clone()),
            "downloadBytes": if pending.download_started_at.is_some() { fs::metadata(&pending.temp_path).map(|item| item.len()).unwrap_or(0) } else { 0 },
            "downloadTotalBytes": if pending.native_saving && pending.download_started_at.is_some() { session.page.as_ref().filter(|page| page.http_status == Some(200) && page.document_type.as_deref().is_some_and(|kind| kind.eq_ignore_ascii_case("application/pdf"))).and_then(|page| page.content_length) } else { None },
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
        let downloaded_bytes = session.pending.as_ref().and_then(pending_progress_bytes);
        let download_event_bytes = session.pending.as_ref().and_then(|pending| {
            pending.download_started_at.and_then(|_| fs::metadata(&pending.temp_path).ok().map(|meta| meta.len()))
        });
        let download_elapsed_ms = session.pending.as_ref().and_then(|pending| {
            pending
                .download_started_at
                .map(|started| started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64)
        });
        let download_total_bytes = session.pending.as_ref().and_then(|pending| {
            (pending.native_saving && pending.download_started_at.is_some())
                .then(|| session.page.as_ref())
                .flatten()
                .filter(|page| page.http_status == Some(200) && page.document_type.as_deref()
                    .is_some_and(|kind| kind.starts_with("application/pdf")))
                .and_then(|page| page.content_length)
        });
        // C17：停滞检测。下载/保存期间字节数长时间不动，就该显示成异常，
        // 而不是永远「正在保存」。
        let stalled_ms = self.stalled_ms_now(downloaded_bytes);
        // 先算好 last_failure 再构造结构体：last_outcome/last_error 稍后会被 move 进去。
        let last_failure = failure_notice_of(session.last_outcome.as_ref(), session.last_error.as_deref());
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
            download_event_bytes,
            download_total_bytes,
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
                    // 语义边界（D1）：`ready` = 至少进来了一个字节，`complete` = 已被
                    // 正向证明收全（收满 Content-Length，或尾部有 %%EOF）。
                    // 两者曾经被写成同一个条件，于是"正在接收"这个状态对外不存在，
                    // 调用方只能看到"已就绪"。
                    ready: payload.received_bytes > 0,
                    complete: payload.complete,
                    content_length: payload.content_length,
                    received_bytes: payload.received_bytes,
                    error: payload.error.clone(),
                }),
            last_pending_task_id: session.last_pending_task_id,
            release_reason: session.release_reason,
            taken_over_at: session.taken_over_at,
            stalled_ms,
            last_failure,
        }
    }

    /// 下载/保存期间「无字节增长」的毫秒数（C17）。非长耗时阶段返回 None。
    ///
    /// 采样的是 `pending_progress_bytes`（下载目标与载荷取较大者），所以走响应层
    /// 时也能正确判定停滞，不会因为只看 `temp_path` 而永远显示"正在保存"。
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

/// 把最近一次失败整理成对调用方可见的提示（R4）。
///
/// 只有"这次真的失败了"才给：成功、没跑过、或上一次是别的原因都不报。
fn failure_notice_of(outcome: Option<&CaptureOutcome>, last_error: Option<&str>) -> Option<FailureNotice> {
    let outcome = outcome.filter(|outcome| !outcome.ok)?;
    let message = outcome
        .error
        .clone()
        .or_else(|| last_error.map(|value| value.to_string()))
        .unwrap_or_else(|| "捕获失败".to_string());
    let salvaged = outcome.path.as_ref().filter(|path| path.is_file());
    Some(FailureNotice {
        message,
        salvaged_path: salvaged.map(|path| path.to_string_lossy().to_string()),
        salvaged_bytes: salvaged.and_then(|path| fs::metadata(path).ok().map(|meta| meta.len())),
        // 只有"文件是完整的 PDF"才值得让调用方去救——不完整的别给 sha256 造成误导。
        salvaged_sha256: salvaged
            .filter(|path| file_is_whole(path))
            .and_then(|path| sha256_of_file(path)),
    })
}

/// 一个捕获任务当前已接收的字节数：下载目标与响应层载荷取较大者。
///
/// 两条路各自写自己的文件，调用方只关心"总共进来多少"。取 max 保证这个数字单调，
/// 不会因为某条路暂时没有数据而回退。
fn pending_progress_bytes(pending: &PendingCapture) -> Option<u64> {
    // 一旦真实下载开始，进度只能来自下载目标文件。预览器缓存的 206 分段或
    // HTML 壳不能与它取 max；那会把 1 KB 假载荷说成已下载的 PDF。
    if pending.download_started_at.is_some() {
        return Some(fs::metadata(&pending.temp_path).map(|meta| meta.len()).unwrap_or(0));
    }
    let payload_bytes = pending
        .pdf_payload
        .as_ref()
        .map(|payload| payload.received_bytes)
        .filter(|bytes| *bytes > 0);
    payload_bytes
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

/// 只清理旧版遗留、可明确判定为 HTML 的查看器缓存。真实 PDF、未知内容和
/// 刚写入的文件一律保留；扫描范围限定在当前任务的应用下载目录。
fn cleanup_stale_html_viewer_payloads(temp_path: &Path) {
    let Some(directory) = temp_path.parent() else { return; };
    let Ok(entries) = fs::read_dir(directory) else { return; };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("capture-") || !name.ends_with(".payload.pdf") { continue; }
        if !entry.file_type().is_ok_and(|kind| kind.is_file()) { continue; }
        let Ok(metadata) = entry.metadata() else { continue; };
        if metadata.len() == 0 || metadata.len() > 4096 { continue; }
        if !metadata.modified().ok().and_then(|time| time.elapsed().ok())
            .is_some_and(|age| age >= Duration::from_secs(300)) { continue; }
        let Ok(bytes) = fs::read(entry.path()) else { continue; };
        let head = String::from_utf8_lossy(&bytes).trim_start().to_ascii_lowercase();
        if head.starts_with("<!doctype html") || head.starts_with("<html") {
            let _ = fs::remove_file(entry.path());
        }
    }
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
                state.fail_pending_download(&app, "Springer 系 SI 下载与当前捕获任务不匹配，请重试");
            }
        }
        Err(message) => {
            if let Some(state) = app.try_state::<WebVpnState>() {
                state.fail_pending_download(&app, &message);
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
/// 读下载产物——**等到内容被证明完整才交出去**。
///
/// 2026-09-27 现场（issue-0.5.5-beta16.md）：`DownloadEvent::Finished { success: true }`
/// 到达时，文件**还在被 WebView2 写**。旧实现第一次 `fs::read` 成功就返回，于是把一个
/// 前缀当成整份上传，捕获服务按规矩回 400；同一序列第 5 次又成功——因为那次竞态刚好
/// 没输。报告把它归因于"上传了响应体载荷"，那是推断；真正的机制就是这里**读得比写完早**。
///
/// 所以判据与载荷/归档一致：`%PDF-` 头 + `%%EOF` 尾（SI 另认 zip/docx），
/// 且**连续两次读到的长度一致**（证明写完了），超时则带着"读到了多少、差哪一项"报错。
fn read_captured_file(path: &Path, kind: &str) -> Result<Vec<u8>, String> {
    let deadline = Instant::now() + CAPTURE_READ_TIMEOUT;
    let mut previous_len: Option<usize> = None;
    loop {
        match fs::read(path) {
            Ok(body) => {
                let stable = previous_len == Some(body.len());
                if let Some(reason) = captured_body_defect(kind, &body) {
                    // 还没写完/内容不对：继续等，直到超时。
                    previous_len = Some(body.len());
                    if Instant::now() >= deadline {
                        return Err(format!(
                            "下载文件未在 {} 秒内写完（已读取 {} 字节，{reason}）",
                            CAPTURE_READ_TIMEOUT.as_secs(),
                            body.len()
                        ));
                    }
                } else if stable {
                    return Ok(body);
                } else {
                    // 结构已经对，但长度还在长：再确认一次，避免把"刚好写到这里"当成写完。
                    previous_len = Some(body.len());
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound && Instant::now() < deadline =>
            {
                previous_len = None;
            }
            Err(error) => return Err(format!("无法读取 WebVPN 下载文件: {error}")),
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

/// 交出去的字节还差什么；`None` 表示"结构上已经是完整产物"。
///
/// 与捕获服务的校验（`validateCapturedFile`）保持同一组判据，这样本地就不会把
/// 一份注定被 400 拒绝的 body 发出去——失败发生在本地，原因也留在本地。
fn captured_body_defect(kind: &str, bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return Some("文件为空".to_string());
    }
    if bytes.starts_with(b"%PDF-") {
        if !tail_has_eof(bytes) {
            return Some("尾部还没有 %%EOF".to_string());
        }
        return None;
    }
    // SI 允许 pdf / docx / zip：zip 与 docx 都以 PK 开头。
    if kind == "si" && bytes.starts_with(b"PK") {
        return None;
    }
    if kind == "si"
    {
        return Some("既不是 PDF（缺 %PDF- 头）也不是 zip/docx（缺 PK 头）".to_string());
    }
    Some("缺少 PDF 文件头（%PDF-）".to_string())
}

pub fn upload_capture(app: AppHandle, upload: PendingUpload) {
    let body = read_captured_file(&upload.path, &upload.kind);
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
            // R2：把服务端的响应体读出来。只记状态码等于把原因扔掉——2026-09-27 现场
            // 三条失败的具体校验文案就是这么永久丢失的（报告 §4）。
            let status = response.status();
            let detail = response
                .text()
                .map(|text| text.chars().take(300).collect::<String>())
                .unwrap_or_default();
            return Err(if detail.is_empty() {
                format!("捕获服务拒绝了文件（HTTP {status}）")
            } else {
                format!("捕获服务拒绝了文件（HTTP {status}）：{detail}")
            });
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
/// 盘上的文件是不是一个**完整的 PDF**（B2：进 failed 之前必须能回答这个问题）。
///
/// 判据与载荷/归档完全一致：`%PDF-` 头 + 尾部 `%%EOF`。不看任务状态——状态可能是错的，
/// 盘上的字节不会骗人。
fn file_is_whole(path: &Path) -> bool {
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    bytes.starts_with(b"%PDF-") && tail_has_eof(&bytes)
}

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

/// 捕获任务启动时先激活承载 WebView 的主窗口。仅给子 WebView 调 set_focus
/// 不能把后台或最小化的原生窗口带到前台。
fn activate_capture_window(app: &AppHandle) -> Result<(), String> {
    let main = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "主窗口不可用".to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn focus_visible_browser(app: &AppHandle, webview: &Webview) -> Result<(), String> {
    let capturing = app
        .try_state::<WebVpnState>()
        .and_then(|state| state.pending_task_id())
        .is_some();
    if capturing {
        if let Err(error) = activate_capture_window(app) {
            // Windows 可拒绝后台进程抢前台。捕获任务仍应继续，随后由焦点诊断
            // 告知 Agent/用户，而不是留下一个已布防却因显示失败被报告失败的任务。
            record(app, "captureFocus", "", &format!("主窗口激活失败: {error}"));
        }
    }
    webview.set_focus().map_err(|error| error.to_string())?;
    if capturing {
        let foreground = app
            .get_window(MAIN_WINDOW_LABEL)
            .and_then(|main| main.is_focused().ok())
            .unwrap_or(false);
        record(
            app,
            "captureFocus",
            "",
            if foreground {
                "主窗口已处于前台，已请求文献浏览器焦点"
            } else {
                "已请求主窗口及文献浏览器焦点，但系统未确认窗口位于前台"
            },
        );
    }
    Ok(())
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
    let was_visible = state.sidebar_visible();
    webview
        .set_bounds(bounds(rect.0, rect.1, rect.2, rect.3))
        .map_err(|error| error.to_string())?;
    webview.show().map_err(|error| error.to_string())?;
    state.set_sidebar_visible(true);
    // DSH 可能在捕获命令返回后才报出 tab 尺寸。此时子 WebView 刚从隐藏变可见，
    // 必须再次把焦点送过去；后续连续布局上报不能反复抢用户焦点。
    if !was_visible && state.pending_task_id().is_some() {
        focus_visible_browser(app, &webview)?;
    }
    Ok(())
}

pub fn show_sidebar(app: &AppHandle, webview: &Webview) -> Result<(), String> {
    let state = app.try_state::<WebVpnState>();
    if state.as_ref().map(|state| state.client_layout()).unwrap_or(false) {
        // DSH 右侧栏接管布局：只按最近一次上报的矩形显示，绝不改动主 WebView 宽度。
        let Some(rect) = state.as_ref().and_then(|state| state.client_rect()) else {
            // tab 尚未量出可用区域（未打开或已收起）：先不显示，等它上报。
            if state.as_ref().and_then(|state| state.pending_task_id()).is_some() {
                if let Err(error) = activate_capture_window(app) {
                    record(app, "captureFocus", "", &format!("主窗口激活失败: {error}"));
                }
            }
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
        focus_visible_browser(app, webview)?;
        if let Some(state) = state.as_ref() {
            state.set_sidebar_visible(true);
        }
        return Ok(());
    }
    layout_sidebar(app, webview)?;
    webview.show().map_err(|error| error.to_string())?;
    focus_visible_browser(app, webview)?;
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

/// 只读 CDP 快照。调试工具不接收任意 method/parameters，也不返回原始 URL、
/// Cookie 或响应体；目标清单足以判断 PDF 查看器是否成为独立 target。
#[cfg(windows)]
async fn debug_cdp_targets(webview: &Webview) -> Result<serde_json::Value, String> {
    let (sender, receiver) = std::sync::mpsc::channel::<Result<String, String>>();
    webview.with_webview(move |platform| {
        let core = match unsafe { platform.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(error) => { let _ = sender.send(Err(error.to_string())); return; }
        };
        let completed_sender = sender.clone();
        let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, result| {
            let value = status.map(|_| result.to_string())
                .map_err(|error| error.to_string());
            let _ = completed_sender.send(value);
            Ok(())
        }));
        let method = CoTaskMemPWSTR::from("Target.getTargets");
        let params = CoTaskMemPWSTR::from("{}");
        if let Err(error) = unsafe { core.CallDevToolsProtocolMethod(
            *method.as_ref().as_pcwstr(), *params.as_ref().as_pcwstr(), &handler,
        ) } {
            let _ = sender.send(Err(error.to_string()));
        }
    }).map_err(|error| error.to_string())?;
    let response = tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(8)))
        .await.map_err(|error| error.to_string())?
        .map_err(|_| "CDP 调试快照超时".to_string())??;
    let value: serde_json::Value = serde_json::from_str(&response)
        .map_err(|_| "CDP 调试结果无效".to_string())?;
    if let Some(error) = value.get("error") {
        return Err(format!("CDP 返回错误: {}", error.get("message").and_then(|v| v.as_str()).unwrap_or("未知错误")));
    }
    let targets = value.get("targetInfos").and_then(|v| v.as_array())
        .map(|items| items.iter().take(30).map(|target| {
            let kind = target.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let raw_url = target.get("url").and_then(|v| v.as_str()).unwrap_or("");
            serde_json::json!({
                "type": kind,
                "host": host_of(raw_url),
                "pdfViewer": raw_url.starts_with("chrome-extension://") || raw_url.starts_with("edge://pdf-viewer"),
                "attached": target.get("attached").and_then(|v| v.as_bool()).unwrap_or(false),
            })
        }).collect::<Vec<_>>()).unwrap_or_default();
    Ok(serde_json::json!({ "targets": targets, "targetCount": value.get("targetInfos").and_then(|v| v.as_array()).map_or(0, Vec::len) }))
}

#[cfg(windows)]
async fn debug_browser_snapshot(state: &WebVpnState, webview: &Webview) -> Result<serde_json::Value, String> {
    let page = state.session.lock().ok().and_then(|session| session.page.clone());
    let events = state.snapshot().into_iter().rev().take(24).collect::<Vec<_>>();
    let targets = debug_cdp_targets(webview).await?;
    Ok(serde_json::json!({
        "page": page.map(|page| serde_json::json!({
            "host": host_of(&page.url),
            "documentType": page.document_type,
            "httpStatus": page.http_status,
            "readyState": page.ready_state,
            "contentLength": page.content_length,
            "pageSeq": page.seq,
        })),
        "cdp": targets,
        "recentEvents": events,
    }))
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
        state.record(WebVpnEvent {
            kind: "response".to_string(),
            url: String::new(),
            host: host_of(&url),
            detail: format!("status={} contentType={} contentLength={}",
                status.map(|value| value.to_string()).unwrap_or_else(|| "unknown".to_string()),
                if lowered.contains("application/pdf") { "application/pdf" } else { "text/html" },
                content_length.map(|value| value.to_string()).unwrap_or_else(|| "unknown".to_string())),
        });
    }
    if !lowered.contains("application/pdf") || attachment {
        return;
    }
    let content_range = response_header(&response, "content-range");
    // 分段响应 = 这份 PDF 的一段，**不是**要丢掉的噪声（见 PdfPayload::segments 的注释）。
    let parsed_range = content_range.as_deref().and_then(parse_content_range);
    if is_partial_response(status, content_range.as_deref()) && parsed_range.is_none() {
        record(
            app,
            "automation",
            "",
            &format!(
                "跳过无法解析的 PDF 分段响应（status={:?}，content-range={:?}）",
                status,
                content_range.unwrap_or_else(|| "-".to_string())
            ),
        );
        return;
    }
    let Some((task_id, path)) = state.pending_pdf_target(&url) else {
        return;
    };
    // 声明总长：分段响应取 total；整份响应取 Content-Length。
    let declared_total = match parsed_range {
        Some((_start, _end, total)) => total,
        None if status == Some(200) || status.is_none() => content_length,
        None => None,
    };
    let offset = parsed_range.map(|(start, _end, _total)| start).unwrap_or(0);
    if !state.ensure_pdf_payload(&task_id, path.clone(), declared_total) {
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
                    state.finish_pdf_segment(
                        &payload_task,
                        offset,
                        0,
                        false,
                        if error.is_err() {
                            format!("get-content-failed: WebView2 响应体读取失败（0x{code:08X}）")
                        } else {
                            "no-body: WebView2 未提供 PDF 响应体".to_string()
                        },
                    );
                }
                return Ok(());
            };
            // 读取放到工作线程：这个流由网络响应驱动，在 UI 线程上把它读完会把整个
            // 应用冻住（2.6 MB 也要好几秒，107 MB 的 SI 更不用说）。`IStream` 不是
            // Send，所以按 COM 的规矩用 CoMarshalInterThreadInterfaceInStream 把接口
            // 封送过去，而不是硬搬指针。
            spawn_payload_read(stream, payload_task, payload_path, payload_app, content_length, offset);
            Ok(())
        },
    ));
    if let Err(error) = unsafe { response.GetContent(&content) } {
        state.finish_pdf_segment(
            &task_id,
            offset,
            0,
            false,
            format!("get-content-failed: WebView2 无法启动响应体读取（0x{:08X}）", error.code().0 as u32),
        );
    }
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
    task_id: &str,
    app: &AppHandle,
    content_length: Option<u64>,
    max_wait: Duration,
    offset: u64,
) -> Result<PdfBodyResult, String> {
    let limit = CAPTURE_MAX_BYTES;
    let mut buffer: Vec<u8> = Vec::new();
    let mut chunk = vec![0_u8; 64 * 1024];
    let started = Instant::now();
    let mut last_progress = Instant::now();
    // 封送失败时会退回"在 UI 线程上读"，那条路必须更短：读满一整个大文件会把
    // 界面冻住。工作者线程上才用得上完整的 PDF_STREAM_MAX_WAIT。
    let max_wait = max_wait.min(PDF_STREAM_MAX_WAIT);
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
            // 已经收到的字节仍然返回：调用方需要 receivedBytes 才能如实报告"卡在哪"。
            return Ok(PdfBodyResult {
                bytes: buffer.len() as u64,
                complete: false,
                note: format!("读取 PDF 响应体失败（0x{:08X}）", hr.0 as u32),
                partial: buffer,
            });
        }
        if read > 0 {
            buffer.extend_from_slice(&chunk[..read as usize]);
            last_progress = Instant::now();
            if buffer.len() >= 5 && !buffer.starts_with(b"%PDF-") {
                let html = buffer.starts_with(b"<!doctype html") || buffer.starts_with(b"<html");
                return Ok(PdfBodyResult {
                    bytes: buffer.len() as u64,
                    complete: false,
                    note: if html {
                        "wrong-object-html: 响应体是 HTML 查看器页面，不是 PDF".to_string()
                    } else {
                        "wrong-object: 响应体缺少 PDF 文件头".to_string()
                    },
                    partial: buffer,
                });
            }
            if buffer.len() as u64 > limit {
                return Ok(PdfBodyResult {
                    bytes: buffer.len() as u64,
                    complete: false,
                    note: format!("PDF 超过 {} MB 捕获上限，已中止", limit / 1024 / 1024),
                    partial: buffer,
                });
            }
            if let Some(state) = app.try_state::<WebVpnState>() {
                state.note_pdf_payload_progress(task_id, buffer.len() as u64);
            }
            if let Some(total) = content_length {
                if buffer.len() as u64 >= total {
                    break;
                }
            }
            if content_length.is_none() && tail_has_eof(&buffer) {
                break;
            }
            continue;
        }
        // read == 0 **不等于** EOF：这个流由网络响应驱动，暂时没数据时会返回 0。
        // 早期版本直接 break，于是在 256 KiB 的缓冲边界上把半个 PDF 当成了完整载荷
        // （2026-09-27 现场：262144 B、有 %PDF- 头、没有 %%EOF，却被标成"已就绪"，
        // 一路送到归档服务换回一个 HTTP 400）。
        if let Some(total) = content_length {
            if buffer.len() as u64 >= total {
                break;
            }
        }
        if tail_has_eof(&buffer) {
            break;
        }
        let idle = last_progress.elapsed();
        if idle >= PDF_STREAM_STALL_TIMEOUT || started.elapsed() >= max_wait {
            let total_note = match content_length {
                Some(total) => format!("{total} 字节"),
                None => "未知总长".to_string(),
            };
            return Ok(PdfBodyResult {
                bytes: buffer.len() as u64,
                complete: false,
                note: format!(
                    "已接收 {} 字节 / {}，{} 秒没有新数据",
                    buffer.len(),
                    total_note,
                    idle.as_secs()
                ),
                partial: buffer,
            });
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    // 这一段自身的完整性：只有"从 0 开始、且声明总长已知、且收满"时才能由它单独判定；
    // 其余情况交给 `finish_pdf_segment` 用区间并集判断（分段装配）。
    let complete = offset == 0 && payload_is_whole(&buffer, content_length);
    let note = if complete {
        String::new()
    } else {
        match (content_length, tail_has_eof(&buffer)) {
            (Some(total), false) => {
                format!("已接收 {} / {} 字节，且尾部没有 %%EOF", buffer.len(), total)
            }
            (Some(total), true) => format!("已接收 {} / {} 字节", buffer.len(), total),
            (None, false) => format!("已接收 {} 字节，且尾部没有 %%EOF", buffer.len()),
            (None, true) => format!("已接收 {} 字节（声明总长未知）", buffer.len()),
        }
    };
    Ok(PdfBodyResult {
        bytes: buffer.len() as u64,
        complete,
        note,
        partial: buffer,
    })
}

/// 响应体读取结果（C1/R2.2）：字节数、是否已被证明完整、以及不完整时的原因。
#[cfg(windows)]
struct PdfBodyResult {
    bytes: u64,
    complete: bool,
    note: String,
    partial: Vec<u8>,
}

/// 在工作线程上读完 PDF 响应流，然后把结果落定到任务上。
///
/// 为什么必须离开 UI 线程：`GetContent` 的流由网络响应驱动，边到边读；在 UI 线程上
/// 读完等于把整个应用冻住到下载结束。`IStream` 不是 `Send`，所以按 COM 的规矩封送：
/// 源线程（STA）用 `CoMarshalInterThreadInterfaceInStream` 生成一个流对象，把它的
/// 裸指针（`usize`，Send）交给工作线程，工作线程 `CoInitializeEx(MTA)` 之后用
/// `CoGetInterfaceAndReleaseStream` 还原接口再读。
///
/// 封送失败时退回当前线程读取（并在日志里写明），而不是静默丢掉这条保存路径。
#[cfg(windows)]
fn spawn_payload_read(
    stream: IStream,
    task_id: String,
    payload_path: PathBuf,
    app: AppHandle,
    content_length: Option<u64>,
    offset: u64,
) {
    match unsafe { CoMarshalInterThreadInterfaceInStream(&IStream::IID, &stream) } {
        Ok(marshaled) => {
            // into_raw 把包装器"漏"成一个裸指针，所有权转交给工作线程。
            let raw = Interface::into_raw(marshaled) as usize;
            std::thread::spawn(move || {
                let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
                let result = (|| -> Result<PdfBodyResult, String> {
                    // **ManuallyDrop 不是可选的**：CoGetInterfaceAndReleaseStream 会释放
                    // 传入的那个流（MSDN：Releases the stream pointer. Even if the
                    // unmarshaling fails, the stream is still released）。如果让 Rust
                    // 包装器在作用域结束再 Drop 一次，就是对同一个流 Release 两次
                    // ——引用计数下溢、堆损坏，进程直接崩（2026-09-27 现场：一进原生
                    // PDF 页就 "ibm-lab-desktop has stopped working"）。
                    let marshaled = core::mem::ManuallyDrop::new(unsafe {
                        IStream::from_raw(raw as *mut core::ffi::c_void)
                    });
                    let stream: IStream = unsafe { CoGetInterfaceAndReleaseStream(&*marshaled) }
                        .map_err(|error| {
                            format!("无法在工作线程还原 PDF 响应流（0x{:08X}）", error.code().0 as u32)
                        })?;
                    write_stream_to_file(
                        &stream,
                        &task_id,
                        &app,
                        content_length,
                        PDF_STREAM_MAX_WAIT,
                        offset,
                    )
                })();
                unsafe { CoUninitialize() };
                finish_payload_read(&app, &task_id, &payload_path, result, offset);
            });
        }
        Err(error) => {
            record(
                &app,
                "error",
                "",
                &format!(
                    "PDF 响应流无法封送到工作线程（0x{:08X}），改在当前线程读取",
                    error.code().0 as u32
                ),
            );
            let result = write_stream_to_file(
                &stream,
                &task_id,
                &app,
                content_length,
                INLINE_STREAM_MAX_WAIT,
                offset,
            );
            finish_payload_read(&app, &task_id, &payload_path, result, offset);
        }
    }
}

/// 把一次载荷读取的结果落定：部分字节也落盘（现场诊断要看得到文件），
/// 但**只有被证明完整的载荷才会被归档**（`complete` 决定一切）。
#[cfg(windows)]
fn finish_payload_read(
    app: &AppHandle,
    task_id: &str,
    payload_path: &Path,
    result: Result<PdfBodyResult, String>,
    offset: u64,
) {
    let Some(state) = app.try_state::<WebVpnState>() else {
        return;
    };
    match result {
        Ok(body) => {
            // 把这一段写到它在文件里的位置（不再整文件覆盖：那是分段装配的前提）。
            write_segment_at(payload_path, offset, &body.partial);
            state.finish_pdf_segment(task_id, offset, body.bytes, body.complete, body.note.clone());
            if !body.complete {
                record(
                    app,
                    "automation",
                    "",
                    &format!("PDF 载荷未收全：{}", body.note),
                );
            }
        }
        Err(error) => {
            state.finish_pdf_segment(task_id, offset, 0, false, error.clone());
            record(app, "error", "", &error);
        }
    }
    if let Some(webview) = app.get_webview(WINDOW_LABEL) {
        let _ = push_capture_ball(app, &webview);
    }
}

/// 载荷是否**被证明完整**——状态上报与归档校验必须用同一个函数。
///
/// 2026-09-27 现场 B1：这两处曾经各判各的 —— 状态按"收满这一次响应的
/// Content-Length"判定（一个 256 KiB 的**分段响应**也能满足），归档按"尾部有
/// %%EOF"判定。于是状态喊 `save-pdf-ready`、归档却拒收，契约与实现互相打架。
/// 现在只有这一个判据：PDF 头 + `%%EOF` 尾 + （声明总长已知时）收满。
#[cfg(windows)]
fn payload_is_whole(bytes: &[u8], declared_total: Option<u64>) -> bool {
    if !bytes.starts_with(b"%PDF-") {
        return false;
    }
    if !tail_has_eof(bytes) {
        return false;
    }
    match declared_total {
        Some(total) => bytes.len() as u64 >= total,
        // 声明总长未知时 `%%EOF` 就是唯一的正向证据（PDF 必须以此结束）。
        None => true,
    }
}

/// 响应是不是"分段/区间"响应。
///
/// 浏览器的 PDF 查看器会用 Range 请求分段取数，第一段常常正好是 256 KiB —— 把它当成
/// 整份文件，就会出现"256 KB 就报已完整"的那种事故（B1）。分段响应一律不进入载荷
/// 路径：宁可不提供保存支路，也不能给一个假的完成信号。
#[cfg(windows)]
fn is_partial_response(status: Option<u16>, content_range: Option<&str>) -> bool {
    status == Some(206) || content_range.is_some()
}

/// 解析 `Content-Range: bytes <start>-<end>/<total|*>`，返回起始偏移与总长。
fn parse_content_range(value: &str) -> Option<(u64, u64, Option<u64>)> {
    let rest = value.trim().strip_prefix("bytes")?.trim();
    let (range, total) = rest.split_once('/')?;
    let (start, end) = range.trim().split_once('-')?;
    let start = start.trim().parse::<u64>().ok()?;
    let end = end.trim().parse::<u64>().ok()?;
    if end < start {
        return None;
    }
    // total 可能是 `*`（未知）。
    let total = total.trim().parse::<u64>().ok();
    Some((start, end, total))
}

/// 查看器「另存为」产生的文件能不能当正文用。
///
/// 不能只看"保存成功"：原生 PDF 的文档壳是一段 HTML 查看器页面，`ShowSaveAsUI`
/// 保存的是**页面**，于是过去会把 ~1 KB 的 HTML 当 PDF 交上去（用户看到的就是
/// "保存工具全部无法正常保存，始终是 1KB"）。判据与插件端校验一致：
/// `%PDF-` 头 + 尾部 `%%EOF` + 至少 8 KiB。
#[cfg(windows)]
fn viewer_saved_pdf_is_usable(path: &Path) -> Result<u64, String> {
    let Ok(bytes) = fs::read(path) else {
        return Err("查看器保存没有产生文件；该站点请改用下载入口".to_string());
    };
    let size = bytes.len() as u64;
    if !bytes.starts_with(b"%PDF-") {
        let html = bytes.starts_with(b"<!doctype html") || bytes.starts_with(b"<html");
        return Err(if html {
            format!(
                "查看器保存得到的是页面（{size} 字节），不是 PDF；该站点的 PDF 需要从下载事件或响应体获取"
            )
        } else {
            format!("查看器保存得到的不是 PDF（{size} 字节）；请改用下载入口")
        });
    }
    if !tail_has_eof(&bytes) {
        return Err(format!("查看器保存得到的 PDF 不完整（{size} 字节，尾部没有 %%EOF）"));
    }
    if size < CAPTURE_PDF_MIN_BYTES {
        return Err(format!("查看器保存得到的 PDF 只有 {size} 字节，疑似空文档；该站点请改用下载入口"));
    }
    Ok(size)
}

/// 把一段字节写到载荷文件的指定偏移（稀疏写；不截断已写入的其他段）。
#[cfg(windows)]
fn write_segment_at(path: &Path, offset: u64, bytes: &[u8]) {
    use std::io::{Seek, SeekFrom};
    let Ok(mut file) = fs::OpenOptions::new().create(true).write(true).open(path) else {
        return;
    };
    if file.seek(SeekFrom::Start(offset)).is_err() {
        return;
    }
    let _ = file.write_all(bytes);
}

/// 区间并集覆盖的字节数。
fn covered_bytes(segments: &[(u64, u64)]) -> u64 {
    let mut sorted = segments.to_vec();
    sorted.sort_unstable();
    let mut covered = 0_u64;
    let mut cursor: Option<(u64, u64)> = None;
    for (start, end) in sorted {
        if end <= start {
            continue;
        }
        match cursor {
            Some((current_start, current_end)) if start <= current_end => {
                cursor = Some((current_start, current_end.max(end)));
            }
            Some((current_start, current_end)) => {
                covered = covered.saturating_add(current_end - current_start);
                cursor = Some((start, end));
            }
            None => cursor = Some((start, end)),
        }
    }
    if let Some((current_start, current_end)) = cursor {
        covered = covered.saturating_add(current_end - current_start);
    }
    covered
}

/// 区间并集是否**从 0 开始连续覆盖到 total**——这才是"整份文件都在手上"的正向证明。
fn covers_from_zero(segments: &[(u64, u64)], total: u64) -> bool {
    let mut sorted = segments.to_vec();
    sorted.sort_unstable();
    let mut reach = 0_u64;
    for (start, end) in sorted {
        if end <= start || start > reach {
            // 中间有洞（或起点在已覆盖范围之后）：不连续。
            if start > reach {
                return false;
            }
            continue;
        }
        reach = reach.max(end);
        if reach >= total {
            return true;
        }
    }
    reach >= total
}

/// PDF 是否以 `%%EOF` 结束（结构完整的最后一道证据）。
///
/// 只看尾部 4 KiB：线性化 PDF 的 `%%EOF` 也在文件末尾，前面还有一段 startxref。
fn tail_has_eof(body: &[u8]) -> bool {
    let tail = if body.len() > 4096 { &body[body.len() - 4096..] } else { body };
    tail.windows(5).any(|window| window == b"%%EOF")
}

/// 由用户从浮层按钮触发的 PDF 查看器下载。
///
/// 与 Agent 走 `lab_browser_download_viewer_pdf` 完全同一条实现，
/// 区别只是发起者是人：结果写进日志与任务行，不需要调用方再查操作状态。
#[cfg(windows)]
pub fn request_native_save(app: &AppHandle) {
    let Some(webview) = app.get_webview(WINDOW_LABEL) else {
        return;
    };
    let Some(task_id) = app
        .try_state::<WebVpnState>()
        .and_then(|state| state.pending_task_id())
    else {
        record(app, "capture", "", "浮层保存被忽略：当前没有进行中的捕获任务");
        return;
    };
    let task_app = app.clone();
    tauri::async_runtime::spawn(async move {
        match download_viewer_pdf(&task_app, &task_id, &webview).await {
            Ok(value) => {
                let bytes = value.get("bytes").and_then(|item| item.as_u64()).unwrap_or(0);
                record(
                    &task_app,
                    "captureCompleted",
                    "",
                    &format!("用户从浮层保存并归档完成（{bytes} 字节）"),
                );
            }
            Err(error) => record(&task_app, "error", "", &format!("浮层保存失败：{error}")),
        }
        let _ = push_capture_ball(&task_app, &webview);
    });
}

#[cfg(not(windows))]
pub fn request_native_save(_app: &AppHandle) {}

/// 把已经落盘的 PDF 载荷归档到课题，并等到终态（C4）。
#[cfg(windows)]
async fn finalize_native_save(
    app: &AppHandle,
    state: &WebVpnState,
    task_id: &str,
    path: &Path,
    webview: &Webview,
) -> Result<serde_json::Value, String> {
    // 归档前的三道校验（C1/D2）：头是 PDF、尾有 %%EOF、大小对得上 Content-Length。
    // 少了任何一道，半个文件就会被送到归档服务，换回一个 HTTP 400 —— 调用方看到的
    // 却是"保存失败"，而真正的原因（载荷没下完）已经丢失。
    let head = fs::read(path).map_err(|error| format!("无法读取已落盘的 PDF: {error}"))?;
    if !head.starts_with(b"%PDF-") {
        let reason = "响应体不是 PDF（页面可能只是 HTML 预览），不能作为原文归档".to_string();
        state.fail_pending_download(app, &reason);
        return Err(reason);
    }
    // 与状态上报同一个判据：头 + %%EOF + 声明总长。两处曾经各判各的，于是
    // 状态喊"已完整"、这里拒收（B1）。
    // 原生另存为写入的文件与响应层缓存不是同一对象；仅在归档响应层载荷时
    // 才使用它的 Content-Length 校验。原生文件仍要求 PDF 头与 %%EOF。
    let declared_total = state.pdf_payload_ready(task_id)
        .filter(|payload_path| payload_path == path)
        .and_then(|_| state.pdf_payload_total(task_id));
    if !payload_is_whole(&head, declared_total) {
        return Err(format!(
            "PDF 载荷不完整（已接收 {} 字节{}{}），未归档；请重试保存，或改用带 ?download=true 的下载入口",
            head.len(),
            declared_total
                .map(|total| format!(" / {total}"))
                .unwrap_or_default(),
            if tail_has_eof(&head) { "" } else { "，尾部没有 %%EOF" }
        ));
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

/// 直接让 WebView2 对当前文档执行“另存为”，并把系统对话框替换成任务暂存路径。
/// 这与用户在查看器里按 Ctrl+S 属于同一浏览器命令，不访问 PDF 扩展的内部 DOM。
#[cfg(windows)]
async fn save_current_pdf_with_webview(
    app: &AppHandle,
    task_id: &str,
    webview: &Webview,
    destination: &Path,
) -> Result<String, String> {
    let (sender, receiver) = std::sync::mpsc::channel::<Result<(i64, i32), String>>();
    let mime_seen = std::sync::Arc::new(Mutex::new(None::<String>));
    let mime_for_event = mime_seen.clone();
    let event_token = std::sync::Arc::new(Mutex::new(None::<i64>));
    let token_for_registration = event_token.clone();
    let save_app = app.clone();
    let save_task = task_id.to_string();
    let save_path: Vec<u16> = destination.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    webview.with_webview(move |platform| {
        let core = match unsafe { platform.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(_) => { let _ = sender.send(Err("无法取得 WebView2 当前文档".to_string())); return; }
        };
        let core25 = match core.cast::<ICoreWebView2_25>() {
            Ok(core25) => core25,
            Err(_) => { let _ = sender.send(Err("当前 WebView2 运行时不支持原生另存为接口".to_string())); return; }
        };
        let showing = SaveAsUIShowingEventHandler::create(Box::new(move |_sender, args| {
            if let Some(args) = args {
                let mut mime_ptr = PWSTR::null();
                let mime = if unsafe { args.ContentMimeType(&mut mime_ptr) }.is_ok() {
                    take_pwstr(mime_ptr).to_ascii_lowercase()
                } else { "unknown".to_string() };
                if let Ok(mut seen) = mime_for_event.lock() { *seen = Some(mime.clone()); }
                if !mime.starts_with("application/pdf") {
                    let _ = unsafe { args.SetCancel(true) };
                } else {
                    let configured = unsafe {
                        args.SetSuppressDefaultDialog(true)
                            .and_then(|_| args.SetSaveAsFilePath(PCWSTR(save_path.as_ptr())))
                            .and_then(|_| args.SetAllowReplace(false))
                            .and_then(|_| args.SetKind(COREWEBVIEW2_SAVE_AS_KIND_DEFAULT))
                    };
                    if configured.is_ok() {
                        if let Some(state) = save_app.try_state::<WebVpnState>() {
                            state.mark_viewer_save_started(&save_task);
                        }
                    } else {
                        let _ = unsafe { args.SetCancel(true) };
                    }
                }
            }
            Ok(())
        }));
        let mut token = 0_i64;
        if unsafe { core25.add_SaveAsUIShowing(&showing, &mut token) }.is_err() {
            let _ = sender.send(Err("无法监听 WebView2 原生另存为事件".to_string()));
            return;
        }
        if let Ok(mut saved) = token_for_registration.lock() { *saved = Some(token); }
        let completed = sender.clone();
        let handler = ShowSaveAsUICompletedHandler::create(Box::new(move |status, result| {
            let code = if status.is_ok() { result.0 } else { -1 };
            let _ = completed.send(Ok((token, code)));
            Ok(())
        }));
        if unsafe { core25.ShowSaveAsUI(&handler) }.is_err() {
            let _ = unsafe { core25.remove_SaveAsUIShowing(token) };
            let _ = sender.send(Err("WebView2 无法启动当前 PDF 的原生另存为".to_string()));
        }
    }).map_err(|_| "无法向 WebView2 发送原生另存为命令".to_string())?;
    let wait = tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(45)))
        .await;
    let registered_token = event_token.lock().ok().and_then(|saved| *saved);
    if let Some(token) = registered_token {
        let _ = webview.with_webview(move |platform| {
            if let Ok(core) = unsafe { platform.controller().CoreWebView2() } {
                if let Ok(core25) = core.cast::<ICoreWebView2_25>() {
                    let _ = unsafe { core25.remove_SaveAsUIShowing(token) };
                }
            }
        });
    }
    let mime = mime_seen.lock().ok().and_then(|seen| seen.clone()).unwrap_or_else(|| "unknown".to_string());
    let reply = wait.map_err(|_| "WebView2 原生另存为等待中断".to_string())?;
    // 完成回调可能比文件写入晚。事件已确认是 PDF 时继续观察实际文件，
    // 避免回调超时后把仍在写入的任务目标交给人工保存并发生竞争。
    let result = match reply {
        Ok(Ok((_, result))) => Some(result),
        Ok(Err(error)) => return Err(error),
        Err(_) if mime.starts_with("application/pdf") => None,
        Err(_) => return Err(format!("WebView2 原生另存为响应超时（contentType={mime}）")),
    };
    if let Some(result) = result {
        if result != COREWEBVIEW2_SAVE_AS_UI_RESULT_SUCCESS.0 {
            return Err(format!("WebView2 原生另存为未成功（result={result}，contentType={mime}）"));
        }
    }
    if !mime.starts_with("application/pdf") {
        return Err(format!("当前另存为对象不是 PDF（contentType={mime}）"));
    }
    Ok(mime)
}

/// Agent 原生 PDF 最后一步：通过 WebView2 原生“另存为”保存当前 PDF，
/// 按任务暂存文件实际写入字节上报进度，校验完成后归档。
#[cfg(windows)]
async fn download_viewer_pdf(
    app: &AppHandle,
    task_id: &str,
    webview: &Webview,
) -> Result<serde_json::Value, String> {
    let state = app.try_state::<WebVpnState>().ok_or("文献浏览器状态不可用")?;
    if let Some(path) = state.pdf_payload_ready(task_id) {
        return finalize_native_save(app, &state, task_id, &path, webview).await;
    }
    let current = webview.url().map_err(|_| "无法读取 PDF 页面地址".to_string())?;
    if !state.is_current_pdf_document(task_id, &current) {
        return Err("当前顶层文档不是已确认的原生 PDF；出版社网页预览器请先观察并点击页面上的 Download PDF 入口".to_string());
    }
    let generation = state.pending_generation(task_id).ok_or("当前文献任务已经结束")?;
    state.begin_viewer_save_action(task_id)?;
    let destination = state.viewer_save_destination(task_id)?;
    if destination.exists() {
        state.clear_viewer_save_action(task_id);
        return Err("当前任务暂存路径已有文件，请先查询任务状态，避免覆盖已下载产物".to_string());
    }
    let mime = match save_current_pdf_with_webview(app, task_id, webview, &destination).await {
        Ok(mime) => mime,
        Err(error) => {
            state.clear_viewer_save_action(task_id);
            record(app, "viewerNativeSave", current.as_str(), &format!("原生另存为未启动：{error}"));
            return Err(format!("{error}；请在侧栏 PDF 查看器按 Ctrl+S，壳会自动捕获归档，无需回传路径"));
        }
    };
    record(app, "viewerNativeSave", current.as_str(), &format!("原生另存为已接受（contentType={mime}）；等待任务文件写入"));
    let _ = push_capture_ball(app, webview);
    let poll_app = app.clone();
    let poll_task_id = task_id.to_string();
    let poll_path = destination.clone();
    let route = tauri::async_runtime::spawn_blocking(move || {
        let deadline = Instant::now() + Duration::from_secs(100);
        let mut last_bytes = 0_u64;
        let mut last_growth = Instant::now();
        loop {
            let Some(state) = poll_app.try_state::<WebVpnState>() else {
                return Err("文献浏览器状态不可用".to_string());
            };
            if state.download_claimed_for(&poll_task_id)
                || state.wait_for_outcome(generation, Duration::ZERO).is_some() {
                return Ok("download-event");
            }
            if state.pending_generation(&poll_task_id) != Some(generation) {
                return Err("当前文献任务已结束".to_string());
            }
            if let Ok(metadata) = fs::metadata(&poll_path) {
                let bytes = metadata.len();
                if bytes != last_bytes { last_bytes = bytes; last_growth = Instant::now(); }
                if bytes >= 5 {
                    let mut prefix = [0_u8; 5];
                    if fs::File::open(&poll_path).and_then(|mut file| file.read_exact(&mut prefix)).is_ok()
                        && &prefix != b"%PDF-" {
                        return Err(format!("原生另存为写入的不是 PDF（已写入 {bytes} 字节）"));
                    }
                }
                if bytes >= 5 && last_growth.elapsed() >= Duration::from_millis(800)
                    && file_is_whole(&poll_path) {
                    return Ok("native-file");
                }
            }
            if Instant::now() >= deadline || last_growth.elapsed() >= Duration::from_secs(12) {
                return Err(format!("原生另存为未写出完整 PDF（已写入 {last_bytes} 字节）"));
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }).await.map_err(|_| "等待原生另存为结果中断".to_string())?;
    match route {
        Ok("native-file") => {
            if state.claim_native_saved_file(task_id) {
                return finalize_native_save(app, &state, task_id, &destination, webview).await;
            }
        }
        Ok(_) => {}
        Err(error) => {
            state.clear_viewer_save_action(task_id);
            let evidence = if destination.exists() {
                let is_pdf = fs::File::open(&destination).and_then(|mut file| {
                    let mut prefix = [0_u8; 5];
                    file.read_exact(&mut prefix).map(|_| &prefix == b"%PDF-")
                }).unwrap_or(false);
                let target = destination.with_extension(if is_pdf { "partial.pdf" } else { "notpdf.bin" });
                Some(fs::rename(&destination, &target).map(|_| target).unwrap_or(destination.clone()))
            } else { None };
            let detail = format!("{error}{}", evidence.as_ref()
                .map(|path| format!("；诊断文件 {}", path.display())).unwrap_or_default());
            record(app, "viewerNativeSave", current.as_str(), &detail);
            return Err(format!("{detail}；请在侧栏 PDF 查看器按 Ctrl+S，壳会自动捕获归档，无需回传路径"));
        }
    }
    let wait_app = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        wait_app.try_state::<WebVpnState>()
            .and_then(|state| state.wait_for_outcome(generation, Duration::from_secs(100)))
    }).await.map_err(|_| "等待 PDF 归档中断".to_string())?;
    match outcome {
        Some(outcome) if outcome.ok => Ok(serde_json::json!({
            "status": "completed", "phase": "completed",
            "bytes": outcome.bytes, "sha256": outcome.sha256
        })),
        Some(outcome) => Err(outcome.error.unwrap_or_else(|| "PDF 归档失败".to_string())),
        None => Err("PDF 已下载，但归档结果尚未确认；请查询任务状态".to_string()),
    }
}

#[cfg(not(windows))]
async fn download_viewer_pdf(
    _app: &AppHandle,
    _task_id: &str,
    _webview: &Webview,
) -> Result<serde_json::Value, String> {
    Err("原生 PDF 下载仅在 Windows 桌面端可用".to_string())
}

/// 只从当前 Science 正文/预览页构造本篇 DOI 的附件入口。其他出版社不猜 URL。
fn science_pdf_download_route(current: &url::Url) -> Result<url::Url, String> {
    if current.scheme() != "https" || current.port().is_some()
        || !matches!(current.host_str(), Some("science.org" | "www.science.org")) {
        return Err("备用入口仅支持 Science 官方页面".to_string());
    }
    let path = current.path();
    let doi = ["/doi/epdf/", "/doi/reader/", "/doi/pdf/", "/doi/"]
        .iter()
        .find_map(|prefix| path.strip_prefix(prefix))
        .ok_or("当前页面不是 Science 正文或预览页")?;
    let suffix = doi.strip_prefix("10.1126/").ok_or("当前页面 DOI 不是 Science 论文")?;
    if suffix.is_empty() || !suffix.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_')) {
        return Err("Science DOI 路径不符合备用入口规则".to_string());
    }
    let mut target = current.clone();
    if current.path().starts_with("/doi/pdf/") && current.query_pairs().any(|(key, value)| key == "download" && value == "true") {
        return Err("当前已经是备用下载入口".to_string());
    }
    target.set_path(&format!("/doi/pdf/{doi}"));
    target.set_query(Some("download=true"));
    target.set_fragment(None);
    if target == *current {
        return Err("当前已经是备用下载入口".to_string());
    }
    Ok(target)
}

pub async fn browser_action(
    app: &AppHandle,
    task_id: &str,
    action: &str,
    observation_id: &str,
    element_id: &str,
    scope: &str,
    route_id: &str,
    expected_page_seq: u64,
) -> Result<serde_json::Value, String> {
    let state = app.try_state::<WebVpnState>().ok_or("文献浏览器状态不可用")?;
    if state.pending_task_id().as_deref() != Some(task_id) {
        return Err("浏览器动作与当前文献任务不匹配".to_string());
    }
    let webview = app.get_webview(WINDOW_LABEL).ok_or("文献浏览器尚未打开")?;
    match action {
        "debug" => {
            #[cfg(windows)]
            { debug_browser_snapshot(&state, &webview).await }
            #[cfg(not(windows))]
            { Err("CDP 调试快照仅在 Windows 桌面端可用".to_string()) }
        }
        "navigate" => {
            if route_id != "science-pdf" {
                return Err("未知备用入口".to_string());
            }
            let current = webview.url().map_err(|error| error.to_string())?;
            let target = science_pdf_download_route(&current)?;
            state.claim_science_fallback(task_id, expected_page_seq, &current)?;
            webview.navigate(target).map_err(|error| error.to_string())?;
            Ok(serde_json::json!({ "navigated": true, "routeId": route_id }))
        }
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
                if action == "click" && state.verification_pending() {
                    return Err("当前页面需要人机验证；请由用户在侧栏完成，随后重新观察页面".to_string());
                }
                let mut value = eval_agent_script(&webview, script).await?;
                if let Some(error) = value.get("error").and_then(|item| item.as_str()) {
                    return Err(error.to_string());
                }
                if action == "observe" {
                    let challenge = observation_requires_verification(&value);
                    state.set_automation_stage(if challenge { "verification" } else { "manual" });
                    if let Some(object) = value.as_object_mut() {
                        object.insert("verificationRequired".to_string(), serde_json::json!(challenge));
                        if challenge {
                            // Agent 不操作验证控件；用户完成后重新观察同一文章页。
                            object.insert("candidates".to_string(), serde_json::json!([]));
                        }
                    }
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
        "viewer-download" => download_viewer_pdf(app, task_id, &webview).await,
        _ => Err("不支持的浏览器动作".to_string()),
    }
}

fn observation_requires_verification(value: &serde_json::Value) -> bool {
    let title = value.get("title").and_then(|item| item.as_str()).unwrap_or("").to_lowercase();
    let body = value.get("text").and_then(|item| item.as_str()).unwrap_or("").to_lowercase();
    ["are you a robot", "verify you are human", "confirm you are a human", "completing the captcha challenge", "验证您是人类", "人机验证"]
        .iter().any(|marker| body.contains(marker))
        || (title.contains("请稍候") || title.contains("just a moment"))
            && (body.contains("cloudflare") || body.contains("checking your browser"))
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
    if url.host_str() == Some("viewer-download") {
        // 右下角浮层「保存到课题」。与 cancel-capture 同理：不在 WebView2 的回调栈里
        // 直接跑长任务，先调度到下一拍，再由 request_native_save 起一个异步任务。
        let scheduled_app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(10));
            request_native_save(&scheduled_app);
        });
        record(app, "capture", "", "用户从右下角浮层请求保存并归档");
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
                    // 原生 PDF 查看器不属于网页 DOM。Agent 通过受限的
                    // viewer-download 动作经当前 WebView2 网络会话读取 PDF 并归档。
                    if let Some(state) = page_app.try_state::<WebVpnState>() {
                        state.set_automation_stage("manual");
                    }
                    record(
                        &page_app,
                        "automation",
                        "",
                        "已进入原生 PDF 预览器；可直接调用保存工具归档，无需右键另存",
                    );
                    // 位移：避免查看器自带的保存/下载工具栏被导航栏盖住。
                    let _ = webview.eval(
                        "window.__ibmWebVpnSetPageOffset && window.__ibmWebVpnSetPageOffset(true)",
                    );
                }
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
                                state.fail_pending_download(&download_app, "WebVPN 页面下载失败，请重新发起捕获");
                            }
                        }
                    } else if let Some(path) = path.as_deref() {
                        if let Some(upload) = state.and_then(|state| state.begin_upload(path)) {
                            let upload_app = download_app.clone();
                            std::thread::spawn(move || upload_capture(upload_app, upload));
                        } else if let Some(state) = download_app.try_state::<WebVpnState>() {
                            state.fail_pending_download(
                                &download_app,
                                "WebVPN 下载文件与当前捕获任务不匹配，请重试",
                            );
                        }
                    } else if let Some(state) = state {
                        state
                            .fail_pending_download(&download_app, "WebVPN 下载完成，但系统未返回文件路径，请重试");
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

    #[test]
    fn observation_marks_real_human_challenge_without_matching_article_text() {
        assert!(observation_requires_verification(&serde_json::json!({
            "title": "请稍候…",
            "text": "Are you a robot? Please confirm you are a human by completing the captcha challenge below."
        })));
        assert!(observation_requires_verification(&serde_json::json!({
            "title": "Just a moment...", "text": "Checking your browser before accessing Cloudflare"
        })));
        assert!(!observation_requires_verification(&serde_json::json!({
            "title": "Biosensors and Bioelectronics", "text": "This article evaluates a captcha challenge in user testing."
        })));
    }

    #[test]
    fn science_fallback_stays_on_the_same_article_and_off_other_hosts() {
        let reader = url::Url::parse("https://www.science.org/doi/epdf/10.1126/science.adz5300").unwrap();
        assert_eq!(
            science_pdf_download_route(&reader).unwrap().as_str(),
            "https://www.science.org/doi/pdf/10.1126/science.adz5300?download=true"
        );
        for rejected in [
            "https://www.nature.com/doi/epdf/10.1126/science.adz5300",
            "https://evilscience.org/doi/epdf/10.1126/science.adz5300",
            "https://www.science.org/doi/epdf/10.1126/science.adz5300/other",
            "https://www.science.org/doi/pdf/10.1126/science.adz5300?download=true",
        ] {
            assert!(science_pdf_download_route(&url::Url::parse(rejected).unwrap()).is_err(), "{rejected}");
        }
    }

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

    #[test]
    fn new_document_does_not_inherit_previous_pdf_response_length() {
        let state = WebVpnState::default();
        let first = "https://example.org/old.pdf";
        let next = "https://example.org/new.pdf";
        state.record_page_event(first, "loading");
        state.record_document_response(first, Some("application/pdf"), Some(4096), Some(206));
        state.record_page_event(next, "loading");
        let session = state.session.lock().unwrap();
        let page = session.page.as_ref().unwrap();
        assert_eq!(page.url, next);
        assert_eq!(page.http_status, None);
        assert_eq!(page.content_length, None);
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
                false,
                upload,
                std::env::temp_dir().join("capture-iwan-si.pdf"),
            )
            .unwrap();
        assert!(
            !state.should_capture_direct_si_preview(&target),
            "iWAN 模式应让 WebView2 原生直连 SI，不得交给 reqwest 拦截器"
        );
        assert!(state.pending_pdf_target(target.as_str()).is_some(),
            "iWAN 下 SI PDF 的完整响应可走载荷通路");
        assert!(state.pending_pdf_target("https://evil.example/other.pdf").is_none());
    }

    #[test]
    fn agent_clicked_public_nature_si_can_use_direct_capture() {
        let state = WebVpnState::default();
        state.transition(WebVpnSessionState::Opening).unwrap();
        state.transition(WebVpnSessionState::Ready).unwrap();
        let upload = url::Url::parse("http://127.0.0.1:3080/api/lab-capture-upload?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDE").unwrap();
        state.prepare_capture("capture-agent-si", "si", "doi.org", PublisherAdapter::Nature,
            true, upload, std::env::temp_dir().join("capture-agent-si.pdf")).unwrap();
        let target = url::Url::parse("https://media.springernature.com/full/springer-static/41586_2026_11032_MOESM1_ESM.pdf").unwrap();
        assert!(state.should_capture_direct_si_preview(&target));
        assert!(state.begin_viewer_save_action("capture-agent-si").is_ok(),
            "SI 任务显示原生 PDF 后也可进入查看器保存通路");
    }

    #[test]
    fn failed_native_save_releases_destination_for_manual_save() {
        let state = WebVpnState::default();
        state.transition(WebVpnSessionState::Opening).unwrap();
        state.transition(WebVpnSessionState::Ready).unwrap();
        let path = std::env::temp_dir().join(format!("ibm-direct-pdf-abort-{}.pdf", std::process::id()));
        let upload = url::Url::parse("http://127.0.0.1:3080/api/lab-capture-upload?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDE").unwrap();
        state.prepare_capture("capture-direct-abort", "pdf", "doi.org", PublisherAdapter::Elsevier,
            false, upload, path.clone()).unwrap();
        state.begin_viewer_save_action("capture-direct-abort").unwrap();
        assert_eq!(state.viewer_save_destination("capture-direct-abort").unwrap(), path);
        state.mark_viewer_save_started("capture-direct-abort");
        assert!(!state.download_claimed_for("capture-direct-abort"), "原生保存不能抢占浏览器下载事件");
        state.clear_viewer_save_action("capture-direct-abort");
        assert_eq!(state.state(), WebVpnSessionState::WaitingDownload);
        assert!(matches!(state.claim_download_destination(), DownloadDecision::Capture(ref target) if target == &path),
            "人工 Ctrl+S 应可重新认领同一个任务目标");
    }

    #[test]
    fn completed_native_save_claims_file_before_upload() {
        let state = WebVpnState::default();
        state.transition(WebVpnSessionState::Opening).unwrap();
        state.transition(WebVpnSessionState::Ready).unwrap();
        let upload = url::Url::parse("http://127.0.0.1:3080/api/lab-capture-upload?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDE").unwrap();
        state.prepare_capture("capture-native-save", "pdf", "doi.org", PublisherAdapter::Elsevier,
            false, upload, std::env::temp_dir().join("capture-native-save.pdf")).unwrap();
        state.begin_viewer_save_action("capture-native-save").unwrap();
        state.mark_viewer_save_started("capture-native-save");
        assert!(state.claim_native_saved_file("capture-native-save"));
        assert!(state.download_claimed_for("capture-native-save"));
        assert!(matches!(state.claim_download_destination(), DownloadDecision::Duplicate));
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

    /// 载荷完整性必须来自正向证明（2026-09-27 现场：262144 B 的半截 PDF 被标成
    /// "已就绪"，一路送到归档服务换回 HTTP 400，而真实原因已经丢失）。
    #[test]
    fn pdf_payload_completeness_requires_positive_proof() {
        // 尾部有 %%EOF：结构完整。
        let mut body = b"%PDF-1.4\n".to_vec();
        body.extend_from_slice(&vec![b'x'; 40_000]);
        body.extend_from_slice(b"\nstartxref\n123\n%%EOF\n");
        assert!(tail_has_eof(&body), "%%EOF 在尾部 4 KiB 内必须被认出来");

        // 半截载荷（恰好 256 KiB，有头没有尾）：绝不完整。
        let mut partial = b"%PDF-1.3\n".to_vec();
        partial.extend_from_slice(&vec![0_u8; 262_144 - partial.len()]);
        assert!(!tail_has_eof(&partial), "没有 %%EOF 就不能算完整");

        // 只有头部字节：连 PDF 都不是。
        assert!(!tail_has_eof(b"%PDF-"));
        assert!(!tail_has_eof(b""));
    }

    /// 完整性只有一个判据，而且必须是**正向证明**（2026-09-27 现场 B1：一个 256 KiB
    /// 的分段响应被当成整份文件，状态喊 save-pdf-ready、归档却拒收）。
    #[test]
    fn payload_completeness_is_one_positive_predicate() {
        let mut whole = b"%PDF-1.4\n".to_vec();
        whole.extend_from_slice(&vec![b'x'; 40_000]);
        whole.extend_from_slice(b"\nstartxref\n123\n%%EOF\n");

        // 完整 + 收满声明总长 → 完整
        assert!(payload_is_whole(&whole, Some(whole.len() as u64)));
        // 完整但没到声明总长（服务器说了更大的数）→ 不算完整
        assert!(!payload_is_whole(&whole, Some(whole.len() as u64 + 1)));
        // 声明总长未知时，%%EOF 是唯一的正向证据
        assert!(payload_is_whole(&whole, None));

        // 半截载荷：有 PDF 头、没有 %%EOF，哪怕"收满"了那一次响应的 Content-Length 也不算
        let mut partial = b"%PDF-1.3\n".to_vec();
        partial.extend_from_slice(&vec![0_u8; 262_144 - partial.len()]);
        assert!(!payload_is_whole(&partial, Some(partial.len() as u64)));
        assert!(!payload_is_whole(&partial, None));
        // 不是 PDF：直接否
        assert!(!payload_is_whole(b"<html>preview</html>", None));
        assert!(!payload_is_whole(b"", None));
    }

    /// 分段不是噪声，是要装配的东西（2026-09-28 现场：Wiley 的 4.4 MB PDF 由 18 个
    /// 256 KiB 的 Range 请求组成；旧实现把它们全部跳过 → 载荷永远收不全）。
    #[test]
    fn content_range_is_parsed_and_ranges_are_assembled() {
        assert_eq!(parse_content_range("bytes 0-262143/4594707"), Some((0, 262143, Some(4594707))));
        assert_eq!(
            parse_content_range("bytes 4456448-4594706/4594707"),
            Some((4456448, 4594706, Some(4594707)))
        );
        assert_eq!(parse_content_range("bytes 253889-253889/536963"), Some((253889, 253889, Some(536963))));
        // 总长未知（`*`）与畸形输入
        assert_eq!(parse_content_range("bytes 0-99/*"), Some((0, 99, None)));
        assert_eq!(parse_content_range("bytes 100-99/200"), None);
        assert_eq!(parse_content_range("items 0-99/200"), None);
        assert_eq!(parse_content_range(""), None);

        // 18 段拼起来必须被认出"整份都在手上"
        let total = 4_594_707_u64;
        let mut segments = Vec::new();
        let mut start = 0_u64;
        while start < total {
            let end = (start + 262_144).min(total);
            segments.push((start, end));
            start = end;
        }
        assert_eq!(covered_bytes(&segments), total);
        assert!(covers_from_zero(&segments, total));

        // 乱序到达也一样
        let mut shuffled = segments.clone();
        shuffled.rotate_left(7);
        assert!(covers_from_zero(&shuffled, total));

        // 缺中间一段 → 不算完整（这正是"永远收不全"的形状）
        let mut holed = segments.clone();
        holed.remove(9);
        assert!(!covers_from_zero(&holed, total));
        assert!(covered_bytes(&holed) < total);

        // 只有尾部那段 → 不完整（旧实现会把它当成"有内容了"）
        assert!(!covers_from_zero(&[(4_456_448, total)], total));
        // 重复段不重复计数
        assert_eq!(covered_bytes(&[(0, 100), (0, 100), (50, 150)]), 150);
        assert_eq!(covered_bytes(&[]), 0);
    }

    #[test]
    fn viewer_save_that_returns_a_page_is_not_a_pdf() {
        let dir = std::env::temp_dir().join(format!("ibm-viewer-save-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();

        // 原生 PDF 的文档壳就是这段 HTML（348 字节）——以前会被当成 PDF 归档（“始终是 1KB”）。
        let shell = dir.join("viewer-shell.pdf");
        fs::write(
            &shell,
            b"<!doctype html><html><body><embed src='about:blank' type='application/pdf'></body></html>",
        )
        .unwrap();
        let reason = viewer_saved_pdf_is_usable(&shell).unwrap_err();
        assert!(reason.contains("页面"), "{reason}");

        // 头尾都对但太小：空文档，也不能当正文。
        let tiny = dir.join("tiny.pdf");
        fs::write(&tiny, b"%PDF-1.4\ntrailer\n%%EOF\n").unwrap();
        assert!(viewer_saved_pdf_is_usable(&tiny).unwrap_err().contains("空文档"));

        // 缺 %%EOF：不完整。
        let truncated = dir.join("truncated.pdf");
        let mut body = b"%PDF-1.4\n".to_vec();
        body.extend_from_slice(&vec![b'x'; 20_000]);
        fs::write(&truncated, &body).unwrap();
        assert!(viewer_saved_pdf_is_usable(&truncated).unwrap_err().contains("%%EOF"));

        // 正常 PDF：放行并给出体积。
        let good = dir.join("good.pdf");
        let mut body = b"%PDF-1.4\n".to_vec();
        body.extend_from_slice(&vec![b'x'; 20_000]);
        body.extend_from_slice(b"\nstartxref\n1\n%%EOF\n");
        fs::write(&good, &body).unwrap();
        assert_eq!(viewer_saved_pdf_is_usable(&good).unwrap(), body.len() as u64);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn partial_responses_are_never_treated_as_the_payload() {
        // 浏览器 PDF 查看器用 Range 分段取数：第一段常常正好 256 KiB
        assert!(is_partial_response(Some(206), None));
        assert!(is_partial_response(Some(200), Some("bytes 0-262143/2744110")));
        assert!(is_partial_response(None, Some("bytes 0-1/9")));
        // 整份响应才放行
        assert!(!is_partial_response(Some(200), None));
        assert!(!is_partial_response(None, None));
    }

    #[test]
    fn incomplete_download_fails_and_keeps_the_evidence_file() {
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
                false,
                url::Url::parse("http://127.0.0.1:3080/api/lab-capture-upload?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDE").unwrap(),
                path.clone(),
            )
            .unwrap();
        // 半截/非 PDF：必须判失败，并且**保留文件**（B5）而不是删掉。
        state.fail_pending_download_without_app("下载失败");
        let status = state.status(&WebVpnConfig::default(), true);
        assert_eq!(status.state, WebVpnSessionState::Error);
        assert!(status
            .last_error
            .as_deref()
            .unwrap_or_default()
            .starts_with("下载失败"), "失败原因要保留原句并附上证据文件路径");
        let _ = std::fs::remove_file(&path);
        assert!(status.pending_task_id.is_none());
        assert!(!path.exists());
    }

    #[test]
    fn successful_archive_removes_html_viewer_payload_cache() {
        let state = WebVpnState::default();
        state.transition(WebVpnSessionState::Opening).unwrap();
        state.transition(WebVpnSessionState::Ready).unwrap();
        let path = std::env::temp_dir().join(format!("capture-cleanup-{}.pdf", std::process::id()));
        let payload_path = pdf_payload_path(&path);
        fs::write(&payload_path, b"<!doctype html><html></html>").unwrap();
        let generation = state.prepare_capture(
            "capture-cleanup", "pdf", "www.sciencedirect.com", PublisherAdapter::Elsevier,
            false,
            url::Url::parse("http://127.0.0.1:3080/api/lab-capture-upload?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDE").unwrap(),
            path,
        ).unwrap();
        state.session.lock().unwrap().pending.as_mut().unwrap().pdf_payload = Some(PdfPayload {
            content_length: Some(348), received_bytes: 348, segments: vec![],
            path: payload_path.clone(), complete: false,
            error: Some("wrong-object-html: HTML 查看器".to_string()),
        });
        state.finish_upload(generation, Ok(()), Some(2_151_133));
        assert!(!payload_path.exists());
    }

    #[test]
    fn stale_cleanup_only_removes_small_html_capture_payloads() {
        let dir = std::env::temp_dir().join(format!("ibm-payload-cleanup-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let html = dir.join("capture-old-pdf.payload.pdf");
        let pdf = dir.join("capture-good-pdf.payload.pdf");
        let recent = dir.join("capture-recent-pdf.payload.pdf");
        fs::write(&html, b"<!doctype html><html></html>").unwrap();
        fs::write(&pdf, b"%PDF-1.7\n%%EOF").unwrap();
        fs::write(&recent, b"<!doctype html><html></html>").unwrap();
        let old = std::time::SystemTime::now() - Duration::from_secs(600);
        for path in [&html, &pdf] {
            fs::File::options().write(true).open(path).unwrap()
                .set_times(fs::FileTimes::new().set_modified(old)).unwrap();
        }
        cleanup_stale_html_viewer_payloads(&dir.join("capture-new-pdf.pdf"));
        assert!(!html.exists());
        assert!(pdf.exists());
        assert!(recent.exists());
        let _ = fs::remove_dir_all(dir);
    }
}
