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
    let desired_state = format!(
        "desktop={}\nmanifest={}\nvendor={}\nrequirements={}\n",
        env!("CARGO_PKG_VERSION"),
        package_manifest,
        vendor_lock,
        requirements
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
}
