# データ形式と保存

IPCでやり取りする主なデータの形と、ディスクに残すファイル。設定キーの一覧は[設定キー一覧](reference/config-keys.md)（生成）にある。

## 主なデータの形

### 言語の組（タブごと）

`selected_your_languages`と`selected_target_languages`。タブ番号`"1"`〜`"3"`ごとに、枠番号から言語への辞書を持つ。

```json
{
  "1": {"1": {"language": "Japanese", "country": "Japan", "enable": true}},
  "2": {"1": {"language": "Japanese", "country": "Japan", "enable": true}},
  "3": {"1": {"language": "Japanese", "country": "Japan", "enable": true}}
}
```

- `language`と`country`は英語の識別子であり、保存・IPC・OSC・プリセットでは翻訳しない。`selectable_language_list`も`[{"language": "Japanese", "country": "Japan"}, …]`のまま。UI表示用のタグと表示名はUI内で解決し、選択のペイロードには加えない（[国際化](cross-cutting.md#国際化)）。
- 自分の言語は枠`"1"`だけ、相手の言語は枠`"1"`〜`"3"`を持つ。既定で有効なのは相手の言語の枠`"1"`だけである。
- 更新には全タブと全枠、および各枠の`language`・`country`・`enable`が必要である。空の辞書、不足・余分なキー、辞書でない入れ子は、変更や保存をせず400の`VALIDATION_CONFIG_VALUE_INVALID`で拒否し、`data`に元の値を返す。翻訳エンジンの辞書も全タブと文字列の値を必要とする。
- `language`と`country`は`transcription_lang`にある組だけを受け付ける。無効な枠は元の値に戻る（エラーにはしない）。
- 入れ替え（`/run/swap_your_language_and_target_language`）は、両方の辞書を検証してから設定ロック内でまとめて変更し、最終的な言語の組で翻訳エンジンを1回だけ調整する。保存も片側だけの状態を取得しない。両方向に対応する選択済みのエンジンは保持し、`{"your": …, "target": …}`を返す。
- 選択中のタブは`selected_tab_no`（`"1"`、`"2"`、`"3"`）、タブごとの翻訳エンジンは`selected_translation_engines`（`{"1": "CTranslate2", …}`）。

### 音声認識エンジンの選択

`SELECTED_TRANSCRIPTION_ENGINE`は既存のエンジン名の文字列、または未選択を表す`null`を保存する。新規設定でキーがない場合の既定値は`null`。保存済みの正常な選択はそのまま読み込み、再同意は求めない。外した`Google`（Web 音声認識）の選択は読み込まず、未選択（`null`）にする。利用者は初回と同じ選択画面で選び直す。今回保存する`null`も再起動後に未選択として保持する。不正な型・未知のエンジン名は読み込まず未選択の既定値を保つ。空文字列や新しいエンジン識別子への置換は行わない。

キー名と`/get/data/selected_transcription_engine`、`/set/data/selected_transcription_engine`は維持する。取得応答には未選択なら`null`、選択済みなら従来の文字列を返す。選択の更新要求は従来のエンジン名を使い、不正な値は`VALIDATION_CONFIG_VALUE_INVALID`で拒否する。可用性やAPIキーの削除で選択を上書きしない。

従来の文字起こしの有効化で未選択なら400の`TRANSCRIPTION_ENGINE_NOT_SELECTED`と`data: false`を返す。API認識器の構築失敗は`TRANSCRIPTION_ENGINE_UNAVAILABLE`を`/set/enable/transcription_send`または`/set/enable/transcription_receive`の400通知で知らせ、開始要求の結果は従来どおり`false`となる。初回選択画面の継続操作はUI内の一時状態で、設定には保存せず、キャンセル・画面の破棄で捨てる。[同意の規則](cross-cutting.md#同意と外部への送信)を参照する。

選べるエンジンは`SELECTABLE_TRANSCRIPTION_ENGINE_LIST`のとおり、ローカル（speech.cpp、`SpeechCpp`）、クラウドのGroq Whisper、OpenAI Whisper、カスタムWhisperサーバー、Deepgramである。ローカルの`Whisper`（faster-whisper）は #288 で削除した。言語表の`Whisper`の列は、クラウドのWhisperのエンジンが言語コードに使うので残している。キーなしの`Google`（Web 音声認識）は、非公式の窓口と`speech_recognition`の汎用のキーを使っていたので外した。言語表の`Google`の列は地域つきの言語タグに使うので残している。

### ローカル音声認識の移行

`LOCAL_ASR_MIGRATION`は、ローカル音声認識の移行をどこまで済ませたかを表す整数で、`config.json`に保存する。新規の設定は最新の段階（いまは2）から始まり、何も移さない。段階が足りない保存ファイルは、読み込みの最後（`Config._migrateLocalASR`）に次を1回ずつ行い、最新の段階を記録する。

| 段階 | 行うこと |
|---|---|
| 1 | Windows のメインスイッチは、以前はリアルタイム音声認識のサーバーの選択に従い、いまは音声認識エンジンに従う。保存済みの`REALTIME_ASR_SETTINGS.server`が`"bundled"`なら、OSによらず音声認識エンジンを`SpeechCpp`にする。スイッチはそれまでと同じ経路を使う |
| 2 | 保存済みの`SELECTED_TRANSCRIPTION_ENGINE`が削除した`"Whisper"`なら、`SpeechCpp`にする。Windows では`REALTIME_ASR_SETTINGS.server`を`"bundled"`にし、ほかの項目は保つ。Linux のスイッチはもともとリアルタイムのサーバーを使っていたので、サーバーの選択は変えない。あわせて`LOCAL_ASR_NOTICE_PENDING`を`true`にする |

保存済みの`"Whisper"`は、使えないエンジン名として error.log に残さずに読み飛ばし、上の段階2が移す。モデルの取得はどの段階でも行わない。

`LOCAL_ASR_NOTICE_PENDING`（真偽値、既定は`false`、保存する）は、移行のお知らせをまだ出していないことを表す。真の間、メイン画面は「ローカルの音声認識は speech.cpp に変わりました」のお知らせを出す（`LocalAsrNoticeController.jsx`）。お知らせは、Whisper が含まれなくなりローカル（speech.cpp）へ移したこと、同梱の ASR サーバーには認識モデルと VAD モデルが要ることと、それぞれが`asr`プロファイルに設定済みかどうか、設定でライセンスとサイズを確かめて同意するまで何も取得しないことを伝える。「音声認識（ASR）」の設定を開くボタンがあり、古い Whisper の重みが残っていれば、その合計の容量と、確認してから削除するボタンを出す。閉じる、Escape、設定を開くのどれで閉じても`/set/disable/local_asr_notice`を送り、以後は出さない。UIは`/get/data/local_asr_notice`で状態を読む。

`VIRTUAL_MIC_NOTICE_PENDING`（真偽値、既定は`true`、保存する）は、仮想マイクの案内（#321）を起動時に自分で開いてよいことを表す。Windowsで仮想ケーブルが1つも見つからないときだけ開く。「完了」か「今後は自動で表示しない」で`/set/disable/virtual_mic_notice`を送り、偽にする。偽でも「テキスト読み上げ（TTS）」の設定から開ける。流れは[UC-17](use-cases.md#uc-17-仮想マイクを用意して確かめるwindows)にある。

### 古い Whisper の重み

以前の版が取得した Whisper の重みは`PATH_DATA`の`weights/whisper/<名前>`にある。名前は`tiny`、`base`、`small`、`medium`、`large-v1`、`large-v2`、`large-v3`、`large-v3-turbo-int8`、`large-v3-turbo`の9つ（`models/transcription/old_whisper_weights.py`の`WHISPER_WEIGHT_NAMES`）。いまの版は読まない。

- `/get/data/old_whisper_weights`は`{"total_bytes": 整数, "folders": [名前, …]}`を返す。容量は、リンクをたどらずに数えた通常のファイルの合計である。
- `/run/delete_old_whisper_weights`は、上の名前のフォルダーだけを消し、`{"total_bytes", "folders", "freed_bytes", "failed"}`を返す。`total_bytes`と`folders`は消した後に残っているもの、`freed_bytes`は空いた容量、`failed`は消せなかった名前（ほかのプログラムがファイルを開いているときなど）である。シンボリックリンクやジャンクションの先はたどらない。`whisper`フォルダーや名前のフォルダーそのものがリンクなら消さない。知らないファイルは残し、`whisper`フォルダーは空になったときだけ消す。
- 読み取りに失敗すると500の`{"error_code": "old_whisper_weights_unreadable"}`、削除に失敗すると500の`{"error_code": "old_whisper_weights_delete_failed"}`を返す。
- 削除は利用者の操作だけで行う。設定の「音声認識（ASR）」は、重みが残っている間「古い Whisper モデル」の欄に合計の容量と削除のボタンを出し、その場で確認してから送る。移行のお知らせにも同じ欄を出す。

### 音声認識の数値設定

マイクとスピーカーの`avg_logprob`と`no_speech_prob`は、OpenAI互換のクラウドエンジン（Groq Whisper、OpenAI Whisper、カスタムWhisperサーバー）が返した区間を捨てるときのしきい値である。設定の「音声認識（ASR）」では、「クラウド音声認識」の下の「Whisperの認識結果のふるい分け」で4つとも変えられる。スライダーは0.05刻みで、値を確定したときに`/set/data/mic_avg_logprob`などへ送る。`avg_logprob`は−2以上0以下、`no_speech_prob`は0以上1以下の有限の数値を受け付ける。IPCでは数値に変換できる文字列も受け付ける。`NaN`・無限大、範囲外、真偽値などは変更や保存をせず400の`VALIDATION_CONFIG_VALUE_INVALID`で拒否し、`data`に元の値を返す。保存済みの不正な値は読み込み時に既定値へ戻す。

`MIC_`と`SPEAKER_`の整数設定は、保存値の読み込みと設定プロパティへの代入で次の範囲を検証する。`null`、真偽値、小数、文字列は受け付けない。IPCで整数に変換する従来の処理は維持し、範囲外の値には既存の`VALIDATION_MIC_*`・`VALIDATION_SPEAKER_*`と元の値を返す。

| 設定名の末尾 | 範囲 |
|---|---|
| `THRESHOLD` | 0〜2000 |
| `RECORD_TIMEOUT`、`PHRASE_TIMEOUT` | 0〜30秒。`RECORD_TIMEOUT`は`PHRASE_TIMEOUT`以下 |
| `MAX_PHRASES` | マイクは0〜30、スピーカーは0〜60 |

保存したタイムアウトはJSONのキー順に関係なく、組として検証する。範囲外や型が不正な値は既定値へ戻す。範囲内でも記録時間がフレーズ時間を超える組は、両方を既定の3秒へ戻す。

2つのタイムアウトの意味は次のとおりである（`native/transcription`の`energy.rs`と`phrases.rs`）。`RECORD_TIMEOUT`は1回の録音（音量で切り出した1つのフレーズ）の長さの上限で、0は上限なしである。上限で切れたフレーズも、間をあけずに続けば同じ発話につながる。`PHRASE_TIMEOUT`は、最後のフレーズからこの秒数が過ぎると、それまでの音声を1つの発話として区切る値である。フレーズの間の無音がこれより長いときも新しい発話になる。発話は音声が15秒になったときも区切る。設定画面のラベルと説明はこの意味で書く（「1回の録音の長さの上限」と「発話を区切るまでの待ち時間」）。

`MIC_ENABLE_VAD`と`SPEAKER_ENABLE_VAD`は、音量の代わりに VAD でフレーズを区切るスイッチである。次に録音を始めたときから効く。VAD で区切るときは`PHRASE_TIMEOUT`を使わず、自然に区切れた区間ごとに1つの発話として認識する。長さの上限で切れた区間は次の区間とつなぐ（15秒まで）。認識に送る音声の前に0.3秒、後に0.5秒の無音を足す。いまの版は VAD のエンジンを持たない（`/get/data/vad_available`が`false`）。この間、`/set/enable/mic_vad_filter`と`/set/enable/speaker_vad_filter`は値を変えず、400の`VAD_UNAVAILABLE`と保存値を返す。オフにする操作は受け付ける。以前の版で保存したオンの値はそのまま残し、録音は音量で区切る。設定画面は VAD の選択肢を選べない状態にして理由を示し、保存値がオンでも「自動」か「手動」の表示にする。

ローカルの Whisper とともに、`MIC_NO_REPEAT_NGRAM_SIZE`と`SPEAKER_NO_REPEAT_NGRAM_SIZE`は削除した。古い`config.json`にあっても読み込まない。

リアルタイム字幕（speech.cpp の Realtime）では、発話の区切りをサーバーの VAD（`server_vad`）が決める。中核はセッションを始めるときに`turn_detection`の`silence_duration_ms`（話し終わりとみなす無音の長さ）と`prefix_padding_ms`（発話の前後に残す余白）を送る（#556）。無音の長さは`REALTIME_ASR_SETTINGS.silence_duration_ms`で、項目がなければ500ミリ秒（speech.cpp と OpenAI の既定と同じ）である。余白は無音の長さの半分で、300ミリ秒（speech.cpp の既定）を超えない。speech.cpp は、余白の2倍のあいだに次の発話が始まらないと分かってから発話を確定するので、既定の余白300ミリ秒のままでは無音500ミリ秒でも確定まで600ミリ秒かかる。余白を半分以下にすると、無音が続いた時点で確定する。発話をどこで区切るかは無音の長さだけで決まる。`silence_duration_ms`は100〜2000の整数を受け付け、範囲外、小数、文字列、真偽値は`realtime_settings_invalid`で拒否する。選ばなかった項目や`null`は保存しないので、既定のままなら0.4の版も同じ設定を読める。値を変えると、マイクとゲーム音声の両方の字幕を停止する（サーバーやモデルを変えたときと同じ）。設定画面の「リアルタイム字幕」では、既定（0.5秒）、0.3秒、0.4秒、0.7秒、1秒から選ぶ。短くすると確定が早くなるが、文の途中の間でも区切られやすくなる。測った値は[音声パイプラインの遅延](../voice-stack/pipeline-latency-2026-11-18.md)にある。

### 直接音声の設定（声の変換）

`DIRECT_VOICE_SETTINGS`の`engine`は`rvc`だけを受け付け、既定も`rvc`である。Seed-VCはPythonのバックエンドで動いていたので、Pythonとともに終わった。`/set/data/direct_voice_settings`に`engine: "seed-vc"`を送ると、何も保存せず400の`{"error_code": "vc_engine_unavailable", "settings": <保存値>}`を返す。そのほかの不正な値は従来どおり`vc_settings_invalid`である。以前の版が保存した`seed-vc`は、読み込むときに`rvc`へ移す。ほかの項目（`mode`、RVCのパス、Seed-VCの`runtime`と`reference`）はそのまま残すので、0.4の版でも読める。`mode`が`converted`だったときだけ、その起動のあいだ`/get/data/direct_voice_state`に`"notice": "seed_vc_moved_to_rvc"`を付け、RVCのページに「Seed-VCは使えなくなったため、声の変換をRVCに切り替えました」と出す。設定を保存し直すと消える。変換は自動では始めない。RVCのモデルが未設定なら、メイン画面のRVCのスイッチは設定を求める。

### 計算デバイスと計算型

計算デバイスと計算型を選ぶのは翻訳（CTranslate2）だけである。音声認識の`SELECTED_TRANSCRIPTION_COMPUTE_DEVICE`と`SELECTED_TRANSCRIPTION_COMPUTE_TYPE`はローカルの Whisper とともに削除し、古い`config.json`にあっても読み込まない。

翻訳の`SELECTED_TRANSLATION_COMPUTE_DEVICE`は、`device`・`device_index`・`device_name`で現在の一覧と照合する。保存した`compute_types`は識別に使わず、現在の一覧の値へ更新する。対応する計算型が増減しただけでは、選択したGPUを変更しない。

`SELECTED_TRANSLATION_COMPUTE_TYPE`は、JSONのキー順に関係なく保存したデバイスの現在の対応型で検証する。対応していれば`float16`などの選択を保つ。デバイスが見つからなければ既定のCPUを使い、対応しない計算型は既定の`auto`へ戻す。実行中の計算型の変更は、その時点で選択しているデバイスで検証する。

### ネットワーク設定

`OSC_PORT`、`WEBSOCKET_PORT`、`OBS_BROWSER_SOURCE_PORT`は、保存値もIPCの変更要求も整数型の1〜65535だけを受け付ける。真偽値、小数、文字列（`"80"`を含む）、0、負数、65536以上、nullは拒否する。保存値が不正なら、その設定の既定値（順に9000、2231、2232）を保ち、読み込み後の保存で書き直す。UIは1〜65535の数字入力を整数にして送る。空欄での保存は不正値として扱う。

変更要求が不正なら、設定の保存や稼働中サービスの停止に進まず、元の値を`data`に入れて400を返す。エラーコードは順に`VALIDATION_OSC_PORT_INVALID`、`WEBSOCKET_PORT_INVALID`、`OBS_BROWSER_SOURCE_PORT_INVALID`。WebSocketとOBSは新しいポートで起動できてから値を保存し、失敗時は元のポートで復旧を試みる。

`WEBSOCKET_HOST`はIPv4アドレスの文字列だけを受け付け、`0.0.0.0`、IPv6、ホスト名、文字列以外は拒否する。不正な保存値は既定の`127.0.0.1`へ戻す。変更要求は`VALIDATION_INVALID_IP`で拒否し、元のホストとサービスを保つ。OBSもこのホストを使う。ループバック（127.0.0.0/8）以外のアドレスには、読み込める証明書と秘密鍵（`WEBSOCKET_TLS_CERT_FILE`、`WEBSOCKET_TLS_KEY_FILE`）が要る。ない場合、変更要求は`WEBSOCKET_HOST_NEEDS_TLS`で拒否し、保存値は起動時に`127.0.0.1`へ戻して`WEBSOCKET_HOST_RESET_WITHOUT_TLS`で知らせる（[この PC の外での待ち受け](external-interfaces.md#この-pc-の外での待ち受け)）。

`WEBSOCKET_TLS_CERT_FILE`と`WEBSOCKET_TLS_KEY_FILE`はPEMのファイルのパスの文字列で、既定は空（未設定）。`/set/data/websocket_tls`で2つを一緒に保存し、両方を読み込めたときだけ保存する。

`WEBSOCKET_AUTH_TOKEN`は空でない文字列を保存する。null、空文字列、空白だけの文字列、文字列以外の保存値は読み込まず、起動時に生成した新しい秘密値を通常の既定値と同じ処理で保存する。正常な保存値は変えない。設定画面がコピーするWebSocket・OBSのURL、OBSのHTML、WebSocketの認証には同じ設定値を使う。修復された場合は外部アプリのURLをコピーし直す必要がある。設定キー名とIPCエンドポイント名は変えず、別キーへの移行は行わない。利用者は`/run/regenerate_websocket_auth_token`で新しい値に作り直せる。新しい値は`secrets.token_urlsafe(32)`で作って保存し、古い値での接続はすぐに切る。応答のトークンはログで伏せる。

`LMSTUDIO_URL`、`OLLAMA_URL`（中核のみ）、`OPENAI_COMPATIBLE_URL`、`TRANSCRIPTION_CUSTOM_URL`は、保存値の読み込み時と変更要求の受付時に同じ規則で検証する。HTTPSは任意のホストを受け付ける。HTTPは`localhost`、127.0.0.0/8、::1、10/8、172.16/12、192.168/16、fc00::/7、IPv4・IPv6のリンクローカルと、`.local`で終わるmDNSの名前（中核のみ）に限る。ほかのLANのホスト名をDNSで解決してHTTPを許可することはない。`localhost`と`.local`の名前は、接続するときに解決したアドレスが上の範囲にあることをもう一度確かめ、範囲の外ならHTTPで送らない。100.64.0.0/10（CGNAT）は含めない。URLのユーザー情報、キー・トークン・パスワード・認証情報・署名などを表すクエリ名、フラグメント、不正なポートは拒否する。

HTTPでプライベートLANやリンクローカルのアドレスへ接続する場合は、文章・音声・APIキーが暗号化されない旨を設定欄に表示する。同じPC内で通信するループバックには、この警告を出さない。URLは保存時に検証し、APIキーを入力して保存すると接続先へ送って認証する旨を、すべてのカスタムURLに表示する。URLの入力中は通信しない。OpenAI互換とCustom WhisperのURL単独の変更は、キーが保存済みなら通信せず`CREDENTIAL_REENTRY_REQUIRED`で拒否する。同じURLの再保存は通信も変更もせず成功し、キーが未設定ならURLだけを保存する。URLとキーを一緒に保存するときは入力した組み合わせで接続先を確かめる（[APIキーの変更](cross-cutting.md#apiキーの変更)）。URLの検証で拒否した変更は、既存の`CONNECTION_LMSTUDIO_URL_INVALID`、`CONNECTION_OLLAMA_URL_INVALID`（中核のみ）、`CONNECTION_OPENAI_COMPATIBLE_URL_INVALID`、`CONNECTION_TRANSCRIPTION_CUSTOM_URL_INVALID`を返して元のURLを保つ。

不正な保存済みURLは空文字列にして接続を止め、起動完了時に対応するURLエラーで再設定を促す。この通知は表示時のUI言語で翻訳し、保存済みの言語が後から反映された場合も表示を更新する。保存済みキーを別の既定ホストへ送らないため、既定URLには戻さない。キー自体は残す。空文字列は未設定の状態として保存できる。キー名・IPCエンドポイント名・JSONの形式は変更しない。

### メッセージ

送信したメッセージ、マイクとスピーカーの認識結果、OCRで読んだ文に共通の形。

```json
{
  "id": "4b1c…",
  "original": {"message": "こんにちは", "transliteration": []},
  "translations": [{"message": "Hello", "transliteration": []}],
  "source": "ocr"
}
```

| 項目 | 内容 |
|---|---|
| `id` | 入力欄から送ったときはUIが付けたUUID。マイクとスピーカーではUIが受け取ってから付ける。OCRは`transcription-ocr-<番号>` |
| `original` | 元の文と、ひらがな・ローマ字の読み（`[{orig, hira?, hepburn?}]`、オフなら空配列） |
| `translations` | 有効な相手の言語の順に並んだ訳。翻訳がオフ、または空のメッセージでは空配列 |
| `source` | OCRのときだけ`"ocr"` |
| `output_failures` | 出力の一部が例外になったときの`[{output, error_code: "MESSAGE_OUTPUT_FAILED"}]`。同期の戻り値には全出力後の一覧を含める。通常は省略 |
| `delivery_reason` | 自分のメッセージ（入力欄とマイク）を、「VRChatにメッセージを送信する」がオフのためチャットボックスへ送らなかったときだけ`"vrchat_off"`。ほかの出力は行う。UIは行の状態を`ok`のまま、「送信」の代わりに「VRChatには未送信（設定でオフ）」と表示する。相手の発言（スピーカー、OCR）には付けない |

- 入力欄からは`/run/send_message_box`に`{"id", "message"}`を送り、応答で上の形を受け取る。UIは送る前に行を「送信中」として出し、200の応答で送信中を解除する。同じ行のIDと時刻を保ち、応答の`original`と`translations`に読みも含めて更新する。Quick Chatからの送信とVRパネルに映す行も同じ処理を使う。デスクトップでは待機中のアイコンが回転し、VRパネルでは動かない文言で示す。
- 通信失敗、400・404・423・500の応答、バックエンドの停止では、該当する送信中の行を`status: "failed"`にし、本文を残して「送信を確認できません」と表示する。自動では再送しない。エラー応答にIDがない場合は送信中の全行を対象にする。その後にID付きの200が届けば、その行の状態、読みを含む原文と訳を更新する。
- 各出力の失敗は、別の400通知`/run/message_output_error`でも知らせる。`result.data`は`{id, source, output, error_code}`で、`id`がない入力では`null`。`source`は`chat`・`mic`・`speaker`・`ocr`、`output`は`osc`・`overlay_small`・`overlay_large`・`clipboard`・`ui`・`websocket`・`logger`・`history`・`tts`のいずれか。本文や例外の詳細は入れない。UIへの通常通知の後に失敗する出力もあるため、全入力元の失敗通知をこの経路で扱う。送信行を失敗扱いにせず、出力先ごとに警告を表示する。
- マイクは`/run/transcription_send_mic_message`、スピーカーは`/run/transcription_receive_speaker_message`、OCRは`/run/transcription_ocr_message`で届く。

### リアルタイム字幕と配送結果

リアルタイム音声認識は200の`/run/realtime_caption`で通知する。行は`source`（`mic`・`speaker`）、`generation`、`namespace`、`item_id`の組で識別する。`revision`は同じ行の更新番号である。

`partial`は認識途中、`final`は認識の確定であり、どちらも配送完了ではない。`text`に認識文、`translations`に訳の配列を持つ。`translated`は原文の読みを含む`original`と`translations`を更新するが、配送の待機は解除しない。`discarded`は空の確定結果や、表示前に期限が切れた字幕を退役させる。

`speakers`は、その発話で話した人のラベルの配列である（`["A"]`、`["A", "B"]`）。サーバーが話者分離モデルを持つときの、スピーカーの`final`と`translated`だけが値を持つ。`partial`とマイクの行、話者分離をしないときは空の配列である。ラベルは大文字1〜3字で最大4個、話しはじめた順に並ぶ。0.4秒以上話した声を数え、どの声もそれに満たなければ最も長い声を1つ入れる。ラベルは1つのセッションの中で声を区別する記号であり、人の名前ではない。セッションが変わると振り直される。話者分離の推定は誤ることがある。行は`speakers`として保持し、ログでは状態の表示の隣に「話者A・B」と出す。

表示した空でない`final`には、次の結果通知を1回発行する。`revision`は`final`より2大きい。本文と訳はこの通知に含めず、同じ行に保持する。

```json
{"status": 200, "endpoint": "/run/realtime_caption", "result": {
  "source": "mic", "generation": 4, "namespace": "session", "item_id": "utterance",
  "revision": 3, "state": "outcome", "outcome": "not_delivered", "reason": "expired"
}}
```

| `outcome` | `reason` | 行の状態と意味 |
|---|---|---|
| `delivered` | `null` | `status: "ok"`。適用対象の出力処理を終えた、または中断前に少なくとも1つの出力先へ配送した。マイクは「送信」、スピーカーは「受信」。全出力先への配送、VRChatでの受信確認、TTSの再生完了は意味しない |
| `delivered` | `vrchat_off` | `status: "ok"`。マイクの行だけ。「VRChatにメッセージを送信する」がオフのため、チャットボックスへは送らなかった。ほかの出力は行った。「VRChatには未送信（設定でオフ）」と表示し、警告の色は使わない |
| `not_delivered` | `expired`・`revoked`・`superseded`・`filtered` | `status: "not_sent"`。出力の成功を記録する前に、2秒の期限切れ、配送世代やセッションの失効、チャットボックスの順序制御、ワードフィルターで配送を省略した。処理失敗とは区別する |
| `failed` | `processing_failed`・`queue_full` | `status: "failed"`。処理自体の例外・VRAM不足、または確定結果の待ち行列が満杯。本文を残す |

出力先だけの例外では`delivered`を維持し、既存の`MESSAGE_OUTPUT_FAILED`警告を使う。行に警告を重ねない。OSC、WebSocket、クリップボード、会話ログ、読み上げの受付が成功したら、次の出力先で待つ前に記録する。以後に期限切れ・失効・処理失敗が起きても、その行は`delivered`にする。OSCが順序制御で省略されても、他の出力先への配送に成功した行は同じ扱いにする。既に終えた出力は取り消さず、自動で再送しない。

認識が確定した行は`status: "pending"`で始める。デスクトップのマイク行は「送信中…」と待機アイコン、スピーカー行は「処理中…」を使う。VRパネルは同じ行を映し、待機アイコンを動かさず文言で示す。処理失敗のマイク行は既存の「送信を確認できません」、スピーカー行は「処理に失敗しました」と表示する。送信を省略したマイク行は理由を添え、スピーカー行は「処理を中止しました」と表示する。

待ち行列で期限が切れた結果も、停止・ミュート・終了で処理へ進めなかった結果も、表示済みなら結果通知を出す。読取ワーカーが既存の待機周期で期限と配送世代を確認するため、翻訳の終了を待たずに行を確定できる。ただし、まだ出力の成功がなく、最初の出力処理が実行中なら、その成否が戻るまで確定を待つ。この待機は停止要求を妨げず、残りの出力を許可することもない。表示しなかった確定結果には出さない。停止後や新しいセッションの開始後でも、UIに残っている同じIDの確定行だけを更新する。未知・削除済み・認識途中の行には適用せず、一度確定した結果は後続の通知で変えない。

結果を受け取る前にサイドカーとの接続が終了した場合は、UIが未確定の行を`failed`にする。この場合だけはバックエンドの結果通知ではなく、配送を確認できない状態として扱う。認識途中の行は消し、受信済みの結果は変えない。入力欄の送信エラーでリアルタイムの行を変更することはない。

### WebSocketとOBSへ送るメッセージ

```json
{"type": "SENT",
 "src_languages": {"1": {"language": "Japanese", "country": "Japan", "enable": true}},
 "dst_languages": {"1": {"language": "English", "country": "United States", "enable": true}, …},
 "message": "こんにちは", "translation": ["Hello"], "transliteration": […]}
```

`src_languages`と`dst_languages`は受付時に固定したタブの言語の組、`translation`は訳の配列である。`type`は`SENT`（マイク）、`RECEIVED`（スピーカーとOCR）、`CHAT`（入力欄）、`REALTIME_MIC`、`REALTIME_SPEAKER`のどれか。表示設定が変わったときは`{"type": "SETTINGS_UPDATED", "settings": {…}}`を送る（[外部インターフェース](external-interfaces.md#websocketサーバー)）。

### 内蔵モデルの取得への同意

`config.json`の`LEGACY_MODEL_DOWNLOAD_CONSENTS`は、モデルIDから確認済みの一覧を表すSHA-256文字列への辞書で、既定は`{}`。IDは`ctranslate2:m2m100_418M-ct2-int8`などで、対象はいまCTranslate2の翻訳モデルだけである。以前の版が記録した`whisper:…`の同意は、ファイルに残っていても使わない。値は`models/legacy_model_consent.py`がモデル名・提供元・ライセンス・重みのリポジトリと固定版・全ファイルの容量とSHA-256・同じ一式に含まれるtokenizerのリポジトリ・固定版・ファイル一覧をJSONにして計算する。ファイルのハッシュそのものではなく、確認した内容を識別する値である。

`/get/data/model_download_catalog`の`legacy_models`に、確認画面用の名前、提供元、ライセンス、非商用の制限、正確な`total_bytes`、`tokenizer_size_unknown`、`manifest_version`を返す。CTranslate2のtokenizerには同じ取得元と固定版、ファイルの容量・SHA-256、bundled: trueが入る。tokenizer_size_unknownはfalse、容量は重複して足さない。`/run/download_ctranslate2_weight`には`{weight_type, consent: true, manifest_version}`を送る。現在の一覧と一致する明示的な同意を受け取ったときだけ記録し、取得前に即時保存を試みる。保存失敗は通常の設定保存と同じ通知・再試行で扱う。

起動時の取得では、保存された値と現在のモデル一覧の値が一致するか確認する。版、ファイルの容量・SHA-256、ライセンス、tokenizerの版が変わると再確認が必要になる。古い値はファイルを削除する根拠にはしない。旧版からの移行時は記録なしとして扱い、`AUTO_DOWNLOAD_MODELS=True`や既存のNLLB選択から同意を推測しない。既に取得したファイルとモデルの選択は保持する。

CTranslate2の取得に失敗したとき（`WEIGHT_CTRANSLATE2_DOWNLOAD`）、`data.reason`は`download_failed`、`insufficient_space`、`hash_mismatch`、`size_mismatch`、`verification_failed`、`download_deadline`、`cancelled`、`download_busy`、`downloads_closed`、`unsafe_destination`の固定のコードで、パスや例外の文は入れない。UIはこのコードに対応する理由を通知に出し、知らないコードは一般的な失敗として扱う（#305）。`cancelled`（取得を止めた）は失敗として知らせず、一覧の取得中の表示だけを戻す。現在、旧形式の取得を止めるのは、アプリの終了時と、起動時に再取得する前だけである。同じモデルの取得が動いている（`active_job_id`がある、`download_busy`）か終了中（`downloads_closed`）でなければ、通知に「確認して再試行」を付け、閉じるまで消さない。押すとそのモデルの確認画面を開き直し、取得は改めて同意を得てから送る。通知から直接は取得しない。CTranslate2は#288で廃止する予定のため、これは現行版の利用者が行き止まりにならないための最小限の対応である。

### チャット読み取りの範囲

`OCR_CAPTURE_REGION`はデスクトップのウィンドウ用、`OCR_VR_CAPTURE_REGION`はWindowsのSteamVRヘッドセット映像の左目側用で、どちらも`config.json`に保存する。画面ごとに幅と高さに対する割合で指定する。

```json
{
  "OCR_CAPTURE_REGION": {"x": 0.6, "y": 0.1, "width": 0.2, "height": 0.2},
  "OCR_VR_CAPTURE_REGION": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
}
```

`x`と`y`は左上、`width`と`height`は幅と高さ。有限の数値で画面内に収まり、幅と高さはそれぞれ0.02以上を必要とする。既定値は両方とも全体。IPCのsetterは小数点以下4桁に丸めて同じ検証を行い、不正な範囲を保存・予約せず400を返す。

旧版の単一の範囲は、キー名を変えず`OCR_CAPTURE_REGION`でウィンドウ用として引き継ぐ。`OCR_VR_CAPTURE_REGION`がない保存ファイルには全体の範囲を補い、読み込み後の保存で書き込む。既存のVR用の値は保持する。不正な値はそのキーの既定値へ戻し、片方の範囲をもう片方へコピーしない。Linuxでも両方を保存するが、VR用の範囲は適用せず、設定ページにも編集欄を出さない。

`/get/data/ocr_capture_region`と`/set/data/ocr_capture_region`は引き続きウィンドウ用の矩形を扱う。VR用は`/get/data/ocr_vr_capture_region`と`/set/data/ocr_vr_capture_region`で同じ形を扱う。

`/get/data/ocr_capture_status`は次の状態を200の応答にまとめて返す。`active`は有効化済みで停止していないワーカーがあるかを示す。`source`は直近の取り込み結果の元で、画像がないときや停止中は`null`。Linuxでは`available_sources`は`["window"]`となる。`shared_window`はLinuxで利用者が共有したウィンドウの扱いを示す。共有されたウィンドウを読んでいる間は`"active"`、読んでいた共有が終わり、名前で探せるウィンドウもない間は`"ended"`、それ以外と停止中は`null`。共有されたウィンドウを読んでいる間も`source`は`"window"`のままとする。

```json
{
  "active": true,
  "source": "window",
  "shared_window": null,
  "available_sources": ["window", "vr"],
  "state": "reading",
  "stage": null,
  "error_code": null,
  "detector": "region"
}
```

`state`は`stopped`、`waiting`、`reading`、`retrying`のいずれか。`stage`は`activation`、`capture`、`detector`、`recognition`、`tick`、`null`で、待機中や失敗した段階を表す。`error_code`は失敗時の既存の`OCR_DISABLED_*`コード、それ以外は`null`。`detector`はワーカーが実際に採用した検出器で、範囲読みでは`region`、独自検出器では`vrct-vox-chatbox`。取得済みかどうかや使用設定とは別に扱う。停止中は`active: false`となり、`source`、`stage`、`error_code`、`detector`はすべて`null`にする。

設定ページを開いている間だけ、このエンドポイントを1秒ごとに1回問い合わせ、取り込み元と実行状態を同じ欄に表示する。この取得はワーカーの状態を見るだけで、デバイスの検査、画像の取り込み、モデルの読み込みは行わない。正常な応答は診断ログへ書かず、状態自体も保存しない。

### その他

| データ | 形 |
|---|---|
| ワードフィルター | 文字列の配列。重複は順を保って除く。一致すると`/run/word_filter`に`{"message": "Detected by word filter: …"}` |
| ホットキー | `{open_quick_chat, toggle_vrct_visibility, toggle_translation, toggle_transcription_send, toggle_transcription_receive, stop_voice, toggle_voice_mute, toggle_tts, toggle_rvc}`の各値が`["Ctrl","Shift","Q"]`のようなキーの配列か`null`。知らないキーを含むと全体を拒否する |
| 実験的機能（`EXPERIMENTAL_FEATURES`） | `{機能のID: 真偽値}`。一覧にある機能をすべて持ち、既定はどれも`false`。要求に含めなかった機能は今の値のまま。一覧にないIDは捨てる（卒業や廃止で消えた機能の保存値が残っていても読み込める）。真偽値でない値を含むと全体を拒否する。機能の一覧は`src-python/models/experimental_features.py`、`src-ui/logics/configs/experimentalFeatures.ts`、`native/core/src/config/schema.rs`の3か所にあり、バックエンドの試験で一致を確かめる。今の機能は	ray_companion（[六芒星のオーバーレイ](cross-cutting.md#六芒星のオーバーレイtray_companion)）だけ |
| 六芒星のオーバーレイで六芒星を隠す端（`TRAY_COMPANION_EDGE`） | `right`、`left`、`top`、`bottom` のどれか。既定は`right`。実験的機能の六芒星のオーバーレイがオフの間も値は残す。ほかの値は拒否する（[六芒星のオーバーレイ](cross-cutting.md#六芒星のオーバーレイtray_companion)） |
| 六芒星のオーバーレイで六芒星を出すモニター（`TRAY_COMPANION_MONITOR`） | システムがモニターに付けた名前。空はメインのモニター（既定）。256文字までで、制御文字は拒否する。選んだモニターが外されていても値は残し、その間はメインのモニターを使う（[六芒星のオーバーレイ](cross-cutting.md#六芒星のオーバーレイtray_companion)） |
| 用途（`USAGE_PRESETS`） | `basic`、`nonverbal`、`multilingual`、`voice_changer`、`all`のうち1つ以上の配列。この順に、重複なしで保存する。知らないIDは除き（後の版で増えたもの）、知っているIDが1つもなければ拒否する。保存は即時。新しく入れたときの既定は`["basic"]`で、前の版から更新したとき（保存した設定があり、このキーがない）は`["all"]`にする。表示する機能を絞るだけで、ほかの設定は変えない（[用途別プリセット](cross-cutting.md#用途別プリセット)） |
| 重みの取得状態 | 一覧は {種類: 取得済みか}。受付は {weight_type, job_id}。進捗は {weight_type, job_id, progress}、成功通知は {weight_type, job_id, downloaded: true}。失敗通知はエラー本体のdataに {weight_type, job_id, downloaded: false, reason} を入れる。進行中の同じ重みへの重複要求を拒否する場合はactive_job_idも付ける |
| エンジンの状態 | `{エンジン名: 使えるか}`。使えるエンジンの一覧は`selectable_*_engines`で配列として返す |
| エラー | [IPCプロトコル](ipc-protocol.md#エラーの本体) |

## config.json

- 置き場所は`$VRCT_CONFIG_DIR`、なければ実行ファイルのあるフォルダ（開発中は`src-python/`）。Linuxの配布版では`$XDG_CONFIG_HOME/vrct-vox`（なければ`~/.config/vrct-vox`）である。フォルダ名は保存先の識別子なので、変えるには移行の処理がいる（`docs/voice-stack/project-rename.md`）。
- 設定は中核の`native/core/src/config/schema.rs`の`keys()`で宣言し、既定値は`defaults()`にある（0.4までのPythonの`Config`クラスの`ManagedProperty`と`ValidatedProperty`を写したもの）。`serialize`が真のものだけを保存する。オンオフの状態（`ENABLE_*`）や選択肢の一覧は保存しない。
- 単純な設定プロパティは、未選択を表すモデル名と音声認識エンジンを除き`null`を受け付けない。APIキーやホットキーの辞書内にある未設定の`null`は維持する。数値のプロパティとオーバーレイの数値設定は`NaN`・無限大（`1e999`などの桁あふれも含む）を保存前に拒否する。不正な保存値は既定値へ戻す。メッセージ欄の比率と大小字幕の設定変更では400の`VALIDATION_CONFIG_VALUE_INVALID`を返し、`data`には保持した設定値を入れる。
- 読み込みでは、各キーを検証してから設定する。知らないキーは捨て、次に保存するとファイルからも消える。検証に通らないキーは既定値のままにしてerror.logに残す。ただしマイクとスピーカーの選択（`SELECTED_MIC_HOST`、`SELECTED_MIC_DEVICE`、`SELECTED_SPEAKER_DEVICE`）は、読み込む時点でデバイスの一覧がまだ取れていないため、保存値をそのまま受け取る。一覧が取れたあと、サイドカーがデバイスの有無を確かめ、無ければ既定のデバイスに戻す。JSONとして読めない、またはオブジェクトでないときは、そのファイルを名前の重複しない`config.json.unreadable-<日時>-<乱数>`に移して残し、既定値で起動する。UIは`/run/config_file_unreadable`を受けて、既定値で起動したことと残したファイルの場所を知らせる。
- メモリー上の初期値をすべて用意してからログ用ディレクトリを作る。ログ用ディレクトリを作れなくても、設定の初期化は完了させる。それ以外の初期化が途中で失敗したときは、不完全なインスタンスを公開せず、設定の読み込みも保存も行わない。読み込み中は保存せず、全項目の適用と移行が終わってから1回だけ保存する。読み取り権限の不足や退避の失敗では元のファイルを残し、[保存の失敗通知](cross-cutting.md#サイドカーでの保存)を出して以後の保存を止める。
- 版番号はない。ローカル音声認識の移行だけは、済ませた段階を`LOCAL_ASR_MIGRATION`に記録する（[ローカル音声認識の移行](#ローカル音声認識の移行)）。用途（`USAGE_PRESETS`）は段階を記録しない。保存した設定があってこのキーがなければ、前の版から更新したと見なして`["all"]`にする。読めないファイルは何も保存していないのと同じに扱うので、新しく入れたときの`["basic"]`になる。移行する前の内容は、APIキーを除いて`config.json.before-migration-<段階>`に残す（[失敗したときに保つもの](failure-recovery.md#設定)）。入れ子の設定のうち`SPEECH_SERVER_SETTINGS`と`REALTIME_ASR_SETTINGS`は`"version": 1`を持つ。
- `OVERLAY_VR_LAUNCHER_SETTINGS`の`ui_scaling`は、ランチャーの帯が952px幅だとしたときの横幅（m）である。帯が880px幅になっても意味を変えない。版番号がなく移行済みかどうかを区別できないので保存値は書き換えず、実際の横幅を880/952倍して求める。保存値のまま、ボタンの大きさが変わらない。
- 保存済みの言語・翻訳エンジンの辞書が壊れているときは、不足・不正なタブや枠を既定値で補い、正常な部分は読み込む。余分なキーは捨てる。実行中の更新に対する構造の検証とは区別し、壊れた辞書で起動を妨げない。
- 書き込みは[横断的な振る舞い](cross-cutting.md#サイドカーでの保存)のとおり、2秒の遅延、0600の一時ファイル、`fsync`、置き換えの順に行う。
- 起動のたびに直す値がある: `SELECTED_RELEASE_CHANNEL`は版から決め直す。インストーラーが置いた`installer_language.txt`があればUIの言語にして消す。WebSocketのトークンは初回と不正な保存値の修復時に作って保存する（[ネットワーク設定](#ネットワーク設定)）。

### APIキーの保存先

APIキーは`config.json`に書かない（0.5.0から）。いまはOSの資格情報ストアに保存する（Issue #575）（[ADR-013](../adr/adr-013-secret-store.md)）。Windowsは資格情報マネージャー、LinuxはSecret Service（GNOME Keyring、KWalletなど）である。`AUTH_KEYS`（翻訳）と`TRANSCRIPTION_AUTH_KEYS`（音声認識）の値と`PAPAGO_CLIENT_ID`を1件ずつ保存する。項目の名前は`AUTH_KEYS/DeepL_API`のように辞書の名前とプロバイダ名をつないだものである。どちらの辞書に足したプロバイダも同じ扱いになる。キーを持つ設定を新しく足すときは`native/core/src/config/secrets.rs`の`SECRET_SETTINGS`に名前を加える。

- メモリー上の設定はいままでどおりで、`/get/data/*_auth_key`は同じ値を返す。`/run/initialization_complete`の一覧にも同じ値が入る。
- 設定のフォルダごとに16桁の16進のIDを作り、`secrets.json`の`store_id`に置く。OSのストアの項目はこのIDで分けるので、`VRCT_CONFIG_DIR`で分けた設定どうしはキーを共有しない。IDは最初のキーを保存したときに作る。IDがないうちはOSのストアに問い合わせない。
- Windowsの項目は汎用の資格情報で、名前は`VRCT-VOX/<ID>/<項目の名前>`、保存の範囲は`CRED_PERSIST_LOCAL_MACHINE`（移動プロファイルで送られない）。値はキーのUTF-8で、2,560バイトまで。
- Linuxの項目は既定のコレクションに置き、属性`application=vrct-vox`、`vrct-vox-store=<ID>`、`entry=<項目の名前>`で探す。ラベルは`VRCT-VOX <項目の名前>`。既定のコレクションがないときは作らない（作ると利用者に尋ねることになる）。
- アプリは鍵束を開くダイアログを出さない。ロックされたストアは`locked`、ストアがない、セッションバスがない、5秒以内に応答しないときは`unavailable`の一時的な失敗として扱い、`secrets.json`にもOSのストアにも触れない。
- `secrets.json`は`{"version": 1, "protection": …, "entries": …, "store_id": …}`である。0.5.xが保存したキーを持っていることがあり、移行の元として読む。Windowsではキーの一覧をDPAPI（暗号化したユーザーだけが戻せる）で包み、Base64にして`entries`に入れる（`"protection": "dpapi"`）。Linuxでは一覧をそのまま入れ、ファイルの権限を0600にする（`"protection": "none"`）。いまの版はこのファイルに新しくキーを書かない。書き込みは`config.json`と同じく、新しい一時ファイル、`fsync`、置き換えの順で行う。
- 移行: 起動時、`secrets.json`だけにあるキーはそのまま使い、1件ずつOSのストアに書いて読み戻す。同じ値が読めたものだけを`secrets.json`から除く。`config.json`にキーがあれば（0.4以前のPythonや以前の中核が書いたもの）、同じ手順でOSのストアへ移し、`config.json`から除いて書き直す。途中で落ちてもキーはどちらかに残り、次の起動で続きから移す。両方にあるときはOSのストアの値を使い、同じ値のときだけ`secrets.json`の写しを除く。
- OSのストアから読めなかったキーは、`secrets.json`に残っていればそちらを使う。残っていなければその起動のあいだは空として扱い、保存先の中身には触れない。読み出しはその起動のあいだにはやり直さず、次の起動で読む。
- 保存先に書けない、読み戻せない、消せないときは、キーをメモリーに残してその起動のあいだ使えるようにし、`/run/secret_store_failed`に400の`SECRET_STORE_FAILED`を送る。`data`は`{operation, entries, reason, store}`で、`operation`は`migrate`、`write`、`delete`、`read`のどれか、`entries`は項目の名前（キーの値は入れない）、`reason`は`unreadable`、`write_failed`、`unavailable`、`locked`のどれか、`store`は`credential_manager`か`secret_service`である。移せなかったキーは元の場所（`config.json`か`secrets.json`）に残す。次の保存と30秒ごとにもう一度試し、移せたら元の場所から除く。同じ項目の失敗は直るまで1回だけ知らせる。画面の通知は、`migrate`ならキーが元の場所で使えること、`unavailable`と`locked`なら鍵束を起動してロックを解除し再起動することを伝える。
- OSのストアが使えないときも、新しいキーや変えたキーを`secrets.json`に平文で書くことはしない。その起動のあいだだけ使える。
- キーを消す要求（`/delete/data/*_auth_key`など）は、`secrets.json`の写しを先に除き、それからOSのストアから除く。OSのストアが応答しなくても平文の写しは残らない。
- JSONとして読めるが項目を復号できない`secrets.json`（別のユーザーのDPAPIなど）は`store_id`をそのまま使い、次にキーを保存するときに`secrets.json.unreadable-<日時>-<乱数>`へ移してIDを引き継いだ新しいファイルを作る。JSONとして読めない`secrets.json`も、キーを保存するときに同じ名前へ移し、新しいIDで作る。どちらも元のファイルは消さない。一時的に読めないファイルには触れず、書き込みを一時的な失敗にする。
- 翻訳のカタログに利用者が足したAPIの項目（#413）のキーも同じ保管場所に置く。項目の名前は`TRANSLATION_CATALOG/<項目のID>`で、設定（`SECRET_SETTINGS`）には入れない。項目を足すときに書いて読み戻し、読み戻せなければ項目を足さない。項目を削除すると、そのキーも消す。
- 0.5.xに戻すと、移したキーは`secrets.json`にないので入れ直しが要る。キーはOSのストアに残っている。0.4以前に戻した場合も同じである。
## そのほかのファイル

| ファイル | 置き場所 | 内容 |
|---|---|---|
| `process.log`、`error.log` | `$VRCT_CONFIG_DIR/logs/`（なければ作業フォルダ） | 診断ログ。10MBで切り詰め、`process.log`は起動のたびに空にする。失敗した実行のあとでUIが中核を起動し直したときだけは空にせず、前の実行の記録に続けて書く。0.4までのPythonバックエンドは、ほかに`freeze_trace.log`と`crash_trace.log`（faulthandlerのスタックダンプ）、`startup_timing.log`（起動の段階ごとの時間）も書いていた。中核はこの3つを書かない |
| `startup.log` | 同上（Tauri側） | ウィンドウの起動記録 |
| 会話ログ `YYYY-MM-DD_HH-MM-SS.log` | `PATH_LOGS` | 「会話ログを自動的に保存する」がオンのときだけ。行頭は`[SENT]`、`[RECEIVED]`、`[OCR]`、`[CHAT]`。画面は新しい1,000件しか残さないが、ファイルには古いものも残る |
| `downloaded_models/<id>/<版>/`と`receipt.json` | `config.json`と同じフォルダ | 取得したモデル。取得中は`.partial-<16進>/`。壊れたモデルを取り直すときも、いったんその名前に戻してから消す（[失敗したときに保つもの](failure-recovery.md#モデルの取得と適用)） |
| `user_models.json` | `config.json`と同じフォルダ | 利用者が名前を付けて登録したモデル（#403）。`{"version": 1, "models": [{id, target, name, files: {役割: {path, size, mtime_ns}}, registered_at}]}`。ファイルの場所と、登録したときの容量と更新時刻だけを持ち、モデルのファイルはコピーしない。一時ファイルに書いて`fsync`してから置き換える。読めない、または版が違うときは書き換えずに残す。PythonとRustのコアは同じ形式を読み書きする |
| `translation_catalog.json` | `config.json`と同じフォルダ | 翻訳のカタログに利用者が足した項目（#413、中核のみ）。`{"version": 1, "entries": [...]}`。推論エンジン系は`{id, group: "engine", name, runtime, folder, languages, registered_at}`、API系は`{id, group: "api", name, protocol, url, model, key, registered_at}`。`key`はキーがあるかどうかだけで、キーそのものは[APIキーの保存先](#apiキーの保存先)に置く。フォルダーのモデルはコピーしない。書き方と、読めないときに残すことは`user_models.json`と同じ。この版が知らない`runtime`や`protocol`の項目は残し、使えないものとして見せる |
| `vc_runtimes/<エンジン>/`と`receipt.json` | `config.json`と同じフォルダ | アプリが準備したRVCの実行環境（WindowsとLinux。0.4まではSeed-VCも）。`.steps.json`に終わった手順を残す。0.4までのPythonバックエンドは、`setup.log`に`uv`とワーカーの確認の出力も残し、Seed-VCでは`.uv-<版>/`に取得用の`uv`を置いた（0.5.0の中核は`setup.log`を書かない）。RVCは`lib/`（ONNX Runtime。GPU用はCUDA 13とcuDNNのライブラリも）と`assets/`だけで、取得中は`lib.part/`と`downloads/`を使う。RVCの取得が終わると、同じフォルダーにある以前のPyTorch形式の`venv/`、`python/`、`engine/`（中のモデルと音声のファイルは残す）、`engine.zip`、固定の`rmvpe.pt`と`preprocessor_config.json`を削除する |
| weights/whisper/… | PATH_DATA | 以前の版が取得した Whisper の重み。いまの版は読まず、取得もしない。利用者が設定で削除を選んだときだけ消す（[古い Whisper の重み](#古い-whisper-の重み)） |
| weights/ctranslate2/… | PATH_DATA | 0.4までのPythonバックエンドが取得したCTranslate2の翻訳モデルと検証記録。0.5.0の中核は読まず、起動の後でPythonが作った名前のフォルダだけを消す（リンクやジャンクションはたどらない。`native/core/src/controller/legacy_weights.rs`、[中核の統合](../voice-stack/core-integration.md)の「旧 CTranslate2 の重み」） |
| `secrets.json` | `config.json`と同じフォルダ | APIキー（[APIキーの保存先](#apiキーの保存先)）。Windowsでは暗号化、Linuxでは権限0600 |
| `voice_mute_state.json` | `config.json`と同じフォルダ | `{"version": 1, "muted": 真偽}`。すぐに書き、原子的に置き換える |
| `telemetry_state.json` | `PATH_DATA` | 利用状況の通知をその日（UTC）に送ったかどうかの記録（起動の通知を送った日付と、その日に送ったエラーコード）と、送った内容そのものの直近20件（`sent`: このPCの時刻、本文、受け付けられたか） |
| `io.github.kein5.vrct-vox.desktop` | `$XDG_DATA_HOME/applications/` | Waylandでショートカットを登録するためのデスクトップファイル |

UIは独自の状態を持たない（`localStorage`も使わない）。画面の状態はすべてサイドカーから受け取る。

### 文字起こしの診断ログ

通常の発話診断は、mic/speaker別の`[utterance-summary]`として`process.log`に残す。
最初の観測から60秒以上経った後、次の観測が来た時点で前の区間を出力する。
活動がなければ出力せず、タイマーや専用スレッドも使わない。停止・終了時には残りを出力する。
停止の待機上限を超えていたワーカーが後から完了した場合も、その残りを出力する。

件数と最大値は区間内の全観測、p50/p95は各段階の直近256件からnearest-rank方式で求める。
`n`は全観測数、`samples`は分位点に使った件数。時間の単位はms。
VADの無音待ち（`vad_wait_ms`）、蓄積音声長（`vad_buffer_ms`）、完成済み音声のキュー待ち、
ASR、翻訳、その他の出力処理を分ける。従来の`total_ms`はASR開始から出力完了までの処理時間の和で、
録音・VAD・キュー待ちは含まない。リアルタイム経路では、サーバーの発話開始/commitからfinal受信までを
`realtime_pending_ms`、final受信から処理完了までを`realtime_total_ms`とする。
サーバー内部のVAD待ちと推論時間は提供されないので、個別の計測値として扱わない。

失敗・例外は従来どおり即時に記録する。遅い処理も従来の詳細を残す。
診断用の基準は、VAD無音待ち1,536ms、蓄積音声15,000ms、キュー待ち/出力1,000ms、
ASR/翻訳5,000ms、従来のtotal 10,000ms。
リアルタイム経路ではpending 7,500ms、finalキュー待ち/翻訳1,000ms、final処理全体2,000ms。
これらは処理を打ち切る制限ではない。キュー落ちは最初の1件を即時記録し、連続した回数は集約し、
次の正常投入で復旧を記録する。停止まで正常投入がなければ`recovery=unconfirmed`とする。
音声や認識文は診断に含めず、文字起こしのIPC応答の既存の伏字処理も維持する。
新しい設定や環境変数はない。実装は`models/transcription/utterance_diagnostics.py`。

## 環境変数

| 変数 | 働き |
|---|---|
| `VRCT_CONFIG_DIR` | `config.json`、ログ、取得したモデル、声質変換の実行環境、ミュート状態の置き場所 |
| `VRCT_DATA_DIR` | Linux配布版のデータの置き場所（`src-tauri/src/backend_host.rs`） |
| `XDG_CONFIG_HOME`、`XDG_DATA_HOME` | Linux配布版の既定の置き場所の元 |
| `VRCT_CACHE_DIR`、`XDG_CACHE_HOME`、`HF_HOME` | 0.4までのPythonバックエンドがLinux配布版のキャッシュの置き場所に使った（`HF_HOME`は未設定なら`<キャッシュ>/huggingface`）。0.5.0のアプリと中核のコードは置き場所に使わない |
| `VRCT_VOICE_TRACE`、`VRCT_VOICE_GC_DIAGNOSTICS` | 読み上げの時間計測とGCの記録（診断用） |
| `WAYLAND_DISPLAY`、`XDG_SESSION_TYPE`、`GDK_BACKEND` | Quick Chatとホットキーの登録方法の判定 |
| `DISPLAY` | X11でのOCRのキャプチャ |
| `VRCT_VR_PANEL_DIR` | Tauriが起動時に決める、このプロセス専用の場所（`$XDG_RUNTIME_DIR/vrct-vox/vr-panel-<pid>`、Linux）。バックエンドはここでVR画面の画素（`frame`）と、共有されたウィンドウの画素（`screen-frame`）を読む。利用者が設定するものではない |
| `APPIMAGE`と`WEBKIT_DISABLE_DMABUF_RENDERER=1` | NVIDIA環境のAppImageでメインウィンドウを不透明にする |

`HF_HUB_OFFLINE`などのオフライン用の変数は、アプリは読まない。`tools/dev.py`が開発用の子プロセスに設定する。

## 音声デバイスの選択と識別

従来の文字起こしと音量メーターは、入力元ごとに1つの録音セッションを共有する。名前は表示用のラベルとし、選択にはIDを使う。

- 保存する`SELECTED_MIC_DEVICE_ID`と`SELECTED_SPEAKER_DEVICE_ID`を追加した。既存の`SELECTED_MIC_HOST`、`SELECTED_MIC_DEVICE`、`SELECTED_SPEAKER_DEVICE`は残す。名前だけの旧設定は、対象ホストの候補が1台に絞れるときだけIDへ移行する。同名の候補が複数あるときは手動で選び直す。保存したIDが見つからなくても、同名という理由で別の機器と同一視しない。
- PortAudioが返すエンドポイントID・UID、対応を一意に確認できるWindowsのIMMDevice ID、PipeWireのノード名を識別に使う。IDを取得できないPortAudioの機器には、プロセス内の一覧に限って有効なIDを付ける。このIDは再起動や接続状態の変更を越えて同じ機器を保証しない。名前の重複からWindowsのIDとの対応を推測しない。
- 録音開始時のPortAudio情報に、選択時に確認したネイティブIDが含まれない場合は、そのopenで使うPortAudioの一覧と新しいIMMDeviceの一覧から対応を確認する。別のIDならそのストリームを閉じて代替機器を探す。対応を確定できない場合は録音を続け、選択時のネイティブIDを引き継がず、実際に開いたスロットのIDと名前を通知する。
- 選択IDとは別に、接続状態の世代、PortAudioのインデックス、サンプルレート、入力チャンネル数を比較する。名前とIDが同じでも、これらが変われば録音を再設定する。
- 旧IPCの名前の文字列と名前一覧は維持する。新しい`/get/data/selectable_mic_device_options`とスピーカー側の同名形式は`[{id, label}]`を返す。`/get/data/selected_mic_device_id`、`/set/data/selected_mic_device_id`とスピーカー側の同名形式はID文字列を扱う。各値の変更は`/run/…`でも通知する。デスクトップとVRの選択欄は新しいIPCを使う。同名の項目にはIDも添える。旧名による変更要求は、候補が1台のときだけ受け付ける。
- 一覧の更新やAuto選択だけでは録音を始めない。Autoをオンにすると、選択値と収録中のデバイスを1回の処理で合わせる。更新中にAutoをオフにしても、利用者が始めた録音を継続する。OFF操作が終わった後に、古い再開要求で録音を再開しない。
- 利用者が始めた録音では、選択した機器が消えた場合や開けない場合、Autoがオフでも利用可能な別の機器へ切り替えて継続する（2026-11-04の保守方針）。ライブラリの既定値を識別しないまま開くことはしない。開けた機器のIDと名前を選択値として通知し、`/run/audio_device_switched`の200通知に`{source, old_device: {id, name}, new_device: {id, name}}`を入れる。UIは変更前後の名前を、操作を妨げない通知で知らせる。
- 代替機器でも開始できない場合、止まった文字起こしとメーターをオフにし、メーターをゼロへ戻す。開く処理がタイムアウトした場合も、その処理の所有権を保持する。処理が終わるまで同じ入力元の新しいopenを拒否し、遅れて開いた資源を閉じる。既に実行中のネイティブ呼び出しを強制的に中断できる保証はない。
- 録音のエラーと復旧処理は開始ごとの世代で照合する。古い録音のエラーで、切り替え後の録音を止めたり、新しいエラー通知を抑止したりしない。この世代は利用者のオン・オフ操作やメッセージ配送の世代と分け、内部のデバイス切り替えだけでは受け付け済みのテキストを破棄しない。検証のために開いたストリームは、リスナーが開始する前に停止された場合も一度だけ閉じる。

リアルタイムASRは別のキャプチャ経路であり、ここで述べた従来の録音の自動継続は適用しない。
