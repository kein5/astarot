# Changelog

All notable changes to ASTAROT, newest first. Only stable releases are listed: each section
covers everything since the previous stable release, its betas included. Betas (`X.Y.Z-beta.N`,
from `develop`) are described in their [GitHub pre-release notes](https://github.com/kein5/VRCT-VOX/releases).
Versions follow [Semantic Versioning](https://semver.org/). The layout follows the ideas of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/): changes that users notice come first, and
changes for developers follow.

A section is written when its release is prepared (`python tools/changelog.py write`), not on
every commit. See [Changelog and releases](CONTRIBUTING.md#changelog-and-releases).

## [0.5.0] - 2026-11-17

Changes since [v0.4.0](https://github.com/kein5/VRCT-VOX/compare/v0.4.0...v0.5.0).

This release includes the changes of 0.5.0-beta.1, 0.5.0-beta.2, 0.5.0-beta.4, 0.5.0-beta.5 and 0.5.0-beta.6, listed below.

### User-facing Changes

#### Breaking Changes

- **linux:** Ship both speech.cpp builds in one package per architecture ([679373f](https://github.com/kein5/VRCT-VOX/commit/679373f22eb60ca680763a2e02a6c9e8448d0375))
  - tools/build_linux.py drops --variant and --speech-archive;
pass --download-speech, or --speech-archive-dir with both pinned archives
under their release names. Release candidates and anything that looks for
linux-x64-vulkan or linux-x64-cpu in a Linux file name must use
linux-x64-release.
- **transcription:** Retire the google web speech engine and its generic key ([804a617](https://github.com/kein5/VRCT-VOX/commit/804a61708fc14c771f2c6f8735e335819c096400))
  - the Google speech recognition engine is removed. Users who
had chosen it are asked to choose another engine the next time they turn
transcription on: Local (speech.cpp), or a cloud engine (Groq, OpenAI,
Deepgram or a custom Whisper server) with their own API key.
- **core:** Keep api keys out of config.json ([877d74f](https://github.com/kein5/VRCT-VOX/commit/877d74ffc628fa57894531c48e541986abfe85fb))
  - config.json no longer holds API keys. Tools that read
keys from config.json must stop doing so. Users who go back to 0.4 or
earlier must enter their API keys again there.
- **core:** Run the rust core as the only backend and stop shipping python ([8f186f6](https://github.com/kein5/VRCT-VOX/commit/8f186f6c30e5d7f04c520244f69f9fb976ccc016))
  - packages no longer contain vrct-vox-sidecar or a Python runtime. Developers use npm run dev, npm run dev-fast or npm run build-resources and `python tools/dev.py setup --scope resources`; build-python, build-python-cuda, build-cuda, dev-cuda, dev-cuda-fast, sidecar-dev, setup --scope sidecar and the spec/*.spec files are gone. To compare with the Python backend, use a 0.4.x package or tag.

#### Features

- **ui:** List models of your own in the model catalog ([259a3d7](https://github.com/kein5/VRCT-VOX/commit/259a3d7fb4fae19462248c870f86d2a282cb403e))
- **downloads:** Register model files of your own and switch to them ([a4f8142](https://github.com/kein5/VRCT-VOX/commit/a4f8142d80850170f016c8d7afbfb6f32709da03))
- **ui:** Show what the cpu choice of a speech server runs on ([e9718ff](https://github.com/kein5/VRCT-VOX/commit/e9718ff3ea1540538a2a2af6cb4b99a783d08938))
- **core:** Run speech.cpp on the cpu or vulkan build the setting asks for ([6ae3dab](https://github.com/kein5/VRCT-VOX/commit/6ae3dab5d5a429ea0c7517d5cf0b7a9b9f72e983))
- **overlay:** Choose the subtitle font from the fonts on this PC ([07da896](https://github.com/kein5/VRCT-VOX/commit/07da8966d890ec595c1ba0da6aca79968c1950dc))
- **app:** List releases and update the app through the backend endpoints ([237303e](https://github.com/kein5/VRCT-VOX/commit/237303e9e1bf41bc22b5e205a6fe420b1486ab16))
- **core:** Check for updates at start only while the update check is on ([addc91c](https://github.com/kein5/VRCT-VOX/commit/addc91cd0f2481d365f2e8ff834846e37c1c8dfa))
- **ui:** Mark catalog models that may be too heavy for the PC ([cb7fca1](https://github.com/kein5/VRCT-VOX/commit/cb7fca1ef99aa04eb0d588f93b03fd13e5f1970c))
- **overlay:** Point, click, grab, scale and resize the VR panel with the controllers ([2baa87c](https://github.com/kein5/VRCT-VOX/commit/2baa87c07f86399126b77eb9d5d1acef872e418f))
- **ui:** Tell which catalog models look too heavy for the PC ([3de3dfc](https://github.com/kein5/VRCT-VOX/commit/3de3dfceb6112134441effa4a3b72e6c7ca6d70c))
- **vc:** Let the rvc device, cpu threads and input high-pass be chosen ([05d4d4e](https://github.com/kein5/VRCT-VOX/commit/05d4d4e5f5c5aae3200cbd21ef011c3dd67028a6))
- **tts:** Let coeiroink's speed, volume, pitch and silences be set ([edd73a6](https://github.com/kein5/VRCT-VOX/commit/edd73a6e214f35187c443c0b3ab7a5a0ab6025b6))
- **ui:** Show the whisper segment filter thresholds in the asr settings ([960882e](https://github.com/kein5/VRCT-VOX/commit/960882e7560273aa59de3f04c538314294b0eb5f))
- **ui:** Choose models from a catalog grouped by use ([23d9de4](https://github.com/kein5/VRCT-VOX/commit/23d9de4b3b33033d1a2595abdc8d16c182717387))
- **core:** Turn on the onnx local translation with gpu devices, quantization choice and own models ([687173a](https://github.com/kein5/VRCT-VOX/commit/687173a61fceccb2de0e2a1bd05788648f418d2d))
- **translation:** Run local translation on amd, nvidia and intel gpus as well as the cpu ([4afd605](https://github.com/kein5/VRCT-VOX/commit/4afd6052aa6e075324b96e5773895fb1b65619eb))
- **translation:** Add google cloud translation, papago and lan addresses for local llms ([6d8ef83](https://github.com/kein5/VRCT-VOX/commit/6d8ef83c6f41fe875fde4bfb0c6d67121acd93af))
- **downloads:** Report models downloaded in an earlier run ([60792ee](https://github.com/kein5/VRCT-VOX/commit/60792ee6adbff5804eb2acc45b4908df02f30ee3))
- **tray:** Keep the app running in the tray when the main window is closed ([406e53b](https://github.com/kein5/VRCT-VOX/commit/406e53bc4b35f0a137dd7683c9af60511de7722b))
- **tray:** Give the whole app one tray icon, shared with the hexagram overlay ([52fc768](https://github.com/kein5/VRCT-VOX/commit/52fc76837f59f4d003bb88b2476a02d0ab82aba9))
- **ui:** Choose the monitor the hexagram shows on, in the settings or the tray menu ([d59bba8](https://github.com/kein5/VRCT-VOX/commit/d59bba8525cf0c2895afd38a431f17a435813e84))
- **core:** Show message readings from the dictionary shipped with the app ([33082d5](https://github.com/kein5/VRCT-VOX/commit/33082d5fe72ee9938ca68eee0289f54b05fb400b))
- **translation:** Analyze readings with sudachi.rs and a sudachidict file ([e7be223](https://github.com/kein5/VRCT-VOX/commit/e7be223f41bd3650b821954c9dfc3ea0e71f26ab))
- **ui:** Dock the common settings out of the hexagram's middle ([a3253a6](https://github.com/kein5/VRCT-VOX/commit/a3253a6c75589b01a0f60dc76d08f92ca5735333))
- **ui:** Turn the hexagram with the wheel and dock features towards the screen ([4b19b6a](https://github.com/kein5/VRCT-VOX/commit/4b19b6ac7304a312eb70db10e83441efd83d99f7))
- **tray:** Hide the hexagram at a screen edge and bring it out near the pointer ([340491c](https://github.com/kein5/VRCT-VOX/commit/340491c9c38943ea8c1c9e84111cf427214644ec))
- **ui:** Offer the tray companion as an experimental feature, off by default ([819afcd](https://github.com/kein5/VRCT-VOX/commit/819afcddb790fe1504ebbc1c16ef701d14f31255))
- **tray:** Keep the app in the system tray while the tray companion is on ([4a1b475](https://github.com/kein5/VRCT-VOX/commit/4a1b475fbf25f3b7c0d6cbeeb6dbe9a0d5b215ae))
- **ui:** Narrow the language picker by an ISO 639 code as it is typed ([ef60634](https://github.com/kein5/VRCT-VOX/commit/ef606345277565d3853da04b5542be5144d1ccf5))
- **ui:** Filter the language picker by language code ([60574f9](https://github.com/kein5/VRCT-VOX/commit/60574f96b4adf28a46eeb7f82a6eebb19ff15622))
- **core:** Speak realtime microphone finals and refuse the cable the voice plays into ([fe74572](https://github.com/kein5/VRCT-VOX/commit/fe745725dac46d0109be274246d56dacc20c680b))
- **core:** Turn speech recognition on and off in the rust backend ([8fb152b](https://github.com/kein5/VRCT-VOX/commit/8fb152b46c5af42a85203a6b1d0c6cba662b7f73))
- **transcription:** Add the speech recognition crate ([37fac05](https://github.com/kein5/VRCT-VOX/commit/37fac05cdf053762f19feadf838656d14968aa8a))
- **audio-routing:** Read a microphone or a speaker loopback for speech recognition ([ac319fd](https://github.com/kein5/VRCT-VOX/commit/ac319fd846de29ea7ffd011511907e94632c4583))
- **core:** Speak, convert and route the voice from the rust core ([b6203e8](https://github.com/kein5/VRCT-VOX/commit/b6203e8c702a779529a66db19164e2601a8a1896))
- **vc:** Own the rvc worker, direct voice and its runtime setup in rust ([6c05ac7](https://github.com/kein5/VRCT-VOX/commit/6c05ac7119b55fa969b2c79b4d8dc1d2d518b8d3))
- **tts:** Read japanese with installed speech engines from the rust core ([54a0ee4](https://github.com/kein5/VRCT-VOX/commit/54a0ee4116e1ff2fa08b85a8476442067242039f))
- **core:** Show pipeline messages in the vr logs and send read chat lines through it ([b3ae827](https://github.com/kein5/VRCT-VOX/commit/b3ae827c2a9c9c4be5cbb32f71c8c94e77394561))
- **ui:** Add an experimental features page to the settings ([6c813a3](https://github.com/kein5/VRCT-VOX/commit/6c813a3098d0e365e81971d555828823877263b6))
- **core:** Translate messages and send them from the rust core ([0a5690b](https://github.com/kein5/VRCT-VOX/commit/0a5690b1023d93dfadb898f9daf9b6ce089ab8c4))
- **core:** Read vrchat chat bubbles in the rust backend ([f42ee40](https://github.com/kein5/VRCT-VOX/commit/f42ee40326f433c474d3287814f928566740685d))
- **ocr:** Let chat reading load onnx runtime at run time and report its state ([0e51a24](https://github.com/kein5/VRCT-VOX/commit/0e51a24b4fdf68c4dbe05005fbee70926b55168e))
- **ui:** Name ASTAROT in the windows microphone question ([cc212d3](https://github.com/kein5/VRCT-VOX/commit/cc212d3b0b43e429279c57ec3b7e2dc9d606a711))
- **ui:** Give the app the ASTAROT icon ([74447a3](https://github.com/kein5/VRCT-VOX/commit/74447a30e464b317949ad20e47978c1936b9f73f))
- **core:** Add the translation providers and readings as a rust crate ([68a6234](https://github.com/kein5/VRCT-VOX/commit/68a62349fea1e39597ebcd51318669505d0ddb65))
- **ui:** Show the ASTAROT symbol and logo in the app ([b95983f](https://github.com/kein5/VRCT-VOX/commit/b95983f494580a4e80e0c3b40e10602279c50121))
- **core:** Answer the update endpoints as the python backend did ([8e26dce](https://github.com/kein5/VRCT-VOX/commit/8e26dce22cde71cf81352ad6c60574c31eb994fb))
- **ui:** Title the app's windows ASTAROT ([97689d1](https://github.com/kein5/VRCT-VOX/commit/97689d19511e013497d81812c9653b6d27e62a23))
- **ui:** Call the app ASTAROT in its messages and settings ([2e5bcc7](https://github.com/kein5/VRCT-VOX/commit/2e5bcc7b870794aba663b0f58e305d8049bfdaac))
- **core:** Answer the VR panel layout and turning chat reading off ([fd6dc69](https://github.com/kein5/VRCT-VOX/commit/fd6dc69fc0483fbbaad204d4e8a217bae7ff1974))
- **core:** Answer the saved keys, URLs and feature settings in the core backend ([2ff3772](https://github.com/kein5/VRCT-VOX/commit/2ff377280dbdaefa579b68dc957662752422f612))

#### Bug Fixes

- **ui:** Draw the main rail's feature icons as buttons at rest ([7872217](https://github.com/kein5/VRCT-VOX/commit/78722176dd768ccab97e728545c830b1f4cda289))
- **ui:** Keep the empty conversation's heading still while the app starts ([4222c26](https://github.com/kein5/VRCT-VOX/commit/4222c2646b0f58c61fb593c3264e48f594d29c10))
- **ui:** Base the model memory notes on the GPU the speech engine uses ([68cba22](https://github.com/kein5/VRCT-VOX/commit/68cba22c9b0b18d507dbf26f6140fc74b0c79c3e))
- **audio:** Stop text to speech failing with output_underflow on Windows virtual microphones ([8e0338a](https://github.com/kein5/VRCT-VOX/commit/8e0338a9c7e2d4d9ef8f93f3d95c03d4584448dc))
- **tray:** Name the tray icon ASTAROT ([69da590](https://github.com/kein5/VRCT-VOX/commit/69da590fbf8a01da269c7cc0d0faabc7542cf672))
- **ui:** Open each feature's settings from its icon so the main rail no longer shifts at startup ([f134b45](https://github.com/kein5/VRCT-VOX/commit/f134b459ebfa7648b4e4bc8bdcdf33b557533e71))
- **core:** Share one ONNX Runtime between chat reading and translation and use the shipped libraries ([27a3fe6](https://github.com/kein5/VRCT-VOX/commit/27a3fe665d1ede406b8b52efcfedefa2a0d0f648))
- **ui:** Keep the main window in the tray after a tray switch has done its job ([58da2b3](https://github.com/kein5/VRCT-VOX/commit/58da2b3f7eb4f537401f12e2059778cf747cfb9f))
- **ui:** Let model downloads be started again after a command gets no reply ([396319a](https://github.com/kein5/VRCT-VOX/commit/396319a1a06c5898c8c0b2135b6ce96a892ad29b))
- **ui:** Tell the user when the hotkeys cannot be registered or the window cannot be restored ([b40c5d3](https://github.com/kein5/VRCT-VOX/commit/b40c5d348974719ec9064bd40df5b6fbb2db80d6))
- **ui:** Show the start button of the chat reading and legacy model reviews in blue ([05ee264](https://github.com/kein5/VRCT-VOX/commit/05ee264435072c7cd7202365d3151371317b2937))
- **ui:** Call the engine "the ASTAROT engine" in the remaining messages ([17fca81](https://github.com/kein5/VRCT-VOX/commit/17fca81316f181b238076a99be893e9a1625b9ca))
- **ui:** Explain the input forwarding and voice route errors in words ([814fe48](https://github.com/kein5/VRCT-VOX/commit/814fe488976bb4fd4794a5cab208fd1d06b9b4c3))
- **ui:** Show "save failed" only when the page's own save fails ([0fbd9cb](https://github.com/kein5/VRCT-VOX/commit/0fbd9cbed57cd70afd00d36473d6c86b38f581fb))
- **ui:** Write メモリ in the LLM privacy note added on develop ([1eca6c9](https://github.com/kein5/VRCT-VOX/commit/1eca6c9c39ecb9b298921aec0d1f20a8552e833e))
- **ui:** Start the VR subtitle sliders with the fields, show their values, and align (OCR) ([cf07e6c](https://github.com/kein5/VRCT-VOX/commit/cf07e6cb51483a8364fff35eef7b69363879303f))
- **ui:** Give "Review download" one name and look, and end checkboxes at the fields' edge ([4a57681](https://github.com/kein5/VRCT-VOX/commit/4a57681801fb879b429b6a91b80f772820a8e181))
- **ui:** Line up the voice pages' buttons with the fields they act on ([166dc0d](https://github.com/kein5/VRCT-VOX/commit/166dc0d2686347c314dbe3d11610dc77136ee832))
- **ui:** Show step numbers, link styling and one monospace face in settings ([eb9dc7a](https://github.com/kein5/VRCT-VOX/commit/eb9dc7aba543863c5119115e5d3bc09dffc93bed))
- **ui:** Use one name for stopping speech and write オン／オフ in Japanese ([959a2c6](https://github.com/kein5/VRCT-VOX/commit/959a2c6b665aadc2dc9246581b9655a1701802c5))
- **ui:** Name the app ASTAROT on the experimental features page and the hexagram menu ([abe57e3](https://github.com/kein5/VRCT-VOX/commit/abe57e3a68a956d5ae16749b5a302a90b4fb598e))
- **ui:** Say what the TTS engine and its servers need in the user's words ([f29e057](https://github.com/kein5/VRCT-VOX/commit/f29e057ab0becfe2d82143358c3967104ae365ab))
- **ui:** Offer another translator while no translation model can be downloaded ([f600905](https://github.com/kein5/VRCT-VOX/commit/f600905cf7a0d082bb4775c0f8660b260d6684bb))
- **config:** Keep secrets.json when Windows cannot decrypt it just now ([fb4622e](https://github.com/kein5/VRCT-VOX/commit/fb4622e0baf7e75585f6655e6c73545591a7826e))
- **ui:** Describe what LLM translation and the update check send ([3cad2f5](https://github.com/kein5/VRCT-VOX/commit/3cad2f56256dcd9dc376764721179dfe0bed20c0))
- **osc:** Answer OSCQuery requests only when Host names an address or localhost ([ca9f6d1](https://github.com/kein5/VRCT-VOX/commit/ca9f6d18eea8f9ed01c2f63abe8557edeea8bfdd))
- **core:** Contact only the engines in use at start and check others when selected ([f2ab165](https://github.com/kein5/VRCT-VOX/commit/f2ab165e445b444c578e8f0958935e36f9b3ac7f))
- **log:** Hide the user name in more ways of writing the home folder ([f1ac8ab](https://github.com/kein5/VRCT-VOX/commit/f1ac8ab1daf92fa0fb63f7276ed78cb7c087db3f))
- **websocket:** Limit how many connections the WebSocket server keeps ([5bbb341](https://github.com/kein5/VRCT-VOX/commit/5bbb341b8d8ea61dfeb9625fa7c7c21192095b68))
- **ocr:** Wait before connecting again after SteamVR asks to quit ([c07fc7c](https://github.com/kein5/VRCT-VOX/commit/c07fc7c4f205bd4a12ca1072c5d26de1f8d95f6b))
- **backend:** Wait for a failed run to stop without freezing the windows ([1ebaa37](https://github.com/kein5/VRCT-VOX/commit/1ebaa373f5414ed43df65a292bb71ef8fe22180f))
- **translation:** Keep the answer that arrives with 100 Continue ([6d7892e](https://github.com/kein5/VRCT-VOX/commit/6d7892e0bd3425aca30dd00b813b789e052abb38))
- **update:** Keep beta updates and the release list when the repository is renamed ([e0f4dfe](https://github.com/kein5/VRCT-VOX/commit/e0f4dfe8f3f8f24470791d162d0f43fdd34cd91e))
- **update:** Restart the app when the Windows installer does not start ([61282bc](https://github.com/kein5/VRCT-VOX/commit/61282bc08f359d08f359f2810994800714ec9f40))
- **telemetry:** Record only errors that can be sent and keep the record whole ([cf0994a](https://github.com/kein5/VRCT-VOX/commit/cf0994a04098bcc4b8e84f3f7b2944f3d1a6295e))
- **vc:** Refuse more broken voice models and indexes before they crash the worker ([6b78d10](https://github.com/kein5/VRCT-VOX/commit/6b78d10effa685f87db8aadba9cc262d356f063f))
- **tray:** Show the main window at start when no tray icon can bring it back ([02c281f](https://github.com/kein5/VRCT-VOX/commit/02c281fa9b07932461131fdb6d369f5471f5816a))
- **tray:** Keep the app responsive while the tray menu changes ([13e0e05](https://github.com/kein5/VRCT-VOX/commit/13e0e0530621d38c1a82a85064a9949db3e59ed2))
- **audio:** Stop a held-up capture from blocking audio and from piling silence ([84a1d02](https://github.com/kein5/VRCT-VOX/commit/84a1d0272b13c448350576121487243d3b446275))
- **ui:** Show the usage data switch off until the notice is answered ([b2dc5cc](https://github.com/kein5/VRCT-VOX/commit/b2dc5cce045299cd7fd5a7159e798ec693d7aa3b))
- Open the main window where it stays instead of moving it after start ([35963bc](https://github.com/kein5/VRCT-VOX/commit/35963bc763ffc310eab0bfa1dad932175bd53b4c))
- **linux:** Show ASTAROT as the tray icon's title in the AppImage ([84c5316](https://github.com/kein5/VRCT-VOX/commit/84c5316df9d9ce238d54e57f1f50237526e43741))
- **ui:** Name the close button after what closing does ([7188a21](https://github.com/kein5/VRCT-VOX/commit/7188a2133dd7a9386cf08e90a60a67c964ee2f1d))
- **ui:** Stop the false engine-unreachable notice right after start ([ad5e455](https://github.com/kein5/VRCT-VOX/commit/ad5e4553579a21ab5d825b8eeeccb35ebf4c3fba))
- **ui:** Line up the word filter and VR rows and show \n as typed ([80f83d7](https://github.com/kein5/VRCT-VOX/commit/80f83d746973ec46ec7943a420e0eabbfd443666))
- **ui:** Reword the spaced この PC and this computer as well ([10c9a81](https://github.com/kein5/VRCT-VOX/commit/10c9a81627b12b15556d338c53626b241bc7d347))
- **ui:** Write English headings and labels in sentence case ([525e442](https://github.com/kein5/VRCT-VOX/commit/525e44244dd87d92068d7b72ef6105511ab15d84))
- **ui:** Speak of your PC instead of this PC ([d209189](https://github.com/kein5/VRCT-VOX/commit/d209189e0f2e212c9455732df3bb3e184fd80a1c))
- **ui:** Say on pages without a save bar that changes apply at once ([280addb](https://github.com/kein5/VRCT-VOX/commit/280addb738d4e9164321130cb1965ce0d4899d49))
- **ui:** Draw the older settings dropdowns as fields like the forms ([c4c10c8](https://github.com/kein5/VRCT-VOX/commit/c4c10c888cfb217d171b904892e87041e915de6c))
- **ui:** Turn settings on and off with checkboxes on every page ([d4dd130](https://github.com/kein5/VRCT-VOX/commit/d4dd130c7e1013546d46faf42d81ed9d230c7a13))
- **ui:** Call mute by one name in the top bar, settings and hotkeys ([6ff37c2](https://github.com/kein5/VRCT-VOX/commit/6ff37c2d48b6e062d1ea6f2c73969a30ba04b648))
- **ui:** Switch direct voice to RVC with its own button ([db88271](https://github.com/kein5/VRCT-VOX/commit/db88271e5822b8c181ff55890f808394ad33b41c))
- **ui:** Stop calling the chosen hexagram monitor unplugged while the list loads ([5ae1d0f](https://github.com/kein5/VRCT-VOX/commit/5ae1d0f32196d552991565a71480b0b3cba007b1))
- **tray:** Keep the hexagram overlay off when it is turned off or fails to start ([5e9ce8c](https://github.com/kein5/VRCT-VOX/commit/5e9ce8c0cfdb15940129d44133103dfe16c5c114))
- **config:** Keep the voice model choice readable by 0.4 ([927ace9](https://github.com/kein5/VRCT-VOX/commit/927ace9aaafbff772acb0e975856cecd38a5646f))
- **asr:** Hand the capture thread's pidfd to its helper alone on linux ([2998f7a](https://github.com/kein5/VRCT-VOX/commit/2998f7a12819193fac2a5db39210c5b0e52d1e19))
- **ui:** End a language change on any error the engine answers ([8814bca](https://github.com/kein5/VRCT-VOX/commit/8814bcab946f08b03317d3a101c11909b7445f2f))
- **audio:** Keep device lists and speech going while a microphone opens ([6601607](https://github.com/kein5/VRCT-VOX/commit/66016073e9d0c695270e9fb6e25c6b84dfa8f8df))
- **audio:** Release com on the thread that initialized it when an output moves ([897b7a9](https://github.com/kein5/VRCT-VOX/commit/897b7a9ecc73d8c13d0f810c8ace97a40b11ac7d))
- **ui:** Show the lost network notice in the UI language ([2aacf2b](https://github.com/kein5/VRCT-VOX/commit/2aacf2bb84123e0e6bb66cb33c0a2cd0b58282f1))
- **ui:** Keep the hidden log font size slider out of the tab order ([f6c8247](https://github.com/kein5/VRCT-VOX/commit/f6c8247e6b357bbf0e89b9975cf289562fddd830))
- **ui:** Keep the translator list open while the sidebar scrollbar is used ([97edca1](https://github.com/kein5/VRCT-VOX/commit/97edca1d28ad3b53a82e700915ad2060d1b98809))
- **ui:** Write the download size in the display language ([2047bef](https://github.com/kein5/VRCT-VOX/commit/2047bef8b89049a87567bbcf0db0fcc5693b4f75))
- **ui:** Name the automatic chat reading language before its list arrives ([07e0fa3](https://github.com/kein5/VRCT-VOX/commit/07e0fa38b80582c3472b442cf13e9627a4913912))
- **ui:** Write the GPU reading's time in the display language ([6bd414f](https://github.com/kein5/VRCT-VOX/commit/6bd414f3336ce8963a699b548c16682022cf34d9))
- **ui:** Make the own-model guide link look like a link ([71911c5](https://github.com/kein5/VRCT-VOX/commit/71911c5c8abad8d26320298332c8ca89f7fd9fbb))
- **ui:** Show the forms' primary actions in blue and give consent room ([4ffaf06](https://github.com/kein5/VRCT-VOX/commit/4ffaf06f9805a2dac8d58ca8b0f975e6e6c6bbb0))
- **ui:** Line up settings rows with their section heading ([1b8cf18](https://github.com/kein5/VRCT-VOX/commit/1b8cf18f7f887d7f29d55a2cf810b50afc216a9b))
- **ui:** Say on and off in the quick settings rows ([3a5f7f4](https://github.com/kein5/VRCT-VOX/commit/3a5f7f40e4762937002ecf4b112153d40502eaf1))
- **ui:** Show the translator choice as a field like the languages ([962ffe9](https://github.com/kein5/VRCT-VOX/commit/962ffe91d5c8bdb3d26a6e2ca73fdd65e5a4a741))
- **core:** Reap the file manager started by open folder on linux ([5ce9882](https://github.com/kein5/VRCT-VOX/commit/5ce9882556f2300a0105820e8d36c3bdc58bfb0b))
- **core:** Drop a stopped run's usage event hook ([663801f](https://github.com/kein5/VRCT-VOX/commit/663801f2ea2850dcd08100405144a6ad52d1b3b3))
- **ui:** Name the translation model group in the model download review ([4b0de8c](https://github.com/kein5/VRCT-VOX/commit/4b0de8ca9057392a364c87c40fcfb14a2ab06637))
- **ui:** Save a Shift and symbol hotkey when Shift is released first ([c09f55d](https://github.com/kein5/VRCT-VOX/commit/c09f55d83adad93f01c0768f127c3cfc57a4738d))
- **ui:** Keep the typed name and paths when a model of one's own is refused ([6cba086](https://github.com/kein5/VRCT-VOX/commit/6cba0862904720c3b598cfd0735f0a634819eb78))
- **rvc:** Report a broken or hostile voice model as invalid instead of ending the worker ([207250a](https://github.com/kein5/VRCT-VOX/commit/207250a7501cf65d4f065851b45a47037def049a))
- **ui:** Show why a switch pressed from the tray did not turn on ([1306501](https://github.com/kein5/VRCT-VOX/commit/13065011110096ece9d8cb67f8efa242c5a6a5f4))
- **osc:** Bound nested osc arrays and the mdns cache ([a2114b2](https://github.com/kein5/VRCT-VOX/commit/a2114b2b496bd22e8a58cc35aa189836fdf248e5))
- **ui:** Keep stop and mute clear of the top bar's right-hand buttons ([d21ebba](https://github.com/kein5/VRCT-VOX/commit/d21ebba2997901fbc8bf261c5b336cec73f3a241))
- **core:** Keep the backend running when the pc wakes from sleep ([c110afb](https://github.com/kein5/VRCT-VOX/commit/c110afb15ad2daee951f1d388a16c43967e0e6d2))
- **core:** Leave the user's home folder out of process.log ([338d239](https://github.com/kein5/VRCT-VOX/commit/338d2395612126db6fc90769003cc2ba33540508))
- **config:** Keep saved api keys when the key file cannot be read for a moment ([28366de](https://github.com/kein5/VRCT-VOX/commit/28366dee23ae591dfca12653c1e61c9c828c4873))
- **rvc:** Find a voice model on a network share on windows ([cd748df](https://github.com/kein5/VRCT-VOX/commit/cd748dfb03934274212fdce640d3470aa75d838c))
- **core:** Wait for a failed run to stop before starting it again ([72dbe49](https://github.com/kein5/VRCT-VOX/commit/72dbe49ea6ec1484d218783a34f78aa651c76995))
- **linux:** Ignore restarts of portal backends that hold no session ([c2a3180](https://github.com/kein5/VRCT-VOX/commit/c2a31807f5c7f7884030c68d4d2d0107fd43eb38))
- **vr:** Remove the linux vr panel's last frame when the app quits ([c4322f3](https://github.com/kein5/VRCT-VOX/commit/c4322f3034872395f077108e4981c35b343d8980))
- **core:** Start nothing more once a start-up past its deadline is stopped ([d671b49](https://github.com/kein5/VRCT-VOX/commit/d671b493ed1f9205ac8bb6f5da6f3c304f8c82ef))
- **asr:** Let both recognition switches share one bundled server start ([dc4fd34](https://github.com/kein5/VRCT-VOX/commit/dc4fd34d851a68a7cb06906ac07327a1d17a127a))
- **installer:** Download the package again when its sha-256 does not match ([aae2f25](https://github.com/kein5/VRCT-VOX/commit/aae2f25df5e04a1dc2c871bc8fe204596c39db3e))
- **hotkeys:** Keep the wayland hotkeys when a change is cancelled or fails ([b28ba84](https://github.com/kein5/VRCT-VOX/commit/b28ba847a3d1fed38a967d65648a6fdd4428f676))
- **translation:** Refuse a chunk size that would overflow instead of panicking ([2e2dd2c](https://github.com/kein5/VRCT-VOX/commit/2e2dd2cb539442727741a9626d4f350874c68455))
- **vr:** Let the vr panel receive the pointer again for its hover effects ([876ce20](https://github.com/kein5/VRCT-VOX/commit/876ce20fed80fc521d3d6fb9f3ee4225dc31f898))
- **tray:** Start without a tray icon when linux has no appindicator library ([4f3eb99](https://github.com/kein5/VRCT-VOX/commit/4f3eb991c66748588bd81ca2826d92fa7c454213))
- **vr:** Pick the language whose code was typed in the VR language filter ([a6c79d8](https://github.com/kein5/VRCT-VOX/commit/a6c79d866c91dec2431454a464a084590cc8ed0e))
- **ui:** Keep the opened sidebar from covering or hiding what it opens ([2bbc6c2](https://github.com/kein5/VRCT-VOX/commit/2bbc6c217381666ee430fc9e25d0a765f1947ada))
- **vr:** Keep the vr overlay and chat reading connected when the other stops ([a845239](https://github.com/kein5/VRCT-VOX/commit/a8452397615db1e6ced52ba7ba1d13b1879c784c))
- **ui:** Mark only the failed typed message when a send is refused ([2e717c7](https://github.com/kein5/VRCT-VOX/commit/2e717c738ac07481d8212abba5ae71f238902ef7))
- **ui:** Keep the RVC selection when saving from the advanced settings ([cf1e31d](https://github.com/kein5/VRCT-VOX/commit/cf1e31d06b6c23b246a3629f78c563b09b6e0a5d))
- **ui:** Find vr and hotkey settings in the settings search and reach every ocr result ([4132e09](https://github.com/kein5/VRCT-VOX/commit/4132e0981b253112d0b0d25e0dea7cc843db98ba))
- **asr:** Say why a cloud speech engine failed when recognition stops ([b487c20](https://github.com/kein5/VRCT-VOX/commit/b487c20dcbd886a1731af565a599db5d3a0ebdde))
- **ui:** Explain unanswered and failed requests on the speech pages ([abbcc4e](https://github.com/kein5/VRCT-VOX/commit/abbcc4e017633fe6bbf97ce7d45f5a1171dc7878))
- **ui:** Name the rvc retrieval blend the same way in japanese errors ([0ac17f4](https://github.com/kein5/VRCT-VOX/commit/0ac17f4bdc83a575e4d64a098cecb2542f0df4cc))
- **ui:** Keep the greyed-out add and remove target buttons from acting on keys ([cbc4524](https://github.com/kein5/VRCT-VOX/commit/cbc45245db4ad3e6416289c13839fff1cec801d1))
- **ui:** Resend a logged message by holding enter or space ([b37a450](https://github.com/kein5/VRCT-VOX/commit/b37a4507df0e67dbf6c09f4dce623940ed6aebcd))
- **ui:** Tell a failed stop or mute where it was pressed ([1139150](https://github.com/kein5/VRCT-VOX/commit/113915037005af6fab231d2c35a534782134cbdd))
- **ui:** Warn about the same language in the sidebar whatever the country ([a128cb2](https://github.com/kein5/VRCT-VOX/commit/a128cb25c1dca4c056c0b30cfe7a4809053a9236))
- **ui:** Show the gpu memory notices for translation in the ui language ([378554b](https://github.com/kein5/VRCT-VOX/commit/378554bedd3f59a3a37fd7ec1a46766d18cb285d))
- **ui:** Explain why the tts settings could not be saved ([7f5b9b6](https://github.com/kein5/VRCT-VOX/commit/7f5b9b6d22675caef88f2d86f2552fa28a461e61))
- **ui:** Explain speech recognition server failures without tts advice ([7e73b81](https://github.com/kein5/VRCT-VOX/commit/7e73b81d31d51a7710102f0e94fb9be4085a6c79))
- **ui:** Confirm saved ocr window names, tls files and new connection keys ([2635656](https://github.com/kein5/VRCT-VOX/commit/2635656c7ff4bac6344769203a390fa0ded0858e))
- **ui:** Lead to the chat reading models when the switch finds them missing ([effc305](https://github.com/kein5/VRCT-VOX/commit/effc30536a24b0cdbd328df5baa34177933ea1a2))
- **ui:** Keep the desktop caption window where it was dragged after a restart ([02365ef](https://github.com/kein5/VRCT-VOX/commit/02365efa975047c74d51184682715be44eb0db65))
- **vr:** Save the speech, model and chatbox settings changed in the vr panel ([d5ac972](https://github.com/kein5/VRCT-VOX/commit/d5ac97227fcddfac7bde4eac9990663be0878362))
- **voice:** Stop offering seed-vc and move a saved seed-vc to rvc ([b3b2413](https://github.com/kein5/VRCT-VOX/commit/b3b24135ee6233e073328cef412c4e361a19bd46))
- **ui:** Describe the record and phrase timeouts as what they do ([a61e235](https://github.com/kein5/VRCT-VOX/commit/a61e235bfbf42dc029ca8bdb5d91d4603173a421))
- **asr:** Show the vad option as unavailable until a vad engine ships ([8562c39](https://github.com/kein5/VRCT-VOX/commit/8562c399695769de197a738df3f4d2aedc298e9b))
- **core:** Paste voice typing into the vrchat window again ([6dd4b87](https://github.com/kein5/VRCT-VOX/commit/6dd4b87a66ded0abf275ae9347839b064d58c624))
- **core:** Keep translation on when one of several translations fails abnormally ([92ae423](https://github.com/kein5/VRCT-VOX/commit/92ae423c5cdb1e13bbd4d40e454930cc63143015))
- **ui:** Remove the startup model download switch that no longer does anything ([1e4283c](https://github.com/kein5/VRCT-VOX/commit/1e4283c9c17c96f4c4b9379df0e4305c6296398a))
- **core:** Fall back to this pc when the saved osc destination cannot be opened ([1c8c998](https://github.com/kein5/VRCT-VOX/commit/1c8c99863793ce891b52bb663edb667ecf19995f))
- **core:** Warn when a message cannot be shown on the vr subtitles ([f163242](https://github.com/kein5/VRCT-VOX/commit/f16324240bc223f3c4b149a661f623cc01192e8b))
- **core:** Stop recognition that still uses the engine you switched away from ([95dbacb](https://github.com/kein5/VRCT-VOX/commit/95dbacb8cec467cd7e80c5f8af188476019a4f3d))
- **ui:** Offer the update button on the error screen only where the app can update itself ([c2e6a2b](https://github.com/kein5/VRCT-VOX/commit/c2e6a2b8edd48f50a4dfc69b230cdd82a880275c))
- **linux:** Require libpipewire in the deb and rpm packages ([f536499](https://github.com/kein5/VRCT-VOX/commit/f53649938a52bfad1274dc6bc33bda17b85ef83a))
- **ui:** Make the rvc high-pass checkbox 24px high like the other fields ([89d921b](https://github.com/kein5/VRCT-VOX/commit/89d921b2f84a813b5198fa39ff7aff597b6d3d51))
- **core:** Wake the start-up deadline at once when a run ends during its start-up ([5b5800a](https://github.com/kein5/VRCT-VOX/commit/5b5800a10e693606c3688b27db131c584ca8c2af))
- **vr:** Stop the vr panel from sending events that pass for rust or another window ([3d4c72e](https://github.com/kein5/VRCT-VOX/commit/3d4c72e546788a258c0e3ac47021426a27f2ea8c))
- **hotkeys:** Tell the user and bind again when the wayland shortcut portal goes away ([27f448c](https://github.com/kein5/VRCT-VOX/commit/27f448c123d78e7503506a325d63b2398ff67b80))
- **ui:** Tell the user when the desktop captions or the vr panel window cannot open ([6b6e5e4](https://github.com/kein5/VRCT-VOX/commit/6b6e5e42693c4346650f70366585a1c6cb58cf03))
- **update:** Save the latest settings and stop the core before the windows installer runs ([6f296a3](https://github.com/kein5/VRCT-VOX/commit/6f296a3c6570b0e97eae2f3c809d652d7964f893))
- **core:** Tell the user when the start-up panics or hangs instead of starting for ever ([08152da](https://github.com/kein5/VRCT-VOX/commit/08152da72fc60947097fba4d94a07c0df843a0db))
- **overlay:** Keep the desktop flow strip updating when a message has a line break ([e545ef0](https://github.com/kein5/VRCT-VOX/commit/e545ef0b8210f119eb21fa08c557a5205306aef0))
- **ui:** Keep the papago client id out of the vr panel like other credentials ([0edeee9](https://github.com/kein5/VRCT-VOX/commit/0edeee98d3f93f6d70a5832a0707be42647f469f))
- **ui:** Lead the translation model download to the shared consent review or say none is published ([d35d292](https://github.com/kein5/VRCT-VOX/commit/d35d292d6a55ea9cc9642788a471b7b75b9cbb98))
- **translation:** Stop offering the google, bing and papago translators ([cbbd4ea](https://github.com/kein5/VRCT-VOX/commit/cbbd4ea1314c3c370ec4409da194ed6c6a518295))
- **ui:** Show example placeholders in the voice input fields and quick chat ([68a3b0b](https://github.com/kein5/VRCT-VOX/commit/68a3b0b4081c64139e5880c201c2c5b37968ae2a))
- **vc:** Judge a converted block's age by its route ([f292f66](https://github.com/kein5/VRCT-VOX/commit/f292f66d320e60e4c2b3126dc97bce0784f8f745))
- **ui:** Keep the translator in sight beside one target language at 1280x720 ([eb47d30](https://github.com/kein5/VRCT-VOX/commit/eb47d3024851338c78119b764a763d9379b15116))
- **obs:** End stalled browser source requests promptly when stopping on windows ([e2054d7](https://github.com/kein5/VRCT-VOX/commit/e2054d756b1642d17f899d463c7b085a2cf9b879))
- **osc:** Stop announcing a withdrawn mdns service after its goodbye ([3c9edd5](https://github.com/kein5/VRCT-VOX/commit/3c9edd56152f63e19cd815a8c5c5d528a3386c79))
- **ui:** Fit the language settings and the translator in the rail ([13d0074](https://github.com/kein5/VRCT-VOX/commit/13d00740d1f109ab4c8576628ae7fa4494c63f46))
- **ui:** Keep the conversation readable in short and very wide windows ([88743f2](https://github.com/kein5/VRCT-VOX/commit/88743f2f83ae039e3743d43c1e1572a5b392bb3b))
- **ui:** Open the narrow window's rail over the conversation and keep its foot in sight ([f6b342f](https://github.com/kein5/VRCT-VOX/commit/f6b342f595dbec11e40f81b241205369555cbbda))
- **ui:** Fit the main top bar to the conversation column, not the window ([f8c701d](https://github.com/kein5/VRCT-VOX/commit/f8c701df770fc237847c2a38f92b257b3519c81f))

#### Performance

- **core:** Find the settings folder at start-up without starting onnx runtime ([7aaffb9](https://github.com/kein5/VRCT-VOX/commit/7aaffb9a102367fc8c15d40a024c62766f76a933))

#### Security

- **core:** Stop the bundled ONNX Runtime from sending usage reports to Microsoft ([264a99c](https://github.com/kein5/VRCT-VOX/commit/264a99cdaf73d792486b8947f8069ccee635cc39))
- **security:** Grant the main window only the core permissions it uses ([29a607f](https://github.com/kein5/VRCT-VOX/commit/29a607fcb6a465976b35ff1dbbe45c0f690f271c))
- **security:** Turn off the web inspector in release builds ([e6c373d](https://github.com/kein5/VRCT-VOX/commit/e6c373dc8bd3d875c4d276cba5aa0e78537ae8b7))

### Internal Changes

#### Refactoring

- **ui:** Ask for the tray in one place without a cfg-only early return ([c8c1803](https://github.com/kein5/VRCT-VOX/commit/c8c180381d96b880a403f1848dd65faa226d0ce7))
- **vr-overlay:** Share one openvr connection and read the scene application ([ce63c70](https://github.com/kein5/VRCT-VOX/commit/ce63c70728807e1aafb74c37918106d999c0a7a7))
- **translation:** Share the provider requests through traits resolved at compile time ([4179f84](https://github.com/kein5/VRCT-VOX/commit/4179f84ee4d8a881463d5a40a8f6d57a6f94a827))
- **ui:** Move the main page's layout skeleton onto the ADR-010 foundation ([82a79a0](https://github.com/kein5/VRCT-VOX/commit/82a79a008f2988f16d0bed66161bbba7c1696ac2))
- **ui:** Add the vanilla-extract and Radix foundation with one use each ([01140b0](https://github.com/kein5/VRCT-VOX/commit/01140b022085f59c7ada45567cded58af7af7cf2))
- **ui:** Move the logic modules without hooks to TypeScript ([09d6042](https://github.com/kein5/VRCT-VOX/commit/09d60425815db94d14dd59616531567fae185914))

#### Dependencies

- **deps:** Write package-lock.json that npm 10 also installs ([fcaedaa](https://github.com/kein5/VRCT-VOX/commit/fcaedaaebf3d917b7949b92192f2e855f251262f))
- **deps:** Add TypeScript, vanilla-extract and Radix for the UI migration ([2f38a20](https://github.com/kein5/VRCT-VOX/commit/2f38a203862187b430d2d5b78374072ed95f6540))

#### Build & CI

- **build:** Ship ONNX Runtime and the OpenVR client library in the packages ([ecbb86c](https://github.com/kein5/VRCT-VOX/commit/ecbb86c0cc3676ebfb248a522faca3181524732a))
- **build:** Replace a stale speech.cpp bundle when building the Windows package ([226a4a0](https://github.com/kein5/VRCT-VOX/commit/226a4a008e473f88c7eadb9b89750ae9194189d5))
- Fetch a pinned sudachidict edition for the readings ([9cda20c](https://github.com/kein5/VRCT-VOX/commit/9cda20c588ec352e9e08b8f417b7c0e9d8635d38))
- **linux:** List the audio devices through pipewire in the app ([510ace8](https://github.com/kein5/VRCT-VOX/commit/510ace86efefa3a6ce9e3af4aab1fdc7f63396da))
- Stage the app's shipped files without the python backend ([8079609](https://github.com/kein5/VRCT-VOX/commit/80796091f8711bca0bd0d95077f09813c7f26489))
- **dev:** Pin node 26.13.1 for development and ci ([952ddbe](https://github.com/kein5/VRCT-VOX/commit/952ddbe3f1fe75167a55e88bea3c5a8fb98ac03a))
- **site:** Compare the manual's release link as a whole address ([c9d6d03](https://github.com/kein5/VRCT-VOX/commit/c9d6d0326ace9ea3bccfbf1c1fba8a63e13cd346))
- **site:** Match the manual's release link by its exact address ([42f1fe5](https://github.com/kein5/VRCT-VOX/commit/42f1fe5492d50f24b98ae5c3abad353a1ddc370b))
- **site:** Check the manual's two languages, chapter pages and linked guide pages ([eadd4f4](https://github.com/kein5/VRCT-VOX/commit/eadd4f44fc30b25dbc83e73b7c9da7fc5c3c70d1))
- **ui:** Type-check the UI and let its tests read TypeScript sources ([4cb08e8](https://github.com/kein5/VRCT-VOX/commit/4cb08e864878955e97e2fb003fcbe7d42c37fb79))

#### Tests

- **build:** Stand in for the runtime library downloads in the Linux staging tests ([f280ffe](https://github.com/kein5/VRCT-VOX/commit/f280ffed2543bcb17fe494817d5209acd384be98))
- **backend:** Keep the main-window check on the async backend_start ([b06908a](https://github.com/kein5/VRCT-VOX/commit/b06908ad43293aadf96357303022c740818c413a))
- **ui:** Press Use RVC before saving and stop waiting forever on idle animations ([ff51863](https://github.com/kein5/VRCT-VOX/commit/ff518635f2d7c27ced733159b027c693b0611a48))
- **ui:** Expect the sentence-case labels in the notice and search tests ([f2cc17f](https://github.com/kein5/VRCT-VOX/commit/f2cc17fe0fd7c8728737a15b7b9297051c203bbb))
- **ui:** Give the startup defaults test the sidebar hook the language button uses ([ec547dc](https://github.com/kein5/VRCT-VOX/commit/ec547dc311a1010833f9c5bb6d02714845bab3ad))
- **ui:** Find the translator button by its name ([d7ee1fd](https://github.com/kein5/VRCT-VOX/commit/d7ee1fd8033a459fa243509c27c0df7c1aff841d))
- **ui:** Check the save bar after opening input forwarding ([6a3a09e](https://github.com/kein5/VRCT-VOX/commit/6a3a09ecc15a244d33a37019d8f2c0a8012427f1))
- **core:** Keep the core's settings reference at its own version ([68e5fd9](https://github.com/kein5/VRCT-VOX/commit/68e5fd915dab9bac271cd604700c4e52f627ccb9))
- **ui:** Check the speech server's cpu fallback notice among its notices ([8cfe166](https://github.com/kein5/VRCT-VOX/commit/8cfe166e98e7056ec95b00bbd5ebf6a194795dc7))
- **ui:** Give the main window safety test the same-language rule and two targets ([7b764cb](https://github.com/kein5/VRCT-VOX/commit/7b764cb3dfdd7f16fc93a05cfc3aac50c7304caa))
- **downloads:** Load the shared apply helper in the controller test ([044e129](https://github.com/kein5/VRCT-VOX/commit/044e129d91bdb381beca50f40b3ac807b5846239))
- **core:** Accept either order when a failing vr overlay is turned on again ([cfbaf9e](https://github.com/kein5/VRCT-VOX/commit/cfbaf9e329945f1e1857424b13b3744d874f7495))
- **core:** Wait for what the slow paths really do in four timing tests ([7149f75](https://github.com/kein5/VRCT-VOX/commit/7149f753557c781e529e55b25ddb01575d0f6485))
- **platform:** Quit the app the way the tray menu does in the native GUI tests ([fe9cb39](https://github.com/kein5/VRCT-VOX/commit/fe9cb39b0be0bc4314e07035404f5ebca6f7a0d0))
- **ui:** Stub the new voice imports in the settings and switch tests ([abd3f8c](https://github.com/kein5/VRCT-VOX/commit/abd3f8cfc6221f4997187d18379601fa23fc469e))
- **core:** Check that every error code the core answers with is in the specification ([077a087](https://github.com/kein5/VRCT-VOX/commit/077a087ab8d98619d764cdd820de29e312db9a56))
- **ui:** Find the main page by data attributes in the packaged-app tests ([a12b65c](https://github.com/kein5/VRCT-VOX/commit/a12b65cc41a2ada96205f86d491f80e7b375a46a))
- **core:** Speak translated chat and microphone finals from the core ([6b40731](https://github.com/kein5/VRCT-VOX/commit/6b40731da56908a9eb37764bbe5226b308d4f9af))
- **adapters:** Wait for the websocket handler instead of sleeping ([2b18759](https://github.com/kein5/VRCT-VOX/commit/2b18759dd294983035e84cbf23994603b981ae95))
- **core:** Give the server tests ports the os never hands out by itself ([62d0189](https://github.com/kein5/VRCT-VOX/commit/62d0189e6240ef86125cc9faba3fb9d2b76d7448))
- **voice:** Read the TypeScript caption reducer with type stripping on ([2d0e902](https://github.com/kein5/VRCT-VOX/commit/2d0e9021a1aede0e9f1cad821fcd72c3ef934de6))

#### Documentation

- **release:** Add the 0.5.0 release notes ([1b258ed](https://github.com/kein5/VRCT-VOX/commit/1b258ed5f311b86a28a7b86fb4ad4751443679b0))
- **site:** Bring the guide's screenshots up to 0.5.0-beta.5 ([b601c28](https://github.com/kein5/VRCT-VOX/commit/b601c2852daaf97d0dc415f6e712bc87269417c5))
- Match the docs to the 0.5.0 core and the ASTAROT display name ([d15ec46](https://github.com/kein5/VRCT-VOX/commit/d15ec463bf9a45c29637f283761c84f0e47f3a6a))
- Link the accessibility statement from the readme and support pages ([7125ee5](https://github.com/kein5/VRCT-VOX/commit/7125ee5e5bdeb1d71054e098e7fa3b414df5869d))
- Add an accessibility statement ([2e8c718](https://github.com/kein5/VRCT-VOX/commit/2e8c71846489171ef3293883faae7fccab5796d9))
- **spec:** Name the app ASTAROT where the web translators are left out ([a43f5f5](https://github.com/kein5/VRCT-VOX/commit/a43f5f551e60344d5beda7e3f98af3dc43f79d03))
- Name the app ASTAROT in the README and the developer docs ([d9c2c35](https://github.com/kein5/VRCT-VOX/commit/d9c2c35e1eeb73791b6ea586d15b4f207517a9fd))
- **site:** Show the 0.5.0 screens in the guide's screenshots ([f47831b](https://github.com/kein5/VRCT-VOX/commit/f47831ba44983b73c7b5c8811f08a0437a050669))
- **notice:** Bring the seed-vc, silero, translation and crate notes up to 0.5.0 ([4fbe353](https://github.com/kein5/VRCT-VOX/commit/4fbe35324ab7328da73ddf8e933be973d1808e31))
- **conduct:** Drop discussions, which the repository does not have ([f0f5e24](https://github.com/kein5/VRCT-VOX/commit/f0f5e24298bfa9e06d0220e253bacdf1fb5caff2))
- **contributing:** Point at the rust model catalog and the current ci jobs ([c40646f](https://github.com/kein5/VRCT-VOX/commit/c40646f52480aea46843bd3b601b6f48a1ea2f80))
- **security:** List every published package and the 0.5.0 backend in scope ([142b906](https://github.com/kein5/VRCT-VOX/commit/142b9066743998146e8fe1eb5b9e54d483886ca3))
- **design:** Match the description fold and switch uses to the ui ([8173a75](https://github.com/kein5/VRCT-VOX/commit/8173a7596c7efed511394aab2cbe617d60d20536))
- **product:** Describe the rust backend and the rvc-only runtime fetch ([fec1203](https://github.com/kein5/VRCT-VOX/commit/fec1203abd1b2e22423fbc86e449ebd73252b596))
- **readme:** Correct the seed-vc note, linux packages and chat reading menu ([ab99fd9](https://github.com/kein5/VRCT-VOX/commit/ab99fd9ed807269b5856e106041cda00e9049a0a))
- **agents:** Name the Rust catalog copies and the SCSS Modules styles ([6748495](https://github.com/kein5/VRCT-VOX/commit/6748495577c4b82c3b3e5fe6fe833d42b4058504))
- **agents:** Point backend and Rust checks at native/ and the core notes ([6a36b26](https://github.com/kein5/VRCT-VOX/commit/6a36b26cfd9f5f6bd1002ef267bb19af7ce64ad3))
- **agents:** Describe the Rust backend core and the RVC-only voice conversion ([c6dc229](https://github.com/kein5/VRCT-VOX/commit/c6dc229cf5b6213a0cd17bdfa0f21523b7023820))
- **design:** Write down the controls, saving and wording rules from the UI audit ([53ad18e](https://github.com/kein5/VRCT-VOX/commit/53ad18ecd473291c72ff25631d2bd72129af85f2))
- **spec:** Say that a run started again keeps the failed run's log ([744a7ec](https://github.com/kein5/VRCT-VOX/commit/744a7ec6275a0e857dbfeaff19a9e854032410ff))
- **spec:** List the vr panel's relayed models, timeouts and chatbox switches ([0178cac](https://github.com/kein5/VRCT-VOX/commit/0178cac924e64aec0536a4edff4d08e7c56c46f7))
- **core:** Drop a repeated line from the web translator decision ([50aa00d](https://github.com/kein5/VRCT-VOX/commit/50aa00d166132313357c58f4ce6dec59935d10d5))
- **core:** Compare inference runtimes for ocr, local translation and vad ([d2aad89](https://github.com/kein5/VRCT-VOX/commit/d2aad890cad7ca15dceb52cdbb9e2bec2b4f68f9))
- **core:** Number the decisions of #394 after the items of #384 ([2644900](https://github.com/kein5/VRCT-VOX/commit/2644900432b4e67fad143d46dc339c3340f9882a))
- **core:** Number the paste target decision after the items of #384 ([c86f06e](https://github.com/kein5/VRCT-VOX/commit/c86f06e5618d3e48229127d771f75627776acf3d))
- **core:** Record the choices made for the core fixes of #394 ([f93ed22](https://github.com/kein5/VRCT-VOX/commit/f93ed22834911af6a6cc7dfa4f6dad0f98952e0c))
- Record where both speech.cpp builds ship and how the setting picks one ([dc41cc2](https://github.com/kein5/VRCT-VOX/commit/dc41cc2941d72f3a91057b31ab52a56c7d23c09a))
- **downloads:** Describe models of your own and user_models.json ([ac7e4b5](https://github.com/kein5/VRCT-VOX/commit/ac7e4b5b2681e99a5a6befe25809bce958289c23))
- **transcription:** Record that the google web speech engine is retired ([aacac90](https://github.com/kein5/VRCT-VOX/commit/aacac90b62c207cee4348256a875010ee9204d91))
- **overlay:** Record the controller port and the system subtitle fonts ([ad5cfe4](https://github.com/kein5/VRCT-VOX/commit/ad5cfe4e0d292a8e33ff767bfae66b18f70259ee))
- **updates:** Describe the update endpoints on the app updater ([f44c864](https://github.com/kein5/VRCT-VOX/commit/f44c864a153e911974c50b1f87cce9b014187660))
- **downloads:** Describe the warning for models that may be too heavy ([e49028a](https://github.com/kein5/VRCT-VOX/commit/e49028a35ce8178c006ec51f41fd74450d8a18dc))
- **spec:** Take back a vr panel relay note another change wrote into this branch ([0dd2642](https://github.com/kein5/VRCT-VOX/commit/0dd2642f256c83f16f1a02cc09a69d933a182367))
- **translation:** Describe the providers as a zero-cost abstraction ([773a1e3](https://github.com/kein5/VRCT-VOX/commit/773a1e3a7f313a7857b6bc410a02090fed0dcde8))
- **spec:** Describe the exit codes of a start-up that panics or runs out of time ([f99f9a8](https://github.com/kein5/VRCT-VOX/commit/f99f9a861054ba47f9c317151ef5784fa8733816))
- **downloads:** Describe the model catalog and the downloaded state ([5ae84d0](https://github.com/kein5/VRCT-VOX/commit/5ae84d0626e782c144215c54b1bf6ca06ecdbd2a))
- **core:** Record the onnx local translation decisions and what remains open ([9cef80f](https://github.com/kein5/VRCT-VOX/commit/9cef80f3d2fa077d59e519d20ed6ae45cf5d3c05))
- **core:** Record the decisions on translation providers, lan addresses and official apis ([a5c25d4](https://github.com/kein5/VRCT-VOX/commit/a5c25d4b3332feccc8795c83538de05a0ae920d4))
- **core:** Record where secrets live and the open choices about them ([aa2a0c0](https://github.com/kein5/VRCT-VOX/commit/aa2a0c056c3e336a65d32e796556a407062141fc))
- **core:** Sort the translation providers, official apis, model consent and runtime choices ([97df00f](https://github.com/kein5/VRCT-VOX/commit/97df00f6face6b9c1c10dc9e4e8c6ed2a93191a3))
- **core:** Inventory the translation legacy and compare local translation engines ([7897223](https://github.com/kein5/VRCT-VOX/commit/7897223ac3870e7be0f3f5570a3f9e1e0ea4f62d))
- **core:** Record the readings analyzer choice and the dictionary options ([48950c2](https://github.com/kein5/VRCT-VOX/commit/48950c2f1e370fb25fcd1dde9769bf33cfdccadf))
- **core:** Record the size and start-up of a package without python ([94ec1a9](https://github.com/kein5/VRCT-VOX/commit/94ec1a9d5be12a426ed5c31568c6b60e285604fc))
- **core:** Renumber the open decisions now that every endpoint runs in the core ([19b9bfb](https://github.com/kein5/VRCT-VOX/commit/19b9bfb03fb6c4b5ac95c376d97ae7cc157bf841))
- **core:** Record the speech recognition wiring and its open choices ([69bd632](https://github.com/kein5/VRCT-VOX/commit/69bd632ca295258c2dfe05cce00b91e6c23e184c))
- **ui:** Keep the layout audit working on vanilla-extract class names ([f233610](https://github.com/kein5/VRCT-VOX/commit/f2336102ef516d5cdfbb2b3538c1578ee61b68c2))
- **site:** Drop the lilac line under the subtitle of the manual's logo ([00662c1](https://github.com/kein5/VRCT-VOX/commit/00662c1cc41186161584b5f95bce5512bec55dd1))
- **ui:** Record the main screen layout revision with before and after images ([59461b0](https://github.com/kein5/VRCT-VOX/commit/59461b0dba6ec2d9fd4989bd6cb2cfc56deadfff))
- **design:** Describe the revised main screen layout ([ac112c1](https://github.com/kein5/VRCT-VOX/commit/ac112c1b232cd3c2f09359b3587a35caaea781cd))
- **core:** Record the translation wiring and the open choices for readings ([50768c7](https://github.com/kein5/VRCT-VOX/commit/50768c7cc9742b4f2ba4bc05c4ad5b32e5ed7763))
- **core:** Say where the linux packages keep the shipped files ([47e8a93](https://github.com/kein5/VRCT-VOX/commit/47e8a932842468dc8edafa37bd8e6499b90f08c7))
- **readme:** Show the node.js version pinned in mise.toml ([bc3b956](https://github.com/kein5/VRCT-VOX/commit/bc3b9562a8af569a5bf81328a1a86f62e455c237))
- **site:** Open the ASTAROT user manual with its home page and chapter pages ([771755b](https://github.com/kein5/VRCT-VOX/commit/771755b4a113e6d70344776b0e4726cdd3adf455))
- **site:** Add the ASTAROT icon, wordmark and guide pictures for the manual ([77d40a1](https://github.com/kein5/VRCT-VOX/commit/77d40a1995d5e86a5783f68f153e8acdc3a6f1e2))
- **site:** Match the latest release to the seven files a download menu offers ([4fa6036](https://github.com/kein5/VRCT-VOX/commit/4fa6036c649d5af1b70400ce335b04c1b8cd55bf))
- **dev:** Describe the rules while the UI moves to TypeScript and vanilla-extract ([99914ac](https://github.com/kein5/VRCT-VOX/commit/99914ac1a964a5add37b3ccfee0d70b8dc9e1b5c))
- **brand:** Set the English UI in Outfit and record the plan to bundle it ([11c210e](https://github.com/kein5/VRCT-VOX/commit/11c210eec78a658f42242e026d5231c6691ecf49))
- **brand:** Set the ASTAROT wordmark and subtitle in Outfit Bold ([8d4fe70](https://github.com/kein5/VRCT-VOX/commit/8d4fe70e84e19beabab08853bf3d68db6748123d))
- **core:** List why the remaining core endpoints wait and what needs a decision ([a822dec](https://github.com/kein5/VRCT-VOX/commit/a822dec91ed9ae12c7b768e93e727cac87868231))

#### Maintenance

- **ui:** Stop the release channel error in the console at startup ([183f7f4](https://github.com/kein5/VRCT-VOX/commit/183f7f4ae72a624a71e476232abf2f0b256c7c5a))
- **ui:** Remove an unused entry template, two helpers and a text ([541e083](https://github.com/kein5/VRCT-VOX/commit/541e0839d8773e8bf64137d41b676ae656f3fe3f))
- **ui:** Drop the unused release channel texts and release list hooks ([883a293](https://github.com/kein5/VRCT-VOX/commit/883a293667b443f71e26eb80029b15449283d6ae))
- **dev:** Export translation models as float32, float16, int8 or int4 ([60da85d](https://github.com/kein5/VRCT-VOX/commit/60da85dc7d1b169c5801b8b0877673673415ca6a))
- **config:** Store experimental feature switches, every one off by default ([80edba0](https://github.com/kein5/VRCT-VOX/commit/80edba0c370d01f4d8a00c93f7d169b60ecd1cec))
- **core:** List, choose and follow the audio devices in the rust backend ([a742964](https://github.com/kein5/VRCT-VOX/commit/a742964e5339ae6542b15fe81c0dde4052ff3f11))
- **audio-routing:** Add device selection rules and the virtual microphone check ([f69f906](https://github.com/kein5/VRCT-VOX/commit/f69f90638180aba364e1ad20d4e330af78805016))
- **core:** Run the vr overlays and the vr panel in the backend core ([76f7309](https://github.com/kein5/VRCT-VOX/commit/76f73094400e57f18a450b55f83088eb9cefe6e9))
- **vr:** Add the steamvr overlay crate for the backend core ([0a05aa3](https://github.com/kein5/VRCT-VOX/commit/0a05aa3fef1362e82b15714a76d771e345430431))
- **dev:** Measure a package without the python sidecar ([53fb4bc](https://github.com/kein5/VRCT-VOX/commit/53fb4bcbcf1f9ee9365322326129ff54bb9c8bbe))
- **dev:** Build the ASTAROT wordmark, logos and brand board from Outfit Bold ([f7c43e4](https://github.com/kein5/VRCT-VOX/commit/f7c43e411e8865134ed54ffc0862b2d415132221))
- **dev:** Measure the package size and backend start-up before the core switch ([89ef820](https://github.com/kein5/VRCT-VOX/commit/89ef82034a855a0d93295f2c5057fab5f3b42cde))

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
