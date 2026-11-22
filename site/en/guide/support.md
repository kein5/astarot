# Platform support

Which systems ASTAROT supports, and how far each has been checked. This page describes 0.5.2 (2026-11-18).

Passing automated tests does not mean a feature has been seen working on a real PC. This page keeps the level of support apart from how it was checked, and says "not verified" wherever there is no record. Memory, GPU and disk space are on [System requirements](requirements).

## Reading the tables

Levels of support:

| Level | Meaning |
|---|---|
| Supported | We ship a build for it and fix bugs found on it |
| Best effort | Expected to work, but not checked, or checked only in part. Reports are welcome; a fix is not promised |
| Not supported | No build is shipped for it |

How it was checked:

| Check | Meaning |
|---|---|
| CI | Automated tests on GitHub's servers. No real audio devices, GPU, VRChat or headset |
| Real PC | Run on a real PC, with a written record. The version is given |
| Not verified | No record from either |

0.5.0 rebuilt what runs inside the app. Checks made on versions before 0.5 are marked "before 0.5" and are not counted for 0.5.

## Systems and packages

| System | Package | Level | CI | Real PC |
|---|---|---|---|---|
| Windows 11 (x64) | Installer (`VRCT-VOX_setup.exe`) | Supported | Contents checked. Install, update and rollback tested with a small stand-in payload | 0.5.1: update from 0.5.0 and start after the update. A fresh install is not verified |
| Windows 11 (x64) | ZIP (`VRCT-VOX.zip`) | Supported | Contents checked | 0.5.1: unpacked and started |
| Windows 11 (x64) | CUDA ZIP (releases up to 0.5 only) | Ended with 0.5 | None | Since 0.5.0 it holds the same files as the ZIP. The next version no longer makes it; every PC uses the ZIP or the installer above |
| Windows 10 (x64) | The installer and the ZIP | Best effort | None | Not verified |
| Ubuntu 24.04, Debian 13 (x64) | deb | Supported | Installed on a clean system: the libraries resolve, the bundled speech engine starts, removal leaves nothing. The window is not opened | Not verified |
| Fedora 44 (x64) | rpm | Supported | Same as the deb | Not verified |
| Linux (x64, glibc 2.39 or later) | AppImage | Supported | On a virtual X11 display on Ubuntu 24.04, started by extraction: start, drawing, the settings screen and shutdown. Starting through FUSE is not tested | 0.5.2: start through FUSE and by extraction, drawing, the settings screen and shutdown (CachyOS, KDE Plasma on Wayland) |
| Linux (x64, glibc 2.39 or later) | tar.gz | Best effort | On a virtual X11 display on Ubuntu 24.04, from a read-only location: start, drawing, the settings screen and shutdown | Not verified on 0.5 |
| Other Linux (x64) | deb, rpm, AppImage, tar.gz | Best effort | None | Not verified |
| ARM64 on Windows or Linux | None | Not supported | None | None |
| macOS | None | Not supported | None | None |

Every Windows record comes from Windows 11 Insider Preview builds (build 26320 for 0.5.1). The generally released Windows 11 has not been checked.

## Linux desktops

| Desktop | Real PC | Notes |
|---|---|---|
| KDE Plasma (Wayland) | 0.5.2: start, drawing and the settings screen of the AppImage | The app window runs through XWayland. Hotkeys are registered through the desktop portal (XDG Desktop Portal) |
| GNOME and other desktops | Not verified | Where the tray cannot be shown, closing the main window quits the app |
| X11 session | Not verified | CI runs on a virtual X11 display with no window manager |

The desktop caption overlay runs under X11 or XWayland. Start the tar.gz with `GDK_BACKEND=x11`. On PCs with an NVIDIA GPU, the AppImage makes its window opaque to avoid a drawing fault.

## What you need

| System | Needs |
|---|---|
| Windows | The WebView2 Runtime (the installer fetches it if missing). A virtual cable to send your voice to VRChat ([Windows audio route](windows-audio)). NVIDIA driver 580 or later for RVC on the GPU |
| Linux | glibc 2.39 or later, GTK 3, WebKitGTK 4.1 and PipeWire. The Vulkan loader and a driver for GPU inference. FUSE for the AppImage (or `APPIMAGE_EXTRACT_AND_RUN=1`). Linux 6.9 or later and WirePlumber 0.5 for the audio route the app manages ([Linux audio route](linux-audio)) |

## Features

The Windows and Linux columns show what has been checked on a real PC. Both builds ship the same features.

| Feature | Windows | Linux | Checked in CI |
|---|---|---|---|
| Start, main screen, settings | Checked on 0.5.1 | 0.5.2: start, main screen and settings of the AppImage | Start and settings screen of the Linux tar.gz and AppImage. UI component tests and the build on both systems. No CI test opens the Windows window |
| Microphone input, speaker output | Not verified on 0.5. Checked before 0.5 with a built-in microphone | Not verified | Tests without devices only |
| Virtual microphone | Not verified on 0.5. The app cannot create one, so install a virtual cable | Not verified on 0.5. Before 0.5, the voice reached VRChat's microphone. The app creates the virtual microphone with PipeWire | Linux: the audio helpers on a test PipeWire. Windows: none |
| Translation | Not verified. Local translation models are not offered yet | Not verified. Same as Windows | Tests without devices or network only |
| Speech recognition (ASR) and realtime captions | Not verified on 0.5. Checked before 0.5 | Not verified on 0.5. Checked before 0.5 | Tests without models only |
| Text to speech (TTS) | Not verified on 0.5. Checked before 0.5 | Not verified on 0.5. Checked before 0.5 | Tests without models only |
| Voice changer (RVC) | Not verified on 0.5. Checked before 0.5 | Not verified on 0.5. Checked before 0.5 | Tests without models only |
| Chat reading (OCR) | 0.5.1: reading a fixed area of a test window. Detecting chat bubbles in real VRChat is not verified | Not verified on 0.5. The VRChat window is read through XWayland; a native Wayland window is read after you share it | Tests without models only |
| Sending messages to VRChat (OSC) | Not verified on 0.5. VRChat detection checked before 0.5 | Not verified | Tests without devices only |
| VR caption overlay and VR UI | Not verified on 0.5. Checked before 0.5 on SteamVR without a headset | Not verified. Before 0.5, checked only with a stand-in for SteamVR | Tests with a fake SteamVR. Neither system has been checked with a real headset |
| Desktop caption overlay | Not verified on 0.5. Before 0.5, shown on top of VRChat | Not verified | Settings screen component tests only |
| Hotkeys | Not verified on 0.5. Checked before 0.5 with keys sent by a program | Not verified | Settings screen component tests only |
| In-app update | 0.5.1: updating the installer version from 0.5.0 | AppImage not verified. deb and rpm update through the package manager | Windows installer update and rollback with a small stand-in payload |

How you update depends on the package. The installer and the AppImage update from inside the app. The ZIP and the tar.gz only tell you a new version is out. The deb and rpm do not check for updates ([Install](install#updates)).

## Reporting a problem

On [Issues](https://github.com/kein5/astarot/issues), give your OS and its version, the package and the ASTAROT version. On Linux, also give the distribution, the desktop and whether it is Wayland or X11. A report that ASTAROT works on a system marked "not verified" also helps us update these tables.

The records behind this page are listed in the developer page [platform verification records](https://github.com/kein5/astarot/blob/develop/docs/voice-stack/platform-verification.md) (Japanese).
