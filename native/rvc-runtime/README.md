# rvc-runtime

Inference-only RVC voice conversion in Rust (issue #275; Phase 1: offline conversion,
Phase 2: streaming conversion, Phase 3: the application's voice changer).

The application runs it as `vrct-rvc-worker` (`src/bin/rvc_worker.rs`), a separate
process that replaces the external PyTorch runtime the voice changer used before. See
[Application worker](#application-worker-phase-3).

## What it does

| Stage (spec section) | Where | How |
|---|---|---|
| Voice model `.pth` (3.1, 3.2) | `src/pth.rs`, `src/model.rs` | Reads the zip + pickle checkpoint directly. The pickle reader only knows tensors, lists, dicts and numbers and refuses anything else, so a model file cannot run code. Half-precision weights are widened to `f32`. |
| Index `.index` (3.3, 7) | `src/index.rs` | Reads FAISS `IVF…,Flat` (what training writes) and flat L2 files; searches the `nprobe` closest lists like FAISS does. A trained-but-empty index is refused. |
| Input filter (4) | `src/filter.rs` | Fifth-order Butterworth high-pass at 48 Hz, applied forward and backward. |
| Splitting long input (4) | `src/pipeline.rs` | Cuts at the quietest point near every interval, with reflected padding. |
| F0 (5) | `src/f0.rs`, `src/backend.rs` | Log-mel front end and salience decoding here; the RMVPE network runs on ONNX Runtime. Extractors sit behind the `F0Estimator` trait. |
| HuBERT features (6) | `src/backend.rs` | ONNX Runtime; one graph gives both the v2 (768) and the v1 (256) features. |
| Blend, protect, ×2 (7, 8) | `src/index.rs`, `src/pipeline.rs` | |
| Synthesizer (9) | `src/synth.rs`, `src/onnx.rs` | The VITS + NSF network is built as an ONNX graph from the model's own weights at load time, for v1/v2, with or without F0, at any upsampling layout. |
| Noise and seed (9.2, 13.2) | `src/noise.rs` | All randomness is generated here and fed to the graph, so a seed fixes the output. |
| Loudness mix, resampling, peak limit (10) | `src/audio.rs` | |
| Synthesizer window (9.3) | `src/synth.rs`, `src/backend.rs` | `Synthesizer::synthesize_window`: the prior encoder sees the whole window, the flow starts 24 frames before `skip_head`, and only `return_length` frames are decoded. Offline conversion uses the same graph over the whole range. |
| Streaming (12) | `src/stream.rs` | `Stream`: fixed blocks of 16 kHz input, one block of output at the model's rate per call. See [Streaming](#streaming-spec-section-12). |
| Causal input filter (12) | `src/filter.rs` | `CausalFilter`: the same Butterworth run forward twice, keeping its memory between blocks. |
| HuBERT graph from the checkpoint (6) | `src/hubert.rs` | `FeatureExtractor::from_checkpoint`: the Transformers-format `hubert_base` folder (`config.json`, `pytorch_model.bin`) is read with the same pickle reader and turned into the same graph `export_hubert_onnx.py` exports, so no exported file has to be distributed. |
| Streaming rate conversion | `src/audio.rs` | `StreamResampler`: the Kaiser-windowed sinc of `resample`, made causal by a fixed delay (2.1 ms at 48 to 16 kHz, 0.9 ms at 40 to 48 kHz). |
| Application worker | `src/bin/rvc_worker.rs` | The live-VC pipe contract of the application around `Stream`. |

Not implemented: formant shift, and F0 extractors other than RMVPE.

## Assets

The two fixed networks are data, not code, and are not part of this repository.

| File | Source | Licence |
|---|---|---|
| `rmvpe.onnx` | `lj1995/VoiceConversionWebUI` on Hugging Face (pinned revision and SHA-256 in `reference/setup_reference.py`) | MIT |
| `hubert.onnx` | Exported by `reference/export_hubert_onnx.py` from the Transformers-format `hubert_base` of the same repository, with the stock `transformers.HubertModel` | MIT (repository); the upstream ContentVec/HuBERT terms must be confirmed before bundling (spec section 14) |

The application does not bundle them. Its runtime setup fetches `hubert_base`'s
`config.json` and `pytorch_model.bin` and `rmvpe.onnx` after the user's consent, from the
pinned revision above, and the worker builds the HuBERT graph from the checkpoint
(`FeatureExtractor::from_checkpoint`); `hubert.onnx` is only used by the tests. Sources and
licences are recorded in `docs/voice-stack/licensing.md`.

## Use

```sh
cargo run --release --bin rvc-infer -- \
  --model voice.pth --index voice.index \
  --hubert hubert.onnx --rmvpe rmvpe.onnx \
  --input in.wav --output out.wav --seed 1
```

`--seed` makes the output reproducible; without it every run draws new noise, like the
reference. `rvc-infer` prints timings only. The library reports errors without audio or
text content, and nothing in it logs samples.

Streaming conversion of a file, block by block, with the processing time of every block:

```sh
cargo run --release --bin rvc-stream -- \
  --model voice.pth --index voice.index \
  --hubert hubert.onnx --rmvpe rmvpe.onnx \
  --input in.wav --output out.wav --block-ms 250 --extra-ms 2500
```

It feeds the blocks back to back rather than at the pace of a live input and prints the
per-block time, the real-time factor and how many blocks took longer than they last.

ONNX Runtime is downloaded by the `ort` crate at build time (feature `download-binaries`,
on by default). `--features cuda` selects the CUDA provider. The provider needs cuDNN 9 at
run time, found through the library path. If the provider cannot start (no GPU or driver,
a missing CUDA or cuDNN library), loading now fails with `Error::DeviceUnavailable`
instead of ONNX Runtime's silent fall back to the CPU; operators the provider lacks still
run on the CPU.

| Feature | What it does |
|---|---|
| `download-binaries` (default) | links the ONNX Runtime build `ort` downloads; tests and the two tools above |
| `cuda` | the CUDA execution provider |
| `load-dynamic` | no ONNX Runtime at build time: `backend::load_runtime(path)` loads `libonnxruntime.so` / `onnxruntime.dll` at run time |
| `worker` | `load-dynamic` + `cuda`, and the `vrct-rvc-worker` binary |

`backend::set_intra_threads(Some(n))` limits each session's CPU thread pool (ONNX Runtime's
default is one thread per physical core and ignores the process's CPU affinity);
`rvc-infer` and `rvc-stream` do not expose it yet, the worker does (`--threads`).

## Verification

`cargo test` runs three groups:

- **Unit and offline tests** need nothing but the repository. `tests/data` holds tiny
  voice models with random weights, the reference's output for them and a small FAISS
  index (written by `reference/make_test_data.py`; no trained weights, no recordings).
- **Conformance tests** (`tests/conformance.rs`) compare against the reference
  implementation and report themselves as skipped until the fixtures exist.
- **Streaming conformance tests** (`tests/streaming.rs`) compare block by block against
  the reference's real-time engine, with fixtures from `reference/dump_streaming.py`, and
  are skipped the same way.

To reproduce the conformance run (about 2.6 GB under `~/.cache/vrct-vox/rvc-reference`,
or `RVC_REFERENCE_DIR`; needs `uv`):

```sh
python native/rvc-runtime/reference/setup_reference.py          # pinned engine, weights, model, clip, venv
REF=~/.cache/vrct-vox/rvc-reference
$REF/venv/bin/python native/rvc-runtime/reference/export_hubert_onnx.py
$REF/venv/bin/python native/rvc-runtime/reference/dump_reference.py
$REF/venv/bin/python native/rvc-runtime/reference/dump_streaming.py   # after dump_reference.py
cd native/rvc-runtime && RVC_REQUIRE_REFERENCE=1 cargo test -- --nocapture   # METRIC lines
```

What is downloaded, all pinned by SHA-256:

- the reference engine at the commit the application already pins (`81eed5e8…`), run on
  the CPU in single precision;
- a real v2 / 48 kHz / F0 voice model with its index: *Saisho Utane* (CC BY 4.0), the
  model in the application's catalogue;
- a real v2 / 40 kHz / F0 model: the published `pretrained_v2/f0G40k.pth` base generator
  (MIT), saved as an inference model by `dump_reference.py` with its weights unchanged;
- a 3.4 s speech clip from the VOiCES corpus (CC BY 4.0), 16 kHz mono, used by the
  conformance tests, and a 7 s LibriSpeech utterance (CC BY 4.0) for the listening set;
- random-weight models for v1/v2 × F0/no-F0 × 32/40/48 kHz, generated locally.

The reference is driven as a black box: the scripts call its public entry points and
record the values that cross them.

### Results

Measured on 2026-11-15, Linux, AMD Ryzen 9 9900X, CPU execution, ONNX Runtime 1.31 via
`ort` 2.0.0-rc.15, reference on PyTorch 2.11.0 (CPU, fp32). These are measurements of
this machine, not guarantees.

| Check (spec 13.1) | Result |
|---|---|
| Input filter and padding | max abs error 2.8e-8 |
| HuBERT features, v2 / v1 | relative error 1.8e-6 / 1.7e-6, cosine similarity 1.0000000 (min over frames) |
| RMVPE F0 | voicing agreement 100 % (941 and 5271 frames); cents error mean 0.016, max 0.08 (max 4.5 on the long input) |
| Quantised pitch from the reference F0 | identical |
| Quantised pitch end to end | 1 of 941, 0 of 941, 0 of 5271 frames differ, never by more than one step |
| Index search (88 024 vectors) | same neighbours in the same order in 469 / 469 frames; distance relative error ≤ 4.9e-7 |
| Blended features | relative error 9.0e-8 |
| Synthesizer input features, end to end | relative error ≤ 1.9e-6 |

| Check (spec 13.2) | Result |
|---|---|
| Synthesizer, noise off, reference inputs: trained v2 48 kHz / 40 kHz | SNR 89.6 – 91.0 dB / 86.1 dB |
| Same, random weights (v1/v2, F0/no-F0, 32/40/48 kHz) | SNR 122 – 132 dB |
| Whole pipeline, noise off, random weights | SNR 70 – 97 dB |
| Whole pipeline, noise off, trained models | SNR 13 – 18 dB sample by sample; 86 – 91 dB once the reference's pitch track is substituted (see below) |
| Long input (110 s, split thresholds 1/6/38/41 s) | same cut position and piece lengths as the reference |
| Loudness mix 0.25 + resampling 48 → 44.1 kHz on the reference's synthesizer output | SNR 81.7 dB |
| Seeded noise | same seed gives identical samples; another seed changes them |
| Seeded noise, log-spectral distance to the reference | 6.91 dB and 7.90 dB, against 6.87 dB and 7.97 dB between two seeds of the reference itself |
| Seeded noise, F0 of the output against the reference's output | voicing agreement 98.8 % / 95.6 %, mean cents error 4.2 / 5.6 (reference against itself: 98.8 % / 99.1 %, 5.8 / 5.4) |

On the trained-model line: a trained source filter follows the excitation phase, and the
phase is the integral of the pitch. Our F0 differs from the reference's by 0.016 cents on
average, which is enough to move the waveform: shifting the *reference's own* pitch input
by 0.02 cents drops its SNR against itself to 10 – 15 dB. With the reference's pitch track
and our own features the output agrees to 86 – 91 dB. So the remaining sample-level
difference is that pitch difference, not the synthesizer.

The 40 kHz output F0 agreement (95.6 % against 99.1 %) looked worse than the reference's
own seed-to-seed spread with a single seed. Measured over four seeds in the objective
comparison below, it is within that spread.

**Listening (spec 13.2), 2026-11-15:** the maintainer listened to the four public cases
below in a browser and could not tell the Rust output from the reference; all four were
judged the same voice and phrasing. ABX trial counts were not recorded.

**Not verified:** listening with v1, 32 kHz or F0-less models (no public model was
available, see below); performance against the current external runtime (13.3) has
not been measured; fp16 and CUDA have not been run; no real v1, 32 kHz or F0-less voice
model was available, so those variants are verified with random weights and, for v1, the
HuBERT v1 features.

### Listening comparison (spec 13.2)

The numbers above cannot stand in for listening. `reference/make_listening_set.py`
prepares a blind comparison:

```sh
$REF/venv/bin/python native/rvc-runtime/reference/make_listening_set.py
# your own models and recordings (kept local, never uploaded or committed):
$REF/venv/bin/python native/rvc-runtime/reference/make_listening_set.py \
  --voice my_v1.pth my_v1.index --voice my_32k.pth --input me.wav --transpose 0 --transpose 12
```

For every model and input it converts the same 16 kHz audio three times with the same
settings: the reference with two different noise seeds and this runtime. It then writes
`$REF/listening/index.html`, an ABX page (Japanese) with the audio embedded in it. Open
it in a web browser; an editor's built-in preview may show the page without playing
sound. `--page-only` rebuilds the page from an existing set without converting again.

- Each trial plays A, B and X, where X repeats one of the two, and asks which. Which
  pair is on screen and which side is the reference are hidden and random.
- Half of the trials are the control "reference against reference with another seed".
  Synthesis noise makes any two runs differ a little, so the control shows how well
  that alone can be heard; "reference against Rust" is read against it.
- After the trials, each model gets the specification's question: do the two sound like
  the same voice with the same phrasing?
- The result (correct answers per pair with a binomial p value, and the judgements) can
  be saved as JSON for the pull request.

Without arguments the set holds the two public models and two public clips (the VOiCES
clip and a LibriSpeech utterance, both CC BY 4.0): four cases, 48 trials. The
specification asks for v1/v2, 32/40/48 kHz and with/without F0; the public set covers v2
with F0 at 40 and 48 kHz only, so the other variants need models passed with `--voice`.

### Objective comparison

`reference/objective_compare.py` measures what the listening test asks, with models
pinned in `setup_reference.py` (about 1.4 GB more):

| Question | Measure |
|---|---|
| Same voice? | speaker-embedding cosine similarity (SpeechBrain ECAPA-TDNN, VoxCeleb; Apache-2.0) |
| Same phrasing? | character error rate between Whisper-small transcripts (Apache-2.0), and against the input's transcript |
| As natural? | TorchAudio-Squim subjective MOS estimate |
| Same timbre? | MFCC distortion (mel-cepstral distortion formula on MFCCs), log-spectral distance |
| Same intonation? | F0 voicing agreement and pitch difference in cents (RMVPE) |
| Same level? | RMS level difference |

Synthesis noise is random, so every model and input is converted with four seeds by
both implementations. A measure passes when "runtime against reference" is no further
apart than the reference's own seeds are from each other (for the per-output measures:
the runtime's mean lies within the reference's range widened by half of it).

```sh
$REF/venv/bin/python native/rvc-runtime/reference/objective_compare.py --language en
# your own models and recordings (kept local):
$REF/venv/bin/python native/rvc-runtime/reference/objective_compare.py --voice my.pth my.index --input me.wav --language ja
```

It writes `$REF/objective/report.md` and `report.json`. Transcripts are only used for
the error rates and are neither printed nor stored.

Results (2026-11-15, same machine, CPU; the two public models × the two public clips,
seeds 7–10). Each cell gives the lowest and highest per-case mean over the four cases.

| Measure | Reference against reference | Runtime against reference | Within the spread |
|---|---|---|---|
| Speaker similarity (cosine) | 0.915 – 0.965 | 0.915 – 0.970 | 4 / 4 |
| CER between transcripts | 0.000 – 0.036 | 0.000 – 0.027 | 4 / 4 |
| MFCC distortion | 21.616 – 30.184 | 21.556 – 30.430 | 4 / 4 |
| Log-spectral distance (dB) | 7.031 – 7.936 | 7.044 – 7.933 | 4 / 4 |
| F0 voicing agreement | 0.948 – 0.989 | 0.947 – 0.990 | 4 / 4 |
| F0 difference (cents, median) | 2.504 – 2.857 | 2.444 – 2.894 | 4 / 4 |
| Level difference (dB) | 0.099 – 0.338 | 0.088 – 0.361 | 4 / 4 |
| Squim MOS estimate | 3.760 – 4.450 | 3.741 – 4.426 | 4 / 4 |
| CER against the input transcript | 0.000 – 0.030 | 0.000 – 0.027 | 4 / 4 |

36 of 36 measures are within the reference's own spread. For the per-output measures (MOS and
CER against the input) the columns compare the outputs of each implementation rather than pairs.
The MFCC distortion uses librosa MFCCs, so its values are not comparable with published
mel-cepstral distortion figures; only the comparison between the columns is meaningful.
With four seeds, the 40 kHz voicing agreement that looked low in the single-seed
conformance test (95.6 % against 99.1 %) is within the reference spread (0.947 – 0.965
against 0.948 – 0.955).

