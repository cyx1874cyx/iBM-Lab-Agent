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
use std::time::{Duration, Instant};

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

/// 科研数据源连接诊断。端点与 Node 侧真实检索实现保持一致，避免出现
/// “诊断正常、实际检索不可用”的假阳性。
const RESEARCH_SOURCE_PROBES: [(&str, &str, &str, &str); 4] = [
    (
        "openalex",
        "DOI 检索 · OpenAlex",
        "https://api.openalex.org/works?search=polymer&per-page=1",
        "results",
    ),
    (
        "crossref",
        "DOI 检索 · Crossref",
        "https://api.crossref.org/works?query=polymer&rows=1",
        "message",
    ),
    (
        "pubchem",
        "结构式检索 · PubChem",
        "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/aspirin/property/CanonicalSMILES,InChIKey/JSON",
        "PropertyTable",
    ),
    (
        "cactus",
        "结构式检索 · CACTUS",
        "https://cactus.nci.nih.gov/chemical/structure/aspirin/stdinchikey",
        "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
    ),
];

fn probe_research_source(key: &str, label: &str, url: &str, marker: &str) -> DependencyStatus {
    let started = Instant::now();
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("iBM-Lab-Agent/diagnostics")
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return missing(
                key,
                label,
                format!("无法创建连接：{error}"),
                "请检查系统网络与 TLS 配置。",
            )
        }
    };
    match client.get(url).send() {
        Ok(response) => {
            let status = response.status();
            let elapsed = started.elapsed().as_millis();
            if !status.is_success() {
                return missing(
                    key,
                    label,
                    format!("连接失败 · HTTP {} · {} ms", status.as_u16(), elapsed),
                    "请检查当前网络、代理或学校网络策略后重新检测。",
                );
            }
            match response.text() {
                Ok(body) if body.contains(marker) => ok(
                    key,
                    label,
                    format!("已连接 · HTTP {} · {} ms", status.as_u16(), elapsed),
                    url,
                ),
                Ok(_) => warning(
                    key,
                    label,
                    format!(
                        "端点可达，但返回内容异常 · HTTP {} · {} ms",
                        status.as_u16(),
                        elapsed
                    ),
                    "服务可能处于限流、验证或维护状态，请稍后重新检测。",
                ),
                Err(error) => warning(
                    key,
                    label,
                    format!("端点可达，但响应读取失败 · {} ms：{error}", elapsed),
                    "请稍后重新检测。",
                ),
            }
        }
        Err(error) => missing(
            key,
            label,
            format!("连接失败 · {} ms：{error}", started.elapsed().as_millis()),
            "请检查当前网络、代理、DNS 或防火墙后重新检测。",
        ),
    }
}

