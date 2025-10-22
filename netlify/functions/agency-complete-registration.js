const { createClient } = require('@supabase/supabase-js');
const { Client } = require('@line/bot-sdk');
const { validateCsrfProtection, createCsrfErrorResponse } = require('./utils/csrf-protection');
const { applyRateLimit, STRICT_RATE_LIMIT } = require('./utils/rate-limiter');
const logger = require('./utils/logger');

// Check environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.error('Missing required environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

if (!process.env.LINE_LOGIN_CHANNEL_ID || !process.env.LINE_LOGIN_CHANNEL_SECRET) {
    logger.error('Missing required LINE environment variables: LINE_LOGIN_CHANNEL_ID or LINE_LOGIN_CHANNEL_SECRET');
}

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Exchange LINE authorization code for access token
async function getLineAccessToken(code, redirectUri) {
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: process.env.LINE_LOGIN_CHANNEL_ID,
        client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET
    });

    const response = await fetch('https://api.line.me/oauth2/v2.1/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    });

    if (!response.ok) {
        const errorText = await response.text();
        logger.error('LINE token exchange failed:', errorText);
        throw new Error('Failed to get LINE access token');
    }

    return await response.json();
}

// Get LINE user profile
async function getLineProfile(accessToken) {
    const response = await fetch('https://api.line.me/v2/profile', {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        logger.error('LINE profile fetch failed:', errorText);
        throw new Error('Failed to get LINE profile');
    }

    return await response.json();
}

exports.handler = async (event) => {
    // Strict CORS configuration
    const ALLOWED_ORIGINS = [
        'https://taskmateai.net',
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

    // Rate limiting (防止DoS攻撃)
    logger.log('=== LINE連携完了処理開始 ===');
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

        // Check if environment variables are configured
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'サービスが一時的に利用できません。しばらくしてから再度お試しください。'
                })
            };
        }

        if (!process.env.LINE_LOGIN_CHANNEL_ID || !process.env.LINE_LOGIN_CHANNEL_SECRET) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'LINE連携の設定が完了していません。管理者にお問い合わせください。'
                })
            };
        }

        const {
            code,
            registration_token,
            redirect_uri
        } = JSON.parse(event.body);

        logger.log('受信したデータ:');
        logger.log('- LINEコード:', code ? 'あり' : 'なし');
        logger.log('- 登録トークン:', registration_token ? registration_token.substring(0, 8) + '...' : 'なし');
        logger.log('- リダイレクトURI:', redirect_uri);

        // Validate required fields
        if (!code || !registration_token || !redirect_uri) {
            logger.error('❌ 必須パラメータが不足しています');
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: '必須パラメータが不足しています'
                })
            };
        }

        // Validate redirect_uri (防止Open Redirect攻撃)
        const ALLOWED_CALLBACK_URLS = [
            'https://taskmateai.net/agency/',
            'http://localhost:3000/agency/',
            'http://localhost:8888/agency/',
            process.env.LINE_LOGIN_CALLBACK_URL
        ].filter(Boolean);

        const isValidRedirectUri = ALLOWED_CALLBACK_URLS.some(allowedUrl => {
            return redirect_uri === allowedUrl || redirect_uri.startsWith(allowedUrl);
        });

        if (!isValidRedirectUri) {
            logger.error('❌ 不正なリダイレクトURI:', redirect_uri);
            logger.error('許可されたURL:', ALLOWED_CALLBACK_URLS);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: '不正なリダイレクトURIです'
                })
            };
        }
        logger.log('✅ リダイレクトURI検証通過');

        // Find agency by registration token
        logger.log('=== STEP 1: 登録トークン検証 ===');
        const { data: agency, error: agencyError } = await supabase
            .from('agencies')
            .select('id, code, name, status, registration_token, line_user_id, registration_token_expires_at')
            .eq('registration_token', registration_token)
            .eq('status', 'pending_line_verification')
            .single();

        if (agencyError || !agency) {
            logger.error('❌ 登録トークンが無効です');
            logger.error('- トークン:', registration_token.substring(0, 8) + '...');
            logger.error('- Supabaseエラー:', agencyError);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: '登録トークンが無効です。最初から登録をやり直してください。'
                })
            };
        }

        logger.log('✅ 代理店レコード発見');
        logger.log('- 代理店ID:', agency.id);
        logger.log('- 代理店名:', agency.name);

        // Check if LINE verification is already completed (防止Code Replay攻撃)
        if (agency.line_user_id) {
            logger.error('❌ この代理店は既にLINE連携済みです');
            logger.error('- LINE User ID:', agency.line_user_id.substring(0, 8) + '...');
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

        // Exchange LINE code for access token
        logger.log('=== STEP 2: LINEアクセストークン取得 ===');
        const tokenData = await getLineAccessToken(code, redirect_uri);
        logger.log('✅ アクセストークン取得成功');

        // Get LINE user profile
        logger.log('=== STEP 3: LINEプロフィール取得 ===');
        const profile = await getLineProfile(tokenData.access_token);
        logger.log('✅ LINEプロフィール取得成功');
        logger.log('- LINE User ID:', profile.userId);
        logger.log('- 表示名:', profile.displayName);

        // Check if LINE user ID is already registered
        logger.log('=== STEP 4: LINE ID重複チェック ===');
        const { data: existingAgency } = await supabase
            .from('agencies')
            .select('id')
            .eq('line_user_id', profile.userId)
            .neq('id', agency.id)
            .single();

        if (existingAgency) {
            logger.error('❌ このLINEアカウントは既に使用されています');
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'このLINEアカウントは既に他の代理店で使用されています。'
                })
            };
        }
        logger.log('✅ LINE ID使用可能');

        // Update agency with LINE information (友達追加待ち状態)
        logger.log('=== STEP 5: 代理店レコード更新 ===');
        const { error: updateError } = await supabase
            .from('agencies')
            .update({
                line_user_id: profile.userId,
                line_display_name: profile.displayName,
                line_picture_url: profile.pictureUrl,
                status: 'pending_friend_add', // 友達追加待ち状態
                registration_token: null, // Clear token after use
                registration_token_expires_at: null
            })
            .eq('id', agency.id);

        if (updateError) {
            logger.error('❌ 代理店レコード更新エラー:', updateError);
            throw updateError;
        }
        logger.log('✅ 代理店レコード更新成功（ステータス: pending_friend_add）');

        // ユーザーアクティベーションは友達追加後に行う（webhookで処理）
        logger.log('=== STEP 6: ユーザーアクティベーションスキップ ===');
        logger.log('友達追加完了後にwebhookで自動的にアクティベーションされます');

        // 友達追加URL取得（環境変数から）
        logger.log('=== STEP 7: 友達追加URL準備 ===');
        const lineOfficialUrl = process.env.LINE_OFFICIAL_URL;

        // 環境変数が設定されていない場合はエラーを返す（無効なURLを返さない）
        if (!lineOfficialUrl || lineOfficialUrl.includes('@xxx') || lineOfficialUrl.includes('@your-line-id')) {
            logger.error('❌ LINE_OFFICIAL_URLが正しく設定されていません');
            logger.error('現在の値:', lineOfficialUrl || '(空)');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'LINE友達追加機能の設定が完了していません。管理者にお問い合わせください。',
                    admin_message: 'LINE_OFFICIAL_URL環境変数を設定してください'
                })
            };
        }

        logger.log('LINE公式アカウントURL:', lineOfficialUrl);

        logger.log('=== ✅✅✅ LINE Login完了（友達追加待ち） ✅✅✅ ===');
        logger.log('代理店コード:', agency.code);
        logger.log('代理店ID:', agency.id);
        logger.log('LINE User ID:', profile.userId.substring(0, 8) + '...');
        logger.log('次のステップ: 友達追加URLにリダイレクト');

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'LINE Login完了',
                requires_friend_add: true, // 友達追加が必要
                line_official_url: lineOfficialUrl, // 友達追加URL
                agency: {
                    code: agency.code,
                    name: agency.name
                },
                line_user_name: profile.displayName
            })
        };

    } catch (error) {
        logger.error('=== ❌❌❌ LINE連携完了処理でエラーが発生 ❌❌❌ ===');
        logger.error('エラータイプ:', error.name);
        logger.error('エラーメッセージ:', error.message);
        logger.error('エラー詳細:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });

        // Security: Never expose detailed error information in production
        const errorMessage = 'LINE連携処理を完了できませんでした。しばらくしてから再度お試しください。';

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: errorMessage
                // 本番環境では絶対にdetailsを含めない
            })
        };
    }
};
