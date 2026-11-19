---
name: adr
description: ASTAROTの設計判断の記録（ADR、docs/adr）を書く、読む、更新する、置き換える手順。設計の選択が決まったとき（「AとBどっちにする？」→「Bで」）、ある案をやめると決めたとき、変更がADRと食い違うとき、「ADRにして」「決めたことを記録して」と頼まれたとき、ADRのstatus・validity・implementation_statusを直すとき、ADRを置き換える（supersede）ときに使う。Use when recording, reading, updating or superseding an architecture decision record in docs/adr. 1つのコードの理由（コメント）、機能の仕様（docs/spec）、作業の手順（スキル）、すべての作業の決まり（AGENTS.md）には使わない。
---

# 設計判断の記録（ADR）

ADRはコードを読んでも分からない判断の理由を残す記録です。何を決めたか、ほかにどの案があり、なぜ採らなかったかを書きます。正本は`docs/adr/`だけにあり、索引は`docs/adr/README.md`です。項目と値の意味は索引の「項目と値」が正本で、このスキルには手順だけを書きます。

ADRは公開物です。人の名前、担当者、開発環境の情報を書きません。決めた人は`Decision owners: リポジトリの保守担当者`のように役割で書きます。

## 1. ADRにするかを決める

次の3つがそろうときにADRを書きます。

- 戻しにくい判断です。戻すと、設定やファイルの形式、IPCとOSCの契約、保存先や識別子、配布物、ライセンスの扱い、複数の機能の動きが変わります。
- 理由を知らないと直したくなる判断です。コードだけを読んだ人が別の形のほうがよいと考えそうなものが当たります。
- 実際に選んだ判断です。ほかの案があり、比べています。

「やらない」と決めたこともADRになります（ADR-009は仮想マイクのドライバーを同梱しないと決めています）。条件がそろわないものは次の場所に書きます。

| 中身 | 書く場所 |
|---|---|
| 1つのコードの理由、ライブラリの癖 | そのコードのコメント |
| 機能の振る舞い、IPCとOSCの契約、データ形式 | `docs/spec/` |
| 画面の見た目と操作 | `DESIGN.md` |
| 製品の目的と守る機能 | `PRODUCT.md` |
| 作業の手順 | スキル（`skills/`） |
| すべての作業が守る決まり | `AGENTS.md` |
| 調査や検証の記録、実装の計画 | Issue、PR、`docs/voice-stack/`の記録 |

会話の中で決まった判断が条件に当たるときは、ADRに書くことを伝えてから書きます。実装より前に決まった判断はADRだけのPRにし、実装と一緒に決まった判断は実装と同じPRに入れます。

## 2. 新しいADRを書く

1. 索引の一覧で最後の番号を見て、その次の番号を使います。番号は使い直しません。並行するブランチと番号が重なったら`--check`が止めるので、まだマージしていない側の番号を変えます。
2. `docs/adr/TEMPLATE.md`を写して`docs/adr/adr-NNN-<英語の短い名前>.md`を作ります。名前は決めたことが分かる英語の語をハイフンでつなぎます（`adr-013-secret-store.md`）。マージしたあとはファイル名を変えません。
3. 見出しを`# ADR-NNN: <決めたことを一文で>`にし、テンプレートの使い方の引用を消します。
4. front matterを埋めます。
   - `date`と`implementation_checked`は書いた日にします。
   - `era`は書いた時点の構成です。いまのADRは`rust-core`です。
   - `status`は`proposed`にします。保守担当者が採用を決めたら`accepted`にし、本文のStatus行に決めた日と決めた場所（Issueの決定の記録など）を書きます。
   - `validity`は`current`にします。
   - `implementation_status`は実装を確かめるまで`pending`か`unknown`にします。`accepted`にしただけで`implemented`にしません。
   - `evidence`にはこのADR自身のパスと、値の裏付けにしたファイルを書きます。
   - 確かめていない値は`unknown`にし、推測で埋めません。
5. 本文はテンプレートの節で書きます（背景、決定、検討した案、影響、検証と受け入れの条件、見直す条件、未決のこと）。
6. `python tools/adr_catalog.py --write`（`mise run adr`）で一覧の表を作り直し、索引の「各 ADR の要約」に1段落を足します。
7. `python tools/dev.py check`を実行し、`tooling`の`adr_catalog.py --check`が通ることを確かめます。番号の重複、項目と値、`evidence`のパス、リンク、一覧の古さを調べます。

## 3. 1件1ファイルで短く保つ

