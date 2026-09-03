use std::ffi::OsString;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use super::{config::AppConfig, dsh::RuntimeLayout, logging::AppLogger, RuntimeError};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};

/// DSH launcher flags must precede the first inner web-app argument.  The
/// launcher deliberately forwards everything from `--no-open` onward to the
/// selected profile, so appending `--patch` at the end makes the web command
/// reject it as an unknown option.
fn dsh_arguments(layout: &RuntimeLayout, port: u16, patch: Option<&Path>) -> Vec<OsString> {
    let mut args = vec![
        layout.dsh_bin().into_os_string(),
        "--profile".into(),
        "ibm-lab".into(),
    ];
    if let Some(path) = patch {
        args.push("--patch".into());
        args.push(path.as_os_str().to_owned());
    }
    args.extend([
        "--no-open".into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string().into(),
    ]);
    args
}

#[cfg(windows)]
struct JobHandle(HANDLE);

#[cfg(windows)]
unsafe impl Send for JobHandle {}

#[cfg(windows)]
impl Drop for JobHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CloseHandle(self.0) };
        }
    }
}

pub struct ManagedProcess {
    child: Child,
    #[cfg(windows)]
    job: Option<JobHandle>,
}

impl ManagedProcess {
    pub fn id(&self) -> u32 {
        self.child.id()
    }
    pub fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }
}

fn pipe_to_log<R: Read + Send + 'static>(mut reader: R, logger: AppLogger, file: &'static str) {
    thread::spawn(move || {
        let mut buffer = [0; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    let text = String::from_utf8_lossy(&buffer[..size]);
                    let _ = logger.write(file, &text);
                }
            }
        }
    });
}

#[cfg(windows)]
fn create_kill_on_close_job(child: &Child) -> Result<JobHandle, RuntimeError> {
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if handle.is_null() {
        return Err(RuntimeError::new(format!(
            "Cannot create Windows Job Object: {}",
            std::io::Error::last_os_error()
        )));
    }
    let job = JobHandle(handle);
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let configured = unsafe {
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if configured == 0 {
        return Err(RuntimeError::new(format!(
            "Cannot configure Windows Job Object: {}",
            std::io::Error::last_os_error()
        )));
    }
    let assigned = unsafe { AssignProcessToJobObject(job.0, child.as_raw_handle() as HANDLE) };
    if assigned == 0 {
        return Err(RuntimeError::new(format!(
            "Cannot assign DSH to Windows Job Object: {}",
            std::io::Error::last_os_error()
        )));
    }
    Ok(job)
}

pub fn spawn_dsh(
    layout: &RuntimeLayout,
    logger: &AppLogger,
    port: u16,
    config: &AppConfig,
) -> Result<ManagedProcess, RuntimeError> {
    logger.app(&format!(
        "Spawning bundled Node and DSH profile=ibm-lab host=127.0.0.1 port={port}"
    ))?;
    let working_directory = if config.workspace.trim().is_empty() {
        layout.workspace_dir.clone()
    } else {
        let path = PathBuf::from(config.workspace.trim());
        if !path.is_dir() {
            return Err(RuntimeError::new(
                "Configured workspace does not exist or is not a directory",
            ));
        }
        path
    };
    for mcp in config.mcp_servers.iter().filter(|entry| entry.enabled) {
        super::mcp::validate_enabled_server(layout, mcp)?;
    }
    let mcp_patch = super::dsh::prepare_mcp_patch(layout, &config.mcp_servers)?;
    let mut command = Command::new(layout.node_exe());
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    command
        .args(dsh_arguments(layout, port, mcp_patch.as_deref()))
        .current_dir(&working_directory)
        .env("DSH_HOME", &layout.dsh_home)
        .env("DSH_HARNESS_NODE_MODULES", layout.dsh_node_modules())
        .env("IBM_LAB_AGENT_WORKSPACE", &layout.workspace_dir)
        .env("IBM_LAB_AGENT_BUNDLED_PYTHON", layout.bundled_python())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for mcp in config.mcp_servers.iter().filter(|entry| entry.enabled) {
        // 0.2.0：origin 与 mnova 均为内置 Python 模块型，不再注入
        // IBM_LAB_MCP_DIR_*（旧 uv 项目型字段已删除）。Mnova 需要四个
        // IBM_LAB_MNOVA_* 运行时路径，YAML patch 以 process.env 引用。
        if mcp.app_key == "mnova" {
            for (key, value) in mnova_child_env(&working_directory, layout) {
                command.env(key, value);
            }
        }
    }
    let mut child = command
        .spawn()
        .map_err(|error| RuntimeError::new(format!("Cannot start bundled DSH: {error}")))?;
    if let Some(stdout) = child.stdout.take() {
        pipe_to_log(stdout, logger.clone(), "dsh.log");
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_to_log(stderr, logger.clone(), "stderr.log");
    }
    #[cfg(windows)]
    let job = match create_kill_on_close_job(&child) {
        Ok(job) => {
            logger.app(&format!(
                "Assigned DSH pid={} to kill-on-close Windows Job Object",
                child.id()
            ))?;
            Some(job)
        }
        Err(error) => {
            logger.app(&format!(
                "Windows Job Object unavailable ({error}); taskkill remains the shutdown fallback"
            ))?;
            None
        }
    };
    Ok(ManagedProcess {
        child,
        #[cfg(windows)]
        job,
    })
}

/// Mnova 子进程需要注入的 IBM_LAB_MNOVA_* 环境变量。
/// 抽成纯函数以便单测断言（WORKSPACE / OUTPUT_ROOT / BRIDGE_SCRIPT 的
/// 取值与 RUNTIME_ROOT 的存在性）。
fn mnova_child_env(
    working_directory: &Path,
    layout: &RuntimeLayout,
) -> Vec<(&'static str, PathBuf)> {
    let mut envs = vec![
        ("IBM_LAB_MNOVA_WORKSPACE", working_directory.to_path_buf()),
        (
            "IBM_LAB_MNOVA_OUTPUT_ROOT",
            working_directory.join("mnova-output"),
        ),
        ("IBM_LAB_MNOVA_RUNTIME_ROOT", mnova_runtime_root()),
    ];
    if let Some(bridge) = super::mcp::mnova_bridge_script(layout) {
        envs.push(("IBM_LAB_MNOVA_BRIDGE_SCRIPT", bridge));
    }
    envs
}

/// Mnova runtime 临时目录（任务书 §13：MestReNova 对 ASCII 命令行路径
/// 更可靠）。优先 %LOCALAPPDATA%\iBM-Lab-Agent\runtime-state\mnova；
/// 当该路径含非 ASCII（如中文用户名）时回退到固定的 ASCII-safe 路径
/// C:\ProgramData\iBM-Lab-Agent\runtime\mnova\<user-hash>，避免要求用户
/// 修改 Windows 用户名。
fn mnova_runtime_root() -> PathBuf {
    let preferred = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|root| root.join(r"iBM-Lab-Agent\runtime-state\mnova"));
    let profile_key = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("LOCALAPPDATA"))
        .unwrap_or_default();
    mnova_runtime_root_for(preferred, &profile_key)
}

