use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::dsh::RuntimeLayout;
use super::{AppConfig, McpServerConfig, RuntimeError};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// MCP 应用启动方式。启动类型由 app_key 决定（McpAppSpec），不写入用户配置，
/// 避免任意 executable 被 MCP manager 启动。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpLaunchKind {
    /// <bundled-python> -m <module>（随安装包内置的 Python 模块，如 origin_mcp /
    /// mnova_mcp）。0.2.0 起 Origin 与 Mnova 均走 bundled Python，不再有 uv 项目型。
    BundledPythonModule { module: &'static str },
}

/// MCP 应用规格：静态注册表，驱动启动命令 / 校验 / UI 渲染。
#[derive(Debug, Clone, Copy)]
pub struct McpAppSpec {
    pub app_key: &'static str,
    pub server_name: &'static str,
    pub requires_directory: bool,
    pub launch_kind: McpLaunchKind,
}

pub static MCP_APPS: [McpAppSpec; 2] = [
    McpAppSpec {
        app_key: "mnova",
        server_name: "mnova",
        requires_directory: false,
        launch_kind: McpLaunchKind::BundledPythonModule {
            module: "mnova_mcp",
        },
    },
    McpAppSpec {
        app_key: "origin",
        server_name: "origin",
        requires_directory: false,
        launch_kind: McpLaunchKind::BundledPythonModule {
            module: "origin_mcp",
        },
    },
];

pub fn spec_for(app_key: &str) -> Option<&'static McpAppSpec> {
    MCP_APPS.iter().find(|spec| spec.app_key == app_key)
}

/// MCP 应用状态（诊断页 / DSH 启动前使用）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMcpStatus {
    pub app_key: String,
    pub server_name: String,

    pub enabled: bool,
    pub configured: bool,

    pub requires_directory: bool,
    pub directory: String,

    pub launcher: String,
    pub launcher_available: bool,
    pub entrypoint_available: bool,

    pub server_connected: bool,
    pub connected: bool,

    pub state: String,
    pub detail: String,

    // 旧字段保留（0.1.x UI 兼容；新 UI 请用 launcher/entrypoint 字段）。
    pub server_file_exists: bool,
    pub uv_available: bool,
}

/// 泛化后的 MCP 启动命令：program + args + env，避免把 Windows 路径拼进
/// 命令行字符串（中文/空格路径安全）。
pub struct McpLaunchCommand {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub env: Vec<(OsString, OsString)>,
}

fn no_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    command
}

/// 内置 Python site-packages 中某 MCP 模块的包目录
/// （dist/Lib/site-packages/<module>），平台相关布局自适应。
fn python_module_package_dir(layout: &RuntimeLayout, module: &str) -> Option<PathBuf> {
    let python_dist = layout.resources.join("python").join("dist");
    if cfg!(windows) {
        let package = python_dist.join("Lib").join("site-packages").join(module);
        Some(package)
    } else {
        // Unix dist 布局：dist/lib/python3.*/site-packages/<module>
        let lib = python_dist.join("lib");
        fs_read_dir(&lib).ok()?.into_iter().find_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("python3") {
                let package = entry.path().join("site-packages").join(module);
                if package.join("__init__.py").is_file() {
                    Some(package)
                } else {
                    None
                }
            } else {
                None
            }
        })
    }
}

/// origin_mcp 专用别名（保留给既有调用点，语义不变）。
fn origin_mcp_package_dir(layout: &RuntimeLayout) -> Option<PathBuf> {
    python_module_package_dir(layout, "origin_mcp")
}

/// mnova_mcp 包目录（bundled Python site-packages）。
fn mnova_mcp_package_dir(layout: &RuntimeLayout) -> Option<PathBuf> {
    python_module_package_dir(layout, "mnova_mcp")
}

/// bundled Python 中 mnova_mcp 包内 bridge.qs 的实际路径
/// （site-packages/mnova_mcp/assets/bridge.qs）。供 DSH child env
/// （IBM_LAB_MNOVA_BRIDGE_SCRIPT）注入；找不到返回 None，调用方不注入，
/// mnova_mcp 侧会回退到包内 asset 兜底。
pub fn mnova_bridge_script(layout: &RuntimeLayout) -> Option<PathBuf> {
    let bridge = mnova_mcp_package_dir(layout)?
        .join("assets")
        .join("bridge.qs");
    bridge.is_file().then_some(bridge)
}

fn fs_read_dir(path: &Path) -> std::io::Result<Vec<std::fs::DirEntry>> {
    std::fs::read_dir(path)?.collect()
}

