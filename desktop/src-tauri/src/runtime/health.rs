use super::{logging::AppLogger, process::ManagedProcess, RuntimeError};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::Mutex;
use std::time::Duration;

fn probe(startup_url: &str, expected_port: u16) -> bool {
    let Ok(parsed) = url::Url::parse(startup_url) else {
        return false;
    };
    if parsed.scheme() != "http"
        || parsed.host_str() != Some("127.0.0.1")
        || parsed.port() != Some(expected_port)
    {
        return false;
    }
    let address: SocketAddr = format!("127.0.0.1:{expected_port}")
        .parse()
        .expect("valid localhost address");
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_secs(2)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    if stream
        .write_all(
            format!(
                "GET / HTTP/1.1\r\nHost: 127.0.0.1:{expected_port}\r\nConnection: close\r\n\r\n"
            )
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
    head.starts_with("HTTP/1.1 2")
        || head.starts_with("HTTP/1.1 3")
        || head.starts_with("HTTP/1.1 401")
}

pub fn wait_until_ready(
    port: u16,
    process: &Mutex<Option<ManagedProcess>>,
    logger: &AppLogger,
) -> Result<String, RuntimeError> {
    for attempt in 1..=90 {
        let (status, startup_url) = {
            let mut guard = process
                .lock()
                .map_err(|_| RuntimeError::new("Runtime process lock poisoned"))?;
            let child = guard
                .as_mut()
                .ok_or_else(|| RuntimeError::new("DSH startup was cancelled"))?;
            let status = child.try_wait().map_err(|error| {
                RuntimeError::new(format!("Cannot inspect DSH process: {error}"))
            })?;
            (status, child.startup_url())
        };
        if let Some(status) = status {
            return Err(RuntimeError::new(format!(
                "DSH exited before becoming ready ({status}); inspect dsh.log and stderr.log"
            )));
        }
        if let Some(startup_url) = startup_url {
            if probe(&startup_url, port) {
                return Ok(startup_url);
            }
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
    use std::net::TcpListener;
    use std::thread;
    #[test]
    fn refuses_an_unserved_port() {
        assert!(!probe("http://127.0.0.1:6553/?token=test", 6553));
    }

    #[test]
    fn refuses_a_non_local_or_unexpected_port() {
        assert!(!probe("http://example.com:6553/?token=test", 6553));
        assert!(!probe("http://127.0.0.1:6554/?token=test", 6553));
    }

    #[test]
    fn accepts_auth_challenge_without_sending_the_launch_token() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 512];
            let size = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..size]);
            assert!(request.starts_with("GET / HTTP/1.1\r\n"));
            assert!(!request.contains("one-time-secret"));
            stream
                .write_all(
                    b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
        });
        assert!(probe(
            &format!("http://127.0.0.1:{port}/?token=one-time-secret"),
            port
        ));
        server.join().unwrap();
    }
}
