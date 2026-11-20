// snowman.js — 눈덩이 3개로 조립된 눈사람. 표정은 연속 파라미터(스프링)로 블렌딩해서 상태 전환이 끊기지 않는다.
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, Ball = SX.Ball;

  const COAL = '#232838';
  const sp = v => ({ x: v, v: 0 });

  class Snowman {
    constructor(parts, world) {
      this.parts = parts;               // [아래, 가운데, 머리]
      for (const b of parts) { b.isPart = true; b.state = 'part'; b.parent = null; b.child = null; b.contact = 0; }
      this.x = parts[0].x;
      this.t = U.rand(0, 10);
      this.state = 'born'; this.stateT = 0; this.next = null;
      this.hopY = 0; this.hopV = 0; this.hopQueue = [];
      this.acc = { eyes: sp(0), nose: sp(0), mouth: sp(0), buttons: sp(0), arms: sp(0), scarf: sp(0), hat: sp(0) };
      this.accOn = {};
      this.P = {
        eyeOpen: sp(0), eyeArc: sp(0), smile: sp(0.4), mouthOpen: sp(0), blush: sp(0.2),
        armL: sp(0.3), armR: sp(0.3), tilt: sp(0), headTilt: sp(0), lookX: sp(0.3), lookY: sp(0),
        hatLift: sp(0), swing: sp(0), breath: sp(0.008),
      };
      this.blinkT = U.rand(1.5, 4); this.blink = 0; this.blinkAgain = false;
      this.zT = 0; this.yawnAt = 1.0; this.sleepClock = 0;
      this.pokes = []; this.poked = false;
      this.headRot = 0;
      this.glanceT = 0; this.glance = 0;
      this.gy = parts[0].y; this.gvy = 0;      // 바닥 눈덩이 중심의 높이 (폴짝 뛰는 높이는 제외)
      this.drag = null; this.fxs = sp(this.x); this.fys = sp(this.gy); this.vxs = 0; this.onGround = true;
      this.bubble = null; this.talkT = U.rand(25, 70) * Math.min(SX.talkEvery || 1, 2);     // 태어나고 조금 뒤 첫 인사
      this.following = false; this.walkT = 0; this.walkDir = 0; this.near = 0; this.dead = false;
      this.style = Snowman.randomStyle(world ? world.snowmen : []);
      this.buddy = null; this.chat = null; this.chatCD = 1.2; this.sleepAfter = U.rand(150, 360);
    }

    setState(s) { this.state = s; this.stateT = 0; this.entered = false; }

    jump(v) { if (this.hopY <= 0.5) { this.hopV = v; for (const b of this.parts) b.squash.v -= 1.4; } }

    poke(world) {
      const now = world.time;
      this.pokes = this.pokes.filter(t => now - t < 1.4); this.pokes.push(now);
      this.poked = true;
      if (this.state === 'born') return;
      const calm = now - world.prevInteract;
      if (this.state === 'asleep' || this.state === 'sleepy' || this.state === 'yawn' || calm > 9 || this.pokes.length >= 3) {
        this.pokes = [];
        this.next = 'happy'; this.setState('surprised');
      } else this.setState('happy');
      this.say(world);
    }

    // 말풍선으로 아재개그나 인사말을 건넨다
    say(world, auto) {
      const asleep = this.state === 'asleep';
      if (auto && (this.state === 'born' || this.state === 'carried' || this.drag)) return;
      const line = SX.pickLine(asleep && auto);
      const q = Array.isArray(line) ? line[0] : line;
      let a = Array.isArray(line) ? line[1] : null, extra = 0;
      this.bubble = { q, a, t: 0, aAt: a ? 2.3 : 0, dur: (a ? 2.3 + 4.4 : 4.6) + extra, quiet: asleep && auto };
      this.talkT = U.rand(45, 600) * (SX.talkEvery || 1);    // 다음 혼잣말까지 ('자주' 기준 길어야 10분)
    }
    // 눈사람을 집어서 옮긴다
    dragStart(p) {
      if (this.state === 'born') return false;
      this.drag = { dx: this.x - p.x, dy: this.gy - p.y };
      this.fxs.v = 0; this.fys.v = 0; this.hopY = 0; this.hopV = 0;
      for (const b of this.parts) b.squash.v -= 1.2;
      this.poked = true;
      this.setState('carried');
      return true;
    }
    dragEnd() { this.drag = null; this.gvy = Math.min(600, Math.max(-500, this.fys.v * 0.6)); }
    plowJump() { this.next = 'idle'; this.setState('surprised'); this.entered = true; this.hopV = 930; this.hopY = 1; for (const b of this.parts) b.squash.v -= 1.6; this.P.hatLift.v += 9; }

    startle() { if (this.state === 'idle' || this.state === 'sleepy' || this.state === 'asleep' || this.state === 'yawn') { this.next = 'idle'; this.setState('surprised'); } }

    hit(x, y) { for (const b of this.parts) if (b.hit(x, y, 4)) return true; return false; }

    update(dt, world) {
      this.t += dt; this.stateT += dt;
      const t = this.t, st = this.stateT, P = this.P;
      const [b0, b1, b2] = this.parts;
      // 커서가 근처에서 움직이면 그것도 '놀아 주는 것' 으로 친다: 졸지 않고, 자다가도 깬다
      const pn = world.pointer;
      if (world.time - pn.movedAt < 0.5 && Math.hypot(pn.x - this.x, pn.y - b1.y) < 450) this.lastNear = world.time;
      const idleFor = world.time - Math.max(world.lastInteract, this.lastNear || 0);
      const enter = !this.entered; this.entered = true;

      // ---- 상태별 목표값 ----
      const T = { eyeOpen: 1, eyeArc: 0, smile: 0.55, mouthOpen: 0, blush: 0.35, armL: 0.32, armR: 0.32, tilt: 0, headTilt: 0, hatLift: 0, breath: 0.008, breathHz: 1.5 };
      T.tilt = Math.sin(t * 0.9) * 0.012 + Math.sin(t * 0.37) * 0.009;
      T.headTilt = Math.sin(t * 0.6 + 1) * 0.035;
      T.armL += Math.sin(t * 1.3) * 0.04; T.armR += Math.sin(t * 1.1 + 2) * 0.04;
      let look = true;

      switch (this.state) {
        case 'born': {
          const order = [['eyes', 0.3], ['nose', 0.5], ['mouth', 0.66], ['buttons', 0.82], ['arms', 0.98], ['scarf', 1.2], ['hat', 1.45]];
          for (const [k, at] of order) {
            if (st >= at && !this.accOn[k]) {
              this.accOn[k] = true;
              const p = k === 'buttons' || k === 'arms' ? b1 : b2;
              world.particles.burst(p.x, p.y - (k === 'hat' ? p.R : 0), 3, 60, 0.7);
              if (k === 'hat') { b2.squash.v += 1.6; b1.squash.v += 0.8; }
            }
          }
          T.eyeOpen = st < 1.0 ? 0.04 : 1; T.smile = st < 1.6 ? 0.2 : 0.7; T.armL = T.armR = 0.1;
          if (st > 2.1) { world.particles.sparkBurst(b2.x, b2.y - b2.R * 0.4, 14, 190, 7 + b2.R * 0.12); this.setState('happy'); }
          break;
        }
        case 'carried': {      // 들려서 옮겨지는 중: 눈이 동그래지고 팔을 허우적거린다
          const w = Math.sin(t * 11) * 0.3;
          T.eyeOpen = 1.32; T.smile = 0.45; T.mouthOpen = 0.5; T.blush = 0.6; T.armL = 0.8 + w; T.armR = 0.8 - w;
          if (!this.drag) this.setState('idle');
          break;
        }
        case 'idle':
          if (idleFor > this.sleepAfter && !this.buddy) { this.sleepAfter = U.rand(150, 360); this.sleepClock = 0; this.yawnAt = 0.8; this.setState('sleepy'); }
          break;
        case 'happy': {
          if (enter) { this.jump(540); this.hopQueue = [0.5]; world.particles.sparkBurst(b2.x, b2.y - b2.R, 6, 120, 5 + b2.R * 0.1); }
          if (this.hopQueue.length && st > this.hopQueue[0]) { this.hopQueue.shift(); this.jump(400); }
          const w = Math.sin(t * 15) * 0.26;
          T.eyeArc = 1; T.smile = 1; T.mouthOpen = 0.42; T.blush = 0.95; T.armL = 0.95 + w; T.armR = 0.95 - w;
          T.headTilt = Math.sin(t * 7.5) * 0.09;
          if (st > 1.7) this.setState('idle');
          break;
        }
        case 'surprised': {
          if (enter) { this.jump(470); P.hatLift.v += 9; P.eyeOpen.x = Math.max(P.eyeOpen.x, 1.2); world.particles.burst(b2.x, b2.y - b2.R * 0.8, 6, 110, 0.8); }
          T.eyeOpen = 1.5; T.smile = 0; T.mouthOpen = 0.8; T.blush = 0.55; T.armL = 0.78; T.armR = 0.78; T.headTilt = -0.03; T.tilt = 0;
          if (st > 0.85) { const n = this.next || 'idle'; this.next = null; this.setState(n); }
          break;
        }
        case 'sleepy': {
          this.sleepClock += dt;
          const ph = (st % 4.2) / 4.2;
          const nod = ph < 0.84 ? U.easeInCubic(ph / 0.84) : 1 - (ph - 0.84) / 0.16;   // 꾸벅… 하다가 번쩍
          T.eyeOpen = ph < 0.84 ? U.lerp(0.5, 0.13, ph / 0.84) : 0.9;
          T.smile = 0.42; T.armL = -0.25; T.armR = -0.3; T.blush = 0.3;
          T.headTilt = 0.05 + nod * 0.2; T.tilt = nod * 0.03; T.breath = 0.012; T.breathHz = 1.0;
          look = false;
          if (idleFor < 0.6) this.setState('idle');
          else if (st > this.yawnAt) this.setState('yawn');
          else if (this.sleepClock > 15) this.setState('asleep');
          break;
        }
        case 'yawn': {
          this.sleepClock += dt;
          const e = Math.sin(U.clamp(st / 2.1, 0, 1) * Math.PI);
          T.eyeOpen = U.lerp(0.4, 0.02, e); T.mouthOpen = e * 1.05; T.smile = 0.25 * (1 - e);
          T.armL = -0.25 + e * 1.15; T.armR = -0.3 + e * 0.95; T.headTilt = -0.1 * e; T.blush = 0.4;
          look = false;
          if (idleFor < 0.6) this.setState('idle');
          else if (st > 2.1) { this.yawnAt = U.rand(6, 9); this.setState('sleepy'); }
          break;
        }
        case 'asleep': {
          T.eyeOpen = 0; T.smile = 0.15; T.mouthOpen = 0.16 + Math.sin(t * 1.3) * 0.08; T.blush = 0.45;
          T.armL = -0.5; T.armR = -0.55; T.headTilt = 0.15 + Math.sin(t * 0.65) * 0.02; T.tilt = 0.02; T.breath = 0.022; T.breathHz = 0.65;
          look = false;
          this.zT -= dt;
          if (this.zT <= 0) { this.zT = 1.7; world.particles.zzz(b2.x + b2.R * 0.75, b2.y - b2.R * 0.9, 9 + b2.R * 0.28); }
          // 잠든 눈사람은 커서가 근처에서 움직여도 깨지 않는다. 직접 눌러 줘야 깬다 (poke)
          break;
        }
      }

      // ---- 깜빡임 ----
      this.blinkT -= dt;
      if (this.blinkT <= 0 && this.blink <= 0) { this.blink = 1; this.blinkAgain = Math.random() < 0.22; this.blinkT = U.rand(2.2, 5.5); }
      let lid = 1;
      if (this.blink > 0) {
        this.blink -= dt / 0.17;
        lid = Math.abs(Math.cos(Math.PI * U.clamp(1 - this.blink, 0, 1)));
        if (this.blink <= 0 && this.blinkAgain) { this.blinkAgain = false; this.blink = 1; }
      }
      this.lid = lid;

      // ---- 시선: 커서를 따라가고, 한참 가만히 있으면 혼자 두리번 ----
      if (Math.abs(P.lookX.x) > 0.15) this.restDir = P.lookX.x > 0 ? 1 : -1;
      let lx = (this.restDir || 1) * 0.38, ly = 0.25;      // 졸 때도 코가 정면을 보지 않게 살짝 옆으로
      if (look) {
        const p = world.pointer;
        if (world.time - p.movedAt < 15) { lx = U.clamp((p.x - b2.x) / 280, -1, 1); ly = U.clamp((p.y - b2.y) / 280, -1, 1); }
        else {
          this.glanceT -= dt;
          if (this.glanceT <= 0) { this.glanceT = U.rand(1.6, 4); this.glance = U.rand(-0.8, 0.8); }
          lx = this.glance; ly = 0;
        }
      }

      // ---- 옆에 다른 눈사람이 있으면: 서로 쳐다보고, 수다 떨고, 같이 웃는다 ----
      const ptr = world.pointer, pdx = ptr.x - this.x, pdist = Math.hypot(pdx, ptr.y - b1.y);
      const bud = this.buddy;
      this.chatCD -= dt;
      if (bud && look && !(world.time - ptr.movedAt < 5 && pdist < b0.R + 170)) {
        lx = U.clamp((bud.x - this.x) / 110, -1, 1) * 0.95;
        ly = U.clamp((bud.parts[2].y - b2.y) / 160, -0.7, 0.7);
      }
      if (this.chat) {
        const C = this.chat, side = bud && bud.x > this.x ? 'armR' : 'armL';
        C.t += dt;
        // 수다는 여러 번 주고받는 대본(C.sc.turns)을 따라간다. 지금 몇 번째 말인지는 흐른 시간으로 정한다
        const turns = C.sc.turns;
        let k = 0, acc = 0;
        while (k < turns.length && C.t >= acc + turns[k].dur) { acc += turns[k].dur; k++; }
        if (!bud || this.state !== 'idle' || this.drag) this.chat = null;
        else if (k >= turns.length) { this.chat = null; this.chatCD = U.rand(16, 34) * (SX.talkEvery || 1); }
        else {
          const turn = turns[k], mine = turn.w === C.me;
          if (k !== C.i) {
            C.i = k; C.hops = 0;
            if (mine) this.bubble = { q: turn.text, a: turn.a, t: 0, aAt: turn.a ? 1.9 : 0, dur: turn.dur + 0.15, quiet: false };
          }
          if (C.sc.laugh && k === turns.length - 1) {
            // 같이 까르르: 눈웃음, 들썩들썩, 팔 흔들기
            const w = Math.sin(t * 15) * 0.25, lt = C.t - acc;
            T.eyeArc = 1; T.smile = 1; T.mouthOpen = 0.42; T.blush = 0.95; T.armL = 0.7 + w; T.armR = 0.7 - w;
            T.tilt += Math.sin(t * 17) * 0.035; T.headTilt += Math.sin(t * 9) * 0.07;
            if (C.hops < 3 && lt > C.hops * 0.42 + (mine ? 0 : 0.15)) { C.hops++; this.jump(230); }
          } else if (turn.text === '…') {
            // 정적: 들은 쪽은 멀뚱멀뚱, 농담한 쪽은 반응을 기다리며 눈치를 본다
            if (mine) { T.smile = 0.12; T.eyeOpen = 0.62; T.headTilt += 0.06; }
            else { T.smile = 0.9; T.blush = 0.6; T.headTilt += Math.sin(t * 3.2) * 0.07; }
          } else if (mine) { T[side] = 0.55 + Math.sin(t * 9) * 0.4; T.headTilt += Math.sin(t * 5) * 0.05; T.smile = 0.8; }
          else { T.headTilt += Math.sin(t * 7.5) * 0.08; T.smile = 0.75; }            // 끄덕끄덕
        }
      }

      // ---- 커서에 반응: 몸을 기울여 쳐다보고, 가까이 오면 손을 흔든다 ----
      const awake = this.state === 'idle' || this.state === 'happy';
      const fresh = world.time - ptr.movedAt < 15;
      if (look && fresh) {
        T.headTilt += lx * 0.13; T.tilt += lx * 0.045;
        this.near += ((pdist < b0.R + 150 ? 1 : 0) - this.near) * U.expo(dt, 0.2);
        if (this.near > 0.05 && this.state === 'idle' && !this.drag) {
          const w = Math.sin(t * 13) * 0.3 * this.near, up = 0.75 * this.near;
          if (pdx >= 0) T.armR += up + w; else T.armL += up + w;
          T.smile = Math.max(T.smile, 0.55 + 0.4 * this.near); T.blush += 0.25 * this.near;
        }
      } else this.near *= Math.exp(-dt * 4);
      if (world.follow && awake && fresh && this.onGround && !this.drag && world.pressMan === null && this.gvy === 0) {
        const ad = Math.abs(pdx);
        if (ad > 300) this.following = true; else if (ad < 170) this.following = false;
        this.walkT -= dt;
        if (this.following && this.hopY <= 0 && this.walkT <= 0) { this.jump(330); this.walkDir = pdx > 0 ? 1 : -1; this.walkT = 0.5; }
      } else this.following = false;
      if ((this.hopY > 0 || this.hopV > 0) && this.walkDir) this.x = U.clamp(this.x + this.walkDir * 105 * dt, b0.R, world.W - b0.R);
      else this.walkDir = 0;

      // ---- 말하기 ----
      this.talkT -= dt;
      if (this.talkT <= 0) { if (this.bubble) this.talkT = 20; else this.say(world, true); }
      if (this.bubble) {
        const B = this.bubble;
        B.t += dt;
        const since = B.a && B.t > B.aAt ? B.t - B.aAt : B.t;
        if (!B.quiet && since < 1.3 && T.mouthOpen < 0.2 && T.eyeOpen > 0.5) { T.mouthOpen = 0.22 + 0.22 * Math.sin(t * 19); T.smile = Math.max(T.smile, 0.6); }
        if (B.t > B.dur) this.bubble = null;
      }

      // ---- 파라미터 보간 ----
      U.damp(P.eyeOpen, T.eyeOpen, 0.09, dt); U.damp(P.eyeArc, T.eyeArc, 0.08, dt);
      U.damp(P.smile, T.smile, 0.14, dt); U.damp(P.mouthOpen, T.mouthOpen, 0.11, dt); U.damp(P.blush, T.blush, 0.3, dt);
      U.spring(P.armL, T.armL, 120, 11, dt); U.spring(P.armR, T.armR, 120, 11, dt);
      T.tilt += U.clamp(-this.vxs * 0.00042, -0.24, 0.24);          // 옮길 때 몸이 뒤로 살짝 쏠린다
      U.damp(P.tilt, T.tilt, this.drag ? 0.12 : 0.25, dt); U.damp(P.headTilt, T.headTilt, 0.18, dt);
      U.damp(P.lookX, lx, 0.16, dt); U.damp(P.lookY, ly, 0.16, dt);
      U.spring(P.hatLift, T.hatLift, 190, 12, dt);
      U.damp(P.breath, T.breath, 0.6, dt);
      this.breathPh = (this.breathPh || 0) + dt * T.breathHz * 1.6;
      U.spring(P.swing, Math.sin(t * 1.1) * 0.05 + U.clamp(world.wind * 0.004, -0.35, 0.35), 40, 5, dt);
      for (const k in this.acc) U.spring(this.acc[k], this.accOn[k] ? 1 : 0, 230, 15, dt);

      // ---- 폴짝 ----
      if (this.hopY > 0 || this.hopV > 0) {
        this.hopV -= 2600 * dt; this.hopY += this.hopV * dt;
        if (this.hopY <= 0) {
          const imp = Math.min(-this.hopV, 900);
          this.hopY = 0; this.hopV = 0;
          b0.squash.v += imp * 0.0042; b1.squash.v += imp * 0.003; b2.squash.v += imp * 0.0022;
          P.hatLift.v += imp * 0.006; P.swing.v += U.rand(-2.5, 2.5);
          world.particles.burst(b0.x, b0.y + b0.R - 2, 7, 80 + imp * 0.1, 1);
        }
      }

      // ---- 몸 배치 ----
      for (const b of this.parts) b.tick(dt);
      let ty = -1e9;
      if (this.drag) {
        const p = world.pointer;
        ty = p.y + this.drag.dy;
        this.fxs.x = this.x;
        U.damp(this.fxs, U.clamp(p.x + this.drag.dx, b0.R * 0.5, world.W - b0.R * 0.5), 0.085, dt);
        this.x = this.fxs.x; this.vxs = this.fxs.v;
      } else this.vxs *= Math.exp(-dt * 7);
      const sup = world.supportAt(this.x, this.gy, b0.R, ty);
      const target = sup ? sup.top - b0.R + Math.min(b0.sinkDepth(sup.surf), 5) : this.gy;
      let grounded = false;
      if (this.drag) {
        this.fys.x = this.gy;
        U.damp(this.fys, Math.min(ty, target), 0.085, dt);
        this.gy = this.fys.x;
        if (this.gy >= target) { this.gy = target; if (this.fys.v > 0) this.fys.v = 0; grounded = true; }
      } else if (this.gy < target - 1.5 || this.gvy < 0) {
        // 놓으면 떨어져서 착지한다
        this.gvy += 2600 * dt; this.gy += this.gvy * dt;
        if (this.gy >= target) {
          if (this.gvy > world.breakSpeed && this.state !== 'born') { this.gy = target; b0.y = this.gy; world.shatterMan(this, sup); return; }
          const imp = Math.min(this.gvy, 1300);
          this.gy = target; this.gvy = 0; grounded = true;
          b0.squash.v += imp * 0.004; b1.squash.v += imp * 0.003; b2.squash.v += imp * 0.0022;
          P.hatLift.v += imp * 0.007; P.swing.v += U.rand(-3, 3);
          world.particles.burst(b0.x, b0.y + b0.R - 2, 6 + Math.round(imp / 150), 80 + imp * 0.1, 1);
          if (imp > 300 && this.state !== 'born') this.setState('happy');
        }
      } else { this.gy += (target - this.gy) * U.expo(dt, 0.08); this.gvy = 0; grounded = true; }
      b0.contactSurf = sup ? sup.surf : null;
      b0.contact = grounded && this.hopY < 2 ? 1 : 0;
      this.onGround = grounded && !!sup && !sup.surf.isWin;
      const breath = 1 + Math.sin(this.breathPh) * P.breath.x;
      b0.x = this.x; b0.y = this.gy - this.hopY;
      const tl = P.tilt.x;
      const d01 = (b0.R * (1 - b0.squash.x * 0.8) + b1.R) * Ball.STACK * breath;
      b1.x = b0.x + Math.sin(tl) * d01; b1.y = b0.y - Math.cos(tl) * d01;
      const t2 = tl * 1.8 + P.headTilt.x * 0.5;
      const d12 = (b1.R * (1 - b1.squash.x * 0.8) + b2.R) * Ball.STACK * breath;
      b2.x = b1.x + Math.sin(t2) * d12; b2.y = b1.y - Math.cos(t2) * d12;
      this.headRot = t2 + P.headTilt.x;
    }

    // ================= 그리기 =================
    draw(ctx, world) {
      const [b0, b1, b2] = this.parts, time = world.time;
      b0.draw(ctx, time);
      b0.drawLip(ctx);
      this.drawArm(ctx, b1, -1, this.P.armL.x);
      this.drawArm(ctx, b1, 1, this.P.armR.x);
      Ball.jointShadow(ctx, b0, b1);
      b1.draw(ctx, time);
      this.drawButtons(ctx, b1);
      this.drawScarfTails(ctx, b1, b2);
      Ball.jointShadow(ctx, b1, b2);
      b2.draw(ctx, time);
      this.drawScarfBand(ctx, b1, b2);
      this.drawFace(ctx, b2);
      this.drawHat(ctx, b2);
    }

    drawShadow(ctx, world) { this.parts[0].drawShadow(ctx, world); }

    drawBubble(ctx, world) {
      const B = this.bubble;
      if (!B) return;
      const head = this.parts[2], R = head.R;
      const showA = B.a && B.t > B.aAt;
      ctx.save();
      const fz = SX.fontScale || 1;
      const fq = (13 * fz).toFixed(1) + 'px "SnowFont", "Malgun Gothic", sans-serif', fa = (14 * fz).toFixed(1) + 'px "SnowFont", "Malgun Gothic", sans-serif';
      const wrap = (text, font) => {
        ctx.font = font;
        const out = []; let line = '';
        for (const word of text.split(' ')) {
          const tryLine = line ? line + ' ' + word : word;
          if (ctx.measureText(tryLine).width > 215 * fz && line) { out.push(line); line = word; } else line = tryLine;
        }
        if (line) out.push(line);
        return out.map(s => ({ s, font, w: ctx.measureText(s).width }));
      };
      const rows = wrap(B.q, fq);
      const nq = rows.length;
      if (showA) for (const r of wrap(B.a, fa)) rows.push(r);
      let tw = 0; for (const r of rows) tw = Math.max(tw, r.w);
      const lh = Math.round(19 * fz), gap = showA ? 7 : 0, bw = tw + 30, bh = rows.length * lh + 20 + gap;
      // 나타날 때 톡 튀어나오고, 답이 붙을 때 한 번 더 살짝 튄다
      const kin = U.easeOutBack(U.clamp(B.t / 0.28, 0, 1)), kout = 1 - U.smoothstep(B.dur - 0.3, B.dur, B.t);
      const pop = showA ? 1 + 0.06 * Math.max(0, 1 - (B.t - B.aAt) / 0.25) : 1;
      const ax = head.x + R * 0.5, ay = head.y - R * 1.55;                 // 꼬리가 가리키는 곳(모자 옆)
      let bx = U.clamp(ax - bw * 0.3, 8, world.W - bw - 8), by = ay - 16 - bh;
      if (by < 8) by = 8;
      ctx.globalAlpha = Math.min(1, B.t / 0.15) * kout;
      ctx.translate(ax, ay); ctx.scale(kin * pop, kin * pop); ctx.translate(-ax, -ay);
      ctx.shadowColor = 'rgba(30,50,95,0.28)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 5;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 16); ctx.fill();
      ctx.shadowColor = 'transparent';
      const txx = U.clamp(ax, bx + 22, bx + bw - 22);
      ctx.beginPath(); ctx.moveTo(txx - 9, by + bh - 1); ctx.lineTo(ax - 2, ay); ctx.lineTo(txx + 9, by + bh - 1); ctx.closePath(); ctx.fill();
      ctx.textBaseline = 'middle';
      let y = by + 10 + lh / 2;
      rows.forEach((r, i) => {
        if (i === nq) y += gap;
        ctx.font = r.font; ctx.fillStyle = i < nq ? '#42506f' : '#c8443c';
        ctx.fillText(r.s, bx + 15, y + 0.5);
        y += lh;
      });
      ctx.restore();
    }

    drawArm(ctx, b1, side, ang) {
      const a = this.acc.arms.x;
      if (a < 0.02) return;
      const R = b1.R, L = (R * 0.95 + 8) * Math.min(a, 1.15);
      const rot = this.P.tilt.x;
      ctx.save();
      ctx.translate(b1.x + side * R * 0.7, b1.y - R * 0.18);
      ctx.rotate(rot);
      ctx.scale(side, 1);
      ctx.rotate(-ang);                           // ang: 수평 기준 위쪽으로 든 각도
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const w = Math.max(1.5, R * 0.075);
      const twig = (color, lw, oy) => {
        ctx.strokeStyle = color; ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(0, oy); ctx.quadraticCurveTo(L * 0.5, -L * 0.07 + oy, L, oy);
        ctx.moveTo(L * 0.7, -L * 0.035 + oy); ctx.lineTo(L * 0.92, -L * 0.24 + oy);
        ctx.moveTo(L * 0.78, -L * 0.02 + oy); ctx.lineTo(L * 1.02, L * 0.17 + oy);
        ctx.moveTo(L * 0.42, -L * 0.055 + oy); ctx.lineTo(L * 0.55, -L * 0.2 + oy);
        ctx.stroke();
      };
      twig('#4a352b', w, 0);
      twig('rgba(150,112,84,0.7)', w * 0.4, -w * 0.22);
      // 가지 위에 얹힌 눈
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = w * 0.55;
      ctx.beginPath(); ctx.moveTo(L * 0.2, -L * 0.035 - w * 0.5); ctx.quadraticCurveTo(L * 0.34, -L * 0.07 - w * 0.5, L * 0.4, -L * 0.06 - w * 0.5); ctx.stroke();
      if (this.style.mitten) {
        const mr = Math.max(3, R * 0.17);
        ctx.fillStyle = this.style.mitten;
        ctx.beginPath(); ctx.ellipse(L * 0.98, 0, mr * 1.15, mr, 0, 0, U.TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(L * 0.9, -mr * 0.85, mr * 0.45, 0, U.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(L * 0.98 - mr * 1.25, -mr * 0.8, mr * 0.45, mr * 1.6);
      }
      ctx.restore();
    }

    drawButtons(ctx, b1) {
      const a = this.acc.buttons.x;
      if (a < 0.02) return;
      const R = b1.R, lx = this.P.lookX.x, st = this.style;
      ctx.save();
      ctx.translate(b1.x, b1.y); ctx.rotate(this.P.tilt.x);
      for (const oy of st.buttons === 3 ? [-0.3, 0.02, 0.34] : [-0.12, 0.3]) {
        const x = lx * R * 0.1, y = oy * R, r = Math.max(1.2, R * 0.072) * a;
        ctx.fillStyle = 'rgba(80,104,158,0.3)';
        ctx.beginPath(); ctx.ellipse(x + r * 0.35, y + r * 0.45, r * 1.05, r * 0.95, 0, 0, U.TAU); ctx.fill();
        ctx.fillStyle = st.buttonC;
        ctx.beginPath(); ctx.arc(x, y, r, 0, U.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.3, 0, U.TAU); ctx.fill();
      }
      ctx.restore();
    }

    scarfFrame(ctx, b1, b2) {
      const R = b2.R;
      ctx.translate(b2.x + Math.sin(this.headRot) * -R * 0 , b2.y);
      ctx.rotate(this.P.tilt.x * 1.8);
      ctx.translate(0, R * 0.74);
      return { w: Math.max(R * 0.92, Math.min(R * 1.12, b1.R * 0.9)), t: R * 0.44 };
    }

    drawScarfTails(ctx, b1, b2) {
      const a = this.acc.scarf.x;
      if (a < 0.02) return;
      const C = this.style.scarf;
      ctx.save();
      const { w, t } = this.scarfFrame(ctx, b1, b2);
      const R = b2.R, L = U.clamp(R * 1.25, 12, b1.R * 1.5) * Math.min(a, 1.1), sw = this.P.swing.x;
      const tail = (rot, len, c0, c1, fr) => {
        ctx.save();
        ctx.translate(w * 0.5, t * 0.85); ctx.rotate(rot);
        const hw = t * 0.42;
        const g = ctx.createLinearGradient(-hw, 0, hw, 0);
        g.addColorStop(0, c0); g.addColorStop(1, c1);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-hw * 0.8, 0); ctx.lineTo(hw * 0.8, 0);
        ctx.quadraticCurveTo(hw * 1.15, len * 0.5, hw, len); ctx.lineTo(-hw, len);
        ctx.quadraticCurveTo(-hw * 1.1, len * 0.5, -hw * 0.8, 0);
        ctx.fill();
        ctx.fillStyle = 'rgba(250,240,222,0.9)';
        ctx.fillRect(-hw, len * 0.72, hw * 2, len * 0.1);
        ctx.strokeStyle = fr; ctx.lineWidth = Math.max(1, t * 0.09); ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < 5; i++) { const x = -hw + (hw * 2) * (i + 0.5) / 5; ctx.moveTo(x, len); ctx.lineTo(x + (i - 2) * 0.4, len + t * 0.3); }
        ctx.stroke();
        ctx.restore();
      };
      tail(-0.3 + sw * 0.7, L * 0.74, C.d, C.dd, C.dd);
      tail(0.1 + sw, L, C.m, C.d, C.d);
      ctx.restore();
    }

    drawScarfBand(ctx, b1, b2) {
      const a = this.acc.scarf.x;
      if (a < 0.02) return;
      const C = this.style.scarf;
      ctx.save();
      const { w: w0, t } = this.scarfFrame(ctx, b1, b2);
      const w = w0 * Math.min(a, 1.08);
      const yT = u => -0.3 * t + 0.36 * t * (1 - u * u);
      const yB = u => 0.72 * t + 0.39 * t * (1 - u * u);
      ctx.beginPath();
      ctx.moveTo(-w, -0.3 * t);
      ctx.quadraticCurveTo(0, 0.42 * t, w, -0.3 * t);
      ctx.quadraticCurveTo(w + 0.26 * t, 0.22 * t, w, 0.72 * t);
      ctx.quadraticCurveTo(0, 1.5 * t, -w, 0.72 * t);
      ctx.quadraticCurveTo(-w - 0.26 * t, 0.22 * t, -w, -0.3 * t);
      ctx.closePath();
      let g = ctx.createLinearGradient(0, -0.3 * t, 0, 1.2 * t);
      g.addColorStop(0, C.l); g.addColorStop(0.5, C.m); g.addColorStop(1, C.d);
      ctx.fillStyle = g; ctx.fill();
      ctx.save(); ctx.clip();
      g = ctx.createLinearGradient(-w - 0.3 * t, 0, w + 0.3 * t, 0);
      g.addColorStop(0, 'rgba(255,220,200,0.22)'); g.addColorStop(0.35, 'rgba(255,220,200,0)');
      g.addColorStop(0.7, 'rgba(70,10,24,0)'); g.addColorStop(1, 'rgba(70,10,24,0.38)');
      ctx.fillStyle = g; ctx.fillRect(-w - t, -t, w * 2 + t * 2, t * 3);
      // 니트 골
      ctx.strokeStyle = 'rgba(92,18,26,0.22)'; ctx.lineWidth = Math.max(0.8, t * 0.07);
      ctx.beginPath();
      const step = Math.max(3, t * 0.3);
      for (let x = -w; x <= w; x += step) { const u = x / w; ctx.moveTo(x - t * 0.06, yT(u)); ctx.lineTo(x + t * 0.06, yB(u)); }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,228,214,0.4)'; ctx.lineWidth = Math.max(0.8, t * 0.07);
      ctx.beginPath(); ctx.moveTo(-w * 0.9, yT(-0.9) + t * 0.08); ctx.quadraticCurveTo(0, 0.5 * t, w * 0.5, yT(0.5) + t * 0.08); ctx.stroke();
      // 매듭
      g = ctx.createRadialGradient(w * 0.46, t * 0.62, 0, w * 0.5, t * 0.72, t * 0.5);
      g.addColorStop(0, C.l); g.addColorStop(1, C.d);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(w * 0.5, t * 0.74, t * 0.4, t * 0.36, 0.3, 0, U.TAU); ctx.fill();
      ctx.restore();
    }

    drawFace(ctx, b2) {
      const R = b2.R, P = this.P, A = this.acc, st = this.style;
      const lx = P.lookX.x, ly = P.lookY.x;
      ctx.save();
      ctx.translate(b2.x, b2.y); ctx.rotate(this.headRot);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const ox = lx * R * 0.2, oy = ly * R * 0.1;

      // 볼터치
      const bl = P.blush.x * Math.min(1, A.eyes.x);
      if (bl > 0.02) {
        for (const s of [-1, 1]) {
          const cx = s * R * 0.52 + ox * 0.9, cy = R * 0.2 + oy, rr = R * 0.2;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
          g.addColorStop(0, `rgba(255,138,138,${(0.5 * bl).toFixed(3)})`); g.addColorStop(1, 'rgba(255,138,138,0)');
          ctx.fillStyle = g; ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
        }
      }

      // 눈
      const ea = A.eyes.x;
      if (ea > 0.02) {
        const open = P.eyeOpen.x * this.lid, arc = U.clamp(P.eyeArc.x, 0, 1);
        const big = Math.max(1, P.eyeOpen.x);
        const rx = R * 0.082 * ea * big * st.eyeS, ry = R * 0.105 * ea * big * st.eyeS * st.eyeTall;
        const lw = Math.max(1.1, R * 0.055);
        for (const s of [-1, 1]) {
          const cx = s * R * st.eyeGap + ox, cy = -R * 0.1 + oy;
          ctx.save(); ctx.translate(cx, cy);
          if (arc > 0.02) {       // 웃는 눈 ⌒
            ctx.globalAlpha = arc;
            ctx.strokeStyle = COAL; ctx.lineWidth = lw;
            ctx.beginPath(); ctx.moveTo(-rx * 1.45, ry * 0.5); ctx.quadraticCurveTo(0, -ry * 1.5, rx * 1.45, ry * 0.5); ctx.stroke();
          }
          if (arc < 0.98) {
            ctx.globalAlpha = 1 - arc;
            if (open < 0.14) {    // 감은 눈 ‿
              ctx.strokeStyle = COAL; ctx.lineWidth = lw;
              ctx.beginPath(); ctx.moveTo(-rx * 1.35, -ry * 0.05); ctx.quadraticCurveTo(0, ry * 0.75, rx * 1.35, -ry * 0.05); ctx.stroke();
            } else {
              const o = Math.min(open, 1);
              ctx.save();
              ctx.beginPath(); ctx.rect(-rx * 2, -ry + (1 - o) * ry * 1.85, rx * 4, ry * 3); ctx.clip();   // 눈꺼풀
              ctx.fillStyle = COAL;
              ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, U.TAU); ctx.fill();
              ctx.fillStyle = 'rgba(255,255,255,0.92)';
              ctx.beginPath(); ctx.arc(-rx * 0.28 + lx * rx * 0.34, -ry * 0.36 + ly * ry * 0.2, rx * 0.34, 0, U.TAU); ctx.fill();
              ctx.restore();
              if (st.lash && o > 0.55) {   // 속눈썹
                ctx.strokeStyle = COAL; ctx.lineWidth = lw * 0.6;
                ctx.beginPath(); ctx.moveTo(s * rx * 0.7, -ry * 0.8); ctx.lineTo(s * rx * 1.5, -ry * 1.35);
                ctx.moveTo(s * rx * 0.98, -ry * 0.4); ctx.lineTo(s * rx * 1.85, -ry * 0.75); ctx.stroke();
              }
              if (o < 0.8) {      // 졸린 눈꺼풀 선
                ctx.strokeStyle = COAL; ctx.lineWidth = lw * 0.8;
                const yl = -ry + (1 - o) * ry * 1.85;
                ctx.beginPath(); ctx.moveTo(-rx * 1.25, yl); ctx.lineTo(rx * 1.25, yl); ctx.stroke();
              }
            }
          }
          ctx.restore();
        }
      }

      // 입
      const ma = A.mouth.x;
      if (ma > 0.02) {
        const sm = P.smile.x, mo = Math.max(0, P.mouthOpen.x);
        const mw = R * U.lerp(0.1, 0.27, U.clamp(sm, 0, 1)) * ma * st.mouthW, mx = lx * R * 0.21, my = R * 0.4 + oy;
        const c = sm * R * 0.15;
        if (mo < 0.06 && st.mouth === 'dots') {      // 숯 조각을 박아 만든 입
          ctx.fillStyle = COAL;
          for (let k = 0; k < 5; k++) {
            const u = k / 4, q = 1 - u;
            const px = mx - mw + 2 * mw * u, py = q * q * (my - c * 0.4) + 2 * q * u * (my + c * 1.5) + u * u * (my - c * 0.4);
            ctx.beginPath(); ctx.arc(px, py, Math.max(1, R * 0.036), 0, U.TAU); ctx.fill();
          }
        } else if (mo < 0.06) {
          ctx.strokeStyle = COAL; ctx.lineWidth = Math.max(1.1, R * 0.05);
          ctx.beginPath(); ctx.moveTo(mx - mw, my - c * 0.4); ctx.quadraticCurveTo(mx, my + c * 1.5, mx + mw, my - c * 0.4); ctx.stroke();
        } else {
          const hh = mo * R * 0.26;
          ctx.fillStyle = '#2b2531';
          ctx.beginPath();
          ctx.moveTo(mx - mw, my - c * 0.4);
          ctx.quadraticCurveTo(mx, my + c * 0.5 - hh * 0.35, mx + mw, my - c * 0.4);
          ctx.quadraticCurveTo(mx + mw * 1.05, my + c + hh * 0.7, mx, my + c * 1.5 + hh);
          ctx.quadraticCurveTo(mx - mw * 1.05, my + c + hh * 0.7, mx - mw, my - c * 0.4);
          ctx.closePath(); ctx.fill();
          ctx.save(); ctx.clip();
          ctx.fillStyle = '#e07a7a';
          ctx.beginPath(); ctx.ellipse(mx, my + c * 1.5 + hh * 1.05, mw * 0.75, hh * 0.55, 0, 0, U.TAU); ctx.fill();
          ctx.restore();
        }
      }

      // 당근 코: 시선 방향으로 돌출 → 정면을 볼 땐 짧게, 옆을 볼 땐 길게
      const na = A.nose.x;
      if (na > 0.02 && st.nose !== 'carrot') {      // 숯 코 / 빨간 방울 코
        const red = st.nose === 'red', nr = R * (red ? 0.15 : 0.11) * Math.min(na, 1.15);
        const nx = lx * R * 0.3, ny = R * 0.12 + oy;
        ctx.fillStyle = 'rgba(84,108,160,0.26)';
        ctx.beginPath(); ctx.ellipse(nx + nr * 0.3, ny + nr * 0.5, nr * 1.1, nr * 0.9, 0, 0, U.TAU); ctx.fill();
        const g = ctx.createRadialGradient(nx - nr * 0.35, ny - nr * 0.4, 0, nx, ny, nr * 1.1);
        if (red) { g.addColorStop(0, '#ff8a80'); g.addColorStop(0.6, '#e2443e'); g.addColorStop(1, '#b02a2c'); }
        else { g.addColorStop(0, '#565d74'); g.addColorStop(1, '#1d2130'); }
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(nx, ny, nr, 0, U.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(nx - nr * 0.35, ny - nr * 0.4, nr * 0.24, 0, U.TAU); ctx.fill();
      } else if (na > 0.02) {
        const bx = lx * R * 0.25, by = R * 0.1 + oy;
        const tx = bx + (lx * 0.7 + 0.05) * R * na * st.noseL, ty = by + (0.1 + Math.abs(lx) * 0.03) * R;
        const br = R * 0.125 * Math.min(na, 1.15);
        const dx = tx - bx, dy = ty - by, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        ctx.fillStyle = 'rgba(84,108,160,0.26)';
        ctx.beginPath(); ctx.ellipse(bx + dx * 0.4 + R * 0.03, by + dy * 0.4 + R * 0.09, br * 1.2 + len * 0.35, br * 0.8, Math.atan2(dy, dx), 0, U.TAU); ctx.fill();
        const g = ctx.createLinearGradient(bx + nx * br, by + ny * br - br, bx - nx * br, by - ny * br + br);
        g.addColorStop(0, '#ffab52'); g.addColorStop(0.5, '#f1862f'); g.addColorStop(1, '#d4621c');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(bx + nx * br, by + ny * br);
        ctx.quadraticCurveTo(bx + dx * 0.6 + nx * br * 0.5, by + dy * 0.6 + ny * br * 0.5, tx, ty);
        ctx.quadraticCurveTo(bx + dx * 0.6 - nx * br * 0.5, by + dy * 0.6 - ny * br * 0.5, bx - nx * br, by - ny * br);
        ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(bx, by, br, 0, U.TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(176,84,22,0.45)'; ctx.lineWidth = Math.max(0.7, R * 0.022);
        ctx.beginPath();
        for (const k of [0.28, 0.5, 0.7]) {
          const px = bx + dx * k, py = by + dy * k, hw = br * (1 - k) * 0.75;
          ctx.moveTo(px + nx * hw, py + ny * hw); ctx.lineTo(px + nx * hw * 0.1, py + ny * hw * 0.1);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,226,180,0.55)';
        ctx.beginPath(); ctx.ellipse(bx - br * 0.3, by - br * 0.35, br * 0.36, br * 0.24, -0.6, 0, U.TAU); ctx.fill();
      }
      ctx.restore();
    }

    drawHat(ctx, b2) {
      const a = this.acc.hat.x;
      if (a < 0.02) return;
      const R = b2.R, lift = this.P.hatLift.x, st = this.style, H = st.hatC;
      ctx.save();
      ctx.translate(b2.x, b2.y); ctx.rotate(this.headRot);
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const drop = Math.max(0, lift) * R * 0.5 + (1 - Math.min(a, 1.2)) * R * 2.4;
      let g;

      if (st.hat === 'earmuff') {            // 귀마개: 머리 위로 넘어가는 밴드 + 양쪽 솜뭉치
        ctx.translate(0, -drop * 0.4);
        ctx.strokeStyle = H.d; ctx.lineWidth = Math.max(2, R * 0.11);
        ctx.beginPath(); ctx.arc(0, 0, R * 1.02, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
        for (const sd of [-1, 1]) {
          const px = sd * R * 0.98, py = R * 0.02, pr = R * 0.3;
          ctx.fillStyle = H.d;
          for (let i = 0; i < 9; i++) { const an = (i / 9) * U.TAU; ctx.beginPath(); ctx.arc(px + Math.cos(an) * pr * 0.72, py + Math.sin(an) * pr * 0.72, pr * 0.42, 0, U.TAU); ctx.fill(); }
          g = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.35, 0, px, py, pr * 1.1);
          g.addColorStop(0, H.l); g.addColorStop(1, H.m);
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, pr * 0.95, 0, U.TAU); ctx.fill();
        }
        ctx.restore();
        return;
      }

      ctx.translate(R * 0.07, -R * 0.7 - drop);
      ctx.rotate(-0.15 + lift * 0.12 + this.P.swing.x * 0.25);

      if (st.hat === 'tophat') {              // 실크햇
        g = ctx.createLinearGradient(-0.7 * R, 0, 0.7 * R, 0);
        g.addColorStop(0, '#4a5470'); g.addColorStop(0.45, '#2b3146'); g.addColorStop(1, '#171b29');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-0.56 * R, 0); ctx.lineTo(-0.62 * R, -1.02 * R); ctx.quadraticCurveTo(0, -1.12 * R, 0.62 * R, -1.02 * R); ctx.lineTo(0.56 * R, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = H.m; ctx.fillRect(-0.585 * R, -0.3 * R, 1.17 * R, 0.2 * R);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(0, 0.02 * R, 0.98 * R, 0.13 * R, 0, 0, U.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';     // 챙 위에 얹힌 눈
        ctx.beginPath(); ctx.ellipse(-0.3 * R, -1.05 * R, 0.3 * R, 0.07 * R, -0.05, 0, U.TAU); ctx.fill();
      } else if (st.hat === 'bucket') {       // 뒤집어 쓴 양동이
        g = ctx.createLinearGradient(-0.75 * R, 0, 0.75 * R, 0);
        g.addColorStop(0, '#c9d6ea'); g.addColorStop(0.45, '#93a6c6'); g.addColorStop(1, '#5f7399');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-0.78 * R, 0.05 * R); ctx.lineTo(-0.56 * R, -0.92 * R); ctx.quadraticCurveTo(0, -1.0 * R, 0.56 * R, -0.92 * R); ctx.lineTo(0.78 * R, 0.05 * R);
        ctx.quadraticCurveTo(0, 0.2 * R, -0.78 * R, 0.05 * R); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(60,80,120,0.5)'; ctx.lineWidth = Math.max(1, R * 0.04);
        ctx.beginPath(); ctx.moveTo(-0.74 * R, -0.12 * R); ctx.quadraticCurveTo(0, 0.03 * R, 0.74 * R, -0.12 * R);
        ctx.moveTo(-0.62 * R, -0.66 * R); ctx.quadraticCurveTo(0, -0.74 * R, 0.62 * R, -0.66 * R); ctx.stroke();
        ctx.strokeStyle = H.m; ctx.lineWidth = Math.max(1.2, R * 0.05);    // 손잡이
        ctx.beginPath(); ctx.moveTo(-0.7 * R, -0.3 * R); ctx.quadraticCurveTo(-1.05 * R, 0.15 * R, -0.5 * R, 0.3 * R); ctx.stroke();
      } else if (st.hat === 'santa') {        // 산타 모자
        g = ctx.createLinearGradient(-0.75 * R, -R, 0.9 * R, 0);
        g.addColorStop(0, '#ea5a50'); g.addColorStop(0.55, '#c93a36'); g.addColorStop(1, '#9d2a2c');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-0.74 * R, -0.06 * R);
        ctx.bezierCurveTo(-0.7 * R, -0.75 * R, -0.25 * R, -1.12 * R, 0.2 * R, -1.02 * R);
        ctx.bezierCurveTo(0.62 * R, -0.94 * R, 0.98 * R, -0.7 * R, 1.02 * R, -0.3 * R);
        ctx.bezierCurveTo(0.86 * R, -0.52 * R, 0.76 * R, -0.3 * R, 0.74 * R, -0.06 * R);
        ctx.closePath(); ctx.fill();
        this.pom(ctx, 1.0 * R, -0.24 * R, 0.21 * R, '#fffdf8', '#e2dccf');
        this.cuff(ctx, R, '#ffffff', '#f1ede4', '#d6d0c4');
      } else {                                // 니트 비니
        ctx.beginPath();
        ctx.moveTo(-0.74 * R, -0.08 * R);
        ctx.bezierCurveTo(-0.78 * R, -0.86 * R, -0.12 * R, -1.1 * R, 0.3 * R, -0.99 * R);
        ctx.bezierCurveTo(0.64 * R, -0.9 * R, 0.78 * R, -0.46 * R, 0.74 * R, -0.08 * R);
        ctx.closePath();
        g = ctx.createLinearGradient(-0.75 * R, -R, 0.75 * R, 0);
        g.addColorStop(0, H.l); g.addColorStop(0.5, H.m); g.addColorStop(1, H.d);
        ctx.fillStyle = g; ctx.fill();
        ctx.save(); ctx.clip();
        ctx.strokeStyle = 'rgba(10,20,40,0.2)'; ctx.lineWidth = Math.max(0.8, R * 0.035);
        ctx.beginPath();
        for (let k = -3; k <= 3; k++) { ctx.moveTo(k * 0.21 * R, -0.05 * R); ctx.quadraticCurveTo(k * 0.2 * R + 0.02 * R, -0.62 * R, 0.3 * R + k * 0.035 * R, -1.02 * R); }
        ctx.stroke();
        g = ctx.createRadialGradient(-0.2 * R, -1.0 * R, 0, -0.2 * R, -1.0 * R, 0.6 * R);
        g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(0.6, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(-R, -1.3 * R, 2 * R, R);
        ctx.restore();
        this.pom(ctx, 0.42 * R, -1.02 * R, 0.23 * R, '#fffdf7', '#d6ccb8');
        this.cuff(ctx, R, '#fffaf0', '#f0e8d9', '#d3c8b4');
      }
      ctx.restore();
    }

    pom(ctx, px, py, pr, c0, c1) {
      ctx.fillStyle = c1;
      for (let i = 0; i < 9; i++) { const an = (i / 9) * U.TAU; ctx.beginPath(); ctx.arc(px + Math.cos(an) * pr * 0.72, py + Math.sin(an) * pr * 0.72, pr * 0.42, 0, U.TAU); ctx.fill(); }
      const g = ctx.createRadialGradient(px - pr * 0.35, py - pr * 0.4, 0, px, py, pr * 1.1);
      g.addColorStop(0, c0); g.addColorStop(1, c1);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, pr * 0.95, 0, U.TAU); ctx.fill();
    }

    cuff(ctx, R, c0, c1, c2) {
      const cw = 0.84 * R, chh = 0.36 * R, rad = 0.15 * R;
      ctx.beginPath();
      ctx.moveTo(-cw + rad, -chh * 0.55);
      ctx.lineTo(cw - rad, -chh * 0.55); ctx.quadraticCurveTo(cw, -chh * 0.55, cw, -chh * 0.55 + rad);
      ctx.lineTo(cw, chh * 0.3 - rad); ctx.quadraticCurveTo(cw, chh * 0.3, cw - rad, chh * 0.34);
      ctx.quadraticCurveTo(0, chh * 0.66, -cw + rad, chh * 0.34);
      ctx.quadraticCurveTo(-cw, chh * 0.3, -cw, chh * 0.3 - rad);
      ctx.lineTo(-cw, -chh * 0.55 + rad); ctx.quadraticCurveTo(-cw, -chh * 0.55, -cw + rad, -chh * 0.55);
      ctx.closePath();
      const g = ctx.createLinearGradient(-cw, -chh, cw, chh);
      g.addColorStop(0, c0); g.addColorStop(0.6, c1); g.addColorStop(1, c2);
      ctx.fillStyle = g; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(128,106,80,0.2)'; ctx.lineWidth = Math.max(0.7, R * 0.028);
      ctx.beginPath();
      for (let x = -cw; x <= cw; x += Math.max(2.5, R * 0.115)) { ctx.moveTo(x, -chh); ctx.lineTo(x, chh); }
      ctx.stroke();
      ctx.restore();
    }
  }

  // 눈사람마다 다른 생김새와 소품을 무작위로 고른다
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const KNIT = [
    { l: '#418f79', m: '#2d6c5b', d: '#1f4d42' }, { l: '#e06a5c', m: '#c2443c', d: '#8f2c2c' }, { l: '#5f86d6', m: '#3f62b0', d: '#2a4380' },
    { l: '#f2c35a', m: '#dc9d2e', d: '#a8721c' }, { l: '#b08ad8', m: '#8a63b8', d: '#5f4188' }, { l: '#f3a3bd', m: '#dc7499', d: '#a84c70' },
    { l: '#7f8ba6', m: '#586583', d: '#3a4560' },
  ];
  const SCARF = [
    { l: '#e05b50', m: '#c8443c', d: '#a23230', dd: '#7e2424' }, { l: '#4f9c84', m: '#35785f', d: '#245a47', dd: '#18402f' },
    { l: '#f0c25c', m: '#dba032', d: '#b07c1e', dd: '#825a12' }, { l: '#6c8fdc', m: '#4969b8', d: '#324d92', dd: '#22366a' },
    { l: '#b792de', m: '#9169be', d: '#6d4a98', dd: '#4d3270' }, { l: '#f4a9c0', m: '#e07c9e', d: '#b9587c', dd: '#8c3e5c' },
  ];
  // others: 지금 화면에 있는 눈사람들. 모자·목도리·얼굴이 서로 겹치지 않게 고른다.
  Snowman.randomStyle = function (others) {
    const used = k => (others || []).map(o => o.style && o.style[k]);
    const fresh = (arr, taken) => { const c = arr.filter(x => taken.indexOf(x) < 0); return pick(c.length ? c : arr); };
    const face = st => st.nose + '/' + st.mouth + '/' + st.lash;
    const faces = (others || []).map(o => o.style ? face(o.style) : '');
    const st = {
      hat: fresh(['beanie', 'santa', 'tophat', 'bucket', 'earmuff'], used('hat')),
      hatC: fresh(KNIT, used('hatC')), scarf: fresh(SCARF, used('scarf')),
      eyeS: U.rand(0.82, 1.28), eyeGap: U.rand(0.27, 0.39), eyeTall: U.rand(0.85, 1.25),
      noseL: U.rand(0.7, 1.3), mouthW: U.rand(0.8, 1.25),
      buttons: Math.random() < 0.4 ? 3 : 2, buttonC: fresh(['#232838', '#b8343a', '#2f6b5a', '#3f5fa8', '#8a63b8'], used('buttonC')),
      mitten: Math.random() < 0.45 ? fresh(['#c8443c', '#35785f', '#4969b8', '#dba032', '#9169be'], used('mitten')) : null,
    };
    for (let k = 0; k < 12; k++) {      // 눈·코·입 조합도 겹치지 않을 때까지 다시 뽑는다
      st.nose = pick(['carrot', 'carrot', 'coal', 'red']); st.mouth = pick(['line', 'dots']); st.lash = Math.random() < 0.35;
      if (faces.indexOf(face(st)) < 0) break;
    }
    return st;
  };

  SX.Snowman = Snowman;
})();
