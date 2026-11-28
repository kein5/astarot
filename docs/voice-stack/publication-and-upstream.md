# Publishing ASTAROT and its relationship with upstream VRCT

[日本語版](#astarotの公開と上流vrctとの関係日本語版)

For the current names, release files and identifiers, see [Names and identifiers](project-rename.md).

## Current policy

The repository is [kein5/astarot](https://github.com/kein5/astarot). Its repository ID is 1435087352, and its default branch is develop.
It left GitHub's fork network on 2026-10-31, so it is not shown as "forked from misyaguziya/VRCT".
It remains a derivative project that modified [misyaguziya/VRCT](https://github.com/misyaguziya/VRCT) under the MIT License,
and it keeps the original [LICENSE](../../LICENSE), [NOTICE](../../NOTICE.md), copyright notices and acknowledgements to the original author.

- Compatibility with upstream VRCT is not a goal. Versions are also counted from 0.1.0, separately from upstream's 3.x.
- Contacting upstream, offering changes for upstream to take in, and opening PRs (including drafts) are not planned. They are done only when the maintainer explicitly asks for them.
- Existing `VRCT` internal identifiers, the settings format and the IPC/OSC contracts are not replaced wholesale just because the name changed.
- The file names of the original specifications provided and past verification records are kept as originals and history.

## Publication status

[`v0.1.0-beta.1`](https://github.com/kein5/astarot/releases/tag/v0.1.0-beta.1) was published as a pre-release on 2026-10-31
(commit `ba94359b` on develop). It contains the Linux tar.gz and AppImage, the Windows ZIPs (standard and CUDA) and the installer.
Betas are built from develop, and stable releases after a `release/X.Y.Z` branch is merged into main.
For the steps, see [Release candidates and release drafts](release-candidates.md).

Our own release files do not include restricted OCR models or VC/TTS/ASR weights without permission. Check the dependencies and permissions
for each distributed item in the [license register](licensing.md).

## History

- 2026-10-28: Decided to publish the work once the planned features were complete. Offering the changes for upstream to take in was kept as a hope for the future.
  An additional instruction the same day decided that contacting upstream, offering changes and opening PRs would not happen automatically even after all features were complete, and would need the user's explicit instruction.
- 2026-10-29: As conditions before distribution, gave priority to excluding all OCR weights, the ZIP/NSIS checks, removing uploads and telemetry to the original project, fork-specific identifiers,
  and separating the README and the support contact. Created, locally, a record of the distribution boundary and an AUR plan (both deleted on 2026-11-16),
  and candidate diffs for upstream (deleted on 2026-11-01). At this point there had been no contact with upstream and no PR.
- 2026-10-31: Published `v0.1.0-beta.1`, and the repository left the fork network. Preparing proposals to upstream is on hold under the policy above.

---

# ASTAROTの公開と上流VRCTとの関係（日本語版）
現在の名称・配布物・識別子は[名称と識別子](project-rename.md)を参照してください。

## 現在の方針

リポジトリは[kein5/astarot](https://github.com/kein5/astarot)。repository IDは1435087352、default branchはdevelop。
2026-10-31にGitHubのfork networkから外れたため、「forked from misyaguziya/VRCT」とは表示されない。
[misyaguziya/VRCT](https://github.com/misyaguziya/VRCT)をMITライセンスのもとで改変した派生プロジェクトであることは変わらず、
元の[LICENSE](../../LICENSE)、[NOTICE](../../NOTICE.md)、著作権表示、原作者への謝辞を維持する。

- 上流VRCTとの互換性は目標にしない。版も上流の3.xとは別に0.1.0から数える。
- 上流への連絡、取り込みの打診、PR作成（draftを含む）は予定していない。保守担当者から明示的に依頼された場合に限り行う。
- 既存の`VRCT`内部識別子、設定形式、IPC/OSC契約は、名称の変更だけを理由に一括置換しない。
- 提供された仕様原本のファイル名や過去の検証記録は、原本・履歴として残す。

## 公開の状況

2026-10-31に[`v0.1.0-beta.1`](https://github.com/kein5/astarot/releases/tag/v0.1.0-beta.1)をプレリリースとして公開した
（developのコミット`ba94359b`）。Linuxのtar.gzとAppImage、WindowsのZIP（標準版・CUDA版）とインストーラーを含む。
ベータ版はdevelopから、正式版は`release/X.Y.Z`ブランチをmainへ統合してから作成する。
手順は[配布候補とリリース下書き](release-candidates.md)を参照。

独自配布物には制限付きのOCRモデルや、許諾のないVC/TTS/ASRの重みを含めない。配布対象ごとの依存と許諾は
[ライセンス台帳](licensing.md)で確認する。

## 経緯

- 2026-10-28: 予定機能の完成後に成果を公開する方針とした。上流への取り込み打診は将来の希望として残した。
  同日の追加指示で、上流への連絡・打診・PR作成は全機能が完成しても自動では行わず、ユーザーの明示的な指示を必要とすることにした。
- 2026-10-29: 配布前の条件として、OCR全重みの除外、ZIP/NSIS検査、本家へのupload/telemetryの排除、fork固有の識別子、
  READMEと支援窓口の分離を優先した。配布境界の記録、AUR案（どちらも2026-11-16に削除）、
  上流への差分候補をローカルで作成した（2026-11-01に削除）。この時点で上流への連絡・PRは行っていない。
- 2026-10-31: `v0.1.0-beta.1`を公開し、リポジトリはfork networkから外れた。上流への提案の準備は、上の方針により止めている。
