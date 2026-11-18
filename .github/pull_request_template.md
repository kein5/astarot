## Summary / 概要

<!-- What changes and why. Link issues with "Fixes #123". / 何をなぜ変えたか。 -->

## Verification / 確認したこと

<!-- Tests and manual checks you ran, and what you could not verify. / 実行したテストと手動確認、確認できなかったこと。 -->

## Platforms / 対応環境

<!-- Fill in when the change is OS-specific or changes what is supported (packages, OS, runtimes, platform-specific code); otherwise write "No platform impact".
     Affected platforms, where it was checked (CI, or a real PC with OS, version and package), what was not checked, and any backward-compatibility impact. CI passing is not a real-PC check.
     If the support range changes, update the support matrix (site/*/guide/support.md) and docs/voice-stack/platform-verification.md.
     OS に依存する変更や対応範囲を変える変更のときに書く。影響する OS、確かめた環境（CI か、実機なら OS と版と配布形式）、確かめていない環境、後方互換性への影響。CI の成功は実機の確認ではない。 -->

## Checklist

- [ ] Commits follow Conventional Commits (`feat:`, `fix:`, `docs:` ...); checked by CI.
- [ ] Tests added or updated for behavior changes.
- [ ] No secrets, API keys, voice recordings or private model files are included.
- [ ] License impact considered: new or upgraded dependencies, bundled files and NOTICE.md.
- [ ] User-facing text is localized (`locales/en.yml`, `locales/ja.yml`) where needed.
- [ ] Target branch: `develop` for changes, `main` only for a release from `develop`.
