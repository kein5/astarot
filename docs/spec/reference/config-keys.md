<!-- 自動生成。手で編集しない。`python tools/spec_catalog.py --write`で更新する。 -->

# 設定キー一覧

中核のキーの表（`native/core/src/config/schema.rs`の`keys()`）と既定値（`defaults()`）から生成した。既定値は`tools/spec_core_catalog.json`を通し、型・検証は`keys()`の式から読む。保存の仕組み（2秒の遅延、置き換えによる書き込み、読み込み時の検証）は[データ形式と保存](../data-and-persistence.md)にある。

- 型・検証: よく使う形（`int_in`、`one_of`など）は言葉にした。それ以外は、検証に使う関数の名前か「独自の検証」で、中身は`schema.rs`にある。
- 既定値: 中核が`config.json`に書くJSON。Windowsのもの。PCで決まるものは仮の値で示す（`<app>`はアプリのフォルダー、`<data>`はモデルなどのデータのフォルダー、`<state>`は設定とログのフォルダー、`<token>`は最初の起動で作る値）。翻訳の計算機器はCPUだけの場合。

チャット読み取りの`OCR_CAPTURE_REGION`はデスクトップウィンドウ用、`OCR_VR_CAPTURE_REGION`はSteamVRの左目側の映像用。旧版の単一範囲はウィンドウ用に保持し、未保存のVR側には全体を補う。[範囲の形と移行](../data-and-persistence.md#チャット読み取りの範囲)を参照。

## config.jsonに保存するキー（153件）

| キー | 型・検証 | 既定値 | 保存 |
|---|---|---|---|
| `CONVERSATION_LOG_DIRECTORY` | str か null、独自の検証 | `null` | 2秒後にまとめて |
| `ENABLE_FOREGROUND` | bool | `false` | 2秒後にまとめて |
| `CONVERT_MESSAGE_TO_ROMAJI` | bool | `false` | 2秒後にまとめて |
| `CONVERT_MESSAGE_TO_HIRAGANA` | bool | `false` | 2秒後にまとめて |
| `MAIN_WINDOW_SIDEBAR_COMPACT_MODE` | bool | `false` | 2秒後にまとめて |
| `TRANSPARENCY` | int | `100` | 2秒後にまとめて |
| `UI_SCALING` | int | `100` | 2秒後にまとめて |
| `TEXTBOX_UI_SCALING` | int | `100` | 2秒後にまとめて |
| `MESSAGE_BOX_RATIO` | number | `10` | 即時 |
| `SEND_MESSAGE_BUTTON_TYPE` | str（`SEND_MESSAGE_BUTTON_TYPE_LIST`のどれか） | `"show"` | 2秒後にまとめて |
| `SHOW_RESEND_BUTTON` | bool | `false` | 2秒後にまとめて |
| `FONT_FAMILY` | str | `"Yu Gothic UI"` | 2秒後にまとめて |
| `UI_LANGUAGE` | str（`SELECTABLE_UI_LANGUAGE_LIST`のどれか） | `"en"` | 2秒後にまとめて |
| `MAIN_WINDOW_GEOMETRY` | 検証 `window_geometry` | `{"x_pos": 0, "y_pos": 0, "width": 870, "height": 654}` | 即時 |
| `SETTINGS_WINDOW_GEOMETRY` | 検証 `window_geometry` | `{"x_pos": 0, "y_pos": 0, "width": 870, "height": 654}` | 即時 |
| `MIC_THRESHOLD` | int、独自の検証 | `300` | 2秒後にまとめて |
| `MIC_AUTOMATIC_THRESHOLD` | bool | `false` | 2秒後にまとめて |
| `MIC_RECORD_TIMEOUT` | 検証 `asr_timeout` | `3` | 2秒後にまとめて |
| `MIC_PHRASE_TIMEOUT` | 検証 `asr_timeout` | `3` | 2秒後にまとめて |
| `MIC_MAX_PHRASES` | int（0〜30） | `10` | 2秒後にまとめて |
| `MIC_AVG_LOGPROB` | number（-2.0〜0.0） | `-0.8` | 2秒後にまとめて |
| `MIC_NO_SPEECH_PROB` | number（0.0〜1.0） | `0.6` | 2秒後にまとめて |
| `HOTKEYS` | 検証 `hotkeys` | `{"open_quick_chat": null, "toggle_vrct_visibility": null, "toggle_translation": null, "toggle_transcription_send": null, "toggle_transcription_receive": null, "stop_voice": null, "toggle_voice_mute": null, "toggle_tts": null, "toggle_rvc": null}` | 即時 |
| `EXPERIMENTAL_FEATURES` | 検証 `experimental_features` | `{"tray_companion": false, "talk_ai": false}` | 即時 |
| `TALK_AI_SCREEN_INTERVAL_MS` | int（250〜10_000） | `1000` | 2秒後にまとめて |
| `TALK_AI_SCREEN_LONG_EDGE` | int（256〜2048） | `1024` | 2秒後にまとめて |
| `TALK_AI_SCREEN_DETAIL` | str、独自の検証 | `"auto"` | 2秒後にまとめて |
| `TALK_AI_PROVIDER` | str、独自の検証 | `"openai"` | 2秒後にまとめて |
| `TALK_AI_LOCAL_URL` | str、独自の検証 | `"ws://127.0.0.1:8000/v1/realtime"` | 2秒後にまとめて |
| `USAGE_PRESETS` | 検証 `usage_presets` | `["basic"]` | 即時 |
| `CATALOG_LAYOUT` | str、独自の検証 | `"grid"` | 2秒後にまとめて |
| `THEME` | 検証 `theme` | `{"preset": "dark_plum", "custom": {"base": "#261633", "accent": "#a47af5"}}` | 2秒後にまとめて |
| `TRAY_COMPANION_EDGE` | str（`TRAY_COMPANION_EDGE_LIST`のどれか） | `"right"` | 2秒後にまとめて |
| `TRAY_COMPANION_MONITOR` | str、独自の検証 | `""` | 2秒後にまとめて |
| `TRAY_COMPANION_WHEEL_HINT_SHOWN` | bool | `false` | 2秒後にまとめて |
| `SPEAKER_THRESHOLD` | int、独自の検証 | `300` | 2秒後にまとめて |
| `SPEAKER_AUTOMATIC_THRESHOLD` | bool | `false` | 2秒後にまとめて |
| `SPEAKER_RECORD_TIMEOUT` | 検証 `asr_timeout` | `3` | 2秒後にまとめて |
| `SPEAKER_PHRASE_TIMEOUT` | 検証 `asr_timeout` | `3` | 2秒後にまとめて |
| `SPEAKER_MAX_PHRASES` | int（0〜60） | `10` | 2秒後にまとめて |
| `SPEAKER_AVG_LOGPROB` | number（-2.0〜0.0） | `-0.8` | 2秒後にまとめて |
| `SPEAKER_NO_SPEECH_PROB` | number（0.0〜1.0） | `0.6` | 2秒後にまとめて |
| `MIC_ENABLE_VAD` | bool | `false` | 2秒後にまとめて |
| `SPEAKER_ENABLE_VAD` | bool | `false` | 2秒後にまとめて |
| `AUTH_KEYS` | 検証 `credentials` | `{"DeepL_API": null, "Plamo_API": null, "Gemini_API": null, "OpenAI_API": null, "OpenAI_Compatible": null, "Groq_API": null, "OpenRouter_API": null, "Google_Cloud_API": null, "Papago_API": null}` | 2秒後にまとめて |
| `LMSTUDIO_URL` | str、検証 `valid_saved_api_url` | `"http://127.0.0.1:1234/v1"` | 2秒後にまとめて |
| `OLLAMA_URL` | str、検証 `valid_saved_api_url` | `"http://localhost:11434"` | 2秒後にまとめて |
| `PAPAGO_CLIENT_ID` | str、独自の検証 | `""` | 2秒後にまとめて |
| `OPENAI_COMPATIBLE_URL` | str、検証 `valid_saved_api_url` | `"https://api.openai.com/v1"` | 2秒後にまとめて |
| `TRANSCRIPTION_AUTH_KEYS` | 検証 `credentials` | `{"Groq_Whisper": null, "OpenAI_Whisper": null, "Custom_Whisper": null, "Deepgram": null}` | 2秒後にまとめて |
| `TRANSCRIPTION_CUSTOM_URL` | str、検証 `valid_saved_api_url` | `""` | 2秒後にまとめて |
| `OVERLAY_SMALL_LOG_SETTINGS` | 検証 `overlay_log` | `{"x_pos": 0.0, "y_pos": 0.0, "z_pos": 0.0, "x_rotation": 0.0, "y_rotation": 0.0, "z_rotation": 0.0, "display_duration": 5, "fadeout_duration": 2, "opacity": 1.0, "ui_scaling": 1.0, "tracker": "HMD"}` | 2秒後にまとめて |
| `OVERLAY_LARGE_LOG_SETTINGS` | 検証 `overlay_log` | `{"x_pos": 0.0, "y_pos": 0.0, "z_pos": 0.0, "x_rotation": 0.0, "y_rotation": 0.0, "z_rotation": 0.0, "display_duration": 5, "fadeout_duration": 2, "opacity": 1.0, "ui_scaling": 1.0, "tracker": "LeftHand"}` | 2秒後にまとめて |
| `OVERLAY_DESKTOP_SETTINGS` | 検証 `overlay_desktop` | `{"position": "bottom", "font_size": 28, "display_duration": 6, "opacity": 0.6}` | 2秒後にまとめて |
| `OVERLAY_DESKTOP_PLACEMENT` | 検証 `overlay_desktop_placement` | `{"x": null, "y": null}` | 2秒後にまとめて |
| `IO_FLOW_OVERLAY_SETTINGS` | 検証 `io_flow_overlay` | `{"desktop": false, "count": 1}` | 2秒後にまとめて |
| `OVERLAY_VR_PANEL_SETTINGS` | 検証 `overlay_vr_window` | `{"width": 900, "height": 700, "x_pos": 0.5209, "y_pos": 0.6442, "z_pos": -0.9509, "x_rotation": 95.0133, "y_rotation": 44.0232, "z_rotation": 42.6138, "display_duration": 5, "fadeout_duration": 0, "opacity": 1.0, "ui_scaling": 0.4, "tracker": "Playspace"}` | 2秒後にまとめて |
| `OVERLAY_VR_LAUNCHER_SETTINGS` | 検証 `overlay_vr_window` | `{"x_pos": 0.0641, "y_pos": -0.0416, "z_pos": -0.0063, "x_rotation": 9.3648, "y_rotation": -22.0338, "z_rotation": -17.1646, "display_duration": 5, "fadeout_duration": 0, "opacity": 1.0, "ui_scaling": 0.1984, "tracker": "LeftHand"}` | 2秒後にまとめて |
| `SEND_MESSAGE_FORMAT_PARTS` | 検証 `message_format` | `{"message": {"prefix": "", "suffix": ""}, "separator": "\n", "translation": {"prefix": "", "separator": "\n", "suffix": ""}, "translation_first": false}` | 2秒後にまとめて |
| `RECEIVED_MESSAGE_FORMAT_PARTS` | 検証 `message_format` | `{"message": {"prefix": "", "suffix": ""}, "separator": "\n", "translation": {"prefix": "", "separator": "\n", "suffix": ""}, "translation_first": false}` | 2秒後にまとめて |
| `VOICE_SETTINGS` | 検証 `tts_settings` | `{"mode": "off", "mic_mode": "off", "direct_policy": "suppress", "target_slot": "1", "japanese_server": "bundled", "japanese_url": "http://127.0.0.1:8080", "japanese_voice": "none", "multilingual_url": "", "multilingual_voice": "ryan", "multilingual_server": "bundled", "japanese_seed": "", "multilingual_seed": "", "japanese_instructions": "", "multilingual_instructions": "", "output_device": "", "routing": "external", "monitor": "off", "monitor_device": "", "monitor_volume": "100", "conversion": "off", "japanese_engine": "speechcpp", "voicevox_url": "http://127.0.0.1:50021", "coeiroink_url": "http://127.0.0.1:50032", "aivis_url": "http://127.0.0.1:10101", "sharevox_url": "http://127.0.0.1:50025", "engine_voice_id": "", "engine_voice_speaker": "", "engine_voice_style": "", "coeiroink_speed": "1.0", "coeiroink_volume": "1.0", "coeiroink_pitch": "0.0", "coeiroink_intonation": "1.0", "coeiroink_pre_phoneme": "0.1", "coeiroink_post_phoneme": "0.1", "coeiroink_sampling_rate": "24000", "voicevox_speed": "1.0", "voicevox_volume": "1.0", "voicevox_pitch": "0.0", "voicevox_intonation": "1.0", "aivis_speed": "1.0", "aivis_volume": "1.0", "aivis_pitch": "0.0", "aivis_intonation": "1.0", "sharevox_speed": "1.0", "sharevox_volume": "1.0", "sharevox_pitch": "0.0", "sharevox_intonation": "1.0"}` | 2秒後にまとめて |
| `DIRECT_VOICE_SETTINGS` | 検証 `voice_settings::load_direct` | `{"mode": "passthrough", "runtime": "", "reference": "", "engine": "rvc", "rvc_runtime": "", "rvc_model": "", "rvc_index": "", "rvc_pitch": 0, "rvc_index_rate": 0.0, "rvc_device": "auto", "rvc_threads": 0, "rvc_highpass": true}` | 2秒後にまとめて |
| `RVC_BLOCK_MS` | int、検証 `is_valid_rvc_block_ms` | `0` | 2秒後にまとめて |
| `REALTIME_ASR_SETTINGS` | 検証 `voice_settings::normalize_realtime` | `{"version": 1, "server": "external", "start_server": true, "base_url": "http://127.0.0.1:8080", "model": "", "vocabulary": {"builtin": true, "terms": []}, "mic": {"language": "ja", "endpoint": null, "follow_default": true}, "speaker": {"language": "auto", "endpoint": null, "follow_default": true}}` | 2秒後にまとめて |
| `SPEECH_SERVER_SETTINGS` | 検証 `astarot_speech_server::settings::normalize_settings` | `{"version": 1, "profiles": {"japanese": {"model": "", "vad_model": "", "diarization_model": "", "voice_file": "", "device": "auto", "low_latency": false}, "multilingual": {"model": "", "vad_model": "", "diarization_model": "", "voice_file": "", "device": "auto", "low_latency": false}, "asr": {"model": "", "vad_model": "", "diarization_model": "", "voice_file": "", "device": "auto", "low_latency": false}}}` | 2秒後にまとめて |
| `WEBSOCKET_SERVER` | bool | `false` | 2秒後にまとめて |
| `OSC_IP_ADDRESS` | str | `"127.0.0.1"` | 2秒後にまとめて |
| `OSC_PORT` | int、検証 `is_valid_port` | `9000` | 2秒後にまとめて |
| `OSC_QUERY` | bool | `true` | 2秒後にまとめて |
| `AUTO_CLEAR_MESSAGE_BOX` | bool | `true` | 2秒後にまとめて |
| `CHECK_SOFTWARE_UPDATES` | bool | `true` | 2秒後にまとめて |
| `SEND_ONLY_TRANSLATED_MESSAGES` | bool | `false` | 2秒後にまとめて |
| `OVERLAY_SMALL_LOG` | bool | `false` | 2秒後にまとめて |
| `OVERLAY_LARGE_LOG` | bool | `false` | 2秒後にまとめて |
| `OVERLAY_DESKTOP` | bool | `false` | 2秒後にまとめて |
| `OVERLAY_VR_PANEL` | bool | `false` | 2秒後にまとめて |
| `OVERLAY_VR_PANEL_LOCKED` | bool | `false` | 2秒後にまとめて |
| `OVERLAY_VR_PANEL_FONT_SIZE` | int | `17` | 2秒後にまとめて |
| `OVERLAY_VR_LAUNCHER_AUTO_HIDE` | bool | `true` | 2秒後にまとめて |
| `OVERLAY_VR_TOOLTIP` | bool | `true` | 2秒後にまとめて |
| `OVERLAY_FONT_FAMILY` | str、独自の検証 | `""` | 2秒後にまとめて |
| `OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES` | bool | `false` | 2秒後にまとめて |
| `SEND_MESSAGE_TO_VRC` | bool | `true` | 2秒後にまとめて |
| `SEND_RECEIVED_MESSAGE_TO_VRC` | bool | `false` | 2秒後にまとめて |
| `LOGGER_FEATURE` | bool | `false` | 2秒後にまとめて |
| `VRC_MIC_MUTE_SYNC` | bool | `false` | 2秒後にまとめて |
| `NOTIFICATION_VRC_SFX` | bool | `true` | 2秒後にまとめて |
| `WEBSOCKET_HOST` | str、検証 `is_valid_websocket_host` | `"127.0.0.1"` | 2秒後にまとめて |
| `WEBSOCKET_PORT` | int、検証 `is_valid_port` | `2231` | 2秒後にまとめて |
| `WEBSOCKET_AUTH_TOKEN` | str、独自の検証 | `"<token>"` | 2秒後にまとめて |
| `WEBSOCKET_TLS_CERT_FILE` | str | `""` | 2秒後にまとめて |
| `WEBSOCKET_TLS_KEY_FILE` | str | `""` | 2秒後にまとめて |
| `OBS_BROWSER_SOURCE` | bool | `false` | 2秒後にまとめて |
| `OBS_BROWSER_SOURCE_PORT` | int、検証 `is_valid_port` | `2232` | 2秒後にまとめて |
| `OBS_BROWSER_SOURCE_MAX_MESSAGES` | 検証 `obs_numeric` | `14` | 2秒後にまとめて |
| `OBS_BROWSER_SOURCE_DISPLAY_DURATION` | 検証 `obs_numeric` | `60` | 2秒後にまとめて |
| `OBS_BROWSER_SOURCE_FADEOUT_DURATION` | 検証 `obs_numeric` | `12` | 2秒後にまとめて |
| `OBS_BROWSER_SOURCE_FONT_SIZE` | 検証 `obs_numeric` | `40` | 2秒後にまとめて |
| `OBS_BROWSER_SOURCE_FONT_COLOR` | str | `"#FFFFFF"` | 2秒後にまとめて |
| `OBS_BROWSER_SOURCE_FONT_OUTLINE_THICKNESS` | 検証 `obs_numeric` | `3` | 2秒後にまとめて |
| `OBS_BROWSER_SOURCE_FONT_OUTLINE_COLOR` | str | `"#000000"` | 2秒後にまとめて |
| `ENABLE_TELEMETRY` | bool | `true` | 2秒後にまとめて |
| `TELEMETRY_NOTICE` | int（0〜1000） | `0` | 即時 |
| `AUTO_DOWNLOAD_MODELS` | bool | `false` | 2秒後にまとめて |
| `LEGACY_MODEL_DOWNLOAD_CONSENTS` | dict、独自の検証 | `{}` | 即時 |
| `SELECTED_TAB_NO` | str（`SELECTABLE_TAB_NO_LIST`のどれか） | `"1"` | 2秒後にまとめて |
| `SELECTED_TRANSCRIPTION_ENGINE` | str か null、独自の検証 | `null` | 2秒後にまとめて |
| `SELECTED_RELEASE_CHANNEL` | str（`SELECTABLE_RELEASE_CHANNEL_LIST`のどれか） | `"stable"` | 2秒後にまとめて |
| `RELEASE_CHANNEL_CHOSEN` | bool | `false` | 2秒後にまとめて |
| `CTRANSLATE2_WEIGHT_TYPE` | str（`SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_LIST`のどれか） | `"m2m100_418M-ct2-int8"` | 2秒後にまとめて |
| `CTRANSLATE2_LICENSE_NOTICE_SHOWN` | bool | `false` | 2秒後にまとめて |
| `LOCAL_ASR_MIGRATION` | int（0〜super::LOCAL_ASR_MIGRATION_LATEST） | `2` | 2秒後にまとめて |
| `VIRTUAL_MIC_NOTICE_PENDING` | bool | `true` | 2秒後にまとめて |
| `MANAGED_ROUTE_RENAME_NOTICE_PENDING` | bool | `false` | 2秒後にまとめて |
| `FIRST_RUN_SETUP_PENDING` | bool | `true` | 2秒後にまとめて |
| `SELECTED_PLAMO_MODEL` | str か null（`SELECTABLE_PLAMO_MODEL_LIST`のどれか。一覧が空なら問わない） | `null` | 2秒後にまとめて |
| `SELECTED_GEMINI_MODEL` | str か null（`SELECTABLE_GEMINI_MODEL_LIST`のどれか。一覧が空なら問わない） | `null` | 2秒後にまとめて |
| `SELECTED_OPENAI_MODEL` | str か null（`SELECTABLE_OPENAI_MODEL_LIST`のどれか。一覧が空なら問わない） | `null` | 2秒後にまとめて |
| `SELECTED_GROQ_MODEL` | str か null（`SELECTABLE_GROQ_MODEL_LIST`のどれか。一覧が空なら問わない） | `null` | 2秒後にまとめて |
| `SELECTED_OPENROUTER_MODEL` | str か null（`SELECTABLE_OPENROUTER_MODEL_LIST`のどれか。一覧が空なら問わない） | `null` | 2秒後にまとめて |
| `SELECTED_LMSTUDIO_MODEL` | str か null（`SELECTABLE_LMSTUDIO_MODEL_LIST`のどれか。一覧が空なら問わない） | `null` | 2秒後にまとめて |
| `SELECTED_OPENAI_COMPATIBLE_MODEL` | str か null（`SELECTABLE_OPENAI_COMPATIBLE_MODEL_LIST`のどれか。一覧が空なら問わない） | `null` | 2秒後にまとめて |
| `SELECTED_OLLAMA_MODEL` | str か null（`SELECTABLE_OLLAMA_MODEL_LIST`のどれか。一覧が空なら問わない） | `null` | 2秒後にまとめて |
| `LLM_TRANSLATION_TEMPERATURE` | str、独自の検証 | `""` | 2秒後にまとめて |
| `LLM_TRANSLATION_INSTRUCTIONS` | str、独自の検証 | `""` | 2秒後にまとめて |
| `SELECTED_GROQ_WHISPER_MODEL` | str か null（`SELECTABLE_GROQ_WHISPER_MODEL_LIST`のどれか。一覧が空なら問わない） | `null` | 2秒後にまとめて |
| `SELECTED_OPENAI_WHISPER_MODEL` | str か null（`SELECTABLE_OPENAI_WHISPER_MODEL_LIST`のどれか。一覧が空なら問わない） | `null` | 2秒後にまとめて |
| `SELECTED_CUSTOM_WHISPER_MODEL` | str か null（`SELECTABLE_CUSTOM_WHISPER_MODEL_LIST`のどれか。一覧が空なら問わない） | `null` | 2秒後にまとめて |
| `SELECTED_DEEPGRAM_MODEL` | str か null（`SELECTABLE_DEEPGRAM_MODEL_LIST`のどれか。一覧が空なら問わない） | `null` | 2秒後にまとめて |
| `MIC_WORD_FILTER` | 検証 `word_filter` | `[]` | 2秒後にまとめて |
| `SELECTED_TRANSLATION_ENGINES` | 検証 `translation_engines_check` | `{"1": "CTranslate2", "2": "CTranslate2", "3": "CTranslate2"}` | 2秒後にまとめて |
| `SELECTED_YOUR_LANGUAGES` | 検証 `languages_check` | `{"1": {"1": {"language": "Japanese", "country": "Japan", "enable": true}}, "2": {"1": {"language": "Japanese", "country": "Japan", "enable": true}}, "3": {"1": {"language": "Japanese", "country": "Japan", "enable": true}}}` | 2秒後にまとめて |
| `SELECTED_TARGET_LANGUAGES` | 検証 `languages_check` | `{"1": {"1": {"language": "English", "country": "United States", "enable": true}, "2": {"language": "English", "country": "United States", "enable": false}, "3": {"language": "English", "country": "United States", "enable": false}}, "2": {"1": {"language": "English", "country": "United States", "enable": true}, "2": {"language": "English", "country": "United States", "enable": false}, "3": {"language": "English", "country": "United States", "enable": false}}, "3": {"1": {"language": "English", "country": "United States", "enable": true}, "2": {"language": "English", "country": "United States", "enable": false}, "3": {"language": "English", "country": "United States", "enable": false}}}` | 2秒後にまとめて |
| `SELECTED_TRANSLATION_COMPUTE_TYPE` | 検証 `compute_type` | `"auto"` | 2秒後にまとめて |
| `AUTO_MIC_SELECT` | bool | `true` | 2秒後にまとめて |
| `AUTO_SPEAKER_SELECT` | bool | `true` | 2秒後にまとめて |
| `SELECTED_MIC_HOST` | 検証 `device_choice` | `"NoHost"` | 2秒後にまとめて |
| `SELECTED_MIC_DEVICE` | 検証 `device_choice` | `"NoDevice"` | 2秒後にまとめて |
| `SELECTED_MIC_DEVICE_ID` | 独自の検証 | `""` | 2秒後にまとめて |
| `SELECTED_SPEAKER_DEVICE_ID` | 独自の検証 | `""` | 2秒後にまとめて |
| `SELECTED_SPEAKER_DEVICE` | 検証 `device_choice` | `"NoDevice"` | 2秒後にまとめて |
| `SELECTED_TRANSLATION_COMPUTE_DEVICE` | 検証 `compute_device` | `{"device": "cpu", "device_index": 0, "device_name": "cpu", "compute_types": ["auto", "float32", "int8", "int8_float32"]}` | 2秒後にまとめて |
| `ENABLE_CLIPBOARD` | bool | `false` | 2秒後にまとめて |
| `OCR_SOURCE_LANGUAGE` | str（`SELECTABLE_OCR_SOURCE_LANGUAGE_LIST`のどれか） | `"auto"` | 2秒後にまとめて |
| `OCR_WINDOW_TITLE` | str、独自の検証 | `"VRChat"` | 2秒後にまとめて |
| `OCR_POLL_INTERVAL_MS` | int（100〜5000） | `750` | 2秒後にまとめて |
| `OCR_MIN_CONFIDENCE` | number（0.1〜0.99） | `0.85` | 2秒後にまとめて |
| `OCR_BUBBLE_MIN_TEXT_LENGTH` | int（1〜50） | `2` | 2秒後にまとめて |
| `OCR_CAPTURE_REGION` | dict、検証 `ocr_region` | `{"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}` | 2秒後にまとめて |
| `OCR_VR_CAPTURE_REGION` | dict、検証 `ocr_region` | `{"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}` | 2秒後にまとめて |
| `OCR_CHATBOX_FILTER` | bool | `true` | 2秒後にまとめて |
| `OCR_USE_CHATBOX_DETECTOR` | bool | `true` | 2秒後にまとめて |
| `OCR_PORTAL_RESTORE_TOKEN` | str、独自の検証 | `""` | 即時 |


## 保存しないキー（46件）

実行中だけの状態、選択肢の一覧、読み取り専用の値。起動のたびに既定値や検出結果から作り直す。

| キー | 型・検証 | 既定値 | 扱い |
|---|---|---|---|
| `VERSION` |  | `"0.7.0-beta.3"` | 読み取り専用 |
| `PATH_LOCAL` |  | `"<app>"` | 読み取り専用 |
| `PATH_DATA` |  | `"<data>"` | 読み取り専用 |
| `PATH_CONFIG` |  | `"<state>/config.json"` | 読み取り専用 |
| `PATH_LOGS` |  | `"<state>/logs"` | 読み取り専用 |
| `GITHUB_URL` |  | `"https://api.github.com/repos/kein5/astarot/releases/latest"` | 読み取り専用 |
| `GITHUB_RELEASES_LIST_URL` |  | `"https://api.github.com/repos/kein5/astarot/releases"` | 読み取り専用 |
| `MIN_SUPPORTED_VERSION` |  | `"0.1.0"` | 読み取り専用 |
| `SELECTABLE_RELEASE_CHANNEL_LIST` |  | `["stable", "beta"]` | 読み取り専用 |
| `MAX_MIC_THRESHOLD` |  | `2000` | 読み取り専用 |
| `MAX_SPEAKER_THRESHOLD` |  | `2000` | 読み取り専用 |
| `WATCHDOG_TIMEOUT` |  | `60` | 読み取り専用 |
| `WATCHDOG_INTERVAL` |  | `20` | 読み取り専用 |
| `SELECTABLE_TAB_NO_LIST` |  | `["1", "2", "3"]` | 読み取り専用 |
| `SELECTED_TAB_TARGET_LANGUAGES_NO_LIST` |  | `["1", "2", "3"]` | 読み取り専用 |
| `SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_LIST` |  | `["m2m100_418M-ct2-int8", "m2m100_1.2B-ct2-int8", "nllb-200-distilled-600M-ct2-int8", "nllb-200-distilled-1.3B-ct2-int8"]` | 読み取り専用 |
| `SELECTABLE_TRANSLATION_ENGINE_LIST` |  | `["DeepL_API", "Google_Cloud_API", "Papago_API", "CTranslate2", "Plamo_API", "Gemini_API", "OpenAI_API", "LMStudio", "OpenAI_Compatible", "Ollama", "Groq_API", "OpenRouter_API"]` | 読み取り専用 |
| `SELECTABLE_TRANSCRIPTION_ENGINE_LIST` |  | `["SpeechCpp", "Groq_Whisper", "OpenAI_Whisper", "Custom_Whisper", "Deepgram"]` | 読み取り専用 |
| `SELECTABLE_UI_LANGUAGE_LIST` |  | `["en", "ja"]` | 読み取り専用 |
| `SELECTABLE_OCR_SOURCE_LANGUAGE_LIST` |  | `["auto", "Arabic", "Hindi", "Korean", "Russian", "Thai", "Ukrainian"]` | 読み取り専用 |
| `COMPUTE_MODE` |  | `"cpu"` | 読み取り専用 |
| `SELECTABLE_COMPUTE_DEVICE_LIST` |  | `[{"device": "cpu", "device_index": 0, "device_name": "cpu", "compute_types": ["auto", "float32", "int8", "int8_float32"]}]` | 読み取り専用 |
| `SEND_MESSAGE_BUTTON_TYPE_LIST` |  | `["show", "hide", "show_and_disable_enter_key"]` | 読み取り専用 |
| `TRAY_COMPANION_EDGE_LIST` |  | `["right", "left", "top", "bottom"]` | 読み取り専用 |
| `ENABLE_TRANSLATION` | bool | `false` | 保存しない |
| `ENABLE_TRANSCRIPTION_SEND` | bool | `false` | 保存しない |
| `ENABLE_TRANSCRIPTION_RECEIVE` | bool | `false` | 保存しない |
| `ENABLE_OCR_CAPTURE` | bool | `false` | 保存しない |
| `ENABLE_CHECK_ENERGY_SEND` | bool | `false` | 保存しない |
| `ENABLE_CHECK_ENERGY_RECEIVE` | bool | `false` | 保存しない |
| `SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT` | dict | `{"m2m100_418M-ct2-int8": false, "m2m100_1.2B-ct2-int8": false, "nllb-200-distilled-600M-ct2-int8": false, "nllb-200-distilled-1.3B-ct2-int8": false}` | 保存しない |
| `SELECTABLE_TRANSLATION_ENGINE_STATUS` | dict | `{"DeepL_API": false, "Google_Cloud_API": false, "Papago_API": false, "CTranslate2": false, "Plamo_API": false, "Gemini_API": false, "OpenAI_API": false, "LMStudio": false, "OpenAI_Compatible": false, "Ollama": false, "Groq_API": false, "OpenRouter_API": false}` | 保存しない |
| `SELECTABLE_TRANSCRIPTION_ENGINE_STATUS` | dict | `{"SpeechCpp": false, "Groq_Whisper": false, "OpenAI_Whisper": false, "Custom_Whisper": false, "Deepgram": false}` | 保存しない |
| `SELECTABLE_PLAMO_MODEL_LIST` | list | `[]` | 保存しない |
| `SELECTABLE_GEMINI_MODEL_LIST` | list | `[]` | 保存しない |
| `SELECTABLE_OPENAI_MODEL_LIST` | list | `[]` | 保存しない |
| `SELECTABLE_GROQ_MODEL_LIST` | list | `[]` | 保存しない |
| `SELECTABLE_OPENROUTER_MODEL_LIST` | list | `[]` | 保存しない |
| `SELECTABLE_LMSTUDIO_MODEL_LIST` | list | `[]` | 保存しない |
| `SELECTABLE_OPENAI_COMPATIBLE_MODEL_LIST` | list | `[]` | 保存しない |
| `SELECTABLE_OLLAMA_MODEL_LIST` | list | `[]` | 保存しない |
| `SELECTABLE_GROQ_WHISPER_MODEL_LIST` | list | `[]` | 保存しない |
| `SELECTABLE_OPENAI_WHISPER_MODEL_LIST` | list | `[]` | 保存しない |
| `SELECTABLE_CUSTOM_WHISPER_MODEL_LIST` | list | `[]` | 保存しない |
| `SELECTABLE_DEEPGRAM_MODEL_LIST` | list | `[]` | 保存しない |
| `DEEPGRAM_MODEL_LANGUAGES` | dict | `{}` | 保存しない |
