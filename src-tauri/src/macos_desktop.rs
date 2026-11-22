use crate::{emit_cmd, overlays, settings_set, AppState};
use core_foundation::{
    base::{CFType, TCFType},
    boolean::CFBoolean,
    dictionary::{CFDictionary, CFDictionaryRef},
    string::CFString,
};
use objc2::MainThreadMarker;
use objc2_app_kit::{NSScreen, NSWorkspace};
use objc2_foundation::{NSDictionary, NSString, NSURL};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use tauri::{menu::MenuItem, AppHandle, Manager};

const THEME_URL: &str = "https://github.com/jeonchan05/sobok/releases/download/v1.1.0-macos-smooth.1/sobok-seoul-winter.png";
const THEME_SHA256: [u8; 32] = [
    0xbb, 0xf0, 0x6d, 0xee, 0x4f, 0x50, 0x7c, 0xc5, 0x2a, 0x6b, 0xf7, 0x28, 0x24, 0xb2, 0x6c, 0x00,
    0x53, 0x6c, 0x57, 0xe7, 0xc9, 0x8b, 0x49, 0x71, 0xcb, 0xee, 0x29, 0x44, 0x7d, 0xf7, 0xf1, 0xc4,
];

#[derive(Default)]
struct PauseState {
    manual: bool,
    locked: bool,
}

pub enum PauseChange {
    Toggle,
    ScreenLocked(bool),
}

impl PauseState {
    fn is_paused(&self) -> bool {
        self.manual || self.locked
    }

    fn update(&mut self, change: PauseChange) -> bool {
        let was_paused = self.is_paused();
        match change {
            PauseChange::Toggle => self.manual = !self.manual,
            PauseChange::ScreenLocked(locked) => self.locked = locked,
        }
        was_paused != self.is_paused()
    }
}

pub struct Controls {
    pause: Mutex<PauseState>,
    pause_item: MenuItem<tauri::Wry>,
    theme_cache: Mutex<()>,
}

impl Controls {
    pub fn new(pause_item: MenuItem<tauri::Wry>) -> Self {
        Self {
            pause: Mutex::new(PauseState { locked: screen_locked().unwrap_or(false), ..PauseState::default() }),
            pause_item,
            theme_cache: Mutex::new(()),
        }
    }
}

pub fn paused(app: &AppHandle) -> bool {
    app.state::<Controls>().pause.lock().unwrap().is_paused()
}

pub fn update_pause(app: &AppHandle, change: PauseChange) {
    let controls = app.state::<Controls>();
    let (changed, paused, manual) = {
        let mut state = controls.pause.lock().unwrap();
        let changed = state.update(change);
        (changed, state.is_paused(), state.manual)
    };
    let _ = controls.pause_item.set_text(if manual { "눈 다시 시작" } else { "눈 일시정지" });
    if !changed {
        return;
    }
    if paused {
        emit_cmd(app, "paused", json!(true));
    }
    for overlay in overlays(app) {
        if paused {
            let _ = overlay.set_ignore_cursor_events(true);
            let _ = overlay.hide();
        } else {
            let _ = overlay.show();
        }
    }
    if !paused {
        emit_cmd(app, "paused", json!(false));
    }
    if std::env::var_os("SOBOK_STRESS").is_some() {
        crate::log_line(app.clone(), format!("mac pause: paused={paused} manual={manual}"));
    }
}

pub fn screen_locked() -> Option<bool> {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGSessionCopyCurrentDictionary() -> CFDictionaryRef;
    }
    let raw = unsafe { CGSessionCopyCurrentDictionary() };
    if raw.is_null() {
        return None;
    }
    let session = unsafe { CFDictionary::<CFString, CFType>::wrap_under_create_rule(raw) };
    // shortcut: macOS does not document this lock key, replace it if a public state API becomes available.
    Some(session
        .find(CFString::from_static_string("CGSSessionScreenIsLocked"))
        .and_then(|value| value.downcast::<CFBoolean>())
        .is_some_and(bool::from))
}

pub async fn apply_seoul_theme(app: AppHandle) -> Result<(), String> {
    let downloader = app.clone();
    let wallpaper = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf, String> {
        let controls = downloader.state::<Controls>();
        let _cache = controls.theme_cache.lock().unwrap();
        let folder = downloader.path().app_config_dir().map_err(|e| e.to_string())?.join("themes");
        prepare_wallpaper(&folder)
    })
    .await
    .map_err(|e| e.to_string())??;

    let (result, mut receiver) = tauri::async_runtime::channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let applied = set_wallpaper(&wallpaper);
        if applied.is_ok() {
            settings_set(handle.clone(), handle.state::<AppState>(), "amount".into(), json!(0.5));
        }
        let _ = result.try_send(applied);
    })
    .map_err(|e| e.to_string())?;
    receiver.recv().await.ok_or_else(|| "배경화면 적용이 중단됐어요.".to_string())?
}

fn prepare_wallpaper(folder: &Path) -> Result<PathBuf, String> {
    let path = folder.join("sobok-seoul-winter.png");
    if fs::read(&path).is_ok_and(|bytes| verified_theme(&bytes)) {
        return Ok(path);
    }
    let download = Command::new("/usr/bin/curl")
        .args(["--disable", "--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https", "--max-time", "30", "--max-filesize", "8000000", THEME_URL])
        .output()
        .map_err(|e| format!("배경화면 다운로드를 시작할 수 없어요. {e}"))?;
    if !download.status.success() {
        return Err("서울 배경화면을 내려받지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.".into());
    }
    if !verified_theme(&download.stdout) {
        return Err("배경화면 파일이 배포본과 일치하지 않아요.".into());
    }
    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let staging = path.with_extension("download");
    fs::write(&staging, download.stdout).map_err(|e| e.to_string())?;
    fs::rename(staging, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn verified_theme(bytes: &[u8]) -> bool {
    Sha256::digest(bytes).as_slice() == THEME_SHA256
}

fn set_wallpaper(path: &Path) -> Result<(), String> {
    let main = MainThreadMarker::new().ok_or("배경화면을 변경할 수 없어요.")?;
    let screen = NSScreen::screens(main).firstObject().ok_or("디스플레이를 찾을 수 없어요.")?;
    let file = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let options = NSDictionary::new();
    // An empty options dictionary asks AppKit to choose its default scaling.
    unsafe { NSWorkspace::sharedWorkspace().setDesktopImageURL_forScreen_options_error(&file, &screen, &options) }
        .map_err(|e| e.localizedDescription().to_string())
}

#[cfg(test)]
mod tests {
    use super::{verified_theme, PauseChange::*, PauseState};

    #[test]
    fn unlock_resumes_only_automatically_paused_snow() {
        let mut state = PauseState::default();
        assert!(state.update(ScreenLocked(true)));
        assert!(!state.update(ScreenLocked(true)));
        assert!(state.update(ScreenLocked(false)));
        assert!(!state.is_paused());
        assert!(state.update(Toggle));
        assert!(!state.update(ScreenLocked(true)));
        assert!(!state.update(ScreenLocked(false)));
        assert!(state.is_paused());
        assert!(state.update(Toggle));
        assert!(!state.is_paused());
    }

    #[test]
    fn rejects_unexpected_theme_content() {
        assert!(!verified_theme(b"unexpected image"));
    }
}
