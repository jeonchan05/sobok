// 소복소복 — 가벼운 바깥 틀 (Tauri + WebView2).
// 하는 일: 모든 모니터를 덮는 투명·항상 위·클릭 통과 창을 띄우고, 창 사각형·Ctrl 키·커서 위치를 읽어
// 화면(웹) 쪽에 알려 준다. 눈을 그리는 코드는 Electron 버전과 완전히 같은 파일을 쓴다.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

static READY: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
// 두 창(눈, 설정)이 같은 값을 써야 한다. 서로 다르면 WebView2 가 두 번째 창을 만들지 못한다.
// 참고: --in-process-gpu 는 메모리를 줄이려다 오히려 CPU 를 5배 쓰게 되어(소프트웨어 렌더링) 넣지 않는다
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --js-flags=--max-old-space-size=128 --disable-background-networking";

// serde(default): 예전 settings.json 에 없는 항목은 기본값으로 채운다 (없다고 설정 전체가 초기화되지 않게)
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
struct Settings {
    amount: f64,     // 눈 내리는 양
    profile: String, // worker | student | free
    talk: f64,       // 말풍선 간격 배율
    font: f64,       // 말풍선 글자 크기 배율
    light: bool,     // 가볍게 모드: 조용할 때 덜 자주 그려 GPU 를 아낀다
    lang: String,    // ko | en | "" (비어 있으면 컴퓨터 언어를 따른다: 한국어가 아니면 영어)
}
impl Default for Settings {
    fn default() -> Self {
        Settings { amount: 1.0, profile: "free".into(), talk: 1.0, font: 1.0, light: false, lang: String::new() }
    }
}
struct AppState {
    settings: Mutex<Settings>,
    menu: Mutex<Option<(MenuItem<tauri::Wry>, MenuItem<tauri::Wry>)>>, // 트레이 메뉴의 [설정 열기, 종료]: 언어를 바꾸면 글자를 바꾼다
}

fn config_file(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join(name))
}
fn load_settings(app: &AppHandle) -> Settings {
    config_file(app, "settings.json")
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
fn save_settings(app: &AppHandle, s: &Settings) {
    if let (Some(p), Ok(txt)) = (config_file(app, "settings.json"), serde_json::to_string(s)) {
        let _ = std::fs::write(p, txt);
    }
}

/// 눈을 그리는 창들. Windows 는 모든 모니터를 덮는 창 하나, macOS 는 모니터마다 하나씩이다.
fn overlays(app: &AppHandle) -> Vec<tauri::WebviewWindow> {
    app.webview_windows().into_iter().filter(|(k, _)| k.starts_with("overlay")).map(|(_, w)| w).collect()
}
fn emit_cmd(app: &AppHandle, name: &str, arg: serde_json::Value) {
    for w in overlays(app) {
        let _ = app.emit_to(w.label(), "command", json!({ "name": name, "arg": arg.clone() }));
    }
}
fn push_settings(app: &AppHandle, s: &Settings) {
    // 많이 내릴수록 빨리 쌓인다
    let pile = if s.amount <= 0.5 { 0.6 } else if s.amount >= 2.2 { 2.4 } else { s.amount };
    emit_cmd(app, "snowRate", json!(s.amount));
    emit_cmd(app, "pileRate", json!(pile));
    emit_cmd(app, "profile", json!(s.profile));
    emit_cmd(app, "follow", json!(false));
    emit_cmd(app, "talk", json!(s.talk));
    emit_cmd(app, "font", json!(s.font));
    emit_cmd(app, "light", json!(s.light));
    emit_cmd(app, "lang", json!(s.lang));
}

#[tauri::command]
fn settings_get(state: tauri::State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}
#[tauri::command]
fn settings_set(app: AppHandle, state: tauri::State<AppState>, key: String, value: serde_json::Value) {
    let snapshot = {
        let mut s = state.settings.lock().unwrap();
        match key.as_str() {
            "amount" => if let Some(v) = value.as_f64() { s.amount = v },
            "talk" => if let Some(v) = value.as_f64() { s.talk = v },
            "font" => if let Some(v) = value.as_f64() { s.font = v },
            "profile" => if let Some(v) = value.as_str() { s.profile = v.to_string() },
            "light" => if let Some(v) = value.as_bool() { s.light = v },
            "lang" => if let Some(v) = value.as_str() { s.lang = v.to_string() },
            _ => {}
        }
        s.clone()
    };
    save_settings(&app, &snapshot);
    push_settings(&app, &snapshot);
}
/// 화면 쪽이 정한 언어(ko | en)에 맞춰 트레이 메뉴, 풍선 도움말, 설정 창 제목을 바꾼다
#[tauri::command]
fn ui_lang(app: AppHandle, state: tauri::State<AppState>, lang: String) {
    let en = lang == "en";
    if let Some((open, quit)) = state.menu.lock().unwrap().as_ref() {
        let _ = open.set_text(if en { "Open Settings" } else { "설정 열기" });
        let _ = quit.set_text(if en { "Quit" } else { "종료" });
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(if en { "Sobok" } else { "소복소복" }));
    }
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.set_title(if en { "Sobok Settings" } else { "소복소복 설정" });
    }
}
#[tauri::command]
fn settings_action(app: AppHandle, name: String) {
    match name.as_str() {
        "plow" => emit_cmd(&app, "plow", json!(null)),
        "quit" => app.exit(0),
        _ => {}
    }
}
#[tauri::command]
fn set_ignore(window: tauri::WebviewWindow, ignore: bool) {
    if window.label().starts_with("overlay") {
        let _ = window.set_ignore_cursor_events(ignore);
    }
}
#[tauri::command]
fn overlay_ready(app: AppHandle, state: tauri::State<AppState>) {
    READY.store(true, Ordering::SeqCst);
    let s = state.settings.lock().unwrap().clone();
    push_settings(&app, &s);
}
#[tauri::command]
fn open_settings(app: AppHandle) {
    show_settings(&app);
}
#[tauri::command]
fn log_line(app: AppHandle, msg: String) {
    if let Some(p) = config_file(&app, "sobok.log") {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "{}", msg);
        }
    }
}

fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        // 맥: 설정 창이 다른 화면(스페이스)에 떠 있으면 그 창은 닫고, 지금 보고 있는 화면에 새로 연다
        #[cfg(target_os = "macos")]
        if !mac_on_active_space(&w) {
            let _ = w.destroy();
            let app2 = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(250));
                build_settings(&app2);
            });
            return;
        }
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    // 창 만들기는 반드시 다른 스레드에서 한다. Windows 에서는 명령 처리 중(메인 스레드)에 새 창을 만들면
    // 서로 기다리다 멈춰서, 화면 전체를 덮은 눈 창까지 같이 얼어 버린다.
    let app = app.clone();
    std::thread::spawn(move || build_settings(&app));
}
fn build_settings(app: &AppHandle) {
    if app.get_webview_window("settings").is_some() {
        return;
    }
    let builder = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()));
    #[cfg(windows)]
    let builder = builder.additional_browser_args(BROWSER_ARGS);
    let built = builder
        .title("소복소복 설정")
        .inner_size(400.0, 590.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .visible(false)
        .build();
    if let Err(e) = &built {
        log_line(app.clone(), format!("settings window failed: {e}"));
    }
    if let Ok(w) = built {
        #[cfg(windows)]
        {
            // 커서 바로 위쪽에, 그 모니터의 작업 영역을 벗어나지 않게 놓는다
            let (cx, cy) = win::cursor();
            let k = w.scale_factor().unwrap_or(1.0);
            let (ww, wh) = ((400.0 * k) as i32, (520.0 * k) as i32);
            let mons = win::monitors();
            let m = mons.iter().find(|m| cx >= m[0] && cx < m[2] && cy >= m[1] && cy < m[3]).or(mons.first());
            if let Some(m) = m {
                let x = (cx - ww / 2).max(m[4] + 10).min(m[6] - ww - 10);
                let y = (cy - wh - 40).max(m[5] + 10).min(m[7] - wh - 50);
                let _ = w.set_position(PhysicalPosition::new(x, y));
            }
        }
        #[cfg(not(windows))]
        let _ = w.center();
        // 맥: 눈 창(레벨 25)보다 위에 놓아 설정 창이 눈에 가려지지 않게 한다. 창 레벨은 메인 스레드에서 바꾼다
        #[cfg(target_os = "macos")]
        {
            let w2 = w.clone();
            let _ = app.run_on_main_thread(move || {
                mac_set_level(&w2, 26);
                mac_set_behavior(&w2, 2 | 256); // 활성 화면으로 따라오고, 전체 화면 앱 위에도 뜬다
            });
        }
        let _ = w.show();
        let _ = w.set_focus();
        // 설정 창이 닫히면 오버레이의 클릭 통과 상태를 처음 상태로 되돌린다
        let app2 = app.clone();
        w.on_window_event(move |ev| {
            if let tauri::WindowEvent::Destroyed = ev {
                for o in overlays(&app2) {
                    let _ = o.set_ignore_cursor_events(true);
                }
                emit_cmd(&app2, "resync", json!(null));
            }
        });
    }
}

