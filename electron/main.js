// electron/main.js — 데스크탑 위젯 본체.
// 모든 모니터를 덮는 투명·항상 위·클릭 통과 오버레이 창 하나를 띄우고,
// 실제 창들의 위치(winwatch.ps1)를 "눈이 쌓이는 면" 으로 바꿔 렌더러에 보낸다.
// 창이 하나라서 눈덩이와 눈사람이 모니터 사이를 자유롭게 넘나든다.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, globalShortcut, nativeImage } = require('electron');
const path = require('path');

app.setName('소복소복');
// 메모리 절약: JS 힙 상한을 낮추고, 쓰지 않는 크롬 기능을 끈다
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,CalculateNativeWinOcclusion,MediaRouter,Translate');
app.commandLine.appendSwitch('disable-background-networking');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let overlay = null;           // { win, ox, oy, W, H, ready, lastJson }
let tray = null, lastRaw = null, lastCtrl = false;
const nodeFs = require('fs');
// amount: 눈 내리는 양, pile: 쌓이는 속도, profile: 말풍선 말을 맞출 사용자 정보
const state = { visible: true, lookOnly: false, follow: false, amount: 1, pile: 1, profile: 'free', talk: 1, font: 1, light: false };
let trayMenu = null, lastR = false, menuWin = null;

// 메뉴를 커서 위치에 띄운다. 오버레이 창은 포커스를 받지 않으므로, 메뉴 전용의 보이지 않는 작은 창을 잠깐 앞으로 꺼내 쓴다.
function openMenu() {
  if (!trayMenu) return;
  const p = screen.getCursorScreenPoint();
  if (!menuWin || menuWin.isDestroyed()) {
    menuWin = new BrowserWindow({ width: 1, height: 1, frame: false, transparent: true, resizable: false, skipTaskbar: true, show: false, hasShadow: false, focusable: true });
    menuWin.setMenu(null);
  }
  menuWin.setBounds({ x: p.x, y: p.y, width: 1, height: 1 });
  menuWin.setAlwaysOnTop(true, 'screen-saver');
  menuWin.show(); menuWin.focus();
  trayMenu().popup({ window: menuWin, x: 0, y: 0, callback: () => { if (menuWin && !menuWin.isDestroyed()) menuWin.hide(); } });
}
function log(msg) { try { nodeFs.appendFileSync(path.join(app.getPath('userData'), 'snowman.log'), new Date().toISOString() + ' ' + msg + '\n'); } catch (_) {} }
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    const s = JSON.parse(nodeFs.readFileSync(settingsFile(), 'utf8'));
    for (const k of ['amount', 'pile', 'profile', 'talk', 'font', 'light']) if (s[k] !== undefined) state[k] = s[k];
  } catch (_) { /* 처음 실행 */ }
}
function saveSettings() {
  try { nodeFs.writeFileSync(settingsFile(), JSON.stringify({ amount: state.amount, pile: state.pile, profile: state.profile, talk: state.talk, font: state.font, light: state.light })); } catch (_) {}
}
function pushSettings() { send('snowRate', state.amount); send('pileRate', state.amount <= 0.5 ? 0.6 : state.amount >= 2.2 ? 2.4 : state.amount);   // 많이 내릴수록 빨리 쌓인다
  send('profile', state.profile); send('follow', false); send('talk', state.talk); send('font', state.font); send('light', state.light); }
function radio(key, items) {
  return items.map(([label, value]) => ({ label, type: 'radio', checked: state[key] === value, click: () => { state[key] = value; saveSettings(); pushSettings(); } }));
}

// ---------- 오버레이 창 ----------
function unionBounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of screen.getAllDisplays()) {
    const b = d.bounds;
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function createOverlay() {
  if (overlay) { try { overlay.win.destroy(); } catch (_) {} overlay = null; }
  const u = unionBounds();
  const W = u.width, H = u.height - 1;       // 화면과 완전히 같은 크기면 전체 화면 창으로 취급되어 투명이 깨질 수 있다
  const win = new BrowserWindow({
    x: u.x, y: u.y, width: W, height: H,
    frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, focusable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false, spellcheck: false, devTools: false, webgl: false },
  });
  win.setBounds({ x: u.x, y: u.y, width: W, height: H });   // 한 모니터보다 큰 창은 생성 후 다시 지정해야 적용된다
  win.setAlwaysOnTop(true, 'screen-saver');                  // 작업 표시줄보다 위
  win.setIgnoreMouseEvents(true, { forward: true });         // 기본은 클릭 통과, 움직임만 전달받는다
  win.setMenu(null);
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  const o = (overlay = { win, ox: u.x, oy: u.y, W, H, ready: false, lastJson: '' });
  win.webContents.on('did-finish-load', () => { if (state.visible) win.showInactive(); });
  win.on('closed', () => { if (overlay === o) overlay = null; });
}

