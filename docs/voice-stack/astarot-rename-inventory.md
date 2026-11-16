# ASTAROT への表示名の移行：棚卸し

Status: **準備（0.5.0 で実行する予定）**
Date: 2026-11-16
Related: [ADR-011](adr-011-astarot-brand-and-multimodal-accessibility.md)、[リポジトリ名の変更手順](repository-rename.md)、[名称と識別子](project-rename.md)

0.5.0 で表示名を `VRCT-VOX` から `ASTAROT` に移す。その準備として、表示名が出てくる場所を洗い出した。この文書は棚卸しだけで、書き換えはまだしていない。

## 対象と対象外

| 区分 | 0.5.0 での扱い |
|---|---|
| A. リポジトリ名と公開サイトの URL | リポジトリ名の変更と同時に切り替える（[手順](repository-rename.md)） |
| B. 文書とサイトの表示名 | 0.5.0 で `ASTAROT` に書き換える |
| C. 履歴と法的な表示 | 原則として書き換えない。個別に判断する |
| D. UI の表示文言 | UI 刷新の作業で扱う。ここでは件数だけを記録する |
| E. 内部識別子 | 対象外。P2 で扱う（[名称と識別子](project-rename.md)） |

E には、パッケージ名、実行名、設定とデータの保存先、`VRCT_*` 環境変数、アプリ ID、レジストリキー、所有マーカーが入る。配布物のファイル名（`VRCT-VOX.zip`、`VRCT-VOX_cuda.zip`、`VRCT-VOX_setup.exe`、`VRCT-VOX-<version>-linux-*.AppImage` など）も E に入れる。インストーラーと updater が名前で探すためである。

## 調べ方

件数は 2026-11-16 の develop（`722638bd`）に ASTAROT 素材の差し替えを足した状態で数えた。行が変われば件数も変わる。実行するときは次のコマンドで数え直す。

```sh
# 表示名（大文字小文字を区別する）
git grep -I -c "VRCT-VOX" -- . ':!*.lock' ':!package-lock.json'
# リポジトリ名に結び付いた URL
git grep -n -I -P "kein5/VRCT-VOX|kein5\.github\.io/VRCT-VOX|base = '/VRCT-VOX/'"
```

全体では `VRCT-VOX` が 1322 件ある。小文字の `vrct-vox` は 477 件で、ほとんどが E である。このうち `github.com/kein5/VRCT-VOX` を含むものが 236 件、`kein5.github.io/VRCT-VOX` を含むものが 15 件ある。

## A. リポジトリ名と公開サイトの URL

リポジトリ名を変えると、ここに挙げる値の指す先が変わる。扱いは[リポジトリ名の変更手順](repository-rename.md)にまとめた。

| 場所 | 値 | 役割 |
|---|---|---|
| `src-tauri/src/app_update.rs` | `REPOSITORY`、`RELEASES_API` | ベータ版の更新確認（GitHub API） |
| `src-tauri/tauri.conf.json` | updater の `endpoints` | 安定版の更新確認。Worker の URL で、リポジトリ名を含まない |
| `src-tauri/capabilities/vrct_capability.json` | opener の許可リスト | アプリから開ける URL（リポジトリとサイト） |
| `src-tauri/src/opener_scope_tests.rs` | 許可と拒否の試験 | 上の許可リストの試験 |
| `src-tauri/nsis/template.nsi` | `$cmder_dl` | インストーラーが本体の zip を取得する URL |
| `src-python/config.py` | `_GITHUB_URL`、`_GITHUB_RELEASES_LIST_URL`、リリースの `base` | 版の一覧と配布物の URL |
| `src-ui/logics/ui_configs.js` | `vrct_document_home_url` | アプリから開くマニュアルの URL |
| `src-ui/views/.../AboutVrct.jsx`、`Updater.jsx`、`AppErrorBoundary.jsx`、`ContactsContainer.jsx` | リポジトリ、Releases、Issues の URL | 画面のリンク |
| `src-ui/logics/common/*.test.js`、`src-python/test/test_model_update.py` | 試験の URL | 上の値の試験 |
| `site/.vitepress/config.mts` | `repo`、`site`、`base = '/VRCT-VOX/'`、favicon の `href` | サイトの URL とパス |
| `site/.vitepress/theme/releases.mjs` | `REPO` | サイトに出すリリース一覧 |
| `.github/workflows/pages.yml` | `if: github.repository == 'kein5/VRCT-VOX'` | サイトの公開。名前が違うと実行されない |
| `.github/workflows/prepare-release.yml` | 同じ `if:`、`gh release create --repo` | リリースの下書き。名前が違うと実行されない |
| `.github/ISSUE_TEMPLATE/bug_report.yml`、`config.yml` | 脆弱性報告の URL | Issue のテンプレート |
| `tools/release_candidate.py` | `REPOSITORY` | `latest.json` の配布物 URL |
| `tools/changelog.py`、`cog.toml`（`repository`） | `REPO_URL` | CHANGELOG のリンク |
| `tools/linux_packages.py` | `HOMEPAGE`、`Maintainer` | Linux パッケージのメタデータ |
| README、`docs/`、`site/`、`SECURITY.md`、`SUPPORT.md`、`NOTICE.md` など | 本文中のリンク | 文書のリンク（B と一緒に直す） |