/// mnova_runtime_root 的纯逻辑部分（可单测）：preferred 为 ASCII 时直接
/// 使用，否则（或缺失）退回到 ProgramData 下以 profile_key 哈希命名的目录。
fn mnova_runtime_root_for(preferred: Option<PathBuf>, profile_key: &std::ffi::OsStr) -> PathBuf {
    match preferred {
        Some(path) if path.to_string_lossy().is_ascii() => path,
        _ => {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            profile_key.hash(&mut hasher);
            let user_hash = format!("{:016x}", hasher.finish());
            PathBuf::from(r"C:\ProgramData\iBM-Lab-Agent\runtime\mnova").join(user_hash)
        }
    }
}

fn pid_file(layout: &RuntimeLayout) -> PathBuf {
    layout.state_dir.join("dsh.pid")
}
pub fn write_pid_state(layout: &RuntimeLayout, pid: u32, port: u16) -> Result<(), RuntimeError> {
    fs::write(pid_file(layout), format!("{pid}\n{port}\n"))
        .map_err(|error| RuntimeError::new(format!("Cannot persist runtime state: {error}")))
}
pub fn read_pid_state(layout: &RuntimeLayout) -> Result<Option<u32>, RuntimeError> {
    read_runtime_state(layout).map(|state| state.map(|(pid, _)| pid))
}
pub fn read_runtime_state(layout: &RuntimeLayout) -> Result<Option<(u32, u16)>, RuntimeError> {
    let path = pid_file(layout);
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)
        .map_err(|error| RuntimeError::new(format!("Cannot read runtime state: {error}")))?;
    let mut lines = text.lines();
    let pid = lines
        .next()
        .and_then(|line| line.trim().parse::<u32>().ok())
        .filter(|pid| *pid > 0);
    let port = lines
        .next()
        .and_then(|line| line.trim().parse::<u16>().ok())
        .filter(|port| *port > 0);
    Ok(pid.zip(port))
}
pub fn remove_pid_state(layout: &RuntimeLayout) -> Result<(), RuntimeError> {
    let path = pid_file(layout);
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| RuntimeError::new(format!("Cannot remove runtime state: {error}")))?;
    };
    Ok(())
}

