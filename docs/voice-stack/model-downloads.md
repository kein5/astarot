# 設定画面からの既定モデル取得

TTS・ASRの「モデルとサーバー」（同梱speech.cppサーバーの欄）内とRVC設定画面に取得UIを追加。提供元、モデル名、正確な容量、利用条件へのリンク、用途・注意、保存先を表示し、チェックボックスへの同意と開始操作を必要とする。ローカル翻訳（ONNX Runtime）のモデルも、公開したあとは同じ確認画面で取得する。

同意は警告を開いた時点のカタログ版に結び付ける。更新された未確認の版で開始しない。

取得成功後の「モデルパスを適用」は別操作。完了ファイルを再検証し、現在の保存パスが画面で確認した値と一致し、対象が停止中の場合だけ反映する。保存するのは取得したパスだけで、フォームで編集中のほかの項目は未保存のまま残る（2026-10-31の変更。以前は先に保存または破棄が必要だった）。置き換えるパス自体に未保存の編集がある場合と、保存処理中は適用できない。device、low_latency、RVC runtime、pitch/index_rate、RVCのdevice/threads/highpass、入力モードは維持する。モデルのロード、発声、サーバーやマイクの開始は行わない。

適用の再検証中も、同じジョブのキャンセルボタンを使える。適用とキャンセルの応答はそれぞれ確認し、両方の待機が終わるまで別の適用や取得を始めない。状態の定期取得や応答待ちの警告だけでは、操作の待機を解除しない。

## 非商用のライセンスの確認

非商用のライセンスのモデル（NLLB-200など）は、上の同意のほかに非商用に限ることの確認を求める（#411）。

- 中核（`native/ops`の`catalog.rs`）がカタログの各行に`restrictions`を付ける。ライセンスの文字列から決まり、Creative CommonsのNonCommercial（CC-BY-NC-4.0と、-SAや-NDの付くもの）なら`["non_commercial"]`、ほかは`[]`になる。`Model`の項目と`receipt.json`の形は変えない。Gemmaの規約のような別の種類を足すときも、この一覧に種類を足す。
- 確認の画面はライセンスの名前を挙げ、非商用の利用だけが認められていることを警告の印を付けた段落で示す。同意のチェックの下に2つめのチェックを出し、両方にチェックが入るまで開始できない。画面を開き直すと、どちらのチェックも外れている。
- 開始の要求（`/run/start_model_download`）は確かめた種類を`acknowledged`に入れる。制限のあるモデルでその種類が欠けていると`model_download_restriction_unacknowledged`で断り、ファイルを書かず通信もしない。知らない種類、同じ種類の重複、そのモデルにない種類を入れた要求は`download_request_invalid`で断る。制限のないモデルの要求は今までと同じで、`acknowledged`は付けなくてよい（空の一覧も受け付ける）。
- 確認は記録しない。`receipt.json`はカタログの項目のままで、取得のたびに確認を求める。
- Pythonのバックエンドの`manager.py`も同じ要求を受け付け、同じ行を返す（`native/ops`の参照ファイルとの照合のため）。
- 翻訳の設定でNLLBを選ぶときの確認（`CTranslate2LicenseDialog`と中核の`WEIGHT_CTRANSLATE2_LICENSE_CONSENT_REQUIRED`）は別にあり、そのまま残る。

## 内蔵CTranslate2と文章分割ファイル

0.5.0の中核では、この取得を引退させた。ローカル翻訳はONNX Runtime（`native/translate-onnx`）で動き、そのモデルは上の固定カタログの対象`translation`から、ほかのモデルと同じ確認と同意を経て取得する。モデルはまだ公開していないので、カタログに項目はない。設定の「翻訳」のダウンロードは、項目があれば共通の取得の画面を出し、なければ未公開であることと、自分で用意したモデルは翻訳のカタログの「自分のモデルを追加」で足せることを示す（#597までは置き場所の`translation-models`フォルダーを示した）。

設定の「翻訳」のモデルの一覧（#565）には、取得済みのモデル、自分で追加したモデル、カタログに項目がある組み込みのモデルだけを並べる。組み込みのモデルに項目があるかは、そのモデルのカタログのID（`<モデル>-onnx-<形>`）で決める。ダウンロードのボタンが出るのは項目がある行だけで、押すとそのモデルの項目を共通の取得の画面で示す。選んでいるモデルは、取得できなくても「まだ取得できません」を付けて残す。組み込みのモデルを1つも取得できず、選んでいるモデルも使えないときは、外部翻訳APIかローカルLLMを使うよう案内する。モデルを公開してカタログに載せる手順は`tools/translation_onnx/README.md`の「公開の手順」にある。

経緯は[中核の統合](core-integration.md)の「判断が要ること」の1、29、33。この節の以下の記述は、0.4までのPythonの取得のもの。

内蔵モデルの取得は、いまは翻訳（CTranslate2）だけである。以前の版は設定の「文字起こし」でローカルの Whisper の重みも同じ確認画面から取得していたが、#288 でローカルの Whisper を削除し、その取得もやめた。ローカルの音声認識（speech.cpp）のモデルは、上のカタログ取得で「音声認識（ASR）」の「モデルとサーバー」から取得する。以前の版が取得した`weights/whisper/`の重みは読まず、利用者が設定で削除を選んだときだけ消す（[古い Whisper の重み](../spec/data-and-persistence.md#古い-whisper-の重み)）。

設定の「翻訳」でダウンロードを押すと、モデル名、提供元、ライセンス、`src-python/models/builtin_model_pins.py`に固定した全ファイルの正確な合計容量を示す。チェックして開始するまで取得しない。NLLBは選択済みでも非商用（CC-BY-NC-4.0）の制限を表示する。新規設定の既定は引き続きMITのM2M100である。

CTranslate2の文章分割ファイル（tokenizer）は、重みと同じリポジトリにある固定済みのファイルを使う。M2M100はvocabとSentencePiece、NLLBはtokenizer.jsonを含む一覧を容量・SHA-256で照合する。別リポジトリへの追加取得は行わず、確認画面の合計に全て含める。例えばM2M100 418Mはtokenizerも含め499,602,144バイトである。取得元の変更はmanifest_versionに反映されるので、旧版で記録したCTranslate2の取得同意は次の取得時に確認し直す。ライセンスと、同意がなければ取得しない条件は変わらない。

確認画面はカタログの`legacy_models`を使い、開いたときの`manifest_version`を保持する。開始要求の`{weight_type, consent: true, manifest_version}`が現在のモデル・一覧と一致しない場合は`WEIGHT_DOWNLOAD_CONSENT_REQUIRED`で拒否し、再確認を促す。NLLBの選択時の確認だけでは取得を許可しない。

