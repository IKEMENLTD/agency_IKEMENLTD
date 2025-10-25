const jwt = require('jsonwebtoken');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const { createClient } = require('@supabase/supabase-js');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    // CORS headers
    const headers = getCorsHeaders(event, {
        // Secure CORS - see getCorsHeaders(),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agency-Id',
        'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'DELETE') {
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

        const { link_id } = JSON.parse(event.body);

        if (!link_id) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'link_id が必要です' })
            };
        }

        // Verify the link belongs to this agency
        const { data: link, error: linkError } = await supabase
            .from('agency_tracking_links')
            .select('id, agency_id, name, tracking_code')
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

        // First, delete all associated visits (cascade delete)
        const { error: visitsDeleteError } = await supabase
            .from('agency_tracking_visits')
            .delete()
            .eq('tracking_link_id', link_id);

        if (visitsDeleteError) {
            console.error('Error deleting visits:', visitsDeleteError);
            // Continue anyway - this might fail if there are no visits
        }

        // Delete the tracking link (hard delete)
        const { error: deleteError } = await supabase
            .from('agency_tracking_links')
            .delete()
            .eq('id', link_id);

        if (deleteError) {
            console.error('Error deleting link:', deleteError);
            throw deleteError;
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'リンクを削除しました',
                deleted_link: {
                    id: link.id,
                    name: link.name,
                    tracking_code: link.tracking_code
                }
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
                error: 'リンクの削除に失敗しました',
                details: error.message
            })
        };
    }
};