// ---------------------------------------------------------------- Windows: 창·모니터·키·커서 읽기
#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use windows::Win32::Foundation::{BOOL, COLORREF, HWND, LPARAM, POINT, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO};
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows::Win32::UI::WindowsAndMessaging::*;

    fn class_name(h: HWND) -> String {
        let mut buf = [0u16; 128];
        let n = unsafe { GetClassNameW(h, &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
    fn pid_of(h: HWND) -> u32 {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
        pid
    }
    fn skip_class(c: &str) -> bool {
        matches!(c, "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
    }
    // 그림자·투명 테두리를 뺀 실제 보이는 사각형
    fn bounds(h: HWND) -> Option<RECT> {
        let mut r = RECT::default();
        let ok = unsafe { DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut _ as *mut c_void, 16) };
        if ok.is_ok() && r.right > r.left {
            return Some(r);
        }
        if unsafe { GetWindowRect(h, &mut r) }.is_ok() { Some(r) } else { None }
    }

    /// 반환: (Ctrl 눌림, 맨 앞 창 사각형, [hwnd, L, T, R, B] 목록(위→아래))
    pub fn snapshot(skip_pid: u32) -> (bool, [i32; 4], Vec<[i64; 5]>) {
        let mut list = Vec::new();
        unsafe {
            let mut cur = GetTopWindow(None).unwrap_or_default();
            let mut guard = 0;
            while !cur.0.is_null() && guard < 4000 {
                guard += 1;
                let h = cur;
                cur = GetWindow(h, GW_HWNDNEXT).unwrap_or_default();
                if !IsWindowVisible(h).as_bool() || IsIconic(h).as_bool() || pid_of(h) == skip_pid {
                    continue;
                }
                let mut cloaked = 0i32;
                if DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut c_void, 4).is_ok() && cloaked != 0 {
                    continue; // 다른 가상 데스크탑 등
                }
                let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
                if ex & 0x80 != 0 || ex & 0x20 != 0 || ex & 0x0800_0000 != 0 {
                    continue; // 도구 창, 클릭 통과 오버레이, 포커스를 받지 않는 보조 창
                }
                if ex & 0x8_0000 != 0 {
                    let (mut key, mut alpha, mut flags) = (COLORREF(0), 0u8, LAYERED_WINDOW_ATTRIBUTES_FLAGS(0));
                    if GetLayeredWindowAttributes(h, Some(&mut key), Some(&mut alpha), Some(&mut flags)).is_ok() && flags.0 & 2 != 0 && alpha < 24 {
                        continue; // 거의 투명한 창
                    }
                }
                if GetWindowTextLengthW(h) == 0 || skip_class(&class_name(h)) {
                    continue;
                }
                if let Some(r) = bounds(h) {
                    if r.right - r.left >= 120 && r.bottom - r.top >= 60 {
                        list.push([h.0 as isize as i64, r.left as i64, r.top as i64, r.right as i64, r.bottom as i64]);
                    }
                }
            }
            let mut fg = [0i32; 4];
            let f = GetForegroundWindow();
            if !f.0.is_null() && pid_of(f) != skip_pid && !skip_class(&class_name(f)) {
                let mut r = RECT::default();
                if GetWindowRect(f, &mut r).is_ok() {
                    fg = [r.left, r.top, r.right, r.bottom];
                }
            }
            let ctrl = (GetAsyncKeyState(0x11) as u16 & 0x8000) != 0;
            (ctrl, fg, list)
        }
    }

    unsafe extern "system" fn mon_proc(hm: HMONITOR, _dc: HDC, _rc: *mut RECT, data: LPARAM) -> BOOL {
        let out = &mut *(data.0 as *mut Vec<[i32; 8]>);
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if GetMonitorInfoW(hm, &mut mi).as_bool() {
            let (m, w) = (mi.rcMonitor, mi.rcWork);
            out.push([m.left, m.top, m.right, m.bottom, w.left, w.top, w.right, w.bottom]);
        }
        BOOL(1)
    }
    /// 모니터마다 [화면 L,T,R,B, 작업 영역 L,T,R,B]
    pub fn monitors() -> Vec<[i32; 8]> {
        let mut v: Vec<[i32; 8]> = Vec::new();
        unsafe {
            let _ = EnumDisplayMonitors(None, None, Some(mon_proc), LPARAM(&mut v as *mut _ as isize));
        }
        v.sort();
        v
    }
    pub fn cursor() -> (i32, i32) {
        let mut p = POINT::default();
        unsafe {
            let _ = GetCursorPos(&mut p);
        }
        (p.x, p.y)
    }
    /// 포커스를 빼앗지 않는 창으로 만들고, 작업 표시줄보다 위로 올린다
    pub fn make_overlay(raw: isize) {
        let h = HWND(raw as *mut c_void);
        unsafe {
            let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
            SetWindowLongW(h, GWL_EXSTYLE, (ex | 0x0800_0000 | 0x80) as i32); // NOACTIVATE | TOOLWINDOW
        }
        topmost(raw);
    }
    pub fn topmost(raw: isize) {
        let h = HWND(raw as *mut c_void);
        unsafe {
            let _ = SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }
}

/// 모든 모니터를 덮는 사각형
#[cfg(windows)]
fn union_of(mons: &[[i32; 8]]) -> (i32, i32, i32, i32) {
    if mons.is_empty() {
        return (0, 0, 1920, 1080);
    }
    let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
    for m in mons {
        x0 = x0.min(m[0]); y0 = y0.min(m[1]); x1 = x1.max(m[2]); y1 = y1.max(m[3]);
    }
    (x0, y0, x1, y1)
}

#[cfg(windows)]
fn start_overlay(app: &AppHandle) -> tauri::Result<()> {
    let (x0, y0, x1, y1) = union_of(&win::monitors());
    let overlay = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("index.html".into()))
        .title("소복소복")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .additional_browser_args(BROWSER_ARGS)
        .build()?;
    // 화면과 완전히 같은 크기면 전체 화면 창으로 취급될 수 있어 1px 줄인다
    overlay.set_position(PhysicalPosition::new(x0, y0))?;
    overlay.set_size(PhysicalSize::new((x1 - x0) as u32, (y1 - y0 - 1) as u32))?;
    overlay.set_ignore_cursor_events(true)?;
    let raw = overlay.hwnd()?.0 as isize;
    win::make_overlay(raw);
    overlay.show()?;
    win::topmost(raw);

    // 커서는 매 16ms, 창 목록은 64ms 마다 읽고, 바뀌었을 때만 화면 쪽에 보낸다
    let app2 = app.clone();
    let pid = std::process::id();
    let stress = std::env::var("SOBOK_STRESS").ok(); // 점검용: 눈덩이·눈사람·제설차를 자동으로 등장시킨다
    std::thread::spawn(move || {
        let (mut tick, mut last_cur, mut last_snap) = (0u64, (i32::MIN, 0), String::new());
        let (mut area, mut ready_at) = ((x0, y0, x1, y1), 0u64);
        loop {
            std::thread::sleep(Duration::from_millis(16));
            tick += 1;
            if !READY.load(Ordering::SeqCst) {
                continue;
            }
            let cur = win::cursor();
            if cur != last_cur {
                last_cur = cur;
                let _ = app2.emit_to("overlay", "cur", [cur.0, cur.1]);
            }
            if ready_at == 0 {
                ready_at = tick;
            }
            if stress.is_some() && tick == ready_at + 300 {
                emit_cmd(&app2, "stress", json!(stress)); // "settings" 이면 화면 쪽에서 설정 창 열기를 시험한다
            }
            if tick % 4 == 0 {
                let (c, fg, w) = win::snapshot(pid);
                let mons = win::monitors();
                // 모니터를 꽂거나 뽑거나 해상도가 바뀌면 창 크기를 다시 맞춘다
                let now = union_of(&mons);
                if now != area {
                    area = now;
                    let _ = overlay.set_position(PhysicalPosition::new(now.0, now.1));
                    let _ = overlay.set_size(PhysicalSize::new((now.2 - now.0) as u32, (now.3 - now.1 - 1) as u32));
                }
                let payload = json!({ "c": c, "fg": fg, "w": w, "mons": mons, "ox": area.0, "oy": area.1 });
                let s = payload.to_string();
                if s != last_snap {
                    last_snap = s;
                    let _ = app2.emit_to("overlay", "snap", payload);
                }
            }
            if tick % 125 == 0 {
                win::topmost(raw); // 작업 표시줄을 누르면 표시줄이 위로 올라오므로 주기적으로 되찾는다
                if let Some(h) = app2.get_webview_window("settings").and_then(|s| s.hwnd().ok()) {
                    win::topmost(h.0 as isize); // 설정 창은 눈보다 앞에
                }
            }
        }
    });
    Ok(())
}

// ---------------------------------------------------------------- macOS: 창·모니터·키·커서 읽기
// 좌표는 모두 "포인트"(화면 왼쪽 위가 원점, 아래로 갈수록 커짐)이고, 웹 화면의 CSS 픽셀과 같은 단위다.
#[cfg(target_os = "macos")]
mod mac {
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::geometry::CGRect;
    use core_graphics::window::{copy_window_info, kCGNullWindowID, kCGWindowListOptionAll, kCGWindowListOptionOnScreenOnly};
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Point {
        x: f64,
        y: f64,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceFlagsState(state: i32) -> u64;
        fn CGEventCreate(source: *const c_void) -> *const c_void;
        fn CGEventGetLocation(event: *const c_void) -> Point;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(p: *const c_void);
    }

    pub fn cursor() -> (i32, i32) {
        unsafe {
            let e = CGEventCreate(std::ptr::null());
            if e.is_null() {
                return (0, 0);
            }
            let p = CGEventGetLocation(e);
            CFRelease(e);
            (p.x.round() as i32, p.y.round() as i32)
        }
    }
    /// Ctrl 또는 Command 가 눌려 있는가 (맥에서는 Ctrl+클릭이 우클릭으로 쓰이므로 Command 도 같은 역할을 한다)
    pub fn modifier() -> bool {
        let f = unsafe { CGEventSourceFlagsState(1) }; // HID 상태
        f & 0x0004_0000 != 0 || f & 0x0010_0000 != 0
    }
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        static kAXTrustedCheckOptionPrompt: *const c_void;
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(opts: *const c_void) -> bool;
        fn AXUIElementCreateApplication(pid: i32) -> *const c_void;
        fn AXUIElementCopyAttributeValue(el: *const c_void, attr: *const c_void, out: *mut *const c_void) -> i32;
        fn AXValueGetValue(v: *const c_void, kind: u32, out: *mut c_void) -> bool;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(a: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(a: *const c_void, i: isize) -> *const c_void;
    }

    pub fn ax_trusted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }
    /// 손쉬운 사용 권한이 없으면 시스템 허용 창을 띄운다 (Dock 의 가로 범위를 읽는 데 필요)
    pub fn ax_prompt() -> bool {
        unsafe {
            let k = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt as _);
            let opts = CFDictionary::from_CFType_pairs(&[(k, core_foundation::boolean::CFBoolean::true_value())]);
            AXIsProcessTrustedWithOptions(opts.as_concrete_TypeRef() as _)
        }
    }
    pub fn dock_pid() -> Option<i32> {
        let raw = copy_window_info(kCGWindowListOptionAll, kCGNullWindowID)?;
        let arr: CFArray<CFDictionary<CFString, CFType>> = unsafe { CFArray::wrap_under_get_rule(raw.as_concrete_TypeRef() as _) };
        for d in arr.iter() {
            let name = d.find(CFString::from_static_string("kCGWindowOwnerName")).and_then(|v| v.downcast::<CFString>()).map(|s| s.to_string());
            if name.as_deref() == Some("Dock") {
                return d.find(CFString::from_static_string("kCGWindowOwnerPID")).and_then(|v| v.downcast::<CFNumber>()).and_then(|n| n.to_i32());
            }
        }
        None
    }
    unsafe fn ax_attr(el: *const c_void, name: &str) -> Option<*const c_void> {
        let k = CFString::new(name);
        let mut out: *const c_void = std::ptr::null();
        if AXUIElementCopyAttributeValue(el, k.as_concrete_TypeRef() as _, &mut out) != 0 || out.is_null() {
            return None;
        }
        Some(out)
    }
    /// Dock 의 아이콘 줄(AXList)이 차지하는 사각형 [L,T,R,B] (포인트). 권한이 없거나 읽지 못하면 None
    pub fn dock_rect(pid: i32) -> Option<[i32; 4]> {
        unsafe {
            let app = AXUIElementCreateApplication(pid);
            if app.is_null() {
                return None;
            }
            let mut res = None;
            if let Some(ch) = ax_attr(app, "AXChildren") {
                for i in 0..CFArrayGetCount(ch) {
                    let el = CFArrayGetValueAtIndex(ch, i);
                    let role = ax_attr(el, "AXRole").map(|r| CFString::wrap_under_create_rule(r as _).to_string());
                    if role.as_deref() != Some("AXList") {
                        continue;
                    }
                    if let (Some(pv), Some(sv)) = (ax_attr(el, "AXPosition"), ax_attr(el, "AXSize")) {
                        let (mut p, mut z) = (Point::default(), Point::default());
                        let ok = AXValueGetValue(pv, 1, &mut p as *mut Point as *mut c_void) && AXValueGetValue(sv, 2, &mut z as *mut Point as *mut c_void);
                        CFRelease(pv);
                        CFRelease(sv);
                        if ok {
                            res = Some([p.x.round() as i32, p.y.round() as i32, (p.x + z.x).round() as i32, (p.y + z.y).round() as i32]);
                        }
                    }
                    break;
                }
                CFRelease(ch);
            }
            CFRelease(app);
            res
        }
    }
    pub static DOCK: std::sync::Mutex<Option<[i32; 4]>> = std::sync::Mutex::new(None);

    /// 한 번의 창 목록 조회로 세 가지를 읽는다 (조회 한 번이 꽤 비싸서 따로 세 번 부르지 않는다):
    ///  - 화면에 보이는 일반 창들 [번호, L, T, R, B, 프로세스] (위→아래)
    ///  - 메뉴 막대 창(레이어 24)의 사각형 [L,T,R,B]. 화면(스페이스)을 넘기는 동안에는 옆으로 밀린다
    ///  - 전체 화면 스페이스가 켜져 있는가: Dock 이 전체 화면 앱 뒤에 까는 "Fullscreen Backdrop" 창(레이어 -2147483622)이 화면에 떠 있다
    pub fn snapshot(skip_pid: i64) -> (Vec<[i64; 6]>, Vec<[i64; 4]>, bool) {
        let mut out = Vec::new();
        let (mut menubar, mut backdrop) = (Vec::new(), false); // 메뉴 막대는 모니터마다 하나씩 있다
        let Some(raw) = copy_window_info(kCGWindowListOptionOnScreenOnly, kCGNullWindowID) else {
            return (out, menubar, backdrop);
        };
        let arr: CFArray<CFDictionary<CFString, CFType>> = unsafe { CFArray::wrap_under_get_rule(raw.as_concrete_TypeRef() as _) };
        for d in arr.iter() {
            let num = |k: &'static str| -> Option<f64> {
                d.find(CFString::from_static_string(k)).and_then(|v| v.downcast::<CFNumber>()).and_then(|n| n.to_f64())
            };
            let rect = || -> Option<CGRect> {
                let b = d.find(CFString::from_static_string("kCGWindowBounds")).and_then(|v| v.downcast::<CFDictionary>())?;
                CGRect::from_dict_representation(&b)
            };
            let layer = num("kCGWindowLayer").unwrap_or(1.0);
            if layer == -2147483622.0 {
                backdrop = true;
                continue;
            }
            if layer == 24.0 {
                if let Some(r) = rect() {
                    menubar.push([r.origin.x.round() as i64, r.origin.y.round() as i64, (r.origin.x + r.size.width).round() as i64, (r.origin.y + r.size.height).round() as i64]);
                }
                continue;
            }
            if layer != 0.0 {
                continue; // Dock, 알림 등은 제외
            }
            let owner = num("kCGWindowOwnerPID").unwrap_or(-1.0) as i64;
            if owner == skip_pid || num("kCGWindowAlpha").unwrap_or(1.0) < 0.1 {
                continue;
            }
            let Some(r) = rect() else {
                continue;
            };
            if r.size.width < 120.0 || r.size.height < 60.0 {
                continue;
            }
            let id = num("kCGWindowNumber").unwrap_or(0.0) as i64;
            out.push([id, r.origin.x.round() as i64, r.origin.y.round() as i64, (r.origin.x + r.size.width).round() as i64, (r.origin.y + r.size.height).round() as i64, owner]);
        }
        (out, menubar, backdrop)
    }
}

