---
name: ci-triage
description: "Steps for telling, with evidence, whether a CI check that failed or warned on a pull request or on develop is a real regression, variation on the runner's side or a known flaky test. Use when investigating failed checks on a pull request, reading Bencher Report warnings and alerts, judging known flaky tests and recording them in Issue #1073, choosing the unit for rerunning failed jobs, or telling cancelled runs and Dependabot statuses apart from results. For the whole flow from creating a pull request to merging it, use the pull-request skill. PRやdevelopのCIチェックが失敗・警告になったときに、本物の退行か、ランナー側のばらつきか、既知のフレーキーかを根拠付きで切り分ける手順。PRのチェック失敗の調査、Bencher Reportの警告やアラートの読み方、既知のフレーキーテストの判定とIssue #1073への記録、失敗ジョブの再実行単位の選定、cancelledやDependabotステータスとの区別に使う。PRの作成からマージ手順全体はpull-requestスキルを使う。"
---

# Triaging CI failures

[日本語版](#ciの失敗の切り分け日本語版)

These are the steps for when a check on a pull request or on `develop` turns red or shows a warning. Do not jump to "the runner acting up" or to "a real regression". Separate the cause using the scope of the change and the logs, and leave the evidence. The authoritative source for a pull request's merge conditions is [skills/pull-request/SKILL.md](../pull-request/SKILL.md).

## 1. First see how the scope of the change relates to the failed check

First, check whether the failed check is in an area related to the changes in this pull request.

1. Check the list of files the pull request changes (`gh pr view <number> --json files` or `git diff --name-only <base>...HEAD`).
2. Read the end of the failed job's log and its first error line, and find which test, tool or step it stopped at.
3. Tentatively sort how the changed files relate to the failure into one of these three.
   - **Directly related to the change**: a check of the code, settings, workflows, documents or dependencies you changed fails. Move on to reproducing it locally and fixing it, as a real regression or a configuration mistake.
   - **Looks unrelated to the change**: for example, you changed only documents or CI settings, yet an unrelated Rust or Playwright timing test or an external benchmark fails. In the following sections, confirm with evidence whether the cause is the Bencher Report, a flaky test or the runner.
   - **Cannot tell**: you cannot rule out an indirect effect (a dependency update, a change to a shared utility and so on). Do not decide that it is a regression or a flaky test. Gather the evidence and escalate to a maintainer.

When you judge a failure unrelated, do not stop at "I did not change it". Always show the list of changed files and the key points of the failure log with it.

## 2. Tell `cancelled` and Dependabot statuses apart from pass and fail

Not every red mark or status other than completed is a CI failure.

- **`cancelled` is not a failure**: it comes from the automatic cancellation by concurrency control when you push to the pull request again, or from a manual cancellation. Check the result of the run on the latest commit (HEAD).
- **Dependabot statuses are separate from whether CI passed**: do not confuse the state of Dependabot's dependency alerts or automatic update pull requests with whether the tests and builds passed. On the other hand, the `dependency-review` job is a required check. If it fails, check its log for newly introduced vulnerabilities or license problems.

## 3. What the Bencher Report is and how to read its warnings

`Bencher Report (astarot)` is an **external performance report** that [docs/voice-stack/pipeline-latency-tracking.md](../../docs/voice-stack/pipeline-latency-tracking.md) and `.github/workflows/pipeline-latency.yml` send, and it is **not a required check** (an alert does not fail CI itself and does not block a merge).

When the Bencher Report shows `failure` or a warning, check these three points in order.

1. **Whether the pull request touches performance code**: what is measured is the audio pipeline latency of `native/core` (`core: final to chatbox` and `core: final to audible speech`, measured on a debug build with fake servers). For a pull request that does not touch the audio pipeline or the core's processing, a change in the numbers is less likely to be a performance regression.
2. **Which testbed measured it**: GitHub-hosted runners such as `ubuntu-latest` and `windows-latest` vary a lot with the load on their virtual machines, and single spikes happen.
3. **Whether a threshold is set**: by the decision of 2026-11-21 (#738), a threshold (t-test, over the latest 64 results at most and 10 at least) is set only for `latency-p50`. `latency-p95` is only recorded and shown in graphs, with no threshold, so the Bencher Report itself prints `WARNING: No Threshold found!`. This is the designed behavior, not a fault.

### Example (pull request #1079, 2026-11-24)

Pull request #1079 changed only the README shields, a CI workflow and the test overview document, and did not touch the code in `native/core` at all. Even so, `latency-p50` of `core: final to audible speech` on the `windows-latest` testbed came to `17.30 ms` (baseline `8.16 ms`, upper limit `16.19 ms`), and an alert was raised (a warning with no threshold also appeared for `latency-p95`). After checking the three points above (no performance code touched, a hosted runner and no p95 threshold by design), it was judged to be variation on the runner's side.

Conversely, when a `latency-p50` alert recurs on a pull request that changed the audio pipeline or thread and queue control, do not blame the runner. Measure `pipeline_latency` locally and check whether there is a regression.

## 4. Known flaky tests and how to connect them to Issue #1073

There is a group of tests that fail now and then on heavily loaded runners because of fixed-time waits or timing races (the timing tests of `core-integration` on the Rust side, and `layoutStability.spec.ts`, `messagePipeline.spec.ts`, `buttonFeedback.test.ts` and others on the TS side). The weekly summary (`.github/workflows/ci-failures.yml`, `tools/ci_failures.py`) also tracks the number of "failed, then passed on rerun" cases.

- **Do not stop at whether a rerun passes**: if you let a failure go with "it passed on a rerun, so it was congestion", you miss real regressions and flaky tests left unattended.
- **Record it in Issue #1073 when it repeats**: when the same test fails now and then across several pull requests or before and after a rerun, leave the following in Issue #1073 (the flow for detecting and handling flaky tests). Then lead it to a root fix by its owner (the Rust side or the TS side), or to quarantine with the reason written down.
  - The name of the failed test and of its job
  - The job URL of the failed run, and the job URL of the rerun if it passed
  - The date and the pull request (or the `develop` commit)
  - The key points of the error message (the timeout value or the difference from the expected value)

## 5. Units of rerun and when to use each

When you rerun, choose the unit to suit the situation.

| Unit | When to use it | Examples |
|---|---|---|
| Only the failed jobs (or only one job) | When an independent single job failed because of a runner problem or as a flaky candidate. You can verify without redoing the other jobs that passed | `gh run rerun <run-id> --failed`, `gh run rerun <run-id> --job <job-id>` |
| The whole workflow run | When you need to rebuild from an earlier job that hands over artifacts, or when you want the whole workflow consistent again | `gh run rerun <run-id>` |

- **A run in progress cannot be rerun**: a rerun command is not accepted for a run that is `queued` or `in_progress`. Wait for it to finish before you decide, or, if it is an old run and you have already pushed a new commit, stop it with `gh run cancel <run-id>`.
- Do not rerun again and again until it turns green. Even when it passes on one rerun, record that it failed and the name of the test.

## 6. How to leave the triage result

Do not keep the conclusion in your head or only on your local terminal. Always leave it, with its evidence, on the pull request or the related issue (Issue #1073 for a flaky test).

```markdown
### CI triage record

- Check: <workflow name / job name> (run URL)
- Conclusion: real regression / runner variation / known flaky candidate (added to #1073) / needs checking (escalated to a maintainer)
- Relation to the scope of the change: <how the changed files relate to where it failed>
- Logs checked: <key points such as the first error line, numbers and the testbed>
- Rerun result: <unit (failed jobs only / whole run), result, job URL if it passed; if not run, say so>
- Next step: <a fix commit, a record in #1073, a request to a maintainer to check and so on>
```

When you cannot decide, do not state "flaky" or "unrelated" on a guess. Gather the evidence above and escalate to a maintainer.

---

# CIの失敗の切り分け（日本語版）

PRや `develop` のチェックが赤や警告になったとき、安易に「ランナーの気まぐれ」とも「本物の退行」とも決めつけず、変更範囲とログから原因を切り分けて根拠を残す手順です。PRのマージ条件の正本は [skills/pull-request/SKILL.md](../pull-request/SKILL.md) にあります。

## 1. まず変更範囲と失敗したチェックの関係を見る

最初に、失敗したチェックが「このPRの変更と関係ある領域か」を確かめます。

1. PRの変更ファイル一覧を確認します（`gh pr view <番号> --json files` または `git diff --name-only <base>...HEAD`）。
2. 失敗したジョブのログの末尾と最初のエラー行を読み、どのテスト・ツール・ステップで止まったかを特定します。
3. 変更ファイルと失敗箇所の対応を次の3つに仮分類します。
   - **変更と直接関係する**：修正したコード、設定、ワークフロー、文書、依存の検査が落ちている。本物の退行または設定ミスとしてローカル再現と修正へ進みます。
   - **変更と無関係に見える**：たとえば文書やCI設定しか変えていないのに、無関係なRustやPlaywrightのタイミング試験や外部ベンチマークが落ちている。次の節以降で、Bencher Report・フレーキー・ランナー起因を根拠付きで確認します。
   - **判断が付かない**：間接的な影響（依存更新、共通ユーティリティ変更など）を否定できない。退行ともフレーキーとも決めつけず、証拠をそろえて保守担当者へ上げます。

無関係と判断するときは「変更していないから」だけで済ませず、変更ファイル一覧と失敗ログの要点を必ず添えて示します。

## 2. `cancelled` と Dependabot ステータスを合否と分ける

赤い印や完了以外の表示がすべてCIの失敗とは限りません。

- **`cancelled` は失敗ではない**：PRへ続けてpushしたときのconcurrency制御による自動キャンセルや、手動キャンセルで発生します。最新コミット（HEAD）の実行結果を確認します。
- **DependabotのステータスはCIの合否とは別**：Dependabotによる依存アラートや自動更新PRの状態を、テスト・ビルドの合否と混同しません。一方、`dependency-review` ジョブは必須チェックであり、失敗した場合は新規の脆弱性やライセンス問題が混入していないかログを確認します。

## 3. Bencher Report の位置づけと警告の読み方

`Bencher Report (astarot)` は [docs/voice-stack/pipeline-latency-tracking.md](../../docs/voice-stack/pipeline-latency-tracking.md) と `.github/workflows/pipeline-latency.yml` が送る**外部の性能報告**であり、**必須チェックではありません**（アラートが出てもCI自体は失敗せず、マージを止めません）。

Bencher Report が `failure` や警告を表示したときは、次の3点を順に確かめます。

1. **PRが性能のコードに触れているか**：計測対象は `native/core` の音声パイプライン遅延（`core: final to chatbox` と `core: final to audible speech`、偽サーバーを使ったデバッグビルド計測）です。音声パイプラインや中核の処理に触れていないPRでの変動は、性能退行である可能性が低くなります。
2. **どの testbed の測定か**：`ubuntu-latest` や `windows-latest` のGitHubホスト型ランナーは仮想マシンの負荷変動によるばらつきが大きく、単発の上振れが起きます。
3. **しきい値が設定されているか**：2026-11-21の決定（#738）により、しきい値（t-test、直近最大64件・最小10件）は `latency-p50` にだけ設定しています。`latency-p95` は記録とグラフ表示のみでしきい値を置いていないため、Bencher Report 自身が `WARNING: No Threshold found!` を出します。これは設計どおりの挙動であり異常ではありません。

### 実例（PR #1079、2026-11-24）

PR #1079 はREADMEのシールド・CIワークフロー・テスト概要文書のみの変更で、`native/core` のコードには一切触れていませんでした。それにもかかわらず `windows-latest` testbed の `core: final to audible speech` で `latency-p50` が `17.30 ms`（基準 `8.16 ms`、上限 `16.19 ms`）となりアラートが付きました（あわせて `latency-p95` にはしきい値なしの警告が表示されました）。上の3点（性能コード無関係・ホスト型ランナー・p95しきい値なしは仕様）を確認し、ランナー側のばらつきと判断しました。

逆に、音声パイプラインやスレッド・キュー制御を変更したPRで `latency-p50` のアラートが再現する場合は、ランナーのせいにせずローカルで `pipeline_latency` を測って退行の有無を確かめます。

## 4. 既知のフレーキーなテストと Issue #1073 へのつなぎ方

負荷の高いランナーで固定時間の待機やタイミング競合により断続的に失敗するテスト群（Rust側の `core-integration` のタイミング系、TS側の `layoutStability.spec.ts`、`messagePipeline.spec.ts`、`buttonFeedback.test.ts` など）が存在します。週次集計（`.github/workflows/ci-failures.yml`、`tools/ci_failures.py`）でも「失敗→再実行で成功」の件数を追っています。

- **再実行で通るかだけで終わらせない**：「再実行したら通ったから混雑のせい」で流すと、本物の退行や放置されたフレーキーを見逃します。
- **繰り返す場合は Issue #1073 へ記録する**：同じテストが複数PRや再実行前後で断続的に落ちたときは、Issue #1073（フレーキーなテストの検出と処理の流れ）へ次の情報を残し、担当（Rust側 / TS側）による根本修正または理由明記の隔離へつなぎます。
  - 失敗したテスト名とジョブ名
  - 失敗した実行のジョブURLと、再実行で成功した場合はそのジョブURL
  - 発生日と対象PR（または `develop` のコミット）
  - エラーメッセージの要点（タイムアウト値や期待値との差）

## 5. 再実行の単位と使い分け

再実行するときは、状況に応じて単位を選びます。

| 単位 | 使う場面 | 例 |
|---|---|---|
| 失敗したジョブだけ（またはジョブ1件だけ） | 独立した単発ジョブがランナー不調やフレーキー候補で落ちたとき。他の成功ジョブをやり直さず検証できる | `gh run rerun <run-id> --failed`、`gh run rerun <run-id> --job <job-id>` |
| ワークフロー実行全体 | アーティファクトを受け渡す前段ジョブから作り直す必要があるとき、またはワークフロー全体の一貫性を取り直したいとき | `gh run rerun <run-id>` |

- **実行中のものは再実行できない**：`queued` や `in_progress` の実行に対して再実行コマンドは受け付けられません。完了を待ってから判断するか、すでに新しいコミットをpushした古い実行であれば `gh run cancel <run-id>` で止めます。
- 再実行を何度も繰り返して緑になるまで粘ることはしません。1回の再実行で通った場合も、落ちた事実とテスト名を記録します。

## 6. 切り分け結果の残し方

切り分けの結論は、頭の中やローカル端末だけに留めず、必ず根拠と一緒にPRまたは関連Issue（フレーキーならIssue #1073）へ残します。

```markdown
### CI切り分けの記録

- 対象チェック：<ワークフロー名 / ジョブ名>（実行URL）
- 結論：本物の退行 / ランナーのばらつき / 既知のフレーキー候補（#1073へ追記） / 要確認（保守担当者へエスカレーション）
- 変更範囲との関係：<変更ファイル一覧と失敗箇所の関係>
- 確認したログ：<最初のエラー行・数値・testbedなどの要点>
- 再実行の結果：<単位（失敗ジョブのみ / 全体）、結果、成功時のジョブURL。未実施ならその旨>
- 次の対応：<修正コミット、#1073への記録、保守担当者への確認依頼など>
```

判断が付かない場合は、推測で「フレーキー」「無関係」と断定せず、上の根拠をそろえて保守担当者へ上げます。
