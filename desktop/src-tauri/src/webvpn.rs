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

/// 窗口 label。单例判定的唯一依据，不要用标题或 URL 判断。
pub const WINDOW_LABEL: &str = "webvpn";

/// 专属 WebView2 profile 目录名（位于应用数据根目录下）。
const PROFILE_DIR_NAME: &str = "webvpn-webview2";

/// 探测记录落盘文件名（写入现有 logs 目录）。
const LOG_FILE: &str = "webvpn.log";

/// 内存中保留的最大事件数，防止长时间探测把内存吃满。
const MAX_EVENTS: usize = 800;

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

/// 导航策略。阶段 0 探测用 `enforce: false`，阶段 1 起用白名单拦截。
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
}

#[derive(Default)]
pub struct WebVpnState {
    events: Mutex<Vec<WebVpnEvent>>,
    policy: Mutex<WebVpnPolicy>,
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

    pub fn enforce(&self) -> bool {
        self.policy
            .lock()
            .map(|policy| policy.enforce)
            .unwrap_or(true)
    }

    pub fn set_policy(&self, enforce: bool, allowed_hosts: Vec<String>) {
        if let Ok(mut policy) = self.policy.lock() {
            policy.enforce = enforce;
            policy.allowed_hosts = allowed_hosts;
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
    enforce: bool,
    allowed_hosts: Vec<String>,
) -> Result<WebviewWindow, String> {
    let profile_dir = resolve_profile_dir(data_root)?;
    if let Some(state) = app.try_state::<WebVpnState>() {
        state.set_policy(enforce, allowed_hosts);
    }
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.navigate(target.clone()).map_err(|error| error.to_string())?;
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(window);
    }

    let navigation_app = app.clone();
    let window_app = app.clone();
    let download_app = app.clone();

    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(target.clone()))
        .title("WebVPN")
        .inner_size(1200.0, 860.0)
        .data_directory(profile_dir)
        .on_navigation(move |url| {
            let host = host_of(url.as_str());
            let enforce = navigation_app
                .try_state::<WebVpnState>()
                .map(|state| state.enforce())
                .unwrap_or(true);
            if enforce {
                let allowed = navigation_app
                    .try_state::<WebVpnState>()
                    .map(|state| {
                        state
                            .policy
                            .lock()
                            .map(|policy| policy.allows(&host))
                            .unwrap_or(false)
                    })
                    .unwrap_or(false);
                if !allowed {
                    record(&navigation_app, "denied", url.as_str(), "不在导航白名单内");
                    return false;
                }
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
        .map_err(|error| error.to_string())?;

    record(app, "windowCreated", target.as_str(), "单例窗口已创建");
    Ok(window)
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
}
