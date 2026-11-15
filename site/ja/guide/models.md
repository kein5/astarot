# モデルの取得

VRCT-VOXの配布物にはテキスト読み上げ・音声認識・ボイスチェンジャー・文字認識のモデルを入れていません。使うモデルは設定画面から取得するか、手元のファイルを指定します。手元のファイルの使い方は[自分のモデルを使う](./custom-models)にあります。

## 取得の流れ

1. 各ページの「既定モデルのダウンロード」で「取得内容を確認」を押します。「テキスト読み上げ（TTS）」と「音声認識（ASR）」では「モデルとサーバー」の中にあります。
2. 提供元、モデル名、正確な容量、利用条件へのリンク、保存先を確かめます。
3. 同意のチェックを入れて「同意してダウンロード」を押します。取得中は取り消せます。
4. 取得と確認が終わったら「モデルパスを適用」を押します。そのモデルを使うサーバーや機能は、先に止めておいてください。

![モデルの取得と利用条件を確かめる画面](/screenshots/ja/model-consent.webp)

取得しただけ、適用しただけでは、サーバーの起動、読み上げ、マイクの使用は始まりません。

::: info ファイルの確認
取得したファイルは容量とSHA-256を確かめてから使います。取得先はあらかじめ決めたHugging Faceのリポジトリと、その特定のバージョンだけです。
:::

## 取得できるモデル

| 用途 | モデル | 容量 | ライセンス |
|---|---|---|---|
| 日本語の読み上げ | Irodori-TTS v4.1 Small MF · F16 | 1.79 GiB | MIT + Apache-2.0 |
| 日本語の読み上げ（軽量） | Irodori-TTS v4.1 Small MF · Q8_0 | 1.12 GiB | MIT + Apache-2.0 |
| 日本語の読み上げ（MFなし） | Irodori-TTS v4.1 Small · F16 | 1.78 GiB | MIT + Apache-2.0 |
| 日本語の読み上げ（大型） | Irodori-TTS v4 Large · Q8_0 | 3.61 GiB | Gemma Terms of Use + MIT + Apache-2.0 |
| ほかの言語の読み上げ | Qwen3-TTS 12Hz 0.6B CustomVoice · Q8_0 | 1.13 GiB | Apache-2.0 |
| ほかの言語の読み上げ（軽量） | Qwen3-TTS 12Hz 0.6B CustomVoice · Q5_K | 0.81 GiB | Apache-2.0 |
| ほかの言語の読み上げ（大型） | Qwen3-TTS 12Hz 1.7B CustomVoice · Q8_0 | 2.13 GiB | Apache-2.0 |
| 音声認識（30言語） | Qwen3-ASR 0.6B · Q8_0 | 0.78 GiB | Apache-2.0 |
| 音声認識（30言語） | Qwen3-ASR 1.7B · Q8_0 | 2.03 GiB | Apache-2.0 |
| 音声認識（日本語） | ReazonSpeech v2 · Q8_0 | 0.62 GiB | Apache-2.0 |
| 音声認識（日本語） | Parakeet TDT-CTC 0.6B ja · Q8_0 | 0.62 GiB | CC BY 4.0 |
| 音声認識（ヨーロッパの25言語） | Parakeet TDT 0.6B v3 · F16 | 1.17 GiB | CC BY 4.0 |
| 音声認識（日本語） | Haas-ja v1.0 · Q8_0 | 0.61 GiB | Apache-2.0 |
| 音声認識（40言語。大きなモデル） | Nemotron 3.5 Transcribe 30B-A4B · IQ4_NL | 17.69 GiB | OpenMDW-1.1 |
| 話している区間の検出 | Silero VAD v6.2 · F32 | 1.2 MB | MIT |
| 話した人の見分け（任意） | Nemotron 3 Diarization · Q8_0 | 約106 MB | OpenMDW-1.1 |
| ボイスチェンジャー（RVC） | Saisho Utane · RVC v2 | 0.31 GiB | CC BY 4.0（クレジット表示が必要） |
| 文字認識 | PP-OCRv6 small（日本語・英語・中国語・ラテン文字） | 約30 MB | Apache-2.0 |
| 文字認識 | PP-OCRv5 mobile（韓国語・キリル文字・タイ文字・アラビア文字・デーヴァナーガリー） | 各8〜14 MB | Apache-2.0 |

