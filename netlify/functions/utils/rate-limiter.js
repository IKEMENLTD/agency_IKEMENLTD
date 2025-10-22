/**
 * シンプルなメモリベースのレート制限ユーティリティ
 *
 * 注意: Netlify Functionsはサーバーレスのため、各リクエストが
 * 異なるインスタンスで実行される可能性があります。
 * より堅牢なレート制限には、Upstash Redis等の外部ストレージを推奨します。
 *
 * 本実装は基本的な保護を提供しますが、完全な防御には不十分です。
 */

const logger = require('./logger');

// メモリベースのレート制限ストア
const rateLimitStore = new Map();

// クリーンアップ間隔（5分）
const CLEANUP_INTERVAL = 5 * 60 * 1000;

// 定期的なクリーンアップ
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of rateLimitStore.entries()) {
        if (now > data.resetTime) {
            rateLimitStore.delete(key);
        }
    }
}, CLEANUP_INTERVAL);

/**
 * IPアドレスを取得
 * @param {Object} event - Netlify Function event
 * @returns {string} IPアドレス
 */
function getClientIp(event) {
    // Netlifyのヘッダーから取得
    return event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           event.headers['x-nf-client-connection-ip'] ||
           event.headers['client-ip'] ||
           'unknown';
}

/**
 * レート制限をチェック
 * @param {string} identifier - 識別子（通常はIPアドレス）
 * @param {Object} options - オプション
 * @param {number} options.maxRequests - 期間内の最大リクエスト数
 * @param {number} options.windowMs - 時間枠（ミリ秒）
 * @returns {Object} { allowed: boolean, remaining: number, resetTime: number, retryAfter: number }
 */
function checkRateLimit(identifier, options = {}) {
    const {
        maxRequests = 5,      // デフォルト: 5回
        windowMs = 60 * 1000  // デフォルト: 60秒
    } = options;

    const now = Date.now();
    const limitData = rateLimitStore.get(identifier);

    // 初回リクエストまたはウィンドウ期限切れ
    if (!limitData || now > limitData.resetTime) {
        const newData = {
            count: 1,
            resetTime: now + windowMs,
            firstRequest: now
        };
        rateLimitStore.set(identifier, newData);

        return {
            allowed: true,
            remaining: maxRequests - 1,
            resetTime: newData.resetTime,
            retryAfter: 0
        };
    }

    // カウントを増やす
    limitData.count++;
    rateLimitStore.set(identifier, limitData);

    const remaining = Math.max(0, maxRequests - limitData.count);
    const retryAfter = Math.ceil((limitData.resetTime - now) / 1000);

    return {
        allowed: limitData.count <= maxRequests,
        remaining,
        resetTime: limitData.resetTime,
        retryAfter
    };
}

/**
 * レート制限をリセット（テスト用）
 * @param {string} identifier - 識別子
 */
function resetRateLimit(identifier) {
    rateLimitStore.delete(identifier);
}

/**
 * レート制限エラーレスポンスを生成
 * @param {number} retryAfter - リトライまでの秒数
 * @returns {Object} Netlify Function response
 */
function createRateLimitResponse(retryAfter) {
    return {
        statusCode: 429,
        headers: {
            'Content-Type': 'application/json',
            'Retry-After': retryAfter.toString(),
            'X-RateLimit-Limit': '5',
            'X-RateLimit-Remaining': '0',
            'X-Content-Type-Options': 'nosniff'
        },
        body: JSON.stringify({
            error: 'レート制限を超過しました',
            message: `${retryAfter}秒後に再試行してください`,
            retryAfter
        })
    };
}

/**
 * Netlify Functionにレート制限を適用（ミドルウェア風）
 * @param {Object} event - Netlify Function event
 * @param {Object} options - レート制限オプション
 * @returns {Object|null} レート制限エラーレスポンス、または null（許可）
 */
function applyRateLimit(event, options = {}) {
    const ip = getClientIp(event);
    const endpoint = event.path || 'unknown';
    const identifier = `${ip}:${endpoint}`;

    const result = checkRateLimit(identifier, options);

    if (!result.allowed) {
        logger.warn(`Rate limit exceeded for ${ip} on ${endpoint}`);
        return createRateLimitResponse(result.retryAfter);
    }

    return null; // 許可
}

/**
 * 厳格なレート制限設定（ログイン、パスワードリセットなど）
 */
const STRICT_RATE_LIMIT = {
    maxRequests: 5,     // 5回まで
    windowMs: 15 * 60 * 1000  // 15分
};

/**
 * 通常のレート制限設定（API呼び出しなど）
 */
const NORMAL_RATE_LIMIT = {
    maxRequests: 60,    // 60回まで
    windowMs: 60 * 1000  // 1分
};

/**
 * 緩いレート制限設定（公開エンドポイントなど）
 */
const RELAXED_RATE_LIMIT = {
    maxRequests: 100,   // 100回まで
    windowMs: 60 * 1000  // 1分
};

module.exports = {
    getClientIp,
    checkRateLimit,
    resetRateLimit,
    createRateLimitResponse,
    applyRateLimit,
    STRICT_RATE_LIMIT,
    NORMAL_RATE_LIMIT,
    RELAXED_RATE_LIMIT
};
