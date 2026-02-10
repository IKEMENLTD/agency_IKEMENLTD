const jwt = require('jsonwebtoken');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const { createClient } = require('@supabase/supabase-js');
const { filterBotVisits } = require('./utils/bot-detector');

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
    });

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

        // Get link_id from query parameters
        const linkId = event.queryStringParameters?.link_id;

        if (!linkId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'link_id パラメータが必要です' })
            };
        }

        // Verify the link belongs to this agency
        const { data: link, error: linkError } = await supabase
            .from('agency_tracking_links')
            .select('id, agency_id')
            .eq('id', linkId)
            .eq('agency_id', agencyId)
            .single();

        if (linkError || !link) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'リンクが見つかりません' })
            };
        }

        // Get pagination parameters
        const limit = parseInt(event.queryStringParameters?.limit) || 50;
        const offset = parseInt(event.queryStringParameters?.offset) || 0;

        // Get visits for this link with pagination
        const { data: visits, error: visitsError } = await supabase
            .from('agency_tracking_visits')
            .select('*')
            .eq('tracking_link_id', linkId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (visitsError) {
            console.error('Error fetching visits:', visitsError);
            throw visitsError;
        }

        // Filter out bot visits
        // const filteredVisits = filterBotVisits(visits || []);
        // console.log(`Filtered ${(visits || []).length - filteredVisits.length} bot visits`);

        // DEBUG: Return ALL visits including bots to diagnose missing history
        const filteredVisits = visits || [];
        console.log(`DEBUG: Returned all ${filteredVisits.length} visits (Bot filtering disabled)`);

        // Get unique LINE user IDs from filtered visits
        const lineUserIds = [...new Set(
            filteredVisits
                .map(v => v.line_user_id)
                .filter(id => id != null)
        )];

        // Fetch LINE user information if there are any LINE user IDs
        let lineProfilesMap = {};
        if (lineUserIds.length > 0) {
            const { data: lineProfiles, error: lineProfilesError } = await supabase
                .from('line_profiles')
                .select('user_id, display_name, picture_url, created_at')
                .in('user_id', lineUserIds);

            if (!lineProfilesError && lineProfiles) {
                // Create a map for quick lookup
                lineProfilesMap = Object.fromEntries(
                    lineProfiles.map(profile => [profile.user_id, profile])
                );
            }
        }

        // Get the first visit timestamp for this tracking link to determine existing/new friends
        const { data: firstVisit } = await supabase
            .from('agency_tracking_links')
            .select('created_at')
            .eq('id', linkId)
            .single();

        const linkCreatedTime = firstVisit ? new Date(firstVisit.created_at) : new Date();

        // Format filtered visits to include LINE display name and existing/new label
        const formattedVisits = filteredVisits.map(visit => {
            const lineProfile = visit.line_user_id ? lineProfilesMap[visit.line_user_id] : null;

            // Determine if this is an existing or new friend
            let friendStatus = null;
            if (lineProfile && lineProfile.created_at) {
                const profileCreatedTime = new Date(lineProfile.created_at);

                // If LINE profile was created before the link, it's an existing friend
                if (profileCreatedTime < linkCreatedTime) {
                    friendStatus = '既存';
                } else {
                    friendStatus = '新規';
                }
            }

            return {
                ...visit,
                line_display_name: lineProfile?.display_name || null,
                line_picture_url: lineProfile?.picture_url || null,
                friend_status: friendStatus
            };
        });

        // Get total count for pagination info (only real visits, not bots)
        // Note: This is an approximation since we filter bots in application layer
        const totalRealVisits = formattedVisits.length;
        const { count: totalCount } = await supabase
            .from('agency_tracking_visits')
            .select('*', { count: 'exact', head: true })
            .eq('tracking_link_id', linkId);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                visits: formattedVisits,
                total: totalRealVisits,
                totalIncludingBots: totalCount || 0,
                botsFiltered: (totalCount || 0) - totalRealVisits,
                hasMore: (offset + limit) < (totalCount || 0),
                offset: offset,
                limit: limit
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
                error: '訪問履歴の取得に失敗しました',
                details: error.message
            })
        };
    }
};
