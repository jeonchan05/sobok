// native-shim.js — Tauri(가벼운 버전)로 실행될 때 window.snowNative / window.snowSettings 를 만들어 준다.
// Electron 에서는 preload 가 같은 것을 이미 제공하므로 아무 일도 하지 않는다.
// 덕분에 눈·눈덩이·눈사람을 그리는 나머지 코드는 두 버전에서 한 글자도 다르지 않다.
(function () {
  'use strict';
  const T = window.__TAURI__;
  if (!T || window.snowNative || window.snowSettings) return;
  const invoke = T.core.invoke, listen = T.event.listen;

  window.snowSettings = {
    get: () => invoke('settings_get'),
    set: (key, value) => invoke('settings_set', { key, value }),
    action: name => invoke('settings_action', { name }),
    uiLang: lang => invoke('ui_lang', { lang }),
  };
  if (location.pathname.indexOf('settings') >= 0) return;      // 설정 창은 여기까지만 필요하다

  const seen = {};
  let ghostTimer = 0, prevGeom = new Map();
  const dying = new Map();                         // 사라지는 중인 창 번호 → 마지막으로 크기가 바뀐 시각
  let dyTimer = 0;
  let ctxKey = 'normal', pendKey = 'normal', pendAt = 0, ctxTimer = 0, lastRaw = null, prevPos = new Map(), moveUntil = 0, faded = false;
  let surfCb = null, cmdCb = null, lastJson = '', lastCtrl = null, ox = 0, oy = 0, haveOrigin = false, unit = 0;
  const cmd = (name, arg) => { if (cmdCb) cmdCb(name, arg); };

  // 창 사각형(물리 픽셀) → 눈이 쌓이는 면 목록(오버레이 기준 CSS 픽셀). Electron 쪽 pushSurfaces 와 같은 계산이다.
  function compute(raw) {
    const s = unit = raw.pt ? 1 : (window.devicePixelRatio || 1);      // macOS 는 좌표가 이미 CSS 픽셀 단위로 온다
    ox = raw.ox; oy = raw.oy; haveOrigin = true;
    const X = v => (v - ox) / s, Y = v => (v - oy) / s;
    if (!!raw.c !== lastCtrl) { lastCtrl = !!raw.c; cmd('ctrl', lastCtrl); }

    let wins = raw.w.map(a => ({ h: a[0], x: X(a[1]), y: Y(a[2]), w: (a[3] - a[1]) / s, hgt: (a[4] - a[2]) / s, pid: a[5] }));
    const fg = raw.fg && raw.fg[2] > raw.fg[0] ? { x: X(raw.fg[0]), y: Y(raw.fg[1]), r: X(raw.fg[2]), b: Y(raw.fg[3]) } : null;
    const list = [], covers = [], fs = [], grounds = [];
    // macOS: 전체 화면 앱은 별도의 화면(스페이스)이다.
    //  - 화면이 넘어가는 동안(3손가락 넘김)에는 창들이 옆으로 밀려 나가므로, 눈 면 목록을 갱신하지 않고 얼려 둔다. 눈사람이 창을 따라 끌려가지 않는다.
    //  - 넘김이 끝나고 전체 화면 창이 안정적으로 떠 있으면 그 창 번호로 화면을 구분해 눈사람·눈덩이·눈을 통째로 바꿔 끼운다.
    lastRaw = raw;
    let moving = false;
    if (raw.pt && raw.mons.length) {
      const m0 = raw.mons[0], bx = X(m0[0]), br = X(m0[2]), now = performance.now();
      // 화면이 넘어가는 중인가: 메뉴 막대 창이 옆으로 밀려 있거나, 창 둘 이상이 똑같이 옆으로 밀렸거나, 화면 옆으로 완전히 나간 창이 있다
      // 모니터가 여럿이면 다른 모니터의 메뉴 막대와 창이 함께 온다. 그것들을 '넘기는 중'으로 잘못 보면 눈이 계속 숨겨지므로 가려낸다:
      //  - 메뉴 막대는 이 모니터의 것(윗변과 폭이 같은 것 중 가장 가까운 것)만 본다
      //  - 다른 모니터 안에 있는 창, 화면 밖에 가만히 멈춰 있는 창은 세지 않는다
      const mw = m0[2] - m0[0], mbs = raw.mbs || (raw.mb ? [raw.mb] : []);
      let mbd = null;
      for (const q of mbs) if (Math.abs(q[1] - m0[1]) <= 1 && Math.abs(q[2] - q[0] - mw) <= 2) { const d = Math.abs(q[0] - m0[0]); if (mbd === null || d < mbd) mbd = d; }
      const others = (raw.all || []).filter(m => m[0] !== m0[0] || m[1] !== m0[1]);
      const onOther = w => { const cx = w.x + w.w / 2 + ox, cy = w.y + Math.min(w.hgt / 2, 200) + oy; return others.some(m => cx >= m[0] && cx < m[2] && cy >= m[1] && cy < m[3]); };
      let same = 0, dxs = null, sliding = mbd !== null && mbd > 1 && mbd < mw;
      const cur = new Map();
      for (const w of wins) {
        cur.set(w.h, [w.x, w.y]);
        const pv = prevPos.get(w.h);
        if (pv && Math.abs(w.y - pv[1]) < 1.5 && Math.abs(w.x - pv[0]) >= 6) { const dx = Math.round((w.x - pv[0]) / 2); if (dxs === null || Math.abs(dx - dxs) <= 1) { dxs = dx; same++; } }
        if ((w.x >= br - 1 || w.x + w.w <= bx + 1) && !onOther(w) && (!pv || Math.abs(w.x - pv[0]) >= 1)) sliding = true;
      }
      prevPos = cur;
      if (same >= 2) sliding = true;
      if (sliding) moveUntil = now + 300;            // 멈춘 뒤에도 잠깐 더 얼려 둔다 (끝자락의 느린 움직임)
      moving = now < moveUntil;
      if (moving) {
        if (!faded) { faded = true; cmd('fade', 0); }
        clearTimeout(ctxTimer); ctxTimer = setTimeout(() => lastRaw && compute(lastRaw), moveUntil - now + 20);
      } else {
        // 전체 화면 스페이스: Dock 의 전체 화면 배경 창이 떠 있을 때. 화면은 가장 큰 창의 번호로 구분한다
        let big = null;
        for (const w of wins) if (!big || w.w * w.hgt > big.w * big.hgt) big = w;
        const cand = raw.fsb ? 'fs:' + (big ? big.h : 0) : 'normal';
        if (cand !== pendKey) { pendKey = cand; pendAt = now; }
        if (pendKey !== ctxKey) {
          if (now - pendAt >= 150) { ctxKey = pendKey; lastJson = ''; cmd('space', ctxKey); clearTimeout(ghostTimer); ghostTimer = setTimeout(() => { lastJson = ''; lastRaw && compute(lastRaw); }, 2700); const sn = seen[ctxKey]; if (sn) for (const v of sn.values()) v.t = now; }   // 돌아온 화면의 창은 목록에 다시 뜰 때까지 잠깐 기다려 준다
          else { clearTimeout(ctxTimer); ctxTimer = setTimeout(() => lastRaw && compute(lastRaw), 170); }
        }
        if (faded && pendKey === ctxKey) { faded = false; cmd('fade', 1); }
        if (pendKey !== ctxKey) return;              // 화면이 바뀌는 중에는 아직 목록을 반영하지 않는다 (새 화면의 창을 옛 화면에 섞지 않는다)
      }
    }
    if (moving) return;                              // 넘기는 동안에는 얼려 둔다
    // macOS: 창을 최소화하면 0.5초 동안 창 좌표가 옆으로 퍼졌다가 Dock 쪽으로 쪼그라든다 (지니 효과).
    // 그 좌표를 따라가면 눈이 같이 끌려가므로, 크기가 갑자기 크게 바뀐 창은 '사라지는 중'으로 보고 닫힌 창과 똑같이 목록에서 뺀다
    // (눈은 마지막으로 쌓여 있던 자리에서 떨어진다). 창이 목록에서 완전히 사라지면 기록을 지운다.
    if (raw.pt) {
      const here = new Set(wins.map(w => w.h)), tn = performance.now();
      for (const h of dying.keys()) if (!here.has(h)) dying.delete(h);
      for (const w of wins) {
        const pg = prevGeom.get(w.h), changed = !pg || Math.abs(w.w - pg[0]) > 1 || Math.abs(w.hgt - pg[1]) > 1;
        if (dying.has(w.h)) {
          if (changed) dying.set(w.h, tn);
          else if (tn - dying.get(w.h) > 500) dying.delete(w.h);       // 크기가 멈췄다: 사라지는 게 아니라 그냥 크기가 바뀐 창 (최대화 등)
        } else if (pg && (Math.abs(w.w - pg[0]) > pg[0] * 0.12 || Math.abs(w.hgt - pg[1]) > pg[1] * 0.12)) dying.set(w.h, tn);
      }
      if (dying.size) { clearTimeout(dyTimer); dyTimer = setTimeout(() => lastRaw && compute(lastRaw), 560); }
      prevGeom = new Map(wins.map(w => [w.h, [w.w, w.hgt]]));
      if (dying.size) wins = wins.filter(w => !dying.has(w.h));
    }
    const fullNow = ctxKey.indexOf('fs:') === 0;
    const displays = raw.mons.map((m, k) => {
      const b = { x: X(m[0]), y: Y(m[1]), r: X(m[2]), b: Y(m[3]) }, wb = Y(m[7]);
      const hasTaskbar = m[7] < m[3] || m[5] > m[1] || m[4] > m[0] || m[6] < m[2];
      // 작업 표시줄(맥에서는 Dock)이 아래에 있으면 그 윗변이 바닥.
      // macOS 에서 전체 화면 앱이 떠 있으면(= 별도의 화면) 그 화면에는 맨 아래 눈만 쌓는다
      const macFull = fullNow;
      // Dock 의 가로 범위를 읽었으면(손쉬운 사용 권한) Dock 아이콘 줄 위에만 따로 바닥을 놓고, 나머지는 화면 맨 아래에 쌓는다
      let dockSplit = null;
      const dk = raw.pt && raw.dock && !macFull ? { x: X(raw.dock[0]), y: Y(raw.dock[1]), r: X(raw.dock[2]), b: Y(raw.dock[3]) } : null;
      const dockOk = dk && dk.r - dk.x > dk.b - dk.y && dk.y < b.b - 4 && dk.b > b.b - 60 && (dk.x + dk.r) / 2 >= b.x && (dk.x + dk.r) / 2 < b.r;
      // macOS: 맨 아래 바닥은 늘 화면 맨 아래다. 전체 화면 창으로 넘겨 볼 때 Dock 높이로 튀어 오르지 않게, Dock 위 눈만 따로 둔다
      const groundY = raw.pt ? b.b - 1 : wb < b.b ? wb : b.b - 1;
      if (dockOk) {
        // Dock 양 끝은 둥글게 휘어 있으므로 눈은 조금 안쪽까지만 쌓는다
        const inset = 10;
        grounds.push({ id: 'dockg:' + k, kind: 'ground', round: true, x0: Math.round(dk.x + inset), x1: Math.round(dk.r - inset), y: Math.round(dk.y + 3) });   // 접근성 값의 윗변은 Dock 유리 윗변보다 3pt 정도 위에 있다
        dockSplit = { x: dk.x + inset, r: dk.r - inset };
      }
      // macOS: 윗변이 메뉴 막대에 걸친 창(최대화·전체 화면)에는 눈을 쌓지 않는다. 막대 바로 아래의 창에는 쌓는다
      const topSkip = raw.pt ? Math.max(30, Y(m[5]) - b.y + 2) : 30;
      if (fg && hasTaskbar && fg.x <= b.x && fg.y <= b.y && fg.r >= b.r && fg.b >= b.b) fs.push([b.x, b.y, b.r, b.b]);
// Dock 가 있으면 맨 아래 눈은 낮게 깔아, Dock 뒤로 비쳐 보이면서 양옆과 자연스럽게 이어지게 한다
      if (dockSplit) {
        // Dock 가 있는 구간의 맨 아래에는 눈을 쌓지 않는다. Dock 양옆에만 쌓고, Dock 쪽 끝은 둥글게 내려앉는다
        if (dockSplit.x - b.x > 40) grounds.push({ id: 'ground:' + k + 'L', kind: 'ground', round: 'r', x0: Math.round(b.x), x1: Math.round(dockSplit.x), y: Math.round(groundY) });
        if (b.r - dockSplit.r > 40) grounds.push({ id: 'ground:' + k + 'R', kind: 'ground', round: 'l', x0: Math.round(dockSplit.r), x1: Math.round(b.r), y: Math.round(groundY) });
      } else grounds.push({ id: 'ground:' + k, kind: 'ground', x0: Math.round(b.x), x1: Math.round(b.r), y: Math.round(groundY) });
      return { b, groundY, topSkip, full: [] };
    });
    const displayOf = w => {
      const cx = w.x + w.w / 2, cy = w.y + Math.min(w.hgt / 2, 200);
      return displays.find(d => cx >= d.b.x && cx < d.b.r && cy >= d.b.y && cy < d.b.b) || displays.find(d => cx >= d.b.x && cx < d.b.r);
    };
    const OV = 0;                                  // 창 양옆으로 눈이 튀어나가는 폭 (맥은 좁게)
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i], d = displayOf(w);
      if (!d || fullNow) continue;                 // 전체 화면 속에서는 창 위에 눈을 쌓지 않는다
      if (w.y + w.hgt > d.groundY - 140) covers.push([Math.round(w.x), Math.round(w.y), Math.round(w.x + w.w), Math.round(w.y + w.hgt)]);
      if (raw.pt) {
        // 화면을 꽉 채운 창(전체 화면) 앞에 뜬 같은 앱의 보조 창(도구 막대 등)은 창으로 치지 않는다
        if (d.full.indexOf(w.pid) >= 0) continue;
        if (w.x <= d.b.x + 2 && w.x + w.w >= d.b.r - 2 && w.y - d.b.y < d.topSkip && w.y + w.hgt >= d.b.b - 2) d.full.push(w.pid);
      }
      if (w.y - d.b.y < d.topSkip || w.y > d.groundY - 24 || w.w < 130) continue;
      let segs = [[w.x - OV, w.x + w.w + OV]];
      for (let j = 0; j < i && segs.length; j++) {
        const u = wins[j];
        if (u.y >= w.y + 10 || u.y + u.hgt <= w.y - 26) continue;
        const a = u.x, c = u.x + u.w, next = [];
        for (const [p, q] of segs) {
          if (c <= p || a >= q) { next.push([p, q]); continue; }
          if (a > p) next.push([p, a]);
          if (c < q) next.push([c, q]);
        }
        segs = next;
      }
      const vs = segs.filter(g => g[1] - g[0] >= 14).map(g => [Math.round(g[0]), Math.round(g[1])]);
      let seen = 0; for (const g of vs) seen += g[1] - g[0];
      if (seen < 44) continue;
      list.push({ id: 'w' + w.h, kind: 'window', x0: Math.round(w.x - OV + 7), x1: Math.round(w.x + w.w + OV - 7), y: Math.round(w.y), vs });
    }
    // macOS: 화면을 넘긴 직후에는 창 목록이 잠깐 덜 찬 채로 올 수 있다. 사라진 창은 0.9초 동안 그대로 둬서, 그 위의 눈사람이 떨어져 깨지지 않게 한다
    const alive = wins.map(w => 'w' + w.h);
    if (raw.pt && !fullNow) {
      const sn = seen[ctxKey] || (seen[ctxKey] = new Map()), tnow = performance.now();
      for (const h of dying.keys()) sn.delete('w' + h);      // 사라지는 중인 창은 유령으로 붙잡지 않는다
      for (const e of list) if (e.kind === 'window') sn.set(e.id, { e, t: tnow });
      let pending = false;
      for (const [id, v] of sn) {
        if (list.some(e => e.id === id)) continue;
        if (tnow - v.t < 900) { list.push(v.e); if (alive.indexOf(id) < 0) alive.push(id); pending = true; } else sn.delete(id);
      }
      if (pending) { clearTimeout(ghostTimer); ghostTimer = setTimeout(() => lastRaw && compute(lastRaw), 950); }
    }
    for (const g of grounds) list.push(g);
    const data = { W: window.innerWidth, H: window.innerHeight, list, covers, fs, alive };
    const json = JSON.stringify(data);
    if (json !== lastJson && surfCb) { lastJson = json; surfCb(data); }
  }

  window.addEventListener('error', e => invoke('log_line', { msg: 'js error: ' + e.message + ' @' + String(e.filename).split('/').pop() + ':' + e.lineno }));
  window.addEventListener('unhandledrejection', e => invoke('log_line', { msg: 'js rejection: ' + (e.reason && e.reason.message || e.reason) }));
  listen('snap', e => compute(e.payload));
  listen('cur', e => {
    if (!haveOrigin) return;
    const s = unit || 1;
    cmd('cursor', [(e.payload[0] - ox) / s, (e.payload[1] - oy) / s]);
  });
  listen('command', e => cmd(e.payload.name, e.payload.arg));

  window.snowNative = {
    onSurfaces: cb => { surfCb = cb; },
    onCommand: cb => { cmdCb = cb; },
    setIgnore: ignore => { invoke('set_ignore', { ignore: !!ignore }); },
    ready: () => { invoke('overlay_ready'); },
    openMenu: () => { invoke('open_settings'); },       // 가벼운 버전에서는 우클릭하면 바로 설정 창을 연다
    openSettings: () => { invoke('open_settings'); },
    uiLang: lang => { invoke('ui_lang', { lang }); },
    log: msg => { invoke('log_line', { msg: String(msg) }); },
  };
})();