### Speed and memory (same machine, CPU)

| Input | Time | Peak memory |
|---|---|---|
| 3.4 s, v2 40 kHz | 1.2 s (RTF 0.35) plus 0.8 s to load | 1.7 – 2.0 GiB |
| 3.4 s, v2 48 kHz with index | 1.3 s (RTF 0.39) plus 1.0 s to load | 2.1 GiB |
| 60 s in one piece, v2 40 kHz | 9.0 s (RTF 0.15) | 6.0 GiB |

Memory grows with the square of the piece length (self-attention at 100 frames per
second). `Chunking` defaults to the reference's values for a capable GPU (3 / 10 / 60 /
65 s); smaller `center` and `max` bound the memory.

## Streaming (spec section 12)

`Stream` converts fixed blocks of 16 kHz audio. Lengths are whole 10 ms frames (`Layout`):

| Setting | Default | Meaning |
|---|---|---|
| `block` | 25 (0.25 s) | audio per call |
| `crossfade` | 5 (0.05 s) | crossfade between consecutive blocks |
| `search` | 1 (0.01 s) | how far the crossfade position is searched |
| `extra` | 250 (2.5 s) | left context the synthesizer sees but does not return |

The defaults are the reference real-time GUI's. Each call moves a window of
`extra + crossfade + search + block` frames by one block and then:

