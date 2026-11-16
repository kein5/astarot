Before publishing this draft (tools/changelog.py puts this list in a comment, which the release page does not show):
- Replace this body with the release notes in `docs/release-notes/<version>.md`, written in the format of `docs/release-notes/README.md` from 0.5.0 (changes that matter to users, then internal changes with their pull request numbers). The full list stays in CHANGELOG.md.
- Check the candidate manifests, SHA256SUMS, Linux GUI acceptance and Windows install/upgrade/uninstall results.
- Confirm model/runtime licenses and supported platforms. No user voice models are bundled.
- TTS/RVC hardware results apply only to the recorded device and configuration. Windows hardware acceptance is separate from building the installer.
- The installer uses `VRCT-VOX.zip` / `VRCT-VOX_cuda.zip` from this release; keep these names and the stable `VRCT-VOX_setup.exe` asset.
- The in-app updater reads `latest.json` from this release once it is published (the latest stable release for stable users). Check that the draft carries it, with entries for `windows-x86_64` (`VRCT-VOX_setup.exe`) and `linux-x86_64` (the AppImage). Configuration and cache retain the legacy storage identity.
