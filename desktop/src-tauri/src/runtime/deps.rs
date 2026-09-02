//! Runtime dependency doctor（P1-1）。
//!
//! 一屏展示 Edge / Python / Bridge / Office 等运行时依赖状态，供用户在
//! 全新 Windows 11（无开发环境）机器上诊断缺失依赖。检测只读，不做任何
//! 修改；Bridge 详细注册快照复用 [bridge::status]。
//!
//! 状态语义：
//! - ok      依赖可用（给出路径/版本详情）；
//! - warning 可继续运行但功能受限（如 LibreOffice 缺失仅影响解析预览）；
//! - missing 缺失或安装损坏（给出修复提示）。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::bridge;
use super::config;
use super::dsh::RuntimeLayout;
use super::mcp::{self, AppMcpStatus};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
use winreg::types::FromRegValue;
use winreg::{RegKey, HKEY};

/// 单项依赖状态。state 取值 "ok" | "warning" | "missing"（前端映射颜色）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub key: String,
    pub label: String,
    pub state: String,
    pub detail: String,
    pub hint: String,
    pub mcp_capable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp: Option<AppMcpStatus>,
}

/// Doctor 聚合结果：依赖列表 + Bridge 注册快照（前端可展开显示）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDeps {
    pub items: Vec<DependencyStatus>,
    pub bridge: bridge::BridgeStatus,
}

const EDGE_CANDIDATES: [&str; 2] = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
];

const OFFICE_CANDIDATES: [&str; 2] = [
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
];
const MS_OFFICE_CANDIDATES: [&str; 3] = [
    r"C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE",
    r"C:\Program Files (x86)\Microsoft Office\root\Office16\WINWORD.EXE",
    r"C:\Program Files\Microsoft Office\Office16\WINWORD.EXE",
];
const WPS_CANDIDATES: [&str; 2] = [
    r"C:\Program Files\WPS Office\ksolaunch.exe",
    r"C:\Program Files (x86)\Kingsoft\WPS Office\ksolaunch.exe",
];
const MNOVA_CANDIDATES: [&str; 3] = [
    r"C:\Program Files\Mestrelab Research S.L\MestReNova\MestReNova.exe",
    r"C:\Program Files\Mestrelab Research\MestReNova\MestReNova.exe",
    r"C:\Program Files (x86)\Mestrelab Research S.L\MestReNova\MestReNova.exe",
];
const ORIGIN_EXE_NAMES: [&str; 3] = ["Origin64.exe", "Origin_64.exe", "Origin.exe"];
const ORIGIN_LAB_ROOTS: [&str; 2] = [
    r"C:\Program Files\OriginLab",
    r"C:\Program Files (x86)\OriginLab",
];

fn ok(key: &str, label: &str, detail: impl Into<String>, hint: &str) -> DependencyStatus {
    DependencyStatus {
        key: key.into(),
        label: label.into(),
        state: "ok".into(),
        detail: detail.into(),
        hint: hint.into(),
        mcp_capable: false,
        mcp: None,
    }
}

fn warning(key: &str, label: &str, detail: impl Into<String>, hint: &str) -> DependencyStatus {
    DependencyStatus {
        key: key.into(),
        label: label.into(),
        state: "warning".into(),
        detail: detail.into(),
        hint: hint.into(),
        mcp_capable: false,
        mcp: None,
    }
}

fn missing(key: &str, label: &str, detail: impl Into<String>, hint: &str) -> DependencyStatus {
    DependencyStatus {
        key: key.into(),
        label: label.into(),
        state: "missing".into(),
        detail: detail.into(),
        hint: hint.into(),
        mcp_capable: false,
        mcp: None,
    }
}

fn local_app_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

fn find_first(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_file()).cloned()
}

fn find_edge() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = EDGE_CANDIDATES.iter().map(PathBuf::from).collect();
    if let Some(base) = local_app_dir() {
        candidates.push(base.join(r"Microsoft\Edge\Application\msedge.exe"));
    }
    find_first(&candidates)
}