1. filters the new block with the causal high-pass (`highpass`, on by default);
2. takes content features over the whole window, repeats the last frame, blends with the
   index from frame `extra / 2` on, and doubles to 100 fps;
3. extracts pitch from the newest `block + 800` samples (rounded up to 5120 − 160 for
   RMVPE), interpolates, transposes and quantises it, moves the pitch history by one block
   and writes the extractor's frames `[3, n − 1)` over its last `n − 4` frames;
4. synthesizes `block + crossfade + search` frames after `extra` frames of context;
5. joins the result to the previous block: the start of the new audio is compared with the
   kept tail at every offset within `search`, the offset with the highest normalised
   cross-correlation is taken, and the two are crossfaded with a squared-sine curve.

All buffers and the pitch history start at zero, as in the reference. Output appears
`block + crossfade + search` after the input (0.31 s with the defaults), plus the
processing time.

### Against the reference's real-time engine

`reference/dump_streaming.py` drives the reference's real-time engine (`infer.rtrvc.RVC`)
block by block with all noise zero, and records each block's window, features, pitch
history, synthesizer inputs and output. The synthesizer window is also checked on its own
against the reference synthesizer's `infer(…, skip_head, return_length)`.
Measured on 2026-11-15, same machine and setup as above (CPU, fp32):

