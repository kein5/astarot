---
route: translation
---

# Translation

Translates what you type and what speech recognition turns into text. Turn it on and off with "Translation" on the main screen, and choose the engine under "Translator". The settings are under Settings → "Translation". The engine can also be chosen under "Engine used for translation" at the top of that page; both are the same choice, made for each language preset.

What you say is translated into the "Target language" on the main screen, and what others say into "Your language".

![Settings → Translation](/screenshots/en/translation.webp)

## What you need

For local translation, choose and prepare a model. To use an external API, prepare the information required by its provider.

## Steps

### Translate on your PC

Translation runs on your PC, so your text is not sent anywhere. Open "Model and device" under "On your PC" and choose a model under "Translation model". The engine is "AI translation (local)".

The list shows the models you have downloaded, the ones you can download and the ones you added. For a model you do not have yet, press "Review download". A screen shows the source, license and size; the download starts after you agree. The [first setup](../guide/first-setup) screen can also choose and download the translation model.

- The model you have selected stays in the list even when it cannot be downloaded, marked "Not available yet".
- When no model can be downloaded and the selected one cannot be used, the page says so. To translate, use an API or a server you run under "API (cloud or your own server)".

The catalog offers the int8 versions of M2M100 418M, NLLB-200 distilled 600M and NLLB-200 distilled 1.3B. The table also lists the sizes of the other supported models.

| Model | Approximate size (int8) | License |
|---|---|---|
| M2M100 418M · int8 (default) | 506 MB | MIT (commercial use allowed) |
| M2M100 1.2B · int8 | 1.3 GB | MIT (commercial use allowed) |
| NLLB-200 distilled 600M · int8 | 643 MB | CC-BY-NC-4.0 (non-commercial) |
| NLLB-200 distilled 1.3B · int8 | 1.4 GB | CC-BY-NC-4.0 (non-commercial) |

::: warning NLLB is non-commercial
NLLB models may not be used for commercial purposes. Selecting or downloading one asks for confirmation, so you can use it only after reading and accepting its license.
:::

Some models cannot translate some languages. For example, M2M100 does not support Basque or Telugu. An unsupported language is reset with a warning so you can choose again.

"Processing device for AI translation" chooses whether translation runs on the CPU or the GPU. To translate on the GPU, download the CUDA build or the DirectML build (Windows) under "ONNX Runtime for translating on the GPU" beside it; the one that suits your GPU is marked "For your GPU". Before the download you check the source, license and size and agree. Then choose it as the processing device and restart ASTAROT. A model that cannot run on the GPU runs on the CPU.

### Use an external translation API

You can use DeepL, PLaMo, Gemini, OpenAI, Groq, OpenRouter, Google Cloud Translation and Papago Translation (NAVER Cloud Platform). Register the credentials for your service (for Papago, the client ID and client secret) under "API (cloud or your own server)", then choose it under "Engine used for translation" at the top of the page or under "Translator" on the main screen.

- The text to translate is sent to the service you choose.
- LLM engines (Gemini, OpenAI, Groq, OpenRouter, a local LLM and so on) also receive up to five recent messages of the conversation, each with the time it was said. Terms from the term dictionary that appear in the text are passed on as names.
- API keys are kept in the OS credential store (Credential Manager on Windows, the Secret Service on Linux), not in the settings file (`config.json`). On Linux, if no keyring (GNOME Keyring, KWallet and so on) is running or it is locked, a key you enter lasts only until the app closes.

Under "What the LLM engines are asked" in "More settings", you can set how much the translation varies ("Temperature") and "Additional instructions" added to the prompt (for example, "Translate without honorifics"). Both are sent to LLM engines only.

### Use local LLMs and compatible servers

You can use LM Studio, Ollama and OpenAI-compatible endpoints, marked "Server you run" under "API (cloud or your own server)". A model of your own works too once you load it into one of these servers ([Use your own models](../guide/custom-models#translation)). Check the connection with "Connection check", then choose a model. If you point the OpenAI-compatible endpoint at a non-official URL, check its pricing, security and compatibility yourself.

If you change the URL while an API key is saved, you are asked to enter the key again, so that the saved key is not sent to a different server. To switch to a server that needs no key, delete the saved key first.

### Add your own models and APIs to the translation catalog

The translation catalog is split between the two parts of Settings → "Translation". Under "On your PC", "Model catalog" adds a model you prepared with "Add a model of your own". Under "API (cloud or your own server)", "APIs you added" adds an API to translate with "Add an API" ([Use your own models](../guide/custom-models#translation)).

- A translation LLM such as TranslateGemma is added as a GGUF file and runs on llama.cpp's server (the Vulkan build). The app does not include the server; it is downloaded after you agree. Before you add the model, a check asks you to confirm Gemma's terms of use.
- Models placed in the `translation-models` folder by earlier versions are no longer listed. Add them again with "Add a model of your own".

## Check that it works

Turn on "Translation" and send a short message. Check that the translation appears in the conversation log in the target language.

## Troubleshooting

### Unavailable engines

The Google, Bing and Papago web translators are unavailable. Upstream VRCT's translator engine code is licensed for official VRCT only.

See [Troubleshooting](../guide/troubleshooting) for fixes by symptom.
