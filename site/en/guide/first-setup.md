# First setup

This page sets up translating text and sending it to the VRChat chatbox. Set up speech or captions afterwards, following the page for each feature.

![The ASTAROT main screen with Translation on and a conversation in the log](/screenshots/en/main.webp)

The switches and languages are on the left, the conversation log is on the right, and the message box is at the bottom.

<StepProgress />

## 1. Choose whether to send usage data

On the first start, a screen asks whether to send usage data. Choose "Send", "Don't send" or "Decide later". The app works the same whichever you choose. [Privacy](./privacy) lists what is sent.

## 2. Turn on OSC in VRChat

ASTAROT sends text to the VRChat chatbox over OSC. In VRChat, open the Action Menu, go to "Options" → "OSC" and choose "Enabled".

"Quick settings" at the top right of the main screen says whether a VRChat with OSC enabled was found on this PC. The top of Settings → "VRChat" says the same.

!["Quick settings" open, saying that VRChat was found](/screenshots/en/quick-settings.webp)

By default ASTAROT sends to <CopyText>127.0.0.1</CopyText> on port <CopyText>9000</CopyText>, which is also VRChat's default, so you usually don't need to change it. To change it, use "OSC" under Settings → "Advanced".

## 3. Choose your languages

In "Language settings" on the left of the main screen, choose:

- "Your language" is the language you speak or type.
- "Target language" is the language to translate into. You can choose up to three.

## 4. Turn on Translation and send

Turn on "Translation" on the left of the main screen. If the translation model has not been downloaded, a review of what will be downloaded opens. Check the provider, license and size and agree; the download starts, and Translation turns on when it finishes.

Type in the box at the bottom and send. The original and its translation appear in the log, and the same text appears in the VRChat chatbox.

::: tip Without a local model
Choose an external translation API under Settings → "Translation" → "More settings". See [Translation](../features/translation).
:::

Models you have not downloaded yet are also listed under "Before you start", which the main screen shows while the conversation log is empty.

## 5. Choose your microphone and speaker

Do this before you use a voice feature (captions, text to speech, the voice changer). Open the settings with the gear at the bottom left of the main screen, then open "Device".

- "Mic" is the microphone that picks up your voice. On Linux it lists PipeWire inputs.
- "Speaker" is the output device ASTAROT listens to when it turns other players' voices into text.

"Auto select" uses the device set as the default in your OS.

## 6. Show the features you use

At the top of the settings menu, "Used for" lets you choose how you use ASTAROT. The main screen's switches and the settings menu then show only the features those uses need.

| Use | What it is for |
|---|---|
| Basic | Your voice, recognized and translated, to the captions and the chatbox. A new install starts here |
| Nonverbal | Talk in text without speaking; read others' voices and chat |
| Multilingual conversation | Talk by voice with people of several languages |
| Voice changer (RVC) | Talk in a changed voice, with or without translation |
| Everything | Every feature and page. An update from an earlier version starts here |

- Pick as many as you like. What any of them needs is shown.
- Changing the uses turns no feature on or off and changes no setting. The switch of a feature that is on is shown whatever you pick.
- "Other features" under the switches shows the hidden ones. The settings search still finds hidden pages.
- Each settings page starts with what you need first. What you set once is under the page's "More settings".

The names of the uses may change after we hear from people who tried them.

## Next

- For everything else it can do: [Find what you want to do](./tasks)
- To speak your translations: [Text to speech (TTS)](../features/tts)
- To turn speech into text: [Speech recognition (ASR) and realtime captions](../features/transcription)
- To read other people's chatboxes: [Chat reading (OCR)](../features/chat-reading)