| Check | Result |
|---|---|
| Synthesizer window, reference inputs (trained 48 / 40 kHz; random v1 F0, v2 F0-less; flow starting inside and after the context) | SNR 102 – 114 dB trained, 130 – 132 dB random |
| Same, tiny committed models (no download) | relative error < 1e-4 |
| Window contents, 13 blocks × 3 models | identical |
| Content features | relative error ≤ 5.9e-6 |
| Synthesizer input features (after repeat, blend, doubling) | relative error ≤ 6.1e-6 |
| Quantised pitch history | identical (0 of 1703 frames differ); continuous pitch 0.015 cents mean, 0.05 max |
| Synthesizer output per block, F0-less random model | SNR ≥ 131 dB |
| Synthesizer output per block, trained models | worst block SNR 38.3 dB (40 kHz) and 40.6 dB (48 kHz); 102 dB and 100 dB with the reference's synthesizer inputs (the remaining difference is the pitch difference explained above) |

### Against offline conversion

The stream's output, delayed by `crossfade + search`, compared with offline conversion of
the same 3.4 s clip (48 kHz model with index, protect off, noise zero, the first second
left out). Log-spectral distance is dominated by the quiet parts of the spectrum, so the
reference's own real-time output (its per-block output joined with the same crossfade) is
the yardstick:

