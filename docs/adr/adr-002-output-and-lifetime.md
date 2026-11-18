# ADR 002: 出力と寿命

> **移行の注記**（2026-11-18、Issue #587）：この文書は、旧 `docs/voice-stack/decisions.md` の「ADR 002」の節を、1件ずつのファイルに分けたものである。原文は 2026-10-27 に書かれ（コミット `ad977081`）、分けるまで変わっていない。本文は原文のままで、変えたのは見出しの階層（`##` から `#`）と、注記を足したことだけである。
>
> 原文には、この ADR だけの採用状態の行はない。旧ファイルにあった採用状態の行は、ADR 001 の節の「Status: accepted for P1, 2026-10-27.」だけである。[ADR 004](adr-004-audio-integration-boundaries.md) は ADR 001〜003 をまとめて、採用済み（accepted）の ADR として扱っている。

HTTP、デバイスopen/write/closeはworker上。設定変更と停止はcancel信号を送り、
キューを破棄。出力は短いPCMブロックに分割し、OSのresamplerに実際のrateを渡す。
ヘッダだけ書き換える疑似resamplingは行わない。Windowsはデバイス名とhost APIを
照合し、再接続後のindex再利用で別デバイスへ流さない。Linuxはtargetと
`node.dont-fallback` / `node.dont-reconnect` を指定する。
