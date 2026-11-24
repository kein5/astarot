# Data formats and persistence

[日本語版](#データ形式と保存日本語版)

The main shapes of the data exchanged over IPC, and the files kept on disk. The list of setting keys is in [the setting key list](reference/config-keys.md) (generated).

## Main data shapes

### Language pairs (per tab)

`selected_your_languages` and `selected_target_languages`. For each tab number `"1"` to `"3"`, each holds a dictionary from slot number to language.

```json
{
  "1": {"1": {"language": "Japanese", "country": "Japan", "enable": true}},
  "2": {"1": {"language": "Japanese", "country": "Japan", "enable": true}},
  "3": {"1": {"language": "Japanese", "country": "Japan", "enable": true}}
}
```

- `language` and `country` are English identifiers and are not translated in saved settings, IPC, OSC or presets. `selectable_language_list` also stays `[{"language": "Japanese", "country": "Japan"}, …]`. The UI resolves the tags and display names it shows inside the UI and does not add them to the selection payload ([Internationalization](cross-cutting.md#国際化)).
- Your language has slot `"1"` only, and the target languages have slots `"1"` to `"3"`. Only target language slot `"1"` is enabled by default.
- An update needs every tab and every slot, and `language`, `country` and `enable` in each slot. An empty dictionary, missing or extra keys, or a nested value that is not a dictionary is rejected with a 400 `VALIDATION_CONFIG_VALUE_INVALID` without changing or saving anything, and `data` carries the original value. The translation engine dictionary also needs every tab, with string values.
- `language` and `country` accept only the pairs in `transcription_lang`. An invalid slot reverts to its original value (this is not an error).
- A swap (`/run/swap_your_language_and_target_language`) validates both dictionaries, changes them together under the settings lock and adjusts the translation engines once, for the final language pair. Saving also never captures a state where only one side has changed. Selected engines that support both directions are kept, and the response is `{"your": …, "target": …}`.
- The selected tab is `selected_tab_no` (`"1"`, `"2"` or `"3"`), and the translation engine of each tab is `selected_translation_engines` (`{"1": "CTranslate2", …}`).

### Speech recognition engine selection

`SELECTED_TRANSCRIPTION_ENGINE` saves the name of an existing engine as a string, or `null` for no selection. In new settings without the key, the default is `null`. A valid saved selection is loaded as it is, and consent is not asked again. A saved selection of the removed `Google` (Web speech recognition) is not loaded and becomes no selection (`null`). The user chooses again on the same selection screen as on first use. The `null` saved this time is also kept as no selection after a restart. A value of the wrong type or an unknown engine name is not loaded, and the default of no selection stays. The value is never replaced with an empty string or a new engine identifier.

The key name, `/get/data/selected_transcription_engine` and `/set/data/selected_transcription_engine` stay. The get response carries `null` when nothing is selected and the usual string when an engine is selected. A request to update the selection uses the existing engine names, and an invalid value is rejected with `VALIDATION_CONFIG_VALUE_INVALID`. Availability and the deletion of an API key do not overwrite the selection.

Turning on the classic transcription with no engine selected returns a 400 `TRANSCRIPTION_ENGINE_NOT_SELECTED` with `data: false`. A failure to build an API recognizer is reported as `TRANSCRIPTION_ENGINE_UNAVAILABLE` in a 400 notification on `/set/enable/transcription_send` or `/set/enable/transcription_receive`, and the start request results in `false` as before. Continuing on the first-use selection screen is temporary state inside the UI: it is not saved to the settings and is discarded on cancel or when the screen goes away. See [the consent rules](cross-cutting.md#同意と外部への送信).

The selectable engines, as `SELECTABLE_TRANSCRIPTION_ENGINE_LIST` lists them, are the local engine (speech.cpp, `SpeechCpp`), the cloud Groq Whisper, OpenAI Whisper, a custom Whisper server and Deepgram. The local `Whisper` (faster-whisper) was removed in #288. The `Whisper` column of the language table stays, because the cloud Whisper engines use it for language codes. The keyless `Google` (Web speech recognition) was removed because it used an unofficial endpoint and the shared key of `speech_recognition`. The `Google` column of the language table stays, because it is used for language tags with a region.

The "Speech recognition (ASR)" settings list the selectable engines under the names of two groups (#414). "On your PC (speech.cpp)" holds `SpeechCpp`, and "API (cloud or your own server)" holds Groq Whisper, OpenAI Whisper, Deepgram and the custom Whisper server, in that order. Only the order changes; the saved values and the endpoints above stay the same.

### Local speech recognition migration

From 0.6.0, local speech recognition is not migrated (decision 4 of #288). If the saved `SELECTED_TRANSCRIPTION_ENGINE` is the removed `"Whisper"`, it is loaded as no selection, like the removed `"Google"`. The user chooses an engine again, as on the first start. `REALTIME_ASR_SETTINGS` is read as saved. No model is downloaded.

`LOCAL_ASR_MIGRATION` (integer) keeps being written to `config.json` as `2`. Versions 0.5 and earlier use this value to decide whether they have finished the migration, so writing it keeps them from running the migration again when someone goes back to one of them. The current version does not read this value.

From 0.3 to 0.5, a saved file whose step was behind was migrated at the end of loading (`Config._migrateLocalASR`; the Python versions and the 0.5 series of the Rust core).

| Step | What versions up to 0.5 did |
|---|---|
| 1 | If the saved `REALTIME_ASR_SETTINGS.server` was `"bundled"`, set the speech recognition engine to `SpeechCpp` |
| 2 | Change a saved `"Whisper"` to `SpeechCpp`. On Windows, set `REALTIME_ASR_SETTINGS.server` to `"bundled"`. Also set `LOCAL_ASR_NOTICE_PENDING` to `true` and show the notice "Local speech recognition now uses speech.cpp" once on the main screen (`/get/data/local_asr_notice`, `/set/disable/local_asr_notice`) |

The content before the migration was kept in `config.json.before-migration-<step>`. 0.6.0 does not write this copy and does not touch copies that earlier versions left. `LOCAL_ASR_NOTICE_PENDING` is dropped on load as a retired key. The notice and its two endpoints do not exist (404).

`VIRTUAL_MIC_NOTICE_PENDING` (boolean, default `true`, saved) meant that the virtual microphone guide (#321) could open by itself at startup. Since #943 the guide no longer opens by itself. The UI receives the value at startup but does not use it to decide whether to open the guide, and does not send `/set/disable/virtual_mic_notice`. So that the same settings file works with earlier versions, the core keeps the key, `/get/data/virtual_mic_notice` and `/set/disable/virtual_mic_notice` as they are. The guide opens from the "Virtual microphone" row in setup and from the "Text to speech (TTS)" settings. The flow is in [UC-17](use-cases.md#uc-17-仮想マイクを用意して確かめるwindows).

`FIRST_RUN_SETUP_PENDING` (boolean, default `true`, saved) means that setup (#557) has not been finished. While it is true and setup still has something to prepare, "Open setup" on the first screen is highlighted. The things to prepare are local speech recognition (when no engine is selected, or when speech.cpp is used with the bundled server and the recognition model or the VAD model is not set) and the chosen translation model (when it can be downloaded but is not there yet, #936). Setup does not open by itself; the user opens it with this button (#935). People who updated from an earlier version also get true, because they have no key, but the row does not appear when nothing is left to prepare. "Done" and "Stop highlighting 'Open setup' on the first screen" send `/set/disable/first_run_setup` and make it false. Even when it is false, setup can be opened from the first screen while something is left to prepare. The flow is in [UC-18](use-cases.md#uc-18-初期設定で基本機能を準備する).

### Old Whisper weights

The Whisper weights that versions 0.2 and earlier downloaded are in `weights/whisper/<name>` under `PATH_DATA`. There are nine names: `tiny`, `base`, `small`, `medium`, `large-v1`, `large-v2`, `large-v3`, `large-v3-turbo-int8` and `large-v3-turbo` (`WHISPER_WEIGHT_NAMES` in [`models/transcription/old_whisper_weights.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/old_whisper_weights.py)). The current version neither reads nor deletes them.

From 0.3 to 0.5, the "Speech recognition (ASR)" settings and the migration notice had an "Old Whisper models" section that showed the total size and let the user delete the weights after checking (`/get/data/old_whisper_weights`, `/run/delete_old_whisper_weights`). 0.6.0 removed this section and the two endpoints (decision 4 of #288). The user can delete the remaining weights by removing the `weights/whisper` folder by hand.

### Numeric speech recognition settings

`avg_logprob` and `no_speech_prob` for the microphone and the speaker are the thresholds for dropping segments that the OpenAI-compatible cloud engines (Groq Whisper, OpenAI Whisper, custom Whisper server) return. In the "Speech recognition (ASR)" settings, all four can be changed under "Whisper result filtering" inside "API (cloud or your own server)". The sliders move in steps of 0.05 and send the value to `/set/data/mic_avg_logprob` and the others when the value is committed. `avg_logprob` accepts finite numbers from −2 to 0, and `no_speech_prob` finite numbers from 0 to 1. IPC also accepts strings that convert to numbers. `NaN`, infinity, out-of-range values, booleans and the like are rejected with a 400 `VALIDATION_CONFIG_VALUE_INVALID` without changing or saving anything, and `data` carries the original value. An invalid saved value goes back to the default on load.

The `MIC_` and `SPEAKER_` integer settings are checked against the ranges below when a saved value is loaded and when a setting property is assigned. `null`, booleans, decimals and strings are not accepted. The existing integer conversion over IPC stays, and an out-of-range value gets the existing `VALIDATION_MIC_*` or `VALIDATION_SPEAKER_*` with the original value.

| End of the setting name | Range |
|---|---|
| `THRESHOLD` | 0 to 2000 |
| `RECORD_TIMEOUT`, `PHRASE_TIMEOUT` | 0 to 30 seconds. `RECORD_TIMEOUT` is at most `PHRASE_TIMEOUT` |
| `MAX_PHRASES` | 0 to 30 for the microphone, 0 to 60 for the speaker |

The saved timeouts are checked as a pair, whatever the key order in the JSON. A value out of range or of the wrong type goes back to the default. When a pair is within range but its record time is longer than its phrase time, both go back to the default of 3 seconds.

The two timeouts mean the following (`energy.rs` and `phrases.rs` in `native/transcription`). `RECORD_TIMEOUT` is the upper limit on the length of one recording (one phrase cut out by volume), and 0 means no limit. A phrase cut at that limit still joins the same utterance when the next one follows without a gap. `PHRASE_TIMEOUT` is the time after the last phrase at which the audio so far is closed off as one utterance. A silence between phrases longer than this also starts a new utterance. An utterance is also closed when its audio reaches 15 seconds. The labels and descriptions in the settings screen are written with these meanings ("Mic record timeout" and "Mic phrase timeout", and "Speaker record timeout" and "Speaker phrase timeout").

`MIC_ENABLE_VAD` and `SPEAKER_ENABLE_VAD` are switches that split phrases with VAD instead of volume. They take effect from the next recording start. When VAD splits, `PHRASE_TIMEOUT` is not used, and each naturally separated segment is recognized as one utterance. A segment cut at the length limit (7 seconds) is joined with the next segment (up to 15 seconds). 0.3 seconds of silence is added before the audio sent to recognition, and 0.5 seconds after it.

VAD uses Silero VAD on the same speech.cpp server as realtime captions (`server_vad.rs` in `native/transcription`). When the switch is on and transcription recording starts, the core opens a Realtime session on that server that does no transcription. In `session.update`, `transcription` is `null` and `turn_detection` is `server_vad` (threshold 0.25, 160 ms prefix padding, 768 ms silence; the same values as the Python VAD path). The recorded audio is sent as 24 kHz mono, and the span from `audio_start_ms` of `input_audio_buffer.speech_started` to `audio_end_ms` of `speech_stopped` is cut as one segment. The bundled server is used only while it is running; recording does not start it. When only the volume meter runs, no session is opened.

`/get/data/vad_available` returns whether the server settings are complete. It is `true` when the realtime caption server is bundled and the `asr` profile of the speech server has paths for the recognition model and the VAD model, or when the server is external and its URL is a loopback address (`speechcpp::local_url`). Whether the server is running is not checked until recording starts. When the realtime caption settings, the speech server settings or applying a downloaded model change this value, the core sends `/get/data/vad_available` to the UI again. While it is `false`, `/set/enable/mic_vad_filter` and `/set/enable/speaker_vad_filter` leave the value unchanged and return a 400 `VAD_UNAVAILABLE` with the saved value. `details.reason` names what is missing (`realtime_asr_model_missing`, `realtime_vad_model_missing`, `realtime_base_url_invalid`). Turning the switch off is accepted. An on value saved by an earlier version stays as it is. The settings screen makes the VAD option unselectable, shows the reason, and shows "Auto" or "Manual" even when the saved value is on.

When the switch is on but the server cannot be used, phrases are split by volume, and a 400 `VAD_UNAVAILABLE` is sent once to `/run/vad_unavailable` (`data` is `{"source": "mic"}` or `{"source": "speaker"}`, and `details.reason` gives the reason). Besides the missing settings above, the reasons are: the server is not running or cannot be reached (`speech_server_not_ready`), the server has no VAD model (`realtime_vad_model_missing`), and the session broke off midway (`realtime_session_failed`). Segments cut by volume while the session is being opened are passed to recognition if the session could not be opened, and dropped if it opened. When the session breaks off midway, phrases from then on are split by volume. If there is a realtime caption hint (`realtime_toggle.*`) for `details.reason`, the UI appends it to the notice.

`MIC_NO_REPEAT_NGRAM_SIZE` and `SPEAKER_NO_REPEAT_NGRAM_SIZE` were removed together with local Whisper. They are not loaded even if an old `config.json` has them.

In realtime captions (speech.cpp Realtime), the server's VAD (`server_vad`) decides where utterances end. When a session starts, the core sends `silence_duration_ms` (the length of silence taken as the end of speech) and `prefix_padding_ms` (the padding kept before speech; padding also remains after it, up to the silence length) in `turn_detection` (#556). The silence length is `REALTIME_ASR_SETTINGS.silence_duration_ms`, and 400 ms by default when the field is absent (shorter than the 500 ms default of speech.cpp and OpenAI). When the default changed from 500 to 400, values that users had chosen and saved were not changed; only settings without a chosen value follow the new default. The padding is half the silence length and does not exceed 300 ms (the speech.cpp default). The bundled speech.cpp (0.11.2) finalizes an utterance once silence has lasted `silence_duration_ms`. When silence as long as the trailing padding has arrived, it starts recognizing the utterance without waiting for finalization, and finalization uses the result of that recognition (speech.cpp #232, #233). The shorter the padding, the earlier this recognition starts and the more likely it is to finish before finalization. speech.cpp up to 0.11.1 finalized an utterance only once it knew that no next utterance had started within twice the padding, so with the default padding of 300 ms, finalization took 600 ms even with 500 ms of silence. The padding was kept at half the silence or less to fit this wait inside the silence. Where an utterance is split depends only on the silence length. `silence_duration_ms` accepts integers from 100 to 2000; out-of-range values, decimals, strings and booleans are rejected with `realtime_settings_invalid`. Fields that were not chosen and `null` are not saved, so while the default stays, the 0.4 versions can read the same settings. Changing the value stops the captions for both the microphone and game audio (as changing the server or the model does). In the "Realtime captions" settings, the choices are the default (0.4 s), 0.3 s, 0.5 s, 0.7 s and 1 s. If a value not in this list is saved (such as 0.4 s chosen in a version whose default was 0.5 s), that value also appears as a choice. A shorter value finalizes sooner but is more likely to split at a pause in the middle of a sentence. Measured values are in [Voice pipeline latency](../voice-stack/pipeline-latency-2026-11-18.md).

The sensitivity for picking up speech is `REALTIME_ASR_SETTINGS.vad_threshold`, sent as `threshold` in `turn_detection` (how confident the detection must be to judge a sound as voice, 0 to 1) (#392). When the field is absent it is not sent, and the server's default applies. Numbers from 0.05 to 0.95 with at most two decimal places are accepted; out-of-range values, numbers with more digits, strings and booleans are rejected with `realtime_settings_invalid`. Fields that were not chosen and `null` are not saved. Changing the value stops both captions, as the silence length does. The settings screen offers the default (left to the server), 0.2, 0.3, 0.4, 0.5, 0.6 and 0.7. A smaller value picks up quiet voices and the starts of speech, and a larger value picks up less noise. The VAD for microphone and game audio recording (used with cloud speech recognition) keeps the same values as Python (0.25, 160 ms padding, 768 ms silence) and does not follow this setting.

### Term dictionary

The term dictionary is `{"builtin": boolean, "terms": [string], "removed": [string]}` in `REALTIME_ASR_SETTINGS.vocabulary`. `removed` holds the written forms of built-in terms that the user took out, and is not saved when there are none (see "Dictionary list and editing built-in terms" below). Each entry has speech.cpp's keyword form, written `written=reading,reading` (the readings can be left out). The user's entries are limited to 100, a written form to 48 characters, and the readings to 8 per entry of up to 32 characters each. Duplicate written forms are removed without regard to case. When `builtin` is `true`, the built-in VRChat terms are added after the user's entries, for a total of up to 150 entries. For the same written form, the user's entry wins.

The built-in VRChat terms are in `native/transcription/data/vrchat_terms.txt` and are embedded when the app is built (`astarot_transcription::speechcpp::vrchat_terms`, #792). Each line holds one entry in the form `written=reading,reading`; lines starting with `#` and empty lines are not read. To add terms or correct readings, edit only this file. Each line follows the same rules as the user's entries, and written forms do not overlap without regard to case (the core's tests check this).

The saved shape is still part of the realtime caption settings, but other features also use the dictionary (#446). Matching treats hiragana and katakana as the same, and upper- and lower-case Latin letters as the same. A word of Latin letters and digits does not match where a Latin letter or digit continues before or after it. A word that starts or ends with katakana does not match where katakana continues before or after it either ("クエスト" inside "リクエスト" is not corrected). Longer words are applied first (`astarot_transcription::terms`).

| Where it is used | What it does |
|---|---|
| Realtime captions | Sends the written forms and readings to the session as keywords (Haas) or a short hint (Qwen3-ASR). In the returned text, both partial and final, readings are changed to written forms, and written forms in Latin letters get the registered case |
| Cloud speech recognition (Whisper, Deepgram) | Corrects recognized text the same way when it enters message processing. The dictionary is not sent to the engine. Text from chat reading (OCR) is not corrected |
| TTS | When the text's language is Japanese, replaces written forms that have readings with their first reading before passing the text to TTS. Applies to both the original and the translation of chat text and final microphone text. Text in other languages is not changed |
| Translation | AI translation engines that use a system prompt (OpenAI-compatible, Gemini, Ollama, PLaMo and others) receive up to 20 written forms of the user's entries that appear in the source text, with an instruction to treat them as names. Words not in the source text and readings are not sent. The built-in VRChat terms are not passed. DeepL, Google, Papago and local translation receive nothing |

#### Dictionary list and editing built-in terms

The term dictionary in the "Speech recognition" settings shows the dictionary in use as one list ("Terms in the dictionary") (#792). The user's entries come first, followed by the built-in terms (the same order the core uses). Terms are added in the fields at the top of the list (written form and readings), and each built-in term can have its readings changed or be taken out. The list of built-in terms itself is not rewritten; the user's changes are saved as a layer over it. When an app update adds terms or corrects readings, terms the user has not changed follow the new list.

| Operation | What is saved |
|---|---|
| Add a term | Appended to the end of the user's entries (`terms`). Readings are separated by "、" or "," and can be left out. If the written form matches a built-in term, that term's readings change (as in the row below). When the written form is already among the user's entries, when the readings are the same as the built-in term's, when the entry breaks the rules, or at the limit (100), nothing is added and the reason appears at the top of the list. When built-in terms are not used, a written form that matches a built-in term is still added as a user entry |
| Change the readings of a user entry, delete it | That entry is replaced in place, or deleted |
| Change readings | A user entry (`terms`) with the same written form. User entries win over built-in terms with the same written form, so it takes the built-in term's place. Changing back to the built-in readings deletes the user entry. It counts toward the limit of 100 user entries |
| Take out | The written form is added to `removed`. The core drops the built-in term with that written form from the dictionary. If its readings were changed, that user entry is deleted too |
| Put back, Restore | The user entry and the `removed` entry for that written form are deleted. "Restore all built-in terms" deletes every user entry with the same written form as a built-in term, and all of `removed`. Entries the user added themselves stay |

- Each `removed` entry is normalized with the rules for written forms (up to 48 characters, no `,` or `=`), and duplicates are removed without regard to case. Up to 150 are accepted. When it is empty, it is not saved. A written form left in `removed` after an app update dropped it from the built-in list has no effect.
- If there is a user entry with the same written form, the user entry is used even when the form is in `removed`.
- Settings that have `removed` cannot be read by versions that do not know this field (up to 0.5.2). Those versions reject all of `REALTIME_ASR_SETTINGS`, run with the default settings and write the defaults back at startup. If no built-in term is taken out, the field is not saved, so earlier versions can read the same settings (handled like `silence_duration_ms`).
- The settings screen receives the list of built-in terms from `/get/data/builtin_vocabulary` (`{"terms": [string]}`, the list embedded in the app). The list is shown in a fold, and its heading shows only the number of terms in use. It does not show how many terms the user added, changed or took out. Each row shows the written form and the readings in use, without a mark for its kind. The kind shows through the row's position, look and buttons. Terms the user added are at the top of the list and can be deleted with "Remove"; built-in terms with changed readings have a colored row and can be reverted with "Restore"; terms taken out keep their row with a strikethrough and come back with "Put back". An entry that changes the readings of a built-in term is a user entry, but appears on the built-in term's row. When built-in terms are not used, and before the list of built-in terms arrives, only the user's entries are shown. The fields at the top of this list are the only place to add terms.
- Each change saves at once, as the other choices of the captions form do (#1111).

#### Exporting to and importing from a file

Below the dictionary list, the dictionary can be exported to a file and imported from a file (#792). This replaced the field for adding several terms at once and "Copy terms".

- The file is a copy of the dictionary in use. Its format is the same as the data file of built-in terms: one entry per line as `written=reading,reading`, and lines starting with `#` are comments. Built-in terms that were taken out are not written.
- Export (`/run/export_vocabulary`): the UI sends the dictionary shown on the screen (the draft before saving) to the core. The core checks it with the same rules as a saved dictionary (a 400 `realtime_vocabulary_invalid` if it does not pass), writes it to `exports` in the settings folder as `vocabulary-YYYYMMDD-HHMMSS.txt`, and returns the file name. It writes the terms exactly as recognition uses them (`speechcpp::merged_terms`), in the same order. The user's entries (including changed readings of built-in terms) come first, followed by the built-in terms that are not taken out, with their shipped readings. The limit of 150 terms is the same. When built-in terms are not used, only the user's entries are written. Whether built-in terms are used is not written. After the export, "Open the export folder" on the screen (`/run/open_filepath_vocabulary_exports`) opens the folder. Both endpoints have `vocabulary` in their names, so their values are masked in `process.log`.
- Import: the screen reads the file the user chose (up to 256 KB) and replaces the dictionary with the file's content (`importVocabulary` in `src-ui/logics/transcription/vocabularyTerms.ts`). Import is not possible until the list of built-in terms has arrived. Each line is handled as follows.
  - A line identical to a built-in term (same written form and readings): that built-in term is used as shipped. It does not become a user entry, so it follows corrected readings after an app update.
  - A line with a built-in term's written form but different readings: becomes a change to that built-in term's readings (a user entry).
  - Any other line: becomes a user entry.
  - A built-in term with no line in the file: becomes taken out.
  - A user entry that is not in the file: disappears.
- When lines with the same written form (case-insensitive) repeat, the first one is used. Lines that break the rules, repeated lines and lines beyond the limit of 100 user entries are not read, and their count is shown. If a line not read because of the limit has a built-in term's written form, that built-in term is not taken out and is used as shipped.
- A file with no term lines does not empty the dictionary; nothing changes.
- Import does not change the switch for using built-in terms. When they are not used, lines in the file that are identical to built-in terms are not used. Turning the switch on makes the dictionary match the file's content.
- After an import, the screen shows, for the replaced dictionary, the number of terms the user added, of built-in terms with changed readings and of built-in terms taken out, and the number of lines not read. If the dictionary already matches the file, the screen says so and leaves the draft unchanged. An import saves the dictionary at once.
- When a file exported from another version is imported, built-in terms added after that version have no line in the file, so they are taken out. For built-in terms whose readings were corrected, the line with the old readings becomes a reading change.

Changing the dictionary stops running realtime captions (`/set/data/realtime_asr_settings`). TTS, translation and cloud speech recognition use the new dictionary from the next message. The dictionary's values are not written to `process.log` ([Secrets](cross-cutting.md#秘密情報)).

### Direct voice settings (voice conversion)

`engine` in `DIRECT_VOICE_SETTINGS` accepts only `rvc`, and the default is `rvc` too. Seed-VC ran on the Python backend, so it ended together with Python. Sending `engine: "seed-vc"` to `/set/data/direct_voice_settings` saves nothing and returns a 400 `{"error_code": "vc_engine_unavailable", "settings": <saved value>}`. Other invalid values give `vc_settings_invalid` as before. A `seed-vc` saved by an earlier version is changed to `rvc` on load. The other fields (`mode`, the RVC paths, and Seed-VC's `runtime` and `reference`) stay as they are, so the 0.4 versions can still read them. Only when `mode` was `converted`, `/get/data/direct_voice_state` carries `"notice": "seed_vc_moved_to_rvc"` for the rest of that run, and the RVC page shows "Seed-VC is no longer available, so voice conversion now uses RVC". Saving the settings again clears it. Conversion does not start by itself. If no RVC model is set, the RVC switch on the main screen asks for the settings.

The length into which RVC conversion splits the microphone audio is saved in `RVC_BLOCK_MS`, separate from `DIRECT_VOICE_SETTINGS` (#531). The value is an integer in milliseconds: 0 (automatic) or a multiple of 20 from 20 to 200 is accepted, and the default is 0. It is not in `DIRECT_VOICE_SETTINGS` because earlier versions do not read that whole value when it has an unknown field, and would reset even the model and index paths to their defaults. As a top-level key, it is kept by versions that keep unknown keys (#629). Versions before that drop it as an unknown key when they save, but do not change other settings. It is changed in the "Advanced" settings through `/set/data/rvc_block_ms`. The screen offers "Automatic" and 20 to 200 ms. A value that is neither 0 nor a multiple of 20 within range, and a value that cannot be read as an integer, is not saved, and the response is a 400 `VALIDATION_RVC_BLOCK_MS` with the saved value. If `config.json` holds such a value, it goes back to the default of 0 on load. The core reads this value each time conversion starts and passes it to the worker as `--block-ms` (0 becomes `--block-ms auto`). When a length is chosen, the worker returns that length in `block_frames` of `ready`, and if it differs, the start fails with `vc_ready_invalid`. In automatic mode, the worker converts a 40 ms block of test sound on the GPU at the end of loading and measures the time. Of 40, 60, 80, 100, 120, 160 and 200 ms, it picks the shortest length that fits 1.4 times that time, and returns it in `block_frames` of `ready`. If none fits, it uses 200 ms. On the CPU it uses 40 ms. The core converts with that length. The worker records the chosen length in `<state>/vc_runtimes/rvc-block-lengths.json`, and the next start with the same voice model and the same GPU uses that length without measuring again. The key of a record is a hash of the voice model (path, size, modification time), the index when one is used, the device, the GPU name, the ONNX Runtime library and the thread count; the file holds only hashes and lengths. A file that cannot be read is treated as absent, and the length is measured again. When the user chooses "Automatic" in the "Advanced" settings (even when it is already "Automatic"), the core saves 0 through `/set/data/rvc_block_ms` and then places `rvc-block-lengths.remeasure` in the same folder. While this file exists, the next automatic start of the worker measures the GPU again instead of using the recorded length. The worker replaces the record for that voice model and GPU with the new length and deletes the file. Records for other combinations stay (decided on 2026-11-21). To have everything measured again, delete the record file (decided on 2026-11-20, [Lower latency for the voice changer](../voice-stack/rvc-low-latency-2026-11-20.md)). Releases before 0.6.0 do not have this value, so nothing is migrated. A length saved by a development build is also treated as a length the user chose (decided on 2026-11-20). The length of the running conversion is in `conversion_block_ms` of `/get/data/direct_voice_state`, and the latency estimate on the RVC page adds this value. Changing the value does not change a running conversion; it applies from the next start. On the GPU, each block is converted in one pass, so a shorter length means less delay but more blocks that are not converted in time. On the CPU, conversion is done in batches of 0.5 seconds whatever this length is.

### TTS servers

`japanese_server` and `multilingual_server` in `VOICE_SETTINGS` say whether each speech.cpp server is the bundled server (`bundled`) or an external server (`external`). The default for new settings is `bundled` (#566). Before that, the default was `external`, and Japanese connected to the default `japanese_url`, `http://127.0.0.1:8080`.

When saved settings exist and their `VOICE_SETTINGS` lacks one of these fields, that field is set to `external` (the core's `Config::migrate_speech_servers`, Python's `Config._migrateSpeechServers`). This keeps people who used an external server with the earlier default from being moved to the bundled server by an update. Settings without `VOICE_SETTINGS`, or where it is not an object, are handled the same way. The two fields are decided separately, and saved values are not changed. Settings with nothing saved, and files that cannot be read, are treated like a new install and stay `bundled`. No step is recorded ([config.json](#the-configjson-file)).

### Compute devices and compute types

Only translation (CTranslate2) has a choice of compute device and compute type. Speech recognition's `SELECTED_TRANSCRIPTION_COMPUTE_DEVICE` and `SELECTED_TRANSCRIPTION_COMPUTE_TYPE` were removed together with local Whisper, and are not loaded even if an old `config.json` has them.

Translation's `SELECTED_TRANSLATION_COMPUTE_DEVICE` is matched against the current list by `device`, `device_index` and `device_name`. The saved `compute_types` is not used for identification and is updated to the value in the current list. A change in the supported compute types alone does not change the selected GPU.

`SELECTED_TRANSLATION_COMPUTE_TYPE` is checked against the types the saved device currently supports, whatever the key order in the JSON. If the type is supported, a choice such as `float16` is kept. If the device is not found, the default CPU is used, and an unsupported compute type goes back to the default `auto`. A change of compute type while running is checked against the device selected at that moment.

### Network settings

`OSC_PORT`, `WEBSOCKET_PORT` and `OBS_BROWSER_SOURCE_PORT` accept only integers from 1 to 65535, both as saved values and in IPC change requests. Booleans, decimals, strings (including `"80"`), 0, negative numbers, 65536 and above, and null are rejected. If a saved value is invalid, the setting keeps its default (9000, 2231 and 2232 respectively), and the save after loading rewrites it. The UI converts the numeric input of 1 to 65535 to an integer before sending it. Saving an empty field is treated as an invalid value.

If a change request is invalid, it goes no further: the settings are not saved and running services are not stopped, and a 400 is returned with the original value in `data`. The error codes are `VALIDATION_OSC_PORT_INVALID`, `WEBSOCKET_PORT_INVALID` and `OBS_BROWSER_SOURCE_PORT_INVALID` respectively. For WebSocket and OBS, the value is saved only after the service has started on the new port; on failure, the core tries to restore the service on the original port.

`WEBSOCKET_HOST` accepts only IPv4 address strings; `0.0.0.0`, IPv6, host names and anything that is not a string are rejected. An invalid saved value goes back to the default `127.0.0.1`. A change request is rejected with `VALIDATION_INVALID_IP`, and the original host and services stay. OBS uses this host too. An address other than loopback (127.0.0.0/8) needs a readable certificate and private key (`WEBSOCKET_TLS_CERT_FILE`, `WEBSOCKET_TLS_KEY_FILE`). Without them, a change request is rejected with `WEBSOCKET_HOST_NEEDS_TLS`, and a saved value is reset to `127.0.0.1` at startup and reported with `WEBSOCKET_HOST_RESET_WITHOUT_TLS` ([Listening for other PCs](external-interfaces.md#この-pc-の外での待ち受け)).

`WEBSOCKET_TLS_CERT_FILE` and `WEBSOCKET_TLS_KEY_FILE` are path strings of PEM files, empty (not set) by default. `/set/data/websocket_tls` saves the two together, and saves them only when both can be read.

`WEBSOCKET_AUTH_TOKEN` saves a non-empty string. A saved value that is null, an empty string, only whitespace or not a string is not loaded; a new secret generated at startup is saved in the same way as an ordinary default. A valid saved value is not changed. The WebSocket and OBS URLs that the settings screen copies, the OBS HTML and WebSocket authentication all use the same setting value. After a repair, the URLs have to be copied into the external apps again. The setting key name and the IPC endpoint names stay, and nothing moves to another key. The user can regenerate the value with `/run/regenerate_websocket_auth_token`. The new value is made with `secrets.token_urlsafe(32)` and saved, and connections that use the old value are closed at once. The token in the response is masked in the logs.

`LMSTUDIO_URL`, `OLLAMA_URL` (core only), `OPENAI_COMPATIBLE_URL` and `TRANSCRIPTION_CUSTOM_URL` are checked with the same rules when a saved value is loaded and when a change request is received. HTTPS accepts any host. HTTP is limited to `localhost`, 127.0.0.0/8, ::1, 10/8, 172.16/12, 192.168/16, fc00::/7, IPv4 and IPv6 link-local addresses, and mDNS names ending in `.local` (core only). HTTP is never allowed by resolving other LAN host names through DNS. For `localhost` and `.local` names, the address resolved when connecting is checked again against the ranges above, and nothing is sent over HTTP if it is outside them. 100.64.0.0/10 (CGNAT) is not included. User information in the URL, query names that stand for keys, tokens, passwords, credentials, signatures and the like, fragments and invalid ports are rejected.

When connecting over HTTP to a private LAN or link-local address, the settings field shows that text, audio and API keys are not encrypted. Loopback, which communicates within the same PC, does not get this warning. URLs are checked when saved, and every custom URL shows that entering an API key and saving sends the key to the destination for authentication. Nothing is sent while the URL is being typed. A change of the URL alone for OpenAI-compatible and Custom Whisper is rejected with `CREDENTIAL_REENTRY_REQUIRED`, without connecting, when a key is saved. Saving the same URL again succeeds without connecting or changing anything, and when no key is set, only the URL is saved. When the URL and the key are saved together, the destination is checked with the entered combination ([Changing API keys](cross-cutting.md#apiキーの変更)). A change rejected by URL validation returns the existing `CONNECTION_LMSTUDIO_URL_INVALID`, `CONNECTION_OLLAMA_URL_INVALID` (core only), `CONNECTION_OPENAI_COMPATIBLE_URL_INVALID` or `CONNECTION_TRANSCRIPTION_CUSTOM_URL_INVALID`, and keeps the original URL.

An invalid saved URL is set to an empty string to stop connections, and when startup completes, the matching URL error asks the user to set it again. This notice is translated into the UI language at the time it is shown, and the display is updated if the saved language is applied later. To avoid sending a saved key to a different default host, the URL is not reset to its default. The key itself stays. An empty string can be saved as the unset state. Key names, IPC endpoint names and the JSON format do not change.

### Messages

The shape shared by sent messages, microphone and speaker recognition results, and text read by OCR.

```json
{
  "id": "4b1c…",
  "original": {"message": "こんにちは", "transliteration": []},
  "translations": [{"message": "Hello", "transliteration": []}],
  "source": "ocr"
}
```

| Field | Content |
|---|---|
| `id` | A UUID that the UI attaches when the message is sent from the input field. For the microphone and the speaker, the UI attaches it after receiving the message. For OCR, `transcription-ocr-<number>` |
| `original` | The original text and its hiragana and romaji readings (`[{orig, hira?, hepburn?}]`, an empty array when off) |
| `translations` | Translations in the order of the enabled target languages. An empty array when translation is off, or for an empty message |
| `source` | `"ocr"` for OCR only |
| `output_failures` | `[{output, error_code: "MESSAGE_OUTPUT_FAILED"}]` when some outputs raised an exception. The synchronous return value carries the list after all outputs. Usually omitted |
| `delivery_reason` | `"vrchat_off"` only when one of your own messages (input field or microphone) was not sent to the chatbox because "Send message to VRChat" is off. The other outputs still happen. The UI keeps the row's state at `ok` and shows "Not sent to VRChat (off in settings)" instead of "Sent". Not attached to what the other side says (speaker, OCR) |

- From the input field, `{"id", "message"}` is sent to `/run/send_message_box`, and the response carries the shape above. The UI shows the row as "Sending…" before sending, and clears the sending state on the 200 response. It keeps the row's ID and time, and updates the row with the response's `original` and `translations`, readings included. Sending from Quick Chat and the rows mirrored to the VR UI use the same process. On the desktop the waiting icon spins, and in the VR UI static text shows the wait.
- On a communication failure, a 400, 404, 423 or 500 response, or a stop of the backend, the matching sending rows become `status: "failed"`, keep their text and show "Send unconfirmed". They are not resent automatically. If the error response has no ID, all sending rows are affected. If a 200 with the ID arrives after that, that row's state, its original text with readings, and its translations are updated.
- Each output failure is also reported in a separate 400 notification, `/run/message_output_error`. `result.data` is `{id, source, output, error_code}`, with `id` set to `null` for input without one. `source` is one of `chat`, `mic`, `speaker` and `ocr`, and `output` is one of `osc`, `overlay_small`, `overlay_large`, `clipboard`, `ui`, `websocket`, `logger`, `history` and `tts`. The message text and exception details are not included. Some outputs fail after the ordinary notification to the UI, so failure notices from every input source go through this path. The sent row is not marked as failed; a warning is shown for each output.
- The microphone arrives on `/run/transcription_send_mic_message`, the speaker on `/run/transcription_receive_speaker_message`, and OCR on `/run/transcription_ocr_message`.

### Realtime captions and delivery outcomes

Realtime speech recognition is notified with a 200 `/run/realtime_caption`. A row is identified by the combination of `source` (`mic` or `speaker`), `generation`, `namespace` and `item_id`. `revision` is the update number of the same row.

`partial` means recognition in progress and `final` means recognition finalized; neither means that delivery is complete. They carry the recognized text in `text` and an array of translations in `translations`. `translated` updates `original` (with the readings of the original text) and `translations`, but does not release the wait for delivery. `discarded` retires an empty final result, or a caption whose deadline passed before it was shown.

`speakers` is an array of the labels of the people who spoke in that utterance (`["A"]`, `["A", "B"]`). Only speaker `final` and `translated` rows have values, and only when the server has a speaker diarization model. `partial` rows, microphone rows and the case without diarization have an empty array. Labels are 1 to 3 upper-case letters, at most 4 of them, in the order the voices started speaking. A voice that spoke for 0.4 seconds or more is counted; if no voice reaches that, the longest voice alone is included. A label is a symbol that tells voices apart within one session, not a person's name. Labels are assigned again when the session changes. Diarization estimates can be wrong. A row keeps them as `speakers`, and the log shows "Speaker A, B" next to the state display.

#### Speaker names and grouping by speaker

The user can give labels names for each session (#447). The speaker display in the log is a button, and pressing it opens a name field below the row. On save, the UI sends `{"namespace": session, "names": {"A": "name", ...}}` to `/set/data/speaker_names`. `names` is the full set of names for that session; labels not sent and empty names go back to having no name. The core accepts the request only when `namespace` is up to 128 characters of letters, digits, `-` and `_`, labels are 1 to 3 upper-case letters, names are up to 32 characters without control characters (runs of whitespace become one space) and there are at most 8 labels, and then returns `{"namespace": ..., "names": {...}}`. Anything else is a 400 `speaker_names_invalid`.

- Names are not saved. The UI keeps the returned names for the last 8 sessions, and the core keeps them for the last 4 sessions for the SteamVR captions. Labels are assigned again when the session changes, so names from an earlier session are not applied to a new session.
- Names are not written to `process.log` (`speaker_names` is in `SENSITIVE_ENDPOINT_MARKERS`).
- A voice with a name shows that name instead of the label in the log, the log in the VR UI (the synchronized atom `SpeakerNames`), the desktop captions (`speaker_names`) and the SteamVR captions (single line and multiple lines). A voice without a name shows as "Speaker B" when another voice has a name, and as "Speaker A, B" as before when no voice has a name. The color of the desktop captions is decided by the label and does not change when a name is given.
- The large SteamVR log shows the speakers after the received header (the time and "Receive") in the form "Mika·B". Beyond 48 characters it is cut with "…". When a name is given, the captions of that session are redrawn if they are on display.
- The single-line SteamVR caption shows the speakers in the same form on the line above the text. Giving a name does not redraw the caption on display; names appear from the next caption.
- In the log, when rows of the same speaker in the same session follow each other, rows from the second on show only the time and leave out the state and speaker display. Screen readers still read the speaker. Rows in progress and failed rows are not shortened. Names cannot be given in the VR UI (display only).

Each non-empty `final` that was shown gets one outcome notification. Its `revision` is 2 more than that of the `final`. The text and translations are not in this notification; they stay on the same row.

```json
{"status": 200, "endpoint": "/run/realtime_caption", "result": {
  "source": "mic", "generation": 4, "namespace": "session", "item_id": "utterance",
  "revision": 3, "state": "outcome", "outcome": "not_delivered", "reason": "expired"
}}
```

| `outcome` | `reason` | Row state and meaning |
|---|---|---|
| `delivered` | `null` | `status: "ok"`. The applicable output processing finished, or the result was delivered to at least one output before an interruption. "Sent" for the microphone, "Received" for the speaker. It does not mean delivery to every output, confirmation of receipt in VRChat, or the end of TTS playback |
| `delivered` | `vrchat_off` | `status: "ok"`. Microphone rows only. Not sent to the chatbox because "Send message to VRChat" is off. The other outputs happened. Shows "Not sent to VRChat (off in settings)" without the warning color |
| `not_delivered` | `expired`, `revoked`, `superseded`, `filtered` | `status: "not_sent"`. Before any output success was recorded, delivery was skipped because of the 2-second deadline, the invalidation of the delivery generation or session, the ordering control of the chatbox, or the word filter. Kept apart from processing failures |
| `failed` | `processing_failed`, `queue_full` | `status: "failed"`. An exception or a VRAM shortage in the processing itself, or the queue of final results was full. The text stays |

An exception in an output alone keeps `delivered` and uses the existing `MESSAGE_OUTPUT_FAILED` warning. No warning is stacked on the row. When OSC, WebSocket, the clipboard, the message log or the acceptance by TTS succeeds, the success is recorded before waiting on the next output. If a deadline, an invalidation or a processing failure happens after that, the row is still `delivered`. A row whose OSC was skipped by the ordering control but that was delivered to another output is treated the same way. Outputs already done are not undone, and nothing is resent automatically.

A row whose recognition is finalized starts as `status: "pending"`. On the desktop, microphone rows show "Sending…" with the waiting icon, and speaker rows show "Processing…". The VR UI mirrors the same row and shows the wait with text, without animating the waiting icon. A microphone row whose processing failed shows the existing "Send unconfirmed", and a speaker row shows "Processing failed". A microphone row whose sending was skipped shows the reason, and a speaker row shows "Processing cancelled".

Results whose deadline passed in the queue, and results that could not go on to processing because of a stop, mute or exit, also get an outcome notification if they were shown. The reading worker checks the deadline and the delivery generation on its existing wait cycle, so a row can be settled without waiting for translation to finish. But if no output has succeeded yet and the first output is running, settling waits until that output reports success or failure. This wait does not block a stop request and does not allow the remaining outputs. Final results that were not shown get no notification. Even after a stop or the start of a new session, only final rows with the same ID that remain in the UI are updated. Unknown, deleted and in-progress rows are not affected, and a result once settled is not changed by later notifications.

If the connection to the sidecar ends before the result arrives, the UI marks unsettled rows as `failed`. Only in this case is this a state where delivery cannot be confirmed, not an outcome notification from the backend. In-progress rows are removed, and results already received are not changed. A send error from the input field never changes realtime rows.

### Messages sent to WebSocket and OBS

```json
{"type": "SENT",
 "src_languages": {"1": {"language": "Japanese", "country": "Japan", "enable": true}},
 "dst_languages": {"1": {"language": "English", "country": "United States", "enable": true}, …},
 "message": "こんにちは", "translation": ["Hello"], "transliteration": […]}
```

`src_languages` and `dst_languages` are the language pairs of the tab, fixed when the message was accepted, and `translation` is the array of translations. `type` is one of `SENT` (microphone), `RECEIVED` (speaker and OCR), `CHAT` (input field), `REALTIME_MIC` and `REALTIME_SPEAKER`. When the display settings change, `{"type": "SETTINGS_UPDATED", "settings": {…}}` is sent ([External interfaces](external-interfaces.md#websocketサーバー)).

### Chat reading regions

`OCR_CAPTURE_REGION` is for desktop windows, and `OCR_VR_CAPTURE_REGION` for the left-eye side of the SteamVR headset view on Windows; both are saved in `config.json`. Each region is given as fractions of its screen's width and height.

```json
{
  "OCR_CAPTURE_REGION": {"x": 0.6, "y": 0.1, "width": 0.2, "height": 0.2},
  "OCR_VR_CAPTURE_REGION": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
}
```

`x` and `y` are the top left corner, and `width` and `height` are the width and height. The values must be finite numbers that fit inside the screen, and the width and height must each be at least 0.02. Both defaults are the whole screen. The IPC setters round to 4 decimal places and apply the same checks; an invalid region is neither saved nor queued for saving, and a 400 is returned.

The single region of older versions is carried over as the window region in `OCR_CAPTURE_REGION`, without renaming the key. A saved file without `OCR_VR_CAPTURE_REGION` gets the whole-screen region, which the save after loading writes. An existing VR value is kept. An invalid value goes back to the default for that key, and one region is never copied to the other. Linux also saves both, but does not apply the VR region and shows no field for editing it on the settings page.

`/get/data/ocr_capture_region` and `/set/data/ocr_capture_region` still handle the window rectangle. The VR region uses `/get/data/ocr_vr_capture_region` and `/set/data/ocr_vr_capture_region` with the same shape.

`/get/data/ocr_capture_status` returns the following state in one 200 response. `active` says whether there is a worker that has been enabled and has not stopped. `source` is the source of the latest capture result, and `null` when there is no image and while stopped. On Linux, `available_sources` is `["window"]`. `shared_window` gives how a window the user shared on Linux is handled: `"active"` while a shared window is being read, `"ended"` while the share that was being read has ended and no window can be found by name, and `null` otherwise and while stopped. While a shared window is being read, `source` stays `"window"`.

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

`state` is one of `stopped`, `waiting`, `reading` and `retrying`. `stage` is `activation`, `capture`, `detector`, `recognition`, `tick` or `null`, and gives the stage that is waiting or failed. `error_code` is the existing `OCR_DISABLED_*` code on failure, and `null` otherwise. `detector` is the detector the worker actually adopted: `region` for region reading, and `vrct-vox-chatbox` for the custom detector. It is kept separate from whether the detector has been downloaded and from the setting for using it. While stopped, `active` is `false`, and `source`, `stage`, `error_code` and `detector` are all `null`.

Only while the settings page is open, the UI queries this endpoint once every second and shows the capture source and the running state in the same field. This query only looks at the worker's state; it does not check devices, capture images or load models. Normal responses are not written to the diagnostic log, and the state itself is not saved.

### Other data

| Data | Shape |
|---|---|
| Word filter | An array of strings. Duplicates are removed, keeping the order. On a match, `{"message": "Detected by word filter: …"}` goes to `/run/word_filter` |
| Hotkeys | Each value of `{open_quick_chat, toggle_vrct_visibility, toggle_translation, toggle_transcription_send, toggle_transcription_receive, stop_voice, toggle_voice_mute, toggle_tts, toggle_rvc}` is an array of keys such as `["Ctrl","Shift","Q"]`, or `null`. An unknown key makes the whole value rejected |
| Experimental features (`EXPERIMENTAL_FEATURES`) | `{feature ID: boolean}`. Holds every feature in the list, all `false` by default. Features not in a request keep their current values. IDs not in the list are dropped (so a saved value for a feature that graduated or was removed can still be loaded). A value that is not a boolean makes the whole value rejected. The feature list is in two places, `src-ui/logics/configs/experimentalFeatures.ts` and `native/core/src/config/schema.rs` (up to 0.5 it was also in Python's [`src-python/models/experimental_features.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/experimental_features.py)). The only current feature is `tray_companion` ([hexagram overlay](cross-cutting.md#六芒星のオーバーレイtray_companion)) |
| Edge where the hexagram overlay hides the hexagram (`TRAY_COMPANION_EDGE`) | One of `right`, `left`, `top` and `bottom`. The default is `right`. The value is kept while the experimental hexagram overlay is off. Other values are rejected ([hexagram overlay](cross-cutting.md#六芒星のオーバーレイtray_companion)) |
| Monitor where the hexagram overlay shows the hexagram (`TRAY_COMPANION_MONITOR`) | The name the system gave the monitor. Empty means the main monitor (default). Up to 256 characters; control characters are rejected. The value is kept even while the chosen monitor is disconnected, and the main monitor is used meanwhile ([hexagram overlay](cross-cutting.md#六芒星のオーバーレイtray_companion)) |
| Whether the hexagram overlay has told the user that the wheel turns it (`TRAY_COMPANION_WHEEL_HINT_SHOWN`) | Boolean. The default is `false`. The hint appears the first time the hexagram comes out, and the value becomes `true`. While it is `true`, the hint does not appear ([hexagram overlay](cross-cutting.md#六芒星のオーバーレイtray_companion), #536) |
| Usage (`USAGE_PRESETS`) | An array of one or more of `basic`, `nonverbal`, `multilingual`, `voice_changer` and `all`, saved in this order without duplicates. Unknown IDs (added in later versions) are removed, and the value is rejected if no known ID is left. It is saved at once. The default for a new install is `["basic"]`, and for an update from an earlier version (saved settings exist without this key) it is `["all"]`. It only narrows the features shown and does not change other settings ([usage presets](cross-cutting.md#用途別プリセット)) |
| Download consents up to 0.4 (`LEGACY_MODEL_DOWNLOAD_CONSENTS`) | A dictionary from model ID to string, `{}` by default. The Python backend up to 0.4 recorded it when the user agreed to download a CTranslate2 translation model. CTranslate2 downloads left the core in 0.5.0, and their confirmation screen left the UI in #1015. The core only reads this key and writes it back as a dictionary whose values are all strings; it neither computes nor records values (`native/core/src/config/schema.rs`). Local translation models are downloaded with the same confirmation and consent as other models ([Model downloads](../voice-stack/model-downloads.md)) |
| Weight download state | The list is {type: downloaded or not}. The acceptance is {weight_type, job_id}. Progress is {weight_type, job_id, progress}, and the success notification is {weight_type, job_id, downloaded: true}. The failure notification puts {weight_type, job_id, downloaded: false, reason} in the data of the error body. When a duplicate request for the same weight in progress is rejected, active_job_id is added too |
| Engine state | `{engine name: usable}`. The list of usable engines is returned as an array by `selectable_*_engines` |
| Errors | [IPC protocol](ipc-protocol.md#エラーの本体) |

## The config.json file

- The location is `$ASTAROT_CONFIG_DIR` (`$VRCT_CONFIG_DIR` is also read during 0.6.x), and otherwise the folder of the executable (during development, `src-tauri/target/debug/` and the like; `src-python/` for the Python backend up to 0.4). For the Linux release builds from 0.6.0, it is `$XDG_CONFIG_HOME/astarot` (or `~/.config/astarot` when that is not set). The `vrct-vox` folder used up to 0.5.x is moved at the very start of startup ([Moving the storage folders on Linux](#moving-the-storage-folders-on-linux)). For the Windows installer build, a folder in the default install location of 0.5.0 and earlier, `%LOCALAPPDATA%\VRCT-VOX`, is moved to `%LOCALAPPDATA%\ASTAROT` by the installer from 0.7.0 ([Moving the install folder on Windows](#moving-the-install-folder-on-windows)). The folder name is a storage identifier, so changing it needs a migration (`docs/voice-stack/project-rename.md`).
- Settings are declared in `keys()` of the core's `native/core/src/config/schema.rs`, and their defaults are in `defaults()` (copied from `ManagedProperty` and `ValidatedProperty` of the Python `Config` class up to 0.4). Only entries whose `serialize` is true are saved. On/off states (`ENABLE_*`) and lists of choices are not saved.
- Simple setting properties do not accept `null`, except model names and the speech recognition engine, where it means no selection. Unset `null` values inside the API key and hotkey dictionaries are kept. Numeric properties and the numeric overlay settings reject `NaN` and infinity (including overflow such as `1e999`) before saving. An invalid saved value goes back to the default. Changes to the message box ratio and to the small and large caption settings return a 400 `VALIDATION_CONFIG_VALUE_INVALID`, with the kept setting value in `data`.
- On load, each key is validated before it is set. Unknown keys are not used, but their values are written back as they were in the file, after the saved settings. This is so that a setting from a newer version stays when an older version opens and saves the file and the newer version opens it again (#560). Only keys that an earlier version saved and the current version has retired (`RETIRED_KEYS` in `native/core/src/config/mod.rs`; the 5 keys removed together with local Whisper in #288) are dropped. When retiring a key, add it to this list too. A key that fails validation keeps its default and is recorded in error.log. A value saved by a version newer than this one is the exception: even if it fails validation (such as a choice added in the newer version), it is not used and is written back to the file as it is, and a new value is written only when the user changes that setting in this version (#560). Which version saved the file is told by `NEWEST_SAVING_VERSION`, written to the file (the newest of the versions that saved it; saving with an older version does not lower it). It is not a setting key, so it is not in the list. Invalid values saved by the same or an older version, and invalid values in a file without this mark, are not saved, as before. The microphone and speaker selections (`SELECTED_MIC_HOST`, `SELECTED_MIC_DEVICE`, `SELECTED_SPEAKER_DEVICE`) are different: the saved value is taken as it is, because the device list is not available yet at load time. Once the list is available, the sidecar checks whether the device exists, and falls back to the default device if it does not. When the file cannot be read as JSON or is not an object, it is moved to a unique name, `config.json.unreadable-<date and time>-<random>`, and kept, and the app starts with the defaults. The UI receives `/run/config_file_unreadable` and tells the user that the app started with the defaults and where the kept file is.
- The log directory is created after all initial values in memory are ready. Even if the log directory cannot be created, the settings initialization completes. If any other part of initialization fails midway, the incomplete instance is not published, and settings are neither loaded nor saved. Nothing is saved during loading; the file is saved once, after all fields are applied and migrated. But if the content to write is the same as the file, it is not written (the key order is not compared; on Unix, a file that others than the owner can read is rewritten). The Python version wrote the file at every startup (#560). When read permission is missing or moving the file aside fails, the original file stays, a [save failure notice](cross-cutting.md#サイドカーでの保存) is sent, and further saves stop.
- There is no version number. Up to 0.5, the step of the local speech recognition migration was recorded in `LOCAL_ASR_MIGRATION` and used. 0.6.0 does not migrate, and only writes `2` for versions 0.5 and earlier ([Local speech recognition migration](#local-speech-recognition-migration)). Usage (`USAGE_PRESETS`) records no step. If saved settings exist without this key, the app treats it as an update from an earlier version and sets `["all"]`. A file that cannot be read is treated as if nothing had been saved, so it gets `["basic"]`, as a new install does. The TTS servers (`japanese_server` and `multilingual_server` in `VOICE_SETTINGS`) follow the same idea: a field missing from saved settings gets `external`, the earlier versions' default ([TTS servers](#tts-servers)). Up to 0.5, the content before a migration was kept in `config.json.before-migration-<step>` ([What is kept on failure](failure-recovery.md#設定)). Of the nested settings, `SPEECH_SERVER_SETTINGS` and `REALTIME_ASR_SETTINGS` have `"version": 1`.
- `ui_scaling` in `OVERLAY_VR_LAUNCHER_SETTINGS` is the width (m) as if the launcher strip were 952 px wide. Its meaning does not change now that the strip is 880 px wide. There is no version number to tell whether it has been migrated, so the saved value is not rewritten; the actual width is the value times 880/952. With the saved value unchanged, the size of the buttons stays the same.
- When a saved language or translation engine dictionary is broken, missing or invalid tabs and slots are filled with defaults, and the valid parts are loaded. Extra keys are dropped. This is different from the structure validation for updates while running, and a broken dictionary does not block startup.
- Writing follows [cross-cutting behavior](cross-cutting.md#サイドカーでの保存): a 2-second delay, a temporary file with mode 0600, `fsync`, then replacement.
- Some values are corrected at every startup. `SELECTED_RELEASE_CHANNEL` is decided again from the version unless the user chose one (`RELEASE_CHANNEL_CHOSEN` is `false`). A chosen value stays (#466, [Updates](external-interfaces.md)). If `installer_language.txt` placed by the installer exists, it becomes the UI language and the file is deleted. The WebSocket token is created and saved on first use and when an invalid saved value is repaired ([Network settings](#network-settings)).

### Moving the storage folders on Linux

From 0.6.0, the Linux release builds move the settings folder and the data folder from `vrct-vox` to `astarot` (section 2.4 of ADR-014). At the very start of startup, before reading anything inside them, the app decides each of the two folders once (`settle` in `native/core/src/storage/linux.rs`, called by `settle_folders` in `src-tauri/src/backend_host.rs`). For the rest of that run, every reader gets the same folder.

- A folder given by an environment variable (`ASTAROT_CONFIG_DIR`, `ASTAROT_DATA_DIR` and the old names) is used as it is. It is not moved.
- When only the old folder exists: it is moved by renaming it to the new name. The parent folder is the same, so even large models move at once without copying. A symbolic link to the new folder (with the target `astarot`) is placed at the old name. After going back to 0.5.x, and from scripts that use the old path, the same files can still be read. Then absolute paths in the saved files that point under the old folder are rewritten (`relocate_saved_paths` in `native/core/src/storage/mod.rs`).
- When neither exists: the new folder is created.
- When the new folder has the app's record: the new folder is used, and whatever has the old name is left alone. An old folder that 0.5.x created again is not used either. If the link was deleted and nothing has the old name, the link is placed again.
- When a new folder without a record and an old folder both exist: the new folder cannot be confirmed as one the app created, so it is not used, and nothing is written to it. The old folder is used. When only the new folder exists, it is used and the record is placed in it.
- When the move is not possible (another ASTAROT or VRCT-VOX is running, the session bus cannot be queried, a different file system, no permission, and so on): the old folder is used as it is, and the next startup tries again. Whether an app is running is decided by whether the single-instance names of the old and the new app ID (`<app ID>.SingleInstance`) are in use on the session bus. The query is made before the app takes its own single-instance name.

The rewrite covers `config.json`, `user_models.json` and `translation_catalog.json` in the settings folder. Only JSON string values that are the moved folder itself, or that point under it after a separator, are changed (`/a/vrct-vox-old` is not under `/a/vrct-vox`). Paths outside the storage folders (such as models the user placed elsewhere) and key names are not changed. Paths that reach the folder through a parent folder written another way (such as when `/home` is a link to `/var/home`) are handled the same way. When the old folder itself was a link, only the link moves, and the path it points to is not changed. The content of `config.json` before the rewrite is kept in `config.json.before-migration-storage` (without the API keys; if that file already exists, it is kept). If the copy cannot be written, `config.json` is not rewritten. Paths that were not rewritten can still be read through the link at the old name.

Each folder with the new name gets a `storage_migration.json` (`{"version": 1, "state": state, "from": old folder}`). The state is `created` (newly created), `moving` (being moved) or `done` (finished moving). When moving, a `moving` record is written to the old folder before the rename and moves along with the files. After a startup that stopped midway, the next startup finds the `moving` record, finishes the link and the rewrite, and sets it to `done`. If the rewrite fails, the record stays `moving`, and the next startup tries again. If the rename fails, the record written to the old folder is deleted.

The result is written to `startup.log` as one line, `Storage folders: settings=<result> data=<result>`, where each result is one of `given`, `created`, `moved`, `finished`, `in_place` and `kept_old:<reason>`. The reason is one of `app_running`, `instance_check_unavailable`, `new_folder_not_ours`, `cross_device`, `permission_denied`, `busy`, `new_folder_appeared`, `rename_failed`, `record_failed` and `path_not_utf8`. A startup that rewrote paths adds ` paths=rewritten` (`unchanged` if nothing needed changing, `failed` on failure), and if a link could not be placed, ` settings_link=failed` or ` data_link=failed` is added. Paths, setting values and API keys are not written.

Development builds on Windows and Linux keep using the executable's folder, as before, and do not move it.

### Moving the install folder on Windows

From 0.7.0, the Windows installer moves the default install folder of 0.5.0 and earlier, `%LOCALAPPDATA%\VRCT-VOX`, to `%LOCALAPPDATA%\ASTAROT`, and moves the registry keys from the `VRCT-VOX` name to the `ASTAROT` name (section 2.5 of ADR-014). On Windows, the settings, logs and models are in the install folder, so moving the install folder moves the user's data with it. It works the same when run interactively and when run with `/P /UPDATE` from the in-app update (`src-tauri/nsis/template.nsi`).

- The previous install folder is read from `HKCU\Software\kein5\ASTAROT`, or if that is absent, from `HKCU\Software\kein5\VRCT-VOX` of 0.6.x and earlier. For the entry in the apps list too, `Uninstall\VRCT-VOX` is read when `Uninstall\ASTAROT` is absent. `Installer Language` in the old key is copied when the new key does not have it.
- The folder is moved only when the previous install folder is `%LOCALAPPDATA%\VRCT-VOX`. Differences in case, a trailing `\` and 8.3 short names count as the same folder. Other locations the user chose are not moved, even if they are named `VRCT-VOX`. Installs made new from 0.5.1 on are already in `%LOCALAPPDATA%\ASTAROT`, so only the keys move. The installer shows the destination of the move on its install folder page. If another folder is chosen there, or a folder is given with `/D=`, nothing is moved and the app is installed into that folder.
- The update itself happens in the original location, as before. Before it, the installer stops the main executable and helper programs running from the install folder (`vrct-vox.exe`, `astarot.exe`, `vrct-rvc-worker.exe`, `astarot-rvc-worker.exe`, the sidecar up to 0.4) and cleans up the working folder of the previous update (`.upd`). The speech.cpp servers (`speech.exe`, `llama-server.exe`) are not stopped by name, because other programs use the same names. The app puts them in a job object, so they end when the app ends.
- Once all the new files are in place, the folder is moved by renaming it. This is only a rename within the same drive; nothing is copied and then deleted. If a folder that is not empty exists at the destination, or the rename fails (such as when another program has a file open; the installer tries 10 times, every 0.5 seconds), the installer finishes in the original location without moving. The next update tries again. An empty folder at the destination is replaced.
- Before the rename, `installer_moved_from.txt` is placed in the folder being moved. It contains the old folder's path, written in UTF-16 with a byte order mark. The file moves with the folder. If the rename fails, it is deleted.
- After the move, the installer repoints the desktop and Start menu shortcuts that remain to the new location. Shortcuts the user deleted are not created again. Items pinned to the taskbar or Start are not changed (a program cannot pin them again).
- Then the new keys (the install folder, and `Uninstall\ASTAROT` in the apps list) are written, and only after that are the old keys (`Software\kein5\VRCT-VOX` and `Uninstall\VRCT-VOX`) deleted. Only one entry remains in the apps list. When the old key points to another folder that still has an uninstaller, it is kept as the key of another install. When nothing was moved, the keys still record the original location under the new name.
- No link or junction is placed at the old location. This keeps deletion routines that do not expect a link, such as the uninstallers of old versions, from touching the data at the link's target.
- If the process stops after the rename but before the keys are written, the old key remains, pointing to the old location. The next update sees that the old location is gone and that there is an install in the new location, takes this as an unfinished move, and fixes the shortcuts and the keys.
- The uninstaller deletes the new key, and also the old key if it points to this install. It also deletes `installer_moved_from.txt`.

At the very start of the next startup, before reading `config.json`, the app reads `installer_moved_from.txt` (`take_installer_move` in `native/core/src/storage/installer.rs`, called by `settle_folders` in `src-tauri/src/backend_host.rs`). It rewrites paths in the files of the settings folder that point under the old folder to the same place under the executable's folder, and then deletes the file. The files it rewrites and the `config.json.before-migration-storage` copy are the same as in [Moving the storage folders on Linux](#moving-the-storage-folders-on-linux). On Windows, paths are compared without regard to case, and `\` and `/` count as the same separator. When the old folder was in the same parent folder as the executable's folder, paths that reach that parent folder written another way are rewritten too.

- If the rewrite fails, the file stays and the next startup tries again.
- If the file's content is not a single absolute path (empty, unreadable as text, several lines and so on), or if it points to the executable's folder itself, nothing is changed and the file is deleted.
- The result is written to `startup.log` as one line, `Storage folders: installer_move=<result>`. The result is one of `rewritten`, `unchanged`, `ignored` and `failed`. If the file could not be deleted, ` installer_move_file=kept` is added. Paths and setting values are not written.

The ZIP build runs where it was extracted, so it is not moved.

### Name of the main executable

From 0.7.0, the main executable is `astarot.exe` on Windows and `astarot` on Linux. Up to 0.6.x it was `vrct-vox.exe` and `vrct-vox` (sections 2.5 and 2.6 of ADR-014). The storage location does not depend on the executable's name (the executable's folder on Windows, the XDG folders above for the Linux release builds), so settings and models are read as before after the name changes.

The Windows installer (`src-tauri/nsis/template.nsi`) works as follows, both when run interactively and when run with `/P /UPDATE /R` from the in-app update.

- It looks for a running main executable under both the new and the old name. When run interactively, it asks whether it may close the app under either name before stopping it.
- It accepts a main executable of either name in the downloaded package (when installing another version with `/VERSION`). The installed name is used for the apps list (`MainBinaryName` and `DisplayIcon`), the shortcuts, the restart with `/R` and the launch from the finish page.
- After the replacement, if a main executable with the other name remains, the installer repoints the remaining shortcuts it created (desktop and Start menu) to the installed executable. Then it deletes the executable with the other name. If that fails, the next update repoints and deletes again. Shortcuts the user deleted are not created again. Shortcuts the user made under another name, and items pinned to the taskbar or Start, are not changed.
- An update that keeps the same name does not touch the shortcuts.
- The uninstaller deletes the main executable under both names.

The ZIP build runs where it was extracted. Extracting it over an earlier version leaves `vrct-vox.exe` behind, and the user deletes it.

On Linux, the deb and rpm packages install `/opt/astarot/astarot` and place the command `/usr/bin/astarot`. The command `/usr/bin/vrct-vox` of 0.6.x and earlier also starts the same executable ([Linux package names](#linux-package-names) below). The executable inside the AppImage is `usr/bin/astarot`. The package's desktop file, and the desktop file the app writes for the Wayland portal (`io.github.kein5.astarot.desktop` in the table below), set `StartupWMClass` to `astarot`, because the window class comes from the executable's name. `Exec` in the package's desktop file is also `astarot`.

### Linux package names

From 0.7.0, the Linux package name and install location are `astarot`. Up to 0.6.x they were `vrct-vox` (section 2.7 of ADR-014). Settings and models are in the XDG folders, not in the package's location, so they are read as before after the package name changes.

| Item | From 0.7.0 | Up to 0.6.x |
|---|---|---|
| deb and rpm package name | `astarot` | `vrct-vox` |
| deb and rpm install location | `/opt/astarot` (the `package-manager` mark is here too) | `/opt/vrct-vox` |
| Command | `/usr/bin/astarot`. During 0.7.x, `/usr/bin/vrct-vox` is placed too | `/usr/bin/vrct-vox` |
| Desktop file and icon | `astarot.desktop`, `astarot.png` | `vrct-vox.desktop`, `vrct-vox.png` |
| Bundled files inside the AppImage | `usr/lib/astarot/_internal` | `usr/lib/vrct-vox/_internal` |
| Folder extracted from the tar.gz | `ASTAROT` | `VRCT-VOX` |

- The new package replaces the old one. The deb conflicts with `vrct-vox` (`Conflicts`), replaces it (`Replaces`) and provides it (`Provides`). The rpm obsoletes `vrct-vox` (`Obsoletes`, for versions before the new one) and provides it (`Provides`). Installing the new file with `apt install` or `dnf install` removes the old package, and only one ASTAROT appears in the apps list.
- `/usr/bin/vrct-vox` is removed in 0.8.0 (`LEGACY_COMMAND_UNTIL` in `tools/linux_packages.py`).
- The app looks for its bundled files in `_internal` next to the executable and in `usr/lib/astarot/_internal` of the AppImage (`native/core/src/resources.rs`). Every version carries its own bundled files, so the location with the old name is not searched.
- The kind of update is decided by `package-manager` next to the executable ([External interfaces](external-interfaces.md#アプリの更新)). A change of install location does not change that decision.

### Renaming the Linux audio routes

From the version after 0.6.0, the managed route on Linux (the virtual microphone) is created under ASTAROT's names (section 2.8 of ADR-014). The names are defined in `audio_route` of `native/app-identity`, each paired with its old name.

| Item | Up to 0.6.0 | New name |
|---|---|---|
| Nodes | `vrct.managed.source` and others | `astarot.managed.source` and others |
| Node description (shown in VRChat's microphone list) | `VRCT Managed Virtual Microphone` and others | `ASTAROT Managed Virtual Microphone` and others |
| Node mark and owner | `vrct.managed.route`, `vrct.managed.owner`=`vrct-vox-service-v1` | `astarot.managed.route`, `astarot.managed.owner`=`astarot-service-v1` |
| systemd user units | `vrct-managed-{source,tts,vc}.service` | `astarot-managed-{source,tts,vc}.service` |
| Configuration placed by hand | `90-vrct-managed.conf` | `90-astarot-managed.conf` |
| Temporary streams | `vrct.source-bridge.*`, `vrct.asr.capture.*`, `vrct.tts` and others | `astarot.source-bridge.*`, `astarot.asr.capture.*`, `astarot.tts` and others |

Each time the core prepares the managed route (when the route is saved, at a startup with a saved route, and when the route's nodes can no longer be found), it migrates as follows. If the user has not chosen the route, the old route is not touched.

- Units with the old names are stopped, disabled and deleted only when their names, owner identifier and content all match what the core up to 0.6.0 wrote, and systemd reads the files without drop-ins. The content is compared byte by byte, except for the `pw-loopback` path in `ExecStart`. If even one unit does not match, all three are kept as the user's. If the new route does not exist yet, `managed_setup_conflict` is returned and the new route is not created. This avoids two virtual microphones side by side.
- `managed_setup_conflict` is also returned when there are nodes with the old names that lack the core's owner identifier (old routes made by hand).
- Configuration placed by hand is looked for under both the new and the old names in `$XDG_CONFIG_HOME/pipewire/pipewire.conf.d` and `/etc/pipewire/pipewire.conf.d`. If it is found while the route does not exist yet, the route is not created automatically. With the new name, `managed_setup_manual_config_pending` is returned, and with the old name, `managed_setup_manual_config_legacy`.
- After the old units are deleted, the route is created again under the new names. The new virtual microphone starts muted as before, and makes no sound until the user presses "Unmute".
- Even when the new route is already running, the core's old units are stopped and deleted if they remain (such as after going back to 0.6.0 and then returning).
- Nodes with the old name prefixes (`vrct.managed.`, `vrct.source-bridge.`, `vrct.asr.capture.`) and the old marks are excluded from the input, monitor and speech recognition candidates, the same as the new names.

When it has stopped the old units, the core sets `MANAGED_ROUTE_RENAME_NOTICE_PENDING` (boolean, default `false`, saved) to true and writes one line, `[voice] the managed route retired its legacy units`, to `process.log`. While it is true, the response of `/get/data/voice_route` carries `"notice": "managed_route_renamed"`, and the audio route section shows a hint to choose the microphone again in VRChat. When the user closes the hint, the UI sends `/set/disable/managed_route_rename_notice` and the value becomes false. The response is the audio route state without the hint. Even if preparing the new route fails, the hint stays once the old units have been stopped.

Reading the old names (excluding nodes and streams with the old prefixes from the candidates, finding configuration placed by hand under the old names, and reporting old routes that are not the core's) happens while `audio_route::READS_LEGACY_NAMES` is true, which is during the release series that introduced the new names (during 0.7.x if they ship in 0.7.0). Cleaning up the old units (stopping and deleting only units that exactly match what the core up to 0.6.0 wrote) is switched by `audio_route::RETIRES_LEGACY_UNITS` and has no end date. This is so that no old virtual microphone remains even on systems that skipped versions when updating. Both were decided on 2026-11-23 and are in the note to section 2.11 of ADR-014.

### Where API keys are stored

API keys are not written to `config.json` (from 0.5.0). They are now stored in the OS credential store (Issue #575) ([ADR-013](../adr/adr-013-secret-store.md)): Credential Manager on Windows, and Secret Service (GNOME Keyring, KWallet and others) on Linux. The values of `AUTH_KEYS` (translation) and `TRANSCRIPTION_AUTH_KEYS` (speech recognition), and `PAPAGO_CLIENT_ID`, are stored one entry each. An entry's name joins the dictionary name and the provider name, such as `AUTH_KEYS/DeepL_API`. A provider added to either dictionary is handled the same way. When adding a new setting that holds a key, add its name to `SECRET_SETTINGS` in `native/core/src/config/secrets.rs`.

- The settings in memory are as before, and `/get/data/*_auth_key` returns the same values. The list in `/run/initialization_complete` also carries the same values.
- Each settings folder gets a 16-digit hexadecimal ID, kept in `store_id` of `secrets.json`. Entries in the OS store are separated by this ID, so settings separated with `VRCT_CONFIG_DIR` do not share keys. The ID is created when the first key is saved. Until there is an ID, the OS store is not queried.
- On Windows, entries are generic credentials named `ASTAROT/<ID>/<entry name>` (`VRCT-VOX/<ID>/<entry name>` in 0.6.0), with the persistence `CRED_PERSIST_LOCAL_MACHINE` (not carried by roaming profiles). The value is the key in UTF-8, up to 2,560 bytes.
- On Linux, entries are placed in the default collection and found by the attributes `application=astarot`, `astarot-store=<ID>` and `entry=<entry name>`. The label is `ASTAROT <entry name>`. In 0.6.0 they were `application=vrct-vox` and `vrct-vox-store=<ID>`, with the label `VRCT-VOX <entry name>`. When there is no default collection, none is created (creating one would prompt the user).
- Entries with the 0.6.0 names (section 2.9 of ADR-014): when there is no entry under the new name, the 0.6.0 name is searched, before `secrets.json` is read. A key found there is used as it is, and at startup it is written under the new name and read back (the same steps as the migration from `secrets.json`; a failure is reported as `migrate`). The entries with the 0.6.0 names are kept, not deleted, so going back to 0.6.0 reads the same keys. When a key changes, only the entry under the new name is rewritten; when a key is deleted, the entry with the 0.6.0 name is deleted too. The 0.6.0 names are searched during 0.6.x (section 2.11 of ADR-014). The version that stops searching them, and the version that deletes the entries with the 0.6.0 names, are decided in the 0.7.0 plan.
- The app does not show a dialog to unlock the keyring. A locked store is treated as `locked`, and a missing store, a missing session bus or no response within 5 seconds as `unavailable`; both are temporary failures, and neither `secrets.json` nor the OS store is touched.
- `secrets.json` is `{"version": 1, "protection": …, "entries": …, "store_id": …}`. It may hold keys that 0.5.x saved, and is read as a source for migration. On Windows, the key list is wrapped with DPAPI (only the user who encrypted it can decrypt it), encoded in Base64 and put in `entries` (`"protection": "dpapi"`). On Linux, the list goes in as it is, and the file's permissions are 0600 (`"protection": "none"`). The current version writes no new keys to this file. Writing follows `config.json`: a new temporary file, `fsync`, then replacement.
- Migration: at startup, keys that are only in `secrets.json` are used as they are, and written one by one to the OS store and read back. Only the keys whose same value can be read back are removed from `secrets.json`. If `config.json` has keys (written by Python up to 0.4 or by an earlier core), they move to the OS store in the same way, are removed from `config.json`, and the file is rewritten. If the process stops midway, each key remains in one of the places, and the next startup continues the move. When a key is in both, the OS store's value is used, and the copy in `secrets.json` is removed only when the values are the same.
- A key that could not be read from the OS store is taken from `secrets.json` if it is still there. Otherwise it is treated as empty for that run, and the content of the stores is not touched. Reading is not retried during that run; it happens at the next startup.
- When the store cannot be written to, read back or deleted from, the key stays in memory so that it can be used for that run, and a 400 `SECRET_STORE_FAILED` is sent to `/run/secret_store_failed`. `data` is `{operation, entries, reason, store}`: `operation` is one of `migrate`, `write`, `delete` and `read`; `entries` holds entry names (not key values); `reason` is one of `unreadable`, `write_failed`, `unavailable` and `locked`; and `store` is `credential_manager` or `secret_service`. A key that could not be moved stays in its original place (`config.json` or `secrets.json`). The core tries again on the next save and every 30 seconds, and removes the key from its original place once it has moved. A failure of the same entry is reported only once until it is fixed. The on-screen notice says, for `migrate`, that the key can still be used from its original place, and for `unavailable` and `locked`, to start the keyring, unlock it and restart.
- Even when the OS store cannot be used, a new or changed key is never written in plain text to `secrets.json`. It can be used only for that run.
- A request to delete a key (`/delete/data/*_auth_key` and others) removes the copy in `secrets.json` first, and then removes the key from the OS store. Even if the OS store does not respond, no plain-text copy remains.
- A `secrets.json` that reads as JSON but whose entries cannot be decrypted (such as DPAPI data of another user) keeps its `store_id`; the next time a key is saved, the file is moved to `secrets.json.unreadable-<date and time>-<random>`, and a new file that carries over the ID is created. A `secrets.json` that cannot be read as JSON is also moved to the same kind of name when a key is saved, and the new file gets a new ID. In both cases the original file is not deleted. A file that is temporarily unreadable is not touched, and the write becomes a temporary failure.
- Keys of the API entries that the user added on the speech recognition page (#414) are handled the same way and kept in the same store. The entry name is `TRANSCRIPTION_CATALOG/<entry ID>`, and when the store is temporarily unreadable, a 409 `transcription_catalog_key_unreadable` is returned.
- Keys of the API entries that the user added to the translation catalog (#413) are also kept in the same store. The entry name is `TRANSLATION_CATALOG/<entry ID>`, and it is not part of the settings (`SECRET_SETTINGS`). When an entry is added, its key is written and read back. Even if it cannot be written or read back, the entry is added, and the key is kept in memory only for that run, like the keys of the settings (`Config::keep_secret` in `native/core/src/config/mod.rs`). This is reported once with `/run/secret_store_failed`, and the key is written again on the next save, every 30 seconds and when the app closes. It is never written to a plain-text file. The entry's `key` becomes `true` when the store could hold the key. An entry whose key had not been placed in the store when the app closed becomes an entry without a key at the next startup. The screen shows "No API key" and tells the user to delete the entry and add it again. When the key is used, a key held in memory comes first. When the store is temporarily unreadable (`locked`, `unavailable` and so on), this is not treated as a missing key; a 409 `translation_catalog_key_unreadable` is returned and nothing changes. Deleting an entry deletes its key from memory and from the store. If it cannot be deleted from the store, the core retries on the next save and every 30 seconds, as for the keys of the settings.
- Going back to 0.5.x means entering the keys again, because the moved keys are not in `secrets.json`. The keys remain in the OS store. The same applies when going back to 0.4 or earlier.
- When "Delete the application data" is chosen in the Windows uninstaller, the uninstaller reads `store_id` from `secrets.json` in the install folder, deletes the generic credentials whose names start with `ASTAROT/<store_id>/` or the 0.6.0 `VRCT-VOX/<store_id>/` from Credential Manager, and then deletes `secrets.json`. If some entries could not be deleted, `secrets.json` is kept, so that uninstalling again with the app data (after installing again into the same folder) can delete the rest with the same `store_id`. Entries of other `store_id` values (of other installs, or of settings separated with `ASTAROT_CONFIG_DIR`) are not touched. When there is no `store_id`, or it is not 16 lower-case hexadecimal digits, no credentials are deleted. If some entries could not be deleted, the uninstaller says that `secrets.json` was kept and gives the start of their names, and tells the user to uninstall again or to delete them under "Windows Credentials" in Credential Manager ([What the Windows uninstaller removes](#what-the-windows-uninstaller-removes)).

## Other files

| File | Location | Content |
|---|---|---|
| `process.log`, `error.log` | `$ASTAROT_CONFIG_DIR/logs/` (the working folder if it is not set) | Diagnostic logs. Truncated at 10 MB, and `process.log` is emptied at every startup. Only when the UI starts the core again after a failed run is it not emptied, and the new records follow those of the previous run. The Python backend up to 0.4 also wrote `freeze_trace.log` and `crash_trace.log` (faulthandler stack dumps) and `startup_timing.log` (the time of each startup stage). The core does not write these three |
| `startup.log` | Same as above (Tauri side) | The record of the window's startup |
| Message log `YYYY-MM-DD_HH-MM-SS.log` | `PATH_LOGS` | Only when "Auto save message logs" is on. Lines start with `[SENT]`, `[RECEIVED]`, `[OCR]` or `[CHAT]`. The screen keeps only the newest 1,000 entries, but the file keeps older ones too |
| `downloaded_models/<id>/<version>/` and `receipt.json` | The same folder as `config.json` | Downloaded models. During a download, `.partial-<hex>/`. When a broken model is downloaded again, it is also first renamed back to that name and then deleted ([What is kept on failure](failure-recovery.md#モデルの取得と適用)) |
| `user_models.json` | The same folder as `config.json` | Models the user registered with a name (#403). `{"version": 1, "models": [{id, target, name, files: {role: {path, size, mtime_ns}}, registered_at}]}`. Holds only the file locations and the size and modification time at registration; model files are not copied. Written to a temporary file, synced with `fsync` and then replaced. When it cannot be read or has a different version, it is kept without being rewritten. The Python backend up to 0.4 also read and wrote the same format |
| `transcription_catalog.json` | The same folder as `config.json` | API entries the user added on the speech recognition page (#414, core only). `{"version": 1, "entries": [{id, name, protocol, url, model, key, registered_at}]}`. In this version, `protocol` is only `openai_compatible` (Whisper-compatible). `key` only says whether [the API key store](#where-api-keys-are-stored) could hold the key; the key itself is not written to this file. Up to 100 entries. An entry with the same name, or with the same address and model, cannot be added. How the file is written, and that it is kept and not overwritten when it cannot be read (a newer format or a hand-edited file), are the same as for `translation_catalog.json`. Entries with a `protocol` this version does not know are kept and shown as unusable |
| `translation_catalog.json` | The same folder as `config.json` | Entries the user added to the translation catalog (#413, core only). `{"version": 1, "entries": [...]}`. Inference engine entries are `{id, group: "engine", name, runtime, folder, languages, registered_at}`; entries whose `runtime` is `llamacpp` (translation LLMs such as TranslateGemma, ADR-015) put the path of the GGUF file in `file` instead of `folder` and add `device` (`auto`, `cpu`, `Vulkan1` and so on). If even one entry has `file`, the file's `version` becomes `2`. Earlier versions that can read only `version` `1` treat the whole file as unreadable and do not overwrite it (the added entries do not appear in the list, and settings that had chosen those weights go back to the default model). When a newer version deletes all `llamacpp` entries, the file goes back to `version: 1`, and earlier versions can read it again. API entries are `{id, group: "api", name, protocol, url, model, key, registered_at}`. `key` only says whether [the API key store](#where-api-keys-are-stored) could hold the key; the key itself is not written to this file (it is `false` while the key is held in memory because it could not be placed in the store). Models in folders are not copied. How the file is written, and that it is kept when it cannot be read, are the same as for `user_models.json`. Entries with a `runtime` or `protocol` this version does not know are kept and shown as unusable |
| `vc_runtimes/<engine>/` and `receipt.json` | The same folder as `config.json` | The RVC runtime the app prepared (Windows and Linux; also Seed-VC up to 0.4). `.steps.json` records the finished steps. The Python backend up to 0.4 also kept the output of `uv` and of the worker check in `setup.log`, and for Seed-VC placed a `uv` for downloading in `.uv-<version>/` (the 0.5.0 core does not write `setup.log`). RVC has only `lib/` (ONNX Runtime; for the GPU, also the CUDA 13 and cuDNN libraries) and `assets/`, and uses `lib.part/` and `downloads/` while downloading. When the RVC download finishes, the earlier PyTorch-format `venv/`, `python/`, `engine/` (the model and audio files inside are kept), `engine.zip`, and the fixed `rmvpe.pt` and `preprocessor_config.json` in the same folder are deleted |
| `vc_runtimes/onnxruntime-cuda/`, `vc_runtimes/onnxruntime-directml/` and `receipt.json` | The same folder as `config.json` | ONNX Runtime for running local translation on the GPU (after 0.5.2; only when the user agreed and downloaded it). `onnxruntime-cuda/` holds the CUDA 13 build and the NVIDIA libraries, and `onnxruntime-directml/` the DirectML build and `DirectML.dll` (Windows only). Both have only `lib/`, and are downloaded and verified the same way as the RVC runtime. At startup, the app loads the build that matches the processing device for translation instead of the bundled CPU build. The RVC worker loads `onnxruntime-directml/lib` when it converts with DirectML |
| `vc_runtimes/llamacpp-vulkan/` and `receipt.json` | The same folder as `config.json` | llama.cpp's `llama-server` for running translation LLMs (ADR-015; only when the user agreed and downloaded it). Only the files the server reads are extracted into `lib/` from the Vulkan archive of llama.cpp's GitHub release (b12125). The same build is used when running on the CPU only. It is downloaded and verified the same way as the RVC runtime, and the verification runs `llama-server --list-devices` once. It contains no model. The server starts only when translation with such a model starts |
| weights/whisper/… | PATH_DATA | Whisper weights that earlier versions downloaded. The current version neither reads nor downloads them. They are deleted only when the user chooses to delete them in the settings ([Old Whisper weights](#old-whisper-weights)) |
| weights/ctranslate2/… | PATH_DATA | CTranslate2 translation models and verification records that the Python backend up to 0.4 downloaded. The 0.5.0 core does not read them, and after startup deletes only the folders with the names Python created (links and junctions are not followed; `native/core/src/controller/legacy_weights.rs`, and the section on the old CTranslate2 weights in [Core integration](../voice-stack/core-integration.md)) |
| `translation-models/<folder>/` | PATH_DATA | Translation models the user placed, which earlier cores read (weight names `custom:<folder>`). From #597 they are not listed or loaded. The folders and files are neither deleted nor moved. The core reports only whether this folder contains any folders, in `retired_folder_used` of `/get/data/translation_catalog`, and meanwhile the translation page points the user to "Add a model of your own" in the translation catalog. Names and paths are not reported |
| `secrets.json` | The same folder as `config.json` | API keys ([Where API keys are stored](#where-api-keys-are-stored)). Encrypted on Windows, permissions 0600 on Linux |
| `exports/` | The same folder as `config.json` | Term dictionaries the user exported (`vocabulary-YYYYMMDD-HHMMSS.txt`, [Exporting to and importing from a file](#exporting-to-and-importing-from-a-file)). The app does not read them |
| `storage_migration.json` | The settings folder and the data folder of the Linux release builds (from 0.6.0) | The record of whether the folder was newly created or moved from `vrct-vox` ([Moving the storage folders on Linux](#moving-the-storage-folders-on-linux)) |
| `config.json.before-migration-storage` | The same folder as `config.json` | The `config.json` before paths were rewritten, when the Linux storage folders were moved and at the first startup after the Windows installer moved the install folder (without the API keys; permissions 0600 on Linux). The app does not read it |
| `installer_moved_from.txt` | The Windows install folder (from 0.7.0) | The path of the old install folder (UTF-16 with a byte order mark), placed when the installer moves the install folder. The app rewrites the paths at the next startup and deletes the file ([Moving the install folder on Windows](#moving-the-install-folder-on-windows)) |
| `voice_mute_state.json` | The same folder as `config.json` | `{"version": 1, "muted": boolean}`. Written at once and replaced atomically |
| `telemetry_state.json` | `PATH_DATA` | The record of whether usage reports were sent that day (UTC) (the date the startup report was sent, and the error codes sent that day), and the last 20 reports exactly as sent (`sent`: the PC's local time, the body, and whether it was accepted) |
| `io.github.kein5.astarot.desktop` | `$XDG_DATA_HOME/applications/` | The desktop file for registering shortcuts on Wayland. Up to 0.6.x it was `io.github.kein5.vrct-vox.desktop`; a file with the line `X-VRCT-VOX-Generated=true` (written by an earlier version) is deleted after the new file is written. A file without that line is kept as the user's or a package's |

The UI keeps no state of its own (it does not use `localStorage` either). It receives all the screen state from the sidecar.

### What the Windows uninstaller removes

On Windows, the folder that holds `config.json` is the install folder, so the items in the table above that are in the same folder as `config.json` or in `PATH_DATA` are in the install folder. The uninstaller deletes the following only when the user chooses "Delete the application data" on the confirmation screen (`Section Uninstall` in `src-tauri/nsis/template.nsi`). If the user does not choose it, they stay. When an app update removes an old install in another location, this option is not chosen, so they stay.

- Settings: `config.json` and `config.json.*` (the lock, `unreadable-*`, `before-migration-*` of 0.5 and earlier, and the temporary file from a save that stopped midway)
- API keys: the keys of this folder in Credential Manager ([Where API keys are stored](#where-api-keys-are-stored)), `secrets.json`, `secrets.json.*`
- `user_models.json`, `translation_catalog.json`, `voice_mute_state.json`, `telemetry_state.json`, and the temporary files from writes of each of them that stopped midway
- `downloaded_models/`, `vc_runtimes/`, `logs/`, `weights/`
- The logs that the Python backend up to 0.5 wrote next to the app (`process.log`, `error.log`, `crash_trace.log`, `freeze_trace.log`, `startup_timing.log`)
- WebView2 data (the folders of the app ID in `%APPDATA%` and `%LOCALAPPDATA%`)

`translation-models/` and `exports/` hold files the user placed or exported, so they are not deleted. If either holds files, the install folder also stays. `installer_language.txt` is deleted whether or not the option was chosen. When adding a file or folder to the table, update `Section Uninstall` too (`tests/devtools/test_nsis_staged_update.py` compares it with the table).

### Transcription diagnostic log

Diagnostics of ordinary utterances are kept in `process.log` as `[utterance-summary]` for the mic and the speaker separately. When an observation arrives 60 seconds or more after the first observation, the previous interval is output. Without activity, nothing is output, and no timer or dedicated thread is used. On a stop or exit, the rest is output. When a worker that went past the wait limit for stopping finishes later, its rest is output too.

Counts and maximums cover all observations in the interval, and p50/p95 are computed with the nearest-rank method from the last 256 entries of each stage. `n` is the number of all observations, and `samples` the number of entries used for the percentiles. Times are in ms. The diagnostics keep apart the VAD silence wait (`vad_wait_ms`), the length of buffered audio (`vad_buffer_ms`), the queue wait of completed audio, ASR, translation, and other output processing. The existing `total_ms` is the sum of the processing time from the start of ASR to the end of output, and does not include recording, VAD or queue waits. On the realtime path, the time from the server's speech start or commit to the arrival of final is `realtime_pending_ms`, and the time from the arrival of final to the end of processing is `realtime_total_ms`. The server does not provide its internal VAD wait and inference time, so they are not treated as separate measurements.

Failures and exceptions are recorded at once, as before. Slow processing also keeps the existing details. The diagnostic thresholds are 1,536 ms for the VAD silence wait, 15,000 ms for buffered audio, 1,000 ms for the queue wait and output, 5,000 ms for ASR and translation, and 10,000 ms for the existing total. On the realtime path, they are 7,500 ms for pending, 1,000 ms for the final queue wait and translation, and 2,000 ms for the whole final processing. These are not limits that stop processing. For queue drops, the first one is recorded at once, consecutive drops are counted together, and the recovery is recorded at the next normal enqueue. If no normal enqueue happens before the stop, the log says `recovery=unconfirmed`. Audio and recognized text are not included in the diagnostics, and the existing masking in the IPC responses of transcription stays. There are no new settings or environment variables. The implementation is `native/transcription/src/diagnostics.rs` (moved on 2026-11-19 from [`models/transcription/utterance_diagnostics.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/utterance_diagnostics.py)). Unlike Python, the core does not list the calls for each language in the engine detail line. `vad_wait_ms` is the length of audio heard after the end of speech, at the moment the speech.cpp server reported the end of speech.

## Environment variables

| Variable | Effect |
|---|---|
| `ASTAROT_CONFIG_DIR` (also `VRCT_CONFIG_DIR` during 0.6.x) | The location of `config.json`, logs, downloaded models, the voice conversion runtimes and the mute state. A folder given here is not moved |
| `ASTAROT_DATA_DIR` (also `VRCT_DATA_DIR` during 0.6.x) | The location of data for the Linux release builds (`src-tauri/src/backend_host.rs`). A folder given here is not moved |
| `XDG_CONFIG_HOME`, `XDG_DATA_HOME` | The base of the default locations for the Linux release builds (`astarot` under them; `vrct-vox` up to 0.5.x) |
| `VRCT_CACHE_DIR`, `XDG_CACHE_HOME`, `HF_HOME` | The Python backend up to 0.4 used them for the cache location of the Linux release builds (`HF_HOME` was `<cache>/huggingface` when not set). The code of the 0.5.0 app and core does not use them for locations |
| `ASTAROT_VOICE_TRACE`, `ASTAROT_VOICE_GC_DIAGNOSTICS` | TTS timing and GC records (for diagnostics) |
| `WAYLAND_DISPLAY`, `XDG_SESSION_TYPE`, `GDK_BACKEND` | Decide how Quick Chat and hotkeys are registered |
| `DISPLAY` | OCR capture on X11 |
| `ASTAROT_VR_PANEL_DIR` | A location for this process only, decided by Tauri at startup (`$XDG_RUNTIME_DIR/astarot/vr-panel-<pid>`, Linux). The backend reads the pixels of the VR screen (`frame`) and of a shared window (`screen-frame`) here. Not something users set |
| `APPIMAGE` and `WEBKIT_DISABLE_DMABUF_RENDERER=1` | Make the main window opaque in the AppImage on NVIDIA systems |
| `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (lower-case names first) | The HTTP proxy that traffic to the cloud speech recognition engines and the online translation providers goes through, and the destinations that bypass it. When none of the `*_proxy` variables is set, the Windows Internet settings are read. Local and LAN destinations (including LM Studio, Ollama and OpenAI-compatible servers on the LAN) do not go through the proxy (`native/translation/src/proxy.rs`) |

The app does not read offline variables such as `HF_HUB_OFFLINE`. `tools/dev.py` sets them for the child processes it starts in development.

## Audio device selection and identification

The classic transcription and the volume meter share one recording per input source (microphone and speaker). Names are display labels, and selection uses IDs (`native/core/src/controller/audio_devices.rs`, `native/audio-routing/src/identity.rs`, `selection.rs`). The classic recording is used only on Windows, when a cloud speech recognition engine is selected. The main-screen switches on Linux, and local speech recognition (speech.cpp) on Windows, use realtime ASR.

- Device list and identification:
    - Windows lists only WASAPI (`IMMDeviceEnumerator`) devices. The IDs include the IMMDevice ID: `mic:Windows WASAPI:<IMMDevice ID>` and `speaker:2:<IMMDevice ID>`. The sample rate and the channel count come from the mix format (`native/audio-routing/src/wasapi/mod.rs`). The only microphone host is `Windows WASAPI`.
    - Linux lists only PipeWire inputs, under a single host named `PipeWire`. The IDs are `pipewire:<node.name>`, and there are no speaker rows. The list is read again every 2 seconds (`native/audio-routing/src/pipewire/devices.rs`). The classic recording does not open PipeWire rows (`asr_capture_windows_only`).
- The saved `SELECTED_MIC_DEVICE_ID` and `SELECTED_SPEAKER_DEVICE_ID` are kept along with the names `SELECTED_MIC_HOST`, `SELECTED_MIC_DEVICE` and `SELECTED_SPEAKER_DEVICE`. A saved ID matches only the device with the same ID. A name matches when exactly one row has that name. Even if the saved ID is not found, another device is never taken as the same one because it has the same name.
- With a setting that has only a name, if the name matches exactly one row when it is used, that device is used, and its ID is written the next time the selection is reported. If several rows have the same name, the saved name stays, and when Auto is off, no device is selected (none is guessed). Selections saved with the hosts that Python up to 0.4 used (MME, DirectSound, WDM-KS) are moved to WASAPI rows: by the native ID part of the saved ID, or, when the ID is empty or a `pa:` slot ID, by name (also allowing for MME's truncation to 31 characters), and only when exactly one row matches (`selection.rs`).
- When the device of the saved ID is not in the list, the OS default device is selected, or else the first row of the list, even when Auto is off. When the list changes, that selected device is saved as the selection, even when nothing is recording. Connecting the original device again does not bring the selection back (`native/core/tests/audio_devices.rs`).
- The recording is set up again when the combination for the open device (ID, name, host, position in the list, connection generation and object serial, sample rate, number of input channels, whether it is loopback, node name) changes (`capture_key` in `identity.rs`). The connection generation goes up with every notice of a device change, so a device change reopens a running recording.
- The name strings and the IPC for the lists of names stay. `/get/data/selectable_mic_device_options` and the speaker's endpoint of the same form return `[{id, label}]`. The device of a running recording stays in the list until the recording stops. `/get/data/selected_mic_device_id`, `/set/data/selected_mic_device_id` and the speaker's endpoints of the same form handle ID strings, and do not accept an empty ID. Each change of a value is also notified with `/run/…`. The selection fields on the desktop and in VR use the new IPC. A request to change the selection by name is accepted only when exactly one row has that name.
- Updates of the list and Auto selection move the recording device only while transcription or the meter is on. When both are off, only the selection is reported, and recording does not start. Turning Auto on aligns the selection and the recording device before the reply. Turning Auto off keeps a recording whose device combination does not change. A pending alignment carries a generation and is dropped if the generation has changed. An off operation also advances the generation, so an old request does not resume recording. The alignment runs on the thread that received the request.
- Automatic speaker selection on Windows follows the playback device that is making the loudest sound, not only the OS default (`native/audio-routing/src/tracker.rs`). This tracking stops while the recording is being set up again.
- In a recording the user started, if the chosen device disappears or cannot be opened, the recording switches to another usable device and continues, even when Auto is off (maintenance policy of 2026-11-04). The order tried is the chosen device, the OS default device, then all other rows, skipping repeats of the same device combination and PipeWire rows. Opening one device waits up to 8 seconds (`native/transcription/src/recorder.rs`). On a read error, the list is read again, and the recording switches if the device is gone. If the device is still in the list, it does not switch, and recognition is turned off with `AUDIO_READ_ERROR`. Opening needs an IMMDevice ID, so a library's default device that has no identification is not opened.
- The ID and the name of the device that opened are saved as the selection. When the ID or the name changes, a 200 notification on `/run/audio_device_switched` carries `{source, old_device: {id, name}, new_device: {id, name}}`. The UI shows the names before and after in a notice that does not get in the way, and adds the IDs when the names are the same.
- If no device can be opened, transcription and the meter are turned off (`/set/disable/transcription_*`, `/set/disable/check_*_threshold`), the meter goes back to 0 (`/run/check_*_volume`), and `/run/transcription_recognition_error` is sent. When there is no device at all, `/run/error_device` (`DEVICE_NO_MIC` or `DEVICE_NO_SPEAKER`) is sent for the speaker and the meter.
- If opening takes longer than 8 seconds, a stop flag is set, the attempt fails with `asr_capture_start_timeout`, and the next device is tried. The next request for the same input source waits on the lock of that input source. A stream that opens late sees the stop flag and stops. There is no guarantee that a native call that is already running (which may be waiting for the Windows microphone permission check) can be interrupted.
- Recording errors and recoveries are matched against a version for each input source (which advances on every start, stop and failure). An error from an old recording does not stop the recording after a switch, and does not suppress a new error notice. This version is separate from the generation of the user's on/off actions and from the generation of message delivery. An internal device switch alone does not discard text that has been accepted, but recognition in progress from the recording before the switch is dropped. No stream is opened only to check a device; a stream that opened is used as it is.
- The default RVC input looks for the microphone of the Device page by name (`native/core/src/controller/voice/mod.rs`).

Realtime ASR is a separate capture path, and the automatic continuation of the classic recording described here does not apply to it. Realtime ASR uses the device fixed in `REALTIME_ASR_SETTINGS` or the OS default device. Starting the classic recording stops realtime ASR first (`native/core/src/controller/realtime_asr.rs`, `transcription.rs`).

---

# データ形式と保存（日本語版）

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

設定の「音声認識（ASR）」は選べるエンジンを2つの系の名前の下に分けて並べる（#414）。「お使いのPCで動かす（speech.cpp）」に`SpeechCpp`を、「API（クラウドや自分のサーバー）」にGroq Whisper、OpenAI Whisper、Deepgram、カスタムWhisperサーバーをこの順に置く。並べ方だけで、保存する値と上のエンドポイントは変わらない。

### ローカル音声認識の移行

0.6.0 から、ローカル音声認識の移行は行わない（#288 の判断4）。保存済みの`SELECTED_TRANSCRIPTION_ENGINE`が削除した`"Whisper"`なら、外した`"Google"`と同じく未選択として読み込む。利用者は最初の起動と同じくエンジンを選び直す。`REALTIME_ASR_SETTINGS`は保存したとおりに読む。モデルは取得しない。

`LOCAL_ASR_MIGRATION`（整数）は`config.json`に`2`を書き続ける。0.5 以前の版はこの値で移行を済ませたかを判断するので、その版へ戻したときに移行をやり直させないためである。いまの版はこの値を読まない。

0.3 から 0.5 までは、段階が足りない保存ファイルを読み込みの最後に移していた（`Config._migrateLocalASR`。Python の版と Rust の中核の 0.5 系）。

| 段階 | 0.5 まで行っていたこと |
|---|---|
| 1 | 保存済みの`REALTIME_ASR_SETTINGS.server`が`"bundled"`なら、音声認識エンジンを`SpeechCpp`にする |
| 2 | 保存済みの`"Whisper"`を`SpeechCpp`にする。Windows では`REALTIME_ASR_SETTINGS.server`を`"bundled"`にする。あわせて`LOCAL_ASR_NOTICE_PENDING`を`true`にし、メイン画面に「ローカルの音声認識は speech.cpp に変わりました」のお知らせを1回出す（`/get/data/local_asr_notice`、`/set/disable/local_asr_notice`） |

移す前の内容は`config.json.before-migration-<段階>`に残していた。0.6.0 はこの写しを書かず、前の版が残した写しにも触れない。`LOCAL_ASR_NOTICE_PENDING`は引退したキーとして読み込みのときに捨てる。お知らせとその2つのエンドポイントはない（404）。

`VIRTUAL_MIC_NOTICE_PENDING`（真偽値、既定は`true`、保存する）は、仮想マイクの案内（#321）を起動時に自分で開いてよいことを表していた。#943で案内は自分では開かなくなった。UIは起動時に値を受け取るが、案内を開くかどうかには使わず、`/set/disable/virtual_mic_notice`も送らない。前の版と同じ設定ファイルを使えるように、中核はキーと`/get/data/virtual_mic_notice`、`/set/disable/virtual_mic_notice`をそのまま持つ。案内は初期設定の「仮想マイク」の行と「テキスト読み上げ（TTS）」の設定から開く。流れは[UC-17](use-cases.md#uc-17-仮想マイクを用意して確かめるwindows)にある。

`FIRST_RUN_SETUP_PENDING`（真偽値、既定は`true`、保存する）は、初期設定（#557）をまだ終えていないことを表す。真の間、初期設定で準備するものが残っていれば、最初の画面の「初期設定を開く」を目立たせる。準備するものは、ローカルの音声認識の準備（エンジンが未選択か、speech.cpp を同梱のサーバーで使うのに認識モデルか VAD モデルが未設定のとき）と、選んだ翻訳のモデル（取得できるのにまだないとき、#936）。初期設定は自分では開かず、利用者がこのボタンで開く（#935）。以前のバージョンから更新した人もキーがないので真になるが、準備するものが残っていなければ行は出ない。「完了」か「最初の画面の「初期設定を開く」を目立たせない」で`/set/disable/first_run_setup`を送り、偽にする。偽でも、準備するものが残っている間は最初の画面から開ける。流れは[UC-18](use-cases.md#uc-18-初期設定で基本機能を準備する)にある。

### 古い Whisper の重み

0.2 以前の版が取得した Whisper の重みは`PATH_DATA`の`weights/whisper/<名前>`にある。名前は`tiny`、`base`、`small`、`medium`、`large-v1`、`large-v2`、`large-v3`、`large-v3-turbo-int8`、`large-v3-turbo`の9つ（[`models/transcription/old_whisper_weights.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/old_whisper_weights.py)の`WHISPER_WEIGHT_NAMES`）。いまの版は読まず、消しもしない。

0.3 から 0.5 までは、設定の「音声認識（ASR）」と移行のお知らせに「古い Whisper モデル」の欄があり、合計の容量を見せて、利用者が確かめてから消せた（`/get/data/old_whisper_weights`、`/run/delete_old_whisper_weights`）。0.6.0 でこの欄と2つのエンドポイントを外した（#288 の判断4）。残った重みは、利用者が`weights/whisper`のフォルダーを手で消せる。

### 音声認識の数値設定

マイクとスピーカーの`avg_logprob`と`no_speech_prob`は、OpenAI互換のクラウドエンジン（Groq Whisper、OpenAI Whisper、カスタムWhisperサーバー）が返した区間を捨てるときのしきい値である。設定の「音声認識（ASR）」では、「API（クラウドや自分のサーバー）」の中の「Whisperの認識結果のふるい分け」で4つとも変えられる。スライダーは0.05刻みで、値を確定したときに`/set/data/mic_avg_logprob`などへ送る。`avg_logprob`は−2以上0以下、`no_speech_prob`は0以上1以下の有限の数値を受け付ける。IPCでは数値に変換できる文字列も受け付ける。`NaN`・無限大、範囲外、真偽値などは変更や保存をせず400の`VALIDATION_CONFIG_VALUE_INVALID`で拒否し、`data`に元の値を返す。保存済みの不正な値は読み込み時に既定値へ戻す。

`MIC_`と`SPEAKER_`の整数設定は、保存値の読み込みと設定プロパティへの代入で次の範囲を検証する。`null`、真偽値、小数、文字列は受け付けない。IPCで整数に変換する従来の処理は維持し、範囲外の値には既存の`VALIDATION_MIC_*`・`VALIDATION_SPEAKER_*`と元の値を返す。

| 設定名の末尾 | 範囲 |
|---|---|
| `THRESHOLD` | 0〜2000 |
| `RECORD_TIMEOUT`、`PHRASE_TIMEOUT` | 0〜30秒。`RECORD_TIMEOUT`は`PHRASE_TIMEOUT`以下 |
| `MAX_PHRASES` | マイクは0〜30、スピーカーは0〜60 |

保存したタイムアウトはJSONのキー順に関係なく、組として検証する。範囲外や型が不正な値は既定値へ戻す。範囲内でも記録時間がフレーズ時間を超える組は、両方を既定の3秒へ戻す。

2つのタイムアウトの意味は次のとおりである（`native/transcription`の`energy.rs`と`phrases.rs`）。`RECORD_TIMEOUT`は1回の録音（音量で切り出した1つのフレーズ）の長さの上限で、0は上限なしである。上限で切れたフレーズも、間をあけずに続けば同じ発話につながる。`PHRASE_TIMEOUT`は、最後のフレーズからこの秒数が過ぎると、それまでの音声を1つの発話として区切る値である。フレーズの間の無音がこれより長いときも新しい発話になる。発話は音声が15秒になったときも区切る。設定画面のラベルと説明はこの意味で書く（「1回の録音の長さの上限」と「発話を区切るまでの待ち時間」）。

`MIC_ENABLE_VAD`と`SPEAKER_ENABLE_VAD`は、音量の代わりに VAD でフレーズを区切るスイッチである。次に録音を始めたときから効く。VAD で区切るときは`PHRASE_TIMEOUT`を使わず、自然に区切れた区間ごとに1つの発話として認識する。長さの上限（7秒）で切れた区間は次の区間とつなぐ（15秒まで）。認識に送る音声の前に0.3秒、後に0.5秒の無音を足す。

VAD は、リアルタイム字幕と同じ speech.cpp のサーバーの Silero VAD を使う（`native/transcription`の`server_vad.rs`）。スイッチがオンで文字起こしの録音を始めると、中核はそのサーバーに文字起こしをしない Realtime のセッションを開く。`session.update`では`transcription`を`null`、`turn_detection`を`server_vad`（しきい値0.25、前の余白160ミリ秒、無音768ミリ秒。Python の VAD の経路と同じ値）にする。録音の音声を24 kHz のモノラルで送り、`input_audio_buffer.speech_started`の`audio_start_ms`から`speech_stopped`の`audio_end_ms`までを1つの区間として切る。同梱のサーバーは、動いているときだけ使い、録音のためには起動しない。音量メーターだけのときはセッションを開かない。

`/get/data/vad_available`は、サーバーの設定がそろっているかを返す。リアルタイム字幕のサーバーが同梱なら、音声サーバーの`asr`プロファイルに認識モデルと VAD モデルのパスがあるとき、外部なら URL がループバックのアドレス（`speechcpp::local_url`）のときに`true`である。サーバーが動いているかは録音を始めるまで確かめない。リアルタイム字幕の設定、音声サーバーの設定、取得したモデルの適用でこの値が変わると、中核は`/get/data/vad_available`を UI へ送り直す。`false`の間、`/set/enable/mic_vad_filter`と`/set/enable/speaker_vad_filter`は値を変えず、400の`VAD_UNAVAILABLE`と保存値を返す。`details.reason`は足りないもの（`realtime_asr_model_missing`、`realtime_vad_model_missing`、`realtime_base_url_invalid`）である。オフにする操作は受け付ける。以前の版で保存したオンの値はそのまま残す。設定画面は VAD の選択肢を選べない状態にして理由を示し、保存値がオンでも「自動」か「手動」の表示にする。

スイッチがオンでもサーバーを使えないときは、音量で区切り、`/run/vad_unavailable`に400の`VAD_UNAVAILABLE`（`data`は`{"source": "mic"}`か`{"source": "speaker"}`、`details.reason`は理由）を1回送る。理由は、上の設定の不足のほか、サーバーが動いていない・接続できない（`speech_server_not_ready`）、サーバーに VAD モデルがない（`realtime_vad_model_missing`）、セッションが途中で切れた（`realtime_session_failed`）である。セッションを開いている間に音量で切った区間は、開けなかったときに認識へ回し、開けたときは捨てる。途中で切れたときは、それ以降を音量で区切る。UI は`details.reason`に対応するリアルタイム字幕の案内（`realtime_toggle.*`）があれば、知らせの後ろに付ける。

ローカルの Whisper とともに、`MIC_NO_REPEAT_NGRAM_SIZE`と`SPEAKER_NO_REPEAT_NGRAM_SIZE`は削除した。古い`config.json`にあっても読み込まない。

リアルタイム字幕（speech.cpp の Realtime）では、発話の区切りをサーバーの VAD（`server_vad`）が決める。中核はセッションを始めるときに`turn_detection`の`silence_duration_ms`（話し終わりとみなす無音の長さ）と`prefix_padding_ms`（発話の前に残す余白。後ろにも、無音の長さを超えない範囲で残る）を送る（#556）。無音の長さは`REALTIME_ASR_SETTINGS.silence_duration_ms`で、項目がなければ既定の400ミリ秒である（speech.cpp と OpenAI の既定の500ミリ秒より短い）。既定を500から400に変えたとき、選んで保存した値は変えず、選んでいない設定だけが新しい既定に従う。余白は無音の長さの半分で、300ミリ秒（speech.cpp の既定）を超えない。同梱の speech.cpp（0.11.2）は、無音が`silence_duration_ms`続いた時点で発話を確定する。後ろの余白のぶんの無音が来た時点で、確定を待たずに発話を読み始め、確定ではその読み取りの結果を使う（speech.cpp の #232、#233）。余白が短いほどこの読み取りが早く始まり、確定までに終わりやすくなる。0.11.1 までの speech.cpp は、余白の2倍のあいだに次の発話が始まらないと分かってから発話を確定したので、既定の余白300ミリ秒のままでは無音500ミリ秒でも確定まで600ミリ秒かかった。余白を半分以下にしていたのは、この待ちを無音の中に収めるためである。発話をどこで区切るかは無音の長さだけで決まる。`silence_duration_ms`は100〜2000の整数を受け付け、範囲外、小数、文字列、真偽値は`realtime_settings_invalid`で拒否する。選ばなかった項目や`null`は保存しないので、既定のままなら0.4の版も同じ設定を読める。値を変えると、マイクとゲーム音声の両方の字幕を停止する（サーバーやモデルを変えたときと同じ）。設定画面の「リアルタイム字幕」では、既定（0.4秒）、0.3秒、0.5秒、0.7秒、1秒から選ぶ。この一覧にない値が保存されていれば（既定が0.5秒だった版で選んだ0.4秒など）、その値も選択肢に出す。短くすると確定が早くなるが、文の途中の間でも区切られやすくなる。測った値は[音声パイプラインの遅延](../voice-stack/pipeline-latency-2026-11-18.md)にある。

発話を拾う感度は`REALTIME_ASR_SETTINGS.vad_threshold`で、`turn_detection`の`threshold`（声と判定するのに要る確からしさ、0〜1）として送る（#392）。項目がなければ送らず、サーバーの既定に任せる。0.05〜0.95の小数点以下2桁までの数を受け付け、範囲外、桁の多い数、文字列、真偽値は`realtime_settings_invalid`で拒否する。選ばなかった項目や`null`は保存しない。値を変えると、無音の長さと同じく両方の字幕を停止する。設定画面では、既定（サーバーに任せる）、0.2、0.3、0.4、0.5、0.6、0.7から選ぶ。小さくすると小さな声や出だしを拾い、大きくすると雑音を拾いにくくなる。マイクとゲーム音声の録音の VAD（クラウドの音声認識で使う）は Python と同じ値（0.25、余白160ミリ秒、無音768ミリ秒）のままで、この設定には従わない。

### 用語辞書

用語辞書は`REALTIME_ASR_SETTINGS.vocabulary`の`{"builtin": 真偽値, "terms": [文字列], "removed": [文字列]}`である。`removed`は利用者が外した内蔵の用語の表記で、ないときは保存しない（下の「辞書の一覧と内蔵の用語の編集」）。1項目は speech.cpp のキーワードの形で、`表記=読み,読み`と書く（読みは省ける）。利用者の項目は100個まで、表記は48字まで、読みは1項目に8個まで、それぞれ32字までである。表記は大文字と小文字を区別せずに重複を除く。`builtin`が`true`なら内蔵のVRChat用語を利用者の項目の後ろに足し、全体を150項目までにする。同じ表記なら利用者の項目が勝つ。

内蔵のVRChat用語は`native/transcription/data/vrchat_terms.txt`にあり、アプリをビルドするときに埋め込む（`astarot_transcription::speechcpp::vrchat_terms`、#792）。1行に1項目を`表記=読み,読み`の形で書き、`#`で始まる行と空の行は読まない。用語を足したり読みを直したりするときは、このファイルだけを直す。各行は利用者の項目と同じ規則に従い、表記は大文字と小文字を区別せずに重ならない（中核の試験が確かめる）。

保存の形はリアルタイム字幕の設定のままだが、辞書はほかの機能でも使う（#446）。照合ではひらがなとカタカナ、英字の大文字と小文字を同じに扱う。英字と数字の語は前後に英字か数字が続く位置では一致させない。カタカナで始まる語やカタカナで終わる語も、前後にカタカナが続く位置では一致させない（「リクエスト」の中の「クエスト」は直さない）。長い語から先に当てる（`astarot_transcription::terms`）。

| 使う場所 | すること |
|---|---|
| リアルタイム字幕 | セッションに表記と読みをキーワード（Haas）か短いヒント（Qwen3-ASR）として送る。返った文は途中のものも確定したものも、読みを表記に直し、英字の表記を登録した大文字と小文字にそろえる |
| クラウドの音声認識（Whisper、Deepgram） | 認識した文がメッセージの処理に入るときに、同じように直す。エンジンには辞書を送らない。チャット読み取り（OCR）の文は直さない |
| 読み上げ | 文の言語が日本語なら、読みのある表記を最初の読みに置き換えてから読み上げに渡す。チャットとマイクの確定文の原文と訳文のどちらにも当てる。日本語以外の文は変えない |
| 翻訳 | システムプロンプトを使うAIの翻訳エンジン（OpenAI互換、Gemini、Ollama、PLaMo など）には、原文に出てくる利用者の項目の表記を20個まで渡し、名前として扱うように指示する。原文にない語と読みは送らない。内蔵のVRChat用語は渡さない。DeepL、Google、Papago、ローカルの翻訳には渡さない |

#### 辞書の一覧と内蔵の用語の編集

設定画面の「音声認識」の用語辞書は、使っている辞書を1つの一覧（「辞書の用語」）で出す（#792）。利用者の項目を先に、続けて内蔵の用語を出す（中核が使う順と同じ）。用語は一覧の頭の欄（表記と読み）で足し、内蔵の用語は1語ずつ読みを変えたり外したりできる。内蔵の用語の一覧そのものは書き換えず、利用者の変更を一覧の上に重ねて保存する。変えていない用語は、アプリの版上げで用語が増えたり読みが直ったりすると、新しい一覧に従う。

| 操作 | 保存する形 |
|---|---|
| 用語を足す | 利用者の項目（`terms`）の末尾に足す。読みは「、」か「,」で区切り、省ける。表記が内蔵の用語と同じなら、その用語の読みを変える（下の行と同じ）。表記が利用者の項目にあるとき、内蔵の用語と同じ読みのとき、規則に合わないとき、上限（100個）のときは足さず、理由を一覧の頭に出す。内蔵の用語を使わない設定では、内蔵と同じ表記も利用者の項目として足す |
| 利用者の項目の読みを変える、削除する | その項目をその場で置き換える、または消す |
| 読みを変える | 同じ表記の利用者の項目（`terms`）。利用者の項目は同じ表記の内蔵の用語に勝つので、そのまま置き換わる。内蔵と同じ読みに戻すと、利用者の項目を消す。利用者の項目の上限（100個）に数える |
| 外す | 表記を`removed`に足す。中核は、その表記の内蔵の用語を辞書から除く。読みを変えていたら、その利用者の項目も消す |
| 戻す、元に戻す | その表記の利用者の項目と`removed`の項目を消す。「内蔵の用語をすべて元に戻す」は、内蔵の用語と同じ表記の利用者の項目と`removed`をすべて消す。利用者が自分で足した項目は残す |

- `removed`の各項目は表記の規則（48字まで、`,`と`=`を含まない）で整え、大文字と小文字を区別せずに重複を除く。150個まで受け付ける。空なら保存しない。版上げで内蔵の一覧からなくなった表記が`removed`に残っても、何も起きない。
- 同じ表記の利用者の項目があれば、`removed`にあっても利用者の項目を使う。
- `removed`を持つ設定は、この項目を知らない版（0.5.2まで）では読めない。その版は`REALTIME_ASR_SETTINGS`全体を受け付けずに既定の設定で動き、起動のときに既定を書き戻す。内蔵の用語を外していなければ、項目を保存しないので、前の版でも同じ設定を読める（`silence_duration_ms`と同じ扱い）。
- 設定画面は内蔵の用語の一覧を`/get/data/builtin_vocabulary`（`{"terms": [文字列]}`、アプリに埋め込んだ一覧）で受け取る。一覧は折りたたみで出し、見出しには使っている用語の数だけを出す。自分で足した数、読みを変えた数、外した数は出さない。各行には表記と使っている読みを出し、種類の印は付けない。種類は行の場所と見た目とボタンで分かる。自分で足した用語は一覧の先頭にあり「削除」ができ、読みを変えた内蔵の用語は行に色が付き「元に戻す」ができ、外した用語は取り消し線を付けて行を残し「戻す」で戻せる。内蔵の用語の読みを変えた項目は、利用者の項目でも内蔵の用語の行に出す。内蔵の用語を使わない設定と、内蔵の用語の一覧を受け取る前は、利用者の項目だけを出す。用語を足す欄は、この一覧のほかにない。
- 変更は、字幕のフォームのほかの選択と同じく、すぐに保存する（#1111）。

#### ファイルへの書き出しと読み込み

辞書の一覧の下で、辞書をファイルに書き出し、ファイルから読み込める（#792）。まとめて追加する欄と「用語をコピー」は、これに置き換えた。

- ファイルは使っている辞書の写しである。形は内蔵の用語のデータファイルと同じく1行に1項目の`表記=読み,読み`で、`#`で始まる行は注記である。外した内蔵の用語は書かない。
- 書き出し（`/run/export_vocabulary`）: 画面に出ている辞書（保存の前の下書き）を中核に送る。中核は保存する辞書と同じ規則で確かめ（合わなければ400の`realtime_vocabulary_invalid`）、設定のフォルダーの`exports`に`vocabulary-年月日-時分秒.txt`として書き、ファイルの名前を返す。書くのは、認識が使う辞書（`speechcpp::merged_terms`）のとおりの用語で、順番も同じである。利用者の項目（内蔵の用語の読みの変更を含む）が先で、続けて外していない内蔵の用語を出荷のときの読みで書く。上限の150語も同じである。内蔵の用語を使わない設定では、利用者の項目だけを書く。内蔵の用語を使うかどうかは書かない。書いたあと、画面の「書き出したフォルダーを開く」（`/run/open_filepath_vocabulary_exports`）でフォルダーを開ける。どちらのエンドポイントも、名前に`vocabulary`を含むので`process.log`では値を伏せる。
- 読み込み: 利用者が選んだファイル（256 KBまで）を画面が読み、辞書をファイルの内容に置き換える（`src-ui/logics/transcription/vocabularyTerms.ts`の`importVocabulary`）。内蔵の用語の一覧を受け取るまでは読み込めない。各行は次のように扱う。
  - 内蔵の用語と同じ行（表記も読みも同じ）: その内蔵の用語を出荷のときのまま使う。利用者の項目にはしないので、版上げで読みが直ればそれに従う。
  - 内蔵の用語と同じ表記で読みが違う行: その内蔵の用語の読みの変更（利用者の項目）にする。
  - それ以外の行: 利用者の項目にする。
  - ファイルに行がない内蔵の用語: 外した用語にする。
  - ファイルにない利用者の項目: 消える。
- 同じ表記（大文字と小文字は区別しない）の行が重なったら、最初の行を使う。規則に合わない行、重なった行、利用者の項目の上限（100語）を超えた行は読まずに、数を出す。上限を超えて読まなかった行が内蔵の用語の表記なら、その内蔵の用語は外さずに出荷のときのまま使う。
- 用語の行が1つもないファイルは、辞書を空にせず、何も変えない。
- 内蔵の用語を使うかどうかの切り替えは、読み込みで変わらない。使わない設定では、ファイルにある内蔵の用語と同じ行は使われない。切り替えを入れると、辞書はファイルの内容と同じになる。
- 読み込みのあと、置き換えたあとの辞書の自分で追加した用語、読みを変えた内蔵の用語、外した内蔵の用語の数と、読まなかった行の数を出す。辞書がファイルの内容とすでに同じなら、そう出して下書きは変えない。読み込んだ辞書はすぐに保存する。
- 別の版で書き出したファイルを読み込むと、その版の後で増えた内蔵の用語は、ファイルに行がないので外れる。読みが直った内蔵の用語は、古い読みの行が読みの変更になる。

辞書を変えると、動作中のリアルタイム字幕を停止する（`/set/data/realtime_asr_settings`）。読み上げ、翻訳、クラウドの音声認識は、次のメッセージから新しい辞書を使う。`process.log`には辞書の値を書かない（[秘密情報](cross-cutting.md#秘密情報)）。

### 直接音声の設定（声の変換）

`DIRECT_VOICE_SETTINGS`の`engine`は`rvc`だけを受け付け、既定も`rvc`である。Seed-VCはPythonのバックエンドで動いていたので、Pythonとともに終わった。`/set/data/direct_voice_settings`に`engine: "seed-vc"`を送ると、何も保存せず400の`{"error_code": "vc_engine_unavailable", "settings": <保存値>}`を返す。そのほかの不正な値は従来どおり`vc_settings_invalid`である。以前の版が保存した`seed-vc`は、読み込むときに`rvc`へ移す。ほかの項目（`mode`、RVCのパス、Seed-VCの`runtime`と`reference`）はそのまま残すので、0.4の版でも読める。`mode`が`converted`だったときだけ、その起動のあいだ`/get/data/direct_voice_state`に`"notice": "seed_vc_moved_to_rvc"`を付け、RVCのページに「Seed-VCは使えなくなったため、声の変換をRVCに切り替えました」と出す。設定を保存し直すと消える。変換は自動では始めない。RVCのモデルが未設定なら、メイン画面のRVCのスイッチは設定を求める。

RVCの変換でマイクの音声を区切る長さは、`DIRECT_VOICE_SETTINGS`とは別の`RVC_BLOCK_MS`に保存する（#531）。値はミリ秒の整数で、0（自動）か20〜200の20の倍数を受け付け、既定は0である。`DIRECT_VOICE_SETTINGS`に入れないのは、知らない項目があると以前の版がその値全体を読まず、モデルとインデックスのパスまで既定に戻すためである。最上位のキーなので、知らないキーを残す版（#629）はこのキーを残す。それより前の版は知らないキーとして消して保存するが、ほかの設定は変えない。設定画面の「高度な設定」で`/set/data/rvc_block_ms`を使って変える。画面では「自動」と20〜200 msから選ぶ。0でも範囲内の20の倍数でもない値と、整数に読めない値は保存せず、400の`VALIDATION_RVC_BLOCK_MS`と保存値を返す。`config.json`にそういう値があれば、読み込むときに既定の0に戻す。中核は変換を始めるたびにこの値を読み、ワーカーに`--block-ms`で渡す（0は`--block-ms auto`）。長さを選んだときは、ワーカーが`ready`の`block_frames`でその長さを返し、違えば開始は`vc_ready_invalid`で失敗する。自動のときは、ワーカーが読み込みの最後にテスト音で40 msのブロックをGPUで変換して時間を測る。40、60、80、100、120、160、200 msのうち、その時間の1.4倍が収まるいちばん短い長さを選んで`ready`の`block_frames`で返す。どれも収まらなければ200 msを使う。CPUでは40 msにする。中核はその長さで変換する。ワーカーは選んだ長さを`<state>/vc_runtimes/rvc-block-lengths.json`に記録し、同じ声のモデルと同じGPUで次に開始したときは、測り直さずにその長さを使う。記録の鍵は、声のモデル（パス、大きさ、更新日時）、使うときのインデックス、デバイス、GPUの名前、ONNX Runtimeのライブラリ、スレッド数をまとめたハッシュで、ファイルにはハッシュと長さだけを書く。読めないファイルは、ないものとして測り直す。利用者が「高度な設定」で「自動」を選ぶと（すでに「自動」のときも）、中核は`/set/data/rvc_block_ms`で0を保存したあと、同じフォルダーに`rvc-block-lengths.remeasure`を置く。このファイルがあると、ワーカーは次に自動で開始したとき、記録した長さを使わずにGPUを測り直す。その声のモデルとGPUの記録を新しい長さで置き換え、ファイルを消す。ほかの組み合わせの記録は残す（2026-11-21に決定）。すべてを測り直させるには、記録のファイルを消す（2026-11-20に決定、[ボイスチェンジャーの低遅延化](../voice-stack/rvc-low-latency-2026-11-20.md)）。この値は0.6.0より前のリリースにはないので、移し替えはしない。開発中のビルドで保存した長さも、利用者が選んだ長さとして扱う（2026-11-20に決定）。動いている変換の長さは`/get/data/direct_voice_state`の`conversion_block_ms`にあり、RVCのページの遅れの目安はこの値を足して出す。値を変えても、動いている変換は変えない。次に開始したときから使う。GPUでは1ブロックを1回で変換するので、短いほど遅れは小さいが、変換が間に合わないブロックが増える。CPUでは、この長さにかかわらず0.5秒ずつまとめて変換する。

### 読み上げのサーバー

`VOICE_SETTINGS`の`japanese_server`と`multilingual_server`はspeech.cppのサーバーを同梱サーバー（`bundled`）と外部サーバー（`external`）のどちらにするかを表す。新しい設定の既定は`bundled`である（#566）。それより前は`external`が既定で、日本語は`japanese_url`の既定の`http://127.0.0.1:8080`に接続していた。

保存した設定があり、その`VOICE_SETTINGS`にこの項目がないときは、その項目を`external`にする（中核の`Config::migrate_speech_servers`、Pythonの`Config._migrateSpeechServers`）。前の版の既定のまま外部サーバーを使っていた人が、更新で同梱サーバーに移らないようにするためである。`VOICE_SETTINGS`がない設定や、オブジェクトでない設定も同じに扱う。2つの項目は別々に決め、保存してある値は変えない。何も保存していない設定と読めないファイルは新しく入れたときと同じで、`bundled`のままになる。段階は記録しない（[config.json](#configjson)）。

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

- 入力欄からは`/run/send_message_box`に`{"id", "message"}`を送り、応答で上の形を受け取る。UIは送る前に行を「送信中…」として出し、200の応答で送信中を解除する。同じ行のIDと時刻を保ち、応答の`original`と`translations`に読みも含めて更新する。Quick Chatからの送信とVRパネルに映す行も同じ処理を使う。デスクトップでは待機中のアイコンが回転し、VRパネルでは動かない文言で示す。
- 通信失敗、400・404・423・500の応答、バックエンドの停止では、該当する送信中の行を`status: "failed"`にし、本文を残して「送信を確認できません」と表示する。自動では再送しない。エラー応答にIDがない場合は送信中の全行を対象にする。その後にID付きの200が届けば、その行の状態、読みを含む原文と訳を更新する。
- 各出力の失敗は、別の400通知`/run/message_output_error`でも知らせる。`result.data`は`{id, source, output, error_code}`で、`id`がない入力では`null`。`source`は`chat`・`mic`・`speaker`・`ocr`、`output`は`osc`・`overlay_small`・`overlay_large`・`clipboard`・`ui`・`websocket`・`logger`・`history`・`tts`のいずれか。本文や例外の詳細は入れない。UIへの通常通知の後に失敗する出力もあるため、全入力元の失敗通知をこの経路で扱う。送信行を失敗扱いにせず、出力先ごとに警告を表示する。
- マイクは`/run/transcription_send_mic_message`、スピーカーは`/run/transcription_receive_speaker_message`、OCRは`/run/transcription_ocr_message`で届く。

### リアルタイム字幕と配送結果

リアルタイム音声認識は200の`/run/realtime_caption`で通知する。行は`source`（`mic`・`speaker`）、`generation`、`namespace`、`item_id`の組で識別する。`revision`は同じ行の更新番号である。

`partial`は認識途中、`final`は認識の確定であり、どちらも配送完了ではない。`text`に認識文、`translations`に訳の配列を持つ。`translated`は原文の読みを含む`original`と`translations`を更新するが、配送の待機は解除しない。`discarded`は空の確定結果や、表示前に期限が切れた字幕を退役させる。

`speakers`は、その発話で話した人のラベルの配列である（`["A"]`、`["A", "B"]`）。サーバーが話者分離モデルを持つときの、スピーカーの`final`と`translated`だけが値を持つ。`partial`とマイクの行、話者分離をしないときは空の配列である。ラベルは大文字1〜3字で最大4個、話しはじめた順に並ぶ。0.4秒以上話した声を数え、どの声もそれに満たなければ最も長い声を1つ入れる。ラベルは1つのセッションの中で声を区別する記号であり、人の名前ではない。セッションが変わると振り直される。話者分離の推定は誤ることがある。行は`speakers`として保持し、ログでは状態の表示の隣に「話者A・B」と出す。

#### 話者の名前と話者ごとのまとまり

利用者はラベルにセッションごとの名前を付けられる（#447）。ログの話者の表示はボタンで、押すと行の下に名前の欄が開く。保存すると、UIは`/set/data/speaker_names`に`{"namespace": セッション, "names": {"A": "名前", ...}}`を送る。`names`はそのセッションの名前の全部で、送らなかったラベルと空の名前は名前なしに戻る。中核は、`namespace`が英数字と`-`、`_`の128字まで、ラベルが大文字1〜3字、名前が制御文字なしの32字まで（連続する空白は1つにまとめる）、ラベルが8個までのときだけ受け付け、`{"namespace": ..., "names": {...}}`を返す。それ以外は400の`speaker_names_invalid`である。

- 名前は保存しない。UIは返った名前を直近8セッション分、中核はSteamVRの字幕用に直近4セッション分を持つ。セッションが変わるとラベルは振り直されるので、前のセッションの名前は新しいセッションに当てない。
- `process.log`には名前を書かない（`speaker_names`は`SENSITIVE_ENDPOINT_MARKERS`に入っている）。
- 名前のある声は、ログ、VRパネルのログ（同期するatomの`SpeakerNames`）、デスクトップの字幕（`speaker_names`）、SteamVRの字幕（一行と複数行）で、ラベルの代わりに名前で出す。名前のない声は、ほかの声に名前があれば「話者B」、どの声にも名前がなければ今までどおり「話者A・B」と出す。デスクトップの字幕の色はラベルで決め、名前を付けても変わらない。
- SteamVRの大きいログは受信の見出し（時刻と「Receive」）の後ろに話者を「ミカ·B」の形で出す。48字を超えると「…」で切る。名前を付けると、そのセッションの字幕を表示中なら描き直す。
- SteamVRの一行の字幕は、文の上の行に話者を同じ形で出す。名前を付けても表示中の字幕は描き直さず、次の字幕から名前で出す。
- ログでは、同じセッションで同じ話者の行が続くとき、2行目からは時刻だけを出し、状態と話者の表示を省く。スクリーンリーダーには話者を読ませる。処理中や失敗の行は省かない。VRパネルでは名前を付けられない（表示だけ）。

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
| 実験的機能（`EXPERIMENTAL_FEATURES`） | `{機能のID: 真偽値}`。一覧にある機能をすべて持ち、既定はどれも`false`。要求に含めなかった機能は今の値のまま。一覧にないIDは捨てる（卒業や廃止で消えた機能の保存値が残っていても読み込める）。真偽値でない値を含むと全体を拒否する。機能の一覧は`src-ui/logics/configs/experimentalFeatures.ts`と`native/core/src/config/schema.rs`の2か所にある（0.5まではPythonの[`src-python/models/experimental_features.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/experimental_features.py)にもあった）。今の機能は`tray_companion`（[六芒星のオーバーレイ](cross-cutting.md#六芒星のオーバーレイtray_companion)）だけ |
| 六芒星のオーバーレイで六芒星を隠す端（`TRAY_COMPANION_EDGE`） | `right`、`left`、`top`、`bottom` のどれか。既定は`right`。実験的機能の六芒星のオーバーレイがオフの間も値は残す。ほかの値は拒否する（[六芒星のオーバーレイ](cross-cutting.md#六芒星のオーバーレイtray_companion)） |
| 六芒星のオーバーレイで六芒星を出すモニター（`TRAY_COMPANION_MONITOR`） | システムがモニターに付けた名前。空はメインのモニター（既定）。256文字までで、制御文字は拒否する。選んだモニターが外されていても値は残し、その間はメインのモニターを使う（[六芒星のオーバーレイ](cross-cutting.md#六芒星のオーバーレイtray_companion)） |
| 六芒星のオーバーレイがホイールで回せることを知らせたか（`TRAY_COMPANION_WHEEL_HINT_SHOWN`） | 真偽値。既定は`false`。六芒星が初めて出たときに知らせ、`true`にする。`true`の間は知らせない（[六芒星のオーバーレイ](cross-cutting.md#六芒星のオーバーレイtray_companion)、#536） |
| 用途（`USAGE_PRESETS`） | `basic`、`nonverbal`、`multilingual`、`voice_changer`、`all`のうち1つ以上の配列。この順に、重複なしで保存する。知らないIDは除き（後の版で増えたもの）、知っているIDが1つもなければ拒否する。保存は即時。新しく入れたときの既定は`["basic"]`で、前の版から更新したとき（保存した設定があり、このキーがない）は`["all"]`にする。表示する機能を絞るだけで、ほかの設定は変えない（[用途別プリセット](cross-cutting.md#用途別プリセット)） |
| 0.4までの取得の同意（`LEGACY_MODEL_DOWNLOAD_CONSENTS`） | モデルIDから文字列への辞書で、既定は`{}`。0.4までのPythonバックエンドが、CTranslate2の翻訳モデルの取得に同意したときに記録していた。CTranslate2の取得は0.5.0で中核から、その確認画面は#1015で画面から消えた。中核はこのキーを、値がすべて文字列の辞書として読み書きして残すだけで、値を計算も記録もしない（`native/core/src/config/schema.rs`）。ローカル翻訳のモデルは、ほかのモデルと同じ取得の確認と同意で取る（[モデル取得](../voice-stack/model-downloads.md)） |
| 重みの取得状態 | 一覧は {種類: 取得済みか}。受付は {weight_type, job_id}。進捗は {weight_type, job_id, progress}、成功通知は {weight_type, job_id, downloaded: true}。失敗通知はエラー本体のdataに {weight_type, job_id, downloaded: false, reason} を入れる。進行中の同じ重みへの重複要求を拒否する場合はactive_job_idも付ける |
| エンジンの状態 | `{エンジン名: 使えるか}`。使えるエンジンの一覧は`selectable_*_engines`で配列として返す |
| エラー | [IPCプロトコル](ipc-protocol.md#エラーの本体) |

## config.json

- 置き場所は`$ASTAROT_CONFIG_DIR`（0.6.xの間は`$VRCT_CONFIG_DIR`も読む）、なければ実行ファイルのあるフォルダ（開発中は`src-tauri/target/debug/`など。0.4までのPythonバックエンドでは`src-python/`）。Linuxの配布版では0.6.0から`$XDG_CONFIG_HOME/astarot`（なければ`~/.config/astarot`）である。0.5.x までの`vrct-vox`のフォルダーは、起動の最初に移す（[Linuxの保存先の移動](#linuxの保存先の移動)）。Windowsのインストーラー版で、0.5.0以前の既定のインストール先`%LOCALAPPDATA%\VRCT-VOX`にあるものは、0.7.0からのインストーラーが`%LOCALAPPDATA%\ASTAROT`へ移す（[Windowsのインストール先の移動](#windowsのインストール先の移動)）。フォルダ名は保存先の識別子なので、変えるには移行の処理がいる（`docs/voice-stack/project-rename.md`）。
- 設定は中核の`native/core/src/config/schema.rs`の`keys()`で宣言し、既定値は`defaults()`にある（0.4までのPythonの`Config`クラスの`ManagedProperty`と`ValidatedProperty`を写したもの）。`serialize`が真のものだけを保存する。オンオフの状態（`ENABLE_*`）や選択肢の一覧は保存しない。
- 単純な設定プロパティは、未選択を表すモデル名と音声認識エンジンを除き`null`を受け付けない。APIキーやホットキーの辞書内にある未設定の`null`は維持する。数値のプロパティとオーバーレイの数値設定は`NaN`・無限大（`1e999`などの桁あふれも含む）を保存前に拒否する。不正な保存値は既定値へ戻す。メッセージ欄の比率と大小字幕の設定変更では400の`VALIDATION_CONFIG_VALUE_INVALID`を返し、`data`には保持した設定値を入れる。
- 読み込みでは、各キーを検証してから設定する。知らないキーは使わないが、ファイルにあったままの値を保存する設定の後ろに書き戻す。新しい版の設定を古い版で開いて保存しても、新しい版に戻ったときにその設定が残るようにするためである（#560）。以前の版が保存し、今の版で廃止したキー（`native/core/src/config/mod.rs`の`RETIRED_KEYS`。#288でローカルのWhisperとともに削除した5つ）だけは捨てる。キーを廃止するときは、このリストにも加える。検証に通らないキーは既定値のままにしてerror.logに残す。ただし、自分より新しい版が保存した値は、検証に通らなくても（新しい版で足した選択肢など）使わずにファイルへそのまま書き戻し、この版で利用者がその設定を変えたときだけ新しい値を書く（#560）。どの版が保存したかは、ファイルに書く`NEWEST_SAVING_VERSION`（保存した版のうち最も新しいもの。古い版で保存しても下がらない）で見分ける。設定キーではないので、一覧には載らない。自分と同じか古い版が保存した無効な値と、この印のないファイルの無効な値は、これまでどおり保存しない。ただしマイクとスピーカーの選択（`SELECTED_MIC_HOST`、`SELECTED_MIC_DEVICE`、`SELECTED_SPEAKER_DEVICE`）は、読み込む時点でデバイスの一覧がまだ取れていないため、保存値をそのまま受け取る。一覧が取れたあと、サイドカーがデバイスの有無を確かめ、無ければ既定のデバイスに戻す。JSONとして読めない、またはオブジェクトでないときは、そのファイルを名前の重複しない`config.json.unreadable-<日時>-<乱数>`に移して残し、既定値で起動する。UIは`/run/config_file_unreadable`を受けて、既定値で起動したことと残したファイルの場所を知らせる。
- メモリー上の初期値をすべて用意してからログ用ディレクトリを作る。ログ用ディレクトリを作れなくても、設定の初期化は完了させる。それ以外の初期化が途中で失敗したときは、不完全なインスタンスを公開せず、設定の読み込みも保存も行わない。読み込み中は保存せず、全項目の適用と移行が終わってから1回だけ保存する。ただし、書く内容がファイルと同じなら書かない（キーの順は比べない。Unixでは所有者のほかにも読めるファイルなら書き直す）。Python版は起動のたびに書いていた（#560）。読み取り権限の不足や退避の失敗では元のファイルを残し、[保存の失敗通知](cross-cutting.md#サイドカーでの保存)を出して以後の保存を止める。
- 版番号はない。0.5 まではローカル音声認識の移行の段階を`LOCAL_ASR_MIGRATION`に記録して使っていた。0.6.0 は移行を行わず、0.5 以前の版のために`2`を書くだけである（[ローカル音声認識の移行](#ローカル音声認識の移行)）。用途（`USAGE_PRESETS`）は段階を記録しない。保存した設定があってこのキーがなければ、前の版から更新したと見なして`["all"]`にする。読めないファイルは何も保存していないのと同じに扱うので、新しく入れたときの`["basic"]`になる。読み上げのサーバー（`VOICE_SETTINGS`の`japanese_server`と`multilingual_server`）も同じ考え方で、保存した設定にない項目は前の版の既定の`external`にする（[読み上げのサーバー](#読み上げのサーバー)）。0.5 までは移行する前の内容を`config.json.before-migration-<段階>`に残していた（[失敗したときに保つもの](failure-recovery.md#設定)）。入れ子の設定のうち`SPEECH_SERVER_SETTINGS`と`REALTIME_ASR_SETTINGS`は`"version": 1`を持つ。
- `OVERLAY_VR_LAUNCHER_SETTINGS`の`ui_scaling`は、ランチャーの帯が952px幅だとしたときの横幅（m）である。帯が880px幅になっても意味を変えない。版番号がなく移行済みかどうかを区別できないので保存値は書き換えず、実際の横幅を880/952倍して求める。保存値のまま、ボタンの大きさが変わらない。
- 保存済みの言語・翻訳エンジンの辞書が壊れているときは、不足・不正なタブや枠を既定値で補い、正常な部分は読み込む。余分なキーは捨てる。実行中の更新に対する構造の検証とは区別し、壊れた辞書で起動を妨げない。
- 書き込みは[横断的な振る舞い](cross-cutting.md#サイドカーでの保存)のとおり、2秒の遅延、0600の一時ファイル、`fsync`、置き換えの順に行う。
- 起動のたびに直す値がある: `SELECTED_RELEASE_CHANNEL`は、利用者が選んでいなければ（`RELEASE_CHANNEL_CHOSEN`が`false`）版から決め直す。選んだ値は残す（#466、[更新](external-interfaces.md)）。インストーラーが置いた`installer_language.txt`があればUIの言語にして消す。WebSocketのトークンは初回と不正な保存値の修復時に作って保存する（[ネットワーク設定](#ネットワーク設定)）。

### Linuxの保存先の移動

0.6.0から、Linuxの配布版は設定のフォルダーとデータのフォルダーを`vrct-vox`から`astarot`へ移す（ADR-014の2.4）。アプリは起動の最初、フォルダーの中を読む前に、2つのフォルダーをそれぞれ1回だけ決める（`native/core/src/storage/linux.rs`の`settle`。呼ぶのは`src-tauri/src/backend_host.rs`の`settle_folders`）。その起動のあいだ、どこから読んでも同じフォルダーになる。

- 環境変数（`ASTAROT_CONFIG_DIR`、`ASTAROT_DATA_DIR`と旧名）で指定したフォルダーは、そのまま使う。移さない。
- 旧のフォルダーだけがあるとき: 新しい名前に名前を変えて移す。親のフォルダーが同じなので、大きなモデルもコピーせずにすぐ移る。旧の名前には新しいフォルダーを指すシンボリックリンク（中身は`astarot`）を置く。0.5.xに戻しても、旧のパスを書いたスクリプトからも、同じファイルを読める。続けて、保存したファイルの中の旧のフォルダーの下を指す絶対パスを付け替える（`native/core/src/storage/mod.rs`の`relocate_saved_paths`）。
- どちらもないとき: 新しいフォルダーを作る。
- 新しいフォルダーにアプリの記録があるとき: 新しいフォルダーを使い、旧の名前のものには触れない。0.5.xが作り直した旧のフォルダーがあっても使わない。リンクを消されていて旧の名前に何もなければ、リンクを置き直す。
- 記録のない新しいフォルダーと旧のフォルダーが両方あるとき: 新しいフォルダーはアプリが作ったものと確かめられないので使わず、何も書かない。旧のフォルダーを使う。新しいフォルダーだけがあるときは、それを使って記録を置く。
- 移せないとき（ほかのASTAROTかVRCT-VOXが動いている、セッションバスに問い合わせられない、別のファイルシステム、権限がない、など）: 旧のフォルダーをそのまま使い、次の起動でまた試す。動いているかどうかは、旧のアプリIDと新しいアプリIDの単一起動の名前（`<アプリID>.SingleInstance`）がセッションバスで使われているかで判定する。自分の単一起動の名前を取る前に問い合わせる。

付け替えの対象は、設定のフォルダーの`config.json`、`user_models.json`、`translation_catalog.json`である。JSONの値の文字列のうち、移したフォルダーそのものか、区切り文字に続けてその下を指すものだけを変える（`/a/vrct-vox-old`は`/a/vrct-vox`の下ではない）。保存先の外のパス（利用者が別の場所に置いたモデルなど）とキーの名前は変えない。親のフォルダーをたどった形（`/home`が`/var/home`へのリンクのときなど）も同じに扱う。旧のフォルダーそのものがリンクだったときは、リンクだけが移り、リンクの先のパスは変えない。`config.json`は書き換える前の内容を`config.json.before-migration-storage`に残す（APIキーは除く。すでにあれば残す）。写しを書けなければ`config.json`を書き換えない。付け替えなかったパスも、旧の名前のリンクを通して読める。

新しい名前のフォルダーには、それぞれ`storage_migration.json`（`{"version": 1, "state": 状態, "from": 旧のフォルダー}`）を置く。状態は`created`（新しく作った）、`moving`（移している途中）、`done`（移し終えた）。移すときは、名前を変える前に旧のフォルダーへ`moving`の記録を書き、ファイルと一緒に移す。途中で止まった起動のあとは、次の起動が`moving`の記録を見つけて、リンクと付け替えを済ませて`done`にする。付け替えに失敗したときは`moving`のまま残し、次の起動でやり直す。名前の変更に失敗したときは、旧のフォルダーに書いた記録を消す。

結果は`startup.log`に1行だけ書く。`Storage folders: settings=<結果> data=<結果>`で、結果は`given`、`created`、`moved`、`finished`、`in_place`、`kept_old:<理由>`のどれか。理由は`app_running`、`instance_check_unavailable`、`new_folder_not_ours`、`cross_device`、`permission_denied`、`busy`、`new_folder_appeared`、`rename_failed`、`record_failed`、`path_not_utf8`。付け替えた起動では` paths=rewritten`（変えるものがなければ`unchanged`、失敗は`failed`）、リンクを置けなければ` settings_link=failed`か` data_link=failed`を足す。パス、設定の値、APIキーは書かない。

WindowsとLinuxの開発ビルドは、これまでどおり実行ファイルのフォルダーを使い、移さない。

### Windowsのインストール先の移動

0.7.0から、Windowsのインストーラーは0.5.0以前の既定のインストール先`%LOCALAPPDATA%\VRCT-VOX`を`%LOCALAPPDATA%\ASTAROT`へ移し、レジストリのキーを`VRCT-VOX`から`ASTAROT`の名前へ移す（ADR-014の2.5）。Windowsでは設定、ログ、モデルがインストール先にあるので、インストール先を移すと利用者のデータも一緒に移る。画面から実行したときも、アプリ内の更新から`/P /UPDATE`で実行したときも同じに動く（`src-tauri/nsis/template.nsi`）。

- 前のインストール先は`HKCU\Software\kein5\ASTAROT`から読み、なければ0.6.xまでの`HKCU\Software\kein5\VRCT-VOX`から読む。アプリの一覧の項目も、`Uninstall\ASTAROT`がなければ`Uninstall\VRCT-VOX`を読む。旧のキーにある`Installer Language`は、新しいキーになければ写す。
- 移すのは、前のインストール先が`%LOCALAPPDATA%\VRCT-VOX`のときだけである。大文字と小文字の違い、末尾の`\`、8.3形式の短い名前は同じフォルダーとして扱う。利用者が選んだほかの場所は、名前が`VRCT-VOX`でも動かさない。0.5.1以降に新しく入れた環境はすでに`%LOCALAPPDATA%\ASTAROT`にあるので、キーだけを移す。インストーラーの画面では、インストール先のページに移す先を出す。そこで別のフォルダーを選んだときと、`/D=`でフォルダーを指定したときは移さず、そのフォルダーに入れる。
- 更新は元の場所でこれまでどおりに行う。その前に、インストール先から動いている本体と補助プログラム（`vrct-vox.exe`、`astarot.exe`、`vrct-rvc-worker.exe`、`astarot-rvc-worker.exe`、0.4までのサイドカー）を止め、前の更新の作業フォルダー（`.upd`）を片付ける。speech.cppのサーバー（`speech.exe`、`llama-server.exe`）はほかのプログラムも使う名前なので名前では止めない。アプリがジョブオブジェクトに入れているので、アプリが終わると一緒に終わる。
- 新しいファイルがそろってから、フォルダーの名前を変えて移す。同じドライブの中で名前を変えるだけで、写してから消すことはしない。移す先にフォルダーがあって空でないとき、名前を変えられないとき（ほかのプログラムがファイルを開いているなど。0.5秒おきに10回試す）は、移さずに元の場所で終える。次の更新でまた試す。空のフォルダーは置き換える。
- 名前を変える前に、移すフォルダーへ`installer_moved_from.txt`を置く。中身は旧のフォルダーのパスで、バイト順マークの付いたUTF-16で書く。ファイルはフォルダーと一緒に移る。名前を変えられなかったときは消す。
- 移したあと、インストーラーはデスクトップとスタートメニューのショートカットのうち残っているものを新しい場所に付け替える。利用者が消したショートカットは作り直さない。タスクバーやスタートにピン留めした項目は変えない（プログラムからはピン留めし直せない）。
- 続けて新しいキー（インストール先と、アプリの一覧の`Uninstall\ASTAROT`）を書き、そのあとで旧のキー（`Software\kein5\VRCT-VOX`と`Uninstall\VRCT-VOX`）を消す。アプリの一覧には1つだけが残る。旧のキーが別のフォルダーを指し、そこにアンインストーラーが残っているときは、別のインストールのキーとして残す。移さなかったときも、キーは新しい名前で元の場所を記録する。
- 旧の場所にリンクやジャンクションは置かない。古い版のアンインストーラーなど、リンクを想定していない削除の処理がリンクの先のデータに触れないようにするためである。
- 名前を変えたあと、キーを書く前に止まったときは、旧のキーが旧の場所を指したまま残る。次の更新は、旧の場所がなく新しい場所にインストールがあるのを見て移動の続きと判断し、ショートカットとキーを直す。
- アンインストーラーは新しいキーを消し、旧のキーもこのインストールを指していれば消す。`installer_moved_from.txt`も消す。

アプリは次の起動の最初、`config.json`を読む前に`installer_moved_from.txt`を読む（`native/core/src/storage/installer.rs`の`take_installer_move`。呼ぶのは`src-tauri/src/backend_host.rs`の`settle_folders`）。設定のフォルダーのファイルの中で旧のフォルダーの下を指すパスを、実行ファイルのフォルダーの同じ場所へ付け替えてから、ファイルを消す。付け替えの対象と`config.json.before-migration-storage`の写しは[Linuxの保存先の移動](#linuxの保存先の移動)と同じである。Windowsではパスを大文字と小文字を区別せずに比べ、`\`と`/`を同じ区切りとして扱う。旧のフォルダーが実行ファイルのフォルダーと同じ親フォルダーにあったときは、その親フォルダーを別の書き方でたどったパスも付け替える。

- 付け替えに失敗したときはファイルを残し、次の起動でやり直す。
- ファイルの中身が1つの絶対パスでないとき（空、文字として読めない、複数の行など）と、実行ファイルのフォルダーそのものを指すときは、何も変えずにファイルを消す。
- 結果は`startup.log`に`Storage folders: installer_move=<結果>`の1行で書く。結果は`rewritten`、`unchanged`、`ignored`、`failed`のどれか。ファイルを消せなかったときは` installer_move_file=kept`を足す。パスと設定の値は書かない。

ZIP版は展開した場所で動くので、移さない。

### 本体の実行ファイルの名前

0.7.0から、本体の実行ファイルはWindowsでは`astarot.exe`、Linuxでは`astarot`である。0.6.xまでは`vrct-vox.exe`と`vrct-vox`だった（ADR-014の2.5と2.6）。保存先は実行ファイルの名前によらない（Windowsは実行ファイルのフォルダー、Linuxの配布版は上のXDGのフォルダー）ので、名前が変わっても設定とモデルはそのまま読む。

Windowsのインストーラー（`src-tauri/nsis/template.nsi`）は、画面から実行したときも、アプリ内の更新から`/P /UPDATE /R`で実行したときも、次のとおりに動く。

- 動いている本体を新旧どちらの名前でも探す。画面から実行したときは、どちらの名前でも閉じてよいかを聞いてから止める。
- 取得したパッケージの本体は、新旧どちらの名前でも受け付ける（`/VERSION`で別の版を入れるとき）。入れた名前を、アプリの一覧（`MainBinaryName`と`DisplayIcon`）、ショートカット、`/R`での再起動、完了のページからの起動に使う。
- 置き換えが済んだあとで、もう一方の名前の本体が残っていれば、インストーラーが作ったショートカット（デスクトップとスタートメニュー）のうち残っているものを、入れた本体に付け替える。そのあとで、もう一方の名前の本体を消す。消せなかったときは次の更新でまた付け替えて消す。利用者が消したショートカットは作り直さない。利用者が別の名前で作ったショートカットと、タスクバーやスタートにピン留めした項目は変えない。
- 同じ名前のままの更新では、ショートカットに触れない。
- アンインストーラーは両方の名前の本体を消す。

ZIP版は展開した場所で動く。前の版の上に展開すると`vrct-vox.exe`が残るので、利用者が消す。

Linuxでは、debとrpmが`/opt/astarot/astarot`を入れ、コマンド`/usr/bin/astarot`を置く。0.6.xまでのコマンド`/usr/bin/vrct-vox`も同じ実行ファイルを起動する（下の[Linuxのパッケージの名前](#linuxのパッケージの名前)）。AppImageの中の実行ファイルは`usr/bin/astarot`である。パッケージのデスクトップファイルと、アプリがWaylandのportalのために書くデスクトップファイル（下の表の`io.github.kein5.astarot.desktop`）は、`StartupWMClass`を`astarot`にする。ウィンドウのクラスは実行ファイルの名前から決まるためである。パッケージのデスクトップファイルの`Exec`も`astarot`である。

### Linuxのパッケージの名前

0.7.0から、Linuxのパッケージの名前と置き場所は`astarot`である。0.6.xまでは`vrct-vox`だった（ADR-014の2.7）。設定とモデルはXDGのフォルダーにあり、パッケージの置き場所にはないので、パッケージの名前が変わってもそのまま読む。

| 対象 | 0.7.0から | 0.6.xまで |
|---|---|---|
| debとrpmのパッケージ名 | `astarot` | `vrct-vox` |
| debとrpmの置き場所 | `/opt/astarot`（`package-manager`の印もここ） | `/opt/vrct-vox` |
| コマンド | `/usr/bin/astarot`。0.7.xの間は`/usr/bin/vrct-vox`も置く | `/usr/bin/vrct-vox` |
| デスクトップファイルとアイコン | `astarot.desktop`、`astarot.png` | `vrct-vox.desktop`、`vrct-vox.png` |
| AppImageの中の同梱のファイル | `usr/lib/astarot/_internal` | `usr/lib/vrct-vox/_internal` |
| tar.gzを展開したフォルダー | `ASTAROT` | `VRCT-VOX` |

- 新しいパッケージは旧のパッケージを置き換える。debは`vrct-vox`と衝突し（`Conflicts`）、置き換え（`Replaces`）、それを提供する（`Provides`）。rpmは`vrct-vox`を廃止し（`Obsoletes`、新しい版より前のもの）、それを提供する（`Provides`）。新しいファイルを`apt install`や`dnf install`で入れると旧のパッケージが消え、アプリの一覧にASTAROTが1つだけ出る。
- `/usr/bin/vrct-vox`は0.8.0で外す（`tools/linux_packages.py`の`LEGACY_COMMAND_UNTIL`）。
- アプリは同梱のファイルを実行ファイルの隣の`_internal`と、AppImageの`usr/lib/astarot/_internal`で探す（`native/core/src/resources.rs`）。どの版も自分の同梱のファイルを持つので、旧の名前の場所は探さない。
- 更新の種類は、実行ファイルの隣の`package-manager`で判定する（[外部とのインターフェース](external-interfaces.md#アプリの更新)）。置き場所が変わっても判定は変わらない。

### Linuxの音声経路の名前の移行

0.6.0の次の版から、Linuxの管理対象の経路（仮想マイク）はASTAROTの名前で作る（ADR-014の2.8）。名前の定義は`native/app-identity`の`audio_route`にあり、旧名との組で持つ。

| 対象 | 0.6.0まで | 新しい名前 |
|---|---|---|
| ノード | `vrct.managed.source`など | `astarot.managed.source`など |
| ノードの説明（VRChatのマイクの一覧に出る） | `VRCT Managed Virtual Microphone`など | `ASTAROT Managed Virtual Microphone`など |
| ノードの印と所有者 | `vrct.managed.route`、`vrct.managed.owner`=`vrct-vox-service-v1` | `astarot.managed.route`、`astarot.managed.owner`=`astarot-service-v1` |
| systemdのユーザーユニット | `vrct-managed-{source,tts,vc}.service` | `astarot-managed-{source,tts,vc}.service` |
| 手で置く設定 | `90-vrct-managed.conf` | `90-astarot-managed.conf` |
| 一時のストリーム | `vrct.source-bridge.*`、`vrct.asr.capture.*`、`vrct.tts`など | `astarot.source-bridge.*`、`astarot.asr.capture.*`、`astarot.tts`など |

中核は管理対象の経路を準備するたびに（経路を保存したとき、経路を保存してある起動のとき、経路のノードが見つからなくなったとき）次のとおり移す。利用者が経路を選んでいなければ、旧の経路には触れない。

- 旧の名前のユニットは、名前、所有者識別子、中身がどれも0.6.0までの中核の書いたものと一致し、systemdがそのファイルをドロップインなしで読んでいるときだけ、止めて無効にし、消す。中身は`ExecStart`の`pw-loopback`のパスを除いてバイト単位で比べる。1つでも一致しないユニットがあれば3つとも利用者のものとして残す。新しい経路がまだないときは`managed_setup_conflict`を返し、新しい経路を作らない。仮想マイクが2つ並ぶのを避けるためである。
- 旧の名前のノードのうち中核の所有者識別子がないもの（手で作った旧の経路）があるときも、`managed_setup_conflict`を返す。
- 手で置いた設定は、新旧どちらの名前でも`$XDG_CONFIG_HOME/pipewire/pipewire.conf.d`と`/etc/pipewire/pipewire.conf.d`で探す。経路がまだないときに見つけたら、自動で作らない。新しい名前なら`managed_setup_manual_config_pending`、旧の名前なら`managed_setup_manual_config_legacy`を返す。
- 旧のユニットを消したら、新しい名前で作り直す。新しい仮想マイクは今までどおりミュートで始まり、利用者が「ミュートを解除」を押すまで音を出さない。
- 新しい経路がすでに動いていても、中核の旧のユニットが残っていれば止めて消す（0.6.0に戻して戻ってきたときなど）。
- 旧の名前の接頭辞（`vrct.managed.`、`vrct.source-bridge.`、`vrct.asr.capture.`）と印のノードは、新しい名前と同じく入力、モニター、音声認識の候補から外す。

旧のユニットを止めたとき、中核は`MANAGED_ROUTE_RENAME_NOTICE_PENDING`（真偽値、既定は`false`、保存する）を真にし、`process.log`に`[voice] the managed route retired its legacy units`の1行を書く。真の間は`/get/data/voice_route`の応答に`"notice": "managed_route_renamed"`が付き、音声経路の欄にVRChatでマイクを選び直す案内が出る。利用者が案内を閉じると`/set/disable/managed_route_rename_notice`を送り、偽にする。応答は案内のない音声経路の状態である。新しい経路の準備に失敗しても、旧のユニットを止めたあとなら案内を残す。

旧の名前を読む（旧の接頭辞のノードとストリームを候補から外す、旧の名前の手で置いた設定を見つける、中核のものでない旧の経路を知らせる）のは`audio_route::READS_LEGACY_NAMES`が真の間で、新しい名前を出した版の系列の間である（0.7.0で出せば0.7.xの間）。旧のユニットの片付け（0.6.0までの中核が書いたものと完全に一致するユニットだけを止めて消す）は`audio_route::RETIRES_LEGACY_UNITS`で切り替え、期限を設けない。版を飛ばして更新した環境でも、旧の仮想マイクが残らないようにするためである。どちらも2026-11-23の決定で、ADR-014の2.11の注記にある。

### APIキーの保存先

APIキーは`config.json`に書かない（0.5.0から）。いまはOSの資格情報ストアに保存する（Issue #575）（[ADR-013](../adr/adr-013-secret-store.md)）。Windowsは資格情報マネージャー、LinuxはSecret Service（GNOME Keyring、KWalletなど）である。`AUTH_KEYS`（翻訳）と`TRANSCRIPTION_AUTH_KEYS`（音声認識）の値と`PAPAGO_CLIENT_ID`を1件ずつ保存する。項目の名前は`AUTH_KEYS/DeepL_API`のように辞書の名前とプロバイダ名をつないだものである。どちらの辞書に足したプロバイダも同じ扱いになる。キーを持つ設定を新しく足すときは`native/core/src/config/secrets.rs`の`SECRET_SETTINGS`に名前を加える。

- メモリー上の設定はいままでどおりで、`/get/data/*_auth_key`は同じ値を返す。`/run/initialization_complete`の一覧にも同じ値が入る。
- 設定のフォルダごとに16桁の16進のIDを作り、`secrets.json`の`store_id`に置く。OSのストアの項目はこのIDで分けるので、`VRCT_CONFIG_DIR`で分けた設定どうしはキーを共有しない。IDは最初のキーを保存したときに作る。IDがないうちはOSのストアに問い合わせない。
- Windowsの項目は汎用の資格情報で、名前は`ASTAROT/<ID>/<項目の名前>`（0.6.0は`VRCT-VOX/<ID>/<項目の名前>`）、保存の範囲は`CRED_PERSIST_LOCAL_MACHINE`（移動プロファイルで送られない）。値はキーのUTF-8で、2,560バイトまで。
- Linuxの項目は既定のコレクションに置き、属性`application=astarot`、`astarot-store=<ID>`、`entry=<項目の名前>`で探す。ラベルは`ASTAROT <項目の名前>`。0.6.0は`application=vrct-vox`、`vrct-vox-store=<ID>`、ラベル`VRCT-VOX <項目の名前>`だった。既定のコレクションがないときは作らない（作ると利用者に尋ねることになる）。
- 0.6.0の名前の項目（ADR-014の2.9）: 新しい名前に項目がないときは0.6.0の名前で探し、`secrets.json`より先に読む。見つかったキーはそのまま使い、起動時に新しい名前に書いて読み戻す（`secrets.json`からの移行と同じ手順で、失敗は`migrate`として知らせる）。0.6.0の名前の項目は消さずに残すので、0.6.0に戻しても同じキーを読める。キーを変えたときは新しい名前の項目だけを書き換え、キーを消したときは0.6.0の名前の項目も消す。0.6.0の名前で探すのは0.6.xの間である（ADR-014の2.11）。やめる版と、0.6.0の名前の項目を消す版は、0.7.0の計画で決める。
- アプリは鍵束を開くダイアログを出さない。ロックされたストアは`locked`、ストアがない、セッションバスがない、5秒以内に応答しないときは`unavailable`の一時的な失敗として扱い、`secrets.json`にもOSのストアにも触れない。
- `secrets.json`は`{"version": 1, "protection": …, "entries": …, "store_id": …}`である。0.5.xが保存したキーを持っていることがあり、移行の元として読む。Windowsではキーの一覧をDPAPI（暗号化したユーザーだけが戻せる）で包み、Base64にして`entries`に入れる（`"protection": "dpapi"`）。Linuxでは一覧をそのまま入れ、ファイルの権限を0600にする（`"protection": "none"`）。いまの版はこのファイルに新しくキーを書かない。書き込みは`config.json`と同じく、新しい一時ファイル、`fsync`、置き換えの順で行う。
- 移行: 起動時、`secrets.json`だけにあるキーはそのまま使い、1件ずつOSのストアに書いて読み戻す。同じ値が読めたものだけを`secrets.json`から除く。`config.json`にキーがあれば（0.4以前のPythonや以前の中核が書いたもの）、同じ手順でOSのストアへ移し、`config.json`から除いて書き直す。途中で落ちてもキーはどちらかに残り、次の起動で続きから移す。両方にあるときはOSのストアの値を使い、同じ値のときだけ`secrets.json`の写しを除く。
- OSのストアから読めなかったキーは、`secrets.json`に残っていればそちらを使う。残っていなければその起動のあいだは空として扱い、保存先の中身には触れない。読み出しはその起動のあいだにはやり直さず、次の起動で読む。
- 保存先に書けない、読み戻せない、消せないときは、キーをメモリーに残してその起動のあいだ使えるようにし、`/run/secret_store_failed`に400の`SECRET_STORE_FAILED`を送る。`data`は`{operation, entries, reason, store}`で、`operation`は`migrate`、`write`、`delete`、`read`のどれか、`entries`は項目の名前（キーの値は入れない）、`reason`は`unreadable`、`write_failed`、`unavailable`、`locked`のどれか、`store`は`credential_manager`か`secret_service`である。移せなかったキーは元の場所（`config.json`か`secrets.json`）に残す。次の保存と30秒ごとにもう一度試し、移せたら元の場所から除く。同じ項目の失敗は直るまで1回だけ知らせる。画面の通知は、`migrate`ならキーが元の場所で使えること、`unavailable`と`locked`なら鍵束を起動してロックを解除し再起動することを伝える。
- OSのストアが使えないときも、新しいキーや変えたキーを`secrets.json`に平文で書くことはしない。その起動のあいだだけ使える。
- キーを消す要求（`/delete/data/*_auth_key`など）は、`secrets.json`の写しを先に除き、それからOSのストアから除く。OSのストアが応答しなくても平文の写しは残らない。
- JSONとして読めるが項目を復号できない`secrets.json`（別のユーザーのDPAPIなど）は`store_id`をそのまま使い、次にキーを保存するときに`secrets.json.unreadable-<日時>-<乱数>`へ移してIDを引き継いだ新しいファイルを作る。JSONとして読めない`secrets.json`も、キーを保存するときに同じ名前へ移し、新しいIDで作る。どちらも元のファイルは消さない。一時的に読めないファイルには触れず、書き込みを一時的な失敗にする。
- 音声認識のページに利用者が足したAPIの項目（#414）のキーも、同じ扱いで同じ保管場所に置く。項目の名前は`TRANSCRIPTION_CATALOG/<項目のID>`で、保管場所が一時的に読めないときは409の`transcription_catalog_key_unreadable`を返す。
- 翻訳のカタログに利用者が足したAPIの項目（#413）のキーも同じ保管場所に置く。項目の名前は`TRANSLATION_CATALOG/<項目のID>`で、設定（`SECRET_SETTINGS`）には入れない。項目を足すときにキーを書いて読み戻す。書けない、読み戻せないときも項目は足し、キーは設定のキーと同じくその起動のあいだだけメモリーに持つ（`native/core/src/config/mod.rs`の`Config::keep_secret`）。`/run/secret_store_failed`で1回だけ知らせ、次の保存、30秒ごと、アプリを閉じるときにもう一度書く。平文のファイルには書かない。項目の`key`は、保管場所がキーを持てたときに`true`になる。保管場所に置けないままアプリを閉じた項目は、次の起動ではキーのない項目になる。画面は「APIキーがありません」と示し、項目を削除して追加し直すよう伝える。使うときは、メモリーに持っているキーを先に使う。保管場所が一時的に読めないとき（`locked`、`unavailable`など）は、キーがないとは扱わず、409の`translation_catalog_key_unreadable`を返して何も変えない。項目を削除すると、メモリーと保管場所のキーも消す。保管場所から消せなければ、設定のキーと同じく次の保存と30秒ごとにやり直す。
- 0.5.xに戻すと、移したキーは`secrets.json`にないので入れ直しが要る。キーはOSのストアに残っている。0.4以前に戻した場合も同じである。
- Windowsのアンインストーラーで「アプリケーションデータを削除する」を選ぶと、アンインストーラーはインストール先の`secrets.json`から`store_id`を読み、資格情報マネージャーから`ASTAROT/<store_id>/`と0.6.0の`VRCT-VOX/<store_id>/`で始まる汎用の資格情報を消してから、`secrets.json`を消す。消しきれなかった項目があるときは`secrets.json`を残し、もう一度アプリのデータごとアンインストールしたとき（同じフォルダーにもう一度インストールしてから行う）に、同じ`store_id`で残りを消し直せるようにする。ほかの`store_id`の項目（別のインストールや`ASTAROT_CONFIG_DIR`で分けた設定のもの）には触れない。`store_id`がないとき、16桁の小文字の16進でないときは、資格情報を消さない。消せなかった項目があれば、`secrets.json`を残したことと名前の始まりを示して、アンインストールをし直すか、資格情報マネージャーの「Windows資格情報」で消すよう伝える（[Windowsのアンインストールで消すもの](#windowsのアンインストールで消すもの)）。
## そのほかのファイル

| ファイル | 置き場所 | 内容 |
|---|---|---|
| `process.log`、`error.log` | `$ASTAROT_CONFIG_DIR/logs/`（なければ作業フォルダ） | 診断ログ。10MBで切り詰め、`process.log`は起動のたびに空にする。失敗した実行のあとでUIが中核を起動し直したときだけは空にせず、前の実行の記録に続けて書く。0.4までのPythonバックエンドは、ほかに`freeze_trace.log`と`crash_trace.log`（faulthandlerのスタックダンプ）、`startup_timing.log`（起動の段階ごとの時間）も書いていた。中核はこの3つを書かない |
| `startup.log` | 同上（Tauri側） | ウィンドウの起動記録 |
| 会話ログ `YYYY-MM-DD_HH-MM-SS.log` | `PATH_LOGS` | 「会話ログを自動的に保存する」がオンのときだけ。行頭は`[SENT]`、`[RECEIVED]`、`[OCR]`、`[CHAT]`。画面は新しい1,000件しか残さないが、ファイルには古いものも残る |
| `downloaded_models/<id>/<版>/`と`receipt.json` | `config.json`と同じフォルダ | 取得したモデル。取得中は`.partial-<16進>/`。壊れたモデルを取り直すときも、いったんその名前に戻してから消す（[失敗したときに保つもの](failure-recovery.md#モデルの取得と適用)） |
| `user_models.json` | `config.json`と同じフォルダ | 利用者が名前を付けて登録したモデル（#403）。`{"version": 1, "models": [{id, target, name, files: {役割: {path, size, mtime_ns}}, registered_at}]}`。ファイルの場所と、登録したときの容量と更新時刻だけを持ち、モデルのファイルはコピーしない。一時ファイルに書いて`fsync`してから置き換える。読めない、または版が違うときは書き換えずに残す。0.4までのPythonバックエンドも同じ形式を読み書きしていた |
| `transcription_catalog.json` | `config.json`と同じフォルダー | 音声認識のページに利用者が足したAPIの項目（#414、中核のみ）。`{"version": 1, "entries": [{id, name, protocol, url, model, key, registered_at}]}`。`protocol`はこの版では`openai_compatible`（Whisper互換）だけ。`key`は[APIキーの保存先](#apiキーの保存先)がキーを持てたかどうかだけで、キーそのものはこのファイルに書かない。項目は100件まで。同じ名前か、同じアドレスとモデルの項目は足せない。書き方と、読めないとき（新しい形式や手で書き換えたもの）に残して上書きしないことは`translation_catalog.json`と同じ。この版が知らない`protocol`の項目は残し、使えないものとして見せる |
| `translation_catalog.json` | `config.json`と同じフォルダ | 翻訳のカタログに利用者が足した項目（#413、中核のみ）。`{"version": 1, "entries": [...]}`。推論エンジン系は`{id, group: "engine", name, runtime, folder, languages, registered_at}`で、`runtime`が`llamacpp`（TranslateGemmaのような翻訳のLLM、ADR-015）の項目は`folder`の代わりに`file`にGGUFのファイルのパスを入れ、`device`（`auto`、`cpu`、`Vulkan1`など）を足す。`file`を持つ項目が1つでもあると、ファイルの`version`は`2`になる。`version`が`1`しか読めない以前の版は、そのファイル全体を読めないものとして扱い、上書きしない（足した項目を一覧に出さず、その重みを選んでいた設定は既定のモデルに戻る）。新しい版で`llamacpp`の項目をすべて削除すると、ファイルは`version: 1`に戻り、以前の版でもまた読める。API系は`{id, group: "api", name, protocol, url, model, key, registered_at}`。`key`は[APIキーの保存先](#apiキーの保存先)がキーを持てたかどうかだけで、キーそのものはこのファイルに書かない（保管場所に置けずにメモリーに持っているあいだは`false`）。フォルダーのモデルはコピーしない。書き方と、読めないときに残すことは`user_models.json`と同じ。この版が知らない`runtime`や`protocol`の項目は残し、使えないものとして見せる |
| `vc_runtimes/<エンジン>/`と`receipt.json` | `config.json`と同じフォルダ | アプリが準備したRVCの実行環境（WindowsとLinux。0.4まではSeed-VCも）。`.steps.json`に終わった手順を残す。0.4までのPythonバックエンドは、`setup.log`に`uv`とワーカーの確認の出力も残し、Seed-VCでは`.uv-<版>/`に取得用の`uv`を置いた（0.5.0の中核は`setup.log`を書かない）。RVCは`lib/`（ONNX Runtime。GPU用はCUDA 13とcuDNNのライブラリも）と`assets/`だけで、取得中は`lib.part/`と`downloads/`を使う。RVCの取得が終わると、同じフォルダーにある以前のPyTorch形式の`venv/`、`python/`、`engine/`（中のモデルと音声のファイルは残す）、`engine.zip`、固定の`rmvpe.pt`と`preprocessor_config.json`を削除する |
| `vc_runtimes/onnxruntime-cuda/`、`vc_runtimes/onnxruntime-directml/`と`receipt.json` | `config.json`と同じフォルダ | ローカル翻訳をGPUで動かすためのONNX Runtime（0.5.2の後から。利用者が同意して取得したときだけ）。`onnxruntime-cuda/`はCUDA 13版とNVIDIAのライブラリ、`onnxruntime-directml/`はDirectML版と`DirectML.dll`（Windowsだけ）。どちらも`lib/`だけで、取得と確認はRVCの実行環境と同じ。アプリは起動時に、翻訳の処理デバイスに合う版を同梱のCPU版の代わりに読み込む。RVCのワーカーはDirectMLで変換するときに`onnxruntime-directml/lib`を読み込む |
| `vc_runtimes/llamacpp-vulkan/`と`receipt.json` | `config.json`と同じフォルダ | 翻訳のLLMを動かすllama.cppの`llama-server`（ADR-015。利用者が同意して取得したときだけ）。llama.cppのGitHubのリリース（b12125）のVulkan版のアーカイブから、サーバーが読むファイルだけを`lib/`に取り出す。CPUだけで動かすときも同じ版を使う。取得と確認はRVCの実行環境と同じで、確認では`llama-server --list-devices`を一度動かす。モデルは含まない。サーバーは、そのモデルを選んだ翻訳を始めたときだけ起動する |
| weights/whisper/… | PATH_DATA | 以前の版が取得した Whisper の重み。いまの版は読まず、取得もしない。利用者が設定で削除を選んだときだけ消す（[古い Whisper の重み](#古い-whisper-の重み)） |
| weights/ctranslate2/… | PATH_DATA | 0.4までのPythonバックエンドが取得したCTranslate2の翻訳モデルと検証記録。0.5.0の中核は読まず、起動の後でPythonが作った名前のフォルダだけを消す（リンクやジャンクションはたどらない。`native/core/src/controller/legacy_weights.rs`、[中核の統合](../voice-stack/core-integration.md)の「旧 CTranslate2 の重み」） |
| `translation-models/<フォルダー>/` | PATH_DATA | 以前の中核が読んだ、利用者が置いた翻訳のモデル（重みの名前は`custom:<フォルダー>`）。#597からは一覧に出さず、読み込まない。フォルダーとファイルは消さず動かさない。中核はこのフォルダーにフォルダーがあるかどうかだけを`/get/data/translation_catalog`の`retired_folder_used`で伝え、翻訳のページはそのあいだ翻訳のカタログの「自分のモデルを追加」への案内を出す。名前やパスは伝えない |
| `secrets.json` | `config.json`と同じフォルダ | APIキー（[APIキーの保存先](#apiキーの保存先)）。Windowsでは暗号化、Linuxでは権限0600 |
| `exports/` | `config.json`と同じフォルダー | 利用者が書き出した用語辞書（`vocabulary-年月日-時分秒.txt`、[ファイルへの書き出しと読み込み](#ファイルへの書き出しと読み込み)）。アプリは読まない |
| `storage_migration.json` | Linux配布版の設定のフォルダーとデータのフォルダー（0.6.0から） | そのフォルダーを新しく作ったか、`vrct-vox`から移したかの記録（[Linuxの保存先の移動](#linuxの保存先の移動)） |
| `config.json.before-migration-storage` | `config.json`と同じフォルダ | Linuxの保存先を移したときと、Windowsのインストーラーがインストール先を移したあとの最初の起動で、パスを付け替える前の`config.json`（APIキーを除く。Linuxでは権限0600）。アプリは読まない |
| `installer_moved_from.txt` | Windowsのインストール先（0.7.0から） | インストーラーがインストール先を移したときに置く、旧のインストール先のパス（バイト順マーク付きのUTF-16）。アプリが次の起動でパスを付け替えて消す（[Windowsのインストール先の移動](#windowsのインストール先の移動)） |
| `voice_mute_state.json` | `config.json`と同じフォルダ | `{"version": 1, "muted": 真偽}`。すぐに書き、原子的に置き換える |
| `telemetry_state.json` | `PATH_DATA` | 利用状況の通知をその日（UTC）に送ったかどうかの記録（起動の通知を送った日付と、その日に送ったエラーコード）と、送った内容そのものの直近20件（`sent`: このPCの時刻、本文、受け付けられたか） |
| `io.github.kein5.astarot.desktop` | `$XDG_DATA_HOME/applications/` | Waylandでショートカットを登録するためのデスクトップファイル。0.6.xまでは`io.github.kein5.vrct-vox.desktop`で、`X-VRCT-VOX-Generated=true`の行があるもの（前の版が書いたもの）は、新しいファイルを書いたあとに消す。その行がないファイルは利用者かパッケージのものとして残す |

UIは独自の状態を持たない（`localStorage`も使わない）。画面の状態はすべてサイドカーから受け取る。

### Windowsのアンインストールで消すもの

Windowsでは`config.json`を置くフォルダーがインストール先なので、上の表の`config.json`と同じフォルダーと`PATH_DATA`のものはインストール先にある。アンインストーラーは、利用者が確認の画面で「アプリケーションデータを削除する」を選んだときだけ、次のものを消す（`src-tauri/nsis/template.nsi`の`Section Uninstall`）。選ばなければ残す。アプリの更新が別の場所の古いインストールを消すときも、この項目は選ばれないので残る。

- 設定: `config.json`と`config.json.*`（ロック、`unreadable-*`、0.5までの`before-migration-*`、保存の途中で止まったときの一時ファイル）
- APIキー: 資格情報マネージャーにあるこのフォルダーのキー（[APIキーの保存先](#apiキーの保存先)）、`secrets.json`、`secrets.json.*`
- `user_models.json`、`translation_catalog.json`、`voice_mute_state.json`、`telemetry_state.json`と、それぞれを書く途中で止まったときの一時ファイル
- `downloaded_models/`、`vc_runtimes/`、`logs/`、`weights/`
- 0.5までのPythonバックエンドがアプリの隣に書いたログ（`process.log`、`error.log`、`crash_trace.log`、`freeze_trace.log`、`startup_timing.log`）
- WebView2のデータ（`%APPDATA%`と`%LOCALAPPDATA%`のアプリIDのフォルダー）

`translation-models/`と`exports/`は利用者が置いたか書き出したファイルなので消さない。この2つにファイルがあれば、インストール先のフォルダーも残る。`installer_language.txt`は、選んだかどうかにかかわらず消す。表にファイルやフォルダーを足すときは、`Section Uninstall`も直す（`tests/devtools/test_nsis_staged_update.py`が表と照らし合わせる）。

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
新しい設定や環境変数はない。実装は`native/transcription/src/diagnostics.rs`（2026-11-19に[`models/transcription/utterance_diagnostics.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/utterance_diagnostics.py)から移した）。
中核では、Pythonと違って、エンジンの詳細行に言語ごとの呼び出しの一覧を出さない。`vad_wait_ms`は、speech.cppのサーバーが話し終わりを知らせた時点で話し終わりのあとに聞いていた音声の長さ。

## 環境変数

| 変数 | 働き |
|---|---|
| `ASTAROT_CONFIG_DIR`（0.6.xの間は`VRCT_CONFIG_DIR`も） | `config.json`、ログ、取得したモデル、声質変換の実行環境、ミュート状態の置き場所。指定したフォルダーは移さない |
| `ASTAROT_DATA_DIR`（0.6.xの間は`VRCT_DATA_DIR`も） | Linux配布版のデータの置き場所（`src-tauri/src/backend_host.rs`）。指定したフォルダーは移さない |
| `XDG_CONFIG_HOME`、`XDG_DATA_HOME` | Linux配布版の既定の置き場所の元（その下の`astarot`。0.5.xまでは`vrct-vox`） |
| `VRCT_CACHE_DIR`、`XDG_CACHE_HOME`、`HF_HOME` | 0.4までのPythonバックエンドがLinux配布版のキャッシュの置き場所に使った（`HF_HOME`は未設定なら`<キャッシュ>/huggingface`）。0.5.0のアプリと中核のコードは置き場所に使わない |
| `ASTAROT_VOICE_TRACE`、`ASTAROT_VOICE_GC_DIAGNOSTICS` | 読み上げの時間計測とGCの記録（診断用） |
| `WAYLAND_DISPLAY`、`XDG_SESSION_TYPE`、`GDK_BACKEND` | Quick Chatとホットキーの登録方法の判定 |
| `DISPLAY` | X11でのOCRのキャプチャ |
| `ASTAROT_VR_PANEL_DIR` | Tauriが起動時に決める、このプロセス専用の場所（`$XDG_RUNTIME_DIR/astarot/vr-panel-<pid>`、Linux）。バックエンドはここでVR画面の画素（`frame`）と、共有されたウィンドウの画素（`screen-frame`）を読む。利用者が設定するものではない |
| `APPIMAGE`と`WEBKIT_DISABLE_DMABUF_RENDERER=1` | NVIDIA環境のAppImageでメインウィンドウを不透明にする |
| `HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`（小文字の名前が先） | 音声認識のクラウドのエンジンと、オンラインの翻訳のプロバイダへの通信が通るHTTPのプロキシと、通さない宛先。`*_proxy`がどれもないときは、Windowsのインターネットの設定を読む。ローカルとLANの宛先（LM Studio、Ollama、LANのOpenAI互換のサーバーを含む）は通さない（`native/translation/src/proxy.rs`） |

`HF_HUB_OFFLINE`などのオフライン用の変数は、アプリは読まない。`tools/dev.py`が開発用の子プロセスに設定する。

## 音声デバイスの選択と識別

従来の文字起こしと音量メーターは、入力元（マイクとスピーカー）ごとに1つの録音を共有する。名前は表示用のラベルとし、選択にはIDを使う（`native/core/src/controller/audio_devices.rs`、`native/audio-routing/src/identity.rs`、`selection.rs`）。従来の録音を使うのは、Windowsでクラウドの音声認識エンジンを選んでいるときだけである。Linuxのメイン画面のスイッチと、Windowsのローカルの音声認識（speech.cpp）は、リアルタイムASRを使う。

- 機器の一覧と識別:
    - Windowsは、WASAPI（`IMMDeviceEnumerator`）の機器だけを並べる。IDはIMMDevice IDを含む`mic:Windows WASAPI:<IMMDevice ID>`と`speaker:2:<IMMDevice ID>`で、サンプルレートとチャンネル数はミックスの形式から取る（`native/audio-routing/src/wasapi/mod.rs`）。マイクのホストは`Windows WASAPI`だけである。
    - Linuxは、PipeWireの入力だけを`PipeWire`という1つのホストに並べる。IDは`pipewire:<node.name>`で、スピーカーの行はない。一覧は2秒ごとに読み直す（`native/audio-routing/src/pipewire/devices.rs`）。従来の録音はPipeWireの行を開かない（`asr_capture_windows_only`）。
- 保存する`SELECTED_MIC_DEVICE_ID`と`SELECTED_SPEAKER_DEVICE_ID`と、名前の`SELECTED_MIC_HOST`、`SELECTED_MIC_DEVICE`、`SELECTED_SPEAKER_DEVICE`を持つ。保存したIDは同じIDの機器にだけ合う。名前は、同じ名前の行が1つだけのときに合う。保存したIDが見つからなくても、同名という理由で別の機器と同一視しない。
- 名前だけの設定は、使うときに名前が1つの行に合えば、その機器を使い、次に選択を知らせるときにIDを書く。同じ名前の行が複数あれば、保存した名前のまま残し、Autoがオフなら機器を選ばない（どれかを推測しない）。0.4までのPythonが使っていたホスト（MME、DirectSound、WDM-KS）で保存した選択は、WASAPIの行へ移す。保存したIDのネイティブIDの部分か、IDが空か`pa:`のスロットのIDなら名前（MMEの31文字の切り詰めも見る）で、1つに合うときだけ移す（`selection.rs`）。
- 保存したIDの機器が一覧にないときは、Autoがオフでも、OSの既定の機器、なければ一覧の最初の行を選ぶ。一覧が変わると、録音していなくても、その選んだ機器を選択として保存する。元の機器をつなぎ直しても、選択は戻らない（`native/core/tests/audio_devices.rs`）。
- 録音を設定し直すのは、開いている機器の組（ID、名前、ホスト、一覧の位置、接続の世代とオブジェクトのシリアル、サンプルレート、入力チャンネル数、ループバックかどうか、ノード名）が変わったときである（`identity.rs`の`capture_key`）。接続の世代は機器の変化の知らせのたびに上がるので、機器の変化があると動いている録音を開き直す。
- 名前の文字列と名前の一覧のIPCは維持する。`/get/data/selectable_mic_device_options`とスピーカー側の同名形式は`[{id, label}]`を返す。動いている録音の機器は、止まるまで一覧に残す。`/get/data/selected_mic_device_id`、`/set/data/selected_mic_device_id`とスピーカー側の同名形式はID文字列を扱い、空のIDは受け付けない。各値の変更は`/run/…`でも通知する。デスクトップとVRの選択欄は新しいIPCを使う。名前による変更の要求は、同じ名前の行が1つのときだけ受け付ける。
- 一覧の更新やAutoの選択は、文字起こしかメーターがオンのときだけ録音の機器を動かす。オフなら選択を知らせるだけで、録音を始めない。Autoをオンにすると、返答の前に選択と録音中の機器を合わせる。Autoをオフにしても、機器の組が変わらない録音は続ける。待っている合わせの処理は世代を持ち、世代が変わっていれば捨てる。オフの操作も世代を進めるので、古い要求で録音を再開しない。合わせの処理は、要求を受けたスレッドで行う。
- Windowsのスピーカーの自動選択は、OSの既定だけでなく、いちばん大きな音を出している再生の機器に従う（`native/audio-routing/src/tracker.rs`）。録音を設定し直している間は、この追跡を止める。
- 利用者が始めた録音では、選んだ機器が消えた場合や開けない場合、Autoがオフでも、使える別の機器へ切り替えて続ける（2026-11-04の保守方針）。試す順は、選んだ機器、OSの既定の機器、ほかのすべての行で、同じ機器の組の重なりとPipeWireの行は飛ばす。1つの機器を開くのは8秒まで待つ（`native/transcription/src/recorder.rs`）。読み取りのエラーでは一覧を読み直し、機器が消えていれば切り替える。機器が一覧に残っていれば切り替えず、`AUDIO_READ_ERROR`で認識をオフにする。開くにはIMMDevice IDが要るので、識別しないライブラリの既定の機器は開かない。
- 開けた機器のIDと名前を選択として保存する。IDか名前が変わったときは、`/run/audio_device_switched`の200通知に`{source, old_device: {id, name}, new_device: {id, name}}`を入れる。UIは変更前後の名前を、操作を妨げない通知で知らせ、名前が同じならIDも添える。
- どの機器も開けない場合は、文字起こしとメーターをオフにし（`/set/disable/transcription_*`、`/set/disable/check_*_threshold`）、メーターを0に戻し（`/run/check_*_volume`）、`/run/transcription_recognition_error`を送る。機器が1つもないときは、スピーカーとメーターに`/run/error_device`（`DEVICE_NO_MIC`か`DEVICE_NO_SPEAKER`）を送る。
- 開く処理が8秒を過ぎたら、止める印を立てて`asr_capture_start_timeout`で失敗にし、次の機器を試す。同じ入力元への次の要求は、入力元のロックで待つ。遅れて開いたストリームは止める印を見て止まる。すでに動いているネイティブの呼び出し（Windowsのマイクの許可の確認を待つことがある）を中断できる保証はない。
- 録音のエラーと復旧は、入力元ごとの版（開始、停止、失敗のたびに進む）で照合する。古い録音のエラーで、切り替え後の録音を止めたり、新しいエラー通知を抑止したりしない。この版は利用者のオン・オフ操作の世代やメッセージ配送の世代と分ける。内部の機器の切り替えだけでは受け付け済みのテキストを破棄しないが、切り替える前の録音で認識している途中のものは捨てる。確かめるためだけのストリームは開かず、開けたストリームをそのまま使う。
- RVCの入力の既定は、デバイスのページのマイクを名前で探す（`native/core/src/controller/voice/mod.rs`）。

リアルタイムASRは別のキャプチャ経路であり、ここで述べた従来の録音の自動継続は適用しない。リアルタイムASRは`REALTIME_ASR_SETTINGS`で固定した機器か、OSの既定の機器を使う。従来の録音を始めるときは、先にリアルタイムASRを止める（`native/core/src/controller/realtime_asr.rs`、`transcription.rs`）。
