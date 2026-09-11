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
//!   - 阶段 2（下载捕获）尚未接入：本模块只记录 `on_download`，不改写下载路径。

use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    utils::config::WebviewUrl,
    webview::{DownloadEvent, NewWindowResponse, WebviewWindowBuilder},
    AppHandle, Manager, WebviewWindow, WindowEvent,
};

use crate::runtime::WebVpnConfig;

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
            // 转发结束后回到 Ready：阶段 2 会在此之后进入 waiting-download。
            (Navigating, Ready) => true,
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

/// 会话内部状态。所有字段共用一个 Mutex，避免多锁的加锁顺序问题。
#[derive(Debug, Default)]
struct Session {
    state: WebVpnSessionState,
    policy: WebVpnPolicy,
    /// 最近一次由应用主动转发的目标 host。
    target_host: Option<String>,
    /// 被白名单拦下、尚未放行的 host。这是「白名单漏域名导致登录被锁死」
    /// 的逃生阀：UI 据此提示用户是否放行，而不是让用户面对一个静默空白页。
    denied_hosts: Vec<String>,
    last_error: Option<String>,
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
    /// WebVPN 窗口当前是否已创建（隐藏也算已创建）。
    pub window_open: bool,
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
        session.state = next;
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
        if matches!(
            session.state,
            WebVpnSessionState::Ready | WebVpnSessionState::Navigating
        ) {
            return;
        }
        session.state = WebVpnSessionState::WaitingLogin;
        session.last_error = None;
    }

    pub fn mark_closed(&self) {
        if let Ok(mut session) = self.session.lock() {
            session.state = WebVpnSessionState::Closed;
            session.target_host = None;
        }
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
        session
            .denied_hosts
            .retain(|candidate| candidate != &host);
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
        // 转发落地：从 Navigating 回到 Ready（阶段 2 会在此之后进入等待下载）。
        if session.state == WebVpnSessionState::Navigating {
            session.state = WebVpnSessionState::Ready;
        }
        true
    }

    pub fn status(&self, config: &WebVpnConfig, window_open: bool) -> WebVpnStatus {
        let session = self
            .session
            .lock()
            .map(|session| Session {
                state: session.state,
                policy: session.policy.clone(),
                target_host: session.target_host.clone(),
                denied_hosts: session.denied_hosts.clone(),
                last_error: session.last_error.clone(),
            })
            .unwrap_or_default();
        WebVpnStatus {
            state: session.state,
            portal_url: config.portal_url.clone(),
            allowed_hosts: session.policy.allowed_hosts.clone(),
            enforce_navigation: session.policy.enforce,
            configured_allowed_hosts: config.allowed_hosts.clone(),
            configured_enforce_navigation: config.enforce_navigation,
            target_host: session.target_host,
            denied_hosts: session.denied_hosts,
            last_error: session.last_error,
            window_open,
            probe_available: Self::probe_available(),
        }
    }

    /// 探测模式是否可用。release 构建必须为 false：探测期不拦截导航，
    /// 若泄漏到正式包就等于把桌面客户端变成任意网页启动器。
    pub fn probe_available() -> bool {
        cfg!(debug_assertions)
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
                serializer.append_pair(&key, &value.chars().take(MAX_LOGGED_VALUE).collect::<String>());
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
    let host = host.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
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
    let mut root_parts = root.components().filter(|c| matches!(c, Component::Normal(_)));
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

/// 创建（或复用）WebVPN 单例窗口。
pub fn open_window(
    app: &AppHandle,
    data_root: &Path,
    target: &url::Url,
    policy: WebVpnPolicy,
) -> Result<WebviewWindow, String> {
    let profile_dir = resolve_profile_dir(data_root)?;
    // 策略最先应用：复用与新建两条路径的导航判定都必须按最新配置执行。
    if let Some(state) = app.try_state::<WebVpnState>() {
        state.apply_policy(policy);
    }

    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window
            .navigate(target.clone())
            .map_err(|error| error.to_string())?;
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        if let Some(state) = app.try_state::<WebVpnState>() {
            // 复用已有会话：登录态在 WebView2 profile 里，已确认过的会话不重置。
            state.enter_reused_session();
        }
        return Ok(window);
    }

    let navigation_app = app.clone();
    let window_app = app.clone();
    let download_app = app.clone();

    if let Some(state) = app.try_state::<WebVpnState>() {
        // 窗口不存在 ⇒ 会话不可能处于打开态（例如 WebView2 进程崩溃后重建）。
        // 先归零再走合法的 Opening 路径，否则 `Ready → Opening` 这类非法迁移
        // 会把"重新打开"永久卡死。
        if state.state() != WebVpnSessionState::Closed {
            state.mark_closed();
        }
        state.transition(WebVpnSessionState::Opening)?;
    }

    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(target.clone()))
        .title("WebVPN")
        .inner_size(1200.0, 860.0)
        .data_directory(profile_dir)
        .on_navigation(move |url| {
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
            // 阶段 0 只观察：放行并使用默认实现，以便记录真实弹窗域名。
            // 新窗口不在 capabilities 列表内，因而没有任何 IPC 命令权限。
            // 阶段 1 需据实测结果决定「受管从属窗口」还是「收敛回主窗口」。
            record(&window_app, "newWindow", url.as_str(), "默认放行");
            NewWindowResponse::Allow
        })
        .on_download(move |_webview, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    // 阶段 0 不改写路径：保留 WebView2 默认落盘位置，
                    // 以便确认出版社给的是附件下载还是内联预览。
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
                }
                _ => {}
            }
            true
        })
        .build()
        .map_err(|error| {
            if let Some(state) = app.try_state::<WebVpnState>() {
                state.fail(&format!("无法创建 WebVPN 窗口: {error}"));
            }
            error.to_string()
        })?;

    record(app, "windowCreated", target.as_str(), "单例窗口已创建");
    if let Some(state) = app.try_state::<WebVpnState>() {
        // 门户正在加载，等待用户完成统一身份认证。
        let _ = state.transition(WebVpnSessionState::WaitingLogin);
    }
    Ok(window)
}

