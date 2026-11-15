---
route: voice-conversion
---

# Voice changer (RVC)

Changes your microphone's voice into another voice and gets it to VRChat through a virtual microphone. RVC conversion is part of VRCT-VOX; the libraries it runs on and its base models are fetched separately as its runtime. RVC converts on an NVIDIA GPU, and on the CPU on a PC whose GPU cannot be used. The settings are under Settings → "Voice changer (RVC)".

It is experimental. Before relying on it, check in your own setup how it sounds and how long the changed voice takes to come through.

## What you need

- To run RVC on the GPU, an NVIDIA GeForce GTX 16 or RTX 20 series GPU or later and driver 580 or later. Without one RVC runs on the CPU, with a longer delay (see "How far behind the voice is" below)
- A virtual microphone that carries the changed voice to VRChat ([How voice and text flow](../guide/how-it-works#why-a-virtual-microphone-is-needed))
- For RVC:
  - an RVC runtime (ONNX Runtime, and on a PC with an NVIDIA driver also the CUDA 13 and cuDNN libraries)
  - HuBERT and RMVPE (models RVC uses to read what is said and the pitch)
  - a trained model you are allowed to use (`.pth`) and, if needed, its retrieval index (`.index`)

Models you trained or bought work too ([Use your own models](../guide/custom-models#rvc)).

## Set up RVC

The settings page can fetch the runtime, HuBERT and RMVPE.

1. Open "Models and runtime" near the bottom of Settings → "Voice changer (RVC)".
2. Under "RVC runtime", press "Review download". Check the license, size and destination, and agree. Nothing is downloaded before you agree.
3. When it finishes, press "Use this runtime" and save.

The runtime that is fetched depends on whether the PC has an NVIDIA driver.

| | PC with an NVIDIA driver (GPU runtime) | Without one (CPU runtime) |
|---|---|---|
| Download, about | 1.8 GB on Windows, 1.9 GB on Linux | 0.6 GB on Windows and Linux |
| Free disk space needed, about | 2.7 GB on Windows, 3.3 GB on Linux | 0.8 GB |

The GPU runtime also converts on the CPU when the GPU cannot be used (a driver older than 580, or a GTX 10 series GPU or older). The setup says so when it finishes. [System requirements](../guide/requirements#rvc-on-an-nvidia-gpu) lists the GPUs and how to check the driver.

An RVC runtime fetched by an earlier version (the kind that uses PyTorch) can no longer be used. If the page says "The runtime in this folder is of an earlier kind and can no longer be used", fetch it again the same way. It goes into the same folder, so your saved settings keep working. When it finishes, the files of the earlier kind (`venv`, `python`, `engine`, `rmvpe.pt` and so on) are deleted automatically. Only what the earlier setup put there is deleted; models (`.pth`, `.index` and the like) and audio files you put in `engine` are kept.

### How far behind the voice is

The converted voice comes a little after your own. On the PC this was measured on:

| Converting on | Delay, about |
|---|---|
| An NVIDIA GPU | 0.2 s |
| The CPU | 1.3 s |

Once conversion starts, the settings page shows where it converts and the delay. On the CPU the voice is converted half a second at a time, which makes the delay longer, and it uses a lot of the CPU, so other apps may slow down. If the CPU cannot keep up, conversion stops with "Conversion could not keep up" instead of passing on a broken voice.

As a default model, you can get Saisho Utane's RVC v2 model (CC BY 4.0, about 0.31 GiB) with "Download a default model". Credit the author when you use it in published work or streams.

## Change your voice with RVC

1. Enter "RVC runtime folder" and "Permitted RVC model (.pth)", and save.

   ![Settings → Voice changer (RVC)](/screenshots/en/rvc.webp)

2. Set up a virtual microphone that carries the changed voice to VRChat.

   <OsTabs>
   <template v-slot:windows>

   On Windows, install a virtual cable such as VB-CABLE. Choose its playback end ("CABLE Input") as "Output device" under Settings → "Text to speech (TTS)", and its recording end ("CABLE Output") as VRChat's microphone ([Windows audio route](../guide/windows-audio)).

   If you have no cable yet, or want to check that it works, press "Check the virtual microphone" under Settings → "Text to speech (TTS)". It shows how to install one and checks the cable with a test sound.

   </template>
   <template v-slot:linux>

   On Linux, press "Prepare and use virtual microphone". When it is ready, press "Resume voice". In VRChat, choose "VRCT Managed Virtual Microphone" as your microphone.

   </template>
   </OsTabs>

3. Under "Input to forward", choose the microphone you speak into. It starts as the "Mic" chosen under "Device".
4. Turn on "Voice changer (RVC)" on the main screen.

## About Seed-VC {#seed-vc}

Seed-VC was removed in 0.4.0, and RVC is now the only voice changer. Changing your voice toward a reference WAV is no longer possible. A Seed-VC runtime fetched by an earlier version is not used by 0.4.0.

## Speak in your changed voice

Set "Speak through voice conversion" under Settings → "Text to speech (TTS)" to On. While the voice changer runs, the speech voice is changed by the voice changer too, before it reaches the virtual microphone.

Together with speaking the translation of what you say ("Speak final translations"), others hear the translation in your changed voice.

- While speech plays, the voice changer changes the speech instead of your microphone, and goes back to your microphone when it ends. It cannot change both at once, so this does not work together with mixing direct input and speech.
- With "Suppress direct input" chosen, your microphone is not heard and only the changed speech is.
- When the voice changer is not running, speech plays in its own voice, unchanged.
- Others hear the speech a little later, because changing the voice takes time.

## Hear the changed voice yourself

Turn on "Hear it on my speakers" under "Text to speech (TTS)".

## Stop

Turn off "Voice changer (RVC)" on the main screen. "Mute" stops both speech and the voice changer ([how to stop text to speech](./tts#stop)).

## Before you use it

Using someone else's voice as a model needs their permission. For a model you bought, also check the provider's terms ([Models you bought or found published](../guide/custom-models#bought-models)).

## When it does not work

If it cannot start, the main screen says why. For a problem with a model's format or location, see the table in [Use your own models](../guide/custom-models#rvc).
