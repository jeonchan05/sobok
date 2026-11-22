// snowfall.js — 3개 깊이 층의 눈송이 + 바람. 가운데 층의 눈송이만 실제로 쌓인다.
(function () {
  'use strict';
  const SX = window.SX, U = SX.util;

  class Snowfall {
    constructor() {
      this.flakes = [];
      this.t = 0;
      this.gustT = 6; this.gustAmp = 0; this.gustAge = 99; this.gustDur = 4;
      this.wind = 0;
      this.density = 1;
    }

    resize(W, H) {
      this.W = W; this.H = H;
      const k = U.clamp((W * H) / (1920 * 1000), 0.35, 1.5) * this.density;
      // 최대(펑펑) 기준으로 만들어 두고 active 개수만 조절한다
      this.counts = [Math.round(150 * k), Math.round(105 * k), Math.round(13 * k)];
      this.flakes = [];
      for (let L = 0; L < 3; L++) {
        for (let i = 0; i < this.counts[L] * 2.2; i++) {
          const f = { L, idx: i, on: false };
          this.spawn(f, true);
          this.flakes.push(f);
        }
      }
    }

    spawn(f, anywhere) {
      const W = this.W, H = this.H, L = f.L;
      f.x = U.rand(-W * 0.15, W * 1.15);
      f.y = anywhere ? U.rand(-20, H) : U.rand(-60, -8);
      f.ph = U.rand(0, U.TAU);
      f.rot = U.rand(0, U.TAU);
      f.crystal = false;
      if (L === 0) { f.size = U.rand(0.7, 1.5); f.alpha = U.rand(0.35, 0.75); f.vy = U.rand(16, 32); f.wf = 0.35; f.amp = U.rand(3, 9); f.freq = U.rand(0.5, 1.2); }
      else if (L === 1) {
        f.size = U.rand(1.5, 3.2); f.alpha = U.rand(0.7, 1); f.vy = U.rand(36, 70); f.wf = 0.72; f.amp = U.rand(6, 18); f.freq = U.rand(0.6, 1.6);
        if (Math.random() < 0.13) { f.crystal = true; f.size = U.rand(4, 6.5); f.vy *= 0.8; f.vr = U.rand(-0.9, 0.9); f.amp *= 1.4; }
      } else { f.size = U.rand(7, 15); f.alpha = U.rand(0.22, 0.48); f.vy = U.rand(95, 150); f.wf = 1.3; f.amp = U.rand(10, 26); f.freq = U.rand(0.4, 0.9); }
      f.py = f.y;
    }

    update(dt, world) {
      this.t += dt;
      const t = this.t;
      // 바람: 느린 사인 합 + 가끔 부는 돌풍
      this.gustT -= dt; this.gustAge += dt;
      if (this.gustT <= 0) { this.gustT = U.rand(11, 26); this.gustAmp = U.rand(40, 95) * (Math.random() < 0.5 ? -1 : 1); this.gustAge = 0; this.gustDur = U.rand(3.5, 6); }
      const ge = this.gustAge < this.gustDur ? Math.sin((this.gustAge / this.gustDur) * Math.PI) : 0;
      this.wind = 16 * Math.sin(t * 0.13) + 11 * Math.sin(t * 0.31 + 1.7) + this.gustAmp * ge * ge;
      world.wind = this.wind;

      const rate = world.snowRate, W = this.W, H = this.H;
      const surfaces = world.surfaces;
      for (const f of this.flakes) {
        const active = f.idx < this.counts[f.L] * rate;
        if (!f.on) { if (active) { f.on = true; this.spawn(f, world.time < 0.5); } else continue; }
        f.py = f.y;
        const wv = this.wind + 7 * Math.sin(f.y * 0.004 + t * 0.5);
        f.x += (wv * f.wf + Math.cos(t * f.freq + f.ph) * f.amp) * dt;
        f.y += (f.vy + Math.sin(t * f.freq * 1.7 + f.ph) * f.vy * 0.18) * dt;
        if (f.crystal) f.rot += f.vr * dt;
        let dead = f.y > H + 20 || f.x < -W * 0.2 || f.x > W * 1.2;
        if (!dead && f.L === 1) {
          // 눈이 쌓이는 면에 닿았는지
          for (let k = 0; k < surfaces.length; k++) {
            const s = surfaces[k];
            if (f.x < s.X0 || f.x > s.X1 || !s.visible(f.x) || s.growHold > 0) continue;
            const top = s.topY(f.x);
            if (f.y >= top + 1 && (!s.isWin || f.py < top + 3)) {
              const amt = (f.crystal ? 1.5 : 1.0) * (0.7 + f.size * 0.16);
              s.deposit(f.x, amt, 5.5);
              // 창이 눈송이를 받아 내도 그 아래 바닥은 똑같이 쌓이게 한다.
              // (그러지 않으면 창이 많이 떠 있는 모니터의 바닥 눈만 눈에 띄게 낮아진다)
              // (창에 닿은 눈송이는 더 일찍 사라져 더 자주 다시 내리므로, 떨어진 거리의 비율만큼 줄여서 더한다)
              if (s.isWin) { const g = world.groundAt(f.x); if (g && !(g.growHold > 0)) g.deposit(f.x, amt * (top + 20) / (g.topY(f.x) + 20), 5.5); }
              dead = true; break;
            }
          }
        }
        if (dead) { if (active) this.spawn(f, false); else f.on = false; }
      }
    }

    draw(ctx, L) {
      const dot = L === 2 ? SX.sprites.blur : SX.sprites.dot;
      for (const f of this.flakes) {
        if (f.L !== L || !f.on) continue;
        const s = f.crystal || L === 2 ? f.size : f.size * 1.7;
        const margin = f.crystal ? s * Math.SQRT2 : s;
        if (f.x + margin < 0 || f.x - margin > this.W || f.y + margin < 0 || f.y - margin > this.H) continue;
        ctx.globalAlpha = f.alpha;
        if (f.crystal) {
          ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot);
          ctx.scale(1, 0.72 + 0.28 * Math.cos(f.rot * 1.7 + f.ph));  // 살짝 뒤집히며 떨어지는 느낌
          ctx.drawImage(SX.sprites.crystal, -s, -s, s * 2, s * 2);
          ctx.restore();
        } else {
          ctx.drawImage(dot, f.x - s, f.y - s, s * 2, s * 2);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  SX.Snowfall = Snowfall;
})();