- 1つのファイルには判断を1つだけ書きます。判断が2つ以上あるなら、ADRを分けます。
- 書くのはコードから分からないことだけです。ファイルの一覧、実装の手順、PRの分け方、APIの写し、調査の経過は書きません。それらはIssue、PR、`docs/spec/`、`docs/voice-stack/`に置き、ADRからリンクします。
- 検討した案には実際に比べた案だけを書きます。会話で名前が出ただけの案は書きません。採らなかった理由にはいまも変わらない理由を書きます。
- 書いた時点の前提（版、OS、バックエンドの構成）を本文に書きます。後から読む人がどの時期の判断かを判別できるようにするためです。
- 計測した値には計測の条件（モデル、OS、GPUの種類、日付）を添えます。
- 要約できるところは要約して短くします。背景や検討した案の経過は、判断の理由になる事実だけを残します。
- 長くなったら、判断が2つ混ざっていないか、手順や記録が入っていないかを見直します。

## 4. 状態を更新する

本文は書いた時点の記録なので書き換えません。後から変わったことは、front matterと、本文の冒頭に足す日付つきの注記で示します。注記の形はADR-003の「状態の注記」を見ます。

`status`と`validity`は別の軸です。`status`は判断を採用したかどうか、`validity`はその判断がいまも当てはまるかを表します。ADR-003は`status: accepted`のまま`validity: replaced`になっています。

| 変わったこと | 直すところ |
|---|---|
| 実装が進んだ、実装を確かめた | `implementation_status`、`implementation_checked`（確かめた日）、`evidence`（確かめたファイル）。`partial`なら`implementation_note`に残りを書く |
| 判断の原則は有効で、実装の方式（言語、プロセスの構成、APIなど）が変わった | `validity: implementation_changed`と`validity_note` |
| 保守担当者が採用、不採用、廃止を決めた | `status`を`accepted`、`rejected`、`deprecated`にし、本文の冒頭に注記を足す |
| 後続のADRが判断を置き換えた | 5の手順 |

`status`を変えるのは保守担当者がそう決めたときだけです。直したら`python tools/adr_catalog.py --write`で一覧を作り直します。

## 5. 判断を置き換える（supersede）

判断を変えるときは、古いADRを書き換えずに新しいADRを書きます。新しいADRと、古いADRのfront matterと注記は同じPRに入れます。

1. 新しいADRを2の手順で書きます。本文の`Related`と背景に、置き換える古いADRと、何をなぜ変えるかを書きます。
2. 古いADRのfront matterを直します。
   - `validity: replaced`にします。
   - `superseded_by:`の下に、新しいADRを`  - ADR-NNN`の形で書きます。
   - `validity_note`に、何が変わり、新しいADRが何を引き継いだかを書きます。
   - 保守担当者が古い判断を置き換えると決めたときだけ`status: superseded`にします。後続のADRが判断を実際に引き継いだだけのときは`status`を変えません（ADR-003がこの例）。
3. 古いADRの本文の冒頭に日付つきの注記を足し、新しいADRへリンクします。注記の下の本文は書き換えません。
4. `python tools/adr_catalog.py --write`で一覧を作り直します。`--check`は、`superseded_by`の書き方と、名前を挙げたADRがあることを確かめます。
5. `AGENTS.md`、`docs/spec/`、スキルが古いADRを根拠に書いていたら、同じPRで新しいADRへ直します。

判断の一部だけを置き換えるときの書き方はまだ決まっていません。そのときはPRの「判断が要ること」に書いて、保守担当者に決めてもらいます。

## 6. ADRを読む

- 振る舞いを変える前に、索引の一覧で関係するADRを探します。読むときは先に「時代」（`era`）と「有効性」（`validity`）を見ます。
- `validity`が`replaced`なら、`superseded_by`のADRを読みます。
- `status: proposed`のADRは採用した判断ではありません。
- `era: python-sidecar`のADRは実装をPythonのモジュール名や`src-python/`のパスで書いていることがあります。`src-python/`は0.6.0で消したので、そのパスは0.5.xのタグで読みます。いまの実装は`native/`の各クレートのREADMEにある対応表で引きます。
- 変更が、`status: accepted`で`validity`が`current`か`implementation_changed`のADRと食い違うときは、進める前に、どのADRのどの判断と食い違うかを保守担当者に伝えます。PRで進めるときは、本文の「判断が要ること」に書きます。

## 7. 判断を変えない修正

ファイルの移動、front matterの訂正、リンクの修正のように判断の内容を変えない変更は、判断の内容を変える変更とは別のPRにします。