| Stream | Log-spectral distance to offline |
|---|---|
| Reference real-time engine, 0.25 s blocks, 1 s context, no filter | 7.50 dB |
| Runtime, same layout, no filter | 7.50 dB |
| Runtime, same layout, causal filter | 7.65 dB |
| Runtime, 0.25 s blocks, 2.5 s context, causal filter | 7.34 dB |
| Runtime, 0.5 s blocks, 2.5 s context, causal filter | 7.29 dB |

The causal filter has the same magnitude response as the zero-phase one; on the clip the
filtered signals differ by 0.83 dB log-spectral distance, while their waveforms do not line
up (SNR 0.2 dB), because two forward passes still turn the phase by about a radian at
500 Hz.

### Speed

`rvc-stream` on a 31 s speech file (the two public clips, three times over), seed 1,
blocks fed back to back after three untimed warm-up blocks. The real-time factor is a
block's processing time over its duration; it must stay below 1 for every block.

Measured 2026-11-15 on the same machine (AMD Ryzen 9 9900X, 12 cores / 24 threads;
NVIDIA GeForce RTX 4080 SUPER, driver 620.70, CUDA 13, cuDNN 9.26 from the library path).
**The machine was heavily loaded by unrelated work during the run: load average 23 – 30
on 24 hardware threads**, from other jobs using several cores each. The CPU figures are
therefore pessimistic and are not this machine's unloaded speed; the CUDA figures are less
affected but not free of it either. Repeat on an idle machine before drawing conclusions.

| Device | Model | Block / extra | Per block mean / p95 / max | RTF mean / p95 / max | Blocks over time |
|---|---|---|---|---|---|
| CPU | 48 kHz + index | 0.25 s / 2.5 s | 290 / 340 / 393 ms | 1.16 / 1.36 / 1.57 | 122 of 125 |
| CPU | 48 kHz + index | 0.25 s / 1.0 s | 203 / 229 / 266 ms | 0.81 / 0.92 / 1.06 | 2 of 125 |
| CPU | 48 kHz + index | 0.5 s / 2.5 s | 347 / 393 / 417 ms | 0.69 / 0.79 / 0.83 | 0 of 62 |
| CPU | 40 kHz | 0.25 s / 2.5 s | 253 / 304 / 342 ms | 1.01 / 1.22 / 1.37 | 62 of 125 |
| CUDA | 48 kHz + index | 0.25 s / 2.5 s | 37 / 56 / 64 ms | 0.15 / 0.23 / 0.26 | 0 of 125 |
| CUDA | 48 kHz + index | 0.1 s / 2.5 s | 34 / 52 / 96 ms | 0.34 / 0.52 / 0.96 | 0 of 313 |
| CUDA | 48 kHz + index | 0.1 s / 1.0 s | 34 / 55 / 81 ms | 0.34 / 0.55 / 0.81 | 0 of 313 |
| CUDA | 40 kHz | 0.25 s / 2.5 s | 25 / 48 / 64 ms | 0.10 / 0.19 / 0.26 | 0 of 125 |

Under this load, CUDA stays within real time in every layout tried, down to 0.1 s blocks
(0.16 s latency plus processing). The CPU meets RTF < 1 for every block only with 0.5 s
blocks; with the reference GUI's defaults it does not. A stage-by-stage timing on the same
loaded machine put the cost of a 0.25 s block at about 100 ms for content features over the
2.8 s window, 20 ms for pitch, 80 – 100 ms for the synthesizer (almost all of it the decoder
for 0.31 s of 48 kHz audio) and 3 ms for the index.

Not measured: an idle machine, weaker CPUs, and CPU thread limits. ONNX Runtime ignores
the process's CPU affinity (it started 70 threads under `taskset -c 0-3`), so restricting
cores with `taskset` would over-subscribe them and say little about a smaller CPU; a
measurement on weaker hardware needs a thread-count setting (added in Phase 3:
`backend::set_intra_threads`; not yet measured on the CPU). The CUDA output was not
compared against the CPU output.

### Where streaming differs from the reference's real-time GUI