/// 四个来源并发探测，单个来源失败不会拖住或覆盖其他来源的结果。
pub fn probe_research_sources() -> Vec<DependencyStatus> {
    std::thread::scope(|scope| {
        let handles: Vec<_> = RESEARCH_SOURCE_PROBES
            .iter()
            .map(|(key, label, url, marker)| {
                scope.spawn(move || probe_research_source(key, label, url, marker))
            })
            .collect();
        handles
            .into_iter()
            .enumerate()
            .map(|(index, handle)| {
                handle.join().unwrap_or_else(|_| {
                    let (key, label, _, _) = RESEARCH_SOURCE_PROBES[index];
                    missing(
                        key,
                        label,
                        "诊断线程异常退出",
                        "请重新检测；若持续出现请查看应用日志。",
                    )
                })
            })
            .collect()
    })
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

fn python_status(layout: &RuntimeLayout) -> DependencyStatus {
    let python = layout.bundled_python();
    if !python.is_file() {
        return missing(
            "python",
            "内置 Python",
            format!("缺失：{}", python.display()),
            "必须使用软件内置 Python 3.12.x；安装包不完整，请重新安装 iBM Lab Agent。",
        );
    }
    if !is_plausible_pe(&python) {
        return warning(
            "python",
            "内置 Python",
            format!("捆绑的 python.exe 不是有效的可执行文件（{}）", python.display()),
            "安装文件不完整或被安全软件截断；请重新安装 iBM Lab Agent。",
        );
    }
    let command = python.to_string_lossy();
    match probe_python(&command, &["--version"]) {
        Some(version) if version.starts_with("Python 3.12.") || version == "Python 3.12" => ok(
            "python",
            "内置 Python",
            format!("{version}（{}）", python.display()),
            "已强制使用软件内置 Python 3.12.x；Agent 不会回退到系统 Python。",
        ),
        Some(version) => warning(
            "python",
            "内置 Python",
            format!("{version}（{}）", python.display()),
            "当前安装包应内置 Python 3.12.x；请升级或重新安装 iBM Lab Agent。",
        ),
        None => missing(
            "python",
            "内置 Python",
            format!("无法启动：{}", python.display()),
            "需要可用的内置 Python 3.12.x；请重新安装 iBM Lab Agent，安装系统 Python 无法修复此问题。",
        ),
    }
}

fn probe_powershell(command: &str) -> Option<String> {
    let output = std::process::Command::new(command)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$PSVersionTable.PSVersion.ToString()",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!version.is_empty()).then_some(version)
}

fn powershell_status() -> DependencyStatus {
    for (command, edition) in [
        ("pwsh.exe", "PowerShell 7"),
        ("powershell.exe", "Windows PowerShell"),
    ] {
        let Some(version) = probe_powershell(command) else {
            continue;
        };
        let mut parts = version
            .split('.')
            .filter_map(|part| part.parse::<u32>().ok());
        let major = parts.next().unwrap_or(0);
        let minor = parts.next().unwrap_or(0);
        if major > 5 || (major == 5 && minor >= 1) {
            return ok(
                "powershell",
                "PowerShell",
                format!("{edition} {version}（{command}）"),
                "已兼容 Windows PowerShell 5.1 与 PowerShell 7.x；若两者共存则优先使用 7.x。",
            );
        }
        return warning(
            "powershell",
            "PowerShell",
            format!("{edition} {version}（{command}）"),
            "Agent Shell 需要 PowerShell 5.1 或 7.x；请升级 PowerShell。",
        );
    }
    missing(
        "powershell",
        "PowerShell",
        "未找到 pwsh.exe 或 powershell.exe",
        "Agent Shell 需要 Windows PowerShell 5.1 或 PowerShell 7.x。",
    )
}

/// 交付物里的可执行文件是否**看起来**是真正的 Windows PE。
///
/// 为什么必须挡一道：直接 `Command::new(path)` 一个 4 字节的伪文件时，Windows 不是
/// 返回一个错误码，而是弹一个「不支持的 16 位应用程序」模态框——在无人值守的探测
/// 里它会一直挡着（实测把单元测试拖到 5 分钟以上），而用户看到的是一句和病因毫无
/// 关系的提示。真正需要诊断的是「安装包不完整 / 被安全软件截断」，所以这里先看
/// 文件头，不满足就如实报告，绝不交给系统去执行。
fn is_plausible_pe(path: &std::path::Path) -> bool {
    const MIN_PE_BYTES: u64 = 64 * 1024;
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() < MIN_PE_BYTES {
        return false;
    }
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut magic = [0_u8; 2];
    std::io::Read::read_exact(&mut file, &mut magic).is_ok() && &magic == b"MZ"
}

fn node_status(layout: &RuntimeLayout) -> DependencyStatus {
    let node = layout.node_exe();
    if node.exists() {
        if !is_plausible_pe(&node) {
            return warning(
                "node",
                "内置 Node.js",
                format!("捆绑的 node.exe 不是有效的可执行文件（{}）", node.display()),
                "安装文件不完整或被安全软件截断；请重新安装 iBM Lab Agent，不要把该文件加入杀软隔离。",
            );
        }
        let version = std::process::Command::new(&node)
            .arg("--version")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
            .unwrap_or_default();
        if version == "v24.16.0" {
            ok(
                "node",
                "内置 Node.js",
                format!("Node.js {version}（{}）", node.display()),
                "DSH 服务与文献捕获 host 的内置运行引擎。",
            )
        } else {
            warning(
                "node",
                "内置 Node.js",
                format!(
                    "Node.js {}（{}）",
                    if version.is_empty() {
                        "无法读取版本"
                    } else {
                        &version
                    },
                    node.display()
                ),
                "当前安装包要求内置 Node.js v24.16.0；请升级或重新安装 iBM Lab Agent。",
            )
        }
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

/// Windows PE 文件版本（File Version 资源）。读取失败返回 None 不阻断
/// （任务书 §18：MestReNova.exe 显示 File version）。
#[cfg(windows)]
fn exe_file_version(path: &Path) -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO,
    };
    let wide: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let size = GetFileVersionInfoSizeW(wide.as_ptr(), std::ptr::null_mut());
        if size == 0 {
            return None;
        }
        let mut buffer = vec![0u8; size as usize];
        if GetFileVersionInfoW(wide.as_ptr(), 0, size, buffer.as_mut_ptr() as *mut _) == 0 {
            return None;
        }
        let mut pointer: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut length: u32 = 0;
        let root: Vec<u16> = "\\".encode_utf16().chain(std::iter::once(0)).collect();
        if VerQueryValueW(
            buffer.as_ptr() as *const _,
            root.as_ptr(),
            &mut pointer,
            &mut length,
        ) == 0
            || pointer.is_null()
        {
            return None;
        }
        let info = &*(pointer as *const VS_FIXEDFILEINFO);
        let (ms, ls) = (info.dwFileVersionMS, info.dwFileVersionLS);
        Some(format!(
            "{}.{}.{}.{}",
            (ms >> 16) & 0xffff,
            ms & 0xffff,
            (ls >> 16) & 0xffff,
            ls & 0xffff
        ))
    }
}

