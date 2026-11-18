// Every word the ASTAROT manual shows, in Japanese and English. The pages switch between the two
// in place (manual/locale.ts), so both languages carry the same keys; tools/check_site_manual.mjs
// checks that and that every guide page linked here is built.
//
// Japanese: few commas, short paragraphs. A string[] is one paragraph per item.

/** @typedef {'ja' | 'en'} Locale */

/**
 * A page of the existing user guide, the same path under /ja/ and /en/.
 * @typedef {{ path: string, label: Record<Locale, string> }} GuideLink
 */

/**
 * @typedef {object} Chapter
 * @property {string} slug
 * @property {Record<Locale, string>} title
 * @property {Record<Locale, string>} summary
 * @property {string} keywords  extra words the search box matches, beyond the title and summary
 * @property {GuideLink[]} guide  guide pages that already cover the chapter
 * @property {'guide' | 'pending'} status  'guide': the guide pages cover it for now; 'pending': nothing covers it yet
 */

/** @returns {GuideLink} */
const g = (path, ja, en) => ({ path, label: { ja, en } })

/** @type {Chapter[]} */
export const CHAPTERS = [
  {
    slug: 'introduction',
    title: { ja: 'はじめに', en: 'Getting to know ASTAROT' },
    summary: {
      ja: 'ASTAROTでできることと動かすのに必要なPCの条件です。',
      en: 'What ASTAROT does, and the PC it needs.',
    },
    keywords: 'about vrct-vox requirements support platform 動作環境 スペック GPU メモリ 対応環境 検証',
    guide: [
      g('/guide/introduction', 'ASTAROTとは', 'What is ASTAROT'),
      g('/guide/requirements', '動作環境と推奨スペック', 'System requirements'),
      g('/guide/support', '対応環境と検証の範囲', 'Platform support'),
    ],
    status: 'guide',
  },
  {
    slug: 'install',
    title: { ja: 'インストールと最初の設定', en: 'Install and first setup' },
    summary: {
      ja: 'インストールの手順と最初に起動したときの設定です。',
      en: 'Getting the app onto your PC and the settings to make on first launch.',
    },
    keywords: 'install setup download windows linux appimage deb rpm zip osc smartscreen インストーラー 初期設定',
    guide: [g('/guide/install', 'インストール', 'Install'), g('/guide/first-setup', '最初の設定', 'First setup')],
    status: 'guide',
  },
  {
    slug: 'screens',
    title: { ja: '画面と操作', en: 'Screens and controls' },
    summary: {
      ja: 'メイン画面の見かたとキーボードでの操作です。',
      en: 'Reading the main screen, and working it from the keyboard.',
    },
    keywords: 'main screen quick chat hotkey keyboard accessibility ホットキー 小窓 キーボード',
    guide: [g('/guide/how-it-works', '声と文字の流れ', 'How voice and text flow'), g('/features/quick-chat', '入力の小窓とホットキー', 'Quick Chat and hotkeys')],
    status: 'pending',
  },
  {
    slug: 'translation',
    title: { ja: '翻訳', en: 'Translation' },
    summary: {
      ja: '入力した文章を訳してVRChatのチャットボックスへ送ります。',
      en: 'Translating what you type and sending it to the VRChat chatbox.',
    },
    keywords: 'translate translation chatbox 翻訳 チャットボックス',
    guide: [g('/features/translation', '翻訳', 'Translation')],
    status: 'guide',
  },
  {
    slug: 'speech',
    title: { ja: '音声認識と字幕', en: 'Speech recognition and captions' },
    summary: {
      ja: '自分と相手の声を文字にして字幕に出します。',
      en: 'Turning your voice and other players’ voices into text and captions.',
    },
    keywords: 'asr speech recognition transcription captions subtitles 字幕 文字起こし 音声認識',
    guide: [g('/features/transcription', '音声認識（ASR）とリアルタイム字幕', 'Speech recognition (ASR) and realtime captions')],
    status: 'guide',
  },
  {
    slug: 'voice',
    title: { ja: '読み上げと声の変換', en: 'Text to speech and revoicing' },
    summary: {
      ja: '文章を声で届ける機能と、マイクの声を別の声に変える機能です。',
      en: 'Speaking your text aloud, and changing the voice that reaches your mic.',
    },
    keywords: 'tts text to speech rvc voice changer revoicing 読み上げ ボイスチェンジャー 声',
    guide: [g('/features/tts', 'テキスト読み上げ（TTS）', 'Text to speech (TTS)'), g('/features/voice-conversion', 'ボイスチェンジャー（RVC）', 'Voice changer (RVC)')],
    status: 'guide',
  },
  {
    slug: 'chat-reading',
    title: { ja: 'チャット読み取り', en: 'Chat reading' },
    summary: {
      ja: '画面に出た相手のチャットを読み取って訳します。',
      en: 'Reading other players’ chatboxes off the screen and translating them.',
    },
    keywords: 'ocr chat reading screen capture チャット 読み取り 画面',
    guide: [g('/features/chat-reading', 'チャット読み取り（OCR）', 'Chat reading (OCR)')],
    status: 'guide',
  },
  {
    slug: 'audio-and-vr',
    title: { ja: '音声経路とVR', en: 'Audio routes and VR' },
    summary: {
      ja: '声をVRChatへ届ける経路とVRの中での表示です。',
      en: 'How sound gets into VRChat, and what you see inside VR.',
    },
    keywords: 'audio route virtual cable microphone overlay vr steamvr pipewire 仮想マイク オーバーレイ 入力 出力',
    guide: [
      g('/features/io-flow', '入力と出力', 'Inputs and outputs'),
      g('/guide/windows-audio', 'Windowsの音声経路', 'Windows audio route'),
      g('/guide/linux-audio', 'Linuxの音声経路', 'Linux audio route'),
      g('/features/vr', 'VRとオーバーレイ', 'VR and overlay'),
    ],
    status: 'guide',
  },
  {
    slug: 'models',
    title: { ja: 'モデルとほかのアプリとの連携', en: 'Models and other apps' },
    summary: {
      ja: '機能に使うモデルの取得と、OBSなどほかのアプリとのつなぎ方です。',
      en: 'Downloading the models features use, and connecting OBS and other apps.',
    },
    keywords: 'model download license custom model obs websocket モデル 取得 連携',
    guide: [
      g('/guide/models', 'モデルの取得', 'Model downloads'),
      g('/guide/custom-models', '自分のモデルを使う', 'Use your own models'),
      g('/features/integrations', 'OBSとWebSocket', 'OBS and WebSocket'),
    ],
    status: 'guide',
  },
  {
    slug: 'help',
    title: { ja: '困ったときは', en: 'When something goes wrong' },
    summary: {
      ja: 'うまく動かないときに確かめることと不具合の報告のしかたです。',
      en: 'What to check when something misbehaves, and how to report it.',
    },
    keywords: 'troubleshooting help log bug report privacy license 困った ログ 不具合 プライバシー ライセンス',
    guide: [
      g('/guide/troubleshooting', '困ったとき', 'Troubleshooting'),
      g('/guide/privacy', 'プライバシー', 'Privacy'),
      g('/guide/license', 'ライセンスと謝辞', 'License and credits'),
    ],
    status: 'guide',
  },
]

