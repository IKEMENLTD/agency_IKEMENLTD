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
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'GET') {
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

        // Get date range from query parameters
        const params = event.queryStringParameters || {};
        const days = parseInt(params.days) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get analytics data
        const [visitsResult, conversionsResult, topCampaignsResult] = await Promise.all([
            // Daily visits
            supabase
                .from('agency_tracking_visits')
                .select('created_at')
                .eq('agency_id', agencyId)
                .gte('created_at', startDate.toISOString()),

            // Conversions
            supabase
                .from('agency_conversions')
                .select('*')
                .eq('agency_id', agencyId)
                .gte('created_at', startDate.toISOString()),

            // Top campaigns
            supabase
                .from('agency_tracking_links')
                .select(`
                    name,
                    utm_campaign,
                    visit_count,
                    conversion_count
                `)
                .eq('agency_id', agencyId)
                .gt('visit_count', 0)
                .order('conversion_count', { ascending: false })
                .limit(10)
        ]);

        if (visitsResult.error) throw visitsResult.error;
        if (conversionsResult.error) throw conversionsResult.error;
        if (topCampaignsResult.error) throw topCampaignsResult.error;

        // Process daily visits
        const dailyVisits = {};
        visitsResult.data.forEach(visit => {
            const date = new Date(visit.created_at).toISOString().split('T')[0];
            dailyVisits[date] = (dailyVisits[date] || 0) + 1;
        });

        // Process daily conversions (optimize: group by date once)
        const dailyConversions = {};
        conversionsResult.data.forEach(conversion => {
            const date = new Date(conversion.created_at).toISOString().split('T')[0];
            dailyConversions[date] = (dailyConversions[date] || 0) + 1;
        });

        // Process conversions by type
        const conversionsByType = {};
        conversionsResult.data.forEach(conversion => {
            const type = conversion.conversion_type;
            conversionsByType[type] = (conversionsByType[type] || 0) + 1;
        });

        // Format analytics data
        const analytics = [];
        const today = new Date();
        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            analytics.unshift({
                date: dateStr,
                visits: dailyVisits[dateStr] || 0,
                conversions: dailyConversions[dateStr] || 0
            });
        }

        // Calculate conversion rate
        const totalVisits = visitsResult.data.length;
        const totalConversions = conversionsResult.data.length;
        const conversionRate = totalVisits > 0 ?
            ((totalConversions / totalVisits) * 100).toFixed(2) : 0;

        // Format top campaigns with proper field names and CVR calculation
        const formattedTopCampaigns = topCampaignsResult.data.map((campaign, index) => {
            const clicks = campaign.visit_count || 0;
            const conversions = campaign.conversion_count || 0;
            const cvr = clicks > 0 ? parseFloat(((conversions / clicks) * 100).toFixed(2)) : 0;

            return {
                id: index + 1,
                name: campaign.name || campaign.utm_campaign || '(キャンペーン名なし)',
                clicks: clicks,
                conversions: conversions,
                cvr: cvr
            };
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                analytics,
                topCampaigns: formattedTopCampaigns,
                conversionsByType,
                summary: {
                    totalVisits,
                    totalConversions,
                    conversionRate: parseFloat(conversionRate),
                    period: `過去${days}日間`
                }
            })
        };

    } catch (error) {
        console.error('Analytics error:', error);

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
                error: '分析データの取得に失敗しました',
                details: error.message
            })
        };
    }
};