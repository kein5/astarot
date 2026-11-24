# Paths to using TranslateGemma for translation (2026-11-18)

[日本語版](#translategemma-を翻訳に使う道筋2026-11-18日本語版)

Researched on 2026-11-18. Status: **proposal**. This is input for Issue #412, and the maintainers decide. Code, the model catalog and displayed text are not changed.

> **Decision note** (2026-11-19): The maintainers decided that the execution path is an LLM runtime (in the form of (a) or (b) below), handled as an exception to ADR-012. Handling consent to the terms of the gated weights is also in scope for the implementation. The proposal under "Recommendation" below to add (d) first was not adopted. The exception is recorded in [ADR-015](../adr/adr-015-translation-llm-runtime-exception.md). The body has not been rewritten.

This document compares the paths for using TranslateGemma for translation in the app and the ways to obtain its weights. The points to decide are listed under "Decisions to make". All sources were viewed on that date, and no model files were downloaded. Only the information returned by the Hugging Face API and the Ollama registry API, and small text files (model cards, chat templates, configuration and terms), were read.

## Purpose

Add TranslateGemma, Google's LLM for translation, to the translation catalog with notes (#412). The catalog's framework came in with #413 ([model downloads](model-downloads.md#翻訳のカタログ413)). This is handled separately from adding NLLB-200 and MADLAD-400 (#411).

## Facts

### The model

- It is a model trained for translation on top of Gemma 3, in 4B, 12B and 27B sizes. The model card's scope is translation across 55 languages.
- Input is text and images, with an input context of up to 2K tokens in total. Output is the translation only.
- The model card's evaluation (WMT24++, 55 languages) is below. Lower MetricX is better, and higher COMET is better.

  | | 4B | 12B | 27B |
  |---|---:|---:|---:|
  | MetricX | 5.32 | 3.60 | 3.09 |
  | COMET | 81.6 | 83.5 | 84.4 |

- The architecture is decoder-only. M2M100 and NLLB-200, which `native/translate-onnx` reads, are encoder-decoder models, so the current runtime code cannot run it (`ARCHITECTURES` in `bundle.rs`).

### Official weights (Hugging Face)

| Repository | revision | Contents | Weight size |
|---|---|---|---|
| [google/translategemma-4b-it](https://huggingface.co/google/translategemma-4b-it/tree/10042cb0e6e7fdce748996a71dc3dc432a4e0c89) | `10042cb0e6e7fdce748996a71dc3dc432a4e0c89` | safetensors in 2 shards | 8,600,277,880 bytes |
| [google/translategemma-12b-it](https://huggingface.co/google/translategemma-12b-it/tree/d1b225e1caa17f1ddc7e62065d8637d0923f34e2) | `d1b225e1caa17f1ddc7e62065d8637d0923f34e2` | safetensors in 5 shards | 24,374,793,024 bytes |
| [google/translategemma-27b-it](https://huggingface.co/google/translategemma-27b-it/tree/7d10f0b72f89a2d0f268cea30727d8b77c0d25c2) | `7d10f0b72f89a2d0f268cea30727d8b77c0d25c2` | safetensors in 12 shards | 54,864,980,440 bytes |

- All three are gated (`gated: manual` in the API), and the license shown is `gemma`. Downloading them requires signing in to Hugging Face and accepting the terms on the model page. When the API is read without signing in, the files' SHA-256 values are hidden. Requesting `config.json` or other files without signing in returns 401.
- The weights are 16-bit and include the part that reads images (`Gemma3ForConditionalGeneration`). Neither ONNX nor GGUF files are provided.
- The model card also points to pages on Kaggle and in Vertex AI Model Garden.

### Third-party conversions

- [onnx-community/translategemma-text-4b-it-ONNX](https://huggingface.co/onnx-community/translategemma-text-4b-it-ONNX/tree/f7874a1ac60758872a4f78aac0df95b17b776994) @ `f7874a1ac60758872a4f78aac0df95b17b776994`. It takes 4B without the image part and converts only the text part (`Gemma3ForCausalLM`) to ONNX. It is not gated. It has no license shown, no README and no copy of the terms. Its `config.json` has settings for Transformers.js and the KV cache types.

  | Form | Files | Total |
  |---|---|---:|
  | q4 | `model_q4.onnx`, `_data` and `_data_1` | 3,091,548,551 bytes |
  | q4f16 | `model_q4f16.onnx`, `_data` and `_data_1` | 2,714,995,011 bytes |
  | int8 | `model_quantized.onnx` and `_data` to `_data_2` | 5,427,753,133 bytes |
  | fp16 | `model_fp16.onnx` and `_data` to `_data_3` | 7,895,984,938 bytes |
  | fp32 | `model.onnx` and `_data` to `_data_7` | 15,789,835,573 bytes |

  `chat_template.jinja` is the same file as the official one (the git blobs match at `d571968f9770221512d29627697012202451983c`). `tokenizer.json` differs in size from the official one: 20,323,013 bytes against 33,384,570 bytes. The graph files were not downloaded, so the input and output names and the operators have not been checked.
- Among the top 100 results for "translategemma" on Hugging Face (by downloads), none is gated except Google's three. Most are GGUF, the form that llama.cpp-family runtimes run. Few include a copy of the terms. For example, `bullerwins/translategemma-4b-it-GGUF` and `mradermacher/translategemma-4b-it-GGUF` have none, and `Menterium/translategemma-4b-it-GGUF` has `GEMMA_TERMS_OF_USE.txt` and `NOTICE`. All three embed the official chat template in the GGUF (`gguf.chat_template` in the API).
- The Ollama library also has `translategemma` (registry manifest). The model layer is 3,298,866,368 bytes for 4b, 8,109,818,272 bytes for 12b and 17,358,640,928 bytes for 27b. The license layer is the Gemma Terms of Use (2024-02-21 version). The figure in the issue, "about 3.3GB for 4B", corresponds to this value.

### Prompt format

The official `chat_template.jinja` specifies the following.

- The only roles are user and assistant. The template raises an exception if the first message is not from user, and also for the system role.
- The user `content` is a list with one element, and that element holds `type` (`text` or `image`), `source_lang_code`, `target_lang_code` and `text`. A string `content` raises an exception.
- Language codes are ISO 639-1 (`ja`) or a code with a region (`en-GB`, `zh-Hant`). The template's table has 581 codes and 161 language names. A code not in the table raises an exception. A language in the table is not necessarily one of the 55 evaluated languages.
- The text the template builds is "You are a professional {source language} ({code}) to {target language} ({code}) translator. …Please translate the following {source language} text into {target language}:", followed by two blank lines and the source text. There is no place for conversation context.
- The model card's example generates with `do_sample=False` (greedy decoding). The end tokens in `generation_config.json` are 1 and 106 (`<end_of_turn>`).

### Terms of use

- The weights and what is made from them (Model Derivatives) are under the Gemma Terms of Use. The text as of 2026-11-18 is the 2026-04-01 version, and its appendix lists TranslateGemma. The Prohibited Use Policy is the 2024-02-21 version and is part of the terms through section 3.2. The terms' URL moved from `ai.google.dev/gemma/terms` to `gemma.ai/resources/terms/` (redirected with a 301).
- Section 3.1 sets four conditions on redistribution.
  1. Include the use restrictions of section 3.2 as an enforceable provision in the agreement that governs use or distribution (such as terms of use). Tell recipients that the restrictions exist.
  2. Give every recipient a copy of these terms.
  3. Mark modified files prominently as modified.
  4. Include a `Notice` text file with the fixed sentence ("Gemma is provided under and subject to the Gemma Terms of Use found at …"). In the text as of 2026-11-18, this URL is `gemma.ai/resources/terms`. The copy in the Irodori-TTS v4 Large repository, of the version with the same date, still has `ai.google.dev/gemma/terms`.
- Under section 3.2, Google can restrict use that it believes violates the terms. The Prohibited Use Policy forbids infringing rights, dangerous or illegal activity, deceptive content, generating sexual content and more. These restrictions apply to the people who use the model as well as to those who distribute it.
- Google claims no rights in the output, that is the translations (section 3.3).

### How the app works now

- The translation catalog's inference-engine group accepts only `onnx` as `runtime`, and its API group accepts only `openai_compatible` as `protocol` (`native/ops/src/downloads/translation_catalog.rs`).
- Model downloads only fetch over HTTPS from fixed Hugging Face hosts and attach no user credentials (top of `native/ops/src/downloads/transport.rs`). The catalog's `Model` has no field that marks a gate.
- LLM translation (OpenAI, OpenAI-compatible, LM Studio, Ollama and others) sends the translation instructions in the system role and the source text in the user role (`native/translation/src/providers/chat.rs`, `ollama.rs`). The instructions contain the list of supported language names, the English names of the source and target languages (such as `Japanese`) and the last 5 messages as conversation context (`prompt.rs`). Generation settings such as temperature are not sent (Ollama gets an empty `options`).
- API keys are kept in the OS credential store ([ADR-013](../adr/adr-013-secret-store.md), [where API keys are stored](../spec/data-and-persistence.md#apiキーの保存先)).

## Comparing execution paths

[ADR-012](../adr/adr-012-audio-ai-runtime-consolidation.md) places local translation inference on ONNX Runtime (2.2). Adding an ONNX translation model is outside the exception procedure, but the model has to run on the existing ONNX Runtime (2.5). Adding a new runtime requires an exception ADR (2.4).

| Path | Relation to ADR-012 | What the app carries | Recommendation |
|---|---|---|---|
| (a) ONNX Runtime GenAI | A new inference library. Needs an exception ADR | The GenAI library and models in its format | Do not adopt |
| (b) Bundle a GGUF runtime (llama.cpp) in the app | A new runtime. Section 3 rejected moving translation to GGML | llama.cpp and GGUF | Do not adopt |
| (c) Add decoder-only generation to `native/translate-onnx` | Allowed, because it runs on the existing ONNX Runtime as 2.5 requires | Generation code, ONNX models | Candidate for the next stage (depends on measurements) |
| (d) Connect to the user's server (Ollama, LM Studio, llama.cpp's server) through the API group | Adds no runtime. A connection to "external translation services and LLM services" under 2.2 | The prompt format only | Add first |

### (a) Use ONNX Runtime GenAI

ONNX Runtime GenAI is a Microsoft library that handles LLM generation on top of ONNX Runtime. It can take over the generation loop and the management of the KV cache. However, it has its own native library and its own model format (a folder with `genai_config.json`). Using it from Rust requires binding to its C API. For the app it is a new inference library and needs an exception ADR under 2.4 of ADR-012. So far no technical reason has been found why the existing base (calling ONNX Runtime directly through `ort`) cannot do the same job. (c) is expected to achieve the same, so this path is not adopted.

### (b) Bundle a GGUF runtime (llama.cpp) in the app

There are many ungated GGUF conversions, in many quantization types. Even so, llama.cpp would add a new runtime to the app. ADR-012 rejected aligning translation on GGML (section 3). It also makes having the bundled speech.cpp handle translation a non-goal (section 5). This path is not adopted.

### (c) Add decoder-only generation to `native/translate-onnx`

Of the four paths compared, this is the only one that runs TranslateGemma inside the app within the scope of ADR-012. The work needed is as follows.

1. ONNX graph: prepare a decoder-only graph that takes and returns the KV cache. Either use the onnx-community conversion, or add an export to `tools/translation_onnx` and build the graph from the official weights. In the latter case, check that the output matches the original model (transformers), as with MADLAD-400 in #411. If the onnx-community graph is used, check its input and output names, its operators (such as `MatMulNBits`) and whether ONNX Runtime 1.31 can load it.
2. Shapes: `config.json` gives 34 layers, 8 attention heads, 4 KV heads, a head dimension of 256 and a vocabulary of 262,208. The KV cache takes 139,264 bytes per token in fp16 (2 × 34 × 4 × 256 × 2). Even at the input limit of 2K tokens, it is estimated at about 285 MB (not measured). One translation input is short, so most of the memory goes to the weights.
3. Tokenizer: read Gemma's `tokenizer.json` with `tokenizers`, and check that the IDs and the decoded output match the official tokenizer. The onnx-community `tokenizer.json` differs in size from the official one, so using it as is needs a comparison.
4. Prompt: build the official template's text in Rust. The template text is only fixed English sentences and a table of language names, so no Jinja engine is needed. A table from the app's language names to ISO codes is also needed (`Chinese Simplified` to `zh-Hans`, `Chinese Traditional` to `zh-Hant` and so on).
5. Generation: generate greedily and stop at token 1 or 106. The current `beam.rs` follows CTranslate2's rules for encoder-decoder models and cannot be used as is. Set the input and output limits again (now 1024 and 256).
6. Manifest: add a new `family` (for example `gemma3`). The current manifest requires encoder-decoder fields such as `encoder`, `decoder` and `decoder_layers`, so split the schema. There are several external data files, so let the catalog hold more than one `data` role.
7. Core: add the model to `family_of`, `weight_of_catalog_id`, `languages::TRANSLATION_WEIGHTS`, the language table and the translation catalog's `RUNTIMES`.
8. Catalog: translation entries go in `native/ops/data/translation_models.json`, written by `tools/translation_onnx/publish.py catalog --write` against the files of the published revision (#277). Pin the revision, each file's size and SHA-256 and the license links (the terms, the Prohibited Use Policy, `NOTICE`), and raise `CATALOG_VERSION`. In the current data format, a translation entry's `notice` is fixed to `translation`, so showing a note about the terms needs a `notice` per entry. Record the model in `NOTICE.md` and the [license register](licensing.md). Do not make it the default.
9. Hardware guidance: translation entries currently have no guidance figures (`guidance.rs`). Add measured values, and make the entry subject to the insufficient-performance warning (#405).
10. Measurement: run 4B in int4 and int8 on the CPU, DirectML and others, and measure the load time, the peak memory and VRAM, and the time per utterance. Values with VRChat, speech recognition and TTS running at the same time are also needed (2.6 of ADR-012). Measure on both Windows and Linux (2.7). The table in `native/translate-onnx/README.md` also lists int4 behavior per execution provider as "not verified".

Even 4B in int4 has about 3 GB of weights. That is about 6 times M2M100 418M in int8 (about 506 MB), and its speed on a CPU is unknown until measured. It is better not to proceed to implementation until measurements show a speed usable in conversation.

### (d) Connect to the user's server

The user installs the model in Ollama, LM Studio, llama.cpp's server or similar, and the app connects to it as an API entry. The app carries neither the runtime nor the weights, and downloads nothing. 12B or 27B can also run on another PC.

**Current state**: a server running TranslateGemma can be selected through an API entry in the translation catalog (`openai_compatible`) or through the Ollama and LM Studio engines. However, the format the app sends does not match TranslateGemma's format.

- On a server that applies the official template as is, the system role and a string `content` raise exceptions, if the server does what the template says. All three GGUF conversions examined embed this template.
- The `translategemma` in the Ollama library uses its own template, not Jinja. This template lists both the system text and the user text as user turns. The app's instructions (including the conversation context) and the source text become two user turns. That raises no exception, but it differs from the format the model was trained on. The model may translate the conversation context as well, or answer the instructions. The only generation settings are `top_k` 64 and `top_p` 0.95, with no temperature set, so the server samples at its default temperature.
- How each server actually responds (whether it returns an exception or switches to another template) and the translation quality have not been checked. Checking them needs a model download.

**What is needed**: let an API entry select a "TranslateGemma prompt".

- Send no system role and only one user turn.
- Pass languages as ISO codes, not names.
- There are two possible formats to send. (1) Keep the official template's format, with `content` as a one-element list of `{type, source_lang_code, target_lang_code, text}`. (2) Send the English text the template builds, together with the source text, as a string `content`. (1) is for servers that apply the Jinja template, and (2) is for servers such as Ollama that use their own template. In the OpenAI Chat Completions format, a text element has only `type` and `text`, so a server may drop the other keys. Which format works on which server is decided by testing the real servers.
- Do not send the conversation context. This behaves differently from the other LLM translation, so say so on screen.
- Send temperature 0, to come close to the greedy decoding of the official example.
- The code goes in `native/translation` (`prompt.rs` and each provider) and in the translation catalog's `PROTOCOLS` or an entry field. Add cases to the translation providers' contract tests (`native/translation/tests/contract/`).

## Obtaining the weights, and tokens

Obtaining the weights matters only if path (c), running the model inside the app, is adopted. In (d) the app downloads nothing.

### (1) Download the official gated weights with the user's token

The user accepts the terms with their Hugging Face account and gives the app a read token. A design would take this form.

- Keep the token in the OS credential store, like API keys (add one item to `SECRET_SETTINGS`). Do not write it in plain text to `config.json` or `secrets.json`.
- Send it only with requests to `huggingface.co` when downloading a gated entry. Do not send it to the CDN that the request is redirected to (such as `cas-bridge.xethub.hf.co`). This changes the current download guarantee (no credentials attached), so rewrite the guarantee and the tests in `transport.rs`.
- Do not show it in logs, in errors or in the IPC records in `process.log`. Provide a way to delete it.
- The consent screen links to the model page. The user accepts the terms with their account, and the app cannot accept them on the user's behalf. Report an invalid token (401) and terms not yet accepted (403) separately.
- To pin SHA-256 values in the catalog, the maintainers need to pass the gate and read the values.

However, **this path cannot run TranslateGemma**. The official repositories hold only 16-bit safetensors (including the image part), which `native/translate-onnx` cannot read. Converting them to ONNX on the user's PC needs PyTorch and transformers, but the app has not bundled Python since 0.5.0. A token mechanism becomes useful only once there is a gated source that provides ONNX. It is better not to build it now.

### (2) The project converts the weights and publishes them with the terms

The maintainers pass the gate of the official weights, convert only the text part to ONNX, quantize it and publish it on Hugging Face. No gate is added. As with other models, the app downloads it from a pinned revision without signing in.

- Precedent: Irodori-TTS v4 Large is downloaded from an ungated repository that holds `GEMMA_TERMS_OF_USE.md`, `GEMMA_PROHIBITED_USE_POLICY.md` and `NOTICE`. Its consent screen shows separate links to the terms and to the Prohibited Use Policy (`irodori_large` in `catalog.rs`). The project also publishes its own chat bubble detection model on Hugging Face (`DETECTOR_REPO` in `catalog.rs`).
- Meet the four conditions of section 3.1 of the terms. Put a copy of the terms, the Prohibited Use Policy and `NOTICE` (with the fixed sentence) in the repository. State in the model card that the weights were converted and quantized, and that the prohibited-use restrictions also apply to users. Show the same on the app's consent screen, and download only after the user consents.
- The project becomes a distributor and takes on the obligations of section 3.1. Google can restrict use that it believes violates the terms (section 3.2).
- Publishing on Hugging Face is an external action, so the maintainers decide (`AGENTS.md`). Whether to publish local translation models at all is not decided yet (item 1 of "Decisions needed" in [core integration](core-integration.md), #565). Note of 2026-11-21: publishing was decided on 2026-11-19 and done in #687. This settled decision 1 of #565.

### (3) Download a third-party conversion that does not include the terms

The onnx-community ONNX and many GGUF files are ungated and can be downloaded right away. This is still not recommended.

- A repository with neither a copy of the terms nor `NOTICE` is a distribution that does not meet the conditions of section 3.1. If the app downloaded from it, the app would be pointing users to a distribution that lacks those conditions.
- Where no license is shown (onnx-community), there is no basis for the license to pin in the catalog.
- There is no record of checking the conversion and the quantization against the original model.
- Third-party repositories can be deleted or rewritten. Even with a pinned revision, nothing can be downloaded once the repository is gone.

Using the onnx-community conversion for measurement is a separate matter from distribution, and can be done with approval for the download.

## Notes shown to users (draft)

These are draft wordings for the four notes in the issue. They are not in `locales/` yet. They appear on the catalog card and on the screen before the download. The consent screen shows separate links to the terms, the Prohibited Use Policy, `NOTICE` and the model card.

| Note | Japanese | English |
|---|---|---|
| License | Gemmaの利用規約と禁止用途のポリシーに従うモデルです。Apache-2.0やMITではありません。この条件はモデルを使う人にも及びます。 | This model is under the Gemma Terms of Use and the Gemma Prohibited Use Policy, not Apache-2.0 or MIT. These terms also apply to you when you use it. | <!-- writing-exempt: copy of the Japanese draft wording; 及びます is the verb 及ぶ, not the conjunction 及び -->
| Download (if (2) is adopted) | Googleの公式の重みはHugging Faceのアカウントで規約に同意しないと取得できません。ASTAROTが取得するのは、公式の重みを変換してGemmaの規約を添えて公開したものです。ログインは要りません。 | Google's official weights on Hugging Face need an account and acceptance of the terms. ASTAROT downloads a conversion of those weights that is published with the Gemma terms. No sign-in is needed. |
| Download (if (1) is adopted) | 公式の重みはHugging Faceでゲート付きです。Hugging Faceのアカウントでモデルのページを開いて規約に同意し、読み取り用のトークンを入れてください。トークンはお使いのPCの資格情報ストアに保存し、Hugging Faceにだけ送ります。 | The official weights are gated on Hugging Face. Open the model page with your Hugging Face account, accept the terms, then enter a read token. The token is kept in your PC's credential store and is sent only to Hugging Face. |
| Download (for (d)) | ASTAROTはこのモデルを取得しません。OllamaなどのサーバーにTranslateGemmaを入れて、そのアドレスを登録してください。モデルの利用条件は、取得した先で確かめてください。 | ASTAROT does not download this model. Install TranslateGemma in a server such as Ollama and add the server's address here. Check the model's terms where you get it. |
| Languages | 対応する言語は55です。NLLB-200（約200言語）やMADLAD-400（400言語あまり）より少なくなります。 | It covers 55 languages, fewer than NLLB-200 (about 200) or MADLAD-400 (over 400). |
| Size | 4Bのダウンロードは約3 GBです（4ビットの量子化）。会話の翻訳には4Bを想定しています。12Bと27Bはファイルだけで約8 GBと約17 GBあり、VRChatと同じPCで動かすには重すぎることがあります。 | The 4B model is about a 3 GB download (4-bit). It is the size meant for translating conversation. The 12B and 27B files alone are about 8 GB and 17 GB, which may be too heavy for the PC that runs VRChat. |

For (d), also state that the conversation context is not sent.

- Japanese: 「このプロンプトでは会話の流れを送りません。メッセージを1つずつ訳します。」
- English: "This prompt does not send the conversation context. Each message is translated on its own."

## Recommendation

1. **Add (d) in 0.6.0.** In the translation catalog's API group, add a way to select the TranslateGemma prompt and a built-in entry with the notes. No runtime, download or token is needed. Decide the format to send by testing real Ollama, LM Studio and llama.cpp servers.
2. **Make (c) a separate issue after measurement.** Implement it after confirming that 4B in int4 runs on the same PC as VRChat with a speed and memory use that work in conversation.
3. **If (c) is adopted, obtain the weights through (2).** The maintainers decide on publishing. The token mechanism (1) does not help, because the official weights are not ONNX. Do not build it now.
4. **Do not adopt (a), (b) or (3).**
5. **List only the 4B size.** Users can choose 12B and 27B through (d).

Under this recommendation, TranslateGemma in 0.6.0 is an API entry. The body of #413 gives TranslateGemma as an example for the inference-engine group, so that part changes.

## Decisions to make

1. Execution path: whether to add (d) first, add (c) in 0.6.0, or both. The recommendation is to add (d) first, and (c) after measurement.
2. Obtaining the weights: if (c) is adopted, whether to publish as in (2), and whether to build the token mechanism of (1). The recommendation is (2), without building (1).
3. Place in the catalog: whether to make TranslateGemma for (d) a built-in API entry, and whether to accept the difference from how the body of #413 groups it (inference-engine group).
4. Format sent in (d): a structured `content`, a string `content`, or a switch by server type. Also whether it is acceptable not to send the conversation context and to send temperature 0.
5. Size: whether 4B alone is enough for running inside the app.
6. Download for measurement: whether the onnx-community conversion or the Ollama model may be downloaded to measure (c) (several GB).

## Remaining work

The work is split into pieces that can each be one issue.

1. TranslateGemma prompt ((d)): add to `native/translation` a form that sends no system role and builds the prompt with language codes. Make it selectable for API entries in the translation catalog, and put the notes in `locales/en.yml` and `locales/ja.yml`. Add cases to the contract tests. Check by hand with the real 4B on Ollama, LM Studio and llama.cpp's server (this needs approval for the model download).
2. Language table: list the 55 languages from the technical report, and build a table from the app's language names to TranslateGemma's codes. Also decide whether languages outside the evaluation can be selected.
3. Measurement (prerequisite for (c)): run the 4B ONNX in int4 and int8 on ONNX Runtime 1.31 with the CPU, DirectML and others, and measure the load time, the peak memory and VRAM, and the time per utterance. Run it alongside VRChat, speech recognition and TTS. Measure on both Windows and Linux.
4. Decoder-only generation ((c)): add to `native/translate-onnx` generation with a KV cache, a new manifest `family`, prompt building and the tokenizer comparison. Add the core's mapping tables, the translation catalog's `RUNTIMES` and the hardware guidance (#405). Test with a fake model.
5. Export and publishing ((c) and (2)): add decoder-only export and quantization to `tools/translation_onnx`, and check that the output matches the original model. Put the terms, the Prohibited Use Policy, `NOTICE` and a model card that states the conversion in the repository to be published (the maintainers do the publishing). After that, pin the model in the catalog and record it in `NOTICE.md` and the license register.
6. Gated download (only if it is built): design the token storage, attaching the token only to requests to `huggingface.co` and not to redirect targets, the 401 and 403 errors, the way to delete the token and the screens. Not recommended now.

## Sources

- [TranslateGemma model card](https://huggingface.co/google/translategemma-4b-it/blob/10042cb0e6e7fdce748996a71dc3dc432a4e0c89/README.md) (4B, revision `10042cb0e6e7fdce748996a71dc3dc432a4e0c89`)
- [Technical report](https://arxiv.org/abs/2601.09012) (the language list has not been copied yet)
- [chat_template.jinja](https://huggingface.co/onnx-community/translategemma-text-4b-it-ONNX/blob/f7874a1ac60758872a4f78aac0df95b17b776994/chat_template.jinja) (the same file as the official one, which is behind the gate)
- [Gemma Terms of Use](https://gemma.ai/resources/terms/) (2026-04-01 version), [Gemma Prohibited Use Policy](https://gemma.ai/resources/prohibited-use/) (2024-02-21 version)
- Copies of the terms in Irodori-TTS v4 Large: [GEMMA_TERMS_OF_USE.md](https://huggingface.co/sakasegawa/Irodori-TTS-v4-Large-GGUF/blob/79cae5947a97e941c62912749e1387c8b35ec16b/GEMMA_TERMS_OF_USE.md), [NOTICE](https://huggingface.co/sakasegawa/Irodori-TTS-v4-Large-GGUF/blob/79cae5947a97e941c62912749e1387c8b35ec16b/NOTICE)
- The Hugging Face API (`/api/models/<repo>`, `/tree/<revision>`, `?expand[]=gguf`, `?search=translategemma`) and the Ollama registry (`registry.ollama.ai/v2/library/translategemma/manifests/<tag>` and its template, configuration and license layers). Both were read on 2026-11-18.

---

# TranslateGemma を翻訳に使う道筋（2026-11-18）（日本語版）

調べた日: 2026-11-18。状態: **提案**。Issue #412 の材料で、決めるのは保守担当者である。コード、モデルのカタログ、表示する文言は変えていない。

> **決定の注記**（2026-11-19）：保守担当者は実行の経路を LLM 用の実行基盤（下の (a) か (b) の形）とし、ADR-012 の例外として扱うと決めた。ゲート付きの重みの規約への同意の扱いも実装の範囲に入る。下の「推奨」の (d) を先に入れる案は採られなかった。例外の記録は [ADR-015](../adr/adr-015-translation-llm-runtime-exception.md) にある。本文は書き換えていない。

TranslateGemma をアプリの翻訳で使う経路と、重みの入手のしかたを比べた。決めることは「判断項目」に挙げた。出典はどれもこの日に見たもので、モデルのファイルは取得していない。読んだのは Hugging Face と Ollama のレジストリの API が返す情報と、小さいテキストのファイル（モデルカード、チャットのテンプレート、設定、規約）だけである。

## 目的

Google の翻訳用の LLM である TranslateGemma を、注記を付けて翻訳のカタログに載せる（#412）。カタログの枠組みは #413 で入った（[モデルの取得](model-downloads.md#翻訳のカタログ413)）。NLLB-200 と MADLAD-400 の追加（#411）とは別に扱う。

## 事実

### モデル

- Gemma 3 をもとに翻訳向けに学習したモデルで、4B、12B、27B がある。モデルカードは「55言語の翻訳」を対象とする。
- 入力は文と画像で、入力の文脈は合わせて 2K トークンまで。出力は訳文だけである。
- モデルカードの評価（WMT24++、55言語）は次のとおり。MetricX は小さいほど、COMET は大きいほどよい。

  | | 4B | 12B | 27B |
  |---|---:|---:|---:|
  | MetricX | 5.32 | 3.60 | 3.09 |
  | COMET | 81.6 | 83.5 | 84.4 |

- アーキテクチャは decoder-only である。`native/translate-onnx` が読む M2M100 と NLLB-200 は encoder-decoder なので、今の実行部では動かない（`bundle.rs` の `ARCHITECTURES`）。

### 公式の重み（Hugging Face）

| リポジトリ | revision | 中身 | 重みの大きさ |
|---|---|---|---|
| [google/translategemma-4b-it](https://huggingface.co/google/translategemma-4b-it/tree/10042cb0e6e7fdce748996a71dc3dc432a4e0c89) | `10042cb0e6e7fdce748996a71dc3dc432a4e0c89` | safetensors 2分割 | 8,600,277,880 bytes |
| [google/translategemma-12b-it](https://huggingface.co/google/translategemma-12b-it/tree/d1b225e1caa17f1ddc7e62065d8637d0923f34e2) | `d1b225e1caa17f1ddc7e62065d8637d0923f34e2` | safetensors 5分割 | 24,374,793,024 bytes |
| [google/translategemma-27b-it](https://huggingface.co/google/translategemma-27b-it/tree/7d10f0b72f89a2d0f268cea30727d8b77c0d25c2) | `7d10f0b72f89a2d0f268cea30727d8b77c0d25c2` | safetensors 12分割 | 54,864,980,440 bytes |

- 3つともゲート付き（API の `gated: manual`）で、ライセンスの表示は `gemma` である。取得するには、Hugging Face にログインしてモデルのページで規約に同意する必要がある。ログインしないで API を読むと、ファイルの SHA-256 は伏せられている。ログインしないで `config.json` などを取りにいくと 401 が返る。
- 重みは 16 ビットで、画像を読む部分を含む（`Gemma3ForConditionalGeneration`）。ONNX も GGUF も置いていない。
- モデルカードは Kaggle と Vertex AI の Model Garden のページも案内している。

### 第三者の変換

- [onnx-community/translategemma-text-4b-it-ONNX](https://huggingface.co/onnx-community/translategemma-text-4b-it-ONNX/tree/f7874a1ac60758872a4f78aac0df95b17b776994) @ `f7874a1ac60758872a4f78aac0df95b17b776994`。4B から画像を読む部分を除き、文を扱う部分（`Gemma3ForCausalLM`）だけを ONNX にしたもので、ゲートはない。ライセンスの表示、README、規約の写しはどれもない。`config.json` には Transformers.js 向けの設定と、KV キャッシュの型がある。

  | 形 | ファイル | 合計 |
  |---|---|---:|
  | q4 | `model_q4.onnx` と `_data`、`_data_1` | 3,091,548,551 bytes |
  | q4f16 | `model_q4f16.onnx` と `_data`、`_data_1` | 2,714,995,011 bytes |
  | int8 | `model_quantized.onnx` と `_data`〜`_data_2` | 5,427,753,133 bytes |
  | fp16 | `model_fp16.onnx` と `_data`〜`_data_3` | 7,895,984,938 bytes |
  | fp32 | `model.onnx` と `_data`〜`_data_7` | 15,789,835,573 bytes |

  `chat_template.jinja` は公式と同じファイルである（git の blob が `d571968f9770221512d29627697012202451983c` で一致）。`tokenizer.json` は公式（33,384,570 bytes）と大きさが違う（20,323,013 bytes）。グラフのファイルは取得していないので、入出力の名前と演算は確かめていない。
- Hugging Face で「translategemma」を検索した上位100件（ダウンロード順）は、Google の3つを除いてどれもゲートがない。多くは GGUF で、llama.cpp 系のランタイムで動かす形である。規約の写しを添えたものは少ない。たとえば `bullerwins/translategemma-4b-it-GGUF` と `mradermacher/translategemma-4b-it-GGUF` にはなく、`Menterium/translategemma-4b-it-GGUF` には `GEMMA_TERMS_OF_USE.txt` と `NOTICE` がある。3つとも GGUF に公式のチャットのテンプレートを埋め込んでいる（API の `gguf.chat_template`）。
- Ollama のライブラリにも `translategemma` がある（レジストリの manifest）。モデルの層は 4b が 3,298,866,368 bytes、12b が 8,109,818,272 bytes、27b が 17,358,640,928 bytes。ライセンスの層は Gemma Terms of Use（2024-02-21 の版）である。Issue の「4B で約3.3GB」はこの値に当たる。

### プロンプトの形

公式の `chat_template.jinja` は次のように決めている。

- 役割は user と assistant だけ。最初が user でないと例外になり、system の役割も例外になる。
- user の `content` は要素が1つのリストで、その要素に `type`（`text` か `image`）、`source_lang_code`、`target_lang_code`、`text` を書く。文字列の `content` は例外になる。
- 言語の符号は ISO 639-1（`ja`）か、地域を付けたもの（`en-GB`、`zh-Hant`）。テンプレートの表には 581 の符号と 161 の言語名がある。表にない符号は例外になる。表に載っていても、評価の対象の55言語に入るとは限らない。
- テンプレートが作る文は「You are a professional {原文の言語} ({符号}) to {訳文の言語} ({符号}) translator. …Please translate the following {原文の言語} text into {訳文の言語}:」に続けて空行2つと原文である。会話の文脈を入れる場所はない。
- モデルカードの例は `do_sample=False`（貪欲法）で生成する。`generation_config.json` の終了のトークンは 1 と 106（`<end_of_turn>`）。

### 利用条件

- 重みと、そこから作ったもの（Model Derivatives）は Gemma Terms of Use に従う。2026-11-18 の原文は 2026-04-01 の版で、付録に TranslateGemma が載っている。禁止用途のポリシーは 2024-02-21 の版で、規約の 3.2 節で規約の一部になっている。規約の URL は `ai.google.dev/gemma/terms` から `gemma.ai/resources/terms/` に移った（301 で転送される）。
- 3.1 節は再配布に次の4つの条件を付ける。
  1. 利用や配布を決める取り決め（利用規約など）に、3.2 節の利用の制限を強制できる条項として入れる。受け取る人に、制限があることを知らせる。
  2. 受け取る人すべてに、この規約の写しを渡す。
  3. 変更したファイルには変更したことを目立つように示す。
  4. 決まった一文（「Gemma is provided under and subject to the Gemma Terms of Use found at …」）を書いた `Notice` のテキストファイルを添える。2026-11-18 の原文ではこの URL が `gemma.ai/resources/terms` になっている。同じ日付の版の写しでも、Irodori-TTS v4 Large のリポジトリのものは `ai.google.dev/gemma/terms` のままである。
- 3.2 節で、Google は規約に反すると考える利用を制限できる。禁止用途のポリシーは権利の侵害、危険や違法な行為、人をだます内容、性的な内容の生成などを禁じる。この制限は配る側だけでなく、使う人にも及ぶ。
- 出力（訳文）について、Google は権利を主張しない（3.3 節）。

### アプリの今の仕組み

- 翻訳のカタログの推論エンジン系が受け付ける `runtime` は `onnx` だけ、API 系の `protocol` は `openai_compatible` だけである（`native/ops/src/downloads/translation_catalog.rs`）。
- モデルの取得は固定した Hugging Face のホストから HTTPS で取るだけで、利用者の認証情報は付けない（`native/ops/src/downloads/transport.rs` の冒頭）。カタログの `Model` にはゲートを表す欄がない。
- LLM の翻訳（OpenAI、OpenAI 互換、LM Studio、Ollama など）は、system の役割に翻訳の指示を、user の役割に原文を送る（`native/translation/src/providers/chat.rs`、`ollama.rs`）。指示には対応する言語の名前の一覧、原文と訳文の言語の英語の名前（`Japanese` など）、直近5件の会話の文脈が入る（`prompt.rs`）。温度などの生成の設定は送らない（Ollama は空の `options`）。
- API キーは OS の資格情報ストアに置く（[ADR-013](../adr/adr-013-secret-store.md)、[APIキーの保存先](../spec/data-and-persistence.md#apiキーの保存先)）。

## 実行の経路の比較

[ADR-012](../adr/adr-012-audio-ai-runtime-consolidation.md) はローカル翻訳の推論を ONNX Runtime に置く（2.2）。翻訳の ONNX のモデルを足すことは例外の手続きの対象外だが、既存の ONNX Runtime の上で動くことを求める（2.5）。新しいランタイムを足すには、例外の ADR が要る（2.4）。

| 経路 | ADR-012 との関係 | アプリが持つもの | 推奨 |
|---|---|---|---|
| (a) ONNX Runtime GenAI | 新しい推論ライブラリ。例外の ADR が要る | GenAI のライブラリと、その形式のモデル | 採らない |
| (b) GGUF のランタイム（llama.cpp）をアプリに入れる | 新しいランタイム。翻訳を GGML に移す案は 3 節で採らなかった | llama.cpp と GGUF | 採らない |
| (c) `native/translate-onnx` に decoder-only の生成を足す | 2.5 のとおり既存の ONNX Runtime の上で動くので許される | 生成の処理、ONNX のモデル | 次の段階の候補（計測しだい） |
| (d) 利用者のサーバー（Ollama、LM Studio、llama.cpp の server）に API 系でつなぐ | ランタイムを足さない。2.2 の「外部の翻訳サービスと LLM のサービス」の接続 | プロンプトの形だけ | 先に入れる |

### (a) ONNX Runtime GenAI

ONNX Runtime の上で LLM の生成を受け持つ Microsoft のライブラリである。生成の処理と KV キャッシュの管理を任せられる。ただし、自分のネイティブのライブラリと、自分の形式のモデル（`genai_config.json` を添えたフォルダ）を持つ。Rust から使うには C の API に結び付ける必要がある。アプリにとっては新しい推論ライブラリで、ADR-012 の 2.4 の例外の ADR が要る。既存の基盤（`ort` で ONNX Runtime を直接呼ぶ）で実現できない技術的な理由は、今のところ見当たらない。(c) で同じことができる見込みなので採らない。

### (b) GGUF のランタイム（llama.cpp）をアプリに入れる

ゲートのない GGUF の変換は多く、量子化の種類も多い。それでも llama.cpp はアプリに新しいランタイムを足すことになる。ADR-012 は翻訳を GGML に揃える案を採らなかった（3 節）。同梱の speech.cpp に翻訳を受け持たせることも、非目標にしている（5 節）。採らない。

### (c) `native/translate-onnx` に decoder-only の生成を足す

比べた4つのうち、ADR-012 の範囲でアプリの中で TranslateGemma を動かせるのはこの経路だけである。必要な作業は次のとおり。

1. ONNX のグラフ: KV キャッシュを受け取って返す decoder-only のグラフを用意する。onnx-community の変換を使うか、`tools/translation_onnx` に書き出しを足して公式の重みから作る。後者なら、元のモデル（transformers）と出力が一致することを確かめる（#411 の MADLAD-400 と同じ）。onnx-community のグラフを使うなら、入出力の名前、演算（`MatMulNBits` など）、ONNX Runtime 1.31 で読めるかを確かめる。
2. 形の大きさ: `config.json` では 34 層、注意の頭が 8、KV の頭が 4、頭の次元が 256、語彙が 262,208 である。KV キャッシュは1トークンあたり fp16 で 139,264 bytes になる（2 × 34 × 4 × 256 × 2）。入力の上限の 2K トークンでも約 285 MB と見積もれる（計っていない）。翻訳の1回の入力は短いので、メモリーの大半は重みになる。
3. トークナイザ: Gemma の `tokenizer.json` を `tokenizers` で読み、ID とデコードの結果が公式のトークナイザと一致することを確かめる。onnx-community の `tokenizer.json` は公式と大きさが違うので、そのまま使うなら照合が要る。
4. プロンプト: 公式のテンプレートの文を Rust で組み立てる。テンプレートの文は決まった英文と言語名の表だけなので、Jinja のエンジンは要らない。アプリの言語の名前から ISO の符号への表も要る（`Chinese Simplified` は `zh-Hans`、`Chinese Traditional` は `zh-Hant` など）。
5. 生成: 貪欲法で生成し、トークン 1 か 106 で止める。今の `beam.rs` は encoder-decoder の CTranslate2 の規則に合わせたもので、そのままは使えない。入力と出力の上限（今は 1024 と 256）を決め直す。
6. マニフェスト: 新しい `family`（例: `gemma3`）を足す。今のマニフェストは `encoder`、`decoder`、`decoder_layers` などの encoder-decoder の欄を必須にしているので、schema を分ける。外部データのファイルが複数あるので、カタログの役割 `data` を複数持てるようにする。
7. 中核: `family_of`、`weight_of_catalog_id`、`languages::TRANSLATION_WEIGHTS`、言語の表、翻訳のカタログの `RUNTIMES` に足す。
8. カタログ: 翻訳の項目は `native/ops/data/translation_models.json` に置き、`tools/translation_onnx/publish.py catalog --write` で公開した版のファイルを照らして書く（#277）。版、ファイルごとの大きさと SHA-256、ライセンスのリンク（規約、禁止用途のポリシー、`NOTICE`）を固定し、`CATALOG_VERSION` を上げる。今のデータの形では翻訳の項目の `notice` が `translation` に決まっているので、規約の注記を出すには項目ごとの `notice` を持てるようにする。`NOTICE.md` と[ライセンス台帳](licensing.md)に書く。既定にはしない。
9. ハードウェアの目安: 翻訳の項目には、今は目安の数値がない（`guidance.rs`）。計測の値を足して、性能不足の警告（#405）の対象にする。
10. 計測: 4B の int4 と int8 を、CPU と DirectML などで動かし、読み込みの時間、メモリーと VRAM のピーク、1発話あたりの時間を測る。VRChat、音声認識、読み上げと同時に動かした値も要る（ADR-012 の 2.6）。Windows と Linux の両方で測る（2.7）。実行プロバイダごとの int4 の動作は、`native/translate-onnx/README.md` の表でも「未確認」である。

4B の int4 でも重みは約 3 GB ある。M2M100 418M の int8（約 506 MB）の6倍ほどで、CPU での速さは計らないと分からない。計測で会話に使える速さが出るまでは、実装に進まないのがよい。

### (d) 利用者のサーバーにつなぐ

Ollama、LM Studio、llama.cpp の server などに利用者がモデルを入れ、アプリは API 系の項目としてつなぐ。アプリはランタイムも重みも持たず、取得もしない。12B や 27B を別の PC で動かすこともできる。

**今の状態**: 翻訳のカタログの API 系の項目（`openai_compatible`）と、Ollama や LM Studio のエンジンで、TranslateGemma を動かしているサーバーを選ぶことはできる。ただし、アプリが送る形は TranslateGemma の形と合わない。

- 公式のテンプレートをそのまま当てるサーバーでは、テンプレートの記述どおりなら system の役割と文字列の `content` で例外になる。調べた3つの GGUF の変換は、どれもこのテンプレートを埋め込んでいる。
- Ollama のライブラリの `translategemma` は Jinja ではなく自分のテンプレートを使う。このテンプレートは system と user のどちらの文も user の発言として並べる。アプリの指示（会話の文脈を含む）と原文が2つの user の発言になり、例外にはならないが、学習した形とは違う。会話の文脈まで訳したり、指示に答えたりするおそれがある。生成の設定は `top_k` 64 と `top_p` 0.95 だけで温度を決めていないので、サーバーの既定の温度でサンプリングする。
- 各サーバーが実際にどう応じるか（例外を返すか、別のテンプレートに切り替えるか）と、訳の質は確かめていない。確かめるにはモデルの取得が要る。

**要るもの**: API 系の項目に「TranslateGemma のプロンプト」を選べる形を足す。

- system の役割を送らず、user の発言を1つだけ送る。
- 言語は名前ではなく ISO の符号で渡す。
- 送る形は2通りある。(1) 公式のテンプレートの形のまま、`content` を `{type, source_lang_code, target_lang_code, text}` の1要素のリストにする。(2) テンプレートが作る英文と原文を、文字列の `content` として送る。(1) は Jinja のテンプレートを当てるサーバー向け、(2) は Ollama のように自分のテンプレートを使うサーバー向けである。OpenAI の Chat Completions の形では文の要素は `type` と `text` だけなので、サーバーがほかの鍵を捨てるかもしれない。どちらがどのサーバーで動くかは、実物で確かめて決める。
- 会話の文脈は送らない。ほかの LLM の翻訳と振る舞いが変わるので、画面に書く。
- 温度 0 を送り、公式の例と同じ貪欲法に近づける。
- 置き場所は `native/translation`（`prompt.rs` と各プロバイダ）と、翻訳のカタログの `PROTOCOLS` または項目の欄である。翻訳のプロバイダの契約テスト（`native/translation/tests/contract/`）に場面を足す。

## 重みの入手とトークン

アプリの中で動かす経路 (c) を採るときだけ、重みの入手が問題になる。(d) ではアプリは取得しない。

### (1) 公式のゲート付きの重みを、利用者のトークンで取得する

利用者が Hugging Face のアカウントで規約に同意し、読み取り用のトークンをアプリに渡す。設計するなら次の形になる。

- トークンは API キーと同じく OS の資格情報ストアに置く（`SECRET_SETTINGS` に1件足す）。`config.json` にも `secrets.json` にも平文で書かない。
- 送るのは、ゲート付きの項目を取得するときの `huggingface.co` への要求だけにする。転送先の CDN（`cas-bridge.xethub.hf.co` など）には送らない。今の取得の約束（認証情報を付けない）を変えることになるので、`transport.rs` の約束と試験を書き直す。
- ログにも、エラーにも、`process.log` の IPC の記録にも出さない。消す操作を用意する。
- 同意の画面ではモデルのページへのリンクを示す。アカウントで規約に同意するのは利用者で、アプリが代わりに同意することはできない。トークンが無効なとき（401）と同意していないとき（403）を分けて知らせる。
- カタログに SHA-256 を固定するには、保守担当者がゲートを通って値を読む必要がある。

ただし、**この経路では TranslateGemma を動かせない**。公式のリポジトリにあるのは 16 ビットの safetensors（画像の部分を含む）だけで、`native/translate-onnx` は読めない。利用者の PC で ONNX に変換するには PyTorch と transformers が要るが、アプリは 0.5.0 から Python を同梱していない。トークンの仕組みは、ゲート付きで ONNX を置いた取得元ができたときに初めて役に立つ。今は作らないのがよい。

### (2) プロジェクトが変換して、規約を添えて公開する

保守担当者が公式の重みのゲートを通り、文を扱う部分だけを ONNX に変換して量子化し、Hugging Face に公開する。ゲートは付けない。アプリはほかのモデルと同じく、ログインなしで固定の revision から取得する。

- 前例: Irodori-TTS v4 Large は、`GEMMA_TERMS_OF_USE.md`、`GEMMA_PROHIBITED_USE_POLICY.md`、`NOTICE` を置いたゲートのないリポジトリから取得している。同意の画面には規約と禁止用途のポリシーへのリンクを個別に出す（`catalog.rs` の `irodori_large`）。プロジェクトは自前のチャットの吹き出しの検出モデルも Hugging Face に公開している（`catalog.rs` の `DETECTOR_REPO`）。
- 規約の 3.1 節の4つの条件を満たす。リポジトリに規約の写し、禁止用途のポリシー、`NOTICE`（決まった一文）を置く。モデルカードに、変換と量子化をしたことと、禁止用途の制限が利用者にも及ぶことを書く。アプリの同意の画面にも同じことを示し、利用者が同意してから取得する。
- プロジェクトは配る側になり、3.1 節の義務を負う。Google は規約に反すると考える利用を制限できる（3.2 節）。
- Hugging Face への公開は外部への操作なので、保守担当者が決める（`AGENTS.md`）。ローカル翻訳のモデルの公開そのものも、まだ決まっていない（[中核の統合](core-integration.md)の「判断が要ること」の 1、#565）。2026-11-21 の注記：2026-11-19 に公開すると決まり、#687 で公開した。#565 の判断 1 はこれで片付いた。

### (3) 規約を添えていない第三者の変換から取得する

onnx-community の ONNX や、多くの GGUF はゲートがなく、すぐに取得できる。それでも勧めない。

- 規約の写しも `NOTICE` もないリポジトリは、3.1 節の条件を満たしていない配布である。アプリがそこから取得させると、条件を欠いた配布を案内することになる。
- ライセンスの表示がないもの（onnx-community）は、カタログに固定するライセンスの根拠がない。
- 変換と量子化の正しさを、元のモデルと比べて確かめた記録がない。
- 第三者のリポジトリは消えたり書き換えられたりする。revision を固定しても、消えれば取得できない。

計測のために onnx-community の変換を使うことは、配布とは別の話で、取得の承認があればできる。

## 利用者に示す注記（案）

Issue の4つの注記の文案である。`locales/` にはまだ入れていない。カタログのカードと、ダウンロードの前の画面に出す。同意の画面には規約、禁止用途のポリシー、`NOTICE`、モデルカードへのリンクを個別に出す。

| 注記 | 日本語 | English |
|---|---|---|
| ライセンス | Gemmaの利用規約と禁止用途のポリシーに従うモデルです。Apache-2.0やMITではありません。この条件はモデルを使う人にも及びます。 | This model is under the Gemma Terms of Use and the Gemma Prohibited Use Policy, not Apache-2.0 or MIT. These terms also apply to you when you use it. |
| 取得（(2) を採るとき） | Googleの公式の重みはHugging Faceのアカウントで規約に同意しないと取得できません。ASTAROTが取得するのは、公式の重みを変換してGemmaの規約を添えて公開したものです。ログインは要りません。 | Google's official weights on Hugging Face need an account and acceptance of the terms. ASTAROT downloads a conversion of those weights that is published with the Gemma terms. No sign-in is needed. |
| 取得（(1) を採るとき） | 公式の重みはHugging Faceでゲート付きです。Hugging Faceのアカウントでモデルのページを開いて規約に同意し、読み取り用のトークンを入れてください。トークンはお使いのPCの資格情報ストアに保存し、Hugging Faceにだけ送ります。 | The official weights are gated on Hugging Face. Open the model page with your Hugging Face account, accept the terms, then enter a read token. The token is kept in your PC's credential store and is sent only to Hugging Face. |
| 取得（(d) のとき） | ASTAROTはこのモデルを取得しません。OllamaなどのサーバーにTranslateGemmaを入れて、そのアドレスを登録してください。モデルの利用条件は、取得した先で確かめてください。 | ASTAROT does not download this model. Install TranslateGemma in a server such as Ollama and add the server's address here. Check the model's terms where you get it. |
| 言語 | 対応する言語は55です。NLLB-200（約200言語）やMADLAD-400（400言語あまり）より少なくなります。 | It covers 55 languages, fewer than NLLB-200 (about 200) or MADLAD-400 (over 400). |
| 大きさ | 4Bのダウンロードは約3 GBです（4ビットの量子化）。会話の翻訳には4Bを想定しています。12Bと27Bはファイルだけで約8 GBと約17 GBあり、VRChatと同じPCで動かすには重すぎることがあります。 | The 4B model is about a 3 GB download (4-bit). It is the size meant for translating conversation. The 12B and 27B files alone are about 8 GB and 17 GB, which may be too heavy for the PC that runs VRChat. |

(d) のときは、会話の文脈を送らないことも書く。

- 日本語: 「このプロンプトでは会話の流れを送りません。メッセージを1つずつ訳します。」
- English: "This prompt does not send the conversation context. Each message is translated on its own."

## 推奨

1. **0.6.0 では (d) を入れる。** 翻訳のカタログの API 系に、TranslateGemma のプロンプトを選べる形と、注記付きの組み込みの項目を足す。ランタイムも取得もトークンも要らない。送る形は Ollama、LM Studio、llama.cpp の server で実物を確かめて決める。
2. **(c) は計測の後の別の Issue にする。** 4B の int4 が VRChat と同じ PC で会話に使える速さとメモリーで動くことを確かめてから実装する。
3. **(c) を採るなら、重みは (2) にする。** 保守担当者が公開を決める。トークンの仕組み (1) は、公式の重みが ONNX でないので役に立たない。今は作らない。
4. **(a)、(b)、(3) は採らない。**
5. **載せる大きさは 4B だけにする。** 12B と 27B は (d) で利用者が選べる。

この推奨では、0.6.0 の TranslateGemma は API 系の項目になる。#413 の本文は TranslateGemma を推論エンジン系の例に挙げているので、そこが変わる。

## 判断項目

1. 実行の経路: (d) を先に入れるか、(c) を 0.6.0 に入れるか、両方か。推奨は (d) を先に入れ、(c) は計測の後。
2. 重みの入手: (c) を採るとき、(2) の公開をするか。(1) のトークンの仕組みを作るか。推奨は (2) で、(1) は作らない。
3. カタログでの置き場所: (d) の TranslateGemma を API 系の組み込みの項目にするか。#413 の本文の分け方（推論エンジン系）との違いを認めるか。
4. (d) の送る形: 構造のある `content` か、文字列の `content` か、サーバーの種類で切り替えるか。会話の文脈を送らないことと、温度 0 を送ることでよいか。
5. 大きさ: アプリの中で動かすのは 4B だけでよいか。
6. 計測のための取得: (c) の計測に onnx-community の変換か Ollama のモデルを取得してよいか（数 GB）。

## 残課題

それぞれ1つの Issue にできる大きさに分けた。

1. TranslateGemma のプロンプト（(d)）: `native/translation` に system を送らず言語の符号で組み立てる形を足す。翻訳のカタログの API 系の項目で選べるようにし、`locales/en.yml` と `locales/ja.yml` に注記を入れる。契約テストに場面を足す。Ollama、LM Studio、llama.cpp の server で実物の 4B を使って手で確かめる（モデルの取得の承認が要る）。
2. 言語の表: 技術報告の55言語を一覧にし、アプリの言語の名前から TranslateGemma の符号への表を作る。評価の対象でない言語を選べるようにするかも決める。
3. 計測（(c) の前提）: 4B の int4 と int8 の ONNX を ONNX Runtime 1.31 の CPU と DirectML などで動かし、読み込みの時間、メモリーと VRAM のピーク、1発話の時間を測る。VRChat、音声認識、読み上げと同時に動かす。Windows と Linux の両方で測る。
4. decoder-only の生成（(c)）: `native/translate-onnx` に KV キャッシュ付きの生成、マニフェストの新しい `family`、プロンプトの組み立て、トークナイザの照合を足す。中核の対応表、翻訳のカタログの `RUNTIMES`、ハードウェアの目安（#405）を足す。偽のモデルで試験する。
5. 書き出しと公開（(c) と (2)）: `tools/translation_onnx` に decoder-only の書き出しと量子化を足し、元のモデルと出力が一致することを確かめる。公開するリポジトリに規約、禁止用途のポリシー、`NOTICE`、変換したことを書いたモデルカードを置く（公開は保守担当者が行う）。そのあとでカタログに固定し、`NOTICE.md` とライセンス台帳に書く。
6. ゲート付きの取得（作るときだけ）: トークンの保存、`huggingface.co` への要求だけに付けて転送先には付けないこと、401 と 403 のエラー、消す操作、画面を設計する。今は推奨しない。

## 出典

- [TranslateGemma のモデルカード](https://huggingface.co/google/translategemma-4b-it/blob/10042cb0e6e7fdce748996a71dc3dc432a4e0c89/README.md)（4B、revision `10042cb0e6e7fdce748996a71dc3dc432a4e0c89`）
- [技術報告](https://arxiv.org/abs/2601.09012)（言語の一覧はまだ写していない）
- [chat_template.jinja](https://huggingface.co/onnx-community/translategemma-text-4b-it-ONNX/blob/f7874a1ac60758872a4f78aac0df95b17b776994/chat_template.jinja)（公式と同じファイル。公式のものはゲートの内側）
- [Gemma Terms of Use](https://gemma.ai/resources/terms/)（2026-04-01 の版）、[Gemma Prohibited Use Policy](https://gemma.ai/resources/prohibited-use/)（2024-02-21 の版）
- Irodori-TTS v4 Large の規約の写し: [GEMMA_TERMS_OF_USE.md](https://huggingface.co/sakasegawa/Irodori-TTS-v4-Large-GGUF/blob/79cae5947a97e941c62912749e1387c8b35ec16b/GEMMA_TERMS_OF_USE.md)、[NOTICE](https://huggingface.co/sakasegawa/Irodori-TTS-v4-Large-GGUF/blob/79cae5947a97e941c62912749e1387c8b35ec16b/NOTICE)
- Hugging Face の API（`/api/models/<repo>`、`/tree/<revision>`、`?expand[]=gguf`、`?search=translategemma`）と Ollama のレジストリ（`registry.ollama.ai/v2/library/translategemma/manifests/<tag>` とテンプレート、設定、ライセンスの層）。どちらも 2026-11-18 に読んだ。
