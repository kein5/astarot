<!-- 自動生成。手で編集しない。`python tools/spec_catalog.py --write`で更新する。 -->

# IPCエンドポイント一覧

UIから中核への要求と、中核からUIへの通知（`RUN_MAPPING`）の一覧。中核（`native/core`）が`tests/spec_catalog.rs`で書き出した`tools/spec_core_catalog.json`から生成した。メッセージの形、状態コード、ロックと再試行の規則は[IPCプロトコル](../ipc-protocol.md)にある。

列の意味:

- 初期化前: 「待つ」は初期化が終わるまでロックされる要求（中核が約30秒まで入れ直し、解けなければ423を返す）。「可」は起動直後から受け付ける。
- UIの受信先: 200の応答を処理するUIのフック（`useReceiveRoutes.ts`の静的ルートと`ui_config_setter.ts`の定義から生成）。「—」は受信先がない。
- ログで伏せる: `process.log`で値を`***MASKED***`に置き換える（`log::SENSITIVE_ENDPOINT_MARKERS`）。stdoutのIPCそのものは伏せない。

## 要求（477件: 削除 13、取得 213、実行 49、有効化 41、無効化 44、設定 117）

並びは中核が経路を足した順（`controller/routes.rs`）。

| エンドポイント | 種別 | 初期化前 | UIの受信先 | 備考 |
|---|---|---|---|---|
| `/get/data/foreground` | 取得 | 可 | useMainFunction.restoreForeground |  |
| `/set/enable/foreground` | 有効化 | 可 | useMainFunction.updateForegroundStatus |  |
| `/set/disable/foreground` | 無効化 | 可 | useMainFunction.updateForegroundStatus |  |
| `/get/data/selected_tab_no` | 取得 | 可 | useLanguageSettings.updateSelectedPresetTabNumber |  |
| `/set/data/selected_tab_no` | 設定 | 可 | useLanguageSettings.updateSelectedPresetTabNumber |  |
| `/get/data/main_window_sidebar_compact_mode` | 取得 | 可 | useIsMainPageCompactMode.updateIsMainPageCompactMode |  |
| `/set/enable/main_window_sidebar_compact_mode` | 有効化 | 可 | useIsMainPageCompactMode.updateIsMainPageCompactMode |  |
| `/set/disable/main_window_sidebar_compact_mode` | 無効化 | 可 | useIsMainPageCompactMode.updateIsMainPageCompactMode |  |
| `/get/data/selectable_translation_engines` | 取得 | 可 | useLanguageSettings.updateTranslatorAvailability |  |
| `/get/data/selectable_language_list` | 取得 | 可 | useLanguageSettings.updateSelectableLanguageList |  |
| `/get/data/selected_translation_engines` | 取得 | 待つ | useLanguageSettings.updateSelectedTranslationEngines |  |
| `/set/data/selected_translation_engines` | 設定 | 可 | useLanguageSettings.updateSelectedTranslationEngines |  |
| `/get/data/selected_your_languages` | 取得 | 可 | useLanguageSettings.updateSelectedYourLanguages |  |
| `/set/data/selected_your_languages` | 設定 | 可 | useLanguageSettings.updateSelectedYourLanguages |  |
| `/get/data/selected_target_languages` | 取得 | 可 | useLanguageSettings.updateSelectedTargetLanguages |  |
| `/set/data/selected_target_languages` | 設定 | 可 | useLanguageSettings.updateSelectedTargetLanguages |  |
| `/get/data/selectable_transcription_engines` | 取得 | 待つ | useTranscription.updateFromBackendSelectableTranscriptionEngines |  |
| `/get/data/selected_transcription_engine` | 取得 | 待つ | useTranscription.updateFromBackendSelectedTranscriptionEngine |  |
| `/set/data/selected_transcription_engine` | 設定 | 待つ | useTranscription.setSuccessSelectedTranscriptionEngine |  |
| `/get/data/selectable_groq_whisper_model_list` | 取得 | 可 | useTranscription.updateFromBackendSelectableGroqWhisperModelList |  |
| `/get/data/selected_groq_whisper_model` | 取得 | 可 | useTranscription.updateFromBackendSelectedGroqWhisperModel |  |
| `/set/data/selected_groq_whisper_model` | 設定 | 可 | useTranscription.setSuccessSelectedGroqWhisperModel |  |
| `/get/data/selectable_openai_whisper_model_list` | 取得 | 可 | useTranscription.updateFromBackendSelectableOpenAIWhisperModelList |  |
| `/get/data/selected_openai_whisper_model` | 取得 | 可 | useTranscription.updateFromBackendSelectedOpenAIWhisperModel |  |
| `/set/data/selected_openai_whisper_model` | 設定 | 可 | useTranscription.setSuccessSelectedOpenAIWhisperModel |  |
| `/get/data/custom_whisper_url` | 取得 | 可 | useTranscription.updateFromBackendCustomWhisperURL |  |
| `/get/data/selectable_custom_whisper_model_list` | 取得 | 可 | useTranscription.updateFromBackendSelectableCustomWhisperModelList |  |
| `/get/data/selected_custom_whisper_model` | 取得 | 可 | useTranscription.updateFromBackendSelectedCustomWhisperModel |  |
| `/set/data/selected_custom_whisper_model` | 設定 | 可 | useTranscription.setSuccessSelectedCustomWhisperModel |  |
| `/get/data/selectable_deepgram_model_list` | 取得 | 可 | useTranscription.updateFromBackendSelectableDeepgramModelList |  |
| `/get/data/selected_deepgram_model` | 取得 | 可 | useTranscription.updateFromBackendSelectedDeepgramModel |  |
| `/set/data/selected_deepgram_model` | 設定 | 可 | useTranscription.setSuccessSelectedDeepgramModel |  |
| `/get/data/selectable_release_channels` | 取得 | 可 | （受け取るだけ） |  |
| `/get/data/release_channel` | 取得 | 可 | useExperimentalFeatures.updateFromBackendReleaseChannel |  |
| `/set/data/release_channel` | 設定 | 可 | useExperimentalFeatures.setSuccessReleaseChannel |  |
| `/get/data/telemetry` | 取得 | 可 | useOthers.updateFromBackendTelemetry |  |
| `/get/data/auto_download_models` | 取得 | 可 | useOthers.updateFromBackendAutoDownloadModels |  |
| `/set/enable/auto_download_models` | 有効化 | 可 | useOthers.setSuccessAutoDownloadModels |  |
| `/set/disable/auto_download_models` | 無効化 | 可 | useOthers.setSuccessAutoDownloadModels |  |
| `/run/shutdown` | 実行 | 可 | （受け取るだけ） |  |
| `/run/swap_your_language_and_target_language` | 実行 | 可 | useLanguageSettings.updateBothSelectedLanguages |  |
| `/set/disable/translation` | 無効化 | 待つ | useMainFunction.updateTranslationStatus |  |
| `/get/data/auto_mic_select` | 取得 | 可 | useDevice.updateFromBackendEnableAutoMicSelect |  |
| `/get/data/auto_speaker_select` | 取得 | 可 | useDevice.updateFromBackendEnableAutoSpeakerSelect |  |
| `/get/data/selected_mic_host` | 取得 | 可 | useDevice.updateFromBackendSelectedMicHost |  |
| `/get/data/selected_mic_device` | 取得 | 可 | useDevice.updateFromBackendSelectedMicDevice |  |
| `/get/data/selected_mic_device_id` | 取得 | 可 | useDevice.updateFromBackendSelectedMicDeviceId |  |
| `/get/data/selected_speaker_device` | 取得 | 可 | useDevice.updateFromBackendSelectedSpeakerDevice |  |
| `/get/data/selected_speaker_device_id` | 取得 | 可 | useDevice.updateFromBackendSelectedSpeakerDeviceId |  |
| `/get/data/voice_settings` | 取得 | 可 | useVoice.updateSettings | ログで伏せる |
| `/get/data/rvc_block_ms` | 取得 | 可 | useAdvancedSettings.updateFromBackendRvcBlockMs |  |
| `/set/data/rvc_block_ms` | 設定 | 可 | useAdvancedSettings.setSuccessRvcBlockMs |  |
| `/get/data/version` | 取得 | 可 | useSoftwareVersion.updateSoftwareVersion |  |
| `/get/data/transparency` | 取得 | 可 | useAppearance.updateFromBackendTransparency |  |
| `/set/data/transparency` | 設定 | 可 | useAppearance.setSuccessTransparency |  |
| `/get/data/ui_scaling` | 取得 | 可 | useAppearance.updateFromBackendUiScaling |  |
| `/set/data/ui_scaling` | 設定 | 可 | useAppearance.setSuccessUiScaling |  |
| `/get/data/textbox_ui_scaling` | 取得 | 可 | useAppearance.updateFromBackendMessageLogUiScaling |  |
| `/set/data/textbox_ui_scaling` | 設定 | 可 | useAppearance.setSuccessMessageLogUiScaling |  |
| `/get/data/message_box_ratio` | 取得 | 可 | useMessageInputBoxRatio.updateMessageInputBoxRatio |  |
| `/set/data/message_box_ratio` | 設定 | 可 | useMessageInputBoxRatio.updateMessageInputBoxRatio |  |
| `/get/data/send_message_button_type` | 取得 | 可 | useAppearance.updateFromBackendSendMessageButtonType |  |
| `/set/data/send_message_button_type` | 設定 | 可 | useAppearance.setSuccessSendMessageButtonType |  |
| `/get/data/show_resend_button` | 取得 | 可 | useAppearance.updateFromBackendShowResendButton |  |
| `/set/enable/show_resend_button` | 有効化 | 可 | useAppearance.setSuccessShowResendButton |  |
| `/set/disable/show_resend_button` | 無効化 | 可 | useAppearance.setSuccessShowResendButton |  |
| `/get/data/font_family` | 取得 | 可 | useAppearance.updateFromBackendSelectedFontFamily |  |
| `/set/data/font_family` | 設定 | 可 | useAppearance.setSuccessSelectedFontFamily |  |
| `/get/data/ui_language` | 取得 | 可 | useAppearance.updateFromBackendUiLanguage |  |
| `/set/data/ui_language` | 設定 | 可 | useAppearance.setSuccessUiLanguage |  |
| `/get/data/main_window_geometry` | 取得 | 可 | （受け取るだけ） |  |
| `/set/data/main_window_geometry` | 設定 | 可 | （受け取るだけ） |  |
| `/get/data/compute_mode` | 取得 | 可 | useComputeMode.updateComputeMode |  |
| `/get/data/selectable_translation_compute_device_list` | 取得 | 可 | useTranslation.updateFromBackendSelectableTranslationComputeDeviceList |  |
| `/get/data/selected_translation_compute_device` | 取得 | 可 | useTranslation.updateFromBackendSelectedTranslationComputeDevice |  |
| `/set/data/selected_translation_compute_device` | 設定 | 可 | useTranslation.setSuccessSelectedTranslationComputeDevice |  |
| `/get/data/selectable_ctranslate2_weight_type_dict` | 取得 | 可 | useTranslation.updateDownloadedCTranslate2WeightTypeStatus |  |
| `/get/data/selected_ctranslate2_weight_type` | 取得 | 可 | useTranslation.updateFromBackendSelectedCTranslate2WeightType |  |
| `/get/data/selected_translation_compute_type` | 取得 | 可 | useTranslation.updateFromBackendSelectedTranslationComputeType |  |
| `/set/data/selected_translation_compute_type` | 設定 | 可 | useTranslation.setSuccessSelectedTranslationComputeType |  |
| `/get/data/convert_message_to_romaji` | 取得 | 可 | useOthers.updateFromBackendConvertMessageToRomaji |  |
| `/set/enable/convert_message_to_romaji` | 有効化 | 可 | useOthers.setSuccessConvertMessageToRomaji |  |
| `/set/disable/convert_message_to_romaji` | 無効化 | 可 | useOthers.setSuccessConvertMessageToRomaji |  |
| `/get/data/convert_message_to_hiragana` | 取得 | 可 | useOthers.updateFromBackendConvertMessageToHiragana |  |
| `/set/enable/convert_message_to_hiragana` | 有効化 | 可 | useOthers.setSuccessConvertMessageToHiragana |  |
| `/set/disable/convert_message_to_hiragana` | 無効化 | 可 | useOthers.setSuccessConvertMessageToHiragana |  |
| `/get/data/mic_threshold` | 取得 | 可 | useDevice.updateFromBackendMicThreshold |  |
| `/set/data/mic_threshold` | 設定 | 可 | useDevice.setSuccessMicThreshold |  |
| `/get/data/mic_automatic_threshold` | 取得 | 可 | useDevice.updateFromBackendEnableAutomaticMicThreshold |  |
| `/set/enable/mic_automatic_threshold` | 有効化 | 可 | useDevice.setSuccessEnableAutomaticMicThreshold |  |
| `/set/disable/mic_automatic_threshold` | 無効化 | 可 | useDevice.setSuccessEnableAutomaticMicThreshold |  |
| `/get/data/mic_record_timeout` | 取得 | 可 | useTranscription.updateFromBackendMicRecordTimeout |  |
| `/set/data/mic_record_timeout` | 設定 | 可 | useTranscription.setSuccessMicRecordTimeout |  |
| `/get/data/mic_phrase_timeout` | 取得 | 可 | useTranscription.updateFromBackendMicPhraseTimeout |  |
| `/set/data/mic_phrase_timeout` | 設定 | 可 | useTranscription.setSuccessMicPhraseTimeout |  |
| `/get/data/mic_max_phrases` | 取得 | 可 | useTranscription.updateFromBackendMicMaxWords |  |
| `/set/data/mic_max_phrases` | 設定 | 可 | useTranscription.setSuccessMicMaxWords |  |
| `/get/data/hotkeys` | 取得 | 可 | useHotkeys.updateHotkeys |  |
| `/set/data/hotkeys` | 設定 | 可 | useHotkeys.setSuccessHotkeys |  |
| `/get/data/experimental_features` | 取得 | 可 | useExperimentalFeatures.updateFromBackendExperimentalFeatures |  |
| `/set/data/experimental_features` | 設定 | 可 | useExperimentalFeatures.setSuccessExperimentalFeatures |  |
| `/get/data/usage_presets` | 取得 | 可 | useUsagePresets.updateFromBackendUsagePresets |  |
| `/set/data/usage_presets` | 設定 | 可 | useUsagePresets.setSuccessUsagePresets |  |
| `/get/data/catalog_layout` | 取得 | 可 | useAppearance.updateFromBackendCatalogLayout |  |
| `/set/data/catalog_layout` | 設定 | 可 | useAppearance.setSuccessCatalogLayout |  |
| `/get/data/theme` | 取得 | 可 | useAppearance.updateFromBackendTheme |  |
| `/set/data/theme` | 設定 | 可 | useAppearance.setSuccessTheme |  |
| `/get/data/llm_translation_temperature` | 取得 | 可 | useTranslation.updateFromBackendLLMTranslationTemperature |  |
| `/set/data/llm_translation_temperature` | 設定 | 可 | useTranslation.setSuccessLLMTranslationTemperature |  |
| `/get/data/llm_translation_instructions` | 取得 | 可 | useTranslation.updateFromBackendLLMTranslationInstructions | ログで伏せる |
| `/set/data/llm_translation_instructions` | 設定 | 可 | useTranslation.setSuccessLLMTranslationInstructions | ログで伏せる |
| `/get/data/tray_companion_edge` | 取得 | 可 | useExperimentalFeatures.updateFromBackendTrayCompanionEdge |  |
| `/set/data/tray_companion_edge` | 設定 | 可 | useExperimentalFeatures.setSuccessTrayCompanionEdge |  |
| `/get/data/tray_companion_monitor` | 取得 | 可 | useExperimentalFeatures.updateFromBackendTrayCompanionMonitor |  |
| `/set/data/tray_companion_monitor` | 設定 | 可 | useExperimentalFeatures.setSuccessTrayCompanionMonitor |  |
| `/get/data/tray_companion_wheel_hint_shown` | 取得 | 可 | useExperimentalFeatures.updateFromBackendTrayCompanionWheelHintShown |  |
| `/set/data/tray_companion_wheel_hint_shown` | 設定 | 可 | useExperimentalFeatures.setSuccessTrayCompanionWheelHintShown |  |
| `/get/data/mic_avg_logprob` | 取得 | 可 | useTranscription.updateFromBackendMicAvgLogprob |  |
| `/set/data/mic_avg_logprob` | 設定 | 可 | useTranscription.setSuccessMicAvgLogprob |  |
| `/get/data/mic_no_speech_prob` | 取得 | 可 | useTranscription.updateFromBackendMicNoSpeechProb |  |
| `/set/data/mic_no_speech_prob` | 設定 | 可 | useTranscription.setSuccessMicNoSpeechProb |  |
| `/get/data/mic_vad_filter` | 取得 | 可 | useDevice.updateFromBackendMicVadFilter |  |
| `/set/enable/mic_vad_filter` | 有効化 | 可 | useDevice.setSuccessMicVadFilter |  |
| `/set/disable/mic_vad_filter` | 無効化 | 可 | useDevice.setSuccessMicVadFilter |  |
| `/get/data/mic_word_filter` | 取得 | 可 | useTranscription.updateFromBackendMicWordFilterList |  |
| `/set/data/mic_word_filter` | 設定 | 可 | useTranscription.setSuccessMicWordFilterList |  |
| `/get/data/speaker_threshold` | 取得 | 可 | useDevice.updateFromBackendSpeakerThreshold |  |
| `/set/data/speaker_threshold` | 設定 | 可 | useDevice.setSuccessSpeakerThreshold |  |
| `/get/data/speaker_automatic_threshold` | 取得 | 可 | useDevice.updateFromBackendEnableAutomaticSpeakerThreshold |  |
| `/set/enable/speaker_automatic_threshold` | 有効化 | 可 | useDevice.setSuccessEnableAutomaticSpeakerThreshold |  |
| `/set/disable/speaker_automatic_threshold` | 無効化 | 可 | useDevice.setSuccessEnableAutomaticSpeakerThreshold |  |
| `/get/data/speaker_record_timeout` | 取得 | 可 | useTranscription.updateFromBackendSpeakerRecordTimeout |  |
| `/set/data/speaker_record_timeout` | 設定 | 可 | useTranscription.setSuccessSpeakerRecordTimeout |  |
| `/get/data/speaker_phrase_timeout` | 取得 | 可 | useTranscription.updateFromBackendSpeakerPhraseTimeout |  |
| `/set/data/speaker_phrase_timeout` | 設定 | 可 | useTranscription.setSuccessSpeakerPhraseTimeout |  |
| `/get/data/speaker_max_phrases` | 取得 | 可 | useTranscription.updateFromBackendSpeakerMaxWords |  |
| `/set/data/speaker_max_phrases` | 設定 | 可 | useTranscription.setSuccessSpeakerMaxWords |  |
| `/get/data/speaker_avg_logprob` | 取得 | 可 | useTranscription.updateFromBackendSpeakerAvgLogprob |  |
| `/set/data/speaker_avg_logprob` | 設定 | 可 | useTranscription.setSuccessSpeakerAvgLogprob |  |
| `/get/data/speaker_no_speech_prob` | 取得 | 可 | useTranscription.updateFromBackendSpeakerNoSpeechProb |  |
| `/set/data/speaker_no_speech_prob` | 設定 | 可 | useTranscription.setSuccessSpeakerNoSpeechProb |  |
| `/get/data/speaker_vad_filter` | 取得 | 可 | useDevice.updateFromBackendSpeakerVadFilter |  |
| `/set/enable/speaker_vad_filter` | 有効化 | 可 | useDevice.setSuccessSpeakerVadFilter |  |
| `/set/disable/speaker_vad_filter` | 無効化 | 可 | useDevice.setSuccessSpeakerVadFilter |  |
| `/get/data/vad_available` | 取得 | 可 | useDevice.updateFromBackendVadAvailable |  |
| `/get/data/virtual_mic_notice` | 取得 | 可 | useVirtualMic.updateNotice |  |
| `/set/disable/virtual_mic_notice` | 無効化 | 可 | useVirtualMic.updateNotice |  |
| `/get/data/first_run_setup` | 取得 | 可 | useFirstRunSetup.updateNotice |  |
| `/set/disable/first_run_setup` | 無効化 | 可 | useFirstRunSetup.updateNotice |  |
| `/get/data/overlay_vr_panel_opacity` | 取得 | 可 | useVr.updateFromBackendOverlayVrPanelOpacity |  |
| `/get/data/overlay_vr_panel_anchor` | 取得 | 可 | useVr.updateFromBackendOverlayVrPanelAnchor |  |
| `/get/data/overlay_vr_panel_locked` | 取得 | 可 | useVr.updateFromBackendOverlayVrPanelLocked |  |
| `/get/data/overlay_vr_panel_font_size` | 取得 | 可 | useVr.updateFromBackendOverlayVrPanelFontSize |  |
| `/get/data/overlay_vr_launcher_hand` | 取得 | 可 | useVr.updateFromBackendOverlayVrLauncherHand |  |
| `/get/data/overlay_vr_launcher_auto_hide` | 取得 | 可 | useVr.updateFromBackendOverlayVrLauncherAutoHide |  |
| `/get/data/overlay_vr_tooltip` | 取得 | 可 | useVr.updateFromBackendOverlayVrTooltip |  |
| `/set/enable/overlay_vr_tooltip` | 有効化 | 可 | useVr.setSuccessOverlayVrTooltip |  |
| `/set/disable/overlay_vr_tooltip` | 無効化 | 可 | useVr.setSuccessOverlayVrTooltip |  |
| `/set/data/overlay_vr_panel_font_size` | 設定 | 可 | useVr.setSuccessOverlayVrPanelFontSize |  |
| `/get/data/overlay_small_log` | 取得 | 可 | useVr.updateFromBackendIsEnabledOverlaySmallLog |  |
| `/get/data/overlay_small_log_settings` | 取得 | 可 | useVr.updateFromBackendOverlaySmallLogSettings |  |
| `/get/data/overlay_large_log` | 取得 | 可 | useVr.updateFromBackendIsEnabledOverlayLargeLog |  |
| `/get/data/overlay_vr_panel` | 取得 | 可 | useVr.updateFromBackendIsEnabledOverlayVrPanel |  |
| `/get/data/overlay_large_log_settings` | 取得 | 可 | useVr.updateFromBackendOverlayLargeLogSettings |  |
| `/get/data/overlay_desktop` | 取得 | 可 | useVr.updateFromBackendIsEnabledOverlayDesktop |  |
| `/set/enable/overlay_desktop` | 有効化 | 可 | useVr.setSuccessIsEnabledOverlayDesktop |  |
| `/set/disable/overlay_desktop` | 無効化 | 可 | useVr.setSuccessIsEnabledOverlayDesktop |  |
| `/get/data/overlay_desktop_settings` | 取得 | 可 | useVr.updateFromBackendOverlayDesktopSettings |  |
| `/set/data/overlay_desktop_settings` | 設定 | 可 | useVr.setSuccessOverlayDesktopSettings |  |
| `/get/data/overlay_desktop_placement` | 取得 | 可 | useVr.updateFromBackendOverlayDesktopPlacement |  |
| `/set/data/overlay_desktop_placement` | 設定 | 可 | useVr.setSuccessOverlayDesktopPlacement |  |
| `/get/data/io_flow_overlay_settings` | 取得 | 可 | useVr.updateFromBackendIoFlowOverlaySettings |  |
| `/set/data/io_flow_overlay_settings` | 設定 | 可 | useVr.setSuccessIoFlowOverlaySettings |  |
| `/get/data/overlay_show_only_translated_messages` | 取得 | 可 | useVr.updateFromBackendOverlayShowOnlyTranslatedMessages |  |
| `/set/enable/overlay_show_only_translated_messages` | 有効化 | 可 | useVr.setSuccessOverlayShowOnlyTranslatedMessages |  |
| `/set/disable/overlay_show_only_translated_messages` | 無効化 | 可 | useVr.setSuccessOverlayShowOnlyTranslatedMessages |  |
| `/get/data/send_message_format_parts` | 取得 | 可 | useOthers.updateFromBackendSendMessageFormatParts |  |
| `/set/data/send_message_format_parts` | 設定 | 可 | useOthers.setSuccessSendMessageFormatParts |  |
| `/get/data/received_message_format_parts` | 取得 | 可 | useOthers.updateFromBackendReceivedMessageFormatParts |  |
| `/set/data/received_message_format_parts` | 設定 | 可 | useOthers.setSuccessReceivedMessageFormatParts |  |
| `/get/data/auto_clear_message_box` | 取得 | 可 | useOthers.updateFromBackendEnableAutoClearMessageInputBox |  |
| `/set/enable/auto_clear_message_box` | 有効化 | 可 | useOthers.setSuccessEnableAutoClearMessageInputBox |  |
| `/set/disable/auto_clear_message_box` | 無効化 | 可 | useOthers.setSuccessEnableAutoClearMessageInputBox |  |
| `/get/data/send_only_translated_messages` | 取得 | 可 | useOthers.updateFromBackendEnableSendOnlyTranslatedMessages |  |
| `/set/enable/send_only_translated_messages` | 有効化 | 可 | useOthers.setSuccessEnableSendOnlyTranslatedMessages |  |
| `/set/disable/send_only_translated_messages` | 無効化 | 可 | useOthers.setSuccessEnableSendOnlyTranslatedMessages |  |
| `/get/data/check_software_updates` | 取得 | 可 | useOthers.updateFromBackendEnableCheckSoftwareUpdates |  |
| `/set/enable/check_software_updates` | 有効化 | 可 | useOthers.setSuccessEnableCheckSoftwareUpdates |  |
| `/set/disable/check_software_updates` | 無効化 | 可 | useOthers.setSuccessEnableCheckSoftwareUpdates |  |
| `/get/data/vrc_mic_mute_sync` | 取得 | 可 | useOthers.updateFromBackendEnableVrcMicMuteSync |  |
| `/get/data/send_message_to_vrc` | 取得 | 可 | useOthers.updateFromBackendEnableSendMessageToVrc |  |
| `/get/data/send_received_message_to_vrc` | 取得 | 可 | useOthers.updateFromBackendEnableSendReceivedMessageToVrc |  |
| `/set/enable/send_received_message_to_vrc` | 有効化 | 可 | useOthers.setSuccessEnableSendReceivedMessageToVrc |  |
| `/set/disable/send_received_message_to_vrc` | 無効化 | 可 | useOthers.setSuccessEnableSendReceivedMessageToVrc |  |
| `/get/data/websocket_host` | 取得 | 可 | useAdvancedSettings.updateFromBackendWebsocketHost |  |
| `/get/data/websocket_port` | 取得 | 可 | useAdvancedSettings.updateFromBackendWebsocketPort |  |
| `/get/data/websocket_auth_token` | 取得 | 可 | useAdvancedSettings.updateFromBackendWebsocketAuthToken | ログで伏せる |
| `/get/data/websocket_tls` | 取得 | 可 | useAdvancedSettings.updateFromBackendWebsocketTls |  |
| `/get/data/websocket_server` | 取得 | 可 | useAdvancedSettings.updateFromBackendEnableWebsocket |  |
| `/get/data/obs_browser_source` | 取得 | 可 | useAdvancedSettings.updateFromBackendEnableObsBrowserSource |  |
| `/get/data/obs_browser_source_port` | 取得 | 可 | useAdvancedSettings.updateFromBackendObsBrowserSourcePort |  |
| `/get/data/obs_browser_source_max_messages` | 取得 | 可 | useAdvancedSettings.updateFromBackendObsBrowserSourceMaxMessages |  |
| `/get/data/obs_browser_source_display_duration` | 取得 | 可 | useAdvancedSettings.updateFromBackendObsBrowserSourceDisplayDuration |  |
| `/get/data/obs_browser_source_fadeout_duration` | 取得 | 可 | useAdvancedSettings.updateFromBackendObsBrowserSourceFadeoutDuration |  |
| `/get/data/obs_browser_source_font_size` | 取得 | 可 | useAdvancedSettings.updateFromBackendObsBrowserSourceFontSize |  |
| `/get/data/obs_browser_source_font_color` | 取得 | 可 | useAdvancedSettings.updateFromBackendObsBrowserSourceFontColor |  |
| `/get/data/obs_browser_source_font_outline_thickness` | 取得 | 可 | useAdvancedSettings.updateFromBackendObsBrowserSourceFontOutlineThickness |  |
| `/get/data/obs_browser_source_font_outline_color` | 取得 | 可 | useAdvancedSettings.updateFromBackendObsBrowserSourceFontOutlineColor |  |
| `/get/data/clipboard` | 取得 | 可 | useVr.updateFromBackendVoiceTypingMode |  |
| `/set/enable/clipboard` | 有効化 | 可 | useVr.setSuccessVoiceTypingMode |  |
| `/set/disable/clipboard` | 無効化 | 可 | useVr.setSuccessVoiceTypingMode |  |
| `/get/data/selectable_ocr_source_languages` | 取得 | 可 | useOcr.updateFromBackendSelectableOcrSourceLanguageList |  |
| `/get/data/ocr_source_language` | 取得 | 可 | useOcr.updateFromBackendOcrSourceLanguage |  |
| `/get/data/ocr_window_title` | 取得 | 可 | useOcr.updateFromBackendOcrWindowTitle |  |
| `/get/data/ocr_poll_interval_ms` | 取得 | 可 | useOcr.updateFromBackendOcrPollIntervalMs |  |
| `/get/data/ocr_min_confidence` | 取得 | 可 | useOcr.updateFromBackendOcrMinConfidence |  |
| `/get/data/ocr_bubble_min_text_length` | 取得 | 可 | useOcr.updateFromBackendOcrBubbleMinTextLength |  |
| `/get/data/ocr_capture_region` | 取得 | 可 | useOcr.updateFromBackendOcrCaptureRegion |  |
| `/get/data/ocr_vr_capture_region` | 取得 | 可 | useOcr.updateFromBackendOcrVrCaptureRegion |  |
| `/get/data/ocr_chatbox_filter` | 取得 | 可 | useOcr.updateFromBackendOcrChatboxFilter |  |
| `/get/data/ocr_use_chatbox_detector` | 取得 | 可 | useOcr.updateFromBackendOcrUseChatboxDetector |  |
| `/get/data/ocr_portal_restore_token` | 取得 | 可 | useOcr.updateFromBackendOcrPortalRestoreToken | ログで伏せる |
| `/set/data/ocr_portal_restore_token` | 設定 | 可 | useOcr.updateFromBackendOcrPortalRestoreToken | ログで伏せる |
| `/get/data/osc_ip_address` | 取得 | 可 | useAdvancedSettings.updateFromBackendOscIpAddress |  |
| `/get/data/osc_port` | 取得 | 可 | useAdvancedSettings.updateFromBackendOscPort |  |
| `/get/data/osc_query` | 取得 | 可 | useAdvancedSettings.updateFromBackendEnableOscQuery |  |
| `/get/data/notification_vrc_sfx` | 取得 | 可 | useOthers.updateFromBackendEnableNotificationVrcSfx |  |
| `/set/enable/notification_vrc_sfx` | 有効化 | 可 | useOthers.setSuccessEnableNotificationVrcSfx |  |
| `/set/disable/notification_vrc_sfx` | 無効化 | 可 | useOthers.setSuccessEnableNotificationVrcSfx |  |
| `/run/feed_watchdog` | 実行 | 可 | （受け取るだけ） |  |
| `/get/data/speech_server_settings` | 取得 | 可 | useSpeechServers.updateSettings |  |
| `/set/data/speech_server_settings` | 設定 | 可 | useSpeechServers.updateSettings |  |
| `/get/data/speech_server_devices` | 取得 | 可 | useSpeechServers.updateDevices |  |
| `/get/data/speech_server_state` | 取得 | 可 | useSpeechServers.updateState |  |
| `/run/start_speech_server` | 実行 | 可 | useSpeechServers.updateState |  |
| `/run/stop_speech_server` | 実行 | 可 | useSpeechServers.updateState | 即時（キューを通らない） |
| `/set/enable/telemetry` | 有効化 | 可 | useOthers.setSuccessTelemetry |  |
| `/set/disable/telemetry` | 無効化 | 可 | useOthers.setSuccessTelemetry |  |
| `/get/data/telemetry_notice` | 取得 | 可 | useOthers.updateFromBackendTelemetryNotice |  |
| `/set/data/telemetry_notice` | 設定 | 可 | useOthers.setSuccessTelemetryNotice |  |
| `/get/data/telemetry_preview` | 取得 | 可 | useOthers.updateFromBackendTelemetryPreview |  |
| `/get/data/model_download_catalog` | 取得 | 可 | useModelDownloads.updateCatalog |  |
| `/get/data/model_download_hardware` | 取得 | 可 | useModelDownloads.updateHardware |  |
| `/run/refresh_model_download_hardware` | 実行 | 可 | useModelDownloads.updateHardware |  |
| `/get/data/model_download_state` | 取得 | 可 | useModelDownloads.updateState |  |
| `/run/start_model_download` | 実行 | 可 | useModelDownloads.acknowledge |  |
| `/run/cancel_model_download` | 実行 | 可 | useModelDownloads.acknowledge |  |
| `/run/apply_model_download` | 実行 | 可 | useModelDownloads.acknowledge |  |
| `/get/data/user_models` | 取得 | 可 | useModelDownloads.updateUserModels | ログで伏せる |
| `/run/register_user_model` | 実行 | 可 | useModelDownloads.acknowledgeUserModels | ログで伏せる |
| `/run/remove_user_model` | 実行 | 可 | useModelDownloads.acknowledgeUserModels | ログで伏せる |
| `/run/apply_user_model` | 実行 | 可 | useModelDownloads.acknowledgeUserModels | ログで伏せる |
| `/run/typing_message_box` | 実行 | 待つ | （受け取るだけ） |  |
| `/run/stop_typing_message_box` | 実行 | 待つ | （受け取るだけ） |  |
| `/set/enable/vrc_mic_mute_sync` | 有効化 | 可 | useOthers.setSuccessEnableVrcMicMuteSync |  |
| `/set/disable/vrc_mic_mute_sync` | 無効化 | 可 | useOthers.setSuccessEnableVrcMicMuteSync |  |
| `/set/enable/send_message_to_vrc` | 有効化 | 可 | useOthers.setSuccessEnableSendMessageToVrc |  |
| `/set/disable/send_message_to_vrc` | 無効化 | 可 | useOthers.setSuccessEnableSendMessageToVrc |  |
| `/get/data/vrchat_osc_presence` | 取得 | 可 | useOthers.updateFromBackendVrchatOscPresence |  |
| `/set/data/osc_ip_address` | 設定 | 可 | useAdvancedSettings.setSuccessOscIpAddress |  |
| `/set/data/osc_port` | 設定 | 可 | useAdvancedSettings.setSuccessOscPort |  |
| `/set/enable/osc_query` | 有効化 | 可 | useAdvancedSettings.setSuccessEnableOscQuery |  |
| `/set/disable/osc_query` | 無効化 | 可 | useAdvancedSettings.setSuccessEnableOscQuery |  |
| `/set/data/websocket_host` | 設定 | 可 | useAdvancedSettings.setSuccessWebsocketHost |  |
| `/set/data/websocket_port` | 設定 | 可 | useAdvancedSettings.setSuccessWebsocketPort |  |
| `/run/regenerate_websocket_auth_token` | 実行 | 可 | useAdvancedSettings.updateFromBackendWebsocketAuthToken | ログで伏せる |
| `/set/data/websocket_tls` | 設定 | 可 | useAdvancedSettings.setSuccessWebsocketTls |  |
| `/set/enable/websocket_server` | 有効化 | 可 | useAdvancedSettings.setSuccessEnableWebsocket |  |
| `/set/disable/websocket_server` | 無効化 | 可 | useAdvancedSettings.setSuccessEnableWebsocket |  |
| `/set/enable/obs_browser_source` | 有効化 | 可 | useAdvancedSettings.setSuccessEnableObsBrowserSource |  |
| `/set/disable/obs_browser_source` | 無効化 | 可 | useAdvancedSettings.setSuccessEnableObsBrowserSource |  |
| `/set/data/obs_browser_source_port` | 設定 | 可 | useAdvancedSettings.setSuccessObsBrowserSourcePort |  |
| `/set/data/obs_browser_source_max_messages` | 設定 | 可 | useAdvancedSettings.setSuccessObsBrowserSourceMaxMessages |  |
| `/set/data/obs_browser_source_display_duration` | 設定 | 可 | useAdvancedSettings.setSuccessObsBrowserSourceDisplayDuration |  |
| `/set/data/obs_browser_source_fadeout_duration` | 設定 | 可 | useAdvancedSettings.setSuccessObsBrowserSourceFadeoutDuration |  |
| `/set/data/obs_browser_source_font_size` | 設定 | 可 | useAdvancedSettings.setSuccessObsBrowserSourceFontSize |  |
| `/set/data/obs_browser_source_font_outline_thickness` | 設定 | 可 | useAdvancedSettings.setSuccessObsBrowserSourceFontOutlineThickness |  |
| `/set/data/obs_browser_source_font_color` | 設定 | 可 | useAdvancedSettings.setSuccessObsBrowserSourceFontColor |  |
| `/set/data/obs_browser_source_font_outline_color` | 設定 | 可 | useAdvancedSettings.setSuccessObsBrowserSourceFontOutlineColor |  |
| `/get/data/deepl_auth_key` | 取得 | 待つ | useTranslation.updateFromBackendDeepLAuthKey | ログで伏せる |
| `/delete/data/deepl_auth_key` | 削除 | 待つ | useTranslation.deleteSuccessDeepLAuthKey | ログで伏せる |
| `/get/data/plamo_auth_key` | 取得 | 待つ | useTranslation.updateFromBackendPlamoAuthKey | ログで伏せる |
| `/delete/data/plamo_auth_key` | 削除 | 待つ | useTranslation.deleteSuccessPlamoAuthKey | ログで伏せる |
| `/get/data/selectable_plamo_model_list` | 取得 | 待つ | useTranslation.updateFromBackendSelectablePlamoModelList |  |
| `/get/data/selected_plamo_model` | 取得 | 待つ | useTranslation.updateFromBackendSelectedPlamoModel |  |
| `/get/data/gemini_auth_key` | 取得 | 可 | useTranslation.updateFromBackendGeminiAuthKey | ログで伏せる |
| `/delete/data/gemini_auth_key` | 削除 | 可 | useTranslation.deleteSuccessGeminiAuthKey | ログで伏せる |
| `/get/data/selectable_gemini_model_list` | 取得 | 可 | useTranslation.updateFromBackendSelectableGeminiModelList |  |
| `/get/data/selected_gemini_model` | 取得 | 可 | useTranslation.updateFromBackendSelectedGeminiModel |  |
| `/get/data/openai_auth_key` | 取得 | 可 | useTranslation.updateFromBackendOpenAIAuthKey | ログで伏せる |
| `/delete/data/openai_auth_key` | 削除 | 可 | useTranslation.deleteSuccessOpenAIAuthKey | ログで伏せる |
| `/get/data/selectable_openai_model_list` | 取得 | 可 | useTranslation.updateFromBackendSelectableOpenAIModelList |  |
| `/get/data/selected_openai_model` | 取得 | 可 | useTranslation.updateFromBackendSelectedOpenAIModel |  |
| `/get/data/groq_auth_key` | 取得 | 可 | useTranslation.updateFromBackendGroqAuthKey | ログで伏せる |
| `/delete/data/groq_auth_key` | 削除 | 可 | useTranslation.deleteSuccessGroqAuthKey | ログで伏せる |
| `/get/data/selectable_groq_model_list` | 取得 | 可 | useTranslation.updateFromBackendSelectableGroqModelList |  |
| `/get/data/selected_groq_model` | 取得 | 可 | useTranslation.updateFromBackendSelectedGroqModel |  |
| `/get/data/openrouter_auth_key` | 取得 | 可 | useTranslation.updateFromBackendOpenRouterAuthKey | ログで伏せる |
| `/delete/data/openrouter_auth_key` | 削除 | 可 | useTranslation.deleteSuccessOpenRouterAuthKey | ログで伏せる |
| `/get/data/selectable_openrouter_model_list` | 取得 | 可 | useTranslation.updateFromBackendSelectableOpenRouterModelList |  |
| `/get/data/selected_openrouter_model` | 取得 | 可 | useTranslation.updateFromBackendSelectedOpenRouterModel |  |
| `/get/data/openai_compatible_auth_key` | 取得 | 可 | useTranslation.updateFromBackendOpenAICompatibleAuthKey | ログで伏せる |
| `/delete/data/openai_compatible_auth_key` | 削除 | 可 | useTranslation.deleteSuccessOpenAICompatibleAuthKey | ログで伏せる |
| `/get/data/openai_compatible_url` | 取得 | 可 | useTranslation.updateFromBackendOpenAICompatibleURL |  |
| `/set/data/openai_compatible_url` | 設定 | 可 | useTranslation.setSuccessOpenAICompatibleURL |  |
| `/get/data/selectable_openai_compatible_model_list` | 取得 | 可 | useTranslation.updateFromBackendSelectableOpenAICompatibleModelList |  |
| `/get/data/selected_openai_compatible_model` | 取得 | 可 | useTranslation.updateFromBackendSelectedOpenAICompatibleModel |  |
| `/get/data/lmstudio_url` | 取得 | 可 | useTranslation.updateFromBackendLMStudioURL |  |
| `/get/data/selected_lmstudio_model` | 取得 | 可 | useTranslation.updateFromBackendSelectedLMStudioModel |  |
| `/get/data/selected_ollama_model` | 取得 | 可 | useTranslation.updateFromBackendSelectedOllamaModel |  |
| `/get/data/ollama_url` | 取得 | 可 | useTranslation.updateFromBackendOllamaURL |  |
| `/get/data/google_cloud_auth_key` | 取得 | 可 | useTranslation.updateFromBackendGoogleCloudAuthKey | ログで伏せる |
| `/delete/data/google_cloud_auth_key` | 削除 | 可 | useTranslation.deleteSuccessGoogleCloudAuthKey | ログで伏せる |
| `/get/data/papago_client_id` | 取得 | 可 | useTranslation.updateFromBackendPapagoClientID | ログで伏せる |
| `/get/data/papago_auth_key` | 取得 | 可 | useTranslation.updateFromBackendPapagoAuthKey | ログで伏せる |
| `/delete/data/papago_auth_key` | 削除 | 可 | useTranslation.deleteSuccessPapagoAuthKey | ログで伏せる |
| `/get/data/groq_whisper_auth_key` | 取得 | 可 | useTranscription.updateFromBackendGroqWhisperAuthKey | ログで伏せる |
| `/delete/data/groq_whisper_auth_key` | 削除 | 可 | useTranscription.deleteSuccessGroqWhisperAuthKey | ログで伏せる |
| `/get/data/openai_whisper_auth_key` | 取得 | 可 | useTranscription.updateFromBackendOpenAIWhisperAuthKey | ログで伏せる |
| `/delete/data/openai_whisper_auth_key` | 削除 | 可 | useTranscription.deleteSuccessOpenAIWhisperAuthKey | ログで伏せる |
| `/get/data/custom_whisper_auth_key` | 取得 | 可 | useTranscription.updateFromBackendCustomWhisperAuthKey | ログで伏せる |
| `/delete/data/custom_whisper_auth_key` | 削除 | 可 | useTranscription.deleteSuccessCustomWhisperAuthKey | ログで伏せる |
| `/get/data/deepgram_auth_key` | 取得 | 可 | useTranscription.updateFromBackendDeepgramAuthKey | ログで伏せる |
| `/delete/data/deepgram_auth_key` | 削除 | 可 | useTranscription.deleteSuccessDeepgramAuthKey | ログで伏せる |
| `/set/data/custom_whisper_url` | 設定 | 可 | useTranscription.setSuccessCustomWhisperURL |  |
| `/set/data/ocr_window_title` | 設定 | 可 | useOcr.setSuccessOcrWindowTitle |  |
| `/set/data/ocr_poll_interval_ms` | 設定 | 可 | useOcr.setSuccessOcrPollIntervalMs |  |
| `/set/data/ocr_min_confidence` | 設定 | 可 | useOcr.setSuccessOcrMinConfidence |  |
| `/set/data/ocr_bubble_min_text_length` | 設定 | 可 | useOcr.setSuccessOcrBubbleMinTextLength |  |
| `/set/data/ocr_capture_region` | 設定 | 可 | useOcr.setSuccessOcrCaptureRegion |  |
| `/set/data/ocr_vr_capture_region` | 設定 | 可 | useOcr.setSuccessOcrVrCaptureRegion |  |
| `/set/enable/ocr_chatbox_filter` | 有効化 | 可 | useOcr.setSuccessOcrChatboxFilter |  |
| `/set/disable/ocr_chatbox_filter` | 無効化 | 可 | useOcr.setSuccessOcrChatboxFilter |  |
| `/set/enable/ocr_use_chatbox_detector` | 有効化 | 可 | useOcr.setSuccessOcrUseChatboxDetector |  |
| `/set/disable/ocr_use_chatbox_detector` | 無効化 | 可 | useOcr.setSuccessOcrUseChatboxDetector |  |
| `/set/enable/ocr_capture` | 有効化 | 待つ | useMainFunction.updateOcrCaptureStatus |  |
| `/set/disable/ocr_capture` | 無効化 | 待つ | useMainFunction.updateOcrCaptureStatus |  |
| `/set/data/ocr_source_language` | 設定 | 可 | useOcr.setSuccessOcrSourceLanguage |  |
| `/get/data/ocr_capture_status` | 取得 | 可 | useOcr.updateFromBackendOcrCaptureStatus |  |
| `/get/data/ocr_readiness` | 取得 | 可 | useOcr.updateFromBackendOcrReadiness |  |
| `/get/data/ocr_model_readiness` | 取得 | 可 | useOcr.updateFromBackendOcrModelReadiness |  |
| `/run/send_text_overlay` | 実行 | 可 | （受け取るだけ） |  |
| `/set/enable/overlay_small_log` | 有効化 | 可 | useVr.setSuccessIsEnabledOverlaySmallLog |  |
| `/set/disable/overlay_small_log` | 無効化 | 可 | useVr.setSuccessIsEnabledOverlaySmallLog |  |
| `/run/vr_panel_tooltip` | 実行 | 待つ | （受け取るだけ） |  |
| `/run/vr_panel_windows` | 実行 | 待つ | （受け取るだけ） |  |
| `/run/vr_panel_recall_log` | 実行 | 待つ | （受け取るだけ） |  |
| `/run/vr_launcher_reset` | 実行 | 待つ | （受け取るだけ） |  |
| `/get/data/vr_panel_layout` | 取得 | 可 | useVr.updateFromBackendVrPanelLayout |  |
| `/run/vr_panel_layout_rendered` | 実行 | 可 | （受け取るだけ） |  |
| `/set/data/overlay_vr_panel_anchor` | 設定 | 可 | useVr.setSuccessOverlayVrPanelAnchor |  |
| `/set/data/overlay_vr_launcher_hand` | 設定 | 可 | useVr.setSuccessOverlayVrLauncherHand |  |
| `/set/enable/overlay_vr_launcher_auto_hide` | 有効化 | 可 | useVr.setSuccessOverlayVrLauncherAutoHide |  |
| `/set/enable/overlay_vr_panel_locked` | 有効化 | 可 | useVr.setSuccessOverlayVrPanelLocked |  |
| `/set/disable/overlay_vr_launcher_auto_hide` | 無効化 | 可 | useVr.setSuccessOverlayVrLauncherAutoHide |  |
| `/set/disable/overlay_vr_panel_locked` | 無効化 | 可 | useVr.setSuccessOverlayVrPanelLocked |  |
| `/set/data/overlay_vr_panel_opacity` | 設定 | 可 | useVr.setSuccessOverlayVrPanelOpacity |  |
| `/set/data/overlay_small_log_settings` | 設定 | 可 | useVr.setSuccessOverlaySmallLogSettings |  |
| `/set/enable/overlay_vr_panel` | 有効化 | 可 | useVr.setSuccessIsEnabledOverlayVrPanel |  |
| `/set/disable/overlay_vr_panel` | 無効化 | 可 | useVr.setSuccessIsEnabledOverlayVrPanel |  |
| `/set/enable/overlay_large_log` | 有効化 | 可 | useVr.setSuccessIsEnabledOverlayLargeLog |  |
| `/set/disable/overlay_large_log` | 無効化 | 可 | useVr.setSuccessIsEnabledOverlayLargeLog |  |
| `/set/data/overlay_large_log_settings` | 設定 | 可 | useVr.setSuccessOverlayLargeLogSettings |  |
| `/get/data/overlay_font_family` | 取得 | 可 | useVr.updateFromBackendOverlayFontFamily |  |
| `/set/data/overlay_font_family` | 設定 | 可 | useVr.setSuccessOverlayFontFamily |  |
| `/get/data/overlay_font_missing_languages` | 取得 | 可 | useVr.updateFromBackendOverlayFontMissingLanguages |  |
| `/set/data/speaker_names` | 設定 | 可 | useSpeakerNames.updateNames | ログで伏せる |
| `/run/open_filepath_config_file` | 実行 | 可 | useOpenFolder.openedFolder_ConfigFile |  |
| `/run/open_filepath_logs` | 実行 | 可 | useOpenFolder.openedFolder_MessageLogs |  |
| `/run/export_vocabulary` | 実行 | 可 | （受け取るだけ） | ログで伏せる |
| `/run/open_filepath_vocabulary_exports` | 実行 | 可 | useOpenFolder.openedFolder_VocabularyExports | ログで伏せる |
| `/get/data/gpu_check_state` | 取得 | 可 | useGpuCheck.updateState |  |
| `/run/start_gpu_check` | 実行 | 可 | useGpuCheck.updateAnswer |  |
| `/run/stop_gpu_check` | 実行 | 可 | useGpuCheck.updateAnswer |  |
| `/set/data/deepl_auth_key` | 設定 | 待つ | useTranslation.setSuccessDeepLAuthKey | ログで伏せる |
| `/set/data/plamo_auth_key` | 設定 | 待つ | useTranslation.setSuccessPlamoAuthKey | ログで伏せる |
| `/set/data/selected_plamo_model` | 設定 | 待つ | useTranslation.setSuccessSelectedPlamoModel |  |
| `/set/data/gemini_auth_key` | 設定 | 可 | useTranslation.setSuccessGeminiAuthKey | ログで伏せる |
| `/set/data/selected_gemini_model` | 設定 | 可 | useTranslation.setSuccessSelectedGeminiModel |  |
| `/set/data/openai_auth_key` | 設定 | 可 | useTranslation.setSuccessOpenAIAuthKey | ログで伏せる |
| `/set/data/selected_openai_model` | 設定 | 可 | useTranslation.setSuccessSelectedOpenAIModel |  |
| `/set/data/groq_auth_key` | 設定 | 可 | useTranslation.setSuccessGroqAuthKey | ログで伏せる |
| `/set/data/selected_groq_model` | 設定 | 可 | useTranslation.setSuccessSelectedGroqModel |  |
| `/set/data/openrouter_auth_key` | 設定 | 可 | useTranslation.setSuccessOpenRouterAuthKey | ログで伏せる |
| `/set/data/selected_openrouter_model` | 設定 | 可 | useTranslation.setSuccessSelectedOpenRouterModel |  |
| `/set/data/google_cloud_auth_key` | 設定 | 可 | useTranslation.setSuccessGoogleCloudAuthKey | ログで伏せる |
| `/set/data/papago_client_id` | 設定 | 可 | useTranslation.setSuccessPapagoClientID | ログで伏せる |
| `/set/data/papago_auth_key` | 設定 | 可 | useTranslation.setSuccessPapagoAuthKey | ログで伏せる |
| `/get/data/connected_lmstudio` | 取得 | 可 | useLLMConnection.setConnectionStatus_LMStudio |  |
| `/run/lmstudio_connection` | 実行 | 可 | useLLMConnection.setConnectionStatus_LMStudio |  |
| `/get/data/selectable_lmstudio_model_list` | 取得 | 可 | useTranslation.updateFromBackendSelectableLMStudioModelList |  |
| `/set/data/selected_lmstudio_model` | 設定 | 可 | useTranslation.setSuccessSelectedLMStudioModel |  |
| `/set/data/lmstudio_url` | 設定 | 可 | useTranslation.setSuccessLMStudioURL |  |
| `/set/data/openai_compatible_auth_key` | 設定 | 可 | useTranslation.setSuccessOpenAICompatibleAuthKey | ログで伏せる |
| `/set/data/openai_compatible_auth_key_and_url` | 設定 | 可 | useTranslation.setSuccessOpenAICompatibleAuthKey | ログで伏せる |
| `/set/data/selected_openai_compatible_model` | 設定 | 可 | useTranslation.setSuccessSelectedOpenAICompatibleModel |  |
| `/get/data/connected_ollama` | 取得 | 可 | useLLMConnection.setConnectionStatus_Ollama |  |
| `/run/ollama_connection` | 実行 | 可 | useLLMConnection.setConnectionStatus_Ollama |  |
| `/get/data/selectable_ollama_model_list` | 取得 | 可 | useTranslation.updateFromBackendSelectableOllamaModelList |  |
| `/set/data/selected_ollama_model` | 設定 | 可 | useTranslation.setSuccessSelectedOllamaModel |  |
| `/set/data/ollama_url` | 設定 | 可 | useTranslation.setSuccessOllamaURL |  |
| `/set/data/selected_ctranslate2_weight_type` | 設定 | 可 | useTranslation.setSuccessSelectedCTranslate2WeightType |  |
| `/set/enable/translation` | 有効化 | 待つ | useMainFunction.updateTranslationStatus |  |
| `/get/data/translation_catalog` | 取得 | 可 | useTranslationCatalog.updateCatalog | ログで伏せる |
| `/run/register_translation_catalog_entry` | 実行 | 待つ | useTranslationCatalog.acknowledge | ログで伏せる |
| `/run/remove_translation_catalog_entry` | 実行 | 待つ | useTranslationCatalog.acknowledge | ログで伏せる |
| `/run/use_translation_catalog_entry` | 実行 | 待つ | useTranslationCatalog.acknowledge | ログで伏せる |
| `/run/send_message_box` | 実行 | 待つ | useMessage.updateSentMessageLogById |  |
| `/get/data/logger_feature` | 取得 | 可 | useOthers.updateFromBackendEnableAutoExportMessageLogs |  |
| `/set/enable/logger_feature` | 有効化 | 可 | useOthers.setSuccessEnableAutoExportMessageLogs |  |
| `/set/disable/logger_feature` | 無効化 | 可 | useOthers.setSuccessEnableAutoExportMessageLogs |  |
| `/get/data/selectable_mic_host_list` | 取得 | 可 | useDevice.updateFromBackendMicHostList |  |
| `/get/data/selectable_mic_device_list` | 取得 | 可 | useDevice.updateFromBackendMicDeviceList |  |
| `/get/data/selectable_speaker_device_list` | 取得 | 可 | useDevice.updateFromBackendSpeakerDeviceList |  |
| `/set/enable/auto_mic_select` | 有効化 | 可 | useDevice.setSuccessEnableAutoMicSelect |  |
| `/set/disable/auto_mic_select` | 無効化 | 可 | useDevice.setSuccessEnableAutoMicSelect |  |
| `/get/data/selectable_mic_device_options` | 取得 | 可 | useDevice.updateFromBackendMicDeviceOptions |  |
| `/set/data/selected_mic_device` | 設定 | 可 | useDevice.setSuccessSelectedMicDevice |  |
| `/set/data/selected_mic_device_id` | 設定 | 可 | useDevice.setSuccessSelectedMicDeviceId |  |
| `/set/enable/auto_speaker_select` | 有効化 | 可 | useDevice.setSuccessEnableAutoSpeakerSelect |  |
| `/set/disable/auto_speaker_select` | 無効化 | 可 | useDevice.setSuccessEnableAutoSpeakerSelect |  |
| `/get/data/selectable_speaker_device_options` | 取得 | 可 | useDevice.updateFromBackendSpeakerDeviceOptions |  |
| `/set/data/selected_speaker_device` | 設定 | 可 | useDevice.setSuccessSelectedSpeakerDevice |  |
| `/set/data/selected_speaker_device_id` | 設定 | 可 | useDevice.setSuccessSelectedSpeakerDeviceId |  |
| `/set/data/selected_mic_host` | 設定 | 可 | useDevice.setSuccessSelectedMicHost |  |
| `/get/data/virtual_mic_status` | 取得 | 可 | useVirtualMic.updateStatus |  |
| `/run/virtual_mic_test` | 実行 | 可 | useVirtualMic.updateResult |  |
| `/get/data/available_releases` | 取得 | 可 | （受け取るだけ） |  |
| `/run/update_software` | 実行 | 可 | （受け取るだけ） |  |
| `/run/update_cuda_software` | 実行 | 可 | （受け取るだけ） |  |
| `/set/enable/transcription_send` | 有効化 | 待つ | useMainFunction.updateTranscriptionSendStatus |  |
| `/set/disable/transcription_send` | 無効化 | 待つ | useMainFunction.updateTranscriptionSendStatus |  |
| `/set/enable/check_mic_threshold` | 有効化 | 可 | useVolume.updateMicThresholdCheckStatus |  |
| `/set/disable/check_mic_threshold` | 無効化 | 可 | useVolume.updateMicThresholdCheckStatus |  |
| `/set/enable/transcription_receive` | 有効化 | 待つ | useMainFunction.updateTranscriptionReceiveStatus |  |
| `/set/disable/transcription_receive` | 無効化 | 待つ | useMainFunction.updateTranscriptionReceiveStatus |  |
| `/set/enable/check_speaker_threshold` | 有効化 | 可 | useVolume.updateSpeakerThresholdCheckStatus |  |
| `/set/disable/check_speaker_threshold` | 無効化 | 可 | useVolume.updateSpeakerThresholdCheckStatus |  |
| `/set/data/groq_whisper_auth_key` | 設定 | 可 | useTranscription.setSuccessGroqWhisperAuthKey | ログで伏せる |
| `/set/data/openai_whisper_auth_key` | 設定 | 可 | useTranscription.setSuccessOpenAIWhisperAuthKey | ログで伏せる |
| `/set/data/custom_whisper_auth_key` | 設定 | 可 | useTranscription.setSuccessCustomWhisperAuthKey | ログで伏せる |
| `/set/data/custom_whisper_auth_key_and_url` | 設定 | 可 | useTranscription.setSuccessCustomWhisperAuthKey | ログで伏せる |
| `/set/data/deepgram_auth_key` | 設定 | 可 | useTranscription.setSuccessDeepgramAuthKey | ログで伏せる |
| `/get/data/realtime_asr_settings` | 取得 | 可 | useRealtimeASR.updateSettings |  |
| `/set/data/realtime_asr_settings` | 設定 | 可 | useRealtimeASR.updateSettings |  |
| `/get/data/realtime_asr_endpoints` | 取得 | 可 | useRealtimeASR.updateEndpoints |  |
| `/get/data/realtime_asr_models` | 取得 | 可 | useRealtimeASR.updateModels |  |
| `/get/data/builtin_vocabulary` | 取得 | 可 | useRealtimeASR.updateBuiltinVocabulary | ログで伏せる |
| `/get/data/realtime_asr_state` | 取得 | 可 | useRealtimeASR.updateState |  |
| `/run/start_realtime_asr` | 実行 | 可 | useRealtimeASR.updateState |  |
| `/run/stop_realtime_asr` | 実行 | 可 | useRealtimeASR.updateState | 即時（キューを通らない） |
| `/set/data/voice_settings` | 設定 | 可 | useVoice.updateSettings | ログで伏せる |
| `/get/data/voice_status` | 取得 | 可 | useVoice.updateStatus |  |
| `/get/data/tts_model_options` | 取得 | 可 | useVoice.updateModelOptions |  |
| `/get/data/tts_engine_voices` | 取得 | 可 | useVoice.updateEngineVoices |  |
| `/get/data/voice_output_devices` | 取得 | 可 | useVoice.updateDevices |  |
| `/run/stop_voice` | 実行 | 可 | useVoice.updateStatus | 即時（キューを通らない） |
| `/run/enable_tts` | 実行 | 可 | useVoice.updateStatus |  |
| `/run/disable_tts` | 実行 | 可 | useVoice.updateStatus | 即時（キューを通らない） |
| `/get/data/voice_route` | 取得 | 可 | useVoice.updateRoute |  |
| `/set/disable/managed_route_rename_notice` | 無効化 | 可 | useVoice.updateRoute |  |
| `/run/mute_voice` | 実行 | 可 | useVoice.updateRoute | 即時（キューを通らない） |
| `/run/resume_voice` | 実行 | 可 | useVoice.updateRoute | 即時（キューを通らない） |
| `/get/data/direct_voice_sources` | 取得 | 可 | useVoice.updateDirectSources |  |
| `/set/data/direct_voice_settings` | 設定 | 可 | useVoice.updateDirectState | ログで伏せる |
| `/get/data/direct_voice_state` | 取得 | 可 | useVoice.updateDirectState |  |
| `/get/data/io_flow` | 取得 | 可 | useIoFlow.updateIoFlow |  |
| `/run/start_direct_voice` | 実行 | 可 | useVoice.updateDirectState |  |
| `/run/stop_direct_voice` | 実行 | 可 | useVoice.updateDirectState | 即時（キューを通らない） |
| `/get/data/voice_audition_state` | 取得 | 可 | useVoiceAudition.updateState |  |
| `/run/start_voice_audition` | 実行 | 可 | useVoiceAudition.updateState |  |
| `/run/stop_voice_audition` | 実行 | 可 | useVoiceAudition.updateState | 即時（キューを通らない） |
| `/get/data/vc_runtime_catalog` | 取得 | 可 | useVcRuntimes.updateCatalog |  |
| `/get/data/vc_runtime_state` | 取得 | 可 | useVcRuntimes.updateState |  |
| `/run/start_vc_runtime_setup` | 実行 | 可 | useVcRuntimes.acknowledge |  |
| `/run/cancel_vc_runtime_setup` | 実行 | 可 | useVcRuntimes.acknowledge |  |
| `/get/data/gpu_memory` | 取得 | 可 | useGpuMemory.updateGpuMemory |  |


