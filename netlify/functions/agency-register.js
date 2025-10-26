const bcrypt = require('bcryptjs');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const { createClient } = require('@supabase/supabase-js');
const { validateCsrfProtection, createCsrfErrorResponse } = require('./utils/csrf-protection');
const { applyRateLimit, STRICT_RATE_LIMIT } = require('./utils/rate-limiter');
const logger = require('./utils/logger');

// Check environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.error('Missing required environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Generate unique agency code
function generateAgencyCode() {
    const prefix = 'AG';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
    return `${prefix}${timestamp}${random}`;
}

// Generate registration token for LINE verification
function generateRegistrationToken() {
    const crypto = require('crypto');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
    return crypto.randomBytes(32).toString('hex');
}

exports.handler = async (event) => {
    // CORS headers
    const headers = getCorsHeaders(event, {
        // Secure CORS - see getCorsHeaders(),
        'Access-Control-Allow-Headers': 'Content-Type',
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

    // レート制限チェック（スパム登録攻撃対策）
    logger.log('=== 登録リクエスト受信 ===');
    logger.log('IPアドレス:', event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown');
    logger.log('User-Agent:', event.headers['user-agent']);

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
        logger.error('Origin:', event.headers.origin);
        logger.error('Referer:', event.headers.referer);
        return createCsrfErrorResponse(csrfValidation.error);
    }
    logger.log('✅ CSRF保護チェック通過');

    try {
        logger.log('=== 登録処理開始 ===');

        // Check if Supabase is configured
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'サービスが一時的に利用できません。しばらくしてから再度お試しください。'
                })
            };
        }

        const {
            company_name,
            agency_name,
            address,
            contact_name,
            email,
            phone,
            password,
            invitation_code
        } = JSON.parse(event.body);

        logger.log('受信したデータ:');
        logger.log('- 会社名:', company_name);
        logger.log('- 代理店名:', agency_name);
        logger.log('- 住所:', address);
        logger.log('- 担当者名:', contact_name);
        logger.log('- メールアドレス:', email);
        logger.log('- 電話番号:', phone);
        logger.log('- パスワード長:', password ? password.length : 0);
        logger.log('- 招待コード:', invitation_code);

        // Validate required fields
        logger.log('=== STEP 0: 必須項目チェック ===');
        const missingFields = [];
        if (!company_name) missingFields.push('会社名');
        if (!agency_name) missingFields.push('代理店名');
        if (!contact_name) missingFields.push('担当者名');
        if (!email) missingFields.push('メールアドレス');
        if (!phone) missingFields.push('電話番号');
        if (!password) missingFields.push('パスワード');
        if (!invitation_code) missingFields.push('招待コード');

        if (missingFields.length > 0) {
            logger.error('❌ 必須項目が入力されていません');
            logger.error('未入力の項目:', missingFields.join(', '));
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: '必須項目を入力してください'
                })
            };
        }
        logger.log('✅ 必須項目チェック通過');

        // Validate password length
        logger.log('パスワード長チェック:', password.length, '文字');
        if (password.length < 8) {
            logger.error('❌ パスワードが短すぎます:', password.length, '文字');
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'パスワードは8文字以上で入力してください'
                })
            };
        }
        logger.log('✅ パスワード長チェック通過');

        // Validate invitation code (4-tier agency system)
        logger.log('=== STEP 1: 代理店コード検証開始 ===');
        logger.log('代理店コード:', invitation_code);

        const { data: parentAgency, error: parentError } = await supabase
            .from('agencies')
            .select('id, code, name, level, own_commission_rate, status')
            .eq('code', invitation_code)
            .single();

        logger.log('Supabaseクエリ結果:');
        logger.log('- parentAgency:', parentAgency);
        logger.log('- parentError:', parentError);

        if (parentError || !parentAgency) {
            logger.error('❌ 代理店コードが見つかりません');
            logger.error('- 入力された代理店コード:', invitation_code);
            logger.error('- Supabaseエラー:', parentError);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: '代理店コードが無効です。紹介元の代理店から正しいコードを取得してください。'
                })
            };
        }

        logger.log('✅ 親代理店が見つかりました');
        logger.log('- ID:', parentAgency.id);
        logger.log('- 代理店名:', parentAgency.name);
        logger.log('- 階層レベル:', parentAgency.level);
        logger.log('- ステータス:', parentAgency.status);

        if (parentAgency.status !== 'active') {
            logger.error('❌ 親代理店が無効化されています');
            logger.error('- 代理店コード:', invitation_code);
            logger.error('- ステータス:', parentAgency.status);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'この代理店コードは現在使用できません。紹介元の代理店にお問い合わせください。'
                })
            };
        }

        // Check maximum hierarchy level (4 tiers)
        if (parentAgency.level >= 4) {
            logger.error('❌ 最大階層に達しています');
            logger.error('- 親代理店レベル:', parentAgency.level);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'これ以上下位の代理店を登録することはできません（最大4階層まで）。'
                })
            };
        }

        // Calculate new agency level and commission rate
        const newAgencyLevel = parentAgency.level + 1;
        const standardRates = { 1: 20.00, 2: 18.00, 3: 16.00, 4: 14.00 };
        const newCommissionRate = standardRates[newAgencyLevel] || 20.00;

        logger.log('✅ 代理店コード検証完了 - 有効なコードです');
        logger.log('- 新規代理店の階層レベル:', newAgencyLevel);
        logger.log('- 新規代理店の報酬率:', newCommissionRate, '%');

        // Check if email already exists
        logger.log('=== STEP 2: メールアドレス重複チェック ===');
        logger.log('チェックするメールアドレス:', email);
        const { data: existingUser } = await supabase
            .from('agency_users')
            .select('id')
            .eq('email', email)
            .single();

        logger.log('メール重複チェック結果:');
        logger.log('- existingUser:', existingUser ? 'メールアドレスは既に使用されています' : 'メールアドレスは使用可能です');

        if (existingUser) {
            logger.error('❌ メールアドレスが既に登録されています');
            logger.error('- メールアドレス:', email);
            logger.error('- 既存ユーザーID:', existingUser.id);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'このメールアドレスは既に登録されています'
                })
            };
        }

        logger.log('✅ メールアドレスは使用可能です');

        // Check if phone number already exists
        logger.log('=== STEP 2.5: 電話番号重複チェック ===');
        logger.log('チェックする電話番号:', phone);
        const { data: existingPhone } = await supabase
            .from('agencies')
            .select('id, contact_phone')
            .eq('contact_phone', phone)
            .single();

        logger.log('電話番号重複チェック結果:');
        logger.log('- existingPhone:', existingPhone ? '電話番号は既に使用されています' : '電話番号は使用可能です');

        if (existingPhone) {
            logger.error('❌ 電話番号が既に登録されています');
            logger.error('- 電話番号:', phone);
            logger.error('- 既存代理店ID:', existingPhone.id);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'この電話番号は既に登録されています'
                })
            };
        }

        logger.log('✅ 電話番号は使用可能です');

        // Generate unique agency code
        logger.log('=== STEP 3: 代理店コード生成 ===');
        let agencyCode = generateAgencyCode();
        let codeIsUnique = false;
        let attempts = 0;

        while (!codeIsUnique && attempts < 5) {
            logger.log('代理店コード生成試行:', attempts + 1, '回目 -', agencyCode);
            const { data: existingAgency } = await supabase
                .from('agencies')
                .select('id')
                .eq('code', agencyCode)
                .single();

            if (!existingAgency) {
                codeIsUnique = true;
                logger.log('✅ ユニークな代理店コードを生成:', agencyCode);
            } else {
                logger.log('⚠️  代理店コードが重複、再生成します');
                agencyCode = generateAgencyCode();
                attempts++;
            }
        }

        if (!codeIsUnique) {
            logger.error('❌ ユニークな代理店コードの生成に失敗');
            throw new Error('Failed to generate unique agency code');
        }

        // Create agency (4-tier system)
        logger.log('=== STEP 4: 代理店レコード作成 ===');
        logger.log('代理店コード:', agencyCode);
        logger.log('親代理店ID:', parentAgency.id);
        logger.log('階層レベル:', newAgencyLevel);
        logger.log('自己報酬率:', newCommissionRate);

        // Generate registration token for LINE verification (15分有効期限)
        const registrationToken = generateRegistrationToken();
        const tokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15分後
        logger.log('登録トークン生成完了');
        logger.log('トークン有効期限:', tokenExpiresAt.toISOString());

        const { data: agency, error: agencyError } = await supabase
            .from('agencies')
            .insert({
                code: agencyCode,
                name: agency_name,
                company_name: company_name,
                contact_email: email,
                contact_phone: phone,
                address: address,
                status: 'pending_line_verification', // LINE連携待ち状態
                registration_token: registrationToken, // LINE連携用トークン
                registration_token_expires_at: tokenExpiresAt.toISOString(), // トークン有効期限（15分）
                // 4段階代理店制度のフィールド
                parent_agency_id: parentAgency.id,
                level: newAgencyLevel,
                own_commission_rate: newCommissionRate,
                settings: {},
                payment_info: {}
            })
            .select()
            .single();

        if (agencyError) {
            logger.error('❌ 代理店レコード作成エラー:', agencyError);
            logger.error('エラー詳細:', {
                message: agencyError.message,
                code: agencyError.code,
                details: agencyError.details
            });
            throw agencyError;
        }
        logger.log('✅ 代理店レコード作成成功 - ID:', agency.id);

        // Hash password
        logger.log('=== STEP 5: パスワードハッシュ化 ===');
        const hashedPassword = await bcrypt.hash(password, 10);
        logger.log('✅ パスワードハッシュ化完了');

        // Create agency user
        logger.log('=== STEP 6: ユーザーレコード作成 ===');
        logger.log('メールアドレス:', email);
        logger.log('代理店ID:', agency.id);
        const { data: agencyUser, error: userError } = await supabase
            .from('agency_users')
            .insert({
                agency_id: agency.id,
                email: email,
                password_hash: hashedPassword,
                name: contact_name,
                role: 'owner',
                is_active: false // LINE連携完了後にアクティブ化
            })
            .select()
            .single();

        if (userError) {
            logger.error('❌ ユーザーレコード作成エラー:', userError);
            logger.error('エラー詳細:', {
                message: userError.message,
                code: userError.code,
                details: userError.details
            });
            // Rollback agency creation
            logger.log('ロールバック: 代理店レコードを削除します');
            await supabase
                .from('agencies')
                .delete()
                .eq('id', agency.id);
            throw userError;
        }
        logger.log('✅ ユーザーレコード作成成功 - ID:', agencyUser.id);

        // Send welcome email (optional - implement if needed)
        // await sendWelcomeEmail(email, contact_name, agency_name);

        logger.log('=== ✅✅✅ 仮登録処理完了 ✅✅✅ ===');
        logger.log('代理店コード:', agencyCode);
        logger.log('代理店ID:', agency.id);
        logger.log('ユーザーID:', agencyUser.id);
        logger.log('メールアドレス:', email);
        logger.log('登録トークン:', registrationToken);
        logger.log('次のステップ: LINE連携が必要です');

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'LINE連携が必要です',
                agency_code: agencyCode,
                registration_token: registrationToken,
                requires_line_verification: true
            })
        };

    } catch (error) {
        logger.error('=== ❌❌❌ 登録処理でエラーが発生 ❌❌❌ ===');
        logger.error('エラータイプ:', error.name);
        logger.error('エラーメッセージ:', error.message);
        logger.error('エラー詳細:', {
            message: error.message,
            stack: error.stack,
            name: error.name,
            code: error.code || 'N/A',
            details: error.details || 'N/A'
        });

        // Supabaseエラーの場合、追加情報をログ出力
        if (error.code) {
            logger.error('Supabaseエラーコード:', error.code);
            logger.error('Supabaseエラー詳細:', error.details);
            logger.error('Supabaseヒント:', error.hint);
        }

        // セキュリティ上の理由により、詳細なエラー情報は返さない
        const errorMessage = '登録処理を完了できませんでした。しばらくしてから再度お試しください。';

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };
    }
};