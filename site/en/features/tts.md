---
route: tts
---

# Text to speech (TTS)

Speaks your text or its translation into VRChat's microphone, through a virtual microphone. The settings are under Settings → "Text to speech (TTS)".

You can turn speech on and off separately from sending text to the chatbox.

## What you need

- A speech model, run by the [speech.cpp](https://github.com/nyosegawa/speech.cpp) servers that come with the app. Japanese is spoken with Irodori-TTS and other languages with Qwen3-TTS. Neither model comes with the app: download one, or point to a file you have ([Model downloads](../guide/models), [Use your own models](../guide/custom-models#tts)). Japanese can also come from VOICEVOX or another engine you install instead ([Read Japanese with VOICEVOX or another engine](#read-japanese-with-voicevox-or-another-engine)).
- A virtual microphone, for VRChat to hear the speech. On Windows, install a virtual cable ([Windows audio route](../guide/windows-audio)). On Linux you can use "Managed virtual microphone (Linux)" ([Linux audio route](../guide/linux-audio)).

## First steps

1. Under Settings → "Text to speech (TTS)" → "Models and servers", download a model with "Download a default model", or enter the path of a <Term tip="A file format that holds an AI model in one file. speech.cpp reads it; the file name ends in .gguf.">GGUF</Term> file you have.
2. Save with "Save changes" at the top, then press "Start server". Saving alone does not load the model.

   ![Settings → Text to speech (TTS)](/screenshots/en/tts.webp)

3. Set "Chat voice" to "Original text". To speak translations, choose "Translated text", and under "Translation slot" choose which target language's translation is spoken.
4. Under "Output device", choose where the speech plays. Try it with your own earphones first. If a device is missing, press "Refresh devices".
5. Go back to the main screen and turn on "Text to speech (TTS)". Text you send is now spoken.

Japanese and the other languages start on the bundled server. With a bundled server selected, turning it on from the main screen also starts the server. To use a server you started yourself, choose "External server" and enter its URL.

## Read Japanese with VOICEVOX or another engine

Japanese can also be read in the voices of a speech engine you install and run yourself: VOICEVOX, COEIROINK, AivisSpeech or SHAREVOX. The app does not install or start the engine.

1. Install the engine and start it.
2. Under Settings → "Text to speech (TTS)" → "Japanese TTS", choose the engine in "Engine that reads Japanese".
3. When it says "Connected", choose a voice in "Voice". If it says "Not connected", check that the engine is running and check "Engine URL", then press "Check again". The engine's default URL usually works. Only addresses on this computer (`127.0.0.1`, `localhost`, `::1`) can be used.
4. Save with "Save changes" at the top, then turn on "Text to speech (TTS)" on the main screen.

While an engine is chosen, Japanese speech uses neither the speech.cpp server nor its model. Other languages are read by speech.cpp as before.

::: warning Voice terms and credits
Each voice has its own terms of use. In videos or streams, credit the voice as its terms say (for example `VOICEVOX:ずんだもん`). COEIROINK voices need the credit "COEIROINK:voice name".
:::

## Get your voice into VRChat

Choose the virtual microphone under "Output device", and choose the same one as your microphone in VRChat.

<OsTabs>
<template v-slot:windows>

On Windows, choose "CABLE Input" as the output device and "CABLE Output" as VRChat's microphone ([Windows audio route](../guide/windows-audio)).

</template>
<template v-slot:linux>

On Linux, use "VRCT Managed Virtual Microphone" ([Linux audio route](../guide/linux-audio)).

</template>
</OsTabs>

Why a virtual microphone is needed is in [How voice and text flow](../guide/how-it-works#why-a-virtual-microphone-is-needed).

## Hear it yourself

"Hear it on my speakers" plays the same speech that goes to VRChat on your own speakers or headphones.

- What VRChat receives does not change.
- Use headphones, so your microphone does not pick up the sound from your speakers.

## Start speaking sooner (Japanese, GPU)

"Low-latency standby (Irodori GPU)" shortens the time before speech starts. It is off by default.

While nothing is being spoken, it keeps running short calculations on the GPU so that speech can start right away. That uses more power and can compete with the game for the GPU.

## Stop

There are three ways to stop, each with a different scope. "Stop speech" and "Mute" are always at the top of the main screen.

| Action | What stops |
|---|---|
| Turn off "Text to speech (TTS)" on the main screen | New speech, the speech playing now and the speech waiting its turn. Text sending, the voice changer and translation continue |
| "Stop speech" | The speech playing now and the speech waiting its turn, nothing else. "Stop speech" under Settings → "Text to speech (TTS)" does the same |
| "Mute" | Everything ASTAROT sends to VRChat (with the managed virtual microphone, both speech and the voice changer). It lasts until you unmute, and the button shows "Muted" meanwhile. Press it again to unmute. "Mute now" and "Unmute" under Settings → "Device" → "More settings" → "Audio route" do the same |

All can be assigned to [hotkeys](./quick-chat#hotkeys). After a restart, speech and the bundled servers start off.

## When it does not work

- If VRChat does not hear it, see [Troubleshooting](../guide/troubleshooting#vrchat-does-not-hear-the-speech).
- If the same text is spoken twice, turn off the other tool that reads the same chat, such as VRCT-TTS by upstream VRCT's author.
- If a model you brought does not work, see [Use your own models](../guide/custom-models#tts).
