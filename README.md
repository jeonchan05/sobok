<div align="center">

# 소복소복

**화면에 눈이 쌓이고, 눈을 굴려 눈사람을 만드는 데스크탑 위젯**

[![release](https://img.shields.io/github/v/release/lovejoohero0228/sobok-release?label=release&color=4a7fd6)](https://github.com/lovejoohero0228/sobok-release/releases/latest) ![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-6b7a99) ![Tauri 2](https://img.shields.io/badge/Tauri-2-24c8db) [![license](https://img.shields.io/badge/license-GPL--3.0-6b7a99)](https://github.com/lovejoohero0228/sobok/blob/main/LICENSE) [![stars](https://img.shields.io/github/stars/lovejoohero0228/sobok?style=flat&color=e8b93a)](https://github.com/lovejoohero0228/sobok/stargazers)

[소개 · 사용법](https://lovejoohero0228.github.io/sobok-release/) · [내려받기](https://github.com/lovejoohero0228/sobok-release/releases/latest) · [버그 제보](https://github.com/lovejoohero0228/sobok/issues)

<a href="https://lovejoohero0228.github.io/sobok-release/"><img src="https://raw.githubusercontent.com/lovejoohero0228/sobok-release/main/docs/hero.gif" alt="소복소복 화면" width="720"></a>

</div>

> **macOS 수정판 · 2026년 11월 22일**
>
> 이 포크는 메뉴 막대 일시정지, 화면 잠금 연동, 서울 겨울 테마와 부드러운 눈 효과를 지원합니다. [Apple Silicon용 앱과 빌드 소스](https://github.com/jeonchan05/sobok/releases) · [수정 고지와 글꼴 이용 조건](NOTICE.md)

- 메뉴 막대에서 소복소복 아이콘을 클릭해 **눈 일시정지** 또는 **눈 다시 시작**을 선택합니다. 화면 잠금으로 멈춘 눈은 잠금을 해제하면 다시 내립니다.
- **설정 열기 → 서울 겨울 테마 적용**을 누르면 기본 디스플레이 배경과 눈의 양을 함께 바꿉니다. 배경 이미지는 처음에 GitHub에서 내려받습니다.

> **이 저장소는 소복소복의 소스 코드예요.**
> 그냥 써 보고 싶다면 [소개 페이지](https://lovejoohero0228.github.io/sobok-release/)로, 코드가 궁금하거나 직접 고쳐 보고 싶다면 계속 읽어 주세요.
> 마음에 드셨다면 별 ⭐ 하나 눌러 주세요. 눈사람이 좋아해요.

## 무엇을 하나요

- **눈이 쌓여요.** 작업 표시줄 · Dock 위에도, 열어 둔 창 위에도.
- **눈사람을 만들어요.** 눈을 뭉쳐 굴리면 커지고, 쌓으면 눈사람이 돼요.
- **눈사람이 말을 해요.** 눌러 보면 한마디 하고, 둘을 붙여 두면 자기들끼리 수다를 떨어요.
- **방해하지 않아요.** 눈덩이와 눈사람 말고는 클릭이 아래 창으로 그대로 통과해요.
- **가벼워요.** 실행 파일 하나, 이미지 파일 0개. 전부 Canvas 2D 코드로 그려요.

## 설치

명령 한 줄이에요. 관리자 권한이 필요 없고, 다시 실행하면 최신 버전으로 덮어써요.

**Windows** — PowerShell 에 붙여 넣기

```powershell
powershell -c "irm https://raw.githubusercontent.com/lovejoohero0228/sobok-release/main/install.ps1 | iex"
```

**macOS** — 터미널에 붙여 넣기

```bash
curl -fsSL https://raw.githubusercontent.com/lovejoohero0228/sobok-release/main/install-mac.sh | bash
```

노는 방법, 설정, 삭제 방법은 [소개 페이지](https://lovejoohero0228.github.io/sobok-release/)에 있어요.

## 어떻게 동작하나요

**투명하고, 항상 위에 있고, 클릭이 통과하는 창**을 화면에 덮고 그 위에 눈을 그려요.

1. 바깥 틀(Rust)이 지금 떠 있는 창들의 위치, 커서 위치, Ctrl · ⌘ 키 상태를 읽어서 화면 쪽으로 보내요.
2. 화면 쪽(JavaScript)이 작업 표시줄 · Dock 과 창들의 윗변을 "눈이 쌓이는 면"으로 삼아 눈을 쌓아요. 다른 창에 가려진 구간에는 그리지 않아요.
3. 커서가 눈덩이 · 눈사람 · 설정 버튼 위에 있을 때만 잠깐 클릭을 받고, 그 밖에는 클릭을 아래 창으로 그대로 넘겨요.

눈송이, 쌓인 눈, 눈덩이 표면, 눈사람 얼굴과 옷까지 전부 코드로 그려요. 이미지 파일이 하나도 없어요.

## 직접 빌드하기

필요한 것: [Node.js](https://nodejs.org/), [Rust](https://rustup.rs/).
Windows 는 WebView2 런타임(Windows 11 에는 기본 포함), macOS 는 Xcode 명령줄 도구(`xcode-select --install`)가 더 필요해요.

```bash
npm install

# Windows  →  src-tauri/target/release/sobok.exe
npx tauri build --no-bundle

# macOS    →  src-tauri/target/release/bundle/macos/소복소복.app
npx tauri build --bundles app
```

- **빌드 없이 보기**: `index.html` 을 브라우저로 열면 가상 바탕화면에서 도는 시연판이 떠요. 그리기와 물리를 고칠 때는 이쪽이 빨라요.
- **유니버설 macOS 빌드**: `.github/workflows/mac.yml` 을 수동으로 실행하면 `sobok-mac.zip` 이 아티팩트로 나와요.
- **자동 장면**: `SOBOK_STRESS=1` 을 주고 실행하면 눈덩이 · 눈사람 · 제설차가 저절로 등장하고 프레임 간격이 기록돼요. `SOBOK_STRESS=settings` 는 설정 창을 바로 열어요.
- **기록 파일**: Windows `%APPDATA%\com.sobok.widget\sobok.log`, macOS `~/Library/Application Support/com.sobok.widget/sobok.log`

## 폴더 구조

```
index.html, css/      화면 뼈대 (브라우저로 열면 시연판)
src/                  눈 · 눈덩이 · 눈사람을 그리고 움직이는 코드
  util.js             난수, 노이즈, 스프링, 이징
  sprites.js          절차적 스프라이트 (눈송이, 반짝임, 눈덩이 표면)
  snowfield.js        쌓인 눈: 1px 높이맵 + 픽셀 셰이더, 깎기 · 쌓기 · 무너짐
  snowfall.js         세 겹의 눈송이와 바람
  snowball.js         눈덩이 물리와 그리기
  snowman.js          눈사람: 생김새, 표정, 상태, 말풍선, 수다
  lines.js            눈사람 대사
  plow.js             제설차
  particles.js        눈가루, 부스러기, 깨진 조각
  main.js             월드 상태, 입력, 갱신 · 그리기 루프
  native-shim.js      바깥 틀이 보낸 신호를 "눈이 쌓이는 면" 목록으로 바꾸는 연결부
  wallpaper.js, desktop.js   시연판용 배경과 가상 창
src-tauri/            바깥 틀 (Tauri 2 + Rust)
  src/main.rs         투명 창, 트레이, 설정 창, 창 · 커서 · 키 읽기 (Windows: Win32, macOS: CoreGraphics)
electron/             예전 바깥 틀 (Electron). 설정 창 화면 settings.html 은 지금도 여기 것을 써요
scripts/              빌드용 파일 복사, 설치 · 삭제 스크립트
assets/               말풍선 글꼴
```

## 설계 메모

- **높이맵이 곧 충돌 영역이에요.** 눈덩이가 파고든 만큼 높이맵을 깎고, 깎아낸 양이 그대로 눈덩이에 더해져요. 그래서 눈이 없는 곳에서는 자라지 않아요.
- **굴림은 미끄러지지 않아요.** 회전각은 `이동 거리 / 반지름` 으로만 변해요.
- **표정은 상태가 아니라 연속 값이에요.** 상태는 목표값만 정하고, 실제 값은 스프링으로 따라가서 전환이 끊기지 않아요.
- **조용할 때는 덜 그려요.** 움직이는 것이 없으면 그리는 횟수를 줄여서 CPU 와 GPU 를 아껴요.
- **Windows 는 창 하나, macOS 는 모니터마다 창 하나예요.** macOS 는 창 하나가 여러 모니터에 걸쳐 보이지 않아서, 눈덩이와 눈사람이 모니터 사이를 넘어가지 못해요.
- **운영체제별 분기는 좁게 둬요.** Rust 는 `#[cfg(target_os = …)]`, 화면 쪽은 `raw.pt` / `MAC` 분기 안에만 있어요.

## 아직 안 된 것

- macOS 는 Apple 실리콘 맥(macOS 15)에서만 직접 확인했어요. Intel 맥과 다른 macOS 버전은 확인하지 못했어요.
- 모니터마다 배율이 다른 환경은 확인하지 못했어요.
- 실행 파일에 코드 서명이 없어요. 그래서 설치는 명령 한 줄로 받는 방식을 써요.
- 소리가 없어요.

버그 제보와 제안은 이슈로 남겨 주세요.

## 라이선스

소스 코드는 [GPL-3.0](LICENSE) 이에요. 자유롭게 쓰고 고칠 수 있고, 고친 것을 배포할 때는 같은 조건으로 소스를 공개해야 해요.

`assets/` 의 말풍선 글꼴 HS활공굴림 (토끼네활자공장)은 [글꼴 제작자의 이용 조건](https://m.blog.naver.com/hp0/224471962233)을 따라요.