#[cfg(not(windows))]
fn exe_file_version(_path: &Path) -> Option<String> {
    None
}

fn mnova_status(layout: &RuntimeLayout) -> DependencyStatus {
    let installed = MNOVA_CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file());
    let config = config::load(&layout.config_dir).unwrap_or_default();
    let mcp_status = mcp::status(layout, &config, "mnova", false);
    let mcp_version = mcp::mnova_package_version(layout)
        .map(|version| format!("（版本 {version}）"))
        .unwrap_or_default();
    let bridge_ok = mcp::mnova_bridge_script(layout).is_some();
    let mut item = match installed {
        Some(path) => {
            let version = exe_file_version(&path)
                .map(|version| format!(" · 文件版本 {version}"))
                .unwrap_or_default();
            ok(
                "mnova",
                "MestReNova",
                format!("{}{version}", path.display()),
                "已检测到 MestReNova 应用；GUI/Verify 工作流可用（需授权）。",
            )
        }
        None => warning(
            "mnova",
            "MestReNova",
            "未找到 MestReNova.exe",
            // 任务书 §18：缺失为 warning 而非 missing/Desktop failure；MCP 与
            // Skill 已内置，只有 GUI/Verify 依赖本机授权安装。
            "Mnova MCP 与 NMR Skill 已内置。安装并授权 MestReNova 后可启用 GUI/Verify 工作流；文件型 NMR 分析和 synthetic FID 能力仍可使用。",
        ),
    };
    item.detail = format!(
        "{}；Mnova MCP 内置{mcp_version}；bridge.qs：{}",
        item.detail,
        if bridge_ok { "已捆绑" } else { "缺失" }
    );
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
            python_status(layout),
            powershell_status(),
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

    /// 探测**绝不能**把非 PE 文件交给系统执行。
    ///
    /// 2026-09-27 现场：`probe_reports_all_dependencies_with_valid_states` 在沙箱里写了
    /// 一个 4 字节的假 `node.exe`，`node_status` 直接 `Command::new()` 它，Windows 于是
    /// 弹出「不支持的 16 位应用程序」模态框并挡住整个探测（那一个测试跑了 5 分钟以上）。
    /// 用户看到的提示和真实病因（安装不完整/被安全软件截断）毫无关系。
    #[test]
    fn probes_never_hand_a_non_pe_binary_to_windows() {
        let dir = std::env::temp_dir().join(format!("ibm-pe-guard-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("node.exe");
        // 4 字节伪文件（旧测试的形状）
        fs::write(&fake, "node").unwrap();
        assert!(!is_plausible_pe(&fake), "伪文件必须被文件头检查拦住");
        // 体积够但没有 MZ 头
        fs::write(&fake, vec![0_u8; 128 * 1024]).unwrap();
        assert!(!is_plausible_pe(&fake), "没有 MZ 头就不是 PE");
        // MZ 头 + 合理体积
        let mut bytes = vec![0_u8; 128 * 1024];
        bytes[0] = b'M';
        bytes[1] = b'Z';
        fs::write(&fake, &bytes).unwrap();
        assert!(is_plausible_pe(&fake), "MZ 头 + 足够体积应当放行");
        assert!(!is_plausible_pe(&dir.join("missing.exe")), "缺失文件不算 PE");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn probe_reports_all_dependencies_with_valid_states() {
        let (layout, sandbox) = sandbox_layout();
        let deps = probe(&layout);
        // 九项齐全且顺序稳定
        let keys: Vec<&str> = deps.items.iter().map(|item| item.key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "edge",
                "python",
                "powershell",
                "node",
                "bridge",
                "office",
                "mnova",
                "origin",
                "edge-policy"
            ]
        );
        // 伪文件可被找到但不是可执行 Node，应降级为 warning，不得误报 ok。
        let node = deps.items.iter().find(|item| item.key == "node").unwrap();
        assert_eq!(node.state, "warning");
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

/// Resolve only the explicitly requested scientific application.
pub fn scientific_application(application: &str) -> Option<PathBuf> {
    match application {
        "origin" => find_origin(),
        "word" => MS_OFFICE_CANDIDATES
            .iter()
            .map(PathBuf::from)
            .find(|p| p.is_file()),
        "mnova" => MNOVA_CANDIDATES
            .iter()
            .map(PathBuf::from)
            .find(|p| p.is_file()),
        _ => None,
    }
}
