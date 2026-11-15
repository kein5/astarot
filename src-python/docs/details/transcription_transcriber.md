# transcription_transcriber.py - 音声文字起こしエンジン

## 概要

音声データを文字テキストに変換する音声認識エンジンのメインクラスです。録音経路（レコーダー → キュー → `AudioTranscriber`）で、Google Speech Recognition とクラウドの音声認識エンジン（Groq Whisper、OpenAI Whisper、カスタム Whisper サーバー、Deepgram）を扱います。キューベースの非同期処理により、リアルタイム音声認識を実現します。

ローカルの音声認識は speech.cpp（エンジン ID `SpeechCpp`）のリアルタイム経路で動き、このクラスは使いません。以前のローカル Whisper（faster-whisper）は #288 で削除しました。`transcription_engine` に `"SpeechCpp"` などこのクラスが扱わないエンジンを渡すと、`TranscriptionStartError(TRANSCRIPTION_ENGINE_UNAVAILABLE)` を送出します。

## 主要機能

### 音声認識エンジン
- Google Speech Recognition（オンライン）
- OpenAI 互換のクラウド API（Groq Whisper、OpenAI Whisper、カスタム Whisper サーバー。`OpenAICompatibleTranscriptionProvider`）
- Deepgram（`DeepgramProvider`）

### リアルタイム処理
- 音声キューからの継続的データ処理
- 非同期音声認識処理
- 結果の即座通知

### 多言語対応
- 複数言語の同時認識
- 地域固有言語コードの対応
- 自動言語検出

### 音声品質制御
- 音声品質フィルタリング
- ノイズ除去機能
- 信頼度スコア評価

## クラス構造

### AudioTranscriber クラス
```python
class AudioTranscriber:
    def __init__(self, speaker: bool, source: Any, phrase_timeout: int, max_phrases: int,
                 transcription_engine: str, api_key: Optional[str] = None,
                 base_url: Optional[str] = None, api_model: Optional[str] = None,
                 api_model_languages: Optional[List[str]] = None,
                 vad_segmented: bool = False, source_label: Optional[str] = None)
```

音声認識の中核クラス

#### 初期化パラメータ
- **speaker**: スピーカー音声かマイク音声か
- **source**: 音声ソース
- **phrase_timeout**: フレーズタイムアウト（秒）
- **max_phrases**: 最大フレーズ数
- **transcription_engine**: 認識エンジン（"Google"、"Groq_Whisper"、"OpenAI_Whisper"、"Custom_Whisper"、"Deepgram"）
- **api_key** / **base_url** / **api_model** / **api_model_languages**: クラウドエンジンの認証キー、接続先、モデル、モデルが対応する言語（`model.py` の `_resolve_api_transcription_kwargs()` が config から解決する）
- **source_label**: ログに出す入力名（"mic"/"speaker"）
- **vad_segmented**: `config.MIC_ENABLE_VAD/SPEAKER_ENABLE_VAD` 連動 (既定 False)。True の場合、audio_queue の
  各アイテムは `(raw_bytes, recorded_at, reason)` の3要素タプルで、`reason` が
  `"silence"`/`"flush"` (自然な区切り) の場合は蓄積分をまとめて即座に確定・
  文字起こしする。`reason="max_duration"` (VAD の安全弁による無音を挟まない強制
  打ち切り) の場合は単独送信せず蓄積を続ける (単語の途中で始まり/終わる不自然な
  断片を単独送信すると、エンジン側の信頼度フィルタに丸ごと棄却されるリスクが
  あるため、2026-09-06 実機で確認)。確定したクリップには前後に無音パディング
  (`_padWithSilenceForVad`、`VAD_PRE_PAD_MS`/`VAD_POST_PAD_MS`) をエンジンを
  問わず一律に付与する (2026-09-07)。**Google エンジンのみ追加で別扱い**:
  パディング単体でも改善は確認できたが、実機の再検証でパディングだけでは
  無応答が再発することが判明したため、reason に関わらず新しいチャンクが
  来るたびに「発話の先頭からここまでの累積バッファ」全体を都度再送信する
  (`interim_send`、VRCT v3.5.0 と同じ「育っていくバッファ」方式。送信の
  たびにパディングも付与するが、蓄積用の内容自体には混ざらない)。
  `vad_segmented=False` (エネルギー閾値方式) でも Google だけはこの
  再送信方式になる (ただし無音パディングは付与されない)。詳細は
  `transcribeAudioQueue` のdocstringと `transcription_recorder.md` 参照。