fn find_libreoffice() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = OFFICE_CANDIDATES.iter().map(PathBuf::from).collect();
    if let Some(base) = local_app_dir() {
        candidates.push(base.join(r"Programs\LibreOffice\program\soffice.exe"));
    }
    find_first(&candidates)
}

/// 运行 `command args` 取 "Python x.y.z" 版本串。仅接受 exit 0 且 stdout
/// 以 "Python " 开头的结果——Windows 的 Microsoft Store python alias 会
/// 以非零退出码 + stderr 提示安装，因此不会误判为已安装。
fn probe_python(command: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new(command)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout);
    let version = version.trim();
    if version.starts_with("Python ") {
        Some(version.to_string())
    } else {
        None
    }
}

/// Python 安装目录名版本解析："Python311" → (3, 11)；"Python3.11" → (3, 11)。
fn python_dir_version(path: &Path) -> (u32, u32) {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let rest = name.strip_prefix("Python").unwrap_or(name);
    if let Some((major, minor)) = rest.split_once('.') {
        (
            major.trim().parse().unwrap_or(0),
            minor.trim().parse().unwrap_or(0),
        )
    } else {
        let digits: Vec<char> = rest.chars().collect();
        if digits.is_empty() {
            return (0, 0);
        }
        let major = digits[0].to_digit(10).unwrap_or(0);
        let minor = digits[1..].iter().collect::<String>().parse().unwrap_or(0);
        (major, minor)
    }
}

/// 官方安装目录 %LOCALAPPDATA%\Programs\Python\Python*\python.exe，取最高版本。
fn find_python_install() -> Option<(PathBuf, String)> {
    let base = local_app_dir()?.join("Programs").join("Python");
    let mut found: Vec<(u32, u32, PathBuf)> = fs::read_dir(&base)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let candidate = entry.path().join("python.exe");
            if candidate.is_file() {
                let (major, minor) = python_dir_version(&entry.path());
                Some((major, minor, candidate))
            } else {
                None
            }
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    found
        .into_iter()
        .next()
        .map(|(major, minor, path)| (path, format!("Python {major}.{minor}")))
}

fn edge_status() -> DependencyStatus {
    match find_edge() {
        Some(path) => ok(
            "edge",
            "Microsoft Edge",
            path.display().to_string(),
            "文献捕获的浏览器 handoff 使用 Edge 打开机构/出版社页面。",
        ),
        None => missing(
            "edge",
            "Microsoft Edge",
            "未找到 msedge.exe",
            "Windows 11 默认自带 Edge。若已安装但未检测到，请检查是否存在 \
             C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe。",
        ),
    }
}

fn python_status() -> DependencyStatus {
    // 1) Windows py launcher（首选：不命中 Store alias）
    if let Some(version) = probe_python("py", &["-3", "--version"]) {
        return ok("python", "Python", version, "位于 PATH 的 py launcher。");
    }
    // 2) PATH 中的 python.exe（stdout 校验，Store alias 不会误判）
    if let Some(version) = probe_python("python", &["--version"]) {
        return ok("python", "Python", version, "位于 PATH 的 python.exe。");
    }
    // 3) 官方安装目录
    if let Some((path, version)) = find_python_install() {
        return ok(
            "python",
            "Python",
            format!("{version}（{}）", path.display()),
            "官方安装目录。",
        );
    }
    missing(
        "python",
        "Python",
        "未检测到 python.exe / py launcher",
        "P1-2 统一 Python resolver 需要 Python 3.8+。可从 python.org 下载安装并勾选 \
         “Add python.exe to PATH”，或安装 Windows py launcher。文献捕获主链路（Node host）不依赖 Python。",
    )
}

fn node_status(layout: &RuntimeLayout) -> DependencyStatus {
    let node = layout.node_exe();
    if node.exists() {
        ok(
            "node",
            "内置 Node.js",
            node.display().to_string(),
            "DSH 服务与文献捕获 host 的运行引擎。",
        )
    } else {
        missing(
            "node",
            "内置 Node.js",
            "捆绑的 node.exe 缺失",
            "安装文件不完整，请重新安装 iBM Lab Agent。",
        )
    }
}

