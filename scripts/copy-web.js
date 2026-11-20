// copy-web.js — Tauri 빌드에 넣을 화면 파일들을 src-tauri/web 으로 모은다.
// 화면 코드는 Electron 버전과 같은 파일을 그대로 쓴다. 설정 창만 경로가 달라서 두 군데를 고친다.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'src-tauri', 'web');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const dir of ['css', 'src', 'assets']) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
const settings = fs.readFileSync(path.join(root, 'electron', 'settings.html'), 'utf8')
  .split('../assets/').join('assets/')
  .split('../src/').join('src/');
fs.writeFileSync(path.join(out, 'settings.html'), settings);
console.log('web files copied to', out);