#### ASR成功率の計測 (`asr_attempts`/`asr_successes`)

`_finalizeAndTranscribe` が呼ばれるたびに (VAD方式のinterim_send含め、
実際にエンジンを呼ぶ1回を1試行として) `self.asr_attempts` をインクリメント
し、テキストが得られた場合のみ `self.asr_successes` もインクリメントする
(2026-09-07)。失敗、候補言語の一部でのエラー、5秒以上のASRでは `printLog` で
`[ASR-stats][mic|speaker][エンジン名] this_call=success|failure
attempts=N successes=M rate=X%` に所要時間と言語別呼び出し内訳を付けて即時にログに残す。
通常成功はVAD・メッセージ処理の観測とともに、mic/speaker別に60秒間隔で遅延集約する。
活動がなければ出力せず、停止・終了時には残りを出力する。件数と最大値は区間全体、
p50/p95は各段階の直近256件から計算する。詳しい項目と基準は
[文字起こしの診断ログ](../../../docs/spec/data-and-persistence.md#文字起こしの診断ログ)を参照。
Google無料エンドポ
イントの信頼性対策 (無音パディング・interim_send) の効果を、ログの手動
突き合わせではなく数値で継続的に確認できるようにするための計測機能。
セッション中は `AudioTranscriber` インスタンスが存続する限り累積し
(mute/unmute等での `clearTranscriptData()` では リセットしない)、
文字起こしエンジンの切り替え等で新しいインスタンスが作られると0から
再スタートする。

## 主要メソッド

### 音声認識処理

```python
transcribeAudioQueue(audio_queue: Queue, languages: List[str], countries: List[str],
                    avg_logprob: float = -0.8, no_speech_prob: float = 0.6) -> bool
```

音声キューからの継続的音声認識

#### パラメータ
- **audio_queue**: 音声データキュー
- **languages**: 認識対象言語リスト
- **countries**: 地域コードリスト  
- **avg_logprob**: 平均対数確率しきい値。OpenAI 互換のクラウドエンジン（Groq / OpenAI / カスタム）が、返ってきたセグメントをふるい分けるのに使う（`MIC_AVG_LOGPROB` / `SPEAKER_AVG_LOGPROB`）
- **no_speech_prob**: 無音判定しきい値。同じくクラウドエンジンのセグメントのふるい分けに使う（`MIC_NO_SPEECH_PROB` / `SPEAKER_NO_SPEECH_PROB`）

### 結果管理

```python
getTranscript() -> dict
```

最新の認識結果を取得

```python
updateTranscript(result: dict) -> None
```

認識結果の更新と通知

```python
clearTranscriptData() -> None
```

認識データのクリア

### 音声データ処理

```python
processMicData() -> AudioData
```

マイク音声データの前処理

```python
processSpeakerData() -> AudioData
```

スピーカー音声データの前処理

## 使用方法

### 基本的な音声認識

```python
from queue import Queue
from models.transcription.transcription_transcriber import AudioTranscriber

# 音声認識の初期化
transcriber = AudioTranscriber(
    speaker=False,              # マイク音声
    source=mic_source,          # 音声ソース
    phrase_timeout=3,           # 3秒のフレーズタイムアウト
    max_phrases=10,             # 最大10フレーズ
    transcription_engine="Google",  # Google音声認識
)

# 音声キューの準備
audio_queue = Queue()

# 認識対象言語の設定
languages = ["Japanese", "English"]
countries = ["Japan", "United States"]

# 音声認識の実行
def transcription_loop():
    while True:
        success = transcriber.transcribeAudioQueue(
            audio_queue, languages, countries
        )
        if success:
            result = transcriber.getTranscript()
            print(f"認識結果: {result['text']}")
            print(f"言語: {result['language']}")

# バックグラウンドで実行
import threading
thread = threading.Thread(target=transcription_loop)
thread.daemon = True
thread.start()
```

### クラウドエンジンの使用

```python
# OpenAI 互換のクラウドエンジン（ここでは Groq）の初期化
cloud_transcriber = AudioTranscriber(
    speaker=True,               # スピーカー音声
    source=speaker_source,
    phrase_timeout=5,
    max_phrases=5,
    transcription_engine="Groq_Whisper",
    api_key=groq_api_key,
    api_model=groq_model,
)

# セグメントのふるい分けのしきい値を指定して認識
success = cloud_transcriber.transcribeAudioQueue(
    audio_queue, languages, countries,
    avg_logprob=-0.5,          # より厳しい品質しきい値
    no_speech_prob=0.4         # より敏感な無音検出
)
```

### コールバック処理

```python
def on_transcription_result(result):
    """認識結果のコールバック処理"""
    if result["text"]:
        print(f"認識成功: {result['text']}")
        print(f"言語: {result['language']}")
        print(f"信頼度: {result.get('confidence', 'N/A')}")
    else:
        print("音声認識失敗")

# 結果通知の設定
transcriber.transcript_changed_event.set()  # イベント設定
```

### エラーハンドリング付きの使用

```python
def safe_transcription(transcriber, audio_queue, languages, countries):
    """安全な音声認識処理"""
    try:
        success = transcriber.transcribeAudioQueue(
            audio_queue, languages, countries
        )
        
        if success:
            result = transcriber.getTranscript()
            return result
        else:
            return {"text": False, "language": None, "error": "認識失敗"}
            
    except Exception as e:
        print(f"音声認識エラー: {e}")
        return {"text": False, "language": None, "error": str(e)}
```

## 認識エンジン比較

### Google Speech Recognition

#### 利点
- 高い認識精度
- 多言語対応
- リアルタイム処理
- ノイズ耐性

#### 制限
- インターネット接続必須
- API制限
- プライバシー懸念
- レイテンシ

### クラウドエンジン（Groq / OpenAI / カスタムサーバー / Deepgram）

#### 利点
- 高精度
- 多言語対応
- この PC の GPU を使わない

#### 制限
- インターネット接続と API キーが必要（カスタムサーバーは接続先が必要）
- 音声が外部のサービスに送られる
- レイテンシ

## 設定パラメータ

### フレーズ制御
- **phrase_timeout**: フレーズ間無音時間（秒）
- **max_phrases**: バッファ内最大フレーズ数

### クラウドエンジンの品質設定
- **avg_logprob**: 平均対数確率しきい値（-2〜0）。OpenAI 互換のクラウドエンジンだけが使う
- **no_speech_prob**: 無音判定しきい値（0〜1）。OpenAI 互換のクラウドエンジンだけが使う

設定画面のスライダーは #288 で削除しました。設定キーとエンドポイントは残っています。

## 音声データフォーマット

### 入力形式
- サンプリングレート: 16kHz推奨
- ビット深度: 16bit
- チャンネル: モノラル推奨
- フォーマット: WAV、FLAC等

### 処理フロー
1. 音声キューからデータ取得
2. 音声フォーマット正規化
3. 音声認識エンジン実行
4. 結果の後処理・フィルタリング
5. 最終結果の通知

## パフォーマンス最適化

### メモリ管理
- 音声バッファの適切なサイズ設定
- 不要な音声データの早期解放

### レイテンシ削減
- 音声バッファサイズの最適化
- エンジン切り替えの高速化
- キャッシュ機能の活用

## エラーハンドリング

### ネットワークエラー
- Google API とクラウド API の接続失敗の検出

### 音声品質エラー
- 低品質音声の検出・フィルタリング
- ノイズレベル監視

## 依存関係

### 必須依存関係
- `speech_recognition`: Google音声認識
- `openai`: OpenAI 互換のクラウドエンジン
- `pyaudiowpatch`: 音声入力
- `pydub`: 音声処理

### オプション依存関係
- `utils`: エラーログ機能

## 注意事項

- Google APIは使用制限あり
- 音声品質が認識精度に大きく影響
- 多言語認識時は処理負荷増加

## 関連モジュール

- `transcription_recorder.py`: 音声録音
- `transcription_providers.py`: エンジンごとの呼び出し（Google、OpenAI 互換、Deepgram）
- `old_whisper_weights.py`: 以前の版がダウンロードした Whisper の重みの確認と、利用者の操作による削除（`WHISPER_WEIGHT_NAMES`、`oldWhisperWeights(root)`、`deleteOldWhisperWeights(root)`）。このクラスからは使わない
- `transcription_languages.py`: 言語コード管理
- `config.py`: 認識設定管理
- `model.py`: 音声認識統合制御
