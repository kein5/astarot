---
route: transcription
---

# Speech recognition (ASR) and realtime captions

Turns your voice and other players' voices into text. The settings are under Settings → "Speech recognition (ASR)".

What you and others say appears as text in the conversation log on the main screen. If the VR subtitle overlay shows multiple lines, it appears there too.

## What you need

The speech recognition (ASR) server that comes with the app (speech.cpp) needs two models:

- a recognition model, which turns speech into text
- Silero VAD, which finds where someone is speaking

Neither comes with the app: download them, or point to files you have ([Model downloads](../guide/models), [Use your own models](../guide/custom-models#asr)).

| Model | Languages | Size | License |
|---|---|---|---|
| Qwen3-ASR 0.6B / 1.7B | 30 languages, detects the language | 0.78 / 2.03 GiB | Apache-2.0 |
| ReazonSpeech v2 | Japanese only | 0.62 GiB | Apache-2.0 |
| Parakeet TDT-CTC 0.6B ja | Japanese only | 0.62 GiB | CC BY 4.0 |
| Parakeet TDT 0.6B v3 | 25 European languages, detects the language (no Japanese) | 1.17 GiB | CC BY 4.0 |
| Haas-ja v1.0 | Japanese only | 0.61 GiB | Apache-2.0 |
| Nemotron 3.5 Transcribe 30B-A4B | 40 languages (a large model) | 17.69 GiB | OpenMDW-1.1 |
| Silero VAD v6.2 · F32 | (finds where speech starts and ends) | about 1.2 MB | MIT |

The sizes are those of the file speech.cpp fetches by default. Each recognition model also comes in other file types (quantizations), which you choose when you download it ([Downloading models](../guide/models)).

The bundled server uses one recognition model for both microphone captions and game audio captions.

- If you talk with people who don't speak Japanese, choose Qwen3-ASR.
- "Detect automatically (auto)" needs a model that can detect the language, such as Qwen3-ASR.

## First steps

1. Open "Models and servers" near the bottom of Settings → "Speech recognition (ASR)", and download a recognition model and Silero VAD under "ASR + VAD".

   ![The "ASR + VAD" section of "Models and servers" in Settings → Speech recognition (ASR)](/screenshots/en/asr-models.webp)

2. Under "Realtime captions", choose which sound to turn into text.
   - "Microphone captions" transcribe what you say into your microphone.
   - "Game audio captions" transcribe other players' voices as you hear them in VRChat. Choose an output device that plays only VRChat's sound. If other apps play through the same output, their sound is transcribed too.

   ![Settings → Speech recognition (ASR)](/screenshots/en/transcription.webp)

3. On the main screen, the "Mic input" switch starts and stops microphone captions, and the "Listening" switch does the same for game audio captions. If you chose the bundled server, turning a switch on also starts the server. On Windows these switches run realtime captions while "Local (speech.cpp)" is the engine chosen under "Transcription Engine Used For Speech Recognition" ([Choose the speech recognition engine](#engines)).

After a restart, captions start off.

::: info Other players' words are not sent to VRChat
What VRCT-VOX transcribes from game audio is never sent to your chatbox or played into your microphone.
:::

## Tell speakers apart

Game audio captions can show who is speaking. VRCT-VOX tells the voices apart and marks them "Speaker A", "Speaker B" and so on.

To use it, download and apply the diarization model under "Models and servers" → "ASR + VAD". This is the model that tells speakers apart (Nemotron 3 Diarization, about 106 MB, OpenMDW-1.1). It is used from the next time the server starts. To stop using it, clear "Diarization GGUF path (optional)".

- The conversation log shows "Speaker A". In the desktop caption overlay, a letter comes before the words and each person gets their own colour.
- Speakers are told apart by the sound of their voices, so their names are not known. People with similar voices can be taken for one person.
- When two people speak with little pause, their words end up in one caption. It then shows both, as "Speaker A, B".
- Each time you turn on "Listening", the letters are handed out again, so "Speaker A" may not be the same person as last time.
- Each caption takes about 0.3 seconds longer to be finalized (measured on an RTX 3060 Ti).
- A GPU is needed. A CPU alone cannot keep up, so while the server runs on the CPU, speakers are not told apart even with the model.
- Microphone captions do not tell speakers apart.

## Add words to recognize

Under "Term dictionary", add words you want recognized and how to write them. Common VRChat terms are built in.

## Paste what you say into an input field

With "Voice typing mode" on under Settings → "VR", what you say is transcribed and pasted into an input field in VRChat or another app. The paste goes through the clipboard.

- While SteamVR is running, it brings the window of the app SteamVR is running (VRChat, for example) to the front and pastes there.
- When SteamVR is not running, the text is only copied to the clipboard.

On Linux it pastes into apps that run as X11/XWayland windows, such as VRChat under Proton. On KDE, the desktop asks once whether VRCT-VOX may control input devices when it first pastes. It cannot paste into a native Wayland window; the text is copied to the clipboard only.

## Choose the speech recognition engine (Windows) {#engines}

On Windows, the speech recognition used by the main screen's "Mic input" and "Listening" switches is chosen under Settings → "Speech recognition (ASR)" → "Transcription Engine Used For Speech Recognition". If you turn transcription on before choosing an engine, a "Choose speech recognition" screen opens.

- With "Local (speech.cpp)", audio is turned into text by a speech.cpp server on this PC, and the switches run realtime captions. It needs a recognition model and Silero VAD ([What you need](#what-you-need)).
- With "Google", your microphone or speaker audio is sent to Google's speech service to be turned into text. No API key is needed.
- Groq Whisper, OpenAI Whisper, Custom Whisper server and Deepgram can be chosen once you register an API key under "Cloud speech recognition". A Whisper server of your own works too ([Use your own models](../guide/custom-models#whisper-server)).

The app never switches from the engine you chose to another one on its own. Switching between "Local (speech.cpp)" and another engine turns "Mic input" and "Listening" off if they were on. Turn them on again to start with the new engine.

Local (speech.cpp) transcribes the languages its recognition model supports (30 languages with Qwen3-ASR, Japanese only with Haas-ja, ReazonSpeech and Parakeet ja). For other languages, use Google or a cloud engine.

On Linux, "Mic input" and "Listening" always run realtime captions, whatever engine is chosen.

## If you used Whisper in an earlier version {#whisper}

The Whisper that ran inside the app is gone. Speech is now turned into text on this PC by "Local (speech.cpp)". The cloud Whisper engines (Groq Whisper, OpenAI Whisper, Custom Whisper server) work as before.

- If Whisper was your engine under "Transcription Engine Used For Speech Recognition", the first start after the update switches it to "Local (speech.cpp)". On Windows, "ASR server" under "Realtime captions" also becomes "Bundled server".
- The main screen then shows the notice "Local speech recognition now uses speech.cpp", once. It shows whether the two models it needs (a speech recognition model and a VAD model) are set, with a button "Open Speech recognition (ASR) settings". The notice never downloads a model. Models are downloaded only after you check their license and size under "Models and servers" and agree.
- The Whisper model type, the recognition thresholds and the processing device settings are gone.

Whisper models downloaded by an earlier version are no longer used. While any remain on the PC, "Old Whisper models" appears at the bottom of Settings → "Speech recognition (ASR)" with the space they take. Press "Delete old Whisper models", then "Delete" in the confirmation, to remove them. This cannot be undone. Only the folders an earlier version made for Whisper models are removed; other files stay. The notice has the same delete button.

::: details What was checked
Telling speakers apart was checked on Windows 11 with conversations of two to six synthetic voices, not with human voices. The results are in the developers' [record](https://github.com/kein5/VRCT-VOX/blob/develop/docs/voice-stack/speaker-diarization-2026-11-13.md) (in Japanese).
:::
