<div align="center">

# Sobok

**A desktop widget where snow piles up on your screen and you roll it into snowmen**

[![release](https://img.shields.io/github/v/release/lovejoohero0228/sobok-release?label=release&color=4a7fd6)](https://github.com/lovejoohero0228/sobok-release/releases/latest) ![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-6b7a99) ![Tauri 2](https://img.shields.io/badge/Tauri-2-24c8db) [![license](https://img.shields.io/badge/license-GPL--3.0-6b7a99)](https://github.com/lovejoohero0228/sobok/blob/main/LICENSE) [![stars](https://img.shields.io/github/stars/lovejoohero0228/sobok?style=flat&color=e8b93a)](https://github.com/lovejoohero0228/sobok/stargazers)

[Guide](https://lovejoohero0228.github.io/sobok-release/en/) · [Download](https://github.com/lovejoohero0228/sobok-release/releases/latest) · [Report a bug](https://github.com/lovejoohero0228/sobok/issues) · [한국어](README.ko.md)

<a href="https://lovejoohero0228.github.io/sobok-release/en/"><img src="https://raw.githubusercontent.com/lovejoohero0228/sobok-release/main/docs/hero.gif" alt="Sobok on a desktop" width="720"></a>

</div>

> **This repository is the source code of Sobok.**
> If you just want to use it, head to the [guide](https://lovejoohero0228.github.io/sobok-release/en/). If you are curious about the code or want to change it, read on.
> If you like it, a star ⭐ would make the snowmen happy.

*소복소복 (sobok-sobok) is the Korean word for snow quietly piling up.*

## What it does

- **Snow piles up.** On the taskbar or Dock, and on top of your open windows.
- **You build snowmen.** Pack the snow, roll it bigger, stack three, and a snowman is born.
- **Snowmen talk.** Poke one and it says something. Put two together and they chat with each other.
- **It stays out of your way.** Clicks pass straight through to the window below, except on snowballs and snowmen.
- **It is light.** One executable, zero image files. Everything is drawn in Canvas 2D code.
- **English and Korean.** It follows your system language, and you can switch in Settings.

## Install

One line. No admin rights needed, and running it again updates to the latest version.

**Windows** — paste into PowerShell

```powershell
powershell -c "irm https://raw.githubusercontent.com/lovejoohero0228/sobok-release/main/install.ps1 | iex"
```

**macOS** — paste into Terminal

```bash
curl -fsSL https://raw.githubusercontent.com/lovejoohero0228/sobok-release/main/install-mac.sh | bash
```

How to play, settings, and uninstalling are covered in the [guide](https://lovejoohero0228.github.io/sobok-release/en/).

## How it works

Sobok covers the screen with a window that is **transparent, always on top, and click-through**, and draws snow on it.

1. The shell (Rust) reads where the open windows are, where the cursor is, and whether Ctrl / ⌘ is held, and sends that to the page.
2. The page (JavaScript) treats the taskbar or Dock and the top edge of each window as a surface for snow to pile on. Stretches hidden behind other windows are skipped.
3. Clicks are captured only while the cursor is over a snowball, a snowman, or the settings button. Everywhere else they fall through to the window below.

Snowflakes, piled snow, snowball texture, snowman faces and clothes are all drawn in code. There is not a single image file.

## Build it yourself

You need [Node.js](https://nodejs.org/) and [Rust](https://rustup.rs/).
Windows also needs the WebView2 runtime (included in Windows 11). macOS also needs the Xcode command line tools (`xcode-select --install`).

```bash
npm install

# Windows  →  src-tauri/target/release/sobok.exe
npx tauri build --no-bundle

# macOS    →  src-tauri/target/release/bundle/macos/소복소복.app
npx tauri build --bundles app
```

- **No build needed to look around**: open `index.html` in a browser for a demo that runs on a fake desktop. This is the fastest way to work on drawing and physics.
- **Universal macOS build**: run `.github/workflows/mac.yml` manually and it produces `sobok-mac.zip` as an artifact.
- **Auto scene**: start with `SOBOK_STRESS=1` and snowballs, snowmen, and the snowplow appear on their own while frame times are logged. `SOBOK_STRESS=settings` opens the settings window right away.
- **Log file**: Windows `%APPDATA%\com.sobok.widget\sobok.log`, macOS `~/Library/Application Support/com.sobok.widget/sobok.log`

## Layout

```
index.html, css/      page skeleton (open in a browser for the demo)
src/                  drawing and motion for snow, snowballs, snowmen
  util.js             random, noise, springs, easing
  sprites.js          procedural sprites (snowflakes, sparkles, snowball texture)
  snowfield.js        piled snow: 1px heightmap + pixel shader, carving, piling, collapsing
  snowfall.js         three layers of snowflakes and wind
  snowball.js         snowball physics and drawing
  snowman.js          snowmen: looks, expressions, states, speech bubbles, chatting
  lines.js            what the snowmen say (Korean)
  lines.en.js         what the snowmen say (English)
  plow.js             the snowplow
  particles.js        snow dust, crumbs, broken pieces
  main.js             world state, input, update and draw loop
  native-shim.js      turns signals from the shell into a list of surfaces for snow
  wallpaper.js, desktop.js   background and fake windows for the demo
src-tauri/            the shell (Tauri 2 + Rust)
  src/main.rs         transparent window, tray, settings window, reading windows / cursor / keys (Windows: Win32, macOS: CoreGraphics)
electron/             the old shell (Electron). Its settings.html is still the settings window
scripts/              build-time file copy, install and uninstall scripts
assets/               the speech bubble font
```

Comments in the code are in Korean.

## Design notes

- **The heightmap is the collision shape.** A snowball carves the heightmap by however much it sinks in, and the carved amount is added to the snowball. So it does not grow where there is no snow.
- **Rolling never slips.** Rotation changes only by `distance / radius`.
- **Expressions are continuous values, not states.** A state only sets targets, and the real values follow with springs, so transitions never snap.
- **It draws less when things are quiet.** With nothing moving, the frame rate drops to save CPU and GPU.
- **One window on Windows, one per monitor on macOS.** A macOS window cannot span monitors, so snowballs and snowmen cannot cross between them.
- **Platform branches are kept narrow.** Rust uses `#[cfg(target_os = …)]`, and the page keeps them inside `raw.pt` / `MAC` branches.
- **The English lines are not translations.** Jokes do not survive translation, so `lines.en.js` was written fresh for the same character.

## Not done yet

- macOS was checked by hand only on Apple silicon. Intel Macs are untested.
- Monitors with different scale factors are untested.
- The executables are not code signed. That is why installing uses a one-line command.
- There is no sound.

Bug reports and ideas are welcome in the issues.

## License

The source code is [GPL-3.0](LICENSE). You are free to use and change it, and if you distribute a changed version you must share its source under the same terms.

The speech bubble font in `assets/`, HSHwalgongGulim (토끼네활자공장), is not covered by this license and follows its own terms.
