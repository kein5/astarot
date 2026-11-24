# What is kept when something fails

[日本語版](#失敗したときに保つもの日本語版)

This page describes what is kept when an operation on settings, models or app updates fails partway (#517). It covers the Rust core from 0.5.0 (`native/core`, `native/ops`) and Tauri (`src-tauri`). The Python backend up to 0.4 (`src-python/`) is not started by the app from 0.5.0, and was removed from the repository as well in 0.6.0.

File formats and locations are in [Data formats and storage](data-and-persistence.md), how a failed save is reported is in [Cross-cutting behavior](cross-cutting.md#サイドカーでの保存), and update destinations and signatures are in [App updates](external-interfaces.md#アプリの更新). This page does not repeat them and gives only the promises for failures.

## What is not guaranteed

The promises here assume that the OS and the file system carry out writes and renames as they promise. In the following cases, the previous state is not guaranteed to remain.

- A failure of the storage itself, a damaged file system, or changes made by other programs or the user
- On Windows, content written just before a power loss (on Windows, nothing is used to explicitly flush the folder's record after a rename)
- The inside of outside processes whose writing cannot be stopped partway (the NSIS installer, the AppImage replacement of `tauri-plugin-updater`). How far this is checked is in [App updates](#app-updates)

Model files have their SHA-256 checked when they are downloaded and when they are applied. The catalog list and startup look only at the size. A file whose content changed while its size stayed the same goes unnoticed until the next download or apply.

## Common rules

- An operation that replaces something first writes the new content under another name and runs `fsync` on it, then swaps it in all at once with a rename. If it stops partway, what is left is a temporary file or a working folder that does not have the correct name. It is never read as valid data.
- On Linux, the folder is also synced with `fsync` after the rename (saving settings and publishing models). If that does not work, it is not treated as a failure, because the rename itself is done.
- A file that cannot be confirmed as made by the app is kept, not deleted. Links and junctions are not followed.
- Failure records and errors hold only fixed codes and file locations. Conversations, audio and API key values are not included.

## Settings

| Operation | On success | On failure | What protects it | Tests that check it |
|---|---|---|---|---|
| Save | `config.json` is replaced with the new content | The previous `config.json` remains. The values are in memory and can be used for that run. Only the first time, `/run/config_save_failed` is sent (with the reason `disk_full`, `permission_denied`, `read_only` or `write_failed`), and the file is written again every 30 seconds. Once it is written, `/run/config_save_recovered` is sent | A temporary file, `fsync` and replacement (`write_config` in `config/mod.rs`). The `config.json.lock` lock. Temporary files (`config.json.<12 hex digits>.tmp`) left by a save that stopped while writing are removed by the next save while it holds the lock. Only regular files whose names match exactly are removed; links and folders are not touched. Temporary files of `secrets.json` are also removed the same way at the next write (because they may contain keys) | `a_failed_save_is_reported_once_and_its_recovery_too` in `native/core/tests/lifecycle.rs`, `a_save_removes_the_temporary_files_a_stopped_save_left_and_nothing_else` in `config/mod.rs`, `a_write_removes_the_temporary_files_a_stopped_write_left` in `config/secrets.rs` |
| Load (cannot be read as JSON) | — | The original file is moved aside to `config.json.unreadable-<date and time>-<random number>` and kept, and the app starts with the defaults. `/run/config_file_unreadable` tells the UI where the file is | `move_aside` | `an_unreadable_settings_file_is_kept_aside_and_reported_after_start_up` |
| Load (cannot be read for another reason, such as missing permission) | — | The original file is left untouched, and nothing is saved during that run. Reported with `load_failed` | `load` | `a_settings_file_that_cannot_be_read_is_left_alone_and_never_overwritten` |
| Moving and saving API keys | Only keys that were written to `secrets.json` and read back are removed from `config.json` | Each key stays in one of the two files. Keys in memory can be used for that run. Reported with `/run/secret_store_failed` | [Where API keys are stored](data-and-persistence.md#apiキーの保存先) | `native/core/tests/secret_store.rs`, the unit tests in `config/secrets.rs` |
| Moving the Windows install location (from 0.7.0) | Saved paths are repointed to locations under `%LOCALAPPDATA%\ASTAROT`, and `installer_moved_from.txt` is removed | If the paths cannot be repointed, the file is kept and the next start tries again. If the file's content cannot be used, it is removed without changing anything | [Moving the Windows install location](data-and-persistence.md#windowsのインストール先の移動). Repointing uses `relocate_saved_paths`, the same as on Linux | `native/core/tests/storage_installer.rs`, the unit tests in `storage/installer.rs` and `storage/mod.rs` |
| Moving the Linux storage location (from 0.6.0) | The `vrct-vox` folder moves to `astarot`, a link remains under the old name, and saved paths are repointed | If the rename fails, the old folder stays in use and the next start tries again. If the app stops after the rename, the next start finishes the rest using the record (`storage_migration.json`). If paths cannot be repointed, the old paths can still be read through the link, and the next start tries again | [Moving the Linux storage location](data-and-persistence.md#linuxの保存先の移動). The rename is a single `rename`, with no copy | `native/core/tests/storage_linux.rs`, the unit tests in `storage/mod.rs` |

Up to 0.5, before the local speech recognition migration (of a saved file whose `LOCAL_ASR_MIGRATION` was not the latest), the content from before the migration, minus API keys, was kept in `config.json.before-migration-<stage>`. If that copy could not be written, `config.json` was not changed. 0.6.0 does not run this migration, so it does not write the copy. Copies left by earlier versions are not touched (`no_copy_before_a_migration_is_written_any_more` in `native/core/tests/lifecycle.rs`; [Local speech recognition migration](data-and-persistence.md#ローカル音声認識の移行)). When the Linux storage location is moved, `config.json.before-migration-storage` is kept by the same rule.

## Downloading and applying models

Catalog models keep the following, without changing the consent, the pinned versions, or how size and SHA-256 are checked (`native/ops/src/downloads/`, [Model downloads](../voice-stack/model-downloads.md)).

| Operation | On success | On failure | Tests that check it (`native/ops/src/downloads/manager_tests.rs`) |
|---|---|---|---|
| Start request | — | If consent, the catalog version, or the acknowledgement of a restriction (`acknowledged`), such as non-commercial use or the Gemma terms of use of the translation models, is missing, the request is refused without creating a folder or connecting to the network | `explicit_consent_before_any_files_or_network`, `only_fixed_catalog_requests_are_accepted`, `a_non_commercial_entry_starts_only_with_its_acknowledgement`, `an_entry_under_the_gemma_terms_starts_only_with_that_acknowledgement`, `a_speech_entry_under_the_gemma_terms_needs_no_acknowledgement` |
| Download | The size and SHA-256 of every file are checked in the working folder `.partial-<hex>/`, and then the folder is published by renaming it to `<id>/<version>/` | Nothing is published. The working folder is removed, then `failed` or `cancelled` is returned | `incomplete_oversized_or_corrupt_download_never_publishes`, `multi_file_bundle_failure_never_publishes_first_file` |
| Lost connection, read failure partway | — | `download_failed`. The working folder is removed. Other files are not touched | `network_failure_removes_staging_and_preserves_unrelated_files`, `unexpected_stream_error_is_a_failure_not_a_stuck_job` |
| Not enough space | — | If there is not enough space before the download, `insufficient_space` is returned without connecting. If the disk fills up while writing, the result is also `insufficient_space` | `disk_preflight_fails_without_network`, `disk_full_during_write_leaves_no_selectable_file` |
| Cancel, quit | — | Nothing is published. A stalled connection is cut off too | `cancel_aborts_a_blocked_body_and_never_publishes`, `real_stopped_http_body_is_aborted_on_close` |
| After the app crashed | At the next download, working folders that can be confirmed as made by the app are removed | A folder that holds anything unknown is kept | `a_live_owners_partial_is_kept_and_a_dead_owners_is_reclaimed` |
| A published file is damaged or missing | When the model is downloaded again, its folder is moved back to a working name and removed, the model is downloaded again, and it is published in the same place | If the folder holds anything the app did not write, it is kept and the download fails with `size_mismatch` or `hash_mismatch`. It is also kept when the working name is taken by something else, or when a file is in use on Windows | `complete_cache_is_reverified_and_a_damaged_one_is_downloaded_again`, `a_damaged_cache_holding_anything_else_is_kept_and_fails`, `a_damaged_cache_whose_staging_name_is_taken_is_kept`, `a_damaged_cache_moved_aside_by_a_run_that_stopped_is_removed_by_the_next` |
| Apply (write it to the settings) | The files are checked again, then the model is written to the settings | If the check fails, nothing is written to the settings, and the download stays `ready` | `tampered_file_cannot_be_applied`, `failed_setting_application_keeps_download_available` |

A published folder may be downloaded again only when its whole content can be confirmed as written by the app. The conditions are the same as for cleaning up an interrupted download: the folder's `owner.json` points to that model and to its working name before publishing, and the content is only regular files, namely that model's files, `owner.json` and `receipt.json`. The `product` in `owner.json` is `ASTAROT-model-download-v1` from 0.6.0, and `VRCT-VOX-model-download-v1`, written by 0.5.x, is treated the same way (ADR-014). Because the folder goes back to its working name, it is cleaned up at the next download even if the app stops right after the rename.

Models the user registered (`user_models.json`) are written to a temporary file that then replaces the old one. When the file cannot be read or has a different version, it is kept without being rewritten (the tests in `native/ops/src/downloads/user_models.rs`). When a registered file's size or modification time changes, the model is no longer treated as usable.

API entries the user added on the speech recognition page (`transcription_catalog.json`, #414) are handled like the API entries of the translation catalog (the tests in `native/ops/src/downloads/transcription_catalog.rs` and `native/core/tests/transcription_catalog.rs`). Entries the user added to the translation catalog (`translation_catalog.json`, #413) are handled the same way: they are written to a temporary file that then replaces the old one, and the file is kept without being rewritten when it cannot be read (the tests in `native/ops/src/downloads/translation_catalog.rs`). An API entry is added even when its key cannot be written to the secret store and read back; like the keys in the settings, the key is then held in memory only for that run (ADR-013). When the store becomes available, the key is written and the entry's `key` is set to `true`. An entry whose key could not be stored before the app closed remains as an entry without a key, and the key is never left in plain text. When the store is temporarily unreadable, the key is not treated as missing, and nothing changes. When the folder of an inference-engine entry becomes unreadable, the entry stays but its weights are taken out of the list, and a setting that had chosen them goes back to the default model. The reason is written to `process.log` as only the entry ID and a fixed code (`native/core/tests/translation_catalog.rs`). A setting that had chosen a model placed in the `translation-models` folder by an earlier version (`custom:<folder>`) also goes back to the default model (#597). Startup does not stop. Only the fixed code `translation_models_folder_retired` is written to `process.log`, without the folder name. No separate notice goes to the user; the guidance on the Translation page covers it (`native/core/tests/translation_models.rs`).

### Preparing runtimes (`vc_runtimes/`)

The ONNX Runtime and the two networks that the RVC worker loads, the app's ONNX Runtime (CUDA and DirectML), and llama.cpp for translation are prepared in `<state folder>/vc_runtimes/<id>/` after consent (`native/voice-conversion/src/runtime.rs`).

| Operation | On success | On failure | Tests that check it (`native/core/tests/voice.rs`) |
|---|---|---|---|
| Start request | — | Without consent and a matching version, nothing is downloaded | `the_rvc_runtime_is_set_up_only_after_consent_and_checked_by_the_worker` |
| Download | The file is written to `<name>.part`, its size and SHA-256 are checked, and then it is renamed | Nothing is published. A file that does not match is removed. Running out of space gives `vc_runtime_space`, both before the download and while writing | `a_failed_runtime_setup_names_its_step` |
| Libraries | Everything is extracted into `lib.part` first; then the previous `lib` is moved to `lib.previous`, the new `lib` is put in place, and the previous one is removed | If the new libraries cannot be put in place, the previous `lib` is restored. In both cases the record of the extraction (`lib.part/.archives.json`) is kept, so starting again replaces the libraries without downloading them again. On Windows, if the previous libraries are in use (by a worker that is converting, or by the llama.cpp server for translation), nothing is removed and the result is `vc_runtime_in_use`. On Windows, a runtime that holds an ONNX Runtime the app loaded for translation cannot be replaced while the app is running. So the download and the extraction are finished, `lib.at-next-start.json` is written, and the operation ends with `restart_required`. The previous `lib` stays in use. At the next start, before the libraries are loaded (`recover_libraries` in `shipped_libraries::use_libraries`), the new `lib` is put in place. If the receipt points to the same version, the runtime can be used as it is (the check stage is not run again). If there is no receipt, only the check stage runs when the setup is started again. If the libraries could not be put in place, it waits for the next start as it is (#880, #900) | `a_repair_puts_the_new_libraries_in_place_of_the_old_ones`, `a_repair_of_libraries_the_app_has_loaded_puts_them_in_place_at_the_next_start`, `a_held_repair_of_a_runtime_without_its_receipt_is_only_checked_after_the_next_start`, `a_repair_that_could_not_swap_the_libraries_resumes_without_fetching_them_again` (Unix), `a_repair_the_old_libraries_hold_up_says_they_are_in_use_and_keeps_them` (Windows) |
| Check (the worker or llama.cpp actually loads them) | After all stages are done, `receipt.json` is written with a temporary file and a replacement | `vc_runtime_check_failed`. No receipt is written, so the runtime is not treated as usable | `a_failed_runtime_setup_names_its_step` |
| After a stop partway | The setup continues from the stages already done (`.steps.json`, `lib.part/.archives.json`). If it stopped between the two renames, the previous `lib` is restored at startup | If the receipt cannot be read, or files listed in the receipt are missing, the runtime is not treated as usable | `libraries_a_stopped_repair_moved_aside_come_back_at_start` |

The translation LLM (`llamacpp` entries, ADR-015) runs on the llama.cpp server. When the server cannot start (it cannot load the model, runs out of memory, or times out), translation cannot be turned on, and running out of memory gives the same notice as running out of GPU memory. If the server ends while in use, the next translation starts it again once, and if it still does not work, that translation is reported as failed. The server stops with the app and does not stay behind even if the app crashes (a job on Windows, a signal delivered when the parent exits on Linux). The audio route and the other translation engines are not touched (`native/core/tests/translation_llama.rs`, `native/speech-server/tests/llama.rs`).

## App updates

Which copies update themselves inside the app depends on how they were installed (the table in [App updates](external-interfaces.md#アプリの更新)). A copy installed with a package manager (deb, rpm) does not even check for updates, so an in-app update never collides with the package manager. An AppImage in a location that cannot be written to, the Windows ZIP and the Linux tar.gz only notify and do not replace files.

| Installed as | Responsible for the update | What is kept on failure | What checks it |
|---|---|---|---|
| Windows installer | The app starts the installer after checking its signature. The installer does the replacement | If the package's SHA-256 does not match, the package is damaged or cut off, or files are in use and cannot be replaced, the previous installation stays. If the replacement stopped partway, the next run of the installer restores the previous state. If the default install location of 0.5.0 and earlier cannot be moved (the destination is not empty, a file is open), the installation stays in the original place where it was updated, and the next update tries again. If it stopped after the rename and before the registry keys were written, the next update finds the installation in the new place and fixes the registry keys and shortcuts ([Moving the Windows install location](data-and-persistence.md#windowsのインストール先の移動)). If the `vrct-vox.exe` of 0.6.x and earlier cannot be removed, or the update stopped after repointing and before removing it, the next update repoints the shortcuts again and then removes it ([The name of the main executable](data-and-persistence.md#本体の実行ファイルの名前)). An installer started while another installer is running exits with exit code 2 without changing anything | `tests/installer/windows_update_scenarios.py` (runs the real NSIS in the `installer-update-tests.yml` CI workflow) |
| AppImage (in a writable location) | The app. `tauri-plugin-updater` only downloads the update and checks its signature; the app does the replacement (`replace_appimage` in `src-tauri/src/app_update.rs`) | After checking the signature and that the file is an ELF file, the app writes it to a hidden file in the same folder (`.<name>.update-<number>`), gives it the previous AppImage's permissions, syncs it with `fsync`, and replaces the AppImage by renaming. If anything fails or stops before the rename, the previous AppImage remains as it was. A half-written file left by a stop is removed at the next start. The running app keeps running from the previous file | The unit tests in `app_update.rs` (`an_appimage_is_replaced_in_one_rename_and_keeps_its_permissions`, `a_failed_replacement_leaves_the_appimage_as_it_was`, `what_a_stopped_replacement_left_goes_and_nothing_else`). The `src-tauri` tests do not run in CI |
| AppImage in a location that cannot be written to, Windows ZIP, Linux tar.gz | The user | The app does not replace files | The unit tests in `app_update.rs` (telling how the app was installed) |
| deb, rpm | The package manager | The app neither checks for nor replaces anything | Same as above |

When `tauri-plugin-updater` itself comes to replace AppImages atomically (writing in the same folder and then renaming), the app's own replacement (`replace_appimage`) is dropped and the app goes back to the plugin's `Update::install`, as for the Windows installer (decided in #881). When upgrading the plugin, check its `install_appimage`.

For every way of installing, when the download or the signature check fails, no file is touched, the app stays at the current version, and a reason code is returned (`update_download_failed`, `update_signature_invalid` and others). On Windows, if the installer could not be started after the backend was stopped, the app starts again to get back to a state with a backend.

## Remaining issues

- When a published model is damaged while keeping the same size, the download screen shows it as usable until it is downloaded again. Checking SHA-256 at every start would take time for models of several GB.
- When settings saved by a newer version are opened in an older version, unknown keys and values that fail the older version's validation, such as choices added in the newer version, stay in the file (#560; from the version that includes this fix. `NEWEST_SAVING_VERSION` tells that a newer version saved the file). When that setting is changed in the older version, it takes the older version's value. Versions before this fix drop unknown keys and values that fail validation when they save.

---

# 失敗したときに保つもの（日本語版）

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
| Windows のインストール先の移動（0.7.0 から） | 保存したパスが `%LOCALAPPDATA%\ASTAROT` の下に付け替わり、`installer_moved_from.txt` が消える | 付け替えられなければファイルを残し、次の起動でやり直す。ファイルの中身が使えないときは何も変えずに消す | [Windowsのインストール先の移動](data-and-persistence.md#windowsのインストール先の移動)。付け替えは Linux と同じ `relocate_saved_paths` | `native/core/tests/storage_installer.rs`、`storage/installer.rs` と `storage/mod.rs` の単体試験 |
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

音声認識のページに利用者が足したAPIの項目（`transcription_catalog.json`、#414）は、翻訳のカタログのAPIの項目と同じく扱う（`native/ops/src/downloads/transcription_catalog.rs`と`native/core/tests/transcription_catalog.rs`の試験）。翻訳のカタログに利用者が足した項目（`translation_catalog.json`、#413）も同じく、一時ファイルに書いて置き換え、読めないときは書き換えずに残す（`native/ops/src/downloads/translation_catalog.rs` の試験）。API の項目はキーを保管場所に書いて読み戻せなくても足し、キーは設定のキーと同じくその起動のあいだだけメモリーに持つ（ADR-013）。保管場所が使えるようになればキーを書き、項目の `key` を `true` にする。置けないままアプリを閉じた項目はキーのない項目として残り、キーを平文で残すことはない。保管場所が一時的に読めないときは、キーがないとは扱わずに何も変えない。推論エンジン系の項目のフォルダーが読めなくなったら、項目は残したまま重みを一覧から外し、選んでいた設定は既定のモデルに戻る。理由は項目の ID と固定のコードだけで `process.log` に書く（`native/core/tests/translation_catalog.rs`）。以前の版で `translation-models` フォルダーに置いたモデル（`custom:<フォルダー>`）を選んでいた設定も、同じく既定のモデルに戻る（#597）。起動は止めない。`process.log` には固定のコード `translation_models_folder_retired` だけを書き、フォルダーの名前は書かない。利用者への知らせは別に出さず、翻訳のページの案内に任せる（`native/core/tests/translation_models.rs`）。

### 実行環境の準備（`vc_runtimes/`）

RVC の worker が読む ONNX Runtime と 2 つのネットワーク、アプリの ONNX Runtime（CUDA と DirectML）、翻訳の llama.cpp は、同意のあとで `<状態のフォルダー>/vc_runtimes/<id>/` に用意する（`native/voice-conversion/src/runtime.rs`）。

| 操作 | 成功したとき | 失敗したとき | 確かめている試験（`native/core/tests/voice.rs`） |
|---|---|---|---|
| 開始の要求 | — | 同意と版の一致がなければ、何も取得しない | `the_rvc_runtime_is_set_up_only_after_consent_and_checked_by_the_worker` |
| 取得 | `<名前>.part` に書き、大きさと SHA-256 を確かめてから名前を変える | 公開しない。合わないファイルは消す。容量不足は取得の前と書いている途中の両方で `vc_runtime_space` | `a_failed_runtime_setup_names_its_step` |
| ライブラリ | `lib.part` に展開し終えてから、前の `lib` を `lib.previous` に移し、新しい `lib` を置き、前のものを消す | 新しいものを置けなければ前の `lib` を戻す。どちらの場合も、展開した記録（`lib.part/.archives.json`）は残すので、もう一度開始すると取得し直さずに置き換える。Windows で前のライブラリが使用中（変換中の worker、翻訳の llama.cpp のサーバー）なら、何も消さずに `vc_runtime_in_use`。アプリが翻訳のために読み込んだ ONNX Runtime を持つ実行環境は、Windows ではアプリが動いている間は置き換えられない。そのため、取得と展開までを済ませ、`lib.at-next-start.json` を書いて `restart_required` で終える。前の `lib` はそのまま使う。次の起動で、ライブラリを読み込む前に（`shipped_libraries::use_libraries` の `recover_libraries`）新しい `lib` を置く。受領書が同じ版を指していれば、そのまま使える（確認の段階はもう一度は行わない）。受領書がなければ、もう一度開始したときに確認の段階だけを行う。置けなかったときは、そのまま次の起動を待つ（#880、#900） | `a_repair_puts_the_new_libraries_in_place_of_the_old_ones`、`a_repair_of_libraries_the_app_has_loaded_puts_them_in_place_at_the_next_start`、`a_held_repair_of_a_runtime_without_its_receipt_is_only_checked_after_the_next_start`、`a_repair_that_could_not_swap_the_libraries_resumes_without_fetching_them_again`（Unix）、`a_repair_the_old_libraries_hold_up_says_they_are_in_use_and_keeps_them`（Windows） |
| 確認（worker か llama.cpp が実際に読み込む） | すべての段階が終わってから `receipt.json` を一時ファイルと置き換えで書く | `vc_runtime_check_failed`。受領書を書かないので、使えるものとして扱わない | `a_failed_runtime_setup_names_its_step` |
| 途中で止まった後 | 終わった段階（`.steps.json`、`lib.part/.archives.json`）から続ける。2 つの名前の変更のあいだで止まったときは、起動のときに前の `lib` を戻す | 受領書が読めない、または受領書にあるファイルが欠けていれば、使えるものとして扱わない | `libraries_a_stopped_repair_moved_aside_come_back_at_start` |

翻訳の LLM（`llamacpp` の項目、ADR-015）は llama.cpp のサーバーで動く。サーバーが起動できない（モデルを読めない、メモリー不足、時間切れ）ときは翻訳を有効にできず、メモリー不足は GPU のメモリー不足と同じ知らせになる。使っているあいだにサーバーが終わったら、次の翻訳で一度だけ起動し直し、それでも動かなければその翻訳を失敗として知らせる。サーバーはアプリと一緒に止まり、アプリが異常終了しても残らない（Windows はジョブ、Linux は親の終了で届くシグナル）。音声の経路とほかの翻訳エンジンには触れない（`native/core/tests/translation_llama.rs`、`native/speech-server/tests/llama.rs`）。

## アプリの更新

どのコピーがアプリの中で更新するかは、入れ方で決まる（[アプリの更新](external-interfaces.md#アプリの更新)の表）。パッケージマネージャーで入れたコピー（deb、rpm）は確認もしないので、アプリの中の更新とパッケージマネージャーがぶつかることはない。書き込めない場所の AppImage、Windows の ZIP、Linux の tar.gz は知らせるだけで、ファイルを置き換えない。

| 入れ方 | 更新の責任 | 失敗したときに保つもの | 確かめているもの |
|---|---|---|---|
| Windows のインストーラー | アプリが署名を確かめたインストーラーを起動する。入れ替えはインストーラー | パッケージの SHA-256 が合わない、壊れている、途中で切れている、ファイルが使用中で入れ替えられないときは、前のインストールのまま。入れ替えの途中で止まったときは、次にインストーラーを動かすと前の状態に戻す。0.5.0 以前の既定のインストール先を移せないとき（移す先が空でない、ファイルが開かれている）は、更新した元の場所に残し、次の更新でまた試す。名前を変えたあとキーを書く前に止まったときは、次の更新が新しい場所のインストールを見つけてキーとショートカットを直す（[Windowsのインストール先の移動](data-and-persistence.md#windowsのインストール先の移動)）。0.6.x までの `vrct-vox.exe` を消せないとき、または付け替えのあとで消す前に止まったときは、次の更新がショートカットをもう一度付け替えてから消す（[本体の実行ファイルの名前](data-and-persistence.md#本体の実行ファイルの名前)）。ほかのインストーラーが動いている間に起動したインストーラーは、何も変えずに終了コード2で終わる | `tests/installer/windows_update_scenarios.py`（CI の `installer-update-tests.yml` で本物の NSIS を動かす） |
| AppImage（書き込める場所） | アプリ。`tauri-plugin-updater` は取得と署名の確認だけで、置き換えはアプリが行う（`src-tauri/src/app_update.rs` の `replace_appimage`） | 署名と ELF であることを確かめてから、同じフォルダーの隠しファイル（`.<名前>.update-<番号>`）に書き、前の AppImage の権限を付け、`fsync` して名前を変えて置き換える。名前を変える前に失敗したり止まったりしても、前の AppImage はそのまま残る。止まったときの書きかけのファイルは、次の起動で消す。動いているアプリは前のファイルのまま動き続ける | `app_update.rs` の単体試験（`an_appimage_is_replaced_in_one_rename_and_keeps_its_permissions`、`a_failed_replacement_leaves_the_appimage_as_it_was`、`what_a_stopped_replacement_left_goes_and_nothing_else`）。`src-tauri` の試験は CI では動かない |
| 書き込めない場所の AppImage、Windows の ZIP、Linux の tar.gz | 利用者 | アプリはファイルを置き換えない | `app_update.rs` の単体試験（入れ方の判定） |
| deb、rpm | パッケージマネージャー | アプリは確認も置き換えもしない | 同上 |

`tauri-plugin-updater` 自身が AppImage を原子的に置き換える（同じフォルダーに書いてから名前を変える）ようになったら、アプリの置き換え（`replace_appimage`）をやめ、Windows のインストーラーと同じくプラグインの `Update::install` に戻す（#881 で決定）。プラグインを上げるときは、その `install_appimage` を確かめる。

どの入れ方でも、ダウンロードと署名の確認に失敗したときはファイルに触れず、今の版のまま理由のコード（`update_download_failed`、`update_signature_invalid` など）を返す。Windows でバックエンドを止めたあとにインストーラーを起動できなかったときは、アプリを起動し直してバックエンドのある状態に戻す。

## 残課題

- 公開済みのモデルが同じ大きさのまま壊れたとき、取得の画面は取得し直すまで使えるものとして表示する。起動のたびに SHA-256 を確かめると、数 GB のモデルでは時間がかかる。
- 新しい版の設定を古い版で開いても、知らないキーと、新しい版で足した選択肢のように古い版の検査に通らない値は、ファイルに残る（#560。この直しを含む版から。`NEWEST_SAVING_VERSION` で新しい版が保存したことを見分ける）。古い版でその設定を変えたときは、古い版の値になる。この直しより前の版は、知らないキーと検査に通らない値を捨てて保存する。
