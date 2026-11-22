// main.js — 월드 상태, 입력, 업데이트/렌더 루프
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, Ball = SX.Ball;

  const bg = document.getElementById('bg'), fg = document.getElementById('fg');
  const bctx = bg.getContext('2d'), ctx = fg.getContext('2d');
  const hintEl = document.getElementById('hint'), hintText = document.getElementById('hintText');
  const NATIVE = !!window.snowNative;
  const MAC = /Mac/i.test(navigator.platform || navigator.userAgent || '');                 // Electron 데스크탑 위젯으로 실행 중
  const MAC_WIDGET = NATIVE && MAC;
  if (NATIVE) document.documentElement.classList.add('native');

  const world = (SX.world = {
    // Retina 전체 화면을 덮는 투명 캔버스의 내부 해상도를 제한한다.
    W: 0, H: 0, dpr: 1, dprCap: MAC_WIDGET ? 1 : 2, time: 0,
    surfaces: [], ground: null, grounds: [], balls: [], snowmen: [], effects: [], twinkles: [],
    stash: new Map(),         // 다른 창에 가려져 잠시 안 보이는 창의 눈 (다시 보이면 그대로 돌아온다)
    plow: null, plowT: 3, plowDir: 1, fsRects: [], ctrl: false, pressMan: null, ctrlHover: 0,
    pointer: { x: -9999, y: -9999, down: false, movedAt: -99 },
    held: null, snapHint: null, hintGlow: 0,
    lastInteract: 0, prevInteract: 0,
    snowRate: 1, pileRate: 1, wind: 0, maxBallR: 90,
    particles: new SX.Particles(), snowfall: new SX.Snowfall(),
    pending: null, slumpT: 4, made: 0, lookOnly: false,
    follow: false,            // 눈사람이 커서를 총총 따라다닌다 (기본은 꺼짐)
    wallBreak: 560,           // 이 속도 이상으로 화면 끝에 부딪히면 깨진다
    breakSpeed: 940,          // 이 속도 이상으로 바닥에 부딪히면 깨진다 (약 190px 높이에서 낙하)
    startFill: 0.06,          // 시작할 때 깔려 있는 눈의 비율. 나머지는 내리면서 쌓인다
  });

  // ================= 초기화 =================
  function setup() {
    const W = (world.W = window.innerWidth), H = (world.H = window.innerHeight);
    const dpr = (world.dpr = Math.min(window.devicePixelRatio || 1, world.dprCap));
    fg.width = Math.round(W * dpr); fg.height = Math.round(H * dpr);
    if (NATIVE) { bg.width = 1; bg.height = 1; }          // 위젯에서는 배경 캔버스를 쓰지 않으므로 메모리를 잡지 않는다
    else { bg.width = fg.width; bg.height = fg.height; }
    if (!NATIVE) world.wallpaper = SX.paintWallpaper(W, H, dpr);
    world.maxBallR = U.clamp(H * 0.1, 56, 104);

    world.surfaces = []; world.ground = null; world.grounds = []; world.stash.clear(); world.plow = null; world.pressMan = null;
    world.balls = []; world.snowmen = []; world.effects = []; world.particles.list = [];
    world.held = null; world.snapHint = null; world.pending = null; world.made = 0;
    syncSurfaces(SX.desktop.getSurfaces(W, H), world.startFill);
    world.snowfall.resize(W, H);
    setHint(pickHint(), true);
  }

  // macOS 전체 화면 앱은 별도의 화면이다: 화면마다 눈사람·눈덩이·눈을 따로 간직했다가, 돌아오면 그대로 꺼내 놓는다
  const spaces = new Map();
  let spaceKey = 'normal';
  function switchSpace(key) {
    if (key === spaceKey) return;
    spaces.set(spaceKey, { surfaces: world.surfaces, stash: new Map(world.stash), balls: world.balls, snowmen: world.snowmen, effects: world.effects, plow: world.plow, twinkles: world.twinkles });
    const n = spaces.get(key);
    spaces.delete(key);
    spaceKey = key;
    world.holdUntil = world.time + 2.5;          // 화면을 바꾼 직후 2.5초 동안은 창 위의 눈과 눈사람을 건드리지 않는다 (창 목록이 덜 찬 채로 올 수 있다)
    world.held = null; world.pressMan = null; world.pending = null; world.snapHint = null;
    world.particles.list = [];
    world.stash.clear();
    if (n) {
      n.stash.forEach((v, k) => world.stash.set(k, v));
      world.surfaces = n.surfaces; world.balls = n.balls; world.snowmen = n.snowmen; world.effects = n.effects; world.plow = n.plow; world.twinkles = n.twinkles;
    } else {
      world.surfaces = []; world.balls = []; world.snowmen = []; world.effects = []; world.plow = null; world.twinkles = [];
    }
    world.grounds = world.surfaces.filter(s => !s.isWin);
    world.ground = world.grounds[0] || null;
  }

  // 눈이 쌓이는 면 목록을 현재 창 배치에 맞춘다. 같은 창은 높이맵을 유지한 채 위치만 옮긴다.
  function syncSurfaces(list, fill, alive) {
    const H = world.H;
    // 위젯에서는 화면 아래를 덜 가리도록 바닥 눈을 얕게 깐다
    const depth0 = NATIVE ? U.clamp(H * 0.02, 15, 22) : U.clamp(H * 0.078, 46, 86);
    const groundMax = Math.round(NATIVE ? Math.min(H * 0.07, 70) : Math.min(H * 0.3, 270));
    const old = new Map(world.surfaces.map(s => [s.id, s]));
    const next = [];
    let changed = false;
    for (const d of list) {
      let s = old.get(d.id);
      const pad = d.kind === 'window' ? 7 : 0;
      if (!s && world.stash.has(d.id)) { s = world.stash.get(d.id); world.stash.delete(d.id); changed = true; }
      if (s && s.n === Math.round(d.x1 - d.x0) + pad * 2 && (d.kind === 'window' || s.baseY === Math.round(d.y))) {
        s.moveTo(d.x0, d.y, world.time < (world.holdUntil || 0) ? null : world);
        s.vis = d.vs || null;
        old.delete(d.id);
      } else {
        s = new SX.Surface({
          id: d.id, kind: d.kind, x0: d.x0, x1: d.x1, y: d.y, vs: d.vs, round: d.round,
          maxH: d.low ? 13 : d.kind === 'ground' ? groundMax : (NATIVE ? 32 : 54),
          depth0: d.low ? Math.min(depth0, 5) : depth0, fill, scale: NATIVE ? 0.55 : 1, seed: d.x0 * 0.013 + d.y * 0.07 + 3,
        });
        if (old.has(d.id)) {          // 같은 창·같은 바닥인데 크기나 높이만 바뀐 경우: 눈을 잃지 않는다
          const prev = old.get(d.id);
          s.adopt(prev); old.delete(d.id);
          if (NATIVE && !s.isWin) window.snowNative.log('ground changed ' + d.id + ' y ' + prev.baseY + '->' + s.baseY + ' n ' + prev.n + '->' + s.n);
        }
        changed = true;
      }
      next.push(s);
    }
    for (const s of old.values()) {
      changed = true;
      if (s.isWin && world.time < (world.holdUntil || 0)) { next.push(s); continue; }      // 화면 전환 직후: 사라진 것처럼 보이는 창도 잠깐 그대로 둔다
      if (s.isWin && NATIVE) window.snowNative.log('window surface dropped ' + s.id + ' alive=' + (alive && alive.indexOf(s.id) >= 0) + ' space=' + spaceKey);
      if (!s.isWin) continue;
      // 창이 닫히거나 최소화되면 눈이 쏟아지고, 다른 창에 가려졌을 뿐이면 눈을 간직해 둔다
      if (alive && alive.indexOf(s.id) >= 0) { if (world.stash.size > 60) world.stash.clear(); world.stash.set(s.id, s); }
      else s.shed(world);
    }
    if (alive) for (const id of world.stash.keys()) if (alive.indexOf(id) < 0) world.stash.delete(id);
    world.surfaces = next;
    world.grounds = next.filter(s => !s.isWin);
    world.ground = world.grounds[0] || null;
    if (!changed) return;
    // 눈밭 위의 반짝임 위치
    world.twinkles = [];
    for (const s of world.surfaces) {
      const n = Math.round(s.n / (s.isWin ? 26 : 34));
      for (let i = 0; i < n; i++) world.twinkles.push({ s, i: (Math.random() * s.n) | 0, off: U.rand(1.5, s.isWin ? 7 : 16), ph: U.rand(0, U.TAU), sp: U.rand(0.7, 2.2) });
    }
  }

  // ================= 월드 질의 =================
  // 눈덩이를 받쳐주는 면. 창은 위에서 내려올 때만 받쳐 주고(아래에서는 통과), 바닥은 항상 받친다.
  world.supportAt = function (x, y, R, ty) {
    let best = null, bestTop = Infinity;
    for (const s of world.surfaces) {
      let top;
      if (s.isWin) {
        if (x < s.X0 - R * 0.3 || x > s.X1 + R * 0.3 || !s.visible(x)) continue;
        top = s.avgTop(x, R * 0.55);
        if (y > top - R * 0.15) continue;
        if (ty - (top - R) > R * 3 + 70) continue;       // 한참 아래로 끌어내리면 창을 통과시킨다
      } else { if (s !== world.groundAt(x)) continue; top = s.avgTop(x, R * 0.55); }
      if (top < bestTop) { bestTop = top; best = s; }
    }
    return best ? { surf: best, top: bestTop } : null;
  };

  // x 위치의 바닥(작업 표시줄 위 눈). 모니터마다 하나씩 있다.
  world.groundAt = function (x) {
    let best = null, bd = Infinity;
    for (const s of world.grounds) {
      const d = x < s.X0 ? s.X0 - x : x > s.X1 ? x - s.X1 : 0;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };

  world.surfaceBelow = function (x, y) {
    let best = null, bestTop = Infinity;
    for (const s of world.surfaces) {
      if (s.isWin ? (x < s.X0 || x > s.X1 || !s.visible(x)) : s !== world.groundAt(x)) continue;
      const top = s.topY(x);
      if (s.isWin && top < y) continue;
      if (top < bestTop) { bestTop = top; best = s; }
    }
    return best ? { surf: best, top: bestTop } : null;
  };

  const chainRoot = b => { while (b.parent) b = b.parent; return b; };
  const chainLen = b => { let n = 1, r = chainRoot(b); while (r.child) { r = r.child; n++; } return n; };

  world.canStack = function (a, b) {
    if (a === b || b.child || b.isPart || a.child || a.parent) return false;
    if (b.state !== 'free' && b.state !== 'stacked') return false;
    if (b.state === 'free' && (Math.abs(b.vx) > 8 || Math.abs(b.vy) > 60 || b.contact < 0.5)) return false;
    return !(b.form < 1 || chainLen(b) >= 3);              // 크기와 상관없이 쌓을 수 있다 (작은 눈덩이 위에 큰 눈덩이도 된다)
  };

  world.findStackTarget = function (ball) {
    let best = null, bd = Infinity;
    for (const b of world.balls) {
      if (!world.canStack(ball, b)) continue;
      const dx = ball.x - b.x, dy = ball.y - b.y, d = Math.hypot(dx, dy);
      if (Math.abs(dx) < Math.max(b.R, ball.R * 0.7) * 0.9 + 8 && dy < -b.R * 0.15 && d < (b.R + ball.R) * 1.3 && d < bd) { bd = d; best = b; }
    }
    return best;
  };

  world.snap = function (a, b) {
    a.parent = b; b.child = a; a.state = 'snap'; a.vx = a.vy = 0; a.fx.v = a.fy.v = 0; b.vx = 0;
  };

  world.onStacked = function (ball) {
    const p = ball.parent;
    ball.squash.v += 2.4; p.squash.v += 1.5;
    ball.wob.v += U.rand(18, 34) * (Math.random() < 0.5 ? -1 : 1);
    const jy = (ball.y + ball.R * 0.8 + p.y - p.R * 0.8) / 2;
    for (let i = 0; i < 12; i++) {
      const s = i % 2 ? 1 : -1;
      world.particles.puff(ball.x + s * ball.R * U.rand(0.5, 0.95), jy + U.rand(-3, 3), s * U.rand(30, 110), -U.rand(10, 80), U.rand(1.2, 2.6), U.rand(0.4, 0.8));
    }
    world.particles.sparkBurst(ball.x, jy, 4, 80, 5);
    if (chainLen(ball) === 3) world.pending = { root: chainRoot(ball), t: 0.38 };
  };

  // 큰 눈덩이가 높은 데서 떨어지면 조각나며 부서진다. 조각은 땅에 떨어져 다시 눈이 된다.
  world.shatter = function (b, sup, restY, wallDir) {
    const imp = Math.min(wallDir ? Math.abs(b.vx) * 0.9 : Math.hypot(b.vx, b.vy), 1900);
    b.dead = true;
    if (wallDir) b.vx = wallDir * (300 + imp * 0.5);       // 벽에 부딪히면 조각이 벽 반대쪽으로 튄다
    breakBall(b, imp, restY + b.R);
    world.particles.sparkBurst(b.x, restY + b.R * 0.6, 7, 170, 5 + b.R * 0.08);
    if (sup) sup.surf.dimple(b.x, Math.min(7, b.R * 0.12), b.R * 0.5);   // 떨어진 자리가 살짝 패인다
    for (const sm of world.snowmen) if (Math.abs(sm.x - b.x) < 420) sm.startle();
  };

  // 눈사람도 높은 데서 떨어지면 세 덩이가 모두 부서지고, 모자와 목도리만 잠시 남는다
  world.shatterMan = function (sm, sup) {
    const imp = Math.min(sm.gvy, 1900), P = world.particles;
    const [b0, b1, b2] = sm.parts, by = b0.y + b0.R;
    sm.dead = true; sm.bubble = null;
    if (world.pressMan && world.pressMan.sm === sm) world.pressMan = null;
    for (const b of sm.parts) breakBall(b, imp, by);
    const fl = (kind, x, y, size, k) => P.debris(kind, x, y, U.rand(-1, 1) * (140 + imp * 0.2) * k, -U.rand(0.5, 1) * (380 + imp * 0.4), size);
    const hc = sm.style.hat === 'santa' ? '#c93a36' : sm.style.hat === 'tophat' ? '#2b3146' : sm.style.hat === 'bucket' ? '#93a6c6' : sm.style.hatC.m;
    P.debris('hat', b2.x, b2.y - b2.R * 0.8, U.rand(-1, 1) * (140 + imp * 0.2) * 0.6, -U.rand(0.5, 1) * (380 + imp * 0.4), b2.R, hc);
    P.debris('scarf', b2.x, b2.y + b2.R * 0.8, U.rand(-1, 1) * (140 + imp * 0.2), -U.rand(0.5, 1) * (380 + imp * 0.4), b2.R * 0.8, sm.style.scarf.m);
    fl('carrot', b2.x, b2.y, b2.R * 0.45, 1.3);
    fl('twig', b1.x - b1.R, b1.y, b1.R * 0.9, 1.2); fl('twig', b1.x + b1.R, b1.y, b1.R * 0.9, 1.2);
    for (let i = 0; i < 4; i++) fl('coal', (i < 2 ? b2 : b1).x, (i < 2 ? b2 : b1).y, Math.max(1.6, b2.R * 0.08), 1.5);
    P.sparkBurst(b1.x, b1.y, 12, 230, 6 + b1.R * 0.08);
    if (sup) sup.surf.dimple(b0.x, Math.min(8, b0.R * 0.12), b0.R * 0.6);
    for (const o of world.snowmen) if (o !== sm && Math.abs(o.x - sm.x) < 520) o.startle();
  };

  function breakBall(b, imp, by) {
    const R = b.R;
    const n = U.clamp(Math.round(R * 0.5), 10, 30);
    const share = (b.area * 0.5) / n;                  // 조각 하나가 되돌려 놓는 눈의 단면적
    for (let i = 0; i < n; i++) {
      const a = U.rand(0, U.TAU), d = Math.sqrt(Math.random()) * R * 0.85;
      const size = R * U.rand(0.1, 0.3) * (i < 3 ? 1.25 : 1);
      const px = b.x + Math.cos(a) * d, py = Math.min(b.y + Math.sin(a) * d, by - size);
      const out = (px - b.x) / R;
      const sig = 5 + size * 0.6;
      world.particles.chunk(px, py, out * (160 + imp * 0.28) + U.rand(-70, 70) + (b.vx || 0) * 0.4, -U.rand(0.35, 1) * (360 + imp * 0.45), size, Math.min(16, share / (sig * 2.5)));
    }
    for (let i = 0; i < 26; i++) {
      const s = i % 2 ? 1 : -1;
      world.particles.puff(b.x + s * U.rand(0, R), by - U.rand(0, R * 0.8), s * U.rand(40, 260 + imp * 0.12), -U.rand(30, 300), U.rand(1.6, 4.2), U.rand(0.5, 1.2));
    }
  }

  function createBallAt(surf, x) {
    const top = surf.topY(x);
    const b = new Ball(x, top, 11, (Math.random() * 1e9) | 0);
    b.form = 0;
    world.balls.push(b); world.made++;
    world.effects.push({ surf, x, t: 0, dur: 0.3 });
    for (let i = 0; i < 16; i++) {
      const sx = x + (i % 2 ? 1 : -1) * U.rand(13, 56);
      world.particles.crumb(sx, surf.topY(sx) + U.rand(0, 3), b, U.rand(0, 0.16), U.rand(0.22, 0.38), U.rand(1.5, 3.2));
    }
    world.particles.burst(x, top, 4, 45, 0.7);
    return b;
  }

  // ================= 입력 =================
  function pos(e) { return { x: e.clientX, y: e.clientY }; }

  // 위젯 모드: 바닥 눈 아래에 다른 프로그램 창이 깔려 있으면 클릭을 그 창에 양보한다.
  // Ctrl 을 누르고 있는 동안에만 그 자리의 눈을 만질 수 있다. (맨 바탕화면 위의 눈은 그냥 만질 수 있다)
  // 위젯 모드: 쌓인 눈을 눌러 새 눈덩이를 만드는 것만 Ctrl 이 필요하다. 그 외의 눈 위 클릭은 아래 창으로 통과한다.
  function canPlay() { return !NATIVE || world.pointer.ctrl || world.ctrl; }
  function snowAt(x, y) { return canPlay() ? snowUnder(x, y) : null; }
  function snowUnder(x, y) {
    for (const s of world.surfaces) {
      if (x < s.X0 + 2 || x > s.X1 - 2 || !s.visible(x)) continue;
      const h = s.heightAt(x), top = s.baseY - h;
      if (y >= top - 9 && y <= s.baseY + (s.isWin ? 9 : 4)) return { s, h };
    }
    return null;
  }
  function ballAt(x, y) {
    let best = null, bd = Infinity;
    for (const b of world.balls) {
      if (b.state === 'snap') continue;
      const d = Math.hypot(x - b.x, y - b.y) - b.R;
      if (d < 7 && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  fg.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    const p = pos(e), P = world.pointer;
    P.x = p.x; P.y = p.y; P.down = true; P.movedAt = world.time; P.ctrl = !!e.ctrlKey;
    world.prevInteract = world.lastInteract; world.lastInteract = world.time;
    try { fg.setPointerCapture(e.pointerId); } catch (_) { /* 합성 이벤트 */ }

    if (gearAt(p.x, p.y)) { if (NATIVE) window.snowNative.openSettings(); return; }
    // 눈사람: 그냥 누르면 인사, 누른 채 끌면 옮기기 (어느 쪽인지는 움직임을 보고 정한다)
    for (let i = world.snowmen.length - 1; i >= 0; i--) {
      if (world.snowmen[i].hit(p.x, p.y)) { world.pressMan = { sm: world.snowmen[i], x: p.x, y: p.y, moved: false }; return; }
    }
    const b = ballAt(p.x, p.y);       // 이미 만든 눈덩이는 Ctrl 없이 잡고 굴릴 수 있다
    if (b) {
      if (b.child) { b.squash.v += 1.2; return; }          // 받침 눈덩이는 흔들리기만
      b.grabStart(P); world.held = b; fg.style.cursor = 'grabbing';
      world.balls.splice(world.balls.indexOf(b), 1); world.balls.push(b);
      return;
    }
    const hit = snowAt(p.x, p.y);
    if (hit) {
      if (hit.h < 3 || world.balls.length >= 9) { world.particles.burst(p.x, hit.s.topY(p.x), 5, 60, 0.8); return; }
      const nb = createBallAt(hit.s, p.x);
      nb.grabStart(P); nb.grab.dx = 0; nb.grab.dy = 0; nb.squash.v = 0;
      world.held = nb; fg.style.cursor = 'grabbing';
    }
  });

  fg.addEventListener('pointermove', e => {
    const p = pos(e), P = world.pointer;
    P.x = p.x; P.y = p.y; P.movedAt = world.time; P.ctrl = !!e.ctrlKey;
    const pm = world.pressMan;
    if (pm) {
      world.lastInteract = world.time;
      if (!pm.moved && Math.hypot(p.x - pm.x, p.y - pm.y) > 7) { pm.moved = pm.sm.dragStart({ x: pm.x, y: pm.y }); if (pm.moved) fg.style.cursor = 'grabbing'; }
      return;
    }
    if (world.held) {
      world.lastInteract = world.time;
      return;
    }
    refreshHover();
  });

  // 설정 버튼: 각 모니터 바닥의 오른쪽 끝에 떠 있는 작은 눈사람. 누르면 설정 창이 열린다.
  function gearGrounds() {
    if (!MAC) return world.grounds;
    return [];                           // 맥에서는 설정 버튼을 두지 않는다 (메뉴 막대 아이콘으로 연다)
  }
  function gearAt(x, y) {
    if (!NATIVE) return null;
    for (const g of gearGrounds()) { const gx = g.X1 - 26, gy = g.baseY - 24; if (Math.hypot(x - gx, y - gy) < 17) return g; }
    return null;
  }
  function openMenu() { if (NATIVE) window.snowNative.openMenu(); }
  fg.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (MAC && e.ctrlKey) return;            // 맥의 Ctrl+클릭은 우클릭으로 들어온다. 눈덩이 만들기와 겹치지 않게 메뉴는 열지 않는다
    up(); openMenu();
  });

  function inFs(x, y) { for (const r of world.fsRects) if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) return true; return false; }
  function refreshHover() {
    if (world.held || world.pressMan) return;
    const P = world.pointer;
    let cur = 'default';
    if (!inFs(P.x, P.y)) {
      const b = ballAt(P.x, P.y);
      if (gearAt(P.x, P.y)) cur = 'pointer';
      else if (world.snowmen.some(s => s.hit(P.x, P.y))) cur = 'grab';
      else if (b && !b.child) cur = 'grab';
      else if (b || snowAt(P.x, P.y)) cur = 'pointer';
    }
    if (fg.style.cursor !== cur) fg.style.cursor = cur;
    setPassThrough(cur === 'default');
  }

  // 위젯 모드: 눈·눈덩이·눈사람 위가 아니면 마우스가 아래 창으로 그대로 통과한다
  let passing = true;
  function setPassThrough(pass) {
    if (!NATIVE) return;
    pass = world.lookOnly || (pass && !world.held && !world.pressMan);
    if (pass === passing) return;
    passing = pass;
    window.snowNative.setIgnore(pass);
  }

  function up() {
    world.pointer.down = false;
    const pm = world.pressMan;
    if (pm) {
      world.pressMan = null;
      if (pm.moved) pm.sm.dragEnd(); else pm.sm.poke(world);
      refreshHover();
      return;
    }
    const b = world.held;
    if (!b) return;
    world.held = null;
    const t = world.findStackTarget(b);
    b.release();
    if (t) world.snap(b, t);
    refreshHover();
  }
  fg.addEventListener('pointerup', up);
  fg.addEventListener('pointercancel', up);
  window.addEventListener('blur', up);

  document.getElementById('btnReset').addEventListener('click', setup);
  document.getElementById('btnSnow').addEventListener('click', e => {
    world.snowRate = world.snowRate > 1 ? 1 : 2.2;
    e.currentTarget.textContent = world.snowRate > 1 ? '펑펑 내리는 눈' : '잔잔한 눈';
  });
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(setup, 180); });

  if (NATIVE) {
    window.snowNative.onSurfaces(data => {
      SX.desktop.native = data.list;
      SX.desktop.covers = data.covers || [];
      world.fsRects = data.fs || [];
      syncSurfaces(data.list, world.startFill, data.alive);
    });
    window.snowNative.onCommand((name, arg) => {
      if (name === 'space') switchSpace(arg);
      else if (name === 'fade') { fg.style.transition = 'opacity ' + (arg ? '0.25s' : '0.15s') + ' ease'; fg.style.opacity = arg ? '1' : '0'; }
      else if (name === 'reset') { spaces.clear(); spaceKey = 'normal'; setup(); }
      else if (name === 'snowRate') world.snowRate = arg;
      else if (name === 'pileRate') world.pileRate = arg;
      else if (name === 'profile') SX.profile = arg;
      else if (name === 'font') SX.fontScale = U.clamp(Number(arg) || 1, 0.6, 2);
      else if (name === 'talk') {
        SX.talkEvery = Number(arg) || 1;
        // 이미 잡혀 있던 다음 말풍선 시각도 새 빈도에 맞춘다
        for (const s of world.snowmen) s.talkT = Math.min(s.talkT, U.rand(30, 300) * SX.talkEvery);
      }
      else if (name === 'lookOnly') { world.lookOnly = !!arg; if (arg) up(); refreshHover(); }
      else if (name === 'resync') { world.lookOnly = false; world.pressMan = null; up(); passing = true; refreshHover(); }
      else if (name === 'ctrl') { world.ctrl = !!arg; if (!arg) world.pointer.ctrl = false; refreshHover(); }
      else if (name === 'cursor') {
        // 클릭 통과 중에는 마우스 이벤트가 오지 않을 수 있어서, 메인 프로세스가 커서 위치를 직접 알려 준다
        const P = world.pointer;
        if (P.x !== arg[0] || P.y !== arg[1]) { P.x = arg[0]; P.y = arg[1]; P.movedAt = world.time; }
        refreshHover();
      }
      else if (name === 'plow') callPlow();
      else if (name === 'stress') { if (arg === 'settings') window.snowNative.openSettings(); else stress(); }
      else if (name === 'follow') world.follow = !!arg;
      else if (name === 'light') calmMs = arg ? 95 : normalCalmMs;
    });
  }

  // ================= 눈사람끼리 수다 =================
  function updateChats() {
    const S = world.snowmen;
    const ok = s => s.state === 'idle' && !s.drag && !s.dead && s.gvy === 0;
    for (const s of S) { s._bd = Infinity; s._b = null; }
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const a = S[i], b = S[j];
      if (!ok(a) || !ok(b) || Math.abs(a.gy - b.gy) > 150) continue;
      const d = Math.abs(a.x - b.x);
      if (d > a.parts[0].R + b.parts[0].R + 190) continue;
      if (d < a._bd) { a._bd = d; a._b = b; }
      if (d < b._bd) { b._bd = d; b._b = a; }
    }
    for (const s of S) s.buddy = s._b && s._b._b === s ? s._b : null;   // 서로가 가장 가까운 짝일 때만
    for (const a of S) {
      const b = a.buddy;
      if (!b || a.x > b.x || a.chat || b.chat || a.chatCD > 0 || b.chatCD > 0 || a.bubble || b.bubble) continue;
      const sc = SX.pickChatScript();
      // 같이 웃는 건 마지막 말에 웃음(ㅋ, ㅎ)이 있을 때만. 'ㅜㅜ' 로 끝나는 말에 폴짝폴짝 웃으면 어색하다
      if (sc.turns.length) sc.laugh = sc.laugh && /[ㅋㅎ]/.test(sc.turns[sc.turns.length - 1].text);
      const [first, second] = Math.random() < 0.5 ? [a, b] : [b, a];
      first.chat = { me: 0, sc, i: -1, t: 0, hops: 0 };          // 말풍선은 각자 자기 차례가 되면 스스로 띄운다
      second.chat = { me: 1, sc, i: -1, t: 0, hops: 0 };
    }
  }

  // ================= 제설차 =================
  // 바닥 눈이 일정 높이만큼 쌓이면 화면 밖에서 제설차가 들어와 밀고 지나간다.
  const PLOW_AT = (NATIVE ? 5 : 10) * 96 / 25.4;      // 위젯에서는 5mm(약 19px)
  function callPlow() {
    if (world.plow || !world.grounds.length) return;
    world.plow = new SX.Plow(world, world.plowDir);
    world.plowDir = -world.plowDir;                 // 다음에는 반대쪽에서 온다
  }
  SX.callPlow = callPlow;

  // 점검용(SOBOK_STRESS 환경 변수로 켠다): 눈덩이를 떨어뜨려 눈사람 둘을 만들고, 눈덩이를 던져 깨뜨리고, 제설차를 부른다.
  function stress() {
    const report = () => window.snowNative.log('state: view=' + [innerWidth, innerHeight, window.screenX, window.screenY, devicePixelRatio].join(',') +
      ' surfaces=' + world.surfaces.map(s => s.id + '@' + s.X0 + '-' + s.X1 + ',y' + s.baseY + ',h' + s.mean().toFixed(1)).join(' ') + ' balls=' + world.balls.length + ' snowmen=' + world.snowmen.length);
    report(); setTimeout(report, 9000); setTimeout(report, 30000);
    const g = world.grounds[0]; if (!g) return;
    const cx = (g.X0 + g.X1) / 2;
    const drop = (x, r, h, vx) => { const b = new Ball(x, g.topY(x) - h, r, 0); b.vx = vx || 0; world.balls.push(b); };
    [34, 24, 16].forEach((r, i) => setTimeout(() => { drop(cx - 120, r, 110 + i * 60); drop(cx + 120, r, 110 + i * 60); }, i * 1800));
    for (let i = 0; i < 6; i++) setTimeout(() => drop(cx - 600 + i * 50, 30, 700, 900), 9000 + i * 700);
    setTimeout(callPlow, 16000);
  }
  function updatePlow(dt) {
    if (world.plow) {
      world.plow.update(dt, world);
      // 제설차가 먼저 지나간 모니터가 먼저 다시 쌓이기 시작하면 모니터마다 눈 높이가 달라진다.
      // 치운 바닥은 제설차가 화면을 다 지나갈 때까지 기다렸다가 다 같이 쌓이기 시작한다.
      for (const g of world.grounds) if (g.growHold > 0) g.growHold = 8;
      if (world.plow.done) { world.plow = null; world.plowT = 20; }
      return;
    }
    world.plowT -= dt;
    if (world.plowT > 0) return;
    world.plowT = 1.5;
    if (!NATIVE) return;                             // 웹 프로토타입에서는 SX.callPlow() 로만 부른다
    for (const g of world.grounds) if (g.mean() >= PLOW_AT) { callPlow(); break; }
  }

  // ================= 안내 문구 =================
  let hintCur = '', hintT = 0;
  function pickHint() {
    if (world.snowmen.length) return world.snowmen.some(s => s.poked) ? '가만히 두면 꾸벅꾸벅 졸아요 · 눈사람은 더 만들 수도 있어요' : '눈사람을 톡 눌러 인사해 보세요';
    const B = world.balls;
    if (!B.length) return world.ground && world.ground.heightAt(world.W / 2) < 8 ? '눈이 쌓이고 있어요… 조금만 기다려 주세요' : '쌓인 눈을 꾹 눌러 눈덩이를 만들어 보세요';
    if (B.some(b => b.parent)) return '하나만 더! 가장 작은 눈덩이를 맨 위에 올려요';
    if (B.length === 1) return B[0].r < 30 ? '눈 위에서 드래그해 굴리면 눈덩이가 점점 커져요' : '좋아요! 크기가 다른 눈덩이를 두 개 더 만들어요';
    if (B.length === 2) return '작은 눈덩이를 들어 큰 눈덩이 위에 올려 보세요 · 하나 더 필요해요';
    return '작은 눈덩이를 들어 큰 눈덩이 위에 차례로 올려 보세요';
  }
  function setHint(text, now) {
    if (text === hintCur) return;
    hintCur = text;
    if (now) { hintText.textContent = text; return; }
    hintEl.classList.add('swap');
    setTimeout(() => { hintText.textContent = hintCur; hintEl.classList.remove('swap'); }, 320);
  }

  // ================= 업데이트 =================
  function collide(dt) {
    const B = world.balls;
    const statics = [];
    for (const sm of world.snowmen) for (const p of sm.parts) statics.push({ b: p, sm });
    for (const a of B) {
      if (a.state !== 'free' || a.child || a.form < 1) continue;
      const moving = Math.abs(a.vx) > 1 || Math.abs(a.vy) > 80 || a.contact < 0.5;
      for (const b of B) {
        if (b === a || b.state === 'held' || b.state === 'snap' || b.form < 1) continue;
        if (hitPair(a, b, b.state !== 'free' || !!b.child, dt, moving)) break;
      }
      for (const s of statics) {
        const before = a.vx;
        hitPair(a, s.b, true, dt, false);
        if (before !== a.vx && Math.hypot(a.vx, a.vy) > 120) s.sm.startle();
      }
    }
  }
  function hitPair(a, b, bStatic, dt, moving) {
    const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy), min = (a.R + b.R) * 0.93;
    if (d >= min || d < 0.01) return false;
    if (moving && dy < 0 && Math.abs(dx) < b.R * 0.8 && world.canStack(a, b)) { world.snap(a, b); return true; }
    const nx = dx / d, ny = dy / d, push = min - d;
    const wa = bStatic ? 1 : b.area / (a.area + b.area);
    if (Math.abs(ny) < 0.55) {
      a.x += U.sign(nx) * push * wa * 0.6;
      if (!bStatic) b.x -= U.sign(nx) * push * (1 - wa) * 0.6;
    } else { a.x += nx * push * wa; a.y += ny * push * wa; }
    const vn = a.vx * nx + a.vy * ny;
    if (vn < 0) { a.vx -= vn * nx * 1.1; a.vy -= vn * ny * 1.1; }
    if (ny < -0.3) a.vx += (nx >= 0 ? 1 : -1) * 520 * dt;
    return false;
  }

  function update(dt) {
    world.time += dt;
    world.snowfall.update(dt, world);

    for (let i = world.effects.length - 1; i >= 0; i--) {
      const e = world.effects[i], k = Math.min(dt, e.dur - e.t) / e.dur;
      e.t += dt;
      if (k > 0) { e.surf.dimple(e.x, 6.5 * k, 10); e.surf.dimple(e.x, 2.4 * k, 32); }   // 가운데는 움푹, 주변은 살짝 쓸려 들어옴
      if (e.t >= e.dur) world.effects.splice(i, 1);
    }

    for (const b of world.balls) b.update(dt, world);
    if (world.balls.some(b => b.dead)) world.balls = world.balls.filter(b => !b.dead);
    collide(dt);
    for (const b of world.balls) if (b.state === 'stacked') b.followParent();

    const held = world.held;
    world.snapHint = held ? world.findStackTarget(held) : null;
    world.hintGlow += ((world.snapHint ? 1 : 0) - world.hintGlow) * U.expo(dt, 0.1);
    if (world.snapHint) world.hintTarget = world.snapHint;

    if (world.pending) {
      world.pending.t -= dt;
      if (world.pending.t <= 0) {
        const r = world.pending.root; world.pending = null;
        const m = r.child, t = m && m.child;
        if (m && t && m.state === 'stacked' && t.state === 'stacked') {
          world.balls = world.balls.filter(b => b !== r && b !== m && b !== t);
          world.snowmen.push(new SX.Snowman([r, m, t], world));
          world.lastInteract = world.time;
        }
      }
    }
    for (const s of world.snowmen) s.update(dt, world);
    if (world.snowmen.some(s => s.dead)) world.snowmen = world.snowmen.filter(s => !s.dead);
    updatePlow(dt);
    updateChats();
    // 위젯: 클릭을 아래 창에 양보하고 있는 바닥 눈 위에 머물면, Ctrl 안내를 띄운다 (처음 몇 번만)
    if (NATIVE) {
      const P = world.pointer;
      const su = !world.held && !world.pressMan && !canPlay() && !inFs(P.x, P.y) ? snowUnder(P.x, P.y) : null;
      const over = !!su && su.h >= 3 && !ballAt(P.x, P.y) && !world.snowmen.some(s => s.hit(P.x, P.y));
      world.ctrlHover = over ? world.ctrlHover + dt : 0;
    }
    world.particles.update(dt, world);
    for (const s of world.surfaces) s.tick(dt, world.pileRate * Math.sqrt(world.snowRate));

    // 창 모서리에 쌓인 눈이 가끔 스르르 흘러 떨어진다
    world.slumpT -= dt;
    if (world.slumpT <= 0) {
      world.slumpT = U.rand(2.5, 6) / world.snowRate;
      const wins = world.surfaces.filter(s => s.isWin);
      const s = wins[(Math.random() * wins.length) | 0];
      if (s) {
        const left = Math.random() < 0.5;
        const x = left ? s.X0 + U.rand(4, 14) : s.X1 - U.rand(4, 14);
        if (s.heightAt(x) > 6 && s.visible(x)) {
          s.dimple(x, 2.2, 7);
          for (let i = 0; i < 4; i++) world.particles.clump(x + (left ? -1 : 1) * U.rand(0, 6), s.baseY + U.rand(0, 6), (left ? -1 : 1) * U.rand(4, 26), U.rand(0, 40), U.rand(1.6, 3.4));
        }
      }
    }

    hintT -= dt;
    if (hintT <= 0 && !NATIVE) { hintT = 0.4; setHint(pickHint()); }
  }

  // ================= 렌더 =================
  function drawChain(root) {
    root.draw(ctx, world.time); root.drawLip(ctx);
    let lower = root, c = root.child;
    while (c) { Ball.jointShadow(ctx, lower, c); c.draw(ctx, world.time); lower = c; c = c.child; }
  }

  function render() {
    const W = world.W, H = world.H, dpr = world.dpr, t = world.time;
    if (!NATIVE) {
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.drawImage(world.wallpaper, 0, 0, bg.width, bg.height);
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      world.snowfall.draw(bctx, 0);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (NATIVE) world.snowfall.draw(ctx, 0);
    world.snowfall.draw(ctx, 1);

    for (const s of world.surfaces) {
      s.flush();
      if (s.isWin) {   // 눈 아래 창틀에 지는 그림자
        const g = ctx.createLinearGradient(0, s.baseY, 0, s.baseY + 20);
        g.addColorStop(0, 'rgba(26,44,92,0.26)'); g.addColorStop(1, 'rgba(26,44,92,0)');
        ctx.fillStyle = g;
        for (const seg of s.vis || [[s.X0, s.X1]]) {
          const ins = MAC ? s.pad + 4 : 0;   // Windows: 창 폭 그대로 (눈이 밖으로 나가는 폭 OV 와 같은 값). 맥은 실제 기기에서 확인하기 전까지 예전 폭 그대로
          const sa = Math.max(s.X0 + ins, seg[0]), sb = Math.min(s.X1 - ins, seg[1]);
          if (sb > sa) ctx.fillRect(sa, s.baseY, sb - sa, 20);
        }
      }
      s.draw(ctx);
    }

    // 눈밭 반짝임
    const star = SX.sprites.star;
    for (const k of world.twinkles) {
      const hh = k.s.h[k.i];
      if (hh < k.off + 2 || !k.s.visible(k.s.X0 + k.i)) continue;      // 가려진 구간에서는 반짝이지도 않는다
      const v = Math.sin(t * k.sp + k.ph);
      if (v < 0.55) continue;
      const I = Math.pow((v - 0.55) / 0.45, 2), sz = 3 + I * 5;
      ctx.globalAlpha = I;
      ctx.drawImage(star, k.s.X0 + k.i - sz, k.s.baseY - hh + k.off - sz, sz * 2, sz * 2);
    }
    ctx.globalAlpha = 1;

    // 그림자
    for (const s of world.snowmen) s.drawShadow(ctx, world);
    for (const b of world.balls) if (!b.parent) b.drawShadow(ctx, world);

    if (world.plow) world.plow.draw(ctx);
    for (const s of world.snowmen) s.draw(ctx, world);

    // 올려놓을 수 있는 자리 안내
    if (world.hintGlow > 0.02 && world.hintTarget) {
      const b = world.hintTarget, a = world.hintGlow * (0.6 + 0.25 * Math.sin(t * 6));
      const cy = b.y - b.R * 0.9, rr = b.R * 0.9;
      ctx.save(); ctx.translate(b.x, cy); ctx.scale(1, 0.42);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
      g.addColorStop(0, `rgba(255,250,225,${(0.75 * a).toFixed(3)})`); g.addColorStop(0.6, `rgba(255,244,205,${(0.3 * a).toFixed(3)})`); g.addColorStop(1, 'rgba(255,244,205,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rr, 0, U.TAU); ctx.fill();
      ctx.restore();
    }

    for (const b of world.balls) if (!b.parent && b !== world.held) drawChain(b);
    if (world.hintGlow > 0.02 && world.hintTarget && world.balls.indexOf(world.hintTarget) >= 0) {
      const b = world.hintTarget;
      ctx.save(); ctx.globalAlpha = world.hintGlow * 0.55; ctx.strokeStyle = '#fff6d8'; ctx.lineWidth = 2.5; ctx.setLineDash([5, 7]); ctx.lineDashOffset = -t * 22;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.R + 5, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); ctx.restore();
    }
    if (world.held && !world.held.parent) drawChain(world.held);

    world.particles.draw(ctx);
    world.snowfall.draw(ctx, 2);
    if (NATIVE) {       // 설정 버튼: 작은 눈사람
      const P = world.pointer;
      for (const g of gearGrounds()) {
        const gx = g.X1 - 26, gy = g.baseY - 24, hot = Math.hypot(P.x - gx, P.y - gy) < 17;
        ctx.save();
        ctx.translate(gx, gy);
        ctx.globalAlpha = hot ? 1 : 0.72;
        ctx.shadowColor = 'rgba(30,50,95,0.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
        const bgc = ctx.createLinearGradient(0, -14, 0, 14);
        bgc.addColorStop(0, hot ? '#86abec' : '#7a9fe0'); bgc.addColorStop(1, hot ? '#5f86d6' : '#587dc8');
        ctx.fillStyle = bgc;
        ctx.beginPath(); ctx.arc(0, 0, 14, 0, U.TAU); ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.rotate(hot ? Math.sin(t * 7) * 0.16 : 0);          // 커서를 올리면 갸우뚱갸우뚱
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(0, 4.6, 6, 0, U.TAU); ctx.fill();          // 몸
        ctx.beginPath(); ctx.arc(0, -3.6, 4.4, 0, U.TAU); ctx.fill();       // 머리
        ctx.fillStyle = '#c8443c';                                           // 목도리
        ctx.beginPath(); ctx.roundRect(-4.6, -0.6, 9.2, 2.4, 1.2); ctx.fill();
        ctx.fillRect(1.6, 1, 2.2, 3.4);
        ctx.fillStyle = '#2d6c5b';                                           // 모자
        ctx.beginPath(); ctx.moveTo(-4, -6.4); ctx.quadraticCurveTo(0, -12.6, 4, -6.4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f0e8d9'; ctx.fillRect(-4.6, -7.2, 9.2, 1.8);
        ctx.fillStyle = '#232838';                                           // 눈
        ctx.beginPath(); ctx.arc(-1.6, -4, 0.75, 0, U.TAU); ctx.arc(1.6, -4, 0.75, 0, U.TAU); ctx.fill();
        ctx.fillStyle = '#f1862f';                                           // 코
        ctx.beginPath(); ctx.moveTo(-0.2, -3); ctx.lineTo(3.2, -2.3); ctx.lineTo(-0.2, -1.7); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    for (const s of world.snowmen) s.drawBubble(ctx, world);

    // 쌓인 눈 위에 커서를 잠깐 두면 조작법을 알려 준다 (몇 초 뒤 스스로 사라진다)
    if (world.ctrlHover > 0.45 && world.ctrlHover < 6) {
      const P = world.pointer, hv = world.ctrlHover;
      const a = Math.min(1, (hv - 0.45) * 4) * (1 - U.smoothstep(5.3, 6, hv));
      const rows = [[MAC ? '⌘ + 클릭' : 'Ctrl + 클릭', '눈덩이 만들기']];
      ctx.save();
      const fz = SX.fontScale || 1, rh = Math.round(24 * fz);
      const fk = (12 * fz).toFixed(1) + 'px "SnowFont", "Malgun Gothic", sans-serif', ft = (12.5 * fz).toFixed(1) + 'px "SnowFont", "Malgun Gothic", sans-serif';
      let kw = 0, tw = 0;
      ctx.font = fk; for (const r of rows) kw = Math.max(kw, ctx.measureText(r[0]).width);
      ctx.font = ft; for (const r of rows) tw = Math.max(tw, ctx.measureText(r[1]).width);
      const bw = kw + tw + 52, bh = rows.length * rh + 14, x = U.clamp(P.x - bw / 2, 8, W - bw - 8), y = Math.max(8, P.y - bh - 26);
      ctx.globalAlpha = a * 0.97;
      ctx.shadowColor = 'rgba(30,50,95,0.3)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 5;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 14); ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.textBaseline = 'middle';
      rows.forEach((r, k) => {
        const cy = y + 7 + rh / 2 + k * rh;
        ctx.fillStyle = '#e8eef9'; ctx.beginPath(); ctx.roundRect(x + 12, cy - rh * 0.42, kw + 14, rh * 0.84, 6); ctx.fill();
        ctx.font = fk; ctx.fillStyle = '#4a5f8f'; ctx.fillText(r[0], x + 19, cy + 0.5);
        ctx.font = ft; ctx.fillStyle = '#3d4c6d'; ctx.fillText(r[1], x + kw + 36, cy + 0.5);
      });
      ctx.restore();
    }
    // 전체 화면 앱이 떠 있는 모니터에는 아무것도 그리지 않는다
    for (const r of world.fsRects) ctx.clearRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
  }

  // ================= 루프 =================
  // 평상시 macOS는 최대 약 60fps, Windows는 약 30fps를 그린다. '가볍게 모드'에서는 약 10fps.
  // 투명 전체 화면 창은 한 번 그릴 때마다 Windows 화면 합성(dwm)이 화면 전체를 다시 합성하므로 그리는 횟수가 곧 GPU 부하다.
  // 실측 (2560x1440 두 대): 30fps → dwm 3D 약 40%, 10fps → 약 17~22%. 대신 10fps 는 눈이 조금 끊겨 보인다.
  const normalCalmMs = MAC_WIDGET ? 15 : 30;
  let calmMs = normalCalmMs;
  let last = 0, slow = 0, frames = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    const calm = NATIVE && !busy();
    if (calm && now - last < calmMs) return;
    const raw = (now - last) / 1000;
    perfNote(raw * 1000, calm);
    last = now;
    if (raw <= 0) return;
    // macOS에서 움직이는 물체는 놓친 프레임의 시간도 짧게 나누어 따라잡는다.
    if (MAC_WIDGET && !calm) {
      const elapsed = Math.min(raw, 1 / 12);
      const steps = Math.ceil(elapsed / (1 / 60 + 0.001));
      for (let i = 0; i < steps; i++) update(elapsed / steps);
    } else {
      let left = Math.min(raw, calm ? 0.15 : 1 / 24);
      while (left > 1e-6) { const dt = Math.min(left, 1 / 24); update(dt); left -= dt; }
    }
    render();
    // macOS는 시작부터 내부 해상도를 제한하므로 실행 중 눈송이를 다시 만들 필요가 없다.
    if (MAC_WIDGET) return;
    frames++;
    if (calm) return;
    if (frames > 60 && raw < 0.2) {
      slow = slow * 0.97 + raw * 0.03;
      if (slow > 0.027 && world.dprCap > 1) {
        world.dprCap = 1;
        world.snowfall.density = 0.6;
        slow = 0;
        frames = 0;
        softResize();
      }
    } else if (frames <= 60) slow = 1 / 60;
  }
  // 프레임 간격 기록: 20초마다 로그 파일에 요약을 남긴다 (끊김이 있는지 숫자로 확인하기 위한 것)
  const perf = { fast: [], calmN: 0, calmMax: 0, t: 0 };
  function perfNote(ms, calm) {
    if (!NATIVE) return;
    if (calm) { perf.calmN++; if (ms > perf.calmMax) perf.calmMax = ms; } else if (ms < 1000) perf.fast.push(ms);
    perf.t += ms;
    if (perf.t < 20000) return;
    const f = perf.fast.sort((a, b) => a - b), n = f.length;
    const avg = n ? f.reduce((a, b) => a + b, 0) / n : 0;
    window.snowNative.log('perf 60fps-frames=' + n + ' avg=' + avg.toFixed(1) + 'ms p99=' + (n ? f[Math.floor(n * 0.99)] : 0).toFixed(1) + 'ms max=' + (n ? f[n - 1] : 0).toFixed(1) +
      'ms over25ms=' + f.filter(v => v > 25).length + ' | calm-frames=' + perf.calmN + ' max=' + perf.calmMax.toFixed(1) + 'ms | balls=' + world.balls.length + ' snowmen=' + world.snowmen.length);
    perf.fast = []; perf.calmN = 0; perf.calmMax = 0; perf.t = 0;
  }
  // 지금 화면에 빠르게 움직이는 것이 있는가 (있으면 60fps, 없으면 calmMs 간격)
  function busy() {
    if (world.held || world.pressMan || world.plow || world.particles.list.length) return true;
    if (world.time - world.pointer.movedAt < 1.2 && (!MAC || !passing)) return true;
    for (const b of world.balls) if (b.state !== 'free' && b.state !== 'stacked' || b.vx !== 0 || b.contact < 0.9 || b.form < 1) return true;
    for (const s of world.snowmen) if (s.hopY > 0 || s.drag || s.gvy !== 0 || s.chat || (s.state !== 'idle' && s.state !== 'asleep' && s.state !== 'sleepy') || (s.bubble && s.bubble.t < 0.5)) return true;
    return false;
  }
  function softResize() {
    const dpr = (world.dpr = Math.min(window.devicePixelRatio || 1, world.dprCap));
    fg.width = Math.round(world.W * dpr); fg.height = Math.round(world.H * dpr);
    if (!NATIVE) { bg.width = fg.width; bg.height = fg.height; }
    if (!NATIVE) world.wallpaper = SX.paintWallpaper(world.W, world.H, dpr);
    world.snowfall.resize(world.W, world.H);
  }

  // 자동화 테스트용: 실제 시간과 무관하게 n 프레임을 진행시킨다
  SX.step = (n, dt) => { for (let i = 0; i < (n || 1); i++) update(dt || 1 / 60); render(); };

  // 말풍선 글꼴을 미리 불러 둔다 (캔버스는 로드가 끝난 글꼴만 쓸 수 있다)
  if (document.fonts && document.fonts.load) document.fonts.load('16px "SnowFont"', '눈사람').catch(() => {});

  // 클릭 통과 상태가 메인 프로세스와 어긋나더라도 1초 안에 다시 맞춰지도록 주기적으로 알려 준다
  if (NATIVE) setInterval(() => { if (!world.held && !world.pressMan) refreshHover(); window.snowNative.setIgnore(passing); }, 1000);

  SX.sprites.build();
  setup();
  if (NATIVE) window.snowNative.ready();
  SX.desktop.tickClock();
  setInterval(SX.desktop.tickClock, 15000);
  requestAnimationFrame(frame);
})();
