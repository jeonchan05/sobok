// util.js — 수학/노이즈/스프링 유틸
(function () {
  'use strict';
  const SX = (window.SX = window.SX || {});
  const U = (SX.util = {});

  U.TAU = Math.PI * 2;
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smoothstep = (a, b, x) => {
    const t = U.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  U.rand = (a, b) => a + Math.random() * (b - a);
  U.sign = v => (v < 0 ? -1 : 1);

  // 시드 고정 난수 (mulberry32)
  U.rng = seed => {
    let s = (seed >>> 0) || 1;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  U.hash = n => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };
  U.noise1 = (x, seed) => {
    const i = Math.floor(x), f = x - i;
    const u = f * f * (3 - 2 * f);
    const o = (seed || 0) * 57.31;
    return U.lerp(U.hash(i + o), U.hash(i + 1 + o), u);
  };
  U.fbm1 = (x, seed, oct) => {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < (oct || 4); i++) {
      s += a * U.noise1(x * f, (seed || 0) + i * 17);
      n += a; a *= 0.5; f *= 2.03;
    }
    return s / n;
  };

  U.easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  U.easeInCubic = t => t * t * t;
  U.easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  U.easeOutBack = t => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };

  // 프레임레이트와 무관한 지수 보간 계수
  U.expo = (dt, tau) => 1 - Math.exp(-dt / tau);

  // 임계감쇠 스프링 (오버슈트 없음, 어떤 dt 에서도 안정). state = {x, v}
  U.damp = (state, target, smoothTime, dt) => {
    const omega = 2 / Math.max(0.0001, smoothTime);
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = state.x - target;
    const temp = (state.v + omega * change) * dt;
    state.v = (state.v - omega * temp) * exp;
    state.x = target + (change + temp) * exp;
  };

  // 탄성 스프링 (오버슈트 있음). 작은 서브스텝으로 적분
  U.spring = (state, target, k, c, dt) => {
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      state.v += (-k * (state.x - target) - c * state.v) * h;
      state.x += state.v * h;
    }
  };

  U.canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };
})();