pub fn terminate_process_tree(
    child: &mut ManagedProcess,
    logger: &AppLogger,
) -> Result<(), RuntimeError> {
    #[cfg(windows)]
    if child.job.take().is_some() {
        logger.app(&format!(
            "Closed Windows Job Object for DSH pid={}; waiting for process tree cleanup",
            child.id()
        ))?;
        for _ in 0..100 {
            if child.try_wait().ok().flatten().is_some() {
                return Ok(());
            }
            thread::sleep(std::time::Duration::from_millis(20));
        }
        logger.app("Job Object close did not finish within 2 seconds; using taskkill fallback")?;
    }
    terminate_pid_tree(child.id(), logger)
}

fn command_line_matches_dsh(command_line: &str, layout: &RuntimeLayout) -> bool {
    let command_line = command_line.to_ascii_lowercase();
    let node = layout.node_exe().display().to_string().to_ascii_lowercase();
    let dsh = layout.dsh_bin().display().to_string().to_ascii_lowercase();
    command_line.contains(&node)
        && command_line.contains(&dsh)
        && command_line.contains("--profile ibm-lab")
        && command_line.contains("--host 127.0.0.1")
}
pub fn is_our_dsh_process(pid: u32, layout: &RuntimeLayout) -> bool {
    #[cfg(windows)]
    {
        let query = format!("$p=Get-CimInstance Win32_Process -Filter 'ProcessId={pid}' -ErrorAction SilentlyContinue; if ($p) {{ [Console]::Write($p.CommandLine) }}");
        let Ok(output) = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &query])
            .output()
        else {
            return false;
        };
        return command_line_matches_dsh(&String::from_utf8_lossy(&output.stdout), layout);
    }
    #[cfg(not(windows))]
    {
        let _ = (pid, layout);
        false
    }
}