## B. 文書とサイトの表示名（0.5.0 で書き換える）

件数は `VRCT-VOX` の出現数である。A の URL も含む。

### リポジトリ直下と GitHub のテンプレート

| ファイル | 件数 | メモ |
|---|---:|---|
| `README.md` | 23 | 見出し、説明、リンク、バッジ |
| `docs/readmes/README.ja.md` | 23 | |
| `docs/readmes/README.en.md` | 1 | |
| `SUPPORT.md` | 12 | |
| `SECURITY.md` | 4 | |
| `CONTRIBUTING.md` | 3 | |
| `CODE_OF_CONDUCT.md` | 2 | |
| `PRODUCT.md` | 2 | 製品の定義。ADR-011 6節5項により P1 で反映する |
| `DESIGN.md` | 1 | 同上 |
| `AGENTS.md` | 2 | 同上 |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | 4 | |
| `.github/ISSUE_TEMPLATE/config.yml` | 1 | |
| `.impeccable/design.json` | 1 | デザインシステムの題名 |

### リリースノートの型

| 場所 | 件数 | メモ |
|---|---:|---|
| `.github/workflows/prepare-release.yml` の `--title 'VRCT-VOX ' + version` | 1 | GitHub Release の題名。過去の題名はすべて「VRCT-VOX x.y.z」 |
| `.github/workflows/prepare-release.yml`、`release.yml` の `name:` | 2 | ワークフローの表示名 |
| `docs/release-draft-template.md` | 2 | 配布物のファイル名への言及で、E の名前を保つ指示。本文は変えない |
| `tools/changelog.py` | 1 | ベータ版の案内文のリンク（A） |

### サイト（GitHub Pages）

| ファイル | 件数 |
|---|---:|
| `site/.vitepress/config.mts` | 12（`title`、`description`、ナビ、フッター、A の URL） |
| `site/.vitepress/theme/components/LocalSearchBox.vue` | 8 |
| `site/.vitepress/theme/releases.mjs` | 5 |
| `site/index.md` | 3 |
| `site/package.json` | 1 |
| `site/en/guide/install.md` / `site/ja/guide/install.md` | 18 / 17 |
| `site/en/guide/troubleshooting.md` / `site/ja/...` | 9 / 8 |
| `site/en/guide/license.md` / `site/ja/...` | 6 / 6 |
| `site/en/features/chat-reading.md` / `site/ja/...` | 6 / 5 |
| `site/en/guide/linux-audio.md` / `site/ja/...` | 5 / 5 |
| `site/en/guide/introduction.md` / `site/ja/...` | 4 / 3 |
| `site/en/guide/first-setup.md` / `site/ja/...` | 4 / 2 |
| `site/en/features/transcription.md` / `site/ja/...` | 4 / 1 |
| `site/en/features/vr.md` / `site/ja/...` | 4 / 3 |
| `site/en/features/quick-chat.md` / `site/ja/...` | 3 / 3 |
| `site/en/guide/how-it-works.md` / `site/ja/...` | 3 / 3 |
| `site/en/guide/privacy.md` / `site/ja/...` | 3 / 3 |
| `site/en/guide/windows-audio.md` / `site/ja/...` | 3 / 3 |
| `site/en/guide/requirements.md` / `site/ja/...` | 2 / 2 |
| `site/en/index.md` / `site/ja/index.md` | 2 / 2 |
| `site/{en,ja}/features/io-flow.md`、`tts.md`、`voice-conversion.md`、`site/{en,ja}/guide/models.md` | 各 1 |
| `site/motion/` | 3（2ファイル） |