fn bridge_status(layout: &RuntimeLayout) -> DependencyStatus {
    let snapshot = bridge::status(layout);
    let id = &snapshot.extension_id;
    if snapshot.host_js_exists
        && snapshot.node_exe_exists
        && snapshot.registered
        && snapshot.origins_match
    {
        return ok(
            "bridge",
            "Native Messaging 桥",
            format!("已注册（扩展 {id}）"),
            "浏览器扩展经此桥把捕获的文献文件交给桌面客户端。",
        );
    }
    let mut problems: Vec<String> = Vec::new();
    if !snapshot.host_js_exists {
        problems.push("host.js 缺失".into());
    }
    if !snapshot.node_exe_exists {
        problems.push("node.exe 缺失".into());
    }
    if !snapshot.registered {
        problems.push("未注册到 HKCU".into());
    }
    if !snapshot.origins_match {
        problems.push("扩展 ID 与 allowed_origins 不一致".into());
    }
    let detail = if problems.is_empty() {
        "状态异常".to_string()
    } else {
        problems.join("；")
    };
    let hint = if snapshot.registered && snapshot.origins_match {
        "桥文件不完整，请重新安装 iBM Lab Agent。"
    } else {
        "桌面应用启动时会自动注册；若持续失败请查看日志（%LOCALAPPDATA%\\iBM-Lab-Agent\\logs）。\
         扩展重载后请通过 edge://quit 完全退出 Edge 再重开，使注册生效。"
    };
    if snapshot.host_js_exists && snapshot.node_exe_exists {
        warning("bridge", "Native Messaging 桥", detail, hint)
    } else {
        missing("bridge", "Native Messaging 桥", detail, hint)
    }
}

fn office_status() -> DependencyStatus {
    for path in MS_OFFICE_CANDIDATES.iter().chain(WPS_CANDIDATES.iter()) {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return ok(
                "office",
                "Office（默认打开程序）",
                candidate.display().to_string(),
                "检测到 Microsoft Office/WPS；报告和 PPT 会直接由系统默认程序打开。 ",
            );
        }
    }
    match find_libreoffice() {
        Some(path) => ok(
            "office",
            "Office (LibreOffice)",
            path.display().to_string(),
            "P1-3 Office 文档解析/预览使用该可执行文件。",
        ),
        None => warning(
            "office",
            "Office (LibreOffice)",
            "未找到 soffice.exe",
            "P1-3 Office 解析（PPTX/DOCX 预览）需要 LibreOffice，可从 libreoffice.org \
             下载安装；不影响文献捕获核心链路。",
        ),
    }
}

fn mnova_status(layout: &RuntimeLayout) -> DependencyStatus {
    let installed = MNOVA_CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file());
    let config = config::load(&layout.config_dir).unwrap_or_default();
    let mcp_status = mcp::status(layout, &config, "mnova", false);
    let mut item = match installed {
        Some(path) => ok(
            "mnova",
            "MestReNova",
            path.display().to_string(),
            "已检测到 MestReNova 应用。",
        ),
        None => warning(
            "mnova",
            "MestReNova",
            "未找到 MestReNova.exe",
            "NMR 分析需要本地 MestReNova；安装后会自动检测。",
        ),
    };
    item.mcp_capable = true;
    if mcp_status.configured {
        item.mcp = Some(mcp_status);
    }
    item
}

fn policy_strings(root: HKEY, subkey: &str) -> Vec<String> {
    RegKey::predef(root)
        .open_subkey_with_flags(subkey, KEY_READ)
        .ok()
        .map(|key| {
            key.enum_values()
                .filter_map(Result::ok)
                .filter_map(|(_, value)| String::from_reg_value(&value).ok())
                .collect()
        })
        .unwrap_or_default()
}

