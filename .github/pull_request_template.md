## Summary

<!-- What changes and why. Link issues with "Fixes #123" or "Refs #123". -->

## Decisions needed

<!-- Numbered list of points that need a maintainer's decision (same items and numbers as in the Japanese section). Omit or write "None" if there are none. -->

## Verification

<!-- Tests and manual checks you ran, and what you could not verify. Separate passed, failed, skipped, not run and missing environment. CI passing is not a real-PC check. -->

## Platforms

<!-- Fill in when the change is OS-specific or changes what is supported (packages, OS, runtimes, platform-specific code); otherwise write "No platform impact".
     Affected platforms, where it was checked (CI, or a real PC with OS, version and package), what was not checked, and any backward-compatibility impact. CI passing is not a real-PC check.
     If the support range changes, update the support matrix (site/*/guide/support.md) and docs/voice-stack/platform-verification.md. -->

## Checklist

- [ ] Commits follow Conventional Commits (`feat:`, `fix:`, `docs:` ...); checked by CI.
- [ ] Tests added or updated for behavior changes.
- [ ] No secrets, API keys, voice recordings or private model files are included.
- [ ] License impact considered: new or upgraded dependencies, bundled files and NOTICE.md.
- [ ] User-facing text is localized (`locales/en.yml`, `locales/ja.yml`) where needed.
- [ ] Target branch: `develop` for changes, `main` only for a release from `develop`.

---

## 概要

<!-- 何をなぜ変えたか。Issueは「Fixes #123」または「Refs #123」でつなぐ。 -->

## 判断が要ること

<!-- 保守担当者が決める点を番号付きで並べる（英語の節と同じ項目を同じ番号で書く）。なければ省略するか「なし」と書く。 -->

## 確認したこと

<!-- 実行したテストと手動確認、確認できなかったこと。成功、失敗、スキップ、未実行、環境不足を分ける。CIの成功は実機の確認ではない。 -->

## 対応環境

<!-- OSに依存する変更や対応範囲を変える変更のときに書く。なければ「影響なし」と書く。
     影響するOS、確かめた環境（CIか、実機ならOSと版と配布形式）、確かめていない環境、後方互換性への影響。CIの成功は実機の確認ではない。
     対応範囲が変わる場合は、対応環境の表（site/*/guide/support.md）と docs/voice-stack/platform-verification.md も更新する。 -->

## チェックリスト

- [ ] コミットがConventional Commits（`feat:`、`fix:`、`docs:` など）に従っている（CIで検査）。
- [ ] 振る舞いの変更に対するテストを追加・更新した。
- [ ] 秘密情報、APIキー、録音データ、非公開モデルファイルを含まない。
- [ ] ライセンスへの影響を確認した（新規・更新の依存関係、同梱物、`NOTICE.md`）。
- [ ] 利用者向けの文言を必要に応じてローカライズした（`locales/en.yml`、`locales/ja.yml`）。
- [ ] 宛先ブランチが適切である（通常の変更は`develop`、`main`は`develop`からのリリースのみ）。