## 通知（中核からUIへ、92件）

要求への応答とは別に、中核が自分から送るメッセージ。`Core::notify(名前, 結果)`で送り、名前は`controller/mod.rs`の`RUN_MAPPING`で終点に変わる。表にない名前は送る時点で止まる（契約のCT-02、`tests/run_mapping.rs`）。

| 名前 | エンドポイント | UIの受信先 |
|---|---|---|
| `enable_translation` | `/run/enable_translation` | — |
| `enable_transcription_send` | `/run/enable_transcription_send` | — |
| `enable_transcription_receive` | `/run/enable_transcription_receive` | — |
| `disable_transcription_send` | `/set/disable/transcription_send` | useMainFunction.updateTranscriptionSendStatus |
| `disable_transcription_receive` | `/set/disable/transcription_receive` | useMainFunction.updateTranscriptionReceiveStatus |
| `disable_check_mic_threshold` | `/set/disable/check_mic_threshold` | useVolume.updateMicThresholdCheckStatus |
| `disable_check_speaker_threshold` | `/set/disable/check_speaker_threshold` | useVolume.updateSpeakerThresholdCheckStatus |
| `connected_network` | `/run/connected_network` | useHandleNetworkConnection.handleNetworkConnection |
| `enable_ai_models` | `/run/enable_ai_models` | useIsVrctAvailable.handleAiModelsAvailability |
| `update_software` | `/run/update_software` | （受け取るだけ） |
| `update_cuda_software` | `/run/update_cuda_software` | （受け取るだけ） |
| `transcription_mic` | `/run/transcription_send_mic_message` | useMessage.addSentMessageLog |
| `transcription_speaker` | `/run/transcription_receive_speaker_message` | useMessage.addReceivedMessageLog |
| `transcription_ocr` | `/run/transcription_ocr_message` | useMessage.addReceivedMessageLog |
| `enable_ocr_capture` | `/run/enable_ocr_capture` | — |
| `check_mic_volume` | `/run/check_mic_volume` | useVolume.updateVolumeVariable_Mic |
| `check_speaker_volume` | `/run/check_speaker_volume` | useVolume.updateVolumeVariable_Speaker |
| `audio_device_switched` | `/run/audio_device_switched` | （受け取るだけ） |
| `error_device` | `/run/error_device` | — |
| `error_translation_engine` | `/run/error_translation_engine` | — |
| `message_output_error` | `/run/message_output_error` | — |
| `error_translation_enable_vram_overflow` | `/run/error_translation_enable_vram_overflow` | — |
| `error_translation_chat_vram_overflow` | `/run/error_translation_chat_vram_overflow` | — |
| `error_translation_mic_vram_overflow` | `/run/error_translation_mic_vram_overflow` | — |
| `error_translation_speaker_vram_overflow` | `/run/error_translation_speaker_vram_overflow` | — |
| `translation_compute_device_fallback` | `/run/translation_compute_device_fallback` | （受け取るだけ） |
| `word_filter` | `/run/word_filter` | useMessage.addSystemMessageLog_FromBackend |
| `transcription_recognition_error` | `/run/transcription_recognition_error` | useMessage.addSystemMessageLog_FromBackend |
| `vad_unavailable` | `/run/vad_unavailable` | — |
| `download_progress_ctranslate2_weight` | `/run/download_progress_ctranslate2_weight` | useTranslation.updateDownloadProgressCTranslate2WeightTypeStatus |
| `downloaded_ctranslate2_weight` | `/run/downloaded_ctranslate2_weight` | useTranslation.downloadedCTranslate2WeightTypeStatus |
| `error_ctranslate2_weight` | `/run/error_ctranslate2_weight` | — |
| `ctranslate2_license_notice` | `/run/ctranslate2_license_notice` | — |
| `translation_model_retired` | `/run/translation_model_retired` | — |
| `translation_language_unsupported` | `/run/translation_language_unsupported` | — |
| `selected_mic_host` | `/run/selected_mic_host` | useDevice.updateFromBackendSelectedMicHost |
| `selected_mic_device_id` | `/run/selected_mic_device_id` | useDevice.updateFromBackendSelectedMicDeviceId |
| `selectable_mic_device_options` | `/run/selectable_mic_device_options` | useDevice.updateFromBackendMicDeviceOptions |
| `selected_mic_device` | `/run/selected_mic_device` | useDevice.updateFromBackendSelectedMicDevice |
| `selected_speaker_device_id` | `/run/selected_speaker_device_id` | useDevice.updateFromBackendSelectedSpeakerDeviceId |
| `selectable_speaker_device_options` | `/run/selectable_speaker_device_options` | useDevice.updateFromBackendSpeakerDeviceOptions |
| `selected_speaker_device` | `/run/selected_speaker_device` | useDevice.updateFromBackendSelectedSpeakerDevice |
| `selected_translation_engines` | `/run/selected_translation_engines` | useLanguageSettings.updateSelectedTranslationEngines |
| `translation_engines` | `/run/translation_engines` | useLanguageSettings.updateTranslatorAvailability |
| `selected_your_languages` | `/run/selected_your_languages` | useLanguageSettings.updateSelectedYourLanguages |
| `selected_target_languages` | `/run/selected_target_languages` | useLanguageSettings.updateSelectedTargetLanguages |
| `selectable_language_list` | `/run/selectable_language_list` | useLanguageSettings.updateSelectableLanguageList |
| `selected_translation_compute_type` | `/run/selected_translation_compute_type` | useTranslation.updateFromBackendSelectedTranslationComputeType |
| `selectable_plamo_model_list` | `/run/selectable_plamo_model_list` | useTranslation.updateFromBackendSelectablePlamoModelList |
| `selected_plamo_model` | `/run/selected_plamo_model` | useTranslation.updateFromBackendSelectedPlamoModel |
| `selectable_gemini_model_list` | `/run/selectable_gemini_model_list` | useTranslation.updateFromBackendSelectableGeminiModelList |
| `selected_gemini_model` | `/run/selected_gemini_model` | useTranslation.updateFromBackendSelectedGeminiModel |
| `selectable_openai_model_list` | `/run/selectable_openai_model_list` | useTranslation.updateFromBackendSelectableOpenAIModelList |
| `selected_openai_model` | `/run/selected_openai_model` | useTranslation.updateFromBackendSelectedOpenAIModel |
| `selectable_groq_model_list` | `/run/selectable_groq_model_list` | useTranslation.updateFromBackendSelectableGroqModelList |
| `selected_groq_model` | `/run/selected_groq_model` | useTranslation.updateFromBackendSelectedGroqModel |
| `selectable_openrouter_model_list` | `/run/selectable_openrouter_model_list` | useTranslation.updateFromBackendSelectableOpenRouterModelList |
| `selected_openrouter_model` | `/run/selected_openrouter_model` | useTranslation.updateFromBackendSelectedOpenRouterModel |
| `selectable_lmstudio_model_list` | `/run/selectable_lmstudio_model_list` | useTranslation.updateFromBackendSelectableLMStudioModelList |
| `selected_lmstudio_model` | `/run/selected_lmstudio_model` | useTranslation.updateFromBackendSelectedLMStudioModel |
| `selectable_openai_compatible_model_list` | `/run/selectable_openai_compatible_model_list` | useTranslation.updateFromBackendSelectableOpenAICompatibleModelList |
| `selected_openai_compatible_model` | `/run/selected_openai_compatible_model` | useTranslation.updateFromBackendSelectedOpenAICompatibleModel |
| `selectable_ollama_model_list` | `/run/selectable_ollama_model_list` | useTranslation.updateFromBackendSelectableOllamaModelList |
| `selected_ollama_model` | `/run/selected_ollama_model` | useTranslation.updateFromBackendSelectedOllamaModel |
| `selectable_groq_whisper_model_list` | `/run/selectable_groq_whisper_model_list` | useTranscription.updateFromBackendSelectableGroqWhisperModelList |
| `selected_groq_whisper_model` | `/run/selected_groq_whisper_model` | useTranscription.updateFromBackendSelectedGroqWhisperModel |
| `selectable_openai_whisper_model_list` | `/run/selectable_openai_whisper_model_list` | useTranscription.updateFromBackendSelectableOpenAIWhisperModelList |
| `selected_openai_whisper_model` | `/run/selected_openai_whisper_model` | useTranscription.updateFromBackendSelectedOpenAIWhisperModel |
| `selectable_custom_whisper_model_list` | `/run/selectable_custom_whisper_model_list` | useTranscription.updateFromBackendSelectableCustomWhisperModelList |
| `selected_custom_whisper_model` | `/run/selected_custom_whisper_model` | useTranscription.updateFromBackendSelectedCustomWhisperModel |
| `selectable_deepgram_model_list` | `/run/selectable_deepgram_model_list` | useTranscription.updateFromBackendSelectableDeepgramModelList |
| `selected_deepgram_model` | `/run/selected_deepgram_model` | useTranscription.updateFromBackendSelectedDeepgramModel |
| `overlay_small_log_settings` | `/run/overlay_small_log_settings` | useVr.updateFromBackendOverlaySmallLogSettings |
| `vr_panel_pointer` | `/run/vr_panel_pointer` | useVrPanelPointer.forwardVrPanelPointer |
| `vr_panel_log_out_of_view` | `/run/vr_panel_log_out_of_view` | useVrPanelLogOutOfView.updateVrPanelLogOutOfView |
| `overlay_vr_launcher_hand` | `/run/overlay_vr_launcher_hand` | useVr.updateFromBackendOverlayVrLauncherHand |
| `vr_panel_launcher_intro` | `/run/vr_panel_launcher_intro` | useVrPanelLauncherIntro.updateVrPanelLauncherIntro |
| `overlay_vr_panel_anchor` | `/run/overlay_vr_panel_anchor` | useVr.updateFromBackendOverlayVrPanelAnchor |
| `vr_panel_layout` | `/run/vr_panel_layout` | useVr.updateFromBackendVrPanelLayout |
| `overlay_large_log_settings` | `/run/overlay_large_log_settings` | useVr.updateFromBackendOverlayLargeLogSettings |
| `selectable_mic_host_list` | `/run/selectable_mic_host_list` | useDevice.updateFromBackendMicHostList |
| `selectable_mic_device_list` | `/run/selectable_mic_device_list` | useDevice.updateFromBackendMicDeviceList |
| `selectable_speaker_device_list` | `/run/selectable_speaker_device_list` | useDevice.updateFromBackendSpeakerDeviceList |
| `software_update_info` | `/run/software_update_info` | useSoftwareVersion.updateSoftwareVersionInfo |
| `virtual_mic_level` | `/run/virtual_mic_level` | useVirtualMic.updateLevel |
| `initialization_progress` | `/run/initialization_progress` | useInitProgress.updateInitProgress |
| `initialization_complete` | `/run/initialization_complete` | — |
| `config_file_unreadable` | `/run/config_file_unreadable` | （受け取るだけ） |
| `config_save_failed` | `/run/config_save_failed` | （受け取るだけ） |
| `config_save_recovered` | `/run/config_save_recovered` | （受け取るだけ） |
| `secret_store_failed` | `/run/secret_store_failed` | （受け取るだけ） |
| `enable_osc_query` | `/run/enable_osc_query` | useHandleOscQuery.handleOscQuery |