// ---------- 창 사각형 → 눈이 쌓이는 면 ----------
function pushSurfaces(raw) {
  const o = overlay;
  if (!raw || !o) return;

  // 오른쪽 버튼이 눌린 순간을 렌더러에 알린다 (클릭 통과 중인 눈 위 우클릭으로 메뉴를 열기 위해)
  if (!!raw.c !== lastCtrl) { lastCtrl = !!raw.c; if (o.ready) o.win.webContents.send('command', 'ctrl', lastCtrl); }

  // 실제로 적용된 창 크기를 기준으로 삼는다 (요청한 크기와 다를 수 있다)
  const wb = o.win.getBounds();
  o.ox = wb.x; o.oy = wb.y; o.W = wb.width; o.H = wb.height;

  // 물리 픽셀 → DIP. z-order 는 위에서 아래 순서 그대로.
  const wins = raw.w.map(([h, L, T, R, B]) => {
    const r = screen.screenToDipRect(null, { x: L, y: T, width: R - L, height: B - T });
    return { h, x: r.x, y: r.y, w: r.width, hgt: r.height };
  });
  const fg = raw.fg && raw.fg[2] > raw.fg[0]
    ? screen.screenToDipRect(null, { x: raw.fg[0], y: raw.fg[1], width: raw.fg[2] - raw.fg[0], height: raw.fg[3] - raw.fg[1] }) : null;

  const list = [], covers = [], fs = [], grounds = [];
  const displays = screen.getAllDisplays().map(d => {
    const b = d.bounds, wa = d.workArea;
    // 작업 표시줄이 아래에 있으면 그 윗변이 바닥, 없으면 화면 맨 아래
    const groundY = wa.y + wa.height < b.y + b.height ? wa.y + wa.height : b.y + b.height - 1;
    const hasTaskbar = wa.height < b.height || wa.width < b.width;
    // 전체 화면 앱(영상·게임)이 덮고 있는 모니터에는 아무것도 그리지 않는다
    if (fg && hasTaskbar && fg.x <= b.x && fg.y <= b.y && fg.x + fg.width >= b.x + b.width && fg.y + fg.height >= b.y + b.height)
      fs.push([b.x - o.ox, b.y - o.oy, b.x + b.width - o.ox, b.y + b.height - o.oy]);
    grounds.push({ id: 'ground:' + d.id, kind: 'ground', x0: b.x - o.ox, x1: b.x + b.width - o.ox, y: Math.round(groundY - o.oy) });
    return { b, groundY };
  });
  const displayOf = w => {
    const cx = w.x + w.w / 2, cy = w.y + Math.min(w.hgt / 2, 200);
    return displays.find(d => cx >= d.b.x && cx < d.b.x + d.b.width && cy >= d.b.y && cy < d.b.y + d.b.height)
      || displays.find(d => cx >= d.b.x && cx < d.b.x + d.b.width);
  };

  for (let i = 0; i < wins.length; i++) {
    const w = wins[i], d = displayOf(w);
    if (!d) continue;
    // 바닥 눈이 이 창을 덮는 자리에서는 클릭을 창에 양보하도록 렌더러에 알려 준다
    if (w.y + w.hgt > d.groundY - 140) covers.push([Math.round(w.x - o.ox), Math.round(w.y - o.oy), Math.round(w.x - o.ox + w.w), Math.round(w.y - o.oy + w.hgt)]);
    if (w.y - d.b.y < 30 || w.y > d.groundY - 24 || w.w < 130) continue;    // 화면 밖이거나 최대화된 창
    // 더 위에 있는 창이 가리는 구간을 빼고, 가장 넓게 보이는 구간에만 눈을 쌓는다
    // 눈은 창 양옆으로 7px 까지 살짝 넘쳐 그려진다. 그 넘치는 부분까지 포함해서 가림을 계산해야
    // 앞에 있는 창 위로 눈이 조금도 삐져나오지 않는다.
    let segs = [[w.x - 7, w.x + w.w + 7]];
    for (let j = 0; j < i && segs.length; j++) {
      const u = wins[j];
      // 눈이 그려질 수 있는 띠(윗변 위 26px ~ 아래 10px)와 겹치는 더 위의 창은 그 가로 구간을 가린다
      if (u.y >= w.y + 10 || u.y + u.hgt <= w.y - 26) continue;
      const a = u.x, c = u.x + u.w, next = [];      // 앞 창의 가장자리에 딱 맞춰 자른다 (틈도, 삐져나옴도 없게)
      for (const [s, e] of segs) {
        if (c <= s || a >= e) { next.push([s, e]); continue; }
        if (a > s) next.push([s, a]);
        if (c < e) next.push([c, e]);
      }
      segs = next;
    }
    // 보이는 구간을 모두 살린다 (가운데가 가려지면 양옆에 따로 쌓인다). 너무 좁은 조각은 버린다.
    const vs = segs.filter(g => g[1] - g[0] >= 14).map(g => [Math.round(g[0] - o.ox), Math.round(g[1] - o.ox)]);
    let seen = 0; for (const g of vs) seen += g[1] - g[0];
    if (seen < 44) continue;
    list.push({ id: 'w' + w.h, kind: 'window', x0: Math.round(w.x - o.ox), x1: Math.round(w.x - o.ox + w.w), y: Math.round(w.y - o.oy), vs });
  }
  for (const g of grounds) list.push(g);
  // alive: 지금 존재하는 모든 창. 목록에서 빠졌어도 여기에 있으면 "가려졌을 뿐" 이다
  const data = { W: o.W, H: o.H, list, covers, fs, alive: wins.map(w => 'w' + w.h) };
  const json = JSON.stringify(data);
  if (json !== o.lastJson && o.ready) { o.lastJson = json; o.win.webContents.send('surfaces', data); }
}

