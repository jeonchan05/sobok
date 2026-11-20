// snowball.js — 눈덩이: 굴림 물리(미끄러지지 않는 회전), 눈 흡수와 성장, 절차적 표면 렌더링
(function () {
  'use strict';
  const SX = window.SX, U = SX.util;

  const GRAVITY = 2300;
  const GAIN = 1.4;        // 걷어낸 눈 단면적 → 눈덩이 단면적 환산 (푹신한 눈이 뭉쳐지는 정도)
  const STACK = 0.87;      // 쌓았을 때 두 눈덩이가 겹치는 비율
  let NEXT_ID = 1;

  class Ball {
    constructor(x, y, r, seed) {
      this.id = NEXT_ID++;
      this.x = x; this.y = y;
      this.area = Math.PI * r * r;
      this.r = r; this.rs = { x: r, v: 0 };
      this.fx = { x, v: 0 }; this.fy = { x: y, v: 0 };
      this.vx = 0; this.vy = 0;
      this.angle = U.rand(0, U.TAU); this.spin = 0;
      this.squash = { x: 0, v: 0 };
      this.wob = { x: 0, v: 0 };
      this.form = 1;
      this.state = 'free';          // free | held | snap | stacked | part
      this.parent = null; this.child = null;
      this.contact = 0; this.contactSurf = null; this.sink = 0;
      this.grab = { dx: 0, dy: 0 };
      this.moveDir = 1; this.absorbAcc = 0; this.dustAcc = 0; this.featT = 0;
      this.isPart = false;
      const rnd = (this.rnd = U.rng(seed || (Math.random() * 1e9) | 0));
      this.lobes = [];
      const amps = [0, 0, 0.024, 0.018, 0.012, 0.008, 0.006];
      for (let k = 2; k <= 6; k++) this.lobes.push({ k, a: amps[k] * (0.5 + rnd()), p: rnd() * U.TAU });
      this.sparks = [];
      for (let i = 0; i < 10; i++) this.sparks.push({ ang: rnd() * U.TAU, d: Math.sqrt(0.05 + rnd() * 0.8), ph: rnd() * U.TAU });
      this.feats = [];
      const n = this.targetCount();
      for (let i = 0; i < n; i++) this.spawnFeature(false, 1);
    }

    get formScale() { return this.form >= 1 ? 1 : 0.18 + 0.82 * U.easeOutBack(U.clamp((this.form - 0.12) / 0.88, 0, 1)); }
    get R() { return this.r * this.formScale; }

    targetCount() { return U.clamp(Math.round((this.r * this.r) / 58) + 5, 6, 140); }

    // 표면 덩어리. 굴릴 때는 바닥 접촉점 근처에 새 눈이 붙는다 → "계속 뭉쳐지는" 느낌
    spawnFeature(atContact, life) {
      const rnd = this.rnd, r = this.r;
      const size = U.lerp(4.2, 6.5 + r * 0.14, rnd());
      let ang, dist;
      if (atContact) {
        const worldA = Math.PI / 2 - this.moveDir * (0.1 + rnd() * 0.8);
        ang = worldA - this.angle;
        dist = Math.max(0, r - size * (0.4 + rnd() * 0.9));
      } else {
        ang = rnd() * U.TAU;
        dist = Math.min(r * Math.sqrt(life ? 0.04 + 0.94 * rnd() : 0.3 + 0.7 * rnd()), Math.max(0, r - size * 0.35));
      }
      this.feats.push({ ang, dist, size, dent: rnd() < 0.3, v: (rnd() * 4) | 0, life: life || 0, fade: 1, dying: false, alpha: 0.5 + 0.5 * rnd() });
    }

    // ---------- 공통 틱 ----------
    tick(dt) {
      if (this.form < 1) this.form = Math.min(1, this.form + dt / 0.5);
      U.damp(this.rs, Math.sqrt(this.area / Math.PI), 0.16, dt);     // 반지름은 항상 부드럽게 따라간다 (크기 튐 방지)
      this.r = this.rs.x;
      const k = Math.max(230, 520 - this.r * 3);
      U.spring(this.squash, 0, k, 2 * Math.sqrt(k) * 0.3, dt);
      this.squash.x = U.clamp(this.squash.x, -0.28, 0.36);
      U.spring(this.wob, 0, 150, 7, dt);

      const F = this.feats, target = this.targetCount();
      let alive = 0;
      for (let i = F.length - 1; i >= 0; i--) {
        const f = F[i];
        if (f.life < 1) f.life = Math.min(1, f.life + dt * 3.5);
        if (f.dying) { f.fade -= dt * 1.4; if (f.fade <= 0) { F.splice(i, 1); continue; } }
        else alive++;
      }
      if (alive > target + 4) { for (const f of F) if (!f.dying) { f.dying = true; break; } }
      this.featT += dt;
      if (alive < target && this.featT > 0.04) { this.featT = 0; this.spawnFeature(false, 0); }
    }

    sinkDepth(surf) {
      const R = this.R;
      let S = U.clamp(2 + R * 0.11, 3, 11);
      S *= 1 - 0.6 * surf.packedAt(this.x, R * 0.5);
      const avail = surf.heightAt(this.x) - surf.minH;
      return Math.max(0, Math.min(S, avail * 0.8));
    }

    absorb(surf, moved, extra, world) {
      const cap = moved * (this.sink + 1.5) * 2.2 + (extra || 0);
      if (cap < 0.02) return;
      const removed = surf.carveCircle(this.x, this.y, this.R, cap);
      if (removed <= 0) return;
      const maxA = Math.PI * world.maxBallR * world.maxBallR;
      if (this.area < maxA) this.area = Math.min(maxA, this.area + removed * GAIN);
      this.absorbAcc += removed;
      const q = 20 + this.r * 0.9;
      while (this.absorbAcc > q) { this.absorbAcc -= q; this.spawnFeature(true, 0); }
      this.dustAcc += removed;
      if (this.dustAcc > 8) {
        this.dustAcc = 0;
        const R = this.R, d = this.moveDir;
        world.particles.puff(this.x - d * R * U.rand(0.2, 0.7), this.y + R - U.rand(1, 5), -d * U.rand(15, 70) + this.vxs * 0.15, -U.rand(25, 85), U.rand(1.1, 2.4), U.rand(0.35, 0.75));
      }
    }

    update(dt, world) {
      this.tick(dt);
      this.vxs = 0;
      if (this.state === 'held') this.updateHeld(dt, world);
      else if (this.state === 'free') this.updateFree(dt, world);
      else if (this.state === 'snap') this.updateSnap(dt, world);
      else if (this.state === 'stacked') this.followParent();
    }

    // ---------- 드래그 중 ----------
    updateHeld(dt, world) {
      const p = world.pointer, R = this.R;
      const tx = U.clamp(p.x + this.grab.dx, R * 0.4, world.W - R * 0.4), ty = p.y + this.grab.dy;
      const sup = world.supportAt(this.x, this.y, R, ty);
      let restY = Infinity;
      if (sup) {
        this.sink += (this.sinkDepth(sup.surf) - this.sink) * U.expo(dt, 0.09);
        restY = sup.top - R + this.sink;
      }
      // 커질수록 묵직하게: 추종 시간상수가 반지름에 비례해 늘어난다
      const heavy = 0.03 + R * 0.00075;
      const tau = heavy * (this.contact > 0.5 ? 1.2 : 1);
      const px = this.x;
      this.fx.x = this.x; this.fy.x = this.y;
      U.damp(this.fx, tx, tau, dt);
      U.damp(this.fy, Math.min(ty, restY), tau, dt);
      this.x = this.fx.x; this.y = this.fy.x;
      if (this.y > restY) {
        if (this.fy.v > 380) { this.squash.v += Math.min(this.fy.v, 1500) * 0.0026; world.particles.burst(this.x, restY + R, 5, 90, 0.9); }
        this.y = restY; if (this.fy.v > 0) this.fy.v = 0;
      }
      const inContact = !!sup && this.y >= restY - 1.5;
      this.contact += ((inContact ? 1 : 0) - this.contact) * U.expo(dt, 0.07);
      this.contactSurf = sup ? sup.surf : null;
      const dx = this.x - px;
      this.vxs = dx / dt;
      if (inContact) {
        // 미끄러짐 없는 굴림: 회전각 = 이동거리 / 반지름
        this.angle += dx / R; this.spin = dx / R / dt;
        if (Math.abs(dx) > 0.02) this.moveDir = dx > 0 ? 1 : -1;
        this.absorb(sup.surf, Math.abs(dx), 0, world);
      } else {
        this.angle += this.spin * dt; this.spin *= Math.exp(-dt * 1.6);
      }
      this.vx = this.fx.v; this.vy = this.fy.v;
    }

    // ---------- 자유 낙하 / 구름 / 정지 ----------
    updateFree(dt, world) {
      const R = this.R;
      if (this.child) this.vx = 0;
      this.vy += GRAVITY * dt;
      const px = this.x;
      this.x += this.vx * dt; this.y += this.vy * dt;
      // 화면 끝(벽): 세게 던져서 부딪히면 깨지고, 살살 닿으면 튕겨 나온다
      const wl = R * 0.9, wr = world.W - R * 0.9;
      if (this.x < wl || this.x > wr) {
        const left = this.x < wl;
        this.x = left ? wl : wr;
        if (Math.abs(this.vx) > world.wallBreak && !this.child && this.form >= 1) { world.shatter(this, null, this.y, left ? 1 : -1); return; }
        this.vx = (left ? 1 : -1) * Math.abs(this.vx) * 0.3;
      }
      const sup = world.supportAt(this.x, this.y, R, -1e9);
      let inContact = false;
      if (sup) {
        this.sink += (this.sinkDepth(sup.surf) - this.sink) * U.expo(dt, 0.09);
        const restY = sup.top - R + this.sink;
        if (this.y >= restY) {
          // 높은 데서 떨어지거나 세게 내던지면 크기와 상관없이 깨진다
          const hard = this.vy > world.breakSpeed || (this.vy > 420 && Math.hypot(this.vx, this.vy) > world.breakSpeed);
          if (hard && R >= 7 && !this.child && this.form >= 1) { world.shatter(this, sup, restY); return; }
          if (this.vy > 300) {
            const imp = Math.min(this.vy, 1700);
            this.squash.v += imp * 0.0034;
            world.particles.burst(this.x, restY + R - 2, 4 + Math.round(imp / 160), 60 + imp * 0.12, 0.8 + R * 0.012);
            this.absorb(sup.surf, 0, imp * 0.006 * R, world);
            this.vy = imp > 620 ? -imp * 0.13 : 0;
          } else this.vy = 0;
          this.y = restY; inContact = true;
          const sl = (sup.surf.avgTop(this.x + R * 0.5, R * 0.3) - sup.surf.avgTop(this.x - R * 0.5, R * 0.3)) / R;
          const steep = Math.abs(sl) > 0.24;
          if (!this.child && steep) this.vx += sl * 1100 * dt;
          this.vx *= Math.exp(-dt * (4.2 + R * 0.02));
          if (Math.abs(this.vx) < 4 && !steep) this.vx = 0;
        }
      }
      this.contact += ((inContact ? 1 : 0) - this.contact) * U.expo(dt, 0.07);
      this.contactSurf = sup ? sup.surf : null;
      const dx = this.x - px;
      this.vxs = dx / dt;
      if (inContact) {
        this.angle += dx / R; this.spin = dx / R / dt;
        if (Math.abs(dx) > 0.02) this.moveDir = dx > 0 ? 1 : -1;
        this.absorb(sup.surf, Math.abs(dx), 0, world);
      } else { this.angle += this.spin * dt; this.spin *= Math.exp(-dt * 0.8); }
    }

    stackPos() {
      const p = this.parent;
      return { x: p.x + this.wob.x, y: p.y - (p.R * (1 - p.squash.x * 0.8) + this.R) * STACK };
    }
    followParent() { const t = this.stackPos(); this.x = t.x; this.y = t.y; this.contact = 0; }

    updateSnap(dt, world) {
      const t = this.stackPos();
      this.fx.x = this.x; this.fy.x = this.y;
      U.damp(this.fx, t.x, 0.085, dt); U.damp(this.fy, t.y, 0.085, dt);
      const dx = this.fx.x - this.x;
      this.x = this.fx.x; this.y = this.fy.x;
      this.angle += (dx / this.R) * 0.5;
      this.contact *= Math.exp(-dt * 12);
      if (Math.hypot(t.x - this.x, t.y - this.y) < 1.2) { this.state = 'stacked'; world.onStacked(this); }
    }

    grabStart(p) {
      if (this.parent) { this.parent.child = null; this.parent = null; }
      this.state = 'held';
      this.grab.dx = this.x - p.x; this.grab.dy = this.y - p.y;
      this.fx.v = 0; this.fy.v = 0;
      this.squash.v += 1.5;                       // 잡는 순간 살짝 눌림
    }
    release() {
      this.state = 'free';
      this.vx = U.clamp(this.fx.v, -2600, 2600);      // 놓는 순간의 속도를 그대로 이어받아 던져진다
      this.vy = U.clamp(this.fy.v, -2200, 2200);
      this.squash.v -= 1.2;
    }

    // ---------- 렌더링 ----------
    path(ctx, R) {
      const N = 44, L = this.lobes, a0 = this.angle;
      let px0 = 0, py0 = 0, mx0 = 0, my0 = 0, ppx = 0, ppy = 0;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const phi = (i / N) * U.TAU;
        let k = 1;
        for (let j = 0; j < L.length; j++) k += L[j].a * Math.cos(L[j].k * phi + L[j].p);
        const x = Math.cos(phi + a0) * R * k, y = Math.sin(phi + a0) * R * k;
        if (i === 0) { px0 = x; py0 = y; }
        else {
          const mx = (ppx + x) * 0.5, my = (ppy + y) * 0.5;
          if (i === 1) { ctx.moveTo(mx, my); mx0 = mx; my0 = my; }
          else ctx.quadraticCurveTo(ppx, ppy, mx, my);
        }
        ppx = x; ppy = y;
      }
      ctx.quadraticCurveTo(px0, py0, mx0, my0);
      ctx.closePath();
    }

    draw(ctx, time) {
      const R = this.R;
      if (R < 0.6) return;
      const s = this.squash.x;
      ctx.save();
      // 바닥(접촉점)을 축으로 눌림/늘어남
      ctx.translate(this.x, this.y + R); ctx.scale(1 + s * 0.75, 1 - s); ctx.translate(0, -R);
      this.path(ctx, R);
      ctx.save(); ctx.clip();

      // 1) 고정 광원 기본 음영 (회전하지 않음)
      let g = ctx.createRadialGradient(-R * 0.36, -R * 0.42, R * 0.04, -R * 0.12, -R * 0.14, R * 1.32);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, '#f8fbff'); g.addColorStop(0.62, '#e3ebf7');
      g.addColorStop(0.86, '#c6d4ea'); g.addColorStop(1, '#abbddb');
      ctx.fillStyle = g; ctx.fillRect(-R - 3, -R - 3, R * 2 + 6, R * 2 + 6);

      // 2) 표면 입자: 눈덩이와 함께 회전. 픽셀 스케일 고정이라 커져도 늘어나지 않는다
      ctx.save(); ctx.rotate(this.angle); ctx.globalAlpha = 0.62;
      ctx.fillStyle = SX.sprites.grainPattern(ctx); ctx.fillRect(-R - 3, -R - 3, R * 2 + 6, R * 2 + 6);
      ctx.restore();

      // 3) 뭉친 덩어리들: 위치만 회전, 명암은 항상 좌상단 빛 기준
      const F = this.feats, a0 = this.angle, bumps = SX.sprites.bumps, dents = SX.sprites.dents;
      for (let i = 0; i < F.length; i++) {
        const f = F[i];
        const edge = U.clamp((R - f.dist) / (f.size * 0.7) + 0.25, 0, 1);
        const al = f.alpha * f.fade * Math.min(1, f.life * 1.4) * edge * 0.82;
        if (al < 0.02) continue;
        const a = f.ang + a0, sz = f.size * (0.55 + 0.45 * f.life) * 1.25;
        ctx.globalAlpha = al;
        ctx.drawImage(f.dent ? dents[f.v & 1] : bumps[f.v], Math.cos(a) * f.dist - sz, Math.sin(a) * f.dist - sz, sz * 2, sz * 2);
      }
      ctx.globalAlpha = 1;

      // 4) 그늘 쪽 터미네이터 + 바닥 눈에서 올라오는 반사광
      g = ctx.createRadialGradient(-R * 0.3, -R * 0.36, R * 0.5, -R * 0.1, -R * 0.12, R * 1.22);
      g.addColorStop(0, 'rgba(112,138,190,0)'); g.addColorStop(0.62, 'rgba(112,138,190,0.14)'); g.addColorStop(1, 'rgba(92,118,176,0.56)');
      ctx.fillStyle = g; ctx.fillRect(-R - 3, -R - 3, R * 2 + 6, R * 2 + 6);
      g = ctx.createRadialGradient(R * 0.12, R * 1.08, 0, R * 0.12, R * 1.08, R * 0.8);
      g.addColorStop(0, 'rgba(238,246,255,0.6)'); g.addColorStop(1, 'rgba(238,246,255,0)');
      ctx.fillStyle = g; ctx.fillRect(-R - 3, 0, R * 2 + 6, R + 3);

      // 5) 눈 결정 반짝임: 하이라이트 영역을 지날 때만 빛난다
      const star = SX.sprites.star, hx = -R * 0.36, hy = -R * 0.4;
      for (let i = 0; i < this.sparks.length; i++) {
        const sp = this.sparks[i];
        const a = sp.ang + a0, x = Math.cos(a) * sp.d * R, y = Math.sin(a) * sp.d * R;
        const q = 1 - Math.hypot(x - hx, y - hy) / (R * 0.8);
        if (q <= 0) continue;
        const I = q * q * (0.45 + 0.55 * Math.sin(time * 2.6 + sp.ph));
        if (I < 0.04) continue;
        const sz = 2.5 + R * 0.06 + I * 3;
        ctx.globalAlpha = Math.min(1, I * 1.5);
        ctx.drawImage(star, x - sz, y - sz, sz * 2, sz * 2);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // 6) 가장자리
      this.path(ctx, R);
      ctx.lineWidth = Math.max(1, R * 0.028);
      ctx.strokeStyle = 'rgba(120,146,196,0.38)';
      ctx.stroke();
      ctx.restore();
    }

    // 바닥 접촉 그림자: 매 프레임 눈덩이 위치에서 계산하므로 따로 놀 수 없다
    drawShadow(ctx, world) {
      const R = this.R;
      if (R < 1) return;
      const s = world.surfaceBelow(this.x, this.y);
      if (!s) return;
      const hgt = Math.max(0, s.top - (this.y + R));
      const k = U.clamp(1 - hgt / 320, 0, 1);
      if (k <= 0.02) return;
      const rx = R * (1.02 + hgt / 260), ry = Math.max(2.5, R * 0.2 * (1 + hgt / 300));
      ctx.save();
      ctx.translate(this.x + R * 0.14 + hgt * 0.1, s.top + ry * 0.55);
      ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(62,88,146,${(0.36 * k * k).toFixed(3)})`);
      g.addColorStop(0.6, `rgba(62,88,146,${(0.16 * k * k).toFixed(3)})`);
      g.addColorStop(1, 'rgba(62,88,146,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, U.TAU); ctx.fill();
      ctx.restore();
    }

    // 눈에 살짝 파묻힌 느낌: 눈덩이 아랫부분을 눈 색으로 부드럽게 덮는다
    drawLip(ctx) {
      if (this.contact < 0.03 || !this.contactSurf) return;
      const R = this.R;
      const hh = this.contactSurf.heightAt(this.x);
      const lip = Math.min(R * 0.2, 6) * Math.min(1, hh / 7) * this.contact;
      if (lip < 0.4) return;
      const by = this.y + R;
      ctx.save();
      ctx.beginPath(); ctx.arc(this.x, this.y, R + 1, 0, U.TAU); ctx.clip();
      const g = ctx.createLinearGradient(0, by - lip * 2.2, 0, by);
      g.addColorStop(0, 'rgba(244,248,254,0)'); g.addColorStop(0.55, 'rgba(244,248,254,0.75)'); g.addColorStop(1, 'rgba(240,246,253,0.98)');
      ctx.fillStyle = g;
      ctx.fillRect(this.x - R, by - lip * 2.2, R * 2, lip * 2.2 + 2);
      ctx.restore();
    }

    hit(x, y, pad) { return Math.hypot(x - this.x, y - this.y) <= this.R + (pad || 0); }
  }

  // 아래 눈덩이 위에 드리우는 위 눈덩이의 그림자
  Ball.jointShadow = function (ctx, lower, upper) {
    const R = lower.R;
    ctx.save();
    ctx.beginPath(); ctx.arc(lower.x, lower.y, R, 0, U.TAU); ctx.clip();
    const cx = upper.x + upper.R * 0.1, cy = upper.y + upper.R * 0.92, rr = upper.R * 0.95;
    const g = ctx.createRadialGradient(cx, cy, rr * 0.2, cx, cy, rr);
    g.addColorStop(0, 'rgba(70,96,154,0.42)'); g.addColorStop(0.6, 'rgba(70,96,154,0.2)'); g.addColorStop(1, 'rgba(70,96,154,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
    ctx.restore();
  };

  Ball.STACK = STACK;
  SX.Ball = Ball;
})();
