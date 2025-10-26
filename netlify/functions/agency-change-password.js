const { createClient } = require('@supabase/supabase-js');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { validateCsrfProtection, createCsrfErrorResponse } = require('./utils/csrf-protection');
const { applyRateLimit, STRICT_RATE_LIMIT } = require('./utils/rate-limiter');
const logger = require('./utils/logger');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    const headers = getCorsHeaders(event, {
        // Secure CORS - see getCorsHeaders(),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agency-Id',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff'
    });

    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
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

    // CSRF保護チェック
    const csrfValidation = validateCsrfProtection(event);
    if (!csrfValidation.valid) {
        return createCsrfErrorResponse(csrfValidation.error);
    }

    try {
        // JWT認証
        const authHeader = event.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Unauthorized: No token provided' })
            };
        }

        const token = authHeader.replace('Bearer ', '');
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Unauthorized: Invalid token' })
            };
        }

        // Agency ID検証
        const agencyId = event.headers['x-agency-id'];
        if (!agencyId || agencyId !== decoded.agencyId) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'Forbidden: Agency ID mismatch' })
            };
        }

        // リクエストボディの解析
        const { currentPassword, newPassword, confirmPassword } = JSON.parse(event.body);

        // バリデーション
        if (!currentPassword || !newPassword || !confirmPassword) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'すべてのフィールドを入力してください' })
            };
        }

        if (newPassword !== confirmPassword) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: '新しいパスワードが一致しません' })
            };
        }

        if (newPassword.length < 8) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'パスワードは8文字以上で入力してください' })
            };
        }

        if (currentPassword === newPassword) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: '新しいパスワードは現在のパスワードと異なる必要があります' })
            };
        }

        // パスワード強度チェック（推奨）
        const hasUpperCase = /[A-Z]/.test(newPassword);
        const hasLowerCase = /[a-z]/.test(newPassword);
        const hasNumbers = /\d/.test(newPassword);
        const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(newPassword);

        const strengthScore = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecialChar].filter(Boolean).length;

        if (strengthScore < 2) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'パスワードは英大文字、英小文字、数字、記号のうち2種類以上を含む必要があります'
                })
            };
        }

        // ユーザー情報を取得（agency_usersテーブルから）
        const { data: userData, error: userError } = await supabase
            .from('agency_users')
            .select('id, email, password_hash, agency_id')
            .eq('id', decoded.userId)
            .eq('agency_id', agencyId)
            .single();

        if (userError || !userData) {
            logger.error('User fetch error:', userError);
            // セキュリティ上の理由により、詳細な理由は返さない
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'パスワード変更に失敗しました。再度ログインしてください。' })
            };
        }

        // 現在のパスワードを検証
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, userData.password_hash);
        if (!isCurrentPasswordValid) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: '現在のパスワードが正しくありません' })
            };
        }

        // 新しいパスワードをハッシュ化
        const saltRounds = 10;
        const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

        // データベースを更新
        const { error: updateError } = await supabase
            .from('agency_users')
            .update({
                password_hash: newPasswordHash,
                updated_at: new Date().toISOString()
            })
            .eq('id', userData.id)
            .eq('agency_id', agencyId);

        if (updateError) {
            logger.error('Password update error:', updateError);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'パスワードの更新に失敗しました' })
            };
        }

        // セキュリティログを記録（オプション）
        logger.log(`Password changed successfully for user: ${userData.email} (ID: ${userData.id})`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'パスワードを正常に変更しました'
            })
        };

    } catch (error) {
        logger.error('Change password error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'パスワード変更処理中にエラーが発生しました' })
        };
    }
};
