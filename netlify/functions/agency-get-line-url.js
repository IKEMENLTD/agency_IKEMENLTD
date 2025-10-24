const { createClient } = require('@supabase/supabase-js');
const { generateLineLoginUrl, generateState } = require('./utils/line-client');
const { validateCsrfProtection, createCsrfErrorResponse } = require('./utils/csrf-protection');
const { applyRateLimit, STRICT_RATE_LIMIT } = require('./utils/rate-limiter');
const logger = require('./utils/logger');

// Supabase client for token validation
const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

exports.handler = async (event) => {
    // Strict CORS configuration
    const ALLOWED_ORIGINS = [
        'https://agency.ikemen.ltd',
        'http://localhost:3000',
        'http://localhost:8888'  // Netlify Dev
    ];

    const origin = event.headers.origin || event.headers.Origin || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const headers = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
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

    // Rate limiting
    logger.log('=== LINE Login URL生成リクエスト ===');
    logger.log('IPアドレス:', event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown');

    const rateLimitResponse = applyRateLimit(event, STRICT_RATE_LIMIT);
    if (rateLimitResponse) {
        logger.error('❌ レート制限により拒否されました');
        return { ...rateLimitResponse, headers };
    }
    logger.log('✅ レート制限チェック通過');

    // CSRF protection
    const csrfValidation = validateCsrfProtection(event);
    if (!csrfValidation.valid) {
        logger.error('❌ CSRF検証失敗:', csrfValidation.error);
        logger.error('Origin:', event.headers.origin);
        logger.error('Referer:', event.headers.referer);
        const csrfError = createCsrfErrorResponse(csrfValidation.error);
        return { ...csrfError, headers };
    }
    logger.log('✅ CSRF保護チェック通過');

    try {

        const { registration_token } = JSON.parse(event.body);

        if (!registration_token) {
            logger.error('❌ registration_tokenが指定されていません');
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: '登録トークンが必要です'
                })
            };
        }

        logger.log('- 登録トークン:', registration_token.substring(0, 8) + '...');

        // Validate registration_token in database
        logger.log('=== 登録トークン検証 ===');
        const { data: agency, error: agencyError } = await supabase
            .from('agencies')
            .select('id, status, line_user_id, registration_token_expires_at')
            .eq('registration_token', registration_token)
            .eq('status', 'pending_line_verification')
            .single();

        if (agencyError || !agency) {
            logger.error('❌ 無効な登録トークンです');
            logger.error('- トークン:', registration_token.substring(0, 8) + '...');
            logger.error('- Supabaseエラー:', agencyError);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: '無効な登録トークンです。最初から登録をやり直してください。'
                })
            };
        }

        logger.log('✅ 有効な登録トークンを確認');

        // Check if LINE verification is already completed
        if (agency.line_user_id) {
            logger.error('❌ この代理店は既にLINE連携済みです');
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'この代理店は既にLINE連携済みです'
                })
            };
        }

        // Check token expiration (if registration_token_expires_at exists)
        if (agency.registration_token_expires_at) {
            const expiresAt = new Date(agency.registration_token_expires_at);
            const now = new Date();
            if (expiresAt < now) {
                logger.error('❌ 登録トークンの有効期限が切れています');
                logger.error('- 有効期限:', expiresAt.toISOString());
                logger.error('- 現在時刻:', now.toISOString());
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: '登録トークンの有効期限が切れています。最初から登録をやり直してください。'
                    })
                };
            }
            logger.log('✅ トークン有効期限チェック通過');
        }

        // Generate state parameter (include registration token for callback)
        const state = generateState();

        // Get callback URL from environment
        const callbackUrl = process.env.LINE_LOGIN_CALLBACK_URL || 'https://agency.ikemen.ltd/';

        logger.log('- コールバックURL:', callbackUrl);
        logger.log('- State:', state);

        // Generate LINE Login URL
        const lineLoginUrl = generateLineLoginUrl(callbackUrl, state);

        logger.log('✅ LINE Login URL生成成功');

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                line_login_url: lineLoginUrl,
                state: state,
                registration_token: registration_token
            })
        };

    } catch (error) {
        logger.error('=== ❌ LINE Login URL生成エラー ===');
        logger.error('エラーメッセージ:', error.message);
        logger.error('エラー詳細:', error.stack);

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'LINE Login URLの生成に失敗しました。しばらくしてから再度お試しください。'
                // 本番環境では絶対にdetailsを含めない
            })
        };
    }
};
