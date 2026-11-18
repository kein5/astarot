REM Sync the Python environments exactly to uv.lock (see pyproject.toml).
REM Requires uv: https://docs.astral.sh/uv/getting-started/installation/
REM The Python is the one mise.toml pins. uv takes it from PATH (mise run setup:app,
REM or a shell after mise activate) and never fetches one of its own.
REM opencv-python, which rapidocr and windows-capture would pull in beside
REM opencv-python-headless, is excluded in pyproject.toml.
setlocal
where uv >nul 2>nul
if errorlevel 1 (
    echo uv is required: https://docs.astral.sh/uv/getting-started/installation/
    exit /b 1
)
set UV_PYTHON_PREFERENCE=only-system
set UV_PYTHON_DOWNLOADS=never

REM .venv: the CPU build environment
set UV_PROJECT_ENVIRONMENT=.venv
uv sync --frozen
if errorlevel 1 exit /b 1

REM .venv_cuda: the GPU build environment (adds the cuda extra)
set UV_PROJECT_ENVIRONMENT=.venv_cuda
uv sync --frozen --extra cuda
if errorlevel 1 exit /b 1

endlocal
REM VRCT-VOX packages exclude OCR models; no build-time model download.
