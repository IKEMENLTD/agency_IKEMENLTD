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
        'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS'
    });

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
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

    // セキュリティ: JWT_SECRETが未設定の場合はエラーをスロー
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret === 'your-jwt-secret') {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'サーバー設定エラーが発生しました' })
        };
    }

    try {
        // Verify JWT
        const decoded = jwt.verify(token, jwtSecret);

        if (!agencyId || decoded.agencyId !== agencyId) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'アクセス権限がありません' })
            };
        }

        if (event.httpMethod === 'GET') {
            // Get tracking links for the agency
            const { data: links, error } = await supabase
                .from('agency_tracking_links')
                .select(`
                    *,
                    agency_tracking_visits(count),
                    agency_conversions(count)
                `)
                .eq('agency_id', agencyId)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching links:', error);
                throw error;
            }

            // Format the response
            const formattedLinks = links.map(link => ({
                id: link.id,
                tracking_code: link.tracking_code,
                name: link.name,
                utm_source: link.utm_source,
                utm_medium: link.utm_medium,
                utm_campaign: link.utm_campaign,
                utm_term: link.utm_term,
                utm_content: link.utm_content,
                line_friend_url: link.line_friend_url,
                destination_url: link.destination_url,
                is_active: link.is_active,
                visit_count: link.visit_count || 0,
                conversion_count: link.conversion_count || 0,
                created_at: link.created_at,
                tracking_url: `https://taskmateai.net/t/${link.tracking_code}`
            }));

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    links: formattedLinks,
                    total: formattedLinks.length
                })
            };
        }

        if (event.httpMethod === 'DELETE') {
            const linkId = event.path.split('/').pop();

            if (!linkId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'リンクIDが必要です' })
                };
            }

            // Verify the link belongs to this agency
            const { data: link } = await supabase
                .from('agency_tracking_links')
                .select('id, agency_id')
                .eq('id', linkId)
                .eq('agency_id', agencyId)
                .single();

            if (!link) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'リンクが見つかりません' })
                };
            }

            // Soft delete - set is_active to false
            const { error } = await supabase
                .from('agency_tracking_links')
                .update({ is_active: false })
                .eq('id', linkId);

            if (error) {
                console.error('Error deleting link:', error);
                throw error;
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    message: 'リンクを削除しました'
                })
            };
        }

        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
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
                error: 'リンクの取得に失敗しました',
                details: error.message
            })
        };
    }
};