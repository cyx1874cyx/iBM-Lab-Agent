use super::{logging::AppLogger, process::ManagedProcess, RuntimeError};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::Mutex;
use std::time::Duration;

fn probe(port: u16) -> bool {
    let address: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .expect("valid localhost address");
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_secs(2)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    if stream
        .write_all(
            format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .is_err()
    {
        return false;
    }
    let mut response = [0; 32];
    let Ok(size) = stream.read(&mut response) else {
        return false;
    };
    let head = String::from_utf8_lossy(&response[..size]);
    head.starts_with("HTTP/1.1 2") || head.starts_with("HTTP/1.1 3")
}

pub fn wait_until_ready(
    port: u16,
    process: &Mutex<Option<ManagedProcess>>,
    logger: &AppLogger,
) -> Result<String, RuntimeError> {
    for attempt in 1..=90 {
        let status = {
            let mut guard = process
                .lock()
                .map_err(|_| RuntimeError::new("Runtime process lock poisoned"))?;
            let child = guard
                .as_mut()
                .ok_or_else(|| RuntimeError::new("DSH startup was cancelled"))?;
            child.try_wait().map_err(|error| {
                RuntimeError::new(format!("Cannot inspect DSH process: {error}"))
            })?
        };
        if let Some(status) = status {
            return Err(RuntimeError::new(format!(
                "DSH exited before becoming ready ({status}); inspect dsh.log and stderr.log"
            )));
        }
        if probe(port) {
            return Ok(format!("http://127.0.0.1:{port}"));
        }
        if attempt % 10 == 0 {
            logger.app(&format!("Waiting for DSH HTTP health check ({attempt}/90)"))?;
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    Err(RuntimeError::new(
        "DSH did not become ready within 90 seconds; inspect dsh.log and stderr.log",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_an_unserved_port() {
        assert!(!probe(6553));
    }
}