pub fn terminate_pid_tree(pid: u32, logger: &AppLogger) -> Result<(), RuntimeError> {
    #[cfg(windows)]
    {
        let status = Command::new("taskkill.exe")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|error| {
                RuntimeError::new(format!("Cannot terminate DSH process tree: {error}"))
            })?;
        if !status.success() {
            logger.app(&format!(
                "taskkill returned {status} for stale/runtime PID {pid}"
            ))?;
        }
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
    logger.app(&format!(
        "DSH process tree termination requested for pid={pid}"
    ))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sandbox() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("ibm-lab-process-{}-{nonce}", std::process::id()))
    }

    fn write_file(path: &Path, contents: &str) {
        fs::create_dir_all(path.parent().expect("fixture file has a parent")).unwrap();
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn recognizes_only_the_bundled_ibm_lab_command() {
        let layout = RuntimeLayout::new(
            PathBuf::from(r"C:\Users\test\AppData\Local\iBM-Lab-Agent"),
            PathBuf::from(r"H:\iBM Lab Agent"),
        );
        let expected = r#"\"H:\iBM Lab Agent\node\node.exe\" \"H:\iBM Lab Agent\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js\" --profile ibm-lab --no-open --host 127.0.0.1 --port 3080"#;
        assert!(command_line_matches_dsh(expected, &layout));
        assert!(!command_line_matches_dsh(
            &expected.replace("ibm-lab", "other"),
            &layout
        ));
        assert!(!command_line_matches_dsh(
            &expected.replace(r"H:\iBM Lab Agent\node\node.exe", r"C:\node.exe"),
            &layout
        ));
    }

    #[test]
    fn dsh_patch_flag_precedes_inner_web_arguments() {
        let root = sandbox();
        let layout = RuntimeLayout::new(root.join("data"), root.join("resources"));
        let patch = root.join("managed-mcp.patch.yml");
        let args = dsh_arguments(&layout, 43123, Some(&patch));
        let text: Vec<_> = args
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();
        let patch_index = text.iter().position(|value| value == "--patch").unwrap();
        let inner_index = text.iter().position(|value| value == "--no-open").unwrap();
        assert!(
            patch_index < inner_index,
            "launcher flags must precede inner args: {text:?}"
        );
        assert_eq!(text[patch_index + 1], patch.to_string_lossy());
        assert_eq!(
            &text[inner_index..],
            &["--no-open", "--host", "127.0.0.1", "--port", "43123"]
        );
    }

    #[test]
    fn mnova_runtime_root_prefers_ascii_localappdata() {
        let preferred =
            PathBuf::from(r"C:\Users\alice\AppData\Local\iBM-Lab-Agent\runtime-state\mnova");
        let resolved = mnova_runtime_root_for(
            Some(preferred.clone()),
            std::ffi::OsStr::new(r"C:\Users\alice"),
        );
        assert_eq!(resolved, preferred);
    }

    #[test]
    fn mnova_runtime_root_falls_back_to_programdata_for_non_ascii_paths() {
        // 中文用户名 -> LOCALAPPDATA 含非 ASCII，必须回退到 ASCII-safe 路径
        let preferred =
            PathBuf::from(r"C:\Users\张三\AppData\Local\iBM-Lab-Agent\runtime-state\mnova");
        let profile_key = std::ffi::OsStr::new(r"C:\Users\张三");
        let resolved = mnova_runtime_root_for(Some(preferred), profile_key);
        let text = resolved.to_string_lossy().into_owned();
        assert!(
            text.starts_with(r"C:\ProgramData\iBM-Lab-Agent\runtime\mnova\"),
            "unexpected fallback: {text}"
        );
        assert!(text.is_ascii(), "fallback path must stay ASCII: {text}");
        assert!(resolved
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.len() == 16 && n.chars().all(|c| c.is_ascii_hexdigit())));
        // 相同 profile 稳定；不同 profile 产生不同目录
        let again = mnova_runtime_root_for(None, std::ffi::OsStr::new(r"C:\Users\张三"));
        assert_eq!(again, resolved);
        let other = mnova_runtime_root_for(None, std::ffi::OsStr::new(r"C:\Users\李四"));
        assert_ne!(other, resolved);
    }

    #[test]
    fn mnova_runtime_root_falls_back_when_localappdata_missing() {
        let resolved = mnova_runtime_root_for(None, std::ffi::OsStr::new(r"C:\Users\bob"));
        assert!(resolved
            .to_string_lossy()
            .starts_with(r"C:\ProgramData\iBM-Lab-Agent\runtime\mnova\"));
    }

    #[test]
    fn mnova_child_env_injects_workspace_output_root_and_bridge() {
        let root = sandbox();
        let resources = root.join("resources");
        // 模拟 bundled Python 中已安装的 mnova_mcp 包（site-packages/assets/bridge.qs）
        write_file(
            &resources
                .join("python")
                .join("dist")
                .join("Lib")
                .join("site-packages")
                .join("mnova_mcp")
                .join("assets")
                .join("bridge.qs"),
            "// bridge",
        );
        let layout = RuntimeLayout::new(root.join("data"), resources);
        let workspace = root.join("data").join("workspace");

        let envs = mnova_child_env(&workspace, &layout);
        let find = |key: &str| {
            envs.iter()
                .find(|(k, _)| *k == key)
                .unwrap_or_else(|| panic!("missing env {key}"))
                .1
                .clone()
        };
        assert_eq!(find("IBM_LAB_MNOVA_WORKSPACE"), workspace);
        assert_eq!(
            find("IBM_LAB_MNOVA_OUTPUT_ROOT"),
            workspace.join("mnova-output")
        );
        assert!(find("IBM_LAB_MNOVA_RUNTIME_ROOT")
            .to_string_lossy()
            .contains("mnova"));
        assert_eq!(
            find("IBM_LAB_MNOVA_BRIDGE_SCRIPT"),
            layout
                .resources
                .join("python")
                .join("dist")
                .join("Lib")
                .join("site-packages")
                .join("mnova_mcp")
                .join("assets")
                .join("bridge.qs")
        );
        assert_eq!(envs.len(), 4);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn mnova_child_env_omits_bridge_when_package_missing() {
        let root = sandbox();
        let resources = root.join("resources");
        // 无 bundled mnova_mcp 包：不注入 BRIDGE_SCRIPT，其余三个仍注入
        let layout = RuntimeLayout::new(root.join("data"), resources);
        let workspace = root.join("data").join("workspace");

        let envs = mnova_child_env(&workspace, &layout);
        assert_eq!(envs.len(), 3);
        assert!(envs
            .iter()
            .all(|(key, _)| *key != "IBM_LAB_MNOVA_BRIDGE_SCRIPT"));
        assert!(envs
            .iter()
            .any(|(key, _)| *key == "IBM_LAB_MNOVA_WORKSPACE"));
        let _ = fs::remove_dir_all(&root);
    }
}
