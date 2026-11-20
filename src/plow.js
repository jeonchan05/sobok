// plow.js — 눈이 너무 쌓이면 화면 밖에서 들어와 바닥 눈을 밀고 지나가는 제설차
(function () {
  'use strict';
  const SX = window.SX, U = SX.util;

  const LEN = 168;          // 삽날 앞끝에서 차 뒤끝까지
  const SPEED = 250;        // px/s
  const SCALE = 0.62;       // 제설차 크기
  const HOP = !!window.snowNative && /Mac/i.test(navigator.platform || navigator.userAgent || '');   // 맥: Dock 위로 폴짝 뛰어 오르고 내려온다
  const GRAV = 1900;

  class Plow {
    constructor(world, dir) {
      this.dir = dir;                              // +1: 왼쪽에서 오른쪽으로
      this.x = dir > 0 ? -60 : world.W + 60;       // 삽날 앞끝의 x
      this.t = 0; this.pile = 0; this.done = false;
      this.baseY = null; this.puffT = 0;
      this.vy = 0; this.air = false; this.tilt = 0;
    }

    // 바닥 높이가 달라지는 곳(Dock 윗면)에서는 삽날이 가장자리에 닿기 직전까지 바닥을 쓸다가 늦게 뛰어오르고,
    // 가장자리를 넘으면 곧바로 빠르게 내려와 다시 바닥을 쓴다. 높이는 삽날 앞끝이 있는 자리의 바닥을 기준으로 한다.
    drive(dt, world) {
      const dir = this.dir, fx = this.x + dir * 2;
      const gh = x => { const s = world.groundAt(x); return s ? s.baseY : null; };
      const lvl = gh(fx);
      if (lvl === null) return;
      if (this.baseY === null) { this.baseY = lvl; return; }
      if (!this.air) {
        if (lvl > this.baseY + 4) { this.air = true; this.vy = 380; }                // 가장자리를 넘었다: 바로 내려간다
        else {
          this.baseY = lvl;
          for (let d = 0; d <= 200; d += 4) {                                          // 앞쪽의 더 높은 바닥을 찾는다
            const a = gh(fx + dir * d);
            if (a === null || a >= lvl - 6) continue;
            const dh = lvl - a + 6, v = Math.sqrt(2 * GRAV * (dh + 4));
            const t1 = (v - Math.sqrt(Math.max(0, v * v - 2 * GRAV * dh))) / GRAV;     // 삽날이 가장자리 높이를 넘을 때까지 걸리는 시간
            if (d <= SPEED * t1 + 2) { this.air = true; this.vy = -v; }
            break;
          }
        }
      }
      if (this.air) {
        this.vy += GRAV * (this.vy > 0 ? 1.8 : 1) * dt; this.baseY += this.vy * dt;
        if (this.vy > 0 && this.baseY >= lvl) {
          const hit = this.vy;
          this.baseY = lvl; this.air = false; this.vy = 0;
          if (hit > 150) { const P = world.particles; for (let i = 0; i < 5; i++) P.puff(this.x - dir * U.rand(20, 60), lvl - U.rand(2, 10), -dir * U.rand(20, 90), -U.rand(20, 80), U.rand(1.5, 3), U.rand(0.4, 0.9)); }
        }
      }
      this.tilt += (U.clamp(this.vy / 800 * 0.4, -0.3, 0.3) - this.tilt) * Math.min(1, dt * 10);
    }

    update(dt, world) {
      this.t += dt;
      const prev = this.x, dir = this.dir;
      this.x += dir * SPEED * dt;
      const g = world.groundAt(this.x - dir * 40);
      if (HOP) this.drive(dt, world);
      else if (g) this.baseY = this.baseY === null ? g.baseY : this.baseY + (g.baseY - this.baseY) * U.expo(dt, 0.12);

      // 삽날이 지나간 구간의 눈을 걷어낸다
      let removed = 0;
      const a = Math.min(prev, this.x), b = Math.max(prev, this.x);
      // 맥: 삽날이 실제로 닿는 자리(삽날 앞끝에서 조금 앞)만, 삽날 높이에 있는 바닥만 치운다. 뛰어오르고 내려오는 중에도 바닥에 닿아 있는 동안은 쓴다
      // 뛰어오르거나 내려오는 동안에도 차가 지나가는 자리의 눈(떠난 바닥의 끝자락, 내려앉을 바닥의 첫머리)을 쓸어 담는다
      const off = HOP ? dir * 7 : 0, pad = HOP ? 2 : 0;
      for (const s of world.grounds) removed += s.plowRange(a + off - pad, b + off + pad);
      // 삽날 앞에 밀려 쌓인 눈더미: 계속 옆으로 흩어지므로 일정 크기 이상 커지지 않는다
      this.pile = Math.min(2600, this.pile + removed);
      this.pile *= Math.exp(-dt * 0.9);

      const P = world.particles, by = this.baseY || 0;
      if (removed > 0.5) {
        const n = Math.min(5, 1 + (removed / 28) | 0);
        for (let i = 0; i < n; i++) P.puff(this.x + dir * U.rand(0, 22), by - U.rand(6, 32), dir * U.rand(70, 300), -U.rand(60, 300), U.rand(1.5, 3.8), U.rand(0.5, 1.2));
        if (Math.random() < 0.12) P.clump(this.x + dir * U.rand(6, 20), by - U.rand(18, 34), dir * U.rand(180, 380), -U.rand(160, 330), U.rand(2, 3.6));
      }
      this.puffT -= dt;                              // 배기
      if (this.puffT <= 0) { this.puffT = 0.16; P.puff(this.x - dir * (LEN - 20) * SCALE, by - 78 * SCALE, -dir * U.rand(10, 40), -U.rand(30, 70), U.rand(2, 3.4), U.rand(0.5, 0.9)); }

      // 길을 막고 있는 눈덩이와 눈사람은 폴짝 뛰어 넘는다
      for (const bl of world.balls) {
        if (bl.state !== 'free' || bl.parent || bl.contact < 0.5 || !bl.contactSurf || bl.contactSurf.isWin) continue;
        const d = dir * (bl.x - this.x);
        if (d > -6 && d < bl.R + 34) { bl.vy = -700 - Math.min(bl.R, 80) * 1.0; bl.y -= 3; bl.contact = 0; bl.squash.v -= 1.5; }
      }
      for (const sm of world.snowmen) {
        if (sm.drag || sm.hopY > 0.5 || !sm.onGround) continue;
        const d = dir * (sm.x - this.x);
        if (d > -6 && d < sm.parts[0].R + 38) sm.plowJump();
      }

      if (dir > 0 ? this.x > world.W + LEN + 80 : this.x < -LEN - 80) this.done = true;
    }

    draw(ctx) {
      if (this.baseY === null) return;
      const t = this.t, dir = this.dir;
      const bob = Math.sin(t * 17) * 0.9 + Math.sin(t * 7.3) * 0.7;
      ctx.save();
      ctx.translate(this.x, this.baseY + 1);
      ctx.scale(dir * SCALE, SCALE);                  // 이후 +x 가 진행 방향
      if (HOP) ctx.rotate(this.tilt);                 // 뛰어오를 때 앞코가 들린다
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';

      // 바닥 그림자
      let g = ctx.createRadialGradient(-LEN * 0.5, 0, 0, -LEN * 0.5, 0, LEN * 0.62);
      g.addColorStop(0, 'rgba(40,60,110,0.34)'); g.addColorStop(1, 'rgba(40,60,110,0)');
      ctx.save(); ctx.scale(1, 0.12); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(-LEN * 0.5, 0, LEN * 0.62, 0, U.TAU); ctx.fill(); ctx.restore();

      // 전조등 빛
      g = ctx.createLinearGradient(-20, 0, 150, 0);
      g.addColorStop(0, 'rgba(255,236,170,0.34)'); g.addColorStop(1, 'rgba(255,236,170,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-22, -40 + bob); ctx.lineTo(150, -66); ctx.lineTo(150, -2); ctx.closePath(); ctx.fill();

      ctx.save();
      ctx.translate(0, bob);
      // 적재함
      g = ctx.createLinearGradient(0, -74, 0, -30);
      g.addColorStop(0, '#f7b458'); g.addColorStop(1, '#de8a2c');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-LEN + 4, -70); ctx.lineTo(-84, -70); ctx.lineTo(-80, -30); ctx.lineTo(-LEN + 10, -30); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(150,84,20,0.28)';
      for (let i = 0; i < 4; i++) ctx.fillRect(-LEN + 16 + i * 17, -66, 3, 34);
      // 적재함에 실린 눈
      ctx.fillStyle = '#f7fafe';
      ctx.beginPath();
      ctx.moveTo(-LEN + 6, -69); ctx.bezierCurveTo(-LEN + 18, -92, -140, -84, -124, -90); ctx.bezierCurveTo(-106, -98, -94, -80, -85, -69); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(160,184,224,0.4)';
      ctx.beginPath(); ctx.moveTo(-124, -90); ctx.bezierCurveTo(-106, -98, -94, -80, -85, -69); ctx.lineTo(-108, -69); ctx.closePath(); ctx.fill();

      // 운전석
      g = ctx.createLinearGradient(0, -86, 0, -28);
      g.addColorStop(0, '#fbc266'); g.addColorStop(1, '#e8962f');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-80, -30); ctx.lineTo(-80, -78); ctx.quadraticCurveTo(-80, -86, -72, -86);
      ctx.lineTo(-44, -86); ctx.quadraticCurveTo(-36, -86, -32, -78); ctx.lineTo(-25, -58);
      ctx.lineTo(-13, -55); ctx.quadraticCurveTo(-8, -53, -8, -47); ctx.lineTo(-8, -30); ctx.closePath(); ctx.fill();
      // 유리창
      g = ctx.createLinearGradient(-72, -80, -34, -58);
      g.addColorStop(0, '#e2f3fd'); g.addColorStop(1, '#9cc7e6');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-73, -60); ctx.lineTo(-73, -77); ctx.quadraticCurveTo(-73, -80, -70, -80); ctx.lineTo(-46, -80);
      ctx.quadraticCurveTo(-40, -80, -38, -75); ctx.lineTo(-33, -60); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-66, -64); ctx.lineTo(-58, -76); ctx.stroke();
      // 지붕 눈 + 경광등
      ctx.fillStyle = '#f8fbff';
      ctx.beginPath(); ctx.moveTo(-80, -84); ctx.bezierCurveTo(-76, -94, -44, -95, -34, -84); ctx.closePath(); ctx.fill();
      const bl = 0.5 + 0.5 * Math.sin(t * 9);
      g = ctx.createRadialGradient(-56, -95, 0, -56, -95, 26);
      g.addColorStop(0, `rgba(255,190,70,${(0.55 * bl).toFixed(3)})`); g.addColorStop(1, 'rgba(255,190,70,0)');
      ctx.fillStyle = g; ctx.fillRect(-84, -122, 56, 54);
      ctx.fillStyle = bl > 0.5 ? '#ffc94a' : '#e39a2a';
      ctx.beginPath(); ctx.moveTo(-61, -91); ctx.lineTo(-61, -96); ctx.quadraticCurveTo(-56, -102, -51, -96); ctx.lineTo(-51, -91); ctx.closePath(); ctx.fill();
      // 전조등, 배기관
      ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(-11, -43, 3.6, 0, U.TAU); ctx.fill();
      ctx.fillStyle = '#566380'; ctx.fillRect(-LEN + 22, -80, 4, 12);
      // 차대
      ctx.fillStyle = '#3a4560';
      ctx.beginPath(); ctx.moveTo(-LEN + 8, -31); ctx.lineTo(-6, -31); ctx.lineTo(-6, -22); ctx.lineTo(-LEN + 8, -22); ctx.closePath(); ctx.fill();
      // 삽날을 잡는 팔
      ctx.strokeStyle = '#4a5878'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-10, -25); ctx.lineTo(8, -20); ctx.moveTo(-8, -36); ctx.lineTo(10, -34); ctx.stroke();
      ctx.restore();

      // 바퀴 (차체와 달리 흔들리지 않는다)
      const spin = (this.x * dir) / 16;
      for (const wx of [-44, -126]) {
        ctx.fillStyle = '#252a3a'; ctx.beginPath(); ctx.arc(wx, -15, 15.5, 0, U.TAU); ctx.fill();
        ctx.fillStyle = '#c9d4e8'; ctx.beginPath(); ctx.arc(wx, -15, 6.5, 0, U.TAU); ctx.fill();
        ctx.strokeStyle = '#6f7d9c'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k < 3; k++) { const an = spin + k * U.TAU / 3; ctx.moveTo(wx, -15); ctx.lineTo(wx + Math.cos(an) * 6, -15 + Math.sin(an) * 6); }
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 3;   // 바퀴에 묻은 눈
        ctx.beginPath(); ctx.arc(wx, -15, 14, spin, spin + 0.9); ctx.stroke();
        ctx.beginPath(); ctx.arc(wx, -15, 14, spin + 3.1, spin + 3.8); ctx.stroke();
      }

      // 삽날 앞에 밀려 올라온 눈더미
      const q = Math.sqrt(this.pile);
      if (q > 1.5) {
        const w = 26 + q * 1.5, hh = Math.min(58, 8 + q * 1.15), wob = Math.sin(t * 11) * 1.5;
        g = ctx.createLinearGradient(0, -hh, 0, 0);
        g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#dfe9f7');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(2, 0); ctx.lineTo(8, -hh * 0.92);
        ctx.bezierCurveTo(8 + w * 0.2, -hh - 6 + wob, 8 + w * 0.5, -hh * 0.8 - wob, 8 + w * 0.68, -hh * 0.42);
        ctx.bezierCurveTo(8 + w * 0.82, -hh * 0.16, 8 + w * 0.94, -3, 8 + w, 0);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(126,152,200,0.45)'; ctx.lineWidth = 1.2; ctx.stroke();
      }

      // 삽날
      g = ctx.createLinearGradient(-6, -52, 16, 0);
      g.addColorStop(0, '#b9c8e0'); g.addColorStop(0.5, '#8196ba'); g.addColorStop(1, '#566a92');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(4, -54 + bob * 0.4); ctx.quadraticCurveTo(-8, -26, 12, 0); ctx.lineTo(19, 0); ctx.quadraticCurveTo(0, -27, 12, -55 + bob * 0.4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(11, -53 + bob * 0.4); ctx.quadraticCurveTo(1, -27, 17, -2); ctx.stroke();
      ctx.restore();
    }
  }

  SX.Plow = Plow;
})();
