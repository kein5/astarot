# SteamVR subtitle images

[日本語版](#steamvrの字幕の画像日本語版)

Since 0.5.0 the Rust core builds both subtitle textures (`native/vr-overlay`,
mainly `src/subtitle.rs`, `src/layout.rs` and `src/fonts.rs`). This contract was
written against the Python backend's [`src-python/models/overlay/overlay_image.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/overlay_image.py),
which built them up to 0.4; the Python names below refer to that implementation.
This contract covers subtitle pixels only; message delivery, OSC text and
retained conversation text are unchanged.

## Layout and bounds

Existing explicit newlines are preserved. Lines wrap against measured glyph
bounds and advances, including fallback fonts. Latin words stay together when
they fit; oversized words split at grapheme boundaries. When the optional
`regex` module is importable, its `\X` supplies extended grapheme boundaries.
It is imported once at module load; an `ImportError` selects the standard-library
fallback, without installing or requiring a new dependency.

The fallback groups a base with combining marks (`unicodedata.combining` or
categories Mn, Mc, Me), variation selectors U+FE00–FE0F and U+E0100–E01EF, emoji
modifiers U+1F3FB–1F3FF, ZWJ sequences, regional-indicator pairs and emoji tags
U+E0020–E007F. It keeps CRLF together and separates other controls. This is an
approximation, **not full UAX #29**: for example, it does not implement Hangul
Jamo composition or all Indic conjunct/prepend rules, and it joins non-control
ZWJ sequences more broadly than the Unicode emoji rule. Those scripts can have
different wrapping boundaries when `regex` is absent.

The covered combining marks, flags and emoji ZWJ sequences are never split to
fit a line in either mode. Empty/invisible input produces a
valid transparent text block. A grapheme that cannot fit is replaced by the
omission line along with the remaining text.

The ordinary font sizes, colors, horizontal alignment, small subtitle padding
and per-token ruby order (romaji, hiragana, original) remain.

A received realtime caption whose voices the speech server told apart names
them in its large-log header, after "Receive": each voice's name if the user
gave it one for that session, else its label, joined by `·` ("Mika·B"), cut to
48 characters with `…` (#447, `Subtitles::set_speaker_names`). The header stays
one row in the default font at the header size; naming a voice redraws the log
when it shows a caption of that session. In the large-log header, "Receive" uses the received purple made lighter at the
same hue (198, 152, 206), "Send" uses the sent blue made lighter at the same
hue (131, 174, 196), and the timestamp uses neutral gray (168, 168, 168).
Against the background (41, 42, 45) all three stand out by 6.0:1 (WCAG 2.x),
above the 4.5:1 small text needs (replacing (168, 97, 180) at 3.4:1,
(97, 151, 180) at 4.5:1, and (120, 120, 120) at 3.25:1). The small log writes the speaker line on a row of its
own above the message (`Subtitles::small_log`): centered, in the same received
purple (198, 152, 206), in the default font at 60px, two thirds of its 92px
text. The row takes the top margin a message without speakers has, and the
message moves down by the row's height. A name given while the small log shows a
picture does not redraw it; the next picture has the name. Line height grows
to contain actual ink, including combining marks and fallback emoji. Ruby
tokens wider than the available line are split into grapheme-safe fragments;
each reading wraps independently. These fragments do not claim linguistic
character-to-reading alignment. Original text absent from ruby tokens,
including whitespace/newlines, is rendered without ruby.

Limits apply **before allocation**, to text blocks, concatenation, backgrounds,
outer margins and the final texture:

| Constant | Limit |
| --- | --- |
| `MAX_SUBTITLE_LINES` | 24 logical rows, including timestamp headers and the omission row; one original line with its ruby is one logical row |
| `MAX_SUBTITLE_WIDTH` | 4096 pixels |
| `MAX_SUBTITLE_HEIGHT` | 2048 pixels |
| `MAX_SUBTITLE_PIXELS` | 4,194,304 pixels (16 MiB for one RGBA raster) |
| `SUBTITLE_PADDING_RESERVE` | 100 pixels reserved in both dimensions when budgeting text, enough for the existing small subtitle outer margins |

All limits apply together. Small subtitles retain their 3940px padded width,
so the area limit allows at most 1064px height. Large subtitles retain their
1010px padded width. Their row count normally limits height first. Concatenation
shares the row/pixel budget across the original, translations and large-log
history. The visible prefix ends at a complete row followed by a centered `…`
line when any limit is reached. Rendering stops there; later blocks are not
rasterized. The stored messages are not modified or paginated automatically.
The final dimensions are validated before returning the image. These limits
bound each raster, not the total process RSS or native texture-copy overhead.

To bound measurement and shaping work, `native/vr-overlay/src/fonts.rs` also limits each
input component to `MAX_TEXT_CODEPOINTS = 8192`, each grapheme to
`MAX_CLUSTER_CODEPOINTS = 128`, and each shaped line to
`MAX_LINE_CODEPOINTS = 512`. A prefix never retains a partial final grapheme.
Input/cluster truncation also displays `…`; the per-line limit wraps intact
graphemes. Ruby font sizes and spacing are capped at 128px. These are display
budgets, not limits on chat input or transmission.

## Local font fallback

Missing glyphs are detected by comparing each character's mask with that font's
missing-glyph mask. A whole grapheme uses the first font covering its visible
characters: the selected font, the standard fonts for its language, then any
other installed font that has the characters. No font is bundled (see the
subtitle font in `use-cases.md`). Shaping controls and variation selectors do not
require a standalone glyph. Adjacent runs share baseline measurement; the same
font and metrics are used for wrapping and drawing.

- Windows searches the Windows and per-user font directories, including
  `seguiemj.ttf` (Segoe UI Emoji).
- Linux searches `/usr/share/fonts`, `/usr/local/share/fonts`,
  `~/.local/share/fonts` and `~/.fonts` for emoji fonts or Symbola. Noto Color
  Emoji's fixed 109px bitmap strike is measured and resized per grapheme to the
  existing subtitle/ruby size. Both the native glyph raster and final texture
  are bounded before allocation.
- If no usable local font covers the whole grapheme, the selected font's
  existing missing-glyph box remains. Color and complex emoji ligature support
  depend on the installed font and Pillow/FreeType shaping support.

No fonts or dependencies are downloaded or bundled by this change. System
fonts are read from the user's installation, not copied into distributions.

## Verification

The core's rendering is checked by the unit tests of `native/vr-overlay`
(`src/subtitle.rs`, `src/layout.rs`, `src/fonts.rs`). The rest of this section
records the Python tests, which left the repository with the backend in 0.6.0
(#285). [`src-python/test/test_overlay_image_rendering.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_overlay_image_rendering.py) used real bundled fonts and
patched `Image.new` to verify allocation requests. It covered multiline Japanese,
mixed-width text, huge input, composition, empty/invisible input, graphemes,
ruby, missing fallback and optional installed emoji fonts. These tests do not
establish headset readability or Windows runtime rendering.
The rendering and allocation tests run with both `regex` and the forced stdlib
path; explicit segmentation cases check identical boundaries for the sequences
listed above. A separate test simulates `regex` failing to import at module load.

---

# SteamVRの字幕の画像（日本語版）

0.5.0からは、Rustの中核が2つの字幕のテクスチャを作る（`native/vr-overlay`。主に`src/subtitle.rs`、`src/layout.rs`、`src/fonts.rs`）。この契約は、0.4までテクスチャを作っていたPythonのバックエンドの[`src-python/models/overlay/overlay_image.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/overlay_image.py)を対象に書いた。以下のPythonの名前はその実装を指す。この契約が扱うのは字幕のピクセルだけである。メッセージの配送、OSCの文、保持する会話の文は変わらない。

## 配置と上限

すでにある明示的な改行は保つ。行は代替のフォントも含めて、測ったグリフの範囲と送り幅に合わせて折り返す。ラテン文字の語は、収まるときは分けない。収まらないほど長い語は書記素の境界で分ける。任意の`regex`モジュールを読み込めるときは、その`\X`が拡張書記素の境界を与える。`regex`はモジュールの読み込み時に1回だけ読み込む。`ImportError`のときは標準ライブラリによる代替を選び、新しい依存を入れることも求めることもしない。

代替の処理は基底の文字に次のものをまとめる。結合文字（`unicodedata.combining`、またはカテゴリMn、Mc、Me）、異体字セレクターU+FE00–FE0FとU+E0100–E01EF、絵文字の修飾子U+1F3FB–1F3FF、ZWJシーケンス、地域指示子の組、絵文字のタグU+E0020–E007Fである。CRLFは1つにまとめ、ほかの制御文字は分ける。これは近似であり、**UAX #29を完全には実装していない**。たとえば、ハングルの字母の合成や、インド系の文字の結合子音と前置の規則のすべては実装していない。また、制御文字でないZWJシーケンスを、Unicodeの絵文字の規則より広くつなぐ。`regex`がないときは、それらの文字体系で折り返しの境界が変わることがある。

対象にした結合文字、旗、絵文字のZWJシーケンスは、どちらの方式でも行に収めるために分けることはない。空の入力や見えない文字だけの入力からは、正しい透明の文字のブロックを作る。収まらない書記素は残りの文と一緒に省略の行に置き換える。

通常の文字の大きさ、色、横の揃え方、小さい字幕の余白、トークンごとのルビの順（ローマ字、ひらがな、原文）はそのまま残す。

受信したリアルタイムの字幕のうち、音声サーバーが声を聞き分けたものは、大きいログの見出しの「Receive」の後ろにその声を挙げる。利用者がそのセッションで声に名前を付けていればその名前を、なければラベルを使い、`·`でつなぎ（「Mika·B」）、48文字を超える分は`…`で切る（#447、`Subtitles::set_speaker_names`）。見出しは既定のフォントの見出しの大きさで1行のままにする。声に名前を付けると、そのセッションの字幕を出しているログを描き直す。大きいログの見出しでは、「Receive」は受信の紫を同じ色相のまま明るくした色（198, 152, 206）、「Send」は送信の青を同じ色相のまま明るくした色（131, 174, 196）、時刻は中間の灰色（168, 168, 168）を使う。背景（41, 42, 45）に対して3色とも6.0:1（WCAG 2.x）で、小さい文字に要る4.5:1を上回る（置き換える前は（168, 97, 180）が3.4:1、（97, 151, 180）が4.5:1、（120, 120, 120）が3.25:1だった）。小さいログは話者の行をメッセージの上の独立した行に書く（`Subtitles::small_log`）。中央揃えで、同じ受信の紫（198, 152, 206）を使い、既定のフォントの60px（本文の92pxの3分の2）で描く。この行は話者のないメッセージが持つ上の余白を使い、メッセージは行の高さの分だけ下へ移る。小さいログが画像を出している間に付けた名前では描き直さない。名前は次の画像から入る。行の高さは結合文字と代替の絵文字も含めて、実際に描く部分が収まるまで伸ばす。使える行より幅の広いルビのトークンは、書記素を壊さない断片に分け、読みはそれぞれ独立して折り返す。この断片は言語として文字と読みが対応することを保証しない。ルビのトークンにない原文は、空白と改行も含めてルビなしで描く。

上限は文字のブロック、連結、背景、外側の余白、最後のテクスチャに、**メモリを確保する前に**かける。

| 定数 | 上限 |
| --- | --- |
| `MAX_SUBTITLE_LINES` | 論理行で24行。時刻の見出しと省略の行を含む。原文の1行とそのルビで論理行1行と数える |
| `MAX_SUBTITLE_WIDTH` | 4096ピクセル |
| `MAX_SUBTITLE_HEIGHT` | 2048ピクセル |
| `MAX_SUBTITLE_PIXELS` | 4,194,304ピクセル（RGBAのラスター1枚で16 MiB） |
| `SUBTITLE_PADDING_RESERVE` | 文字の予算を見積もるときに、縦と横のそれぞれで確保する100ピクセル。既存の小さい字幕の外側の余白に足りる量 |

すべての上限を同時にかける。小さい字幕は余白を含めた幅3940pxを保つので、面積の上限から高さは最大1064pxになる。大きい字幕は余白を含めた幅1010pxを保つ。大きい字幕では、ふつうは行数が先に高さを制限する。連結では行数とピクセルの予算を原文、訳文、大きいログの履歴で分け合う。どれかの上限に達したら、見える先頭部分を完全な行で終え、その後に中央揃えの`…`の行を置く。描画はそこで止め、後のブロックはラスターにしない。保存したメッセージは変更せず、自動でページに分けることもしない。画像を返す前に最後の寸法を検証する。これらの上限が抑えるのはラスター1枚ごとの大きさで、プロセスのRSSの合計や、ネイティブのテクスチャのコピーにかかる余分な量ではない。

計測とシェーピングの処理量を抑えるため、`native/vr-overlay/src/fonts.rs`は、入力の構成要素ごとに`MAX_TEXT_CODEPOINTS = 8192`、書記素ごとに`MAX_CLUSTER_CODEPOINTS = 128`、シェーピングした行ごとに`MAX_LINE_CODEPOINTS = 512`の上限もかける。先頭部分の末尾に、途中で切れた書記素は残さない。入力や書記素のまとまりを切り詰めたときも`…`を出す。行ごとの上限では書記素を壊さずに折り返す。ルビの文字の大きさと間隔は128pxを上限にする。これらは表示の予算であり、チャットの入力や送信の上限ではない。

## ローカルのフォントへの代替

文字ごとのマスクをそのフォントの「グリフなし」のマスクと比べて、足りないグリフを見つける。書記素は全体で、見える文字をすべて持つ最初のフォントを使う。探す順は選んだフォント、その言語の標準のフォント、その文字を持つほかの入っているフォントである。フォントは同梱しない（`use-cases.md`の字幕の書体を参照）。シェーピングの制御文字と異体字セレクターには、単独のグリフを求めない。隣り合う連なり（run）はベースラインの計測を共有し、折り返しと描画には同じフォントと寸法を使う。

- WindowsではWindowsのフォントのディレクトリと、利用者ごとのフォントのディレクトリを探す。`seguiemj.ttf`（Segoe UI Emoji）も含む。
- Linuxでは`/usr/share/fonts`、`/usr/local/share/fonts`、`~/.local/share/fonts`、`~/.fonts`から絵文字のフォントかSymbolaを探す。Noto Color Emojiの大きさが109pxに決まったビットマップは、書記素ごとに測り、既存の字幕やルビの大きさに合わせて縮尺を変える。ネイティブのグリフのラスターにも最後のテクスチャにも、メモリを確保する前に上限をかける。
- 書記素全体を持つ使えるローカルのフォントがないときは、選んだフォントがもともと出す、グリフがないことを示す箱を残す。カラーの絵文字と、複雑な絵文字の合字に対応できるかは、入っているフォントと、PillowとFreeTypeのシェーピングの対応しだいである。

この変更ではフォントも依存もダウンロードせず、同梱もしない。システムのフォントは利用者の環境から読み、配布物には写さない。

## 検証

中核の描画は`native/vr-overlay`の単体試験（`src/subtitle.rs`、`src/layout.rs`、`src/fonts.rs`）で確かめる。この節の残りはPythonの試験の記録である。Pythonの試験は0.6.0でバックエンドと一緒にリポジトリから消えた（#285）。[`src-python/test/test_overlay_image_rendering.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_overlay_image_rendering.py)は同梱した実際のフォントを使い、`Image.new`を差し替えてメモリの確保の要求を確かめていた。対象は複数行の日本語、文字の幅が混ざった文、とても大きな入力、合成、空の入力や見えない文字だけの入力、書記素、ルビ、代替が見つからないとき、任意で入れた絵文字のフォントだった。これらの試験はヘッドセットでの読みやすさや、Windowsで動かしたときの描画を保証しない。描画と確保の試験は`regex`を使う経路と、標準ライブラリの経路を強制した場合の両方で流す。分割を明示した事例で、上に挙げた並びの境界が同じになることを確かめる。別の試験がモジュールの読み込み時に`regex`の読み込みが失敗する場合を再現する。