/// 探测内置 Python 中某 MCP 包版本（供状态详情显示；失败返回 None 不阻断）。
fn python_package_version(layout: &RuntimeLayout, module: &str) -> Option<String> {
    let python = layout.bundled_python();
    if !python.is_file() {
        return None;
    }
    let mut command = Command::new(python);
    no_window(&mut command);
    let output = command
        .args([
            "-c",
            &format!("import {module}; print({module}.__version__)"),
        ])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

/// origin_mcp 版本探测（专用别名）。
fn origin_package_version(layout: &RuntimeLayout) -> Option<String> {
    python_package_version(layout, "origin_mcp")
}

/// mnova_mcp 版本探测（deps 诊断面板亦使用）。
pub(crate) fn mnova_package_version(layout: &RuntimeLayout) -> Option<String> {
    python_package_version(layout, "mnova_mcp")
}

/// 根据 app_key 规格构造 MCP 启动命令。此函数只做静态构造，可用性校验
/// 由 [validate_enabled_server] / [status] 完成，因此可单元测试。
pub fn build_launch_command(
    layout: &RuntimeLayout,
    entry: &McpServerConfig,
) -> Result<McpLaunchCommand, RuntimeError> {
    let spec = spec_for(&entry.app_key).ok_or_else(|| {
        RuntimeError::new(format!("Unsupported MCP application: {}", entry.app_key))
    })?;
    match spec.launch_kind {
        McpLaunchKind::BundledPythonModule { module } => {
            let mut env = vec![];
            if spec.app_key == "origin" {
                env.push((
                    OsString::from("ORIGIN_MCP_TOOL_PROFILE"),
                    OsString::from("compact"),
                ));
            }
            Ok(McpLaunchCommand {
                program: layout.bundled_python(),
                args: vec![OsString::from("-m"), OsString::from(module)],
                env,
            })
        }
    }
}

/// 通用 MCP 握手：initialize → notifications/initialized → tools/list。
/// 要求 10 秒内返回 tools/list 且至少包含一个工具；进程最终必须 kill + wait。
/// 返回工具名列表，供调用方按 app 规格追加检查（如 origin_ 前缀）。
fn handshake(command: &McpLaunchCommand) -> Result<Vec<String>, RuntimeError> {
    let mut child = Command::new(&command.program);
    no_window(&mut child);
    let mut child = child
        .args(&command.args)
        .envs(command.env.iter().cloned())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| RuntimeError::new(format!("无法启动 MCP Server: {error}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| RuntimeError::new("MCP stdin 不可用"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| RuntimeError::new("MCP stdout 不可用"))?;
    let messages = [
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"ibm-lab-desktop","version":"0.2.0"}}}"#,
        r#"{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}"#,
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#,
    ];
    for message in messages {
        writeln!(stdin, "{message}")
            .map_err(|error| RuntimeError::new(format!("无法向 MCP 发送自检请求: {error}")))?;
    }
    stdin
        .flush()
        .map_err(|error| RuntimeError::new(format!("无法提交 MCP 自检请求: {error}")))?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let is_tools_response = serde_json::from_str::<serde_json::Value>(&line)
                .ok()
                .and_then(|value| value.get("id").and_then(|id| id.as_i64()))
                == Some(2);
            if is_tools_response {
                let _ = sender.send(line);
                return;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    let result = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break Err(RuntimeError::new("MCP 连接测试超时（10 秒）"));
        }
        match receiver.recv_timeout(remaining) {
            Ok(line) if line.contains(r#""error"#) => {
                break Err(RuntimeError::new(format!("MCP Server 返回错误: {line}")))
            }
            Ok(line) => {
                break parse_tool_names(&line);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                break Err(RuntimeError::new("MCP 连接测试超时（10 秒）"))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break Err(RuntimeError::new("MCP 在完成握手前退出"))
            }
        }
    };
    let _ = child.kill();
    let _ = child.wait();
    result
}

/// 从 tools/list JSON-RPC 响应提取工具名；要求至少一个工具。
fn parse_tool_names(line: &str) -> Result<Vec<String>, RuntimeError> {
    let value: serde_json::Value = serde_json::from_str(line)
        .map_err(|_| RuntimeError::new("MCP tools/list 响应不是合法 JSON"))?;
    let tools = value
        .pointer("/result/tools")
        .and_then(|tools| tools.as_array())
        .ok_or_else(|| RuntimeError::new("MCP tools/list 响应缺少 result.tools"))?;
    let names: Vec<String> = tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(|name| name.as_str()))
        .map(str::to_string)
        .collect();
    if names.is_empty() {
        return Err(RuntimeError::new("MCP tools/list 未返回任何工具"));
    }
    Ok(names)
}

