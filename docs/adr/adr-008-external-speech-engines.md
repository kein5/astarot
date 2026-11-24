---
date: 2026-11-15
status: accepted
era: python-sidecar
validity: implementation_changed
validity_note: 利用者が入れたエンジンにループバックの HTTP で接続し、同梱も取得もしない決定は変わらない。4 章の Python のモジュール構成は、Rust の native/tts の src/engines.rs に替わった。
implementation_status: implemented
implementation_checked: 2026-11-18
implementation_note: 0.3.0 で実装し（#272、#313）、Rust の native/tts が引き継いだ。
evidence:
  - native/tts/README.md
  - native/tts/src/engines.rs
---
# ADR-008: Use external speech synthesis engines (VOICEVOX family, COEIROINK) for text to speech

[日本語版](#adr-008-外部の合成音声エンジンvoicevox系coeiroinkを読み上げに使う日本語版)

Status: Accepted (2026-11-15). Implemented in 0.3.0 (#272, #313).
Date: 2026-11-15
Related: [ADR-007](adr-007-translated-speech-through-voice-conversion.md)

The user wrote a design memo on 2026-11-15 and asked to "put this into v0.3.0 too". Sections 1 to 10 are that memo. Sections 11 and 12 are the result of checking the memo against the code on the same day, and a proposal for the open items in section 9.

## 1. Purpose

Besides TTS with the current AI voice (speech.cpp), let users choose a speech synthesis engine that they have installed on their own PC (VOICEVOX, COEIROINK, AivisSpeech, SHAREVOX) as the TTS backend. The scope is reading Japanese aloud (the `japanese` role).

## 2. Approach: "connect" instead of bundling

The app does not bundle or redistribute the engines or their voice models. It connects to the HTTP API that an engine the user has already installed exposes on localhost.

Reasons (licenses):

- The VOICEVOX software's terms of use forbid redistributing all or part of the software without permission. The engine and core code are under LGPL-3.0 and similar licenses, but a distribution that contains the voice libraries is treated separately, and bundling it would break the terms. Anyone who wants to redistribute it is asked to consult the creator.
- COEIROINK's official terms of use also list redistributing the software or models among the prohibited acts.
- The conditions for using generated audio (such as credit lines) differ for each voice library, and the duty to follow them lies with the user who publishes the audio. The app keeps this division of responsibility by not redistributing anything.

This approach also fits the existing design. `local_url()` in `settings.py` already limits and validates the connection target to a local server of the form `http://127.0.0.1:PORT`, and connections to external engines fall under the same constraint (loopback only, never exposed to the LAN).

## 3. Target engines and APIs

| Engine | Default URL | API format | Notes |
|---|---|---|---|
| VOICEVOX | `http://127.0.0.1:50021` | VOICEVOX API | The original. Speaker IDs are integer style ids |
| SHAREVOX | `http://127.0.0.1:50025` | Fully VOICEVOX-compatible | Supported by changing the URL only |
| AivisSpeech | `http://127.0.0.1:10101` | Mostly VOICEVOX-compatible | See the caution in 5.2 below |
| COEIROINK v2 | `http://127.0.0.1:50032` | Its own API (v2) | Needs a dedicated adapter. See 3.2 below |

COEIROINK v1 was VOICEVOX-compatible, but the current v2 is not, so v1 is out of scope (only v2 is targeted).

### 3.1 Call sequence for the VOICEVOX-compatible API

1. `GET /speakers`: get the list of speakers and styles (used for choosing the speaker in the settings UI)
2. `POST /audio_query?text=...&speaker=<style_id>`: get the AudioQuery (accents, phoneme lengths and so on)
3. `POST /synthesis?speaker=<style_id>` (body = AudioQuery JSON): get the WAV bytes

### 3.2 Call sequence for the COEIROINK v2 API

1. `GET /v1/speakers`: get the list of speakers (`speakerUuid` and the styles' `styleId`)
2. `POST /v1/synthesis` (a JSON body containing `speakerUuid`, `styleId`, `text` and the various Scale values): get the WAV in one request. The two-step call that corresponds to AudioQuery is not needed
   (`/v1/estimate_prosody` is used only when the prosody has to be adjusted beforehand)

## 4. Module layout (proposal)

Implement it in the same style as the existing `speechcpp_tts.py`: based on `http.client`, with an exception equivalent to `SpeechError` that carries only safe codes, and cancellation tied to `CancelToken`.

- `src-python/models/tts/voicevox_tts.py` (new)
  - A VOICEVOX-compatible client. The engine kind (voicevox / sharevox / aivis) and the base URL are parameters, so one implementation covers the three engines.
  - Handles the connection check (a probe of `/version` or `/speakers` with a short timeout), listing speakers and synthesis (audio_query → synthesis).
- `src-python/models/tts/coeiroink_tts.py` (new)
  - A client for COEIROINK v2 only. Only speaker listing and `/v1/synthesis`.
- `src-python/models/tts/settings.py` (extended)
  - Add an engine choice to the `japanese` role of `VoiceSettings`.
    For example, `japanese_engine: str = "speechcpp"` (`speechcpp` | `voicevox` | `sharevox` |
    `aivis` | `coeiroink`), plus fields that hold the URL and the speaker (style id, or speakerUuid+styleId) for each engine. The meaning of the existing fields (`japanese_url`, `japanese_voice` and others) does not change, and the added fields keep backward compatibility through their default values.
  - The URL is validated with the existing `local_url()` (anything other than loopback is rejected).
- The scheduler and playback side (`tts_scheduler.py`, the conversion router) do not change.
  Like the existing backend, the new backends plug in as suppliers of a sequence of `AudioFrame` values after the WAV is converted to PCM.

### 4.1 Converting the audio format

- Each engine outputs WAV (VOICEVOX defaults to 24 kHz mono; the output sample rate can be changed with `outputSamplingRate` in the AudioQuery).
- The backend decodes the WAV and, where needed, resamples it into the PCM format that the existing pipeline expects. The conversion stays in memory and creates no temporary files.

## 5. Implementation notes

### 5.1 Latency and sentence splitting

- The engine APIs synthesize a whole sentence at once; they cannot stream. Translated text follows the existing sentence splitting: each sentence is synthesized and then played in order. The delay before the first utterance is expected to be roughly 0.3 to 1 second per short sentence with CPU inference (to be confirmed by measuring on real hardware).
- Interrupting synthesis (for example when a new utterance cuts in) follows the existing `CancelToken` mechanism, so that an HTTP request in progress can be closed.

### 5.2 How far AivisSpeech is compatible

- AivisSpeech Engine is mostly compatible with the VOICEVOX API, but if the client edits the AudioQuery before passing it to `/synthesis`, synthesis can fail because of differences in the specification. This implementation passes the AudioQuery to synthesis unchanged (adjustments such as speed and volume stay within the AudioQuery's Scale fields).

### 5.3 When the engine is not running

- The engine is an external process that the user starts separately, and the app does not manage starting or stopping it (unlike speech.cpp's bundled mode). An engine that is not running, or a failed connection, is shown in the settings UI as the "not ready" state, and speech fails safely (following the existing style of failure notices).
  The app does not start the engine automatically.
- Several engines can run at once because their ports differ. Detection is based on whether the probe succeeds, and an engine that is not running is not removed from the list; it is marked "not connected".

### 5.4 Logs and privacy

- As the existing code's rules require, the text being read, audio data and server response bodies are not put in logs or exception messages. Errors are expressed with safe codes only.

## 6. License and operating arrangements

- The app does not bundle or redistribute any engine or voice model. The settings UI has links to each engine's official site and the notice "the engine must be installed separately".
- The duty to credit generated audio differs for each voice library (character), and following it for the way the audio is published is the user's responsibility. Near the speaker choice in the settings UI, show a note asking the user to check the terms, with examples of credit lines (for example `VOICEVOX:ずんだもん` and `COEIROINK:合成音声名`, with the voice's name after the colon).
  - VOICEVOX: each voice has its own terms. Many voices require credit, and some rights holders require a paid contract to leave the credit out.
  - COEIROINK: the software's terms require the credit `COEIROINK:合成音声名`. The terms of each voice library apply on top of that.
  - AivisSpeech: the engine itself can be used without credit. Each model (AIVMX) has its own license (ACML and others), so the model's conditions take precedence.
  - SHAREVOX: some voices may require credit.
- This feature is for Japanese only. VOICEVOX-family engines cannot synthesize text in languages other than Japanese correctly, so they are not assigned to the `multilingual` role (if reading English or other languages becomes necessary, Piper (MIT), which can be built in, or the OS's standard voices are separate candidates).

## 7. Test approach

- Following the style of the existing `src-python/test/test_tts_*.py`, verify the contract against a local fake HTTP server instead of real engines.
  - VOICEVOX-compatible: parsing `/speakers`, the shape of the audio_query→synthesis requests, turning the WAV response into PCM, and the error codes when the connection fails.
  - COEIROINK v2: parsing `/v1/speakers`, and the shape of the `/v1/synthesis` request
    (passing speakerUuid/styleId).
  - Settings: validating the engine choice field (unknown engine names, rejecting URLs
    other than loopback).
- Check on real hardware with real VOICEVOX and COEIROINK v2 processes, and measure the synthesis delay for short sentences and the load when used together with VRChat.

## 8. Out of scope (not part of this proposal)

- Installing, starting or bundling the engines automatically
- Managing downloads of voice models (they are not put on the existing model download system)
- UI for engine-specific features such as singing synthesis, morphing and user dictionary editing
- A COEIROINK v1 compatibility mode
- Assigning the engines to the multilingual role

## 9. Decisions to make (open)

1. The order in which the engine choices are shown by default, and how engines that are not connected are displayed (depends on the design of the settings UI)
2. How to save the speaker and style (as the numeric style id, or as the speaker name plus the style name;
   allowing for ids that may change when the engine is updated)
3. Whether AivisSpeech is part of the first release (weighed against the cost of verifying compatibility)
4. Depending on the measured synthesis delay, whether splitting finer than sentences (at punctuation) is needed

## 10. References

- VOICEVOX official site and terms of use: https://voicevox.hiroshiba.jp/term/
- VOICEVOX ENGINE repository (API specification; includes the OpenAPI definition)
- COEIROINK official site and terms of use: https://coeiroink.com/terms
  / API reference: https://coeiroink.com/help/002
- AivisSpeech Engine repository (includes a description of its compatibility with the VOICEVOX API)
- SHAREVOX official site

## 11. Checking against the code (2026-11-15)

The memo's assumptions were checked against the code on develop (`e21f319f`).

### Assumptions that held

- `local_url()` (`src-python/models/tts/settings.py`) accepts only `http` loopback addresses (`127.0.0.1`, `localhost`, `::1`) and rejects paths, queries and user information. Every engine's default URL fits this form.
- `SpeechError` and `CancelToken` are in `speechcpp_tts.py`. Registering a closing action with `CancelToken.register()` lets an interrupt close an HTTP request in progress.
- `VoiceSettings` has two roles, `japanese_*` and `multilingual_*`. `from_dict()` fills in missing fields with default values, so existing settings still load after fields are added.

### Assumptions that were wrong

The implementation does the following.

- There is no sentence splitting yet. `tts_scheduler.py` passes a whole utterance to `synthesize_stream()`. Because speech.cpp returns PCM a little at a time, the first sound comes early even without splitting. The engines return a whole WAV for each sentence, so the new backend's `synthesize_stream()` splits the text into sentences, synthesizes one sentence at a time and returns `AudioFrame` values in order. The scheduler does not change.
- Resampling is not needed. `AudioFrame` (`models/voice_events.py`) accepts 16-bit PCM at 8000 to 192000 Hz, mono or stereo, and the output side adapts it. The backend only has to decode the WAV into 16-bit PCM. A WAV that is not 16-bit is refused with `SpeechError`.
- One place in the scheduler does change. At present `request_for()` returns the URL and the voice, and `provider_factory(url)` always creates a `SpeechCppTTS`. The engine kind will be passed as well, and the client that matches the kind will be created. The queue and playback mechanism do not change.

### Other things to decide

- The existing `japanese_server` (`external` | `bundled`) chooses how to reach speech.cpp. When `japanese_engine` is something other than speech.cpp, this value and `japanese_url` are not used. Each engine's URL is held in that engine's own field.
- Once 0.3.0 adds fields, 0.2.0 treats TTS settings that contain fields it does not know as invalid and resets them to the defaults. Someone who goes back from 0.3.0 to 0.2.0 will have to set up TTS again. Write this in the notes for updating.
- To open each engine's official site from the settings screen, add the official sites to the list of URLs the app may open (`src-tauri/capabilities/vrct_capability.json`, second security audit SEC-02).
- An utterance has a deadline by which it has to start (`start_deadline` of `CancelToken`). When a long sentence is synthesized on the CPU, the first sentence may miss the deadline. Split the text into sentences, then measure on real hardware to confirm.

## 12. Proposal for the open items

Unless the user decides otherwise, the implementation follows this proposal.

1. Order and the display of engines that are not connected: AI voice (speech.cpp, the default), VOICEVOX, COEIROINK, AivisSpeech, SHAREVOX, in that order. When the chosen engine cannot be reached, its field shows "Not connected" and tells the user to start the engine and then press "Check again". The app does not query the engine again and again on its own.
2. Saving the speaker: save the speaker name and the style name together with the style id (for COEIROINK, speakerUuid and styleId). When reading, if the id is not found or the name has changed, search again by name. If it is still not found, fail with a safe code and tell the user to choose the speaker again.
3. AivisSpeech: include it in 0.3.0. Use the VOICEVOX-compatible client and pass the AudioQuery as it is, without rewriting it (5.2).
4. Splitting finer than sentences: first split at sentence ends (`。`, `！`, `？`, `!`, `?`, line breaks). If measurements on real hardware show it is too slow, add splitting at Japanese commas (`、`).

Checking on real hardware requires installing the engines on this PC. That means downloading the engines and voice libraries, so get the user's consent before installing them.

## 13. Measured values and decisions made in the implementation (2026-11-15)

Measured on the project's test PC (Windows 11, Intel Core i7-1255U, the CPU version of both engines), with VOICEVOX ENGINE 0.26.1 and COEIROINK 2.13.0 started under `build/`. The APIs were checked against the `/openapi.json` that both engines return.

| Sentence | VOICEVOX (Zundamon) | COEIROINK (Tsukuyomi-chan) |
|---|---|---|
| 6 characters | About 1.3 s (about 3.7 s for the first run after starting) | About 0.5 s (about 1.2 s for the first run) |
| 11 characters | About 1.7 s | About 0.9 s |
| 32 characters | About 4.0 s | About 2.4 s |

This is slower than the memo's estimate (0.3 to 1 second for a short sentence). The rule is that reading microphone speech aloud starts within 5 seconds of the speech, so the implementation does the following.

- Besides splitting into sentences, it also splits a sentence longer than 40 characters at Japanese commas.
- It synthesizes the next sentence while the current one is being read. Splitting and then synthesizing in order would put silence between sentences for as long as synthesis takes.
- With a translation of 3 sentences (about 13 seconds of audio), the time until the first sound was about 1.5 seconds with VOICEVOX and about 1.6 seconds with COEIROINK.

In VOICEVOX 0.26.1, the `type` of the reading styles was `streaming_talk`. Both `talk` and `streaming_talk` are treated as reading styles, and styles for singing are left out of the list. COEIROINK's `/v1/synthesis` required every field, such as speed and volume.

---

# ADR-008: 外部の合成音声エンジン（VOICEVOX系、COEIROINK）を読み上げに使う（日本語版）

Status: 採用（2026-11-15）。0.3.0で実装済み（#272、#313）。
Date: 2026-11-15
Related: [ADR-007](adr-007-translated-speech-through-voice-conversion.md)

利用者が2026-11-15に設計メモを書き、「これもv0.3.0に入れて」と依頼した。1章から10章はそのメモである。11章と12章は、同じ日にコードと照らし合わせた結果と、9章の未決事項への提案である。

## 1. 目的

現在の AI ボイス（speech.cpp）による TTS に加えて、利用者が自分の PC にインストールした
合成音声エンジン（VOICEVOX、COEIROINK、AivisSpeech、SHAREVOX）を TTS バックエンドとして
選択できるようにする。対象は日本語読み上げ（`japanese` ロール）とする。

## 2. 方式：同梱ではなく「接続」

エンジン本体や音声モデルはアプリに同梱・再配布しない。利用者が導入済みのエンジンが
localhost で公開する HTTP API に接続する方式を採る。

理由（ライセンス）:

- VOICEVOX の本体利用規約は、本ソフトウェアの全部または一部の無断再配布を禁止している。
  エンジン／コアのコードは LGPL-3.0 等だが、音声ライブラリを含む配布物は別扱いであり、
  同梱配布は規約違反になる。再配布を希望する場合は製作者への相談が必要とされている。
- COEIROINK の公式利用規約も、ソフトウェア・モデルの再配布を禁止事項に含む。
- 生成音声の利用条件（クレジット表記など）は音声ライブラリごとに異なり、それを遵守する
  義務は音声を公開する利用者側にある。アプリ側は再配布をしないことで、この分界を保つ。

この方式は既存設計とも整合する。`settings.py` の `local_url()` は接続先を
`http://127.0.0.1:PORT` 形式のローカルサーバに限定して検証済みであり、
外部エンジン接続も同じ制約（ループバックのみ、LAN へ公開しない）の下に置く。

## 3. 対象エンジンと API

| エンジン | 既定 URL | API 形式 | 備考 |
|---|---|---|---|
| VOICEVOX | `http://127.0.0.1:50021` | VOICEVOX API | 本家。話者 ID は整数 style id |
| SHAREVOX | `http://127.0.0.1:50025` | VOICEVOX 完全互換 | URL 差し替えのみで対応可 |
| AivisSpeech | `http://127.0.0.1:10101` | VOICEVOX 概ね互換 | 下記 5.2 の注意あり |
| COEIROINK v2 | `http://127.0.0.1:50032` | 独自 API（v2） | 専用アダプタが必要。下記 3.2 |

COEIROINK v1 は VOICEVOX 互換だったが、現行の v2 は互換ではないため対象外とする
（v2 のみを対象にする）。

### 3.1 VOICEVOX 互換 API の呼び出し手順

1. `GET /speakers` — 話者とスタイルの一覧を取得（設定 UI の話者選択に使う）
2. `POST /audio_query?text=...&speaker=<style_id>` — AudioQuery（アクセント・音素長など）を取得
3. `POST /synthesis?speaker=<style_id>`（body = AudioQuery JSON）— WAV バイト列を取得

### 3.2 COEIROINK v2 API の呼び出し手順

1. `GET /v1/speakers` — 話者一覧（`speakerUuid` と styles の `styleId`）を取得
2. `POST /v1/synthesis`（body に `speakerUuid`、`styleId`、`text`、各種 Scale を含む JSON）
   — 1 リクエストで WAV を取得。AudioQuery 相当の2段階呼び出しは不要
   （韻律の事前調整が必要な場合のみ `/v1/estimate_prosody` を使う）

## 4. モジュール構成（提案）

既存の `speechcpp_tts.py` と同じ流儀（`http.client` ベース、例外は安全なコードのみを
持つ `SpeechError` 相当、キャンセルは `CancelToken` 連携）で実装する。

- `src-python/models/tts/voicevox_tts.py`（新規）
  - VOICEVOX 互換クライアント。エンジン種別（voicevox / sharevox / aivis）と
    ベース URL をパラメータ化し、3 エンジンを1実装で賄う。
  - 接続確認（`/version` または `/speakers` への短いタイムアウトのプローブ）と
    話者列挙、合成（audio_query → synthesis）を担当。
- `src-python/models/tts/coeiroink_tts.py`（新規）
  - COEIROINK v2 専用クライアント。話者列挙と `/v1/synthesis` のみ。
- `src-python/models/tts/settings.py`（拡張）
  - `VoiceSettings` の `japanese` ロールにエンジン選択を追加する。
    例：`japanese_engine: str = "speechcpp"`（`speechcpp` | `voicevox` | `sharevox` |
    `aivis` | `coeiroink`）と、エンジン別の URL・話者（style id／speakerUuid+styleId）を
    保持するフィールド。既存フィールド（`japanese_url`、`japanese_voice` 等）の意味は
    変えず、追加フィールドは既定値により後方互換を保つ。
  - URL は既存の `local_url()` で検証する（ループバック以外を拒否）。
- スケジューラ／再生系（`tts_scheduler.py`、変換ルータ）は変更しない。
  新バックエンドは既存バックエンドと同じく WAV→PCM 変換後の `AudioFrame` 列を
  供給する側として接続する。

### 4.1 音声形式の変換

- 各エンジンの出力は WAV（VOICEVOX 既定 24kHz モノラル。出力サンプルレートは
  AudioQuery の `outputSamplingRate` で変更可能）。
- 既存パイプラインが期待する PCM 形式へ、WAV デコードと必要に応じたリサンプルを
  バックエンド側で行う。変換はメモリ上で完結させ、一時ファイルを作らない。

## 5. 実装上の注意

### 5.1 遅延と文分割

- エンジン API は文単位の一括合成で、ストリーミング合成はできない。翻訳文は
  既存の文分割に従い、文ごとに合成→順次再生する。初回発話までの遅延は
  CPU 推論で短文あたり概ね 0.3〜1 秒程度を見込む（実機計測で要確認）。
- 合成中の中断（新しい発話による割り込み等）は既存の `CancelToken` の仕組みに合わせ、
  進行中の HTTP リクエストを閉じられるようにする。

### 5.2 AivisSpeech の互換性の範囲

- AivisSpeech Engine は VOICEVOX API と概ね互換だが、AudioQuery の内容をクライアント側で
  編集してから `/synthesis` に渡すと、仕様差異により正常に合成できない場合がある。
  本実装では AudioQuery を改変せず、そのまま合成に渡す（速度・音量等の調整は
  AudioQuery の Scale フィールドの範囲に限る）。

### 5.3 エンジン未起動時の扱い

- エンジンは利用者が別途起動する外部プロセスであり、アプリは起動・終了を管理しない
  （speech.cpp の bundled モードとは異なる）。未起動・接続失敗は「未準備」状態として
  設定 UI に表示し、発話時は安全に失敗させる（既存の失敗通知の流儀に従う）。
  自動起動は行わない。
- 複数エンジンの同時起動はポートが異なるため可能。検出はプローブの成否で行い、
  起動していないエンジンを一覧から除外するのではなく「未接続」と明示する。

### 5.4 ログとプライバシー

- 既存コードの規約どおり、読み上げテキスト・音声データ・サーバ応答ボディを
  ログや例外メッセージに含めない。エラーは安全なコードのみで表す。

## 6. ライセンス・運用上の取り決め

- アプリはエンジン本体・音声モデルを一切同梱・再配布しない。設定 UI には各エンジンの
  公式サイトへのリンクと「エンジンは別途インストールが必要」の案内を置く。
- 生成音声のクレジット表記義務は音声ライブラリ（キャラクター）ごとに異なり、
  公開形態に応じた遵守は利用者の責任である。設定 UI の話者選択付近に、
  規約確認を促す注記とクレジット表記の例（例：`VOICEVOX:ずんだもん`、
  `COEIROINK:合成音声名`）を表示する。
  - VOICEVOX：声ごとに個別規約。クレジット必須の声が多く、表記省略には
    有償契約が必要な権利者もいる。
  - COEIROINK：本体規約で `COEIROINK:合成音声名` のクレジットが必須。
    加えて音声ライブラリごとの規約が適用される。
  - AivisSpeech：エンジン自体はクレジット不要で利用可。モデル（AIVMX）ごとに
    ライセンス（ACML 等）が設定されるため、モデル側の条件が優先する。
  - SHAREVOX：声ごとにクレジット必須の場合がある。
- 本機能は日本語専用である。VOICEVOX 系エンジンは日本語以外のテキストを正しく
  合成できないため、`multilingual` ロールには割り当てない（英語等の読み上げが
  必要になった場合は、組み込み可能な Piper（MIT）や OS 標準音声が別途候補になる）。

## 7. テスト方針

- 既存の `src-python/test/test_tts_*.py` の流儀に合わせ、実エンジンを使わず
  ローカルの偽 HTTP サーバで契約を検証する。
  - VOICEVOX 互換：`/speakers` の解釈、audio_query→synthesis のリクエスト形、
    WAV 応答の PCM 化、接続失敗時のエラーコード。
  - COEIROINK v2：`/v1/speakers` の解釈、`/v1/synthesis` のリクエスト形
    （speakerUuid／styleId の受け渡し）。
  - 設定：エンジン選択フィールドの検証（未知のエンジン名、ループバック以外の
    URL の拒否）。
- 実機確認は VOICEVOX と COEIROINK v2 の実プロセスで行い、短文の合成遅延と
  VRChat 併用時の負荷を計測する。

## 8. 非対象（この提案に含まないもの）

- エンジン本体の自動インストール・自動起動・同梱配布
- 音声モデルのダウンロード管理（既存のモデルダウンロード基盤には載せない）
- 歌唱合成、モーフィング、ユーザー辞書編集などのエンジン固有機能の UI 化
- COEIROINK v1 互換モード
- 多言語ロールへの割り当て

## 9. 決定事項（未決）

1. 既定のエンジン選択肢の提示順と、未接続エンジンの表示方法（設定 UI の設計に依存）
2. 話者・スタイルの保存形式（style id の数値保存か、話者名＋スタイル名の保存か。
   エンジン側のアップデートで id が変わる可能性への配慮）
3. AivisSpeech を初回リリースの対象に含めるか（互換性の検証コストとの兼ね合い）
4. 合成遅延の実測結果次第で、文より細かい分割（句読点単位）が必要かどうか

## 10. 参考資料

- VOICEVOX 公式サイト・利用規約：https://voicevox.hiroshiba.jp/term/
- VOICEVOX ENGINE リポジトリ（API 仕様、OpenAPI 定義を同梱）
- COEIROINK 公式サイト・利用規約：https://coeiroink.com/terms
  ／ API リファレンス：https://coeiroink.com/help/002
- AivisSpeech Engine リポジトリ（VOICEVOX API との互換性に関する記載を含む）
- SHAREVOX 公式サイト

## 11. コードとの照合（2026-11-15）

メモの前提をdevelop（`e21f319f`）のコードと照らし合わせた。

### 合っていた前提

- `local_url()`（`src-python/models/tts/settings.py`）は、`http`のループバック（`127.0.0.1`、`localhost`、`::1`）だけを受け付け、パス・クエリ・利用者情報を拒否する。エンジンの既定URLはどれもこの形に収まる。
- `SpeechError`と`CancelToken`は`speechcpp_tts.py`にある。`CancelToken.register()`に閉じる処理を登録すれば、進行中のHTTP要求を割り込みで閉じられる。
- `VoiceSettings`は`japanese_*`と`multilingual_*`の2つのロールを持つ。`from_dict()`は欠けた項目を既定値で補うので、項目を足しても既存の設定は読める。

### 違っていた前提

実装では次のとおりにする。

- 文分割はまだない。`tts_scheduler.py`は1件の発話を丸ごと`synthesize_stream()`に渡す。speech.cppはPCMを少しずつ返すので、分割がなくても最初の音が早い。エンジンは文ごとにWAVを丸ごと返すので、新しいバックエンドの`synthesize_stream()`の中で文に分け、1文ずつ合成して順に`AudioFrame`を返す。スケジューラは変えない。
- リサンプルは要らない。`AudioFrame`（`models/voice_events.py`）は8000〜192000 Hz、モノラルかステレオの16ビットPCMを受け付け、出力側で合わせる。バックエンドはWAVを解いて16ビットPCMにするだけでよい。16ビット以外のWAVは`SpeechError`で断る。
- スケジューラの1か所は変える。今は`request_for()`がURLと声を返し、`provider_factory(url)`が必ず`SpeechCppTTS`を作る。エンジンの種類も渡して、種類に合うクライアントを作るようにする。キューと再生の仕組みは変えない。

### そのほかに決めること

- 既存の`japanese_server`（`external` | `bundled`）は、speech.cppの接続先の選び方である。`japanese_engine`がspeech.cpp以外のときは、この値と`japanese_url`を使わない。エンジンのURLはエンジンごとの項目に持つ。
- 0.3.0で項目を足すと、0.2.0は知らない項目を含む読み上げの設定を不正とみなし、既定に戻す。0.3.0から0.2.0へ戻した人は、読み上げの設定をやり直すことになる。更新するときの注意に書く。
- 設定画面から各エンジンの公式サイトを開くには、URLを開ける先の一覧（`src-tauri/capabilities/vrct_capability.json`、第2回セキュリティ監査 SEC-02）に公式サイトを足す。
- 発話には始まるまでの期限がある（`CancelToken`の`start_deadline`）。長い文をCPUで合成すると、最初の文が期限に間に合わないことがある。文に分けたうえで、実機で測って確かめる。

## 12. 未決事項への提案

利用者が別に決めない限り、次で実装する。

1. 並び順と未接続の表示: AIボイス（speech.cpp、既定）、VOICEVOX、COEIROINK、AivisSpeech、SHAREVOXの順にする。選んだエンジンに接続できないときは、その欄に「未接続」と、エンジンを起動してから「再確認」を押す案内を出す。自動で何度も問い合わせることはしない。
2. 話者の保存: style id（COEIROINKはspeakerUuidとstyleId）と一緒に、話者名とスタイル名も保存する。読み上げのときにidが見つからないか、名前が変わっていれば、名前で探し直す。それでも見つからなければ、安全なコードで失敗し、話者を選び直すよう案内する。
3. AivisSpeech: 0.3.0に入れる。VOICEVOX互換のクライアントを使い、AudioQueryは書き換えずにそのまま渡す（5.2）。
4. 文より細かい分割: まず文（`。`、`！`、`？`、`!`、`?`、改行）で分ける。実機で測って遅すぎれば、読点での分割を足す。

実機での確認にはこのPCにエンジンを入れる必要がある。エンジンと音声ライブラリのダウンロードになるので、入れる前に利用者の同意を得る。

## 13. 実機で測った値と、実装で決めたこと（2026-11-15）

このプロジェクトの試験用のPC（Windows 11、Intel Core i7-1255U、エンジンはどちらもCPU版）で、VOICEVOX ENGINE 0.26.1とCOEIROINK 2.13.0を`build/`の下で起動して測った。APIは、両方のエンジンが返す`/openapi.json`で確かめた。

| 文 | VOICEVOX（ずんだもん） | COEIROINK（つくよみちゃん） |
|---|---|---|
| 6文字 | 約1.3秒（起動して最初の1回は約3.7秒） | 約0.5秒（最初の1回は約1.2秒） |
| 11文字 | 約1.7秒 | 約0.9秒 |
| 32文字 | 約4.0秒 | 約2.4秒 |

メモの見込み（短文で0.3〜1秒）より遅い。マイクの読み上げは発話から5秒以内に始める決まりなので、次のように実装した。

- 文に分けるだけでなく、40文字を超える文は読点でも分ける。
- 読み上げている間に次の文を合成する。分けて順に合成すると、文の間に合成の時間だけ無音が入るため。
- 3文の訳文（約13秒分の音声）で、最初の音が出るまではVOICEVOXで約1.5秒、COEIROINKで約1.6秒だった。

VOICEVOX 0.26.1では、読み上げのスタイルの`type`が`streaming_talk`になっていた。`talk`と`streaming_talk`を読み上げのスタイルとして扱い、歌うためのスタイルは一覧から外す。COEIROINKの`/v1/synthesis`は、速さや音量などの項目がすべて必須だった。