// 창 위치와 Ctrl 키 상태를 주기적으로 읽는다. 운영체제별 구현은 platform-*.js 에 있다.
let platform = null, pollTimer = null, lastRawStr = '';
function startWatcher() {
  try { platform = require(process.platform === 'win32' ? './platform-win32' : './platform-other'); }
  catch (e) { log('platform load failed: ' + e.message); platform = require('./platform-other'); }
  const tick = () => {
    let raw;
    try { raw = platform.snapshot(process.pid); } catch (_) { return; }
    const str = JSON.stringify(raw);
    if (str === lastRawStr) return;          // 바뀐 게 없으면 아무 일도 하지 않는다
    lastRawStr = str; lastRaw = raw;
    pushSurfaces(raw);
  };
  pollTimer = setInterval(tick, 70);
  tick();
}

// ---------- 표시 / 트레이 ----------
function applyVisibility() {
  if (!overlay) return;
  if (state.visible && !overlay.win.isVisible()) {
    overlay.win.showInactive();
    // 숨겼다 다시 보일 때 클릭 통과·맨 위 상태가 풀려 있을 수 있으므로 처음 상태로 다시 맞춘다
    overlay.win.setIgnoreMouseEvents(true, { forward: true });
    overlay.win.setAlwaysOnTop(true, 'screen-saver');
    send('resync');
  } else if (!state.visible && overlay.win.isVisible()) overlay.win.hide();
}
function send(name, arg) { if (overlay && overlay.ready) overlay.win.webContents.send('command', name, arg); }

function trayIcon() {
  // 작은 눈사람 아이콘을 직접 그린다 (외부 이미지 파일 없음)
  const S = 32, buf = Buffer.alloc(S * S * 4);
  const disc = (cx, cy, r, R, G, B) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const a = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
      if (a <= 0) continue;
      const i = (y * S + x) * 4, ia = buf[i + 3] / 255, oa = a + ia * (1 - a);
      buf[i] = (B * a + buf[i] * ia * (1 - a)) / oa; buf[i + 1] = (G * a + buf[i + 1] * ia * (1 - a)) / oa;
      buf[i + 2] = (R * a + buf[i + 2] * ia * (1 - a)) / oa; buf[i + 3] = oa * 255;
    }
  };
  disc(16, 22.5, 9.5, 120, 150, 205); disc(16, 22.5, 8.3, 250, 252, 255);
  disc(16, 10, 7, 120, 150, 205); disc(16, 10, 5.8, 250, 252, 255);
  disc(13.6, 9, 1.1, 35, 40, 56); disc(18.4, 9, 1.1, 35, 40, 56); disc(16.6, 11.4, 1.3, 240, 134, 47);
  return nativeImage.createFromBitmap(buf, { width: S, height: S });
}