/// 在目录树中查找 Origin/OriginPro 主程序：根目录 + 一层子目录。
fn find_origin_exe_under(root: &Path) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for name in ORIGIN_EXE_NAMES {
        candidates.push(root.join(name));
    }
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            for name in ORIGIN_EXE_NAMES {
                candidates.push(entry.path().join(name));
            }
        }
    }
    find_first(&candidates)
}

/// 遍历 Windows 卸载注册表，DisplayName 命中 OriginLab 产品且
/// InstallLocation 下存在 Origin64.exe/Origin.exe 时返回该主程序路径。
fn find_origin_via_registry() -> Option<PathBuf> {
    let roots = [HKEY_LOCAL_MACHINE, HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER];
    let subkeys = [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    ];
    for (root, subkey) in roots.iter().zip(subkeys.iter()) {
        let Ok(key) = RegKey::predef(*root).open_subkey_with_flags(subkey, KEY_READ) else {
            continue;
        };
        for name in key.enum_keys().filter_map(Result::ok) {
            let Ok(app) = key.open_subkey_with_flags(&name, KEY_READ) else {
                continue;
            };
            let display: Option<String> = app.get_value("DisplayName").ok();
            let looks_like_origin = display.as_deref().is_some_and(|value| {
                let value = value.to_ascii_lowercase();
                (value.contains("originpro") || value.contains("originlab"))
                    && value.contains("origin")
            });
            if !looks_like_origin {
                continue;
            }
            let install_location: Option<String> = app.get_value("InstallLocation").ok();
            if let Some(location) = install_location {
                let dir = PathBuf::from(location.trim());
                if let Some(exe) = find_origin_exe_under(&dir) {
                    return Some(exe);
                }
            }
        }
    }
    None
}

/// 查找本机 Origin/OriginPro 主程序。检测顺序：卸载注册表 →
/// C:\Program Files\OriginLab → (x86)。不写死版本号目录。
fn find_origin() -> Option<PathBuf> {
    if let Some(path) = find_origin_via_registry() {
        return Some(path);
    }
    for root in ORIGIN_LAB_ROOTS {
        let root = PathBuf::from(root);
        if root.is_dir() {
            if let Some(path) = find_origin_exe_under(&root) {
                return Some(path);
            }
        }
    }
    None
}

/// Doctor 聚合项：Origin/OriginPro 是否已安装 + origin-mcp 配置状态。
/// Origin 未安装仅 warning——不影响主程序；Bridge/启动诊断见 mcp 子块。
fn origin_status(layout: &RuntimeLayout) -> DependencyStatus {
    let config = config::load(&layout.config_dir).unwrap_or_default();
    let mcp_status = mcp::status(layout, &config, "origin", false);
    let installed = find_origin();
    let mut item = match installed {
        Some(path) => ok(
            "origin",
            "Origin/OriginPro",
            path.display().to_string(),
            "已检测到 Origin 主程序；未启动也可由 origin-mcp Bridge 按需拉起。",
        ),
        None => warning(
            "origin",
            "Origin/OriginPro",
            "未找到 Origin64.exe / Origin.exe",
            "不影响桌面主功能；需要 Origin MCP 时才要求安装 Origin。",
        ),
    };
    item.mcp_capable = true;
    if mcp_status.configured {
        item.mcp = Some(mcp_status);
    }
    item
}

