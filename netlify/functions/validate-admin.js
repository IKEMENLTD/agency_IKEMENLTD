const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const { applyRateLimit, STRICT_RATE_LIMIT } = require('./utils/rate-limiter');
const { createErrorResponse, createAuthErrorResponse } = require('./utils/error-handler');

exports.handler = async (event, context) => {
    // セキュアなCORSヘッダー
    const headers = getCorsHeaders(event);

    // プリフライトリクエスト処理
    if (event.httpMethod === 'OPTIONS') {
        return handleCorsPreflightRequest(event);
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // レート制限チェック（ブルートフォース攻撃対策）
    const rateLimitResponse = applyRateLimit(event, STRICT_RATE_LIMIT);
    if (rateLimitResponse) {
        return rateLimitResponse;
    }

    try {
        const { username, password } = JSON.parse(event.body);

        // 入力バリデーション
        if (!username || !password) {
            return createAuthErrorResponse('ユーザー名とパスワードを入力してください', 400);
        }

        // セキュリティ: 環境変数が正しく設定されているかチェック
        const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
        const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

        // 環境変数が未設定の場合はエラー
        if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) {
            console.error('❌ CRITICAL: ADMIN_USERNAME or ADMIN_PASSWORD_HASH not configured');
            return createErrorResponse(
                new Error('Server configuration error'),
                'サーバー設定エラーが発生しました。管理者にお問い合わせください。',
                500,
                headers
            );
        }

        // 古い形式（平文パスワード）が設定されていないかチェック
        if (process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_HASH) {
            console.error('⚠️  SECURITY WARNING: ADMIN_PASSWORD (plaintext) is set. Use ADMIN_PASSWORD_HASH instead.');
        }

        // ユーザー名チェック
        if (username !== ADMIN_USERNAME) {
            // タイミング攻撃対策: パスワードチェックも実行（時間を一定に）
            await bcrypt.compare('dummy', ADMIN_PASSWORD_HASH).catch(() => {});
            return createAuthErrorResponse('ユーザー名またはパスワードが間違っています', 401);
        }

        // パスワードチェック（bcrypt）
        const validPassword = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);

        if (!validPassword) {
            console.warn('⚠️  Failed admin login attempt for username:', username);
            return createAuthErrorResponse('ユーザー名またはパスワードが間違っています', 401);
        }

        // JWT秘密鍵チェック
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret || jwtSecret === 'your-jwt-secret') {
            console.error('❌ CRITICAL: JWT_SECRET is not properly configured');
            return createErrorResponse(
                new Error('JWT_SECRET not configured'),
                'サーバー設定エラーが発生しました',
                500,
                headers
            );
        }

        // JWT トークン生成
        const token = jwt.sign(
            {
                username: ADMIN_USERNAME,
                role: 'admin',
                type: 'admin_session'
            },
            jwtSecret,
            { expiresIn: '4h' }  // 管理画面は4時間
        );

        console.log('✅ Admin login successful for username:', username);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                token,
                expiresIn: '4h'
            })
        };
    } catch (error) {
        console.error('❌ Admin authentication error:', error);
        return createErrorResponse(error, 'サーバーエラーが発生しました', 500, headers);
    }
};