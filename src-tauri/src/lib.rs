use std::net::TcpStream;
use std::process::Command;
use std::thread;
use std::time::Duration;
use tauri::Manager;

const APP_PORT: &str = "3000";

// Real app (owner, 2026-07-30): this wraps the existing Next.js app, which
// has real server-rendered routes (Supabase auth, API routes) — it cannot
// be a static export, so `frontendDist` only holds a placeholder (Tauri's
// bundler requires SOME folder to exist). Instead, on launch this spawns
// `npm start` (the real production Next.js server, already built via
// `npm run build`) as a child process, waits for it to actually accept
// connections, then points the real window at it. In dev mode
// (`tauri dev`), the developer already runs `next dev` themselves in a
// separate terminal — devUrl in tauri.conf.json handles that case, this
// spawn logic only runs for the built .app (release mode).
fn port_is_open(port: &str) -> bool {
  TcpStream::connect(format!("127.0.0.1:{port}")).is_ok()
}

// Screen Vision, read-only (owner, 2026-07-30): "อ่านสิ่งที่อยู่บนจอเฮียเอง
// ตอนที่เฮียสั่งเอง" — captures a screenshot ONLY when explicitly invoked
// from the chat (never a background/continuous watcher), using macOS's own
// built-in `screencapture` CLI — no Accessibility permission needed (that
// permission is for synthetic input/clicking, deliberately NOT built — see
// the same conversation's explanation of why autonomous clicking stays
// declined). `-x` suppresses the camera-shutter sound. Returns the file
// path only; the actual image bytes are read by the Next.js server
// (app/api/admin/screen-vision/route.ts) directly off disk — both run on
// the same Mac, so no base64 encoding or extra Tauri fs-plugin permission
// is needed in Rust at all.
#[tauri::command]
fn capture_screen() -> Result<String, String> {
  let path = "/tmp/dna_os_screen_capture.png";
  let status = Command::new("/usr/sbin/screencapture")
    .arg("-x")
    .arg(path)
    .status()
    .map_err(|e| format!("เรียก screencapture ไม่สำเร็จ: {e}"))?;
  if !status.success() {
    return Err(format!("screencapture จบด้วยสถานะผิดพลาด: {status}"));
  }
  Ok(path.to_string())
}

// Native App Launch (owner, 2026-07-30): "สั่งเปิดแอปพลิเคชัน...บอกว่า
// open_app(app_name)" — real, scoped capability: launches an installed macOS
// app by name via the system's own `open -a` (the same mechanism Spotlight/
// Finder use, not a synthetic click). Deliberately NOT the broader ask ("AI
// has full rights to control the Mac") — that framing was not adopted in the
// system prompt (see cognitive/pipeline.ts's OWNER_APP_CONTROL_RULE comment)
// because it would make the model promise capabilities that don't actually
// exist (clicking inside an app, reading its contents, controlling other
// software) and risk it claiming success on things nothing here does. This
// function does exactly one real thing: ask macOS to launch a named app.
// `open -a <name>` takes app_name as a single argv element (Command::new
// with .arg(), never a shell), so there is no shell-injection surface even
// though app_name comes from parsed voice/text input — worst case is macOS
// replying "Unable to find application named X", not an arbitrary command
// running.
#[tauri::command]
fn open_app(app_name: String) -> Result<String, String> {
  let name = app_name.trim();
  if name.is_empty() {
    return Err("ไม่ได้ระบุชื่อแอปที่จะเปิด".to_string());
  }
  let status = Command::new("/usr/bin/open")
    .arg("-a")
    .arg(name)
    .status()
    .map_err(|e| format!("เรียกคำสั่งเปิดแอปไม่สำเร็จ: {e}"))?;
  if !status.success() {
    return Err(format!("ไม่พบแอปพลิเคชันชื่อ \"{name}\" บนเครื่องนี้"));
  }
  Ok(format!("เปิด {name} ให้แล้วครับ"))
}

