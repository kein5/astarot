# Privacy

## Usage data

ASTAROT sends its developers two kinds of events, to fix problems and to learn which features run well on which PCs. Turn them off under Settings → "Advanced" → "Send usage data".

| Event | When | What it holds |
|---|---|---|
| The app started | Once a day | The time it was sent, the app version, the OS and its version, the display language, the PC's hardware |
| An error happened | Once a day for each kind of error | The same, and the fixed name of the kind of error (its error code) |

The PC's hardware means:

- the CPU's name and its number of logical cores
- the amount of memory, rounded to a common size such as 8, 16 or 32 GB
- for up to four GPUs: the name, whether it is integrated or discrete, the amount of video memory, and the driver version when it can be read

![The dialog that asks about usage data](/screenshots/en/telemetry-notice.webp)

You can read what is sent in the app itself. The notice shown before anything is sent (above) and Settings → "Advanced" both have "See what is sent", which lists what your PC sends field by field and also shows the data itself. Under "Advanced" you can also read what has been sent so far.

- The text and audio of conversations, the names of microphones and speakers, user names, the PC's name and file locations are never sent.
- The receiver does not keep the sender's IP address or anything that tells one PC from another. The receiver runs on Cloudflare, though, and Cloudflare receives the sender's IP address as the other end of the connection.
- The receiver records when each event arrived and the country the connection came from, which Cloudflare derives from the sender's address.
- No number that identifies a PC is sent, but an unusual combination of hardware can suggest that two events came from the same PC.
- Before anything is sent, a dialog explains what is sent. Nothing is sent until you choose "Send" or "Don't send". "Decide later" puts the dialog away, and it comes back the next time the app starts.
- Starting the app with the environment variable `VRCT_TELEMETRY` set to `off` sends nothing, whatever the setting says.

Upstream VRCT's usage reporting (Aptabase telemetry) is not used. Even when an old key file remains, nothing goes to upstream.

## What is sent outside

Turning off usage reporting does not make every feature offline. Services you choose receive what they need to work.

| Feature | Sent to | What is sent |
|---|---|---|
| Machine translation APIs (DeepL, Google Cloud, Papago) | The service you choose | The text to translate |
| LLM translation engines (OpenAI, Gemini, Groq, OpenRouter, Plamo, OpenAI-compatible, LM Studio, Ollama) | The service or server you choose | The text to translate, plus up to five recent messages: what you said in chat or into the microphone, and what the speaker transcription heard from others. Each comes with the time it was said (hours and minutes) |
| Checking translation and speech recognition engines | Services whose API key you saved | The API key and a request for the model list. At start only to the engines you have selected; to other engines when you select them. No conversation |
| Cloud speech recognition (Groq Whisper, OpenAI Whisper, Deepgram, a custom Whisper server) | The service or server you choose | The audio of each utterance |
| Model downloads | Hugging Face | The download request |
| Voice changer (RVC) runtime download | Hugging Face, NuGet (`api.nuget.org`, for ONNX Runtime) and PyPI (`files.pythonhosted.org`, for the libraries an NVIDIA GPU needs) | The download request |
| Sending to the chatbox | VRChat (OSC on your PC) | The text you send |
| VRChat integration (OSCQuery, can be turned off) | Your PC only (mDNS; nothing leaves your PC) | A notice that the app is running, named `VRCT:<start time>` with its ports. It holds no PC name or user name |
| Usage data (can be turned off) | The developers of ASTAROT (Cloudflare) | That the app started, the kind of an error, and the PC's hardware |
| Update check (at start, can be turned off) and update download | A stable version asks GitHub through the developers of ASTAROT (Cloudflare); a beta asks the GitHub API directly. The download comes from GitHub | A request for the latest version and the download. No conversation, voice or settings. Not made by deb or rpm installs |

The translation engine you choose also translates what the speaker transcription hears from others and the chat bubbles that chat reading reads.

On Windows, the component that draws the window (WebView2) connects to Microsoft's servers. This is WebView2's own traffic, not the app's: safety checks (SmartScreen) and checks for updates to its components. The app's settings cannot stop it. WebView2's crash reports (crash dumps) are not sent to Microsoft; they stay on your PC. The optional diagnostic data WebView2 collects follows Windows' Settings → "Privacy & security" → "Diagnostics & feedback" → "Diagnostic data".

Local translation models, the bundled speech.cpp servers (speech, local speech recognition and realtime captions), the voice changer (RVC) and chat reading run on your PC. The picture of a window you share for chat reading stays on your PC too.

You choose the speech recognition engine yourself the first time you turn transcription on. Audio is never sent to a service you did not choose, and the app does not switch to another engine on its own when a Local (speech.cpp) model is missing.

When you change the URL of an OpenAI-compatible endpoint or Custom Whisper, you enter the API key again. A saved key is never sent to the new URL on its own.

## What is stored on your PC

- The settings file (`config.json`), which holds the key for the OBS browser source and WebSocket and, on Linux, what the desktop needs to share the same window again without its dialog.
- API keys for translation and speech recognition, which are kept in the operating system's credential store instead of the settings file: Credential Manager on Windows, the Secret Service (GNOME Keyring, KWallet and others) on Linux. Up to 0.5.2 the keys were kept in `secrets.json` in the same folder as the settings file (on Windows, encrypted so that only the signed-in user can read them back); the first start after updating moves them to the credential store.
- Logs, recording what the app did. Remove personal data and conversation text before posting them in a report.
- Conversation logs, saved as text files only when "Auto save message logs" under Settings → "Advanced" is on.

For the locations, see [Install](./install) and [Troubleshooting](./troubleshooting).

## Servers that run on your PC

The OBS browser source and WebSocket run only when you turn them on, and by default can be reached only from your PC (`127.0.0.1`). Connecting needs the key in the URL (see [OBS and WebSocket](../features/integrations)).
