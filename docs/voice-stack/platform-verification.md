# 対応環境の検証の記録

利用者向けの[対応環境と検証の範囲](../../site/ja/guide/support.md)（英語は[Platform support](../../site/en/guide/support.md)）の根拠にした記録の一覧です。マトリクスのどの欄もこの一覧のどれかの記録に基づきます。記録がない欄は「未検証」と書きます。

作成日は 2026-11-18、対象の版は 0.5.1 です。

## 言葉の決まり

マトリクスでは対応の扱いと確かめ方を分けて書きます。CI が通っていることは、実際の PC で動くことを意味しません。

| 区分 | 意味 |
|---|---|
| 正式サポート | 配布物を出していて、不具合を直す対象にしている環境 |
| ベストエフォート | 動くことを想定しているが、確かめていないか、確かめた範囲が狭い環境。報告は受け付けるが、直せないことがある |
| 未対応 | 配布物がない、または動かないと分かっている環境 |
| CI で検証 | GitHub Actions のランナーで自動で確かめた。実際の音声機器、GPU、VRChat、ヘッドセットは使わない |
| 実機で検証 | 実際の PC で、配布物か開発用のビルドを動かして確かめ、その記録が残っている。版と OS を添える |
| 未検証 | CI でも実機でも確かめた記録がない |

実機の記録には確かめた版を必ず添えます。0.5.0 でバックエンドを Python から Rust の中核に作り直したので、0.4 以前の記録は 0.5 系の動作の根拠にしません。マトリクスでは「0.5より前の版で確認」と分けて書きます。

## CI が確かめていること

| ワークフローとジョブ | ランナー | 確かめること | 確かめないこと |
|---|---|---|---|
| `voice-tests.yml` の `headless` | `ubuntu-latest`、`windows-latest` | モデルなしの契約試験、UI の単体試験と型チェックとビルド（`check --scope voice`、`ui`）。Linux では固定した版の PipeWire を隔離した場所に作って、音声の補助プログラムを試す | 画面、実際の音声機器、モデル |
| `voice-tests.yml` の `core-integration` | `ubuntu-latest`、`windows-latest` | 中核（`native/core`）、OpenVR、VR オーバーレイ、音声認識、声質変換のクレートの試験。VR は偽の SteamVR（`FakeVr`）を使う | モデル、機器、ネットワーク、実際の SteamVR |
| `voice-tests.yml` の `backend-windows`、`backend-linux` | `windows-latest`、`ubuntu-latest` | Python のバックエンド（`src-python/`）の試験 | 0.5.0 から配布物に Python は入っていないので、配布物の動作の根拠にはならない |
| `build-linux.yml` | `ubuntu-24.04` | tar.gz、AppImage、deb、rpm を作る。tar.gz を読み取り専用の場所に置いて起動する試験と、AppImage を展開方式で起動する試験を Xvfb（X11）で行う。起動、描画、設定画面の操作、終了まで。deb と rpm は Ubuntu 24.04、Debian 13、Fedora 44 のコンテナに入れて、ライブラリがそろうこと、同梱の音声エンジンが起動すること、削除で残らないことを確かめる | FUSE での起動、Wayland、実際の音声、モデル、VRChat。deb と rpm の画面 |
| `release.yml` | `windows-latest` | CPU 版と CUDA 版の ZIP と NSIS のインストーラーを作り、配布してはいけないファイル、容量、SHA-256、組み込んだハッシュを確かめる | アプリの起動、画面、音声 |
| `windows-package.yml` | `windows-latest` | `_internal` に入るファイルがそろっていること | アプリの起動 |
| `installer-update-tests.yml` | `windows-latest` | 実際の NSIS のインストーラーで、軽いダミーの中身を使った新規インストール、更新、巻き戻し、中断からの復旧、表示名の変更 | 実際の配布物の中身、アプリの起動 |

`build-linux.yml`、`windows-package.yml`、`installer-update-tests.yml` は、関係するファイルを変えた PR と手動の実行でだけ動きます。`release.yml` は main 宛ての PR と手動の実行で動きます。Windows のアプリの画面を開く CI はありません。

## 実機の記録

### 0.5 系

