use super::RuntimeError;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub struct AppLogger {
    pub dir: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl AppLogger {
    pub fn new(dir: PathBuf) -> Result<Self, RuntimeError> {
        fs::create_dir_all(&dir)
            .map_err(|error| RuntimeError::new(format!("Cannot create logs directory: {error}")))?;
        Ok(Self {
            dir,
            lock: Arc::new(Mutex::new(())),
        })
    }
    pub fn app(&self, message: &str) -> Result<(), RuntimeError> {
        self.write("app.log", message)
    }
    pub fn write(&self, file: &str, message: &str) -> Result<(), RuntimeError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| RuntimeError::new("Log lock poisoned"))?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let mut handle = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.dir.join(file))
            .map_err(|error| RuntimeError::new(format!("Cannot write log: {error}")))?;
        writeln!(handle, "[{timestamp}] {message}")
            .map_err(|error| RuntimeError::new(format!("Cannot append log: {error}")))
    }
}