/// 由命令层调用的状态组装：补上"窗口是否存在"与配置。
///
/// 窗口隐藏也算存在——隐藏正是"保留会话"的实现方式，UI 需要区分
/// "已创建但隐藏"与"从未创建"。
pub fn status_of(app: &AppHandle, config: &WebVpnConfig) -> WebVpnStatus {
    let window_open = app.get_webview_window(WINDOW_LABEL).is_some();
    match app.try_state::<WebVpnState>() {
        Some(state) => state.status(config, window_open),
        None => WebVpnState::default().status(config, window_open),
    }
}

/// 关闭按钮只隐藏窗口，保留 WebView2 会话。
///
/// 入参是 `Window`（`on_window_event` 回调给的类型），不是 `WebviewWindow`。
pub fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != WINDOW_LABEL {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
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
        let redacted = redact_for_log("https://webvpn.example.edu/https/doi.org/x?target=nature&t=abc123");
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
        assert!(ensure_strictly_inside(root, root).is_err(), "根目录自身不是子目录");
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
        assert!(
            status.denied_hosts.is_empty(),
            "只记录模式不应产生被拦域名"
        );
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
        assert!(!state.decide_navigation("sso.unknown.edu"), "重复拦截应去重");
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
        assert!(state
            .transition(WebVpnSessionState::Navigating)
            .is_err());

        state
            .transition(WebVpnSessionState::WaitingLogin)
            .expect("加载完成进入等待登录");
        state
            .transition(WebVpnSessionState::Ready)
            .expect("用户确认登录");
        state
            .begin_navigation("doi.org")
            .expect("已确认后可以转发");
        let navigating = state.status(&config, true);
        assert_eq!(navigating.state, WebVpnSessionState::Navigating);
        assert_eq!(navigating.target_host.as_deref(), Some("doi.org"));

        // 转发落地后回到 Ready，并清除目标。
        assert!(state.decide_navigation("doi.org"));
        assert_eq!(
            state.status(&config, true).state,
            WebVpnSessionState::Ready
        );

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
        assert!(
            !status.enforce_navigation,
            "探测模式实际生效的是只记录策略"
        );
        assert!(
            status.allowed_hosts.is_empty(),
            "只记录策略下生效白名单为空"
        );
        // 用户意图与实际生效必须同时可见。
        assert!(status.configured_enforce_navigation, "配置里的拦截开关为 true");
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

        // 错误态复用：应回到等待登录并清掉旧报错，让用户能继续操作。
        state.fail("上一次导航失败");
        state.enter_reused_session();
        assert_eq!(state.state(), WebVpnSessionState::WaitingLogin);
        assert!(state.status(&WebVpnConfig::default(), true).last_error.is_none());
    }

    #[test]
    fn any_state_can_be_reset_and_reopened() {
        use WebVpnSessionState::*;
        // open_window 的新建分支 = 「若非 Closed 则归零」+「→ Opening」。
        // 只要这两步对任意起点都合法，"重新打开"就不可能被卡死。
        for from in [Closed, Opening, WaitingLogin, Ready, Navigating, Error] {
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
}
