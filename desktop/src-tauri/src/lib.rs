use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::Manager;

struct PrintSidecar(Mutex<Option<Child>>);

fn resolve_node_bin() -> PathBuf {
  if let Ok(p) = std::env::var("NODE_BINARY") {
    let path = PathBuf::from(p);
    if path.exists() {
      return path;
    }
  }

  let home = std::env::var("HOME")
    .or_else(|_| std::env::var("USERPROFILE"))
    .unwrap_or_default();

  // nvm (Unix) / nvm-windows
  let nvm_candidates = [
    format!("{home}/.nvm/versions/node"),
    format!("{home}/AppData/Roaming/nvm"),
  ];
  for nvm_glob in nvm_candidates {
    if let Ok(entries) = std::fs::read_dir(&nvm_glob) {
      let mut versions: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_dir())
        .map(|dir| {
          if cfg!(windows) {
            dir.join("node.exe")
          } else {
            dir.join("bin/node")
          }
        })
        .filter(|p| p.exists())
        .collect();
      versions.sort();
      if let Some(last) = versions.pop() {
        return last;
      }
    }
  }

  if cfg!(windows) {
    for c in [
      r"C:\Program Files\nodejs\node.exe",
      r"C:\Program Files (x86)\nodejs\node.exe",
    ] {
      let p = PathBuf::from(c);
      if p.exists() {
        return p;
      }
    }
    return PathBuf::from("node.exe");
  }

  for c in ["/usr/local/bin/node", "/usr/bin/node", "/usr/bin/nodejs"] {
    let p = PathBuf::from(c);
    if p.exists() {
      return p;
    }
  }

  PathBuf::from("node")
}

fn resolve_printing_dir() -> Option<PathBuf> {
  if let Ok(root) = std::env::var("POSR_REPO_ROOT") {
    let p = PathBuf::from(root).join("printing");
    if p.join("server.js").exists() {
      return Some(p);
    }
  }

  // Dev: desktop/src-tauri -> repo/printing
  let manifest_printing = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../printing");
  if let Ok(canonical) = manifest_printing.canonicalize() {
    if canonical.join("server.js").exists() {
      return Some(canonical);
    }
  }

  // Next to the executable (release layouts)
  if let Ok(exe) = std::env::current_exe() {
    if let Some(exe_dir) = exe.parent() {
      for rel in ["printing", "../printing", "../../printing"] {
        let p = exe_dir.join(rel);
        if p.join("server.js").exists() {
          return p.canonicalize().ok().or(Some(p));
        }
      }
    }
  }

  None
}

/// Dev Vite origins + Tauri webview origins. Print CORS fails closed when
/// GATEWAY_ALLOWED_ORIGINS is unset (same posture as Docker compose).
const DEFAULT_PRINT_ALLOWED_ORIGINS: &str = concat!(
  "http://localhost:5173,",
  "http://127.0.0.1:5173,",
  "tauri://localhost,",
  "https://tauri.localhost"
);

fn load_dotenv_value(repo_root: &std::path::Path, key: &str) -> Option<String> {
  for name in [".env.local", ".env"] {
    let path = repo_root.join(name);
    let Ok(contents) = std::fs::read_to_string(&path) else {
      continue;
    };
    for line in contents.lines() {
      let line = line.trim();
      if line.is_empty() || line.starts_with('#') {
        continue;
      }
      let Some((k, v)) = line.split_once('=') else {
        continue;
      };
      if k.trim() != key {
        continue;
      }
      let mut val = v.trim().to_string();
      if (val.starts_with('"') && val.ends_with('"')) || (val.starts_with('\'') && val.ends_with('\''))
      {
        val = val[1..val.len() - 1].to_string();
      }
      if !val.is_empty() {
        return Some(val);
      }
    }
  }
  None
}

fn env_flag_false(name: &str) -> bool {
  matches!(
    std::env::var(name).ok().as_deref().map(str::trim).map(str::to_ascii_lowercase),
    Some(v) if v == "0" || v == "false" || v == "no" || v == "off"
  )
}

