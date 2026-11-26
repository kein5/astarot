---
date: 2026-11-22
status: accepted
era: rust-core
validity: current
implementation_status: partial
implementation_checked: 2026-11-26
implementation_note: 接続の部品（native/talk-ai）、中核の設定、同意、音声、画面の送信（native/core/src/controller/talk_ai.rs）、設定の「おしゃべりAI」のページと送っている間の帯（src-ui）が入っている。Gemini Liveの部品は中核のカタログにまだ載っていない。マニュアルとライセンス台帳の文書（段階7）は、まだない。
evidence:
  - docs/adr/adr-018-talk-ai-through-external-services.md
  - docs/adr/adr-012-audio-ai-runtime-consolidation.md
  - docs/adr/adr-013-secret-store.md
  - native/talk-ai
  - native/core/src/controller/talk_ai.rs
  - src-ui/views/app/config_page/setting_section/setting_box/talk_ai/TalkAi.tsx
  - src-ui/views/app/others/talk_ai_indicator/TalkAiIndicator.tsx
---
# ADR-018: Talk AI connects to external conversation services, and the app does not run conversation models

[日本語版](#adr-018-おしゃべりaiは外部の対話サービスにつなぎアプリは対話のモデルを動かさない日本語版)

Decision owners: The repository's maintainers
Related: Issue #388, [ADR-012](adr-012-audio-ai-runtime-consolidation.md), [ADR-013](adr-013-secret-store.md), [ADR-015](adr-015-translation-llm-runtime-exception.md), [the license register](../voice-stack/licensing.md)
Status: Accepted (2026-11-22). The decision is recorded under "What was decided" in PR #969. Implementation proceeds from stage 1 (the connection component that talks in the OpenAI Realtime form).

In this ADR, "the app" means the app in this repository. Its display name is ASTAROT (ADR-011). The layout at the time of writing is that of 0.6.0, in which the Rust core runs inside the app process (`rust-core`).

## 1. Context

"Talk AI" in Issue #388 is a feature for talking with an AI by voice while showing it the screen. Uses include asking about what you are looking at and having the AI describe the screen by voice, and accessibility uses are expected as well. It needs to hear a voice and answer by voice, to let the user interrupt in the middle of a reply, and to accept images of the screen.

As of 2026-11-22, the services that meet these needs fall into two families:

- **Cloud realtime APIs**: OpenAI Realtime and Gemini Live. They handle audio input and output, image input and interruption over WebSocket. They are used with the user's API key.
- **Local models**: Qwen3-Omni (Apache-2.0) takes images and audio, answers with audio, and supports Japanese speech. Running it needs at least a GPU with video memory in the 24 GB class, and even quantized the model is 18 to 26 GB. The runtime that can run the whole pipeline is vLLM-Omni (Python), which has `/v1/realtime` in the same form as part of OpenAI Realtime.

ADR-012 gathered the inference of audio AI into speech.cpp and required an exception ADR to add an inference runtime specific to the app. Its table in 2.2 counted external translation services and LLM services as "connections to existing providers", and left the app responsible for consent, credentials, control of the data sent, and the handling of failures. Where Talk AI fits in this table depends on whether its counterpart runs inside the app or is an outside service the app connects to.

## 2. Decision

1. **The app does not run conversation models itself.** Talk AI's counterpart is an external conversation service that the app connects to.
   - **API family**: the app connects to cloud realtime APIs with the user's API key. The key is stored in the place set by ADR-013.
   - **Local family**: the app connects to a server that the user set up on their own PC or in their LAN (vLLM-Omni first). The app neither bundles nor downloads that server or the model. It gives guidance on the recommended models and on the hardware needed.
2. **This is not an exception to ADR-012.** It is treated the same as "external translation services and LLM services" in 2.2, and the way it connects follows the practice of the local LLMs for translation (LM Studio, Ollama) and of the external speech synthesis engines (ADR-008). Local destinations are limited to this PC and the LAN.
3. **The same communication form uses the same connection component.** OpenAI Realtime and the `/v1/realtime` of vLLM-Omni are spoken to by the same component. A service with a different form, such as Gemini Live, gets a component of its own.
4. **The app's responsibilities are those in 2.2 of ADR-012**: explicit consent before the screen and voice are sent outside, an indication that makes sending visible while it happens, control of the interval and size of the screen images sent, a stop that reliably ends sending, and control of the microphone and output routes.

## 3. Alternatives considered

| Option | What it is | Why it was not chosen |
|---|---|---|
| Bundle vLLM-Omni with the app | Put local inference in the distribution | The app would carry a whole Python runtime, which goes against the policy that stopped bundling Python in 0.6.0 (#285). The model is also 18 to 26 GB, beyond the size of what goes into a distribution |
| Run local conversation on llama.cpp (GGML) | The app runs a GGML derivative of MiniCPM-o | As of 2026-11-22, MiniCPM-o speaks only English and Chinese, so it cannot hold a spoken conversation in Japanese. No GGML support covers Qwen3-Omni including its audio output |
| Run it on ONNX Runtime | Put it on the same base as OCR and translation | There is no ONNX form that can run Qwen3-Omni's listening, seeing and speaking |
| Put a conversation model into speech.cpp | Gather it upstream, following the principle of ADR-012 | speech.cpp has no conversation model that takes images and audio and answers by voice. Adding one is not on a scale that fits upstream either, and it would not be ready in time for Issue #388. If a conversation model enters speech.cpp, this is reconsidered under 6 |

## 4. Consequences

- The distribution does not grow. No new runtime is added for the inference of conversation models, so the distribution, resource and maintenance burden of ADR-012 does not grow either.
- To use it locally, users need to set up a server themselves and provide a GPU in the 24 GB class. For that reason, the local catalog centers on guidance about the recommended models and the hardware needed.
- Cloud APIs may change their communication form. The connection component is protected by tests against a fake server, and follows changes in the form.
- The screen and voice leave the app. Consent, the indication while sending, and the control of the amount sent are built as the app's responsibility for every counterpart.
- Gemini Live is an API meant for server-to-server authentication, and it does not recommend direct use from clients. The app connects directly from the user's PC with the user's own key. This point is included in the explanation given to users.

## 5. Verification and acceptance criteria

| Aspect | What to check | How |
|---|---|---|
| No inference | The distribution contains no conversation model and no runtime for its inference | The distribution check (`tools/check_voice_distribution.py`) |
| Connection | Audio, images and interruptions make the round trip in the OpenAI Realtime form and in the Gemini Live form | Tests of the core and the crate against a fake server |
| Consent and indication | The screen and voice are not sent before consent or after a stop. While sending, an indication is shown | Tests of the core and of the screens |
| Local destinations | Plain-text connections go only to this PC and the LAN | The same destination check tests as for translation |

## 6. Revisit triggers

- When speech.cpp or ONNX Runtime can run a model that takes images and audio and answers in a Japanese voice with fewer resources than the 24 GB class. In that case, return to the principle of ADR-012 and evaluate running it inside the app.
- When vLLM-Omni drops its endpoint in the same form as OpenAI Realtime.
- When the recommended local models can no longer be recommended, for license or other reasons.

## 7. Open questions

The scope of the feature, the source the screen is captured from, the interval and size of what is sent, the output for the reply voice, and the models listed in the catalog are decided in Issue #388 and in "Decisions needed" in the PR of this ADR. What is decided is written in `docs/spec/`.

---

# ADR-018: おしゃべりAIは外部の対話サービスにつなぎ、アプリは対話のモデルを動かさない（日本語版）

Decision owners: リポジトリの保守担当者
Related: Issue #388、[ADR-012](adr-012-audio-ai-runtime-consolidation.md)、[ADR-013](adr-013-secret-store.md)、[ADR-015](adr-015-translation-llm-runtime-exception.md)、[ライセンス台帳](../voice-stack/licensing.md)
Status: 採用（2026-11-22）。決定は PR #969 の「決まったこと」に記録した。実装は段階 1（OpenAI Realtime の形で話す接続の部品）から進める。

この ADR の「アプリ」は本リポジトリのアプリを指す。表示名は ASTAROT（ADR-011）である。書いた時点の構成は、Rust の中核がアプリのプロセスの中で動く 0.6.0 の構成（`rust-core`）である。

## 1. Context（背景）

Issue #388 の「おしゃべりAI」は、画面を見せながら、声で AI と話す機能である。見ているものについて聞く、画面の様子を声で説明してもらう、といった使い方で、アクセシビリティの用途も見込む。声を聞いて声で返し、話の途中で割り込めることと、画面の絵を受けられることが要る。

2026-11-22 の時点で、これを満たす相手は次の 2 つの系に分かれる。

- **クラウドのリアルタイム API**: OpenAI Realtime と Gemini Live。WebSocket の上で、音声の入出力、画像の入力、割り込みを扱う。利用者の API キーで使う。
- **ローカルのモデル**: Qwen3-Omni（Apache-2.0）は、画像と音声を受けて音声で返し、日本語の音声に対応する。動かすには、ビデオメモリーが 24GB 級の GPU が最低ラインで、量子化してもモデルは 18〜26GB ある。全工程を回せる実行基盤は vLLM-Omni（Python）で、OpenAI Realtime の一部と同じ形の `/v1/realtime` を持つ。

ADR-012 は、音声 AI の推論を speech.cpp に集め、アプリ固有の推論ランタイムを足すには例外の ADR を要るとした。2.2 の分担の表は、外部の翻訳サービスと LLM のサービスを「既存のプロバイダの接続」とし、アプリには同意、認証情報、送るデータの制御、失敗したときの扱いを残した。おしゃべりAIの相手をアプリの中で動かすか、外のサービスにつなぐかで、この表のどこに入るかが変わる。

## 2. Decision（決定）

1. **アプリは、対話のモデルを自分では動かさない。** おしゃべりAIの相手は、外部の対話サービスにつないで使う。
   - **API 系**: クラウドのリアルタイム API に、利用者の API キーでつなぐ。キーは ADR-013 の置き場所に保存する。
   - **ローカル系**: 利用者が自分の PC か LAN の中で立てたサーバー（まず vLLM-Omni）につなぐ。アプリは、そのサーバーもモデルも同梱せず、取得もしない。推奨のモデルとハードウェアの目安を案内する。
2. **これは ADR-012 の例外ではない。** 2.2 の「外部の翻訳サービスと LLM のサービス」と同じ扱いで、つなぎ方は翻訳のローカル LLM（LM Studio、Ollama）や外部の音声合成エンジン（ADR-008）の作法にそろえる。ローカルの接続先は、この PC と LAN の中にする。
3. **同じ通信の形には、同じ接続の部品を使う。** OpenAI Realtime と vLLM-Omni の `/v1/realtime` は同じ部品で話す。Gemini Live のように形の違うものは、それぞれに部品を足す。
4. **アプリが持つ責務は、ADR-012 の 2.2 のとおりである。** 画面と声を外に送る前の明示の同意、送っている間それと分かる表示、送る画面の間隔と大きさの制御、止めると確実に送らなくなること、マイクと出力の経路の制御である。

## 3. Alternatives considered（検討した案）

| 案 | 中身 | 採らなかった理由 |
|---|---|---|
| vLLM-Omni をアプリに同梱する | ローカルの推論を配布物に入れる | Python の実行環境ごと抱えることになり、0.6.0 で Python の同梱をやめた方針（#285）に逆行する。モデルも 18〜26GB あり、配布物に入れる規模ではない |
| llama.cpp 系（GGML）でローカルの対話を動かす | MiniCPM-o の GGML の派生をアプリが動かす | 2026-11-22 の時点で、MiniCPM-o の音声は英語と中国語だけで、日本語の音声対話ができない。Qwen3-Omni の音声出力まで含めた GGML の対応はない |
| ONNX Runtime で動かす | OCR と翻訳と同じ基盤に載せる | Qwen3-Omni の聞く、見る、話すを回せる ONNX の形がない |
| speech.cpp に対話のモデルを入れる | ADR-012 の原則どおり上流に集める | speech.cpp には、画像と音声を受けて声で返す対話のモデルがない。上流に入れる規模でもなく、Issue #388 の時期に間に合わない。対話のモデルが speech.cpp に入ったら、6 で見直す |

## 4. Consequences（影響）

- 配布物は大きくならない。対話のモデルの推論のために新しいランタイムを足さないので、ADR-012 の配布、資源、保守の負担も増えない。
- ローカルで使うには、利用者が自分でサーバーを立て、24GB 級の GPU を用意する必要がある。そのため、ローカル系のカタログは、推奨のモデルとハードウェアの目安の案内が中心になる。
- クラウドの API は、通信の形が変わることがある。接続の部品は、偽のサーバーを相手にした試験で守り、形の変化に追随する。
- 画面と声がアプリの外へ出る。同意、送っている間の表示、送る量の制御は、どの相手でもアプリの責務として作る。
- Gemini Live は、サーバーからサーバーへの認証を想定した API で、クライアントから直接使うことを勧めていない。アプリは利用者自身のキーで、利用者の PC から直接つなぐ。この点は、利用者への説明に含める。

## 5. Verification / Acceptance criteria（検証と受け入れの条件）

| 観点 | 確かめること | 方法 |
|---|---|---|
| 推論を持たない | 配布物に対話のモデルと、その推論のランタイムが入っていない | 配布物の検査（`tools/check_voice_distribution.py`） |
| 接続 | OpenAI Realtime の形と Gemini Live の形で、音声、画像、割り込みが往復する | 偽のサーバーを相手にした中核とクレートの試験 |
| 同意と表示 | 同意の前と、止めたあとに、画面と声を送らない。送っている間は表示がある | 中核の試験と画面の試験 |
| ローカルの接続先 | 平文の接続はこの PC と LAN の中だけ | 翻訳と同じ接続先の検査の試験 |

## 6. Revisit triggers（見直す条件）

- speech.cpp か ONNX Runtime で、画像と音声を受けて日本語の声で返すモデルが、24GB 級より小さい資源で動くようになったとき。そのときは ADR-012 の原則に戻って、アプリの中で動かすことを評価する。
- vLLM-Omni が OpenAI Realtime と同じ形の接続口をやめたとき。
- 推奨のローカルのモデルが、ライセンスなどの理由で案内できなくなったとき。

## 7. 未決のこと

機能の範囲、画面の取り込み元、送る間隔と大きさ、応答の声の出し先、カタログに載せるモデルは、Issue #388 と、この ADR の PR の「判断が要ること」で決める。決まったものは `docs/spec/` に書く。