| 記録 | 版 | OS と形式 | 確かめたこと | 確かめなかったこと |
|---|---|---|---|---|
| [PR #571 のコメント](https://github.com/kein5/astarot/pull/571#issuecomment-6956375435) の「候補のビルドと Windows での検証の結果」 | 0.5.1 の候補 | Windows 11 Home Insider Preview build 26320、x64。インストーラーと ZIP | 来歴と `.sha256` の照合。0.5.0 からの更新（取得先をローカルに替えた同じコミットのインストーラーで、`/P /UPDATE`）。「アプリと機能」の表示。更新後の起動。チャット読み取りの範囲読み（試験用のウィンドウ）。テレメトリを切った状態で ONNX Runtime が送信しないこと | 新規インストール、ローカル翻訳（モデルがカタログにない）、実際の VRChat での吹き出しの検出、音声認識、読み上げ、RVC、仮想マイク、VR。Linux |
| [PR #520](https://github.com/kein5/astarot/pull/520) | 0.5.0-beta.5 と修正 | Windows 11、x64 | 0.5.0-beta.5 の実機確認で、読み上げを仮想マイクへ送ると `output_underflow` で無音になる不具合を見つけた。修正のあと、Steam Streaming の仮想デバイスへの再生を試験（`native/audio-routing/tests/wasapi_live.rs`）で確かめた | アプリの読み上げから VRChat まで届くことの通し確認。VB-CABLE などほかの仮想マイク |
| [PR #453](https://github.com/kein5/astarot/pull/453) | 0.5.0-beta.2 と修正 | Linux（ディストリビューションとデスクトップの記録なし）、AppImage と tar.gz。Windows 11 の開発用のビルド | Linux の実機テストで、AppImage の起動直後のエンジンの通知、トレイがないときの閉じるボタンの名前、トレイの題を見つけた。Windows で窓の位置を確かめた | 修正のあとの Linux の実機での確認 |

0.5 系の Linux の配布物を、修正のあとに実機で確かめた記録はありません。

### 0.5 より前の版

| 記録 | 版 | OS と形式 | 確かめたこと |
|---|---|---|---|
| [Windows 音声の検証記録](windows-voice-report.md) | 0.1.0 のベータ版のころ（2026-11-07〜11-13）、Python のバックエンド | Windows 11 Insider build 26220、開発用のビルドと凍結したサイドカー | 同梱の speech.cpp での読み上げと音声認識、RVC と Seed-VC、入力の転送、実際の SteamVR（null ドライバー）でのオーバーレイ、実マイク、ホットキー（`SendInput`）、VRChat の検出、翻訳モデルの取得、デスクトップの字幕オーバーレイ |
| [Windows で未確認の変更](windows-pending-checks.md) | 0.1.0-beta.7、0.1.0 の ZIP | Windows 11 | 展開して起動、設定の各ページ、デスクトップの字幕オーバーレイ、翻訳モデルの取得から翻訳まで |
| [ベンチマーク](benchmarks.md#vrchatデスクトップ手動試験)の「VRChatデスクトップ手動試験」 | Python のバックエンドの版 | Linux、アプリが作る仮想マイク | 仮想マイクを VRChat の入力に選び、VRChat の録音・再生のテストで声が聞こえた。VRChat の中の遅延とほかの利用者への送信は確かめていない |
| [README](../../README.md) の Platforms の節と[配布候補](release-candidates.md#動く環境) | 0.4 以前 | CachyOS（KDE Plasma、Wayland）、x64 | 実際のモデルを使った試験（`tools/native_acceptance.py`）。Linux のデスクトップでの確認は KDE Plasma（Wayland）だけ |

## マトリクスを更新するとき

- 対応の範囲を変える PR（配布形式、OS、ランタイムの条件、プラットフォーム固有の処理）は、PR の本文に、影響するプラットフォーム、確かめた環境、確かめていない環境、後方互換性への影響を書きます（[PR のテンプレート](../../.github/pull_request_template.md)）。
- 実機で確かめたら、この一覧に記録を足してから、マトリクスの欄を変えます。記録には版、OS とその版、配布形式、確かめたことと確かめなかったことを書きます。PC の持ち主が分かる情報は書きません。
- 配布物の名前、deb と rpm を試すコンテナ、CI のランナーを変えたら、マトリクスも直します。`tests/voice/test_support_matrix.py` が、ワークフローに書かれた配布物の名前とコンテナの OS がマトリクスにあるかを確かめます。
- マトリクスに書く内容は[README](../../README.md)、[動作環境と推奨スペック](../../site/ja/guide/requirements.md)、[インストール](../../site/ja/guide/install.md)と食い違わないようにします。
