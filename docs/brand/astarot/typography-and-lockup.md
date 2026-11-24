# ASTAROT typography and lockup requirements

[日本語版](#astarot-タイポグラフィとロックアップの要件日本語版)

The rules for the brand typeface and for setting the wordmark together with the subtitle (the lockup). They were settled on 2026-11-16.

## Typeface

- The brand typeface is **Outfit** (Google Fonts, OFL 1.1). It is used for the wordmark and the subtitle.
- The weight is **Bold 700**.
- It replaced Space Grotesk on 2026-11-16.
- The Japanese typeface of the UI stays Zen Kaku Gothic New (unchanged).

## Making the wordmark

- The master is the outline of the actual Outfit Bold font, converted to paths with fontTools.
- Remove the overlaps between contours before converting them to paths (`removeOverlaps`). If the contours still overlap, the `fill-rule="evenodd"` fill leaves parts of the letterforms missing.
- Normalized dimensions: cap height 130 units, box 889 × 131 units.
- Letter spacing (tracking) brings the total ink width to 888 units. At a cap height of 130, Outfit's natural ink width is 844.5 units, and the tracking is about 7.26 units per letter gap (about 0.04em).

## Lockup rules (one-line subtitle)

- The subtitle is "Speech, Translation, Accessibility, Revoicing & OCR Toolkit", set in Outfit Bold.
- **Wordmark ink width = subtitle ink width × 1.0047** (about 100.5%).
- Align the left edges by the position of the ink.
- Measure widths by **ink width (the area actually drawn)**, not by the font's advance width. If the advance widths are matched, the wordmark looks as if it sticks out to the right.
- How this was decided: on 2026-11-16, a version of the base layout (ink width ratio 96.6%) with the wordmark enlarged by 4% was approved.
- Values used in the horizontal logo: with the wordmark group at scale 1.074241, the subtitle's font-size is 35.8. A measurement of the rendered logo confirmed the ratio of 100.5%.

## Vertical logo

- The subtitle is on two lines, centered (the same layout as before; only the typeface changed to Outfit).
- The ratio rule of the one-line lockup does not apply to the vertical logo.

## Unchanged

- Colors: Dark Plum `#261633`, Lilac `#A47AF5`, Off-White `#FAFAFC`.
- Symbol: the geometry of the uniform version is the master (outside the scope of this document).

---

# ASTAROT タイポグラフィとロックアップの要件（日本語版）

ブランド書体と、ワードマークとサブタイトルの組み方（ロックアップ）の決め事。
2026-11-16 に確定した。

## 書体

- ブランド書体は **Outfit**（Google Fonts、OFL 1.1）。ワードマークとサブタイトルに使う。
- ウェイトは **Bold 700**。
- 2026-11-16 に Space Grotesk から変更した。
- UI の日本語書体は Zen Kaku Gothic New のまま（変更なし）。

## ワードマークの作り方

- Outfit Bold の実フォントの輪郭を fontTools でパス化したものを正とする。
- パス化の前に輪郭同士の重なりを除去する（`removeOverlaps`）。
  重なった輪郭のままだと `fill-rule="evenodd"` の塗りで字形が欠けるため。
- 正規化の寸法：キャップハイト 130 単位、ボックス 889 × 131 単位。
- 字間トラッキングでインク幅の合計を 888 単位に合わせる。
  Outfit の自然なインク幅はキャップハイト 130 で 844.5 単位、
  トラッキングは約 7.26 単位／字間（約 0.04em）。

## ロックアップ規則（サブタイトルが1行の場合）

- サブタイトルは「Speech, Translation, Accessibility, Revoicing & OCR Toolkit」、
  Outfit Bold で組む。
- **ワードマークのインク幅 ＝ サブタイトルのインク幅 × 1.0047**（約 100.5%）。
- 左端はインクの位置で揃える。
- 幅はフォントの送り幅（advance）ではなく、
  **インク幅（実際に描画される範囲）**で測る。
  送り幅で合わせると、見た目にはワードマークが右にはみ出して見える。
- 決め方：基準の組み（インク幅比 96.6%）のワードマークを 4% 拡大した形を
  2026-11-16 に承認した。
- 横ロゴでの実装値：ワードマークのグループ scale 1.074241 に対して
  サブタイトルの font-size は 35.8。レンダリング実測で比率 100.5% を確認済み。

## 縦ロゴ

- サブタイトルは2行・中央揃え（従来の構成のまま、書体だけ Outfit に変更）。
- 1行ロックアップの比率規則は縦ロゴには適用しない。

## 変更なし

- 色：Dark Plum `#261633`、Lilac `#A47AF5`、Off-White `#FAFAFC`。
- シンボル：均一版の幾何が正本（本書の対象外）。
