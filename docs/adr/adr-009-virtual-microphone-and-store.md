---
date: 2026-11-15
status: accepted
era: python-sidecar
validity: current
implementation_status: partial
implementation_checked: 2026-11-18
implementation_note: アプリでの導入の支援（4.2）は 0.4.0 で実装し、中核では controller/audio_devices.rs の仮想マイクの案内が引き継いだ。Store への申請（4.1）は、申請するときの作業として残っている。
evidence:
  - docs/adr/adr-009-virtual-microphone-and-store.md
  - native/core/src/controller/audio_devices.rs
---
# ADR-009: On Windows, rely on an external driver for the virtual microphone, and disclose the dependency in the Microsoft Store

[日本語版](#adr-009-windows-の仮想マイクは外部のドライバに頼りmicrosoft-store-では依存を開示する日本語版)

Status: Accepted (2026-11-15). The setup support in the app (4.2) was implemented in 0.4.0. Submitting to the Store (4.1) is work for the time of submission.
Date: 2026-11-15
Related: [ADR-005](adr-005-managed-microphone-lifetime.md), [ADR-008](adr-008-external-speech-engines.md), [Platform constraints](../voice-stack/platform-constraints.md), Issue #321

In a comment on Issue #321 on 2026-11-15, the user decided on approach A+B. This ADR records that approach and the reasons for it.

## 1. Background

VRCT-VOX delivers the audio of text to speech (TTS) and voice conversion (RVC) to VRChat. VRChat takes audio only from a recording device that can be chosen as a microphone. So a "virtual microphone" is needed, which presents the app's output as a recording device.

On Linux, a PipeWire loopback can create a virtual microphone without a driver. VRCT-VOX creates it automatically when the user asks for it (ADR-005).

On Windows, VRCT-VOX cannot create a virtual microphone. At present, users install a virtual cable such as VB-CABLE themselves, choose the cable's playback side (for example CABLE Input) as the TTS output, and choose its recording side (for example CABLE Output) as VRChat's microphone ([Windows local setup](../voice-stack/local-setup-windows.md)). A user who has not installed a cable gets no voice into VRChat and does not know where things went wrong.

Distribution through the Microsoft Store is also being considered for the future. This ADR decides how the Store version handles this dependency.

## 2. Platform constraints

The details are in sections 2 and 3 of [Platform constraints](../voice-stack/platform-constraints.md). These 4 constraints bear on this decision.

1. **MSIX cannot install drivers.** There is no manifest extension that installs a driver either. There is no way to bundle a virtual microphone driver with the Store version (MSIX).
2. **A microphone endpoint that other apps can choose can only be created by a kernel-mode driver.** There is no user-mode API. Loading a driver of your own needs Microsoft's signature, and that needs a Hardware Dev Center account (an EV code signing certificate and verification that the organization exists).
3. **Redistributing an existing driver needs a contract with its provider.** VB-CABLE and similar drivers cannot be bundled without permission.
4. **Store Policy 10.2.4 (Dependencies).**
   - A dependency on software outside the Store is allowed if it is disclosed at the start of the Store description.
   - A dependency on a driver that Microsoft does not provide is, in principle, not allowed. A driver certified under WHCP is judged case by case.
   - A dependency on a driver is declared in the certification notes in Partner Center.

## 3. Options considered

| Option | What it means | Decision |
|---|---|---|
| Build our own driver and bundle it | Develop a virtual microphone driver, sign it and distribute it | Rejected. At present this project does not meet the Hardware Dev Center registration needed for signing (an EV code signing certificate and verification that the organization exists). MSIX cannot bundle a driver, so the Store version would still need a separate installation |
| Bundle an existing driver | Put VB-CABLE or a similar driver in the installer | Rejected. It needs a contract with the provider. MSIX cannot bundle a driver |
| Ship only a configuration without a virtual microphone to the Store | Remove the features that rely on a virtual microphone from the Store version | Rejected. TTS and voice conversion could not reach VRChat, so the product would not meet its purpose |
| Give up on the Store | Do not ship to the Store; distribute only through GitHub Releases | Rejected. The Store version has an advantage: the Store re-signs it, which avoids the warning for an unsigned installer ([Constraints](../voice-stack/platform-constraints.md), section 1). While disclosure may still get the dependency accepted, keep the Store open as an option |
| **Rely on an external driver and disclose it (A), and support setup in the app (B)** | Section 4 below | **Adopted** |

## 4. Decision

### 4.1 A: Rely on an external driver, and disclose the dependency in the Store

- The virtual microphone driver is not bundled. Users get it from its provider and install it. The app neither downloads nor installs the driver.
- When submitting to the Store, disclose the dependency as Policy 10.2.4 requires.
  - At the start of the Store description, state that delivering audio to VRChat requires installing a virtual audio cable (such as VB-CABLE) separately.
  - Declare the driver dependency in the certification notes in Partner Center. Write which drivers are expected, that the app does not install a driver, and which features work without a driver.
  - A driver dependency is in principle not allowed, so the aim is to have it accepted by a case-by-case decision. Acceptance is not guaranteed (section 6).
- Keep a configuration in which the central features, such as translation and captions, work without a virtual microphone. Only the part that delivers TTS and voice conversion to VRChat relies on a virtual microphone. The disclosure text and the review decision rest on this premise.

### 4.2 B: Reduce the setup effort in the app

Implemented in 0.4.0. It targets Windows.

1. Detection: on the first start, check whether the playback side of a virtual cable is installed. Start from the existing check (`is_virtual_cable()` in `src-python/models/audio_routing/devices_windows.py`).
2. Guidance: show guidance only when none is found. When one is found, show nothing. Match the first-run guidance flow to the first-use guidance added in Issues #305 and #311.
3. Where to get it: show a way to the provider's official site and the installation steps. So that the official site can be opened, add the provider's site to the list of URLs the app may open (`src-tauri/capabilities/vrct_capability.json`).
4. Detecting again: when the installation is finished, check again automatically.
5. Self-test: play a test sound and confirm with a level meter that it went through the virtual cable. Finally, guide the user up to choosing the cable's recording side as VRChat's microphone.

What to keep (`AGENTS.md`, "User actions and consent"):

- Detection and guidance do not turn on the microphone or change the TTS output device or the audio routes on their own. Even when a cable is found, the user is the one who chooses it as the output.
- The test sound plays only when the user presses the button. When it plays on a route that reaches VRChat, say so first.
- The guidance can be closed, and after it is closed it can be opened again from the settings screen.

### 4.3 Complement: a route to any output device

A user who uses another virtual mixer, such as Voicemeeter, can choose that device as the output of TTS or voice conversion instead. This is handled by the audio route features, and this ADR adds no new mechanism.

## 5. Consequences

- Windows users install a virtual cable themselves, as before. The app now shows the steps and lets them check whether it is connected.
- The driver is handled the same way in the Store version and the GitHub Releases version. The features do not depend on how the app is distributed.
- The license register and `NOTICE.md` do not change, because the driver is not bundled.
- The system requirements page states that delivering audio to VRChat on Windows needs a virtual audio cable (together with the main work of Issue #321).

## 6. Conditions for revisiting this decision

- When the Store review does not accept the driver dependency. Then decide again how to handle the Store version (skip the Store, or ship a different configuration).
- When Windows gains an API that can create a microphone endpoint in user mode.
- When a redistribution contract with a virtual cable provider becomes possible (MSIX cannot bundle a driver, so this would apply to distributions other than the Store).
- When the conditions of Store Policy 10.2.4 change.

## 7. Open items

1. Which virtual cable product the guidance names. Whether VB-CABLE is the first candidate, or several are listed. Whether the provider's site may be added to the list of URLs the app may open.
2. The condition under which detection considers that "a virtual microphone exists". The current `is_virtual_cable()` treats a driver whose name contains `cable`, `virtual`, `steam streaming` or `voicemeeter` as a virtual cable. Whether the Steam Streaming Microphone or a Voicemeeter input counts as a virtual microphone for VRChat that the guidance can use.
3. The wording of the Store description and the certification notes. Written at the time of submission, together with the text on the system requirements page.
4. How to handle the Store version if the review does not accept the dependency (section 6).

## 8. References

- [Platform constraints](../voice-stack/platform-constraints.md) (collects the sources of this ADR's premises)
- [Microsoft Store Policies](https://learn.microsoft.com/windows/apps/publish/store-policies) (10.2.4 Dependencies, 10.2.9)
- [Windows local setup](../voice-stack/local-setup-windows.md)
- Issue #321 (the comment of 2026-11-15 titled "仮想マイクの扱い（Store を見据えた方針 A+B）", on handling the virtual microphone with approach A+B and the Store in view)

---

# ADR-009: Windows の仮想マイクは外部のドライバに頼り、Microsoft Store では依存を開示する（日本語版）

Status: 採用（2026-11-15）。アプリ側の導入支援（4.2）は 0.4.0 で実装した。Store への申請（4.1）は、申請するときの作業とする。
Date: 2026-11-15
Related: [ADR-005](adr-005-managed-microphone-lifetime.md)、[ADR-008](adr-008-external-speech-engines.md)、[プラットフォームの制約](../voice-stack/platform-constraints.md)、Issue #321

Issue #321 への 2026-11-15 のコメントで、利用者が方針 A+B を決めた。この ADR はその方針と理由を記録する。

## 1. 背景

VRCT-VOX は、読み上げ（TTS）や声の変換（RVC）の音声を VRChat に届ける。VRChat はマイクとして選べる録音デバイスからしか音声を受け取らない。そのため、アプリの出力を録音デバイスとして見せる「仮想マイク」が要る。

Linux では、PipeWire のループバックでドライバなしに仮想マイクを作れる。VRCT-VOX は利用者の操作で自動作成する（ADR-005）。

Windows では、VRCT-VOX は仮想マイクを作れない。今は、利用者が VB-CABLE などの仮想ケーブルを自分で入れ、TTS の出力にケーブルの再生側（例: CABLE Input）を、VRChat のマイクに録音側（例: CABLE Output）を選ぶ（[Windows のローカル準備](../voice-stack/local-setup-windows.md)）。ケーブルを入れていない利用者は、どこでつまずいたかが分からないまま、VRChat に声が届かない。

将来、Microsoft Store で配布することも考えている。Store 版でこの依存をどう扱うかを、ここで決める。

## 2. プラットフォームの制約

詳しくは[プラットフォームの制約](../voice-stack/platform-constraints.md)の 2 節と 3 節にある。この判断に効くのは次の 4 つである。

1. **MSIX はドライバをインストールできない。** ドライバを入れるマニフェスト拡張もない。Store 版（MSIX）に仮想マイクのドライバを同梱する方法はない。
2. **他のアプリから選べるマイクの端点は、カーネルモードのドライバでしか作れない。** ユーザーモードの API はない。自前のドライバを読み込ませるには Microsoft の署名が要り、それには Hardware Dev Center のアカウント（EV コード署名証明書と組織の実在確認）が要る。
3. **既存のドライバを再配布するには、提供元との契約が要る。** VB-CABLE などを、許諾なしに同梱することはできない。
4. **Store ポリシー 10.2.4（依存関係）。**
   - Store の外のソフトウェアへの依存は、Store の説明文の冒頭で開示すれば認められる。
   - Microsoft が提供していないドライバへの依存は、原則として認められない。WHCP の認定を受けたドライバなら、個別に判断される。
   - ドライバへの依存は、Partner Center の認証ノートに申告する。

## 3. 検討した案

| 案 | 内容 | 判断 |
|---|---|---|
| 自前のドライバを作って同梱する | 仮想マイクのドライバを開発し、署名して配布する | 採らない。署名に要る Hardware Dev Center の登録（EV コード署名証明書と組織の実在確認）を、このプロジェクトは今は満たしていない。MSIX には同梱できないので、Store 版では別に導入してもらう点も変わらない |
| 既存のドライバを同梱する | VB-CABLE などをインストーラーに入れる | 採らない。提供元との契約が要る。MSIX には同梱できない |
| 仮想マイクのない構成だけを Store に出す | 仮想マイクに頼る機能を Store 版から外す | 採らない。読み上げと声の変換を VRChat に届けられず、製品の目的を満たさない |
| Store を諦める | Store には出さず、GitHub Releases だけで配布する | 採らない。Store 版には、Store が再署名するので署名なしのインストーラーの警告を避けられるという利点がある（[制約](../voice-stack/platform-constraints.md) 1 節）。開示で認められる可能性があるうちは、選択肢を残す |
| **外部のドライバに頼り、開示する（A）と、アプリで導入を支える（B）** | 下の 4 章 | **採る** |

## 4. 決定

### 4.1 A: 外部のドライバに頼り、Store では依存を開示する

- 仮想マイクのドライバは同梱しない。利用者が提供元から入手して入れる。アプリはドライバをダウンロードもインストールもしない。
- Store に申請するときは、ポリシー 10.2.4 に従って依存を開示する。
  - Store の説明文の冒頭に、VRChat へ音声を届けるには仮想オーディオケーブル（VB-CABLE など）を別に入れる必要があることを書く。
  - Partner Center の認証ノートに、ドライバへの依存を申告する。どのドライバを想定するか、アプリはドライバを入れないこと、ドライバがなくても動く機能を書く。
  - ドライバへの依存は原則として認められないので、個別の判断で認められることを狙う。認められる保証はない（6 章）。
- 仮想マイクがなくても、翻訳や字幕などの中心の機能が使える構成を保つ。仮想マイクに頼るのは、読み上げと声の変換を VRChat に届ける部分だけにする。開示の説明と審査の判断は、この前提に立つ。

### 4.2 B: アプリで導入の手間を減らす

0.4.0 で実装した。Windows を対象にする。

1. **検出**: 初回起動のときに、仮想ケーブルの再生側が入っているかを調べる。既存の判定（`src-python/models/audio_routing/devices_windows.py` の `is_virtual_cable()`）を出発点にする。
2. **案内**: 見つからないときだけ案内を出す。見つかったときは何も出さない。初回の案内の流れは、Issue #305 と #311 で入れた初回利用時の案内にそろえる。
3. **入手先**: 提供元の公式サイトへの導線と、導入の手順を示す。公式サイトを開けるように、URL を開ける先の一覧（`src-tauri/capabilities/vrct_capability.json`）に提供元のサイトを足す。
4. **再検出**: 導入が終わったら、自動でもう一度調べる。
5. **自己診断**: テスト用の音声を流し、レベルメーターで仮想ケーブルを通ったことを確かめる。最後に、VRChat のマイクにケーブルの録音側を選ぶところまで案内する。

守ること（`AGENTS.md` の「ユーザーの操作と同意」）:

- 検出と案内のために、マイクを有効にしたり、TTS の出力デバイスや音声経路を勝手に変えたりしない。ケーブルが見つかっても、出力に選ぶのは利用者である。
- テスト用の音声は、利用者が押したときだけ流す。VRChat に届いてしまう経路で流すときは、そのことを先に示す。
- 案内は閉じられるようにし、閉じたあとも設定画面から開き直せるようにする。

### 4.3 補完: 任意の出力デバイスへの経路

Voicemeeter など別の仮想ミキサーを使っている利用者は、TTS や声の変換の出力にそのデバイスを選べば代わりになる。これは音声経路の機能で扱い、この ADR では新しい仕組みを足さない。

## 5. 影響

- Windows の利用者は、これまでどおり仮想ケーブルを自分で入れる。アプリが手順を示し、つながったかを確かめられるようになる。
- Store 版でも GitHub Releases 版でも、ドライバの扱いは同じになる。配布の方法によって機能が変わらない。
- ライセンスの台帳と `NOTICE.md` は変わらない。ドライバを同梱しないからである。
- 必要環境のページには、Windows で VRChat に音声を届けるには仮想オーディオケーブルが要ることを書く（Issue #321 の本体の作業と合わせる）。

## 6. この判断を見直す条件

- Store の審査で、ドライバへの依存が認められなかったとき。そのときは、Store 版の扱い（Store を見送るか、別の構成で出すか）を改めて決める。
- Windows に、ユーザーモードでマイクの端点を作れる API が入ったとき。
- 仮想ケーブルの提供元と、再配布の契約を結べることになったとき（MSIX には同梱できないので、対象は Store 以外の配布物になる）。
- Store ポリシー 10.2.4 の条件が変わったとき。

## 7. 未決事項

1. 案内で示す仮想ケーブルの製品。VB-CABLE を第一の候補にするか、複数を並べるか。提供元のサイトを、URL を開ける先の一覧に足してよいか。
2. 検出で「仮想マイクがある」とみなす条件。今の `is_virtual_cable()` はドライバ名に `cable`、`virtual`、`steam streaming`、`voicemeeter` を含むものを仮想ケーブルとみなす。Steam Streaming Microphone や Voicemeeter の入力を、VRChat 向けの仮想マイクとして案内に使えるとみなすか。
3. Store の説明文と認証ノートの文面。申請するときに、必要環境のページの記載と合わせて作る。
4. 審査で依存が認められなかったときに、Store 版をどう扱うか（6 章）。

## 8. 参考資料

- [プラットフォームの制約](../voice-stack/platform-constraints.md)（この ADR の前提の出典をまとめている）
- [Microsoft Store Policies](https://learn.microsoft.com/windows/apps/publish/store-policies)（10.2.4 依存関係、10.2.9）
- [Windows のローカル準備](../voice-stack/local-setup-windows.md)
- Issue #321（2026-11-15 のコメント「仮想マイクの扱い（Store を見据えた方針 A+B）」）
