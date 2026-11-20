// platform-win32.js — Windows: 화면에 보이는 창들의 사각형과 Ctrl 키 상태를 Win32 API 로 직접 읽는다.
// (예전에는 PowerShell 프로세스를 따로 띄웠지만, 메모리를 아끼려고 메인 프로세스 안에서 호출한다)
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');

const H = 'intptr_t';      // HWND 를 정수로 다룬다
const GetTopWindow = user32.func('GetTopWindow', H, [H]);
const GetWindow = user32.func('GetWindow', H, [H, 'uint32']);
const IsWindowVisible = user32.func('IsWindowVisible', 'int', [H]);
const IsIconic = user32.func('IsIconic', 'int', [H]);
const GetWindowTextLengthW = user32.func('GetWindowTextLengthW', 'int', [H]);
const GetClassNameW = user32.func('GetClassNameW', 'int', [H, 'void *', 'int']);
const GetWindowLongW = user32.func('GetWindowLongW', 'int32', [H, 'int']);
const GetWindowThreadProcessId = user32.func('GetWindowThreadProcessId', 'uint32', [H, 'void *']);
const GetForegroundWindow = user32.func('GetForegroundWindow', H, []);
const GetWindowRect = user32.func('GetWindowRect', 'int', [H, 'void *']);
const GetAsyncKeyState = user32.func('GetAsyncKeyState', 'int16', ['int']);
const GetLayeredWindowAttributes = user32.func('GetLayeredWindowAttributes', 'int', [H, 'void *', 'void *', 'void *']);
const DwmGetWindowAttribute = dwmapi.func('DwmGetWindowAttribute', 'int32', [H, 'uint32', 'void *', 'uint32']);

const rc = Buffer.alloc(16), i4 = Buffer.alloc(4), cls = Buffer.alloc(256), b4a = Buffer.alloc(4), b1 = Buffer.alloc(1), b4b = Buffer.alloc(4);
const SKIP_CLASS = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

function className(h) {
  const n = GetClassNameW(h, cls, 128);
  return n > 0 ? cls.toString('utf16le', 0, n * 2) : '';
}
function pidOf(h) { i4.writeUInt32LE(0, 0); GetWindowThreadProcessId(h, i4); return i4.readUInt32LE(0); }
// 그림자·투명 테두리를 뺀 실제 보이는 사각형
function bounds(h) {
  if (DwmGetWindowAttribute(h, 9, rc, 16) === 0 && rc.readInt32LE(8) > rc.readInt32LE(0)) return true;   // DWMWA_EXTENDED_FRAME_BOUNDS
  return GetWindowRect(h, rc) !== 0;
}

// 반환: { c: Ctrl 눌림(0/1), fg: 맨 앞 창 사각형, w: [[hwnd, L, T, R, B], ...] (위→아래 순서) }  좌표는 물리 픽셀
function snapshot(skipPid) {
  const w = [];
  let guard = 0;
  for (let h = GetTopWindow(0); h && guard < 4000; h = GetWindow(h, 2), guard++) {      // GW_HWNDNEXT
    if (!IsWindowVisible(h) || IsIconic(h)) continue;
    if (pidOf(h) === skipPid) continue;
    i4.writeInt32LE(0, 0);
    if (DwmGetWindowAttribute(h, 14, i4, 4) === 0 && i4.readInt32LE(0) !== 0) continue;   // DWMWA_CLOAKED: 다른 가상 데스크탑 등
    const ex = GetWindowLongW(h, -20);
    if (ex & 0x80) continue;                                 // 도구 창
    if ((ex & 0x20) || (ex & 0x08000000)) continue;          // 클릭 통과 오버레이, 포커스를 받지 않는 보조 창
    if (ex & 0x80000) {                                      // 거의 투명한 창
      if (GetLayeredWindowAttributes(h, b4a, b1, b4b) && (b4b.readUInt32LE(0) & 2) && b1[0] < 24) continue;
    }
    if (GetWindowTextLengthW(h) === 0) continue;
    if (SKIP_CLASS.has(className(h))) continue;
    if (!bounds(h)) continue;
    const L = rc.readInt32LE(0), T = rc.readInt32LE(4), R = rc.readInt32LE(8), B = rc.readInt32LE(12);
    if (R - L < 120 || B - T < 60) continue;
    w.push([Number(h), L, T, R, B]);
  }
  let fg = [0, 0, 0, 0];
  const f = GetForegroundWindow();
  if (f && pidOf(f) !== skipPid && !SKIP_CLASS.has(className(f)) && GetWindowRect(f, rc)) {
    fg = [rc.readInt32LE(0), rc.readInt32LE(4), rc.readInt32LE(8), rc.readInt32LE(12)];
  }
  return { c: (GetAsyncKeyState(0x11) & 0x8000) ? 1 : 0, fg, w };
}

module.exports = { snapshot, windowSnow: true };

if (require.main === module) {       // 단독 실행 테스트: node electron/platform-win32.js
  const t0 = process.hrtime.bigint();
  let s; for (let i = 0; i < 50; i++) s = snapshot(0);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 50;
  console.log(JSON.stringify(s).slice(0, 260));
  console.log('windows:', s.w.length, 'ms per snapshot:', ms.toFixed(2));
}
