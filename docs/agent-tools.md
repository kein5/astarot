# エージェントが使う道具

このリポジトリで作業するエージェントが、どの場面でどの道具を使うかをまとめます。どの項目も「何をする道具か」「いつ使うか」「決まりの正本」の3点だけを書きます。決まりそのものは正本にあり、ここには写しません。正本とこの文書が食い違うときは、正本に従います。

道具は2つに分けます。

- 推奨: 使った実績があり、該当する作業では使うもの
- 試行中: 試した実績はあるが、本格的に導入するかは決まっていないもの

道具の導入方法や接続の設定は、作業する環境ごとに違うので、ここには書きません。

## 推奨

### impeccable

- 何をする: UIの監査と批評。見た目、操作、アクセシビリティの問題を洗い出す。
- いつ使う: 画面（`src-ui/`）や利用者向けのサイトを作る、直す、仕上げるとき。変更の前に現状を監査し、変更の後に批評する。
- 正本: [DESIGN.md](../DESIGN.md)と`.impeccable/`の設定（`config.json`は検出の除外、`design.json`はデザインシステム）。検出を除外するときは、`config.json`に理由を書く。

### unslop

- 何をする: AIが作ったように見える見た目を見つけて取り除く。紫のグラデーション、光彩（グロー）、グラデーションの文字、絵文字のラベル、不ぞろいな余白などが対象。
- いつ使う: UIの作業の仕上げ。impeccableの監査と併せて使う。
- 正本: [DESIGN.md](../DESIGN.md)。unslopの提案とDESIGN.mdが食い違うときは、DESIGN.mdに従う。

### ニールセンのユーザビリティ10原則

- 何をする: ヤコブ・ニールセンのユーザビリティの10原則（システムの状態が見える、利用者が操作を取り消せる、など）。UIを評価する観点のひとつ。
- いつ使う: UIの監査で、impeccableと併せて観点として使う。指摘にはどの原則に当たるかを添える。
- 正本: 操作と振る舞いの決まりは[DESIGN.md](../DESIGN.md)と[PRODUCT.md](../PRODUCT.md)。原則は観点で、決まりの代わりにはしない。

### yomiyasu と humanizer

- 何をする: 文章の推敲。日本語はyomiyasu、英語はhumanizerを使う。
- いつ使う: 文書、UIの文言、リリースノート、PRの説明など、人が読む文章を書き終えたとき。
- 正本: 日本語は[docs/writing/japanese-guideline.md](writing/japanese-guideline.md)、英語は[docs/writing/english-guideline.md](writing/english-guideline.md)。道具の指摘と文章の決まりが食い違うときは、文章の決まりに従う。

### Cua Driver

- 何をする: Windowsの実機で、アプリの画面の構造（アクセシビリティツリー）を読み取り、操作する。設定値や表示を、画面を前面に出さず、フォーカスを奪わずに読める。
- いつ使う: 実機のアプリで、設定値の反映や表示を確かめる検証。VRパネルの中は対象にしない。
- 正本: Windowsの実機での試験の手順をまとめた文書はまだない。報告の仕方は[AGENTS.md](../AGENTS.md)の「検証と完了の報告」に従う。Linuxの実機でのGUIの試験は[docs/voice-stack/linux-build-pipeline.md](voice-stack/linux-build-pipeline.md)にある。読み取った会話の文章や音声の内容は、記録や報告に写さない。

### Mermaid

- 何をする: Markdownの中に書く図。GitHubでそのまま表示される。
- いつ使う: アーキテクチャの提案や変更を、構成要素のつながりや処理の流れで示すとき。
- 正本: 書き方は開発者向けの仕様書の図に合わせる（[docs/spec/overview.md](spec/overview.md)、[docs/spec/sequences.md](spec/sequences.md)）。仕様書の図の選び方は[docs/spec/README.md](spec/README.md)にある。

## 試行中

### ミューテーションテスト

- 何をする: コードにわざと小さな変更（ミュータント）を入れ、テストが失敗するかを見る。テストが実際に不具合を見つけられるかを測る。画面側は[@mizchi/mutator](https://www.npmjs.com/package/@mizchi/mutator)を使い、Rust側は[cargo-mutants](https://mutants.rs/)を候補にしている。
- いつ使う: リファクタリングの節目と、対象のモジュールを変えたとき。CIでは常には回さない。対象は小さな純粋なロジックにし、Rust側はタイミングに依存するテストのないモジュールから始める。画面側の純粋なロジックで、スコアの計測までを試した。
- 正本: [Issue #550](https://github.com/kein5/astarot/issues/550)。0.6.0で導入を進めることが決まっている。画面側のテストはVitestで動く（[docs/development.md](development.md)の「UIの試験（Vitest）」）。`hookHarness.js` の `loadModule` で読むソースはViteを通らないため、カバレッジと同じく変異の対象にならない見込みで、対象は直接importされる純粋なロジックから選ぶ。実行の手順と対象の選び方は、導入が終わったらこの項目に書く。それまでは試行中として扱う。結果を報告するときは、対象の範囲と計測した条件を添え、スコアを品質の保証としては書かない。