同意は`config.json`の`LEGACY_MODEL_DOWNLOAD_CONSENTS`へ即時保存する。起動時取得スイッチがオンでも、同じモデル・重みの版と全ファイルの容量・SHA-256・ライセンス・tokenizerの版への同意が記録されていなければ取得を見送り、設定画面への案内を出して起動を続ける。起動時の再試行も同じ条件である。旧設定は記録なしとして、次の取得前に確認する。既存ファイルは削除せず、保存済みのNLLB選択も変えない。

翻訳開始時と取得済み判定は、検証済みの重みから固定済みtokenizerファイルだけを専用の一時フォルダーへコピーし、そのコピーも照合してから明示したtokenizerクラスでローカルだけで読む。既存フォルダーにある未固定の追加ファイルや、以前のHubキャッシュは使わない。欠落・不一致なら取得済みとせず、翻訳の有効化要求にはTRANSLATION_MODEL_MISSINGを返す。照合に通ったファイルからtokenizerを組み立てられなかったときは、取得し直しても直らないのでTRANSLATION_MODEL_LOAD_FAILEDを返す。

画面はカタログ取得と同じCSSとネイティブのdialogを使う。戻るに最初のフォーカスを置き、Escapeで閉じ、呼び出し元へフォーカスを戻す。幅・高さを画面内に収め、長い日本語やリポジトリ名を折り返す。取得でモデルの選択や翻訳・マイクを有効にしない。

