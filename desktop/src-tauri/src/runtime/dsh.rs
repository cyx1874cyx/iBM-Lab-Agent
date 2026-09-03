use super::{logging::AppLogger, RuntimeError};
use std::fs;
use std::path::{Path, PathBuf};

pub struct RuntimeLayout {
    pub root: PathBuf,
    pub config_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub workspace_dir: PathBuf,
    pub state_dir: PathBuf,
    pub dsh_home: PathBuf,
    pub resources: PathBuf,
}

impl RuntimeLayout {
    pub fn new(root: PathBuf, resources: PathBuf) -> Self {
        Self {
            config_dir: root.join("config"),
            logs_dir: root.join("logs"),
            workspace_dir: root.join("workspace"),
            state_dir: root.join("runtime-state"),
            dsh_home: root.join("dsh"),
            root,
            resources,
        }
    }
    pub fn create_user_directories(&self) -> Result<(), RuntimeError> {
        for directory in [
            &self.root,
            &self.config_dir,
            &self.logs_dir,
            &self.workspace_dir,
            &self.state_dir,
            &self.dsh_home,
        ] {
            fs::create_dir_all(directory).map_err(|error| {
                RuntimeError::new(format!(
                    "Cannot create user data directory {}: {error}",
                    directory.display()
                ))
            })?;
        }
        Ok(())
    }
    pub fn node_exe(&self) -> PathBuf {
        self.resources.join("node").join("node.exe")
    }
    pub fn dsh_bin(&self) -> PathBuf {
        self.resources
            .join("dsh")
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh")
            .join("lib")
            .join("bin.js")
    }
    pub fn dsh_node_modules(&self) -> PathBuf {
        self.resources.join("dsh").join("node_modules")
    }
    /// Bundled Python interpreter (resources/python/dist), platform-aware.
    /// dist/ is a self-contained Python install (interpreter + stdlib +
    /// site-packages all in one tree), so the packaged app works offline
    /// without any system Python. Note: a copied venv is NOT portable on
    /// Windows (pyvenv.cfg pins the base interpreter), hence the dist layout.
    pub fn bundled_python(&self) -> PathBuf {
        let dist = self.resources.join("python").join("dist");
        if cfg!(windows) {
            dist.join("python.exe")
        } else {
            dist.join("bin").join("python3")
        }
    }
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), RuntimeError> {
    if !source.exists() {
        return Err(RuntimeError::new(format!(
            "Bundled resource missing: {}",
            source.display()
        )));
    }
    fs::create_dir_all(target).map_err(|error| {
        RuntimeError::new(format!("Cannot create {}: {error}", target.display()))
    })?;
    for entry in fs::read_dir(source)
        .map_err(|error| RuntimeError::new(format!("Cannot read {}: {error}", source.display())))?
    {
        let entry = entry
            .map_err(|error| RuntimeError::new(format!("Cannot enumerate resource: {error}")))?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        if entry
            .file_type()
            .map_err(|error| RuntimeError::new(format!("Cannot inspect resource: {error}")))?
            .is_dir()
        {
            copy_tree(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|error| {
                RuntimeError::new(format!("Cannot copy {}: {error}", from.display()))
            })?;
        }
    }
    Ok(())
}

fn replace_tree(source: &Path, target: &Path) -> Result<(), RuntimeError> {
    if target.exists() {
        fs::remove_dir_all(target).map_err(|error| {
            RuntimeError::new(format!(
                "Cannot remove stale managed data {}: {error}",
                target.display()
            ))
        })?;
    }
    copy_tree(source, target)
}

fn write_if_missing(path: &Path, contents: &str) -> Result<(), RuntimeError> {
    if !path.exists() {
        fs::write(path, contents).map_err(|error| {
            RuntimeError::new(format!("Cannot write {}: {error}", path.display()))
        })?;
    }
    Ok(())
}

