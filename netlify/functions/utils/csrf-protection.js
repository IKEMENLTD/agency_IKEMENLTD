/**
 * CSRF保護ユーティリティ
 * Netlify Functions用のCSRF対策実装
 */

/**
 * 許可されたオリジンのリスト
 * 本番環境では環境変数から読み込むことを推奨
 */
const getAllowedOrigins = () => {
    const allowedOrigins = [
        process.env.SITE_URL,
        process.env.URL,
        'http://localhost:8888',
        'http://localhost:3000',
        'http://127.0.0.1:8888',
        'http://127.0.0.1:3000'
    ].filter(Boolean); // undefined/nullを除外

    // Netlifyのプレビュー環境のドメインパターンも許可
    return allowedOrigins;
};

/**
 * オリジンが許可されているか検証
 * @param {string} origin - リクエストのOriginヘッダー
 * @returns {boolean}
 */
const isOriginAllowed = (origin) => {
    if (!origin) return false;

    const allowedOrigins = getAllowedOrigins();

    // 完全一致チェック
    if (allowedOrigins.includes(origin)) {
        return true;
    }

    // Netlifyのプレビュー環境パターン（*.netlify.app）
    if (origin.endsWith('.netlify.app')) {
        return true;
    }

    // 本番ドメインパターン（必要に応じて追加）
    // if (origin.endsWith('.yourdomain.com')) {
    //     return true;
    // }

    return false;
};

/**
 * RefererヘッダーからOriginを抽出
 * @param {string} referer - RefererヘッダーURL
 * @returns {string|null}
 */
const extractOriginFromReferer = (referer) => {
    if (!referer) return null;

    try {
        const url = new URL(referer);
        return url.origin;
    } catch (error) {
        console.error('Invalid referer URL:', error);
        return null;
    }
};

/**
 * CSRF保護検証
 * @param {Object} event - Netlify Function eventオブジェクト
 * @param {Object} options - オプション設定
 * @returns {Object} { valid: boolean, error: string|null }
 */
const validateCsrfProtection = (event, options = {}) => {
    const {
        requireCustomHeader = false,
        customHeaderName = 'X-Requested-With',
        customHeaderValue = 'XMLHttpRequest'
    } = options;

    // GETリクエストやOPTIONSリクエストはスキップ
    if (event.httpMethod === 'GET' || event.httpMethod === 'OPTIONS') {
        return { valid: true, error: null };
    }

    // 1. Originヘッダーのチェック
    const origin = event.headers.origin || event.headers.Origin;
    if (origin) {
        if (!isOriginAllowed(origin)) {
            console.error('CSRF: Unauthorized origin:', origin);
            return {
                valid: false,
                error: 'Unauthorized origin. Request blocked for security.'
            };
        }
    } else {
        // Originがない場合、Refererをチェック
        const referer = event.headers.referer || event.headers.Referer;
        if (referer) {
            const refererOrigin = extractOriginFromReferer(referer);
            if (!refererOrigin || !isOriginAllowed(refererOrigin)) {
                console.error('CSRF: Unauthorized referer:', referer);
                return {
                    valid: false,
                    error: 'Unauthorized referer. Request blocked for security.'
                };
            }
        } else {
            // OriginもRefererもない場合は疑わしい
            console.warn('CSRF: No origin or referer header present');
            // Webhook等の正当なケースもあるため、警告のみ
            // 必要に応じてここでエラーを返すことも可能
        }
    }

    // 2. カスタムヘッダーのチェック（オプション）
    if (requireCustomHeader) {
        const customHeader = event.headers[customHeaderName.toLowerCase()];
        if (customHeader !== customHeaderValue) {
            console.error('CSRF: Missing or invalid custom header:', customHeaderName);
            return {
                valid: false,
                error: 'Missing required security header. Request blocked.'
            };
        }
    }

    return { valid: true, error: null };
};

/**
 * CSRF保護エラーレスポンスを生成
 * @param {string} errorMessage - エラーメッセージ
 * @returns {Object} Netlify Function response
 */
const createCsrfErrorResponse = (errorMessage) => {
    return {
        statusCode: 403,
        headers: {
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff'
        },
        body: JSON.stringify({
            error: errorMessage || 'CSRF validation failed'
        })
    };
};

/**
 * セキュアなCookieオプションを取得
 * @returns {string} Set-Cookie属性文字列
 */
const getSecureCookieOptions = () => {
    const isProduction = process.env.NODE_ENV === 'production';

    const options = [
        'HttpOnly',
        'SameSite=Strict',
        'Path=/',
        'Max-Age=604800' // 7日間
    ];

    // 本番環境ではSecure属性を追加（HTTPS必須）
    if (isProduction) {
        options.push('Secure');
    }

    return options.join('; ');
};

module.exports = {
    validateCsrfProtection,
    createCsrfErrorResponse,
    isOriginAllowed,
    getAllowedOrigins,
    getSecureCookieOptions
};