日本語の読み上げは、最初の音がいちばん早く出るSmall MFが標準です。MFの付かないSmallとLargeは、最初の音が出るまで長く待ちます。Largeは文章を読む部分がGoogleのGemmaに由来するので、[Gemmaの利用規約](https://ai.google.dev/gemma/terms)と禁止用途のポリシーに従います。

音声認識のモデルはアプリに入っているspeech.cppが扱うものをすべて選べます。表の容量はspeech.cppが既定で取得するファイルのものです。「ファイルの種類（量子化）」ではほかの種類（Q4_Kなど）も選べます。小さい種類ほど容量とメモリーが少なく済みますが、誤りが少し増えることがあります。

翻訳のモデルは「設定」→「翻訳」で取得します（[翻訳](../features/translation)）。「ダウンロード」を押すと、提供元・ライセンス・容量を確かめる画面が開きます。同意のチェックを入れるまで取得は始まりません。

以前の版にあったWhisperのモデルは、もう取得できません。このPCの中での音声認識は、上の表の音声認識のモデルとSilero VADを使います（[以前の版でWhisperを使っていた場合](../features/transcription#whisper)）。PCに残っている古いWhisperのモデルは、「設定」→「音声認識（ASR）」の「古い Whisper モデル」で削除できます。

## GPUとメモリの目安

読み上げのページではGPUの名前とメモリの合計・空きを表示し、空きに合わせて標準か軽量のモデルを勧めます。これは目安です。メモリを予約するものでも、動作を保証するものでもありません。VRChatなどと同時に使うときは余裕を多めに見てください。

## 使えるGPU

| 機能 | GPU |
|---|---|
| 読み上げ、リアルタイム字幕、話した人の見分け（アプリに入っているspeech.cpp） | AMD、Intel、NVIDIA（Vulkan） |
| ローカルの翻訳 | NVIDIA（WindowsのGPU版）。ほかのGPUではCPUで動きます |
| ボイスチェンジャー（RVC、Seed-VC） | NVIDIA |
| チャット読み取り | CPUで動きます |

アプリに入っているspeech.cppのサーバーは、推論デバイスが「自動」か「GPU」のとき、内蔵GPUより独立GPU（グラフィックボード）を優先して使います。独立GPUが複数あればメモリの多いほうを使います。使うGPUは「モデルとサーバー」の「推論デバイス」で指定もできます。

AMDやIntelのGPUで翻訳したいときは、[ローカルLLM](../features/translation#ローカルllmと互換サーバーを使う)を使えます。OllamaやLM StudioはAMDとIntelのGPUにも対応しています。音声を文字にするときは、どのGPUでも動くリアルタイム字幕（アプリに入っているspeech.cpp）を使ってください。

## 保存先

取得したモデルは設定ファイル（`config.json`）と同じフォルダーの`downloaded_models`に保存します。Linuxでは<CopyText>~/.config/vrct-vox/downloaded_models</CopyText>、Windowsではアプリを入れたフォルダーの`downloaded_models`です。翻訳のモデルは別の場所で、Windowsではアプリのフォルダーの`weights`に、Linuxでは<CopyText>~/.local/share/vrct-vox</CopyText>の中に入ります。以前の版が取得したWhisperのモデルが残っていれば、同じ場所の`weights/whisper`にあります。

## 起動時の自動取得

「設定」→「翻訳」の「起動時に翻訳モデルをダウンロード」をオンにすると、次に起動したときに、選んでいる翻訳モデルをまだダウンロードしていなければ取得します。取得するのは、そのバージョンに一度同意したことのあるモデルだけです。同意していないモデルは取得せず、お知らせを出します。音声認識や読み上げのモデルは、起動時に取得しません。初期設定はオフです。オフでも取得済みのモデルは使えます。
