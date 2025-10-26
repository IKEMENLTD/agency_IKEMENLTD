const { createClient } = require('@supabase/supabase-js');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const crypto = require('crypto');
const { validateCsrfProtection, createCsrfErrorResponse } = require('./utils/csrf-protection');
const { applyRateLimit, STRICT_RATE_LIMIT } = require('./utils/rate-limiter');
const logger = require('./utils/logger');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// SendGridを使う場合（オプション）
// const sgMail = require('@sendgrid/mail');
// sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.handler = async (event) => {
    const headers = getCorsHeaders(event, {
        // Secure CORS - see getCorsHeaders(),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    });

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

    // レート制限チェック（パスワードリセット要求のスパム対策）
    logger.log('=== パスワードリセット要求受信 ===');
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
        const { email } = JSON.parse(event.body);

        if (!email) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'メールアドレスを入力してください'
                })
            };
        }

        // ユーザーの確認
        const { data: user, error: userError } = await supabase
            .from('agency_users')
            .select('id, name, email, agency_id')
            .eq('email', email)
            .single();

        if (userError || !user) {
            // セキュリティのため、ユーザーが存在しない場合も成功を返す
            console.log('User not found:', email);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    message: 'パスワードリセットメールを送信しました（該当するアカウントが存在する場合）'
                })
            };
        }

        // トークン生成
        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1); // 1時間有効

        // 既存の未使用トークンを無効化
        await supabase
            .from('password_reset_tokens')
            .update({ used: true })
            .eq('agency_user_id', user.id)
            .eq('used', false);

        // 新しいトークンを保存
        const { error: tokenError } = await supabase
            .from('password_reset_tokens')
            .insert({
                agency_user_id: user.id,
                token: hashedToken,
                expires_at: expiresAt.toISOString()
            });

        if (tokenError) {
            console.error('Token creation error:', tokenError);
            throw tokenError;
        }

        // リセットURL
        const resetUrl = `${process.env.APP_URL || 'https://taskmateai.net'}/agency/reset-password.html?token=${resetToken}`;

        // メール送信オプション1: SendGrid（要設定）
        if (process.env.SENDGRID_API_KEY) {
            const sgMail = require('@sendgrid/mail');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);

            const msg = {
                to: email,
                from: process.env.EMAIL_FROM || 'noreply@taskmateai.net',
                subject: '🔐 パスワードリセットのご案内 - TaskMate AI',
                html: `
                    <!DOCTYPE html>
                    <html lang="ja">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>パスワードリセット</title>
                    </head>
                    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #f0fdf4 0%, #d1fae5 100%); min-height: 100vh;">
                        <!-- メインコンテナ -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="min-height: 100vh; padding: 40px 20px;">
                            <tr>
                                <td align="center">
                                    <!-- メールカード -->
                                    <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background: #ffffff; border-radius: 16px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1); overflow: hidden;">

                                        <!-- ヘッダー（グラデーション） -->
                                        <tr>
                                            <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 30px; text-align: center;">
                                                <!-- アイコン -->
                                                <div style="width: 80px; height: 80px; background: rgba(255, 255, 255, 0.2); border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);">
                                                    <span style="font-size: 40px; color: #ffffff;">🔐</span>
                                                </div>
                                                <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">パスワードリセット</h1>
                                                <p style="margin: 10px 0 0 0; color: rgba(255, 255, 255, 0.9); font-size: 16px;">TaskMate AI パートナーポータル</p>
                                            </td>
                                        </tr>

                                        <!-- 本文 -->
                                        <tr>
                                            <td style="padding: 40px 30px;">
                                                <!-- 挨拶 -->
                                                <p style="margin: 0 0 20px 0; font-size: 18px; color: #1f2937; font-weight: 600;">
                                                    ${user.name} 様
                                                </p>

                                                <!-- メッセージ -->
                                                <p style="margin: 0 0 10px 0; font-size: 15px; color: #4b5563; line-height: 1.6;">
                                                    パスワードリセットのリクエストを受け付けました。
                                                </p>
                                                <p style="margin: 0 0 30px 0; font-size: 15px; color: #4b5563; line-height: 1.6;">
                                                    以下のボタンをクリックして、新しいパスワードを設定してください。
                                                </p>

                                                <!-- リセットボタン -->
                                                <table width="100%" cellpadding="0" cellspacing="0">
                                                    <tr>
                                                        <td align="center" style="padding: 10px 0 30px 0;">
                                                            <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); transition: all 0.3s;">
                                                                🔑 パスワードをリセット
                                                            </a>
                                                        </td>
                                                    </tr>
                                                </table>

                                                <!-- 有効期限 -->
                                                <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-left: 4px solid #f59e0b; padding: 16px 20px; border-radius: 8px; margin: 0 0 30px 0;">
                                                    <p style="margin: 0; font-size: 14px; color: #92400e; line-height: 1.6;">
                                                        <strong>⏰ 重要：</strong>このリンクは<strong>1時間のみ有効</strong>です。<br>
                                                        有効期限：${expiresAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                                                    </p>
                                                </div>

                                                <!-- URLコピー -->
                                                <p style="margin: 0 0 10px 0; font-size: 14px; color: #6b7280;">
                                                    ボタンが機能しない場合は、以下のURLをブラウザにコピーしてください：
                                                </p>
                                                <div style="background: #f3f4f6; padding: 12px 16px; border-radius: 8px; word-break: break-all; margin: 0 0 30px 0;">
                                                    <code style="font-size: 13px; color: #059669; font-family: monospace;">${resetUrl}</code>
                                                </div>

                                                <!-- セキュリティ注意 -->
                                                <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 16px 20px; border-radius: 8px;">
                                                    <p style="margin: 0; font-size: 14px; color: #991b1b; line-height: 1.6;">
                                                        <strong>🛡️ セキュリティについて</strong><br>
                                                        • このリクエストに心当たりがない場合は、このメールを無視してください<br>
                                                        • パスワードはご自身で変更しない限り変更されません<br>
                                                        • このメールを第三者に転送しないでください
                                                    </p>
                                                </div>
                                            </td>
                                        </tr>

                                        <!-- フッター -->
                                        <tr>
                                            <td style="background: #f9fafb; padding: 30px; border-top: 1px solid #e5e7eb;">
                                                <table width="100%" cellpadding="0" cellspacing="0">
                                                    <tr>
                                                        <td align="center">
                                                            <p style="margin: 0 0 10px 0; font-size: 14px; color: #6b7280;">
                                                                本メールは TaskMate AI より自動送信されています
                                                            </p>
                                                            <p style="margin: 0 0 15px 0; font-size: 13px; color: #9ca3af;">
                                                                © ${new Date().getFullYear()} TaskMate AI. All rights reserved.
                                                            </p>
                                                            <div style="margin: 15px 0 0 0;">
                                                                <a href="https://taskmateai.net" style="color: #10b981; text-decoration: none; font-size: 13px; margin: 0 10px;">公式サイト</a>
                                                                <span style="color: #d1d5db;">|</span>
                                                                <a href="https://taskmateai.net/agency/" style="color: #10b981; text-decoration: none; font-size: 13px; margin: 0 10px;">ログイン</a>
                                                                <span style="color: #d1d5db;">|</span>
                                                                <a href="https://ikemen.ltd/contact/" style="color: #10b981; text-decoration: none; font-size: 13px; margin: 0 10px;">お問い合わせ</a>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                </table>
                                            </td>
                                        </tr>

                                    </table>
                                </td>
                            </tr>
                        </table>
                    </body>
                    </html>
                `,
                text: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔐 パスワードリセットのご案内
TaskMate AI パートナーポータル
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${user.name} 様

パスワードリセットのリクエストを受け付けました。
以下のURLにアクセスして、新しいパスワードを設定してください。

▼ パスワードリセットURL
${resetUrl}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ 重要事項
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• このリンクは1時間のみ有効です
• 有効期限：${expiresAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ セキュリティについて
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• このリクエストに心当たりがない場合は、このメールを無視してください
• パスワードはご自身で変更しない限り変更されません
• このメールを第三者に転送しないでください

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

本メールは TaskMate AI より自動送信されています
© ${new Date().getFullYear()} TaskMate AI. All rights reserved.

公式サイト：https://taskmateai.net
ログイン：https://taskmateai.net/agency/
お問い合わせ：https://ikemen.ltd/contact/
                `
            };

            await sgMail.send(msg);
            console.log('Password reset email sent to:', email);

        } else {
            // メール送信オプション2: コンソールに表示（開発用）
            console.log('=== PASSWORD RESET LINK ===');
            console.log('Email:', email);
            console.log('Reset URL:', resetUrl);
            console.log('Token:', resetToken);
            console.log('Expires at:', expiresAt);
            console.log('===========================');

            // 本番環境ではSendGridまたは他のメールサービスを設定してください

            // データベースにリセットURLを保存（開発用）
            // セキュリティ: plain_tokenは保存しない（ログのみに出力）
            await supabase
                .from('password_reset_tokens')
                .update({
                    reset_url: resetUrl
                    // plain_token: 削除 - セキュリティリスクのため保存しない
                })
                .eq('token', hashedToken);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'パスワードリセットの案内を送信しました',
                // メール送信が設定されていない場合はトークンを返す
                ...(!process.env.SENDGRID_API_KEY ? {
                    token: resetToken,
                    resetUrl
                } : {})
            })
        };

    } catch (error) {
        console.error('Password reset error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'パスワードリセット処理中にエラーが発生しました'
            })
        };
    }
};