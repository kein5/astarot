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
REM ONNX Runtime (chat reading, local translation) and the OpenVR client library (VR overlay),
REM pinned by size and SHA-256 and kept in build/runtime-libraries.
python tools/runtime_libraries.py --platform windows --download --output build
if errorlevel 1 exit /b 1
REM The readings' dictionary, SudachiDict full (decision 3 in docs/voice-stack/core-integration.md),
REM pinned by size and SHA-256. A checked dictionary of that edition in build/sudachi is kept.
python tools/sudachi_dictionary.py fetch --edition full --output build/sudachi
if errorlevel 1 exit /b 1
REM The license texts of the Rust crates in vrct-vox.exe and the worker (NOTICE.md).
python tools/rust_licenses.py --output build/licenses/rust
if errorlevel 1 exit /b 1
python tools/app_resources.py --platform windows stage --output src-tauri/bin/_internal
if errorlevel 1 exit /b 1
python tools/check_voice_distribution.py src-tauri/bin/_internal
if errorlevel 1 exit /b 1
