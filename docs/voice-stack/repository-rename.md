# リポジトリ名の変更手順（kein5/VRCT-VOX → ASTAROT）

Status: **準備（0.5.0 のリリース時に実行する予定。まだ実行しない）**
Date: 2026-11-16
Related: [ADR-011](adr-011-astarot-brand-and-multimodal-accessibility.md)、[表示名の棚卸し](astarot-rename-inventory.md)、[名称と識別子](project-rename.md)、[配布候補](release-candidates.md)

GitHub のリポジトリ名を `kein5/VRCT-VOX` から ASTAROT の名前に変える手順と影響の範囲をまとめる。変えるのは 0.5.0 のリリースのときである。0.4.0 は現行の名前で出すので、それまでは変えない。

内部識別子（パッケージ名、実行名、設定とデータの保存先、`VRCT_*` 環境変数、アプリ ID、配布物のファイル名）はリポジトリ名と一緒には変えない。これらは P2 の移行 ADR で扱う。

## 1. 新しい名前

未決である（9節）。この文書では仮に `kein5/ASTAROT` と書く。大文字か小文字か（`ASTAROT` か `astarot` か）によって、サイトのパス（`/ASTAROT/` か `/astarot/` か）も変わる。

## 2. 変えたときに GitHub がすること

- **転送される**：リポジトリのページ、`git clone`、`fetch`、`push`、REST API（`301`）、Releases の配布物の URL。Issue と PR の番号、Star、Watch、Actions の secrets と variables、Pages の設定はそのまま新しい名前に移る。
- **転送されない**：GitHub Pages のサイトの URL。`https://kein5.github.io/VRCT-VOX/` は名前を変えた時点で開けなくなり、サイトは `https://kein5.github.io/ASTAROT/` に移る。
- **転送が切れる条件**：`kein5` の下に `VRCT-VOX` という名前のリポジトリを作り直すと、古い名前への転送はすべて止まる。名前を変えた後は、この名前のリポジトリを作らない。
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
