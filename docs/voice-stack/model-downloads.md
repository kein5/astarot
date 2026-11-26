# Downloading default models from the settings

[日本語版](#設定画面からの既定モデル取得日本語版)

A download UI was added inside "Models and servers" for TTS and ASR (the section for the bundled speech.cpp server) and on the RVC settings page. It shows the provider, model name, exact size, links to the terms of use, purpose, cautions and save location, and it requires consent through a checkbox and a start action. Local translation (ONNX Runtime) models in the catalog are downloaded through the same confirmation dialog.

Consent is tied to the catalog version at the time the warning was opened. A download does not start with an updated version that has not been reviewed.

"Apply model path" after a successful download is a separate action. It re-verifies the completed files and applies the path only when the currently saved path matches the value confirmed on screen and the target is stopped. Only the downloaded path is saved; other fields being edited in the form stay unsaved (a change of 2026-10-31; before that, the form had to be saved or discarded first). The path cannot be applied when the path being replaced has unsaved edits of its own, or while a save is in progress. It keeps device, low_latency, the RVC runtime, pitch/index_rate, RVC's device/threads/highpass and the input mode. It does not load the model, speak, or start a server or the microphone.

The same job's cancel button stays available while the apply step re-verifies. The responses to apply and to cancel are each checked, and no other apply or download starts until both waits have ended. A periodic state fetch or a waiting-for-response warning alone does not release the wait on an operation.

## Confirming non-commercial licenses

For a model with a non-commercial license (such as NLLB-200), the dialog asks, in addition to the consent above, for confirmation that use is limited to non-commercial purposes (#411). Translation models under the Gemma terms of use ask for confirmation of those terms through the same mechanism (see "Confirming the Gemma terms of use" below).

- The core (`catalog.rs` in `native/ops`) attaches `restrictions` to each catalog row. The value follows from the license string: it contains `non_commercial` for a Creative Commons NonCommercial license (CC-BY-NC-4.0 and the variants with -SA or -ND), and `gemma_terms` for a translation model (`target` is `translation`) under the Gemma Terms of Use (including one whose Hugging Face license label is only `gemma`). Models for other targets, such as TTS, do not get `gemma_terms` (`restrictions_for`). With both, the order is `["non_commercial", "gemma_terms"]`; otherwise the value is `[]`. The fields of `Model` and the shape of `receipt.json` do not change. A new kind of restriction is likewise added as a kind in this list.
- The confirmation dialog names the license and states, in a paragraph marked with a warning sign, that only non-commercial use is permitted. Below the consent checkbox it shows one checkbox per kind, and the download cannot start until all of them are checked. When the dialog is opened again, every checkbox is cleared.
- The start request (`/run/start_model_download`) puts the confirmed kinds in `acknowledged`. For a restricted model, a request that lacks one of its kinds is refused with `model_download_restriction_unacknowledged`; no file is written and nothing goes over the network. A request with an unknown kind, a duplicated kind or a kind the model does not have is refused with `download_request_invalid`. Requests for unrestricted models are the same as before and do not need `acknowledged` (an empty list is also accepted).
- The confirmation is not recorded. `receipt.json` keeps only the catalog fields, and confirmation is asked for on every download.
- The confirmation shown when NLLB is selected in the translation settings (`CTranslate2LicenseDialog` and the core's `WEIGHT_CTRANSLATE2_LICENSE_CONSENT_REQUIRED`) is separate and stays as it is.

### Confirming the Gemma terms of use

Gemma's weights and the models made from them are under the Gemma Terms of Use. The Prohibited Use Policy, which is part of those terms, applies to the people who use the model as well as to those who distribute it (ADR-015, [Paths to using TranslateGemma for translation](translategemma.md)).

- The confirmation dialog for `gemma_terms` states, in a paragraph marked with a warning sign, that the license includes the Gemma terms of use and the Prohibited Use Policy and that their conditions also apply to the people who use the model. The terms and the policy are listed as separate links under "Terms and licenses" in the confirmation dialog.
- A checkbox separate from the consent is required: "I have read the Gemma Terms of Use and the Prohibited Use Policy and will use this model under them." The start request carries `acknowledged: ["gemma_terms"]`; if it is missing, the core refuses the request with `model_download_restriction_unacknowledged`.
- Only translation models ask for this confirmation (decided on 2026-11-19; decision item 4 of [the plan for the translation LLM runtime](translation-llm-runtime-plan.md)). Irodori-TTS v4 Large (`irodori-v4-large-q8`, `Gemma Terms of Use + MIT + Apache-2.0`) has a text-reading part derived from Gemma, but it does not get this confirmation. Its confirmation dialog shows the license and the links to the terms (`GEMMA_TERMS_OF_USE.md` and `GEMMA_PROHIBITED_USE_POLICY.md`) as before, and the consent checkbox alone is enough to download it.
- No built-in TranslateGemma entry is listed until the project converts and publishes the model (decision item 3). So the pinned catalog of 2026-11-19 has no entry that carries this confirmation.

## Built-in CTranslate2 and tokenizer files

The 0.5.0 core retired this download. Local translation runs on ONNX Runtime (`native/translate-onnx`), and its models are downloaded from the target `translation` of the pinned catalog above, through the same confirmation and consent as other models. On 2026-11-19, the int8 builds of M2M100 418M (default, MIT, about 506 MB) and NLLB-200 distilled 600M (CC-BY-NC-4.0, about 643 MB) were published and added to the catalog (#687). On 2026-11-21, the int8 build of NLLB-200 distilled 1.3B (CC-BY-NC-4.0, about 1.4 GB) was added as well (#411). The NLLB confirmation shows dedicated text that states the non-commercial license, the free space the download needs and the memory used while translating (about 1.4 GiB for 600M, about 2.6 GiB for 1.3B). The download in the "Translation" settings opens the shared download dialog if there is an entry. If there is none, it says that the model has not been published and that a model you prepared yourself can be added with "Add a model of your own" in the translation catalog (up to #597, it pointed to the `translation-models` folder as the place to put one).

The model list in the "Translation" settings (#565) shows only downloaded models, models you added yourself and built-in models that have an entry in the catalog. "Included with the app" in the translation catalog follows the same rule, and its rows and cards use the name of the download catalog entry ("NLLB-200 distilled 600M · int8") (2026-11-21). NLLB-200 3.3B, which is not published, was removed from the built-in list. A setting that had it selected is loaded with the default, and a notice is shown once. Whether a built-in model has an entry is decided by the model's catalog ID (`<モデル>-onnx-<形>`, that is, the model and its format). Only rows with an entry show the download button; pressing it shows that model's entry in the shared download dialog. The selected model stays in the list with "Not available yet" even when it cannot be downloaded. When no built-in model can be downloaded and the selected model cannot be used either, the screen suggests an external translation API or a local LLM. The steps for publishing a model and adding it to the catalog are in the section on publishing and adding to the catalog in `tools/translation_onnx/README.md`.

The background is in items 1, 29 and 33 of the decisions list in [Core integration](core-integration.md). The old confirmation dialog that remained in the UI (the confirmation and consent for the catalog's `legacy_models`) was also removed in #1015. The confirmation dialog opened from the "Translation" settings and from the switch lists the translation models in the catalog. The rest of this section describes the Python download up to 0.4.

Built-in model downloads now cover translation (CTranslate2) only. Earlier versions also downloaded local Whisper weights through the same confirmation dialog under "Transcription" in the settings, but #288 removed local Whisper and that download with it. Models for local speech recognition (speech.cpp) are downloaded through the catalog download above, from "Models and servers" under "Speech recognition (ASR)". Weights that earlier versions downloaded to `weights/whisper/` are not read; they are deleted only when the user chooses to delete them in the settings ([Old Whisper weights](../spec/data-and-persistence.md#古い-whisper-の重み)).

Pressing "Download" in the "Translation" settings shows the model name, the provider, the license and the exact total size of all files pinned in `src-python/models/builtin_model_pins.py`. Nothing is downloaded until the box is checked and the download is started. For NLLB, the non-commercial (CC-BY-NC-4.0) restriction is shown even when it is already selected. The default for new settings is still M2M100, under MIT.

CTranslate2's tokenizer files are the pinned files in the same repository as the weights. The file list, which includes vocab and SentencePiece for M2M100 and tokenizer.json for NLLB, is checked by size and SHA-256. Nothing extra is downloaded from another repository, and every file is included in the total shown in the confirmation dialog. For example, M2M100 418M is 499,602,144 bytes including the tokenizer. A change of source is reflected in manifest_version, so CTranslate2 download consent recorded by an older version is asked for again at the next download. The license and the rule that nothing is downloaded without consent do not change.

The confirmation dialog uses the catalog's `legacy_models` and keeps the `manifest_version` from when it was opened. If `{weight_type, consent: true, manifest_version}` in the start request does not match the current model and list, the request is refused with `WEIGHT_DOWNLOAD_CONSENT_REQUIRED`, and the user is asked to confirm again. The confirmation at NLLB selection alone does not permit a download.

Consent is saved at once to `LEGACY_MODEL_DOWNLOAD_CONSENTS` in `config.json`. Even with the download-at-startup switch on, the download is skipped unless consent is recorded for the same model, the same weight version, and the sizes, SHA-256, license and tokenizer version of all files; startup then continues and points the user to the settings page. Retries at startup follow the same condition. Old settings count as having no record, and confirmation is asked for before the next download. Existing files are not deleted, and a saved NLLB selection is not changed.

When translation starts and when the downloaded state is checked, only the pinned tokenizer files are copied from the verified weights to a dedicated temporary folder. The copies are checked too, then loaded locally only, with an explicitly named tokenizer class. Unpinned extra files in an existing folder and the older Hub cache are not used. If a file is missing or does not match, the model does not count as downloaded, and a request to turn on translation gets TRANSLATION_MODEL_MISSING. If the tokenizer cannot be built from files that passed the check, downloading again would not fix it, so TRANSLATION_MODEL_LOAD_FAILED is returned.

The dialog uses the same CSS and native dialog element as the catalog download. Initial focus goes to "Back", Escape closes the dialog, and focus returns to the element that opened it. The width and height fit within the screen, and long Japanese text and repository names wrap. A download does not select a model or turn on translation or the microphone.

For the current core keeping the consent record (`LEGACY_MODEL_DOWNLOAD_CONSENTS`), see [Data formats and storage](../spec/data-and-persistence.md#その他); for the errors, see [Cross-cutting behavior](../spec/cross-cutting.md#同意と外部への送信). Integrity checks and the download process follow the contract below.

### Verification, storage and shutdown for built-in models

- The first availability check compares every file in the pinned list, existing files included, by size and SHA-256. A successful load alone does not make a model count as downloaded. The same check also runs just before loading. To avoid reading large files every time, the manifest's identifying value and each file's size, mtime_ns, ctime_ns, device and inode are recorded. Records in the old .weight_verified.json format and records for another manifest are not used. The check runs in the startup process or the download worker, and normal loads use the record. In a read-only location the record cannot be written, so the hash is computed again the next time. On Windows, `ctime_ns` is the creation time, so if a file is rewritten with the same size and its modification time is set back, the change cannot be detected while the record remains.
- If both the old and the new CTranslate2 names exist, both are kept, and the verified new name is chosen first, then the verified old name. If there is no new name, only a verified old name is moved. User files that do not match are not deleted. When a consented re-download succeeds for all files, the existing directory is kept as `.preserved-<weight>-<uuid>` in the same root before the new set is published.
- The same OS lease as the catalog uses is taken on the weights/ctranslate2 root. If another process is using the same root, the request is refused with download_busy. Files are written to a dedicated .partial-<uuid>, anything over the limit is refused before saving, and after fsync and a check of all files the directory is renamed to publish it. The older shared .part is not used and is left as a user file. Staging left behind by an abnormal exit is cleaned up only when the next consented download can confirm the lease and the ownership marker.
- The whole transfer of each file has a limit of 1800 seconds, which also covers up to 3 attempts and the waits between them. The read timeout for the body stays at 60 seconds. On timeout or cancellation, the same socket interruption as in the catalog is used. There is no guarantee that a Python thread can force-stop the work before DNS, the connection or the headers return, or during the OS's disk I/O. Shutdown first invalidates message delivery from all input sources and notifies both the catalog download/Apply and the built-in model download of the cancellation, then starts waiting. The built-in model side waits up to 2 seconds in total for taking the lock, interrupting the body and joining all workers, and logs anything left. Publishing after cancellation is forbidden. At startup, each attempt is waited on for up to 1800 seconds, and one retry happens only if the previous attempt could be cancelled and joined.
- Every exit path (success, failure, cancellation, use of existing files or an exception) returns a result with weight_type and job_id exactly once. A 200 for a download request means the request was accepted, not that it succeeded. The value downloaded=true is set only after the check of all files and the local load of the tokenizer both pass. The UI's failure handling clears pending and progress for that weight only and keeps the other weights. A refusal of a duplicate request within the same process carries active_job_id and does not clear the in-progress display.

## speech.cpp speech recognition models (2026-11-16)

From catalog version `2026-11-16.1`, all 7 recognition models that the bundled speech.cpp (0.11.0) handles can be downloaded in every quantization type (31 entries). They are qwen3-asr-0.6b, qwen3-asr-1.7b, reazonspeech-v2, parakeet-tdt_ctc-0.6b-ja, parakeet-tdt-0.6b-v3, haas-ja-v1.0 and nemotron-3.5-transcribe.

- For the revision, files, sizes, SHA-256, supported languages and default file, speech.cpp's catalog (`speech models --json`) is the source of truth. `tools/speechcpp_models.py` copies the output of the bundled version into `native/ops/data/speechcpp_models.json`. Do not copy it by hand. When the speech.cpp version goes up, run this tool again with the bundled version and raise `CATALOG_VERSION` too.
- The app side records only which names to offer and the license review (`offers` in `native/ops/data/speechcpp_asr.json`). The review record is in [licensing.md](licensing.md#speechcppの音声認識モデル2026-11-16) and `licenses/speechcpp-models/NOTICE.md`.
- `native/ops` also reads the text of the same 2 files (`downloads/speechcpp.rs`). The comparison with the copy of the Python catalog (`python_reference.json`) was retired in 0.6.0 (#746).
- An entry's id is `<名前>-<種類>`, that is, the name and the type (for example `reazonspeech-v2-q8` or `nemotron-35-transcribe-iq4nl`). The existing `haas-ja-q8` and `qwen3-asr-06b-q8` keep the same ids, so their downloaded folders can be used as they are.
- On screen, the user picks a "Recognition model" and a "File type (quantization)". At first, the file that speech.cpp downloads by name is selected, and the supported languages and speech.cpp's recommended languages are shown. As before, a download needs consent in the confirmation dialog. Selecting alone downloads nothing.
- Runtime handling does not change. The recognition server loads the selected file, and the language and vocabulary options follow what `/v1/models` reports. The entries for VAD (silero-vad) and diarization are unchanged too. Tests confirm that the 2 files match speech.cpp's catalog.

The newly added models have not yet been tested on a real server (because downloading them needs consent).

### Information for choosing (profile)

So that first-time users can compare and choose on the 0.5.0 screen, each catalog row carries information for users. The rows for speech recognition, VAD, diarization and TTS have it. For RVC and OCR rows it is `null`.

| What the user wants to know | Row field | Source |
|---|---|---|
| Display name | `name` (down to the file type), `speech.label` (the model name only) | Existing. `OFFERS` |
| Short description | `profile.summary` (the string key `model_downloads.summary.<key>`) | `PROFILES` and `locales/` |
| Supported languages | `profile.languages` | speech.cpp's catalog |
| Download size | `total_bytes` (per file, `artifacts[].size`) | Existing. speech.cpp's catalog |
| Hardware guide | `profile.memory_bytes` and `memory_measured_on`, `tier` (light, medium or heavy), `cpu`, `gpu` | Measured values in the model card. `tier` is computed from them |
| Recommendation | `profile.recommended_for` | `start` in speech.cpp's catalog. For TTS, `recommended_for` in `PROFILES` |

- The recommendation uses what speech.cpp names, per language, as the "model to start with". The app does not decide it separately. As of 2026-11-16 it is reazonspeech-v2 for Japanese; parakeet-tdt-0.6b-v3 for 9 European languages, Ukrainian among them; and qwen3-asr-0.6b for other languages. It is attached only to the row of the file that the name downloads (the default type).
- `memory_bytes` is the peak memory per type from the model card at the pinned revision. The device it was measured on is written in `memory_measured_on` (an H100 for Nemotron 3.5 Transcribe, an Apple M5 for the others). It is neither a measurement on your PC nor a guarantee of the amount needed. `tier` is light up to 1.5 GiB, medium up to 4 GiB and heavy above that.
- `cpu` records only what was checked by running on a CPU. `slow` is what ASTAROT measured, `practical` is for what speech.cpp builds to run on a CPU (VAD), and everything else is `unverified`. `gpu` was set to `recommended` for everything except VAD. All model card measurements were on GPUs, and in the measurement below the GPU was also much faster.
- Measurement of 2026-11-16: Windows 11, Intel Core i7-1255U, NVIDIA RTX 3060 Ti (connected over Thunderbolt, Vulkan1), speech.cpp 0.11.0, Qwen3-ASR 0.6B Q8_0, language `ja`. Windows synthesized speech (one Japanese sentence of 10.2 seconds) was recognized with `speech asr`, and the time per utterance was derived from the difference in run time between 1 file and 6 files. Over 2 runs each, the CPU took 2.95 and 4.26 seconds and the GPU took 0.08 and 0.16 seconds. It runs on a CPU, but captions lag a few seconds behind the speech. This was measured on one synthesized sentence and is not an evaluation of accuracy.

TTS rows (added on 2026-11-16):

- These rows are pinned by hand in the catalog, so `ids` in `PROFILES` point to the catalog ID for each file type (for example `irodori-v41-f16` for Irodori-TTS MF F16).
- The recommendation is `recommended_for` in `PROFILES`, and it replaces speech.cpp's `start`. This is because speech.cpp suggests Qwen3-TTS 0.6B for Japanese as well, while ASTAROT reads Japanese with Irodori-TTS (the japanese profile) and other languages with Qwen3-TTS (the multilingual profile). Japanese gets Irodori-TTS MF F16 and the other 9 languages get Qwen3-TTS 0.6B Q8_0; both are the files the app selects from the start. The other TTS rows are empty. Irodori-TTS Large is under the Gemma terms of use, so it is not recommended.
- `cpu` is `impractical`. The test ran speech.cpp 0.10.0 on the CPU of an i7-1255U (2026-11-16, 5 short Japanese sentences). Irodori-TTS MF F16 took 3 to 7 seconds to the first sound and generated about 4 times slower than real time. Playback broke up. Qwen3-TTS 1.7B Q8_0 took about 1 second to the first sound but generated about 3 times slower. Irodori-TTS Small F16 took 20 to 100 seconds to the first sound. Large and Qwen3-TTS 0.6B were not measured on a CPU but are treated the same way because of their size. `gpu` is `recommended`.
- `memory_bytes` is the peak memory per type from the model card at the pinned revision; all values are from an Apple M5 (Metal).

### Catalog screen (0.5.0)

The download area in "Models and servers" in the settings lays out model cards in groups by purpose.

- Groups follow the catalog's `target`. The TTS page has "Reading Japanese" and "Reading other languages"; the speech recognition page has "Speech recognition", "Voice activity detection (VAD)" and "Telling speakers apart (optional)"; the voice changer page has "Voice changer voices".
- There is one card per model, and the file type (quantization) is chosen inside the card. Rows are grouped into cards by `speech.name` for recognition models, by `profile.summary` for TTS and similar rows, and by the row ID for the rest (RVC) (`src-ui/logics/voice/modelCatalog.ts`). Cards stay in catalog order.
- A card shows the `profile` description, the supported languages, the download size and the hardware guide, along with the provider and license. The recommendation shows the languages in `profile.recommended_for`, as in "Suggested for Japanese". Types that match the free-memory guidance (`modelHardwareAdvice.ts`) get "Fits the free memory".
- The type shown first is chosen in this order: the one in use, one that fits the free memory, then speech.cpp's default. Selecting alone downloads nothing.
- The download state is shown as "Not downloaded", "Downloaded", "In use", "Downloading" or "Verified, not applied". "In use" appears only when the path of the downloaded file is the same as the path in the saved settings.

#### Warning that a model may be too heavy (#405)

A model that is unlikely to run on the user's PC gets a "!" mark and "May be too heavy" in the card heading, and a note inside the card gives the reason (`src-ui/logics/voice/modelHardwareWarning.ts`). It is a rough guide, so it does not block selecting, downloading or applying. The download confirmation dialog shows the same note. The file type options also carry "may be too heavy", so lighter types can be told apart.

- The comparison uses the total memory returned by hardware detection (`native/ops/src/downloads/hardware.rs`). This is because free memory changes from moment to moment, and the types that fit the free memory are already shown by "Fits the free memory" above.
- A model's memory is the largest of `profile.memory_bytes`, `guidance.reference_memory_bytes` and the verified `sampled_peak_bytes`. As in the guidance, 25% is added, then 4 GiB for VRChat; if the result exceeds the GPU's total memory, the warning appears (`low_memory`, `GPU_RESERVE`; decision of 2026-11-20). With several GPUs, the comparison is with the largest one, and their memory is not added together. If the engine settings select a GPU by name, the comparison is with that GPU.
- When there is no GPU, or the engine is set to run on the CPU, models whose `profile.gpu` is `recommended` and whose `profile.cpu` is `impractical` or `slow` get the warning (`no_gpu`, `cpu_setting`). If the total CPU memory (RAM) is known, the model is compared with it as well.
- When comparing with RAM, 13 GiB is added to the model's memory plus 25%: 5 GiB for the OS and 8 GiB for VRChat (`RAM_RESERVE`). Adding a margin was decided on 2026-11-19; applying it to every model and revising the values away from the minimum requirements were decided on 2026-11-20. The note also states the amount kept free.
  - 5 GiB for the OS: on an 8 GB laptop, Windows 11 just after startup used 5.3 GB (25H2), and 4.1 GB on 26H2 ([Windows Central](https://www.windowscentral.com/microsoft/windows-11/windows-11-25h2-26h2-tested-8gb-pc)). A PC with more memory uses more, but it also has more headroom, so the value follows the 8 GB PC.
  - 8 GiB for VRChat: how much memory VRChat uses varies widely with the world and the avatars nearby. In a test that ran VRChat in VR on PCs with 16 GB, 32 GB and 64 GB of memory (an article from December 2025, with a browser, Discord and Unity also left open), total PC usage was 12.6 to 14.3 GB with 16 GB, and 17.9 to 21.1 GB with 32 GB and 64 GB ([Measured memory needs of VRChat](https://note.com/jackvrclove/n/n473be2e7d494)). Taking the OS and other apps out of the values on PCs with 32 GB or more, VRChat appears to use 8 GB or more (an estimate). On the 16 GB PC, it was held to what was available, with no headroom left. 8 GiB was set as the lower end of this range.
  - The earlier values (4 GiB each for the OS and VRChat) were the minimum memory requirements of Windows 11 and of VRChat's Steam page (4 GB for both). Minimum requirements are far below actual use, so the values were revised.
  - With this margin, NLLB-200 distilled 600M (about 1.39 GiB) needs about 14.7 GiB of RAM, and M2M100 418M (about 0.97 GiB) about 14.2 GiB. An 8 GB PC gets the warning. A 16 GB PC (shown as about 15.8 GiB in Windows) does not, but a PC that gives memory to an integrated GPU and drops below 15 GiB does. NLLB-200 distilled 1.3B (about 2.65 GiB) needs about 16.3 GiB, so even a 16 GB PC gets the warning.
- The 4 GiB for VRChat on the GPU is the decided value. In this repository's measurement on an RTX 3060 Ti (8 GB), TTS, captions and RVC running together used about 4.8 GB; adding VRChat in desktop mode brought this to about 6.1 GB, and to about 7.2 GB at the peak ([System requirements](../../site/ja/guide/requirements.mdx)). VRChat added about 1.3 to 2.4 GB, so the value is enough for desktop mode. Usage when running on a VR headset has not been measured.
- No warning appears when detection has not run, has failed or cannot tell the memory, or for models without numbers (such as RVC). Not knowing is not reported as too little performance.
- For this reason, the speech recognition and voice changer pages also run hardware detection (`/run/refresh_model_download_hardware`) once when opened. Detection only runs speech.cpp's `devices --json`; it does not download models or change settings.

##### Local translation models (#597)

The confirmation dialog for translation downloads (the catalog's `translation`, opened from `LegacyModelDownloadDialog`) shows the same warning. This follows the decision of 2026-11-19.

- The guide values are returned per catalog ID by the core's `native/ops/src/downloads/guidance.rs`.
- NLLB-200 distilled 600M int8 (`nllb-200-distilled-600m-onnx-int8`) is 1,490,300,928 bytes (about 1.39 GiB). This is the peak working set while translating 30 sentences each from English to Japanese and from Japanese to English with `astarot-translate`, the same runner as the app, measured on Windows 11, an Intel Core i7-1255U, 4 CPU threads and ONNX Runtime 1.32.0. It is the same value as the download note in PR #687 (about 1.4 GiB).
- The default M2M100 418M int8 (`m2m100-418m-onnx-int8`) is 1,044,295,680 bytes (about 0.97 GiB), measured with the same method and environment (PR #687). M2M100 uses the shared translation note, so its note does not state the number.
- NLLB-200 distilled 1.3B int8 (`nllb-200-distilled-1-3b-onnx-int8`) is 2,841,083,904 bytes (about 2.65 GiB). This is the peak resident memory (VmHWM, reached during loading) when the published files were loaded with `astarot-translate` and 30 sentences each from English to Japanese and from Japanese to English, plus 61 more sentences, were translated. It was measured on Linux, an AMD Ryzen 9 9950X3D, 4 CPU threads and ONNX Runtime 1.32.0 (2026-11-21). The method differs from the 2 Windows working-set values above, so its validation scope was kept separate as `translation_onnx_cpu_linux`. The download note (`translation_nllb_1_3b`) says about 2.6 GiB.
- Other translation models (such as M2M100 1.2B) have not been measured, so they stay `unknown`. Their cards show "Not measured yet" and get no warning. Once measured, they are added to `guidance.rs`.
- The card's "Memory" row shows the memory used while translating. Inside "Memory needs and testing", the text for translation is shown (`tier` is `translation`) instead of the text for TTS models (GPU, the provider's measurements).
- What the model is compared with depends on the device used for translation compute (`SELECTED_TRANSLATION_COMPUTE_DEVICE`, read by `translationDeviceMode`). With the default CPU, the comparison is with the CPU row of hardware detection (total RAM). With a GPU selected, it is with that GPU's total memory. CUDA and TensorRT count NVIDIA GPUs; MIGraphX counts AMD GPUs; DirectML and WebGPU count all GPUs. Each counts in detection order to find the `device_index`-th GPU. No comparison is made when that GPU is not among the detected rows, or for OpenVINO, which runs on both CPU and GPU.
- The "Fits the free memory" guidance for TTS models (`modelHardwareAdvice.ts`) looks at free GPU memory, so it is not shown for translation.
- RAM is known from the CPU row of detection (speech.cpp's `devices --json`). Translation itself does not use speech.cpp. When the bundled speech.cpp is not found and detection fails, no warning appears, as with other models.
- The warning threshold is the same as for other models: 25% is added to the model's memory, plus 13 GiB for the OS and VRChat (`RAM_RESERVE` above) when comparing with RAM, or 4 GiB for VRChat (`GPU_RESERVE`) when comparing with a GPU.
- The translation entries entered the catalog when PR #687 (2026-11-19) wrote M2M100 and NLLB into `translation_models.json`. Before that, the catalog had no IDs to return guide values for, and nothing appeared on screen.

#### Downloaded state after a restart

`downloaded` (`{id: {role: path}}`) was added to the response of `/get/data/model_download_state`. It returns the models whose save location `<id>/<revision>/` holds all of the catalog's files, each a regular file with the pinned size.

- Only the size is checked; SHA-256 is not computed, because the state is polled every 750 milliseconds during a download. SHA-256 is checked, as before, when preparing for use and when applying.
- A downloaded model with no job is used through "Check the files and get ready to use". This opens the same confirmation dialog, and the check starts after consent. The backend only checks the files already there and does not use the network (the existing behavior of `start`). If the check passes, the state becomes "Verified, not applied", and as before "Apply model path" puts the model into the settings.

#### External speech synthesis engines

Below the group for reading Japanese, cards for VOICEVOX, COEIROINK, AivisSpeech and SHAREVOX are listed ([ADR-008](../adr/adr-008-external-speech-engines.md)).

- Nothing is downloaded. Each card links to the official site and the terms of use, and states that the terms of use follow the official terms of each engine and voice.
- Instead of a download state, the card shows whether the saved address can be reached. The query is `/get/data/tts_engine_voices`, which only asks for the version and the list of voices. It is sent once when the saved settings arrive and again when "Check again" is pressed. Its `request_id` starts with `catalog-` and is kept apart from the queries of the "Engine that reads Japanese" field.
- The engine is still chosen in the "Engine that reads Japanese" field, as before. The cards do not select, save or start anything.

#### Playing a TTS sample (#415)

In the groups for reading Japanese and reading other languages, the card of the model in use gets "Play sample". It sits in the same row as the card's own actions (reviewing the download, getting ready to use), after them. Pressing it makes the bundled speech.cpp server running for that profile read a fixed short sentence, played only on the monitor output ([UC-19](../spec/use-cases.md#uc-19-読み上げの声を試聴する)).

- A card that cannot play shows the reason in one line instead of the button. There are 4 reasons: the model is not in use, the server is stopped, "Hear it on my speakers" is off, or audio is muted. Nothing is added to cards that are not downloaded, because downloading comes first.
- A card for a model you registered yourself has the same button when it is in use.
- Playing a sample does not download, apply, start a server or save settings. Trying a model that is not in use would mean restarting the server with that model, so the button is limited to the model in use.

#### Playing a voice changer sample (#415)

In the voice changer (RVC) group, cards for downloaded models and for models you registered yourself get "Play sample". The model does not have to be in use. Pressing it records the user's voice for 5 seconds with the microphone chosen in "Input to forward" on the same page, converts that voice with the card's model and plays it only on the monitor output ([UC-20](../spec/use-cases.md#uc-20-ボイスチェンジャーの声を試聴する)). The conversion runs in a worker started only for the sample, and the worker ends when the sample is done.

- The microphone opens only when the button is pressed and closes when the recording ends. The recorded voice is not saved.
- Pitch and the index ratio use the values currently in the form on the same page. They are not saved. If a value is invalid, a prompt to fix it appears instead of the button.
- A card that cannot play shows the reason in one line instead of the button. There are 5 reasons: a value is invalid, live conversion is running, nothing is chosen in "Input to forward", "Hear it on my speakers" is off, or audio is muted. Nothing is added to cards that are not downloaded.
- While recording, the card shows "Recording. Speak for 5 seconds."; after the recording, while the worker loads, it shows "Preparing the conversion". A stop button stays visible during both.
- Playing a sample does not download, apply, save settings or start a server.

#### Your own models (#403)

In each catalog group, model files on your PC can be registered under a name. Registered models are listed after the official cards in the same list, with a "Your model" badge and a state ("Registered", "In use", "File not found" or "File changed").

- Targets: reading Japanese, reading other languages, speech recognition, VAD and telling speakers apart take one `.gguf` file. Voice changer voices take a `.pth` and, optionally, an `.index`. Chat reading is not covered. Translation is handled in "Translation catalog" below.
- Registering only remembers where the file is; it does not copy, move or download anything. `user_models.json`, in the same folder as `config.json`, saves the name, target and path, along with the size and modification time at registration ([Data formats and storage](../spec/data-and-persistence.md#そのほかのファイル)). The same name or the same file cannot be registered twice for the same target. Up to 200 entries.
- Switching is done with "Use this model". As with "Apply model path" for downloaded models, it checks that the saved values shown on screen are still the saved ones and that the target server or audio input is stopped, then saves only the path (`_applyModelPaths`, `apply_model_paths`). When switching to an RVC model that has no registered `.index`, the saved `.index` is cleared, because it belongs to the previous voice.
- Each state request checks that the file exists and that its size and modification time are the same as at registration. If they differ, the state is "File changed", and switching is refused with `user_model_changed`. SHA-256 is not computed, because model files can be several GiB and the calculation takes time.
- Removing a registration deletes only the registration. The file and any settings that point to it stay as they are.
- The app does not check the origin or the license. The registration area says so.
- Names and paths are user data, so the IPC route names contain `user_model`, and the values are masked in `process.log` (`SENSITIVE_ENDPOINT_MARKERS`).
- IPC: `/get/data/user_models`, `/run/register_user_model` (`{target, name, paths}`), `/run/remove_user_model` (`{id}`), `/run/apply_user_model` (`{id, expected}`). All of them return `{models: [...]}`, and failures return `{error_code}`.

#### Translation catalog (#413)

Translation is not part of the registration above; it is handled in "Translation catalog" on the translation page. What translation uses comes in 2 forms, and each needs different input when added. This "form that suits each kind" is the settled way to add your own translation models.

- **Inference engine** (`engine`): models run by an inference engine on your PC. The app's built-in weights and entries the user added (`user:<ID>`) are listed. Earlier versions also listed models placed in `<データ>/translation-models/<フォルダー>/`, that is, a folder under the data folder (`custom:<フォルダー>`), but #597 removed them. While that folder contains folders, the translation page points to "Add a model of your own" (the core reports only whether any exist, through `retired_folder_used`). Adding one takes the model folder, the inference engine (`runtime`) and the language codes (if omitted, all of the model's languages). The folder can be anywhere and is neither copied nor moved.
- **API** (`api`): the providers the core calls (DeepL, Google Cloud, Papago, Gemini, OpenAI, Groq, OpenRouter, PLaMo, LM Studio, Ollama and OpenAI-compatible) and entries the user added. Adding one takes a name, a kind (`protocol`), an address, a model and a key. An address on your PC or within the LAN can also use `http://` (`validate_api_url` in `net_policy`; the same as for the OpenAI-compatible engine).
- Entries are kept in `translation_catalog.json` in the same folder as `config.json` ([Data formats and storage](../spec/data-and-persistence.md#そのほかのファイル)). API keys go to `TRANSLATION_CATALOG/<ID>` in the same store as other API keys ([Where API keys are stored](../spec/data-and-persistence.md#apiキーの保存先)) and are not written to `translation_catalog.json` or `config.json`. When the store cannot be used, the key is held in memory for that session only, as with the keys in the settings (ADR-013). Up to 100 entries. Within a group, an entry with the same name, the same folder or the same pair of address and model cannot be added.
- Adding an entry only makes the core remember it; nothing is downloaded or switched. For an inference engine entry, the core opens the folder when the entry is added and checks that `native/translate-onnx` can read the format and that the model has the stated languages (`translation_onnx::inspect`). The SHA-256 of the files is checked at load time.
- For an inference engine entry, "Use for translation on your PC" selects its weights (`user:<ID>`) through the same process as `/set/data/selected_ctranslate2_weight_type`. The compute device (CPU, DirectML, CUDA and others) is chosen in the same field as for other local weights. A user model has only one quantization format; if that format does not run on the GPU, it runs on the CPU and the user is told. The entry of the selected model cannot be deleted.
- For an API entry, "Use as the OpenAI-compatible connection" checks the address and key through the same process as `/set/data/openai_compatible_auth_key_and_url`, then changes the connection of the OpenAI-compatible engine. If the entry's model is not in the server's list, it switches anyway and reports `translation_catalog_model_not_listed`. Entries are not listed as separate engines (left open in the PR).
- Built-in entries and entries the user added are told apart by `origin` (`builtin`, `user`) and marked on screen. Up to #597, models in the `translation-models` folder were listed as `folder`.
- Entries with a `runtime` or `protocol` that this version does not know (written by a newer version) are kept, not deleted, and shown as "Not supported by this version". A new inference engine (a T5 family model such as MADLAD-400) or a new kind of API is added to `translation_catalog::RUNTIMES` and `PROTOCOLS` once the core can run it. Ways to run TranslateGemma and to get its weights were compared in [Paths to using TranslateGemma for translation](translategemma.md) (#412).
- **Translation LLM (`llamacpp`, ADR-015)**: when llama.cpp is chosen as the inference engine, the entry takes one TranslateGemma GGUF file (the entry's `file`) instead of a folder, and a compute device (`auto` or `cpu`; the core also accepts names such as `Vulkan1`). When the entry is added, the core reads the start of the file and checks that it is a GGUF whose `general.architecture` is `gemma3` (otherwise `translation_catalog_gguf_invalid`). The language codes are the codes of the TranslateGemma template (`ja`, `zh-Hans` and so on); if omitted, they cover every language the app can name. As with your other models, the user checks the file's origin and license.
- This entry runs on llama.cpp's `llama-server`. The server is not included in the app; it is downloaded with consent from the inference engine area of the catalog (the Vulkan build only; see "Downloading the llama.cpp server" below). While there is no server, the entry shows "Needs llama.cpp's server" and cannot be used (`server_ready: false`). Each time the catalog opens, the core checks the entries and the server again.
- "Use for translation on your PC" only selects those weights (`user:<ID>`); it does not start the server. When translation is turned on (or a message is translated with those weights), the core starts the server on your PC only (`127.0.0.1`, port 0, an API key per launch, no web UI). With the device set to `auto`, llama.cpp's device list is searched by name and description for the GPU that the speech.cpp server picks (the discrete GPU with the most memory); if it is not found, the server runs on the CPU. Loading another model stops the server, and an ONNX Runtime model is not held at the same time.
- To translate, the English text of TranslateGemma's official template (with the names and ISO codes of the source and target languages) and the source text are sent to `/completion`. No system role and no conversation context are sent, and generation uses temperature 0 (greedy decoding). Neither the text to translate nor the translation is logged.

#### Downloading the llama.cpp server

`llama-server`, which runs the translation LLM, is downloaded only when the user consents, through the same download mechanism as the RVC runtime (`native/voice-conversion/src/runtime.rs`).

| ID | Contents | Source | Size / SHA-256 |
|---|---|---|---|
| `llamacpp-vulkan` (Windows) | `llama-b12125-bin-win-vulkan-x64.zip` | Release b12125 of `ggml-org/llama.cpp` on GitHub | 37,683,656 / `29db801266e784d17fbc9dd7ff9b6a350d2b665bdc5658216f37d91c09918f07` |
| `llamacpp-vulkan` (Linux x64) | `llama-b12125-bin-ubuntu-vulkan-x64.tar.gz` | Same as above | 35,883,040 / `455ec2f079e0d175b29beef93975aeacd119d8c74bd3e40298afa9a98e5a75f1` |

- Only the Vulkan build is offered (decided on 2026-11-19; decision item 5 of the plan). The Vulkan build also contains the CPU backends, so for entries with the device set to `cpu`, or on a PC without a GPU, it runs on the CPU alone with `--device none`. The difference from the CPU build is only about 13 MB of download, so the CPU build is not offered.
- Release b12125 was published on 2026-11-04, more than 2 weeks before the day it was chosen (2026-11-19). The values were checked against both the digests GitHub shows and the files actually downloaded.
- The source stays the GitHub release (decided on 2026-11-19; decision item 2 of the plan). The hosts `github.com` and its redirect target `release-assets.githubusercontent.com` were added to `SOURCE_HOSTS`, the list of hosts allowed for downloads.
- Only the files the server reads are extracted from the archive into `lib/`: the server, `llama-server-impl`, `llama-common`, `llama`, `mtmd`, `ggml`, `ggml-base`, 14 CPU backends and `ggml-vulkan`, plus `libomp.dll` and `LICENSE-LLVM-OpenMP` on Windows and `LICENSE` on Linux. The CLI, the quantization tools, the RPC server and the like are not extracted. The Linux archive contains links to versioned files (`libllama.so.0` → `libllama.so.0.9.0`), so the files are extracted under the link names.
- The check runs `llama-server --list-devices` once. It does not load a model. If no Vulkan GPU is found, the setup still counts as ready, and a notice says that no GPU was found (`llamacpp_no_gpu`).
- On Linux the server uses the distribution's OpenSSL 3 (`libssl.so.3`, `libcrypto.so.3`), `libgomp.so.1` and `libvulkan.so.1`. The app does not download these.
- On 2026-11-19, the pinned archives (4 at the time, including the CPU builds) were downloaded on Windows, and the Windows build was extracted by the download mechanism itself and run through `--list-devices` (`llamacpp_sets_up_from_its_release`, an ignored test). It has not yet been checked on a real Linux machine.
- When developers add an inference engine entry (#411, #412), it goes into the pinned catalog as before (`native/ops/data/translation_models.json`, target `translation`, written with `tools/translation_onnx/publish.py catalog --write`) with its version, size, SHA-256 and license pinned, and it is recorded in the license register (`licensing.md`) and `NOTICE.md`. A model with a non-commercial or other restriction is not made the default. Downloading a non-commercial model (NLLB-200) needs the [non-commercial license confirmation](#confirming-non-commercial-licenses) above. The id and rules for adding NLLB-200 are in [the license register](licensing.md#nllb-200をカタログに載せるときの決まり2026-11-18411). For entries the user adds, the add form states that the app does not check their origin or license.
- Names, folders, addresses and keys are user data, so the IPC route names contain `translation_catalog`, and the values are masked in `process.log`. For an entry whose folder cannot be read, only the ID and a fixed code are logged.
- IPC: `/get/data/translation_catalog` (`{engine, api, runtimes, protocols}`), `/run/register_translation_catalog_entry`, `/run/remove_translation_catalog_entry` (`{id}`), `/run/use_translation_catalog_entry` (`{id}`). All of them return the whole catalog, and failures return `{error_code}`.

#### Two kinds of speech recognition (#414)

The speech recognition page follows the same idea as the translation catalog and shows the engines split into 2 kinds. Only the screen layout changed. Setting keys, IPC, engine IDs and the core are unchanged.

- **speech.cpp** ("On your PC (speech.cpp)"): the "Local (speech.cpp)" engine and its "Models and servers". The cards of the catalog groups above ("Speech recognition", "Voice activity detection (VAD)" and "Telling speakers apart (optional)") and models the user registered (#403, #407; with the "Your model" badge) are listed here. Adding one means registering the file's location.
- **API** ("API (cloud or your own server)"): Groq Whisper, OpenAI Whisper, Deepgram and the user's Whisper server ("Custom Whisper server"). Each provider has a one-line fold where the key (the URL and key for your own server) and the model are entered. "Whisper result filtering" is also placed in this kind. Your own server comes last, and a "Your server" badge (the same dashed badge as in the catalog) shows that it is the user's own connection. Providers that the app supplies get no badge. Keys are kept in the same store as other API keys ([Where API keys are stored](../spec/data-and-persistence.md#apiキーの保存先)), not in `config.json`. This is the same as before.
- There is still one engine selection (`/set/data/selected_transcription_engine`), and its options are split under the names of the 2 kinds. It is a single radio group, so the arrow keys move across both kinds and Tab stops on it once. An API engine cannot be selected until the core accepts its key (`/get/data/selectable_transcription_engines`). The consent dialog for the selection (`TranscriptionConsentController`) is unchanged.
- The real-time caption settings stayed in "More settings", since they are set once and then left alone. The "Bundled server" and "External server" under its "ASR server" both belong to the speech.cpp kind. The bundled server runs with the model in "Models and servers" above. The external server is a speech.cpp server that you started separately on your PC, and its address is limited to `http://` on loopback (`localhost`, `127.0.0.1` and so on) (`speechcpp::local_url`). Audio does not leave your PC, so it is not in the API kind. On Windows, when "Local (speech.cpp)" is chosen as the engine, the switch on the main screen runs real-time captions on this server. When an API engine is chosen, the earlier recording is used, and real-time captions start with the start button in that section. On Linux the switch always uses real-time captions, whatever engine is selected.
- APIs the user adds (the rest of #414): at the end of the API kind, speech recognition APIs the user added are listed one per row. "Add a speech recognition API" adds one with a name, a Whisper-compatible address (OpenAI-compatible `/audio/transcriptions`), a model and a key. Entries are kept in `transcription_catalog.json` in the same folder as `config.json`, and keys go to `TRANSCRIPTION_CATALOG/<ID>` in the same store as other API keys. Entries do not add engines. "Make it the custom Whisper server" checks the address and key through the same process as `/set/data/custom_whisper_auth_key_and_url`, then replaces the address, key and model of the custom Whisper server with the entry's. The engine list, the consent dialog and the VR UI do not change. IPC: `/get/data/transcription_catalog` (`{api, protocols}`), `/run/register_transcription_catalog_entry` (`{name, protocol, url, model, auth_key}`), `/run/remove_transcription_catalog_entry` and `/run/use_transcription_catalog_entry` (`{id}`). The route names contain `transcription_catalog`, and the values are masked in `process.log`.
- Differences from the translation catalog: speech.cpp models are registered by file location (translation entries are added by folder). An API the user adds changes the connection of the custom Whisper server instead of creating a new engine. No new inference runner was added.

## Pinned catalog

The table below records the first catalog (version `2026-10-31.1`). The current catalog is in `native/ops/src/downloads/catalog.rs` (version in `CATALOG_VERSION`) and `native/ops/data/*.json`. In the first catalog, TTS offered 2 candidates for each slot, ASR had one candidate (Haas-ja) and RVC had one candidate (Saisho) (from 2026-11-16, ASR is as described in the section above).

| ID | Repository and pinned revision | File / bytes | SHA256 |
|---|---|---|---|
| irodori-v41-f16 | sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF @ 9db7da1bec3d1069ef8e29732e0497be60c7b047 | Irodori-TTS-866M-MF-v4.1-F16.gguf / 1920321792 | e237dc3eefe469b8bba87872beacf12fb7fe00dbdf85767edca8ec04ab910d13 |
| irodori-v41-q8 | Same as above | Irodori-TTS-866M-MF-v4.1-Q8_0.gguf / 1207133984 | 2d161b0bbcd74f906f6b07e03d031075f8ae916db1b8bd4daf16cb37b451086a |
| qwen3-06b-q8 | sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF @ fd9df9364613a92a86b4137074bc281204823033 | Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf / 1213534464 | f606ea3981aa42762b16db9a94826d2d560eb60f0b102001618f40d5a2f78cc6 |
| qwen3-06b-q5 | Same as above | Qwen3-TTS-12Hz-0.6B-CustomVoice-Q5_K.gguf / 873894144 | 4bb9ba9e822ab614798c416c7f0187994f349be41221966fa911aca24f237930 |
| rvc-saisho | Saisho-Utane/Saisho-Model-RVC @ 7a61b17e4f014fc5013a489f2b5cd3a7ee9e2b1a | model.pth / 57577658 | 82312a29a3996a451aaa3d3776566cec85b47b5414fce53da82b2d66b04f3d35 |
| rvc-saisho | Same as above | model.index / 278065619 | e9f7396e5db3077274c720d055e43abb8f1eac5609cbdf48b198ca4f4a35cad5 |
| haas-ja-q8 | sakasegawa/Haas-ja-v1.0-GGUF @ 6b965d5007ba780585de51549d57a8c1c0d67c7e | Haas-616M-ja-v1.0-Q8_0.gguf / 656381472 | cd5f60b2f1c411404b83fca4a65e3ce30a26d9e951b6a346529e65f22758afeb |

The base models were traced from the [Irodori-TTS card](https://huggingface.co/sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF/blob/9db7da1bec3d1069ef8e29732e0497be60c7b047/README.md) and the [Qwen card](https://huggingface.co/sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF/blob/fd9df9364613a92a86b4137074bc281204823033/README.md) and checked against speech.cpp v0.9.0's [Irodori-TTS](https://github.com/nyosegawa/speech.cpp/blob/v0.9.0/docs/models/irodori-tts.md) and [Qwen](https://github.com/nyosegawa/speech.cpp/blob/v0.9.0/docs/models/qwen3-tts.md) documents. The dedicated GGUFs include the codec. Irodori-TTS shows MIT and, for the codec base, Apache-2.0, along with the provider's prohibitions such as unauthorized imitation and generating misinformation. Qwen is Apache-2.0.

The base model [third-intelligence/Haas-ja-v1.0](https://huggingface.co/third-intelligence/Haas-ja-v1.0) was traced from the [Haas-ja card](https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF/blob/6b965d5007ba780585de51549d57a8c1c0d67c7e/README.md) and checked against speech.cpp v0.10.0's [FastConformer document](https://github.com/nyosegawa/speech.cpp/blob/v0.10.0/docs/models/fastconformer.md). Apache-2.0. The files at this revision need speech.cpp 0.9.4 or later and load with the bundled 0.10.0. The ASR server also needs a VAD model, which is not in the catalog; its path is set as before. Haas is not part of the hardware recommendation, because no measurement of the GPU memory it needs has been recorded on the VRCT side.

On 2026-10-31, live tests with the bundled 0.10.0 Vulkan build, Haas Q8_0 and Silero v6.2 ran GPU/CPU startup through `SpeechServer`, listing of recognition models through `/v1/models`, REST recognition and Realtime (with and without server VAD), and passed. The input was 2 Japanese sentences synthesized with Irodori-TTS MF; this is not an evaluation of recognition accuracy.

The [Saisho author card](https://huggingface.co/Saisho-Utane/Saisho-Model-RVC/blob/7a61b17e4f014fc5013a489f2b5cd3a7ee9e2b1a/README.md) states that the model uses the author's own voice and own dataset, is under CC BY 4.0 and requires attribution. Voice model created by **Saisho Utane** — [author](https://huggingface.co/Saisho-Utane) — Used under the [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/). This app does not modify the model. Users of the model are also advised to give credit in what they publish or in their descriptions, to link to the license and to indicate changes. Mia2026 is not included in the catalog.

The RVC metadata is v2/48 kHz/f0=1. After the first short tests, a longer muted-input test, `native-guidance-rvc-strict-2`, detected a stop caused by `vc_capture_overrun`. Tracing the search exception that came before it showed that the cause was missing neighbor candidates due to the narrow search range of the IVF index. The RVC adapter now adjusts the search range at initialization, and the queue, the freshness limit and the rejection of invalid search results were kept. The failure record is also kept.

On the fixed AppImage `b8050d10c7243da5d57dda92d09784912947ad6516eccde152d11e4ef3bb4fe0`, `native-rvc-fixed-strict-3` gave 1 PASS (45.82 seconds). For the whole synthesized-speech input while muted (138 non-zero frames), the output increase was 0, and after the input finished, a fresh running state with the same generation was confirmed. After unmuting, another complete input also finished, and a stop during a third input and OFF after restart were confirmed. Silence was judged as S16 absolute values of 64 or less, lasting 2 seconds after the stop; this is kept apart from tests that confirm all-zero bytes or perceived sound quality. For details, see the hardware test records.

An RVC voice model and index alone do not run. A separate runtime is needed (from 2026-11-15: ONNX Runtime; the CUDA and cuDNN libraries; the HuBERT configuration and weights; RMVPE as ONNX. Conversion runs in the bundled `astarot-rvc-worker`). This download feature does not install the runtime and does not read pickle files. On Windows and Linux (x86-64), the runtime can be downloaded through a separate consent dialog (in 0.5.0, the core's `native/voice-conversion/src/runtime.rs`; up to 0.4, Python's `models/voice_conversion/runtime_setup.py`; see [Voice features on Windows](local-setup-windows.md#rvc) and [the Linux steps](local-setup-linux.md#rvcの実行環境)).

## Guidance by GPU and free VRAM

Opening the TTS settings runs the bundled, integrity-checked speech.cpp (currently 0.11.2; 0.9.0 when this section was tested) with `devices --json`. No model is loaded. It shows the GPU name and its total and free memory, with the time of the check, and a button to check again was added. The run is asynchronous in the backend with a 3-second timeout; at exit, only the child processes it owns are terminated, and any that do not respond are killed and reaped. After receiving the output of the pinned executable, it checks that the output is within 64 KiB and validates the JSON types and value ranges. No arbitrary executable or URL can be given.

Because the same GGUF is used on every supported backend, models are not split by GPU vendor; a standard candidate and a light candidate are suggested according to free memory. However, hardware testing is limited to Linux / RTX 4080 SUPER / Vulkan. The display does not claim that runs on AMD, Intel, Metal or CPU have been confirmed.

| Slot | Standard candidate | Light candidate | Upstream VRAM measurement example (standard / light, decimal GB) |
|---|---|---|---|
| Japanese | Irodori-TTS MF F16 | Irodori-TTS MF Q8_0 | 2.30 / 1.59 |
| Multilingual | Qwen CustomVoice Q8_0 | Qwen CustomVoice Q5_K | 1.33 / 0.99 |

The upstream values are measurement examples from the linked speech.cpp v0.9.0 documents, on an RTX 2080 / Vulkan with 20 Japanese sentences; they are not minimum requirements. The display also mentions the size reduction from quantization and the possible change in audio quality. Qwen Q4 was left out of the candidates this time because of its higher transcription error rate upstream.

The guidance uses these conditions:

- It targets the first GPU that the engine uses by default. The memory of several GPUs is not added up, and there is no switching to another GPU.
- If `max(上流の測定例, 親担当の観測ピーク) × 1.25 + 余裕容量` (the larger of the upstream measurement example and the peak observed by the lead, times 1.25, plus headroom) fits in the current free VRAM, the standard candidate is suggested first, then the light one.
- The headroom defaults to 2 GiB ("with VRChat and others"). 0.5 GiB ("TTS only") can also be chosen. The 25% and the headroom are a policy for the guidance, not reserved memory or a guarantee that it runs.
- For a CPU setting, a shared-memory GPU, unknown capacity, a failed query or a measurement older than 2 minutes, the reason is shown. Zero free memory and unknown are told apart. Even when no candidate fits, automatic selection is not suggested, and manual selection stays possible.

Selecting does not change the model path or the execution device in the settings. Consent to the warning, the download and Apply after verification remain separate actions, as before. The manual selection is kept, and switching to another candidate during a download leaves the progress, cancel and apply buttons in place. RVC is a choice of voice, so this VRAM estimate does not apply to it. Running TTS, RVC, ASR and a game at the same time, or long texts, needs extra headroom.

For the 2 light candidates, the lead verified a full real download from HF and the pinned sizes and hashes. Irodori-TTS Q8, Qwen Q5 and Qwen Q8 were run through synthesis, cancel, stop and restart on a real GPU, and the PCM matched across 3 runs for each model. Through a separate real GUI, 2 runs each also confirmed a full PCM match against an independent reference and silence before and after. The comparison was at each model's own rate, 48 kHz for Irodori-TTS and 24 kHz for Qwen; it does not confirm resampling to 48 kHz on the host side or perceived quality. The observed peak VRAM was 1,499 / 1,000 / 1,332 MiB respectively (measured on the owning PID at 100 ms intervals), and peaks between samples may have been missed.

The AppImage that includes the new guidance UI, `3c034035748633fa4e11d56c09379bd8dfe751dbf86b62aee0d1c3945a33036a`, was also checked through real GPU display → choosing the 2 light candidates → product verification of the already downloaded cache → Apply → starting and stopping the bundled Japanese and multilingual servers → OFF and path kept after restart. This was a cache verification, not a test that transferred all files again through the new UI.

With the same AppImage, Irodori-TTS F16 and low-latency standby ON, 30 warm runs of a fixed short sentence gave a p95 upper bound of 50.054284 ms and a p50 upper bound of 46.018233 ms. The measurement runs from a trusted GUI click to the completion of the first non-zero PCM write. The following were recalculated independently from the saved records: a full S16 PCM match with zeros before and after for all 31 utterances including warmup; 2.304 seconds of zeros when OFF; one OSC message per send. This is not a speed guarantee for the light models. The interval between trials was about 10.18 to 10.24 seconds, and the results are not generalized to arbitrary long texts, contention with games or physical listening.

The latest build, with the RVC search fix, is the AppImage in `build/gpu-model-guidance-rvc-fixed-2026-10-30-artifacts/` (SHA256 b8050d10… above). The 30-run performance values are kept as measurements of the older 3c034035… build. The new input hash record has 575 entries, including copied items such as RVC. In the lead's extraction check, 18 adapter and license files matched their source files, and this worker also compared the record with the hashes of the current source. The older match record of 543 entries did not include anything under integrations.

The TTS recheck of the b8050d10… build, `native-rvc-fixed-tts-smoke`, gave 1 PASS (72.01 seconds). The following were confirmed independently from the saved PCM: a full PCM match with zeros before and after for warmup plus 2 warm runs; all-zero bytes for 2.266666 seconds when OFF; one OSC message per send. Two warm runs are not enough to recertify performance, so the result is kept as `summary.verdict=insufficient_samples`.

## Boundaries of cancellation, failure and shutdown

Files are saved in `downloaded_models/<id>/<revision>/` in the same directory as config.json. Network access is allowed only from the pinned HF URLs, over HTTPS, with redirects only to allowed delivery hosts. `us.aws.cdn.hf.co`, which the lead's HEAD check found in use for 3 models, was added as an exact match, and a regression check confirmed that other subdomains, HTTP and URLs with credentials are refused. Credentials, arbitrary URLs and arbitrary extraction commands are not accepted. Reads are done in small chunks, and the size and SHA256 are checked. After all files succeed, the directory is renamed on the same file system. An existing corrupted cache is not overwritten; the download fails and reports it. Free space of the total file size plus 64 MiB is checked in advance, and ENOSPC during writing also counts as a failure.

Cancellation holds an Event so that it excludes completion handling, then shuts down the socket that is waiting for the body to release read1. The same happens at exit. However, **it cannot stop at once before DNS, the connection or the headers return**. Network operations have a 15-second timeout, but this is not a guarantee that everything, DNS included, ends within 15 seconds. If something is left after the 2-second wait in close, the incomplete work is logged.

During Apply's re-verification, the state lock is released, and the work is treated as a cancellable verification job, like a download. A shutdown request is signaled before waiting for the lock, and the wait in close is shared by taking the lock, the download worker and waiting for Apply to finish. After re-verification, the shutdown request and the job are checked inside the lock, and the saved values and the target's stopped state are checked again inside the existing settings lock before the change is applied. An Apply interrupted by cancellation or shutdown ends as `cancelled` and does not apply the path. An Apply that has already started writing the settings is waited on until it finishes, but if that goes past the close deadline, it is returned as incomplete.

The derived character dictionary in OCR's `.ocr-keys/` is compared every time with the UTF-8 content generated from the verified YAML. A matching file is reused. If it does not match, the content is written to a temporary file in the same directory, which atomically replaces the file after flush and fsync. The size and SHA256 checks of the original ONNX/YAML files continue.

Leftovers from a forced exit are cleaned up at the next explicit download start. Only when the per-root OS lock can be taken is a `.partial-<uuid>` deleted, and only if it has an ownership marker whose product, model, revision and file names match. Downloads by other live processes, unknown or incomplete markers, extra files and symlinks are not cleaned up. Completed directories are not deleted either. Range transfers for resuming are not implemented, so a cancelled transfer starts over the next time.

The overlay relay refuses all 7 new routes (catalog, state, start, cancel and apply, plus getting and refreshing hardware). The new Jotai atoms are not registered in dynamicStoreRegistry. In Tauri, links go through the opener, and the main window's permission is limited to HF, CC BY and Apache URLs. On failure, a URL that can be copied is shown. A successful mock invoke in a browser test and a check with the real AppImage that a browser process starts with the URL are treated as separate records.

## Implementation and tests

- The download mechanism is `downloads` in `native/ops` (catalog, transfer, storage location, download management, device information and guidance) and the 7 routes in the core's `native/core/src/controller/downloads.rs`. Up to 0.5 it was the Python backend's `src-python/models/model_downloads/`, which was removed in 0.6.0 (#285).
- `ModelDownloads.tsx` / `useModelDownloads.ts`, with small insertions into SpeechServers/DirectVoiceSettings. Separate en/ja namespaces.
- `modelHardwareAdvice.ts` computes the guidance from the queried values and the candidates. It distinguishes CPU, shared memory, unknown or zero capacity, several GPUs and the measurement expiry.
- The IPC send functions were made stable, which fixed a loop that fetched catalog/state again on every re-render. A browser check confirmed that the fetch count does not change while idle.
- The problem where confirmed saved values after Apply did not reach a clean form was fixed in `useSettingsDraft.tsx` by comparing the previous saved values with the draft. Unsaved edits are kept.

---

# 設定画面からの既定モデル取得（日本語版）

TTS・ASRの「モデルとサーバー」（同梱speech.cppサーバーの欄）内とRVC設定画面に取得UIを追加。提供元、モデル名、正確な容量、利用条件へのリンク、用途・注意、保存先を表示し、チェックボックスへの同意と開始操作を必要とする。カタログにあるローカル翻訳（ONNX Runtime）のモデルも同じ確認画面で取得する。

同意は警告を開いた時点のカタログ版に結び付ける。更新された未確認の版で開始しない。

取得成功後の「モデルパスを適用」は別操作。完了ファイルを再検証し、現在の保存パスが画面で確認した値と一致し、対象が停止中の場合だけ反映する。保存するのは取得したパスだけで、フォームで編集中のほかの項目は未保存のまま残る（2026-10-31の変更。以前は先に保存または破棄が必要だった）。置き換えるパス自体に未保存の編集がある場合と、保存処理中は適用できない。device、low_latency、RVC runtime、pitch/index_rate、RVCのdevice/threads/highpass、入力モードは維持する。モデルのロード、発声、サーバーやマイクの開始は行わない。

適用の再検証中も、同じジョブのキャンセルボタンを使える。適用とキャンセルの応答はそれぞれ確認し、両方の待機が終わるまで別の適用や取得を始めない。状態の定期取得や応答待ちの警告だけでは、操作の待機を解除しない。

## 非商用のライセンスの確認

非商用のライセンスのモデル（NLLB-200など）は、上の同意のほかに非商用に限ることの確認を求める（#411）。Gemmaの利用規約に従う翻訳のモデルも、同じ仕組みで規約の確認を求める（下の「Gemmaの利用規約の確認」）。

- 中核（`native/ops`の`catalog.rs`）がカタログの各行に`restrictions`を付ける。ライセンスの文字列から決まり、Creative CommonsのNonCommercial（CC-BY-NC-4.0と、-SAや-NDの付くもの）なら`non_commercial`、Gemma Terms of Use（Hugging Faceのライセンスの表示`gemma`だけのものも）の翻訳のモデル（`target`が`translation`）なら`gemma_terms`を含む。読み上げなどほかの対象のモデルには`gemma_terms`を付けない（`restrictions_for`）。両方なら`["non_commercial", "gemma_terms"]`の順で、ほかは`[]`になる。`Model`の項目と`receipt.json`の形は変えない。別の種類を足すときも、この一覧に種類を足す。
- 確認の画面はライセンスの名前を挙げ、非商用の利用だけが認められていることを警告の印を付けた段落で示す。同意のチェックの下に種類ごとのチェックを出し、すべてにチェックが入るまで開始できない。画面を開き直すと、どのチェックも外れている。
- 開始の要求（`/run/start_model_download`）は確かめた種類を`acknowledged`に入れる。制限のあるモデルでその種類が欠けていると`model_download_restriction_unacknowledged`で断り、ファイルを書かず通信もしない。知らない種類、同じ種類の重複、そのモデルにない種類を入れた要求は`download_request_invalid`で断る。制限のないモデルの要求は今までと同じで、`acknowledged`は付けなくてよい（空の一覧も受け付ける）。
- 確認は記録しない。`receipt.json`はカタログの項目のままで、取得のたびに確認を求める。
- 翻訳の設定でNLLBを選ぶときの確認（`CTranslate2LicenseDialog`と中核の`WEIGHT_CTRANSLATE2_LICENSE_CONSENT_REQUIRED`）は別にあり、そのまま残る。

### Gemmaの利用規約の確認

Gemmaの重みと、そこから作ったモデルはGemma Terms of Useに従う。規約の一部である禁止用途のポリシーは、配る側だけでなくモデルを使う人にも及ぶ（ADR-015、[TranslateGemmaを翻訳に使う道筋](translategemma.md)）。

- `gemma_terms`の確認の画面は、ライセンスにGemmaの利用規約と禁止用途のポリシーが含まれること、その条件が使う人にも及ぶことを警告の印を付けた段落で示す。規約とポリシーは、確認の画面の「利用条件・ライセンス」に項目ごとのリンクとして並ぶ。
- 同意とは別のチェック「Gemmaの利用規約と禁止用途のポリシーを読み、その条件に従ってこのモデルを使います。」が要る。開始の要求は`acknowledged: ["gemma_terms"]`を付け、欠けていれば中核が`model_download_restriction_unacknowledged`で断る。
- この確認を求めるのは翻訳のモデルだけである（2026-11-19に決定。[翻訳のLLMの実行基盤の計画](translation-llm-runtime-plan.md)の判断項目4）。Irodori-TTS v4 Large（`irodori-v4-large-q8`、`Gemma Terms of Use + MIT + Apache-2.0`）は文章を読む部分がGemmaに由来するが、この確認は付かない。確認の画面はライセンスと規約のリンク（`GEMMA_TERMS_OF_USE.md`と`GEMMA_PROHIBITED_USE_POLICY.md`）を今までどおり示し、同意のチェックだけで取得できる。
- TranslateGemmaの組み込みの項目は、プロジェクトが変換して公開するまで載せていない（判断項目3）。そのため2026-11-19の固定カタログにはこの確認が付く項目がない。

## 内蔵CTranslate2と文章分割ファイル

0.5.0の中核では、この取得を引退させた。ローカル翻訳はONNX Runtime（`native/translate-onnx`）で動き、そのモデルは上の固定カタログの対象`translation`から、ほかのモデルと同じ確認と同意を経て取得する。2026-11-19に、M2M100 418Mのint8（既定、MIT、約506 MB）とNLLB-200 distilled 600Mのint8（CC-BY-NC-4.0、約643 MB）を公開し、カタログに載せた（#687）。2026-11-21にNLLB-200 distilled 1.3Bのint8（CC-BY-NC-4.0、約1.4 GB）も載せた（#411）。NLLBの確認には、非商用のライセンス、取得に要る空き容量、翻訳中のメモリー（600Mは約1.4 GiB、1.3Bは約2.6 GiB）を書いた専用の文面を出す。設定の「翻訳」のダウンロードは、項目があれば共通の取得の画面を出し、なければ未公開であることと、自分で用意したモデルは翻訳のカタログの「自分のモデルを追加」で足せることを示す（#597までは置き場所の`translation-models`フォルダーを示した）。

設定の「翻訳」のモデルの一覧（#565）には、取得済みのモデル、自分で追加したモデル、カタログに項目がある組み込みのモデルだけを並べる。翻訳のカタログの「アプリに含まれる項目」も同じ規則で並べ、行とカードは取得のカタログの項目の名前（「NLLB-200 distilled 600M · int8」）で示す（2026-11-21）。公開しないNLLB-200 3.3Bは組み込みの一覧から外した。それを選んでいた設定は既定で読み込まれ、一度だけ知らせる。組み込みのモデルに項目があるかは、そのモデルのカタログのID（`<モデル>-onnx-<形>`）で決める。ダウンロードのボタンが出るのは項目がある行だけで、押すとそのモデルの項目を共通の取得の画面で示す。選んでいるモデルは、取得できなくても「まだ取得できません」を付けて残す。組み込みのモデルを1つも取得できず、選んでいるモデルも使えないときは、外部翻訳APIかローカルLLMを使うよう案内する。モデルを公開してカタログに載せる手順は`tools/translation_onnx/README.md`の「公開してカタログに載せる」にある。

経緯は[中核の統合](core-integration.md)の「判断が要ること」の1、29、33。画面に残っていた古い確認画面（カタログの`legacy_models`の確認と同意）も、#1015で消した。設定の「翻訳」とスイッチから開く確認画面は、カタログの翻訳モデルを並べる。この節の以下の記述は、0.4までのPythonの取得のもの。

内蔵モデルの取得は、いまは翻訳（CTranslate2）だけである。以前の版は設定の「文字起こし」でローカルの Whisper の重みも同じ確認画面から取得していたが、#288 でローカルの Whisper を削除し、その取得もやめた。ローカルの音声認識（speech.cpp）のモデルは、上のカタログ取得で「音声認識（ASR）」の「モデルとサーバー」から取得する。以前の版が取得した`weights/whisper/`の重みは読まず、利用者が設定で削除を選んだときだけ消す（[古い Whisper の重み](../spec/data-and-persistence.md#古い-whisper-の重み)）。

設定の「翻訳」でダウンロードを押すと、モデル名、提供元、ライセンス、`src-python/models/builtin_model_pins.py`に固定した全ファイルの正確な合計容量を示す。チェックして開始するまで取得しない。NLLBは選択済みでも非商用（CC-BY-NC-4.0）の制限を表示する。新規設定の既定は引き続きMITのM2M100である。

CTranslate2の文章分割ファイル（tokenizer）は、重みと同じリポジトリにある固定済みのファイルを使う。M2M100はvocabとSentencePiece、NLLBはtokenizer.jsonを含む一覧を容量・SHA-256で照合する。別リポジトリへの追加取得は行わず、確認画面の合計に全て含める。例えばM2M100 418Mはtokenizerも含め499,602,144バイトである。取得元の変更はmanifest_versionに反映されるので、旧版で記録したCTranslate2の取得同意は次の取得時に確認し直す。ライセンスと、同意がなければ取得しない条件は変わらない。

確認画面はカタログの`legacy_models`を使い、開いたときの`manifest_version`を保持する。開始要求の`{weight_type, consent: true, manifest_version}`が現在のモデル・一覧と一致しない場合は`WEIGHT_DOWNLOAD_CONSENT_REQUIRED`で拒否し、再確認を促す。NLLBの選択時の確認だけでは取得を許可しない。

同意は`config.json`の`LEGACY_MODEL_DOWNLOAD_CONSENTS`へ即時保存する。起動時取得スイッチがオンでも、同じモデル・重みの版と全ファイルの容量・SHA-256・ライセンス・tokenizerの版への同意が記録されていなければ取得を見送り、設定画面への案内を出して起動を続ける。起動時の再試行も同じ条件である。旧設定は記録なしとして、次の取得前に確認する。既存ファイルは削除せず、保存済みのNLLB選択も変えない。

翻訳開始時と取得済み判定は、検証済みの重みから固定済みtokenizerファイルだけを専用の一時フォルダーへコピーし、そのコピーも照合してから明示したtokenizerクラスでローカルだけで読む。既存フォルダーにある未固定の追加ファイルや、以前のHubキャッシュは使わない。欠落・不一致なら取得済みとせず、翻訳の有効化要求にはTRANSLATION_MODEL_MISSINGを返す。照合に通ったファイルからtokenizerを組み立てられなかったときは、取得し直しても直らないのでTRANSLATION_MODEL_LOAD_FAILEDを返す。

画面はカタログ取得と同じCSSとネイティブのdialogを使う。戻るに最初のフォーカスを置き、Escapeで閉じ、呼び出し元へフォーカスを戻す。幅・高さを画面内に収め、長い日本語やリポジトリ名を折り返す。取得でモデルの選択や翻訳・マイクを有効にしない。

同意の記録（`LEGACY_MODEL_DOWNLOAD_CONSENTS`）をいまの中核が残すことは[データ形式と保存](../spec/data-and-persistence.md#その他)、エラーは[横断的な振る舞い](../spec/cross-cutting.md#同意と外部への送信)を参照する。完全性確認と取得処理は次の契約に従う。

### 内蔵モデルの検証・保存・終了

- 初回の利用判定では、既存ファイルも含め、固定一覧の全ファイルを容量とSHA-256で照合する。ロードの成功だけでは取得済みにしない。ロード直前にも同じ判定を通す。大きなファイルを毎回読まないよう、manifestの識別値とファイルのsize・mtime_ns・ctime_ns・device・inodeを記録する。旧形式の.weight_verified.jsonや別manifestの記録は使わない。照合は起動処理や取得workerで行い、通常のロードはこの記録を利用する。読み取り専用の場所では記録を書けないため、次回もハッシュを計算する。Windowsの`ctime_ns`は作成時刻のため、同じ容量のまま書き換えて更新時刻を戻した場合は、記録が残っている間は検出できない。
- CTranslate2の旧名と新名が両方あれば両方を残し、検証済みの新名、検証済みの旧名の順に選ぶ。新名がなければ検証済みの旧名だけを移動する。不一致のユーザーファイルは削除しない。同意済みの再取得が全て成功したときは、既存ディレクトリを同じrootの `.preserved-<weight>-<uuid>` へ残してから、新しい一式を公開する。
- weights/ctranslate2のrootで、カタログと同じOS leaseを取得する。同じrootを別プロセスが使用中ならdownload_busyで拒否する。専用の.partial-<uuid>へ書き、上限超過を保存前に拒否し、fsyncと全ファイルの照合後にディレクトリをrenameして公開する。以前の共有.partは使わず、ユーザーファイルとして残す。異常終了で残ったstagingは、次の同意済み取得でleaseと所有markerを確認できた場合だけ回収する。
- 各ファイルの転送全体には1800秒の期限があり、最大3回の試行と待機もその期限に含む。本文のread timeoutは従来どおり60秒。期限・取消ではカタログと同じsocket中断を使う。DNS・接続・headersが返る前やOSのディスクI/OをPythonのthreadから強制終了する保証はない。shutdownは最初に全入力元のメッセージ配送を失効させ、カタログ取得・Applyと内蔵モデル取得の両方へ取消を通知してから待機に入る。内蔵モデル側はロック取得・本文の中断・全workerのjoinを合計2秒まで待ち、残ればログへ記録する。取消後の公開は禁止する。起動時は各試行を1800秒まで待ち、前回を取消・joinできた場合だけ1回再試行する。
- 成功・失敗・取消・既存ファイルの利用・例外のどの終了経路も、weight_typeとjob_idを持つ結果を1回だけ返す。取得要求の200は受付であり、成功確定ではない。全ファイルの照合とtokenizerのローカル読込みまで通ったときだけdownloaded=trueになる。失敗のUI処理は該当する重みのpending・progressだけを解除し、他の重みは維持する。同じプロセス内で重複した要求の拒否にはactive_job_idを付け、既に進行中の表示を解除しない。

## speech.cppの音声認識モデル（2026-11-16）

カタログ版 `2026-11-16.1` から、同梱のspeech.cpp（0.11.0）が扱う認識モデル7種を、量子化の種類ごとにすべて取得できる（31件）。対象はqwen3-asr-0.6b、qwen3-asr-1.7b、reazonspeech-v2、parakeet-tdt_ctc-0.6b-ja、parakeet-tdt-0.6b-v3、haas-ja-v1.0、nemotron-3.5-transcribeである。

- revision、ファイル、容量、SHA-256、対応言語、既定のファイルはspeech.cppのカタログ（`speech models --json`）を正とする。`tools/speechcpp_models.py`が同梱するバージョンの出力を`native/ops/data/speechcpp_models.json`へ写す。手で書き写さない。speech.cppのバージョンを上げたら、同梱するバージョンでこのツールを実行し直して`CATALOG_VERSION`も上げる。
- アプリ側に書くのは、どの名前を出すかとライセンスの審査（`native/ops/data/speechcpp_asr.json`の`offers`）だけである。審査の記録は[licensing.md](licensing.md#speechcppの音声認識モデル2026-11-16)と`licenses/speechcpp-models/NOTICE.md`にある。
- `native/ops`も同じ2つのファイルの文字列を読む（`downloads/speechcpp.rs`）。Pythonのカタログの写し（`python_reference.json`）との照合は、0.6.0で引退させた（#746）。
- エントリのidは`<名前>-<種類>`（例：`reazonspeech-v2-q8`、`nemotron-35-transcribe-iq4nl`）。以前からある`haas-ja-q8`と`qwen3-asr-06b-q8`は同じidのままなので、取得済みのフォルダーをそのまま使える。
- 画面では「認識モデル」と「ファイルの種類（量子化）」を選ぶ。最初はspeech.cppが名前で取得するファイルを選んだ状態になり、対応言語とspeech.cppの推奨言語を表示する。取得には従来どおり確認画面での同意が要る。選んだだけでは何も取得しない。
- 実行時の扱いは変わらない。認識サーバーは選んだファイルを読み込み、言語や語彙のオプションは`/v1/models`の申告に従う。VAD（silero-vad）と話者分離のエントリも変えていない。2つのファイルがspeech.cppのカタログと一致することは試験で確かめている。

新しく加えたモデルを実機のサーバーで動かす試験は、まだしていない（取得に同意が要るため）。

### 選ぶための情報（profile）

0.5.0の画面で、初めての人が比べて選べるように、カタログの各行に利用者向けの情報を持たせた。音声認識、VAD、話者分離、読み上げ（TTS）の行にある。RVCとOCRの行は`null`である。

| 知りたいこと | 行の項目 | 出どころ |
|---|---|---|
| 表示名 | `name`（ファイルの種類まで）、`speech.label`（モデル名だけ） | 既存。`OFFERS` |
| 短い説明 | `profile.summary`（`model_downloads.summary.<key>`の文言キー） | `PROFILES`と`locales/` |
| 対応言語 | `profile.languages` | speech.cppのカタログ |
| ダウンロードサイズ | `total_bytes`（ファイルは`artifacts[].size`） | 既存。speech.cppのカタログ |
| ハードウェアの目安 | `profile.memory_bytes`と`memory_measured_on`、`tier`（light／medium／heavy）、`cpu`、`gpu` | モデルカードの実測値。`tier`はそこから計算する |
| おすすめ | `profile.recommended_for` | speech.cppのカタログの`start`。読み上げは`PROFILES`の`recommended_for` |

- おすすめは、speech.cppが言語ごとに「最初に使うモデル」として示すものを使う。アプリでは別に決めない。2026-11-16時点では、日本語がreazonspeech-v2、ウクライナ語などヨーロッパの9言語がparakeet-tdt-0.6b-v3、ほかの言語がqwen3-asr-0.6bである。名前が取得するファイル（既定の種類）の行にだけ付く。
- `memory_bytes`は、固定revisionのモデルカードにある種類ごとのピークメモリーである。測った機器は`memory_measured_on`に書く（Nemotron 3.5 TranscribeはH100、ほかはApple M5）。お使いのPCでの実測値でも、必要量の保証でもない。`tier`は1.5 GiB以下をlight、4 GiB以下をmedium、それより大きいものをheavyとする。
- `cpu`は、CPUで動かして確かめたものだけを書く。`slow`はASTAROTが測ったもの、`practical`はspeech.cppがCPUで動かす作りのもの（VAD）、ほかは`unverified`である。`gpu`はVAD以外を`recommended`にした。モデルカードの測定はどれもGPUで、下の測定でもGPUのほうがずっと速かった。
- 2026-11-16の測定。Windows 11、Intel Core i7-1255U、NVIDIA RTX 3060 Ti（Thunderbolt接続、Vulkan1）、speech.cpp 0.11.0、Qwen3-ASR 0.6B Q8_0、言語は`ja`。Windowsの合成音声（10.2秒の日本語1文）を`speech asr`で認識させ、1ファイルと6ファイルの所要時間の差から1発話あたりを出した。各2回で、CPUは2.95秒と4.26秒、GPUは0.08秒と0.16秒だった。CPUでも動くが、字幕は発話の後に数秒遅れる。合成音声1文での測定で、精度の評価ではない。

読み上げの行（2026-11-16に追加）：

- カタログで手で固定した行なので、`PROFILES`の`ids`で、ファイルの種類ごとにカタログのIDを指す（Irodori-TTS MFのF16は`irodori-v41-f16`など）。
- おすすめは`PROFILES`の`recommended_for`で、speech.cppの`start`を置き換える。speech.cppは日本語にもQwen3-TTS 0.6Bを勧めるが、ASTAROTは日本語をIrodori-TTS（japaneseプロファイル）で、ほかの言語をQwen3-TTS（multilingualプロファイル）で読むためである。日本語はIrodori-TTS MFのF16、ほかの9言語はQwen3-TTS 0.6BのQ8_0で、どちらもアプリが最初から選ぶファイルである。ほかの読み上げの行は空。Irodori-TTS LargeはGemmaの利用規約に従うので、おすすめにしない。
- `cpu`は`impractical`。i7-1255UのCPUでspeech.cpp 0.10.0を動かした（2026-11-16、短い日本語5文）。Irodori-TTS MF F16は最初の音まで3〜7秒で、生成は実時間の約4倍遅く、再生が途切れる。Qwen3-TTS 1.7B Q8_0は最初の音まで約1秒だが、生成は約3倍遅い。Irodori-TTS Small F16は最初の音まで20〜100秒だった。LargeとQwen3-TTS 0.6BはCPUで測っていないが、大きさから同じ扱いにした。`gpu`は`recommended`。
- `memory_bytes`は、固定revisionのモデルカードにある種類ごとのピークメモリーで、どれもApple M5（Metal）での値である。
### カタログ画面（0.5.0）

設定の「モデルとサーバー」にある取得の欄は、用途ごとのまとまりにモデルのカードを並べる。

- まとまりはカタログの`target`で分ける。読み上げのページは「日本語の読み上げ」「日本語以外の読み上げ」、音声認識のページは「音声認識」「発話区間の検出（VAD）」「話者の区別（任意）」、ボイスチェンジャーのページは「ボイスチェンジャーの声」である。
- カードはモデル1つに1枚で、ファイルの種類（量子化）はカードの中で選ぶ。まとめ方は、認識モデルが`speech.name`、読み上げなどが`profile.summary`、それ以外（RVC）が行のIDである（`src-ui/logics/voice/modelCatalog.ts`）。並びはカタログの順のままにする。
- カードには`profile`の説明、対応言語、ダウンロードサイズ、ハードウェアの目安、提供元とライセンスを出す。おすすめは`profile.recommended_for`の言語を「おすすめ：日本語」のように示す。空きメモリーによる案内（`modelHardwareAdvice.ts`）に合う種類には「空きメモリーに合う」を付ける。
- 最初に見せる種類は、使用中のもの、空きメモリーに合うもの、speech.cppの既定の順に選ぶ。選んだだけでは何も取得しない。
- 取得の状態は「未取得」「取得済み」「使用中」「取得中」「検証済み・未適用」で示す。「使用中」は、取得したファイルのパスが保存済みの設定のパスと同じときだけである。

#### 性能不足の可能性の警告（#405）

利用者のPCで動きそうにないモデルには、カードの見出しに「!」の印と「性能不足の可能性」を付け、カードの中に理由を書いた注記を出す（`src-ui/logics/voice/modelHardwareWarning.ts`）。目安なので、選ぶこと、取得、適用は止めない。取得の確認画面にも同じ注記を出す。ファイルの種類の選択肢にも「性能不足の可能性」を添え、軽い種類を見分けられるようにする。

- 比べるのは、ハードウェアの検出（`native/ops/src/downloads/hardware.rs`）が返すメモリーの総量である。空き容量は時々で変わり、空き容量に合う種類は上の「空きメモリーに合う」が示すためである。
- モデルのメモリーは、`profile.memory_bytes`、`guidance.reference_memory_bytes`、検証済みの`sampled_peak_bytes`のうち最も大きい値である。案内と同じく25%を足し、さらにVRChatの分として4 GiBを足した値が、GPUのメモリーの総量を超えれば警告する（`low_memory`、`GPU_RESERVE`。2026-11-20の決定）。GPUが複数あれば最も大きいものと比べ、メモリーを足し合わせない。エンジンの設定でGPUを名前で選んでいれば、そのGPUと比べる。
- GPUがないか、エンジンをCPUで動かす設定のときは、`profile.gpu`が`recommended`で`profile.cpu`が`impractical`か`slow`のモデルに警告する（`no_gpu`、`cpu_setting`）。CPUのメモリー（RAM）の総量が分かれば、それとも比べる。
- RAMと比べるときは、モデルのメモリーに25%を足した値に、OSの5 GiBとVRChatの8 GiB、合わせて13 GiBを足す（`RAM_RESERVE`）。余裕を足すことは2026-11-19に決まり、すべてのモデルに効かせることと、値を最小要件から見直すことが2026-11-20に決まった。注記には残す分も書く。
  - OSの5 GiB：8 GBのノートPCで起動した直後のWindows 11は5.3 GB（25H2）、26H2では4.1 GBを使った（[Windows Central](https://www.windowscentral.com/microsoft/windows-11/windows-11-25h2-26h2-tested-8gb-pc)）。メモリーの多いPCほど使う量は増えるが、そのPCには余裕もあるので、8 GBのPCの値に合わせた。
  - VRChatの8 GiB：VRChatの使う量はワールドと周りのアバターで大きく変わる。メモリーが16 GB、32 GB、64 GBのPCでVRChatをVRで試した例（2025年12月の記事。ブラウザー、Discord、Unityも開いたまま）では、PC全体の使用量が16 GBで12.6〜14.3 GB、32 GBと64 GBで17.9〜21.1 GBだった（[VRChatに必要なメモリ容量の実測](https://note.com/jackvrclove/n/n473be2e7d494)）。32 GB以上のPCの値からOSとほかのアプリの分を除くと、VRChatは8 GB以上を使っていると見られる（推定）。16 GBのPCでは使える量に抑えられ、余裕がなかった。この下のほうの値として8 GiBにした。
  - それまでの値（OSとVRChatそれぞれ4 GiB）は、Windows 11とSteamのVRChatのページの最小要件のメモリー（どちらも4 GB）だった。最小要件は実際に使う量よりかなり少ないので見直した。
  - この余裕を足すと、NLLB-200 distilled 600M（約1.39 GiB）には約14.7 GiB、M2M100 418M（約0.97 GiB）には約14.2 GiBのRAMが要る。8 GBのPCでは警告が出る。16 GBのPC（Windowsで約15.8 GiBと出る）では出ないが、内蔵GPUにメモリーを分けて15 GiBを下回るPCでは出る。NLLB-200 distilled 1.3B（約2.65 GiB）には約16.3 GiBが要るので、16 GBのPCでも警告が出る。
- GPUのVRChatの4 GiBは決定の値である。このリポジトリの計測では、RTX 3060 Ti（8 GB）で読み上げ、字幕、RVCを動かした約4.8 GBが、デスクトップ表示のVRChatを足すと約6.1 GB、いちばん多いときで約7.2 GBになった（[動作環境](../../site/ja/guide/requirements.mdx)）。VRChatが増やした量は約1.3〜2.4 GBなので、デスクトップ表示には足りる。VRのヘッドセットで動かしたときの量は測っていない。
- 検出していない、失敗した、メモリーが分からないときと、数値のないモデル（RVCなど）には警告しない。分からないことを性能不足とは書かない。
- このため、音声認識やボイスチェンジャーのページでも、開いたときにハードウェアの検出（`/run/refresh_model_download_hardware`）を1回走らせる。検出はspeech.cppの`devices --json`を動かすだけで、モデルの取得や設定の変更はしない。
##### ローカル翻訳のモデル（#597）

翻訳の取得の確認画面（`LegacyModelDownloadDialog`から開くカタログの`translation`）でも同じ警告を出す。2026-11-19の決定による。

- 目安の値は中核の`native/ops/src/downloads/guidance.rs`がカタログのIDごとに返す。
- NLLB-200 distilled 600M int8（`nllb-200-distilled-600m-onnx-int8`）は1,490,300,928バイト（約1.39 GiB）。アプリと同じ実行部`astarot-translate`で英日と日英を各30文訳したときの作業集合の最大で、Windows 11、Intel Core i7-1255U、CPUの4スレッド、ONNX Runtime 1.32.0で測った。PR #687の取得の注記（約1.4 GiB）と同じ値である。
- 既定のM2M100 418M int8（`m2m100-418m-onnx-int8`）は1,044,295,680バイト（約0.97 GiB）。同じ方法と環境で測った（PR #687）。M2M100は翻訳の共通の注記を使うので、注記には数値を書いていない。
- NLLB-200 distilled 1.3B int8（`nllb-200-distilled-1-3b-onnx-int8`）は2,841,083,904バイト（約2.65 GiB）。公開したファイルを`astarot-translate`で読み込み、英日と日英の各30文に61文を足して訳したときの常駐メモリーの最大（VmHWM。読み込みの間に達する）で、Linux、AMD Ryzen 9 9950X3D、CPUの4スレッド、ONNX Runtime 1.32.0で測った（2026-11-21）。上の2つのWindowsの作業集合とは測り方が違うので、検証の範囲は`translation_onnx_cpu_linux`として分けた。取得の注記（`translation_nllb_1_3b`）には約2.6 GiBと書いた。
- ほかの翻訳のモデル（M2M100 1.2Bなど）は測っていないので`unknown`のままにする。カードには「まだ測っていません」と出し、警告もしない。測ったら`guidance.rs`に足す。
- カードの「使うメモリ」の行に、翻訳の間に使うメモリを出す。「必要メモリと動作確認」の中は、読み上げのモデル向けの文（GPU、提供元の測定）ではなく、翻訳用の文を出す（`tier`が`translation`）。
- 比べる相手は翻訳の計算に使う機器（`SELECTED_TRANSLATION_COMPUTE_DEVICE`）で決める（`translationDeviceMode`）。既定のCPUならハードウェアの検出のCPUの行（RAMの総量）と比べる。GPUを選んでいればそのGPUのメモリの総量と比べる。CUDAとTensorRTはNVIDIAのGPUを、MIGraphXはAMDのGPUを、DirectMLとWebGPUはすべてのGPUを、検出の順に`device_index`番目として数える。そのGPUが検出の行にないときと、CPUでもGPUでも動くOpenVINOのときは比べない。
- 読み上げのモデル向けの「空きメモリーに合う」の案内（`modelHardwareAdvice.ts`）は、空いているGPUのメモリを見るので翻訳には出さない。
- RAMは検出（speech.cppの`devices --json`）のCPUの行で分かる。翻訳そのものはspeech.cppを使わない。同梱のspeech.cppが見つからず検出が失敗したときは、ほかのモデルと同じく警告しない。
- 警告の基準はほかのモデルと同じく、モデルのメモリに25%を足し、RAMと比べるときはOSとVRChatの分の13 GiB（上の`RAM_RESERVE`）、GPUと比べるときはVRChatの分の4 GiB（`GPU_RESERVE`）も足す。
- 翻訳の項目は、PR #687（2026-11-19）が`translation_models.json`にM2M100とNLLBを書いたときにカタログに入った。それより前は目安を返すIDがカタログになく、画面に出なかった。

#### 再起動後の取得済み

`/get/data/model_download_state`の応答に`downloaded`（`{id: {role: path}}`）を足した。保存先の`<id>/<revision>/`にカタログのファイルがすべてあり、どれも通常のファイルで、容量が固定値と同じものを返す。

- 確かめるのは容量だけで、SHA-256は計算しない。取得中は状態を750ミリ秒ごとに問い合わせるためである。SHA-256は、従来どおり使う準備と適用のときに照合する。
- 取得済みでジョブのないモデルは、「ファイルを確かめて使う準備をする」から使う。同じ確認画面を開き、同意してから開始する。バックエンドは既にあるファイルを照合するだけで、通信はしない（`start`の既存の動き）。照合に通ると「検証済み・未適用」になり、従来どおり「モデルパスを適用」で設定に入る。

#### 外部の音声合成エンジン

日本語の読み上げのまとまりの下に、VOICEVOX、COEIROINK、AivisSpeech、SHAREVOXのカードを並べる（[ADR-008](../adr/adr-008-external-speech-engines.md)）。

- ダウンロードはしない。カードには公式サイトと利用規約へのリンクを置き、利用条件は各エンジンと声の公式の規約に従うことを書く。
- 取得の状態の代わりに、保存済みの接続先に接続できるかを出す。問い合わせは`/get/data/tts_engine_voices`で、版と声の一覧を聞くだけである。保存済みの設定が届いたときに1回と、「再確認」を押したときに問い合わせる。`request_id`は`catalog-`で始め、「日本語を読み上げるエンジン」の欄の問い合わせとは別に持つ。
- エンジンを選ぶのは、従来どおり「日本語を読み上げるエンジン」の欄である。カードからは選択も保存も起動もしない。

#### 読み上げの試聴（#415）

日本語の読み上げと日本語以外の読み上げのまとまりで、使用中のモデルのカードに「試聴する」を置く。場所はカード自身の操作（取得内容の確認、使う準備）と同じ行のその後ろである。押すと、そのプロファイルで動いている同梱のspeech.cppサーバーが決まった短い文を読み、モニター出力先だけで鳴らす（[UC-19](../spec/use-cases.md#uc-19-読み上げの声を試聴する)）。

- 鳴らせないカードはボタンの代わりに理由を1行で出す。使用中でない、サーバーが止まっている、「自分のスピーカーでも聞く」がオフ、ミュート中、の4つである。未取得のカードには何も足さない。取得が先だからである。
- 自分で登録したモデルのカードも、使用中なら同じボタンを持つ。
- 試聴は取得、適用、サーバーの起動、設定の保存のどれもしない。使用中でないモデルを試すには、そのモデルでサーバーを起動し直すことになる。そのため使用中のモデルだけにした。

#### ボイスチェンジャーの声の試聴（#415）

ボイスチェンジャー（RVC）のまとまりでは、取得したモデルのカードと自分で登録したモデルのカードに「試聴する」を置く。使用中でなくてもよい。押すと、同じページの「転送する入力」で選んだマイクで利用者の声を5秒間録り、その声をカードのモデルで変換して、モニター出力先だけで鳴らす（[UC-20](../spec/use-cases.md#uc-20-ボイスチェンジャーの声を試聴する)）。変換は試聴のためだけに起動するworkerで行い、終わればworkerも終える。

- マイクを開くのは押したときだけで、録り終えたら閉じる。録った声は保存しない。
- ピッチとインデックスの比率は、同じページのフォームにいま入っている値を使う。保存はしない。値が正しくなければ、ボタンの代わりにそれを直すよう出す。
- 鳴らせないカードはボタンの代わりに理由を1行で出す。値が正しくない、ライブの変換が動いている、「転送する入力」が選ばれていない、「自分のスピーカーでも聞く」がオフ、ミュート中、の5つである。未取得のカードには何も足さない。
- 録音のあいだはカードに「録音しています。5秒間、話してください。」と出し、録り終えてworkerを読み込むあいだは「変換の準備をしています」と出す。どちらのあいだも止めるボタンを出しておく。
- 試聴は取得、適用、設定の保存、サーバーの起動のどれもしない。

#### 自分のモデル（#403）

カタログの各まとまりで、お使いのPCにあるモデルのファイルを名前を付けて登録できる。登録したモデルは公式のカードと同じ一覧の後ろに並び、「自分のモデル」の印と状態（登録済み、使用中、ファイルがありません、ファイルが変わりました）を付ける。

- 対象：日本語の読み上げ、日本語以外の読み上げ、音声認識、VAD、話者の区別は`.gguf`のファイル1つ。ボイスチェンジャーの声は`.pth`と、任意で`.index`。チャット読み取りは対象にしていない。翻訳は下の「翻訳のカタログ」で扱う。
- 登録はファイルの場所を覚えるだけで、コピー、移動、取得はしない。`config.json`と同じフォルダーの`user_models.json`に、名前、対象、パス、登録したときの容量と更新時刻を保存する（[データ形式と保存](../spec/data-and-persistence.md#そのほかのファイル)）。同じ対象に同じ名前か同じファイルは登録できない。200件まで。
- 切り替えは「このモデルを使う」で行う。取得したモデルの「モデルパスを適用」と同じく、画面に出ている保存済みの値が今も保存されていることと、対象のサーバーや音声入力が止まっていることを確かめ、パスだけを保存する（`_applyModelPaths`、`apply_model_paths`）。RVCで`.index`を登録していないモデルに切り替えると、保存済みの`.index`は空にする。前の声のファイルだからである。
- 状態を聞かれるたびに、ファイルがあるかと、容量と更新時刻が登録したときと同じかを確かめる。違えば「ファイルが変わりました」とし、切り替えは`user_model_changed`で断る。SHA-256は計算しない。モデルのファイルは数GiBになることがあり、計算に時間がかかるためである。
- 登録の解除は登録だけを消す。ファイルも、そのファイルを指している設定もそのまま残す。
- 出どころとライセンスはアプリでは確かめない。登録の欄にそう書いている。
- 名前とパスは利用者のデータなので、IPCの経路名に`user_model`を含め、`process.log`では値を伏せる（`SENSITIVE_ENDPOINT_MARKERS`）。
- IPC：`/get/data/user_models`、`/run/register_user_model`（`{target, name, paths}`）、`/run/remove_user_model`（`{id}`）、`/run/apply_user_model`（`{id, expected}`）。どれも`{models: [...]}`を返し、失敗は`{error_code}`で返す。

#### 翻訳のカタログ（#413）

翻訳は上の登録の対象に入れず、翻訳のページの「翻訳のカタログ」で扱う。翻訳に使うものの形が2つに分かれ、足すときに入れるものも違うからである。自分の翻訳のモデルの足し方はこの「種類ごとに合った形」で決着とする。

- **推論エンジン系**（`engine`）：お使いのPCの推論エンジンで動かすモデル。アプリの組み込みの重みと、利用者が足した項目（`user:<ID>`）が並ぶ。以前の版は`<データ>/translation-models/<フォルダー>/`に置いたモデル（`custom:<フォルダー>`）も並べたが、#597で外した。そのフォルダーにフォルダーがあるあいだは、翻訳のページが「自分のモデルを追加」への案内を出す（中核は`retired_folder_used`で、あるかどうかだけを伝える）。足すときはモデルのフォルダー、推論エンジン（`runtime`）、言語のコード（省略するとモデルのすべての言語）を入れる。フォルダーはどこにあってもよく、コピーも移動もしない。
- **API系**（`api`）：中核が呼ぶプロバイダ（DeepL、Google Cloud、Papago、Gemini、OpenAI、Groq、OpenRouter、PLaMo、LM Studio、Ollama、OpenAI互換）と、利用者が足した項目が並ぶ。足すときは名前、種類（`protocol`）、アドレス、モデル、キーを入れる。アドレスはお使いのPCとLANの中なら`http://`も使える（`net_policy`の`validate_api_url`。OpenAI互換のエンジンと同じ）。
- 項目は`config.json`と同じフォルダーの`translation_catalog.json`に置く（[データ形式と保存](../spec/data-and-persistence.md#そのほかのファイル)）。APIのキーはほかのAPIキーと同じ保管場所（[APIキーの保存先](../spec/data-and-persistence.md#apiキーの保存先)）の`TRANSLATION_CATALOG/<ID>`に置き、`translation_catalog.json`と`config.json`には書かない。保管場所に置けないときは、設定のキーと同じくその起動のあいだだけメモリーに持つ（ADR-013）。100件まで。グループの中で同じ名前、同じフォルダー、同じアドレスとモデルの組は足せない。
- 項目を足しても中核は覚えるだけで、取得も切り替えもしない。推論エンジン系の項目は、足すときに中核がフォルダーを開いて、`native/translate-onnx`が読める形か、示す言語がモデルにあるかを確かめる（`translation_onnx::inspect`）。ファイルのSHA-256は読み込むときに確かめる。
- 推論エンジン系の「お使いのPCの翻訳に使う」は、その重み（`user:<ID>`）を`/set/data/selected_ctranslate2_weight_type`と同じ処理で選ぶ。計算に使う機器（CPU、DirectML、CUDAなど）は、ほかのローカルの重みと同じ欄で選ぶ。利用者のモデルは量子化の形を1つだけ持ち、その形がGPUで動かないときはCPUで動かして知らせる。選んでいるモデルの項目は削除できない。
- API系の「OpenAI互換の接続先にする」は、`/set/data/openai_compatible_auth_key_and_url`と同じ処理で、アドレスとキーを確かめてからOpenAI互換のエンジンの接続先を替える。項目のモデルがサーバーの一覧になければ、切り替えたうえで`translation_catalog_model_not_listed`を知らせる。項目ごとに別のエンジンとして並べることはしていない（PRの残課題）。
- 組み込みの項目と、利用者が足した項目は`origin`（`builtin`、`user`）で見分け、画面では印を付ける。#597までは`translation-models`フォルダーのモデルを`folder`として並べた。
- この版が知らない`runtime`や`protocol`の項目（新しい版が書いたもの）は消さずに残し、「この版では使えません」と見せる。新しい推論エンジン（MADLAD-400のようなT5系）や新しい種類のAPIは、中核で動かせるようになったときに`translation_catalog::RUNTIMES`と`PROTOCOLS`に足す。TranslateGemmaの実行の経路と重みの入手は[TranslateGemmaを翻訳に使う道筋](translategemma.md)で比べた（#412）。
- **翻訳のLLM（`llamacpp`、ADR-015）**：推論エンジンにllama.cppを選ぶと、フォルダーの代わりにTranslateGemmaのGGUFのファイル1つ（項目の`file`）と、計算に使う機器（`auto`か`cpu`。中核は`Vulkan1`のような名前も受け付ける）を入れる。足すとき、中核はファイルの頭を読み、GGUFで`general.architecture`が`gemma3`であることを確かめる（違えば`translation_catalog_gguf_invalid`）。言語のコードはTranslateGemmaのテンプレートの符号（`ja`、`zh-Hans`など）で、省略するとアプリが名前を付けられるすべての言語になる。ファイルの出どころとライセンスは、ほかの自分のモデルと同じく利用者が確かめる。
- この項目はllama.cppの`llama-server`で動く。サーバーはアプリに含めず、カタログの推論エンジン系の欄で同意して取得する（Vulkan版だけ。下の「llama.cppのサーバーの取得」）。サーバーがないあいだ、項目は「llama.cppのサーバーが必要です」と出て使えない（`server_ready: false`）。カタログを開くたびに、中核は項目とサーバーを確かめ直す。
- 「お使いのPCの翻訳に使う」はその重み（`user:<ID>`）を選ぶだけで、サーバーは起動しない。翻訳を有効にしたとき（またはその重みでメッセージを訳すとき）に、中核がサーバーをお使いのPCの中だけで起動する（`127.0.0.1`、ポート0、起動ごとのAPIキー、Webの画面なし）。機器の`auto`は、speech.cppのサーバーが選ぶGPU（独立したGPUのうちメモリーが最も多いもの）をllama.cppの一覧で名前と説明から探し、なければCPUで動かす。別のモデルを読み込むとサーバーを止め、ONNX Runtimeのモデルも同時には持たない。
- 訳すときは、TranslateGemmaの公式のテンプレートの英文（原文と訳文の言語の名前とISOの符号）と原文を`/completion`に送る。systemの役割も会話の文脈も送らず、温度0（貪欲法）で生成する。訳す文と訳文はログに出さない。

#### llama.cppのサーバーの取得

翻訳のLLMを動かす`llama-server`は、RVCの実行環境と同じ取得の仕組み（`native/voice-conversion/src/runtime.rs`）で、利用者が同意したときだけ取得する。

| ID | 中身 | 取得元 | 大きさ / SHA-256 |
|---|---|---|---|
| `llamacpp-vulkan`（Windows） | `llama-b12125-bin-win-vulkan-x64.zip` | GitHub `ggml-org/llama.cpp`のリリース b12125 | 37,683,656 / `29db801266e784d17fbc9dd7ff9b6a350d2b665bdc5658216f37d91c09918f07` |
| `llamacpp-vulkan`（Linux x64） | `llama-b12125-bin-ubuntu-vulkan-x64.tar.gz` | 同上 | 35,883,040 / `455ec2f079e0d175b29beef93975aeacd119d8c74bd3e40298afa9a98e5a75f1` |

- 出すのはVulkan版だけである（2026-11-19に決定。計画の判断項目5）。Vulkan版はCPUの処理部も含み、機器に`cpu`を選んだ項目やGPUのないPCでは`--device none`でCPUだけで動く。CPU版との差は取得量で約13 MBだけなので、CPU版は出さない。
- b12125は2026-11-04に公開されたリリースで、選んだ日（2026-11-19）より2週間以上前のものである。値はGitHubが示すダイジェストと、実際に取得したファイルの両方で確かめた。
- 取得元はGitHubのリリースのままとする（2026-11-19に決定。計画の判断項目2）。ホストは`github.com`と、そのリダイレクト先の`release-assets.githubusercontent.com`を足した（取得の許可の一覧`SOURCE_HOSTS`）。
- アーカイブからは、サーバーが読むファイルだけを`lib/`に取り出す。サーバー、`llama-server-impl`、`llama-common`、`llama`、`mtmd`、`ggml`、`ggml-base`、CPUの処理部14種、`ggml-vulkan`、Windowsでは`libomp.dll`と`LICENSE-LLVM-OpenMP`、Linuxでは`LICENSE`である。CLI、量子化の道具、RPCのサーバーなどは取り出さない。Linuxのアーカイブは版付きのファイルへのリンク（`libllama.so.0`→`libllama.so.0.9.0`）を含むので、リンクの名前でファイルを取り出す。
- 確認では`llama-server --list-devices`を一度動かす。モデルは読まない。VulkanのGPUが見つからなければ、準備はできたままで「GPUが見つかりませんでした」と知らせる（`llamacpp_no_gpu`）。
- Linuxのサーバーは、ディストリビューションのOpenSSL 3（`libssl.so.3`、`libcrypto.so.3`）、`libgomp.so.1`、`libvulkan.so.1`を使う。アプリはこれらを取得しない。
- 2026-11-19に、Windowsで固定のアーカイブ（当時はCPU版も含む4つ）を取得し、Windowsの版を取得の仕組みそのもので展開して`--list-devices`まで通した（`llamacpp_sets_up_from_its_release`、無視の付いた試験）。Linuxの実機の確認はまだである。
- 開発側で推論エンジン系の項目を足すとき（#411、#412）は、これまでどおり固定カタログ（`native/ops/data/translation_models.json`、対象`translation`。`tools/translation_onnx/publish.py catalog --write`で書く）に版、サイズ、SHA-256、ライセンスを固定して載せ、ライセンス台帳（`licensing.md`）と`NOTICE.md`に記録する。非商用などの制限があるモデルは既定にしない。非商用のモデル（NLLB-200）の取得には、上の[非商用のライセンスの確認](#非商用のライセンスの確認)が要る。NLLB-200を載せるときのidと決まりは、[ライセンス台帳](licensing.md#nllb-200をカタログに載せるときの決まり2026-11-18411)にある。利用者が足した項目は、出どころとライセンスをアプリでは確かめないことを追加の欄に書いている。
- 名前、フォルダー、アドレス、キーは利用者のデータなので、IPCの経路名に`translation_catalog`を含め、`process.log`では値を伏せる。フォルダーが読めない項目は、IDと固定のコードだけをログに書く。
- IPC：`/get/data/translation_catalog`（`{engine, api, runtimes, protocols}`）、`/run/register_translation_catalog_entry`、`/run/remove_translation_catalog_entry`（`{id}`）、`/run/use_translation_catalog_entry`（`{id}`）。どれもカタログ全体を返し、失敗は`{error_code}`で返す。

#### 音声認識の2つの系（#414）

音声認識のページも翻訳のカタログと同じ考え方で、エンジンを2つの系に分けて見せる。画面の並べ方だけを変えた。設定のキー、IPC、エンジンのID、中核は変えていない。

- **speech.cpp系**（「お使いのPCで動かす（speech.cpp）」）：エンジン「ローカル（speech.cpp）」と、その「モデルとサーバー」。上のカタログの「音声認識」「発話区間の検出（VAD）」「話者の区別（任意）」のカードと、利用者が登録したモデル（#403、#407。「自分のモデル」の印）がここに並ぶ。足すときはファイルの場所を登録する。
- **API系**（「API（クラウドや自分のサーバー）」）：Groq Whisper、OpenAI Whisper、Deepgramと、利用者のWhisperサーバー（カスタムWhisperサーバー）。プロバイダごとに1行の畳みで、キー（自分のサーバーはURLとキー）とモデルを入れる。「Whisperの認識結果のふるい分け」もこの系に置く。自分のサーバーは最後に並べ、利用者の接続先であることを「自分のサーバー」の印（カタログと同じ破線の印）で示す。アプリが用意したプロバイダには印を付けない。キーは`config.json`ではなくほかのAPIキーと同じ保管場所（[APIキーの保存先](../spec/data-and-persistence.md#apiキーの保存先)）に置く。これまでと同じである。
- エンジンの選択（`/set/data/selected_transcription_engine`）は1つのままで、選択肢を2つの系の名前の下に分けて並べる。ラジオボタンは1組なので、矢印キーで系をまたいで動き、Tabで止まるのは1回である。APIのエンジンは、中核がキーを受け付けるまで選べない（`/get/data/selectable_transcription_engines`）。選択の同意の画面（`TranscriptionConsentController`）は変えていない。
- リアルタイム字幕の設定は、一度決めたら触らないものなので「詳細設定」に残した。その「ASRサーバー」の「同梱サーバー」と「外部サーバー」は、どちらもspeech.cpp系である。同梱サーバーは上の「モデルとサーバー」のモデルで動く。外部サーバーは利用者がお使いのPCで別に起動したspeech.cppのサーバーで、アドレスはループバック（`localhost`、`127.0.0.1`など）の`http://`に限る（`speechcpp::local_url`）。音声はお使いのPCの外に出ないので、API系には入れない。Windowsでエンジンに「ローカル（speech.cpp）」を選ぶと、メイン画面のスイッチはこのサーバーでリアルタイム字幕を動かす。APIのエンジンを選んでいるときは従来の録音を使い、リアルタイム字幕はその欄にある開始ボタンで始める。Linuxのスイッチはエンジンの選択にかかわらずいつもリアルタイム字幕を使う。
- 利用者が足すAPI（#414の残り）：API系の最後に、利用者が足した音声認識のAPIが1件ずつ並び、「音声認識のAPIを追加」で名前、Whisper互換（OpenAI互換の`/audio/transcriptions`）のアドレス、モデル、キーを入れて足す。項目は`config.json`と同じフォルダーの`transcription_catalog.json`に置き、キーはほかのAPIキーと同じ保管場所に`TRANSCRIPTION_CATALOG/<ID>`で置く。項目はエンジンを増やさない。「カスタムWhisperサーバーの接続先にする」が、`/set/data/custom_whisper_auth_key_and_url`と同じ処理でアドレスとキーを確かめてから、カスタムWhisperサーバーのアドレス、キー、モデルをその項目のものに替える。エンジンの一覧、同意の画面、VR UIは変わらない。IPC：`/get/data/transcription_catalog`（`{api, protocols}`）、`/run/register_transcription_catalog_entry`（`{name, protocol, url, model, auth_key}`）、`/run/remove_transcription_catalog_entry`と`/run/use_transcription_catalog_entry`（`{id}`）。経路名に`transcription_catalog`を含め、`process.log`では値を伏せる。
- 翻訳のカタログとの違い：speech.cppのモデルはファイルの場所で登録する（翻訳はフォルダーで足す）。利用者が足すAPIは、新しいエンジンではなくカスタムWhisperサーバーの接続先を替える。新しい推論の実行部は加えていない。

## 固定カタログ

下の表は、最初のカタログ（版 `2026-10-31.1`）の記録である。今のカタログは`native/ops/src/downloads/catalog.rs`（版は`CATALOG_VERSION`）と`native/ops/data/*.json`にある。最初のカタログでは、TTSは各2候補から選択でき、ASRはHaas-jaの1候補、RVCはSaishoの1候補だった（ASRは2026-11-16から上の節のとおり）。

| ID | リポジトリと固定revision | ファイル / bytes | SHA256 |
|---|---|---|---|
| irodori-v41-f16 | sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF @ 9db7da1bec3d1069ef8e29732e0497be60c7b047 | Irodori-TTS-866M-MF-v4.1-F16.gguf / 1920321792 | e237dc3eefe469b8bba87872beacf12fb7fe00dbdf85767edca8ec04ab910d13 |
| irodori-v41-q8 | 同上 | Irodori-TTS-866M-MF-v4.1-Q8_0.gguf / 1207133984 | 2d161b0bbcd74f906f6b07e03d031075f8ae916db1b8bd4daf16cb37b451086a |
| qwen3-06b-q8 | sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF @ fd9df9364613a92a86b4137074bc281204823033 | Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf / 1213534464 | f606ea3981aa42762b16db9a94826d2d560eb60f0b102001618f40d5a2f78cc6 |
| qwen3-06b-q5 | 同上 | Qwen3-TTS-12Hz-0.6B-CustomVoice-Q5_K.gguf / 873894144 | 4bb9ba9e822ab614798c416c7f0187994f349be41221966fa911aca24f237930 |
| rvc-saisho | Saisho-Utane/Saisho-Model-RVC @ 7a61b17e4f014fc5013a489f2b5cd3a7ee9e2b1a | model.pth / 57577658 | 82312a29a3996a451aaa3d3776566cec85b47b5414fce53da82b2d66b04f3d35 |
| rvc-saisho | 同上 | model.index / 278065619 | e9f7396e5db3077274c720d055e43abb8f1eac5609cbdf48b198ca4f4a35cad5 |
| haas-ja-q8 | sakasegawa/Haas-ja-v1.0-GGUF @ 6b965d5007ba780585de51549d57a8c1c0d67c7e | Haas-616M-ja-v1.0-Q8_0.gguf / 656381472 | cd5f60b2f1c411404b83fca4a65e3ce30a26d9e951b6a346529e65f22758afeb |

[Irodori-TTSのカード](https://huggingface.co/sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF/blob/9db7da1bec3d1069ef8e29732e0497be60c7b047/README.md)と[Qwenカード](https://huggingface.co/sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF/blob/fd9df9364613a92a86b4137074bc281204823033/README.md)から元モデルへたどり、speech.cpp v0.9.0の[Irodori-TTS](https://github.com/nyosegawa/speech.cpp/blob/v0.9.0/docs/models/irodori-tts.md)・[Qwen](https://github.com/nyosegawa/speech.cpp/blob/v0.9.0/docs/models/qwen3-tts.md)資料と照合した。専用GGUFはcodecを含む。Irodori-TTSはMITとcodec基盤Apache-2.0、提供元の無断模倣・誤情報生成禁止なども表示。QwenはApache-2.0。

[Haas-jaカード](https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF/blob/6b965d5007ba780585de51549d57a8c1c0d67c7e/README.md)から元モデル[third-intelligence/Haas-ja-v1.0](https://huggingface.co/third-intelligence/Haas-ja-v1.0)へたどり、speech.cpp v0.10.0の[FastConformer資料](https://github.com/nyosegawa/speech.cpp/blob/v0.10.0/docs/models/fastconformer.md)と照合した。Apache-2.0。このrevisionのファイルはspeech.cpp 0.9.4以降が必要で、同梱0.10.0で読める。ASRサーバーにはVADモデルも必要だが、カタログには含めず従来どおりパスを指定する。HaasはGPU推奨量の実測をVRCT側で記録していないため、ハードウェア推奨の対象にしない。

2026-10-31、同梱0.10.0 Vulkan版とHaas Q8_0・Silero v6.2で、`SpeechServer`経由のGPU/CPU起動、`/v1/models`での認識モデル列挙、REST認識、Realtime（サーバーVADあり/なし）のライブ試験を実行しPASS。入力はIrodori-TTS MFで合成した日本語2文で、認識精度の評価ではない。

[Saisho作者カード](https://huggingface.co/Saisho-Utane/Saisho-Model-RVC/blob/7a61b17e4f014fc5013a489f2b5cd3a7ee9e2b1a/README.md)は本人の声・自前データセット・CC BY 4.0・帰属必須を明記。Voice model created by **Saisho Utane** — [作者](https://huggingface.co/Saisho-Utane) — Used under the [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/). 本アプリはモデルを改変しない。モデル利用者にも公開物や説明でのクレジット、ライセンスへのリンク、改変表示を案内する。Mia2026はカタログに含めない。

RVCのmetadataはv2/48 kHz/f0=1。初期の短時間試験後、長めのミュート入力試験 `native-guidance-rvc-strict-2` で `vc_capture_overrun` による停止を検出した。先行する検索例外を追跡し、IVFインデックスの狭い探索範囲による近傍候補の欠落が原因と判明。RVCアダプターで探索範囲を初期化時に調整し、待ち行列・鮮度制限・不正検索結果の拒否は維持した。失敗記録も保持している。

修正版AppImage `b8050d10c7243da5d57dda92d09784912947ad6516eccde152d11e4ef3bb4fe0` の `native-rvc-fixed-strict-3` は1 PASS（45.82秒）。ミュート中の全合成音声入力（非ゼロ138フレーム）に対し出力増分0、入力完了後の新鮮な稼働状態と同じgenerationを確認。解除後にも別の全入力を完了し、第三の入力中の停止と再起動OFFを確認した。無音判定はS16絶対値64以下、停止後2秒継続であり、全バイトゼロや知覚的な音質を確認した試験とは区別する。詳細は実機検証記録を参照。

RVC音声モデル/indexだけでは動作しない。別途runtime（2026-11-15からはONNX Runtime、CUDA・cuDNNのライブラリ、HuBERT設定/重み、RMVPEのONNX。変換は同梱の`astarot-rvc-worker`）が必要。この取得機能はruntimeを入れず、pickleも読まない。WindowsとLinux（x86-64）では別の同意画面からruntimeを取得できる（0.5.0は中核の`native/voice-conversion/src/runtime.rs`、0.4まではPythonの`models/voice_conversion/runtime_setup.py`。[Windowsの音声機能](local-setup-windows.md#rvc)、[Linuxの手順](local-setup-linux.md#rvcの実行環境)）。

## GPU・空きVRAMによる案内

TTS設定を開くと、整合性確認済みの同梱speech.cpp（現在は0.11.2。この節の試験時は0.9.0）を `devices --json` で実行する。モデルはロードしない。GPU名、総容量・空き容量、確認時刻を表示し、再確認ボタンも設けた。実行はバックエンドの非同期処理で3秒timeout、終了時は所有する子プロセスだけをterminateし、応答しなければkillして回収する。固定実行ファイルの出力を受け取った後、64 KiB以内かとJSONの型・値域を検証する。任意の実行ファイルやURLは指定できない。

同じGGUFを各対応バックエンドで利用するため、GPUメーカー別にモデルを分けず、空き容量に応じて標準候補と軽量候補を案内する。ただし、実機検証はLinux / RTX 4080 SUPER / Vulkanに限る。AMD・Intel・Metal・CPUの実行成功を確認した表示にはしない。

| 枠 | 標準候補 | 軽量候補 | 上流のVRAM測定例（標準 / 軽量、十進GB） |
|---|---|---|---|
| 日本語 | Irodori-TTS MF F16 | Irodori-TTS MF Q8_0 | 2.30 / 1.59 |
| 多言語 | Qwen CustomVoice Q8_0 | Qwen CustomVoice Q5_K | 1.33 / 0.99 |

上流値はリンク先のspeech.cpp v0.9.0資料にあるRTX 2080 / Vulkan・日本語20文での測定例であり、必要最低容量ではない。量子化による容量削減と音声品質の変化の可能性も表示する。Qwen Q4は上流の転記誤り率の増加を考慮して今回の候補から除外した。

案内には次の条件を使う。

- 実行エンジンが既定で使う最初のGPUを対象にする。複数GPUの容量は合算せず、別GPUへの切替も行わない。
- `max(上流の測定例, 親担当の観測ピーク) × 1.25 + 余裕容量` が現在の空きVRAMに収まる場合、標準を優先し、次に軽量を案内する。
- 余裕容量は「VRChat等と併用」の2 GiBが既定。「TTS単独」の0.5 GiBも選べる。25%と余裕容量は案内用の方針であり、確保済みメモリや動作保証ではない。
- CPU指定、共有メモリGPU、容量不明、取得失敗、2分を超える古い測定は理由を表示する。空き0と不明は区別する。収まる候補がない場合も自動選択を勧めず、手動選択は可能にする。

選択しても設定のモデルパスや実行デバイスは変わらない。警告への同意、取得、検証後のApplyは従来どおり別操作。手動選択を保持し、取得中に別候補へ切り替えても進捗・取消・適用ボタンを残す。RVCは声の選択であり、このVRAM見積りは適用しない。TTS・RVC・ASR・ゲームの同時利用や長文には追加の余裕が必要になる。

軽量2候補は親担当が実HF全取得と固定size/hashを検証済み。Irodori-TTS Q8、Qwen Q5、Qwen Q8は実GPUで合成・取消・停止・再起動し、各モデル3回のPCM一致を確認した。別の実GUI経由でも各2回、独立参照との全PCM一致と前後の無音を確認。Irodori-TTSは48 kHz、Qwenは24 kHzのモデル固有rateでの照合であり、ホスト側の48 kHzへの再サンプリングや知覚音質まで確認した結果ではない。観測ピークVRAMはそれぞれ1,499 / 1,000 / 1,332 MiB（100 ms間隔の所有PID測定）で、測定間のピークを取り逃す可能性がある。

新しい案内UIを含むAppImage `3c034035748633fa4e11d56c09379bd8dfe751dbf86b62aee0d1c3945a33036a` でも、実GPU表示→軽量2候補の選択→既取得cacheの製品検証→Apply→同梱日本語/多言語サーバーの起動・停止→再起動時OFF・パス保持を確認した。これはcache検証であり、新UIで全ファイルを再転送した試験ではない。

同じAppImageのIrodori-TTS F16・低遅延待機ONでは、固定短文のwarm 30回がp95上限50.054284 ms、p50上限46.018233 ms。測定は信頼されたGUIクリックから最初の非ゼロPCM書込み完了まで。warmupを含む31発声の全S16 PCM一致・前後ゼロ、OFF時2.304秒ゼロ、各送信のOSC1回を保存記録から独立再計算した。これは軽量モデルの速度保証ではない。試行間隔は約10.18〜10.24秒で、任意長文・ゲームとの競合・物理聴感へ一般化しない。

RVC検索修正を含む最新版は `build/gpu-model-guidance-rvc-fixed-2026-10-30-artifacts/` のAppImage（SHA256は上記b8050d10…）。30回の性能値は旧3c034035…版の測定として保持する。新しい入力hash記録はRVC等のコピー対象も含む575件。親担当の展開検査でアダプター・ライセンス18件が元ファイルと一致し、本担当も記録と現sourceのhashを照合した。旧543件の一致記録にはintegrations以下は含まれていなかった。

b8050d10…版のTTS再確認 `native-rvc-fixed-tts-smoke` は1 PASS（72.01秒）。warmup＋warm2件の全PCM一致・前後ゼロ、OFF時2.266666秒の全バイトゼロ、各送信のOSC1回を保存PCMから独立確認した。warm2件は性能の再認証には足りず、`summary.verdict=insufficient_samples` のまま保持している。

## 取消・失敗・終了の境界

保存先はconfig.jsonと同じディレクトリの `downloaded_models/<id>/<revision>/`。ネットワークは固定HF URLから、HTTPSと許可された配信先へのリダイレクトだけを許可する。親担当のHEAD確認で3モデルに使われていた `us.aws.cdn.hf.co` を完全一致で追加し、他のサブドメイン/HTTP/認証付きURL拒否を回帰確認した。認証情報・任意URL・任意の展開コマンドは受け取らない。読取りを小分けにし、容量とSHA256を照合。全ファイル成功後に同じファイルシステム上でディレクトリをrenameする。既存の破損cacheを上書きせず、失敗して報告する。空き容量は総ファイル容量+64 MiBを事前確認し、書込み中のENOSPCも失敗扱い。

取消はEventを保持して完了処理と排他し、本文待機中のsocketをshutdownしてread1を解除する。終了時も同じ処理を行う。ただし**DNS・接続・headersが戻る前は即時停止できない**。ネットワーク操作は15秒timeoutだがDNSなども含めた一律15秒の終了保証ではない。closeの2秒待ちで残った場合は未完了をログに出す。

Applyの再検証中は状態ロックを解放し、取得と同じく取消可能な検証中ジョブとして扱う。終了要求はロック待ちより先に通知し、closeの待ち時間はロック取得・取得worker・Applyの完了待ちで共有する。再検証後にロック内で終了要求とジョブを確認し、既存の設定用ロック内で保存値と対象の停止状態を再確認してから反映する。取消・終了で中断したApplyは `cancelled` となり、パスを適用しない。設定反映を開始済みのApplyは完了まで待つが、closeの期限を超える場合は未完了として返す。

OCRの `.ocr-keys/` にある派生文字辞書は、検証済みYAMLから生成したUTF-8の内容と毎回比較する。一致するファイルは再利用し、不一致なら同じディレクトリの一時ファイルに書き、flush・fsync後にatomic replaceする。元のONNX/YAMLのサイズ・SHA256検証は引き続き行う。

強制終了の残骸は、次の明示的な取得開始時に回収する。root単位のOSロックを取得できた場合だけ、製品・モデル・revision・ファイル名が一致する所有marker付き `.partial-<uuid>` を削除する。生存する他プロセスの取得、未知/不完全marker、余分なファイル、symlinkは回収しない。完了ディレクトリも削除しない。再開用Range転送は実装しておらず、取り消した転送は次回やり直す。

overlay relayは新しいcatalog/state/start/cancel/applyとhardware取得/更新の7ルートをすべて拒否する。新しいJotai atomはdynamicStoreRegistryに登録しない。リンクはTauriではopener経由、mainウィンドウの権限はHF・CC BY・ApacheのURLに限定する。失敗時はコピーできるURLを表示する。ブラウザ試験での模擬invoke成功と、実AppImageによるURL付きブラウザプロセスの起動確認は別の記録として扱う。

## 実装と試験

- 取得の仕組みは`native/ops`の`downloads`（カタログ、転送、置き場所、取得の管理、機器の情報、案内）と、中核の`native/core/src/controller/downloads.rs`の7ルート。0.5まではPythonのバックエンドの`src-python/models/model_downloads/`で、0.6.0で消した（#285）。
- `ModelDownloads.tsx` / `useModelDownloads.ts`、SpeechServers/DirectVoiceSettingsへの小さな挿入。en/jaの独立namespace。
- `modelHardwareAdvice.ts`で取得値と候補から案内を算出。CPU・共有メモリ・容量不明/ゼロ・複数GPU・測定期限を区別する。
- IPC送信関数を安定させ、再描画に伴うcatalog/state再取得ループを修正。idle時の取得回数不変をブラウザで確認。
- Apply後の確認済み保存値がcleanフォームへ反映されない問題は、`useSettingsDraft.tsx`で直前の保存値とdraftを比較する形に修正。未保存の編集は保持する。
