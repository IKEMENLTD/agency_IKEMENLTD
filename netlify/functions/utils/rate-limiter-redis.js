/**
 * Redisベースのレート制限ユーティリティ
 *
 * Upstash Redisを使用してサーバーレス環境でも正確なレート制限を実現
 *
 * 環境変数:
 * - UPSTASH_REDIS_REST_URL: Upstash RedisのREST API URL
 * - UPSTASH_REDIS_REST_TOKEN: Upstash Redisの認証トークン
 *
 * Upstash Redis無料プラン:
 * - 10,000 commands/day
 * - 256MB storage
 * - セットアップ: https://console.upstash.com/
 */

const logger = require('./logger');

// Redis REST APIクライアント（@upstash/redis不要、fetch APIで実装）
class RedisClient {
    constructor(url, token) {
        this.url = url;
        this.token = token;
    }

    async execute(command, ...args) {
        try {
            const response = await fetch(`${this.url}/${command}/${args.join('/')}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (!response.ok) {
                throw new Error(`Redis error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.result;
        } catch (error) {
            logger.error('Redis command failed:', error);
            throw error;
        }
    }

    async get(key) {
        return await this.execute('GET', key);
    }

    async set(key, value, options = {}) {
        const args = [key, value];
        if (options.ex) {
            args.push('EX', options.ex);
        }
        return await this.execute('SET', ...args);
    }

    async incr(key) {
        return await this.execute('INCR', key);
    }

    async expire(key, seconds) {
        return await this.execute('EXPIRE', key, seconds);
    }

    async ttl(key) {
        return await this.execute('TTL', key);
    }

    async del(key) {
        return await this.execute('DEL', key);
    }
}

// Redisクライアントインスタンス
let redisClient = null;

/**
 * Redisクライアントを取得（遅延初期化）
 * @returns {RedisClient|null}
 */
function getRedisClient() {
    if (redisClient) {
        return redisClient;
    }

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        logger.warn('⚠️  UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not configured');
        logger.warn('⚠️  Falling back to memory-based rate limiting (not recommended for production)');
        return null;
    }

    redisClient = new RedisClient(url, token);
    logger.log('✅ Redis client initialized');
    return redisClient;
}

/**
 * IPアドレスを取得
 * @param {Object} event - Netlify Function event
 * @returns {string} IPアドレス
 */
function getClientIp(event) {
    return event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           event.headers['x-nf-client-connection-ip'] ||
           event.headers['client-ip'] ||
           'unknown';
}

/**
 * Redisベースのレート制限チェック
 * @param {string} identifier - 識別子（IPアドレス:エンドポイント）
 * @param {Object} options - オプション
 * @param {number} options.maxRequests - 期間内の最大リクエスト数
 * @param {number} options.windowMs - 時間枠（ミリ秒）
 * @returns {Promise<Object>} { allowed: boolean, remaining: number, resetTime: number, retryAfter: number }
 */
async function checkRateLimitRedis(identifier, options = {}) {
    const {
        maxRequests = 5,
        windowMs = 60 * 1000
    } = options;

    const redis = getRedisClient();

    if (!redis) {
        // Redisが利用できない場合はメモリベースにフォールバック
        const memoryLimiter = require('./rate-limiter');
        return memoryLimiter.checkRateLimit(identifier, options);
    }

    try {
        const key = `rate_limit:${identifier}`;
        const windowSeconds = Math.ceil(windowMs / 1000);

        // カウントを取得
        let count = await redis.get(key);

        if (count === null) {
            // 初回リクエスト
            await redis.set(key, '1', { ex: windowSeconds });

            return {
                allowed: true,
                remaining: maxRequests - 1,
                resetTime: Date.now() + windowMs,
                retryAfter: 0
            };
        }

        count = parseInt(count, 10);

        // カウントを増やす
        const newCount = await redis.incr(key);

        // TTLを確認
        const ttl = await redis.ttl(key);
        const resetTime = Date.now() + (ttl * 1000);
        const retryAfter = ttl;

        const remaining = Math.max(0, maxRequests - newCount);
        const allowed = newCount <= maxRequests;

        if (!allowed) {
            logger.warn(`🚫 Rate limit exceeded: ${identifier} (${newCount}/${maxRequests})`);
        }

        return {
            allowed,
            remaining,
            resetTime,
            retryAfter
        };

    } catch (error) {
        logger.error('❌ Redis rate limit check failed:', error);

        // Redisエラー時はリクエストを許可（Fail Open）
        // セキュリティとUXのバランスを取る
        logger.warn('⚠️  Allowing request due to Redis error (fail-open)');
        return {
            allowed: true,
            remaining: 0,
            resetTime: Date.now() + windowMs,
            retryAfter: 0
        };
    }
}

/**
 * レート制限をリセット（テスト用）
 * @param {string} identifier - 識別子
 */
async function resetRateLimitRedis(identifier) {
    const redis = getRedisClient();

    if (!redis) {
        const memoryLimiter = require('./rate-limiter');
        return memoryLimiter.resetRateLimit(identifier);
    }

    const key = `rate_limit:${identifier}`;
    await redis.del(key);
}

/**
 * レート制限エラーレスポンスを生成
 * @param {number} retryAfter - リトライまでの秒数
 * @param {number} maxRequests - 最大リクエスト数
 * @returns {Object} Netlify Function response
 */
function createRateLimitResponse(retryAfter, maxRequests = 5) {
    return {
        statusCode: 429,
        headers: {
            'Content-Type': 'application/json',
            'Retry-After': retryAfter.toString(),
            'X-RateLimit-Limit': maxRequests.toString(),
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
 * @returns {Promise<Object|null>} レート制限エラーレスポンス、または null（許可）
 */
async function applyRateLimitRedis(event, options = {}) {
    const ip = getClientIp(event);
    const endpoint = event.path || 'unknown';
    const identifier = `${ip}:${endpoint}`;

    const result = await checkRateLimitRedis(identifier, options);

    if (!result.allowed) {
        logger.warn(`🚫 Rate limit exceeded for ${ip} on ${endpoint}`);
        return createRateLimitResponse(result.retryAfter, options.maxRequests);
    }

    // レート制限ヘッダーを追加（情報提供用）
    logger.log(`✅ Rate limit OK: ${ip} on ${endpoint} (${result.remaining} remaining)`);

    return null; // 許可
}

/**
 * 厳格なレート制限設定（ログイン、パスワードリセットなど）
 */
const STRICT_RATE_LIMIT = {
    maxRequests: 5,               // 5回まで
    windowMs: 15 * 60 * 1000      // 15分
};

/**
 * 通常のレート制限設定（API呼び出しなど）
 */
const NORMAL_RATE_LIMIT = {
    maxRequests: 60,              // 60回まで
    windowMs: 60 * 1000           // 1分
};

/**
 * 緩いレート制限設定（公開エンドポイントなど）
 */
const RELAXED_RATE_LIMIT = {
    maxRequests: 100,             // 100回まで
    windowMs: 60 * 1000           // 1分
};

module.exports = {
    getClientIp,
    checkRateLimit: checkRateLimitRedis,
    resetRateLimit: resetRateLimitRedis,
    createRateLimitResponse,
    applyRateLimit: applyRateLimitRedis,
    STRICT_RATE_LIMIT,
    NORMAL_RATE_LIMIT,
    RELAXED_RATE_LIMIT,
    getRedisClient  // テスト用にエクスポート
};