pub fn bootstrap_user_data(layout: &RuntimeLayout, logger: &AppLogger) -> Result<(), RuntimeError> {
    if !layout.node_exe().exists() || !layout.dsh_bin().exists() {
        return Err(RuntimeError::new(
            "Bundled Node.js or DSH runtime is missing. Reinstall iBM Lab Agent.",
        ));
    }
    let profile_dir = layout.dsh_home.join("profiles").join("ibm-lab");
    fs::create_dir_all(&profile_dir)
        .map_err(|error| RuntimeError::new(format!("Cannot create ibm-lab profile: {error}")))?;
    write_if_missing(
        &profile_dir.join("package.json"),
        r#"{
  "name": "dsh-profile-ibm-lab",
  "private": true,
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-lab-agent"] } }
}"#,
    )?;
    write_if_missing(&profile_dir.join("cordis.patch.yml"), "[]\n")?;

    let plugin = layout.resources.join("plugin");
    let bundled_plugin = plugin.join("dsh-lab-agent");
    let lab_home = layout.dsh_home.join("lab-agent");
    let marker = lab_home.join(".desktop-bootstrap-state");
    let package_manifest =
        fs::read_to_string(bundled_plugin.join("package.json")).map_err(|error| {
            RuntimeError::new(format!("Cannot read bundled plugin manifest: {error}"))
        })?;
    let vendor_lock = fs::read_to_string(plugin.join("vendor.lock.json"))
        .map_err(|error| RuntimeError::new(format!("Cannot read bundled vendor lock: {error}")))?;
    let requirements = fs::read_to_string(bundled_plugin.join("python").join("requirements.lock"))
        .map_err(|error| RuntimeError::new(format!("Cannot read bundled Python lock: {error}")))?;
    // 0.2.0：mnova-mcp（含 nmr-analyze-simulate skill）独立 component lock。
    // 纳入 marker 使 vendor 树中 mnova-mcp 变更（contentHash/版本变化）时
    // 桌面端自动重新物化 vendor，而不是等 nature-skills 锁变化才刷新。
    let mnova_lock = fs::read_to_string(bundled_plugin.join("vendor").join("mnova-mcp.lock.json"))
        .map_err(|error| {
            RuntimeError::new(format!("Cannot read bundled mnova-mcp lock: {error}"))
        })?;
    let desired_state = format!(
        "desktop={}\nmanifest={}\nvendor={}\nrequirements={}\nmnova={}\n",
        env!("CARGO_PKG_VERSION"),
        package_manifest,
        vendor_lock,
        requirements,
        mnova_lock
    );
    let current_state = fs::read_to_string(&marker).unwrap_or_default();
    if current_state != desired_state {
        logger.app("Materializing bundled iBM Lab data into AppData")?;
        replace_tree(
            &bundled_plugin,
            &profile_dir.join("node_modules").join("dsh-lab-agent"),
        )?;
        replace_tree(
            &plugin.join("presets").join("lab-research"),
            &layout.dsh_home.join(".agent-presets").join("lab-research"),
        )?;
        fs::create_dir_all(&lab_home).map_err(|error| {
            RuntimeError::new(format!("Cannot create lab data directory: {error}"))
        })?;
        replace_tree(&bundled_plugin.join("vendor"), &lab_home.join("vendor"))?;
        fs::copy(
            plugin.join("vendor.lock.json"),
            lab_home.join("vendor.lock.json"),
        )
        .map_err(|error| RuntimeError::new(format!("Cannot copy vendor.lock.json: {error}")))?;
        fs::copy(
            bundled_plugin.join("python").join("requirements.lock"),
            lab_home.join("requirements.lock"),
        )
        .map_err(|error| RuntimeError::new(format!("Cannot copy requirements.lock: {error}")))?;
        fs::create_dir_all(lab_home.join("projects")).map_err(|error| {
            RuntimeError::new(format!("Cannot create lab projects directory: {error}"))
        })?;
        fs::write(marker, desired_state).map_err(|error| {
            RuntimeError::new(format!("Cannot write bootstrap marker: {error}"))
        })?;
        let legacy_marker = lab_home.join(".desktop-bootstrap-v1");
        if legacy_marker.exists() {
            let _ = fs::remove_file(legacy_marker);
        }
    }
    Ok(())
}

