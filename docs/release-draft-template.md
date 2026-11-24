# Release draft checklist

[日本語版](#リリースの下書きの確認事項日本語版)

Before publishing this draft (tools/changelog.py puts this list in a comment, which the release page does not show):
- Confirm that the tag is `v<version>` and that the draft targets the commit the candidates were built from (the run of "Start ASTAROT release draft" or "Prepare verified ASTAROT release draft" names it). Publishing creates the tag, and release tags cannot be moved afterwards.
- Replace this body with the release notes in `docs/release-notes/<version>.md`, written in the format of `docs/release-notes/README.md` from 0.5.0 (an opening paragraph, one emoji heading per change that matters to users, and a last heading for internal changes with their pull request numbers). The full list stays in CHANGELOG.md.
- Check the candidate manifests, SHA256SUMS, Linux GUI acceptance and Windows install/upgrade/uninstall results.
- Confirm model/runtime licenses and supported platforms. No user voice models are bundled.
- TTS/RVC hardware results apply only to the recorded device and configuration. Windows hardware acceptance is separate from building the installer.
- The installer uses `ASTAROT.zip` from this release (also for apps up to 0.5 that ask for the GPU edition); keep this name and the stable `ASTAROT_setup.exe` asset. There is no `VRCT-VOX_cuda.zip` any more.
- Up to 0.7.x the release also carries each file under its name up to 0.6.x (`VRCT-VOX.zip`, `VRCT-VOX_setup.exe`, `VRCT-VOX-<version>-linux-x64-release.*`): the same bytes, each with its `.sha256` and its line in `SHA256SUMS`, so that older links keep working (`tools/release_candidate.py`). Check that each one is there beside its file.
- The in-app updater reads `latest.json` from this release once it is published (the latest stable release for stable users). Check that the draft carries it, with entries for `windows-x86_64` (`ASTAROT_setup.exe`) and `linux-x86_64` (`ASTAROT-<version>-linux-x64-release.AppImage`), and that it names none of the copies.
- Settings and data: on Linux they are under `astarot` since 0.6.0 (moved from `vrct-vox` at the first start); on Windows they are in the install folder (`%LOCALAPPDATA%\ASTAROT` by default; from 0.7.0 the installer also moves an install of 0.5.0 or earlier from `%LOCALAPPDATA%\VRCT-VOX` there). There is no cache folder.

---

# リリースの下書きの確認事項（日本語版）

この下書きを公開する前に、次のことを確かめます（`tools/changelog.py`がこの一覧を入れるコメントはリリースのページに表示されません）。
- タグが`v<version>`であることと、下書きの対象が候補をビルドしたコミットであることを確かめます（どのコミットかは「Start ASTAROT release draft」か「Prepare verified ASTAROT release draft」の実行に書かれています）。公開するとタグができ、リリースのタグはあとから動かせません。
- この本文を`docs/release-notes/<version>.md`のリリースノートに差し替えます。ノートは0.5.0から`docs/release-notes/README.md`の書式で書いています（序文のあとに利用者に関係のある変更ごとに絵文字の見出しを1つずつ置き、最後の見出しに内部の変更をPRの番号付きで並べます）。変更の一覧の全体は`CHANGELOG.md`に残ります。
- 候補のマニフェスト、`SHA256SUMS`、LinuxのGUIの受け入れ試験、Windowsでのインストールと更新とアンインストールの結果を確かめます。
- モデルと実行環境のライセンスと、対応するプラットフォームを確かめます。利用者の声のモデルは同梱していません。
- TTSとRVCの実機での結果は記録した機器と構成にだけ当てはまります。Windowsの実機での受け入れ試験はインストーラーのビルドとは別です。
- インストーラーはこのリリースの`ASTAROT.zip`を使います（0.5までのアプリがGPU版を求めたときも同じです）。この名前を変えず、名前の決まった資産`ASTAROT_setup.exe`も残します。`VRCT-VOX_cuda.zip`はもうありません。
- 0.7.xまでのリリースは、古いリンクが切れないように各ファイルを0.6.xまでの名前でも載せます（`VRCT-VOX.zip`、`VRCT-VOX_setup.exe`、`VRCT-VOX-<version>-linux-x64-release.*`）。写しは元と同じバイト列で、それぞれに`.sha256`と`SHA256SUMS`の行があります（`tools/release_candidate.py`）。どの写しも元のファイルと並んでいることを確かめます。
- アプリ内の更新はこのリリースを公開したあと、その`latest.json`を読みます（安定版の利用者のアプリは最新の安定版のものを読みます）。下書きに`latest.json`があり、`windows-x86_64`（`ASTAROT_setup.exe`）と`linux-x86_64`（`ASTAROT-<version>-linux-x64-release.AppImage`）の項目を持ち、写しを1つも挙げていないことを確かめます。
- 設定とデータは、Linuxでは0.6.0から`astarot`の下にあります（初回の起動で`vrct-vox`から移します）。Windowsではインストール先のフォルダーにあります（既定は`%LOCALAPPDATA%\ASTAROT`です。0.7.0からはインストーラーが0.5.0以前のインストールも`%LOCALAPPDATA%\VRCT-VOX`からそこへ移します）。キャッシュのフォルダーはありません。
