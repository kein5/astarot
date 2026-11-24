# Choosing and testing speaker diarization (2026-11-13)

[日本語版](#話者分離の選定と試験2026-11-13日本語版)

This is the record of choosing a setup that tells apart several people speaking in game audio captions, and of testing it on one Windows PC. All values were measured on this PC and are not a guarantee for other environments.

## Chosen setup

The speaker diarization model Nemotron 3 Diarization (NVIDIA, Q8_0, 106 MB) is loaded into the same bundled speech.cpp server as the current recognition models (Qwen3-ASR 0.6B and Haas-ja).

- The bundled speech.cpp 0.10.0 supports this model. No executable or dependency is added.
- Over a realtime connection, the server returns "who spoke when" for each finalized utterance. Speakers get the labels A, B and so on, up to 8 people.
- The license is OpenMDW-1.1. Downloading it needs no login and no agreement to terms of use. The conditions are written in the [license register](licensing.md#話者分離モデル2026-11-13).

## Candidates and why they were not chosen

| Candidate | License | Why it was not chosen |
|---|---|---|
| Streaming Sortformer v2.1 (NVIDIA) + the current recognition models | NVIDIA Open Model License | Up to 4 people. speech.cpp 0.10.0 does not support it |
| Matching voice features (CAM++ and others, sherpa-onnx) | Apache-2.0 | Cannot handle sections where voices overlap. The training data is Chinese and English. Kept as a fallback in case Japanese accuracy is not enough |
| pyannote (community-1, 3.1) | CC-BY-4.0, MIT | Downloading needs a login and agreement to terms of use. Needs PyTorch |
| Multitalker Parakeet (NVIDIA) | NVIDIA Open Model License | English only |
| VibeVoice-ASR-Streaming (Microsoft) | MIT | Runs only on PyTorch or vLLM. Large, at 3B to 9B |
| MOSS-Transcribe-Diarize | Apache-2.0 | Not realtime. Needs a separate runtime |
| Nemotron 3.5 Transcribe | OpenMDW-1.1 | 19 GB. Not realtime |
| Cloud speech recognition with diarization | — | OpenAI's model works on whole files. Other people's voices would be sent outside |

The license and size of each candidate were checked against the model cards and license texts on 2026-11-13. Sortformer v1 (CC-BY-NC-4.0) is non-commercial, so it was not a candidate.

## Test method

- PC: Windows 11 (build 26220), Core i7-1255U, RTX 3060 Ti connected over Thunderbolt (`Vulkan1` in speech.cpp's naming), integrated GPU Iris Xe (`Vulkan0`).
- Server: `speech.exe` from speech.cpp 0.10.0, the same version as the bundled one. Recognition with Qwen3-ASR 0.6B (Q8_0), speech boundary detection with Silero VAD v6.2, and diarization with Nemotron 3 Diarization (Q8_0) in `low_latency`.
- Audio: conversations made with the text-to-speech voices that come with Windows. Japanese has 3 female voices (Ayumi, Haruka, Sayaka) and 1 male voice (Ichiro); English has 1 male voice (David) and 1 female voice (Zira). 24 kHz mono, with 42 Japanese and 6 English utterances.
- How the conversations were built: gaps of 0.2 to 1.2 seconds between utterances. Backchannel responses were laid over the middle of the previous utterance, and some utterances started before the previous one ended. Voices overlap for 2.5 to 2.8% of the speaking time.
- Reference: who spoke when, built in 10 ms steps from the level of each utterance before they were mixed.
- BGM: a synthesized mix of chords, bass, kick and hi-hat, laid under the voices at voice-to-music ratios (SNR) of 15 dB and 5 dB.
- Streaming: the same format as the app (24 kHz PCM in 20 ms pieces), sent at real-time speed.

The diarization error rate (DER) is the time of missed speech, false alarms and speaker confusion divided by the reference speaking time. It includes the overlapping sections, with no tolerance (0 seconds) at the boundaries. For the judgment per caption, the voice that spoke longest among the segments the server returned was taken as that caption's speaker.

## Results

### Diarization only (`speech diarize`, RTX 3060 Ti)

| Audio | People | Mode | DER | Missed | False alarm | Confusion | People found |
|---|---|---|---|---|---|---|---|
| 2 people, male and female | 2 | low_latency | 3.69% | 2.01 | 1.67 | 0.00 | 2 |
| 2 women | 2 | low_latency | 12.42% | 0.89 | 4.94 | 6.60 | 2 |
| 4 people | 4 | low_latency | 12.44% | 1.65 | 3.42 | 7.38 | 4 |
| 4 people, BGM 15 dB | 4 | low_latency | 13.71% | 3.92 | 2.41 | 7.38 | 4 |
| 4 people, BGM 5 dB | 4 | low_latency | 11.17% | 1.78 | 2.26 | 7.13 | 4 |
| 6 people (4 Japanese, 2 English) | 6 | low_latency | 21.97% | 10.31 | 1.64 | 10.02 | 5 |

With `offline`, the DER was 3.61% for the 2 people (male and female), 5.27% for the 2 women, 16.42% for the 4 people and 27.03% for the 6 people.

### Speaker and delay per caption (realtime connection, RTX 3060 Ti)

"Single-speaker captions" are captions in which only one person spoke according to the reference. "Multi-speaker captions" are captions in which 2 or more people spoke for 0.3 seconds or more. The delay is the time from the actual end of the voice until the finalized sentence arrives.

| Audio | Captions | People found | Single-speaker captions with the right speaker | Multi-speaker captions (main speaker right) | Delay median / 90% |
|---|---|---|---|---|---|
| 2 people, male and female | 20 | 2 / 2 | 6 / 6 | 14 (14) | 1.02 / 1.31 s |
| 2 women | 17 | 2 / 2 | 9 / 9 | 8 (7) | 1.12 / 1.42 s |
| 4 people | 36 | 4 / 4 | 15 / 17 (88%) | 19 (16) | 1.06 / 1.42 s |
| 4 people, BGM 5 dB | 34 | 4 / 4 | 13 / 14 (93%) | 20 (17) | 1.08 / 1.40 s |
| 6 people | 45 | 5 / 6 | 16 / 22 (73%) | 23 (21) | 1.12 / 1.34 s |

- On a server without the diarization model loaded, the delay for the same 4-person audio was 0.73 seconds at the median and 0.79 seconds at 90%. With diarization, it grows by 0.33 seconds at the median and 0.63 seconds at 90%.
- Speaker confusion happened on Haruka's utterances in both the 4-person and the 6-person audio. They were put under the same speaker as a female voice of the same text-to-speech engine (Ayumi or Sayaka). In the 6-person audio, Haruka did not get a label of her own.
- Shortening the silence that decides where a caption ends from 0.5 seconds to 0.25 seconds reduced the multi-speaker captions in the 4-person audio from 19 of 36 to 12 of 62. In exchange, a single sentence gets split at its commas. The app's boundary was not changed.

### Load

| Condition | Result |
|---|---|
| GPU memory (usage of the whole card) | 2385 MiB without diarization, 2510 MiB with it. The difference is about 125 MiB |
| Server memory (working set) | About 320 to 330 MiB in both cases |
| With VRChat running on the same GPU (50 to 60% GPU usage) | Delay with diarization: median 1.06 s, 90% 1.40 s; without: 0.75 s and 0.85 s. About the same as without VRChat |
| Everything on the integrated GPU (Iris Xe) | With the 2-person (male and female) audio, the delay was median 1.35 s, 90% 1.62 s. The speaker was right 6 / 6 |
| CPU only | `low_latency` in `speech diarize` ran at 0.6 times real-time speed and could not keep up |

### Check in the app's code

With a diarization model in the settings, the app's server startup (`SpeechServer`) and realtime connection (`SpeechCppRealtime`) were run on the same audio.

- The server was ready in 2.7 seconds, and `/v1/models` returned three models: recognition, detection and diarization.
- The connection for the speaker output requested diarization, and all 20 finalized captions had a speaker.
- The connection for the microphone did not request diarization, even on the same server, and none of its 17 captions had a speaker.

### Check in the app's UI

A development build was started with a settings folder for testing and run through with UI operations. The audio was played to a silent output device (Steam Streaming Speakers), and the app read that output as game audio.

- In "ASR + VAD" under "Settings" → "Speech recognition", a "Diarization GGUF path (optional)" field and a Nemotron 3 Diarization entry appeared.
- The screen that "Review download" opens showed the size (106,179,488 bytes), OpenMDW-1.1, links to the model card and the license text, and where the file is saved. The download button could not be pressed until the consent box was checked.
- The download and verification finished in about 6 seconds (the connection speed was not measured). Pressing "Apply model path" put the downloaded file's path into the diarization field only; the recognition model and VAD fields did not change.
- Turning on "Listening" on the main screen took 2.6 seconds, and `speech.exe` was running with the three models: recognition, VAD and diarization.
- After 60 seconds of a male-and-female conversation, all 12 lines in the log had labels such as "Speaker A, B" and "Speaker B". In the desktop caption overlay, the label appeared before the sentence, with A's lines in purple and B's lines in yellow. Lines still being recognized had no label, and got one when they were finalized.
- Turning off "Listening" ended `speech.exe` in 0.8 seconds.

## Findings and limits

- Two people with clearly different voices could be told apart. Similar voices sometimes end up under one speaker.
- When the gap is shorter than 0.5 seconds, two people's words become one caption. In the audio used this time, about half of the captions were like that. In that case both labels are shown in speaking order, as "A, B". Which words belong to whom is not known.
- Labels are assigned again for each connection. They are not tied to names.
- A GPU is needed. It worked on the integrated GPU too, but CPU only cannot keep up. When a setup without a GPU was simulated and streamed through the same connection as the app, the caption delay piled up beyond 1 minute. So the app was changed not to request diarization from a server whose diarization model is on the CPU ([Simulating GPU configurations](windows-voice-report.md#gpuの構成の模擬2026-11-13)).
- Adding BGM hardly changed the results, with the sounds used this time.

## Not verified

- Accuracy with human voices. The test used only text-to-speech voices. It was not measured with real VRChat conversations, with differences in microphone quality, or with processed voices (voice changers).
- The error rate on public Japanese conversation data. The model card does not list Japanese in its training data. For the previous generation, Sortformer v2.1, there is a third-party report of a 10.07% error rate on Japanese telephone conversations (2 people).
- 7 or more people, long connections (tens of minutes or more), and conversations where voices overlap heavily.
- The combination with Haas-ja. The server's documentation does not tie it to a particular recognition model, but we have not run it.
- Linux, discrete AMD and Intel GPUs, macOS.
- F16 (199 MB) and F32 (397 MB). In the speech.cpp author's measurement (English meetings), the difference in error rate is 0.06 points.

## How the app handles it

- A diarization model path field (optional) was added to "Settings" → "Speech recognition" → "Bundled speech.cpp servers" → "ASR + VAD". The model can be downloaded and applied on the same screen.
- When the field has a model, the bundled server loads it too. Only the connection for game audio captions requests diarization. It is not used for microphone captions.
- In a setup that uses an external server, it works the same way if that server has the diarization model.
- Finalized captions get speaker labels. Voices that spoke for 0.4 seconds or more are shown in the order they started speaking, up to 4. When no voice reaches 0.4 seconds, the longest voice is shown.
- Log lines show "Speaker A" or "Speaker A, B". In the desktop caption overlay, the label goes before the sentence, and each speaker has its own color.
- The wait for a caption to be finalized gets longer. Captions still being recognized (shown before they are finalized) appear as fast as before.
- The VR caption overlay (the large log) and the captions for streaming do not show labels.

> **Addendum** (2026-11-18, #447): The VR large log now shows speakers too. Labels can be given names for each session, and the names show in the message log, the desktop captions and the VR large log. Consecutive lines from the same speaker are shown as one group in the message log. The captions for streaming (WebSocket, OBS) still do not show them. The current handling is in [Data formats and storage](../spec/data-and-persistence.md#話者の名前と話者ごとのまとまり).

The scripts and audio used in the test are not in the repository.

---

# 話者分離の選定と試験（2026-11-13）（日本語版）

ゲーム音声の字幕で、複数の人の発言を聞き分けるための構成を選び、Windowsの1台で試した記録です。値はどれもこのPCで測ったもので、ほかの環境での保証ではありません。

## 選んだ構成

話者分離モデルのNemotron 3 Diarization（NVIDIA、Q8_0、106 MB）を、今の認識モデル（Qwen3-ASR 0.6BやHaas-ja）と同じ同梱speech.cppサーバーに読み込ませます。

- 同梱しているspeech.cpp 0.10.0がこのモデルに対応しています。実行ファイルも依存も足しません。
- サーバーはリアルタイムの接続で、確定した発話ごとに「誰がいつ話したか」を返します。話者はA、B…のラベルで、最大8人です。
- ライセンスはOpenMDW-1.1です。取得にログインや利用規約への同意は要りません。条件は[ライセンス台帳](licensing.md#話者分離モデル2026-11-13)に書きました。

## 候補と見送った理由

| 候補 | ライセンス | 見送った理由 |
|---|---|---|
| Streaming Sortformer v2.1（NVIDIA）＋今の認識モデル | NVIDIA Open Model License | 最大4人。speech.cpp 0.10.0が対応していない |
| 声の特徴の照合（CAM++など、sherpa-onnx） | Apache-2.0 | 声が重なる区間を扱えない。学習データは中国語と英語。日本語の精度が足りないときの予備として残す |
| pyannote（community-1、3.1） | CC-BY-4.0、MIT | 取得にログインと利用規約への同意が要る。PyTorchが要る |
| Multitalker Parakeet（NVIDIA） | NVIDIA Open Model License | 英語だけ |
| VibeVoice-ASR-Streaming（Microsoft） | MIT | PyTorchかvLLMでしか動かない。3B〜9Bで大きい |
| MOSS-Transcribe-Diarize | Apache-2.0 | リアルタイムではない。別の実行環境が要る |
| Nemotron 3.5 Transcribe | OpenMDW-1.1 | 19 GB。リアルタイムではない |
| クラウドの話者分離つき音声認識 | — | OpenAIのモデルはファイル単位。ほかの人の声を外部へ送ることになる |

各候補のライセンスとサイズは、2026-11-13にモデルカードとライセンス文で確かめました。Sortformer v1（CC-BY-NC-4.0）は非商用なので候補に入れていません。

## 試験の方法

- PC: Windows 11（build 26220）、Core i7-1255U、Thunderbolt接続のRTX 3060 Ti（speech.cppの名前で`Vulkan1`）、内蔵GPUはIris Xe（`Vulkan0`）。
- サーバー: 同梱と同じspeech.cpp 0.10.0の`speech.exe`。認識はQwen3-ASR 0.6B（Q8_0）、区切りの検出はSilero VAD v6.2、話者分離はNemotron 3 Diarization（Q8_0）の`low_latency`。
- 音声: Windowsに入っている読み上げの声で作った会話です。日本語は女性3人（Ayumi、Haruka、Sayaka）と男性1人（Ichiro）、英語は男性1人（David）と女性1人（Zira）。24 kHzのモノラルで、発話は日本語42個、英語6個です。
- 会話の作り: 発話の間は0.2〜1.2秒。相づちを前の発話の途中に重ね、一部の発話は前の発話が終わる前に始めました。声が重なる時間は、話している時間の2.5〜2.8%です。
- 正解: 重ねる前の各発話の音量から、誰がいつ話したかを10 ms単位で作りました。
- BGM: 和音とベース、キック、ハイハットを合成した音を、声との比（SNR）15 dBと5 dBで重ねました。
- 流し方: アプリと同じ形式（24 kHzのPCMを20 msずつ）で、実時間の速さで送りました。

誤り率（DER）は、見逃し・誤検出・取り違えの時間を正解の発話時間で割った値です。重なった区間を含み、境界の猶予は0秒です。字幕ごとの判定では、サーバーが返した区間のうち最も長く話した声を、その字幕の話者としました。

## 結果

### 話者分離だけ（`speech diarize`、RTX 3060 Ti）

| 音声 | 人数 | モード | DER | 見逃し | 誤検出 | 取り違え | 見つけた人数 |
|---|---|---|---|---|---|---|---|
| 男女2人 | 2 | low_latency | 3.69% | 2.01 | 1.67 | 0.00 | 2 |
| 女性2人 | 2 | low_latency | 12.42% | 0.89 | 4.94 | 6.60 | 2 |
| 4人 | 4 | low_latency | 12.44% | 1.65 | 3.42 | 7.38 | 4 |
| 4人、BGM 15 dB | 4 | low_latency | 13.71% | 3.92 | 2.41 | 7.38 | 4 |
| 4人、BGM 5 dB | 4 | low_latency | 11.17% | 1.78 | 2.26 | 7.13 | 4 |
| 6人（日本語4、英語2） | 6 | low_latency | 21.97% | 10.31 | 1.64 | 10.02 | 5 |

`offline`では男女2人が3.61%、女性2人が5.27%、4人が16.42%、6人が27.03%でした。

### 字幕ごとの話者と遅れ（リアルタイムの接続、RTX 3060 Ti）

「1人の字幕」は、正解で1人だけが話した字幕です。「複数人の字幕」は、0.3秒以上話した人が2人以上いる字幕です。遅れは、声が実際に終わってから確定した文が届くまでの時間です。

| 音声 | 字幕の数 | 見つけた人数 | 1人の字幕で話者が合った数 | 複数人の字幕（主な話者が合った数） | 遅れ 中央値 / 90% |
|---|---|---|---|---|---|
| 男女2人 | 20 | 2 / 2 | 6 / 6 | 14（14） | 1.02 / 1.31秒 |
| 女性2人 | 17 | 2 / 2 | 9 / 9 | 8（7） | 1.12 / 1.42秒 |
| 4人 | 36 | 4 / 4 | 15 / 17（88%） | 19（16） | 1.06 / 1.42秒 |
| 4人、BGM 5 dB | 34 | 4 / 4 | 13 / 14（93%） | 20（17） | 1.08 / 1.40秒 |
| 6人 | 45 | 5 / 6 | 16 / 22（73%） | 23（21） | 1.12 / 1.34秒 |

- 話者分離モデルを読み込まないサーバーでは、同じ4人の音声の遅れは中央値0.73秒、90%で0.79秒でした。話者分離ありでは中央値で0.33秒、90%で0.63秒増えます。
- 取り違えは、4人と6人の音声のどちらでもHarukaの発話で起きました。同じ読み上げエンジンの女性の声（AyumiかSayaka）と同じ話者にされています。6人の音声ではHarukaに独立したラベルが付きませんでした。
- 字幕の区切りを決める無音の長さを0.5秒から0.25秒に短くすると、4人の音声で複数人の字幕は36個中19個から62個中12個に減りました。その代わり1つの文が読点で分かれます。アプリの区切りは変えていません。

### 負荷

| 条件 | 結果 |
|---|---|
| GPUメモリ（カード全体の使用量） | 話者分離なしで2385 MiB、ありで2510 MiB。差は約125 MiB |
| サーバーのメモリ（ワーキングセット） | どちらも約320〜330 MiB |
| VRChatを同じGPUで動かしたまま（使用率50〜60%） | 遅れは話者分離ありで中央値1.06秒・90%で1.40秒、なしで0.75秒・0.85秒。VRChatなしとほぼ同じ |
| 内蔵GPU（Iris Xe）で全部を動かす | 男女2人の音声で遅れは中央値1.35秒・90%で1.62秒。話者は6 / 6で合った |
| CPUだけ | `speech diarize`の`low_latency`が実時間の0.6倍速で、間に合わない |

### アプリのコードでの確認

設定に話者分離モデルを入れた状態で、アプリのサーバー起動（`SpeechServer`）とリアルタイム接続（`SpeechCppRealtime`）を同じ音声で動かしました。

- サーバーは2.7秒で準備ができ、`/v1/models`が認識・検出・話者分離の3つを返しました。
- スピーカー側の接続は話者分離を要求し、確定した20個の字幕すべてに話者が付きました。
- マイク側の接続は、同じサーバーでも話者分離を要求せず、17個の字幕に話者は付きませんでした。

### アプリの画面での確認

開発用のビルドを試験用の設定フォルダーで起動し、画面の操作で通しました。音声は無音の出力デバイス（Steam Streaming Speakers）へ流し、アプリにはその出力をゲーム音声として読ませています。

- 「設定」→「音声認識」の「ASR + VAD」に「話者分離GGUFのパス（任意）」の欄と、Nemotron 3 Diarizationの項目が出ました。
- 「取得内容を確認」で開く画面は、容量（106,179,488 bytes）、OpenMDW-1.1、モデルカードとライセンス文へのリンク、保存先を示しました。同意のチェックを入れるまで取得のボタンは押せませんでした。
- 取得と検証は約6秒で終わりました（回線の速さは測っていません）。「モデルパスを適用」を押すと話者分離の欄だけに取得したファイルのパスが入り、認識モデルとVADの欄は変わりませんでした。
- メイン画面の「聞き取り」をオンにすると2.6秒でオンになり、`speech.exe`は認識・VAD・話者分離の3つのモデルで起動していました。
- 男女2人の会話を60秒流すと、ログの12行すべてに「話者A・B」「話者B」などのラベルが付きました。デスクトップの字幕オーバーレイでは文の前にラベルが出て、Aの行は紫、Bの行は黄でした。認識の途中の行にはラベルがなく、確定すると付きました。
- 「聞き取り」をオフにすると0.8秒で`speech.exe`が終了しました。

## 分かったことと制約

- 声がはっきり違う2人は区別できました。似た声は同じ話者にまとまることがあります。
- 間が0.5秒より短いと、2人の発言が1つの字幕になります。今回の音声では字幕の約半分がそうでした。そのときは話した順に「A・B」と両方のラベルを付けます。どの言葉が誰のものかは分かりません。
- ラベルは接続ごとに振り直されます。名前とは結び付きません。
- GPUが要ります。内蔵GPUでも動きましたが、CPUだけでは間に合いません。GPUのない構成を模擬してアプリと同じ接続で流すと、字幕の遅れが1分を超えて積み上がりました。そのため、話者分離モデルがCPUにあるサーバーには話者分離を要求しないようにしました（[GPUの構成の模擬](windows-voice-report.md#gpuの構成の模擬2026-11-13)）。
- BGMを重ねても、今回の音では結果はほとんど変わりませんでした。

## 確かめていないこと

- 人の声での精度。試験は読み上げの声だけで行いました。VRChatの実際の会話、マイクの質の差、声の加工（ボイスチェンジャー）では測っていません。
- 日本語の会話の公開データでの誤り率。モデルカードは学習データに日本語を挙げていません。前の世代のSortformer v2.1には、日本語の電話会話（2人）で誤り率10.07%という第三者の報告があります。
- 7人以上、長時間（数十分以上）の接続、声が大きく重なる会話。
- Haas-jaとの組み合わせ。サーバーの文書では認識モデルを選びませんが、動かしていません。
- Linux、AMDやIntelの単体GPU、macOS。
- F16（199 MB）とF32（397 MB）。speech.cppの作者の計測（英語の会議）では、誤り率の差は0.06ポイントです。

## アプリでの扱い

- 「設定」→「音声認識」→「同梱speech.cppサーバー」→「ASR + VAD」に、話者分離モデルのパスの欄（任意）を足しました。モデルは同じ画面で取得して適用できます。
- 欄にモデルがあると、同梱サーバーはそれも読み込みます。ゲーム音声の字幕の接続だけが話者分離を要求します。マイクの字幕には使いません。
- 外部のサーバーを使う設定でも、そのサーバーが話者分離モデルを持っていれば同じように働きます。
- 確定した字幕に話者のラベルを付けます。0.4秒以上話した声を、話しはじめた順に最大4人まで出します。どの声も0.4秒に満たないときは、最も長い声を出します。
- ログの行には「話者A」「話者A・B」と出します。デスクトップの字幕オーバーレイでは、文の前にラベルを付け、話者ごとに色を変えます。
- 確定を待つ時間が延びます。認識の途中の字幕（確定前の表示）は、これまでと同じ速さで出ます。
- VRの字幕オーバーレイ（大きいログ）と、配信用の字幕にはラベルを出していません。

> **追記**（2026-11-18、#447）：VRの大きいログにも話者を出すようになりました。ラベルにはセッションごとの名前を付けられ、会話ログ、デスクトップの字幕、VRの大きいログに出ます。同じ話者が続く行は、会話ログでひとまとまりに見せます。配信用の字幕（WebSocket、OBS）には今も出していません。いまの扱いは[データ形式と保存](../spec/data-and-persistence.md#話者の名前と話者ごとのまとまり)にあります。

試験に使ったスクリプトと音声はリポジトリに入れていません。
