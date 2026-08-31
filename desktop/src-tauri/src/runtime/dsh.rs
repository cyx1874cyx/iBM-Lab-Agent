use std::fs;
use std::path::{Path, PathBuf};
use super::{logging::AppLogger, RuntimeError};

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
            config_dir: root.join("config"), logs_dir: root.join("logs"), workspace_dir: root.join("workspace"),
            state_dir: root.join("runtime-state"), dsh_home: root.join("dsh"), root, resources,
        }
    }
    pub fn create_user_directories(&self) -> Result<(), RuntimeError> {
        for directory in [&self.root, &self.config_dir, &self.logs_dir, &self.workspace_dir, &self.state_dir, &self.dsh_home] {
            fs::create_dir_all(directory).map_err(|error| RuntimeError::new(format!("Cannot create user data directory {}: {error}", directory.display())))?;
        }
        Ok(())
    }
    pub fn node_exe(&self) -> PathBuf { self.resources.join("node").join("node.exe") }
    pub fn dsh_bin(&self) -> PathBuf { self.resources.join("dsh").join("node_modules").join("@deepseek-ai").join("dsh").join("lib").join("bin.js") }
    pub fn dsh_node_modules(&self) -> PathBuf { self.resources.join("dsh").join("node_modules") }
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), RuntimeError> {
    if !source.exists() { return Err(RuntimeError::new(format!("Bundled resource missing: {}", source.display()))); }
    fs::create_dir_all(target).map_err(|error| RuntimeError::new(format!("Cannot create {}: {error}", target.display())))?;
    for entry in fs::read_dir(source).map_err(|error| RuntimeError::new(format!("Cannot read {}: {error}", source.display())))? {
        let entry = entry.map_err(|error| RuntimeError::new(format!("Cannot enumerate resource: {error}")))?;
        let from = entry.path(); let to = target.join(entry.file_name());
        if entry.file_type().map_err(|error| RuntimeError::new(format!("Cannot inspect resource: {error}")))?.is_dir() { copy_tree(&from, &to)?; }
        else { fs::copy(&from, &to).map_err(|error| RuntimeError::new(format!("Cannot copy {}: {error}", from.display())))?; }
    }
    Ok(())
}

fn write_if_missing(path: &Path, contents: &str) -> Result<(), RuntimeError> {
    if !path.exists() { fs::write(path, contents).map_err(|error| RuntimeError::new(format!("Cannot write {}: {error}", path.display())))?; }
    Ok(())
}

pub fn bootstrap_user_data(layout: &RuntimeLayout, logger: &AppLogger) -> Result<(), RuntimeError> {
    if !layout.node_exe().exists() || !layout.dsh_bin().exists() {
        return Err(RuntimeError::new("Bundled Node.js or DSH runtime is missing. Reinstall iBM Lab Agent."));
    }
    let profile_dir = layout.dsh_home.join("profiles").join("ibm-lab");
    fs::create_dir_all(&profile_dir).map_err(|error| RuntimeError::new(format!("Cannot create ibm-lab profile: {error}")))?;
    write_if_missing(&profile_dir.join("package.json"), r#"{
  "name": "dsh-profile-ibm-lab",
  "private": true,
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-lab-agent"] } }
}"#)?;
    write_if_missing(&profile_dir.join("cordis.patch.yml"), "[]\n")?;

    let plugin = layout.resources.join("plugin");
    let lab_home = layout.dsh_home.join("lab-agent");
    let marker = lab_home.join(".desktop-bootstrap-v1");
    if !marker.exists() {
        logger.app("Materializing bundled iBM Lab data into AppData")?;
        copy_tree(&plugin.join("dsh-lab-agent"), &profile_dir.join("node_modules").join("dsh-lab-agent"))?;
        copy_tree(&plugin.join("presets").join("lab-research"), &layout.dsh_home.join(".agent-presets").join("lab-research"))?;
        fs::create_dir_all(&lab_home).map_err(|error| RuntimeError::new(format!("Cannot create lab data directory: {error}")))?;
        for filename in ["vendor.lock.json"] {
            fs::copy(plugin.join(filename), lab_home.join(filename)).map_err(|error| RuntimeError::new(format!("Cannot copy {filename}: {error}")))?;
        }
        fs::create_dir_all(lab_home.join("projects")).map_err(|error| RuntimeError::new(format!("Cannot create lab projects directory: {error}")))?;
        fs::write(marker, "1\n").map_err(|error| RuntimeError::new(format!("Cannot write bootstrap marker: {error}")))?;
    }
    Ok(())
}