fn edge_policy_status() -> DependencyStatus {
    const POLICY: &str = r"Software\Policies\Microsoft\Edge";
    let mut blocklist = Vec::new();
    let mut allowlist = Vec::new();
    let mut user_level_disabled = false;
    for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        blocklist.extend(policy_strings(
            root,
            &format!(r"{POLICY}\NativeMessagingBlocklist"),
        ));
        allowlist.extend(policy_strings(
            root,
            &format!(r"{POLICY}\NativeMessagingAllowlist"),
        ));
        if let Ok(key) = RegKey::predef(root).open_subkey_with_flags(POLICY, KEY_READ) {
            user_level_disabled |= key
                .get_value::<u32, _>("NativeMessagingUserLevelHosts")
                .ok()
                == Some(0);
        }
    }
    let host = bridge::HOST_NAME;
    let explicitly_allowed = allowlist.iter().any(|value| value == host || value == "*");
    let blocked =
        blocklist.iter().any(|value| value == host || value == "*") && !explicitly_allowed;
    if blocked || user_level_disabled {
        let mut reasons = Vec::new();
        if blocked {
            reasons.push("Native Messaging blocklist blocks this host");
        }
        if user_level_disabled {
            reasons.push("user-level Native Messaging hosts are disabled");
        }
        return warning(
            "edge-policy",
            "Edge 企业策略",
            reasons.join("；"),
            &format!("请管理员将 {host} 加入 NativeMessagingAllowlist，并允许用户级 Native Messaging host。"),
        );
    }
    let detail = if blocklist.is_empty() && allowlist.is_empty() {
        "未检测到会阻止 Native Messaging 的 Edge 组织策略".to_string()
    } else if explicitly_allowed {
        format!("策略已允许 {host}")
    } else {
        "检测到 Edge 策略，但未发现对本 host 的阻止".to_string()
    };
    ok(
        "edge-policy",
        "Edge 企业策略",
        detail,
        "Native Messaging host 名称：com.ibm.lab.capture。",
    )
}

/// 聚合探测：Edge / Python / Node / Bridge / Office 一屏可见。
pub fn probe(layout: &RuntimeLayout) -> RuntimeDeps {
    RuntimeDeps {
        items: vec![
            edge_status(),
            python_status(),
            node_status(layout),
            bridge_status(layout),
            office_status(),
            mnova_status(layout),
            origin_status(layout),
            edge_policy_status(),
        ],
        bridge: bridge::status(layout),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sandbox_layout() -> (RuntimeLayout, PathBuf) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sandbox = std::env::temp_dir().join(format!("ibm-deps-{}-{nonce}", std::process::id()));
        let resources = sandbox.join("resources");
        fs::create_dir_all(resources.join("node")).unwrap();
        fs::create_dir_all(resources.join("bridge")).unwrap();
        fs::write(resources.join("node").join("node.exe"), "node").unwrap();
        fs::write(resources.join("bridge").join("host.js"), "host").unwrap();
        let layout = RuntimeLayout::new(sandbox.join("data"), resources);
        layout.create_user_directories().unwrap();
        (layout, sandbox)
    }

    #[test]
    fn parses_python_dir_versions() {
        assert_eq!(python_dir_version(Path::new("Python311")), (3, 11));
        assert_eq!(python_dir_version(Path::new("Python310")), (3, 10));
        assert_eq!(python_dir_version(Path::new("Python39")), (3, 9));
        assert_eq!(python_dir_version(Path::new("Python3.12")), (3, 12));
        assert_eq!(python_dir_version(Path::new("nonsense")), (0, 0));
        assert_eq!(python_dir_version(Path::new("")), (0, 0));
    }

    #[test]
    fn probe_reports_all_six_deps_with_valid_states() {
        let (layout, sandbox) = sandbox_layout();
        let deps = probe(&layout);
        // 八项齐全且顺序稳定
        let keys: Vec<&str> = deps.items.iter().map(|item| item.key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "edge",
                "python",
                "node",
                "bridge",
                "office",
                "mnova",
                "origin",
                "edge-policy"
            ]
        );
        // 捆绑 node 存在 → ok
        let node = deps.items.iter().find(|item| item.key == "node").unwrap();
        assert_eq!(node.state, "ok");
        // 沙箱下未注册 → bridge 至少非 ok，且不 panic
        let bridge_item = deps.items.iter().find(|item| item.key == "bridge").unwrap();
        assert_ne!(bridge_item.state, "ok");
        // 所有状态字符串合法、提示非空
        for item in &deps.items {
            assert!(
                matches!(item.state.as_str(), "ok" | "warning" | "missing"),
                "{}: {}",
                item.key,
                item.state
            );
            assert!(!item.detail.is_empty());
            assert!(!item.hint.is_empty());
        }
        let _ = fs::remove_dir_all(sandbox);
    }
}
