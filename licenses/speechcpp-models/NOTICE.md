# speech.cpp recognition models (downloadable, not shipped)

VRCT-VOX does not ship these models. The download catalog
(`src-python/models/model_downloads/speechcpp_asr.py`) offers every file that
speech.cpp's own catalog lists for the names below. A file is fetched only
after the user reads the review dialog (provider, license links, exact size,
destination) and agrees. The file comes straight from the pinned Hugging Face
revision to the user's PC and is checked against its size and SHA-256.
VRCT-VOX does not redistribute, modify or host any of them.

The revisions, files, sizes and SHA-256 are speech.cpp 0.11.0's
(`speech models --json`, copied by `tools/speechcpp_models.py` into
`src-python/models/model_downloads/speechcpp_models.py`). This ledger records
the license review, made on 2026-11-16 against the pinned revisions and the
upstream model cards.

| speech.cpp name | Upstream model (revision converted) | GGUF repository @ pinned revision | License | Files |
|---|---|---|---|---|
| `qwen3-asr-0.6b` | [Qwen/Qwen3-ASR-0.6B](https://huggingface.co/Qwen/Qwen3-ASR-0.6B) @ `5eb144179a02acc5e5ba31e748d22b0cf3e303b0` | [sakasegawa/Qwen3-ASR-0.6B-GGUF](https://huggingface.co/sakasegawa/Qwen3-ASR-0.6B-GGUF/tree/ee78f8709547f39bea3b924a16c72403826cac92) @ `ee78f8709547f39bea3b924a16c72403826cac92` | Apache-2.0 | Q8_0 (default), Q6_K, Q5_K, Q4_K |
| `qwen3-asr-1.7b` | [Qwen/Qwen3-ASR-1.7B](https://huggingface.co/Qwen/Qwen3-ASR-1.7B) @ `7278e1e70fe206f11671096ffdd38061171dd6e5` | [sakasegawa/Qwen3-ASR-1.7B-GGUF](https://huggingface.co/sakasegawa/Qwen3-ASR-1.7B-GGUF/tree/81e2423d24073cdeeccb5951df16accc89e075a2) @ `81e2423d24073cdeeccb5951df16accc89e075a2` | Apache-2.0 | Q8_0 (default), Q6_K, Q5_K, Q4_K |
| `reazonspeech-v2` | [reazon-research/reazonspeech-nemo-v2](https://huggingface.co/reazon-research/reazonspeech-nemo-v2) @ `33693408be76b7cba9fd4a7546a0a8772430211b` | [sakasegawa/reazonspeech-nemo-v2-GGUF](https://huggingface.co/sakasegawa/reazonspeech-nemo-v2-GGUF/tree/ed04d9ee2cd156414982a7c0f6123c6fd1093904) @ `ed04d9ee2cd156414982a7c0f6123c6fd1093904` | Apache-2.0 | Q8_0 (default), F16, Q6_K, Q5_K, Q4_K |
| `parakeet-tdt_ctc-0.6b-ja` | [nvidia/parakeet-tdt_ctc-0.6b-ja](https://huggingface.co/nvidia/parakeet-tdt_ctc-0.6b-ja) @ `44edb27eea9317daf89333e75eb830db4b1cc298` | [sakasegawa/parakeet-tdt_ctc-0.6b-ja-GGUF](https://huggingface.co/sakasegawa/parakeet-tdt_ctc-0.6b-ja-GGUF/tree/f7cb5387e1e76385456b7a792054565ecf177417) @ `f7cb5387e1e76385456b7a792054565ecf177417` | CC BY 4.0 | Q8_0 (default), F16, Q6_K, Q5_K, Q4_K |
| `parakeet-tdt-0.6b-v3` | [nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) @ `541d1f99c6b0c3cd0b11a95167540bb8edefd82b` | [sakasegawa/parakeet-tdt-0.6b-v3-GGUF](https://huggingface.co/sakasegawa/parakeet-tdt-0.6b-v3-GGUF/tree/b7ed82dbfba6e63da0ef9cf5104f5fc67da44414) @ `b7ed82dbfba6e63da0ef9cf5104f5fc67da44414` | CC BY 4.0 | F16 (default), Q8_0, Q6_K, Q5_K, Q4_K |
| `haas-ja-v1.0` | [third-intelligence/Haas-ja-v1.0](https://huggingface.co/third-intelligence/Haas-ja-v1.0) @ `660728d39019e5e065046154beca44ac9a66a540` | [sakasegawa/Haas-ja-v1.0-GGUF](https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF/tree/6b965d5007ba780585de51549d57a8c1c0d67c7e) @ `6b965d5007ba780585de51549d57a8c1c0d67c7e` | Apache-2.0 | Q8_0 (default), F16, Q6_K, Q5_K, Q4_K |
| `nemotron-3.5-transcribe` | [nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B) @ `ef905575a106fdad904f3b0ce661dccad654607d` | [sakasegawa/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B-GGUF](https://huggingface.co/sakasegawa/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B-GGUF/tree/55d289085ed6b1acd1cfd2e6cf279fdeb32fee5f) @ `55d289085ed6b1acd1cfd2e6cf279fdeb32fee5f` | OpenMDW-1.1 | IQ4_NL (default), F16, Q8_0 |

## What was checked

- The license of every GGUF repository at its pinned revision (model card
  metadata and text) and of its upstream model. They agree for all seven. None
  is gated, needs a login or accepting terms on Hugging Face, or limits
  commercial use.
- Apache-2.0 (Qwen3-ASR, ReazonSpeech, Haas-ja). Redistribution would need the
  license and notices to go with the files. VRCT-VOX does not redistribute, and
  the review dialog links the model card and the license (Haas-ja: the
  `LICENSE` file in the repository).
- CC BY 4.0 (both Parakeet models). Sharing the model needs credit to NVIDIA, a
  link to the license and a note of changes. VRCT-VOX does not share the model.
  The review dialog links the license and tells the user what sharing the model
  needs. The license puts no condition on the recognized text.
- OpenMDW-1.1 (Nemotron 3.5 Transcribe). The same agreement as Nemotron 3
  Diarization, read on 2026-11-13 (`docs/voice-stack/licensing.md`, "話者分離モデル").
  It allows use without limits. Distribution must carry the agreement and the
  notices, and it puts no limit or duty on outputs. The repository holds the
  agreement with NVIDIA's copyright notice as `LICENSE`, and the dialog links it.
- Training data. ReazonSpeech v2 and Parakeet ja (its card lists the dataset)
  are trained on the ReazonSpeech corpus, which has terms of its own ("other" on
  Hugging Face). VRCT-VOX neither offers nor downloads the corpus. The model
  cards state Apache-2.0 and CC BY 4.0 for the models and add no conditions
  from the corpus.

## Left out

None of the seven names was left out for its license. Nemotron 3.5 Transcribe
is offered although its smallest file is 19.00 GB (18,997,225,856 bytes) and
it needs memory to match. Its notice says so before consent, and it is never
chosen by default.