/// 모니터마다 [화면 L,T,R,B, 작업 영역 L,T,R,B] (포인트)
#[cfg(target_os = "macos")]
fn mac_monitors(app: &AppHandle) -> Vec<[i32; 8]> {
    let mut v = Vec::new();
    for m in app.available_monitors().unwrap_or_default() {
        let k = m.scale_factor();
        let (p, s, w) = (m.position(), m.size(), m.work_area());
        let f = |n: f64| (n / k).round() as i32;
        v.push([
            f(p.x as f64), f(p.y as f64), f(p.x as f64 + s.width as f64), f(p.y as f64 + s.height as f64),
            f(w.position.x as f64), f(w.position.y as f64), f(w.position.x as f64 + w.size.width as f64), f(w.position.y as f64 + w.size.height as f64),
        ]);
    }
    v.sort();
    v
}

/// 이 창이 지금 보고 있는 화면(스페이스)에 있는가
#[cfg(target_os = "macos")]
fn mac_on_active_space(w: &tauri::WebviewWindow) -> bool {
    use std::ffi::c_void;
    #[link(name = "objc")]
    extern "C" {
        fn sel_registerName(n: *const u8) -> *const c_void;
        fn objc_msgSend();
    }
    match w.ns_window() {
        Ok(p) => unsafe {
            let f: unsafe extern "C" fn(*mut c_void, *const c_void) -> bool = std::mem::transmute(objc_msgSend as *const ());
            f(p, sel_registerName(b"isOnActiveSpace\0".as_ptr()))
        },
        Err(_) => true,
    }
}
/// NSWindow.collectionBehavior 를 지정한다 (2 = MoveToActiveSpace, 256 = FullScreenAuxiliary)
#[cfg(target_os = "macos")]
fn mac_set_behavior(w: &tauri::WebviewWindow, bits: u64) {
    use std::ffi::c_void;
    #[link(name = "objc")]
    extern "C" {
        fn sel_registerName(n: *const u8) -> *const c_void;
        fn objc_msgSend();
    }
    if let Ok(p) = w.ns_window() {
        unsafe {
            let f: unsafe extern "C" fn(*mut c_void, *const c_void, u64) = std::mem::transmute(objc_msgSend as *const ());
            f(p, sel_registerName(b"setCollectionBehavior:\0".as_ptr()), bits);
        }
    }
}