/// True when something already answers on the print health endpoint (e.g. Docker printer).
fn print_server_already_up() -> bool {
  use std::io::{Read, Write};
  use std::net::TcpStream;
  use std::time::Duration;

  let addr = match "127.0.0.1:3132".parse() {
    Ok(a) => a,
    Err(_) => return false,
  };
  let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
    return false;
  };
  let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
  let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
  if stream
    .write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
    .is_err()
  {
    return false;
  }
  let mut buf = Vec::new();
  let _ = stream.read_to_end(&mut buf);
  let body = String::from_utf8_lossy(&buf);
  body.contains("posr-print-server") || body.contains("\"ok\":true")
}

fn spawn_print_server() -> Option<Child> {
  // Prefer the existing Docker printer (root + /dev/bus/usb) when present —
  // same USB access model operators already use. Host Node as a normal user
  // often hits LIBUSB_ERROR_ACCESS because /dev/bus/usb/* is root:lp.
  if env_flag_false("POSR_PRINT_SIDECAR") {
    eprintln!("[posr-desktop] POSR_PRINT_SIDECAR disabled — not starting host print sidecar");
    return None;
  }
  if print_server_already_up() {
    eprintln!(
      "[posr-desktop] print server already healthy on :3132 — skip host sidecar (use Docker printer / existing process)"
    );
    return None;
  }

  let printing_dir = match resolve_printing_dir() {
    Some(p) => p,
    None => {
      eprintln!("[posr-desktop] printing/ not found — skip print sidecar (set POSR_REPO_ROOT)");
      return None;
    }
  };

  let repo_root = printing_dir.parent().map(|p| p.to_path_buf());
  let allowed_origins = std::env::var("GATEWAY_ALLOWED_ORIGINS")
    .ok()
    .filter(|s| !s.trim().is_empty())
    .or_else(|| {
      repo_root
        .as_ref()
        .and_then(|root| load_dotenv_value(root, "GATEWAY_ALLOWED_ORIGINS"))
    })
    .unwrap_or_else(|| DEFAULT_PRINT_ALLOWED_ORIGINS.to_string());

  let jwt_secret = std::env::var("GATEWAY_JWT_SECRET")
    .ok()
    .filter(|s| !s.trim().is_empty())
    .or_else(|| {
      repo_root
        .as_ref()
        .and_then(|root| load_dotenv_value(root, "GATEWAY_JWT_SECRET"))
    });

  let node = resolve_node_bin();
  let server_js = printing_dir.join("server.js");
  eprintln!(
    "[posr-desktop] starting print server: {} {} (cwd={})",
    node.display(),
    server_js.display(),
    printing_dir.display()
  );

  let mut cmd = Command::new(&node);
  cmd
    .arg(&server_js)
    .current_dir(&printing_dir)
    .env("PRINT_PORT", "3132")
    .env("PRINT_HOST", "127.0.0.1")
    .env("GATEWAY_ALLOWED_ORIGINS", &allowed_origins)
    .stdin(Stdio::null())
    .stdout(Stdio::inherit())
    .stderr(Stdio::inherit());

  if let Some(secret) = jwt_secret {
    cmd.env("GATEWAY_JWT_SECRET", secret);
  }

  match cmd.spawn() {
    Ok(child) => {
      eprintln!("[posr-desktop] print sidecar pid={}", child.id());
      Some(child)
    }
    Err(err) => {
      eprintln!(
        "[posr-desktop] failed to start print sidecar with {}: {err}",
        node.display()
      );
      None
    }
  }
}

fn stop_print_server(state: &PrintSidecar) {
  if let Ok(mut guard) = state.0.lock() {
    if let Some(mut child) = guard.take() {
      let pid = child.id();
      match child.kill() {
        Ok(()) => {
          let _ = child.wait();
          eprintln!("[posr-desktop] stopped print sidecar pid={pid}");
        }
        Err(err) => eprintln!("[posr-desktop] failed to stop print sidecar pid={pid}: {err}"),
      }
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(PrintSidecar(Mutex::new(None)))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let child = spawn_print_server();
      if let Some(state) = app.try_state::<PrintSidecar>() {
        if let Ok(mut guard) = state.0.lock() {
          *guard = child;
        }
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if let tauri::RunEvent::Exit = event {
        if let Some(state) = app_handle.try_state::<PrintSidecar>() {
          stop_print_server(state.inner());
        }
      }
    });
}
