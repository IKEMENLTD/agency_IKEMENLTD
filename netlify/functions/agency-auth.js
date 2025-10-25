const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const { validateCsrfProtection, createCsrfErrorResponse, getSecureCookieOptions } = require('./utils/csrf-protection');
const { applyRateLimit, STRICT_RATE_LIMIT } = require('./utils/rate-limiter');
const logger = require('./utils/logger');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'X-Content-Type-Options': 'nosniff'
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

    // レート制限チェック（ブルートフォース攻撃対策）
    const rateLimitResponse = applyRateLimit(event, STRICT_RATE_LIMIT);
    if (rateLimitResponse) {
        return rateLimitResponse;
    }

    // CSRF保護チェック（一時的に無効化 - テスト用）
    // TODO: テスト後に必ず有効化すること
    // const csrfValidation = validateCsrfProtection(event);
    // if (!csrfValidation.valid) {
    //     return createCsrfErrorResponse(csrfValidation.error);
    // }

    try {
        logger.log('=== 🔐 ログイン処理開始 ===');
        logger.log('IPアドレス:', event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown');
        logger.log('User-Agent:', event.headers['user-agent'] || 'unknown');

        const { email, password } = JSON.parse(event.body);

        logger.log('📧 入力されたメールアドレス:', email);
        logger.log('🔑 パスワード長:', password ? password.length : 0);

        if (!email || !password) {
            logger.error('❌ メールアドレスまたはパスワードが空です');
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'メールアドレスとパスワードを入力してください'
                })
            };
        }

        // Find agency user
        logger.log('=== STEP 1: ユーザー検索 ===');
        logger.log('検索メールアドレス:', email);

        const { data: user, error: userError } = await supabase
            .from('agency_users')
            .select(`
                id,
                email,
                password_hash,
                name,
                role,
                is_active,
                agency_id,
                agencies!inner (
                    id,
                    code,
                    name,
                    company_name,
                    contact_email,
                    contact_phone,
                    status,
                    level,
                    own_commission_rate,
                    parent_agency_id
                )
            `)
            .eq('email', email)
            .single();

        logger.log('=== STEP 2: データベース検索結果 ===');

        if (userError) {
            logger.error('❌ Supabaseエラー発生:');
            logger.error('- エラーコード:', userError.code);
            logger.error('- エラーメッセージ:', userError.message);
            logger.error('- エラー詳細:', JSON.stringify(userError, null, 2));
        }

        if (!user) {
            logger.error('❌ ユーザーが見つかりません');
            logger.error('- 検索メールアドレス:', email);
            logger.error('- データベース応答: null');
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({
                    error: 'メールアドレスまたはパスワードが間違っています'
                })
            };
        }

        logger.log('✅ ユーザー発見:');
        logger.log('- ユーザーID:', user.id);
        logger.log('- メールアドレス:', user.email);
        logger.log('- 名前:', user.name);
        logger.log('- 役割:', user.role);
        logger.log('- アクティブ:', user.is_active);
        logger.log('- 代理店ID:', user.agency_id);
        logger.log('- 代理店名:', user.agencies?.name);
        logger.log('- 代理店ステータス:', user.agencies?.status);
        logger.log('- パスワードハッシュ存在:', !!user.password_hash);

        // Verify password
        logger.log('=== STEP 3: パスワード検証 ===');
        logger.log('パスワードハッシュ比較中...');

        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (validPassword) {
            logger.log('✅ パスワード一致');
        } else {
            logger.error('❌ パスワード不一致');
            logger.error('- 入力パスワード長:', password.length);
            logger.error('- ハッシュ形式:', user.password_hash ? user.password_hash.substring(0, 10) + '...' : 'なし');
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({
                    error: 'メールアドレスまたはパスワードが間違っています'
                })
            };
        }

        // Check if user account is active
        logger.log('=== STEP 4: アクティブステータス確認 ===');
        logger.log('- ユーザーアクティブ:', user.is_active);
        logger.log('- 代理店ステータス:', user.agencies.status);

        if (!user.is_active) {
            logger.error('❌ ユーザーが非アクティブです');
            logger.error('- is_active:', user.is_active);
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({
                    error: 'このアカウントは無効化されています',
                    error_type: 'user_inactive',
                    message: 'アカウントが管理者により無効化されています。サポートにお問い合わせください。',
                    actions: [
                        {
                            type: 'contact_support',
                            label: 'サポートに問い合わせる',
                            url: 'https://ikemen.ltd/contact/',
                            email: 'info@ikemen.ltd'
                        }
                    ]
                })
            };
        }

        if (user.agencies.status !== 'active') {
            logger.error('❌ 代理店が非アクティブです');
            logger.error('- 代理店ステータス:', user.agencies.status);
            logger.error('- 代理店名:', user.agencies.name);

            const lineOfficialUrl = process.env.LINE_OFFICIAL_URL;

            // 環境変数チェック
            if (!lineOfficialUrl || lineOfficialUrl.includes('@xxx') || lineOfficialUrl.includes('@your-line-id')) {
                logger.error('❌ LINE_OFFICIAL_URLが正しく設定されていません');
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({
                        success: false,
                        error: 'LINE友達追加機能の設定が完了していません。管理者にお問い合わせください。'
                    })
                };
            }

            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({
                    error: 'アカウントの有効化が完了していません',
                    error_type: 'agency_pending_activation',
                    agency_status: user.agencies.status,
                    message: user.agencies.status === 'pending_friend_add'
                        ? 'LINE公式アカウントを友達追加して、アカウントを有効化してください。'
                        : 'アカウントの有効化処理中です。しばらくお待ちください。',
                    actions: user.agencies.status === 'pending_friend_add'
                        ? [
                            {
                                type: 'add_line_friend',
                                label: 'LINE友達追加してアカウントを有効化',
                                url: lineOfficialUrl
                            },
                            {
                                type: 'contact_support',
                                label: '問題が解決しない場合はサポートへ',
                                url: 'https://ikemen.ltd/contact/',
                                email: 'info@ikemen.ltd'
                            }
                        ]
                        : [
                            {
                                type: 'retry',
                                label: '数分後に再度ログインを試す',
                                url: null
                            },
                            {
                                type: 'contact_support',
                                label: 'サポートに問い合わせる',
                                url: 'https://ikemen.ltd/contact/',
                                email: 'info@ikemen.ltd'
                            }
                        ]
                })
            };
        }

        logger.log('✅ アクティブステータス確認完了');

        // Update last login
        logger.log('=== STEP 5: 最終ログイン時刻更新 ===');
        const { error: updateError } = await supabase
            .from('agency_users')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', user.id);

        if (updateError) {
            logger.error('⚠️ 最終ログイン時刻の更新に失敗:', updateError.message);
        } else {
            logger.log('✅ 最終ログイン時刻更新完了');
        }

        // Generate JWT token
        logger.log('=== STEP 6: JWT トークン生成 ===');

        // セキュリティ: JWT_SECRETが未設定の場合はエラーをスロー
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret || jwtSecret === 'your-jwt-secret') {
            logger.error('❌ CRITICAL: JWT_SECRET is not properly configured');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'サーバー設定エラーが発生しました。管理者にお問い合わせください。'
                })
            };
        }

        const token = jwt.sign(
            {
                userId: user.id,
                agencyId: user.agency_id,
                email: user.email,
                role: user.role
            },
            jwtSecret,
            { expiresIn: '7d' }
        );
        logger.log('✅ JWT トークン生成完了');
        logger.log('- トークン長:', token.length);
        logger.log('- 有効期限: 7日間');

        // セキュアなCookie設定を取得
        const cookieOptions = getSecureCookieOptions();
        logger.log('- Cookie設定:', cookieOptions);

        // HttpOnly Cookieでトークンを設定（セキュリティ強化）
        const setCookieHeaders = [
            `agencyAuthToken=${token}; ${cookieOptions}`,
            `agencyId=${user.agency_id}; ${cookieOptions.replace('HttpOnly; ', '')}`  // agencyIdはJSからアクセス可能に
        ];

        logger.log('=== ✅✅✅ ログイン成功 ✅✅✅ ===');
        logger.log('- ユーザーID:', user.id);
        logger.log('- メールアドレス:', user.email);
        logger.log('- 代理店:', user.agencies.name);
        logger.log('- 代理店コード:', user.agencies.code);
        logger.log('- 階層レベル:', user.agencies.level);

        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Set-Cookie': setCookieHeaders.join(', ')
            },
            body: JSON.stringify({
                success: true,
                // 下位互換性のためにtokenも返すが、推奨はCookieを使用
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role
                },
                agency: {
                    id: user.agencies.id,
                    code: user.agencies.code,
                    name: user.agencies.name,
                    company_name: user.agencies.company_name,
                    contact_email: user.agencies.contact_email,
                    contact_phone: user.agencies.contact_phone,
                    // 4段階代理店制度の情報
                    level: user.agencies.level,
                    own_commission_rate: user.agencies.own_commission_rate,
                    parent_agency_id: user.agencies.parent_agency_id
                }
            })
        };
    } catch (error) {
        logger.error('Authentication error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'サーバーエラーが発生しました'
            })
        };
    }
};