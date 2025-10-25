/**
 * エラーハンドリングユーティリティ
 * セキュリティ: 本番環境では詳細なエラーメッセージを隠蔽
 */

/**
 * 開発環境かどうかを判定
 */
function isDevelopment() {
    return process.env.NODE_ENV === 'development' ||
           process.env.NETLIFY_DEV === 'true';
}

/**
 * セキュアなエラーレスポンスを生成
 * 本番環境では詳細を隠し、開発環境では詳細を表示
 *
 * @param {Error|string} error - エラーオブジェクトまたはメッセージ
 * @param {string} userMessage - ユーザーに表示する一般的なメッセージ
 * @param {number} statusCode - HTTPステータスコード（デフォルト: 500）
 * @param {Object} headers - 追加のヘッダー
 * @returns {Object} Netlify Function response
 */
function createErrorResponse(error, userMessage = 'エラーが発生しました', statusCode = 500, headers = {}) {
    const defaultHeaders = {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        ...headers
    };

    // エラーログに記録（サーバーログ）
    if (error) {
        console.error('❌ Error:', error);
        if (error.stack && isDevelopment()) {
            console.error('Stack trace:', error.stack);
        }
    }

    // レスポンスボディ
    const responseBody = {
        error: userMessage
    };

    // 開発環境のみ詳細を追加
    if (isDevelopment()) {
        responseBody.details = error?.message || error || 'Unknown error';
        if (error?.code) {
            responseBody.errorCode = error.code;
        }
        if (error?.stack) {
            responseBody.stack = error.stack.split('\n').slice(0, 5); // 最初の5行のみ
        }
    }

    return {
        statusCode,
        headers: defaultHeaders,
        body: JSON.stringify(responseBody)
    };
}

/**
 * データベースエラー用のセキュアなレスポンス
 * @param {Object} error - Supabaseエラーオブジェクト
 * @param {string} userMessage - ユーザー向けメッセージ
 * @returns {Object} Netlify Function response
 */
function createDatabaseErrorResponse(error, userMessage = 'データベースエラーが発生しました') {
    // Supabaseエラーの場合、追加情報を記録
    if (error) {
        console.error('🗄️  Database Error Code:', error.code);
        console.error('🗄️  Database Error Message:', error.message);
        if (error.details) {
            console.error('🗄️  Database Error Details:', error.details);
        }
    }

    return createErrorResponse(error, userMessage, 500);
}

/**
 * 認証エラー用のセキュアなレスポンス
 * @param {string} userMessage - ユーザー向けメッセージ
 * @param {number} statusCode - HTTPステータスコード（デフォルト: 401）
 * @returns {Object} Netlify Function response
 */
function createAuthErrorResponse(userMessage = '認証エラー', statusCode = 401) {
    return createErrorResponse(null, userMessage, statusCode);
}

/**
 * バリデーションエラー用のセキュアなレスポンス
 * @param {string|Array} errors - エラーメッセージまたはエラー配列
 * @param {string} userMessage - ユーザー向けメッセージ
 * @returns {Object} Netlify Function response
 */
function createValidationErrorResponse(errors, userMessage = '入力内容に誤りがあります') {
    const responseBody = {
        error: userMessage
    };

    // 開発環境またはバリデーションエラーの場合は詳細を表示
    if (isDevelopment() || Array.isArray(errors)) {
        responseBody.validationErrors = Array.isArray(errors) ? errors : [errors];
    }

    return {
        statusCode: 400,
        headers: {
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff'
        },
        body: JSON.stringify(responseBody)
    };
}

/**
 * 一般的なエラーメッセージのマッピング
 * 詳細なエラーを一般的なメッセージに変換
 */
const ERROR_MESSAGES = {
    // 認証関連
    'Invalid credentials': 'メールアドレスまたはパスワードが間違っています',
    'User not found': 'メールアドレスまたはパスワードが間違っています',
    'Invalid token': 'セッションが無効です。再度ログインしてください',
    'Token expired': 'セッションが期限切れです。再度ログインしてください',

    // データベース関連
    'Duplicate entry': '既に登録されています',
    'Foreign key constraint': 'データの整合性エラーが発生しました',
    'Connection timeout': 'データベース接続がタイムアウトしました',

    // 一般
    'Network error': 'ネットワークエラーが発生しました',
    'Server error': 'サーバーエラーが発生しました',
    'default': 'エラーが発生しました。しばらくしてから再度お試しください'
};

/**
 * エラーメッセージを一般化
 * @param {string} errorMessage - 元のエラーメッセージ
 * @returns {string} 一般化されたエラーメッセージ
 */
function sanitizeErrorMessage(errorMessage) {
    if (!errorMessage) {
        return ERROR_MESSAGES.default;
    }

    // エラーメッセージのマッピングをチェック
    for (const [key, value] of Object.entries(ERROR_MESSAGES)) {
        if (errorMessage.toLowerCase().includes(key.toLowerCase())) {
            return value;
        }
    }

    // マッピングが見つからない場合はデフォルト
    return ERROR_MESSAGES.default;
}

module.exports = {
    isDevelopment,
    createErrorResponse,
    createDatabaseErrorResponse,
    createAuthErrorResponse,
    createValidationErrorResponse,
    sanitizeErrorMessage,
    ERROR_MESSAGES
};
