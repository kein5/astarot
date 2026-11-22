---
route: translation
---

# Translation

Translates what you type and what speech recognition turns into text. Turn it on and off with "Translation" on the main screen, and choose the engine under "Translator". The settings are under Settings → "Translation".

What you say is translated into the "Target language" on the main screen, and what others say into "Your language".

![Settings → Translation](/screenshots/en/translation.webp)

## Translate on your PC

Translation runs on your PC, so your text is not sent anywhere. Open "Model and device" under "AI translation (local)" and choose a model under "Translation model".

The list shows the models you have downloaded, the ones you can download and the ones you added. For a model you do not have yet, press "Review download". A screen shows the source, license and size; the download starts after you agree.

- The model you have selected stays in the list even when it cannot be downloaded, marked "Not available yet".
- When no model can be downloaded and the selected one cannot be used, the page says so. To translate, use an external translation API or a local LLM under "More settings".

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

"Processing device for AI translation" chooses whether translation runs on the CPU or the GPU.

## Use an external translation API

You can use DeepL, PLaMo, Gemini, OpenAI, Groq, OpenRouter, Google Cloud Translation and Papago Translation (NAVER Cloud Platform). Register the credentials for your service (for Papago, the client ID and client secret), then choose it under "Translator" on the main screen.

- The text to translate is sent to the service you choose.
- API keys are stored in the settings file on your PC (`config.json`).

## Use local LLMs and compatible servers

You can use LM Studio, Ollama and OpenAI-compatible endpoints. Check the connection with "Connection check", then choose a model. If you point the OpenAI-compatible endpoint at a non-official URL, check its pricing, security and compatibility yourself.

If you change the URL while an API key is saved, you are asked to enter the key again, so that the saved key is not sent to a different server. To switch to a server that needs no key, delete the saved key first.

## Unavailable engines

The Google, Bing and Papago web translators are unavailable. Upstream VRCT's translator engine code is licensed for official VRCT only.
