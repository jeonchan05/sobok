// desktop.js — "눈이 쌓일 수 있는 면" 을 알려주는 플랫폼 어댑터.
// 웹 프로토타입에서는 가상의 창(DOM) 위치를 돌려준다.
// Electron 위젯(electron/main.js)으로 실행하면 window.snowNative 가 생기고,
// 실제 OS 창의 사각형과 작업 표시줄 위치가 같은 형식으로 들어온다. 나머지 코드는 그대로 동작한다.
(function () {
  'use strict';
  const SX = window.SX, U = SX.util;
  const TASKBAR = 48;

  function place(el, x, y, w, h) {
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
    el.style.width = Math.round(w) + 'px';
    el.style.height = Math.round(h) + 'px';
    return { x0: Math.round(x), x1: Math.round(x) + Math.round(w), y: Math.round(y) };
  }

  SX.desktop = {
    taskbar: TASKBAR,
    // 반환: [{ id, kind: 'window' | 'ground', x0, x1, y }]
    native: null,          // Electron 위젯일 때: 메인 프로세스가 보내 준 실제 창 목록
    getSurfaces(W, H) {
      if (window.snowNative) return this.native || [{ id: 'ground', kind: 'ground', x0: 0, x1: W, y: H - TASKBAR }];
      const out = [];
      const nw = U.clamp(W * 0.21, 230, 360), nh = U.clamp(H * 0.36, 210, 350);
      const pw = U.clamp(W * 0.27, 280, 460), ph = U.clamp(H * 0.29, 180, 290);
      const mw = U.clamp(W * 0.2, 240, 330), mh = U.clamp(H * 0.21, 150, 190);
      const nx = Math.max(W * 0.075, 112);
      const r1 = place(document.getElementById('win-notes'), nx, H * 0.2, nw, nh);
      const px = U.clamp(W * 0.5 - pw * 0.45, nx + nw + 30, W - pw - mw - 60);
      const r2 = place(document.getElementById('win-photos'), px, H * 0.35, pw, ph);
      const r3 = place(document.getElementById('win-music'), W - mw - Math.max(W * 0.07, 28), H * 0.15, mw, mh);
      out.push(Object.assign({ id: 'notes', kind: 'window' }, r1));
      out.push(Object.assign({ id: 'photos', kind: 'window' }, r2));
      out.push(Object.assign({ id: 'music', kind: 'window' }, r3));
      out.push({ id: 'ground', kind: 'ground', x0: 0, x1: W, y: H - TASKBAR });
      return out;
    },
    tickClock() {
      const d = new Date();
      const el = document.getElementById('clock');
      if (el) el.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    },
  };
})();
