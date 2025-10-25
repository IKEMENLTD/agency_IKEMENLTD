const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { validateCsrfProtection, createCsrfErrorResponse } = require('./utils/csrf-protection');
const logger = require('./utils/logger');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateTrackingCode() {
    return Math.random().toString(36).substring(2, 8) +
           Math.random().toString(36).substring(2, 8);
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agency-Id',
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

    // CSRF保護チェック
    const csrfValidation = validateCsrfProtection(event);
    if (!csrfValidation.valid) {
        return createCsrfErrorResponse(csrfValidation.error);
    }

    try {
        // Verify JWT token
        const token = event.headers.authorization?.replace('Bearer ', '');
        const agencyId = event.headers['x-agency-id'];

        if (!token || !agencyId) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: '認証が必要です' })
            };
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: '無効なトークンです' })
            };
        }

        // Verify agency ID matches token
        if (decoded.agencyId !== agencyId) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'アクセス権限がありません' })
            };
        }

        const {
            name,
            service_id,
            utm_source,
            utm_medium,
            utm_campaign,
            utm_term,
            utm_content
        } = JSON.parse(event.body);

        // Multi-service support: Get LINE Official URL based on service_id
        let line_friend_url;
        let destination_url;

        if (service_id) {
            // マルチサービス: servicesテーブルからLINE URLを取得
            const { data: service, error: serviceError } = await supabase
                .from('services')
                .select('line_official_url, app_redirect_url, status')
                .eq('id', service_id)
                .single();

            if (serviceError || !service) {
                logger.error('❌ Invalid service_id:', service_id);
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: '指定されたサービスが見つかりません'
                    })
                };
            }

            if (service.status !== 'active') {
                logger.error('❌ Service is not active:', service_id);
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: '指定されたサービスは現在利用できません'
                    })
                };
            }

            line_friend_url = service.line_official_url;
            destination_url = service.app_redirect_url || service.line_official_url;

            logger.log('✅ Using service-specific LINE URL:', line_friend_url);
        } else {
            // 後方互換性: 環境変数から取得（service_id未指定の場合）
            line_friend_url = process.env.LINE_OFFICIAL_URL;
            destination_url = line_friend_url;

            // 環境変数チェック
            if (!line_friend_url || line_friend_url.includes('@your-line-id')) {
                logger.error('❌ LINE_OFFICIAL_URLが設定されていません');
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({
                        error: 'LINE友達追加機能の設定が完了していません。管理者にお問い合わせください。'
                    })
                };
            }

            logger.log('⚠️ Using default LINE URL from environment variable (backward compatibility)');
        }

        // Validate required fields
        if (!name) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'キャンペーン名は必須です'
                })
            };
        }

        // Generate unique tracking code
        let trackingCode;
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 5) {
            trackingCode = generateTrackingCode();

            const { data: existing } = await supabase
                .from('agency_tracking_links')
                .select('id')
                .eq('tracking_code', trackingCode)
                .single();

            if (!existing) {
                isUnique = true;
            }
            attempts++;
        }

        if (!isUnique) {
            logger.error('❌ Failed to generate unique tracking code after', attempts, 'attempts');
            throw new Error('Failed to generate unique tracking code');
        }

        logger.log('✅ Generated unique tracking code:', trackingCode);
        logger.log('🔗 Creating tracking link for agency:', agencyId);

        // Create tracking link
        const { data: link, error: linkError } = await supabase
            .from('agency_tracking_links')
            .insert({
                agency_id: agencyId,
                created_by: decoded.userId,
                tracking_code: trackingCode,
                name,
                service_id: service_id || null,  // Multi-service support
                utm_source,
                utm_medium,
                utm_campaign,
                utm_term,
                utm_content,
                line_friend_url,
                destination_url: destination_url || line_friend_url,
                is_active: true,
                visit_count: 0,
                conversion_count: 0
            })
            .select()
            .single();

        if (linkError) {
            logger.error('❌ Error creating tracking link:', linkError);
            logger.error('Link error details:', {
                message: linkError.message,
                code: linkError.code,
                details: linkError.details,
                hint: linkError.hint
            });
            throw linkError;
        }

        logger.log('✅✅✅ Tracking link created successfully! ✅✅✅');
        logger.log('📊 Link details:', {
            id: link.id,
            tracking_code: link.tracking_code,
            name: link.name,
            agency_id: link.agency_id,
            full_url: `https://${event.headers.host}/t/${link.tracking_code}`
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                ...link
            })
        };
    } catch (error) {
        logger.error('❌ Create link error:', error);
        logger.error('Error type:', error.name);
        logger.error('Error message:', error.message);
        logger.error('Error stack:', error.stack);

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'リンクの作成に失敗しました',
                details: logger.isDevelopment() ? error.message : undefined
            })
        };
    }
};