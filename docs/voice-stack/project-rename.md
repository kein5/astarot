# ASTAROTの名称と識別子

ASTAROT（旧名VRCT-VOX）は[misyaguziya/VRCT](https://github.com/misyaguziya/VRCT)を基にした派生プロジェクトです（MIT）。2026-10-31にGitHubのfork networkから外れましたが、元のライセンスと帰属表示は維持します。上流のVRCTと、上流の作者による別プロジェクト[VRCT-TTS](https://github.com/misyaguziya/VRCT-TTS)の名称は変更しません。

表示名の移行の範囲は[ADR-011](adr-011-astarot-brand-and-multimodal-accessibility.md)にあり、旧名が出てくる場所は[表示名の棚卸し](astarot-rename-inventory.md)にまとめてあります。

## 表示名

| 対象 | 名称 |
|---|---|
| 製品名と、画面・文書・サイトに出す名前 | `ASTAROT` |
| Tauriの`productName`（0.5.1から。インストーラーの題名、新しく入れるときのインストール先、ショートカット、Windowsのアプリの一覧、実行ファイルの版情報の製品名） | `ASTAROT` |
| 補助ウィンドウのタイトル（0.5.1から） | `ASTAROT VR Panel`、`ASTAROT Control Panel`、`ASTAROT Hexagram`、`ASTAROT Captions Handle` |
| 正式なサブタイトル | `Speech, Translation, Accessibility, Revoicing & OCR Toolkit` |

## 旧名のまま使う名前

次の名前は旧名のままです。リポジトリは0.5.0のリリースのときに`kein5/astarot`へ改名しました（[リポジトリ名の変更手順](repository-rename.md)）。旧名の`kein5/VRCT-VOX`は、いまは転送ページと0.5.0のリリースの複製だけを持つ別のリポジトリで、GitHubは旧名から転送しません。ほかの名前は内部識別子として扱い、表示名と一緒には変えません。変えるときは、ADR-011のP2として別のADRで移行を決めます。配布物の名前は、インストーラーとupdaterが名前で探します。

| 対象 | 名称 |
|---|---|
| npm・Cargoパッケージ、本体の実行名 | `vrct-vox` |
| Pythonバックエンドの実行名（0.4まで。0.5.0の配布物には入らない） | `vrct-vox-sidecar` |
| Linuxの配布物 | `VRCT-VOX-<version>-linux-x64-release.tar.gz`、同名の`.AppImage`、`.deb`、`.rpm`（0.4までは`linux-x64-vulkan`か`linux-x64-cpu`） |
| Windowsの配布物 | `VRCT-VOX.zip`、`VRCT-VOX_cuda.zip`、`VRCT-VOX_setup.exe`（ビルドが作るインストーラーは0.5.1から`ASTAROT_<version>_x64-setup.exe`で、リリースでは`VRCT-VOX_setup.exe`の名前で載せる） |
| Linuxデスクトップエントリー | `vrct-vox.desktop` |

Windowsの実行ファイルには`.exe`が付きます。

## 識別子と保存先

次の値は設定・データの保存先やOSとの連携に使います。変更すると既存の設定や連携を引き継げなくなるため、変える場合は移行処理を伴わせてください。

| 対象 | 値 |
|---|---|
| TauriアプリID | `io.github.kein5.vrct-vox` |
| Linuxの設定保存先 | `$XDG_CONFIG_HOME/vrct-vox`、既定は`~/.config/vrct-vox` |
| Linuxのデータ保存先 | `$XDG_DATA_HOME/vrct-vox`、既定は`~/.local/share/vrct-vox` |
| Linuxのキャッシュ保存先 | `$XDG_CACHE_HOME/vrct-vox`、既定は`~/.cache/vrct-vox` |
| 環境変数 | `VRCT_CONFIG_DIR`、`VRCT_DATA_DIR`、`VRCT_CACHE_DIR`などの`VRCT_*` |
| Windowsのインストール先を記録するキー | `VRCT-VOX` |
| 音声経路と仮想マイク | `vrct.managed.*`ノード、`vrct-managed-*.service`、所有者識別子`vrct-vox-service-v1` |
| モデル取得の所有マーカー | `VRCT-VOX-model-download-v1` |
| Linuxビルド作業領域の所有マーカー | `VRCT-VOX Linux staging v1` |
| Waylandのショートカット登録 | portalのアプリID`io.github.kein5.vrct-vox`、`~/.local/share/applications/io.github.kein5.vrct-vox.desktop` |

WindowsのNSISテンプレートは上記のレジストリキーから前回のインストール先を読みます。0.5.1から、インストーラーの画面、Windowsのアプリの一覧、ショートカットには`ASTAROT`と出ます。新しく入れるときの既定のインストール先は`%LOCALAPPDATA%\ASTAROT`です。Windowsでは設定とモデルがインストール先に置かれるため、0.5.0以前から更新したときは、インストール先は元の`%LOCALAPPDATA%\VRCT-VOX`のままです。アプリの一覧の登録は同じキーのまま名前だけが変わり、`vrct-vox`という名前のショートカットは`ASTAROT`の名前に置き換わります。

## 公開

CIは[ビルドガイド](../readme_build.md)のとおり、試験と配布候補の作成を行います。GitHub Releasesの下書きは[手動の検証ゲート](release-candidates.md)から作成し、保守担当者が確認して公開します。最初の公開版は`v0.1.0-beta.1`（プレリリース）です。版は上流VRCT（3.x）とは別に0.1.0から数えます。自動公開と、CIからのHugging Faceへのアップロードは無効のままです（モデルの公開は保守担当者が手動で行います）。元のライセンス・著作権・謝辞は維持します。