// ---------- 설정 팝업 ----------
let settingsWin = null;
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  const p = screen.getCursorScreenPoint(), d = screen.getDisplayNearestPoint(p), wa = d.workArea;
  const w = 400, h = 520;
  settingsWin = new BrowserWindow({
    width: w, height: h, useContentSize: true,
    x: Math.round(Math.min(Math.max(p.x - w / 2, wa.x + 10), wa.x + wa.width - w - 10)),
    y: Math.round(Math.min(Math.max(p.y - h - 40, wa.y + 10), wa.y + wa.height - h - 50)),
    title: '소복소복 설정', resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    autoHideMenuBar: true, skipTaskbar: false, icon: trayIcon(),
    webPreferences: { preload: path.join(__dirname, 'preload-settings.js'), contextIsolation: true, spellcheck: false, devTools: false, webgl: false },
  });
  settingsWin.setMenu(null);
  settingsWin.setAlwaysOnTop(true, 'screen-saver');     // 눈 오버레이보다 앞에 보이도록
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => {
    settingsWin = null;
    // 설정 창이 닫힌 뒤 오버레이의 클릭 통과 상태가 어긋나지 않도록 처음 상태로 맞춘다
    if (overlay) { overlay.win.setIgnoreMouseEvents(true, { forward: true }); overlay.win.setAlwaysOnTop(true, 'screen-saver'); send('resync'); }
  });
  const sb = settingsWin.getBounds(); log('settings: ' + [sb.x, sb.y, sb.width, sb.height].join(','));
}
function applySetting(key, value) {
  if (!(key in state) || key === 'follow' || key === 'lookOnly' || key === 'visible') return;
  state[key] = value;
  saveSettings();
  if (key === 'visible') applyVisibility();
  else if (key === 'lookOnly') send('lookOnly', state.lookOnly);
  else pushSettings();
}
ipcMain.handle('settings-get', () => Object.assign({}, state));
ipcMain.on('settings-set', (_e, key, value) => applySetting(key, value));
ipcMain.on('settings-action', (_e, name) => {
  if (name === 'plow') send('plow');
  else if (name === 'reset') send('reset');
  else if (name === 'quit') app.quit();
});
ipcMain.on('open-settings', () => openSettings());
ipcMain.on('log', (_e, msg) => log('renderer: ' + String(msg).slice(0, 300)));

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('소복소복');
  // 우클릭 메뉴는 설정으로 들어가는 문 하나만 둔다. 실제 설정은 별도 팝업에서 바꾼다.
  trayMenu = () => Menu.buildFromTemplate([
    { label: '설정 열기', click: openSettings },
  ]);
  tray.on('click', openSettings);
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: '설정 열기', click: openSettings },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ])));
}

// ---------- 앱 ----------
ipcMain.on('ignore-mouse', (e, ignore) => {
  if (overlay && overlay.win.webContents === e.sender) overlay.win.setIgnoreMouseEvents(ignore, { forward: true });
});
ipcMain.on('open-menu', () => openMenu());
ipcMain.on('ready', e => {
  const o = overlay;
  if (!o || o.win.webContents !== e.sender) return;
  o.ready = true; o.lastJson = '';
  pushSurfaces(lastRaw);
  pushSettings();
  if (state.lookOnly) send('lookOnly', true);
  if (lastCtrl) send('ctrl', true);
  send('follow', state.follow);
});

// 위젯이 이미 떠 있는데 다시 실행하면 설정 창을 연다
app.on('second-instance', () => openSettings());
app.on('before-quit', () => { app.isQuitting = true; if (pollTimer) clearInterval(pollTimer); });
app.on('window-all-closed', e => e.preventDefault());        // 모니터 재구성 중에도 살아 있는다

app.whenReady().then(() => {
  if (!gotLock) return;            // 이미 떠 있으면 아무것도 만들지 않고 끝낸다
  loadSettings();
  createOverlay();
  buildTray();
  startWatcher();
  // 트레이 아이콘이 숨겨져 있어도 단축키로 메뉴를 커서 위치에 띄울 수 있다
  const okM = globalShortcut.register('Control+Alt+M', openMenu);
  log('start: tray=' + !!tray + ' iconEmpty=' + trayIcon().isEmpty() + ' hotkeyM=' + okM);

  // 커서 위치를 직접 읽어 렌더러에 알려 준다 (클릭 통과 중에는 마우스 이벤트 전달이 끊길 수 있다)
  let lastCur = '';
  setInterval(() => {
    const o = overlay;
    if (!o || !o.ready || !state.visible) return;
    const p = screen.getCursorScreenPoint(), key = p.x + ',' + p.y;
    if (key === lastCur) return;
    lastCur = key;
    o.win.webContents.send('command', 'cursor', [p.x - o.ox, p.y - o.oy]);
  }, 16);
  // 작업 표시줄을 누르면 표시줄이 위로 올라오므로, 주기적으로 맨 위 자리를 되찾는다
  setInterval(() => {
    if (overlay && state.visible) overlay.win.setAlwaysOnTop(true, 'screen-saver');
    if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) settingsWin.moveTop();
  }, 2000);
  let t = null;
  const relayout = () => { clearTimeout(t); t = setTimeout(createOverlay, 400); };
  screen.on('display-added', relayout);
  screen.on('display-removed', relayout);
  screen.on('display-metrics-changed', relayout);
});
