# Open issues

[日本語版](#未決事項日本語版)

Mismatches and undecided points found while studying the implementation to write the specification. This is a record as of 2026-11-02. A row is removed once it is fixed. An item that was decided not to be fixed stays, with the reason.

| ID | Description | Basis | Status |
|---|---|---|---|
| OI-03 | Text sent to VRChat has no length limit and is not split. The VRChat chatbox shows up to 144 characters | `native/adapters/src/osc/`, `src-ui/logics/common/chatboxLength.ts` | Decided not to truncate or split (2026-11-03). When the input goes over 144 characters, a warning appears next to the input field on the main screen and in Quick Chat. The length of text sent with a translation attached is not counted |
| OI-06 | No screen reads `IsVrctAvailable`, which is updated on `/run/enable_ai_models`. It used to show a notice, but missing models are now shown on the screen while the conversation is empty (2026-11-13, `src-ui/logics/main/useSetupNeeds.ts`), so today the value is only stored | `src-ui/logics/common/useIsVrctAvailable.ts` | Open. Whether to remove it along with its endpoint is not decided |
| OI-07 | There are 60 routes that exist only in the UI. Most are generated mechanically from the definitions in `ui_config_setter.ts` and are not used | The section "Routes only in the UI" of the [IPC endpoint list](reference/ipc-endpoints.md) | Whether to clean them up is open |
| OI-08 | Requests carry no sequence number, and responses are matched by endpoint name. When requests to the same endpoint overlap, there is no telling which response belongs to which request. Only for language changes does the UI fill in the matching | [IPC protocol](ipc-protocol.md#言語の変更の対応づけ) | A design constraint. Changing it means raising the protocol version |
| OI-09 | `config.json` has no version number, so there is no clue for a migration when the meaning of a key changes. Only the local speech recognition migration records the stages it has done in `LOCAL_ASR_MIGRATION` ([Local speech recognition migration](data-and-persistence.md#ローカル音声認識の移行)) | [Data formats and storage](data-and-persistence.md#configjson) | Open |
| OI-21 | The chat reading settings are in different places on the desktop and in VR. The desktop moved them to their own "Chat reading (OCR)" page (2026-11-13). The VR settings keep them inside the "VRChat" page. The layout that OI-11 once aligned has split again | `src-ui/views/app/config_page/setting_section/setting_box/SettingBox.tsx`, `src-ui/views/vr/VrSettingsWindow.tsx` | Open. The VR settings have only four items, so they are left as they are |
| OI-10 | Of the 114 error codes, 10 have no dedicated handling in the UI. All are speech recognition failures (`AUDIO_*`, `ASR_ERROR`, `TRANSCRIPTION_API_*` and others). They appear in the conversation log as `/run/transcription_recognition_error`, so they do not turn into generic notices. The conversation log translates them with the `backend_errors` strings (2026-11-08). `AUDIO_TRACKER_STOP_TIMEOUT` is for telemetry and does not reach the screen | [Error code list](reference/error-codes.md) | Checked. When adding a new code, do the same check, and add `en.yml` and `ja.yml` strings for codes that appear in the conversation log |
| OI-22 | Because the local Whisper was removed (#288), the 31 languages that have no model in speech.cpp can no longer be recognized locally on the PC. The languages that local (speech.cpp) recognition supports are set by the languages of the recognition model applied. Cloud engines can still be chosen as before (Google without a key was removed) | `RETIRED_WHISPER_ENGINE` in `native/core/src/config/mod.rs`, [Choosing a speech recognition engine](data-and-persistence.md#音声認識エンジンの選択) | Decided to remove (the maintainer's decision, #288). The recognition threshold screen, `no_repeat_ngram_size`, and the choice of compute device and compute type for speech recognition were removed at the same time |

## Found and fixed

Problems found while writing the specification and fixed in the same period.

- The VR panel's window name did not match (OI-01). Rust creates the VR panel with the name `VRCT-VOX VR Panel`, but the Windows overlay looked for `VRCT VR Panel` with `FindWindowW`. Tauri 2.12 and wry 0.57 do not copy the document's `<title>` to the window name unless a handler is registered, so on Windows the VR panel could not be captured. The names in Python and `vr.html` now match Rust, and `tests/devtools/test_vr_panel_title.py` checks that they match. Not verified on real Windows hardware.
- In the VR settings, "Send sample text to the subtitle overlay" (which sends repeatedly while started) and "Reset the launcher position and size" had no UI receiver for the sidecar's response (200), so each send logged `Invalid endpoint` to the console (OI-04). A receiver that only takes the response was added.
- The Linux build did not check the hashes of the Python dependencies (OI-15). `uv sync --frozen` now compares the hashes in the lock, and archives without a hash and Git dependencies not pinned to a full commit SHA are refused before syncing.
- The OBS browser source returned the WebSocket token without authentication (OI-12, SEC-01). The page URL now requires the same token as well, and the settings screen tells the user to copy the URL again.
- The VRAM shortage notice shown when translation was turned on used a `run_mapping` name that did not exist, and raised an exception.
- The notice for a missing input device during transcription had no error code and became a generic notice.
- The Deepgram key check used `/v1/models`, which succeeds even without authentication.
- OpenAI's `gpt-4o-transcribe` family was asked for `verbose_json`, which it does not support.
- When a settings value was rejected (`VALIDATION_CONFIG_VALUE_INVALID`), the UI had no branch for it and showed a "contact the developer" notice.
- The unused Tauri command `download_zip_asset` could fetch any URL (OI-02). The command and the dependencies that existed only for it (reqwest, base64) were removed.
- VRC mic mute sync resumed transcription on an OSC `false` alone (OI-14, SEC-05). It now confirms the release through the local VRChat OSCQuery, and keeps mute on while it cannot confirm, including at startup. It also checks that the discovered service is on loopback and matches the name and the send destination. The serialization of the OSC lifecycle, the removal of waiting for bundle times, combining and stopping queries, the cleanup of Zeroconf and HTTP, and capabilities based on the actual result of preparation are described in [the OSC contract](external-interfaces.md#vrchatへのosc) too.
- When the API key check at startup failed, the key was deleted. Starting offline was enough to delete every saved key. When a key was entered again and its check failed, the key saved before was deleted too.
- Fetching the Ollama model list at startup had no time limit, so if the response stalled, startup never finished.
- When the LLM returned an empty translation, it was treated as a success, and with the setting that sends only the translation, nothing was sent.
- A translation cut off at the LLM's length limit was also treated as a success (OI-19). The finish reason of the response is now checked; a partial translation is not used and goes to the same failure handling as an empty one.
- When the actual bind of the WebSocket server failed, the app still reported it as turned on.
- The state copied to the VR panel contained authentication keys and tokens. The VR panel could change the connection URL and make the app send saved keys to that destination.
- An unreadable `config.json` was overwritten with the defaults. A crash of the sidecar was not reported. Sidecar errors were shown in English as they came.
- The engine check at startup had no overall time limit, so a server that kept returning its response a little at a time kept startup from finishing (OI-18). Each stage is now cut off after 30 seconds, and the app starts with the engines that were not ready in time marked as unavailable.
- The conversation log stayed in the UI's memory and on screen without limit, and with the VR UI on, every change sent all entries to the VR panel (OI-17). The screen now keeps only the newest 1,000 entries, and the VR panel receives only what changed since the log it was last sent.
- When a translation model could not be loaded, the translation switch only flipped back, with no reason given. The notice now tells a missing model apart from one that cannot be loaded.
- When writing `config.json` failed, the exception was dropped and success was returned (OI-16). The UI is now told the reason, and the file is written again every 30 seconds.
- The built-in translation models (CTranslate2 and the tokenizer) and the Whisper weights were downloaded from the default branch without checks (OI-13). The commit is now pinned, and the size and SHA-256 are checked.
- Only the VR settings still had the "Chat reading" and "Other" tabs (OI-11). They now have the same page layout as the desktop, and the existing items moved to VRChat, Appearance and Device.
- When waiting for the WebSocket server to start timed out, the server could still start listening later or overlap with the cleanup of the next start (OI-20). The start is now cancelled after 6 seconds, and the next start begins only after the resources of the previous one are closed.
- "Always on top" was not saved and went back to its old state after a restart (OI-05). `ENABLE_FOREGROUND` is now saved in `config.json`, and at startup the window is put on top according to the saved value.

---

# 未決事項（日本語版）

仕様書を作るために実装を調べて見つかった、食い違いや決まっていないこと。2026-11-02時点の記録で、直したら行を消す。直さないと決めたものは、理由を書いて残す。

| ID | 内容 | 根拠 | 状態 |
|---|---|---|---|
| OI-03 | VRChatへ送る文に長さの上限や分割の処理がない。VRChatのチャットボックスに表示されるのは144文字まで | `native/adapters/src/osc/`、`src-ui/logics/common/chatboxLength.ts` | 切り詰めと分割はしないと決めた（2026-11-03）。入力が144文字を超えたら、メイン画面の入力欄とQuick Chatの入力欄のそばに警告を出す。翻訳を付けて送る文の長さは数えていない |
| OI-06 | `/run/enable_ai_models`を受けて更新する`IsVrctAvailable`を読む画面がない。以前はお知らせを出していたが、足りないモデルを会話が空の画面に出すようにしたので（2026-11-13、`src-ui/logics/main/useSetupNeeds.ts`）、いまは値を保存するだけである | `src-ui/logics/common/useIsVrctAvailable.ts` | 未決。エンドポイントごと外すか決めていない |
| OI-07 | UIだけにあるルートが60件ある。多くは`ui_config_setter.ts`の定義が機械的に作るもので、使われない | [IPCエンドポイント一覧](reference/ipc-endpoints.md)の「UIだけにあるルート」 | 整理するか未決 |
| OI-08 | 要求に通し番号がなく、応答はエンドポイント名で対応づける。同じエンドポイントへの要求が重なると、どの応答がどの要求のものか分からない。言語の変更だけはUIが対応づけを補っている | [IPCプロトコル](ipc-protocol.md#言語の変更の対応づけ) | 設計上の制約。変えるならプロトコルの版を上げる |
| OI-09 | `config.json`に版番号がない。キーの意味を変えるときに移行の手がかりがない。ローカル音声認識の移行だけは、`LOCAL_ASR_MIGRATION`に済ませた段階を記録している（[ローカル音声認識の移行](data-and-persistence.md#ローカル音声認識の移行)） | [データ形式と保存](data-and-persistence.md#configjson) | 未決 |
| OI-21 | チャット読み取りの設定の場所が、デスクトップとVRで違う。デスクトップは「チャット読み取り」のページに分けた（2026-11-13）。VRの設定は「VRChat」のページの中に置いたままである。OI-11で一度そろえた構成が、また分かれた | `src-ui/views/app/config_page/setting_section/setting_box/SettingBox.tsx`、`src-ui/views/vr/VrSettingsWindow.tsx` | 未決。VRの設定は項目が4つだけなので、そのままにしている |
| OI-10 | エラーコード114件のうち10件は、UIに個別の処理がない。いずれも音声認識の失敗（`AUDIO_*`、`ASR_ERROR`、`TRANSCRIPTION_API_*`など）で、`/run/transcription_recognition_error`として会話ログに出るため汎用の通知にはならない。会話ログでは`backend_errors`の文言で翻訳する（2026-11-08）。`AUDIO_TRACKER_STOP_TIMEOUT`はテレメトリー用で画面には届かない | [エラーコード一覧](reference/error-codes.md) | 確認済み。新しいコードを足すときは同じ確認をし、会話ログに出るコードには`en.yml`と`ja.yml`の文言を足す |
| OI-22 | ローカルの Whisper を削除したため（#288）、speech.cpp にモデルのない31言語は、この PC の中では認識できなくなった。ローカル（speech.cpp）で認識できる言語は、適用した認識モデルが持つ言語で決まる。クラウドのエンジンでは、これまでどおり選べる（キーなしの Google は外した） | `native/core/src/config/mod.rs`の`RETIRED_WHISPER_ENGINE`、[音声認識エンジンの選択](data-and-persistence.md#音声認識エンジンの選択) | 削除すると決めた（保守担当者の判断、#288）。認識の閾値の画面、`no_repeat_ngram_size`、音声認識の計算デバイスと計算型の選択も同時に外した |

## 調べて直したもの

仕様書を作る途中で見つけ、同じ時期に直したもの。

- VRパネルのウィンドウ名が一致していなかった（OI-01）。RustはVRパネルを`VRCT-VOX VR Panel`という名前で作るが、Windowsのオーバーレイは`FindWindowW`で`VRCT VR Panel`を探していた。Tauri 2.12とwry 0.57は、ハンドラを登録しない限り文書の`<title>`をウィンドウ名に写さないため、WindowsではVRパネルを撮影できなかった。Python・`vr.html`の名前をRustに合わせ、`tests/devtools/test_vr_panel_title.py`で一致を確かめる。Windowsの実機では未確認。
- VRの設定の「サンプルテキストをOverlayに送信する」（開始している間くり返し送る）と「ランチャーの位置と大きさを初期に戻す」は、サイドカーの応答（200）にUIの受け先がなく、送るたびにコンソールへ`Invalid endpoint`を出していた（OI-04）。応答を受け取るだけの受け先を足した。
- LinuxのビルドでPython依存のハッシュを確かめていなかった（OI-15）。`uv sync --frozen`でロックのハッシュを照合し、ハッシュのないアーカイブや完全なcommit SHAで固定していないGit依存は同期前に拒否するようにした。
- OBSブラウザソースが認証なしでWebSocketのトークンを返していた（OI-12、SEC-01）。ページのURLにも同じトークンを必須にし、設定画面にURLのコピーし直しを案内した。
- 翻訳をオンにしたときのVRAM不足の通知が、存在しない`run_mapping`の名前を使って例外になっていた。
- 文字起こし中に入力デバイスがないときの通知にエラーコードがなく、汎用の通知になっていた。
- Deepgramのキーの確認が、認証なしでも成功する`/v1/models`で行われていた。
- OpenAIの`gpt-4o-transcribe`系に、対応していない`verbose_json`を要求していた。
- 設定値が拒否されたとき（`VALIDATION_CONFIG_VALUE_INVALID`）、UIに分岐がなく「開発者に連絡」の通知になっていた。
- 使われていないTauriのコマンド`download_zip_asset`が任意のURLを取得できた（OI-02）。コマンドと、そのためだけの依存（reqwest、base64）を外した。
- VRCマイクミュート同期がOSCの`false`だけで文字起こしを再開していた（OI-14、SEC-05）。ローカルのVRChatのOSCQueryで解除を確認し、起動時を含め確認できない間はミュートを保つようにした。探索先のloopback・名前・送信先との対応も確認する。OSCのライフサイクルの直列化、bundle時刻の待機廃止、問い合わせの集約と停止、Zeroconf・HTTPの後始末、実際の準備結果に基づくcapabilityについても[OSCの契約](external-interfaces.md#vrchatへのosc)に記載した。
- 起動時のAPIキーの確認に失敗すると、キーを消していた。オフラインで起動するだけで保存したキーがすべて消えた。キーを入れ直して確認に失敗したときも、保存してあったキーを消していた。
- 起動時のOllamaのモデル一覧の取得に時間の上限がなく、応答が止まると起動が終わらなかった。
- LLMが空の訳を返すと成功として扱い、訳だけを送る設定では何も送らなかった。
- LLMの訳が長さの上限で切れても成功として扱っていた（OI-19）。応答の終了理由を確かめ、途中の訳は使わず、空の訳と同じ失敗時の処理に進むようにした。
- WebSocketサーバーの実際のbindが失敗しても、有効にしたと返していた。
- VRパネルへ写す状態に認証キーとトークンが入っていた。VRパネルから接続先のURLを変えられ、保存したキーをその接続先へ送らせられた。
- 読めない`config.json`を既定値で上書きしていた。サイドカーが落ちても知らせなかった。サイドカーのエラーを英語のまま出していた。
- 起動時のエンジンの確認に全体の時間の上限がなく、応答を少しずつ返し続けるサーバーがあると起動が終わらなかった（OI-18）。段階ごとに30秒で打ち切り、間に合わなかったエンジンは使えない状態で起動する。
- 会話ログがUIのメモリーと画面に際限なく残り、VR UIがオンなら変わるたびに全件をVRパネルへ送っていた（OI-17）。画面には新しい1,000件だけを残し、VRパネルへは前に送ったログとの差分だけを送る。
- 翻訳モデルを読み込めないと、翻訳のスイッチが戻るだけで理由を知らせなかった。モデルがないのか読み込めないのかを分けて知らせる。
- `config.json`の書き込みに失敗しても、例外を捨てて成功を返していた（OI-16）。UIに理由を知らせ、30秒ごとに書き直す。
- 内蔵の翻訳モデル（CTranslate2とトークナイザー）とWhisperの重みは、既定のブランチから確かめずに取得していた（OI-13）。commitを固定し、大きさとSHA-256を確かめる。
- VRの設定だけ「チャット読み取り」と「その他」のタブが残っていた（OI-11）。デスクトップと同じページ構成にそろえ、既存の項目をVRChat、デザイン、デバイスへ移した。
- WebSocketサーバーの起動待ちが時間切れになっても、遅れて待ち受けを始めたり次の起動の後片付けと重なったりしていた（OI-20）。6秒で起動を取り消し、起動ごとの資源を閉じてから次を始めるようにした。
- 「最前面固定」が保存されず、再起動すると戻っていた（OI-05）。`ENABLE_FOREGROUND`を`config.json`に保存し、起動時に保存した値でウィンドウを最前面にする。
