# Developing ASTAROT

[日本語版](#astarotの開発日本語版)

The versions of the development tools are pinned in `mise.toml` at the root of the repository. The routine steps are also [mise](https://mise.jdx.dev/) tasks.

```sh
mise install                 # install Node, Rust, Python, uv and Cocogitto at the versions in mise.toml
mise tasks                   # list the tasks
mise run doctor              # show missing tools and dependencies
mise run setup:headless      # install the Python dependencies for the tests that run without models
mise run setup:ui            # install the UI dependencies
mise run check               # light checks
```

Each task runs an existing CLI such as `python tools/dev.py`. Before that, mise puts the pinned versions of the tools at the front of PATH. Extra arguments go after the task name (for example `mise run check:voice --dry-run`). You can also call `python tools/dev.py` directly without mise. In that case, you match the versions of the tools on PATH yourself.

`doctor` shows what is missing. `setup` installs the dependencies you name. `check` defaults to `quick`, which runs the tests of the development CLI, the UI tests (Vitest) and Ruff. Each subcommand's `--help` shows the detailed commands. The development CLI itself runs on nothing but the standard library of Python 3.11 or later.

| Task | What it runs |
| --- | --- |
| `doctor` | `python tools/dev.py doctor` |
| `check`, `check:all` | `python tools/dev.py check` (`quick`), `--scope all` |
| `check:voice`, `check:ui`, `check:rust`, `check:integration`, `check:workflows`, `check:crates`, `check:links`, `check:hooks` | `python tools/dev.py check --scope <name>` |
| `check:commits`, `check:secrets` | `python tools/dev.py check --scope <name> --base origin/develop` |
| `check:vulns` | `python tools/dev.py check --scope vulns` (queries osv.dev) |
| `setup:headless`, `setup:ui`, `setup:browser`, `setup:rust`, `setup:resources`, `setup:integration`, `setup:hooks` | `python tools/dev.py setup --scope <name>` |
| `spec` | Rebuilds the lists in the functional specifications (rewrites the core's list, `tools/spec_core_catalog.json`, then runs `python tools/spec_catalog.py --write`) |
| `adr` | Rebuilds the ADR index table (`python tools/adr_catalog.py --write`) |
| `build:voice-gate`, `build:rvc-worker` | Builds the audio helper programs and the RVC worker into `build/` |
| `build:windows`, `build:linux` | `npm run build`, `python tools/build_linux.py` |
| `changelog:print` | Shows the changes for the next release without writing them |
| `changelog:notes` | Creates the template of the release notes for a stable release at `docs/release-notes/<version>.md`. Does not overwrite an existing file ([release notes format](release-notes/README.md#雛形から書き始める)) |
| `dev:web` | The development server for the web UI (Vite). Not part of the checks |
| `dev:catalog` | The component catalog of the UI kit (Storybook) at `http://localhost:6006` ([components](design/components/README.md)). Not part of the checks |

The lists in the functional specifications (the endpoints, error codes and setting keys in `docs/spec/reference/`) are generated from the code of the core and the UI. When you change an endpoint, an error code or a setting key, rebuild them with `mise run spec`. `check` also confirms that these lists are up to date. The specifications start at [docs/spec/README.md](spec/README.md).

The index table of the architecture decision records (ADRs) in [docs/adr/README.md](adr/README.md) is generated from the front matter at the top of each ADR. When you add an ADR or change its front matter, rebuild the table with `mise run adr`. Through `tests/devtools/test_adr_catalog.py`, `check` looks for duplicate numbers and checks the fields and their values, the evidence paths, the links and whether the table is out of date.

Shortcuts to the development CLI (`tools/dev.py`) live only in mise tasks (2026-11-21). The npm scripts keep only what needs npm to run: Vite, Tauri, starting the app (`npm run dev-fast` and others), building the Windows release package (`npm run build`, `npm run release`), the UI tests (`npm test`, Vitest), type checking (`npm run typecheck`) and similar. When you call them from a shell with mise turned on (`mise activate`), the npm scripts also run with the pinned versions.

npm used to have the same shortcuts, and they disagreed with mise (npm's `check:commits` did not pass `--base`, and the scope checks were named `test:*`). The npm shortcuts were replaced by these mise tasks.

| Former npm script | mise task |
| --- | --- |
| `npm run doctor` | `mise run doctor` |
| `npm run check`, `npm run check:all` | `mise run check`, `mise run check:all` |
| `npm run check:commits` | `mise run check:commits` |
| `npm run test:voice`, `npm run test:ui`, `npm run test:integration` | `mise run check:voice`, `mise run check:ui`, `mise run check:integration` |
| `npm run setup:headless`, `npm run setup:browser` | `mise run setup:headless`, `mise run setup:browser` |

`check:commits` compares against `origin/develop`, the name that a fresh clone uses. When your remote has another name, add `--base` after the task, as in `mise run check:commits --base <remote>/develop`, and that one is used. `tests/devtools/test_dev_shortcuts.py` checks that no npm script calls `tools/dev.py`, that the names of the scope tasks match the scope names (`check:<scope>`, `setup:<scope>`) and that the tasks handing over to npm point at scripts that still exist.

## Tools to install

Install mise with [the official instructions](https://mise.jdx.dev/getting-started.html), then run `mise trust` and `mise install` once in the repository. The tools at the versions in `mise.toml` go into mise's own storage. The same tools installed in the OS are left unchanged.

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 26.13.1 | npm is the one that comes with Node |
| Rust | 1.100.0 | Installed through rustup (profile minimal, with clippy and rustfmt added). There is no `rust-toolchain.toml` |
| Python | 3.14.10 | Used for the build tools and the tests. `requires-python` in `pyproject.toml` gives the same minor version (3.14). From 0.5.0 the release package contains no Python |
| uv | 0.13.5 | |
| Cocogitto | 7.0.0 | The command is `cog` |
| Biome | 2.6.6 | Lint and formatting for the UI's TypeScript and JavaScript ([UI lint and formatting](#ui-lint-and-formatting-biome)) |
| actionlint | 1.7.12 | Checks how workflows are written |
| shellcheck | 0.11.0 | Checks the shell scripts in workflow `run:` steps (called from actionlint) |
| zizmor | 1.32.0 | Checks workflows for security problems |
| cargo-deny | 0.20.2 | Checks the licenses, known vulnerabilities and sources of Rust crates |
| cargo-nextest | 0.9.151 | Runs the Rust tests. The command is `cargo nextest`. It is not in mise's registry, so `[tool_alias]` in `mise.toml` takes it from the GitHub releases |
| gitleaks | 8.30.1 | Checks the history and the files for keys and tokens |
| osv-scanner | 2.7.0 | Checks the dependencies in the lock files for known vulnerabilities |
| lychee | 0.24.2 | Checks the links in the documents and the guide |
| hk | 2.11.1 | Runs the Git hooks |
| ast-grep | 0.51.1 | Searches and rewrites by syntax. Used for migration work and not part of `check` |
| syft | 1.57.0 | Creates the software bill of materials (SBOM) for a release. Not part of `check` |

`mise.toml` is the source of truth for the versions. The table above is a copy for explanation; if the two disagree, `mise.toml` is right. `mise.lock` records the download URL and SHA-256 of each tool other than Rust, for Linux and for Windows. To change a version, edit `mise.toml` and rebuild `mise.lock` with `mise lock --platform linux-x64,windows-x64`. CI installs the same versions from these two files (see below). `tests/devtools/test_toolchain_pins.py` checks that the versions are fully pinned, that they match `mise.lock` and that no workflow decides a version outside mise.

Pick the latest version of a tool that has been public for at least 14 days (two weeks). This applies to the tools pinned in `mise.toml` (Biome included) and to development tools installed through npm or other means, both when you add a tool and when you upgrade one. The reason is to stay out of trouble when a fresh release is withdrawn, or hijacked and replaced. The rule was decided on 2026-11-20 in #828 (originally #582) and written here on 2026-11-21 in #832. Dependabot's version update proposals also wait until a release has been public for 14 days (`cooldown` in `.github/dependabot.yml`, decided on 2026-11-21 in #833). Security updates come out without waiting.

uv can find a Python installed outside mise first (including one that uv downloaded itself). The tasks that create environments (`setup:*`) set `UV_PYTHON_PREFERENCE=only-system` so that uv uses mise's Python on PATH. uv commands do not name a Python version (no `--python 3.14` or the like). uv picks the Python on PATH that matches `requires-python` in `pyproject.toml`, and `tools/dev.py` reads the version from `mise.toml`. To upgrade Python, edit `mise.toml`, `mise.lock`, `requires-python` in `pyproject.toml` and `uv.lock`. `tests/devtools/test_toolchain_pins.py` also checks that CI, the tasks, the bat files and `tools/dev.py` do not pass a version to uv. `mise.toml` has no uv settings under `[env]`. Values in `[env]` are passed on to every program that mise starts, so only the tasks that create environments set them, each for itself.

The only value in `[env]` is `ORT_DISABLE_TELEMETRY=1`. With nothing set, ONNX Runtime creates a `deviceid` and an event database in `~/.cache/Microsoft/DeveloperTools/.onnxruntime/` when it creates a session, and tries to send usage data to Microsoft. This value can safely pass to every program, so it lives in `[env]`. The child processes of `tools/dev.py`, the translation model export (`tools/translation_onnx/`) and the HuBERT export (`native/rvc-runtime/reference/export_hubert_onnx.py`) also set the same value themselves. When you use ONNX Runtime from another script without going through mise, set `ORT_DISABLE_TELEMETRY=1` first. The ONNX Runtime bundled with the app is turned off by the app itself at startup (`docs/spec/external-interfaces.md`).

`setup` does not run the OS package manager or any global installer. Automatic download of Python itself is also turned off, so without mise you install Python of the same minor version as `mise.toml` (3.14) beforehand. Without mise, follow each tool's official instructions:

| Tool | Official instructions |
| --- | --- |
| Python | [Python downloads](https://www.python.org/downloads/) |
| uv | [uv installation](https://docs.astral.sh/uv/getting-started/installation/) |
| Node.js / npm | [Node.js downloads](https://nodejs.org/en/download) |
| Rust / Cargo | [Rust installation](https://www.rust-lang.org/tools/install) |
| Cocogitto | [Cocogitto installation](https://docs.cocogitto.io/) |
| actionlint | [actionlint installation](https://github.com/rhysd/actionlint/blob/main/docs/install.md) |
| shellcheck | [ShellCheck installing](https://github.com/koalaman/shellcheck#installing) |
| zizmor | [zizmor installation](https://docs.zizmor.sh/installation/) |
| cargo-deny | [cargo-deny](https://embarkstudios.github.io/cargo-deny/) |
| cargo-nextest | [cargo-nextest installation](https://nexte.st/docs/installation/pre-built-binaries/) |
| gitleaks | [gitleaks](https://github.com/gitleaks/gitleaks#installing) |
| osv-scanner | [OSV-Scanner installation](https://google.github.io/osv-scanner/installation/) |
| lychee | [lychee installation](https://github.com/lycheeverse/lychee#installation) |
| hk | [hk getting started](https://hk.jdx.dev/getting_started.html) |
| ast-grep | [ast-grep quick start](https://ast-grep.github.io/guide/quick-start.html) |
| syft | [Syft installation](https://github.com/anchore/syft#installation) |

Checking Tauri on Linux also needs development libraries such as WebKitGTK 4.1. The packages you need are listed in [the Linux build steps](voice-stack/linux-build-pipeline.md). `doctor --scope rust` looks for the main libraries with pkg-config. On Windows, prepare the C++ build environment for Tauri and the like separately. A successful Rust compile is not the same as checking the installer on real hardware.

For the Linux tray library, the diagnosis passes with either `ayatana-appindicator3-0.1` or `appindicator3-0.1`. It does not require the Ubuntu Ayatana package name on every other distribution. This follows [the Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and the libappindicator-sys 0.9.0 in use, whose implementation handles both libraries.

## Preparing dependencies

`setup` takes one scope at a time. These commands use the network, so you can check them first with `--dry-run`. To prepare from the cache alone, add `--offline`.

| Scope | What it does and where it puts things |
| --- | --- |
| `headless` | Syncs only the `voice-test` group of `uv.lock` into `build/dev/headless-venv` |
| `ui` | Prepares the root `node_modules` with `npm ci --ignore-scripts` |
| `browser` | Syncs the `voice-ui-test` group of `uv.lock` into `build/dev/browser-venv`. Can also add to an existing venv |
| `rust` | Fetches the dependencies that Cargo.lock pins with `cargo fetch --locked` (`CARGO_WORKSPACES` in `tools/dev.py`: `src-tauri`, the `native/` crates in `NATIVE_CRATES` and `native/browser-core-bridge` for the integration tests; the same list as `check --scope crates` below) |
| `resources` | Rebuilds `src-tauri/bin/_internal` from what is in `build/` with `tools/app_resources.py stage --allow-missing` |
| `integration` | Prepares the [integration tests](#integration-tests-playwright). Fetches the dependencies of `native/browser-core-bridge` with `cargo fetch --locked` and downloads Playwright's Chromium and WebKit (several hundred MB in total). Needs `setup --scope ui` first. Does not install the OS libraries the browsers use |
| `hooks` | Installs the Git hooks in `hk.pkl` into this clone with `hk install` ([Git hooks](#git-hooks)). No other scope installs them |

Each dedicated venv stores an ownership marker. If an existing directory or symbolic link without the marker is in the same place, `setup` stops and does not delete it. Every Python scope checks, with `tools/check_python_lock.py`, the SHA-256 of every archive in the lock and the full commit SHA of every Git dependency. It then writes a list with hashes and indirect dependencies from `uv.lock` to `build/dev/<scope>-requirements.txt` with `uv export`, and syncs the dedicated venv with `uv pip sync`. uv compares the hashes in the list and stops on a mismatch. Git dependencies need no archive hash; they use the pinned commit. When `--python` names an existing venv (`browser` only), the packages are added with `uv pip install -r` and no other package is removed. See [uv's environment selection](https://docs.astral.sh/uv/pip/environments/) and [locking and syncing dependencies](https://docs.astral.sh/uv/pip/compile/).

`setup --scope ui` rebuilds an existing `node_modules` as npm specifies. If package.json and package-lock.json disagree, it fails and does not update the lock. See [the npm ci documentation](https://docs.npmjs.com/cli/v11/commands/npm-ci).

On Windows too, `headless`, `ui`, `browser`, `rust` and `resources` use the same entry point. The Python backend and the steps that built its environments (`mise run setup:app` and `bat\install.bat`, which created `.venv`, `.venv_cuda` and `.venv_linux`) were removed in 0.6.0 (#285). Only the dependencies of the tools and tests remain in `uv.lock`.

### Preparing the resources that Tauri reads

`tauri.conf.json` bundles `src-tauri/bin/_internal` as `_internal` in the release package. Without this folder, `cargo check`, `tauri dev` and `tauri build` stop. In a new checkout, prepare and diagnose it in this order:

```sh
python tools/dev.py setup --scope resources --dry-run
python tools/dev.py setup --scope resources
python tools/dev.py doctor --scope rust
python tools/dev.py check --scope rust
```

`setup --scope resources` rebuilds the folder and copies speech.cpp, the RVC worker and the Rust license texts from `build/`, plus the repository's `LICENSE` and `NOTICE.md`. It shows what is missing but does not fail. A development (debug) build reads speech.cpp and the rest directly from `build/` in the checkout (`native/core/src/resources.rs`). To assemble the contents of the release package, use `npm run build-resources` (Windows).

The development sidecar used up to 0.4 (`utils/dev_sidecar`, `setup --scope sidecar` and the Python start in `npm run dev-fast`) was deleted when Python stopped being bundled. The Python backend (`src-python/`) was removed in 0.6.0. To check how it behaved, use a checkout of a 0.5.x tag or a 0.4.x release package.

### Adding the UI test dependencies to an existing Linux environment

```sh
python tools/dev.py setup --scope browser --python path/to/venv/bin/python --dry-run
python tools/dev.py setup --scope browser --python path/to/venv/bin/python
python tools/dev.py doctor --scope browser --python path/to/venv/bin/python
```

This adds or updates the packages needed in the venv you chose (Python 3.14, as in `mise.toml`). It does not remove unrelated packages with a sync. It refuses the system Python. For a Windows venv, name the executable, as in `.venv\Scripts\python.exe`.

The Playwright Python package and the Chromium executable are separate. `setup --scope browser` does not fetch Chromium or OS libraries. For the conditions for running the browser tests, see [the verification record for the model download UI](voice-stack/model-downloads.md). The usual `check` strips the variables that turn on the hardware and browser tests, so those tests run through their own steps. The long-running tests and the tests with a real microphone on Windows are in [the Windows field tests](voice-stack/windows-field-tests.md).

## Choosing what to check

```sh
python tools/dev.py check --scope tooling
python tools/dev.py check --scope node
python tools/dev.py check --scope voice
python tools/dev.py check --scope ui
python tools/dev.py check --scope rust --dry-run
python tools/dev.py check --scope integration
```

| Scope | What it covers |
| --- | --- |
| `tooling` | Tests `tests/devtools` with the standard library's unittest |
| `node` | Runs the `.test.js` / `.test.mjs` / `.test.ts` files under `src-ui` and the tests of `tools/i18n_gate` and `tools/writing_gate` with Vitest (`vitest.config.js`). Starts the Vitest in `node_modules` directly with Node and fetches nothing. If Vitest is not installed, it points to `setup --scope ui` and stops. Then runs the [UI text check](#checking-ui-text-and-translations) (`tools/i18n_gate/check.mjs`) and the [prose check](#checking-prose-docswriting) (`tools/writing_gate/check.mjs`) |
| `lint` | Checks `LINT_PATHS` in `tools/dev.py` (`tests/voice`, `tests/devtools` and the audio, distribution and development tools) with Ruff. No automatic fixes. The voice CI runs the same scope |
| `voice` | The contract tests without models, run with `tests/voice/pytest.ini`, and the two standalone tests in `tests/platform` |
| `ui` | The UI tests (Vitest), the lint and formatting checks of [Biome](#ui-lint-and-formatting-biome), type checking (`npm run typecheck`), `npm run vite-build` and the build of the component catalog (`npm run build:catalog`, into `build/storybook/`). No browser interaction |
| `rust` | `cargo check --locked --offline` of `src-tauri`, and the tests of `native/app-identity`, `native/speech-server`, `native/ops`, `native/audio-routing`, `native/adapters`, `native/translation`, `native/transcription`, `native/openvr-client`, `native/onnx-runtime`, `native/vr-overlay`, `native/voice-conversion`, `native/translate-onnx`, `native/tts`, `native/core`, `native/ocr-runtime`, `native/rvc-runtime` and `native/talk-ai`, run with cargo-nextest (`cargo nextest run --locked --offline`). nextest does not run doctests, so for the crates that have `src/lib.rs` it then runs `cargo test --doc`. Fails without the cache or the OS dependencies (on Linux, the development files of `libpipewire-0.3` and libclang; `src-tauri` also uses them, through the core) |
| `integration` | The [integration tests](#integration-tests-playwright). Builds `native/browser-core-bridge` with `cargo build --locked --offline`, builds the UI with `tests/integration/vite.config.ts`, then runs the tests in Chromium and WebKit with Playwright. Does not fetch browsers. If they are not installed, it points to `setup --scope integration` and stops |
| `workflows` | Checks the workflows and our own actions with actionlint (including shellcheck) and zizmor ([repository checks](#repository-checks)) |
| `crates` | Checks the licenses, the banned settings and the sources of the dependencies of every Cargo workspace with cargo-deny ([repository checks](#repository-checks)). Needs `setup --scope rust` first |
| `links` | Checks the links between the repository's Markdown files and the links to headings with lychee. Does not query external sites ([repository checks](#repository-checks)) |
| `hooks` | Checks the Git hook settings (`hk.pkl`) with `hk validate` ([Git hooks](#git-hooks)) |
| `quick` | `tooling`, `node`, `lint`. The default |
| `all` | The 11 targets above. It takes a long time, so run it explicitly when integrating |
| `commits` | Checks the format of the new commits from `--base` to HEAD |
| `secrets` | Checks the new commits from `--base` to HEAD for keys and tokens with gitleaks ([repository checks](#repository-checks)) |
| `vulns` | Checks the dependencies in the lock files for known vulnerabilities with osv-scanner. It queries osv.dev, so it is not part of `all` ([repository checks](#repository-checks)) |

For Python, the dedicated venv comes first, then an existing `.venv`. With `--python`, that executable is used. Running `all` without the dedicated venv does not silently skip missing dependencies. You can check first with `doctor --scope all`.

`doctor` and `check` do not fetch dependency packages or models, and do not start the app, the microphone, speech output or GPU inference. In child processes they remove the environment variables that start with `ASTAROT_` and `VRCT_`, extra pytest arguments and the automatic loading of external plugins, and they put Hugging Face offline. These settings keep tests from starting by mistake; they are not a network sandbox that contains arbitrary test code. The HTTP/UDP contract tests use temporary local ports. In a sandbox that forbids networking, those tests fail.

`check` creates caches and temporary files for the checks, and rewrites `dist` for the UI and Cargo's build directory for Rust. It does not call npm's `dev` / `build` / `task-kill`, which stop a running copy of the normal app. When rustc is present, the tooling tests compile and run the unit tests of `src-tauri/src/single_instance.rs` in a temporary directory (`tests/devtools/test_single_instance.py`). Release builds run in the dedicated workspace described in [the Linux build steps](voice-stack/linux-build-pipeline.md).

The run stops at the first failure. The exit codes are:

| Code | Meaning |
| --- | --- |
| `0` | The selected checks succeeded. With `--dry-run`, only that the plan was shown |
| `1` | A check or install command that ran failed. The child command's exit status is shown too |
| `2` | A problem with the arguments, a missing prerequisite, an ownership marker, the Git base or the like |
| `130` | Interrupted with Ctrl+C |

For machine processing, use `python tools/dev.py doctor --scope voice --json`. In an environment that is not set up, it returns `ok: false` and what to do.

## Repository checks

Apart from the tests of the product code, some scopes check the repository itself. Every tool they use has its version pinned in `mise.toml`. Locally, install the tools with `mise install` before you run these scopes. If a tool is missing, `check` points to `mise install` and stops. In CI, one job in `repo-checks.yml` runs them, one step per scope. The later steps run even if an earlier step fails.

| Scope | Tool | What it checks | Where exceptions go |
| --- | --- | --- | --- |
| `workflows` | actionlint, shellcheck, zizmor | How workflows are written, their expressions and types (actionlint). The shell scripts in `run:` (shellcheck, called by actionlint). Security problems in the workflows, our own actions and `dependabot.yml` (zizmor) | `.github/zizmor.yml`, or `# zizmor: ignore[<audit>] <reason>` on the line |
| `links` | lychee | Links between Markdown files outside `site/`, and links to headings (`#...`). Does not query external sites | `lychee.toml` |
| `hooks` | hk | How the Git hook settings (`hk.pkl`) are written. That the version of the hk settings package that `hk.pkl` reads matches the hk version in `mise.toml` (`tests/devtools/test_toolchain_pins.py`) | None |
| `secrets` | gitleaks | Keys and tokens in the new commits from `--base` to HEAD. Found values are not printed (`--redact`) | `.gitleaks.toml` (rules), `.gitleaksignore` (fingerprints of past commits) |
| `vulns` | osv-scanner | Known vulnerabilities (osv.dev) in the dependencies in `uv.lock`, `package-lock.json` (the root, `site/` and `site/motion/`) and the 19 `Cargo.lock` files | `osv-scanner.toml` (exceptions, each with a reason and a review date) |
| `crates` | cargo-deny | For the 19 Cargo workspaces (`CARGO_WORKSPACES`): the licenses of the dependencies, their sources (crates.io and the allowed git repositories) and dependencies given without a version. Only the dependencies built for the two systems the app ships for (Windows and Linux on x64) are checked | `deny.toml` |

- actionlint checks `run:` scripts with the shellcheck pinned in `mise.toml` (0.11.0) (decided on 2026-11-21 in decision 3 of #833). What shellcheck finds differs between versions, so `doctor` accepts only the pinned version of shellcheck. The pyflakes check is turned off (there are no `shell: python` steps for pyflakes to read).
- With `GH_TOKEN` set, zizmor also runs the audits that query GitHub (whether a pinned commit really belongs to that action, and whether a version has known vulnerabilities). CI passes the workflow token (read-only). Locally, without `GH_TOKEN`, those audits are skipped.
- Every exception you add needs a reason.
- The licenses in `deny.toml` follow [the license register](voice-stack/licensing.md). Permissive licenses (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode-3.0 and others) are allowed for any crate; MPL-2.0 and CDLA-Permissive-2.0 are allowed only for the crates checked in the register. If a new dependency stops the check, record it in the register first, then add it to `deny.toml`. cargo-deny is not used for known vulnerabilities.
- For gitleaks, the 56 findings from the scan of the whole history (4,806 commits) on 2026-11-21 are excluded, split into rules (hashes in measurement results, WebSocket values in tests and encrypted keys) and a list of fingerprints of past commits. None of them were secrets. In CI, gitleaks reads only the commits that the pull request, push or merge queue added.
- osv-scanner does not read `tools/translation_onnx/requirements.txt`, because it cannot resolve torch's local version (`+cpu`); nothing from that file goes into the release package. An advisory that is not listed in `osv-scanner.toml` also fails the `vulns` step in CI (decided on 2026-11-21 in #835). An advisory that cannot be fixed yet becomes an exception in `osv-scanner.toml`, with a reason and a review date (`ignoreUntil`). After that date the exception expires and the check fails, so either fix the problem or extend the exception with the reason it still cannot be fixed and a new date. As of 2026-11-21 there were 9 exceptions, and an update within the same major version fixes none of them (unmaintained crates, and `glib` 0.18 for GTK 3).
- lychee does not read `site/`. The guide's pages link to each other by route (such as `requirements`), not by file, and the check after the site build (`tools/check_site_anchors.mjs`) covers those links. When you delete a file that other files link to, replace the links in dated records with GitHub links pinned to a commit from before the deletion.
- In CI, only `crates` runs in a separate workflow, `rust-crates.yml`. It needs every dependency fetched, so it runs only for pull requests that change `Cargo.toml`, `Cargo.lock`, `deny.toml` or similar files, and for pushes to develop and main.

## TypeScript and styles in the UI (migration in progress)

Under [ADR-010](adr/adr-010-frontend-stack.md), the UI moves from JavaScript to TypeScript in stages. The move of the styles from SCSS Modules to vanilla-extract finished in #957. Until the move to TypeScript finishes, JavaScript and TypeScript are mixed. The conventions for the mixed period are below (a proposal set in the first stage, to be confirmed in review).

- Write new logic and views in TypeScript (`.ts`, or `.tsx` for files with JSX). Write styles with vanilla-extract (`.css.ts`). Do not use SCSS.
- Type checking is `npm run typecheck`. `check --scope ui` runs it too, and so does CI. TypeScript files are checked with `strict`. JavaScript files are not checked; their types are only inferred when they are read.
- Type checking runs with two configurations: `tsconfig.json` for the app's source, and `tsconfig.test.json` for the tests (`*.test.ts`) and the test infrastructure (`src-ui/logics/test/`). The tests and the infrastructure run in Node, so only `tsconfig.test.json` reads the Node types (`@types/node`). If the app's source uses a Node API by accident, the `tsconfig.json` check stops it.
- Do not use `any`, `as unknown as`, `@ts-ignore` or `@ts-expect-error`. Take values from the backend as `unknown` and narrow them. Keep the existing runtime shape checks as well. `test_typescript_strictness.py` in `check --scope tooling` counts these.
- The order of the move and what remains are in [the TypeScript migration plan](typescript-migration.md).
- Keep TypeScript source in a form that becomes JavaScript by erasing the types alone (a form that also runs as it is under Node's type stripping). Use only erasable syntax (no `enum`, `namespace` or constructor parameter properties), write type-only imports as `import type`, and write relative imports with the extension, as in `./name.ts`. `erasableSyntaxOnly`, `verbatimModuleSyntax` and `allowImportingTsExtensions` in `tsconfig.json` check this.

### UI tests (Vitest)

The UI tests run on Vitest. The configuration is `vitest.config.js`; it does not read the app's Vite configuration (the SVG, YAML and vanilla-extract plugins). The environment is Node, with no DOM.

```sh
npm test                 # run every test once (same as check --scope node)
npx vitest run src-ui/logics/common/meterValue.test.ts   # narrow to one file
npm run test:watch       # watch for changes and rerun
npm run test:coverage    # coverage (HTML and json-summary in build/coverage/ui)
```

- Coverage counts the source in `src-ui` minus the tests, the test infrastructure, type declarations and styles (`.css.ts`) (`coverage` in `vitest.config.js`). Styles are also left out of mutation testing.
- Assertions use `node:assert/strict`. Import `test` and `vi` from `vitest`.
- Register cleanup with `context.onTestFinished(fn)`. `src-ui/logics/test/vitestSetup.ts` calls the callbacks in the order they were registered, as node:test's `after` does (Vitest's default is the reverse order).
- Fake clocks use `vi.useFakeTimers({ toFake: [...] })` and `vi.advanceTimersByTime(ms)`. Real time comes back when the test ends. `vi.spyOn` is undone before the next test (`restoreMocks`).
- Vite also transforms the source that `loadModule` in `hookHarness.ts` loads (`src-ui/logics/test/harnessModules.ts`). For a module loaded with `?harness`, after the TypeScript and JSX transforms, its imports and exports are wrapped in a function that takes `require` and `exports`. `loadModule` calls that function with the stand-ins the test passed. As before, the top level of the source runs again on every load. Source loaded this way also counts toward coverage and is a target of mutation testing.
- `loadModule` does not load an import that the test did not pass (it stops with `Unexpected dependency`). To make the module use the same singleton as the test (such as `settingsWriteResponses.ts`), pass the module that the test file imported, as it is (`useStdoutToPython.test.ts`).
- `import.meta.hot` (Vite's hot module replacement) is one of the stand-ins too. If the test passes it under the name `HOT_DEPENDENCY` (`harnessModules.ts`), the module uses it. If not, it is `undefined`, as in a build. A test that carries state across a replacement passes the same stand-in and loads the module again (`useHotkeys.test.ts`).
- When you move an existing `.js` file to `.ts`, rewrite every reference in the same commit: the imports in views, the loading in tests, and the paths that Python tests or tools point to.
- `src-ui/views/app/_index_css/variables.css` is the source of truth for the values of the design tokens. From vanilla-extract, `vars` in `src-ui/views/theme/vars.css.ts` refers to the same variables. When you add a token, write it in both (`vars.test.ts` detects any mismatch).
- Radix UI is used for behavior and accessibility; the look comes from vanilla-extract. When you add a Radix component, check whether it inserts a `<style>` element at runtime. The CSP allows inserted styles by hash, and `contentSecurityPolicy.test.ts` counts them.

### UI lint and formatting (Biome)

The UI's TypeScript and JavaScript are linted and formatted with [Biome](https://biomejs.dev/). Its version is pinned in `mise.toml` (`mise install` installs it), and its configuration is `biome.json`. `check --scope ui` runs `biome lint` and `biome format`. Both only check and do not rewrite files.

```sh
biome lint                     # lint (targets: files.includes in biome.json)
biome format                   # check formatting (targets: formatter.includes)
biome format --write <file>    # format
biome lint --write <file>      # apply only the safe automatic fixes
```

- The targets are `.ts` and `.tsx` in `src-ui`, `.ts` in `locales`, `.mjs` in `tools/`, and `.js` and `.mjs` at the root of the repository. `site/` is handled by another tool, so it is not included.
- Lint uses the recommended rules (`preset: "recommended"`). The rules that had violations when Biome was introduced are set to warnings (`warn`) in `biome.json` and do not stop `check`. The rules that had none stay errors, so a new violation stops it.
- The Playwright domain rules (`domains.playwright`) are turned off. Biome turns them on automatically when it sees the `@playwright/test` dependency, but the Playwright tests (`tests/integration/`) are outside the targets, and inside the targets those rules wrongly flag functions named `describe`.
- For now, formatting applies only to the files in `formatter.includes` (the configuration files at the root of the repository and `.mjs` in `tools/`). `src-ui` and `locales` are not formatted.
- Indentation and line endings follow `.editorconfig` (`useEditorconfig`). The line width is 120 characters.
- To turn a rule off in one place only, write `// biome-ignore lint/<group>/<rule>: <reason>` with a reason. ESLint comments (`eslint-disable`) have no effect.
- The `.eslintrc.json` and the ESLint dependencies that used to be here were removed. `check` did not call them, and no check used them.

### Integration tests (Playwright)

These tests operate the UI and check, in a single test, the whole path through the core and the Rust crates, out to what leaves the app and back to the result on screen ([ADR-017](adr/adr-017-integration-tests-through-the-core.md)). They live in `tests/integration/` and run with Playwright in both Chromium and WebKit. In CI, the `integration` job in `voice-tests.yml` runs them on Linux and Windows for every pull request. Tests that go through the shell and the OS in the form of the release package (`tests/platform`, `tools/native_acceptance.py`) are called E2E and are not covered here.

```sh
python tools/dev.py setup --scope ui
python tools/dev.py setup --scope integration    # fetch the host's dependencies, Chromium and WebKit
python tools/dev.py check --scope integration    # build the host and the UI, and run in both browsers
# after building, run with fewer browsers or files
node node_modules/@playwright/test/cli.js test --config tests/integration/playwright.config.ts --project chromium translationCatalog.spec.ts
```

- The UI page, `tests/integration/app/`, loads the app's real entry point (`src-ui/views/app/index.tsx`). Before loading it, the page installs Tauri's official fake (`mockIPC` from `@tauri-apps/api/mocks`). Only the exchanges with the core (`backend_start`, `backend_write`, `backend_kill`) go over WebSocket to the core's host; the fakes in `tauriStandIns.ts` answer the other Tauri calls. The app's code has no branches for tests.
- The core's host, `native/browser-core-bridge`, starts the core with the same fake `Services` as `native/core/tests/common` (audio devices, TTS output, OSC, recording and an in-memory store for keys) and connects it to the UI over WebSocket. Each test starts one host, with its own settings folder and port.
- Fakes in `standIns.ts` take the place of the external services (the translation API, the TTS server and the OSC receiver), and the test checks what reached them. Tests can also read the files in the settings folder (`config.json`, `translation_catalog.json`, logs) (`fixtures.ts`).
- When you make the app call a new Tauri command, add an answer for it to `tauriStandIns.ts`. A call with no answer is recorded, and the test fails there.
- At the end, each test checks that the page had no errors and that no Tauri call went unanswered.
- Playwright's WebKit is built for Ubuntu, and on other Linux distributions it may not start because OS libraries are missing. On Ubuntu, `node node_modules/@playwright/test/cli.js install-deps chromium webkit` installs them. If you cannot run WebKit locally, run Chromium only and leave WebKit to CI.
- Results are in `build/integration/results` (screenshots and traces of failed tests).

### Mutation testing for the UI

Mutation testing puts small deliberate changes (mutants) into the source and checks whether any test fails. Coverage only looks at whether code ran; mutation testing measures whether the tests notice a difference in values. The tool is [@mizchi/mutator](https://www.npmjs.com/package/@mizchi/mutator) (pinned to 0.2.0). It does not run in CI; you run it by hand. When to run it is in "When to run mutation testing" below.

```sh
npm run test:mutation                                                  # the whole target set
npm run test:mutation -- --include src-ui/logics/flow/flowGraph.ts    # narrow to one file
npm run test:mutation -- --reporter text --reporter json               # also write every result to .mutator/report/mutation.json
npm run test:mutation -- --reporter agent > build/mutants.json         # list of undetected mutants (key, location, covering tests)
npx mutator accept <key> --reason "<why it was judged equivalent>"     # record an equivalent mutant
```

The targets are listed in `mutator.config.mjs`: `.ts` and `.tsx` in `src-ui/logics` and `src-ui/views`, excluding styles (`.css.ts`), type declarations, and the tests and their infrastructure. mutator inserts mutations during Vite's transform. Besides the source that the tests import, the hooks, bridges and components loaded through `loadModule` (`hookHarness.ts`) or `loadBridgeRoutes` (`bridgeHarness.ts`) also go through Vite, so they can be targets too. Mutations in source that no test runs count as NoCoverage and are included in the score.

How to read the results:

| Status | Meaning | Counted as |
|---|---|---|
| Killed / Timeout | A test failed or hung | Detected |
| Survived | Tests ran, but none failed. `not infected` means that no test gives an input for which the original and the mutant produce different values | Undetected |
| NoCoverage | No test runs that line | Undetected |
| CompileError | Not run because the types do not match (decided by `tsc`) | Not in the denominator |
| Ignored | Code that only logs (`console.*` and similar), or an equivalent mutant recorded in `mutator.accepted.json` | Not in the denominator |

The score is detected ÷ (detected + undetected).

- Read the code for each undetected mutant and decide whether a test is missing or the mutant is equivalent, that is, no input changes the result. If it is equivalent, record it with a reason using `npx mutator accept` and commit `mutator.accepted.json`. If a recorded line changes, the next run reports the record as stale.
- No kind of mutation is excluded (`excludedMutators`). String replacement (`StringLiteral`) often produces equivalent mutants, but it also found many real gaps, such as endpoint names in tables and node IDs.
- In a test that passes stand-ins to `loadModule`, the replaced source does not run. For a file with many undetected mutants, check how the tests that use the file load it before you decide whether the mutants are equivalent. A module that Node loads directly from a `data:` URL is invisible to mutator. Tests load source through `loadModule` or import.
- Vitest 5 keeps transformed modules in `node_modules/.vitest-cache` (`fsModuleCache`, on by default). mutator does not tell this cache apart from its own instrumentation. So when you run with different targets, uninstrumented modules are loaded, almost everything becomes NoCoverage without any error, and the score drops to near 0%. `npm run test:mutation` uses `vitest.mutator.config.js` (a configuration with this cache turned off). Do not run it with another configuration, as in `npx mutator --config vitest.config.js`.
- The result cache is in `.mutator/` (ignored by Git), and the next run reuses the results where the function and the tests have not changed. 0.2.0 keeps only the results of the last run, so a full run after a run narrowed with `--include` reruns almost everything. Runs share `.mutator/`, so do not run two at the same time in one working tree.
- When you do a full run after a run narrowed with `--include`, add `--full-dry-run`. Without it, part of the coverage collection uses the results of the narrowed run, and mutations in files that were not targets in that run are counted as NoCoverage (this happened on 2026-11-21 with 64 files and about 3,600 mutants).
- Also add `--full-dry-run` when you narrow a run with an `--include` range that differs from the previous run. Without it, even mutations in files whose tests pass can all show up as NoCoverage (this happened on 2026-11-23 with 438 mutants in `views/app/io_flow`).
- A full run from scratch took about 35 minutes locally (Linux, 16 in parallel) (2026-11-21, 40,552 mutants). When much of the previous run's results can be reused, it ends in a few minutes. When you report results, give the target range and the measurement conditions (version, parallelism, hardware), and do not present the score as a guarantee of quality.
- A problem has been reported in 0.2.0 where the path separators do not match on Windows and nothing is instrumented (Issue #550). These steps were checked on Linux.

### Rust coverage and mutation testing

Rust coverage is measured with [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov) and mutation testing with [cargo-mutants](https://mutants.rs/). Both have their versions pinned in `mise.toml` (`cargo:cargo-llvm-cov`, `cargo:cargo-mutants`; cargo builds them from source, so the first install takes a few minutes). As decided in [Issue #550](https://github.com/kein5/astarot/issues/550) and #871, they are used as follows.

- For coverage, the `rust-coverage` job in `voice-tests.yml` in CI measures the figures per crate for every pull request and every push to develop and main, and shows them as a table in the job summary (Summary). There is no threshold, and CI does not fail when the figures drop. You can measure locally with the same tool (`tools/rust_coverage.py`).
- Mutation testing does not run in CI; you run it by hand. When to run it is in "When to run mutation testing" below.

```sh
mise install cargo:cargo-llvm-cov cargo:cargo-mutants
rustup component add llvm-tools --toolchain 1.100.0

# coverage (every crate, or narrow with --crate; the same table as the CI job)
python tools/rust_coverage.py
python tools/rust_coverage.py --crate native/ops
cargo llvm-cov --locked --manifest-path native/ops/Cargo.toml --summary-only
cargo llvm-cov report --manifest-path native/ops/Cargo.toml --show-missing-lines   # lines the previous run did not reach

# mutation testing (narrow to files)
cd native/ops && cargo mutants -j 4 --cargo-arg=--locked -f src/downloads/catalog.rs
cd native/core && PROPTEST_DISABLE_FAILURE_PERSISTENCE=1 cargo mutants --in-place --cargo-arg=--locked -f src/voice_settings.rs -- --lib
```

- The `native/` crates are not one workspace; each has its own `Cargo.lock`. Coverage is measured per crate, with that crate's own tests only. Code reached from the core's integration tests does not count in that crate's figure, and neither do the tests that need a real PipeWire (`--ignored`). So that coverage can be measured even when tests fail, `tools/rust_coverage.py` passes `--ignore-run-fail` and lists the failing crates in the table.
- cargo-mutants does nothing unless all tests pass without mutations.
- By default, cargo-mutants copies the crate to a temporary folder and mutates the copy. In `native/core`, the relative paths to sibling crates differ between the normal dependencies and the test dependencies, so the copy does not build. It is therefore run with `--in-place` (mutating in place, one mutant at a time). Do not edit that crate's files while it runs.
- proptest writes failing inputs to `proptest-regressions/` and tries them first in the next run. Inputs that failed against mutated code are not worth keeping, so mutation testing runs with `PROPTEST_DISABLE_FAILURE_PERSISTENCE=1`.
- When you run in parallel with `-j`, do not set `CARGO_TARGET_DIR`. cargo-mutants copies the crate for each parallel job and builds in the copy's target. With `CARGO_TARGET_DIR` set, the parallel jobs share one target and may run the tests on the build of a different mutant (on 2026-11-23, one run recorded the failure of a different mutant as "caught"). For `native/core`, which runs one mutant at a time with `--in-place`, you can leave it set. `mise run mutation:changed` removes `CARGO_TARGET_DIR` from what it passes on for parallel runs.
- Target pure logic, and leave out modules whose tests depend on time or waiting (their results vary from mutant to mutant). With `-- --lib`, only the unit tests run. Mutations that only the integration tests check go undetected, so when you report results, also state which tests ran.
- Results are in `mutants.out/`: `caught.txt` (detected), `missed.txt` (undetected), `timeout.txt` and `unviable.txt` (mutations that do not build; not in the denominator). Read the code for each undetected mutant and decide whether a test is missing or the mutant is equivalent, that is, no input changes the result.
- The boundaries of pure functions can be checked with property-based tests ([proptest](https://proptest-rs.github.io/proptest/), a test dependency of `native/core`). Write properties that hold for any input, such as normalizing a normalized result again changes nothing, or saving and reading back gives the same value.

### Mutation testing for changed code

`mise run mutation:changed` (`python tools/mutation_changed.py`) runs mutation testing only on what your working branch changed. It looks at both the UI and Rust, and runs only the side that has changes ([Issue #550](https://github.com/kein5/astarot/issues/550), Phase 3).

```sh
mise run mutation:changed                                 # changes since the fork point from origin/develop
mise run mutation:changed -- --base astarot/develop       # when you fetch develop from a remote with another name
mise run mutation:changed -- --dry-run                    # only show what would run
mise run mutation:changed -- --ui-only                    # the UI only (--rust-only for Rust only)
```

- The changes are the diff from the fork point of `--base` and HEAD to the working tree. Uncommitted changes are included. New files count once you `git add` them.
- For the UI, mutator's `--since` runs and reports only the mutations inside the diff. The targets are the same as in `mutator.config.mjs`. The score shown is the score of the changed code.
- For Rust, cargo-mutants' `--in-diff` runs only the mutations inside the diff, for each crate in `NATIVE_CRATES` in `tools/dev.py` whose `src/` changed. As in the section above, `native/core` runs with `--in-place` and only its unit tests (`-- --lib`).
- Survived mutants do not make the run fail. Read each one and decide whether a test is missing or the mutant is equivalent (the two sections above). The run fails only when a tool could not run (for example, when tests fail without mutations).
- Results are in `.mutator/report/` for the UI and in `<crate>/mutants.out/` for Rust.

### When to run mutation testing

Phase 3 of [Issue #550](https://github.com/kein5/astarot/issues/550) decided the following (2026-11-23, decision in PR #975). Mutation testing does not run in CI.

- For a pull request that changes UI logic (`src-ui/logics`, `src-ui/views`) or the `src/` of a Rust crate, running `mise run mutation:changed` is recommended. It is not required. If you run it, write the numbers of Survived and NoCoverage mutants, and whether you read each one, in the "Verification" section of the pull request description. If you do not run it, write why (the pull-request skill).
- Before a stable release, run the whole UI side and all of the main Rust crates (the list below) (the release skill). Do not run it for betas.
  - UI: `npm run test:mutation -- --full-dry-run --reporter text --reporter json`. Every result goes to `.mutator/report/mutation.json`. Locally (Linux, 16 in parallel) it took from 40 minutes to two and a half hours (depending on the load on the machine). The run is long, so run it detached from the terminal.
  - Rust: run the whole list of main crates at each milestone (2026-11-23, decision in PR #982). The list is the pure logic, independent of time and waiting, that #871 and `native/translation/.cargo/mutants.toml` have targeted. To change the list, edit this table.

    | Crate | Targets | Tests run | Command (in the crate's folder) |
    |---|---|---|---|
    | `native/ops` | `catalog.rs`, `speechcpp.rs`, `translation_catalog.rs`, `verification.rs` and `user_models.rs` in `src/downloads/` | All | `cargo mutants -j 4 --cargo-arg=--locked -f src/downloads/catalog.rs -f src/downloads/speechcpp.rs -f src/downloads/translation_catalog.rs -f src/downloads/verification.rs -f src/downloads/user_models.rs` |
    | `native/core` | `src/voice_settings.rs`, `src/languages.rs` | Unit only | `PROPTEST_DISABLE_FAILURE_PERSISTENCE=1 cargo mutants --in-place --cargo-arg=--locked -f src/voice_settings.rs -f src/languages.rs -- --lib` |
    | `native/tts` | `src/onset.rs` | Unit only | `cargo mutants -j 4 --cargo-arg=--locked -f src/onset.rs -- --lib` |
    | `native/transcription` | `src/diagnostics.rs` | Unit only | `cargo mutants -j 4 --cargo-arg=--locked -f src/diagnostics.rs -- --lib` |
    | `native/translation` | `hepburn.rs` and `mod.rs` in `src/transliteration/` (`.cargo/mutants.toml`) | All | `cargo mutants -j 3 --cargo-arg=--locked` |
- Keep the results of full runs in issues. For now, comment on #550; after #550 is closed, open a record issue for each milestone. Do not put the results in the repository's documents. The figures depend on the measurement conditions (version, parallelism, hardware), and a document makes them easy to read as a guarantee. A report gives the target range and the conditions, and does not present the score as a guarantee of quality.

## Checking UI text and translations

`locales/en.yml` and `locales/ja.yml` are the source of truth for the text shown to users. The UI takes text out with `t("key")` and does not write it in the code. This covers labels, buttons, descriptions, notifications, dialogs, validation messages, tooltips, the names and descriptions read out by screen readers, and the text that shows backend errors.

`tools/i18n_gate/check.mjs` checks this. It is part of `check --scope node` and `check --scope ui`, and it runs in CI too. On failure it shows the file, the line and the cause.

```sh
node tools/i18n_gate/check.mjs                    # check only
node tools/i18n_gate/check.mjs --inventory        # count the known hard-coded text by place and kind
node tools/i18n_gate/check.mjs --update-baseline  # rewrite the baseline after reducing hard-coded text
```

It checks the following:

- English and Japanese have the same set of keys. No value is empty.
- The `{{name}}` interpolation variables form the same set of names as in English.
- Plurals (`_one`, `_other` and so on) have every form the language needs. The target of each `$t(key)` exists.
- The keys that the UI names exist in `en.yml`. This covers `t()`, `i18n.t()`, `i18nKey`, the fixed part of a template (`main_page` in `` t(`main_page.${id}`) ``) and strings that look like keys in a known namespace.
- There is no new hard-coded text in JSX strings, in attributes that users see (`title`, `placeholder`, `alt`, `label`, `aria-label` and others), in the `label` of options or in similar places.

The hard-coded text that existed when the check started is recorded in `tools/i18n_gate/baseline.json` as a count per file. The check fails when a count goes up. It also fails when a count goes down, until you rewrite the baseline with `--update-baseline`, so that removed hard-coded text does not come back.

A string that is not translated becomes an exception, with a reason.

- Add product names, service names, protocol names and units to `terms` in `tools/i18n_gate/exceptions.yml`.
- For a single line, write `// i18n-exempt: reason` at the end of that line or on the line before it (`{/* i18n-exempt: reason */}` inside JSX).
- For several consecutive lines, enclose them in `// i18n-exempt-start: reason` and `// i18n-exempt-end`.

User input, names received from outside, protocol identifiers and strings written only to logs are not subject to translation in the first place, and the check does not treat them as UI text either. Where a key is built before it is passed (such as `` t(`backend_errors.${code}`) ``), only the fixed part can be checked, so tests cover the rest.

## Checking prose (docs/writing)

The rules for prose are set in [the Japanese writing guideline](writing/japanese-guideline.md) and [the English writing guideline](writing/english-guideline.md). `tools/writing_gate/check.mjs` checks the rules among them that a pattern can catch. It is part of `check --scope node`, and it runs in `check` (the light checks) and in CI as well. On failure it shows the file, the line and the rule.

```sh
node tools/writing_gate/check.mjs                      # check only
node tools/writing_gate/check.mjs --inventory          # count the findings by rule and by place
node tools/writing_gate/check.mjs --update-baseline    # rewrite the baseline after fixing violations
node tools/writing_gate/check.mjs --file <file>        # check text outside the repository, such as a PR description or a report (--user reads it as user-facing text)
```

- It reads the Markdown that git tracks, the manual's `.mdx` files and the text in `locales/*.yml`. It does not read code blocks, inline code, URLs, link targets, HTML or quotes (lines that start with `>`). Generated files and files brought in from elsewhere are left out through `tools/writing_gate/exceptions.yml`. Code comments fall under the guidelines, but the gate does not read them for now (decision of 2026-11-23).
- The rules are in `tools/writing_gate/rules.mjs`, and each one notes the guideline section it comes from. The Japanese rules apply to lines that contain kana, and the English rules to lines written only in Latin script. The rules for user-facing text apply to `site/`, `docs/readmes/`, the release notes and `locales/`.
- A heading that gives both languages puts English first ("Summary / 概要"; decision of 2026-11-23).
- The release notes (`docs/release-notes/<version>.md`, not its README) are also checked for commas and line breaks (`tools/writing_gate/release_notes.mjs`, decided on 2026-11-25 in PR #1157). A Japanese sentence with four or more 「、」 outside brackets, and a comma that only makes a pause after a short noun topic at the start of a sentence (「Windowsでは、」), are flagged; a comma after a condition or a purpose is not. A paragraph must be one line, blocks are separated by one blank line, a heading has a blank line before and after it, and no line ends in spaces or in 「：」. A beta's notes are not in the repository: copy them under `docs/release-notes/` for the check (`--file docs/release-notes/<file> --user`) and delete the copy afterwards.
- Where a document lists forms to avoid as bad examples, exclude those places with markers. A reason is required.

  ```md
  <!-- writing-exempt-start: lists forms to avoid as bad examples -->
  ...
  <!-- writing-exempt-end -->
  | サーバ | サーバー | <!-- writing-exempt: bad example -->
  ```

  A marker at the end of a line excludes that line; a marker on a line of its own excludes the next line.

- The violations that existed when the check started are recorded in `tools/writing_gate/baseline.json` as counts per file, rule and word. The check fails when a count goes up. It also fails when a count goes down, until you rewrite the baseline with `--update-baseline`, so that fixed forms do not come back. Existing violations are fixed area by area, one pull request per area (decision of 2026-11-23).
- The rules that need a person's judgment are not checked: the role of the document, whether the conclusion comes first, the direction of the argument, whether revision changed the meaning, and the like. Check them with the final section of each guideline ("書いたあとの確認" in the Japanese one, "Checklist" in the English one), and write in the "Verification" section of the pull request description that you went through them and what came out (the pull-request skill).

## Testing VR handling without VR hardware

From 0.5.0, the Rust core handles the VR overlays (`native/vr-overlay`, `native/openvr-client`). The core's tests use a fake SteamVR (`runtime::fake::FakeVr` in `native/vr-overlay`). It holds controller poses and buttons, and answers where the laser hits from the positions of the overlays that have been placed. The tests are `native/vr-overlay/tests/interaction.rs` and `native/core/tests/vr_overlay.rs`, and they are part of `check --scope rust`. Details are in [the crate's README](../native/vr-overlay/README.md).

The Python backend's fake SteamVR (`src-python/test/fake_openvr.py`), and `tools/run_with_fake_vr.py` and `tools/fake_vr_site`, which plugged it into the backend, were removed together with the backend in 0.6.0 (#285). The 0.5.0 app does not start the Python backend, so they were not connected to the app's VR. For now, there is no procedure for running the whole app against a fake SteamVR.

## EditorConfig and commit format

`.editorconfig` sets UTF-8, LF and a final newline. The base indentation is four spaces, and two for JSON/YAML/TOML/HTML/CSS/SCSS. Trailing spaces in Markdown, and the whitespace and final newline in patch/diff files, carry meaning, so they are not stripped across the board. The settings apply to the files you edit in an editor from now on. Biome formats the UI's TypeScript and JavaScript with the same settings ([UI lint and formatting](#ui-lint-and-formatting-biome)). No command was added to reformat the other existing files in bulk. Use an editor or extension that supports [the EditorConfig specification](https://editorconfig.org/).

Cocogitto is a tool for Conventional Commits, and its command is `cog`. For example, `feat(dev): add developer checks` is a feature addition and `fix(tts): preserve cancellation state` is a bug fix. The format follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

```sh
# install the Git hooks into this clone (hk.pkl: commit-msg and pre-commit; runs hk install)
python tools/dev.py setup --scope hooks

# check only the message; no commit is created
cog verify "feat(dev): add developer checks"

# name a ref that exists locally as the base
python tools/dev.py check --scope commits --base origin/develop

# show the changes for the next release without writing them
python tools/changelog.py print
```

The hook rejects a malformed message before the commit is made. It lets merge commits and `fixup!`, `squash!` and `amend!` commits through (CI rejects the latter). How to choose the type, how to install the hook, what to do when you are stuck, the changelog categories and the release steps are in "Commit messages" and "Changelog and releases" in [CONTRIBUTING.md](../CONTRIBUTING.md).

The CLI finds the common ancestor of the given ref and HEAD, and passes only the commits after it to `cog check`. If the base does not exist, it stops with exit code 2; it does not fetch automatically or switch to the whole history. In CI it runs after the base and head of the pull request have been fetched. It also stops when the fetch depth is too shallow to find the common ancestor.

There is no need to go back through the existing history to fix its format. `cog check` without arguments examines the whole history, so normally use the range given above. Merge commits are excluded in the settings; fixup commits are not. CI checks the commits of pull requests and the commits pushed to develop and main. You can also refer to the official documentation on [checking history](https://docs.cocogitto.io/guide/check.html), [Git hooks](https://docs.cocogitto.io/guide/git_hooks.html) and [the changelog](https://docs.cocogitto.io/guide/changelog.html).

`tools/changelog.py` writes `CHANGELOG.md` when a stable release is being prepared. It lists stable releases only, and summarizes the changes since the previous stable release. Notes for a beta are made from the commits since the previous tag. Cocogitto's `cog changelog` parses the commits, and this script decides the split into user-facing and internal changes and the format. The heading for each type is in `[commit_types]` in `cog.toml`. The tests are in `tests/devtools/test_changelog.py`.

The development CLI does not install hooks on its own. To install them, a developer runs `setup --scope hooks` ([hk](#git-hooks)). Without hk, `cog install-hook commit-msg` installs the same check from `cog.toml` (on 2026-11-21, decision 2 of #837 moved this to hk). The development CLI also leaves out `cog edit`, which rewrites history, `cog bump`, which creates versions and tags, commit/push and publishing hooks. As before, the version is decided in `package.json` and applied with `npm run update-version`, and the tag is created when the GitHub Releases draft is published.

## Git hooks

`hk.pkl` holds the settings for the Git hooks that hk runs. To use them, run `python tools/dev.py setup --scope hooks` (`mise run setup:hooks`, which runs `hk install`) once per clone. The development CLI does not install hooks during any other setup or check (decided on 2026-11-21 in #837). With Git 2.54 or later, the hooks go into the Git config (`hook.<name>.command`) without rewriting `.git/hooks/`. The installed hooks go through mise's shims, so hk and the tool for each step run at the versions in `mise.toml` (run `mise install` first).

| Hook | Step | What it checks |
| --- | --- | --- |
| pre-commit | gitleaks | Keys and tokens in the staged changes. Found values are not shown |
| pre-commit | actionlint (including shellcheck), zizmor | Changed workflows and our own actions. Same settings as `check --scope workflows` |
| pre-commit | Biome | Lint and formatting of changed TypeScript and JavaScript in the UI. Same settings as `check --scope ui` (`biome.json`); files outside the targets are not read. The rules not yet fixed are warnings, so they do not stop the commit |
| pre-commit | lychee | Links in changed Markdown (except `site/`). Does not query external sites |
| commit-msg | cocogitto | Conventional Commits (`cog.toml`). Like the hook in `cog.toml`, lets `fixup!`, `squash!` and `amend!` commits through (CI rejects them) |

- No step rewrites files. To skip the hooks once, use `HK=0 git commit ...`.
- The commit message hook moved to hk (2026-11-21, decision 2 of #837). Without hk, you can also install it with `cog install-hook commit-msg`. In a clone with both installed, Git 2.54 or later checks the message twice (this does no harm). hk's commit-msg step lets `fixup!` and similar commits through for `git rebase --autosquash`, and that part is written in shell, so it runs with `sh` on Windows too.
- To run on every file, use `hk run pre-commit --all`. Even then, gitleaks reads only the staged changes. Check a range of commits with `check --scope secrets`.
- `check --scope hooks` checks `hk.pkl` with `hk validate`. The first time, it downloads the hk settings package at the pinned version from the GitHub releases.

## Use in CI and reproducibility

The CI workflows install Node, Rust, Python, uv, Cocogitto and the tools for the [repository checks](#repository-checks) with `jdx/mise-action` (pinned by commit SHA). The versions come from `mise.toml`, and the files to download and their SHA-256 come from `mise.lock`, so CI gets the same versions as a developer's machine. Each job picks only the tools it needs with `install_args`. The jobs that use uv set `UV_PYTHON_PREFERENCE=only-system` and `UV_PYTHON_DOWNLOADS=never`, so that uv uses mise's Python and does not download another one. `prepare-release.yml`, which handles the signing secrets, does not pass a token with write access to mise-action and uses no cache.

CI keeps preparation and checking apart. For example, after the dependencies are installed, it can call the same commands as below. On Windows, change the Python executable to `.venv\Scripts\python.exe`.

```sh
python tools/dev.py check --scope tooling
python tools/dev.py check --scope voice --python .venv/bin/python
python tools/dev.py check --scope lint --python .venv/bin/python
python tools/dev.py check --scope ui
python tools/dev.py check --scope integration
python tools/dev.py check --scope commits --base origin/develop
```

This CLI does not compile the voice gate for you. In Linux CI, `tools/build_voice_gate.py` and the preparation of the OS dependencies it needs keep their existing steps. Browser tests, the native app, real GPUs, microphones and acceptance tests of the release package are also separate, explicit stages.

There are three Linux helper programs (`astarot-voice-gate`, `astarot-source-bridge`, `astarot-screen-capture`). `mise run build:voice-gate` below (`tools/build_voice_gate.py`) builds them into `build/`. The helpers in `build/` are used by the app started from source and by the Rust tests that run on a dedicated PipeWire graph (such as `voice_gate_private` in `native/audio-routing`; the Linux job of the voice CI). The Python tests in `check --scope voice` compile the helpers they use into a temporary folder themselves, so they do not depend on the helpers in `build/`. Both need a C compiler, pkg-config and the PipeWire development files (`libpipewire-0.3`).

The verified audio stack is PipeWire 1.6.10 and WirePlumber 0.5.18. The helpers cannot be compiled against the PipeWire API that comes with Ubuntu 24.04, so CI first builds the pinned version in an isolated place and then builds the helpers against it (`tools/ci/setup_pipewire.sh`). The isolated setup in [the Linux build steps](voice-stack/linux-build-pipeline.md) builds the needed version from official sources with pinned hashes. It does not change the host's audio services. It is an explicit step, separate from `setup --scope headless` for Python.

```sh
mise run build:voice-gate
mise run check:voice
```

To use RVC in the app started from source, also build the RVC worker into `build/` (this needs Rust, and it is the same on Windows and Linux). The worker does not carry ONNX Runtime; it loads it from the runtime that the app downloaded with the user's consent, so this build downloads nothing. The release builds (`tools/build_linux.py`, `bat/build.bat`) run it automatically.

```sh
mise run build:rvc-worker
```

For the tests of `native/rvc-runtime` itself (`cargo test`), `ort` downloads ONNX Runtime at build time. The steps are in [the crate's README](../native/rvc-runtime/README.md).

The npm, Cargo and Python dependencies use `package-lock.json`, `Cargo.lock` and `uv.lock` respectively. For Python, what is verified is the distribution archives and the Git commits in the lock. The versions of Node, Rust, Python itself, uv and Cocogitto are pinned in `mise.toml`. The build dependencies added to the isolated environment during a source build, and the OS libraries, are not pinned. None of this guarantees bit-for-bit identical release packages or correct behavior on every machine. Verification records give the output of `doctor --json`, the scope that was run, the commit and the OS alongside the results.

### Retrying core tests in CI

The `core-integration` job in CI runs the tests of `native/core` with cargo-nextest's `ci` profile (`native/core/.config/nextest.toml`). It writes a JUnit report, and if any test passed on a retry, it lists those tests in the job summary and puts a warning on the run (`tools/ci/nextest_flaky_summary.py`).

- From 2026-11-23, no test is retried. Before that, 10 tests that sometimes failed on slow runners because they waited for a fixed time (#861) were retried up to twice. After the waiting was fixed, repeated runs on Linux and Windows confirmed that they no longer fail; this was recorded in #861 and the tests were taken off the list.
- If a test needs retries again, first write the reason in an issue, then add `[[profile.ci.overrides]]` (`filter` and `retries`) to `native/core/.config/nextest.toml`. Remove it once the issue records that the test no longer fails.
- `python tools/dev.py check --scope rust` on your machine runs with the default profile, so it does not retry.

### Weekly count of CI failures

"Weekly CI failures" (`.github/workflows/ci-failures.yml`) counts the CI failures of the last 7 days every Monday and shows them as a table in the job summary. It covers the runs for pushes to develop and for pull requests, and for each workflow and job it gives the number of failed attempts and the number that passed when the same run was rerun. Those that passed on a rerun are flaky tests or temporary outages. It does not read logs, so check each job's log to see what failed. Locally, `python3 -m tools.ci_failures --days 7` prints the same table (you need to be logged in to `gh`).

---

# ASTAROTの開発（日本語版）

開発に使うツールの版はリポジトリの直下にある `mise.toml` で固定しています。よく使う手順も [mise](https://mise.jdx.dev/) のタスクにしてあります。

```sh
mise install                 # mise.tomlの版のNode、Rust、Python、uv、Cocogittoを入れる
mise tasks                   # タスクの一覧
mise run doctor              # 足りないツールや依存を表示する
mise run setup:headless      # モデルなしの試験に使うPythonの依存を入れる
mise run setup:ui            # UIの依存を入れる
mise run check               # 軽量チェック
```

タスクの中身は `python tools/dev.py` などの既存のCLIです。miseはその前に固定した版のツールをPATHの先頭に置きます。追加の引数はタスク名の後ろに書きます（`mise run check:voice --dry-run` など）。miseを使わずに `python tools/dev.py` を直接呼んでもかまいません。そのときは、PATHにあるツールの版を自分で合わせます。

`doctor` は不足を表示します。`setup` は指定した依存関係を導入します。`check` の既定値は `quick` で、開発CLIの試験、UIの試験（Vitest）、Ruffを実行します。詳しいコマンドは各サブコマンドの `--help` で確認できます。開発CLI自体はPython 3.11以降の標準ライブラリだけで動きます。

| タスク | 中身 |
| --- | --- |
| `doctor` | `python tools/dev.py doctor` |
| `check`、`check:all` | `python tools/dev.py check`（`quick`）、`--scope all` |
| `check:voice`、`check:ui`、`check:rust`、`check:integration`、`check:workflows`、`check:crates`、`check:links`、`check:hooks` | `python tools/dev.py check --scope <名前>` |
| `check:commits`、`check:secrets` | `python tools/dev.py check --scope <名前> --base origin/develop` |
| `check:vulns` | `python tools/dev.py check --scope vulns`（osv.devに問い合わせる） |
| `setup:headless`、`setup:ui`、`setup:browser`、`setup:rust`、`setup:resources`、`setup:integration`、`setup:hooks` | `python tools/dev.py setup --scope <名前>` |
| `spec` | 機能仕様書の一覧を作り直す（中核の一覧`tools/spec_core_catalog.json`を書き直してから`python tools/spec_catalog.py --write`） |
| `adr` | ADR の索引の表を作り直す（`python tools/adr_catalog.py --write`） |
| `build:voice-gate`、`build:rvc-worker` | 音声の補助プログラムとRVCのワーカーを `build/` にビルドする |
| `build:windows`、`build:linux` | `npm run build`、`python tools/build_linux.py` |
| `changelog:print` | 次のリリースの変更を、書き込まずに表示する |
| `changelog:notes` | 正式版のリリースノートの雛形を `docs/release-notes/<版>.md` に作る。既にあれば上書きしない（[リリースノートの書式](release-notes/README.md#雛形から書き始める)） |
| `dev:web` | Web UIの開発サーバー（Vite）。検証には含めない |
| `dev:catalog` | UIの部品のカタログ（Storybook）を `http://localhost:6006` で開く（[部品](design/components/README.md)）。検証には含めない |

機能仕様書の一覧（`docs/spec/reference/` のエンドポイント、エラーコード、設定キー）は中核とUIのコードから生成します。エンドポイント、エラーコード、設定キーを変えたら `mise run spec` で作り直します。`check` はこの一覧が最新かどうかも確かめます。仕様書の入口は [docs/spec/README.md](spec/README.md) です。

設計判断の記録（ADR）の索引の表（[docs/adr/README.md](adr/README.md)）は、各 ADR の冒頭の front matter から生成します。ADR を足したり front matter を変えたりしたら `mise run adr` で作り直します。`check` は `tests/devtools/test_adr_catalog.py` で、番号の重複、項目と値、裏付けのパス、リンク、表の古さを確かめます。

開発CLI（`tools/dev.py`）の近道は、miseのタスクだけに置きます（2026-11-21）。npmのスクリプトに残すのは、npmでないと動かないものです。Vite、Tauri、アプリの起動（`npm run dev-fast` など）、Windowsの配布物のビルド（`npm run build`、`npm run release`）、UIの試験（`npm test`、Vitest）、型チェック（`npm run typecheck`）などです。miseを有効にしたシェル（`mise activate`）から呼ぶと、npmのスクリプトも固定した版で動きます。

以前はnpmにも同じ近道があり、miseと食い違っていました（npmの `check:commits` は `--base` を渡さず、範囲の検査の名前は `test:*` でした）。npmの近道は、次のmiseのタスクに替わりました。

| 以前のnpmのスクリプト | miseのタスク |
| --- | --- |
| `npm run doctor` | `mise run doctor` |
| `npm run check`、`npm run check:all` | `mise run check`、`mise run check:all` |
| `npm run check:commits` | `mise run check:commits` |
| `npm run test:voice`、`npm run test:ui`、`npm run test:integration` | `mise run check:voice`、`mise run check:ui`、`mise run check:integration` |
| `npm run setup:headless`、`npm run setup:browser` | `mise run setup:headless`、`mise run setup:browser` |

`check:commits` は、cloneしたときの `origin/develop` と比べます。リモートの名前が違うときは、`mise run check:commits --base <リモート>/develop` のように後ろに `--base` を書くと、そちらが使われます。`tests/devtools/test_dev_shortcuts.py` が、npmのスクリプトから `tools/dev.py` を呼んでいないこと、範囲のタスクの名前が範囲の名前（`check:<範囲>`、`setup:<範囲>`）とそろっていること、npmへ渡すタスクが残っているスクリプトを指していることを確かめます。

## 用意するツール

miseを[公式の手順](https://mise.jdx.dev/getting-started.html)で入れ、リポジトリで一度 `mise trust` と `mise install` を実行します。`mise.toml` の版のツールがmiseの保存先に入ります。OSに入っている同じツールは変更しません。

| ツール | 版 | 補足 |
| --- | --- | --- |
| Node.js | 26.13.1 | npmはNodeに付属するもの |
| Rust | 1.100.0 | rustupを通して入れる（profileはminimal、clippyとrustfmtを追加）。`rust-toolchain.toml` は置かない |
| Python | 3.14.10 | ビルドの道具と試験に使う。`pyproject.toml` の `requires-python` には同じマイナー版（3.14）を書く。0.5.0から配布物にPythonは入らない |
| uv | 0.13.5 | |
| Cocogitto | 7.0.0 | コマンド名は `cog` |
| Biome | 2.6.6 | UIのTypeScriptとJavaScriptのlintと整形（[UIのlintと整形](#uiのlintと整形biome)） |
| actionlint | 1.7.12 | ワークフローの書き方を確かめる |
| shellcheck | 0.11.0 | ワークフローの `run:` のシェルのスクリプトを確かめる（actionlintから呼ばれる） |
| zizmor | 1.32.0 | ワークフローの安全の問題を確かめる |
| cargo-deny | 0.20.2 | Rustのクレートのライセンス、既知の脆弱性、取得元を確かめる |
| cargo-nextest | 0.9.151 | Rustの試験を流す。コマンドは `cargo nextest`。miseのレジストリにないので、`mise.toml` の `[tool_alias]` でGitHubのリリースから取る |
| gitleaks | 8.30.1 | 履歴とファイルに鍵やトークンが入っていないかを確かめる |
| osv-scanner | 2.7.0 | ロックファイルの依存に既知の脆弱性がないかを確かめる |
| lychee | 0.24.2 | 文書とガイドのリンクを確かめる |
| hk | 2.11.1 | Gitのフックを動かす |
| ast-grep | 0.51.1 | 構文で探して書き換える。移行の作業に使い、`check` には入れない |
| syft | 1.57.0 | リリースの部品表（SBOM）を作る。`check` には入れない |

版の正本は `mise.toml` です。上の表は説明のために写したもので、食い違ったら `mise.toml` が正しいです。`mise.lock` はRust以外のツールの取得元のURLとSHA-256を、LinuxとWindowsのそれぞれについて記録しています。版を変えるときは `mise.toml` を書き換え、`mise lock --platform linux-x64,windows-x64` で `mise.lock` を作り直します。CIはこの2つのファイルから同じ版を入れます（後述）。`tests/devtools/test_toolchain_pins.py` は、版が完全に固定されていること、`mise.lock` と一致すること、ワークフローがmiseの外で版を決めていないことを確かめます。

道具の版は、公開から14日（2週間）以上たった最新の版から選びます。`mise.toml` で固定する道具（Biomeを含む）も、npmなどで入れる開発の道具も同じで、足すときも、版を上げるときも同じです。出たばかりの版が取り下げられたり、乗っ取られて差し替えられたりしたときに、巻き込まれないためです。この決まりは2026-11-20に #828 で決めたもので（元は #582）、2026-11-21に #832 で、ここに書きました。Dependabotの版の更新の提案も、公開から14日たつまで待ちます（`.github/dependabot.yml` の `cooldown`。2026-11-21に #833 で決めました）。セキュリティの更新は待たずに出ます。

uvはmise以外で入れたPython（uvが自分で取得したものを含む）を先に見つけることがあります。環境を作るタスク（`setup:*`）は `UV_PYTHON_PREFERENCE=only-system` を付けて、PATHにあるmiseのPythonを使わせます。uvのコマンドにはPythonの版を書きません（`--python 3.14` などを付けない）。uvは `pyproject.toml` の `requires-python` に合うPythonをPATHから選び、`tools/dev.py` は `mise.toml` の版を読みます。Pythonの版を上げるときに書き換えるのは、`mise.toml`、`mise.lock`、`pyproject.toml` の `requires-python`、`uv.lock` です。`tests/devtools/test_toolchain_pins.py` は、CI、タスク、bat、`tools/dev.py` がuvに版を渡していないことも確かめます。`mise.toml` の `[env]` にはuvの設定を置いていません。`[env]` の値はmiseが起動するすべてのプログラムに引き継がれるため、環境を作るタスクだけが自分で設定します。

`[env]` に置いているのは `ORT_DISABLE_TELEMETRY=1` だけです。ONNX Runtimeは、何も設定しないとセッションを作った時点で `~/.cache/Microsoft/DeveloperTools/.onnxruntime/` に `deviceid` とイベントのデータベースを作り、Microsoftへ利用状況を送ろうとします。この値はすべてのプログラムに引き継がれてかまわないため、`[env]` に置きます。`tools/dev.py` の子プロセス、翻訳モデルの書き出し（`tools/translation_onnx/`）とHuBERTの書き出し（`native/rvc-runtime/reference/export_hubert_onnx.py`）も、自分で同じ値を設定します。miseを通さずにほかのスクリプトでONNX Runtimeを使うときは、先に `ORT_DISABLE_TELEMETRY=1` を設定してください。アプリに同梱するONNX Runtimeは、アプリが起動時に自分で止めます（`docs/spec/external-interfaces.md`）。

`setup` はOSのパッケージマネージャーやグローバルインストーラーを実行しません。Python本体の自動取得も無効にしているため、miseを使わない場合は、`mise.toml` と同じマイナー版のPython（3.14）を先に用意します。miseを使わない場合の各ツールの公式手順は次のとおりです。

| ツール | 公式手順 |
| --- | --- |
| Python | [Python downloads](https://www.python.org/downloads/) |
| uv | [uv installation](https://docs.astral.sh/uv/getting-started/installation/) |
| Node.js / npm | [Node.js downloads](https://nodejs.org/en/download) |
| Rust / Cargo | [Rust installation](https://www.rust-lang.org/tools/install) |
| Cocogitto | [Cocogitto installation](https://docs.cocogitto.io/) |
| actionlint | [actionlint installation](https://github.com/rhysd/actionlint/blob/main/docs/install.md) |
| shellcheck | [ShellCheck installing](https://github.com/koalaman/shellcheck#installing) |
| zizmor | [zizmor installation](https://docs.zizmor.sh/installation/) |
| cargo-deny | [cargo-deny](https://embarkstudios.github.io/cargo-deny/) |
| cargo-nextest | [cargo-nextest installation](https://nexte.st/docs/installation/pre-built-binaries/) |
| gitleaks | [gitleaks](https://github.com/gitleaks/gitleaks#installing) |
| osv-scanner | [OSV-Scanner installation](https://google.github.io/osv-scanner/installation/) |
| lychee | [lychee installation](https://github.com/lycheeverse/lychee#installation) |
| hk | [hk getting started](https://hk.jdx.dev/getting_started.html) |
| ast-grep | [ast-grep quick start](https://ast-grep.github.io/guide/quick-start.html) |
| syft | [Syft installation](https://github.com/anchore/syft#installation) |

LinuxのTauri検証にはWebKitGTK 4.1などの開発ライブラリも必要です。必要なパッケージは[Linuxビルド手順](voice-stack/linux-build-pipeline.md)にあります。`doctor --scope rust` は主要ライブラリをpkg-configで調べます。WindowsではTauri用のC++ビルド環境などを別途用意します。Rustのコンパイル成功は、インストーラーの実機確認とは別です。

Linuxのトレイ用ライブラリは `ayatana-appindicator3-0.1` または `appindicator3-0.1` のどちらかがあれば診断を通します。Ubuntu向けのAyatanaパッケージ名を他のディストリビューションへ一律に要求しません。[Tauriの前提条件](https://v2.tauri.app/start/prerequisites/)と、使用中のlibappindicator-sys 0.9.0が両方のライブラリを扱う実装に合わせています。

## 依存関係の準備

`setup` はスコープを1つずつ指定します。通信を伴うコマンドなので、先に `--dry-run` で確認できます。キャッシュだけで準備するときは `--offline` を付けます。

| スコープ | 実行内容と保存先 |
| --- | --- |
| `headless` | `uv.lock` の `voice-test` グループだけを `build/dev/headless-venv` に同期 |
| `ui` | `npm ci --ignore-scripts` でルートの `node_modules` を準備 |
| `browser` | `uv.lock` の `voice-ui-test` グループを `build/dev/browser-venv` に同期。既存venvへの追加も可 |
| `rust` | `cargo fetch --locked` でCargo.lockに従う依存を取得（`tools/dev.py` の `CARGO_WORKSPACES`。`src-tauri`、`NATIVE_CRATES` にある `native/` のクレート、結合テストの `native/browser-core-bridge`。下の `check --scope crates` と同じ一覧） |
| `resources` | `tools/app_resources.py stage --allow-missing` で `src-tauri/bin/_internal` を `build/` にあるもので作り直す |
| `integration` | [結合テスト](#結合テストplaywright)の準備。`native/browser-core-bridge` の依存を `cargo fetch --locked` で取得し、Playwright の Chromium と WebKit を取得する（合わせて数百 MB）。先に `setup --scope ui` が要る。ブラウザが使う OS のライブラリは入れない |
| `hooks` | `hk.pkl` のGitのフックを `hk install` でこの複製に入れる（[Gitのフック](#gitのフック)）。ほかのスコープでは入れない |

専用venvには所有マーカーを保存します。同じ場所にマーカーのない既存ディレクトリやシンボリックリンクがある場合は停止し、削除しません。Pythonのスコープはいずれも、`tools/check_python_lock.py`でロック全体のアーカイブのSHA-256とGit依存の完全なcommit SHAを検査します。続いて、`uv.lock` からハッシュと間接依存を含む一覧を `uv export` で `build/dev/<scope>-requirements.txt` に書き出し、専用venvへ `uv pip sync` で同期します。uvは一覧にあるハッシュを照合し、不一致なら停止します。Git依存にはアーカイブのハッシュを要求せず、固定commitを使います。`--python` で既存venvを指定した場合（`browser` のみ）は `uv pip install -r` で追加し、ほかのパッケージは削除しません。[uvの環境指定](https://docs.astral.sh/uv/pip/environments/)と[依存の固定・同期](https://docs.astral.sh/uv/pip/compile/)を参照してください。

`setup --scope ui` は既存の `node_modules` をnpmの仕様どおり作り直します。package.jsonとpackage-lock.jsonに不一致があれば失敗し、lockを更新しません。[npm ciの仕様](https://docs.npmjs.com/cli/v11/commands/npm-ci)を参照してください。

Windowsでも `headless`、`ui`、`browser`、`rust`、`resources` は同じ入口です。Pythonのバックエンドと、その環境を作る手順（`.venv`、`.venv_cuda`、`.venv_linux` を作っていた `mise run setup:app` と `bat\install.bat`）は0.6.0で消しました（#285）。`uv.lock` には道具と試験の依存だけが残っています。

### Tauriが読む資源を用意する

`tauri.conf.json` は `src-tauri/bin/_internal` を配布物の `_internal` として同梱します。このフォルダがないと、`cargo check`、`tauri dev`、`tauri build` が止まります。新しいcheckoutでは次の順に用意して診断します。

```sh
python tools/dev.py setup --scope resources --dry-run
python tools/dev.py setup --scope resources
python tools/dev.py doctor --scope rust
python tools/dev.py check --scope rust
```

`setup --scope resources` はフォルダを作り直し、`build/` にあるspeech.cpp、RVCのworker、Rustのライセンス文と、リポジトリの `LICENSE`、`NOTICE.md` を写します。足りないものは表示しますが、失敗にはしません。開発用のビルド（debug）は、speech.cppなどをチェックアウトの `build/` から直接読みます（`native/core/src/resources.rs`）。配布物の中身をそろえるときは `npm run build-resources`（Windows）を使います。

0.4までの開発用sidecar（`utils/dev_sidecar`、`setup --scope sidecar`、`npm run dev-fast` のPython起動）は、Pythonの同梱をやめたときに削除しました。Pythonのバックエンド（`src-python/`）は0.6.0で消しました。その振る舞いを確かめたいときは、0.5.xのタグのcheckoutか、0.4.xの配布物を使います。

### 既存Linux環境へUI試験の依存を追加する

```sh
python tools/dev.py setup --scope browser --python path/to/venv/bin/python --dry-run
python tools/dev.py setup --scope browser --python path/to/venv/bin/python
python tools/dev.py doctor --scope browser --python path/to/venv/bin/python
```

この操作は選んだvenv（`mise.toml` と同じPython 3.14）に必要なパッケージを追加・更新します。無関係なパッケージをsyncで削除しません。システムPythonは拒否します。Windowsのvenvなら `.venv\Scripts\python.exe` のように実行ファイルを指定します。

PlaywrightのPythonパッケージとChromium実行ファイルは別です。`setup --scope browser` はChromiumやOSライブラリを取得しません。ブラウザ試験の実行条件は[モデル取得UIの検証記録](voice-stack/model-downloads.md)を参照してください。通常の `check` は実機・ブラウザ試験の有効化変数を除外するため、専用試験は個別の手順で実行します。Windowsの長時間運転と実マイクの試験は[Windowsの実機試験](voice-stack/windows-field-tests.md)にあります。

## 検証する対象を選ぶ

```sh
python tools/dev.py check --scope tooling
python tools/dev.py check --scope node
python tools/dev.py check --scope voice
python tools/dev.py check --scope ui
python tools/dev.py check --scope rust --dry-run
python tools/dev.py check --scope integration
```

| スコープ | 内容 |
| --- | --- |
| `tooling` | 標準ライブラリのunittestで `tests/devtools` を検証 |
| `node` | `src-ui` 以下の `.test.js` / `.test.mjs` / `.test.ts` と `tools/i18n_gate`、`tools/writing_gate` の試験を Vitest で実行（`vitest.config.js`）。`node_modules` の Vitest を Node で直接起動し、取得はしない。未導入なら `setup --scope ui` を案内して止まる。続けて[文言の検査](#uiの文言と翻訳の検査)（`tools/i18n_gate/check.mjs`）と[文章の検査](#文章の検査docswriting)（`tools/writing_gate/check.mjs`）を実行する |
| `lint` | `tools/dev.py` の `LINT_PATHS`（`tests/voice`、`tests/devtools`、音声・配布・開発の道具）をRuffで検査。自動修正なし。voice CIも同じスコープを実行する |
| `voice` | `tests/voice/pytest.ini` を使ったモデルなしの契約試験と、`tests/platform`にある単体の試験2件 |
| `ui` | UIの試験（Vitest）、[Biome](#uiのlintと整形biome)のlintと整形の検査、型チェック（`npm run typecheck`）、`npm run vite-build`、部品のカタログのビルド（`npm run build:catalog`、`build/storybook/` へ）。ブラウザの操作は含まない |
| `rust` | `src-tauri` の `cargo check --locked --offline` と、`native/app-identity`、`native/speech-server`、`native/ops`、`native/audio-routing`、`native/adapters`、`native/translation`、`native/transcription`、`native/openvr-client`、`native/onnx-runtime`、`native/vr-overlay`、`native/voice-conversion`、`native/translate-onnx`、`native/tts`、`native/core`、`native/ocr-runtime`、`native/rvc-runtime`、`native/talk-ai` の試験を、cargo-nextestで実行（`cargo nextest run --locked --offline`）。nextestはdoctestを流さないので、`src/lib.rs` のあるクレートは続けて `cargo test --doc` を実行する。キャッシュやOS依存（Linuxでは `libpipewire-0.3` の開発ファイルとlibclang。`src-tauri` も中核を通して使う）がなければ失敗 |
| `integration` | [結合テスト](#結合テストplaywright)。`native/browser-core-bridge` を `cargo build --locked --offline` で組み、`tests/integration/vite.config.ts` で画面を組んでから、Playwright で Chromium と WebKit の試験を流す。ブラウザは取得しない。未導入なら `setup --scope integration` を案内して止まる |
| `workflows` | ワークフローと自前のアクションを、actionlint（shellcheckを含む）とzizmorで検査（[リポジトリの検査](#リポジトリの検査)） |
| `crates` | すべてのCargoのワークスペースの依存のライセンス、禁止の設定、取得元を、cargo-denyで検査（[リポジトリの検査](#リポジトリの検査)）。先に `setup --scope rust` が要る |
| `links` | リポジトリのMarkdownのファイル同士のリンクと見出しへのリンクを、lycheeで検査。外部のサイトには問い合わせない（[リポジトリの検査](#リポジトリの検査)） |
| `hooks` | Gitのフックの設定（`hk.pkl`）を `hk validate` で検査（[Gitのフック](#gitのフック)） |
| `quick` | `tooling`、`node`、`lint`。既定値 |
| `all` | 上記11対象。時間がかかるため統合時に明示実行 |
| `commits` | `--base` からHEADまでの新規コミット形式を検証 |
| `secrets` | `--base` からHEADまでの新規コミットに、鍵やトークンが入っていないかをgitleaksで検査（[リポジトリの検査](#リポジトリの検査)） |
| `vulns` | ロックファイルの依存の既知の脆弱性を、osv-scannerで検査。osv.devに問い合わせるので `all` には入れない（[リポジトリの検査](#リポジトリの検査)） |

Pythonは専用venvを優先し、次に既存の `.venv` を探します。`--python` があればその実行ファイルを使います。専用venvがない状態で `all` を実行しても、依存の不足を黙って省略しません。`doctor --scope all` で先に確認できます。

`doctor` と `check` は依存パッケージ・モデルを取得せず、アプリ、マイク、発声、GPU推論を起動しません。子プロセスでは `ASTAROT_` と `VRCT_` で始まる環境変数、pytest追加引数・外部pluginの自動読込みを除外し、Hugging Faceをofflineにします。これは試験の誤起動を防ぐ設定であり、任意のテストコードを封じるネットワークsandboxではありません。HTTP/UDP契約試験はローカルの一時ポートを使います。通信を禁止するsandboxではその試験が失敗します。

`check` はキャッシュや検証用の一時ファイルを作り、UIでは `dist`、RustではCargoのビルド先を書き換えます。起動中の通常アプリを停止するnpmの `dev` / `build` / `task-kill` は呼びません。tooling試験では、rustcがある場合に一時ディレクトリで `src-tauri/src/single_instance.rs` の単体試験をコンパイルして実行します（`tests/devtools/test_single_instance.py`）。配布ビルドは[Linuxビルド手順](voice-stack/linux-build-pipeline.md)の専用workspaceで行います。

最初に見つかった失敗で停止します。終了コードは次のとおりです。

| コード | 意味 |
| --- | --- |
| `0` | 選択した検証の成功。`--dry-run` なら計画の表示成功のみ |
| `1` | 実行した検証・導入コマンドが失敗。子コマンドの終了値も表示 |
| `2` | 引数、不足する前提、所有マーカー、Git基点などの問題 |
| `130` | Ctrl+Cによる中断 |

機械処理には `python tools/dev.py doctor --scope voice --json` を使います。未整備環境では `ok: false` と対処方法を返します。

## リポジトリの検査

製品のコードの試験とは別に、リポジトリそのものを検査するスコープがあります。道具はどれも `mise.toml` で版を固定しています。手元では `mise install` で入れてから実行します。入っていなければ、`check` は `mise install` を案内して止まります。CIでは `repo-checks.yml` の1つのジョブが、スコープごとに1つのステップで実行します。前のステップが失敗しても、後のステップは実行します。

| スコープ | 道具 | 確かめること | 例外の置き場所 |
| --- | --- | --- | --- |
| `workflows` | actionlint、shellcheck、zizmor | ワークフローの書き方、式、型（actionlint）。`run:` のシェルのスクリプト（actionlintが呼ぶshellcheck）。ワークフロー、自前のアクション、`dependabot.yml` の安全の問題（zizmor） | `.github/zizmor.yml`、または該当行の `# zizmor: ignore[<監査>] <理由>` |
| `links` | lychee | `site/` 以外のMarkdownのファイル同士のリンクと、見出しへのリンク（`#...`）。外部のサイトには問い合わせない | `lychee.toml` |
| `hooks` | hk | Gitのフックの設定（`hk.pkl`）の書き方。`hk.pkl` が読むhkの設定のパッケージの版と、`mise.toml` のhkの版がそろっていること（`tests/devtools/test_toolchain_pins.py`） | なし |
| `secrets` | gitleaks | `--base` からHEADまでの新規コミットの鍵やトークン。見つけた値は出力に出さない（`--redact`） | `.gitleaks.toml`（規則）、`.gitleaksignore`（過去のコミットの指紋） |
| `vulns` | osv-scanner | `uv.lock`、`package-lock.json`（ルートと `site/` と `site/motion/`）、19の `Cargo.lock` の依存の既知の脆弱性（osv.dev） | `osv-scanner.toml`（例外。理由と見直す日を書く） |
| `crates` | cargo-deny | 19のCargoのワークスペース（`CARGO_WORKSPACES`）の依存のライセンス、取得元（crates.ioと、許可したgitのリポジトリ）、版を書かない依存。配布する2つのシステム（WindowsとLinuxのx64）で組む依存だけを見る | `deny.toml` |

- actionlintは、`mise.toml` で固定したshellcheck（0.11.0）で `run:` のスクリプトを確かめます（2026-11-21に #833 の判断3で決定）。版によって見つけるものが変わるので、`doctor` は固定した版のshellcheckだけを通します。pyflakesの検査は切っています（pyflakesが見る `shell: python` のステップがないため）。
- zizmorは、`GH_TOKEN` があるとGitHubに問い合わせる監査（固定したコミットが本当にそのアクションのものか、既知の脆弱性のある版か）も行います。CIではワークフローのトークン（読み取りだけ）を渡します。手元では、`GH_TOKEN` がなければその監査を飛ばします。
- 例外を足すときは、理由を必ず書きます。
- `deny.toml` のライセンスは[ライセンス台帳](voice-stack/licensing.md)に合わせています。許容型（MIT、Apache-2.0、BSD、ISC、Zlib、Unicode-3.0など）はどのクレートにも認め、MPL-2.0とCDLA-Permissive-2.0は台帳で確かめたクレートだけに認めます。新しい依存で検査が止まったら、台帳に記録してから `deny.toml` に足します。既知の脆弱性はcargo-denyでは見ません。
- gitleaksは、2026-11-21に履歴全体（4,806コミット）を調べたときの56件を、規則（計測結果のハッシュ、試験のWebSocketの値と暗号化した鍵）と、過去のコミットの指紋の一覧に分けて外しています。どれも秘密ではありませんでした。CIでは、PR、push、マージキューが足したコミットだけを見ます。
- osv-scannerは `tools/translation_onnx/requirements.txt` を読みません。torchのローカルの版（`+cpu`）を解決できないためで、そこから配布物に入るものはありません。`osv-scanner.toml` に載っていない通知があると、CIの `vulns` のステップも失敗します（2026-11-21に #835 で決定）。いま直せない通知は、`osv-scanner.toml` に理由と見直す日（`ignoreUntil`）を書いて例外にします。その日を過ぎると例外が切れて検査が失敗するので、直すか、まだ直せない理由と新しい日を書いて例外を延ばします。2026-11-21の時点の例外は9件で、どれも同じメジャー版の中の更新では直らないものです（保守が終わったクレートと、GTK 3の `glib` 0.18）。
- lycheeは `site/` を読みません。ガイドのページはファイルではなく道筋（`requirements` など）でつながっているためで、そのリンクはサイトのビルドのあとの検査（`tools/check_site_anchors.mjs`）が確かめます。リンク先のファイルを消したときは、日付の入った記録の中のリンクを、消す前のコミットに固定したGitHubのリンクに替えます。
- CIでは `crates` だけを別のワークフロー `rust-crates.yml` で実行します。すべての依存の取得が要るので、`Cargo.toml`、`Cargo.lock`、`deny.toml` などを変えたPRと、developとmainへのpushだけで動きます。

## UIのTypeScriptとスタイル（移行中）

[ADR-010](adr/adr-010-frontend-stack.md)により、UIはJavaScriptからTypeScriptへ段階的に移ります。スタイルのSCSS Modulesからvanilla-extractへの移行は、#957で終わりました。TypeScriptへの移行が終わるまでは、JavaScriptとTypeScriptが混在します。混在期の規約は次のとおりです（第一段で定めた案で、レビューで確定します）。

- 新しく書くロジックとビューはTypeScript（`.ts`、JSXを含むものは `.tsx`）で書きます。スタイルはvanilla-extract（`.css.ts`）で書きます。SCSSは使いません。
- 型チェックは `npm run typecheck` です。`check --scope ui` も実行し、CIでも動きます。TypeScriptのファイルは `strict` で検査します。JavaScriptのファイルは検査せず、型を推論して読むだけです。
- 型チェックは2つの設定で走ります。アプリのソースは `tsconfig.json`、試験（`*.test.ts`）と試験の基盤（`src-ui/logics/test/`）は `tsconfig.test.json` です。試験と基盤はNodeで動くので、`tsconfig.test.json` だけがNodeの型（`@types/node`）を読みます。アプリのソースがNodeのAPIをうっかり使うと、`tsconfig.json` の検査で止まります。
- `any`、`as unknown as`、`@ts-ignore`、`@ts-expect-error` は使いません。バックエンドから届く値は `unknown` として受けて絞り込みます。既存の実行時の形の検査も残します。`check --scope tooling` の `test_typescript_strictness.py` がこれらを数えます。
- 移す順序と残りの範囲は [TypeScript 移行計画](typescript-migration.md) にあります。
- TypeScriptのソースは、型を消すだけでJavaScriptになる形にそろえます（Nodeの型の除去でもそのまま動く形です）。消去できる構文だけを使い（`enum`、`namespace`、コンストラクター引数のプロパティは使いません）、型だけのimportは `import type` にし、相対importは `./name.ts` のように拡張子まで書きます。`tsconfig.json` の `erasableSyntaxOnly`、`verbatimModuleSyntax`、`allowImportingTsExtensions` がこれを確かめます。

### UIの試験（Vitest）

UIの試験は Vitest で動きます。設定は `vitest.config.js` で、アプリの Vite の設定（SVG、YAML、vanilla-extract のプラグイン）は読みません。環境は Node で、DOM はありません。

```sh
npm test                 # 全件を1回実行する（check --scope node と同じ）
npx vitest run src-ui/logics/common/meterValue.test.ts   # ファイルを絞る
npm run test:watch       # 変更を監視して実行する
npm run test:coverage    # カバレッジ（build/coverage/ui に HTML と json-summary）
```

- カバレッジが数えるのは、`src-ui` のソースから、試験、試験の基盤、型の宣言、スタイル（`.css.ts`）を除いたものです（`vitest.config.js` の `coverage`）。スタイルは、ミューテーションテストの対象からも外しています。
- アサーションは `node:assert/strict` を使います。`test` と `vi` は `vitest` から import します。
- 後片付けは `context.onTestFinished(fn)` で登録します。`src-ui/logics/test/vitestSetup.ts` が、node:test の `after` と同じく登録した順に呼びます（Vitest の既定は逆順）。
- 時計の偽装は `vi.useFakeTimers({ toFake: [...] })` と `vi.advanceTimersByTime(ms)` です。テストが終わると実時間に戻ります。`vi.spyOn` は次のテストの前に元に戻ります（`restoreMocks`）。
- `hookHarness.ts` の `loadModule` で読むソースも、Vite が変換します（`src-ui/logics/test/harnessModules.ts`）。`?harness` を付けて読み込むと、TypeScript と JSX の変換のあと、import と export を `require` と `exports` を受け取る関数に包みます。`loadModule` はその関数を、試験が渡した差し替え品で呼びます。読み込むたびにソースの最上位が実行し直されるのは、前と同じです。この読み込み方のソースも、カバレッジに数えられ、ミューテーションテストの対象になります。
- `loadModule` は、試験が渡さなかった import を読みません（`Unexpected dependency` で止まります）。試験と同じシングルトン（`settingsWriteResponses.ts` など）を使わせるときは、試験ファイルが import したモジュールをそのまま渡します（`useStdoutToPython.test.ts`）。
- `import.meta.hot`（Viteのモジュールの差し替え）も、差し替え品の1つです。試験が `HOT_DEPENDENCY`（`harnessModules.ts`）の名前で渡せば、モジュールはそれを使います。渡さなければ `undefined` で、ビルドしたときと同じです。差し替えをまたいで状態を引き継ぐ試験は、同じ品を渡してモジュールを読み直します（`useHotkeys.test.ts`）。
- 既存の `.js` を `.ts` に移すときは、同じコミットで参照をすべて書き換えます。ビューのimport、試験の読み込み、Pythonの試験やツールが指すパスが対象です。
- デザイントークンの値は `src-ui/views/app/_index_css/variables.css` が正本です。vanilla-extractからは `src-ui/views/theme/vars.css.ts` の `vars` で同じ変数を参照します。トークンを足したら両方に書きます（`vars.test.ts` が食い違いを検出します）。
- Radix UIは振る舞いとアクセシビリティに使い、見た目はvanilla-extractで付けます。Radixの部品を足すときは、実行時に `<style>` 要素を差し込むかどうかを確かめます。CSPは差し込まれるスタイルをハッシュで許可していて、`contentSecurityPolicy.test.ts` がその数を数えています。

### UIのlintと整形（Biome）

UIのTypeScriptとJavaScriptは [Biome](https://biomejs.dev/) でlintと整形を行います。版は `mise.toml` で固定していて（`mise install` で入ります）、設定は `biome.json` です。`check --scope ui` が `biome lint` と `biome format` を実行します。どちらも検査だけで、ファイルを書き換えません。

```sh
biome lint                     # lint（対象は biome.json の files.includes）
biome format                   # 整形の検査（対象は formatter.includes）
biome format --write <ファイル>  # 整形する
biome lint --write <ファイル>    # 安全な自動修正だけを当てる
```

- 対象は `src-ui` の `.ts` と `.tsx`、`locales` の `.ts`、`tools/` の `.mjs`、リポジトリ直下の `.js` と `.mjs` です。`site/` は別の道具で扱うので含めません。
- lintは推奨のルール（`preset: "recommended"`）を使います。導入の時点で違反のあったルールは `biome.json` で警告（`warn`）にしてあり、`check` を止めません。違反のなかったルールはエラーのままなので、新しく増えると止まります。
- Playwright の領域のルール（`domains.playwright`）は切ってあります。Biome は `@playwright/test` の依存を見て自動で有効にしますが、Playwright の試験（`tests/integration/`）は対象の外で、対象の中では `describe` という名前の関数を誤って指摘するためです。
- 整形を当てるのは、いまは `formatter.includes` のファイル（リポジトリ直下の設定ファイルと `tools/` の `.mjs`）だけです。`src-ui` と `locales` は整形していません。
- 字下げと改行は `.editorconfig` に従います（`useEditorconfig`）。1行の長さは120字です。
- ルールをその場所だけ外すときは、理由を添えて `// biome-ignore lint/<グループ>/<ルール>: <理由>` と書きます。ESLintのコメント（`eslint-disable`）は効きません。
- 前に置いていた `.eslintrc.json` と ESLint の依存は外しました。`check` から呼ばれておらず、検査には使われていませんでした。

### 結合テスト（Playwright）

画面を操作して、中核と Rust のクレートを通り、外への出口と画面の結果までを 1 本で確かめる試験です（[ADR-017](adr/adr-017-integration-tests-through-the-core.md)）。試験は `tests/integration/` にあり、Playwright で Chromium と WebKit の両方で流します。CI では `voice-tests.yml` の `integration` のジョブが、すべての PR で Linux と Windows で流します。配布物の形で殻と OS を通す試験（`tests/platform`、`tools/native_acceptance.py`）は E2E と呼び、ここには含めません。

```sh
python tools/dev.py setup --scope ui
python tools/dev.py setup --scope integration    # ホストの依存と Chromium、WebKit を取得する
python tools/dev.py check --scope integration    # ホストと画面を組んで、両方のブラウザで流す
# 組んだあと、ブラウザやファイルを絞って流す
node node_modules/@playwright/test/cli.js test --config tests/integration/playwright.config.ts --project chromium translationCatalog.spec.ts
```

- **画面**：`tests/integration/app/` は、アプリの本物の入り口（`src-ui/views/app/index.tsx`）を読み込むページです。読み込む前に Tauri の公式の偽物（`@tauri-apps/api/mocks` の `mockIPC`）を入れます。中核とのやり取り（`backend_start`、`backend_write`、`backend_kill`）だけを WebSocket で中核のホストへ流し、ほかの Tauri の呼び出しには `tauriStandIns.ts` の偽物が答えます。アプリのコードに試験用の分岐はありません。
- **中核のホスト**：`native/browser-core-bridge` は、中核を `native/core/tests/common` と同じ偽物の `Services`（音声の機器、読み上げの出力、OSC、録音、メモリーの鍵の保存先）で起動し、WebSocket で画面とつなぎます。試験ごとに、自分の設定のフォルダーとポートで 1 つ起動します。
- **外のサービス**：翻訳の API、読み上げのサーバー、OSC の受け手は `standIns.ts` の偽物が受け、届いたものを試験が確かめます。設定のフォルダーのファイル（`config.json`、`translation_catalog.json`、ログ）も試験から読めます（`fixtures.ts`）。
- **アプリが新しい Tauri のコマンドを呼ぶようにしたら**、`tauriStandIns.ts` に答えを足します。答えのない呼び出しは記録され、試験はそこで失敗します。
- **試験の終わり**に、ページのエラーがないことと、答えのない Tauri の呼び出しがないことを確かめます。
- **Linux の WebKit**：Playwright の WebKit は Ubuntu 向けに組まれていて、Ubuntu 以外では OS のライブラリが足りずに起動しないことがあります。Ubuntu では `node node_modules/@playwright/test/cli.js install-deps chromium webkit` で入ります。手元で WebKit を流せないときは、Chromium だけを流し、WebKit は CI で確かめます。
- 結果は `build/integration/results`（失敗した試験の画面写真とトレース）にあります。

### UIのミューテーションテスト

ミューテーションテストは、ソースにわざと小さな変更（ミュータント）を入れ、どれかのテストが失敗するかを確かめます。カバレッジは「実行されたか」しか見ませんが、こちらは「値の違いをテストが見ているか」を測ります。道具は [@mizchi/mutator](https://www.npmjs.com/package/@mizchi/mutator)（0.2.0 に固定）です。CIでは回さず、手で回します。回す場面は下の「ミューテーションテストを回す場面」にあります。

```sh
npm run test:mutation                                                  # 対象の全体
npm run test:mutation -- --include src-ui/logics/flow/flowGraph.ts    # ファイルを絞る
npm run test:mutation -- --reporter text --reporter json               # 全件を .mutator/report/mutation.json にも書く
npm run test:mutation -- --reporter agent > build/mutants.json         # 未検出の一覧（キー、場所、覆うテスト）
npx mutator accept <キー> --reason "<等価と判断した理由>"               # 等価なミュータントを記録する
```

対象は `mutator.config.mjs` に書いてあります。`src-ui/logics` と `src-ui/views` の `.ts` と `.tsx` で、スタイル（`.css.ts`）、型の宣言、試験とその基盤は除きます。mutator は Vite の変換の中で変異を入れます。試験が import するソースに加え、`loadModule`（`hookHarness.ts`）や `loadBridgeRoutes`（`bridgeHarness.ts`）で読むフック、橋渡し、部品も Vite を通るので、対象にできます。どの試験も実行しないソースの変異は NoCoverage として数え、スコアに入れます。

結果の読み方:

| 状態 | 意味 | 扱い |
|---|---|---|
| Killed / Timeout | どれかのテストが失敗した、または止まった | 検出 |
| Survived | テストは実行したが、どれも失敗しなかった。`not infected` は、元と変異で値が変わる入力をどのテストも与えていない | 未検出 |
| NoCoverage | どのテストもその行を実行しない | 未検出 |
| CompileError | 型が合わないので実行しない（`tsc` で判定） | 分母に入れない |
| Ignored | ログだけの処理（`console.*` など）か、`mutator.accepted.json` に記録した等価なもの | 分母に入れない |

スコアは「検出 ÷（検出＋未検出）」です。

- 未検出は1件ずつコードを読み、テストの不足か、どの入力でも結果が変わらない等価なミュータントかを判断します。等価なら `npx mutator accept` で理由と一緒に記録し、`mutator.accepted.json` をコミットします。記録した行が変わると、次の実行で「古い」と報告されます。
- 変異の種類ごとの除外（`excludedMutators`）はしていません。文字列の置き換え（`StringLiteral`）は等価になりやすい一方、表のエンドポイント名やノードのIDなど、本物の穴も多く見つかったためです。
- `loadModule` に差し替え品を渡したテストでは、差し替えたソースは実行されません。未検出が多いファイルは、等価か判断する前に、そのファイルを使うテストの読み込み方を確かめます。`data:` URL でNodeに直接モジュールを読ませると、mutator には見えません。試験はソースを `loadModule` か import で読みます。
- Vitest 5 は変換したモジュールを `node_modules/.vitest-cache` に残します（`fsModuleCache`、既定で有効）。mutator はこのキャッシュと自分の計装を区別しません。そのため、対象を変えて回すと計装のないモジュールが読まれ、エラーなしで NoCoverage ばかりになり、スコアが0%近くまで落ちます。`npm run test:mutation` は `vitest.mutator.config.js`（このキャッシュを切った設定）を使います。`npx mutator --config vitest.config.js` のように、ほかの設定で回さないでください。
- 結果のキャッシュは `.mutator/` にあり（Gitの対象外）、次の実行では関数とテストが変わっていないものを再利用します。0.2.0 は最後の実行の結果だけを持つので、`--include` で絞って回した後の全体の実行は、ほぼ全件を回し直します。`.mutator/` を共有するので、同じ作業ツリーで2つ同時に回さないでください。
- `--include` で絞って回した後に全体を回すときは、`--full-dry-run` を付けます。付けないと、カバレッジの収集の一部に絞った回の結果が使われ、そのときに対象でなかったファイルの変異が NoCoverage と数えられます（2026-11-21 に、64 ファイル・約 3,600 件で起きました）。
- `--include` の範囲を前の回から変えて絞って回すときも、`--full-dry-run` を付けます。付けないと、試験が通っているファイルの変異まで、全部 NoCoverage と出ることがあります（2026-11-23 に、`views/app/io_flow` の 438 件で起きました）。
- 全体を最初から回すと、手元（Linux、並列16）で35分ほどかかりました（2026-11-21、変異40,552件）。前の回の結果を使える部分が多ければ、数分で終わります。結果を報告するときは、対象の範囲と計測した条件（版、並列数、機材）を添え、スコアを品質の保証として書かないでください。
- 0.2.0 には、Windows でパスの区切りが合わず計装されない問題が報告されています（Issue #550）。手順は Linux で確かめたものです。

### Rustのカバレッジとミューテーションテスト

Rustのカバレッジは [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov)、ミューテーションテストは [cargo-mutants](https://mutants.rs/) で測ります。どちらも `mise.toml` で版を固定しています（`cargo:cargo-llvm-cov`、`cargo:cargo-mutants`。cargo でソースから組むので、初めの1回は数分かかります）。[Issue #550](https://github.com/kein5/astarot/issues/550) と #871 の決定で、使い方は次のとおりです。

- **カバレッジ**: CIの `voice-tests.yml` の `rust-coverage` のジョブが、PRと、developとmainへのpushごとに、クレートごとの数字を測り、ジョブの要約（Summary）に表で出します。しきい値はなく、数字が下がってもCIは失敗しません。手元でも同じ道具で測れます（`tools/rust_coverage.py`）。
- **ミューテーションテスト**: CIでは回さず、手で回します。回す場面は下の「ミューテーションテストを回す場面」にあります。

```sh
mise install cargo:cargo-llvm-cov cargo:cargo-mutants
rustup component add llvm-tools --toolchain 1.100.0

# カバレッジ（全部のクレート、または --crate で絞る。CIのジョブと同じ表）
python tools/rust_coverage.py
python tools/rust_coverage.py --crate native/ops
cargo llvm-cov --locked --manifest-path native/ops/Cargo.toml --summary-only
cargo llvm-cov report --manifest-path native/ops/Cargo.toml --show-missing-lines   # 直前の実行の、通らなかった行

# ミューテーションテスト（ファイルを絞る）
cd native/ops && cargo mutants -j 4 --cargo-arg=--locked -f src/downloads/catalog.rs
cd native/core && PROPTEST_DISABLE_FAILURE_PERSISTENCE=1 cargo mutants --in-place --cargo-arg=--locked -f src/voice_settings.rs -- --lib
```

- `native/` のクレートは1つのワークスペースではなく、それぞれが `Cargo.lock` を持ちます。カバレッジはクレートごとに、そのクレートの試験だけで測ります。中核の統合試験から通っているコードも、そのクレートの数字には入りません。実機のPipeWireが要る試験（`--ignored`）も入りません。試験が落ちても測れるよう、`tools/rust_coverage.py` は `--ignore-run-fail` を付け、落ちたクレートは表に書きます。
- cargo-mutants は、変異のない状態で試験がすべて通らないと何もしません。
- cargo-mutants は既定でクレートを一時フォルダーに写して変異させます。`native/core` は、兄弟のクレートへの相対パスが通常の依存と試験用の依存で食い違い、写したものがビルドできません。そのため `--in-place`（その場で1件ずつ変異させる）で回します。回している間は、そのクレートのファイルを編集しないでください。
- proptest は、落ちた入力を `proptest-regressions/` に書き残し、次の実行で先に試します。変異させたコードで落ちた入力は残す意味がないので、ミューテーションテストは `PROPTEST_DISABLE_FAILURE_PERSISTENCE=1` を付けて回します。
- `-j` で並列に回すときは、`CARGO_TARGET_DIR` を設定しません。cargo-mutants は並列の作業ごとにクレートを写し、写した先の target でビルドします。`CARGO_TARGET_DIR` があると、並列の作業が 1 つの target を共有し、別の変異のビルドで試験を流すことがあります（2026-11-23 に、別の変異の失敗を「検出」と記録した回がありました）。`--in-place` で 1 件ずつ回す `native/core` は、設定したままでかまいません。`mise run mutation:changed` は、並列の回では `CARGO_TARGET_DIR` を外して渡します。
- 対象は純粋なロジックにし、時刻や待ちに頼る試験のあるモジュールは外します（ミュータントごとに結果がぶれるため）。`-- --lib` を付けると単体の試験だけを流します。統合試験だけが確かめている変異は検出されないので、結果を報告するときは流した試験の範囲も書きます。
- 結果は `mutants.out/` の `caught.txt`（検出）、`missed.txt`（未検出）、`timeout.txt`、`unviable.txt`（ビルドできない変異。分母に入れない）にあります。未検出は1件ずつコードを読み、試験の不足か、どの入力でも結果が変わらない等価なミュータントかを判断します。
- 純粋な関数の境界は、プロパティベーステスト（[proptest](https://proptest-rs.github.io/proptest/)。`native/core` の試験用の依存）で確かめられます。正規化の結果をもう一度正規化しても変わらないこと、保存して読み戻すと同じになることなど、入力を選ばない性質を書きます。

### 変えた所のミューテーションテスト

`mise run mutation:changed`（`python tools/mutation_changed.py`）は、作業中の枝が変えた所だけをミューテーションテストにかけます。画面とRustの両方を見て、変えたものがある側だけを回します（[Issue #550](https://github.com/kein5/astarot/issues/550) の Phase 3）。

```sh
mise run mutation:changed                                 # origin/develop との分岐点からの変更
mise run mutation:changed -- --base astarot/develop       # develop を別の名前のリモートで取っているとき
mise run mutation:changed -- --dry-run                    # 何を回すかだけを表示する
mise run mutation:changed -- --ui-only                    # 画面だけ（--rust-only でRustだけ）
```

- 変更は、`--base` と HEAD の分岐点から作業ツリーまでの差分です。コミットしていない変更も入ります。新しいファイルは `git add` してから数えられます。
- 画面: mutator の `--since` で、差分の中の変異だけを回して報告します。対象は `mutator.config.mjs` と同じです。表示されるスコアは、変えた所のスコアです。
- Rust: `tools/dev.py` の `NATIVE_CRATES` のうち `src/` が変わったクレートごとに、cargo-mutants の `--in-diff` で差分の中の変異だけを回します。`native/core` は、上の節のとおり `--in-place` で単体の試験（`-- --lib`）だけを流します。
- Survived があっても失敗にはしません。1件ずつ読み、試験の不足か等価なミュータントかを判断します（上の2つの節）。道具が回せなかったとき（変異のない状態で試験が落ちるなど）だけ失敗します。
- 結果は、画面が `.mutator/report/`、Rustが `<クレート>/mutants.out/` にあります。

### ミューテーションテストを回す場面

[Issue #550](https://github.com/kein5/astarot/issues/550) の Phase 3 で、次のように決まりました（2026-11-23、PR #975 の判断）。CIでは回しません。

- **PR**: 画面のロジック（`src-ui/logics`、`src-ui/views`）か、Rustのクレートの `src/` を変えたPRでは、`mise run mutation:changed` を回すことを勧めます。必須ではありません。回したら、PRの本文の「確認したこと」に、Survived と NoCoverage の件数と、それを1件ずつ読んだかどうかを書きます。回さなかったときは、その理由を書きます（pull-requestスキル）。
- **正式版の前**: 画面側の全体と、Rustの主なクレート（下の一覧）の全部を回します（releaseスキル）。ベータでは回しません。
  - 画面: `npm run test:mutation -- --full-dry-run --reporter text --reporter json`。全件の結果は `.mutator/report/mutation.json` に出ます。手元（Linux、並列16）で40分から2時間半かかりました（機材の負荷によります）。長いので、端末から切り離して回します。
  - Rust: 主なクレートの一覧を、節目ごとに全部回します（2026-11-23、PR #982 の判断）。一覧は、#871 と `native/translation/.cargo/mutants.toml` で対象にしてきた、時刻や待ちに頼らない純粋なロジックです。一覧を変えるときは、この表を直します。

    | クレート | 対象 | 流す試験 | コマンド（クレートのフォルダーで） |
    |---|---|---|---|
    | `native/ops` | `src/downloads/` の `catalog.rs`、`speechcpp.rs`、`translation_catalog.rs`、`verification.rs`、`user_models.rs` | 全部 | `cargo mutants -j 4 --cargo-arg=--locked -f src/downloads/catalog.rs -f src/downloads/speechcpp.rs -f src/downloads/translation_catalog.rs -f src/downloads/verification.rs -f src/downloads/user_models.rs` |
    | `native/core` | `src/voice_settings.rs`、`src/languages.rs` | 単体だけ | `PROPTEST_DISABLE_FAILURE_PERSISTENCE=1 cargo mutants --in-place --cargo-arg=--locked -f src/voice_settings.rs -f src/languages.rs -- --lib` |
    | `native/tts` | `src/onset.rs` | 単体だけ | `cargo mutants -j 4 --cargo-arg=--locked -f src/onset.rs -- --lib` |
    | `native/transcription` | `src/diagnostics.rs` | 単体だけ | `cargo mutants -j 4 --cargo-arg=--locked -f src/diagnostics.rs -- --lib` |
    | `native/translation` | `src/transliteration/` の `hepburn.rs`、`mod.rs`（`.cargo/mutants.toml`） | 全部 | `cargo mutants -j 3 --cargo-arg=--locked` |
- **結果の置き場**: 全体を回した結果は Issue に残します。いまは #550 にコメントし、#550 を閉じたあとは、節目ごとに記録の Issue を立てます。リポジトリの文書には置きません。数字は計測した条件（版、並列数、機材）に左右され、文書に置くと保証のように読まれやすいためです。報告には対象の範囲と条件を添え、スコアを品質の保証として書きません。

## UIの文言と翻訳の検査

利用者に見せる文言は `locales/en.yml` と `locales/ja.yml` が正本です。UIは `t("キー")` で取り出し、コードに直接書きません。対象はラベル、ボタン、説明、通知、ダイアログ、検証のメッセージ、ツールチップ、読み上げ用の名前と説明、バックエンドのエラーを表示する文言です。

`tools/i18n_gate/check.mjs` がこれを検査します。`check --scope node` と `check --scope ui` に含まれ、CIでも動きます。失敗するとファイルと行と原因を表示します。

```sh
node tools/i18n_gate/check.mjs                    # 検査だけ
node tools/i18n_gate/check.mjs --inventory        # 既知の直書きを場所と種類ごとに数える
node tools/i18n_gate/check.mjs --update-baseline  # 直書きを減らしたあとに基準を書き直す
```

検査する内容は次のとおりです。

- 英語と日本語で、キーの集合が同じこと。値が空でないこと。
- `{{name}}` の補間変数が英語と同じ名前の組であること。
- 複数形（`_one`、`_other` など）に、その言語が必要とする形がそろっていること。`$t(キー)` の参照先があること。
- UIが名指しするキーが `en.yml` にあること。`t()`、`i18n.t()`、`i18nKey`、テンプレートの固定部分（`` t(`main_page.${id}`) `` なら `main_page`）、既知の名前空間のキーに見える文字列が対象です。
- JSXの文字列、利用者に見える属性（`title`、`placeholder`、`alt`、`label`、`aria-label` など）、選択肢の `label` などに、新しい直書きがないこと。

検査を始めたときにあった直書きは `tools/i18n_gate/baseline.json` にファイルごとの件数で記録してあります。件数が増えると失敗します。減ったときも、消した直書きが戻らないように、`--update-baseline` で基準を書き直すまで失敗します。

翻訳しない文字列は理由を書いて例外にします。

- 製品名、サービス名、プロトコル名、単位は `tools/i18n_gate/exceptions.yml` の `terms` に足します。
- 1行だけなら、その行の末尾か直前の行に `// i18n-exempt: 理由`（JSXの中では `{/* i18n-exempt: 理由 */}`）と書きます。
- 続く数行なら `// i18n-exempt-start: 理由` と `// i18n-exempt-end` で囲みます。

利用者の入力、外部から受け取った名前、プロトコルの識別子、ログだけに出す文字列は、もともと翻訳の対象ではありません。検査もそれらを画面の文言とは見なしません。キーを組み立てて渡す箇所（`` t(`backend_errors.${code}`) `` など）は固定部分しか確かめられないので、試験で補います。

## 文章の検査（docs/writing）

文章の決まりの正本は [日本語の文章ルール](writing/japanese-guideline.md) と [英語の文章ルール](writing/english-guideline.md) です。そのうち形で確かめられる決まりを、`tools/writing_gate/check.mjs` が検査します。`check --scope node` に含まれ、`check`（軽量チェック）とCIでも動きます。失敗するとファイルと行と決まりを表示します。

```sh
node tools/writing_gate/check.mjs                      # 検査だけ
node tools/writing_gate/check.mjs --inventory          # 見つかったものを決まりごと、場所ごとに数える
node tools/writing_gate/check.mjs --update-baseline    # 違反を直したあとに基準を書き直す
node tools/writing_gate/check.mjs --file <ファイル>     # PRの本文や報告のように、リポジトリの外の文章を確かめる（--user で利用者向けとして読む）
```

- 読むのは、gitが管理する Markdown、マニュアルの `.mdx`、`locales/*.yml` の文言です。コードブロック、インラインのコード、URL、リンクの行き先、HTML、引用（`>` の行）は読みません。生成するファイルと外から持ってきたファイルは `tools/writing_gate/exceptions.yml` で外します。コードのコメントは、ガイドラインの対象ですが、いまは読みません（2026-11-23 の決定）。
- 決まりは `tools/writing_gate/rules.mjs` にあり、それぞれがガイドラインのどの節から来たかを書いています。日本語の決まりは仮名を含む行に、英語の決まりはラテン文字だけの行に当てます。利用者向けの決まりは、`site/`、`docs/readmes/`、リリースノート、`locales/` に当てます。
- 両方の言語を並べる見出しは、英語を先に書きます（「Summary / 概要」。2026-11-23 の決定）。
- リリースノート（`docs/release-notes/<版>.md`。README は除く）は、読点と改行も検査します（`tools/writing_gate/release_notes.mjs`。2026-11-25 に PR #1157 で決定）。括弧の外に「、」が4つ以上ある日本語の文と、文の頭の短い名詞の主題のあとの間を置くだけの読点（「Windowsでは、」）を指摘します。条件や目的のあとの読点は指摘しません。段落は1行に書き、ブロックの間は空行1つにし、見出しの前後に空行を置き、行末に空白も「：」も置きません。ベータ版のノートはリポジトリにないので、`docs/release-notes/` の下にコピーして検査し（`--file docs/release-notes/<ファイル> --user`）、終わったらコピーを消します。
- 文書の中で、悪い例として避ける形を挙げる所は、目印で外します。理由が要ります。

  ```md
  <!-- writing-exempt-start: 悪い例として避ける形を挙げている -->
  ...
  <!-- writing-exempt-end -->
  | サーバ | サーバー | <!-- writing-exempt: 悪い例 -->
  ```

  行の末尾に置いた目印はその行を、それだけの行に置いた目印は次の行を外します。

- 検査を始めたときにあった違反は `tools/writing_gate/baseline.json` に、ファイルと決まりと語ごとの件数で記録してあります。件数が増えると失敗します。減ったときも、直した形が戻らないように、`--update-baseline` で基準を書き直すまで失敗します。既存の違反は、場所ごとに別のPRで直していきます（2026-11-23 の決定）。
- 文書の立場、結論が先にあるか、論の向き、推敲で意味を変えていないかのように、人が判断する決まりは検査しません。ガイドラインの最後の確認の節（「書いたあとの確認」「Checklist」）で確かめ、PRの本文の「確認したこと」に、通したことと結果を書きます（pull-requestスキル）。

## VRの機器なしでVRの処理を試す

0.5.0からVRのオーバーレイはRustの中核（`native/vr-overlay`、`native/openvr-client`）が扱います。中核の試験は偽のSteamVR（`native/vr-overlay` の `runtime::fake::FakeVr`）を使います。コントローラの姿勢とボタンを持ち、置いたオーバーレイの位置からレーザーの当たりを答えます。試験は `native/vr-overlay/tests/interaction.rs` と `native/core/tests/vr_overlay.rs` で、`check --scope rust` に含まれます。詳しくは[クレートのREADME](../native/vr-overlay/README.md)にあります。

Pythonのバックエンドの偽のSteamVR（`src-python/test/fake_openvr.py`）と、それをバックエンドに差し込む `tools/run_with_fake_vr.py` と `tools/fake_vr_site` は、0.6.0でバックエンドと一緒に消しました（#285）。0.5.0のアプリはPythonのバックエンドを起動しないので、これらはアプリのVRにはつながっていませんでした。アプリ全体を偽のSteamVRで動かす手順は、今のところありません。

## EditorConfigとコミット形式

`.editorconfig` はUTF-8、LF、末尾改行を指定します。基本の字下げは空白4個、JSON/YAML/TOML/HTML/CSS/SCSSは2個です。Markdownの末尾空白、patch/diffの空白と末尾改行は意味があるため、一律削除を避けています。適用はエディターで今後編集するファイルが対象です。UIのTypeScriptとJavaScriptは、Biomeが同じ設定で整形します（[UIのlintと整形](#uiのlintと整形biome)）。それ以外の既存ファイルを一括整形するコマンドは追加していません。[EditorConfigの設定仕様](https://editorconfig.org/)に対応するエディターまたは拡張機能を使います。

CocogittoはConventional Commitsを扱うツールで、コマンド名が `cog` です。例えば `feat(dev): add developer checks` は機能追加、`fix(tts): preserve cancellation state` は不具合修正を表します。形式は[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)に従います。

```sh
# この複製にGitのフックを入れる（hk.pkl。commit-msgとpre-commit。中身は hk install）
python tools/dev.py setup --scope hooks

# メッセージだけを検証。コミットは作らない
cog verify "feat(dev): add developer checks"

# 基点はローカルに存在するrefを明示する
python tools/dev.py check --scope commits --base origin/develop

# 次のリリースの変更を、書き込まずに表示する
python tools/changelog.py print
```

フックは不正な形のメッセージをコミットの前に拒否します。マージのコミットと、`fixup!`・`squash!`・`amend!` のコミットは通します（後者はCIで拒否されます）。種別の選び方、フックの入れ方、困ったときの対処、CHANGELOGの分類とリリースの手順は [CONTRIBUTING.md](../CONTRIBUTING.md) の「Commit messages」と「Changelog and releases」にあります。

CLIは指定refとHEADの共通祖先を求め、その後のコミットだけを `cog check` に渡します。基点がない場合は終了コード2で止まり、自動fetchや全履歴への切替はしません。CIでは対象PRのbase/headを取得した状態で実行します。取得深さが足りず共通祖先が見つからない場合も停止します。

既存履歴を遡って形式を直す必要はありません。引数なしの `cog check` は全履歴を調べるため、通常は上記の範囲指定を使います。merge commitは設定で除外し、fixup commitは除外しません。CIはPRのコミットと、developとmainへpushされたコミットを検査します。[履歴検証](https://docs.cocogitto.io/guide/check.html)、[Gitフック](https://docs.cocogitto.io/guide/git_hooks.html)、[changelog](https://docs.cocogitto.io/guide/changelog.html)の公式手順も参照できます。

`CHANGELOG.md` は正式版のリリースを準備するときに `tools/changelog.py` が書きます。載せるのは正式版だけで、前の正式版からの変更をまとめます。ベータ版のノートは、前のタグからのコミットで作ります。コミットの解析はCocogittoの `cog changelog` に任せ、利用者向けと内部向けの分類と書式をこのスクリプトが決めます。種別ごとの見出しは `cog.toml` の `[commit_types]` にあります。試験は `tests/devtools/test_changelog.py` です。

開発CLIはフックを自動では入れません。入れるときは、開発者が `setup --scope hooks`（[hk](#gitのフック)）を実行します。hkを使わないときは、`cog install-hook commit-msg` で `cog.toml` の同じ検査を入れられます（2026-11-21、#837の判断2でhkに寄せました）。履歴を書き換える `cog edit`、版とタグを作る `cog bump`、commit/push、公開hookも開発CLIに含めません。版は今までどおり `package.json` で決めて `npm run update-version` で反映し、タグはGitHub Releasesの下書きを公開したときにできます。


## Gitのフック

`hk.pkl` は、hkで動かすGitのフックの設定です。使うときは、複製ごとに一度 `python tools/dev.py setup --scope hooks`（`mise run setup:hooks`。中身は `hk install`）を実行します。開発CLIは、ほかの準備やチェックではフックを入れません（2026-11-21、#837で決定）。Git 2.54以降では、`.git/hooks/` を書き換えずにGitの設定（`hook.<名前>.command`）として入ります。入ったフックはmiseのshimを通るので、hkも各手順の道具も `mise.toml` の版で動きます（先に `mise install`）。

| フック | 手順 | 確かめること |
| --- | --- | --- |
| pre-commit | gitleaks | ステージした変更の鍵やトークン。見つけた値は表示しない |
| pre-commit | actionlint（shellcheckを含む）、zizmor | 変えたワークフローと自前のアクション。`check --scope workflows` と同じ設定 |
| pre-commit | Biome | 変えたUIのTypeScriptとJavaScriptのlintと整形。`check --scope ui` と同じ設定（`biome.json`）で、対象外のファイルは読まない。まだ直していない規則は警告なので、コミットは止まらない |
| pre-commit | lychee | 変えたMarkdown（`site/` を除く）のリンク。外部のサイトには問い合わせない |
| commit-msg | cocogitto | Conventional Commits（`cog.toml`）。`cog.toml` のフックと同じく、`fixup!`、`squash!`、`amend!` のコミットは通す（CIは拒否する） |

- どの手順もファイルを書き換えません。1回だけ飛ばすときは `HK=0 git commit ...` です。
- コミットメッセージのフックはhkに寄せました（2026-11-21、#837の判断2）。hkを使わないときは `cog install-hook commit-msg` でも入れられます。両方を入れた複製では、Git 2.54以降ではメッセージを2回確かめます（害はありません）。hkのcommit-msgは、`git rebase --autosquash` のために `fixup!` などのコミットを通す手順をシェルで書いているので、Windowsでも `sh` で動かします。
- すべてのファイルに流すときは `hk run pre-commit --all` です。gitleaksはそのときもステージした変更だけを見ます。コミットの範囲は `check --scope secrets` で確かめます。
- `check --scope hooks` は `hk.pkl` を `hk validate` で確かめます。初回は、固定した版のhkの設定のパッケージをGitHubのリリースから取得します。
## CIでの利用と再現性

CIのワークフローはNode、Rust、Python、uv、Cocogitto、それに[リポジトリの検査](#リポジトリの検査)の道具を `jdx/mise-action`（コミットSHAで固定）で入れます。版は `mise.toml`、取得するファイルとSHA-256は `mise.lock` から読むので、開発者の手元と同じ版になります。ジョブごとに必要なツールだけを `install_args` で選びます。uvを使うジョブは `UV_PYTHON_PREFERENCE=only-system` と `UV_PYTHON_DOWNLOADS=never` を付け、miseのPythonを使わせて、uvが別のPythonを取得しないようにします。署名の秘密情報を扱う `prepare-release.yml` では、書き込みのできるトークンをmise-actionに渡さず、キャッシュも使いません。

CIでは準備と検証を分けます。例えば、依存を導入した後は次のように同じコマンドを呼べます。WindowsではPython実行ファイルを `.venv\Scripts\python.exe` に変更します。

```sh
python tools/dev.py check --scope tooling
python tools/dev.py check --scope voice --python .venv/bin/python
python tools/dev.py check --scope lint --python .venv/bin/python
python tools/dev.py check --scope ui
python tools/dev.py check --scope integration
python tools/dev.py check --scope commits --base origin/develop
```

このCLIはvoice gateのコンパイルを代行しません。Linux CIの `tools/build_voice_gate.py` と必要なOS依存の準備は既存の手順を維持します。ブラウザ試験、ネイティブアプリ、実GPU、マイク、配布物の受け入れ試験も別の明示的な工程です。

Linuxの補助プログラムは3つです（`astarot-voice-gate`、`astarot-source-bridge`、`astarot-screen-capture`）。次の `mise run build:voice-gate`（`tools/build_voice_gate.py`）が、これらを `build/` に作ります。`build/` の補助を使うのは、ソースから起動したアプリと、専用のPipeWireのグラフで流すRustの試験（`native/audio-routing` の `voice_gate_private` など。voice CIのLinuxのジョブ）です。`check --scope voice` のPythonの試験は、使う補助を一時フォルダーに自分でコンパイルするので、`build/` の補助には頼りません。どちらにも、Cコンパイラー、pkg-config、PipeWireの開発ファイル（`libpipewire-0.3`）が要ります。

検証済みの音声基盤はPipeWire 1.6.10とWirePlumber 0.5.18です。Ubuntu 24.04標準のPipeWireのAPIでは補助をコンパイルできないので、CIは固定の版を隔離した場所に作ってから組みます（`tools/ci/setup_pipewire.sh`）。[Linuxビルド手順](voice-stack/linux-build-pipeline.md)の隔離セットアップは、固定ハッシュの公式ソースから必要な版を作ります。ホストの音声サービスは変更しません。Python用の `setup --scope headless` とは別の明示操作です。

```sh
mise run build:voice-gate
mise run check:voice
```

ソースから起動したアプリでRVCを使うときは、RVCのワーカーも `build/` にビルドします（Rustが必要です。WindowsとLinuxのどちらでも同じです）。ワーカーはONNX Runtimeを持たず、アプリが同意のうえで取得した実行環境から読み込むので、このビルドは何もダウンロードしません。配布物のビルド（`tools/build_linux.py`、`bat/build.bat`）はこれを自動で実行します。

```sh
mise run build:rvc-worker
```

`native/rvc-runtime` 自体の試験（`cargo test`）は、ビルド時に `ort` がONNX Runtimeを取得します。手順は[クレートのREADME](../native/rvc-runtime/README.md)にあります。

npm、Cargo、Pythonの依存はそれぞれ `package-lock.json`、`Cargo.lock`、`uv.lock` を使います。Pythonの検証対象はロックにある配布アーカイブとGitのcommitです。Node、Rust、Python本体、uv、Cocogittoの版は `mise.toml` で固定します。ソースビルド時に隔離環境へ追加されるビルド依存とOSライブラリは固定しません。同じビット列の配布物や全機種での動作を保証するものではありません。検証記録には `doctor --json` の結果、実行scope、commit、OSを併記します。

### CIでの中核の試験の再試行

CIの `core-integration` は、`native/core` の試験をcargo-nextestの `ci` プロファイルで流します（`native/core/.config/nextest.toml`）。JUnitの報告を書き、再試行で通った試験があれば、ジョブの要約に一覧で出して、実行に警告を付けます（`tools/ci/nextest_flaky_summary.py`）。

- 2026-11-23からは、どの試験も再試行しません。それまでは、決まった時間で待つために遅いランナーでときどき落ちる試験（#861）の10個を、2回まで再試行していました。待ち方を直したあと、LinuxとWindowsで続けて流して落ちないことを確かめ、#861に記録して一覧から外しました。
- また再試行させる試験が出たら、先にIssueに理由を書き、`native/core/.config/nextest.toml` に `[[profile.ci.overrides]]`（`filter` と `retries`）を足します。落ちなくなったとIssueに記録したら外します。
- 手元の `python tools/dev.py check --scope rust` は既定のプロファイルで流すので、再試行しません。

### CIの失敗の週ごとの集計

「Weekly CI failures」（`.github/workflows/ci-failures.yml`）が、毎週月曜に直近7日のCIの失敗を数え、ジョブの要約に表で出します。対象はdevelopへのpushとPRの実行で、ワークフローとジョブごとに、落ちた試行の数と、同じ実行の再実行で通った数を出します。再実行で通ったものは、揺らぐ試験か一時的な障害です。ログは読まないので、何が落ちたかは各ジョブのログで確かめます。手元では `python3 -m tools.ci_failures --days 7` で同じ表が出ます（`gh` のログインが要ります）。
