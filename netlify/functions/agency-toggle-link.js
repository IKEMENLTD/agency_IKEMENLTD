const jwt = require('jsonwebtoken');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    // CORS headers
    const headers = getCorsHeaders(event, {
        // Secure CORS - see getCorsHeaders(),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agency-Id',
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

    // Verify JWT token
    const authHeader = event.headers.authorization;
    const agencyId = event.headers['x-agency-id'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: '認証が必要です' })
        };
    }

    const token = authHeader.substring(7);

    try {
        // Verify JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!agencyId || decoded.agencyId !== agencyId) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'アクセス権限がありません' })
            };
        }

        const { link_id, is_active } = JSON.parse(event.body);

        if (!link_id || typeof is_active !== 'boolean') {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'link_id と is_active が必要です' })
            };
        }

        // Verify the link belongs to this agency
        const { data: link, error: linkError } = await supabase
            .from('agency_tracking_links')
            .select('id, agency_id, name')
            .eq('id', link_id)
            .eq('agency_id', agencyId)
            .single();

        if (linkError || !link) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'リンクが見つかりません' })
            };
        }

        // Update the link status
        const { data: updatedLink, error: updateError } = await supabase
            .from('agency_tracking_links')
            .update({ is_active })
            .eq('id', link_id)
            .select()
            .single();

        if (updateError) {
            console.error('Error updating link:', updateError);
            throw updateError;
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: `リンクを${is_active ? '有効化' : '無効化'}しました`,
                link: updatedLink
            })
        };

    } catch (error) {
        console.error('Handler error:', error);

        if (error.name === 'JsonWebTokenError') {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: '無効な認証トークンです' })
            };
        }

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'リンクステータスの更新に失敗しました',
                details: error.message
            })
        };
    }
};
