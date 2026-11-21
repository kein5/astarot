# 失敗したときに保つもの

設定、モデル、アプリの更新で、操作が途中で失敗しても何を保つかを書く（#517）。対象は 0.5.0 からの Rust の中核（`native/core`、`native/ops`）と Tauri（`src-tauri`）である。0.4 までの Python バックエンド（`src-python/`）は、0.5.0 からアプリが起動せず、0.6.0 でリポジトリからも消した。

ファイルの形と置き場所は[データ形式と保存](data-and-persistence.md)に、保存の失敗の知らせ方は[横断的な振る舞い](cross-cutting.md#サイドカーでの保存)に、更新の宛先と署名は[アプリの更新](external-interfaces.md#アプリの更新)にある。ここでは同じことを繰り返さず、失敗したときの約束だけを書く。

## 保証しないこと

ここに書く約束は、OS とファイルシステムが書き込みと名前の変更を約束どおりに行うことを前提にしている。次の場合は、直前の状態が残ることを保証しない。

- ストレージそのものの故障、ファイルシステムの破損、ほかのプログラムや利用者による書き換え
- Windows で、電源断の直前に書いた内容（Windows では、名前を変えたあとのフォルダーの記録を明示的に書き出す手段を使っていない）
- 書き込みを途中で止められない外部の処理の内部（NSIS インストーラー、`tauri-plugin-updater` の AppImage の置き換え）。どこまで確かめているかは[アプリの更新](#アプリの更新)に書く

モデルのファイルは、取得と適用のときに SHA-256 を確かめる。カタログの一覧と起動のときは大きさしか見ない。同じ大きさのまま中身が変わったファイルは、次に取得か適用をするまで気づかない。

## 共通の決まり

- 置き換える操作は、新しい内容を別の名前で書き終えて `fsync` してから、名前の変更で一度に入れ替える。途中で止まったときに残るのは、正しい名前ではない一時ファイルか作業用のフォルダーである。それを正しいデータとして読むことはない。
- Linux では、名前を変えたあとにそのフォルダーも `fsync` する（設定の保存とモデルの公開）。うまくいかなくても、名前の変更そのものは済んでいるので失敗にはしない。
- アプリが作ったものかどうかを確かめられないファイルは、消さずに残す。リンクやジャンクションの先はたどらない。
- 失敗の記録とエラーには、決まったコードとファイルの場所だけを入れる。会話、音声、API キーの値は入れない。

## 設定

| 操作 | 成功したとき | 失敗したとき | 守っている仕組み | 確かめている試験 |
|---|---|---|---|---|
| 保存 | `config.json` が新しい内容に置き換わる | 前の `config.json` が残る。値はメモリーにあり、その起動では使える。初めの1回だけ `/run/config_save_failed`（理由は `disk_full`、`permission_denied`、`read_only`、`write_failed`）を送り、30秒ごとに書き直す。書けたら `/run/config_save_recovered` を送る | 一時ファイル、`fsync`、置き換え（`config/mod.rs` の `write_config`）。`config.json.lock` のロック。書いている途中で止まった保存が残した一時ファイル（`config.json.<12桁の16進>.tmp`）は、次の保存がロックを持ったまま消す。名前が完全に一致する通常のファイルだけで、リンクやフォルダーには触れない。`secrets.json` の一時ファイルも、次に書くときに同じく消す（キーを含みうるため） | `native/core/tests/lifecycle.rs` の `a_failed_save_is_reported_once_and_its_recovery_too`、`config/mod.rs` の `a_save_removes_the_temporary_files_a_stopped_save_left_and_nothing_else`、`config/secrets.rs` の `a_write_removes_the_temporary_files_a_stopped_write_left` |
| 読み込み（JSON として読めない） | — | 元のファイルを `config.json.unreadable-<日時>-<乱数>` に移して残し、既定値で起動する。UI に `/run/config_file_unreadable` で場所を知らせる | `move_aside` | `an_unreadable_settings_file_is_kept_aside_and_reported_after_start_up` |
| 読み込み（権限がないなど、読めない理由がほかにある） | — | 元のファイルに触れず、その起動では保存しない。`load_failed` で知らせる | `load` | `a_settings_file_that_cannot_be_read_is_left_alone_and_never_overwritten` |
| API キーの移し替えと保存 | `secrets.json` に書いて読み戻せたキーだけを `config.json` から除く | キーはどちらかのファイルに残る。メモリーのキーはその起動で使える。`/run/secret_store_failed` で知らせる | [API キーの保存先](data-and-persistence.md#apiキーの保存先) | `native/core/tests/secret_store.rs`、`config/secrets.rs` の単体試験 |
| Linux の保存先の移動（0.6.0 から） | `vrct-vox` のフォルダーが `astarot` に移り、旧の名前にリンクが残り、保存したパスが付け替わる | 名前を変えられなければ旧のフォルダーをそのまま使い、次の起動でまた試す。名前を変えたあとで止まったときは、次の起動が記録（`storage_migration.json`）から続きを済ませる。パスを付け替えられなければ、旧のパスはリンクを通して読め、次の起動でやり直す | [Linuxの保存先の移動](data-and-persistence.md#linuxの保存先の移動)。名前の変更は1回の `rename` で、コピーしない | `native/core/tests/storage_linux.rs`、`storage/mod.rs` の単体試験 |

0.5 までは、ローカル音声認識の移行（`LOCAL_ASR_MIGRATION` が最新でない保存ファイル）の前に、移す前の内容を API キーを除いて `config.json.before-migration-<段階>` に残していた。写しを書けなければ `config.json` を書き換えなかった。0.6.0 はこの移行を行わないので、その写しを書かない。前の版が残した写しには触れない（`native/core/tests/lifecycle.rs` の `no_copy_before_a_migration_is_written_any_more`。[ローカル音声認識の移行](data-and-persistence.md#ローカル音声認識の移行)）。Linux の保存先を移すときは、同じ決まりで `config.json.before-migration-storage` を残す。

## モデルの取得と適用

カタログのモデルは、同意と固定の版、大きさと SHA-256 の確かめ方を変えずに、次を守る（`native/ops/src/downloads/`、[モデルの取得](../voice-stack/model-downloads.md)）。

| 操作 | 成功したとき | 失敗したとき | 確かめている試験（`native/ops/src/downloads/manager_tests.rs`） |
|---|---|---|---|
| 開始の要求 | — | 同意、カタログの版、非商用や翻訳のモデルのGemmaの利用規約などの制限の確認（`acknowledged`）のどれかが欠けていれば、フォルダーを作らず通信もせずに断る | `explicit_consent_before_any_files_or_network`、`only_fixed_catalog_requests_are_accepted`、`a_non_commercial_entry_starts_only_with_its_acknowledgement`、`an_entry_under_the_gemma_terms_starts_only_with_that_acknowledgement`、`a_speech_entry_under_the_gemma_terms_needs_no_acknowledgement` |
| 取得 | 作業用の `.partial-<16進>/` で全ファイルの大きさと SHA-256 を確かめてから、`<id>/<版>/` に名前を変えて公開する | 何も公開しない。作業用のフォルダーは消してから `failed` か `cancelled` を返す | `incomplete_oversized_or_corrupt_download_never_publishes`、`multi_file_bundle_failure_never_publishes_first_file` |
| 通信の切断、途中の読み込みの失敗 | — | `download_failed`。作業用のフォルダーを消す。ほかのファイルには触れない | `network_failure_removes_staging_and_preserves_unrelated_files`、`unexpected_stream_error_is_a_failure_not_a_stuck_job` |
| 容量不足 | — | 取得の前に足りなければ通信せずに `insufficient_space`。書いている途中でいっぱいになっても `insufficient_space` | `disk_preflight_fails_without_network`、`disk_full_during_write_leaves_no_selectable_file` |
| 取り消し、終了 | — | 公開しない。止まっている通信も打ち切る | `cancel_aborts_a_blocked_body_and_never_publishes`、`real_stopped_http_body_is_aborted_on_close` |
| アプリの異常終了の後 | 次に取得するとき、アプリが作ったと確かめられる作業用のフォルダーを消す | 知らないものが入ったフォルダーは残す | `a_live_owners_partial_is_kept_and_a_dead_owners_is_reclaimed` |
| 公開済みのファイルが壊れた、なくなった | 取得し直すと、そのフォルダーを作業用の名前に戻して消し、取り直して同じ場所に公開する | フォルダーにアプリが書いていないものがあれば、残して `size_mismatch` か `hash_mismatch` で失敗する。作業用の名前がほかのもので使われているとき、Windows でファイルが使用中のときも残す | `complete_cache_is_reverified_and_a_damaged_one_is_downloaded_again`、`a_damaged_cache_holding_anything_else_is_kept_and_fails`、`a_damaged_cache_whose_staging_name_is_taken_is_kept`、`a_damaged_cache_moved_aside_by_a_run_that_stopped_is_removed_by_the_next` |
| 適用（設定に書く） | ファイルを確かめ直してから設定に書く | 確かめられなければ設定に書かず、取得は `ready` のまま残る | `tampered_file_cannot_be_applied`、`failed_setting_application_keeps_download_available` |

公開済みのフォルダーを取り直してよいのは、中身がすべてアプリの書いたものだと確かめられたときだけである。確かめる条件は、中断した取得を片付ける条件と同じにしている。フォルダーの `owner.json` がそのモデルと公開前の作業用の名前を指し、中身がそのモデルのファイル、`owner.json`、`receipt.json` の通常のファイルだけであること。`owner.json` の `product` は 0.6.0 から `ASTAROT-model-download-v1` で、0.5.x が書いた `VRCT-VOX-model-download-v1` も同じに扱う（ADR-014）。作業用の名前に戻すので、名前を変えた直後にアプリが止まっても、次に取得するときに片付く。

利用者が登録したモデル（`user_models.json`）は、一時ファイルに書いて置き換える。読めない、または版が違うときは書き換えずに残す（`native/ops/src/downloads/user_models.rs` の試験）。登録したファイルの大きさか更新時刻が変わったら、使えるものとして扱わない。

翻訳のカタログに利用者が足した項目（`translation_catalog.json`、#413）も同じく、一時ファイルに書いて置き換え、読めないときは書き換えずに残す（`native/ops/src/downloads/translation_catalog.rs` の試験）。API の項目はキーを保管場所に書いて読み戻せなくても足し、キーは設定のキーと同じくその起動のあいだだけメモリーに持つ（ADR-013）。保管場所が使えるようになればキーを書き、項目の `key` を `true` にする。置けないままアプリを閉じた項目はキーのない項目として残り、キーを平文で残すことはない。保管場所が一時的に読めないときは、キーがないとは扱わずに何も変えない。推論エンジン系の項目のフォルダーが読めなくなったら、項目は残したまま重みを一覧から外し、選んでいた設定は既定のモデルに戻る。理由は項目の ID と固定のコードだけで `process.log` に書く（`native/core/tests/translation_catalog.rs`）。以前の版で `translation-models` フォルダーに置いたモデル（`custom:<フォルダー>`）を選んでいた設定も、同じく既定のモデルに戻る（#597）。起動は止めない。`process.log` には固定のコード `translation_models_folder_retired` だけを書き、フォルダーの名前は書かない。利用者への知らせは別に出さず、翻訳のページの案内に任せる（`native/core/tests/translation_models.rs`）。

### 実行環境の準備（`vc_runtimes/`）

RVC の worker が読む ONNX Runtime と 2 つのネットワーク、アプリの ONNX Runtime（CUDA と DirectML）、翻訳の llama.cpp は、同意のあとで `<状態のフォルダー>/vc_runtimes/<id>/` に用意する（`native/voice-conversion/src/runtime.rs`）。

| 操作 | 成功したとき | 失敗したとき | 確かめている試験（`native/core/tests/voice.rs`） |
|---|---|---|---|
| 開始の要求 | — | 同意と版の一致がなければ、何も取得しない | `the_rvc_runtime_is_set_up_only_after_consent_and_checked_by_the_worker` |
| 取得 | `<名前>.part` に書き、大きさと SHA-256 を確かめてから名前を変える | 公開しない。合わないファイルは消す。容量不足は取得の前と書いている途中の両方で `vc_runtime_space` | `a_failed_runtime_setup_names_its_step` |
| ライブラリ | `lib.part` に展開し終えてから、前の `lib` を `lib.previous` に移し、新しい `lib` を置き、前のものを消す | 新しいものを置けなければ前の `lib` を戻す。Windows で前のライブラリが使用中（変換中の worker、アプリが読み込んだ ONNX Runtime）なら、何も消さずに `vc_runtime_libraries_failed` | `a_repair_puts_the_new_libraries_in_place_of_the_old_ones` |
| 確認（worker か llama.cpp が実際に読み込む） | すべての段階が終わってから `receipt.json` を一時ファイルと置き換えで書く | `vc_runtime_check_failed`。受領書を書かないので、使えるものとして扱わない | `a_failed_runtime_setup_names_its_step` |
| 途中で止まった後 | 終わった段階（`.steps.json`、`lib.part/.archives.json`）から続ける。2 つの名前の変更のあいだで止まったときは、起動のときに前の `lib` を戻す | 受領書が読めない、または受領書にあるファイルが欠けていれば、使えるものとして扱わない | `libraries_a_stopped_repair_moved_aside_come_back_at_start` |

翻訳の LLM（`llamacpp` の項目、ADR-015）は llama.cpp のサーバーで動く。サーバーが起動できない（モデルを読めない、メモリー不足、時間切れ）ときは翻訳を有効にできず、メモリー不足は GPU のメモリー不足と同じ知らせになる。使っているあいだにサーバーが終わったら、次の翻訳で一度だけ起動し直し、それでも動かなければその翻訳を失敗として知らせる。サーバーはアプリと一緒に止まり、アプリが異常終了しても残らない（Windows はジョブ、Linux は親の終了で届くシグナル）。音声の経路とほかの翻訳エンジンには触れない（`native/core/tests/translation_llama.rs`、`native/speech-server/tests/llama.rs`）。

## アプリの更新

どのコピーがアプリの中で更新するかは、入れ方で決まる（[アプリの更新](external-interfaces.md#アプリの更新)の表）。パッケージマネージャーで入れたコピー（deb、rpm）は確認もしないので、アプリの中の更新とパッケージマネージャーがぶつかることはない。書き込めない場所の AppImage、Windows の ZIP、Linux の tar.gz は知らせるだけで、ファイルを置き換えない。

| 入れ方 | 更新の責任 | 失敗したときに保つもの | 確かめているもの |
|---|---|---|---|
| Windows のインストーラー | アプリが署名を確かめたインストーラーを起動する。入れ替えはインストーラー | パッケージの SHA-256 が合わない、壊れている、途中で切れている、ファイルが使用中で入れ替えられないときは、前のインストールのまま。入れ替えの途中で止まったときは、次にインストーラーを動かすと前の状態に戻す | `tests/installer/windows_update_scenarios.py`（CI の `installer-update-tests.yml` で本物の NSIS を動かす） |
| AppImage（書き込める場所） | アプリ。`tauri-plugin-updater` は取得と署名の確認だけで、置き換えはアプリが行う（`src-tauri/src/app_update.rs` の `replace_appimage`） | 署名と ELF であることを確かめてから、同じフォルダーの隠しファイル（`.<名前>.update-<番号>`）に書き、前の AppImage の権限を付け、`fsync` して名前を変えて置き換える。名前を変える前に失敗したり止まったりしても、前の AppImage はそのまま残る。止まったときの書きかけのファイルは、次の起動で消す。動いているアプリは前のファイルのまま動き続ける | `app_update.rs` の単体試験（`an_appimage_is_replaced_in_one_rename_and_keeps_its_permissions`、`a_failed_replacement_leaves_the_appimage_as_it_was`、`what_a_stopped_replacement_left_goes_and_nothing_else`）。`src-tauri` の試験は CI では動かない |
| 書き込めない場所の AppImage、Windows の ZIP、Linux の tar.gz | 利用者 | アプリはファイルを置き換えない | `app_update.rs` の単体試験（入れ方の判定） |
| deb、rpm | パッケージマネージャー | アプリは確認も置き換えもしない | 同上 |

`tauri-plugin-updater` 自身が AppImage を原子的に置き換える（同じフォルダーに書いてから名前を変える）ようになったら、アプリの置き換え（`replace_appimage`）をやめ、Windows のインストーラーと同じくプラグインの `Update::install` に戻す（#881 で決定）。プラグインを上げるときは、その `install_appimage` を確かめる。

どの入れ方でも、ダウンロードと署名の確認に失敗したときはファイルに触れず、今の版のまま理由のコード（`update_download_failed`、`update_signature_invalid` など）を返す。Windows でバックエンドを止めたあとにインストーラーを起動できなかったときは、アプリを起動し直してバックエンドのある状態に戻す。

## 残課題

- 公開済みのモデルが同じ大きさのまま壊れたとき、取得の画面は取得し直すまで使えるものとして表示する。起動のたびに SHA-256 を確かめると、数 GB のモデルでは時間がかかる。
- 新しい版の設定を古い版で開いても、知らないキーと、新しい版で足した選択肢のように古い版の検査に通らない値は、ファイルに残る（#560。この直しを含む版から。`NEWEST_SAVING_VERSION` で新しい版が保存したことを見分ける）。古い版でその設定を変えたときは、古い版の値になる。この直しより前の版は、知らないキーと検査に通らない値を捨てて保存する。