/** @typedef {'normal' | 'wink' | 'laugh' | 'surprised' | 'sleepy' | 'angry' | 'sparkle' | 'dizzy'} Face */
/** @type {Face[]} */
export const FACES = ['normal', 'wink', 'laugh', 'surprised', 'sleepy', 'angry', 'sparkle', 'dizzy']

/** @typedef {'note' | 'tip' | 'important' | 'caution' | 'warning' | 'trouble'} Callout */
/** @type {{ kind: Callout, face: Face }[]} */
export const CALLOUTS = [
  { kind: 'note', face: 'normal' },
  { kind: 'tip', face: 'wink' },
  { kind: 'important', face: 'sparkle' },
  { kind: 'caution', face: 'surprised' },
  { kind: 'warning', face: 'angry' },
  { kind: 'trouble', face: 'dizzy' },
]

/** @typedef {'speech' | 'translation' | 'accessibility' | 'revoicing' | 'ocr'} Feature */
/**
 * The subtitle's words in order: Speech, Translation, Accessibility, Revoicing & OCR.
 * @type {{ id: Feature, word: string, chapters: string[] }[]}
 */
export const FEATURES = [
  { id: 'speech', word: 'Speech', chapters: ['speech', 'voice'] },
  { id: 'translation', word: 'Translation', chapters: ['translation'] },
  { id: 'accessibility', word: 'Accessibility', chapters: ['screens', 'audio-and-vr'] },
  { id: 'revoicing', word: 'Revoicing', chapters: ['voice'] },
  { id: 'ocr', word: 'OCR', chapters: ['chat-reading'] },
]