/// Origin Bridge 运行状态（status --json 摘要）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginBridgeStatus {
    /// running | stopped | stale | unavailable
    pub state: String,
    pub detail: String,
}

/// 运行 bundled python 的 origin_mcp CLI 诊断命令（status/doctor），解析顶层
/// JSON。`extra_args` 形如 ["status"] 或 ["doctor", "--ping-origin"]。
fn run_origin_cli_json(
    layout: &RuntimeLayout,
    extra_args: &[&str],
    timeout_seconds: u64,
) -> Result<serde_json::Value, RuntimeError> {
    let python = layout.bundled_python();
    if !python.is_file() {
        return Err(RuntimeError::new("内置 Python 缺失，无法诊断 Origin MCP"));
    }
    let mut command = Command::new(&python);
    no_window(&mut command);
    let mut child = command
        .args(["-m", "origin_mcp"])
        .args(extra_args)
        .arg("--json")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| RuntimeError::new(format!("无法启动 origin_mcp 诊断: {error}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| RuntimeError::new("origin_mcp stdout 不可用"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| RuntimeError::new("origin_mcp stderr 不可用"))?;
    let stdout_handle = std::thread::spawn(move || {
        let mut text = String::new();
        use std::io::Read;
        let _ = BufReader::new(stdout).read_to_string(&mut text);
        text
    });
    let stderr_handle = std::thread::spawn(move || {
        let mut text = String::new();
        use std::io::Read;
        let _ = BufReader::new(stderr).read_to_string(&mut text);
        text
    });
    let deadline = Instant::now() + Duration::from_secs(timeout_seconds);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(RuntimeError::new("origin_mcp 诊断超时"));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(RuntimeError::new(format!("origin_mcp 诊断失败: {error}")));
            }
        }
    };
    let stdout_text = stdout_handle.join().unwrap_or_default();
    let stderr_text = stderr_handle.join().unwrap_or_default();
    if !status.success() && stdout_text.trim().is_empty() {
        return Err(RuntimeError::new(format!(
            "origin_mcp 诊断退出码 {}: {}",
            status.code().unwrap_or(-1),
            stderr_text.trim()
        )));
    }
    serde_json::from_str(stdout_text.trim()).map_err(|error| {
        RuntimeError::new(format!(
            "origin_mcp 诊断输出不是合法 JSON: {error}\n{stderr_text}"
        ))
    })
}

/// 普通诊断页刷新使用：只运行 `status --json`（轻量，不 ping Origin、
/// 不启动 MCP Server）。失败统一转 unavailable，不抛给调用方。
pub fn origin_bridge_status(layout: &RuntimeLayout) -> OriginBridgeStatus {
    let json = match run_origin_cli_json(layout, &["status"], 8) {
        Ok(json) => json,
        Err(error) => {
            return OriginBridgeStatus {
                state: "unavailable".into(),
                detail: format!("无法读取 Origin MCP Bridge 状态：{error}"),
            }
        }
    };
    let state = json
        .get("state")
        .and_then(|value| value.as_str())
        .unwrap_or("diagnostic_error");
    match state {
        "running" => OriginBridgeStatus {
            state: "running".into(),
            detail: "Origin MCP Bridge 正在运行".into(),
        },
        "stopped" | "not_running" | "failed" | "starting" => OriginBridgeStatus {
            state: "stopped".into(),
            detail: "Origin MCP Bridge 未启动".into(),
        },
        "stale" => OriginBridgeStatus {
            state: "stale".into(),
            detail: "Origin MCP Bridge 状态文件已过期；请重新启动 Bridge".into(),
        },
        _ => OriginBridgeStatus {
            state: "unavailable".into(),
            detail: "Origin MCP Bridge 诊断不可用".into(),
        },
    }
}