## UIに受信先がないエンドポイント（17件）

200で届いた場合にUIが`Invalid endpoint`としてコンソールに出すもの。ただし、400で届くエラーの通知（`/run/error_…`など）は`errorHandling_Backend`が処理し、`/run/initialization_complete`は`receiveRoutes`が個別に処理するので、このどちらかに当たるものは実害がない。

- `/run/ctranslate2_license_notice`
- `/run/enable_ocr_capture`
- `/run/enable_transcription_receive`
- `/run/enable_transcription_send`
- `/run/enable_translation`
- `/run/error_ctranslate2_weight`
- `/run/error_device`
- `/run/error_translation_chat_vram_overflow`
- `/run/error_translation_enable_vram_overflow`
- `/run/error_translation_engine`
- `/run/error_translation_mic_vram_overflow`
- `/run/error_translation_speaker_vram_overflow`
- `/run/initialization_complete`
- `/run/message_output_error`
- `/run/translation_language_unsupported`
- `/run/translation_model_retired`
- `/run/vad_unavailable`


## UIだけにあるルート（60件）

UIに受信先が定義されているが、中核の要求と通知にはないもの。多くは`ui_config_setter.ts`の定義が機械的に作るルートで、使われない。

- `/get/data/ctranslate2_weight`
- `/run/download_ctranslate2_weight`
- `/run/io_trace`
- `/run/pending_ctranslate2_weight`
- `/run/realtime_caption`
- `/set/data/auto_clear_message_box`
- `/set/data/auto_download_models`
- `/set/data/auto_mic_select`
- `/set/data/auto_speaker_select`
- `/set/data/check_software_updates`
- `/set/data/clipboard`
- `/set/data/convert_message_to_hiragana`
- `/set/data/convert_message_to_romaji`
- `/set/data/ctranslate2_weight`
- `/set/data/logger_feature`
- `/set/data/mic_automatic_threshold`
- `/set/data/mic_vad_filter`
- `/set/data/notification_vrc_sfx`
- `/set/data/obs_browser_source`
- `/set/data/ocr_chatbox_filter`
- `/set/data/ocr_use_chatbox_detector`
- `/set/data/osc_query`
- `/set/data/overlay_desktop`
- `/set/data/overlay_large_log`
- `/set/data/overlay_show_only_translated_messages`
- `/set/data/overlay_small_log`
- `/set/data/overlay_vr_launcher_auto_hide`
- `/set/data/overlay_vr_panel`
- `/set/data/overlay_vr_panel_locked`
- `/set/data/overlay_vr_tooltip`
- `/set/data/selectable_custom_whisper_model_list`
- `/set/data/selectable_deepgram_model_list`
- `/set/data/selectable_gemini_model_list`
- `/set/data/selectable_groq_model_list`
- `/set/data/selectable_groq_whisper_model_list`
- `/set/data/selectable_lmstudio_model_list`
- `/set/data/selectable_mic_device_list`
- `/set/data/selectable_mic_device_options`
- `/set/data/selectable_mic_host_list`
- `/set/data/selectable_ocr_source_languages`
- `/set/data/selectable_ollama_model_list`
- `/set/data/selectable_openai_compatible_model_list`
- `/set/data/selectable_openai_model_list`
- `/set/data/selectable_openai_whisper_model_list`
- `/set/data/selectable_openrouter_model_list`
- `/set/data/selectable_plamo_model_list`
- `/set/data/selectable_speaker_device_list`
- `/set/data/selectable_speaker_device_options`
- `/set/data/selectable_translation_compute_device_list`
- `/set/data/send_message_to_vrc`
- `/set/data/send_only_translated_messages`
- `/set/data/send_received_message_to_vrc`
- `/set/data/show_resend_button`
- `/set/data/speaker_automatic_threshold`
- `/set/data/speaker_vad_filter`
- `/set/data/telemetry`
- `/set/data/vrc_mic_mute_sync`
- `/set/data/websocket_server`
- `/set/disable/tray_companion_wheel_hint_shown`
- `/set/enable/tray_companion_wheel_hint_shown`
