@echo off
REM The files the app ships in _internal (tools/app_resources.py). Since 0.5.0 no Python
REM backend is frozen: the backend runs inside vrct-vox.exe. The tools below need only the
REM Python from mise.toml, no app environment.
REM The pinned speech.cpp (the Vulkan build; Windows ships no other). A verified bundle of this
REM release is kept; one of another release is replaced, since the core refuses it. Nothing
REM else under build/ is touched.
python tools/speechcpp_bundle.py --variant windows-x64-vulkan --download --replace --output build/speechcpp
if errorlevel 1 exit /b 1
REM The RVC worker (cargo rebuilds only what changed); it loads ONNX Runtime from the
REM runtime the user sets up.
python tools/build_rvc_worker.py --output-dir build
if errorlevel 1 exit /b 1
REM The license texts of the Rust crates in vrct-vox.exe and the worker (NOTICE.md).
python tools/rust_licenses.py --output build/licenses/rust
if errorlevel 1 exit /b 1
python tools/app_resources.py --platform windows stage --output src-tauri/bin/_internal
if errorlevel 1 exit /b 1
python tools/check_voice_distribution.py src-tauri/bin/_internal
if errorlevel 1 exit /b 1
