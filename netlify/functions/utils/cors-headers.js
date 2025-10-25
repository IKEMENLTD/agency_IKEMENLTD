/**
 * CORSヘッダーユーティリティ（セキュア版）
 * 特定のドメインのみからのアクセスを許可
 */

/**
 * 許可するオリジンのリスト
 * 環境変数から読み込み、フォールバックでハードコードされた値を使用
 */
const getAllowedOrigins = () => {
    // 環境変数から許可オリジンを取得
    const envOrigins = process.env.ALLOWED_ORIGINS;
    if (envOrigins) {
        return envOrigins.split(',').map(origin => origin.trim());
    }

    // フォールバック: デフォルトの許可オリジン
    return [
        'https://ikemenltd.netlify.app',
        'https://agency.ikemen.ltd',
        'https://taskmateai.net',
        'https://liteweb.plus'
    ];
};

/**
 * 開発環境の判定
 */
const isDevelopment = () => {
    return process.env.NODE_ENV === 'development' ||
           process.env.NETLIFY_DEV === 'true';
};

/**
 * リクエストのオリジンが許可されているかチェック
 * @param {string} origin - リクエストのOriginヘッダー
 * @returns {boolean} 許可されている場合true
 */
function isOriginAllowed(origin) {
    if (!origin) {
        return false;
    }

    const allowedOrigins = getAllowedOrigins();

    // 開発環境では localhost を許可
    if (isDevelopment()) {
        if (origin.startsWith('http://localhost:') ||
            origin.startsWith('http://127.0.0.1:') ||
            origin.startsWith('http://192.168.')) {
            return true;
        }
    }

    return allowedOrigins.includes(origin);
}

/**
 * セキュアなCORSヘッダーを生成
 * @param {Object} event - Netlify Function eventオブジェクト
 * @param {Object} additionalHeaders - 追加のヘッダー（オプション）
 * @returns {Object} CORSヘッダーを含むヘッダーオブジェクト
 */
function getCorsHeaders(event, additionalHeaders = {}) {
    const origin = event.headers.origin || event.headers.Origin || '';
    const allowedOrigins = getAllowedOrigins();

    // デフォルトのセキュリティヘッダー
    const headers = {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        ...additionalHeaders
    };

    // オリジンが許可リストに含まれている場合のみ、そのオリジンを許可
    if (isOriginAllowed(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Credentials'] = 'true';
        headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Agency-Id, X-Requested-With';
        headers['Access-Control-Max-Age'] = '86400'; // 24時間
        headers['Vary'] = 'Origin'; // キャッシュ対策
    } else {
        // オリジンが許可されていない場合
        // ヘッダーを設定しない（デフォルトでCORSエラーになる）
        // ログに記録（本番環境では）
        if (!isDevelopment()) {
            console.warn('🚫 Blocked CORS request from unauthorized origin:', origin);
            console.warn('   Allowed origins:', allowedOrigins.join(', '));
        }
    }

    return headers;
}

/**
 * OPTIONSリクエスト（プリフライト）用のレスポンスを生成
 * @param {Object} event - Netlify Function eventオブジェクト
 * @returns {Object} Netlify Function response
 */
function handleCorsPreflightRequest(event) {
    return {
        statusCode: 200,
        headers: getCorsHeaders(event),
        body: ''
    };
}

/**
 * CORS エラーレスポンスを生成
 * @param {string} message - エラーメッセージ
 * @returns {Object} Netlify Function response
 */
function createCorsErrorResponse(message = 'CORS policy: Origin not allowed') {
    return {
        statusCode: 403,
        headers: {
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff'
        },
        body: JSON.stringify({
            error: 'アクセスが拒否されました',
            details: isDevelopment() ? message : undefined
        })
    };
}

module.exports = {
    getAllowedOrigins,
    isOriginAllowed,
    getCorsHeaders,
    handleCorsPreflightRequest,
    createCorsErrorResponse,
    isDevelopment
};