/// 눈 창을 메뉴 막대보다 앞에 놓는다 (NSStatusWindowLevel = 25). 눈사람과 말풍선이 메뉴 막대 위로 나올 수 있다
#[cfg(target_os = "macos")]
fn mac_set_level(w: &tauri::WebviewWindow, level: i64) {
    use std::ffi::c_void;
    #[link(name = "objc")]
    extern "C" {
        fn sel_registerName(n: *const u8) -> *const c_void;
        fn objc_msgSend();
    }
    if let Ok(p) = w.ns_window() {
        unsafe {
            let f: unsafe extern "C" fn(*mut c_void, *const c_void, i64) = std::mem::transmute(objc_msgSend as *const ());
            f(p, sel_registerName(b"setLevel:\0".as_ptr()), level);
        }
    }
}

#[cfg(target_os = "macos")]
fn start_overlay(app: &AppHandle) -> tauri::Result<()> {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory); // Dock 에 아이콘을 만들지 않는다
    let mons = mac_monitors(app);
    // macOS 는 창 하나가 여러 모니터에 걸쳐 보이지 않으므로, 모니터마다 눈 창을 하나씩 띄운다
    for (k, m) in mons.iter().enumerate() {
        let w = WebviewWindowBuilder::new(app, format!("overlay-{k}"), WebviewUrl::App("index.html".into()))
            .title("소복소복")
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .accept_first_mouse(true) // 비활성 상태에서도 첫 클릭이 바로 전달되게
            .visible(false)
            .position(m[0] as f64, m[1] as f64)
            .inner_size((m[2] - m[0]) as f64, (m[3] - m[1]) as f64)
            .build()?;
        w.set_ignore_cursor_events(true)?;
        mac_set_level(&w, 25);
        w.show()?;
        log_line(app.clone(), format!("mac overlay-{k}: pos={:?} size={:?}", w.outer_position().ok(), w.outer_size().ok()));
    }
    // Dock 의 가로 범위: 손쉬운 사용 권한이 있어야 읽을 수 있다. 처음 한 번 허용을 요청하고, 0.5초마다 읽는다
    mac::ax_prompt();
    let app_ax = app.clone();
    std::thread::spawn(move || {
        let mut pid: Option<i32> = None;
        let mut last = String::new();
        loop {
            std::thread::sleep(Duration::from_millis(500));
            let trusted = mac::ax_trusted();
            let mut r = None;
            if trusted {
                if pid.is_none() {
                    pid = mac::dock_pid();
                }
                r = pid.and_then(mac::dock_rect);
            }
            *mac::DOCK.lock().unwrap() = r;
            let st = format!("dock ax: trusted={} pid={:?} rect={:?}", trusted, pid, r);
            if st != last {
                log_line(app_ax.clone(), st.clone());
                last = st;
            }
        }
    });
    let app2 = app.clone();
    let pid = std::process::id() as i64;
    let stress = std::env::var("SOBOK_STRESS").ok();
    std::thread::spawn(move || {
        let (mut tick, mut last_cur, mut last_snap) = (0u64, (i32::MIN, 0), String::new());
        let mut ready_at = 0u64;
        let (mut log_after, mut logged) = (0u64, 0u32);
        loop {
            std::thread::sleep(Duration::from_millis(16));
            tick += 1;
            if !READY.load(Ordering::SeqCst) {
                continue;
            }
            if ready_at == 0 {
                ready_at = tick;
            }
            if stress.is_some() && tick == ready_at + 300 {
                emit_cmd(&app2, "stress", json!(stress));
            }
            if stress.is_some() && (tick - ready_at) % 600 == 60 {
                // 점검용 기록: 읽어 온 창·모니터·커서
                log_line(app2.clone(), format!("mac snapshot: mons={:?} cursor={:?} mod={} windows={:?}", mac_monitors(&app2), mac::cursor(), mac::modifier(), mac::snapshot(pid).0));
            }
            let cur = mac::cursor();
            if cur != last_cur {
                last_cur = cur;
                for w in overlays(&app2) {
                    let _ = app2.emit_to(w.label(), "cur", [cur.0, cur.1]);
                }
            }
            if tick % 4 == 0 {
                let (c, (wins, mb, fsb)) = (mac::modifier(), mac::snapshot(pid));
                let now = mac_monitors(&app2);
                let dock = *mac::DOCK.lock().unwrap();
                let key = json!({ "c": c, "w": wins, "m": now, "d": dock, "mb": mb, "fsb": fsb }).to_string();
                if key != last_snap {
                    // 점검용: 창 배치가 바뀔 때마다 기록한다 (2초에 한 번, 실행마다 300줄까지)
                    if tick >= log_after && logged < 300 {
                        log_after = tick + 120;
                        logged += 1;
                        log_line(app2.clone(), format!("mac layout: mons={:?} dock={:?} mb={:?} fsb={} windows={:?}", now, dock, mb, fsb, wins));
                    }
                    last_snap = key;
                    for (k, m) in now.iter().enumerate() {
                        // "pt": 좌표가 이미 CSS 픽셀과 같은 단위라는 표시
                        let payload = json!({ "c": c, "fg": [0, 0, 0, 0], "w": wins, "mons": [m], "all": now, "dock": dock, "mbs": mb, "fsb": fsb, "ox": m[0], "oy": m[1], "pt": true });
                        let _ = app2.emit_to(format!("overlay-{k}"), "snap", payload);
                    }
                }
            }
        }
    });
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn start_overlay(_app: &AppHandle) -> tauri::Result<()> {
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_settings(app); // 이미 떠 있는데 다시 실행하면 설정 창을 연다
        }))
        .manage(AppState { settings: Mutex::new(Settings::default()), menu: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            settings_get, settings_set, settings_action, ui_lang, set_ignore, overlay_ready, open_settings, log_line
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            *app.state::<AppState>().settings.lock().unwrap() = load_settings(&handle);

            let open = MenuItem::with_id(app, "open", "설정 열기", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            *app.state::<AppState>().menu.lock().unwrap() = Some((open.clone(), quit.clone()));
            let mut tray = TrayIconBuilder::with_id("main").tooltip("소복소복").menu(&menu).show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, ev| match ev.id().as_ref() {
                "open" => show_settings(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, ev| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                    show_settings(tray.app_handle());
                }
            })
            .build(app)?;

            start_overlay(&handle)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start")
        .run(|_app, event| {
            // 설정 창을 닫아도 앱은 계속 돈다 (종료는 설정 창의 '종료' 버튼이나 트레이 메뉴)
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
