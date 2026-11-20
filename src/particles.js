// particles.js — 눈가루, 모여드는 눈 부스러기, 반짝임, 떨어지는 눈뭉치, 잠꼬대 z
(function () {
  'use strict';
  const SX = window.SX, U = SX.util;
  const PUFF = 0, CRUMB = 1, SPARK = 2, CLUMP = 3, ZZZ = 4, CHUNK = 5, DEBRIS = 6;

  class Particles {
    constructor() { this.list = []; }
    add(p) { if (this.list.length < 800) this.list.push(p); return p; }

    puff(x, y, vx, vy, size, life) { return this.add({ type: PUFF, x, y, vx, vy, size, life, age: 0 }); }
    burst(x, y, n, speed, sizeMul) {
      for (let i = 0; i < n; i++) {
        const a = U.rand(-Math.PI, 0), sp = U.rand(0.25, 1) * speed;
        this.puff(x + U.rand(-5, 5), y + U.rand(-2, 2), Math.cos(a) * sp, Math.sin(a) * sp * 0.75, U.rand(1.2, 3) * (sizeMul || 1), U.rand(0.35, 0.85));
      }
    }
    crumb(x, y, ball, delay, dur, size) { return this.add({ type: CRUMB, x, y, x0: x, y0: y, ball, delay, dur, size, age: 0, lift: U.rand(5, 16) }); }
    spark(x, y, vx, vy, size, life) { return this.add({ type: SPARK, x, y, vx, vy, size, life, age: 0, ph: U.rand(0, 6.28) }); }
    sparkBurst(x, y, n, speed, size) {
      for (let i = 0; i < n; i++) {
        const a = U.rand(0, U.TAU), sp = U.rand(0.3, 1) * speed;
        this.spark(x + Math.cos(a) * 6, y + Math.sin(a) * 6, Math.cos(a) * sp, Math.sin(a) * sp - 30, U.rand(0.6, 1.3) * size, U.rand(0.6, 1.3));
      }
    }
    clump(x, y, vx, vy, size) { return this.add({ type: CLUMP, x, y, vx, vy, size, age: 0, life: 6 }); }
    // 눈덩이가 깨질 때 튀는 각진 눈 조각. dep = 땅에 떨어져 남기는 눈의 양
    chunk(x, y, vx, vy, size, dep) {
      const pts = [], n = 5 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) { const a = (i / n) * U.TAU + U.rand(-0.25, 0.25), r = size * U.rand(0.62, 1.05); pts.push(Math.cos(a) * r, Math.sin(a) * r); }
      return this.add({ type: CHUNK, x, y, vx, vy, size, dep, pts, rot: U.rand(0, U.TAU), vr: U.rand(-9, 9), age: 0, life: 5, bounced: false });
    }
    // 눈사람이 깨질 때 튀어나오는 모자·목도리·당근·숯·나뭇가지
    debris(kind, x, y, vx, vy, size, color) {
      return this.add({ type: DEBRIS, kind, color, x, y, vx, vy, size, rot: U.rand(-0.5, 0.5), vr: U.rand(-7, 7), age: 0, life: 9, landed: 0 });
    }
    zzz(x, y, size) { return this.add({ type: ZZZ, x, y, x0: x, size, age: 0, life: 2.8 }); }

    update(dt, world) {
      const L = this.list;
      for (let i = L.length - 1; i >= 0; i--) {
        const p = L[i];
        p.age += dt;
        let dead = false;
        switch (p.type) {
          case PUFF:
            p.vy += 300 * dt; p.vx += (world.wind * 0.6 - p.vx) * Math.min(1, dt * 1.6); p.vy *= Math.exp(-dt * 1.5);
            p.x += p.vx * dt; p.y += p.vy * dt; dead = p.age >= p.life; break;
          case CRUMB: {
            const t = (p.age - p.delay) / p.dur;
            if (t >= 1) dead = true;
            else if (t > 0) {
              const e = t * t, b = p.ball;
              p.x = U.lerp(p.x0, b.x, e); p.y = U.lerp(p.y0, b.y, e) - Math.sin(Math.PI * t) * p.lift;
            }
            break;
          }
          case SPARK:
            p.vx *= Math.exp(-dt * 2.4); p.vy = p.vy * Math.exp(-dt * 2.4) + 40 * dt;
            p.x += p.vx * dt; p.y += p.vy * dt; dead = p.age >= p.life; break;
          case CLUMP: {
            p.vy += 900 * dt; p.vx += (world.wind * 0.3 - p.vx) * Math.min(1, dt);
            p.x += p.vx * dt; p.y += p.vy * dt;
            const g = world.groundAt(p.x);
            if (g && p.y >= g.topY(p.x)) {
              g.deposit(p.x, p.size * 0.55, 4.5);
              this.burst(p.x, p.y - 1, 3, 40, 0.7);
              dead = true;
            } else dead = p.age >= p.life;
            break;
          }
          case CHUNK: {
            p.vy += 2100 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
            const s = p.vy > 0 ? world.surfaceBelow(p.x, p.y - p.size - 4) : null;
            if (s && p.y + p.size * 0.5 >= s.top) {
              if (!p.bounced && p.size > 5 && p.vy > 320) {
                // 큰 조각은 한 번 튀면서 더 잘게 부서진다
                p.bounced = true; p.y = s.top - p.size * 0.5;
                p.vy *= -0.28; p.vx *= 0.55; p.vr *= 0.5; p.size *= 0.72; p.dep *= 0.6;
                for (let k = 0; k < p.pts.length; k++) p.pts[k] *= 0.72;
                s.surf.deposit(p.x, p.dep * 0.5, 5 + p.size * 0.5);
                this.burst(p.x, s.top, 4, 90, 0.9);
              } else {
                s.surf.deposit(p.x, p.dep, 5 + p.size * 0.6);
                this.burst(p.x, s.top, 3, 60, 0.8);
                dead = true;
              }
            } else dead = p.age >= p.life || p.y > world.H + 40;
            break;
          }
          case DEBRIS: {
            if (!p.landed) {
              p.vy += 2000 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
              const s = p.vy > 0 ? world.surfaceBelow(p.x, p.y - 8) : null;
              if (s && p.y >= s.top - p.size * 0.25) {
                if (p.vy > 420 && !p.bounced) { p.bounced = true; p.vy *= -0.3; p.vx *= 0.5; p.vr *= 0.4; p.y = s.top - p.size * 0.25; }
                else { p.landed = p.age; p.y = s.top - p.size * 0.2; this.burst(p.x, s.top, 2, 40, 0.7); }
              }
              dead = p.y > world.H + 60;
            } else dead = p.age - p.landed > 3.2;      // 눈 위에 잠시 남았다가 사라진다
            break;
          }
          case ZZZ:
            p.y -= 20 * dt; p.x = p.x0 + p.age * 9 + Math.sin(p.age * 2.4) * 5; dead = p.age >= p.life; break;
        }
        if (dead) { L[i] = L[L.length - 1]; L.pop(); }
      }
    }

    draw(ctx) {
      const dot = SX.sprites.dot, star = SX.sprites.star;
      for (const p of this.list) {
        switch (p.type) {
          case PUFF: {
            const k = p.age / p.life, s = p.size * (1 + k * 0.9) * 1.7;
            ctx.globalAlpha = Math.pow(1 - k, 1.3) * 0.9;
            ctx.drawImage(dot, p.x - s, p.y - s, s * 2, s * 2);
            break;
          }
          case CRUMB: {
            const t = (p.age - p.delay) / p.dur;
            if (t <= 0) break;
            const s = p.size * (1 - 0.35 * t) * 1.6;
            ctx.globalAlpha = Math.min(1, t * 6);
            ctx.drawImage(dot, p.x - s, p.y - s, s * 2, s * 2);
            break;
          }
          case SPARK: {
            const k = p.age / p.life;
            const s = p.size * (0.5 + 0.5 * Math.sin(Math.min(1, k * 4) * Math.PI / 2)) * (1 - k * 0.5);
            ctx.globalAlpha = (1 - k) * (0.55 + 0.45 * Math.sin(p.age * 20 + p.ph));
            ctx.drawImage(star, p.x - s, p.y - s, s * 2, s * 2);
            break;
          }
          case CLUMP: {
            const s = p.size * 1.5;
            ctx.globalAlpha = 0.95;
            ctx.drawImage(dot, p.x - s, p.y - s, s * 2, s * 2);
            break;
          }
          case CHUNK: {
            const s = p.size, c = Math.cos(p.rot), sn = Math.sin(p.rot), P = p.pts;
            ctx.globalAlpha = 1;
            ctx.beginPath();
            for (let k = 0; k < P.length; k += 2) {
              const x = p.x + P[k] * c - P[k + 1] * sn, y = p.y + P[k] * sn + P[k + 1] * c;
              k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.closePath();
            const g = ctx.createLinearGradient(p.x - s, p.y - s, p.x + s, p.y + s);   // 빛은 항상 좌상단
            g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#e6eef9'); g.addColorStop(1, '#b3c5e2');
            ctx.fillStyle = g; ctx.lineJoin = 'round'; ctx.fill();
            ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(104,132,186,0.7)'; ctx.stroke();
            break;
          }
          case DEBRIS: {
            const s = p.size;
            ctx.save();
            ctx.globalAlpha = p.landed ? 1 - U.smoothstep(2.2, 3.2, p.age - p.landed) : 1;
            ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            if (p.kind === 'hat') {
              ctx.fillStyle = p.color || '#2d6c5b';
              ctx.beginPath(); ctx.moveTo(-0.74 * s, 0); ctx.bezierCurveTo(-0.78 * s, -0.8 * s, -0.1 * s, -1.05 * s, 0.3 * s, -0.95 * s);
              ctx.bezierCurveTo(0.66 * s, -0.86 * s, 0.78 * s, -0.4 * s, 0.74 * s, 0); ctx.closePath(); ctx.fill();
              ctx.fillStyle = '#f0e8d9'; ctx.beginPath(); ctx.roundRect(-0.84 * s, -0.12 * s, 1.68 * s, 0.34 * s, 0.14 * s); ctx.fill();
              ctx.beginPath(); ctx.arc(0.42 * s, -0.98 * s, 0.22 * s, 0, U.TAU); ctx.fill();
            } else if (p.kind === 'scarf') {
              ctx.fillStyle = p.color || '#c8443c'; ctx.beginPath(); ctx.roundRect(-s, -0.2 * s, 2 * s, 0.4 * s, 0.18 * s); ctx.fill();
              ctx.fillStyle = 'rgba(250,240,222,0.9)'; ctx.fillRect(0.55 * s, -0.2 * s, 0.14 * s, 0.4 * s);
            } else if (p.kind === 'carrot') {
              ctx.fillStyle = '#f1862f';
              ctx.beginPath(); ctx.moveTo(-0.5 * s, -0.2 * s); ctx.lineTo(0.6 * s, 0); ctx.lineTo(-0.5 * s, 0.2 * s); ctx.closePath(); ctx.fill();
            } else if (p.kind === 'twig') {
              ctx.strokeStyle = '#4a352b'; ctx.lineWidth = Math.max(1.5, s * 0.09);
              ctx.beginPath(); ctx.moveTo(-0.5 * s, 0); ctx.lineTo(0.5 * s, 0); ctx.moveTo(0.2 * s, 0); ctx.lineTo(0.42 * s, -0.22 * s); ctx.moveTo(0.28 * s, 0); ctx.lineTo(0.5 * s, 0.18 * s); ctx.stroke();
            } else {
              ctx.fillStyle = '#232838'; ctx.beginPath(); ctx.arc(0, 0, s, 0, U.TAU); ctx.fill();
            }
            ctx.restore();
            break;
          }
          case ZZZ: {
            const k = p.age / p.life;
            ctx.globalAlpha = Math.sin(Math.min(1, k * 3) * Math.PI / 2) * (1 - U.smoothstep(0.6, 1, k));
            ctx.font = `${(p.size * (0.8 + 0.6 * k)).toFixed(1)}px "SnowFont", "Malgun Gothic", sans-serif`;
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(86,110,165,0.55)'; ctx.fillStyle = '#ffffff';
            ctx.strokeText('z', p.x, p.y); ctx.fillText('z', p.x, p.y);
            break;
          }
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  SX.Particles = Particles;
})();
