# Security policy

[日本語版](#脆弱性の報告日本語)

## Supported versions

| Version | Supported |
|---|---|
| Latest stable release (from `main`) | Yes |
| Latest beta release (from `develop`) | Yes, until the next beta or stable release |
| Older releases and unreleased builds | No |

## Scope

In scope: the ASTAROT application (since 0.5.0 its backend runs inside it; 0.4.x and earlier ship a Python sidecar), the Windows installer and ZIP files and the Linux packages (AppImage, tar.gz, deb, rpm) published on [Releases](https://github.com/kein5/astarot/releases), the local servers the app opens (for example the OBS browser source and the WebSocket server), model download and verification, and the release workflows in this repository.

Out of scope: vulnerabilities in third-party engines and models (speech.cpp, RVC, Seed-VC, translation and speech services) that ASTAROT does not change. Report those to their projects; tell us too if ASTAROT should work around them. ASTAROT (formerly VRCT-VOX) is derived from [VRCT](https://github.com/misyaguziya/VRCT); if an issue also affects upstream VRCT, report it to its maintainers as well.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** ([private vulnerability reporting](https://github.com/kein5/astarot/security/advisories/new)). Do not open a public issue for a vulnerability.

Include the affected version and operating system, the steps to reproduce, and the impact you expect. Remove personal data such as voice recordings, chat text, API keys and full log files you have not reviewed.

This project is maintained by one person on a best-effort basis. We aim to acknowledge a report within 7 days, and we publish a fix in a new release (released assets are never replaced) together with a GitHub security advisory when the issue is confirmed.

---

## 脆弱性の報告（日本語）

### サポートする版

| 版 | サポート |
|---|---|
| 最新の正式版（`main` から公開） | あり |
| 最新のベータ版（`develop` から公開） | あり（次のベータ版か正式版を公開するまで） |
| それより前の版と、公開していないビルド | なし |

### 対象

対象は、ASTAROT のアプリ本体（0.5.0 からはバックエンドもアプリの中で動きます。0.4.x までは Python のバックエンドを別に同梱しています）、[Releases](https://github.com/kein5/astarot/releases) で配布している Windows のインストーラーと ZIP と Linux 版のパッケージ（AppImage、tar.gz、deb、rpm）、アプリが開くローカルのサーバー（OBS のブラウザーソースや WebSocket のサーバーなど）、モデルの取得と検証、このリポジトリのリリース用ワークフローです。

ASTAROT が手を加えていない外部のエンジンとモデル（speech.cpp、RVC、Seed-VC、翻訳と音声のサービス）の脆弱性は対象外です。それぞれのプロジェクトへ報告してください。ASTAROT の側で回避したほうがよいときは、こちらにも知らせてください。ASTAROT（旧名 VRCT-VOX）は [VRCT](https://github.com/misyaguziya/VRCT) から派生したプロジェクトです。本家 VRCT にも影響する問題は、本家の開発者にも報告してください。

### 報告のしかた

脆弱性は GitHub で非公開に報告してください。リポジトリの「Security」タブを開き、「Report a vulnerability」を選びます（[非公開の脆弱性報告](https://github.com/kein5/astarot/security/advisories/new)）。脆弱性を公開の Issue に書かないでください。

影響を受ける版と OS、再現手順、想定される影響を書いてください。音声の録音、チャットの本文、API キー、中身を確かめていないログのファイルなどの個人情報は取り除いてください。

このプロジェクトは1人で、できる範囲で保守しています。報告には7日以内に受け取ったことを知らせるのを目標にしています。問題を確認できたら、新しい版で修正し、GitHub のセキュリティアドバイザリと一緒に公表します。公開済みのファイルを差し替えることはありません。