/// Build the optional profile overlay used by the desktop MCP manager.  The
/// repository path is passed through the child environment, so paths with
/// spaces never have to be interpolated into YAML.
///
/// 启动命令按 [super::mcp::McpAppSpec] 输出（0.2.0 起均为 bundled Python 模块）：
/// - Mnova：IBM_LAB_AGENT_BUNDLED_PYTHON -m mnova_mcp，注入
///   MNOVA_MCP_WORKSPACE/OUTPUT_ROOT/RUNTIME_ROOT/BRIDGE_SCRIPT，
///   toolCallTimeoutMs=360000（任务可能持续数分钟）。
/// - Origin：IBM_LAB_AGENT_BUNDLED_PYTHON -m origin_mcp，注入
///   ORIGIN_MCP_TOOL_PROFILE=compact。
/// 不把打包后的绝对路径写进 YAML，解释器路径一律经环境变量传递。
pub fn prepare_mcp_patch(
    layout: &RuntimeLayout,
    servers: &[super::config::McpServerConfig],
) -> Result<Option<PathBuf>, RuntimeError> {
    let enabled: Vec<_> = servers.iter().filter(|entry| entry.enabled).collect();
    if enabled.is_empty() {
        return Ok(None);
    }
    let path = layout.config_dir.join("managed-mcp.patch.yml");
    let mut contents = String::from("- insert:\n");
    for entry in enabled {
        if entry.server_name.is_empty()
            || entry.server_name.len() > 32
            || !entry
                .server_name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err(RuntimeError::new("Invalid managed MCP server name"));
        }
        let spec = super::mcp::spec_for(&entry.app_key).ok_or_else(|| {
            RuntimeError::new(format!("Invalid managed MCP app_key: {}", entry.app_key))
        })?;
        let server = &entry.server_name;
        let module = match spec.launch_kind {
            super::mcp::McpLaunchKind::BundledPythonModule { module } => module,
        };
        if spec.app_key == "mnova" {
            // 0.2.0：Mnova 走 bundled Python。四个 MNOVA_MCP_* 运行时路径经
            // 子进程环境注入（IBM_LAB_MNOVA_*），YAML 只引用 process.env，
            // 避免把含空格/中文的绝对路径拼进 YAML。
            contents.push_str(&format!(
                r#"    - id: mcp-{server}
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: {server}
        transport: stdio
        command: !!js process.env['IBM_LAB_AGENT_BUNDLED_PYTHON']
        args:
          - -m
          - {module}
        env:
          MNOVA_MCP_WORKSPACE: !!js process.env['IBM_LAB_MNOVA_WORKSPACE']
          MNOVA_MCP_OUTPUT_ROOT: !!js process.env['IBM_LAB_MNOVA_OUTPUT_ROOT']
          MNOVA_MCP_RUNTIME_ROOT: !!js process.env['IBM_LAB_MNOVA_RUNTIME_ROOT']
          MNOVA_MCP_BRIDGE_SCRIPT: !!js process.env['IBM_LAB_MNOVA_BRIDGE_SCRIPT']
        toolCallTimeoutMs: 360000
        failOnStartupError: false
"#,
                server = server,
            ));
        } else {
            // Origin：工具面档位来自配置（默认 compact）。值经白名单校验后
            // 才可拼入 YAML，防手改配置注入非法键/值。
            let profile = entry
                .tool_profile
                .as_deref()
                .unwrap_or("compact")
                .trim()
                .to_ascii_lowercase();
            if !super::mcp::is_valid_origin_profile(&profile) {
                return Err(RuntimeError::new(format!(
                    "Unsupported Origin tool profile: {profile:?}（可选：{:?}）",
                    super::mcp::ORIGIN_TOOL_PROFILES
                )));
            }
            contents.push_str(&format!(
                r#"    - id: mcp-{server}
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: {server}
        transport: stdio
        command: !!js process.env['IBM_LAB_AGENT_BUNDLED_PYTHON']
        args:
          - -m
          - {module}
        env:
          ORIGIN_MCP_TOOL_PROFILE: {profile}
        toolCallTimeoutMs: 120000
        failOnStartupError: false
"#,
                server = server,
            ));
        }
    }
    fs::write(&path, contents).map_err(|error| {
        RuntimeError::new(format!("Cannot write managed MCP profile overlay: {error}"))
    })?;
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_file(path: &Path, contents: &str) {
        fs::create_dir_all(path.parent().expect("fixture file has a parent")).unwrap();
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn materializes_required_lab_data_and_refreshes_managed_trees() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sandbox =
            std::env::temp_dir().join(format!("ibm-lab-bootstrap-{}-{nonce}", std::process::id()));
        let resources = sandbox.join("resources");
        let plugin = resources.join("plugin");
        let bundled_plugin = plugin.join("dsh-lab-agent");
        write_file(&resources.join("node").join("node.exe"), "node");
        write_file(
            &resources
                .join("dsh")
                .join("node_modules")
                .join("@deepseek-ai")
                .join("dsh")
                .join("lib")
                .join("bin.js"),
            "dsh",
        );
        write_file(
            &bundled_plugin.join("package.json"),
            r#"{"version":"1.0.0"}"#,
        );
        write_file(
            &bundled_plugin
                .join("vendor")
                .join("nature-skills")
                .join("skills")
                .join("sample")
                .join("SKILL.md"),
            "v1",
        );
        write_file(
            &bundled_plugin.join("python").join("requirements.lock"),
            "example==1.0\n",
        );
        write_file(
            &bundled_plugin.join("vendor").join("mnova-mcp.lock.json"),
            r#"{"name":"mnova-mcp","version":"0.3.1","contentHash":"v1"}"#,
        );
        write_file(
            &plugin
                .join("presets")
                .join("lab-research")
                .join("agent.cordis.yml"),
            "preset-v1",
        );
        write_file(&plugin.join("vendor.lock.json"), r#"{"pinned":"v1"}"#);

        let layout = RuntimeLayout::new(sandbox.join("data"), resources);
        layout.create_user_directories().unwrap();
        let logger = AppLogger::new(layout.logs_dir.clone()).unwrap();
        bootstrap_user_data(&layout, &logger).unwrap();

        let lab_home = layout.dsh_home.join("lab-agent");
        let profile_plugin = layout
            .dsh_home
            .join("profiles")
            .join("ibm-lab")
            .join("node_modules")
            .join("dsh-lab-agent");
        assert!(lab_home
            .join("vendor")
            .join("nature-skills")
            .join("skills")
            .join("sample")
            .join("SKILL.md")
            .exists());
        assert_eq!(
            fs::read_to_string(lab_home.join("requirements.lock")).unwrap(),
            "example==1.0\n"
        );
        assert!(profile_plugin.join("package.json").exists());

        write_file(&profile_plugin.join("removed-in-v2.txt"), "stale");
        write_file(&lab_home.join("vendor").join("removed-in-v2.txt"), "stale");
        write_file(
            &bundled_plugin.join("package.json"),
            r#"{"version":"2.0.0"}"#,
        );
        write_file(
            &bundled_plugin.join("python").join("requirements.lock"),
            "example==2.0\n",
        );
        write_file(
            &bundled_plugin.join("vendor").join("mnova-mcp.lock.json"),
            r#"{"name":"mnova-mcp","version":"0.3.1","contentHash":"v2"}"#,
        );
        write_file(&plugin.join("vendor.lock.json"), r#"{"pinned":"v2"}"#);
        bootstrap_user_data(&layout, &logger).unwrap();

        assert!(!profile_plugin.join("removed-in-v2.txt").exists());
        assert!(!lab_home.join("vendor").join("removed-in-v2.txt").exists());
        assert_eq!(
            fs::read_to_string(lab_home.join("requirements.lock")).unwrap(),
            "example==2.0\n"
        );
        assert_eq!(
            fs::read_to_string(lab_home.join("vendor.lock.json")).unwrap(),
            r#"{"pinned":"v2"}"#
        );

        let _ = fs::remove_dir_all(sandbox);
    }

    #[test]
    fn prepare_mcp_patch_mnova_uses_bundled_python_and_mnova_env() {
        let sandbox = std::env::temp_dir().join(format!(
            "ibm-patch-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let layout = RuntimeLayout::new(sandbox.join("data"), sandbox.join("resources"));
        layout.create_user_directories().unwrap();
        let servers = [super::super::config::McpServerConfig {
            app_key: "mnova".into(),
            server_name: "mnova".into(),
            enabled: true,
            directory: String::new(),
            tool_profile: None,
        }];
        let patch = prepare_mcp_patch(&layout, &servers)
            .unwrap()
            .expect("enabled mnova must produce a patch");
        let contents = fs::read_to_string(patch).unwrap();
        assert!(contents.contains("- id: mcp-mnova"));
        assert!(contents.contains("serverName: mnova"));
        // 0.2.0：Mnova 走 bundled Python（python -m mnova_mcp），解释器经环境变量传递
        assert!(contents.contains("!!js process.env['IBM_LAB_AGENT_BUNDLED_PYTHON']"));
        assert!(contents.contains("- -m"));
        assert!(contents.contains("- mnova_mcp"));
        // 四个 MNOVA_MCP_* 运行时路径经 IBM_LAB_MNOVA_* 子进程环境注入
        assert!(
            contents.contains("MNOVA_MCP_WORKSPACE: !!js process.env['IBM_LAB_MNOVA_WORKSPACE']")
        );
        assert!(contents
            .contains("MNOVA_MCP_OUTPUT_ROOT: !!js process.env['IBM_LAB_MNOVA_OUTPUT_ROOT']"));
        assert!(contents
            .contains("MNOVA_MCP_RUNTIME_ROOT: !!js process.env['IBM_LAB_MNOVA_RUNTIME_ROOT']"));
        assert!(contents
            .contains("MNOVA_MCP_BRIDGE_SCRIPT: !!js process.env['IBM_LAB_MNOVA_BRIDGE_SCRIPT']"));
        // 长任务超时：Mnova 用 360s，避免 process 类任务被 DSH 客户端提前判定失败
        assert!(contents.contains("toolCallTimeoutMs: 360000"));
        assert!(contents.contains("failOnStartupError: false"));
        // 不再出现 uv 项目型字段
        assert!(!contents.contains("uv"));
        assert!(!contents.contains("run_server.py"));
        assert!(!contents.contains("--directory"));
        assert!(!contents.contains("IBM_LAB_MCP_DIR_"));
        let _ = fs::remove_dir_all(sandbox);
    }

    #[test]
    fn prepare_mcp_patch_origin_uses_bundled_python_env() {
        let sandbox = std::env::temp_dir().join(format!(
            "ibm-patch-origin-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let layout = RuntimeLayout::new(sandbox.join("data"), sandbox.join("resources"));
        layout.create_user_directories().unwrap();
        let servers = [super::super::config::McpServerConfig {
            app_key: "origin".into(),
            server_name: "origin".into(),
            enabled: true,
            directory: String::new(),
            tool_profile: None,
        }];
        let patch = prepare_mcp_patch(&layout, &servers)
            .unwrap()
            .expect("enabled origin must produce a patch");
        let contents = fs::read_to_string(patch).unwrap();
        assert!(contents.contains("- id: mcp-origin"));
        assert!(contents.contains("serverName: origin"));
        // 不把打包后的绝对路径插进 YAML，解释器路径走环境变量
        assert!(contents.contains("!!js process.env['IBM_LAB_AGENT_BUNDLED_PYTHON']"));
        assert!(!contents.contains(r"C:\Program Files"));
        assert!(contents.contains("- -m"));
        assert!(contents.contains("- origin_mcp"));
        assert!(contents.contains("ORIGIN_MCP_TOOL_PROFILE: compact"));
        assert!(!contents.contains("uv"));
        let _ = fs::remove_dir_all(sandbox);
    }

    #[test]
    fn prepare_mcp_patch_returns_none_without_enabled_servers() {
        let sandbox = std::env::temp_dir().join(format!(
            "ibm-patch-none-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let layout = RuntimeLayout::new(sandbox.join("data"), sandbox.join("resources"));
        layout.create_user_directories().unwrap();
        let servers = [
            super::super::config::McpServerConfig {
                app_key: "mnova".into(),
                server_name: "mnova".into(),
                enabled: false,
                directory: String::new(),
                tool_profile: None,
            },
            super::super::config::McpServerConfig {
                app_key: "origin".into(),
                server_name: "origin".into(),
                enabled: false,
                directory: String::new(),
                tool_profile: None,
            },
        ];
        assert!(prepare_mcp_patch(&layout, &servers).unwrap().is_none());
        let _ = fs::remove_dir_all(sandbox);
    }

    #[test]
    fn prepare_mcp_patch_rejects_invalid_server_names_and_app_keys() {
        let sandbox = std::env::temp_dir().join(format!(
            "ibm-patch-invalid-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let layout = RuntimeLayout::new(sandbox.join("data"), sandbox.join("resources"));
        layout.create_user_directories().unwrap();
        // Case D-1：非法 server_name 仍拒绝
        let bad_name = [super::super::config::McpServerConfig {
            app_key: "mnova".into(),
            server_name: "bad name!".into(),
            enabled: true,
            directory: r"C:\tools\mnova-mcp".into(),
            tool_profile: None,
        }];
        assert!(prepare_mcp_patch(&layout, &bad_name).is_err());
        // Case D-2：app_key 无注册规格也拒绝（防止任意 executable 被启用）
        let bad_key = [super::super::config::McpServerConfig {
            app_key: "unknown-app".into(),
            server_name: "unknown".into(),
            enabled: true,
            directory: String::new(),
            tool_profile: None,
        }];
        assert!(prepare_mcp_patch(&layout, &bad_key).is_err());
        let _ = fs::remove_dir_all(sandbox);
    }
}
