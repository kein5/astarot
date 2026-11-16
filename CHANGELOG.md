# Changelog

All notable changes to VRCT-VOX, newest first. Only stable releases are listed: each section
covers everything since the previous stable release, its betas included. Betas (`X.Y.Z-beta.N`,
from `develop`) are described in their [GitHub pre-release notes](https://github.com/kein5/VRCT-VOX/releases).
Versions follow [Semantic Versioning](https://semver.org/). The layout follows the ideas of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/): changes that users notice come first, and
changes for developers follow.

A section is written when its release is prepared (`python tools/changelog.py write`), not on
every commit. See [Changelog and releases](CONTRIBUTING.md#changelog-and-releases).

## [0.4.0] - 2026-11-16

Changes since [v0.3.0](https://github.com/kein5/VRCT-VOX/compare/v0.3.0...v0.4.0).

### User-facing Changes

#### Breaking Changes

- **voice:** Let RVC convert on the CPU, move its GPU runtime to CUDA 13 and remove the earlier runtime ([8367f8d](https://github.com/kein5/VRCT-VOX/commit/8367f8d4ac03760b7d6f48bb009d8e8b1de2f506))
  - Converting RVC on the GPU now needs NVIDIA driver 580 or
later and a GeForce GTX 16 or RTX 20 series GPU or later; older ones convert
on the CPU, with about 1.3 s of delay. Update the driver to keep the GPU.
- **voice:** Convert RVC voice with the bundled Rust worker ([c2f5373](https://github.com/kein5/VRCT-VOX/commit/c2f53736afc092da87b17ddfd316b3a7ecb7c5a7))
  - An RVC runtime set up by an earlier version (the PyTorch
kind) can no longer be used. Set it up again from Settings > Voice changer
(RVC) > Models and runtime; the page says so when the saved folder holds the
earlier kind. It goes into the same folder, so the saved runtime setting
keeps working. Once the new runtime is set up, the earlier files (venv,
python, engine and so on) are removed; models and audio files placed in the
folder are kept.

#### Features

- **asr:** Give each speech.cpp catalog entry what a user compares before choosing ([ec8c8dd](https://github.com/kein5/VRCT-VOX/commit/ec8c8dd439a76596756371c58b0c78cd7b9d697c))
- **tts:** Explain the speech model choices and name each license link ([538cae9](https://github.com/kein5/VRCT-VOX/commit/538cae991a5c3eb4ce382f9ebbb6a2b24c217a13))
- **tts:** Offer Irodori-TTS Small, Irodori-TTS Large and Qwen3-TTS 1.7B for download ([6d5cd4d](https://github.com/kein5/VRCT-VOX/commit/6d5cd4d91b80f0ca29ef903485ef94d4f0b53842))
- **asr:** Choose the recognizer and its file type before the download ([91f8127](https://github.com/kein5/VRCT-VOX/commit/91f8127246a306e7e13d343492c4d31077496f05))
- **asr:** Offer every speech.cpp recognizer and file type for download ([3f30886](https://github.com/kein5/VRCT-VOX/commit/3f308865e7875e5ddb5b3356ad15565a4f2cf90f))
- **overlay:** Save caption moves and size steps, and reset them in settings ([3fdcba0](https://github.com/kein5/VRCT-VOX/commit/3fdcba07d72311181ff3ab1229289de0b2c12e79))
- **overlay:** Move the desktop captions with Ctrl and a drag ([0ab423d](https://github.com/kein5/VRCT-VOX/commit/0ab423d828881008ec410e2c405d78f8b75cd214))
- **overlay:** Save where the desktop caption window was dragged ([bc687e2](https://github.com/kein5/VRCT-VOX/commit/bc687e2811914ba2fec822a1380570473675b566))
- **voice:** Guide Windows users to a virtual microphone and check it with a test sound ([fff36d6](https://github.com/kein5/VRCT-VOX/commit/fff36d6c3cda2b7f4811bf70ac868243eea1d1ab))
- **ui:** Check for updates at start and update from the settings ([13733cb](https://github.com/kein5/VRCT-VOX/commit/13733cbeea9dbd0189d18747aec4b00db69da8da))
- **config:** Add a setting for checking for updates at start ([2074821](https://github.com/kein5/VRCT-VOX/commit/20748216bba5bb6c1f2a49fc831966199cc8f509))
- **app:** Check for and install signed updates with the Tauri updater ([86e52a9](https://github.com/kein5/VRCT-VOX/commit/86e52a9af929aedd9ebc369e73c89dee3caf0310))
- **ui:** Open the main window at its normal size and in the system language ([cb070a0](https://github.com/kein5/VRCT-VOX/commit/cb070a05aecc54c0a7fa6fbb26f94610693ad24c))
- **ui:** Show the main page while the engine starts instead of the splash screen ([fb42f4b](https://github.com/kein5/VRCT-VOX/commit/fb42f4b3b57c00fe07659e0607e5823bf837d4aa))
- **ui:** Keep why the engine failed to start and derive the startup phase ([51b58c3](https://github.com/kein5/VRCT-VOX/commit/51b58c3a54023f280a3cdf30ee036112cb7ad3f4))
- **vr:** Grey out VR launcher switches until their setup is there, and say why ([b828df9](https://github.com/kein5/VRCT-VOX/commit/b828df994183b22c05d10104d2480d23648365a9))
- **ui:** Take a greyed-out chat reading switch to its models section ([ecf79b1](https://github.com/kein5/VRCT-VOX/commit/ecf79b181721d75a76fabad758bf6d151657bf82))
- **ui:** Grey out a main switch until its setup is there, and say why ([7925f40](https://github.com/kein5/VRCT-VOX/commit/7925f40aee81ba70ef7f09dff2581e82d9cb533e))
- **ui:** Work out which main switches still miss their setup ([28ead80](https://github.com/kein5/VRCT-VOX/commit/28ead80faca60cdc353c4a13cc59ef9cb5761185))
- **ocr:** Report whether the chat reading models are here without looking for the window ([1d38f43](https://github.com/kein5/VRCT-VOX/commit/1d38f439044e79bdf14389ace420afdee0fd928d))

#### Improvements

- **site:** Download the file for your OS from the guide's home page ([d93e6d9](https://github.com/kein5/VRCT-VOX/commit/d93e6d925a6bfa4cc40beb2b4e34a179adf91dda))

#### Bug Fixes

- **installer:** Keep the language, edition and shortcuts when the app updates itself ([488824e](https://github.com/kein5/VRCT-VOX/commit/488824e97bb1abc5194f435834b097d7c5ab530f))
- **privacy:** Keep sent and spoken messages out of process.log ([4c26fa1](https://github.com/kein5/VRCT-VOX/commit/4c26fa144fde93b5fdae180c69f889d34a633c9f))

### Internal Changes

#### Refactoring

- **core:** Let each wired area add its endpoints from its own module ([27db2f0](https://github.com/kein5/VRCT-VOX/commit/27db2f080a5ebe70d9f629b3f3bf1f372ec18910))
- **ui:** Work out the blocked main switches once and keep them in a shared atom ([591ce9a](https://github.com/kein5/VRCT-VOX/commit/591ce9a5e9a2f980571056ebb771953dab1aaecc))
- **websocket:** Bind the checked address as a fresh value so CodeQL sees the guard ([a0120c9](https://github.com/kein5/VRCT-VOX/commit/a0120c9d4a3c3f4fbd4e0f947cc4d1ddcbcef669))

#### Dependencies

- **deps:** Bundle speech.cpp 0.11.0 ([939efed](https://github.com/kein5/VRCT-VOX/commit/939efedd1f67c2a67e0413ed4f209857c4acb72c))
- **deps:** Refresh the Cargo lockfiles ([be70d57](https://github.com/kein5/VRCT-VOX/commit/be70d57be39fbdd3da47c9d23614f27cc329bde9))
- **deps:** Update tauri-plugin-opener to 2.7.3 ([bb03525](https://github.com/kein5/VRCT-VOX/commit/bb03525143055363acdf597e87d3f3e355ea46d3))

#### Build & CI

- **linux:** Copy the backend files native/ops includes into the build workspace ([74bb5c5](https://github.com/kein5/VRCT-VOX/commit/74bb5c54c33ae50ad8851e0f6011b502d50ea808))
- Take the core integration job's Rust from mise.toml ([e1ee6ae](https://github.com/kein5/VRCT-VOX/commit/e1ee6ae44e76743cf24668bc5a2c15ab74fe1c4b))
- Credit the CCADB in the Rust license list when webpki-roots ships ([5b70ce5](https://github.com/kein5/VRCT-VOX/commit/5b70ce5ebe7a859f90172ebefaba8bb3ee0be44d))
- **linux:** Copy the crates the app links by path into the build workspace ([c1471a0](https://github.com/kein5/VRCT-VOX/commit/c1471a08fb7bcc3a1d976698cb4f8d1e4b4d33c2))
- Install cocogitto in the headless voice jobs ([d30f8ff](https://github.com/kein5/VRCT-VOX/commit/d30f8ffa9869f95c0c98a1a79a2e2625b35ce570))
- Show cargo's error when the Rust license list cannot be made ([064b050](https://github.com/kein5/VRCT-VOX/commit/064b050b64c8f49ffcc1f52149cd2ad1af7c30e4))
- Ship the license texts of the Rust crates in each package ([3fe265a](https://github.com/kein5/VRCT-VOX/commit/3fe265a99eca9a984be309b6cc7820a51b3a7dde))
- Install node, rust, python, uv and cocogitto through mise ([111209d](https://github.com/kein5/VRCT-VOX/commit/111209de152a9c16efcd27d530d00f6a5a026eae))
- Run the Rust core's integration tests on Linux and Windows ([0e6744e](https://github.com/kein5/VRCT-VOX/commit/0e6744e987a77415eb36aa20babd93250b336b16))
- **release:** Sign the updater files and publish latest.json with the draft ([c47a99a](https://github.com/kein5/VRCT-VOX/commit/c47a99a33161508f7c95e92528d4d256184bbeac))
- **rust:** Move the app and the dev sidecar to edition 2024 ([2b03569](https://github.com/kein5/VRCT-VOX/commit/2b03569c1425aa082331388147a260b6675dfd00))
- **rust:** Move the native crates to edition 2024 ([7b5ae8a](https://github.com/kein5/VRCT-VOX/commit/7b5ae8ada590fba2ca5c0640815e60e2228729ec))
- **translation:** Store the vocabulary matrix once in the ONNX models ([ee74b01](https://github.com/kein5/VRCT-VOX/commit/ee74b010eb6504cf75e5f7e33d0feb2e23946847))
- **translation:** Write the ONNX graphs without optimum, on transformers 5.22.1 ([bad0399](https://github.com/kein5/VRCT-VOX/commit/bad039918b60139293f7557cd4379b2a253b2016))

#### Tests

- **core:** Wait for a failed speech server's generation to settle ([54f4823](https://github.com/kein5/VRCT-VOX/commit/54f482358ff7acdc06d8031d0c14dbbb7cec25dc))
- **release:** Verify updater signatures in the voice test environment ([c4649d7](https://github.com/kein5/VRCT-VOX/commit/c4649d7224c24d9e7c92a44f39a64afcb51c31b7))
- **platform:** Wait for the main page to be ready, not for the composer ([d181064](https://github.com/kein5/VRCT-VOX/commit/d181064feafa5a7ceab71695d1ef41275acd7a37))
- **devtools:** Check the RVC runtime pin that remains after the native worker ([25d30e7](https://github.com/kein5/VRCT-VOX/commit/25d30e7b1e2adcad732d130d6e91e2e5b86e21b8))

#### Documentation

- **brand:** Replace the ASTAROT sources with the reference-traced set ([0bd6183](https://github.com/kein5/VRCT-VOX/commit/0bd6183e3ba4ca2db969749cad8cedb8a0c2edc2))
- **brand:** Add ADR-011 and the ASTAROT brand sources ([e831352](https://github.com/kein5/VRCT-VOX/commit/e831352d58abc6568109911dbf3f7502f109ac56))
- Record the licenses of the added speech models and why drama-3 is left out ([a61420d](https://github.com/kein5/VRCT-VOX/commit/a61420dc96b8ddef7cc8a659fb90a1cd2dc5564c))
- **asr:** List every speech.cpp recognizer in the guide and the download notes ([20cf06a](https://github.com/kein5/VRCT-VOX/commit/20cf06aa92fb61fa3ed8670b3a1f0cfaecb00f5a))
- **overlay:** Describe moving and resizing the desktop captions ([b40e920](https://github.com/kein5/VRCT-VOX/commit/b40e9202b3101482638258097d232fd3e9a57f16))
- **site:** State the driver 580 requirement for RVC on the GPU and drop Seed-VC ([f8f3aad](https://github.com/kein5/VRCT-VOX/commit/f8f3aad4d3d5fcf1e13a52bcbdec741a012e5997))
- **voice:** Record the approval to keep using rmvpe.onnx ([431a6bc](https://github.com/kein5/VRCT-VOX/commit/431a6bc869a054df7cf20c26316d459fbffa708e))
- **voice:** Reconcile the license ledger with the crates the core added ([a0158eb](https://github.com/kein5/VRCT-VOX/commit/a0158ebf02f4ee3605c55310cf3cf72623045fc0))
- **voice:** Record that the core stays a trial in 0.4.0 and becomes the default in 0.5.0 ([4bd5ee9](https://github.com/kein5/VRCT-VOX/commit/4bd5ee9839e64d78455bc5dc0db09940363c7c96))
- Add code owners, a code of conduct and a support guide ([d02b71e](https://github.com/kein5/VRCT-VOX/commit/d02b71eb289a5bfa648ee5115ec0865c47ba449a))
- **voice:** List the update-check endpoints among those the core does not wire yet ([bbe6ee6](https://github.com/kein5/VRCT-VOX/commit/bbe6ee6b1d6b5548cdd8ecb5be23dea7f38262e3))
- **voice:** Update the license ledger for the Rust crates and RVC base models ([8a8ed9c](https://github.com/kein5/VRCT-VOX/commit/8a8ed9c85e5245b998d7de094ad8f13b4019d5c3))
- **dev:** Describe the mise setup and tasks ([7477927](https://github.com/kein5/VRCT-VOX/commit/7477927bc801530be0d6bb44206a3883abe352c7))
- **core:** Say how the app reaches the Rust core and what it answers ([4fa1a58](https://github.com/kein5/VRCT-VOX/commit/4fa1a583d29039da82605f349ac9e2152a6071be))
- **voice:** Record the state of the core integration and what is left ([58903d5](https://github.com/kein5/VRCT-VOX/commit/58903d5dfb04d88603b6805de3080234bfc75e79))
- Describe in-app updates and how releases are signed for them ([d07ea15](https://github.com/kein5/VRCT-VOX/commit/d07ea150829ee9658189c2d5c0c992554fd6a438))
- **ui:** Describe the locked main page and the startup failure dialog ([33bd8a3](https://github.com/kein5/VRCT-VOX/commit/33bd8a394ea39fd5916279d885b76bbf5372b506))
- **voice:** Name speech.cpp 0.11.0 in the build steps ([6ec0cc3](https://github.com/kein5/VRCT-VOX/commit/6ec0cc32fb505c039f09f690a15f15c96a27345e))
- **translation:** Record the smaller ONNX models and the 4-bit trade-off ([f938b47](https://github.com/kein5/VRCT-VOX/commit/f938b479931737300390fd6f2fb38919c603a2ff))
- **translation:** Record the comparison again with the graphs written without optimum ([c98de11](https://github.com/kein5/VRCT-VOX/commit/c98de11573b9cfdb4024cd5d009d6f56e19d6a82))
- **spec:** Describe the shared switch blocks and the VR launcher's greyed-out buttons ([6648bfb](https://github.com/kein5/VRCT-VOX/commit/6648bfb9fa02445c340bcb4d25e26e7b55a5105e))
- **ui:** Record where the main screen layout breaks across window sizes ([32cc404](https://github.com/kein5/VRCT-VOX/commit/32cc404c4ebc905c55bfe43c66b325245b140e9e))
- **voice:** List ADR-009 in the decision index ([9fdf684](https://github.com/kein5/VRCT-VOX/commit/9fdf684cdd3abc34a5ba171dff39772ff7f5d534))
- **voice:** Adopt relying on an external virtual cable on Windows and disclosing it to the Store ([7baca37](https://github.com/kein5/VRCT-VOX/commit/7baca3728d83eb297f1c1db91d56fd8a14ff4d30))
- **voice:** Collect the platform constraints on signing, the Store and virtual microphones ([a2fbff0](https://github.com/kein5/VRCT-VOX/commit/a2fbff08e1f5e71a0b9959dc8746a1eec2487ed4))
- **site:** Sort the latest release's files for a download button ([7df5b4d](https://github.com/kein5/VRCT-VOX/commit/7df5b4d298427f24a99389b59e8063e656722a41))
- **spec:** Count the chat reading model endpoint together with the TTS engine one ([8238809](https://github.com/kein5/VRCT-VOX/commit/823880912f3995d43e7ca1143e1108fe259cb765))
- **rvc:** Describe CPU conversion, the CUDA 13 runtime and the cleanup of the earlier one ([debddd0](https://github.com/kein5/VRCT-VOX/commit/debddd065ee2cdc09edcb07cdb0584042fa096bb))
- **rvc:** Describe the bundled worker, its runtime and how it compares ([0363c82](https://github.com/kein5/VRCT-VOX/commit/0363c823f6fde4aeca63fbfee45bae1d71739c66))
- **translation:** Record the comparison of the ONNX translator with CTranslate2 ([7b25fb7](https://github.com/kein5/VRCT-VOX/commit/7b25fb7fcb2e22b38856c70e8727edc01ccbca46))

#### Maintenance

- **app:** Read the stable update metadata through the project's worker ([c801df9](https://github.com/kein5/VRCT-VOX/commit/c801df96486ce3b4647664b28dedc59941a749d0))
- **models:** Describe each downloadable model for people choosing one ([054c5c2](https://github.com/kein5/VRCT-VOX/commit/054c5c20fcc0318724665461e19248d12ef75a2a))
- **dev:** Copy speech.cpp's own model catalog into the app with a tool ([1c0b180](https://github.com/kein5/VRCT-VOX/commit/1c0b1808f02699730145cd257b7601fa40556a43))
- **core:** Retire the CTranslate2 weights once the core is the default backend ([cc7cb37](https://github.com/kein5/VRCT-VOX/commit/cc7cb3795205a73934affbe971016e4517c90ef8))
- **core:** Forget the server models of engines whose start-up check fails, as Python did ([bee9317](https://github.com/kein5/VRCT-VOX/commit/bee93179036ae8ff652c8f9be44a3a340ebdd777))
- **core:** Keep the start-up update check setting that develop added ([c615e5c](https://github.com/kein5/VRCT-VOX/commit/c615e5ca2267a8ec71c4ab21020c44a578dbadd3))
- **dev:** Use Cocogitto from mise only when mise has it ([1a7c39b](https://github.com/kein5/VRCT-VOX/commit/1a7c39b50bfd23f294c5b7e276726d36ea8a43b0))
- **dev:** Pin the toolchain versions in mise.toml and add mise tasks ([e74337f](https://github.com/kein5/VRCT-VOX/commit/e74337fad79975d40ce57b0845210253adb3c1fc))
- **core:** Wire OSC, the WebSocket server and the OBS page into the Rust core ([f618f37](https://github.com/kein5/VRCT-VOX/commit/f618f3749e42cda3e8cfcc3077542cbe03bf56e4))
- **core:** Wire the model downloads and the usage events into the Rust core ([1949b90](https://github.com/kein5/VRCT-VOX/commit/1949b90ad063ab6aa4833803fb80490473c7114c))
- **core:** Find the bundled speech.cpp where the packaged app keeps it ([de1fdd8](https://github.com/kein5/VRCT-VOX/commit/de1fdd8f5869cc984bbb90580d52e5af1dde5fa5))
- **core:** Wire the speech.cpp servers into the Rust core ([045949d](https://github.com/kein5/VRCT-VOX/commit/045949d7ad067189aeedc3bcf492ac67aa29d83f))
- **core:** Let the app run the Rust core in place of the sidecar for development ([69211d5](https://github.com/kein5/VRCT-VOX/commit/69211d56f2309b36bbfbe6307e930c371d4cb577))
- **core:** Add the Rust backend core with the settings carried over from Python ([876d889](https://github.com/kein5/VRCT-VOX/commit/876d8891b15ff128acbb38a6dcb5f47dbc8764cd))
- **rvc:** Convert on the CPU when the GPU cannot be used, and load CUDA 13 ([c3e798b](https://github.com/kein5/VRCT-VOX/commit/c3e798ba65652d4415255d868911cf9f01052382))
- **rvc:** Add the live conversion worker and build HuBERT from its checkpoint ([a0ba230](https://github.com/kein5/VRCT-VOX/commit/a0ba2300c196016b046de5c59ad4c7cdabf145e2))
- **translation:** Give characters SentencePiece does not know the ids the app gives them ([7682da0](https://github.com/kein5/VRCT-VOX/commit/7682da060dcb0cb0e27102d2fe2d2be91723bc0c))
- **translation:** Add the ONNX Runtime translator for the local models ([0c0ec7c](https://github.com/kein5/VRCT-VOX/commit/0c0ec7c92bbf6d683738ac8f9d792d008fafd4b1))

## [0.3.0] - 2026-11-15

Changes since [v0.2.0](https://github.com/kein5/VRCT-VOX/compare/v0.2.0...v0.3.0).

### User-facing Changes

#### Breaking Changes

- **asr:** Replace the local Whisper engine with speech.cpp ([c78b369](https://github.com/kein5/VRCT-VOX/commit/c78b369517e9c7fab2947e616e8c2f0b8813b0c9))
  - Settings that chose the local Whisper engine move to Local (speech.cpp); on Windows the realtime ASR server becomes the bundled one. The first start shows which models it needs: download them in Settings → Speech recognition (ASR) → Models and servers after reviewing their license and size. Old Whisper weights are not used any more and can be deleted in Settings → Speech recognition (ASR). For developers, the IPC endpoints for the Whisper weight (selectable_whisper_weight_type_dict, selected_whisper_weight_type, /run/download_whisper_weight and its notifications) and for the transcription compute device and type are removed, as are the config keys WHISPER_WEIGHT_TYPE, SELECTED_TRANSCRIPTION_COMPUTE_DEVICE, SELECTED_TRANSCRIPTION_COMPUTE_TYPE and MIC_/SPEAKER_NO_REPEAT_NGRAM_SIZE (ignored in an old config.json) and the error codes TRANSCRIPTION_MODEL_MISSING, TRANSCRIPTION_VRAM_*, TRANSCRIPTION_*_DISABLED_VRAM and WEIGHT_WHISPER_DOWNLOAD. New endpoints: /get/data/local_asr_notice, /set/disable/local_asr_notice, /get/data/old_whisper_weights and /run/delete_old_whisper_weights.

#### Features

- **tts:** Read Japanese with VOICEVOX and other installed engines from the TTS page ([b9dd441](https://github.com/kein5/VRCT-VOX/commit/b9dd4414756a59fb360bc0ffebb10c4cc8900952))
- **ui:** Show examples in the empty TTS fields ([0bed154](https://github.com/kein5/VRCT-VOX/commit/0bed1549cd5aa2ffeced729ba491cf1a5a380b5e))
- **ocr:** Guide to the model download when chat reading is turned on without its models ([f8d4a45](https://github.com/kein5/VRCT-VOX/commit/f8d4a45878724fc6d3e3307b883a70935d63ee03))
- **asr:** Add the local speech.cpp engine and let users stop the switches starting its server ([744acea](https://github.com/kein5/VRCT-VOX/commit/744acea991f03e2801864a81db492d85ec4919f5))
- **ui:** Drop RVC model files into their fields and show downloads and server starts finishing ([fefcc70](https://github.com/kein5/VRCT-VOX/commit/fefcc700b7a3995a894a104f3ff2dac1863ac65c))
- **linux:** Ship deb and rpm packages ([9020f1c](https://github.com/kein5/VRCT-VOX/commit/9020f1ca515f232578f72a4b7c06c33d96d83219))

#### Bug Fixes

- **translation:** Stop reporting a stopped CTranslate2 download as a failure ([8a9552c](https://github.com/kein5/VRCT-VOX/commit/8a9552c2cf40836d4b9440afa5b7fd197f26ad51))
- **translation:** Say why a CTranslate2 download failed and offer a retry ([ac9cc26](https://github.com/kein5/VRCT-VOX/commit/ac9cc268115c18c164fb8f8c40e7b3f4909938bf))

#### Security

- **security:** Give the windows only the native permissions they use ([c013a43](https://github.com/kein5/VRCT-VOX/commit/c013a43977a9c4d65d14f18b94d574bbaa751c8f))
- **release:** Sign build provenance for every release file ([60176d4](https://github.com/kein5/VRCT-VOX/commit/60176d430647b94b14e6939065b8d2d33b7df0b4))
- **security:** Let only the main window open links, and only to listed sites ([111033c](https://github.com/kein5/VRCT-VOX/commit/111033cbcaa9b370af48feceaaea02f197ffbbdb))
- **windows:** Keep WebView2's SmartScreen protection on ([b3d7ba4](https://github.com/kein5/VRCT-VOX/commit/b3d7ba4902ce1a01f4d279c36c99c762ebb3a02a))
- **voice:** Check the whole voice changer engine archive before installing it ([06c1de9](https://github.com/kein5/VRCT-VOX/commit/06c1de9a4506a0c1c54219a24459800793e1ff3a))
- **vr:** Send the VR panel only the state it shows, through its own channel ([f64b5ff](https://github.com/kein5/VRCT-VOX/commit/f64b5ffffc19eef2764a9ee4b6a3596b5441cda0))
- **websocket:** Close clients that flood the server with messages ([c34298c](https://github.com/kein5/VRCT-VOX/commit/c34298ca022526cc417a6468279a0e06bd865d42))

### Internal Changes

#### Build & CI

- **asr:** Ship the Silero VAD model instead of reading it from faster-whisper ([d7fc532](https://github.com/kein5/VRCT-VOX/commit/d7fc532aa0a86a8b9318b52f03bc7beb7947bc03))
- **windows:** Build the package hashes into the installer ([05ad543](https://github.com/kein5/VRCT-VOX/commit/05ad543274e956d0e8953cf5331b5659bc6a3226))
- **release:** Regenerate the spec catalog when the version changes ([ca66544](https://github.com/kein5/VRCT-VOX/commit/ca66544ff84152fca9eeb27bdfd529ad5980899e))

#### Tests

- **tts:** Expect the engine voice check to stay out of the startup collection ([e1011d6](https://github.com/kein5/VRCT-VOX/commit/e1011d6d4a900573dc18c606cb8cf05527d81cfb))
- **voice:** Look for the current GPU help text in the speech server UI test ([f1b2413](https://github.com/kein5/VRCT-VOX/commit/f1b24136354ec04ba84933c5f931503a1e9011b9))
- **downloads:** Compare the catalog reference the same way on every OS ([5e1410e](https://github.com/kein5/VRCT-VOX/commit/5e1410e09bc50cda3c5a63af483e0b1f66ad78e3))
- **audio:** Wait for the monitoring thread and age the graph without new snapshots ([f38ee0f](https://github.com/kein5/VRCT-VOX/commit/f38ee0fdbb6744cef42563d10b7b143139654e48))
- **overlay:** Check the Rust VR overlay against recorded Python values ([64827eb](https://github.com/kein5/VRCT-VOX/commit/64827eb540b64448c7dc6d50f97f5c514bb2f73c))
- **voice:** Give the download tests room on slow CI runners ([8947143](https://github.com/kein5/VRCT-VOX/commit/894714331743bed77ffaaa50bb6d5fe9a5be8675))
- **rvc:** Compare the runtime with the reference by objective measures ([551a7cc](https://github.com/kein5/VRCT-VOX/commit/551a7cc2539500f9e6c3c0bf70da9f9d18c71ae4))
- **rvc:** Add a blind ABX listening comparison against the reference ([de32dc4](https://github.com/kein5/VRCT-VOX/commit/de32dc48fe8f24700e1872d08e3935b6a1270594))

#### Documentation

- **ocr:** Describe the Rust OCR runtime, its verification and open questions ([2eb2d33](https://github.com/kein5/VRCT-VOX/commit/2eb2d334de4059ebb6ce3e8dbdeb38d4df303493))
- **site:** Open the guide in your language without showing the language picker first ([62d3b72](https://github.com/kein5/VRCT-VOX/commit/62d3b7247cbbe5c307b3baafa8d03daadf0d6e0b))
- **site:** Add step progress, OS tabs, copy buttons, term tips and a page palette to the guide ([014084a](https://github.com/kein5/VRCT-VOX/commit/014084aa93296dd5ae672e293b39c5137f67c5b4))
- **rvc:** Describe streaming conversion and its measurements ([ca38e02](https://github.com/kein5/VRCT-VOX/commit/ca38e0261b825cc12277f2e59e5bcbe50df57bc2))
- **adapters:** Describe the Rust adapters and run their tests in the rust check ([e0ae6d3](https://github.com/kein5/VRCT-VOX/commit/e0ae6d3f295465692a8969f581005a72dd1640ce))
- **audio:** Map the Python audio modules to the Rust crate and list what is open ([2184f31](https://github.com/kein5/VRCT-VOX/commit/2184f3108148ad809ea996ce8884b615cef2a7fb))
- **tts:** Describe the Rust speech crate and what stays outside it ([1d7567b](https://github.com/kein5/VRCT-VOX/commit/1d7567b6bd495e6461c1b5b4e1850dca09a4ea29))
- **readme:** Show build, release and environment badges ([545cd6f](https://github.com/kein5/VRCT-VOX/commit/545cd6feb21339d769df7fe8391bb36af9a310dd))
- **overlay:** Note what the recorded values leave out and how to run them ([d3466c0](https://github.com/kein5/VRCT-VOX/commit/d3466c08fc11e1f057a142282c23180280c594de))
- **overlay:** Add the design for moving the VR overlay to Rust ([d45cd6a](https://github.com/kein5/VRCT-VOX/commit/d45cd6a5a83789de263bfea2083f3d6fadac7734))
- **site:** Show each feature on the home page as a short animation ([93e5d27](https://github.com/kein5/VRCT-VOX/commit/93e5d27907b79112be3a9aad917d5b31d1ec4186))
- **rvc:** Note that the 40 kHz pitch agreement is within the seed spread ([b5691ba](https://github.com/kein5/VRCT-VOX/commit/b5691ba2f927854037d6316d27d35984709e17f7))
- **rvc:** Record the listening judgement of the public cases ([03fd001](https://github.com/kein5/VRCT-VOX/commit/03fd0019200dc4164a3dfc6cbe7a15985717f63e))
- **site:** Give the guide the app's look and put Windows first ([6d2407f](https://github.com/kein5/VRCT-VOX/commit/6d2407f750254ae9ef118ed80debf5a584402dcb))
- **voice:** Add the RVC inference runtime specification ([f0f0c54](https://github.com/kein5/VRCT-VOX/commit/f0f0c54ea9706e5d19c924ffefcc2bbf154d1294))
- **site:** List the additions over VRCT under their own headings ([f1eeddd](https://github.com/kein5/VRCT-VOX/commit/f1eedddaae37694209539ab90212b3a155756013))
- **site:** Add a system requirements page ([6315a9f](https://github.com/kein5/VRCT-VOX/commit/6315a9f13e368f56d219efb9fdc8c0293599b1f6))
- **voice:** Adopt connecting to the user's VOICEVOX-family and COEIROINK engines for speech ([9acea14](https://github.com/kein5/VRCT-VOX/commit/9acea140fd89cf376fe6e9d401e5e1fa2a1ed6d4))
- State which web features the UI may use in WebView2 and WebKitGTK ([03aba77](https://github.com/kein5/VRCT-VOX/commit/03aba77c64f6f6c21eac4105165ec402b5b29efc))

#### Maintenance

- **ocr:** Give tools a read that logs failures and returns no words ([4ce5f9c](https://github.com/kein5/VRCT-VOX/commit/4ce5f9c1d199882981de56269846ef7cc35710a3))
- **ocr:** Capture VRChat's window and headset view in the Rust OCR runtime ([5582f1b](https://github.com/kein5/VRCT-VOX/commit/5582f1b045cab87d3c18619d4634a69fdcb040cd))
- **ocr:** Find, merge and deduplicate chat bubbles in the Rust OCR runtime ([4814268](https://github.com/kein5/VRCT-VOX/commit/4814268c1730ad0d3ee1b3ee56a61b033f57a859))
- **ocr:** Read chat text with the Rust OCR engine and check it against the reference ([e528e77](https://github.com/kein5/VRCT-VOX/commit/e528e77ab80ebb61300c98cb126fbf8b4c7b5918))
- **ocr:** Add the image operations of the Rust OCR runtime ([6736218](https://github.com/kein5/VRCT-VOX/commit/67362186f567dd6dd2016bfd2013706441b15ff2))
- **rvc:** Time streaming conversion block by block from a file ([3ebb0cf](https://github.com/kein5/VRCT-VOX/commit/3ebb0cf98e926ec81523193934a721ca08186d02))
- **rvc:** Convert block by block with the Rust RVC runtime ([24237a8](https://github.com/kein5/VRCT-VOX/commit/24237a87404d5bcb9c329aedded16397be702213))
- **rvc:** Approximate the input high-pass causally for streaming ([0e4020e](https://github.com/kein5/VRCT-VOX/commit/0e4020e99318698e85d33c4954e7a92ad040cfef))
- **rvc:** Synthesize only a window after left context for streaming ([5fac041](https://github.com/kein5/VRCT-VOX/commit/5fac041a37a47497809ba4bc80bc9bfc2b5d3f03))
- **rvc:** Refuse a crossfade longer than the streaming block ([a1d23fd](https://github.com/kein5/VRCT-VOX/commit/a1d23fdff15f826e8f460373159d8f858ce8a1c0))
- **rvc:** Play the listening comparison audio wherever the page is opened ([f0fbe67](https://github.com/kein5/VRCT-VOX/commit/f0fbe67d8842a8f47cacdc36c095f3969ed65ec5))
- **adapters:** Update rustls and tokio past their security advisories ([d3d883b](https://github.com/kein5/VRCT-VOX/commit/d3d883b9f5cbb0d7bfad45f4cd2732ec81eb1348))
- **adapters:** Harden OSCQuery, mDNS and the WebSocket token change ([38e112e](https://github.com/kein5/VRCT-VOX/commit/38e112ed45df8a3552d94c65c7637fc512c05250))
- **dev:** Run the audio routing crate's tests in the rust check scope ([caa99c9](https://github.com/kein5/VRCT-VOX/commit/caa99c95c9ef272c3ed156cf95126fdc009cb4ed))
- **adapters:** Add the clipboard with automatic paste to the Rust adapters ([933e3cf](https://github.com/kein5/VRCT-VOX/commit/933e3cfbe47a10df03b961998ad491c896a1b735))
- **audio:** Control the managed route, the virtual microphone and the source bridge from Rust ([2d080de](https://github.com/kein5/VRCT-VOX/commit/2d080debbdb0471c539b9f3a9f268c7e4db1127e))
- **dev:** Test the Rust ops crate in the rust check scope ([9731133](https://github.com/kein5/VRCT-VOX/commit/97311339dfa827684b535544c13c677983b81abb))
- **watchdog:** Add the Rust watchdog that stops the backend without a UI ([3dece6a](https://github.com/kein5/VRCT-VOX/commit/3dece6a0fb5d0cf57404e72bbe8f2ae4dc7cf961))
- **telemetry:** Add the Rust sender of the two usage events ([eef8ed2](https://github.com/kein5/VRCT-VOX/commit/eef8ed2e1c4a5682aeae359a115723bd51053b1a))
- **adapters:** Add OSC and OSCQuery to the Rust adapters ([32b0b4a](https://github.com/kein5/VRCT-VOX/commit/32b0b4a1526bf24bbb2d7f16d2b5a9ab68f15eb0))
- **downloads:** Add the Rust owner of consent-gated model downloads ([8ce8a20](https://github.com/kein5/VRCT-VOX/commit/8ce8a204483ff1dbc3df489f032579ffe7448a9f))
- **tts:** Read the installed-engine settings and send Japanese to the engine in Rust ([c51ebf3](https://github.com/kein5/VRCT-VOX/commit/c51ebf3c7b92becfd4d40dc6d336f64ff945ed92))
- **audio:** Play speech and direct voice through native WASAPI and PipeWire streams ([86f38a5](https://github.com/kein5/VRCT-VOX/commit/86f38a56423787e5c8cd0b9dbfdc95004e4445e7))
- **tts:** Schedule speech and hand its PCM to the output in Rust ([08c1dc0](https://github.com/kein5/VRCT-VOX/commit/08c1dc0e33fecaa0363e76b6c6f980b947d7d98c))
- **tts:** Stream speech.cpp PCM and notice a lost server in Rust ([c79e32b](https://github.com/kein5/VRCT-VOX/commit/c79e32b7d18a86f77266d6e042ea05789df5658a))
- **tts:** Add the Rust speech settings and model options ([1ec8165](https://github.com/kein5/VRCT-VOX/commit/1ec8165eec073373dda091173d2c2db8fe53b084))
- **adapters:** Add the OBS browser source to the Rust adapters ([b658cdc](https://github.com/kein5/VRCT-VOX/commit/b658cdccefcad11fcaddabeca6b4b34503564549))
- **audio:** Observe the PipeWire graph through the native client API ([d4635c5](https://github.com/kein5/VRCT-VOX/commit/d4635c560b524b9a272050b35f7c5da94768baa0))
- **overlay:** Check VR tooltip requests and markers in Rust ([b655bd5](https://github.com/kein5/VRCT-VOX/commit/b655bd5cf68808b987a86fc1132c9068c15fd3e5))
- **overlay:** Time the VR subtitle fades and window visibility in Rust ([8724bbe](https://github.com/kein5/VRCT-VOX/commit/8724bbe22b136241dccb9bd47215c979c5c81578))
- **overlay:** Place, point at and hold VR windows in Rust ([b6ad6eb](https://github.com/kein5/VRCT-VOX/commit/b6ad6ebfb7b5b411f36e83b7eb81415a41cd3b87))
- **overlay:** Compute the VR layout and overlay poses in Rust ([b2a5316](https://github.com/kein5/VRCT-VOX/commit/b2a53161f982e8edf58b38a7cf48ec8b5b665d41))
- **adapters:** Add the WebSocket server to the Rust adapters ([886ba68](https://github.com/kein5/VRCT-VOX/commit/886ba6820d959d4932fdbc2b7aad486791ce8727))
- **audio:** Add the Rust device manager, identity rules and speaker peak tracker ([37c52f7](https://github.com/kein5/VRCT-VOX/commit/37c52f75b02076a6ce1423b9ab63c4d1262a6248))
- **adapters:** Add the Rust crate for the external adapters and its TLS rules ([217822b](https://github.com/kein5/VRCT-VOX/commit/217822b14e34c27720978c34dd6c3daac8d8dcc8))
- **speech:** Add the Rust owner of the bundled speech.cpp servers ([b8c1e4d](https://github.com/kein5/VRCT-VOX/commit/b8c1e4d2cf7fd8079a527afc0a6f898a810a3040))
- **rvc:** Declare the listening page font as the design system lists it ([d8d2499](https://github.com/kein5/VRCT-VOX/commit/d8d24996ac81d5aaca48c751062bdcc3d73af5c7))
- **rvc:** Convert offline with the Rust RVC runtime and check it against the reference ([aeeef0e](https://github.com/kein5/VRCT-VOX/commit/aeeef0ea8f1b8551d4eb8dc70c337833890b66ee))
- **rvc:** Add the model, index and signal front end of the Rust RVC runtime ([3b5c8ef](https://github.com/kein5/VRCT-VOX/commit/3b5c8ef9ca3292c8bbfcc9e473947277da9c6c02))
- **tts:** Connect to the user's VOICEVOX-family and COEIROINK engines for Japanese ([a1a46ba](https://github.com/kein5/VRCT-VOX/commit/a1a46bab5775f8559e665ebaa5f6da950cbab1f3))

## [0.2.0] - 2026-11-15

Changes since [v0.1.0](https://github.com/kein5/VRCT-VOX/compare/v0.1.0...v0.2.0).

This release includes the changes of 0.2.0-beta.1, listed below.

### User-facing Changes

#### Breaking Changes

- **websocket:** Listen beyond this PC only over TLS, and let the connection key be replaced ([bb0c5fe](https://github.com/kein5/VRCT-VOX/commit/bb0c5fe37c6c34f64171b45ad975f4f7538dba06))
  - a WebSocket host other than 127.0.0.x needs a
certificate and key. A LAN host saved without them goes back to
127.0.0.1 at startup, and the app says so.
- **ocr:** Remove upstream VRCT's chat-bubble model from the repository ([78a1ad2](https://github.com/kein5/VRCT-VOX/commit/78a1ad254a3b6e0331c8288a270200f84723ab85))
  - BubbleDetector() without model_path has no model.
- **ui:** Offer English and Japanese only as UI languages ([87ecf44](https://github.com/kein5/VRCT-VOX/commit/87ecf442a8be5ab9d214d399e565383033c96306))
  - UI_LANGUAGE accepts only "en" and "ja".

#### Features

- **ui:** Link each model setting to how to use your own model ([f215c44](https://github.com/kein5/VRCT-VOX/commit/f215c448d77f91b244fd5832004038bbc462c61d))
- **ui:** Name features by what they do, with the short name in brackets ([6510ebe](https://github.com/kein5/VRCT-VOX/commit/6510ebe9b9ba337ed749ca59d824cf01e8a158b5))
- **flow:** Draw where each input goes as a graph, in the panel, in VR and on the desktop ([cf26e26](https://github.com/kein5/VRCT-VOX/commit/cf26e2684153eacf8976bb268fb10aadb9d11d7e))
- **flow:** Show where your voice and chat go, with the time each step took, in the app, on the desktop and in VR ([cd16585](https://github.com/kein5/VRCT-VOX/commit/cd16585e694df8734c00bcc38d6994ba8a6920b8))
- **flow:** Record where the user's voice and chat go and how long each step takes ([197fb24](https://github.com/kein5/VRCT-VOX/commit/197fb241b588b9ada517de18fe628e521cb6a3b2))
- **voice:** Speak translations in the converted voice (ADR-007) ([8b4f190](https://github.com/kein5/VRCT-VOX/commit/8b4f190fa8d05dfdb4b968b9803c2320bdf8f429))
- **voice:** Stop RVC and Seed-VC at the start when no NVIDIA GPU is there ([9b5453e](https://github.com/kein5/VRCT-VOX/commit/9b5453e66fe4de72229ce90b02ede8582459628c))
- **captions:** Show the desktop caption overlay on Linux under X11 and XWayland ([1528fc5](https://github.com/kein5/VRCT-VOX/commit/1528fc53af2f3d5ba3bc16b5117310cf5af7d23c))

#### Bug Fixes

- **telemetry:** Start sending usage data only from the answer to the notice ([13da826](https://github.com/kein5/VRCT-VOX/commit/13da8260d92c19d2734186a57aec2fd6e68a7608))
- **vr:** Relay only the requests the VR panel sends, and check them in the backend too ([8692fa6](https://github.com/kein5/VRCT-VOX/commit/8692fa69c893e177799a324758632f7be5ccc2b6))
- **site:** Make links to Japanese headings with voiced marks land on the heading ([7abb9d9](https://github.com/kein5/VRCT-VOX/commit/7abb9d96e7b5f2febbcda68746a7c9d63b83f282))
- **site:** Keep the search working in browsers without Intl.Segmenter ([1cd1ad8](https://github.com/kein5/VRCT-VOX/commit/1cd1ad8030f2a68e2a6586b7623a985885757f05))
- **ui:** Explain voice errors on the main screen, and name speech recognition in English hints ([60f4758](https://github.com/kein5/VRCT-VOX/commit/60f4758c7a77c1df6c29291808ff076f7c6a416e))
- **ui:** Keep long feature names whole in the settings menu and the VR panel ([f740307](https://github.com/kein5/VRCT-VOX/commit/f740307fe406966b0f4d0cae858f019649e9bf44))
- **voice:** Say why the voice changer could not start instead of showing its code ([97aa51b](https://github.com/kein5/VRCT-VOX/commit/97aa51b2582ad82fcf35173f9e2133ff0377a2ac))
- **flow:** Fit the panel, the desktop strip and the VR window, and document them ([8888d17](https://github.com/kein5/VRCT-VOX/commit/8888d17033a3fb88c1403357287877e0953d404f))
- **voice:** Keep the router's control frames as before when nothing is suppressed ([3000d35](https://github.com/kein5/VRCT-VOX/commit/3000d35c0ff0c55777f8c98c2b91cc865a6f0852))
- **captions:** Realize the Linux overlay window before making it click-through ([b143251](https://github.com/kein5/VRCT-VOX/commit/b1432518ebac0eaf54bb62115f92278c809f8e9e))
- **downloads:** Never wait longer than asked when stopping a legacy download ([4465fe1](https://github.com/kein5/VRCT-VOX/commit/4465fe13fd539d262c0b5f25e03f3fec0bb16e2f))
- **speech:** Start the bundled servers on a dedicated GPU first, for any vendor ([8c1f74c](https://github.com/kein5/VRCT-VOX/commit/8c1f74c5a60e8f9eb1fabd11da2da5519569ec6b))
- **translation:** Do not treat a model that was never downloaded as an error ([250b4bc](https://github.com/kein5/VRCT-VOX/commit/250b4bc2b046b645f313b8d1331e9c8687421396))
- **ui:** Name the section users can see in speech server messages ([f5f2e08](https://github.com/kein5/VRCT-VOX/commit/f5f2e08a09286fdad925b2445d32e612814d3431))

### Internal Changes

#### Build & CI

- **release:** Keep CHANGELOG.md to stable releases, and make beta notes from their commits ([65a52cf](https://github.com/kein5/VRCT-VOX/commit/65a52cfbfc36437f7724c9c026ddcd9a8637e89f))
- **release:** List the pre-releases' user-facing changes in a stable release's notes ([b7fe1a2](https://github.com/kein5/VRCT-VOX/commit/b7fe1a2b2adad2d4ab96c316531b26b05e9b4611))
- **release:** Check commit messages with a cog hook, and write CHANGELOG.md when a release is prepared ([239b93d](https://github.com/kein5/VRCT-VOX/commit/239b93da434620eb246324d935f0bedcda37a757))

#### Tests

- **websocket:** Give the test Model the same re-entrant OBS lock as the app ([2db2497](https://github.com/kein5/VRCT-VOX/commit/2db2497006bdbd0da052a5871648328f90c868ca))
- **websocket:** Connect over wss with the asyncio client, which does not lose data on Windows ([ba65507](https://github.com/kein5/VRCT-VOX/commit/ba65507710b8c2b50f889c726d071c9b6a918ecf))
- **voice:** Import the controller fixture the way the other voice tests do ([70a6959](https://github.com/kein5/VRCT-VOX/commit/70a6959293631c556ca12a2c20bde9e97399c207))

#### Documentation

- **websocket:** Say "needed" and "cannot connect" in the LAN certificate texts ([86ce481](https://github.com/kein5/VRCT-VOX/commit/86ce4818e403ca9f125eac5c935f1dfb6d9e8a24))
- **site:** Explain using OBS and WebSocket from other PCs, and making a new key ([9b4398a](https://github.com/kein5/VRCT-VOX/commit/9b4398a0ae80cfe27a2e0a1ead7e2e038e30c6bc))
- **site:** Say what each feature does in words a reader can follow ([7e52250](https://github.com/kein5/VRCT-VOX/commit/7e52250eae4b24a96f6bfebcfc403dca4c7139f5))
- **site:** Say a custom Whisper server always needs a key, and fix the last old names ([b2655d4](https://github.com/kein5/VRCT-VOX/commit/b2655d4b287dea423f9c1929b7679b4d99439e14))
- Record how features are named, in the design guide and the use cases ([422313f](https://github.com/kein5/VRCT-VOX/commit/422313f3ca9ed556498e6dd9c89dd0d04cb760aa))
- **site:** Retake the screenshots with the new feature names, and keep names whole in the flow graph ([56aa7b3](https://github.com/kein5/VRCT-VOX/commit/56aa7b3f789e19d086d3abd1d8ac6280d1d3633a))
- **site:** Put every feature and guide page in the common order, with the new feature names ([508f024](https://github.com/kein5/VRCT-VOX/commit/508f024ddee089b8d6187cb850790f0c7abc2772))
- Write down the commit and changelog rules for people and agents ([175d3c2](https://github.com/kein5/VRCT-VOX/commit/175d3c217dff3037eb553056b45f52ca4e8bbc66))
- **site:** Put the text to speech page in the common order ([2733f87](https://github.com/kein5/VRCT-VOX/commit/2733f8717220ff92796be997ed25e3f87f07831a))
- **site:** Add pages for what you want to do, how voice and text flow, and your own models ([12bcb02](https://github.com/kein5/VRCT-VOX/commit/12bcb024cc383c6db24796680640e43522fdfe22))
- **site:** Group pages by what you want to do, and search Japanese by word ([7d7d89d](https://github.com/kein5/VRCT-VOX/commit/7d7d89db248f81e9d76a777a9e465620f2d5eda4))
- **superpowers:** Plan the user docs restructure, the feature names and the own-model guide ([f9caf31](https://github.com/kein5/VRCT-VOX/commit/f9caf31dddbad4395735124de94cad9937847008))
- **site:** Point AMD and Intel GPU users to local LLMs and realtime captions ([17b3281](https://github.com/kein5/VRCT-VOX/commit/17b328177a2a1e144e90cc0b703d729f592c49ab))
- **voice:** Propose speaking translations through voice conversion (ADR-007) ([1240014](https://github.com/kein5/VRCT-VOX/commit/124001460085cf2d3d1504ccce0a258037312c8d))
- **tts:** Use the labels the settings show now in the quickstart ([bd70a52](https://github.com/kein5/VRCT-VOX/commit/bd70a52b463cd12c708eff26e98e888d0f4cf1c4))
- **site:** Show the desktop captions on a screen, and say what the GPU version adds ([d07032a](https://github.com/kein5/VRCT-VOX/commit/d07032a9b93a958223a3cf7cb554592f8d49b8be))
- **release:** Record the 0.1.0 release and the log line the package check always leaves ([d6d347d](https://github.com/kein5/VRCT-VOX/commit/d6d347dfecb1c19974d8dae4719f7dea9ea1c202))
- **site:** Show the app in use, fix stale paths, and let screenshots open larger ([821e911](https://github.com/kein5/VRCT-VOX/commit/821e911f9c99b286d1088353faf4be98589588f8))

#### Maintenance

- Drop the VR UI previews, upstream-era notes and ko/zh logos; run stray unit tests ([f148d04](https://github.com/kein5/VRCT-VOX/commit/f148d040b8d373cb6c8f88e75047faa65680e728))
- Remove files nothing uses ([f5377bb](https://github.com/kein5/VRCT-VOX/commit/f5377bb3fcfdfb231f6c70c3edfd920be32d7523))

## Earlier releases

Releases up to 0.1.0 are described in [GitHub Releases](https://github.com/kein5/VRCT-VOX/releases).
