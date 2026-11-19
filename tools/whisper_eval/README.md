# 音声認識の評価ツール（旧 Whisper 評価ツール）

Common Voice日本語の音声と正解テキストから、再現可能な音声認識の評価セットを作成し、
CER・推論時間・リアルタイム倍率を比較するためのツールです。

もとはローカルWhisperの評価用に作りました。ローカルWhisperは #288 で削除し、ローカルの
音声認識は speech.cpp に一本化しました。評価セットの作成とCERの計算はエンジンに依らないので
そのまま使えます。VRCTの統合確認（下記）は、従来の経路（Googleとクラウドのエンジン）だけを
対象にします。speech.cpp はリアルタイムの経路で動くため、このツールの対象外です。

## 方針

- Common Voiceの音声本体はリポジトリに含めず、ローカルに展開する
- `validated.tsv` の `path` / `sentence` / `client_id` を使って、seed固定で発話を選ぶ
- 短文・中程度・長文を均等に選び、3人以上の話者を含める
- 16kHz・モノラル・16-bit PCM WAVへ統一する
- クリーン音声に、固定seedのホワイトノイズ／環境音をSNR 10dB・20dBで重ねる
- `metadata.csv` は発話ごとの入力、`manifest.json` は取得元と生成条件を記録する
- 音声の変換・雑音生成はこのツールで行うが、音声認識のモデルはダウンロードしない

Common Voiceの日本語データセットは、Mozillaのデータカタログでライセンスとバージョンを確認して取得してください。
取得時のバージョンを `--dataset-version` に記録します。

## 必要なもの

- VRCTのPython仮想環境
- `numpy`（`pyproject.toml`の依存に含まれる）
- Common Voice日本語の展開済みデータ
- MP3を変換する場合は `ffmpeg`。16kHz・モノラル・16-bit PCM WAVを入力する場合は不要
- `--environment-noise` 用の利用許諾済み環境音WAVまたは変換可能な音声

## 評価セットの作成

リポジトリルートから実行します。

```powershell
python -m tools.whisper_eval.prepare_common_voice `
  --input-dir .\tmp\commonvoice-ja `
  --tsv validated.tsv `
  --output-dir .\tmp\whisper_eval\dataset `
  --environment-noise .\tmp\noise\environment.wav `
  --count 150 `
  --seed 20260911 `
  --dataset-version <common-voice-version>
```

生成物:

```text
tmp/whisper_eval/dataset/
  clean/cv_0001.wav
  white_snr10/cv_0001.wav
  white_snr20/cv_0001.wav
  environment_snr10/cv_0001.wav
  environment_snr20/cv_0001.wav
  metadata.csv
  manifest.json
```

`manifest.json` には、元音声と環境音のSHA-256、ライセンス、データセットバージョン、
音声形式、雑音条件、選択した発話と正解テキスト、クリーン音声の合計時間を記録します。
100〜200発話という件数だけでは20〜30分になることを保証できないため、
`total_clean_duration_seconds` を確認して必要なら発話数や選定条件を調整します。

## VRCT文字起こし機能の統合確認

0.5までは、準備した音声をPythonのバックエンドの `VadRecognizerAdapter` で区切り、`AudioTranscriber` のキューへ入れて認識結果が格納されるまでを確かめる `run_vrct_transcription_test.py` がありました。エンジンはGoogleの音声認識でした。Googleの音声認識は #288 で外し、この道具は0.6.0でバックエンドと一緒に消しました（#285）。中核の文字起こしの経路は `native/core/tests/transcription.rs` などが確かめます。

## 実機VAD評価との分離

このツールは公開データセットを使ったASR評価用です。VADの取りこぼし率は、別途2種類以上の
実機マイクで録音し、録音後に波形から発話開始・終了時刻をアノテーションして評価します。
実機音声はGit管理せず、アノテーション形式と評価スクリプトだけを共有します。
