// wallpaper.js — 겨울 해질녘 바탕화면을 한 번 그려 캐시한다
(function () {
  'use strict';
  const SX = window.SX, U = SX.util;

  function hillY(x, W, base, amp, scale, seed) {
    return base - amp * (U.fbm1(x / scale, seed, 4) - 0.5) * 2;
  }

  function pine(g, x, y, h, body, snow) {
    const w = h * 0.36;
    g.fillStyle = body;
    g.fillRect(x - h * 0.03, y - h * 0.14, h * 0.06, h * 0.16);
    const tiers = [[0.08, 0.60, 1.0], [0.33, 0.82, 0.76], [0.58, 1.0, 0.52]];
    for (const [b, t, k] of tiers) {
      g.fillStyle = body;
      g.beginPath();
      g.moveTo(x - w * k, y - h * b);
      g.quadraticCurveTo(x, y - h * b + h * 0.05, x + w * k, y - h * b);
      g.lineTo(x, y - h * t);
      g.closePath(); g.fill();
      // 좌상단에 얹힌 눈
      g.fillStyle = snow;
      g.beginPath();
      g.moveTo(x - w * k * 0.82, y - h * (b + (t - b) * 0.16));
      g.quadraticCurveTo(x - w * k * 0.2, y - h * (b + (t - b) * 0.42), x + w * k * 0.28, y - h * (b + (t - b) * 0.52));
      g.lineTo(x, y - h * t);
      g.closePath(); g.fill();
    }
  }

  function cabin(g, x, y, s) {
    const w = s, h = s * 0.62;
    // 따뜻한 빛 번짐
    g.save();
    g.globalCompositeOperation = 'lighter';
    let gr = g.createRadialGradient(x, y - h * 0.3, 0, x, y - h * 0.3, s * 2.6);
    gr.addColorStop(0, 'rgba(255,196,120,0.34)'); gr.addColorStop(0.4, 'rgba(255,186,120,0.12)'); gr.addColorStop(1, 'rgba(255,186,120,0)');
    g.fillStyle = gr; g.fillRect(x - s * 3, y - s * 3, s * 6, s * 6);
    g.restore();
    // 굴뚝 + 연기
    g.fillStyle = '#55648a';
    g.fillRect(x + w * 0.2, y - h - s * 0.48, s * 0.13, s * 0.3);
    g.fillStyle = '#eef4fc';
    g.fillRect(x + w * 0.185, y - h - s * 0.52, s * 0.16, s * 0.06);
    for (let i = 0; i < 6; i++) {
      const k = i / 5;
      g.globalAlpha = 0.26 * (1 - k * 0.8);
      g.drawImage(SX.sprites.blur, x + w * 0.2 + k * s * 0.5 - s * (0.14 + k * 0.2), y - h - s * (0.62 + k * 0.75) - s * (0.14 + k * 0.2), s * (0.34 + k * 0.4), s * (0.34 + k * 0.4));
    }
    g.globalAlpha = 1;
    // 몸체
    gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    gr.addColorStop(0, '#62749c'); gr.addColorStop(1, '#4a5980');
    g.fillStyle = gr;
    g.fillRect(x - w / 2, y - h, w, h + 2);
    // 지붕 (눈 덮인)
    g.fillStyle = '#44527a';
    g.beginPath(); g.moveTo(x - w * 0.62, y - h + 2); g.lineTo(x, y - h - s * 0.44); g.lineTo(x + w * 0.62, y - h + 2); g.closePath(); g.fill();
    gr = g.createLinearGradient(0, y - h - s * 0.5, 0, y - h);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#d5e2f4');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x - w * 0.68, y - h - s * 0.01);
    g.quadraticCurveTo(x - w * 0.36, y - h - s * 0.3, x, y - h - s * 0.52);
    g.quadraticCurveTo(x + w * 0.36, y - h - s * 0.3, x + w * 0.68, y - h - s * 0.01);
    g.quadraticCurveTo(x + w * 0.62, y - h + s * 0.06, x + w * 0.52, y - h - s * 0.02);
    g.quadraticCurveTo(x + w * 0.2, y - h - s * 0.24, x, y - h - s * 0.36);
    g.quadraticCurveTo(x - w * 0.2, y - h - s * 0.24, x - w * 0.52, y - h - s * 0.02);
    g.quadraticCurveTo(x - w * 0.62, y - h + s * 0.06, x - w * 0.68, y - h - s * 0.01);
    g.fill();
    // 창문과 문
    const win = (wx) => {
      g.fillStyle = '#ffd990';
      g.fillRect(wx, y - h * 0.72, s * 0.17, s * 0.2);
      g.fillStyle = 'rgba(190,120,60,0.55)';
      g.fillRect(wx + s * 0.08, y - h * 0.72, s * 0.012, s * 0.2);
      g.fillRect(wx, y - h * 0.72 + s * 0.095, s * 0.17, s * 0.012);
    };
    win(x - w * 0.36); win(x + w * 0.16);
    g.fillStyle = '#3b4768';
    g.fillRect(x - s * 0.07, y - h * 0.62, s * 0.14, h * 0.62 + 2);
    // 처마 아래 눈
    g.fillStyle = 'rgba(240,246,255,0.9)';
    g.beginPath(); g.ellipse(x, y + 2, w * 0.72, s * 0.07, 0, 0, U.TAU); g.fill();
  }

  SX.paintWallpaper = function (W, H, dpr) {
    const c = U.canvas(W * dpr, H * dpr), g = c.getContext('2d');
    g.scale(dpr, dpr);
    const rnd = U.rng(20241224);

    // 하늘
    let gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#6787bf'); gr.addColorStop(0.3, '#8ba7d6'); gr.addColorStop(0.55, '#b9cbe8');
    gr.addColorStop(0.7, '#e2dfea'); gr.addColorStop(0.8, '#f5dccd'); gr.addColorStop(1, '#eed8cf');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);

    // 낮은 겨울 해
    const sx = W * 0.72, sy = H * 0.6;
    gr = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.62);
    gr.addColorStop(0, 'rgba(255,236,208,0.85)'); gr.addColorStop(0.18, 'rgba(255,226,196,0.45)');
    gr.addColorStop(0.5, 'rgba(255,214,190,0.14)'); gr.addColorStop(1, 'rgba(255,214,190,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    gr = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.05);
    gr.addColorStop(0, 'rgba(255,252,244,1)'); gr.addColorStop(0.7, 'rgba(255,246,230,0.9)'); gr.addColorStop(1, 'rgba(255,240,220,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(sx, sy, H * 0.05, 0, U.TAU); g.fill();

    // 옅은 구름
    for (let i = 0; i < 9; i++) {
      const cx = rnd() * W, cy = H * (0.1 + rnd() * 0.42), cw = W * (0.14 + rnd() * 0.2), chh = H * (0.03 + rnd() * 0.04);
      g.globalAlpha = 0.1 + rnd() * 0.12;
      g.drawImage(SX.sprites.blur, cx - cw, cy - chh, cw * 2, chh * 2);
    }
    g.globalAlpha = 1;

    const layers = [
      { base: H * 0.665, amp: H * 0.055, scale: W * 0.33, seed: 3, top: '#a9bedf', bot: '#93abd2', tree: ['#7890ba', 'rgba(214,226,244,0.75)'], th: H * 0.05, n: 34 },
      { base: H * 0.735, amp: H * 0.06, scale: W * 0.27, seed: 9, top: '#c2d2ec', bot: '#a4b9dc', tree: ['#5f79a8', 'rgba(228,237,250,0.85)'], th: H * 0.085, n: 18 },
      { base: H * 0.83, amp: H * 0.05, scale: W * 0.4, seed: 15, top: '#d6e2f4', bot: '#b5c8e6', tree: ['#4f6898', 'rgba(238,244,253,0.9)'], th: H * 0.14, n: 7 },
    ];
    layers.forEach((L, li) => {
      // 나무는 능선 뒤쪽에 살짝 묻히도록 먼저 그린다
      const trees = [];
      for (let i = 0; i < L.n; i++) {
        let x = rnd() * W;
        if (li === 2) x = rnd() < 0.5 ? rnd() * W * 0.2 : W * (0.82 + rnd() * 0.18);
        if (li === 1 && Math.abs(x - W * 0.27) < W * 0.06) x += W * 0.11;
        trees.push({ x, h: L.th * (0.6 + rnd() * 0.7) });
      }
      trees.sort((a, b) => a.h - b.h);
      for (const t of trees) pine(g, t.x, hillY(t.x, W, L.base, L.amp, L.scale, L.seed) + t.h * 0.06, t.h, L.tree[0], L.tree[1]);
      if (li === 1) {
        const cx = W * 0.27;
        cabin(g, cx, hillY(cx, W, L.base, L.amp, L.scale, L.seed) + 3, U.clamp(W * 0.05, 54, 96));
      }
      gr = g.createLinearGradient(0, L.base - L.amp, 0, L.base + L.amp + H * 0.2);
      gr.addColorStop(0, L.top); gr.addColorStop(1, L.bot);
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W + 8; x += 8) g.lineTo(x, hillY(x, W, L.base, L.amp, L.scale, L.seed));
      g.lineTo(W, H); g.closePath(); g.fill();
      // 능선의 따뜻한 역광
      g.save();
      g.beginPath();
      for (let x = 0; x <= W + 8; x += 8) { const y = hillY(x, W, L.base, L.amp, L.scale, L.seed); x === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.lineWidth = 2.5;
      const rg = g.createLinearGradient(0, 0, W, 0);
      rg.addColorStop(0, 'rgba(255,255,255,0.25)'); rg.addColorStop(0.72, 'rgba(255,238,220,0.75)'); rg.addColorStop(1, 'rgba(255,255,255,0.3)');
      g.strokeStyle = rg; g.stroke();
      g.restore();
      // 층 사이 안개
      gr = g.createLinearGradient(0, L.base - L.amp, 0, L.base + L.amp * 2.5);
      gr.addColorStop(0, 'rgba(226,232,246,0)'); gr.addColorStop(1, 'rgba(232,232,244,0.26)');
      g.fillStyle = gr; g.fillRect(0, L.base - L.amp, W, L.amp * 3.5);
    });

    // 비네트
    gr = g.createRadialGradient(W / 2, H * 0.52, Math.min(W, H) * 0.35, W / 2, H * 0.52, Math.max(W, H) * 0.78);
    gr.addColorStop(0, 'rgba(40,60,110,0)'); gr.addColorStop(1, 'rgba(40,60,110,0.26)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    return c;
  };
})();