// Native Text-to-Speech (owner, 2026-07-31): real bug found live — the
// browser's own Web Speech API (window.speechSynthesis, used by
// components/admin/ttsSpeak.ts) produced completely silent, error-free
// no-ops inside this Tauri app's WKWebView (the wake-word event correctly
// brought the window to the front, proving the Realtime signal path
// worked, but no audio ever played) — the same general class of "silently
// blocked, no prompt, no error" restriction already hit once this session
// with node's missing microphone entitlement. Rather than debug WKWebView's
// speech-synthesis internals blind, this calls macOS's own `say` command
// directly — a real, long-standing system binary with zero webview
// involvement, guaranteed to either work or print a real error. Confirmed
// live that macOS ships a real Thai voice for it: `say -v '?'` lists
// "Kanya th_TH". `-v` and the text are separate argv elements (Command::new
// with .arg(), never a shell), so this is safe against injection the same
// way open_app's `-a <name>` already is.
#[tauri::command]
fn speak_native(text: String) -> Result<(), String> {
  Command::new("/usr/bin/say")
    .arg("-v")
    .arg("Kanya")
    .arg(&text)
    .spawn()
    .map_err(|e| format!("เรียกคำสั่งพูดไม่สำเร็จ: {e}"))?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![capture_screen, open_app, speak_native])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      } else {
        // Release build: spawn the real Next.js production server ourselves
        // if nothing is already listening on the port (a developer running
        // `npm run dev` separately during testing shouldn't get a second
        // server fighting over the same port).
        if !port_is_open(APP_PORT) {
          // NOT app.path().resource_dir() — the built .app bundle only
          // contains a placeholder frontend (see comment above); the real
          // Next.js project (node_modules, .next build, package.json) lives
          // on disk at a fixed path. This is a single-owner desktop app
          // wrapping one specific local project, not something distributed
          // to other machines, so a hardcoded absolute path is correct here
          // (found live, 2026-07-30: the old resource_dir().parent() logic
          // pointed inside Contents/ where no package.json exists, so `npm
          // start` failed silently every launch and the window navigated to
          // a server that was never actually running).
          let project_dir = "/Users/tam/Desktop/DNA OS-โฟลเดอร์หลักต้นฉบับ /dna-os-deadboard";
          let log_path = "/tmp/dna-os-next-start.log";
          // Absolute path, not "npm" — an app launched by double-clicking in
          // Finder (not from a terminal) gets a minimal PATH from launchd
          // that does NOT include /usr/local/bin, so plain Command::new
          // ("npm") fails to find the binary at all and returns Err
          // silently (found live, 2026-07-30: the log file stayed completely
          // empty, meaning spawn() never even started a process).
          let npm_path = "/usr/local/bin/npm";
          let spawn_result = if let Ok(log_file) = std::fs::File::create(log_path) {
            let err_file = log_file.try_clone().ok();
            Command::new(npm_path)
              .arg("start")
              .current_dir(project_dir)
              .stdout(log_file)
              .stderr(err_file.unwrap_or_else(|| std::fs::File::create(log_path).unwrap()))
              .spawn()
          } else {
            Command::new(npm_path)
              .arg("start")
              .current_dir(project_dir)
              .spawn()
          };
          if let Err(e) = spawn_result {
            let _ = std::fs::write(log_path, format!("failed to spawn npm start: {e}"));
          }
        }

        // Poll until the real server actually accepts connections (up to
        // ~20s) before navigating — showing the placeholder for a moment
        // is honest; showing a connection-refused error page is not.
        let handle = app.handle().clone();
        thread::spawn(move || {
          for _ in 0..40 {
            if port_is_open(APP_PORT) {
              if let Some(window) = handle.get_webview_window("main") {
                let _ = window.navigate(
                  format!("http://localhost:{APP_PORT}/admin/relationships")
                    .parse()
                    .unwrap(),
                );
              }
              break;
            }
            thread::sleep(Duration::from_millis(500));
          }
        });
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
