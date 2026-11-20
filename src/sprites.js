// sprites.js — 한 번만 그려 두고 재사용하는 절차적 스프라이트
(function () {
  'use strict';
  const SX = window.SX, U = SX.util;
  const S = (SX.sprites = {});

  function radial(g, x, y, r0, r1, stops) {
    const gr = g.createRadialGradient(x, y, r0, x, y, r1);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    return gr;
  }

  function softDot() {
    const c = U.canvas(32, 32), g = c.getContext('2d');
    g.fillStyle = radial(g, 16, 16, 0, 16, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.75)'], [0.7, 'rgba(255,255,255,0.2)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(0, 0, 32, 32);
    return c;
  }

  function blurDot() {
    const c = U.canvas(64, 64), g = c.getContext('2d');
    g.fillStyle = radial(g, 32, 32, 0, 32, [[0, 'rgba(255,255,255,0.55)'], [0.5, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  function star() {
    const c = U.canvas(48, 48), g = c.getContext('2d');
    g.translate(24, 24);
    g.fillStyle = radial(g, 0, 0, 0, 14, [[0, 'rgba(255,255,255,0.9)'], [0.4, 'rgba(235,244,255,0.25)'], [1, 'rgba(235,244,255,0)']]);
    g.fillRect(-24, -24, 48, 48);
    g.fillStyle = '#fff';
    for (let i = 0; i < 2; i++) {
      g.beginPath();
      g.moveTo(0, -22); g.quadraticCurveTo(1.6, -1.6, 22, 0); g.quadraticCurveTo(1.6, 1.6, 0, 22);
      g.quadraticCurveTo(-1.6, 1.6, -22, 0); g.quadraticCurveTo(-1.6, -1.6, 0, -22);
      g.fill();
      g.rotate(Math.PI / 4); g.scale(0.45, 0.45);
    }
    return c;
  }

  function crystal() {
    const c = U.canvas(48, 48), g = c.getContext('2d');
    g.translate(24, 24);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineCap = 'round'; g.lineWidth = 2.2;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(0, -19);
      g.moveTo(0, -11); g.lineTo(-5, -16);
      g.moveTo(0, -11); g.lineTo(5, -16);
      g.moveTo(0, -5.5); g.lineTo(-3.4, -9);
      g.moveTo(0, -5.5); g.lineTo(3.4, -9);
      g.stroke();
      g.rotate(Math.PI / 3);
    }
    return c;
  }

  // 눈덩이 표면의 덩어리(볼록) / 패임(오목). 빛은 항상 좌상단 → 스프라이트는 회전시키지 않고 위치만 회전시킨다.
  function lump(seed, dent) {
    const rnd = U.rng(seed);
    const c = U.canvas(48, 48), g = c.getContext('2d');
    const blobs = [];
    const n = 2 + ((rnd() * 3) | 0);
    for (let i = 0; i < n; i++) blobs.push({ x: 24 + (rnd() - 0.5) * 11, y: 24 + (rnd() - 0.5) * 11, r: 8 + rnd() * 6 });
    const dark = dent ? [-2.2, -2.2] : [3.0, 3.2];
    const lite = dent ? [2.4, 2.6] : [-2.0, -2.2];
    for (const b of blobs) {
      g.fillStyle = radial(g, b.x + dark[0], b.y + dark[1], 0, b.r * 1.15, [[0, dent ? 'rgba(118,142,190,0.30)' : 'rgba(112,138,190,0.26)'], [0.55, 'rgba(120,146,196,0.11)'], [1, 'rgba(120,146,196,0)']]);
      g.fillRect(0, 0, 48, 48);
    }
    for (const b of blobs) {
      g.fillStyle = radial(g, b.x + lite[0], b.y + lite[1], 0, b.r, [[0, dent ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.92)'], [0.5, dent ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
      g.fillRect(0, 0, 48, 48);
    }
    return c;
  }

  function grain() {
    const rnd = U.rng(4242);
    const c = U.canvas(128, 128), g = c.getContext('2d');
    for (let i = 0; i < 1500; i++) {
      const x = rnd() * 128, y = rnd() * 128, s = 0.5 + rnd() * 1.1;
      if (rnd() < 0.55) g.fillStyle = `rgba(255,255,255,${(0.12 + rnd() * 0.45).toFixed(3)})`;
      else g.fillStyle = `rgba(132,156,202,${(0.06 + rnd() * 0.22).toFixed(3)})`;
      g.fillRect(x, y, s, s);
    }
    return c;
  }

  S.build = function () {
    S.dot = softDot();
    S.blur = blurDot();
    S.star = star();
    S.crystal = crystal();
    S.bumps = [lump(11, false), lump(23, false), lump(37, false), lump(51, false)];
    S.dents = [lump(71, true), lump(89, true)];
    S.grain = grain();
    S._pattern = null;
  };

  S.grainPattern = function (ctx) {
    if (!S._pattern) S._pattern = ctx.createPattern(S.grain, 'repeat');
    return S._pattern;
  };
})();
