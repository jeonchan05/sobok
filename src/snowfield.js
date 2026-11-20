// snowfield.js — 적설면. 1px 단위 높이맵 + 픽셀 셰이더(ImageData)로 그린 눈 단면.
// 높이맵이 곧 충돌 영역이고, 깎기(carve)·쌓기(deposit)·무너짐(relax)이 모두 여기서 일어난다.
(function () {
  'use strict';
  const SX = window.SX, U = SX.util;

  const TW = 512, TH = 256;
  let BLOTCH = null, GRAIN = null;
  const SKIN = new Float32Array(256), DEEP = new Float32Array(256);
  const HALO = !!window.snowNative;

  function buildTiles() {
    if (BLOTCH) return;
    const rnd = U.rng(77);
    BLOTCH = new Uint8Array(TW * TH);
    GRAIN = new Uint8Array(TW * TH);
    const waves = [];
    for (let k = 0; k < 16; k++) {
      const fx = 1 + ((rnd() * 9) | 0), fy = ((rnd() * 5) | 0) * (rnd() < 0.5 ? -1 : 1);
      waves.push({ fx, fy, ph: rnd() * U.TAU, a: 1 / (1 + (fx + Math.abs(fy)) * 0.3) });
    }
    let mn = 1e9, mx = -1e9;
    const tmp = new Float32Array(TW * TH);
    for (let y = 0; y < TH; y++) {
      for (let x = 0; x < TW; x++) {
        let v = 0;
        for (const w of waves) v += w.a * Math.sin(U.TAU * (w.fx * x / TW + w.fy * y / TH) + w.ph);
        tmp[y * TW + x] = v;
        if (v < mn) mn = v; if (v > mx) mx = v;
      }
    }
    for (let i = 0; i < tmp.length; i++) {
      BLOTCH[i] = ((tmp[i] - mn) / (mx - mn)) * 255;
      GRAIN[i] = (rnd() * 256) | 0;
    }
    for (let d = 0; d < 256; d++) {
      SKIN[d] = Math.exp(-d / 15);
      DEEP[d] = Math.min(1, d / 95);
    }
  }

  class Surface {
    constructor(o) {
      buildTiles();
      this.id = o.id;
      this.kind = o.kind;
      this.isWin = o.kind === 'window';
      this.round = o.round || false;
      this.pad = this.isWin ? 7 : 0;
      this.X0 = Math.round(o.x0) - this.pad;
      this.n = Math.round(o.x1 - o.x0) + this.pad * 2;
      this.X1 = this.X0 + this.n;
      this.baseY = Math.round(o.y);
      this.maxH = Math.round(o.maxH);
      this.minH = 0;                             // 굴리거나 제설하면 바닥까지 완전히 사라진다
      this.top = this.maxH + 10;                 // 캔버스 안에서 baseY 가 놓이는 행
      this.cw = this.n;
      this.ch = this.top + (this.isWin ? 14 : 4);
      this.Y0 = this.baseY - this.top;
      this.h = new Float32Array(this.n);
      this.packed = new Float32Array(this.n);     // 다져진 정도 (굴린 자국)
      this.env = new Float32Array(this.n);        // 창 모서리에서 둥글게 떨어지는 최대 높이
      this.droop = new Float32Array(this.n);      // 창틀 아래로 흘러내린 눈의 깊이
      this.target = new Float32Array(this.n);     // 시간이 지나면 도달하는 적설 형태
      this.scratch = new Float32Array(512);
      this.canvas = U.canvas(this.cw, this.ch);
      this.ctx = this.canvas.getContext('2d');
      this.img = this.ctx.createImageData(this.cw, this.ch);
      this.img32 = new Uint32Array(this.img.data.buffer);
      this.da = Infinity; this.db = -1;           // 즉시 다시 그릴 범위
      this.lazy = false; this.lazyT = 0;          // 눈 쌓임처럼 느린 변화는 모아서 그린다
      this.aa = Infinity; this.ab = -1; this.aT = 0; // 무너짐(relax)을 돌릴 활성 범위
      this.seed = o.seed || 1;
      this.depth0 = o.depth0 || 60;               // 바닥 눈의 초기 깊이
      this.scale = o.scale || 1;                  // 다 쌓였을 때의 높이 배율
      this.fill = o.fill === undefined ? 1 : o.fill; // 처음에 쌓여 있는 양 (새로 열린 창은 얇게 시작)
      this.vis = o.vs || null;                    // 다른 창에 가리지 않고 보이는 구간들 [[a, b], ...]. null 이면 전부 보인다
      this.init();
    }

    init() {
      const n = this.n, s = this.seed;
      for (let i = 0; i < n; i++) {
        const x = this.X0 + i;
        if (this.isWin) {
          const d = Math.min(i, n - 1 - i);
          const q1 = Math.min(d / 22, 1), q2 = Math.min(d / 34, 1);
          const shoulder = Math.sqrt(1 - (1 - q1) * (1 - q1));
          this.env[i] = this.maxH * Math.sqrt(1 - (1 - q2) * (1 - q2));
          const base = (12 + 13 * U.fbm1(x / 85, s, 3) + 5 * U.fbm1(x / 24, s + 5, 2)) * this.scale;
          this.target[i] = Math.min(base * shoulder, this.env[i]);
          this.h[i] = this.target[i] * this.fill;
          this.droop[i] = 2.5 + 7 * U.fbm1(x / 19, s + 9, 3);
        } else {
          const D = this.depth0;
          this.env[i] = this.maxH;
          this.target[i] = D * (0.74 + 0.55 * U.fbm1(x / 290, s, 3)) + (9 * U.fbm1(x / 62, s + 3, 2) + 2.5 * U.fbm1(x / 16, s + 7, 2)) * this.scale;
          if (this.round) {                      // 양 끝이 뚝 잘리지 않고 둥글게 내려앉는다 (Dock 위처럼 폭이 짧은 바닥)
            const dd = this.round === 'r' ? n - 1 - i : this.round === 'l' ? i : Math.min(i, n - 1 - i);   // 'l'/'r': 그쪽 끝만 둥글게
            const q = Math.min(dd / 34, 1), sh = Math.sqrt(1 - (1 - q) * (1 - q));
            this.env[i] = this.maxH * sh;
            this.target[i] = Math.min(this.target[i] * sh, this.env[i]);
          }
          this.h[i] = this.target[i] * this.fill;
          this.droop[i] = 0;
        }
      }
      this.render(0, n - 1);
    }

    // 실제 창이 움직이면 눈도 함께 따라간다. 크게 움직이면 눈이 조금 털려 떨어진다.
    moveTo(x0, y, world) {
      const nx = Math.round(x0) - this.pad, ny = Math.round(y);
      const dx = nx - this.X0, dy = ny - this.baseY;
      if (!dx && !dy) return;
      this.X0 = nx; this.X1 = nx + this.n; this.baseY = ny; this.Y0 = ny - this.top;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist > 18 && world) {
        const k = Math.max(0.9, 1 - dist * 0.0007);
        for (let i = 0; i < this.n; i++) this.h[i] *= k;
        const m = Math.min(7, 1 + ((dist / 30) | 0));
        for (let j = 0; j < m; j++) {
          const i = (Math.random() * this.n) | 0;
          if (this.h[i] > 4) world.particles.clump(this.X0 + i, this.baseY - this.h[i] * 0.5, -dx * 2 + U.rand(-20, 20), U.rand(-40, 20), U.rand(1.6, 3.4));
        }
        this.mark(0, this.n - 1);
      }
    }
    // 창이 닫히거나 가려질 때: 쌓였던 눈이 쏟아져 내린다
    shed(world) {
      for (let i = 4; i < this.n - 4; i += 9) {
        if (this.h[i] > 3 && this.visible(this.X0 + i))
          world.particles.clump(this.X0 + i + U.rand(-3, 3), this.baseY - this.h[i] * U.rand(0.2, 0.9), U.rand(-25, 25), U.rand(-30, 30), U.rand(1.8, 3.8));
      }
    }
    visible(x) {
      const v = this.vis;
      if (!v) return true;
      for (let k = 0; k < v.length; k++) if (x >= v[k][0] && x <= v[k][1]) return true;
      return false;
    }
    // 위치나 크기가 바뀌어 새로 만들어질 때, 이전 면에 쌓여 있던 눈을 그대로 이어받는다
    adopt(old) {
      for (let i = 0; i < this.n; i++) {
        const j = Math.round((i / Math.max(1, this.n - 1)) * (old.n - 1));
        this.h[i] = Math.min(old.h[j], this.env[i]);
        this.packed[i] = old.packed[j];
      }
      this.growHold = old.growHold || 0;
      this.render(0, this.n - 1);
    }
    mean() { let a = 0; for (let i = 0; i < this.n; i++) a += this.h[i]; return a / this.n; }
    // 제설차 삽날이 지나간 구간: 눈을 남김없이 걷어낸다. 반환값은 걷어낸 단면적
    plowRange(xa, xb) {
      const a = Math.max(0, Math.floor(xa - this.X0)), b = Math.min(this.n - 1, Math.ceil(xb - this.X0));
      if (b < a) return 0;
      let removed = 0;
      for (let i = a; i <= b; i++) {
        const res = 0;
        if (this.h[i] > res) { removed += this.h[i] - res; this.h[i] = res; }
        this.packed[i] = 0.6;
      }
      if (removed > 0) { this.mark(a, b); this.activate(a - 30, b + 30); }
      this.growHold = 8;                         // 제설 직후 잠깐은 깨끗한 상태로 둔다
      return removed;
    }

    // ---- 조회 ----
    heightAt(x) {
      const f = x - this.X0;
      if (f <= 0 || f >= this.n - 1) return this.isWin ? 0 : this.h[f <= 0 ? 0 : this.n - 1];
      const i = f | 0, t = f - i;
      return this.h[i] + (this.h[i + 1] - this.h[i]) * t;
    }
    topY(x) { return this.baseY - this.heightAt(x); }
    avgTop(x, hw) {
      const a = Math.round(x - hw - this.X0), b = Math.round(x + hw - this.X0);
      let s = 0, c = 0;
      for (let i = a; i <= b; i++) {
        if (i >= 0 && i < this.n) s += this.h[i];
        else if (!this.isWin) s += this.h[i < 0 ? 0 : this.n - 1];
        c++;
      }
      return this.baseY - (c ? s / c : 0);
    }
    packedAt(x, hw) {
      const a = Math.max(0, Math.round(x - hw - this.X0)), b = Math.min(this.n - 1, Math.round(x + hw - this.X0));
      let s = 0, c = 0;
      for (let i = a; i <= b; i++) { s += this.packed[i]; c++; }
      return c ? s / c : 0;
    }

    // ---- 변경 ----
    mark(a, b) { if (a < this.da) this.da = a; if (b > this.db) this.db = b; }
    activate(a, b) { if (a < this.aa) this.aa = a; if (b > this.ab) this.ab = b; this.aT = 1.6; }

    deposit(x, amount, sigma) {
      const c = x - this.X0, r = Math.ceil(sigma * 2.6);
      const a = Math.max(0, Math.floor(c - r)), b = Math.min(this.n - 1, Math.ceil(c + r));
      const k = 1 / (2 * sigma * sigma);
      for (let i = a; i <= b; i++) {
        const d = i - c;
        const nh = this.h[i] + amount * Math.exp(-d * d * k);
        this.h[i] = nh > this.env[i] ? Math.max(this.h[i], this.env[i]) : nh;
        this.packed[i] *= 0.96;
      }
      this.lazy = true;
    }

    dimple(x, depth, sigma) {
      const c = x - this.X0, r = Math.ceil(sigma * 2.6);
      const a = Math.max(0, Math.floor(c - r)), b = Math.min(this.n - 1, Math.ceil(c + r));
      const k = 1 / (2 * sigma * sigma);
      let removed = 0;
      for (let i = a; i <= b; i++) {
        const d = i - c;
        const rem = Math.min(depth * Math.exp(-d * d * k), this.h[i] - this.minH);
        if (rem > 0) { this.h[i] -= rem; removed += rem; }
      }
      this.mark(a, b); this.activate(a - 12, b + 12);
      return removed;
    }

    // 눈덩이(원)가 파고든 만큼 눈을 걷어낸다. cap = 이번 프레임에 걷어낼 수 있는 최대 단면적.
    carveCircle(cx, cy, r, cap) {
      const rr = r * 0.985;
      let a = Math.ceil(cx - rr - this.X0), b = Math.floor(cx + rr - this.X0);
      if (a < 0) a = 0; if (b > this.n - 1) b = this.n - 1;
      if (b < a) return 0;
      if (b - a + 1 > this.scratch.length) this.scratch = new Float32Array(b - a + 64);
      const sc = this.scratch;
      let total = 0;
      for (let i = a; i <= b; i++) {
        const dx = this.X0 + i - cx;
        const arcY = cy + Math.sqrt(rr * rr - dx * dx);
        const pen = arcY - (this.baseY - this.h[i]);
        let rem = 0;
        if (pen > 0) { rem = Math.min(pen, this.h[i] - this.minH); if (rem < 0) rem = 0; }
        sc[i - a] = rem; total += rem;
      }
      if (total <= 0.001) return 0;
      const f = Math.min(1, cap / total);
      for (let i = a; i <= b; i++) {
        const rem = sc[i - a];
        if (rem > 0) {
          this.h[i] -= rem * f;
          this.packed[i] = Math.min(1, this.packed[i] + 0.35 * f + 0.02);
        }
      }
      this.mark(a, b); this.activate(a - 24, b + 24);
      return total * f;
    }

    // 안식각을 넘는 경사는 무너져 내리고, 날카로운 모서리는 살짝 뭉개진다
    relax(a, b) {
      a = Math.max(1, a); b = Math.min(this.n - 2, b);
      if (b <= a) return;
      const h = this.h, S = 1.25;
      let ca = Infinity, cb = -1;
      for (let pass = 0; pass < 3; pass++) {
        const fwd = pass % 2 === 0;
        for (let k = 0; k <= b - a; k++) {
          const i = fwd ? a + k : b - k;
          const d = h[i + 1] - h[i];
          const ad = d < 0 ? -d : d;
          if (ad > S) {
            const ex = (ad - S) * 0.3 * (d < 0 ? -1 : 1);
            h[i] += ex; h[i + 1] -= ex;
            if (i < ca) ca = i; if (i + 1 > cb) cb = i + 1;
          }
          const lap = h[i - 1] + h[i + 1] - 2 * h[i];
          if (lap > 0.35 || lap < -0.35) {
            h[i] += lap * 0.12;
            if (i < ca) ca = i; if (i > cb) cb = i;
          }
        }
      }
      if (cb >= 0) {
        for (let i = ca; i <= cb; i++) { if (h[i] > this.env[i]) h[i] = this.env[i]; if (h[i] < 0) h[i] = 0; }
        this.mark(ca, cb);
      }
    }

    tick(dt, rate) {
      // 눈이 차차 쌓인다: 얕을수록 빨리, 목표 형태에 가까워지면 아주 천천히.
      // 굴려서 깎인 자국도 같은 방식으로 서서히 다시 메워진다.
      if (this.growHold > 0) { this.growHold -= dt; this._gr = 0; }
      this._gr = (this._gr || 0) + dt;
      if (this._gr > 0.12 && !(this.growHold > 0)) {
        const t = this._gr * (rate || 1);
        this._gr = 0;
        const k = 1 - Math.exp(-t / 70), tr = 0.014 * t;      // 바닥과 창 위가 같은 속도로 쌓인다
        // 바닥은 절반쯤 쌓인 뒤부터 아주 천천히 는다. 제설차가 너무 자주 와서 눈이 쌓일 틈이 없던 문제를 막는다
        const k2 = this.isWin ? k : 1 - Math.exp(-t / 420);
        const h = this.h, tg = this.target, env = this.env, mh = this.maxH;
        for (let i = 0; i < this.n; i++) {
          const d = tg[i] - h[i];
          // 목표 형태를 조금 넘으면 더 쌓이지 않는다 (무한정 쌓이지 않게)
          let nh = h[i] + (d > 0 ? d * (h[i] > tg[i] * 0.5 ? k2 : k) : 0) + (h[i] < tg[i] * 1.25 ? tr * (env[i] / mh) : 0);
          if (nh > env[i]) nh = Math.max(h[i], env[i]);
          h[i] = nh;
        }
        this.lazy = true;
      }
      if (this.aT > 0) {
        this.aT -= dt;
        this.relax(this.aa, this.ab);
        if (this.aT <= 0) { this.aa = Infinity; this.ab = -1; }
      }
      // 다져진 자국은 서서히 풀린다
      this._pk = (this._pk || 0) + dt;
      if (this._pk > 0.25) {
        const k = Math.exp(-this._pk / 14);
        this._pk = 0;
        const p = this.packed;
        for (let i = 0; i < this.n; i++) p[i] *= k;
      }
      if (this.lazy) {
        this.lazyT += dt;
        if (this.lazyT > 0.45) { this.lazyT = 0; this.lazy = false; this.relax(0, this.n - 1); this.mark(0, this.n - 1); }
      }
    }

    flush() {
      if (this.db >= this.da) { this.render(this.da, this.db); this.da = Infinity; this.db = -1; }
    }

    // ---- 픽셀 셰이더 ----
    render(a, b) {
      a = Math.max(0, a - 9); b = Math.min(this.n - 1, b + 9);
      const n = this.n, h = this.h, cw = this.cw, ch = this.ch, base = this.top, out = this.img32;
      const isWin = this.isWin, droop = this.droop, X0 = this.X0, Y0 = this.Y0;
      for (let i = a; i <= b; i++) {
        const hi = h[i];
        const top = base - hi;
        const il = i >= 3 ? i - 3 : 0, ir = i + 3 < n ? i + 3 : n - 1;
        const slope = (h[ir] - h[il]) / (ir - il || 1);         // + : 오른쪽으로 올라감 → 좌상단 빛을 받음
        const jl = i >= 8 ? i - 8 : 0, jr = i + 8 < n ? i + 8 : n - 1;
        const valley = (h[jl] + h[jr]) * 0.5 - hi;
        let lit = 0.8 + slope * 0.75 - (valley > 0 ? valley * 0.045 : 0);
        if (lit > 1) lit = 1; else if (lit < 0) lit = 0;
        const sr = 164 + 91 * lit, sg = 190 + 65 * lit, sb = 230 + 25 * lit;
        const bot = isWin ? base + Math.min(hi * 0.55, droop[i]) : base + Math.min(4.5, hi);
        const wx = (X0 + i) & 511;
        let y0 = Math.floor(top - 0.5); if (y0 < 0) y0 = 0;
        let y1 = Math.ceil(bot + 0.5); if (y1 > ch) y1 = ch;
        let p = i;
        // 위젯 모드: 밝은 창 위에서도 눈 윤곽이 보이도록 윗면 바깥에 옅은 푸른 테두리를 둔다
        const hy = HALO && hi > 0.6 ? (y0 - 4 > 0 ? y0 - 4 : 0) : y0;
        for (let y = 0; y < hy; y++, p += cw) out[p] = 0;
        for (let y = hy; y < y0; y++, p += cw) {
          const q = 1 - (top - 0.5 - y) / 4.5;
          out[p] = q > 0 ? (((q * q * 105) | 0) << 24) | (196 << 16) | (150 << 8) | 118 : 0;
        }
        if (hi < 0.05) { for (let y = y0; y < ch; y++, p += cw) out[p] = 0; continue; }
        for (let y = y0; y < y1; y++, p += cw) {
          const d = y + 0.5 - top;
          let al = d + 0.5; if (al > 1) al = 1;
          const db = bot - (y + 0.5);
          if (db < 0.5) al *= db + 0.5;
          if (al <= 0) { out[p] = 0; continue; }
          const di = d < 0 ? 0 : d > 255 ? 255 : d | 0;
          const t = SKIN[di] * 0.92, dp = DEEP[di];
          let r = 238 - 34 * dp, g = 244 - 25 * dp, bl = 252 - 11 * dp;
          r += (sr - r) * t; g += (sg - g) * t; bl += (sb - bl) * t;
          if (d < 2.6) { const q = (1 - d / 2.6) * (0.35 + 0.55 * lit); r += (255 - r) * q; g += (255 - g) * q; bl += (255 - bl) * q; }
          const ti = (((Y0 + y) & 255) << 9) + wx;
          const gn = GRAIN[ti];
          const m = (BLOTCH[ti] - 128) * 0.085 + (gn - 128) * (0.028 + 0.06 * t);
          r += m; g += m * 0.92; bl += m * 0.62;
          if (gn === 255 && d > 1 && d < 14) { r = 255; g = 255; bl = 255; }
          if (isWin && db < 6) { const q = (1 - db / 6) * 0.5; r += (146 - r) * q; g += (168 - g) * q; bl += (208 - bl) * q; }
          if (r > 255) r = 255; if (g > 255) g = 255; if (bl > 255) bl = 255;
          out[p] = (((al * 255) | 0) << 24) | ((bl | 0) << 16) | ((g | 0) << 8) | (r | 0);
        }
        for (let y = y1; y < ch; y++, p += cw) out[p] = 0;
      }
      this.ctx.putImageData(this.img, 0, 0, a, 0, b - a + 1, ch);
    }

    draw(ctx) {
      if (!this.vis) { ctx.drawImage(this.canvas, this.X0, this.Y0); return; }
      ctx.save();
      ctx.beginPath();
      for (const g of this.vis) ctx.rect(g[0], this.Y0, g[1] - g[0], this.ch);
      ctx.clip();
      ctx.drawImage(this.canvas, this.X0, this.Y0);
      ctx.restore();
    }
  }

  SX.Surface = Surface;
})();