保存形式は[データ形式と保存](../spec/data-and-persistence.md#内蔵モデルの取得への同意)、エラーは[横断的な振る舞い](../spec/cross-cutting.md#同意と外部への送信)を参照する。完全性確認と取得処理は次の契約に従う。

### 内蔵モデルの検証・保存・終了

- 初回の利用判定では、既存ファイルも含め、固定一覧の全ファイルを容量とSHA-256で照合する。ロードの成功だけでは取得済みにしない。ロード直前にも同じ判定を通す。大きなファイルを毎回読まないよう、manifestの識別値とファイルのsize・mtime_ns・ctime_ns・device・inodeを記録する。旧形式の.weight_verified.jsonや別manifestの記録は使わない。照合は起動処理や取得workerで行い、通常のロードはこの記録を利用する。読み取り専用の場所では記録を書けないため、次回もハッシュを計算する。Windowsの`ctime_ns`は作成時刻のため、同じ容量のまま書き換えて更新時刻を戻した場合は、記録が残っている間は検出できない。
- CTranslate2の旧名と新名が両方あれば両方を残し、検証済みの新名、検証済みの旧名の順に選ぶ。新名がなければ検証済みの旧名だけを移動する。不一致のユーザーファイルは削除しない。同意済みの再取得が全て成功したときは、既存ディレクトリを同じrootの `.preserved-<weight>-<uuid>` へ残してから、新しい一式を公開する。
- weights/ctranslate2のrootで、カタログと同じOS leaseを取得する。同じrootを別プロセスが使用中ならdownload_busyで拒否する。専用の.partial-<uuid>へ書き、上限超過を保存前に拒否し、fsyncと全ファイルの照合後にディレクトリをrenameして公開する。以前の共有.partは使わず、ユーザーファイルとして残す。異常終了で残ったstagingは、次の同意済み取得でleaseと所有markerを確認できた場合だけ回収する。
- 各ファイルの転送全体には1800秒の期限があり、最大3回の試行と待機もその期限に含む。本文のread timeoutは従来どおり60秒。期限・取消ではカタログと同じsocket中断を使う。DNS・接続・headersが返る前やOSのディスクI/OをPythonのthreadから強制終了する保証はない。shutdownは最初に全入力元のメッセージ配送を失効させ、カタログ取得・Applyと内蔵モデル取得の両方へ取消を通知してから待機に入る。内蔵モデル側はロック取得・本文の中断・全workerのjoinを合計2秒まで待ち、残ればログへ記録する。取消後の公開は禁止する。起動時は各試行を1800秒まで待ち、前回を取消・joinできた場合だけ1回再試行する。
- 成功・失敗・取消・既存ファイルの利用・例外のどの終了経路も、weight_typeとjob_idを持つ結果を1回だけ返す。取得要求の200は受付であり、成功確定ではない。全ファイルの照合とtokenizerのローカル読込みまで通ったときだけdownloaded=trueになる。失敗のUI処理は該当する重みのpending・progressだけを解除し、他の重みは維持する。同じプロセス内で重複した要求の拒否にはactive_job_idを付け、既に進行中の表示を解除しない。

## speech.cppの音声認識モデル（2026-11-16）

カタログ版 `2026-11-16.1` から、同梱のspeech.cpp（0.11.0）が扱う認識モデル7種を、量子化の種類ごとにすべて取得できる（31件）。対象はqwen3-asr-0.6b、qwen3-asr-1.7b、reazonspeech-v2、parakeet-tdt_ctc-0.6b-ja、parakeet-tdt-0.6b-v3、haas-ja-v1.0、nemotron-3.5-transcribeである。

- revision、ファイル、容量、SHA-256、対応言語、既定のファイルはspeech.cppのカタログ（`speech models --json`）を正とする。`tools/speechcpp_models.py`が同梱するバージョンの出力を`native/ops/data/speechcpp_models.json`へ写す。手で書き写さない。speech.cppのバージョンを上げたら、同梱するバージョンでこのツールを実行し直して`CATALOG_VERSION`も上げる。
- アプリ側に書くのは、どの名前を出すかとライセンスの審査（`native/ops/data/speechcpp_asr.json`の`offers`）だけである。審査の記録は[licensing.md](licensing.md#speechcppの音声認識モデル2026-11-16)と`licenses/speechcpp-models/NOTICE.md`にある。
- `native/ops`も同じ2つのファイルの文字列を読む（`downloads/speechcpp.rs`）。`python_reference.json`との照合は従来どおり。
- エントリのidは`<名前>-<種類>`（例：`reazonspeech-v2-q8`、`nemotron-35-transcribe-iq4nl`）。以前からある`haas-ja-q8`と`qwen3-asr-06b-q8`は同じidのままなので、取得済みのフォルダーをそのまま使える。
- 画面では「認識モデル」と「ファイルの種類（量子化）」を選ぶ。最初はspeech.cppが名前で取得するファイルを選んだ状態になり、対応言語とspeech.cppの推奨言語を表示する。取得には従来どおり確認画面での同意が要る。選んだだけでは何も取得しない。
- 実行時の扱いは変わらない。認識サーバーは選んだファイルを読み込み、言語や語彙のオプションは`/v1/models`の申告に従う。VAD（silero-vad）と話者分離のエントリも変えていない。2つのファイルがspeech.cppのカタログと一致することは試験で確かめている。

新しく加えたモデルを実機のサーバーで動かす試験は、まだしていない（取得に同意が要るため）。

### 選ぶための情報（profile）

0.5.0の画面で、初めての人が比べて選べるように、カタログの各行に利用者向けの情報を持たせた。音声認識、VAD、話者分離、読み上げ（TTS）の行にある。RVCとOCRの行は`null`である。

| 知りたいこと | 行の項目 | 出どころ |
|---|---|---|
| 表示名 | `name`（ファイルの種類まで）、`speech.label`（モデル名だけ） | 既存。`OFFERS` |
| 短い説明 | `profile.summary`（`model_downloads.summary.<key>`の文言キー） | `PROFILES`と`locales/` |
| 対応言語 | `profile.languages` | speech.cppのカタログ |
| ダウンロードサイズ | `total_bytes`（ファイルは`artifacts[].size`） | 既存。speech.cppのカタログ |
| ハードウェアの目安 | `profile.memory_bytes`と`memory_measured_on`、`tier`（light／medium／heavy）、`cpu`、`gpu` | モデルカードの実測値。`tier`はそこから計算する |
| おすすめ | `profile.recommended_for` | speech.cppのカタログの`start`。読み上げは`PROFILES`の`recommended_for` |

- おすすめは、speech.cppが言語ごとに「最初に使うモデル」として示すものを使う。アプリでは別に決めない。2026-11-16時点では、日本語がreazonspeech-v2、ウクライナ語などヨーロッパの9言語がparakeet-tdt-0.6b-v3、ほかの言語がqwen3-asr-0.6bである。名前が取得するファイル（既定の種類）の行にだけ付く。
- `memory_bytes`は、固定revisionのモデルカードにある種類ごとのピークメモリーである。測った機器は`memory_measured_on`に書く（Nemotron 3.5 TranscribeはH100、ほかはApple M5）。このPCでの値でも、必要量の保証でもない。`tier`は1.5 GiB以下をlight、4 GiB以下をmedium、それより大きいものをheavyとする。
- `cpu`は、CPUで動かして確かめたものだけを書く。`slow`はASTAROTが測ったもの、`practical`はspeech.cppがCPUで動かす作りのもの（VAD）、ほかは`unverified`である。`gpu`はVAD以外を`recommended`にした。モデルカードの測定はどれもGPUで、下の測定でもGPUのほうがずっと速かった。
- 2026-11-16の測定。Windows 11、Intel Core i7-1255U、NVIDIA RTX 3060 Ti（Thunderbolt接続、Vulkan1）、speech.cpp 0.11.0、Qwen3-ASR 0.6B Q8_0、言語は`ja`。Windowsの合成音声（10.2秒の日本語1文）を`speech asr`で認識させ、1ファイルと6ファイルの所要時間の差から1発話あたりを出した。各2回で、CPUは2.95秒と4.26秒、GPUは0.08秒と0.16秒だった。CPUでも動くが、字幕は発話の後に数秒遅れる。合成音声1文での測定で、精度の評価ではない。

読み上げの行（2026-11-16に追加）：

- `catalog.py`で手で固定した行なので、`PROFILES`の`ids`で、ファイルの種類ごとにカタログのIDを指す（Irodori MFのF16は`irodori-v41-f16`など）。
- おすすめは`PROFILES`の`recommended_for`で、speech.cppの`start`を置き換える。speech.cppは日本語にもQwen3-TTS 0.6Bを勧めるが、ASTAROTは日本語をIrodori（japaneseプロファイル）で、ほかの言語をQwen3-TTS（multilingualプロファイル）で読むためである。日本語はIrodori MFのF16、ほかの9言語はQwen3-TTS 0.6BのQ8_0で、どちらもアプリが最初から選ぶファイルである。ほかの読み上げの行は空。Irodori LargeはGemmaの利用規約に従うので、おすすめにしない。
- `cpu`は`impractical`。i7-1255UのCPUでspeech.cpp 0.10.0を動かした（2026-11-16、短い日本語5文）。Irodori MF F16は最初の音まで3〜7秒で、生成は実時間の約4倍遅く、再生が途切れる。Qwen3-TTS 1.7B Q8_0は最初の音まで約1秒だが、生成は約3倍遅い。Irodori Small F16は最初の音まで20〜100秒だった。LargeとQwen3-TTS 0.6BはCPUで測っていないが、大きさから同じ扱いにした。`gpu`は`recommended`。
- `memory_bytes`は、固定revisionのモデルカードにある種類ごとのピークメモリーで、どれもApple M5（Metal）での値である。
### カタログ画面（0.5.0）

設定の「モデルとサーバー」にある取得の欄は、用途ごとのまとまりにモデルのカードを並べる。

- まとまりはカタログの`target`で分ける。読み上げのページは「日本語の読み上げ」「日本語以外の読み上げ」、音声認識のページは「音声認識」「発話区間の検出（VAD）」「話者の区別（任意）」、ボイスチェンジャーのページは「ボイスチェンジャーの声」である。
- カードはモデル1つに1枚で、ファイルの種類（量子化）はカードの中で選ぶ。まとめ方は、認識モデルが`speech.name`、読み上げなどが`profile.summary`、それ以外（RVC）が行のIDである（`src-ui/logics/voice/modelCatalog.ts`）。並びはカタログの順のままにする。
- カードには`profile`の説明、対応言語、ダウンロードサイズ、ハードウェアの目安、提供元とライセンスを出す。おすすめは`profile.recommended_for`の言語を「おすすめ：日本語」のように示す。空きメモリーによる案内（`modelHardwareAdvice.ts`）に合う種類には「空きメモリーに合う」を付ける。
- 最初に見せる種類は、使用中のもの、空きメモリーに合うもの、speech.cppの既定の順に選ぶ。選んだだけでは何も取得しない。
- 取得の状態は「未取得」「取得済み」「使用中」「取得中」「検証済み・未適用」で示す。「使用中」は、取得したファイルのパスが保存済みの設定のパスと同じときだけである。

#### 性能不足の可能性の警告（#405）

利用者のPCで動きそうにないモデルには、カードの見出しに「!」の印と「性能不足の可能性」を付け、カードの中に理由を書いた注記を出す（`src-ui/logics/voice/modelHardwareWarning.ts`）。目安なので、選ぶこと、取得、適用は止めない。取得の確認画面にも同じ注記を出す。ファイルの種類の選択肢にも「性能不足の可能性」を添え、軽い種類を見分けられるようにする。

- 比べるのは、ハードウェアの検出（`hardware.py`）が返すメモリーの総量である。空き容量は時々で変わり、空き容量に合う種類は上の「空きメモリーに合う」が示すためである。
- モデルのメモリーは、`profile.memory_bytes`、`guidance.reference_memory_bytes`、検証済みの`sampled_peak_bytes`のうち最も大きい値である。案内と同じく25%を足し、GPUのメモリーの総量を超えれば警告する（`low_memory`）。GPUが複数あれば最も大きいものと比べ、メモリーを足し合わせない。エンジンの設定でGPUを名前で選んでいれば、そのGPUと比べる。
- GPUがないか、エンジンをCPUで動かす設定のときは、`profile.gpu`が`recommended`で`profile.cpu`が`impractical`か`slow`のモデルに警告する（`no_gpu`、`cpu_setting`）。CPUのメモリーの総量が分かれば、それとも比べる。
- 検出していない、失敗した、メモリーが分からないときと、数値のないモデル（RVCなど）には警告しない。分からないことを性能不足とは書かない。
- このため、音声認識やボイスチェンジャーのページでも、開いたときにハードウェアの検出（`/run/refresh_model_download_hardware`）を1回走らせる。検出はspeech.cppの`devices --json`を動かすだけで、モデルの取得や設定の変更はしない。
##### ローカル翻訳のモデル（#597）

翻訳の取得の確認画面（`LegacyModelDownloadDialog`から開くカタログの`translation`）でも同じ警告を出す。2026-11-19の決定による。

- 目安の値は中核の`native/ops/src/downloads/guidance.rs`がカタログのIDごとに返す。Pythonのバックエンドには翻訳の項目がないので足していない。
- NLLB-200 distilled 600M int8（`nllb-200-distilled-600m-onnx-int8`）は1,490,300,928バイト（約1.39 GiB）。アプリと同じ実行部`vrct-translate`で英日と日英を各30文訳したときの作業集合の最大で、Windows 11、Intel Core i7-1255U、CPUの4スレッド、ONNX Runtime 1.32.0で測った。PR #687の取得の注記（約1.4 GiB）と同じ値である。
- 既定のM2M100 418M int8（`m2m100-418m-onnx-int8`）は1,044,295,680バイト（約0.97 GiB）。同じ方法と環境で測った（PR #687）。M2M100は翻訳の共通の注記を使うので、注記には数値を書いていない。
- ほかの翻訳のモデル（NLLB-200 distilled 1.3Bなど）は測っていないので`unknown`のままにする。カードには「まだ測っていません」と出し、警告もしない。測ったら`guidance.rs`に足す。
- カードの「使うメモリ」の行に、翻訳の間に使うメモリを出す。「必要メモリと動作確認」の中は、読み上げのモデル向けの文（GPU、提供元の測定）ではなく、翻訳用の文を出す（`tier`が`translation`）。
- 比べる相手は翻訳の計算に使う機器（`SELECTED_TRANSLATION_COMPUTE_DEVICE`）で決める（`translationDeviceMode`）。既定のCPUならハードウェアの検出のCPUの行（RAMの総量）と比べる。GPUを選んでいればそのGPUのメモリの総量と比べる。CUDAとTensorRTはNVIDIAのGPUを、MIGraphXはAMDのGPUを、DirectMLとWebGPUはすべてのGPUを、検出の順に`device_index`番目として数える。そのGPUが検出の行にないときと、CPUでもGPUでも動くOpenVINOのときは比べない。
- 読み上げのモデル向けの「空きメモリーに合う」の案内（`modelHardwareAdvice.ts`）は、空いているGPUのメモリを見るので翻訳には出さない。
- RAMは検出（speech.cppの`devices --json`）のCPUの行で分かる。翻訳そのものはspeech.cppを使わない。同梱のspeech.cppが見つからず検出が失敗したときは、ほかのモデルと同じく警告しない。
- 警告の基準はほかのモデルと同じく、モデルのメモリに25%を足した値が総量を超えるかである。OSやVRChatが使う分の余裕は足していない（PRの残課題）。
- カタログに翻訳の項目が入るのはPR #687が`translation_models.json`にNLLBの項目を書いたときである。それまでは目安を返すIDがカタログになく、画面には出ない。

#### 再起動後の取得済み

`/get/data/model_download_state`の応答に`downloaded`（`{id: {role: path}}`）を足した。保存先の`<id>/<revision>/`にカタログのファイルがすべてあり、どれも通常のファイルで、容量が固定値と同じものを返す。PythonとRustのコアは同じ答えを返す。

- 確かめるのは容量だけで、SHA-256は計算しない。取得中は状態を750ミリ秒ごとに問い合わせるためである。SHA-256は、従来どおり使う準備と適用のときに照合する。
- 取得済みでジョブのないモデルは、「ファイルを確かめて使う準備をする」から使う。同じ確認画面を開き、同意してから開始する。バックエンドは既にあるファイルを照合するだけで、通信はしない（`start`の既存の動き）。照合に通ると「検証済み・未適用」になり、従来どおり「モデルパスを適用」で設定に入る。

#### 外部の音声合成エンジン

日本語の読み上げのまとまりの下に、VOICEVOX、COEIROINK、AivisSpeech、SHAREVOXのカードを並べる（[ADR-008](../adr/adr-008-external-speech-engines.md)）。

- ダウンロードはしない。カードには公式サイトと利用規約へのリンクを置き、利用条件は各エンジンと声の公式の規約に従うことを書く。
- 取得の状態の代わりに、保存済みの接続先に接続できるかを出す。問い合わせは`/get/data/tts_engine_voices`で、版と声の一覧を聞くだけである。保存済みの設定が届いたときに1回と、「再確認」を押したときに問い合わせる。`request_id`は`catalog-`で始め、「日本語を読み上げるエンジン」の欄の問い合わせとは別に持つ。
- エンジンを選ぶのは、従来どおり「日本語を読み上げるエンジン」の欄である。カードからは選択も保存も起動もしない。

#### 読み上げの試聴（#415）

日本語の読み上げと日本語以外の読み上げのまとまりで、使用中のモデルのカードに「試聴する」を置く。場所はカード自身の操作（取得内容の確認、使う準備）と同じ行のその後ろである。押すと、そのプロファイルで動いている同梱のspeech.cppサーバーが決まった短い文を読み、モニター出力先だけで鳴らす（[UC-19](../spec/use-cases.md#uc-19-読み上げの声を試聴する)）。

- 鳴らせないカードはボタンの代わりに理由を1行で出す。使用中でない、サーバーが止まっている、「自分のスピーカーでも聞く」がオフ、ミュート中、の4つである。未取得のカードには何も足さない。取得が先だからである。
- 自分で登録したモデルのカードも、使用中なら同じボタンを持つ。
- 試聴は取得、適用、サーバーの起動、設定の保存のどれもしない。使用中でないモデルを試すには、そのモデルでサーバーを起動し直すことになる。そのため使用中のモデルだけにした。
- ボイスチェンジャーの声（RVC）のカードには、まだ試聴がない。

#### 自分のモデル（#403）

カタログの各まとまりで、お使いのPCにあるモデルのファイルを名前を付けて登録できる。登録したモデルは公式のカードと同じ一覧の後ろに並び、「自分のモデル」の印と状態（登録済み、使用中、ファイルがありません、ファイルが変わりました）を付ける。

- 対象：日本語の読み上げ、日本語以外の読み上げ、音声認識、VAD、話者の区別は`.gguf`のファイル1つ。ボイスチェンジャーの声は`.pth`と、任意で`.index`。チャット読み取りは対象にしていない。翻訳は下の「翻訳のカタログ」で扱う。
- 登録はファイルの場所を覚えるだけで、コピー、移動、取得はしない。`config.json`と同じフォルダーの`user_models.json`に、名前、対象、パス、登録したときの容量と更新時刻を保存する（[データ形式と保存](../spec/data-and-persistence.md#そのほかのファイル)）。同じ対象に同じ名前か同じファイルは登録できない。200件まで。
- 切り替えは「このモデルを使う」で行う。取得したモデルの「モデルパスを適用」と同じく、画面に出ている保存済みの値が今も保存されていることと、対象のサーバーや音声入力が止まっていることを確かめ、パスだけを保存する（`_applyModelPaths`、`apply_model_paths`）。RVCで`.index`を登録していないモデルに切り替えると、保存済みの`.index`は空にする。前の声のファイルだからである。
- 状態を聞かれるたびに、ファイルがあるかと、容量と更新時刻が登録したときと同じかを確かめる。違えば「ファイルが変わりました」とし、切り替えは`user_model_changed`で断る。SHA-256は計算しない。モデルのファイルは数GiBになることがあり、計算に時間がかかるためである。
- 登録の解除は登録だけを消す。ファイルも、そのファイルを指している設定もそのまま残す。
- 出どころとライセンスはアプリでは確かめない。登録の欄にそう書いている。
- 名前とパスは利用者のデータなので、IPCの経路名に`user_model`を含め、`process.log`では値を伏せる（`SENSITIVE_ENDPOINT_MARKERS`）。
- IPC：`/get/data/user_models`、`/run/register_user_model`（`{target, name, paths}`）、`/run/remove_user_model`（`{id}`）、`/run/apply_user_model`（`{id, expected}`）。どれも`{models: [...]}`を返し、失敗は`{error_code}`で返す。PythonとRustのコアは同じ答えを返す。

#### 翻訳のカタログ（#413）

翻訳は上の登録の対象に入れず、翻訳のページの「翻訳のカタログ」で扱う。翻訳に使うものの形が2つに分かれ、足すときに入れるものも違うからである。自分の翻訳のモデルの足し方はこの「種類ごとに合った形」で決着とする。中核だけの機能で、Pythonのバックエンドにはない。

- **推論エンジン系**（`engine`）：お使いのPCの推論エンジンで動かすモデル。アプリの組み込みの重みと、利用者が足した項目（`user:<ID>`）が並ぶ。以前の版は`<データ>/translation-models/<フォルダー>/`に置いたモデル（`custom:<フォルダー>`）も並べたが、#597で外した。そのフォルダーにフォルダーがあるあいだは、翻訳のページが「自分のモデルを追加」への案内を出す（中核は`retired_folder_used`で、あるかどうかだけを伝える）。足すときはモデルのフォルダー、推論エンジン（`runtime`）、言語のコード（省略するとモデルのすべての言語）を入れる。フォルダーはどこにあってもよく、コピーも移動もしない。
- **API系**（`api`）：中核が呼ぶプロバイダ（DeepL、Google Cloud、Papago、Gemini、OpenAI、Groq、OpenRouter、PLaMo、LM Studio、Ollama、OpenAI互換）と、利用者が足した項目が並ぶ。足すときは名前、種類（`protocol`）、アドレス、モデル、キーを入れる。アドレスはお使いのPCとLANの中なら`http://`も使える（`net_policy`の`validate_api_url`。OpenAI互換のエンジンと同じ）。
- 項目は`config.json`と同じフォルダーの`translation_catalog.json`に置く（[データ形式と保存](../spec/data-and-persistence.md#そのほかのファイル)）。APIのキーはほかのAPIキーと同じ保管場所（[APIキーの保存先](../spec/data-and-persistence.md#apiキーの保存先)）の`TRANSLATION_CATALOG/<ID>`に置き、`translation_catalog.json`と`config.json`には書かない。保管場所に置けないときは、設定のキーと同じくその起動のあいだだけメモリーに持つ（ADR-013）。100件まで。グループの中で同じ名前、同じフォルダー、同じアドレスとモデルの組は足せない。
- 項目を足しても中核は覚えるだけで、取得も切り替えもしない。推論エンジン系の項目は、足すときに中核がフォルダーを開いて、`native/translate-onnx`が読める形か、示す言語がモデルにあるかを確かめる（`translation_onnx::inspect`）。ファイルのSHA-256は読み込むときに確かめる。
- 推論エンジン系の「お使いのPCの翻訳に使う」は、その重み（`user:<ID>`）を`/set/data/selected_ctranslate2_weight_type`と同じ処理で選ぶ。計算に使う機器（CPU、DirectML、CUDAなど）は、ほかのローカルの重みと同じ欄で選ぶ。利用者のモデルは量子化の形を1つだけ持ち、その形がGPUで動かないときはCPUで動かして知らせる。選んでいるモデルの項目は削除できない。
- API系の「OpenAI互換の接続先にする」は、`/set/data/openai_compatible_auth_key_and_url`と同じ処理で、アドレスとキーを確かめてからOpenAI互換のエンジンの接続先を替える。項目のモデルがサーバーの一覧になければ、切り替えたうえで`translation_catalog_model_not_listed`を知らせる。項目ごとに別のエンジンとして並べることはしていない（PRの残課題）。
- 組み込みの項目と、利用者が足した項目は`origin`（`builtin`、`user`）で見分け、画面では印を付ける。#597までは`translation-models`フォルダーのモデルを`folder`として並べた。
- この版が知らない`runtime`や`protocol`の項目（新しい版が書いたもの）は消さずに残し、「この版では使えません」と見せる。新しい推論エンジン（MADLAD-400のようなT5系、TranslateGemmaのようなdecoder-onlyのLLM）や新しい種類のAPIは、中核で動かせるようになったときに`translation_catalog::RUNTIMES`と`PROTOCOLS`に足す。TranslateGemmaの実行の経路と重みの入手は[TranslateGemmaを翻訳に使う道筋](translategemma.md)で比べた（提案、#412）。
- 開発側で推論エンジン系の項目を足すとき（#411、#412）は、これまでどおり固定カタログ（`native/ops/data/translation_models.json`、対象`translation`。`tools/translation_onnx/publish.py catalog --write`で書く）に版、サイズ、SHA-256、ライセンスを固定して載せ、ライセンス台帳（`licensing.md`）と`NOTICE.md`に記録する。非商用などの制限があるモデルは既定にしない。非商用のモデル（NLLB-200）の取得には、上の[非商用のライセンスの確認](#非商用のライセンスの確認)が要る。NLLB-200を載せるときのidと決まりは、[ライセンス台帳](licensing.md#nllb-200をカタログに載せるときの決まり2026-11-18411)にある。利用者が足した項目は、出どころとライセンスをアプリでは確かめないことを追加の欄に書いている。
- 名前、フォルダー、アドレス、キーは利用者のデータなので、IPCの経路名に`translation_catalog`を含め、`process.log`では値を伏せる。フォルダーが読めない項目は、IDと固定のコードだけをログに書く。
- IPC：`/get/data/translation_catalog`（`{engine, api, runtimes, protocols}`）、`/run/register_translation_catalog_entry`、`/run/remove_translation_catalog_entry`（`{id}`）、`/run/use_translation_catalog_entry`（`{id}`）。どれもカタログ全体を返し、失敗は`{error_code}`で返す。

#### 音声認識の2つの系（#414）

音声認識のページも翻訳のカタログと同じ考え方で、エンジンを2つの系に分けて見せる。画面の並べ方だけを変えた。設定のキー、IPC、エンジンのID、中核は変えていない。

- **speech.cpp系**（「お使いのPCで動かす（speech.cpp）」）：エンジン「ローカル（speech.cpp）」と、その「モデルとサーバー」。上のカタログの「音声認識」「発話区間の検出（VAD）」「話者の区別（任意）」のカードと、利用者が登録したモデル（#403、#407。「自分のモデル」の印）がここに並ぶ。足すときはファイルの場所を登録する。
- **API系**（「API（クラウドや自分のサーバー）」）：Groq Whisper、OpenAI Whisper、Deepgramと、利用者のWhisperサーバー（カスタムWhisperサーバー）。プロバイダごとに1行の畳みで、キー（自分のサーバーはURLとキー）とモデルを入れる。「Whisperの認識結果のふるい分け」もこの系に置く。自分のサーバーは最後に並べ、利用者の接続先であることを「自分のサーバー」の印（カタログと同じ破線の印）で示す。アプリが用意したプロバイダには印を付けない。キーは`config.json`ではなくほかのAPIキーと同じ保管場所（[APIキーの保存先](../spec/data-and-persistence.md#apiキーの保存先)）に置く。これまでと同じである。
- エンジンの選択（`/set/data/selected_transcription_engine`）は1つのままで、選択肢を2つの系の名前の下に分けて並べる。ラジオボタンは1組なので、矢印キーで系をまたいで動き、Tabで止まるのは1回である。APIのエンジンは、中核がキーを受け付けるまで選べない（`/get/data/selectable_transcription_engines`）。選択の同意の画面（`TranscriptionConsentController`）は変えていない。
- リアルタイム字幕の設定は、一度決めたら触らないものなので「詳細設定」に残した。その「ASRサーバー」の「同梱サーバー」と「外部サーバー」は、どちらもspeech.cpp系である。同梱サーバーは上の「モデルとサーバー」のモデルで動く。外部サーバーは利用者がお使いのPCで別に起動したspeech.cppのサーバーで、アドレスはループバック（`localhost`、`127.0.0.1`など）の`http://`に限る（`speechcpp::local_url`）。音声はお使いのPCの外に出ないので、API系には入れない。Windowsでエンジンに「ローカル（speech.cpp）」を選ぶと、メイン画面のスイッチはこのサーバーでリアルタイム字幕を動かす。APIのエンジンを選んでいるときは従来の録音を使い、リアルタイム字幕はその欄にある開始ボタンで始める。Linuxのスイッチはエンジンの選択にかかわらずいつもリアルタイム字幕を使う。
- 翻訳のカタログとの違い：APIの項目は利用者のWhisperサーバーの1枠だけで、翻訳のように何件も足すことはできない。speech.cppのモデルはファイルの場所で登録する（翻訳はフォルダーで足す）。新しい推論の実行部は加えていない。

## 固定カタログ

版 `2026-10-31.1`。TTSは各2候補から選択でき、ASRはHaas-jaの1候補、RVCはSaishoの1候補（ASRは2026-11-16から上の節のとおり）。

| ID | リポジトリと固定revision | ファイル / bytes | SHA256 |
|---|---|---|---|
| irodori-v41-f16 | sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF @ 9db7da1bec3d1069ef8e29732e0497be60c7b047 | Irodori-TTS-866M-MF-v4.1-F16.gguf / 1920321792 | e237dc3eefe469b8bba87872beacf12fb7fe00dbdf85767edca8ec04ab910d13 |
| irodori-v41-q8 | 同上 | Irodori-TTS-866M-MF-v4.1-Q8_0.gguf / 1207133984 | 2d161b0bbcd74f906f6b07e03d031075f8ae916db1b8bd4daf16cb37b451086a |
| qwen3-06b-q8 | sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF @ fd9df9364613a92a86b4137074bc281204823033 | Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf / 1213534464 | f606ea3981aa42762b16db9a94826d2d560eb60f0b102001618f40d5a2f78cc6 |
| qwen3-06b-q5 | 同上 | Qwen3-TTS-12Hz-0.6B-CustomVoice-Q5_K.gguf / 873894144 | 4bb9ba9e822ab614798c416c7f0187994f349be41221966fa911aca24f237930 |
| rvc-saisho | Saisho-Utane/Saisho-Model-RVC @ 7a61b17e4f014fc5013a489f2b5cd3a7ee9e2b1a | model.pth / 57577658 | 82312a29a3996a451aaa3d3776566cec85b47b5414fce53da82b2d66b04f3d35 |
| rvc-saisho | 同上 | model.index / 278065619 | e9f7396e5db3077274c720d055e43abb8f1eac5609cbdf48b198ca4f4a35cad5 |
| haas-ja-q8 | sakasegawa/Haas-ja-v1.0-GGUF @ 6b965d5007ba780585de51549d57a8c1c0d67c7e | Haas-616M-ja-v1.0-Q8_0.gguf / 656381472 | cd5f60b2f1c411404b83fca4a65e3ce30a26d9e951b6a346529e65f22758afeb |

[Irodoriカード](https://huggingface.co/sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF/blob/9db7da1bec3d1069ef8e29732e0497be60c7b047/README.md)と[Qwenカード](https://huggingface.co/sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF/blob/fd9df9364613a92a86b4137074bc281204823033/README.md)から元モデルへたどり、speech.cpp v0.9.0の[Irodori](https://github.com/nyosegawa/speech.cpp/blob/v0.9.0/docs/models/irodori-tts.md)・[Qwen](https://github.com/nyosegawa/speech.cpp/blob/v0.9.0/docs/models/qwen3-tts.md)資料と照合した。専用GGUFはcodecを含む。IrodoriはMITとcodec基盤Apache-2.0、提供元の無断模倣・誤情報生成禁止なども表示。QwenはApache-2.0。

[Haas-jaカード](https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF/blob/6b965d5007ba780585de51549d57a8c1c0d67c7e/README.md)から元モデル[third-intelligence/Haas-ja-v1.0](https://huggingface.co/third-intelligence/Haas-ja-v1.0)へたどり、speech.cpp v0.10.0の[FastConformer資料](https://github.com/nyosegawa/speech.cpp/blob/v0.10.0/docs/models/fastconformer.md)と照合した。Apache-2.0。このrevisionのファイルはspeech.cpp 0.9.4以降が必要で、同梱0.10.0で読める。ASRサーバーにはVADモデルも必要だが、カタログには含めず従来どおりパスを指定する。HaasはGPU推奨量の実測をVRCT側で記録していないため、ハードウェア推奨の対象にしない。

2026-10-31、同梱0.10.0 Vulkan版とHaas Q8_0・Silero v6.2で、`SpeechServer`経由のGPU/CPU起動、`/v1/models`での認識モデル列挙、REST認識、Realtime（サーバーVADあり/なし）のライブ試験を実行しPASS。入力はIrodori MFで合成した日本語2文で、認識精度の評価ではない。

[Saisho作者カード](https://huggingface.co/Saisho-Utane/Saisho-Model-RVC/blob/7a61b17e4f014fc5013a489f2b5cd3a7ee9e2b1a/README.md)は本人の声・自前データセット・CC BY 4.0・帰属必須を明記。Voice model created by **Saisho Utane** — [作者](https://huggingface.co/Saisho-Utane) — Used under the [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/). 本アプリはモデルを改変しない。モデル利用者にも公開物や説明でのクレジット、ライセンスへのリンク、改変表示を案内する。Mia2026はカタログに含めない。

RVCのmetadataはv2/48 kHz/f0=1。初期の短時間試験後、長めのミュート入力試験 `native-guidance-rvc-strict-2` で `vc_capture_overrun` による停止を検出した。先行する検索例外を追跡し、IVFインデックスの狭い探索範囲による近傍候補の欠落が原因と判明。RVCアダプターで探索範囲を初期化時に調整し、待ち行列・鮮度制限・不正検索結果の拒否は維持した。失敗記録も保持している。

修正版AppImage `b8050d10c7243da5d57dda92d09784912947ad6516eccde152d11e4ef3bb4fe0` の `native-rvc-fixed-strict-3` は1 PASS（45.82秒）。ミュート中の全合成音声入力（非ゼロ138フレーム）に対し出力増分0、入力完了後の新鮮な稼働状態と同じgenerationを確認。解除後にも別の全入力を完了し、第三の入力中の停止と再起動OFFを確認した。無音判定はS16絶対値64以下、停止後2秒継続であり、全バイトゼロや知覚的な音質を確認した試験とは区別する。詳細は実機検証記録を参照。

RVC音声モデル/indexだけでは動作しない。別途runtime（2026-11-15からはONNX Runtime、CUDA・cuDNNのライブラリ、HuBERT設定/重み、RMVPEのONNX。変換は同梱の`vrct-rvc-worker`）が必要。この取得機能はruntimeを入れず、pickleも読まない。WindowsとLinux（x86-64）では別の同意画面からruntimeを取得できる（0.5.0は中核の`native/voice-conversion/src/runtime.rs`、0.4まではPythonの`models/voice_conversion/runtime_setup.py`。[Windowsの音声機能](local-setup-windows.md#rvc)、[Linuxの手順](local-setup-linux.md#rvcの実行環境)）。

## GPU・空きVRAMによる案内

TTS設定を開くと、整合性確認済みの同梱speech.cpp（現在は0.11.0。この節の試験時は0.9.0）を `devices --json` で実行する。モデルはロードしない。GPU名、総容量・空き容量、確認時刻を表示し、再確認ボタンも設けた。実行はバックエンドの非同期処理で3秒timeout、終了時は所有する子プロセスだけをterminateし、応答しなければkillして回収する。固定実行ファイルの出力を受け取った後、64 KiB以内かとJSONの型・値域を検証する。任意の実行ファイルやURLは指定できない。

同じGGUFを各対応バックエンドで利用するため、GPUメーカー別にモデルを分けず、空き容量に応じて標準候補と軽量候補を案内する。ただし、実機検証はLinux / RTX 4080 SUPER / Vulkanに限る。AMD・Intel・Metal・CPUの実行成功を確認した表示にはしない。

| 枠 | 標準候補 | 軽量候補 | 上流のVRAM測定例（標準 / 軽量、十進GB） |
|---|---|---|---|
| 日本語 | Irodori MF F16 | Irodori MF Q8_0 | 2.30 / 1.59 |
| 多言語 | Qwen CustomVoice Q8_0 | Qwen CustomVoice Q5_K | 1.33 / 0.99 |

上流値はリンク先のspeech.cpp v0.9.0資料にあるRTX 2080 / Vulkan・日本語20文での測定例であり、必要最低容量ではない。量子化による容量削減と音声品質の変化の可能性も表示する。Qwen Q4は上流の転記誤り率の増加を考慮して今回の候補から除外した。

案内には次の条件を使う。

- 実行エンジンが既定で使う最初のGPUを対象にする。複数GPUの容量は合算せず、別GPUへの切替も行わない。
- `max(上流の測定例, 親担当の観測ピーク) × 1.25 + 余裕容量` が現在の空きVRAMに収まる場合、標準を優先し、次に軽量を案内する。
- 余裕容量は「VRChat等と併用」の2 GiBが既定。「TTS単独」の0.5 GiBも選べる。25%と余裕容量は案内用の方針であり、確保済みメモリや動作保証ではない。
- CPU指定、共有メモリGPU、容量不明、取得失敗、2分を超える古い測定は理由を表示する。空き0と不明は区別する。収まる候補がない場合も自動選択を勧めず、手動選択は可能にする。

選択しても設定のモデルパスや実行デバイスは変わらない。警告への同意、取得、検証後のApplyは従来どおり別操作。手動選択を保持し、取得中に別候補へ切り替えても進捗・取消・適用ボタンを残す。RVCは声の選択であり、このVRAM見積りは適用しない。TTS・RVC・ASR・ゲームの同時利用や長文には追加の余裕が必要になる。

軽量2候補は親担当が実HF全取得と固定size/hashを検証済み。Irodori Q8、Qwen Q5、Qwen Q8は実GPUで合成・取消・停止・再起動し、各モデル3回のPCM一致を確認した。別の実GUI経由でも各2回、独立参照との全PCM一致と前後の無音を確認。Irodoriは48 kHz、Qwenは24 kHzのモデル固有rateでの照合であり、ホスト側の48 kHzへの再サンプリングや知覚音質まで確認した結果ではない。観測ピークVRAMはそれぞれ1,499 / 1,000 / 1,332 MiB（100 ms間隔の所有PID測定）で、測定間のピークを取り逃す可能性がある。

新しい案内UIを含むAppImage `3c034035748633fa4e11d56c09379bd8dfe751dbf86b62aee0d1c3945a33036a` でも、実GPU表示→軽量2候補の選択→既取得cacheの製品検証→Apply→同梱日本語/多言語サーバーの起動・停止→再起動時OFF・パス保持を確認した。これはcache検証であり、新UIで全ファイルを再転送した試験ではない。

同じAppImageのIrodori F16・低遅延待機ONでは、固定短文のwarm 30回がp95上限50.054284 ms、p50上限46.018233 ms。測定は信頼されたGUIクリックから最初の非ゼロPCM書込み完了まで。warmupを含む31発声の全S16 PCM一致・前後ゼロ、OFF時2.304秒ゼロ、各送信のOSC1回を保存記録から独立再計算した。これは軽量モデルの速度保証ではない。試行間隔は約10.18〜10.24秒で、任意長文・ゲームとの競合・物理聴感へ一般化しない。

RVC検索修正を含む最新版は `build/gpu-model-guidance-rvc-fixed-2026-10-30-artifacts/` のAppImage（SHA256は上記b8050d10…）。30回の性能値は旧3c034035…版の測定として保持する。新しい入力hash記録はRVC等のコピー対象も含む575件。親担当の展開検査でアダプター・ライセンス18件が元ファイルと一致し、本担当も記録と現sourceのhashを照合した。旧543件の一致記録にはintegrations以下は含まれていなかった。

b8050d10…版のTTS再確認 `native-rvc-fixed-tts-smoke` は1 PASS（72.01秒）。warmup＋warm2件の全PCM一致・前後ゼロ、OFF時2.266666秒の全バイトゼロ、各送信のOSC1回を保存PCMから独立確認した。warm2件は性能の再認証には足りず、`summary.verdict=insufficient_samples` のまま保持している。

## 取消・失敗・終了の境界

保存先はconfig.jsonと同じディレクトリの `downloaded_models/<id>/<revision>/`。ネットワークは固定HF URLから、HTTPSと許可された配信先へのリダイレクトだけを許可する。親担当のHEAD確認で3モデルに使われていた `us.aws.cdn.hf.co` を完全一致で追加し、他のサブドメイン/HTTP/認証付きURL拒否を回帰確認した。認証情報・任意URL・任意の展開コマンドは受け取らない。読取りを小分けにし、容量とSHA256を照合。全ファイル成功後に同じファイルシステム上でディレクトリをrenameする。既存の破損cacheを上書きせず、失敗して報告する。空き容量は総ファイル容量+64 MiBを事前確認し、書込み中のENOSPCも失敗扱い。

取消はEventを保持して完了処理と排他し、本文待機中のsocketをshutdownしてread1を解除する。終了時も同じ処理を行う。ただし**DNS・接続・headersが戻る前は即時停止できない**。ネットワーク操作は15秒timeoutだがDNSなども含めた一律15秒の終了保証ではない。closeの2秒待ちで残った場合は未完了をログに出す。

Applyの再検証中は状態ロックを解放し、取得と同じく取消可能な検証中ジョブとして扱う。終了要求はロック待ちより先に通知し、closeの待ち時間はロック取得・取得worker・Applyの完了待ちで共有する。再検証後にロック内で終了要求とジョブを確認し、既存の設定用ロック内で保存値と対象の停止状態を再確認してから反映する。取消・終了で中断したApplyは `cancelled` となり、パスを適用しない。設定反映を開始済みのApplyは完了まで待つが、closeの期限を超える場合は未完了として返す。

OCRの `.ocr-keys/` にある派生文字辞書は、検証済みYAMLから生成したUTF-8の内容と毎回比較する。一致するファイルは再利用し、不一致なら同じディレクトリの一時ファイルに書き、flush・fsync後にatomic replaceする。元のONNX/YAMLのサイズ・SHA256検証は引き続き行う。

強制終了の残骸は、次の明示的な取得開始時に回収する。root単位のOSロックを取得できた場合だけ、製品・モデル・revision・ファイル名が一致する所有marker付き `.partial-<uuid>` を削除する。生存する他プロセスの取得、未知/不完全marker、余分なファイル、symlinkは回収しない。完了ディレクトリも削除しない。再開用Range転送は実装しておらず、取り消した転送は次回やり直す。

overlay relayは新しいcatalog/state/start/cancel/applyとhardware取得/更新の7ルートをすべて拒否する。新しいJotai atomはdynamicStoreRegistryに登録しない。リンクはTauriではopener経由、mainウィンドウの権限はHF・CC BY・ApacheのURLに限定する。失敗時はコピーできるURLを表示する。ブラウザ試験での模擬invoke成功と、実AppImageによるURL付きブラウザプロセスの起動確認は別の記録として扱う。

## 実装と試験

- `src-python/models/model_downloads/{catalog,transport,staging,manager,hardware,guidance}.py` とController/stdioの7ルート。
- `ModelDownloads.jsx` / `useModelDownloads.ts`、SpeechServers/DirectVoiceSettingsへの小さな挿入。en/jaの独立namespace。
- `modelHardwareAdvice.js`で取得値と候補から案内を算出。CPU・共有メモリ・容量不明/ゼロ・複数GPU・測定期限を区別する。
- IPC送信関数を安定させ、再描画に伴うcatalog/state再取得ループを修正。idle時の取得回数不変をブラウザで確認。
- Apply後の確認済み保存値がcleanフォームへ反映されない問題は、`useSettingsDraft.tsx`で直前の保存値とdraftを比較する形に修正。未保存の編集は保持する。
