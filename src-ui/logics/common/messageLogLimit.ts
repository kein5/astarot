// 画面に残す会話ログの件数。超えたら古いものからメモリと画面から消す。
// 「会話ログを自動的に保存する」がオンなら、消えた分もファイルには残っている
export const MESSAGE_LOG_LIMIT = 1000;

export const keepRecentLogs = <T>(rows: T[], limit = MESSAGE_LOG_LIMIT): T[] =>
    rows.length > limit ? rows.slice(rows.length - limit) : rows;