const ja = {
  meta: {
    title: 'ASTAROTユーザーマニュアル',
    description: 'VRChatの会話を声と文字で支えるデスクトップアプリASTAROTの使い方',
  },
  nav: {
    home: 'ASTAROTマニュアルのトップ',
    name: 'マニュアル',
    search: '目次を検索',
    searchLabel: '目次を絞り込む',
    language: '言語',
    github: 'GitHubのリポジトリ',
    skip: '本文へ移動',
  },
  hero: {
    label: 'ユーザーマニュアル',
    lead: ['VRChatでの会話を声と文字の両方から支えるデスクトップアプリです。', '翻訳・字幕・読み上げ・声の変換・チャットの読み取りをひとつにまとめています。'],
    renamed: 'ASTAROTはVRCT-VOXの新しい名前です。配布ファイルの名前はVRCT-VOXのままです。',
    quickstart: 'クイックスタート',
    bubble: ['はじめまして！', 'このマニュアルの案内役だよ。', 'わからないところは一緒に見ていこう。'],
    mascotAlt: '案内役の悪魔のペンギン。紫のヘッドホンと角と羽がある',
  },
  download: {
    download: 'ダウンロード',
    releases: 'リリース一覧を開く',
    more: 'ほかの形式を選ぶ',
    menu: 'ダウンロードするファイル',
    recommended: 'おすすめ',
    absent: 'この版にはありません',
    all: 'すべてのリリース',
    idle: 'GitHub Releasesの最新版を開きます',
    loading: '最新版を確かめています',
    failed: 'ファイルの一覧を読み込めませんでした。ボタンからGitHub Releasesを開けます',
    unsupported: 'お使いの環境向けの版はありません。WindowsとLinuxの版はリリース一覧から選べます',
    missing: 'この版にはお使いのOS向けのファイルがありません。一覧から選べます',
    slots: {
      'windows-installer': 'インストーラー',
      'windows-zip-cpu': 'ZIP（CPU版）',
      'windows-zip-cuda': 'ZIP（CUDA版）',
      'linux-appimage': 'AppImage',
      'linux-deb': 'deb（Ubuntu・Debian）',
      'linux-rpm': 'rpm（Fedora）',
      'linux-tar': 'tar.gz',
    },
  },
  quickstart: {
    title: 'クイックスタート',
    intro: '3つの手順で最初のメッセージを送るところまで進めます。',
    steps: [
      {
        title: 'ダウンロードして入れる',
        text: ['上のボタンからお使いのOS向けのファイルを入手します。', 'Windowsはインストーラーを開けば入ります。'],
        chapter: 'install',
      },
      {
        title: 'VRChatとつなぐ',
        text: ['VRChatのOSCをオンにします。', 'ASTAROTでは自分の言語と相手の言語を選びます。'],
        chapter: 'install',
      },
      {
        title: '送ってみる',
        text: ['翻訳をオンにして文章を送ります。', '訳した文章がVRChatのチャットボックスに出れば完了です。'],
        chapter: 'translation',
      },
    ],
    open: '手順を読む',
  },
  contents: {
    title: '目次',
    intro: '上の検索窓にことばを入れると章を絞り込めます。',
    count: (shown, total) => (shown === total ? `全${total}章` : `${total}章のうち${shown}章`),
    empty: '当てはまる章がありません。ことばを変えて探してください。',
    clear: '検索をやめる',
    chapter: (n) => `第${n}章`,
    status: { guide: 'ガイドで読めます', pending: '準備中' },
  },
  features: {
    title: 'できること',
    intro: 'ロゴの下に並ぶ5つのことばがASTAROTの5つの柱です。',
    items: {
      speech: { name: '音声', text: ['声を文字にして字幕にします。', '文章を声にして届けることもできます。'] },
      translation: { name: '翻訳', text: ['自分の文章も相手のことばも訳します。', '手元のモデルと外部の翻訳サービスから選べます。'] },
      accessibility: { name: 'アクセシビリティ', text: ['声でも文字でも会話できます。', '入力と出力を選べます。キーボードだけでも操作できます。'] },
      revoicing: { name: '音声変換', text: ['マイクの声を別の声に変えてVRChatへ届けます。', '自分で用意したモデルも使えます。'] },
      ocr: { name: 'OCR', text: ['画面に出た相手のチャットを読み取ります。', '読んだ文字はそのまま訳せます。'] },
    },
    read: '章を読む',
  },
  guide: {
    title: '案内役',
    intro: ['このマニュアルでは悪魔のペンギンが案内します。', '表情を見ればその場面で何に気をつけるかがわかります。'],
    faces: {
      normal: { name: 'ふつう', use: '説明を始めるとき' },
      wink: { name: 'ウインク', use: '知っておくと楽になること' },
      laugh: { name: '大笑い', use: '手順がうまくいったとき' },
      surprised: { name: '驚き', use: '間違えやすいところ' },
      sleepy: { name: '眠い', use: '時間がかかる処理や準備中の章' },
      angry: { name: '怒り', use: '設定やデータを失うおそれがあるとき' },
      sparkle: { name: 'キラキラ目', use: '大事なところ' },
      dizzy: { name: '目がぐるぐる', use: 'うまくいかないとき' },
    },
    faceAlt: (name) => `案内役の表情：${name}`,
    legendTitle: 'コールアウトの見かた',
    legendIntro: '本文の囲みは6種類あります。',
    callouts: {
      note: { name: '補足', text: '本文を少し詳しくした説明です。読み飛ばしても進めます。' },
      tip: { name: 'ヒント', text: '知っておくと手間が減ることです。' },
      important: { name: '大事', text: '手順を進める前に必ず読んでほしいことです。' },
      caution: { name: '注意', text: 'よく間違えるところです。画面と見比べてください。' },
      warning: { name: '警告', text: '設定やデータを失うおそれがあります。元に戻せないこともあります。' },
      trouble: { name: 'うまくいかないとき', text: '動かないときに確かめることです。' },
    },
  },
  system: {
    title: '動作環境',
    intro: ['必要な性能は使う機能によって変わります。', '文字の翻訳と字幕だけならGPUはなくても動きます。'],
    rows: [
      { os: 'Windows', text: ['64ビットのWindows 11で確かめています。Windows 10では確かめていません。', 'WebView2 Runtimeが必要です。なければインストーラーが入れます。'] },
      { os: 'Linux', text: ['x86-64のPCで、glibc 2.39以降・GTK 3・WebKitGTK 4.1が必要です。', 'Ubuntu 24.04・Debian 13・Fedora 44に入れられることを確かめています。'] },
      { os: 'macOS', text: ['macOS版はありません。'] },
    ],
    gpu: ['読み上げと音声認識は、Vulkanに対応したGPUがあると速くなります。内蔵GPUでも動きます。', '声の変換（RVC）をGPUで動かすには、NVIDIAのGPUとドライバー580以降が必要です。'],
    details: '詳しい動作環境',
  },
  support: {
    title: 'サポート',
    intro: 'うまく動かないときは「困ったときは」の章から見てください。',
    links: {
      help: { name: '困ったときは', text: 'よくあるつまずきと確かめる順番' },
      issues: { name: '不具合を報告する', text: 'GitHub Issuesで受け付けています' },
      releases: { name: 'リリースノート', text: '版ごとの変更点' },
      privacy: { name: 'プライバシー', text: '送る情報と送らない情報' },
    },
  },
  chapter: {
    back: '目次へ戻る',
    pending: ['この章の本文は準備中です。', 'それまでは次のガイドのページが参考になります。'],
    guide: ['この章の本文は準備中です。', 'いまは次のガイドのページで同じ内容を読めます。'],
    related: '関連するガイド',
    prev: '前の章',
    next: '次の章',
  },
  footer: {
    unofficial: 'ASTAROT（VRCT-VOX）はVRCTの非公式な派生版です。VRChat Inc.とは関係ありません。',
    license: 'MIT License。元のVRCTの著作権表示を保持しています。',
    guide: '以前のガイド',
  },
}

