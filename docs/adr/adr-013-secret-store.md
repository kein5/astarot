---
date: 2026-11-18
status: accepted
era: rust-core
validity: current
implementation_status: implemented
implementation_checked: 2026-11-18
implementation_note: 中核の SystemStore で実装した（本文 10.5、#575）。KWallet、ロックされた鍵束、Secret Service のない Linux、AppImage での実機の確認と、0.5.x へ戻すときの注意をリリースノートに書くことが残っている（本文 10.6）。
evidence:
  - docs/adr/adr-013-secret-store.md
  - native/core/src/config/secrets/system.rs
  - native/core/tests/secret_store.rs
---
# ADR-013: Keep API keys in the OS credential store

[日本語版](#adr-013-api-キーを-os-の資格情報ストアに保管する日本語版)

Status: Accepted (2026-11-18). Decides to move the storage of the keys to the OS credential store. The work is done in Issue #575, and the decisions in section 9 and what was implemented were added in section 10.
Date: 2026-11-18
Decision owners: The repository maintainers
Related: Issue #575, Issue #517, PR #384, items 35 and 37 in the list of decisions needed in [Core integration](../voice-stack/core-integration.md), [Data and persistence](../spec/data-and-persistence.md#apiキーの保存先), [Cross-cutting behavior](../spec/cross-cutting.md), [ADR-011](adr-011-astarot-brand-and-multimodal-accessibility.md), [Names and identifiers](../voice-stack/project-rename.md), `native/core/src/config/secrets.rs`, `NOTICE.md`

In this ADR, "the app" means the app in this repository. Its display name is ASTAROT (ADR-011), and identifiers such as the storage locations and the app ID remain VRCT-VOX.

> **Migration note** (2026-11-18, Issue #587): This ADR was written while it was in `docs/voice-stack/`. `release-candidates.md`, which section 7 names by file name only, is still in `docs/voice-stack/` ([Release candidates](../voice-stack/release-candidates.md)). The body has not been rewritten.

## 1. Context

### 1.1 Current storage (from 0.5.0)

#384 split the API keys out of `config.json`, and they are stored in `secrets.json` in the same folder. The implementation is `SecretStore` in `native/core/src/config/secrets.rs`, and the app uses `FileStore`, which writes to a file. It covers the settings named in `SECRET_SETTINGS`. There are currently 3.

| Setting | Contents | Entry name in `secrets.json` |
|---|---|---|
| `AUTH_KEYS` | API keys for translation providers | `AUTH_KEYS/<provider name>` |
| `TRANSCRIPTION_AUTH_KEYS` | API keys for speech recognition providers | `TRANSCRIPTION_AUTH_KEYS/<provider name>` |
| `PAPAGO_CLIENT_ID` | The Papago Client ID (used together with the Secret) | `PAPAGO_CLIENT_ID` |

The protection on each OS is as follows.

| OS | `protection` | What protects the keys |
|---|---|---|
| Windows | `dpapi` | The list of entries is encrypted with DPAPI (`CryptProtectData`). Only the user who was signed in when it was encrypted can decrypt it |
| Linux | `none` | The list of entries is written in plain text. The only protection is setting the file permissions to 0600 (only the owner can read and write) |

On both, a write goes to a temporary file, then `fsync`, then replaces the file. An unreadable file (another user's DPAPI, corrupted content) is moved to `secrets.json.unreadable-<timestamp>-<random>` the next time a key is written. When the file is only temporarily unreadable (a lock, a temporary I/O failure, DPAPI not responding), the write fails without touching the file (#427, #470). When the storage cannot be written to or read back, the key stays in memory so that it can be used for the rest of that run, and `/run/secret_store_failed` reports only the entry names. Key values do not appear in errors or logs.

### 1.2 The problem with plain text on Linux

On Linux, anyone who can read `secrets.json` can read the keys as they are. The 0600 permissions protect the keys from other users on the same PC, but they do not help in these cases.

- The settings folder leaves the PC through a backup, a sync tool or a move to another PC
- An unencrypted disk is taken out and read
- The user hands over the whole settings folder for a bug report

Windows encrypts the file with DPAPI, so even if the file leaves the PC, other users and other PCs cannot decrypt it. The same API key is protected to a different extent depending on the OS.

### 1.3 A decision that had been left open

How to store the keys had not been decided. Item 35 in the list of decisions needed in [Core integration](../voice-stack/core-integration.md) set out 2 options, "keep the current `secrets.json`" and "the OS credential vault". 0.5.0 kept `secrets.json`, which is easier to back out of. This ADR takes over that decision.

## 2. Decision

### 2.1 The decision

The entries in `SECRET_SETTINGS` move to the OS credential store.

| OS | Storage |
|---|---|
| Windows | Credential Manager (`CredWriteW`, `CredReadW`, `CredDeleteW`) |
| Linux | Secret Service (the freedesktop.org D-Bus specification; GNOME Keyring, KWallet and others) |

The work is done in Issue #575. The move adds one more `SecretStore` implementation and swaps `Services::secret_store`. The in-memory shape of the settings, the IPC requests and responses and the entry naming do not change.

### 2.2 Properties to keep

After the move, these properties still hold.

1. **Keys do not leak.** Key values do not go into logs, errors, notifications or `process.log`. `StoreError` carries only the reason. Only entry names are reported.
2. **Keys are not lost silently.** Only entries that were written to the new storage and read back count as moved (the same idea as `write_verified`).
3. **After a failure, the app starts in the last good state.** If the app crashes partway through the migration, each key remains in either the old storage or the new one (the data integrity policy of #517).
4. **Temporary failures are not mistaken for corruption.** When the store does not respond or is locked, neither the old storage nor the contents of the store are touched.
5. **Nothing is sent out without the user's action.** Only stores inside the OS are used, and no storage on the network.

## 3. Alternatives considered

### 3.1 Candidates

| Option | Description |
|---|---|
| (a) Keep as is | `secrets.json` encrypted with DPAPI on Windows, plain-text `secrets.json` with 0600 permissions on Linux |
| (b) OS credential store | Credential Manager on Windows, Secret Service on Linux |
| (c) Encrypt with a key the app manages | The app creates an encryption key and encrypts `secrets.json` with it. The encryption key is kept in the app's folder or embedded in the executable |

### 3.2 Comparison

| Aspect | (a) Keep as is | (b) OS credential store | (c) Encrypt with the app's key |
|---|---|---|---|
| The file leaves the PC on Linux | The keys can be read as they are | The keyring is encrypted with a key derived from the login password. The keyring file alone does not reveal the keys (unless the keyring has no password) | The encryption key is on the same PC, so if the whole settings folder leaves, the keys can be read. Even if the encryption key is embedded in the executable, anyone can get the executable |
| The file leaves the PC on Windows | DPAPI keeps other users and other PCs from reading it | Credential Manager also uses DPAPI internally. The protection is about the same as (a) | Weaker than (a) if DPAPI is dropped |
| Other programs running as the same user | On Windows they can decrypt it by calling DPAPI. On Linux they can read the file | On Windows they can read the credentials. On Linux they can request them over D-Bus while the keyring is unlocked. No option prevents this | They can read the encryption key and the file, so this is not prevented |
| Same protection on both OSes | No (plain text on Linux only) | Yes (on both, the OS protects the keys and ties them to the login) | Yes, but both at the weaker level |
| Dependencies | None added | On Windows, only a `windows-sys` feature is added. On Linux, the core gains D-Bus dependencies (`keyring`, `secret-service`, `zbus` or others; all MIT or Apache-2.0) | A cryptography library is added |
| Environments where it does not work | None | Linux without Secret Service (a desktop with only a window manager, over SSH, no keyring, a keyring that has not been unlocked) | None |
| Risk of losing keys | Low | Lost when the store is cleared or the user account is recreated, which is how the OS normally works | Losing the encryption key file makes the API keys unreadable. Encryption adds one more way to lose them |
| Can users check the keys | Visible by opening the file (Linux) | Users can view and delete them in OS tools (Credential Manager, Seahorse, KWalletManager) | Not visible |

### 3.3 Why the other options were not chosen

- **(a) Keep as is**: Plain text remains on Linux, and the problem in section 1.2 is not solved. The protection still differs by OS. Adding no dependencies and working the same in every environment are advantages, and section 9 decides whether to keep it as the fallback storage for (b).
- **(c) A key the app manages**: The encryption key sits on the same PC, so when the file leaves the PC, the encryption key leaves with it. In practice this protects little more than file permissions do, and because it looks encrypted, it misleads people about what is protected. It also adds a new way to lose the keys: losing the encryption key loses the API keys too. Deriving the encryption key from a user password would make it more effective, but the app would then ask for a password at every start and rebuild what the OS keyring already does.

### 3.4 Why (b) is chosen

- It removes the plain text on Linux. The keyring is tied to the login credentials, so the keys cannot be read even if the file leaves the PC.
- Windows and Linux follow the same model: the OS protects the keys and ties them to the login.
- Key management is left to the OS, so the app holds no encryption key.
- Users can check and delete the keys in OS tools.
- #384 already provides the point for swapping implementations (`SecretStore`, `Services::secret_store`), and the migration can follow the same path as the move from `config.json` to `secrets.json`.

Even (b) cannot protect the keys from a malicious program running as the same user. The same is true of (a) and (c), and this ADR does not include that in what it protects against.

## 4. Consequences

### 4.1 Gains

- API keys no longer stay in a plain-text file on Linux.
- Handing over the settings folder for a backup or a report does not hand over the keys with it (both OSes).
- The difference in protection between the OSes also becomes smaller in the spec and the documents.

### 4.2 Costs and risks

- The core on Linux gains D-Bus dependencies. Update `NOTICE.md`, the license register and the list in `tools/rust_licenses.py`. `zbus` is written in Rust only, so the AppImage does not need the D-Bus C library.
- The behavior on Linux without Secret Service, or with the keyring not unlocked, has to be decided (section 9).
- When the keyring is locked, the OS may show a dialog to unlock it. Decide when it may appear, and do not show an unexpected dialog during startup (section 9).
- Credential Manager holds up to 2,560 bytes per entry. Every current entry fits, but check this when adding a setting with long values to `SECRET_SETTINGS`.
- After going back to 0.5.x or earlier, the keys may be unreadable (section 4.3, section 9).
- Most Linux CI and development environments have no Secret Service. Tests use a fake store, and checks against the real store are done separately (section 7).

### 4.3 Migration approach

The keys move from the existing `secrets.json` step by step.

1. At startup, if `secrets.json` has entries, write them one by one to the OS store and read them back. Only entries that read back with the same value count as moved.
2. What happens to moved entries (removed from `secrets.json` or kept) is decided in section 9. If they are removed, the file is rewritten with only the moved entries removed, as in the move from `config.json` to `secrets.json`.
3. Entries that could not be moved stay in `secrets.json`, and the keys are kept in memory so that they work for the rest of that run. The existing `/run/secret_store_failed` (with `operation` set to `migrate`) reports only the entry names, and the move is retried at the next save and at a fixed interval. A failure for the same entry is reported only once until it is fixed.
4. Keys still in `config.json` (installs upgraded from 0.4 or earlier that have not finished the move to `secrets.json`) move to the OS store by the same steps.
5. If the app crashes partway, every entry remains in either the old storage or the OS store. The next start continues the same steps.
6. An unreadable `secrets.json` is not moved by the migration steps. The current `FileStore` handling (moving it to `.unreadable-` the next time a key is written) is reviewed to match the handling of `secrets.json` decided in section 9.

Entry names in the store (the target name on Windows, the attributes in Secret Service) use the internal identifier VRCT-VOX, not the display name ASTAROT. If the identifier changes, provide a migration as the [names and identifiers](../voice-stack/project-rename.md) policy says.

### 4.4 What does not change

- The in-memory shape of the settings, IPC requests and responses such as `/get/data/*_auth_key`, and the list in `/run/initialization_complete`
- The entry naming (`AUTH_KEYS/<provider name>` and so on) and how entries are specified in `SECRET_SETTINGS`
- The shape of `/run/secret_store_failed` (`{operation, entries, reason, store}`). `store` carries the type of the new storage
- A request to delete a key (`/delete/data/*_auth_key` and so on) also deletes it from the storage

## 5. Non-goals

- Protecting the keys from malicious programs running as the same user
- Moving the WebSocket token (`WEBSOCKET_AUTH_TOKEN`) and the restore token for Linux screen sharing (`OCR_PORTAL_RESTORE_TOKEN`). Whether to move them is decided under "whether to move other secrets as well" in item 35 of [Core integration](../voice-stack/core-integration.md). If they are moved, they follow this ADR's storage and properties
- Reconsidering whether the Papago Client ID stays a secret (item 37 of the same document)
- Supporting the macOS Keychain. The app does not target macOS
- Storage on the network, or integration with password managers

## 6. Scope of the work (Issue #575)

- Add a `SecretStore` implementation for each OS. Windows uses the credential API in `windows-sys`, and Linux uses the Secret Service D-Bus API
- The migration in section 4.3
- Implementing what section 9 decides (fallback storage, the handling of `secrets.json`, the handling of store failures)
- Updating the section on where API keys are stored in `docs/spec/data-and-persistence.md`, `docs/spec/cross-cutting.md` and the description in `secrets.rs`
- Updating `NOTICE.md`, the license register and `tools/rust_licenses.py`
- When adding text that users see, `en.yml` and `ja.yml` in `locales/`

## 7. Verification and acceptance criteria

| Aspect | What to check | How |
|---|---|---|
| Migration | Entries in `secrets.json` and `config.json` move to the OS store, and only those that read back count as moved | Core tests with a fake store (one that can inject failures, like `MemoryStore`) |
| Failure partway | Whether a write fails, a read-back does not match or the app exits partway, every entry remains in one of the two storage locations. The next start continues from where it stopped | Fault-injection tests. Tests that start again from a state stopped partway |
| Temporary failure | When the store does not respond or is locked, neither the old storage nor the contents of the store change | Inject temporary failures and corrupted contents separately with the fake store |
| No key leaks | Key values do not appear in logs, errors, notifications or `process.log` | Tests check that the output does not contain key values |
| IPC compatibility | Requests and responses for `/get/data/*_auth_key`, `/delete/data/*_auth_key` and `/run/secret_store_failed` do not change | The existing core tests |
| Real Windows hardware | Keys can be written to Credential Manager, read after a restart and deleted. They move from the DPAPI `secrets.json` | A check on a real Windows machine |
| Real Linux hardware | Keys can be written, read and deleted with GNOME Keyring and KWallet. The behavior without Secret Service and with a locked keyring matches what section 9 decides | A check on a real Linux machine. In CI, use `dbus-run-session` and a keyring daemon |
| Distribution | Works in the AppImage and the other Linux packages | Check with the steps in `release-candidates.md` |
| Licenses | Added dependencies appear in `NOTICE.md` and the register | `tools/rust_licenses.py` |

Anything that cannot be checked on both OSes is marked "not verified" in the PR and checked during release candidate verification before it goes into a stable release (the same handling as section 2.7 of ADR-012).

## 8. Revisit triggers

- Many users are on Linux without Secret Service, and the handling of fallback storage affects how they use the app
- More forms of distribution are supported (the Flatpak Secret portal, Snap, ARM and so on)
- A serious vulnerability or a major change in specification appears in the Credential Manager or Secret Service API, or in a dependency in use
- A value that could exceed the size limit for one entry is added to `SECRET_SETTINGS`
- Protection from programs running as the same user becomes necessary

## 9. Decisions needed

The following had not been decided when this ADR was accepted. They were decided during the work in Issue #575 and written in section 10.

1. **Handling Linux environments where Secret Service is not available.** Whether to have fallback storage. If so, whether to write to the current 0600 `secrets.json`. If not, whether to keep the keys in memory for that run only and report that they cannot be saved. In either case, when, where and how to tell the user (the settings screen, a notice at startup, `/run/secret_store_failed`). With fallback storage, whether to tell the user clearly that the keys are saved in plain text and get their consent.
2. **Handling `secrets.json` after the migration.** Whether to remove moved entries at once, keep them for a set period or number of versions, or delete the file. Keeping them means the keys can still be read after going back to 0.5.x, but plain text stays on Linux for that time. Removing them means the keys have to be entered again after going back to 0.5.x. Whether to mention this in the release notes is decided together with this point.
3. **Handling store failures.** What to do when, at startup, the store does not respond, the keyring is locked or the contents of the store cannot be read. Whether to show the dialog that unlocks the keyring at startup, when a feature that uses a key starts, or never. Whether to start with empty keys until the keyring is unlocked, or to read `secrets.json` if it is still there. How many times and at what interval to retry.
4. **Handling an unreadable `secrets.json`.** The current `FileStore` moves an unreadable file to `.unreadable-` the next time a key is written. After the move to the OS store, whether to keep an unreadable `secrets.json`, move it or report it.

## 10. What was decided during the work (Issue #575)

For the 4 points in section 9, the options chosen from those listed there are the ones that do not lose keys and do not add plain text.

### 10.1 Linux environments where Secret Service is not available (point 1 of section 9)

#### Decision

There is no fallback storage. Newly entered and changed keys are kept in memory for that run only, and `/run/secret_store_failed` reports this (`reason` is `unavailable` or `locked`). Keys saved in `secrets.json` up to 0.5 are read from that file and used until they can be moved to the OS store, and they are not deleted.

#### Reasons

- Writing to the 0600 `secrets.json` would extend the plain-text storage that this ADR set out to remove to new keys as well. It would also need a screen that asks for consent to save in plain text.
- Keeping keys only in memory does not lose them silently. A notification says they cannot be saved, and saving is retried at the next save and every 30 seconds.
- Deleting keys already saved in plain text would lose them.

#### How the user is told

When saving or migration fails, and when a key could not be read at startup, `/run/secret_store_failed` reports only the entry names. Each entry is reported once until it is fixed. For `unavailable` and `locked`, a notification on screen asks the user to start the keyring (GNOME Keyring, KWallet or others), unlock it and restart the app. For a migration failure (`migrate`), it says that the key is still in its original place and can be used as before. No indicator that stays on the settings screen was added.

### 10.2 `secrets.json` after the migration (point 2 of section 9)

#### Decision

Each entry written to the OS store and read back is removed from `secrets.json` at that time. The file itself is not deleted. It stays as the file that holds the ID of the settings folder (`store_id` in section 10.5).

#### Reasons

- Keeping the entries would leave plain text on Linux. When the values in the 2 places disagreed, there would also be no way to decide which one to use.
- The file is kept because the ID has to be stored somewhere.
- Going back to 0.5.x means entering the keys again. The keys remain in the OS store and can be checked in Credential Manager, Seahorse or KWalletManager. This goes in the release notes (it was also written in the commit's `BREAKING CHANGE`).

### 10.3 Store failures (point 3 of section 9)

#### Decision

- No dialog to unlock the keyring is shown, neither at startup nor when a feature that uses a key starts. The app does not call `Unlock` or `Prompt` in Secret Service.
- A locked keyring, and a write for which the keyring tried to ask the user, are `locked`. No store, no session bus, or a single call that does not respond within 5 seconds is `unavailable`. Both are treated as temporary failures. With Credential Manager, no logon session and a busy system are `unavailable`.
- A temporary failure touches neither `secrets.json` nor the OS store.
- For an entry that could not be read from the OS store at startup, the value in `secrets.json` is used if it is still there. If not, the entry is treated as empty for that run and reported as a `read` failure. A key that could not be read is not overwritten with an empty value or deleted.
- Reads are not retried during that run. They are tried again at the next start. Writes, deletes and migrations are retried at the next save and every 30 seconds (the mechanism from 0.5, unchanged).

#### Reasons

No unexpected dialog during startup (section 4.2). If a read were retried during the run to fill in a value, the values the UI received at startup would disagree with the values in the backend.

### 10.4 An unreadable `secrets.json` (point 4 of section 9)

#### Decision

- The file is not deleted in any case.
- A file that parses as JSON but whose entries cannot be decrypted (another user's DPAPI, for example) is left as it is, and its `store_id` stays in use. Each of its entries is reported as a `read` failure at every start while it is not in the OS store. The next time a key is saved to the OS store, the file is moved to `secrets.json.unreadable-<timestamp>-<random>`, and a new file that carries over the `store_id` is created. This is the same as the 0.5 `FileStore`, which moved the file on the next write.
- A file that does not parse as JSON is also moved to `.unreadable-` when a key is saved, and a new file is created with a new ID. Entries placed in the OS store under the old ID remain and are not deleted.
- A file that is only temporarily unreadable (a lock, a temporary I/O failure, DPAPI not responding) is left untouched, and the write becomes a temporary failure (the same as #427 and #470).

#### Reasons

A file that may contain keys is not deleted, and the user is told that it cannot be read. It is moved only so that new keys can be saved, and the moved file is kept too.

### 10.5 What was implemented

- `SystemStore` (`native/core/src/config/secrets/system.rs`) implements `SecretStore` and became the default for `Services::secret_store`. Internally it combines the OS store (`Vault`) with `secrets.json` (`FileStore`). IPC, the shape of the settings and the entry names did not change. The `store` in `/run/secret_store_failed` became `credential_manager` or `secret_service`, and `reason` gained `unavailable` and `locked`.
- Each settings folder gets a 16-digit hexadecimal ID, kept as `store_id` in `secrets.json`. Entries in the OS store are separated by this ID, so that development and test settings separated with `VRCT_CONFIG_DIR` do not read or delete the user's keys. If the folder moves, the ID moves with it. The ID is created when the first key is saved, and the OS store is not queried while there is no ID. The ID is not a secret.
- On Windows, entries are generic credentials named `VRCT-VOX/<ID>/<entry name>`, with the persistence `CRED_PERSIST_LOCAL_MACHINE` (they are not sent to other PCs through a roaming profile; property 5 in section 2.2).
- On Linux, entries go in the default collection and are looked up by the attributes `application=vrct-vox`, `vrct-vox-store=<ID>` and `entry=<entry name>`. The label is `VRCT-VOX <entry name>`. When there is no default collection, creating one would mean asking the user, so this is treated as `unavailable`. The app talks to D-Bus through `zbus`, and the session uses `plain` from the specification. This ADR does not protect against programs of the same user (section 5), so no encryption on the bus was added.
- Migration (section 4.3): When startup finds entries that are only in `secrets.json`, it keeps using them while it writes each one to the OS store and reads it back, and it removes from `secrets.json` only the entries that read back with the same value. Entries that fail stay in `secrets.json`, are reported as `migrate` failures and are retried at the next save and every 30 seconds. Keys left in `config.json` (0.4 or earlier) move to the OS store without going through `secrets.json`. If the process stops partway, each entry remains in one place or the other. When an entry is in both, the value in the OS store is used, and the copy in `secrets.json` is removed only when the values are the same.
- A delete removes the copy in `secrets.json` first, then removes the entry from the OS store. Even if the OS store does not respond, no plain-text copy remains.
- Dependencies: `zbus` 5.19.0 was added to the core on Linux. The app already uses the same version for portals such as screen sharing, so the list in `tools/rust_licenses.py` (Windows 379, Linux 455) does not change. On Windows, only the `windows-sys` feature `Win32_Security_Credentials` was added.
- Tests: `MemoryStore`, which can inject failures, stands in for the OS store to check migration, failures partway, temporary failures, deletion and unreadable files (`native/core/src/config/secrets/system.rs` and `native/core/tests/secret_store.rs`). Core tests use this stand-in store by default and do not touch the credentials on the PC. Tests against the real store are marked `#[ignore]`. In CI, they run on Linux with GNOME Keyring started on a dedicated session bus, and on Windows with the runner's Credential Manager.

### 10.6 What remains

- Checks on real hardware with KWallet, Linux with a locked keyring, Linux without Secret Service and the AppImage. As section 7 says, these are done during release candidate verification.
- Stating in the release notes that going back to 0.5.x requires entering the keys again.
- If many users are on systems without Secret Service, that meets a revisit trigger in section 8. Fallback storage that saves in plain text with the user's consent will then be considered again.

### 10.7 API keys in the translation catalog (added 2026-11-19)

The keys of API entries that users add to the translation catalog (`TRANSLATION_CATALOG/<entry ID>`, #413) are not settings in `SECRET_SETTINGS`. They still follow this ADR's storage and properties, and the handling when they cannot be stored also matches sections 10.1 and 10.3.

- Even when the key cannot be written to the storage or read back, the entry is added. The key is kept in memory for that run only. `/run/secret_store_failed` reports it once, and the write is tried again at the next save, every 30 seconds and at exit. The key is not written to a plain-text file (`Config::keep_secret`).
- The entry's `key` is set to `true` once the storage holds the key. An entry whose key was still not stored at exit remains as an entry without a key at the next start. The UI shows this and tells the user to delete the entry and add it again.
- When the storage is temporarily unreadable (`locked`, `unavailable` and so on), the key is not treated as missing, and nothing changes (property 4 in section 2.2).

When #597 introduced this, an entry whose key could not be stored was not added, and `translation_catalog_key_store_failed` was returned. That handling differed from section 10.1, so it was changed to match section 10.1.

---

# ADR-013: API キーを OS の資格情報ストアに保管する（日本語版）

Status: 採用（2026-11-18）。保管先を OS の資格情報ストアへ移すことを決める。実施は Issue #575 で、9 の判断と実施の内容は 10 に書き足した。
Date: 2026-11-18
Decision owners: リポジトリの保守担当者
Related: Issue #575、Issue #517、PR #384、[中核の統合](../voice-stack/core-integration.md)の「判断が要ること」の 35 と 37、[データと保存](../spec/data-and-persistence.md#apiキーの保存先)、[横断的な振る舞い](../spec/cross-cutting.md)、[ADR-011](adr-011-astarot-brand-and-multimodal-accessibility.md)、[名称と識別子](../voice-stack/project-rename.md)、`native/core/src/config/secrets.rs`、`NOTICE.md`

この ADR の「アプリ」は本リポジトリのアプリを指す。表示名は ASTAROT（ADR-011）で、保存先やアプリ ID などの識別子は VRCT-VOX のままである。

> **移行の注記**（2026-11-18、Issue #587）：この ADR は `docs/voice-stack/` にあったときに書いた。7 でファイル名だけを書いた `release-candidates.md` は、いまも `docs/voice-stack/` にある（[配布候補](../voice-stack/release-candidates.md)）。本文は書き換えていない。

## 1. Context（背景）

### 1.1 現在の保管（0.5.0 から）

API キーは #384 で `config.json` から分け、同じフォルダの `secrets.json` に保管している。実装は `native/core/src/config/secrets.rs` の `SecretStore` で、アプリが使うのはファイルに書く `FileStore` である。対象は `SECRET_SETTINGS` に名前のある設定で、いまは次の 3 つである。

| 設定 | 中身 | `secrets.json` の項目の名前 |
|---|---|---|
| `AUTH_KEYS` | 翻訳のプロバイダの API キー | `AUTH_KEYS/<プロバイダ名>` |
| `TRANSCRIPTION_AUTH_KEYS` | 音声認識のプロバイダの API キー | `TRANSCRIPTION_AUTH_KEYS/<プロバイダ名>` |
| `PAPAGO_CLIENT_ID` | Papago の Client ID（Secret と組で使う） | `PAPAGO_CLIENT_ID` |

OS ごとの保護は次のとおりである。

| OS | `protection` | 保護の中身 |
|---|---|---|
| Windows | `dpapi` | 項目の一覧を DPAPI（`CryptProtectData`）で暗号化する。復号できるのは、暗号化したときにサインインしていたユーザーだけである |
| Linux | `none` | 項目の一覧を平文で書く。ファイルの権限を 0600（所有者だけが読み書きできる）にするだけである |

どちらも、書き込みは一時ファイル、`fsync`、置き換えの順で行う。読めないファイル（別のユーザーの DPAPI、壊れた内容）は、次にキーを書くときに `secrets.json.unreadable-<日時>-<乱数>` へ移す。一時的に読めないだけのとき（ロック、I/O の一時的な失敗、DPAPI が応答しない）は、ファイルに触れずに書き込みを失敗にする（#427、#470）。保存先に書けない、読み戻せないときは、キーをメモリーに残してその起動のあいだ使えるようにし、`/run/secret_store_failed` で項目の名前だけを知らせる。エラーとログにキーの値は入らない。

### 1.2 Linux が平文であることの問題

Linux の `secrets.json` は、ファイルを読めればキーがそのまま読める。0600 の権限は、同じ PC のほかのユーザーからは守るが、次の場合には効かない。

- 設定のフォルダがバックアップ、同期のツール、ほかの PC への移行で外へ出たとき
- 暗号化していないディスクを外して読まれたとき
- 不具合の報告のために、利用者が設定のフォルダをまとめて渡したとき

Windows は DPAPI で暗号化しているので、ファイルが外へ出てもほかのユーザーやほかの PC では復号できない。同じ API キーでも、OS によって守られる範囲が違う。

### 1.3 未決のまま残っていた判断

保管先の方式は、[中核の統合](../voice-stack/core-integration.md)の「判断が要ること」の 35 で「いまの `secrets.json` のまま」と「OS の資格情報の保管庫」の 2 案が並び、決まっていなかった。0.5.0 では後戻りしやすい `secrets.json` を残した。この ADR はその判断を引き取る。

## 2. Decision（決定）

### 2.1 決定

`SECRET_SETTINGS` の項目の保管先を、OS の資格情報ストアへ移す。

| OS | 保管先 |
|---|---|
| Windows | 資格情報マネージャー（Credential Manager。`CredWriteW`、`CredReadW`、`CredDeleteW`） |
| Linux | Secret Service（freedesktop.org の D-Bus の仕様。GNOME Keyring、KWallet など） |

実施は Issue #575 で行う。移す仕組みは `SecretStore` の実装を 1 つ足し、`Services::secret_store` を差し替える形にする。設定のメモリー上の形、IPC の要求と応答、項目の名前の付け方は変えない。

### 2.2 守る性質

移した後も、次の性質を保つ。

1. **キーを外へ出さない。** ログ、エラー、通知、`process.log` にキーの値を入れない。`StoreError` は理由だけを持つ。知らせるのは項目の名前だけである。
2. **キーを黙って失わない。** 新しい保管先に書いて読み戻せたものだけを、移せたものとして扱う（`write_verified` と同じ考え方）。
3. **失敗しても直前の正常な状態で起動する。** 移行の途中で落ちても、キーは古い保管先か新しい保管先のどちらかに残る（#517 のデータ整合性の方針）。
4. **一時的な失敗を壊れたものと取り違えない。** ストアが応答しない、ロックされているときは、古い保管先にもストアの中身にも触れない。
5. **利用者の操作なしに外へ送らない。** ストアは OS の中にあるものだけを使い、ネットワーク上の保管先は使わない。

## 3. Alternatives considered（検討した案）

### 3.1 候補

| 案 | 内容 |
|---|---|
| (a) 現状維持 | Windows は DPAPI で暗号化した `secrets.json`、Linux は 0600 の平文の `secrets.json` |
| (b) OS の資格情報ストア | Windows は資格情報マネージャー、Linux は Secret Service |
| (c) アプリが管理する鍵で暗号化 | アプリが鍵を作り、その鍵で `secrets.json` を暗号化する。鍵はアプリのフォルダか、実行ファイルに埋め込む |

### 3.2 比較

| 観点 | (a) 現状維持 | (b) OS の資格情報ストア | (c) アプリの鍵で暗号化 |
|---|---|---|---|
| Linux でファイルが外へ出たとき | キーがそのまま読める | 鍵束はログインのパスワードから作った鍵で暗号化されている。鍵束のファイルだけではキーを読めない（鍵束にパスワードを付けていない場合を除く） | 鍵も同じ PC にあるので、設定のフォルダごと出れば読める。鍵を実行ファイルに埋めても、実行ファイルは誰でも手に入る |
| Windows でファイルが外へ出たとき | DPAPI でほかのユーザーやほかの PC では読めない | 資格情報マネージャーも中で DPAPI を使う。守られる範囲は (a) とほぼ同じ | DPAPI をやめるなら (a) より弱くなる |
| 同じユーザーで動くほかのプログラム | Windows は DPAPI を呼べば復号できる。Linux はファイルを読める | Windows は資格情報を読める。Linux は鍵束が開いていれば D-Bus で要求できる。どの方式でも防げない | 鍵とファイルを読めるので防げない |
| 両 OS での守られ方の揃い方 | 揃わない（Linux だけ平文） | 揃う（どちらも OS がログインと結び付けて守る） | 揃うが、どちらも弱い側に揃う |
| 依存 | 増えない | Windows は `windows-sys` の機能を足すだけ。Linux は D-Bus の依存（`keyring`、`secret-service`、`zbus` など。いずれも MIT か Apache-2.0）が中核に増える | 暗号のライブラリが増える |
| 動かない環境 | ない | Linux で Secret Service がない環境（ウィンドウマネージャーだけのデスクトップ、SSH 越し、鍵束がない、開かれていない） | ない |
| 鍵を失う危険 | 少ない | ストアの消去やユーザーの作り直しで失う。OS の作法どおりである | 鍵のファイルを失うとキーも読めない。暗号化の分だけ失い方が増える |
| 利用者が確かめられるか | ファイルを開けば見える（Linux） | OS の画面（資格情報マネージャー、Seahorse、KWalletManager）で見て消せる | 見えない |

### 3.3 採らなかった理由

- **(a) 現状維持**: Linux の平文が残り、1.2 の問題が解けない。OS によって守られる範囲が違うままになる。依存が増えないことと、どの環境でも同じに動くことは利点で、(b) の代わりの保管先として残すかを 9 で決める。
- **(c) アプリが管理する鍵**: 鍵を同じ PC に置くので、ファイルが外へ出る場合には鍵も一緒に出る。権限で守るのと実効はほとんど変わらず、暗号化したように見える分だけ守られる範囲を誤解させる。鍵を失ったときにキーも失うという新しい失い方も増える。利用者のパスワードから鍵を作れば実効は上がるが、起動のたびにパスワードを求めることになり、OS の鍵束と同じことをアプリが作り直すことになる。

### 3.4 (b) を採る理由

- Linux の平文をなくせる。鍵束はログインの資格情報と結び付いていて、ファイルが外へ出てもキーを読めない。
- Windows と Linux で、OS がログインと結び付けてキーを守るという同じ形に揃う。
- 鍵の管理を OS に任せるので、アプリは暗号の鍵を持たない。
- 利用者が OS の画面でキーを確かめ、消せる。
- 実装の差し替え口（`SecretStore`、`Services::secret_store`）が #384 で用意してあり、移行も `config.json` から `secrets.json` へ移したときと同じ道で書ける。

(b) でも、同じユーザーで動く悪意のあるプログラムからは守れない。これは (a)、(c) も同じで、この ADR はそこまでを守る範囲にしない。

## 4. Consequences（影響）

### 4.1 得るもの

- Linux で API キーが平文のファイルに残らなくなる。
- 設定のフォルダをバックアップや報告のために渡しても、キーが一緒に出ない（両 OS）。
- OS ごとの保護の差が、仕様と文書の上でも小さくなる。

### 4.2 負担とリスク

- Linux の中核に D-Bus の依存が増える。`NOTICE.md`、ライセンス台帳、`tools/rust_licenses.py` の一覧を更新する。`zbus` は Rust だけで書かれていて、AppImage に D-Bus の C のライブラリを入れずに済む。
- Linux で Secret Service がない環境、開かれていない環境での振る舞いを決める必要がある（9）。
- 鍵束がロックされていると、OS が開くためのダイアログを出すことがある。いつ出るかを決め、起動の途中で予期しないダイアログを出さない（9）。
- 資格情報マネージャーは 1 件あたり 2,560 バイトまでである。いまの項目はどれも収まるが、長い値を持つ設定を `SECRET_SETTINGS` に足すときは確かめる。
- 0.5.x 以前の版に戻したときに、キーが読めないことがある（4.3、9）。
- Linux の CI と開発の環境の多くは Secret Service を持たない。試験は偽のストアで行い、本物のストアでの確認は別に行う（7）。

### 4.3 移行の方針

既存の `secrets.json` から、段階的に移す。

1. 起動時に、`secrets.json` に項目があれば、1 件ずつ OS のストアに書いて読み戻す。同じ値が読めたものだけを移せたものとして扱う。
2. 移せた項目の扱い（`secrets.json` から除くか、残すか）は 9 で決める。除くときは、`config.json` から `secrets.json` へ移したときと同じく、移せたものだけを除いて書き直す。
3. 移せなかった項目は `secrets.json` に残し、キーはメモリーに持ってその起動のあいだ使えるようにする。いまの `/run/secret_store_failed`（`operation` は `migrate`）で項目の名前だけを知らせ、次の保存と一定の間隔でもう一度試す。同じ項目の失敗は直るまで 1 回だけ知らせる。
4. `config.json` にまだキーが残っている環境（0.4 以前から上げた環境で、`secrets.json` への移行が終わっていないもの）からも、同じ手順で OS のストアへ移す。
5. 途中で落ちても、どの項目も古い保管先か OS のストアのどちらかに残る。次の起動で同じ手順を続ける。
6. 読めない `secrets.json` は、移行の手順では動かさない。いまの `FileStore` の扱い（次にキーを書くときに `.unreadable-` へ移す）は、9 で決める `secrets.json` の扱いに合わせて見直す。

ストアに置く項目の名前（Windows のターゲット名、Secret Service の属性）は、内部識別子の VRCT-VOX を使う。表示名の ASTAROT は使わない。識別子を変えるときは、[名称と識別子](../voice-stack/project-rename.md)の方針どおり移行を用意する。

### 4.4 変わらないもの

- 設定のメモリー上の形、`/get/data/*_auth_key` などの IPC の要求と応答、`/run/initialization_complete` の一覧
- 項目の名前の付け方（`AUTH_KEYS/<プロバイダ名>` など）と `SECRET_SETTINGS` での指定のしかた
- `/run/secret_store_failed` の形（`{operation, entries, reason, store}`）。`store` には新しい保管先の種類が入る
- キーを消す要求（`/delete/data/*_auth_key` など）で保管先からも消すこと

## 5. 非目標

- 同じユーザーで動く悪意のあるプログラムからキーを守ること
- WebSocket のトークン（`WEBSOCKET_AUTH_TOKEN`）と Linux の画面共有の再開トークン（`OCR_PORTAL_RESTORE_TOKEN`）を移すこと。移すかどうかは[中核の統合](../voice-stack/core-integration.md)の 35 の「ほかの秘密の値も移すか」で決める。移すと決めたときは、この ADR の保管先と性質に従う
- Papago の Client ID を秘密の値として扱い続けるかを決め直すこと（同じ文書の 37）
- macOS の Keychain に対応すること。アプリは macOS を対象にしていない
- ネットワーク上の保管先や、パスワードマネージャーとの連携

## 6. 実施の範囲（Issue #575）

- `SecretStore` の実装を OS ごとに足す。Windows は `windows-sys` の資格情報の API、Linux は Secret Service の D-Bus の API を使う
- 4.3 の移行
- 9 で決めたことの実装（代わりの保管先、`secrets.json` の扱い、ストアの障害の扱い）
- `docs/spec/data-and-persistence.md` の「APIキーの保存先」、`docs/spec/cross-cutting.md`、`secrets.rs` の説明の更新
- `NOTICE.md`、ライセンス台帳、`tools/rust_licenses.py` の更新
- 利用者に見える文言を足すときは、`locales/` の `en.yml` と `ja.yml`

## 7. Verification / Acceptance criteria（検証と受け入れの条件）

| 観点 | 確かめること | 方法 |
|---|---|---|
| 移行 | `secrets.json` と `config.json` の項目が OS のストアへ移り、読み戻せたものだけが移せたものとして扱われる | 偽のストア（`MemoryStore` と同じく失敗を注入できるもの）を使う中核の試験 |
| 途中の失敗 | 書き込みの失敗、読み戻しの不一致、途中での終了のどれでも、すべての項目がどちらかの保管先に残る。次の起動で続きから移る | 失敗を注入する試験。途中で止めた状態から起動し直す試験 |
| 一時的な失敗 | ストアが応答しない、ロックされているときに、古い保管先もストアの中身も変わらない | 偽のストアで、一時的な失敗と壊れた中身を分けて注入する |
| キーを外へ出さない | ログ、エラー、通知、`process.log` にキーの値が入らない | 試験で、出力にキーの値が含まれないことを確かめる |
| IPC の互換 | `/get/data/*_auth_key`、`/delete/data/*_auth_key`、`/run/secret_store_failed` の要求と応答が変わらない | 既存の中核の試験 |
| Windows の実機 | 資格情報マネージャーに書き、起動し直して読め、消せる。DPAPI の `secrets.json` から移る | Windows の実機での確認 |
| Linux の実機 | GNOME Keyring と KWallet で書き、読み、消せる。Secret Service がない環境、鍵束がロックされた環境での振る舞いが 9 で決めたとおりになる | Linux の実機での確認。CI で行うなら `dbus-run-session` と鍵束のデーモンを使う |
| 配布 | AppImage と、そのほかの Linux の配布物で動く | `release-candidates.md` の手順で確かめる |
| ライセンス | 足した依存が `NOTICE.md` と台帳に載る | `tools/rust_licenses.py` |

両方の OS で確かめられないものは、PR に「未確認」と書き、リリース候補の確認で確かめてから正式版に入れる（ADR-012 の 2.7 と同じ扱い）。

## 8. Revisit triggers（見直す条件）

- Linux で Secret Service がない環境の利用者が多く、代わりの保管先の扱いが利用に響くとき
- 対応する配布の形を増やすとき（Flatpak の Secret ポータル、Snap、ARM など）
- 資格情報マネージャーや Secret Service の API、または使う依存に深刻な脆弱性や大きな仕様の変更があったとき
- `SECRET_SETTINGS` に、1 件の大きさの上限を超えうる値を足すとき
- 同じユーザーで動くプログラムからの保護が必要になったとき

## 9. 判断が要ること

次のことは、この ADR を採用した時点では決めていなかった。Issue #575 の実施の中で決め、10 に書いた。

1. **Linux で Secret Service が使えない環境の扱い**。代わりの保管先を持つか。持つなら、いまの 0600 の `secrets.json` に書くか。持たないなら、キーをその起動のあいだだけメモリーに持ち、保存できないと知らせるか。どちらの場合も、利用者にいつ、どこで、どう知らせるか（設定の画面、起動時の通知、`/run/secret_store_failed`）。代わりの保管先を持つときに、平文で保存することを利用者に明示して同意を得るか。
2. **移行した後の `secrets.json` の扱い**。移せた項目をすぐ除くか、一定の期間か版のあいだ残すか、ファイルを消すか。残すと、0.5.x に戻したときにもキーが読めるが、Linux の平文がその間は残る。除くと、0.5.x に戻したときにキーの入れ直しが要る。リリースノートに書くかどうかも、この判断と一緒に決める。
3. **ストアの障害の扱い**。起動時にストアが応答しない、鍵束がロックされている、ストアの中身が読めないときに、どうするか。鍵束を開くダイアログを起動時に出すか、キーを使う機能を始めたときに出すか、出さないか。開かれるまでキーを空として起動するか、`secrets.json` が残っていればそちらを読むか。何回、どの間隔でもう一度試すか。
4. **読めない `secrets.json` の扱い**。いまの `FileStore` は、読めないファイルを次にキーを書くときに `.unreadable-` へ移す。OS のストアへ移した後も、読めない `secrets.json` を残すか、移すか、知らせるか。

## 10. 実施で決めたこと（Issue #575）

9 の 4 点は、9 に挙げた選択肢のうち、キーを失わず平文を増やさないものを選んだ。

### 10.1 Linux で Secret Service が使えない環境（9 の 1）

#### 決定

代わりの保管先は持たない。新しく入力したキーと変えたキーは、その起動のあいだだけメモリーに持ち、`/run/secret_store_failed` で知らせる（`reason` は `unavailable` か `locked`）。0.5 までに `secrets.json` に保存したキーは、OS のストアへ移せるまでそのファイルから読んで使い、消さない。

#### 理由

- 0600 の `secrets.json` に書き続けると、この ADR がなくそうとした平文の保管が新しいキーにも広がる。平文で保存することへの同意を求める画面も要る。
- メモリーに持つだけなら、キーを黙って失うことはない。保存できないことは通知で知らせ、次の保存と 30 秒ごとにもう一度試す。
- すでに平文で保存してあるキーを消すと、キーを失う。

#### 知らせ方

保存や移行に失敗したときと、起動時に読めなかったときに、`/run/secret_store_failed` で項目の名前だけを知らせる。同じ項目は直るまで 1 回だけである。`unavailable` と `locked` のときは、画面の通知で鍵束（GNOME Keyring や KWallet など）を起動してロックを解除し、アプリを再起動するよう伝える。移行の失敗（`migrate`）のときは、キーが元の場所に残っていてそのまま使えることを伝える。設定の画面に常に出す表示は足していない。

### 10.2 移行した後の `secrets.json`（9 の 2）

#### 決定

OS のストアに書いて読み戻せた項目は、そのつど `secrets.json` から除く。ファイルそのものは消さず、設定のフォルダの ID（10.5 の `store_id`）を持つファイルとして残す。

#### 理由

- 項目を残すと、Linux では平文が残る。2 か所の値が食い違ったときに、どちらを使うかも決められない。
- ファイルを消さないのは、ID を置く場所が要るからである。
- 0.5.x に戻すとキーの入れ直しが要る。キーは OS のストアに残っていて、資格情報マネージャーや Seahorse、KWalletManager で確かめられる。このことはリリースノートに書く（コミットの `BREAKING CHANGE` にも書いた）。

### 10.3 ストアの障害（9 の 3）

#### 決定

- 鍵束を開くダイアログは出さない。起動時にも、キーを使う機能を始めたときにも出さない。アプリは Secret Service の `Unlock` と `Prompt` を呼ばない。
- ロックされた鍵束と、鍵束が尋ねようとした書き込みは `locked`、ストアがない、セッションバスがない、1 回の呼び出しが 5 秒以内に応答しないときは `unavailable` とし、どちらも一時的な失敗として扱う。資格情報マネージャーでは、ログオンのセッションがないときと、システムが混んでいるときを `unavailable` とする。
- 一時的な失敗では `secrets.json` にも OS のストアにも触れない。
- 起動時に OS のストアから読めなかった項目は、`secrets.json` に残っていればそちらを使う。残っていなければ、その起動のあいだは空として扱い、`read` の失敗として知らせる。読めなかったキーを、空の値で上書きしたり消したりはしない。
- 読み出しはその起動のあいだにはやり直さない。次の起動でもう一度読む。書き込み、削除、移行は、次の保存と 30 秒ごとにやり直す（0.5 からの仕組みのまま）。

#### 理由

起動の途中に予期しないダイアログを出さない（4.2）。読み出しを起動の途中でやり直して値を埋めると、画面が起動時に受け取った値とバックエンドの値が食い違う。

### 10.4 読めない `secrets.json`（9 の 4）

#### 決定

- どの場合もファイルは消さない。
- JSON として読めるが項目を復号できないファイル（別のユーザーの DPAPI など）は、そのまま残し、`store_id` は使い続ける。その項目は OS のストアにないときに `read` の失敗として起動のたびに知らせる。次にキーを OS のストアへ保存したときに、`secrets.json.unreadable-<日時>-<乱数>` へ移し、`store_id` を引き継いだ新しいファイルを作る。0.5 の `FileStore` が次の書き込みで移していたのと同じである。
- JSON として読めないファイルも、キーを保存するときに同じく `.unreadable-` へ移し、新しい ID でファイルを作る。古い ID で OS のストアに置いた項目は、消さずに残る。
- 一時的に読めないファイル（ロック、I/O の一時的な失敗、DPAPI が応答しない）には触れず、書き込みを一時的な失敗にする（#427、#470 と同じ）。

#### 理由

キーを含むかもしれないファイルを消さず、読めないことは知らせる。移すのは、新しいキーを保存できるようにするためだけで、移した先のファイルも残る。

### 10.5 実施の内容

- `SystemStore`（`native/core/src/config/secrets/system.rs`）が `SecretStore` を実装し、`Services::secret_store` の既定になった。中で OS のストア（`Vault`）と `secrets.json`（`FileStore`）を組み合わせる。IPC、設定の形、項目の名前は変えていない。`/run/secret_store_failed` の `store` は `credential_manager` か `secret_service` になり、`reason` に `unavailable` と `locked` が加わった。
- 設定のフォルダごとに 16 桁の 16 進の ID を作り、`secrets.json` の `store_id` に置く。OS のストアの項目はこの ID で分ける。`VRCT_CONFIG_DIR` で分けた開発や試験の設定が、利用者のキーを読んだり消したりしないためである。フォルダを移しても ID は一緒に移る。ID は最初のキーを保存したときに作り、ID がないうちは OS のストアに問い合わせない。ID は秘密の値ではない。
- Windows の項目は汎用の資格情報で、名前は `VRCT-VOX/<ID>/<項目の名前>`、保存の範囲は `CRED_PERSIST_LOCAL_MACHINE` である（移動プロファイルでほかの PC へ送られない。2.2 の 5）。
- Linux の項目は既定のコレクションに置き、属性 `application=vrct-vox`、`vrct-vox-store=<ID>`、`entry=<項目の名前>` で探す。ラベルは `VRCT-VOX <項目の名前>` である。既定のコレクションがないときは、作ると利用者に尋ねることになるので `unavailable` とする。D-Bus は `zbus` で話し、セッションは仕様の `plain` を使う。同じユーザーのプログラムからは守らない（5）ので、バスの上の暗号化は足さなかった。
- 移行（4.3）: 起動時に `secrets.json` だけにある項目を見つけたら、それを使いながら 1 件ずつ OS のストアに書いて読み戻し、同じ値が読めたものだけを `secrets.json` から除く。失敗した項目は `secrets.json` に残り、`migrate` の失敗として知らせ、次の保存と 30 秒ごとにやり直す。`config.json` に残っていたキー（0.4 以前）は、`secrets.json` を通らずに OS のストアへ移る。途中で止まっても各項目はどちらかに残る。両方にあるときは OS のストアの値を使い、同じ値のときだけ `secrets.json` の写しを除く。
- 削除は `secrets.json` の写しを先に除いてから、OS のストアから除く。OS のストアが応答しなくても、平文の写しは残らない。
- 依存: Linux の中核に `zbus` 5.19.0 を足した。アプリが画面共有などのポータルにすでに同じ版を使っていて、`tools/rust_licenses.py` の一覧（Windows 379、Linux 455）は変わらない。Windows は `windows-sys` の機能 `Win32_Security_Credentials` を足しただけである。
- 試験: 失敗を注入できる `MemoryStore` を OS のストアの代わりにして、移行、途中の失敗、一時的な失敗、削除、読めないファイルを確かめる（`native/core/src/config/secrets/system.rs` と `native/core/tests/secret_store.rs`）。中核の試験は既定でこの代わりのストアを使い、PC の資格情報に触れない。本物のストアを使う試験は `#[ignore]` で、CI では Linux は GNOME Keyring を専用のセッションバスで起動して、Windows はランナーの資格情報マネージャーで実行する。

### 10.6 残っていること

- KWallet、鍵束がロックされた Linux、Secret Service のない Linux、AppImage での実機の確認。7 のとおり、リリース候補の確認で行う。
- 0.5.x に戻したときにキーの入れ直しが要ることを、リリースノートに書くこと。
- Secret Service がない環境の利用者が多いときは、8 の見直す条件に当たる。そのときは、平文で保存することに同意を得る代わりの保管先を、改めて検討する。

### 10.7 翻訳のカタログの API のキー（2026-11-19 追記）

翻訳のカタログに利用者が足した API の項目のキー（`TRANSLATION_CATALOG/<項目の ID>`、#413）は、`SECRET_SETTINGS` の設定ではない。それでもこの ADR の保管先と性質に従い、保管場所に置けないときの扱いも 10.1 と 10.3 に合わせる。

- 保管場所に書けない、読み戻せないときも項目は足す。キーはその起動のあいだだけメモリーに持つ。`/run/secret_store_failed` で 1 回だけ知らせ、次の保存、30 秒ごと、終了時にもう一度書く。平文のファイルには書かない（`Config::keep_secret`）。
- 項目の `key` は、保管場所がキーを持てたときに `true` にする。置けないまま終了した項目は、次の起動ではキーのない項目として残る。画面はそのことを示し、項目を削除して追加し直すよう伝える。
- 保管場所が一時的に読めないとき（`locked`、`unavailable` など）は、キーがないとは扱わずに何も変えない（2.2 の 4）。

#597 で入れたときは、置けなければ項目を足さず `translation_catalog_key_store_failed` を返していた。この扱いは 10.1 と違っていたので、10.1 に合わせた。
