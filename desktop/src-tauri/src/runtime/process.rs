use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use super::{config::AppConfig, dsh::RuntimeLayout, logging::AppLogger, RuntimeError};

pub type ManagedProcess = Child;

fn pipe_to_log<R: Read + Send + 'static>(mut reader: R, logger: AppLogger, file: &'static str) {
    thread::spawn(move || {
        let mut buffer = [0; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(size) => { let text = String::from_utf8_lossy(&buffer[..size]); let _ = logger.write(file, &text); }
            }
        }
    });
}

pub fn spawn_dsh(layout: &RuntimeLayout, logger: &AppLogger, port: u16, config: &AppConfig) -> Result<ManagedProcess, RuntimeError> {
    logger.app(&format!("Spawning bundled Node and DSH profile=ibm-lab host=127.0.0.1 port={port}"))?;
    let working_directory = if config.workspace.trim().is_empty() { layout.workspace_dir.clone() } else {
        let path = PathBuf::from(config.workspace.trim());
        if !path.is_dir() { return Err(RuntimeError::new("Configured workspace does not exist or is not a directory")); }
        path
    };
    let mut command = Command::new(layout.node_exe());
    command
        .arg(layout.dsh_bin())
        .args(["--profile", "ibm-lab", "--no-open", "--host", "127.0.0.1", "--port"])
        .arg(port.to_string())
        .current_dir(working_directory)
        .env("DSH_HOME", &layout.dsh_home)
        .env("DSH_HARNESS_NODE_MODULES", layout.dsh_node_modules())
        .env("IBM_LAB_AGENT_WORKSPACE", &layout.workspace_dir)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if !config.api_key.trim().is_empty() { command.env("OPENAI_API_KEY", config.api_key.trim()); }
    if !config.base_url.trim().is_empty() { command.env("OPENAI_BASE_URL", config.base_url.trim()); }
    if !config.model.trim().is_empty() { command.env("OPENAI_MODEL", config.model.trim()); }
    let mut child = command.spawn().map_err(|error| RuntimeError::new(format!("Cannot start bundled DSH: {error}")))?;
    if let Some(stdout) = child.stdout.take() { pipe_to_log(stdout, logger.clone(), "dsh.log"); }
    if let Some(stderr) = child.stderr.take() { pipe_to_log(stderr, logger.clone(), "stderr.log"); }
    Ok(child)
}

fn pid_file(layout: &RuntimeLayout) -> PathBuf { layout.state_dir.join("dsh.pid") }
pub fn write_pid_state(layout: &RuntimeLayout, pid: u32, port: u16) -> Result<(), RuntimeError> {
    fs::write(pid_file(layout), format!("{pid}\n{port}\n")).map_err(|error| RuntimeError::new(format!("Cannot persist runtime state: {error}")))
}
pub fn read_pid_state(layout: &RuntimeLayout) -> Result<Option<u32>, RuntimeError> {
    let path = pid_file(layout); if !path.exists() { return Ok(None); }
    let text = fs::read_to_string(path).map_err(|error| RuntimeError::new(format!("Cannot read runtime state: {error}")))?;
    Ok(text.lines().next().and_then(|line| line.trim().parse::<u32>().ok()).filter(|pid| *pid > 0))
}
pub fn remove_pid_state(layout: &RuntimeLayout) -> Result<(), RuntimeError> {
    let path = pid_file(layout); if path.exists() { fs::remove_file(path).map_err(|error| RuntimeError::new(format!("Cannot remove runtime state: {error}")))?; }; Ok(())
}

pub fn terminate_process_tree(child: &mut ManagedProcess, logger: &AppLogger) -> Result<(), RuntimeError> { terminate_pid_tree(child.id(), logger) }
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
        let Ok(output) = Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", &query]).output() else { return false; };
        return command_line_matches_dsh(&String::from_utf8_lossy(&output.stdout), layout);
    }
    #[cfg(not(windows))]
    { let _ = (pid, layout); false }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_only_the_bundled_ibm_lab_command() {
        let layout = RuntimeLayout::new(PathBuf::from(r"C:\Users\test\AppData\Local\iBM-Lab-Agent"), PathBuf::from(r"H:\iBM Lab Agent"));
        let expected = r#"\"H:\iBM Lab Agent\node\node.exe\" \"H:\iBM Lab Agent\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js\" --profile ibm-lab --no-open --host 127.0.0.1 --port 3080"#;
        assert!(command_line_matches_dsh(expected, &layout));
        assert!(!command_line_matches_dsh(&expected.replace("ibm-lab", "other"), &layout));
        assert!(!command_line_matches_dsh(&expected.replace(r"H:\iBM Lab Agent\node\node.exe", r"C:\node.exe"), &layout));
    }
}
pub fn terminate_pid_tree(pid: u32, logger: &AppLogger) -> Result<(), RuntimeError> {
    #[cfg(windows)]
    {
        let status = Command::new("taskkill.exe").args(["/PID", &pid.to_string(), "/T", "/F"]).status()
            .map_err(|error| RuntimeError::new(format!("Cannot terminate DSH process tree: {error}")))?;
        if !status.success() { logger.app(&format!("taskkill returned {status} for stale/runtime PID {pid}"))?; }
    }
    #[cfg(not(windows))]
    { let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status(); }
    logger.app(&format!("DSH process tree termination requested for pid={pid}"))?;
    Ok(())
}