These follow the specification's wording or are left to it; each is a setting or a
small change if the specification decides otherwise.

- **Crossfade length.** The specification says 0.05 s. The reference GUI sizes its window
  with the crossfade setting but caps the fade itself at 0.04 s. The runtime fades over the
  whole `crossfade`.
- **Search range.** The specification says "one block"; the reference searches one 10 ms
  frame, which is what the runtime does by default (`search: 1`). Searching a whole block
  (0.25 s) would let a block start up to 0.25 s early or late.
- **Sample rate of the crossfade.** The reference crossfades at the sound device's rate,
  after resampling; the runtime at the model's rate. Device rates belong to Phase 3.
- **Input filter.** The reference's real-time path has no high-pass; the specification
  asks for one, so the causal filter is on by default (`highpass: false` matches the
  reference).
- **Protect.** The reference's real-time engine has no protect, and neither has `Stream`.
- **Index lookups with missing neighbours.** The reference skips the blend for the whole
  block when any frame gets fewer than eight neighbours; the runtime blends each frame
  with the neighbours it found, as offline conversion does. This only happens with very
  small index lists.
- **Not included:** the GUI's input gate, loudness mix, noise reduction, phase vocoder,
  formant shift, and device input and output.

## Application worker (Phase 3)

`vrct-rvc-worker` is what the application starts for the voice changer. It speaks the
application's fixed live-VC pipe contract (`src-python/models/voice_conversion/protocol.py`,
"VVC1"): a `ready` packet, or a `failed` packet with a fixed code, then one `output` packet
of 80 ms of 48 kHz mono 16-bit audio for every `input` packet. The owner, the Linux launch
helper (`native/vc-worker`, mode `rvc-native`), the router process, the managed sink, mute
and the speech-through-conversion path are the same as with the external runtime.

```sh
python tools/build_rvc_worker.py   # cargo build --no-default-features --features worker → build/vrct-rvc-worker
vrct-rvc-worker --runtime <dir> --model voice.pth --session <32 hex> [--index f.index] [--pitch n] [--index-rate r] [--device auto|cuda|cpu]
vrct-rvc-worker --runtime <dir> --probe [--device cuda|cpu|auto]   # exit 0 runs; 3 the GPU cannot be used (auto: the CPU can); 4 broken
```

- **Runtime folder** (set up by `src-python/models/voice_conversion/runtime_setup.py` after
  consent). On a PC with an NVIDIA driver: `lib/` holds ONNX Runtime 1.31.0 (CUDA 13 build,
  Microsoft's release) with CUDA 13.4 Update 1 and cuDNN 9.26 (NVIDIA's PyPI wheels; driver
  580 or later; the provider has kernels for sm_75 to sm_120, Turing and later). Without
  one: only ONNX Runtime's CPU build. `assets/` holds `hubert_base` and `rmvpe.onnx`. The
  worker loads the CUDA libraries from `lib/` itself, then ONNX Runtime, so nothing depends
  on the system's library path.
- **Where it converts** (`--device`, default `auto`): on the GPU when the runtime has the
  CUDA provider, its libraries load and a CUDA session runs; otherwise on the CPU. The
  `ready` packet says which (`profile`: `low` for the GPU as before, `cpu`) and the delay
  the worker adds (`latency_ms`); the application shows both. `--device cuda` keeps the
  strict form (`vc_gpu_unavailable`). Missing or broken libraries are
  `vc_runtime_incomplete`.
- **GPU layout**: the external runtime's profile: 80 ms blocks, 40 ms crossfade searched
  over 10 ms, 2 s of context (`Layout { block: 8, crossfade: 4, search: 1, extra: 200 }`),
  every packet converted before it is answered. Added delay 52 ms (crossfade, search and
  the two rate conversions).
- **CPU layout**: 0.5 s blocks, 50 ms crossfade, 10 ms search, 2.5 s of context, the only
  layout of the Phase 2 measurements in which every CPU block took less time than it lasts.
  The blocks are converted on a thread of their own; every packet is answered at once from
  what that thread finished, a fixed 14 packets (1.12 s) later, which leaves a whole block's
  time for converting each block. Added delay 1182 ms. Until the first converted audio is
  due, the answers are silence (`vad_silence`). A block that comes after its place was
  answered is dropped, and when more than three blocks of input wait, the oldest is dropped
  unconverted. When more than half of the last eight blocks were late or dropped, the
  worker sends `failed` with `vc_capture_overrun` instead of the next answer and stops, as
  the owner stops a GPU worker that falls behind.
- Both: index blend from the user's index rate, speaker 0, random synthesis noise; the
  input high-pass of the specification is on (`--highpass off` matches the external runtime,
  for measurements); 48 kHz to 16 kHz in and the model's rate to 48 kHz out with
  `StreamResampler`.
- **CPU threads** per session (`--threads` overrides): 1 with CUDA; on the CPU half the
  logical CPUs, from 2 to 6 (measurements below).
