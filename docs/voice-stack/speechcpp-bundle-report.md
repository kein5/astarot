# Pinned speech.cpp bundle (2026-10-29)

[日本語版](#speechcpp固定配布部品--2026-10-29日本語版)

**The Linux CPU and Vulkan bundles are built and verified. Integration into the GUI and distribution of the whole app are not finished.**
Work started after the 30-minute combined test passed. The code is at `bcd5c623`.
It follows the design and the plan.

## How the bundle is built and its boundaries

The [bundling tool](../../tools/speechcpp_bundle.py) verifies the pinned official release of speech.cpp **0.9.0**, from a local ZIP or an explicit `--download`, and produces only the executable, 7 notice documents and `bundle.json`.
The download sizes, SHA256 values, source commit and notice sources are in the [pinned ledger](speechcpp-bundle-artifacts.json).
It does not include models, reference voices, Mia2026, the VC runtime or the libspeech shared library.
Downloads happen only at development or build time; app startup never calls them.

```sh
UV_CACHE_DIR=/tmp/vrct-uv-cache uv run --no-project --python /usr/bin/python3 python \
  tools/speechcpp_bundle.py --variant linux-x64-vulkan \
  --archive /path/to/speech-0.9.0-linux-x64-vulkan.zip --output /path/to/new/speechcpp
```

Replace `--archive PATH` with `--download` only to fetch the release online.
The tool does not overwrite an existing output directory. This is not a command for downloading models.

## Automated tests and checks on the real artifacts

After the 33 new cases were confirmed RED, the distribution and download tests gave 65 PASS.
A local review added 2 cases: 2 FAIL before the fix, **67 PASS** after it (0.39 seconds, 1 existing openvr warning).
In case the original ZIP is replaced after verification, the tool was changed to hash-check the private copy that it actually extracts.
It also rejects a `bundle.json` that is a FIFO or similar before it starts reading it.
Confirmed: tampering, size over the limit, truncation, duplicated or linked executables, missing notices and protection of existing output; verification that still holds when Python runs with optimization; and rejection of a bundle with an extra private model added.

The sources are the official Python documentation for [ZipFile](https://docs.python.org/3.11/library/zipfile.html#zipfile.ZipFile) and
[TemporaryFile](https://docs.python.org/3.11/library/tempfile.html#tempfile.TemporaryFile),
and the implementation of the running CPython 3.11.17.
This is a local review and does not replace the Trail of Bits audit requested at a later date.

| Artifact | CPU | Vulkan |
|---|---:|---:|
| Verified size of the official ZIP | 5,471,367 bytes | 31,684,675 bytes |
| Extracted speech | 8,536,032 bytes | 50,727,760 bytes |
| Finished bundle (9 files in total) | 8,584,038 bytes | 50,775,777 bytes |
| `--version` after relocation | exit 0, speech.cpp 0.9.0 / C API 3.4 | Same as CPU |
| Highest GLIBC symbol required by the ELF | 2.34 | 2.34 |
| Files created in a new HOME or working directory | 0 | 0 |

SHA256 of the CPU executable: `394fd7c0636143fa96fc961af55f1bcdcf71fa557e4c210e231eb253a97353d8`.
SHA256 of the Vulkan executable: `800e9bae0057a7ce2b63dde01a71bf83653ffbd70eb83f8bea3e8fd944f678e7`.

With the final code, the official ZIPs were verified again, copied to a separate directory and run with a new HOME, an empty cwd and
an empty `LD_LIBRARY_PATH`. The check for forbidden OCR and Mia2026 files also exited 0 for both bundles.
The CPU build needs libm, libc and the dynamic loader; the Vulkan build also needs libvulkan.so.1.
Neither depends dynamically on libspeech or on libraries in the development checkout.
The Vulkan build, however, still carries an absolute RUNPATH from upstream CI,
`/home/runner/work/_temp/1.4.357.0/x86_64/lib/VulkanLoader/lib`.
On this PC it started without that directory. The binary is not rewritten, and this is kept in the distribution record.
Compatibility with other distributions as a whole is not guaranteed from this one machine alone.

The test environment is the same Linux PC as the combined test above. No model was started, and inference performance was not measured again.

## Remaining P5 steps

- Starting, checking and stopping the bundled server from the GUI, and compatibility with external server settings.
- Reclaiming owned processes when the parent app exits or is killed, stopping during loading, and OFF on restart.
- Packaging of the whole Linux app, the location for mutable settings, the fork name, identifiers and update target, and the final notices for dependencies.
- Acceptance of TTS and ASR in the GUI again with the bundled version, and support on a Windows PC.
- A Trail of Bits Skills audit of the whole app, and the unverified physical, listening, VRChat and HMD gates.

There was no publishing, push, contact with upstream or PR.

---

# speech.cpp固定配布部品 — 2026-10-29（日本語版）

**Linux CPU/Vulkanの配布部品を作成・検証済み。GUIへの組み込みとアプリ全体の配布は未完了。**
30分複合試験の通過後に着手。コードは`bcd5c623`。
設計・
計画に従う。

## 作成方法と境界

[同梱ツール](../../tools/speechcpp_bundle.py)は、ローカルZIPまたは明示的な`--download`から
speech.cpp **0.9.0** の固定公式releaseを検証し、実行ファイル、7個の通知文書、`bundle.json`だけを作る。
取得サイズ・SHA256・source commit・通知原典は[固定台帳](speechcpp-bundle-artifacts.json)。
モデル・参照音声・Mia2026・VC runtime・libspeech共有ライブラリは含まない。
ダウンロードは開発/ビルド時だけで、アプリ起動から呼ばれない。

```sh
UV_CACHE_DIR=/tmp/vrct-uv-cache uv run --no-project --python /usr/bin/python3 python \
  tools/speechcpp_bundle.py --variant linux-x64-vulkan \
  --archive /path/to/speech-0.9.0-linux-x64-vulkan.zip --output /path/to/new/speechcpp
```

オンライン取得する場合のみ`--archive PATH`を`--download`に置き換える。
既存の出力先は上書きしない。これはモデル取得のコマンドではない。

## 自動試験と実物検証

新規33ケースのREDを確認後、配布・取得関連は65 PASS。
ローカルレビューで2ケースを追加し、修正前2 FAIL→修正後**67 PASS**（0.39秒、既存openvr警告1）。
検証後の元ZIPの差し替えに備え、実際に展開する私有コピーをhash検証するよう修正。
FIFO等の`bundle.json`も読み始める前に拒否する。
改ざん・サイズ超過・切断・重複/リンクされた実行ファイル・通知不足・既存出力保護、
Python最適化時の検証維持と、余分な私有モデルを追加した部品の拒否を確認した。

原典はPython公式の[ZipFile](https://docs.python.org/3.11/library/zipfile.html#zipfile.ZipFile)と
[TemporaryFile](https://docs.python.org/3.11/library/tempfile.html#tempfile.TemporaryFile)、
実行中のCPython 3.11.17の実装。
これは局所レビューであり、後日依頼されたTrail of Bits監査の代替ではない。

| 実物 | CPU | Vulkan |
|---|---:|---:|
| 公式ZIPの検証サイズ | 5,471,367 bytes | 31,684,675 bytes |
| 展開したspeech | 8,536,032 bytes | 50,727,760 bytes |
| 完成部品（9ファイル合計） | 8,584,038 bytes | 50,775,777 bytes |
| 移設後`--version` | exit 0、speech.cpp 0.9.0 / C API 3.4 | 同左 |
| ELFが要求する最大GLIBC symbol | 2.34 | 2.34 |
| 新しいHOME/作業ディレクトリの生成ファイル | 0 | 0 |

CPU実行ファイルSHA256: `394fd7c0636143fa96fc961af55f1bcdcf71fa557e4c210e231eb253a97353d8`。
Vulkan実行ファイルSHA256: `800e9bae0057a7ce2b63dde01a71bf83653ffbd70eb83f8bea3e8fd944f678e7`。

最終コードで公式ZIPを再検証し、別ディレクトリへコピーしてから新しいHOME・空のcwd・
空の`LD_LIBRARY_PATH`で実行。両部品で禁止OCR/Mia2026検査もexit 0。
CPUはlibm/libc/動的ローダー、Vulkanは追加でlibvulkan.so.1を要求する。
libspeechや開発checkoutにあるライブラリへの動的依存はない。
ただしVulkan版に上流CIの絶対RUNPATH
`/home/runner/work/_temp/1.4.357.0/x86_64/lib/VulkanLoader/lib`が残る。
このPCではそのディレクトリなしで起動成功。バイナリを書き換えず配布記録に保持する。
他ディストリビューション全体への互換性をこの1台だけで保証しない。

試験環境は前記複合試験と同じLinux PC。モデルを起動せず、推論性能は再測定していない。

## 残るP5工程

- GUIからの同梱サーバー起動・状態・停止と、外部サーバー設定の互換性。
- 親アプリ終了/強制終了に追随した所有プロセス回収、ロード中停止、再起動時OFF。
- Linuxアプリ全体のパッケージ、可変設定保存先、fork名/識別子/更新先、依存の最終通知。
- 同梱版を使ったGUIのTTS/ASR再受入れとWindows PCでの対応。
- アプリ全体のTrail of Bits Skills監査と、未検証の物理/聴感/VRChat/HMDゲート。

公開・push・上流連絡・PRは行っていない。
