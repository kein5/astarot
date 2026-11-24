# Renaming the repository (kein5/VRCT-VOX → ASTAROT)

[日本語版](#リポジトリ名の変更手順kein5vrct-vox--astarot日本語版)

Status: **Carried out; kept as a record** (the repository was renamed to `kein5/astarot` at the 0.5.0 release. The old name, `kein5/VRCT-VOX`, became a separate repository that holds only a redirect page and copies of the 0.5.0 release, and GitHub does not redirect from the old name. The current values are in [Names and identifiers](project-rename.md). What follows is the preparation record written on 2026-11-16, and the open items in section 9 also date from then)
Date: 2026-11-16
Related: [ADR-011](../adr/adr-011-astarot-brand-and-multimodal-accessibility.md), [Display name inventory](astarot-rename-inventory.md), [Names and identifiers](project-rename.md), [Release candidates](release-candidates.md)

This document sets out the steps for changing the GitHub repository name from `kein5/VRCT-VOX` to the ASTAROT name, and what the change affects. The change happens at the 0.5.0 release. 0.4.0 ships under the current name, so nothing changes until then.

Internal identifiers (package names, executable names, the settings and data locations, `VRCT_*` environment variables, the app ID and release file names) do not change together with the repository name. The P2 migration ADR handles them.

## 1. The new name

Undecided (section 9). This document tentatively writes `kein5/ASTAROT`. Whether it is upper or lower case (`ASTAROT` or `astarot`) also decides the site path (`/ASTAROT/` or `/astarot/`).

## 2. What GitHub does on a rename

- **Redirected**: the repository page, `git clone`, `fetch`, `push`, the REST API (`301`) and the URLs of release files on Releases. Issue and PR numbers, stars, watches and the Pages settings move to the new name as they are, and so do Actions secrets and variables.
- **Not redirected**: the URL of the GitHub Pages site. `https://kein5.github.io/VRCT-VOX/` stops opening the moment the name changes, and the site moves to `https://kein5.github.io/ASTAROT/`.
- **When redirects break**: creating a new repository named `VRCT-VOX` under `kein5` stops every redirect from the old name. After the rename, do not create a repository with this name.
- **Workflows with conditions on the name**: the condition `github.repository == 'kein5/VRCT-VOX'` becomes false, and those jobs no longer run. This affects the deploy in `pages.yml` and `prepare-release.yml`.

## 3. Effect on the update paths

The update paths do not break after the rename. The reasons and what was checked are below.

### Stable (from 0.4.x to 0.5.0)

1. The app reads the endpoint in `tauri.conf.json`, `https://vrct-vox-updates.kei9d09.workers.dev/latest.json`. This URL does not contain the repository name.
2. The Worker redirects with `302` to `https://github.com/kein5/VRCT-VOX/releases/latest/download/latest.json`. The `Location` of the response was checked on 2026-11-16.
3. After the rename, GitHub redirects this old URL to the `latest.json` of the latest release in the new repository.
4. The URLs of the release files in 0.5.0's `latest.json` are built from `REPOSITORY` in `tools/release_candidate.py`. If it is changed to the new name beforehand, the files are fetched without a redirect. If it keeps the old name, they still arrive through the redirect.
5. The updater fetches with `tauri-plugin-updater` (reqwest). The app has no setting that changes the redirect policy (it was confirmed that `src-tauri/src` has no redirect setting). By default, reqwest follows up to 10 redirects. After the rename, there are about 3 redirects (the Worker, GitHub's rename and GitHub's release files), which is within this limit.
6. Signatures are verified with the signature in `latest.json` and the public key. This does not depend on the repository name. The release file names (`VRCT-VOX_setup.exe` and the AppImage) do not change, so the names the updater looks for do not change either.

To avoid relying on GitHub's redirect for good, change the Worker's redirect target to the new URL right after the rename. The Worker is outside this repository.

Note: as of 2026-11-16, GitHub's "Latest" is v0.3.0, which has no `latest.json`. So for now, following the redirect from the Worker ends in a `404`. Publishing 0.4.0 with a `latest.json` is expected to resolve this, and it is unrelated to the rename.

### Beta

0.4.x betas read `https://api.github.com/repos/kein5/VRCT-VOX/releases?per_page=30` in `src-tauri/src/app_update.rs` directly. After the rename, the GitHub API redirects to the new name with `301`, and reqwest follows it. This path holds as long as a repository with the old name is not created again. 0.5.0 changes it to the URL with the new name.

The `latest.json` URL that the API returns at the end of the redirect has the new name. Apps up to 0.5.0-beta.2 accepted only URLs starting with `https://github.com/kein5/VRCT-VOX/releases/download/`. So after the rename, beta updates and the version list (`/get/data/available_releases`) become empty without any message. Beta updates fall back to the stable Worker, so they can move up to a stable release once one is out (#456).

Later versions accept a Releases URL of the owner (`kein5`) whatever the repository name is (`project_download` in `app_update.rs`). For a `latest.json` that cannot be accepted because the owner or the location changed, `startup.log` gets `Update: skipped a latest.json outside the project's downloads` with the URL. After the rename, run a beta update check once and confirm that this line does not appear.

On the Python side, `src-python/config.py` (`_GITHUB_URL`, `_GITHUB_RELEASES_LIST_URL`) also arrives through the same redirect. 0.5.0 changes it to the new name.

### Installer

The 0.4.x installer downloads the main zip from `https://github.com/kein5/VRCT-VOX/releases/download/<tag>/<file>`. This also arrives through the Releases redirect.

## 4. Effect on the public site

- The site URL changes from `https://kein5.github.io/VRCT-VOX/` to `https://kein5.github.io/ASTAROT/`. GitHub does not redirect the old URL.
- 0.4.x apps open the old URL from help links and model description links (`src-ui/logics/ui_configs.js`). The opener allowlist (`src-tauri/capabilities/vrct_capability.json`) also allows only the old URL. If nothing is done, the help links in 0.4.x return `404` from the moment of the rename.
- Old site URLs pasted into the README, release notes and posts elsewhere stop opening in the same way.

The candidate ways to keep the old URLs working are listed below. Which one to take is undecided (section 9).

| Option | What it does | Caution |
|---|---|---|
| a. Redirect from a user site | Create `kein5/kein5.github.io` and put pages under `/VRCT-VOX/` that redirect to the new URLs | As of 2026-11-16, this repository does not exist. Before doing this, test that the user site serves the `/VRCT-VOX/` path when no project site has it |
| b. Use a custom domain | Set a custom domain on Pages | The old `kein5.github.io/VRCT-VOX/` cannot be saved. The URL changes once more |
| c. Do nothing | Old links return `404` | 0.4.x users can no longer open help |

Recreating a repository with the old name and putting Pages there is not an option. As section 2 says, the redirects for the repository, the API and Releases would all stop, and 0.4.x updates and installs would break.

## 5. Order of execution

### Preparation (during the 0.5.0 work)

1. Decide the new name and how to handle the old site URL (section 9).
2. Prepare the "switch PR". It changes the values in A of [the inventory](astarot-rename-inventory.md) to the new name. Its contents:
   - The updater's beta URL, the Releases URL in Python, the NSIS download URL, the links in the UI and the manual URLs
   - The opener allowlist and its tests
   - `repo`, `site`, `base` and the favicon `href` in `site/.vitepress/config.mts`, and `REPO` in `releases.mjs`
   - The conditions and `--repo` in `pages.yml` and `prepare-release.yml`
   - `tools/release_candidate.py`, `tools/changelog.py`, `cog.toml` and `tools/linux_packages.py`
   - The links in the issue templates, the README, `docs/` and `site/`
3. Decide whether to keep the old URL in the opener allowlist for 0.4.x users. GitHub's old URLs are redirected, so keeping it does no harm.
4. If option a is chosen, prepare the redirect pages and test them under a different name first.

### Execution (on the 0.5.0 release day)

1. Merge the switch PR into develop and build the 0.5.0 release candidate from that commit. At this point the new URLs do not open yet. Jobs with conditions on the name (the Pages deploy) do not run until the rename either.
2. Finish verifying the release candidate, except for checking link targets.
3. In GitHub's Settings, change the repository name to the new name.
4. Right after that, do the following:
   - Change the Worker's redirect target to `https://github.com/kein5/ASTAROT/releases/latest/download/latest.json`
   - Run the Pages workflow by hand and confirm that the site opens at the new URL
   - If option a is chosen, turn on the redirect for the old URLs
   - In the local clone, run `git remote set-url origin https://github.com/kein5/ASTAROT.git`
5. Create the 0.5.0 draft with `prepare-release.yml`. Confirm that the `latest.json` URLs in the draft have the new name.
6. A maintainer checks the draft and publishes it.

### After publishing

1. On a setup with 0.4.0 installed, confirm that the stable update check finds 0.5.0 and can update to it.
2. Confirm that the 0.4.x beta update check (the GitHub API `301`) works.
3. Confirm that the 0.4.x installer can do a new install.
4. Confirm that the old site URLs are handled as decided.
5. Confirm that the repository, Releases, Issues and manual links open from the 0.5.0 app.

## 6. What does not change with the rename

- The stable endpoint for update checks (the Worker URL)
- The telemetry destination (`vrct-vox-telemetry.kei9d09.workers.dev`)
- The release file names, the app ID, the settings and data locations, the registry keys and the `VRCT_*` environment variables
- Issue and PR numbers, and past Releases and tags. The titles of past Releases, "VRCT-VOX x.y.z", remain
- The links in past sections of `CHANGELOG.md`. Old URLs still open through the redirect

## 7. Rolling back

Changing the repository name back to `VRCT-VOX` turns GitHub's redirect back to the original direction. Set the Worker's redirect target back as well. Revert the switch PR. For Pages, run the workflow again after the name has been changed back.

## 8. Record of checks

| Date | What was checked | Result |
|---|---|---|
| 2026-11-16 | Worker response | `302`, `Location: https://github.com/kein5/VRCT-VOX/releases/latest/download/latest.json` |
| 2026-11-16 | Following from the Worker to the end | After 2 redirects, `404` for `v0.3.0/latest.json` (v0.3.0 has no `latest.json`) |
| 2026-11-16 | updater endpoint | `tauri.conf.json` has only the Worker URL, which does not contain the repository name |
| 2026-11-16 | Redirect settings in the app | `src-tauri/src` has no setting that stops redirects. The Python version check (`src-python/model.py`) follows redirects with the default of `requests.get` |
| 2026-11-16 | Pages | `build_type: workflow`, no custom domain, URL `https://kein5.github.io/VRCT-VOX/` |
| 2026-11-16 | User site | `kein5/kein5.github.io` does not exist |

The redirects after the rename have not been tried for real yet. This record relies on the behavior described in GitHub's documentation.

## 9. Open items

1. Whether the new repository name is `ASTAROT` or `astarot`
2. How to handle the old site URLs (options a, b and c in section 4)
3. Whether to rewrite the workflow conditions to the new name, or to use a form that does not depend on the name, such as `github.repository_owner == 'kein5'`
4. Whether to keep the old URLs in the 0.5.0 opener allowlist
5. Whether to keep "VRCT-VOX" in `LICENSE` and `NOTICE.md`, or to add the new name next to it

---

# リポジトリ名の変更手順（kein5/VRCT-VOX → ASTAROT）（日本語版）

Status: **実行済み。記録**（0.5.0 のリリースのときに `kein5/astarot` へ改名した。旧名の `kein5/VRCT-VOX` は、転送ページと 0.5.0 のリリースの複製だけを持つ別のリポジトリになり、GitHub は旧名から転送しない。今の値は[名称と識別子](project-rename.md)にある。下は 2026-11-16 に書いた準備の記録で、9 節の未決事項もそのときのもの）
Date: 2026-11-16
Related: [ADR-011](../adr/adr-011-astarot-brand-and-multimodal-accessibility.md)、[表示名の棚卸し](astarot-rename-inventory.md)、[名称と識別子](project-rename.md)、[配布候補](release-candidates.md)

GitHub のリポジトリ名を `kein5/VRCT-VOX` から ASTAROT の名前に変える手順と影響の範囲をまとめる。変えるのは 0.5.0 のリリースのときである。0.4.0 は現行の名前で出すので、それまでは変えない。

内部識別子（パッケージ名、実行名、設定とデータの保存先、`VRCT_*` 環境変数、アプリ ID、配布物のファイル名）はリポジトリ名と一緒には変えない。これらは P2 の移行 ADR で扱う。

## 1. 新しい名前

未決である（9節）。この文書では仮に `kein5/ASTAROT` と書く。大文字か小文字か（`ASTAROT` か `astarot` か）によって、サイトのパス（`/ASTAROT/` か `/astarot/` か）も変わる。

## 2. 変えたときに GitHub がすること

- **転送される**：リポジトリのページ、`git clone`、`fetch`、`push`、REST API（`301`）、Releases の配布物の URL。Issue と PR の番号、Star、Watch、Actions の secrets と variables、Pages の設定はそのまま新しい名前に移る。
- **転送されない**：GitHub Pages のサイトの URL。`https://kein5.github.io/VRCT-VOX/` は名前を変えた時点で開けなくなり、サイトは `https://kein5.github.io/ASTAROT/` に移る。
- **転送が切れる条件**：`kein5` の下に `VRCT-VOX` という名前のリポジトリを作り直すと、古い名前からの転送はすべて止まる。名前を変えた後は、この名前のリポジトリを作らない。
- **名前で条件を書いたワークフロー**：`github.repository == 'kein5/VRCT-VOX'` の条件は偽になり、そのジョブは実行されなくなる。対象は `pages.yml` の deploy と `prepare-release.yml` である。

## 3. 更新の経路への影響

更新の経路は、名前を変えた後も切れない。理由と確認した内容を次に書く。

### 安定版（0.4.x から 0.5.0 へ）

1. アプリは `tauri.conf.json` の endpoint、`https://vrct-vox-updates.kei9d09.workers.dev/latest.json` を読む。この URL にはリポジトリ名が入っていない。
2. Worker は `302` で `https://github.com/kein5/VRCT-VOX/releases/latest/download/latest.json` へ転送する。2026-11-16 に応答の `Location` を確かめた。
3. 名前を変えた後は、GitHub がこの古い URL を新しいリポジトリの最新版の `latest.json` へ転送する。
4. 0.5.0 の `latest.json` に載る配布物の URL は、`tools/release_candidate.py` の `REPOSITORY` から作る。新しい名前に変えておけば転送を経ずに取得できる。古い名前のままでも転送で届く。
5. updater は `tauri-plugin-updater`（reqwest）で取得する。アプリ側で転送の方針を変える設定はない（`src-tauri/src` に redirect の設定がないことを確認した）。reqwest の既定は 10 回まで転送をたどる。名前を変えた後の転送は Worker、GitHub の改名、GitHub の配布物の 3 段ほどで、この範囲に収まる。
6. 署名の検証は `latest.json` の署名と公開鍵で行う。リポジトリ名には依存しない。配布物のファイル名（`VRCT-VOX_setup.exe` と AppImage）は変えないので、updater が探す名前も変わらない。

転送を GitHub に頼り続けないよう、名前を変えたらすぐに Worker の転送先を新しい URL に変える。Worker はこのリポジトリの外にある。

参考：2026-11-16 の時点で GitHub の「Latest」は v0.3.0 で、`latest.json` を持っていない。そのため今は Worker から辿った先が `404` になる。0.4.0 を `latest.json` 付きで公開すれば解消する見込みで、名前の変更とは関係しない。

### ベータ版

0.4.x のベータ版は `src-tauri/src/app_update.rs` の `https://api.github.com/repos/kein5/VRCT-VOX/releases?per_page=30` を直接読む。名前を変えた後、GitHub API は `301` で新しい名前に転送し、reqwest がそれをたどる。古い名前のリポジトリを作り直さない限り、この経路は保たれる。0.5.0 では新しい名前の URL に変える。

転送の先で API が返す `latest.json` の URL は、新しい名前になる。0.5.0-beta.2 までのアプリは、`https://github.com/kein5/VRCT-VOX/releases/download/` で始まる URL だけを受け付けていた。そのため名前を変えると、ベータ版の更新と版の一覧（`/get/data/available_releases`）が何も言わずに空になる。ベータ版の更新は安定版の Worker に戻るので、安定版が出ればそれに上がれる（#456）。

それより後の版は、持ち主（`kein5`）の Releases の URL ならリポジトリ名を問わずに受け付ける（`app_update.rs` の `project_download`）。持ち主や置き場所が変わって受け付けられない `latest.json` は、`startup.log` に `Update: skipped a latest.json outside the project's downloads` と URL を書く。名前を変えた後は、ベータ版の更新確認を一度実行し、この行が出ていないことを確かめる。

Python 側の `src-python/config.py`（`_GITHUB_URL`、`_GITHUB_RELEASES_LIST_URL`）も同じ転送で届く。0.5.0 では新しい名前に変える。

### インストーラー

0.4.x のインストーラーは `https://github.com/kein5/VRCT-VOX/releases/download/<tag>/<file>` から本体の zip を取得する。これも Releases の転送で届く。

## 4. 公開サイトへの影響

- サイトの URL が `https://kein5.github.io/VRCT-VOX/` から `https://kein5.github.io/ASTAROT/` に変わる。古い URL は GitHub が転送しない。
- 0.4.x のアプリは、ヘルプやモデルの説明のリンクで古い URL を開く（`src-ui/logics/ui_configs.js`）。opener の許可リスト（`src-tauri/capabilities/vrct_capability.json`）も古い URL だけを許している。何もしなければ、0.4.x のヘルプのリンクは名前を変えた時点で `404` になる。
- README、リリースノート、外部の投稿に貼られた古いサイトの URL も同じく開けなくなる。

古い URL を生かす方法の候補を次に挙げる。どれを採るかは未決である（9節）。

| 案 | 内容 | 注意 |
|---|---|---|
| a. ユーザーサイトで転送する | `kein5/kein5.github.io` を作り、`/VRCT-VOX/` 以下に新しい URL へ転送するページを置く | 2026-11-16 の時点でこのリポジトリはない。プロジェクトサイトのない `/VRCT-VOX/` のパスをユーザーサイトが返すことは、実行前に試して確かめる |
| b. 独自ドメインにする | Pages に独自ドメインを設定する | 古い `kein5.github.io/VRCT-VOX/` は救えない。URL がもう一度変わる |
| c. 何もしない | 古いリンクは `404` になる | 0.4.x の利用者がヘルプを開けなくなる |

古い名前のリポジトリを作り直して Pages を置く方法は採らない。2節のとおり、リポジトリ、API、Releases の転送がすべて止まり、0.4.x の更新とインストールが切れる。

## 5. 実行の順序

### 準備（0.5.0 の作業中）

1. 新しい名前と、古いサイトの URL の扱いを決める（9節）。
2. 「切り替えの PR」を用意する。[棚卸し](astarot-rename-inventory.md)の A の値を新しい名前に変える。中身は次のとおり。
   - updater のベータの URL、Python の Releases の URL、NSIS の取得 URL、画面のリンク、マニュアルの URL
   - opener の許可リストと、その試験
   - `site/.vitepress/config.mts` の `repo`、`site`、`base`、favicon の `href`、`releases.mjs` の `REPO`
   - `pages.yml` と `prepare-release.yml` の条件と `--repo`
   - `tools/release_candidate.py`、`tools/changelog.py`、`cog.toml`、`tools/linux_packages.py`
   - Issue のテンプレート、README、`docs/`、`site/` のリンク
3. 0.4.x の利用者のために、opener の許可リストに古い URL を残すかを決める。GitHub の古い URL は転送されるので害はない。
4. 案 a を採るなら、転送するページを用意し、別の名前で試しておく。

### 実行（0.5.0 のリリースの日）

1. 切り替えの PR を develop にマージし、0.5.0 の配布候補をそのコミットから作る。この時点では、新しい URL はまだ開けない。名前で条件を書いたジョブ（Pages の deploy）も、名前を変えるまでは実行されない。
2. 配布候補の検証を、リンク先の確認を除いて済ませる。
3. GitHub の Settings で、リポジトリ名を新しい名前に変える。
4. 直後に次を行う。
   - Worker の転送先を `https://github.com/kein5/ASTAROT/releases/latest/download/latest.json` に変える
   - Pages の workflow を手動で実行し、新しい URL でサイトが開けることを確かめる
   - 案 a を採るなら、古い URL の転送を有効にする
   - 手元の clone で `git remote set-url origin https://github.com/kein5/ASTAROT.git` を実行する
5. `prepare-release.yml` で 0.5.0 の下書きを作る。下書きの `latest.json` の URL が新しい名前になっていることを確かめる。
6. 保守担当者が下書きを確認して公開する。

### 公開の後

1. 0.4.0 を入れた環境で、安定版の更新確認が 0.5.0 を見つけて更新できることを確かめる。
2. 0.4.x のベータ版の更新確認（GitHub API の `301`）が動くことを確かめる。
3. 0.4.x のインストーラーで新規インストールできることを確かめる。
4. 古いサイトの URL の扱いが、決めたとおりになっていることを確かめる。
5. 0.5.0 のアプリから、リポジトリ、Releases、Issues、マニュアルのリンクが開けることを確かめる。

## 6. 名前を変えても変わらないもの

- 更新を確認する安定版の endpoint（Worker の URL）
- テレメトリの送信先（`vrct-vox-telemetry.kei9d09.workers.dev`）
- 配布物のファイル名、アプリ ID、設定とデータの保存先、レジストリキー、`VRCT_*` 環境変数
- Issue と PR の番号、過去の Release とタグ。過去の Release の題名「VRCT-VOX x.y.z」は残る
- `CHANGELOG.md` の過去の節のリンク。古い URL のままでも転送で開ける

## 7. 戻すとき

リポジトリ名を元の `VRCT-VOX` に戻せば、GitHub の転送は元の向きに戻る。Worker の転送先も元に戻す。切り替えの PR はリバートする。Pages は名前を戻した後に workflow をもう一度実行する。

## 8. 確認の記録

| 日付 | 確認したこと | 結果 |
|---|---|---|
| 2026-11-16 | Worker の応答 | `302`、`Location: https://github.com/kein5/VRCT-VOX/releases/latest/download/latest.json` |
| 2026-11-16 | Worker から最後までたどる | 転送 2 回で `v0.3.0/latest.json` の `404`（v0.3.0 に `latest.json` がないため） |
| 2026-11-16 | updater の endpoint | `tauri.conf.json` は Worker の URL だけで、リポジトリ名を含まない |
| 2026-11-16 | アプリの転送の設定 | `src-tauri/src` に転送を止める設定はない。Python の版の確認（`src-python/model.py`）は `requests.get` の既定で転送をたどる |
| 2026-11-16 | Pages | `build_type: workflow`、独自ドメインなし、URL は `https://kein5.github.io/VRCT-VOX/` |
| 2026-11-16 | ユーザーサイト | `kein5/kein5.github.io` はない |

名前を変えた後の転送は、まだ実際には試していない。GitHub の文書にある振る舞いを前提にしている。

## 9. 未決事項

1. 新しいリポジトリ名を `ASTAROT` と `astarot` のどちらにするか
2. 古いサイトの URL をどう扱うか（4節の案 a、b、c）
3. ワークフローの条件を新しい名前に書き換えるか、`github.repository_owner == 'kein5'` のように名前に依存しない形にするか
4. 0.5.0 の opener の許可リストに古い URL を残すか
5. `LICENSE` と `NOTICE.md` の「VRCT-VOX」を残すか、新しい名前を併記するか
