// The rules of docs/writing/ that a pattern can check. Each names the guideline section it comes
// from; the judgement calls (the document's stance, the point first, one direction of argument,
// revising without changing the meaning) stay with the writer and the checklists of the
// guidelines. A rule reads one language's lines (ja: a line with kana; en: a line with Latin
// letters and no CJK) in every document, or only in user-facing text.
//
// The patterns are kept narrow: a word that is right in some places (様, ユーザー, harness,
// elevate) is left out rather than flagged everywhere.

const JA = "docs/writing/japanese-guideline.md";
const EN = "docs/writing/english-guideline.md";

const KANJI = "\\u4e00-\\u9fff";
const KANA = "\\u3040-\\u30ff";
const JAPANESE = `${KANJI}${KANA}`;

const rule = (id, lang, audience, pattern, message) => ({ id, lang, audience, pattern, message });

export const LINE_RULES = [
    // 共通の決まり: 避ける表現
    rule(
        "ja-filler",
        "ja",
        "all",
        /さて、|それでは見ていきましょう|以下で説明します|ポイントは[0-9一二三四五六]つ|重要なのは|注目すべきは|と言えるでしょう|に他なりません|いかがでしょうか|お役に立てば幸いです/g,
        `定型句です。本題か内容を直接書きます（${JA}「定型句と誇張」）`,
    ),
    rule(
        "ja-hype",
        "ja",
        "all",
        /シームレス|強力な|革新的な|劇的に/g,
        `誇張です。できることを具体的に、効果は数値と条件で書きます（${JA}「定型句と誇張」）`,
    ),
    rule(
        "ja-metaphor",
        "ja",
        "all",
        /静かに失敗|握りつぶ|を蹴[るっらり]|メモリを食|を叩[くきいけ]|側に倒|ログが語|が効きます|刺さります|(?:アプリ|プロセス|ASTAROT)が落ち/g,
        `比喩か擬人化です。意味の決まった言葉に直します（${JA}「比喩と擬人化」）`,
    ),
    rule(
        "ja-roundabout",
        "ja",
        "all",
        /することができ|を実施し|を実施する|を行[うい]|を行います|することによって|において|に関して|させていただ/g,
        `回りくどい言い方です（${JA}「回りくどい言い方と翻訳調」）`,
    ),
    // 書式
    rule("ja-exclamation", "ja", "all", new RegExp(`！|[${JAPANESE}]!`, "g"), `感嘆符を使いません（${JA}「書式」）`),
    rule("ja-question", "ja", "documents", /？/g, `疑問符は画面の確認の文にだけ使います（${JA}「書式」）`),
    rule("ja-dash", "ja", "all", /(?<!\|\s*)[—―](?!\s*\|)/g, `ダッシュで文をつなぎません（${JA}「書式」）`),
    rule("ja-colon-line-end", "ja", "all", /：\s*$/g, `行末を全角のコロンで終えません（${JA}「書式」）`),
    rule("ja-indent", "ja", "all", /^　/g, `段落の先頭を1字下げしません（${JA}「書式」）`),
    // 表記
    rule(
        "ja-kana-words",
        "ja",
        "all",
        new RegExp(
            `出来(?:る|ます|ない|ません|た|て)|下さい|及び|又は|但し|(?<!変)更に|(?:する|した|ない|できる|いる|ある|なる)事(?=[がをはにもで。、])|(?:する|した|ない|ある|いる|なる|の)時(?=[はに、])|(?:の|次の|以下の|この|その|上の|下の)通り|(?<!その)他の(?![${KANJI}])|(?<![同平均高初上中下対劣優特一二三四五六七八九十何])等(?=[のをがはにで、。])`,
            "g",
        ),
        `仮名で書く語です（${JA}「漢字と仮名」）`,
    ),
    rule(
        "ja-okurigana",
        "ja",
        "all",
        /取扱い|取扱(?!い)|読込み|読込(?!み)|書込み|書込(?!み)|割当て|割当(?!て)|問合せ|受付(?![けき])|引継ぎ|引継(?!ぎ)|切替え|切替(?!え)|取消し|取消(?!し)/g,
        `送り仮名を省きません（${JA}「送り仮名」）`,
    ),
    rule(
        "ja-long-vowel-er",
        "ja",
        "all",
        /(?:サーバ|フォルダ|ユーザ|ドライバ|ブラウザ|パラメータ|エンコーダ|デコーダ|インストーラ|プレイヤ|コンピュータ|プロセッサ|アダプタ|コントローラ|モニタ|ヘッダ|フッタ|レンダラ|コンバータ|フィルタ|マネージャ|ジェネレータ|コネクタ|セレクタ|レジスタ|プリンタ)(?![ーァ-ヶ])/g,
        `英語の-er、-or、-arに当たる長音は「ー」を書きます（${JA}「外来語」）`,
    ),
    rule(
        "ja-long-vowel-y",
        "ja",
        "all",
        /(?:メモリ|セキュリティ|ディレクトリ|プロパティ|ライブラリ|リポジトリ|カテゴリ|エントリ|クエリ|ユーティリティ|アクセシビリティ|コミュニティ)ー/g,
        `英語の-yに当たる長音は「ー」を書きません（${JA}「外来語」）`,
    ),
    rule("ja-vu", "ja", "all", /ヴ/g, `「ヴ」を使わず「バ行」で書きます（${JA}「外来語」）`),
    rule("ja-fullwidth-alnum", "ja", "all", /[０-９Ａ-Ｚａ-ｚ]/g, `数字と英字は半角で書きます（${JA}「数字と単位」）`),
    rule(
        "ja-unit-space",
        "ja",
        "all",
        /\d(?:GiB|MiB|KiB|GB|MB|KB|ms|kHz|Hz)\b|\d %/g,
        `数字と単位の記号の間は半角スペースを空け、「%」は空けません（${JA}「数字と単位」）`,
    ),
    rule(
        "ja-halfwidth-paren",
        "ja",
        "all",
        new RegExp(`[${JAPANESE}]\\(|\\)[${JAPANESE}]`, "g"),
        `和文の中の括弧は全角の（）を使います（${JA}「符号」）`,
    ),
    rule("ja-fullwidth-punct", "ja", "all", /[，．]/g, `句読点は「。」「、」を使います（${JA}「符号」）`),
    // 用語
    rule(
        "ja-terms",
        "ja",
        "all",
        /デフォルト|クリック(?:し|する|して|します)|タップ(?:し|する|して|します)|クイックチャット|VRパネル/g,
        `用語の表で使わない言葉です（${JA}「用語」）`,
    ),
    rule(
        "ja-terms-user",
        "ja",
        "user",
        /音声合成/g,
        `利用者向け文書では「テキスト読み上げ（TTS）」と書きます（${JA}「用語」）`,
    ),
    // 利用者向け文書
    rule(
        "ja-this-pc",
        "ja",
        "user",
        /このPC|この PC|手元のPC/g,
        `利用者向け文書では「お使いのPC」と書きます（${JA}「利用者向け文書」）`,
    ),
    rule(
        "ja-honorific",
        "ja",
        "user",
        /ございます|いたします|申し上げ/g,
        `利用者向け文書で使わない敬語です（${JA}「利用者向け文書」）`,
    ),
    rule(
        "ja-latin-spacing",
        "ja",
        "user",
        new RegExp(`[${JAPANESE}] +[A-Za-z0-9]|[A-Za-z0-9] +[${JAPANESE}]`, "g"),
        `利用者向け文書では和文と英数字の間を空けません（${JA}「和文と英数字の間」）`,
    ),

    rule(
        "en-filler",
        "en",
        "all",
        /\b(?:it'?s (?:important|worth) (?:to note|noting)|in today'?s fast-paced world|when it comes to|let'?s dive in|here'?s the thing|in conclusion|in summary)\b|(?:^|[.!?]\s+)Overall,/gi,
        `Filler opener or transition (${EN}, "Filler openers and transitions")`,
    ),
    rule(
        "en-chatbot",
        "en",
        "all",
        /\b(?:certainly!|great question|you'?re absolutely right|i hope this helps|let me know if you have any questions|as an ai\b|knowledge cutoff)/gi,
        `Chatbot leftover (${EN}, "Chatbot leftovers")`,
    ),
    rule(
        "en-promotional",
        "en",
        "all",
        /\b(?:robust|seamless(?:ly)?|cutting-edge|state-of-the-art|powerful|comprehensive|effortless(?:ly)?|blazing[- ]fast|game-changing|world-class|best-in-class|truly|incredibly|significantly|dramatically)\b/gi,
        `Promotional word or intensifier without a number (${EN}, "Unsupported emphasis and promotional words")`,
    ),
    rule(
        "en-ai-vocabulary",
        "en",
        "all",
        /\b(?:delv(?:e|es|ed|ing)|leverag(?:e|es|ed|ing)|utiliz(?:e|es|ed|ing|ation)|underscor(?:e|es|ed|ing)|showcas(?:e|es|ed|ing)|foster(?:s|ed|ing)?|empower(?:s|ed|ing)?|streamlin(?:e|es|ed|ing)|tapestry|testament to|pivotal|crucial|intricate)\b/gi,
        `AI vocabulary; use the plain word (${EN}, "AI vocabulary")`,
    ),
    rule(
        "en-copula",
        "en",
        "all",
        /\b(?:serves as|stands as|acts as|boasts)\b/gi,
        `Write "is" or "has" (${EN}, "Avoiding "is" and "has"")`,
    ),
    rule(
        "en-ing-tail",
        "en",
        "all",
        /,\s(?:ensuring|highlighting|underscoring|showcasing|making it (?:ideal|perfect|easy))\b/gi,
        `Trailing "-ing" commentary (${EN}, "Trailing "-ing" commentary")`,
    ),
    rule(
        "en-plain-verbs",
        "en",
        "all",
        /\b(?:facilitat(?:e|es|ed|ing)|commenc(?:e|es|ed|ing)|prior to|subsequently|in order to|a number of|in the event that|due to the fact that)\b/gi,
        `Use the plain word (${EN}, "Plain verbs and wording")`,
    ),
    rule("en-exclamation", "en", "all", /[A-Za-z0-9)]!(?=\s|$)/g, `No exclamation marks (${EN}, "Formatting")`),
    rule("en-curly-quotes", "en", "all", /[“”‘’]/g, `Straight quotes and apostrophes (${EN}, "Formatting")`),
    rule(
        "en-dash",
        "en",
        "all",
        /(?<![0-9]\s?|\|\s*)–(?![\s]?[0-9]|\s*\|)|[A-Za-z)]\s-\s[A-Za-z(]/g,
        `No en dash or spaced hyphen as a dash (${EN}, "Dashes")`,
    ),
    rule(
        "en-british",
        "en",
        "all",
        /\b(?:colours?|licence|behaviours?|analys(?:e|ed|es|ing)|organis(?:e|ed|es|ing|ation)|recognis(?:e|ed|es|ing)|favour|centre|customis(?:e|ed|ation)|initialis(?:e|ed|es|ing|ation)|serialis(?:e|ed|ation)|normalis(?:e|ed|ation)|optimis(?:e|ed|ation))\b/gi,
        `American spelling (${EN}, "Spelling and mechanics")`,
    ),
    rule(
        "en-contraction",
        "en",
        "all",
        /\b(?:don't|doesn't|can't|isn't|won't|aren't|wasn't|weren't|shouldn't|wouldn't|couldn't|didn't|haven't|hasn't|it's|that's|there's|we're|you're|they're|let's)\b/gi,
        `Use the full form (${EN}, "Spelling and mechanics")`,
    ),
    rule(
        "en-eg-ie",
        "en",
        "user",
        /\b(?:e\.g\.|i\.e\.)/gi,
        `Write "for example" or "that is" in user-facing text (${EN}, "Spelling and mechanics")`,
    ),
    rule(
        "en-this-pc",
        "en",
        "user",
        /\bthis (?:PC|machine)\b/gi,
        `Write "your PC" in user-facing text (${EN}, "User-facing text")`,
    ),
    rule(
        "en-click",
        "en",
        "user",
        /\b(?:click(?:s|ed|ing)?|tap(?:s|ped|ping)?)\b/gi,
        `Write "press" (${EN}, "Terminology")`,
    ),
];

// The emoji rule reads every line but the release notes: they put an emoji at the start of their
// headings and name those headings in the text (docs/release-notes/README.md decides).
export const EMOJI_RULE = rule(
    "emoji",
    "both",
    "all",
    /(?![©®™])\p{Extended_Pictographic}/gu,
    `No emoji, except where a document's own rule asks for them (${JA}「書式」, ${EN}, "Formatting")`,
);

const KANA_RE = new RegExp(`[${KANA}]`);
const CJK_RE = /[　-鿿＀-￯]/;

export const languageOf = (text) =>
    KANA_RE.test(text) ? "ja" : !CJK_RE.test(text) && /[A-Za-z]/.test(text) ? "en" : null;