- Before `ready`, three blocks of a test tone (GPU) or one 0.5 s block (CPU) are converted
  and forgotten.

### Measurements (2026-11-15)

Same machine as above (Ryzen 9 9900X, RTX 4080 SUPER, driver 620.70), CUDA, the worker
driven through the application's contract module (`protocol.py`) with a 22.9 s speech file
(the two public clips, twice, with pauses), fed in real time. Load average 1 – 16 from
unrelated work during the runs. Round trip is the time from writing a block to reading its
output.

| Runtime | Model | Round trip mean / p95 / max | Over 80 ms | Ready after start |
|---|---|---|---|---|
| Rust worker (3 runs) | 48 kHz + index 0.75 | 27 – 36 / 49 – 54 / 61 – 114 ms | 0 – 1 of 286 | 3.1 – 4.8 s |
| External runtime (3 runs) | 48 kHz + index 0.75 | 28 – 45 / 39 – 61 / 45 – 89 ms | 0 – 2 of 286 | 5.6 – 8.1 s |
| Rust worker (3 runs) | 40 kHz | 22 – 28 / 45 – 49 / 48 – 55 ms | 0 of 286 | 2.1 – 4.1 s |
| External runtime (3 runs) | 40 kHz | 25 – 41 / 38 – 53 / 39 – 70 ms | 0 of 286 | 3.6 – 6.8 s |

Each line is the range of the per-run values; the runs of both runtimes alternated. "Ready"
is from start to the `ready` packet, which includes loading the model and the warm-up.

| Worker, 48 kHz + index, one run each | CPU (one core = 100 %) | Threads | Peak memory | Round trip mean |
|---|---|---|---|---|
| Rust, ONNX Runtime's default threads | 44 % | 77 | 2.1 GiB | 24.1 ms |
| Rust, 1 thread (the worker's default on CUDA) | 36 % | 8 | 2.2 GiB | 23.7 ms |
| Rust, 2 / 4 threads | 36 % / 38 % | 11 / 17 | 2.2 / 2.1 GiB | 24.3 / 24.9 ms |
| External runtime | 106 % | 62 | 2.9 GiB | 25.7 ms |

**CUDA 13 and the CPU (2026-11-15, later the same day).** The machine was busy with
unrelated jobs during all of these (load average 18 – 34 on 24 hardware threads), which made
every number slower than the ones above; read them against each other, not against those.

| Same load, alternating runs, 48 kHz + index | Round trip mean / p95 / max | Over 80 ms |
|---|---|---|
| Worker of the first commit with CUDA 12.8 (2 runs) | 64 – 66 / 102 – 108 / 121 – 144 ms | 70 of 286 |
| This worker with CUDA 13.4 (2 runs) | 64 – 65 / 106 / 136 – 172 ms | 62 – 76 of 286 |

So CUDA 13 converts as fast as CUDA 12 did; the slower round trip is the load.

CPU threads, the time to convert one 0.5 s block (48 kHz + index, 2.5 s of context) in the
worker, twelve blocks each, under that load:

| Threads | 2 | 4 | 6 | 8 | 12 | ONNX Runtime's default |
|---|---|---|---|---|---|---|
| Per block | 1.0 – 1.4 s | 0.71 – 0.97 s | 0.48 – 0.89 s | 0.70 – 1.00 s | 1.35 – 1.74 s | 2.3 – 3.0 s |

With every logical CPU busy, more threads only wait for each other; six was fastest. Under
this load no setting converted a block in less than its 0.5 s, so a live CPU conversion on
this machine at that time stopped with `vc_capture_overrun` after about four seconds. With
the input fed at 300 ms per packet instead of 80 ms (so the CPU keeps up), the worker
converted the whole 22.9 s file without a single late block: 14 silent packets at the start,
then 272 packets of voice, measured 1175 ms behind the input (envelope cross-correlation;
the `ready` packet said 1182 ms). The GPU worker measured 45 ms the same way (said 52 ms).
On the screen the delay is shown as the 80 ms block, plus `latency_ms`, plus the round
trip: about 0.2 s on the GPU and 1.3 s on the CPU.

Through the application's private PipeWire graph (`tests/platform/test_native_rvc_worker.py`,
20 s of continuous conversion, index rate 0 and 0.5, stop and worker kill): all four cases
passed; from the end of a captured block to its write to the managed sink 54 – 70 ms
(median), 77 ms at most; start to active 3.2 – 3.3 s; silent 76 – 88 ms after stop or kill.

**Against the external runtime's output.** Synthesis noise is random, so each runtime
converted the file three times and the measures of `reference/objective_compare.py` were
taken between pairs, after aligning the outputs (envelope cross-correlation, all within
4 ms). "Within" means the Rust-against-external mean lies within the external runtime's
spread against itself.

