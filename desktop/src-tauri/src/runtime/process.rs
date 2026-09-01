use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use super::{config::AppConfig, dsh::RuntimeLayout, logging::AppLogger, RuntimeError};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};

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
    let mut command = Command::new(layout.node_exe());
	#[cfg(windows)]
	command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    command
        .arg(layout.dsh_bin())
        .args([
            "--profile",
            "ibm-lab",
            "--no-open",
            "--host",
            "127.0.0.1",
            "--port",
        ])
        .arg(port.to_string())
        .current_dir(working_directory)
        .env("DSH_HOME", &layout.dsh_home)
        .env("DSH_HARNESS_NODE_MODULES", layout.dsh_node_modules())
        .env("IBM_LAB_AGENT_WORKSPACE", &layout.workspace_dir)
        .env("IBM_LAB_AGENT_BUNDLED_PYTHON", layout.bundled_python())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if !config.api_key.trim().is_empty() {
        command.env("OPENAI_API_KEY", config.api_key.trim());
    }
    if !config.base_url.trim().is_empty() {
        command.env("OPENAI_BASE_URL", config.base_url.trim());
    }
    if !config.model.trim().is_empty() {
        command.env("OPENAI_MODEL", config.model.trim());
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
}