/** @type {typeof ja} */
const en = {
  meta: {
    title: 'ASTAROT User Manual',
    description: 'How to use ASTAROT, a desktop app that helps you talk in VRChat by voice and by text',
  },
  nav: {
    home: 'ASTAROT manual home',
    name: 'Manual',
    search: 'Search the contents',
    searchLabel: 'Filter the chapters',
    language: 'Language',
    github: 'GitHub repository',
    skip: 'Skip to content',
  },
  hero: {
    label: 'User manual',
    lead: ['A desktop app that helps you hold a conversation in VRChat, by voice and by text.', 'Translation, captions, text to speech, voice changing and chat reading share one window.'],
    renamed: 'ASTAROT is the new name of VRCT-VOX. The files you download still carry the VRCT-VOX name.',
    quickstart: 'Quick start',
    bubble: ['Hi there.', 'I’ll be showing you around this manual.', 'If something is unclear, we’ll work through it together.'],
    mascotAlt: 'The guide, a little devil penguin with purple headphones, horns and wings',
  },
  download: {
    download: 'Download',
    releases: 'Open the releases',
    more: 'Other formats',
    menu: 'Files to download',
    recommended: 'Recommended',
    absent: 'Not in this release',
    all: 'All releases',
    idle: 'Opens the latest release on GitHub Releases',
    loading: 'Checking the latest release',
    failed: 'Could not load the file list. The button still opens GitHub Releases',
    unsupported: 'There is no build for your system. The Windows and Linux builds are on the releases page',
    missing: 'This release has no file for your OS. Pick one from the list',
    slots: {
      'windows-installer': 'Installer',
      'windows-zip-cpu': 'ZIP (CPU)',
      'windows-zip-cuda': 'ZIP (CUDA)',
      'linux-appimage': 'AppImage',
      'linux-deb': 'deb (Ubuntu, Debian)',
      'linux-rpm': 'rpm (Fedora)',
      'linux-tar': 'tar.gz',
    },
  },
  quickstart: {
    title: 'Quick start',
    intro: 'Three steps take you from download to your first message.',
    steps: [
      {
        title: 'Download and install',
        text: ['Get the file for your OS with the button above.', 'On Windows, opening the installer is all it takes.'],
        chapter: 'install',
      },
      {
        title: 'Connect to VRChat',
        text: ['Turn on OSC in VRChat.', 'In ASTAROT, pick the language you speak and the one you want to reach.'],
        chapter: 'install',
      },
      {
        title: 'Send something',
        text: ['Switch translation on and type a message.', 'Once the translation shows up in your VRChat chatbox, you’re set.'],
        chapter: 'translation',
      },
    ],
    open: 'Read the steps',
  },
  contents: {
    title: 'Contents',
    intro: 'Type in the search box at the top to narrow the chapters down.',
    count: (shown, total) => (shown === total ? `${total} chapters` : `${shown} of ${total} chapters`),
    empty: 'No chapter matches. Try another word.',
    clear: 'Clear the search',
    chapter: (n) => `Chapter ${n}`,
    status: { guide: 'In the guide', pending: 'Coming soon' },
  },
  features: {
    title: 'What it does',
    intro: 'The five words under the logo are the five things ASTAROT is built around.',
    items: {
      speech: { name: 'Speech', text: ['Your voice becomes text and captions.', 'Your text can also be spoken aloud for you.'] },
      translation: { name: 'Translation', text: ['Your messages and other players’ words, both translated.', 'Use a model on your PC or an online service.'] },
      accessibility: { name: 'Accessibility', text: ['Talk by voice, by text, or both.', 'Choose your inputs and outputs, and run it all from the keyboard.'] },
      revoicing: { name: 'Revoicing', text: ['Change the voice your mic sends into VRChat.', 'Models you trained yourself work too.'] },
      ocr: { name: 'OCR', text: ['Read other players’ chatboxes straight off the screen.', 'What it reads can be translated right away.'] },
    },
    read: 'Read the chapter',
  },
  guide: {
    title: 'Your guide',
    intro: ['A little devil penguin walks you through this manual.', 'Its face tells you what kind of note you are looking at.'],
    faces: {
      normal: { name: 'Calm', use: 'Starting an explanation' },
      wink: { name: 'Wink', use: 'A shortcut worth knowing' },
      laugh: { name: 'Laughing', use: 'A step that worked' },
      surprised: { name: 'Surprised', use: 'An easy place to slip' },
      sleepy: { name: 'Sleepy', use: 'Something slow, or a chapter still being written' },
      angry: { name: 'Angry', use: 'Settings or data could be lost' },
      sparkle: { name: 'Sparkly eyes', use: 'Something important' },
      dizzy: { name: 'Dizzy', use: 'Things are not working' },
    },
    faceAlt: (name) => `The guide’s face: ${name}`,
    legendTitle: 'Reading the callouts',
    legendIntro: 'Boxed notes in the chapters come in six kinds.',
    callouts: {
      note: { name: 'Note', text: 'A little more detail. Safe to skip.' },
      tip: { name: 'Tip', text: 'Something that saves you a step.' },
      important: { name: 'Important', text: 'Read this before you carry on.' },
      caution: { name: 'Caution', text: 'People often get this wrong. Compare with your screen.' },
      warning: { name: 'Warning', text: 'You could lose settings or data, sometimes for good.' },
      trouble: { name: 'If it doesn’t work', text: 'What to check when things go wrong.' },
    },
  },
  system: {
    title: 'System requirements',
    intro: ['What your PC needs depends on the features you use.', 'Text translation and captions run fine without a GPU.'],
    rows: [
      { os: 'Windows', text: ['Tested on 64-bit Windows 11. Windows 10 has not been tested.', 'Needs the WebView2 Runtime. The installer fetches it if it is missing.'] },
      { os: 'Linux', text: ['An x86-64 PC with glibc 2.39 or later, GTK 3 and WebKitGTK 4.1.', 'The packages install on Ubuntu 24.04, Debian 13 and Fedora 44.'] },
      { os: 'macOS', text: ['There is no macOS build.'] },
    ],
    gpu: ['Text to speech and speech recognition run faster on any Vulkan-capable GPU, integrated ones included.', 'Voice changing (RVC) on the GPU needs an NVIDIA card with driver 580 or later.'],
    details: 'Full system requirements',
  },
  support: {
    title: 'Support',
    intro: 'If something goes wrong, start with the “When something goes wrong” chapter.',
    links: {
      help: { name: 'When something goes wrong', text: 'Common snags and what to check first' },
      issues: { name: 'Report a bug', text: 'Open an issue on GitHub' },
      releases: { name: 'Release notes', text: 'What changed in each version' },
      privacy: { name: 'Privacy', text: 'What is sent and what never leaves your PC' },
    },
  },
  chapter: {
    back: 'Back to contents',
    pending: ['This chapter is still being written.', 'Until it is ready, these guide pages cover the same ground.'],
    guide: ['This chapter is still being written.', 'For now, the guide pages below cover the same ground.'],
    related: 'Related guide pages',
    prev: 'Previous chapter',
    next: 'Next chapter',
  },
  footer: {
    unofficial: 'ASTAROT (VRCT-VOX) is an unofficial derivative of VRCT. It is not affiliated with VRChat Inc.',
    license: 'MIT License. The original VRCT copyright notice is retained.',
    guide: 'Previous guide',
  },
}

/** @type {Record<Locale, typeof ja>} */
export const WORDS = { ja, en }
