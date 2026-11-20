// platform-other.js — Windows 가 아닌 환경(macOS 등)의 기본 어댑터.
// 창 목록을 읽는 네이티브 코드가 아직 없어서 창 위 눈은 쌓이지 않고, 바닥(Dock/메뉴 막대를 뺀 작업 영역의 아랫변) 눈만 쌓인다.
// Ctrl 키 상태는 마우스 이벤트에 실려 오는 값으로 판단한다.
module.exports = {
  windowSnow: false,
  snapshot() { return { c: 0, fg: [0, 0, 0, 0], w: [] }; },
};
