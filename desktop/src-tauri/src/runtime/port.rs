use std::net::TcpListener;
use super::RuntimeError;

pub fn find_available_port(first: u16, count: u16) -> Result<u16, RuntimeError> {
    for port in first..first.saturating_add(count) {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() { return Ok(port); }
    }
    Err(RuntimeError::new(format!("No available localhost port in range {first}-{}", first.saturating_add(count).saturating_sub(1))))
}

/// 检测 loopback 端口当前是否可绑定（未被占用）。
pub fn is_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_a_loopback_port() { assert!(find_available_port(3080, 32).is_ok()); }
    #[test]
    fn detects_occupied_port() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral port");
        let port = listener.local_addr().expect("local addr").port();
        assert!(!is_available(port));
        drop(listener);
        assert!(is_available(port));
    }
}