/// 显式“测试连接”第二步：`doctor --ping-origin --json`。
/// 返回 (state, bridge_ok, origin_ok, detail)。
fn origin_doctor(layout: &RuntimeLayout) -> (String, bool, bool, String) {
    let json = match run_origin_cli_json(layout, &["doctor", "--ping-origin"], 30) {
        Ok(json) => json,
        Err(error) => {
            return (
                "unavailable".into(),
                false,
                false,
                format!("Origin MCP doctor 执行失败：{error}"),
            )
        }
    };
    let state = json
        .get("state")
        .and_then(|value| value.as_str())
        .unwrap_or("diagnostic_error")
        .to_string();
    let bridge_ok = json
        .pointer("/diagnostics/bridge/ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let origin_ok = json
        .pointer("/diagnostics/origin/ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let bridge_error = json
        .pointer("/diagnostics/bridge/message")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let origin_error = json
        .pointer("/diagnostics/origin/message")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let detail = if !bridge_ok {
        if bridge_error.is_empty() {
            "Origin MCP Bridge 未启动".to_string()
        } else {
            bridge_error
        }
    } else if !origin_ok {
        if origin_error.is_empty() {
            "Origin automation 不可达".to_string()
        } else {
            origin_error
        }
    } else {
        "Origin MCP Server、Bridge 与 Origin automation 均正常".to_string()
    };
    (state, bridge_ok, origin_ok, detail)
}

/// DSH 启动前的 MCP 配置校验（bundled Python 模块型）。
/// Origin/Mnova 应用未安装不视为安装损坏，不阻止 DSH 启动。
pub fn validate_enabled_server(
    layout: &RuntimeLayout,
    entry: &McpServerConfig,
) -> Result<(), RuntimeError> {
    let spec = spec_for(&entry.app_key).ok_or_else(|| {
        RuntimeError::new(format!("Unsupported MCP application: {}", entry.app_key))
    })?;
    match spec.launch_kind {
        McpLaunchKind::BundledPythonModule { module } => {
            if !layout.bundled_python().is_file() {
                return Err(RuntimeError::new(format!(
                    "{} MCP 已启用，但内置 Python 缺失；安装包不完整，请重新安装",
                    entry.server_name
                )));
            }
            let package_dir = python_module_package_dir(layout, module)
                .ok_or_else(|| RuntimeError::new(format!("{} MCP 包目录不可解析", module)))?;
            if !package_dir.join("__init__.py").is_file() {
                return Err(RuntimeError::new(format!(
                    "{} MCP 已启用，但内置 {module} 包缺失；安装包不完整，请重新安装",
                    entry.server_name
                )));
            }
            Ok(())
        }
    }
}

/// 准备 Origin Bridge App 源文件（install-origin-app --force）。
/// 该命令只准备 “Origin MCP Bridge Start/Stop” App 源并输出 OPX 注册指令；
/// UI 不得谎称 Bridge 已完成注册。
pub fn install_origin_bridge(layout: &RuntimeLayout) -> Result<String, RuntimeError> {
    let python = layout.bundled_python();
    if !python.is_file() {
        return Err(RuntimeError::new(
            "内置 Python 缺失，无法准备 Origin Bridge",
        ));
    }
    let mut command = Command::new(&python);
    no_window(&mut command);
    let output = command
        .args(["-m", "origin_mcp", "install-origin-app", "--force"])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| RuntimeError::new(format!("无法启动 origin_mcp install: {error}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let message = if !stderr.is_empty() { stderr } else { stdout };
        return Err(RuntimeError::new(format!(
            "origin_mcp install-origin-app 失败（退出码 {}）：{message}",
            output.status.code().unwrap_or(-1)
        )));
    }
    if stdout.is_empty() {
        return Err(RuntimeError::new(
            "origin_mcp install-origin-app 未产生任何输出",
        ));
    }
    Ok(stdout)
}

/// 汇总某 app_key 的 MCP 状态。
///
/// 状态语义：
/// - server_connected：MCP initialize + tools/list 成功
/// - connected：最终应用链路可用（Mnova：等于 server_connected；Origin：
///   还需要 Bridge/Origin automation 可用）
/// - state 取值：unconfigured | disabled | ready | connected | missing |
///   invalid | bridge-missing | origin-unreachable | error
pub fn status(
    layout: &RuntimeLayout,
    config: &AppConfig,
    app_key: &str,
    test_connection: bool,
) -> AppMcpStatus {
    let Some(spec) = spec_for(app_key) else {
        return AppMcpStatus {
            app_key: app_key.to_string(),
            server_name: app_key.to_string(),
            enabled: false,
            configured: false,
            requires_directory: false,
            directory: String::new(),
            launcher: String::new(),
            launcher_available: false,
            entrypoint_available: false,
            server_connected: false,
            connected: false,
            state: "error".into(),
            detail: format!("Unsupported MCP application: {app_key}"),
            server_file_exists: false,
            uv_available: false,
        };
    };
    let entry = config
        .mcp_servers
        .iter()
        .find(|entry| entry.app_key == app_key);
    let configured = entry.is_some();
    let enabled = entry.map(|entry| entry.enabled).unwrap_or(false);
    let directory = entry
        .map(|entry| entry.directory.clone())
        .unwrap_or_default();
    let fallback_entry = McpServerConfig {
        app_key: app_key.to_string(),
        server_name: spec.server_name.to_string(),
        enabled: false,
        directory: String::new(),
    };
    let entry = entry.unwrap_or(&fallback_entry);

    // launcher / 可用性描述（用于动态 UI 与诊断 detail）。0.2.0 起 Mnova 与
    // Origin 均为 bundled Python 模块（无 uv / 无外部目录）。
    let (module, launcher, launcher_available, entrypoint_available) = match spec.launch_kind {
        McpLaunchKind::BundledPythonModule { module } => {
            let python_ok = layout.bundled_python().is_file();
            let package_ok = python_module_package_dir(layout, module)
                .map(|dir| dir.join("__init__.py").is_file())
                .unwrap_or(false);
            (
                module,
                format!("内置 Python（python -m {module}）"),
                python_ok,
                package_ok,
            )
        }
    };

    let mk_status = |server_connected: bool,
                     connected: bool,
                     state: &str,
                     detail: String,
                     entrypoint_ok: bool,
                     launcher_ok: bool|
     -> AppMcpStatus {
        AppMcpStatus {
            app_key: app_key.to_string(),
            server_name: entry.server_name.clone(),
            enabled,
            configured,
            requires_directory: spec.requires_directory,
            directory: directory.clone(),
            launcher: launcher.clone(),
            launcher_available: launcher_ok,
            entrypoint_available: entrypoint_ok,
            server_connected,
            connected,
            state: state.into(),
            detail,
            server_file_exists: entrypoint_ok,
            uv_available: launcher_ok,
        }
    };

    if !configured {
        let detail = if spec.app_key == "origin" {
            "尚未配置 Origin MCP；点击“配置 MCP”启用（无需安装 Python/uv）".to_string()
        } else {
            "尚未配置 Mnova MCP；点击“配置 MCP”启用（无需安装 Python/uv/外部目录）".to_string()
        };
        return mk_status(
            false,
            false,
            "unconfigured",
            detail,
            false,
            launcher_available,
        );
    }
    if !enabled {
        return mk_status(
            false,
            false,
            "disabled",
            "MCP 已配置但未启用".into(),
            entrypoint_available,
            launcher_available,
        );
    }

    // 配置可用性自检（不启动 Server）。
    let availability_error: Option<RuntimeError> = if !launcher_available {
        Some(RuntimeError::new("内置 Python 缺失，安装包不完整"))
    } else if !entrypoint_available {
        Some(RuntimeError::new(format!(
            "内置 {module} 包缺失，安装包不完整"
        )))
    } else {
        None
    };
    if let Some(error) = availability_error {
        return mk_status(
            false,
            false,
            "invalid",
            error.to_string(),
            entrypoint_available,
            launcher_available,
        );
    }

    // 自检通过：test_connection=false 时只做轻量检查，不启动 MCP Server。
    if !test_connection {
        let (detail, state) = if spec.app_key == "origin" {
            // 普通刷新只运行 status --json（任务书 §6），不自动 doctor --ping-origin。
            let bridge = origin_bridge_status(layout);
            let version = origin_package_version(layout)
                .map(|version| format!("（版本 {version}）"))
                .unwrap_or_default();
            let bridge_text = match bridge.state.as_str() {
                "running" => "Bridge：运行中".to_string(),
                "stale" => "Bridge：状态过期".to_string(),
                "stopped" => "Bridge：未启动".to_string(),
                _ => format!("Bridge：{}", bridge.detail),
            };
            (
                format!("内置 origin-mcp {version} 就绪；{bridge_text}"),
                "ready",
            )
        } else {
            // Mnova 轻量就绪：bundled 包就绪即可；MestReNova 是否安装由
            // deps 面板单独展示（缺失不阻断 DSH）。
            let version = mnova_package_version(layout)
                .map(|version| format!("（版本 {version}）"))
                .unwrap_or_default();
            (
                format!("内置 mnova-mcp {version} 就绪；MestReNova 检测见依赖面板"),
                "ready",
            )
        };
        return mk_status(false, false, state, detail, true, true);
    }

    // test_connection=true：执行完整握手（Origin 额外执行 doctor）。
    let entry_ref = McpServerConfig {
        app_key: entry.app_key.clone(),
        server_name: entry.server_name.clone(),
        enabled,
        directory: directory.clone(),
    };
    let handshake_result =
        build_launch_command(layout, &entry_ref).and_then(|command| handshake(&command));
    let tools = match handshake_result {
        Err(error) => {
            return mk_status(false, false, "error", error.to_string(), true, true);
        }
        Ok(tools) => tools,
    };
    // 握手成功 → server_connected=true。
    if spec.app_key == "origin" {
        // Origin 额外要求：工具名至少存在 origin_ 前缀。
        let has_origin_tools = tools.iter().any(|name| name.starts_with("origin_"));
        if !has_origin_tools {
            return mk_status(
                true,
                false,
                "error",
                "MCP Server 未暴露 origin_* 工具，请检查内置 origin-mcp 安装".into(),
                true,
                true,
            );
        }
        let (state, bridge_ok, origin_ok, detail) = origin_doctor(layout);
        if bridge_ok && origin_ok {
            mk_status(true, true, "connected", detail, true, true)
        } else if bridge_ok && !origin_ok {
            mk_status(
                true,
                false,
                "origin-unreachable",
                format!(
                    "Origin MCP Server 正常，Bridge 已连接，但 Origin automation 不可达。{}",
                    detail
                ),
                true,
                true,
            )
        } else if state == "unavailable" {
            mk_status(true, false, "error", detail, true, true)
        } else {
            mk_status(
                true,
                false,
                "bridge-missing",
                "Origin MCP Server 正常，但未检测到 Origin MCP Bridge。请打开 Origin/OriginPro，并启动 “Origin MCP Bridge Start”。"
                    .into(),
                true,
                true,
            )
        }
    } else {
        // Mnova：需要 mnova_ 前缀工具存在，并调用 mnova_status 判断
        // MestReNova / bridge 是否真正可用（任务书 §10）。
        let required = [
            "mnova_status",
            "mnova_process_1d",
            "mnova_prepare_structure_1d",
            "mnova_apply_assignments_1d",
        ];
        let missing_tools: Vec<&str> = required
            .iter()
            .copied()
            .filter(|name| !tools.iter().any(|tool| tool == name))
            .collect();
        if !missing_tools.is_empty() {
            return mk_status(
                true,
                false,
                "error",
                format!(
                    "MCP Server 缺少核心工具（{}），请检查内置 mnova-mcp 安装",
                    missing_tools.join(", ")
                ),
                true,
                true,
            );
        }
        // mnova_status → 判断 MestReNova executable / bridge.qs。
        let entry_ref = McpServerConfig {
            app_key: entry.app_key.clone(),
            server_name: entry.server_name.clone(),
            enabled,
            directory: directory.clone(),
        };
        let status_json = build_launch_command(layout, &entry_ref)
            .and_then(|command| call_mnova_status(&command));
        match status_json {
            Err(error) => mk_status(
                true,
                false,
                "mnova-missing",
                format!("MCP Server 正常，但无法读取 Mnova 状态：{error}"),
                true,
                true,
            ),
            Ok(json) => {
                let exe = json
                    .pointer("/mnova_executable")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string();
                let bridge_ok = json
                    .pointer("/bridge_script_exists")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                if !exe.is_empty() && bridge_ok {
                    mk_status(
                        true,
                        true,
                        "connected",
                        format!("Mnova MCP Server、MestReNova（{exe}）与 bridge.qs 均正常"),
                        true,
                        true,
                    )
                } else if exe.is_empty() {
                    mk_status(
                        true,
                        false,
                        "mnova-missing",
                        "MCP Server 正常，但未检测到 MestReNova.exe。安装并授权 MestReNova 15 后可启用 GUI/Verify 工作流；文件型 NMR 分析与 synthetic FID 能力仍可使用。"
                            .into(),
                        true,
                        true,
                    )
                } else {
                    mk_status(
                        true,
                        false,
                        "bridge-missing",
                        format!("MestReNova 已检测到（{exe}），但 bridge.qs 缺失：{bridge_ok}"),
                        true,
                        true,
                    )
                }
            }
        }
    }
}

/// 对已启动的 Mnova MCP 发送 initialize + initialized + tools/call(mnova_status)，
/// 返回其 JSON-RPC result（含 mnova_executable / bridge_script_exists 等）。
fn call_mnova_status(command: &McpLaunchCommand) -> Result<serde_json::Value, RuntimeError> {
    let mut child = Command::new(&command.program);
    no_window(&mut child);
    let mut child = child
        .args(&command.args)
        .envs(command.env.iter().cloned())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| RuntimeError::new(format!("无法启动 Mnova MCP: {error}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| RuntimeError::new("MCP stdin 不可用"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| RuntimeError::new("MCP stdout 不可用"))?;
    let messages = [
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"ibm-lab-desktop","version":"0.2.0"}}}"#,
        r#"{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}"#,
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"mnova_status","arguments":{}}}"#,
    ];
    for message in messages {
        writeln!(stdin, "{message}").map_err(|error| {
            RuntimeError::new(format!("无法向 Mnova MCP 发送自检请求: {error}"))
        })?;
    }
    stdin
        .flush()
        .map_err(|error| RuntimeError::new(format!("无法提交 Mnova MCP 自检请求: {error}")))?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let is_call_response = serde_json::from_str::<serde_json::Value>(&line)
                .ok()
                .and_then(|value| value.get("id").and_then(|id| id.as_i64()))
                == Some(2);
            if is_call_response {
                let _ = sender.send(line);
                return;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(20);
    let result = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break Err(RuntimeError::new("Mnova mnova_status 调用超时（20 秒）"));
        }
        match receiver.recv_timeout(remaining) {
            Ok(line) if line.contains(r#""error"#) => {
                break Err(RuntimeError::new(format!("Mnova MCP 返回错误: {line}")))
            }
            Ok(line) => {
                break parse_tool_result_content(&line);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                break Err(RuntimeError::new("Mnova mnova_status 调用超时（20 秒）"))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break Err(RuntimeError::new("Mnova MCP 在完成调用前退出"))
            }
        }
    };
    let _ = child.kill();
    let _ = child.wait();
    result
}

