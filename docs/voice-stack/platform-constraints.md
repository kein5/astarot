# Platform constraints on distributing ASTAROT

[日本語版](#astarot-の配布を縛るプラットフォームの制約日本語版)

This reference page collects the constraints set by outside platforms that planning ASTAROT's distribution and features has to take as given. Its contents were researched on 2026-11-15. Each company's terms change, so before using them for a decision, check the current terms in the sources of each section.

Design decisions are not written here. The decisions drawn from these constraints are in their own ADRs.

- Virtual microphones and the Microsoft Store: [ADR-009](../adr/adr-009-virtual-microphone-and-store.md)
- External speech synthesis engines: [ADR-008](../adr/adr-008-external-speech-engines.md)

## 1. Code signing

- The current Windows installer (`VRCT-VOX_setup.exe`) is not signed.
- OV and EV code signing certificates from the major certificate authorities assume verification that the business or organization exists.
- Microsoft's Azure Artifact Signing (formerly Trusted Signing) is offered only in a limited set of regions (the United States and Canada at the time of research).
- There are also code signing certificates for open source developers (for example, Certum's Open Source Code Signing). The publisher is shown in the form "Open Source Developer, (full name)". They come with terms under which commercial use can get the certificate revoked.
- When an MSIX is distributed through the Microsoft Store, the Store re-signs it. No certificate of your own is needed.

## 2. Microsoft Store and MSIX

- Individuals can also register a developer account. The registration fee for individuals was dropped in 2025, and identity verification with an ID document is required. Company accounts have different terms.
- An MSIX cannot install drivers, and there is no manifest extension for installing them. There is no way to bundle a virtual microphone driver in an MSIX.
- Listing an EXE or MSI installer in the Store (policy 10.2.9) requires signing the installer yourself. It does not solve the signing problem.
- Features that need full trust, such as starting child processes, may require an explanation of the reason at submission.
- The package size limit (25 GB) is not a problem for the current release files.

Sources: [Microsoft Store Policies](https://learn.microsoft.com/windows/apps/publish/store-policies), [End of the registration fee for individual developers (Windows Developer Blog, 2025-09-10)](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/)

## 3. Virtual microphones

To deliver the app's audio to apps such as VRChat, a recording device that the other app can choose as a microphone (a virtual microphone) is needed. On Windows the following constraints apply.

- A microphone endpoint that other apps can choose can only be created by a kernel-mode driver. There is no API for creating one in user mode.
- For Windows to load your own driver, the driver needs Microsoft's signature. The signature requires a Hardware Dev Center account, and registering one requires an EV code signing certificate and verification that the organization exists.
- Redistributing the driver of an existing virtual cable such as VB-CABLE requires a separate agreement with its provider (VB-Audio and others). It cannot be bundled without permission.
- Store policy 10.2.4 (dependencies):
  - The main features may depend on software outside the Store. The dependency must then be stated at the start of the Store description.
  - Dependencies on drivers or NT services that Microsoft does not provide are not allowed as a rule. They need an exception, and a driver certified under WHCP (Windows Hardware Compatibility Program) is judged case by case.
  - A dependency on a driver or NT service is declared in the certification notes in Partner Center. The reviewer decides whether to allow the dependency, and if it is not allowed, certification fails. Once it is allowed, it does not need to be declared again for each update unless dependencies are added.

On Linux, a PipeWire loopback (`pw-loopback`) creates a virtual microphone without a driver. ASTAROT has a feature that creates it automatically. The constraints in this section are specific to Windows.

Sources: [Microsoft Store Policies 10.2.4](https://learn.microsoft.com/windows/apps/publish/store-policies), [Store policy change history](https://learn.microsoft.com/windows/apps/publish/store-policies-change-history)

## 4. GPUs and runtimes

- CTranslate2 supports only CUDA and the CPU. This was why the release files were split in two, a CPU build and a CUDA build. The plan for resolving it is in Issue #288 (speech recognition through speech.cpp with Vulkan and similar backends, local translation through ONNX Runtime; on Windows, DirectML covers NVIDIA, AMD and Intel in one build). From 0.5.0 the two release files had the same contents, and 0.6.0 made the Windows release files a single package (the CUDA build was dropped; [One Windows package](single-package.md)).
- Moving the RVC runtime to CUDA 13 (0.4.0) requires NVIDIA driver 580 or later. Older GPUs without support lose CUDA acceleration. This goes in the system requirements (Issue #321).
- Models are downloaded only after the user agrees. Showing the size, the provider and the license is a precondition. NLLB is CC-BY-NC, so consent is required ([Model downloads](model-downloads.md)).

## 5. Licenses

- The terms of external speech synthesis engines (VOICEVOX, COEIROINK and others) forbid redistribution. They are not bundled; the app connects to an engine the user installed (ADR-008). AivisSpeech and SHAREVOX are handled on the same basis. Piper is MIT-licensed, so it can be bundled and redistributed.
- Updating the approval record of the RVC base model (`rmvpe.onnx`) and checking the upstream terms of HuBERT (ContentVec) are not finished yet (Issue #322).
- How to put the license texts of the bundled Rust dependencies into the release files is also to be settled in Issue #322.

The register is in [licensing.md](licensing.md) and `NOTICE.md`.

## 6. Distribution and the site

- GitHub Releases is the reference source of the release files. Asset names mix fixed names (`VRCT-VOX_setup.exe` and others) and names that include the version (the Linux AppImage). For direct downloads from the site, get the latest release through the API and match the names against patterns (PR #319).
- A push to develop deploys the guide site to production (`pages.yml`). Merging a site change publishes it as it is.

How release candidates are built is in [release-candidates.md](release-candidates.md).

---

# ASTAROT の配布を縛るプラットフォームの制約（日本語版）

この文書は、ASTAROT の配布と機能の計画を立てるときの前提になる、外部のプラットフォーム側の制約をまとめた参照ページです。2026-11-15 に調べた内容です。各社の条件は変わるので、判断に使う前に、各節の出典で現在の条件を確かめてください。

設計判断はここには書きません。この制約から導いた判断は、それぞれの ADR にあります。

- 仮想マイクと Microsoft Store: [ADR-009](../adr/adr-009-virtual-microphone-and-store.md)
- 外部の合成音声エンジン: [ADR-008](../adr/adr-008-external-speech-engines.md)

## 1. コード署名

- 現在の Windows インストーラー（`VRCT-VOX_setup.exe`）は署名していない。
- 主要な認証局の OV / EV コード署名証明書は、事業者や組織の実在確認を前提にしている。
- Microsoft の Azure Artifact Signing（旧 Trusted Signing）は、提供する地域が限られる（調査時点では米国とカナダ）。
- オープンソース開発者向けのコード署名証明書もある（例: Certum の Open Source Code Signing）。発行者の表示は「Open Source Developer, 氏名」の形になる。商用に使うと失効しうる条件が付く。
- MSIX を Microsoft Store から配布するときは、Store が再署名する。自前の証明書は要らない。

## 2. Microsoft Store と MSIX

- 開発者アカウントは個人でも登録できる。個人の登録料は 2025 年に廃止され、身分証による本人確認が要る。法人のアカウントは別の条件になる。
- MSIX はドライバをインストールできない。ドライバを入れるためのマニフェスト拡張もない。仮想マイクのドライバを MSIX に同梱する方法はない。
- EXE / MSI のインストーラーを Store に載せる方式（ポリシー 10.2.9）では、インストーラーを自前で署名する必要がある。署名の問題は解決しない。
- 子プロセスの起動など、full trust が要る機能は、申請のときに理由の説明を求められることがある。
- パッケージのサイズの上限（25 GB）は、現在の配布物では問題にならない。

出典: [Microsoft Store Policies](https://learn.microsoft.com/windows/apps/publish/store-policies)、[個人開発者の登録料の廃止（Windows Developer Blog、2025-09-10）](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/)

## 3. 仮想マイク

VRChat などのアプリにアプリの音声を届けるには、相手のアプリがマイクとして選べる録音デバイス（仮想マイク）が要る。Windows では次の制約がある。

- 他のアプリから選べるマイクの端点は、カーネルモードのドライバでしか作れない。ユーザーモードで作る API はない。
- 自前のドライバを Windows に読み込ませるには、Microsoft の署名が要る。署名には Hardware Dev Center のアカウントが要り、その登録には EV コード署名証明書と組織の実在確認が要る。
- VB-CABLE などの既存の仮想ケーブルのドライバを再配布するには、提供元（VB-Audio など）との契約が別に要る。許諾なしに同梱することはできない。
- Store ポリシー 10.2.4（依存関係）:
  - 主な機能が Store の外のソフトウェアに依存してもよい。ただし、依存していることを Store の説明文の冒頭で示す。
  - Microsoft が提供していないドライバや NT サービスへの依存は、原則として認められない。例外の扱いを受ける必要があり、WHCP（Windows Hardware Compatibility Program）の認定を受けたドライバであれば、個別に判断される。
  - ドライバや NT サービスに依存するときは、Partner Center の認証ノートに申告する。審査担当者が依存を認めるかを判断し、認められなければ認証に失敗する。一度認められれば、依存を増やさない限り、更新のたびに申告し直す必要はない。

Linux では、PipeWire のループバック（`pw-loopback`）で、ドライバなしに仮想マイクを作れる。ASTAROT はこれを自動で作る機能を持っている。この節の制約は Windows に固有のものである。

出典: [Microsoft Store Policies 10.2.4](https://learn.microsoft.com/windows/apps/publish/store-policies)、[Store ポリシーの変更履歴](https://learn.microsoft.com/windows/apps/publish/store-policies-change-history)

## 4. GPU とランタイム

- CTranslate2 は CUDA と CPU にしか対応していない。これが CPU 版と CUDA 版の 2 つの配布物に分かれる原因だった。解消の方針は Issue #288 にある（音声認識は speech.cpp の Vulkan など、ローカル翻訳は ONNX Runtime。Windows は DirectML で NVIDIA、AMD、Intel を 1 つのビルドで扱う）。0.5.0 から 2 つの配布物の中身は同じになり、0.6.0 で Windows の配布物を 1 つにした（CUDA 版はやめた。[Windows の配布物の一本化](single-package.md)）。
- RVC のランタイムを CUDA 13 に移すと（0.4.0）、NVIDIA ドライバは 580 以上が必要になる。対応しない古い GPU は CUDA による高速化の対象から外れる。必要環境に書く（Issue #321）。
- モデルは、利用者の同意を得てから取得する。容量、提供元、ライセンスを示すことが前提になる。NLLB は CC-BY-NC なので、同意が必須である（[モデル取得](model-downloads.md)）。

## 5. ライセンス

- 外部の合成音声エンジン（VOICEVOX、COEIROINK など）の規約は再配布を禁じている。同梱せず、利用者が入れたエンジンに接続する（ADR-008）。AivisSpeech と SHAREVOX も同じ前提で扱う。Piper は MIT なので、同梱して再配布できる。
- RVC の基礎モデル（`rmvpe.onnx`）の承認記録の更新と、HuBERT（ContentVec）の上流の条件の確認がまだ終わっていない（Issue #322）。
- 同梱する Rust の依存のライセンス文を配布物に入れる方法も、Issue #322 で整える。

台帳は [licensing.md](licensing.md) と `NOTICE.md` にある。

## 6. 配布とサイト

- 配布物の正本は GitHub Releases である。アセットの名前には、固定のもの（`VRCT-VOX_setup.exe` など）と、版を含むもの（Linux の AppImage）が混在する。サイトから直接ダウンロードさせるときは、API で最新のリリースを取得し、名前をパターンで照合する（PR #319）。
- ガイドサイトは、develop に push すると本番に配信される（`pages.yml`）。サイトの変更をマージすると、そのまま公開される。

配布候補の作り方は [release-candidates.md](release-candidates.md) にある。