`site/` の画像（スクリーンショット、動画）には、旧名のアプリ画面が写っているものがある。画像の撮り直しは UI 刷新の後になる。

### 開発者向け文書と仕様

| ファイル | 件数 |
|---|---:|
| `docs/readme_build.md` | 8 |
| `docs/development.md` | 1 |
| `docs/ocr_model_license.md` | 3 |
| `docs/brand/README.md` | 2 |
| `docs/spec/external-interfaces.md` | 5 |
| `docs/spec/overview.md` | 3 |
| `docs/spec/README.md`、`use-cases.md`、`reference/config-keys.md` | 各 2 |
| `docs/spec/open-issues.md` | 1 |
| `docs/voice-stack/release-candidates.md` | 12 |
| `docs/voice-stack/project-rename.md` | 10 |
| `docs/voice-stack/linux-build-pipeline.md` | 9 |
| `docs/voice-stack/appimage.md` | 8 |
| `docs/voice-stack/licensing.md` | 7 |
| `docs/voice-stack/platform-constraints.md` | 5 |
| `docs/voice-stack/publication-and-upstream.md` | 3 |
| `docs/voice-stack/model-downloads.md` | 2 |
| `docs/voice-stack/decisions.md`、`local-setup-windows.md` | 各 1 |

これらの中には E の値（配布物の名前、所有マーカーなど）の説明が混ざっている。書き換えるときは 1 行ずつ、表示名か識別子かを見分ける。`project-rename.md` は名称の正本なので、表示名と識別子の表を分けて書き直す。

### パッケージのメタデータ

| ファイル | 値 |
|---|---|
| `pyproject.toml` | `description` とコメント（4 件） |
| `src-tauri/Cargo.toml` | `description` |
| `src-tauri/tauri.conf.json` | `shortDescription` |

`tauri.conf.json` の `productName` は配布物とインストール先の名前を決めるので E に入れる。ウィンドウの `title` は D に入れる。

## C. 履歴と法的な表示（原則として書き換えない）

| 場所 | 件数 | 理由 |
|---|---:|---|
| `CHANGELOG.md` | 142 | 出荷済みの版の記録。過去の節は変えない |
| `docs/release-notes/0.4.0.md` | 3 | 現行名で出す版のノート |
| `docs/voice-stack/` の日付付きの記録（`architecture-evaluation-2026-10-27.md`、`windows-voice-report.md`、`windows-pending-checks.md`、`adr-009-virtual-microphone-and-store.md`） | 16 | 書いた時点の記録 |
| `LICENSE` | 4 | 著作権表示「kein5 (VRCT-VOX changes)」と経緯の説明 |
| `NOTICE.md` | 18 | 帰属と同梱物の説明 |
| `licenses/speechcpp-models/NOTICE.md`、`licenses/speech.cpp/NOTICE.md`、`licenses/silero-vad/NOTICE.md` | 8 / 1 / 1 | 同梱の経緯の説明 |

`LICENSE` と `NOTICE.md` で旧名を残すか、新名を併記するかは判断が要る（[手順](repository-rename.md)の未決事項）。

## D. UI の表示文言（UI 刷新の作業で扱う）

| 場所 | 件数 |
|---|---:|
| `locales/en.yml` | 67 |
| `locales/ja.yml` | 64 |
| `src-ui/views/` | 19（13 ファイル） |
| `src-ui/logics/` | 14（9 ファイル）。多くは A の URL |
| `src-tauri/tauri.conf.json` のウィンドウの `title` | 1 |
| `src-tauri/src/` | 50（9 ファイル）。ログ、トレイ、識別子が混ざっている |
| `src-tauri/nsis/template.nsi` | 11。インストーラーの表示とレジストリキーが混ざっている |

## E. 内部識別子（対象外、P2）

`native/`、`tools/`、`tests/`、`src-python/models/`、`bat/`、`utils/`、`packaging/` の出現は、大半が実行名、所有マーカー、配布物の名前、ログの接頭辞である。P2 の移行 ADR で扱うので、この棚卸しでは 1 件ずつは数えていない。この中にも利用者に見えるメッセージが残っている可能性があるため、P1 の書き換えのときに `git grep` で確認する。