| Measure | 48 kHz + index: external spread | Rust against external | 40 kHz: external spread | Rust against external |
|---|---|---|---|---|
| Speaker similarity | 0.982 – 0.987 | 0.984 (within) | 0.982 – 0.984 | 0.981 (just below) |
| CER between transcripts | 0.000 – 0.009 | 0.012 | 0.026 – 0.044 | 0.026 (within) |
| MFCC distortion | 27.3 – 28.2 | 32.4 | 31.4 – 31.9 | 33.2 |
| Log-spectral distance (dB) | 7.51 – 7.65 | 8.49 | 8.17 – 8.23 | 11.68 |
| F0 voicing agreement | 0.964 – 0.974 | 0.955 | 0.970 – 0.974 | 0.973 (within) |
| F0 difference (cents) | 6.4 – 9.5 | 8.1 (within) | 5.8 – 6.2 | 8.3 |
| Level difference (dB) | 0.04 – 0.11 | 0.09 (within) | 0.05 – 0.16 | 0.09 (within) |
| Squim MOS estimate | 4.30 – 4.31 | 4.36 (higher) | 4.41 – 4.44 | 4.42 (within) |

So the voice, the words and the estimated naturalness are the same, but timbre and pitch
measures show a small systematic difference beyond the noise. What was ruled out and found:

- The Rust runs against each other spread as much as the external ones (40 kHz MFCC
  31.5 – 32.2), so the difference is between the implementations, not more noise.
- The external runtime runs in half precision on this GPU; forcing it to single precision
  stays within its own spread, so precision is not the cause. Turning the Rust input
  high-pass off does not close the gap either (40 kHz MFCC 32.95).
- Long-term spectra agree within 1 dB in every band up to 20 kHz. The 40 kHz LSD is mostly
  the 20 – 24 kHz band, which the external runtime's resampler fills at about −110 dB and
  `StreamResampler` leaves at about −133 dB; LSD weighs such quiet bins heavily.
- Against offline conversion of the same file (this crate, which matches the reference;
  40 kHz, protect off, three seeds), the Rust stream is closer than the external stream:
  MFCC distortion 40.6 against 41.1, F0 difference 8.2 against 9.9 cents, LSD 9.4 against
  12.4 dB. The remaining difference is more likely the external runtime's per-block
  resampling of 80 ms pieces than a fault of this runtime, but it has not been pinned down.

Decided by the maintainer (2026-11-15, PR #312): the live output was checked by ear and
accepted; Windows is accepted on the CI build without a check on a Windows PC.

Not done: other GPUs; a CPU conversion in real time on a machine that is not busy; long runs
under the mixed load of VRChat, TTS and captions; the GUI test with the real worker
(`tests/platform/test_native_rvc_ui.py`).

## Decisions on the specification's open questions (section 15)

1. **Reading `.pth`**: read directly, no import step. The reader is about 600 lines, runs
   no code from the file, and the synthesizer graph is built from the weights in under a
   second, so a converted format would add a cache to keep in sync and nothing else.
2. **Graphs**: three separate graphs. HuBERT and RMVPE are fixed and shipped as ONNX
   files; the synthesizer differs per voice model and is generated at load time. FAISS is
   replaced by an own reader and search: the tested index (88 024 × 768) scans one list
   of about 40 vectors per frame, which needs no library.
3. **Precision**: fp32 everywhere for now; half-precision model files are widened on
   load. The tolerances above are for fp32. fp16 execution is left for the GPU work.
4. **v1**: supported in the code (features, synthesizer, model reader) and verified with
   random weights; verification with a real v1 model is open.
5. **CPU**: offline conversion runs several times faster than real time on the test
   machine. Streaming on the test machine's CPU: see [Streaming](#streaming-spec-section-12).
   Weaker CPUs have not been measured (below). The application keeps the GPU requirement
   of the external runtime and does not convert on the CPU; a thread setting now exists
   (`backend::set_intra_threads`), so a CPU measurement on weaker hardware is possible.
6. **Formant shift**: not included.

Where the specification leaves a detail open, the behaviour was taken from black-box
comparison with the reference and is asserted by the conformance tests:

- The distance `d` in the blend weight `(1 / d)^2` is the value the index reports, which
  for these L2 indexes is the *squared* distance.
- The search is the index's own approximate search (the closest `nprobe` lists, `nprobe`
  read from the file), not an exhaustive one.
- Leading and trailing unvoiced frames take the nearest voiced F0.
- Quantised pitch rounds half to even.
- The excitation's phase rule (per-frame linear phase, carried across frames) and noise
  levels, which section 9.1 only names.
- The loudness mix uses the high-passed input.

Two things are deliberately left as they are: an exact index hit (`d = 0`) gives a
non-finite weight, as the formula says, and the input level is used as given. The
conformance runs enter the reference at its pipeline, as the specification describes it;
whether a caller should normalise the peak first is a question for the specification.

## Reimplementation discipline (spec section 14)

No reference source was copied or adapted. The network layout comes from the published
architectures (VITS, HiFi-GAN, NSF, HuBERT) and from the names and shapes of the tensors
in the model files; behaviour the specification does not pin down was determined by
running the reference and comparing numbers. The Python scripts under `reference/` only
call the reference through its entry points (found from their signatures); they are test
tooling and are not shipped.
