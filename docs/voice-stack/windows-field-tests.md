# Windows field tests

[日本語版](#windowsの実機試験日本語版)

The field tests in `tools/windows_field/` started the Python backend with the Python in `.venv` and drove it. They were removed together with the backend in 0.6.0 (#285). This document is a record of the steps up to 0.5. The tools that check the same things on the core are `native/core/examples/live_speech.rs` for TTS and `native/core/examples/pipeline_latency.rs` for the latency of the whole voice pipeline. The results are recorded in the [Windows voice verification record](windows-voice-report.md).

None of the tests save audio. The output checks keep only volume figures.

Changes made on Linux that have not yet been checked on a real Windows machine are listed in [Changes not yet checked on Windows](windows-pending-checks.md).

## Preparation

- Install the app's dependencies into `.venv` and put `speech.exe` in `build/speechcpp` (`npm run setup-python`).
- Put the models downloaded with consent in `build/model-test/win-voice/`. The RVC runtime goes in `build/rvc-runtime`.
- Make the English test speech with Windows speech synthesis. Audio files are not put in the repository.

```powershell
.venv\Scripts\python.exe tools\windows_field\make_speech.py
```

To use the `build/` of a checkout in another place, set the environment variable `VOX_FIELD_ROOT` to that folder. If SteamVR is not in the default location, set `VOX_STEAMVR`.

## Long runs

```powershell
.venv\Scripts\python.exe tools\windows_field\win_soak_full.py 1800 run-name realtime Vulkan1
```

This test starts the Python backend (`src-python/mainloop.py`) with the Python in `.venv` and drives it (`tools/windows_field/harness.py`). It does not test the backend of the 0.5.0 app (the Rust core).

The arguments are the number of seconds, the name of the result folder (under `build/model-test/`), `realtime` and the speech.cpp device. The only value the third argument accepts is `realtime`. `whisper` (the classic recording path with local Whisper) was removed together with that engine (#288). The test starts the real SteamVR with the null driver. Settings and logs are redirected to a temporary folder with `VR_CONFIG_PATH` and `VR_LOG_PATH`, so the usual settings do not change. A test hook keeps the microphone from opening. The number of attempts to open it is recorded in `mic-guard.log`.

Audio is played to the silent virtual output `Speakers (Steam Streaming Microphone)`, and its loopback is used as the input. This needs the Steam Remote Play virtual device.

To test together with VRChat, start VRChat with `--no-vr`, then run the test with the environment variable `VOX_NO_OSC_LISTENER=1`. This is because VRChat holds the OSC port.

The default conversion engine is RVC. To test Seed-VC, set `VOX_VC_ENGINE=seed-vc`, and also set `VOX_SEED_RUNTIME` to the runtime folder and `VOX_SEED_REFERENCE` to the reference voice WAV.

Block processing times are normally logged only when conversion stops. If `VOX_VC_PROBE` is set to a file path, the round-trip times of the last 75 blocks, the block delay and the number of late blocks are appended to it every 5 seconds.

To test with an empty GPU cache, set `VOX_SHADER_CACHE` to an empty folder. It works on the RTX, but whether it works on the Iris Xe has not been checked.

The results are saved in `summary.json`, `samples.csv`, `gpu-memory.json` and `results.jsonl`.

## Real microphone

Run this only while the user is at the PC.

Up to 0.4 this was tested with `tools/windows_field/win_mic_full.py`, which uses the frozen sidecar. 0.5.0 removed the sidecar from the package, so this tool was deleted as well. A tool that runs the same test on the core will be prepared in the work that connects speech recognition to the core. The following is a record of the steps up to 0.4.

```powershell
.venv\Scripts\python.exe tools\windows_field\win_mic_full.py
```

The user answers the Windows microphone prompt. The test must not close the prompt or stop `PickerHost`. If the run ends while the prompt is unanswered, that exe is refused without a prompt from then on. Closing the prompt can also leave a firewall block rule behind.

When the terminal shows "話してください" ("please speak"), read the sentences aloud with a pause after each one. Adding `norvc` skips RVC. Adding `classic` tests only the classic recording path. `stdout.log`, which contains the recognized text, is deleted at the end.

The microphone is chosen by part of its name (the default is `Surface`). To use another microphone, set `VOX_MIC_LABEL`. To use a frozen build in another folder under `build/`, set `VOX_FROZEN` to the folder name.

The threshold of the classic recording path is set to the default of 300 every time. Adding `low` sets it to 40.

---

# Windowsの実機試験（日本語版）

`tools/windows_field/`の実機の試験は、Pythonのバックエンドを`.venv`のPythonで起動して動かすものでした。0.6.0でバックエンドと一緒に消しました（#285）。この文書は0.5までの手順の記録です。中核で同じことを確かめる道具は、読み上げは`native/core/examples/live_speech.rs`、音声パイプライン全体の遅延は`native/core/examples/pipeline_latency.rs`です。結果の記録は[Windows音声の検証記録](windows-voice-report.md)にあります。

どの試験も音声を保存しません。出力の確認は、音量の数値だけを残します。

Linuxで入れた変更のうち、Windowsの実機でまだ確かめていないものは、[Windowsで未確認の変更](windows-pending-checks.md)にあります。

## 準備

- `.venv`にアプリの依存を入れ、`build/speechcpp`に`speech.exe`を置きます（`npm run setup-python`）。
- 同意して取得したモデルを`build/model-test/win-voice/`に置きます。RVCの実行環境は`build/rvc-runtime`です。
- 英語の試験音声をWindowsの音声合成で作ります。音声ファイルはリポジトリに入れません。

```powershell
.venv\Scripts\python.exe tools\windows_field\make_speech.py
```

別の場所にあるチェックアウトの`build/`を使うときは、環境変数`VOX_FIELD_ROOT`にそのフォルダーを指定します。SteamVRの場所が既定と違うときは`VOX_STEAMVR`を指定します。

## 長時間の運転

```powershell
.venv\Scripts\python.exe tools\windows_field\win_soak_full.py 1800 run-name realtime Vulkan1
```

この試験はPythonバックエンド（`src-python/mainloop.py`）を`.venv`のPythonで起動して動かします（`tools/windows_field/harness.py`）。0.5.0のアプリのバックエンド（Rustの中核）は試しません。

引数は、秒数、結果のフォルダー名（`build/model-test/`の下）、`realtime`、speech.cppの装置です。3つめの引数に指定できるのは`realtime`だけです。`whisper`（従来の録音とローカルのWhisper）は、そのエンジンと一緒に削除しました（#288）。実物のSteamVRをnullドライバーで起動します。設定とログは`VR_CONFIG_PATH`と`VR_LOG_PATH`で一時フォルダーへ逃がすので、普段の設定は変わりません。マイクは試験用のフックで開けないようにします。開こうとした回数は`mic-guard.log`に残ります。

音声は、無音の仮想出力`Speakers (Steam Streaming Microphone)`へ流し、そのループバックを入力にします。Steam Remote Playの仮想デバイスが要ります。

VRChatと同時に試すときは、VRChatを`--no-vr`で起動してから、環境変数`VOX_NO_OSC_LISTENER=1`を付けて実行します。VRChatがOSCのポートを持っているからです。

変換の既定はRVCです。Seed-VCを試すときは、`VOX_VC_ENGINE=seed-vc`に加えて、実行環境のフォルダーを`VOX_SEED_RUNTIME`に、参照音声のWAVを`VOX_SEED_REFERENCE`に指定します。

ブロックの処理時間は、ふだんは変換が止まったときにしかログに残りません。`VOX_VC_PROBE`にファイルのパスを指定すると、直近75ブロックの往復時間、ブロックの遅れ、遅れたブロックの数を5秒ごとに書き足します。

GPUのキャッシュが空の状態を試すときは、`VOX_SHADER_CACHE`に空のフォルダーを指定します。RTXでは効きますが、Iris Xeで効くかは確かめていません。

結果は`summary.json`、`samples.csv`、`gpu-memory.json`、`results.jsonl`に残ります。

## 実マイク

利用者がPCの前にいるときだけ行います。

0.4までは凍結したサイドカーを使う`tools/windows_field/win_mic_full.py`で試していました。0.5.0で配布物からサイドカーをなくしたので、この道具も削除しました。中核で同じ試験をする道具は、音声認識を中核につなぐ作業で用意します。以下は0.4までの手順の記録です。

```powershell
.venv\Scripts\python.exe tools\windows_field\win_mic_full.py
```

Windowsのマイクの確認は、利用者が答えます。試験の側から確認の画面を閉じたり、`PickerHost`を止めたりしてはいけません。答えないまま終わると、そのexeは次から確認なしで拒否されます。確認の画面を閉じるとファイアウォールのブロック規則が残ることもあります。

ターミナルに「話してください」と出たら、1文ごとに間をあけて読みます。`norvc`を付けるとRVCを省きます。`classic`を付けると従来の録音経路だけを試します。認識した文を含む`stdout.log`は、終了時に消します。

使うマイクは名前の一部（既定は`Surface`）で選びます。別のマイクを使うときは`VOX_MIC_LABEL`を指定します。`build/`の下の別のフォルダーにある凍結物を使うときは、`VOX_FROZEN`にフォルダー名を指定します。

従来の録音経路の閾値は、毎回、既定の300に設定します。`low`を付けると40にします。