/// 从 tools/call 响应中解析 result.content[0].text 为 JSON（MCP 工具返回约定）。
fn parse_tool_result_content(line: &str) -> Result<serde_json::Value, RuntimeError> {
    let value: serde_json::Value =
        serde_json::from_str(line).map_err(|_| RuntimeError::new("Mnova MCP 响应不是合法 JSON"))?;
    let text = value
        .pointer("/result/content/0/text")
        .and_then(|text| text.as_str())
        .ok_or_else(|| RuntimeError::new("Mnova MCP tools/call 响应缺少 content[0].text"))?;
    serde_json::from_str(text)
        .map_err(|error| RuntimeError::new(format!("mnova_status 返回不是合法 JSON: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sandbox(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ibm-mcp-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn layout_with_python() -> (RuntimeLayout, PathBuf) {
        let sandbox = sandbox("layout");
        let resources = sandbox.join("resources");
        let dist = resources.join("python").join("dist");
        std::fs::create_dir_all(dist.join("Lib").join("site-packages")).unwrap();
        std::fs::write(dist.join("python.exe"), "python").unwrap();
        let layout = RuntimeLayout::new(sandbox.join("data"), resources);
        layout.create_user_directories().unwrap();
        (layout, sandbox)
    }

    fn origin_entry(enabled: bool) -> McpServerConfig {
        McpServerConfig {
            app_key: "origin".into(),
            server_name: "origin".into(),
            enabled,
            directory: String::new(),
        }
    }

    fn mnova_entry(enabled: bool, directory: &str) -> McpServerConfig {
        McpServerConfig {
            app_key: "mnova".into(),
            server_name: "mnova".into(),
            enabled,
            directory: directory.into(),
        }
    }

    #[test]
    fn spec_for_returns_expected_launch_kinds() {
        let mnova = spec_for("mnova").expect("mnova spec");
        assert_eq!(mnova.server_name, "mnova");
        assert!(!mnova.requires_directory);
        assert_eq!(
            mnova.launch_kind,
            McpLaunchKind::BundledPythonModule {
                module: "mnova_mcp"
            }
        );
        let origin = spec_for("origin").expect("origin spec");
        assert_eq!(origin.server_name, "origin");
        assert!(!origin.requires_directory);
        assert_eq!(
            origin.launch_kind,
            McpLaunchKind::BundledPythonModule {
                module: "origin_mcp"
            }
        );
        assert!(spec_for("invalid").is_none());
        assert!(spec_for("").is_none());
    }

    #[test]
    fn origin_launch_command_uses_bundled_python_module() {
        let (layout, sandbox) = layout_with_python();
        let command = build_launch_command(&layout, &origin_entry(true)).expect("launch command");
        assert_eq!(command.program, layout.bundled_python());
        let args: Vec<String> = command
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args, ["-m", "origin_mcp"]);
        let env: Vec<(String, String)> = command
            .env
            .iter()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().into_owned(),
                    v.to_string_lossy().into_owned(),
                )
            })
            .collect();
        assert!(
            env.contains(&("ORIGIN_MCP_TOOL_PROFILE".into(), "compact".into())),
            "origin 必须默认 compact profile: {env:?}"
        );
        let _ = std::fs::remove_dir_all(sandbox);
    }

    #[test]
    fn mnova_launch_command_uses_bundled_python_module() {
        let (layout, sandbox) = layout_with_python();
        let command =
            build_launch_command(&layout, &mnova_entry(true, "")).expect("launch command");
        assert_eq!(command.program, layout.bundled_python());
        let args: Vec<String> = command
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args, ["-m", "mnova_mcp"]);
        // Mnova 不需要 ORIGIN_MCP_TOOL_PROFILE（那是 origin_mcp 专有）。
        assert!(
            command.env.is_empty(),
            "mnova 不应注入 origin env: {:?}",
            command.env
        );
        let _ = std::fs::remove_dir_all(sandbox);
    }

    #[test]
    fn validate_origin_accepts_package_but_rejects_missing_package() {
        let (layout, sandbox) = layout_with_python();
        // 未创建 origin_mcp 包目录 → 校验失败（安装损坏）
        assert!(validate_enabled_server(&layout, &origin_entry(true)).is_err());
        // 创建包 → 校验通过（不要求 Origin 应用 / Bridge 存在）
        let package = layout
            .resources
            .join("python")
            .join("dist")
            .join("Lib")
            .join("site-packages")
            .join("origin_mcp");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(package.join("__init__.py"), "v").unwrap();
        assert!(validate_enabled_server(&layout, &origin_entry(true)).is_ok());
        let _ = std::fs::remove_dir_all(sandbox);
    }

    #[test]
    fn validate_mnova_accepts_package_but_rejects_missing_package() {
        let (layout, sandbox) = layout_with_python();
        // 未创建 mnova_mcp 包目录 → 校验失败（安装损坏）
        assert!(validate_enabled_server(&layout, &mnova_entry(true, "")).is_err());
        // 创建包 → 校验通过（不要求 MestReNova 安装）
        let package = layout
            .resources
            .join("python")
            .join("dist")
            .join("Lib")
            .join("site-packages")
            .join("mnova_mcp");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(package.join("__init__.py"), "v").unwrap();
        assert!(validate_enabled_server(&layout, &mnova_entry(true, "")).is_ok());
        let _ = std::fs::remove_dir_all(sandbox);
    }

    #[test]
    fn unconfigured_origin_is_not_invalid() {
        let (layout, sandbox) = layout_with_python();
        let config = AppConfig::default();
        let status = status(&layout, &config, "origin", false);
        assert_eq!(status.state, "unconfigured");
        assert!(!status.configured);
        assert!(!status.requires_directory);
        assert_eq!(status.launcher, "内置 Python（python -m origin_mcp）");
        let _ = std::fs::remove_dir_all(sandbox);
    }

    #[test]
    fn unconfigured_mnova_is_not_invalid() {
        let (layout, sandbox) = layout_with_python();
        let config = AppConfig::default();
        let status = status(&layout, &config, "mnova", false);
        assert_eq!(status.state, "unconfigured");
        assert!(!status.configured);
        assert!(!status.requires_directory);
        assert_eq!(status.launcher, "内置 Python（python -m mnova_mcp）");
        let _ = std::fs::remove_dir_all(sandbox);
    }

    #[test]
    fn parse_tool_names_requires_at_least_one_tool() {
        let names = parse_tool_names(
            r#"{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"origin_open_project"}]}}"#,
        )
        .expect("valid response");
        assert_eq!(names, ["origin_open_project"]);
        assert!(parse_tool_names(r#"{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}"#).is_err());
        assert!(parse_tool_names(r#"{"jsonrpc":"2.0","id":2,"result":{"no":"tools"}}"#).is_err());
        assert!(parse_tool_names("not json").is_err());
    }

    #[test]
    fn origin_package_dir_points_into_bundled_dist() {
        let (layout, sandbox) = layout_with_python();
        let dir = origin_mcp_package_dir(&layout).expect("package dir");
        assert!(dir.ends_with(Path::new("python/dist/Lib/site-packages/origin_mcp")));
        let _ = std::fs::remove_dir_all(sandbox);
    }

    #[test]
    fn mnova_package_dir_points_into_bundled_dist() {
        let (layout, sandbox) = layout_with_python();
        let dir = mnova_mcp_package_dir(&layout).expect("package dir");
        assert!(dir.ends_with(Path::new("python/dist/Lib/site-packages/mnova_mcp")));
        let _ = std::fs::remove_dir_all(sandbox);
    }

    #[test]
    fn parse_mnova_status_tool_result_content() {
        let json = r#"{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"ok\": true, \"mnova_executable\": \"C:\\\\Program Files\\\\Mestrelab\\\\MestReNova.exe\", \"bridge_script_exists\": true}"}]}}"#;
        let value = parse_tool_result_content(json).expect("parse");
        assert_eq!(
            value.pointer("/mnova_executable").and_then(|v| v.as_str()),
            Some(r"C:\Program Files\Mestrelab\MestReNova.exe")
        );
        assert_eq!(
            value
                .pointer("/bridge_script_exists")
                .and_then(|v| v.as_bool()),
            Some(true)
        );
        // 缺少 content[0].text 视为错误
        assert!(
            parse_tool_result_content(r#"{"jsonrpc":"2.0","id":2,"result":{"content":[]}}"#)
                .is_err()
        );
    }
}
