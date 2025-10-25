const { createClient } = require('@supabase/supabase-js');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const bcrypt = require('bcryptjs');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const crypto = require('crypto');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const { validateCsrfProtection, createCsrfErrorResponse } = require('./utils/csrf-protection');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const { applyRateLimit, STRICT_RATE_LIMIT } = require('./utils/rate-limiter');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const logger = require('./utils/logger');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    const headers = getCorsHeaders(event, {
        // Secure CORS - see getCorsHeaders(),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // レート制限チェック（パスワードリセット確認のスパム対策）
    logger.log('=== パスワードリセット確認受信 ===');
    logger.log('IPアドレス:', event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown');

    const rateLimitResponse = applyRateLimit(event, STRICT_RATE_LIMIT);
    if (rateLimitResponse) {
        logger.error('❌ レート制限により拒否されました');
        return rateLimitResponse;
    }
    logger.log('✅ レート制限チェック通過');

    // CSRF保護チェック
    const csrfValidation = validateCsrfProtection(event);
    if (!csrfValidation.valid) {
        logger.error('❌ CSRF検証失敗:', csrfValidation.error);
        return createCsrfErrorResponse(csrfValidation.error);
    }
    logger.log('✅ CSRF保護チェック通過');

    try {
        const { token, password } = JSON.parse(event.body);

        if (!token || !password) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'トークンとパスワードが必要です'
                })
            };
        }

        if (password.length < 8) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'パスワードは8文字以上で入力してください'
                })
            };
        }

        // トークンをハッシュ化
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        // トークンを確認
        const { data: resetToken, error: tokenError } = await supabase
            .from('password_reset_tokens')
            .select('*, agency_users!inner(*)')
            .eq('token', hashedToken)
            .eq('used', false)
            .gt('expires_at', new Date().toISOString())
            .single();

        if (tokenError || !resetToken) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: '無効または期限切れのトークンです'
                })
            };
        }

        // 新しいパスワードをハッシュ化
        const hashedPassword = await bcrypt.hash(password, 10);

        // パスワードを更新
        const { error: updateError } = await supabase
            .from('agency_users')
            .update({
                password_hash: hashedPassword,
                updated_at: new Date().toISOString()
            })
            .eq('id', resetToken.agency_user_id);

        if (updateError) {
            console.error('Password update error:', updateError);
            throw updateError;
        }

        // トークンを使用済みにする
        await supabase
            .from('password_reset_tokens')
            .update({
                used: true,
                used_at: new Date().toISOString()
            })
            .eq('id', resetToken.id);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'パスワードを変更しました'
            })
        };

    } catch (error) {
        console.error('Password reset confirm error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'パスワード変更処理中にエラーが発生しました'
            })
        };
    }
};