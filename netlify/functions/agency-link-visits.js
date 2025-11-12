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

        // Get all unique visitor IPs and user agents for matching
        const visitorSignatures = (visits || []).map(v => ({
            ip: v.visitor_ip,
            userAgent: v.user_agent,
            visitId: v.id
        }));

        // Get all LINE user IDs (both from visits and from potential matches)
        const lineUserIds = [...new Set(
            (visits || [])
                .map(v => v.line_user_id)
                .filter(id => id != null)
        )];

        // Fetch LINE user information for all user IDs
        let lineProfilesMap = {};
        if (lineUserIds.length > 0) {
            const { data: lineProfiles, error: lineProfilesError } = await supabase
                .from('line_profiles')
                .select('user_id, display_name, picture_url, created_at')
                .in('user_id', lineUserIds);

            if (!lineProfilesError && lineProfiles) {
                lineProfilesMap = Object.fromEntries(
                    lineProfiles.map(profile => [profile.user_id, profile])
                );
            }
        }

        // Also try to match visits without line_user_id by IP + User Agent
        const visitsWithoutLineId = (visits || []).filter(v => !v.line_user_id);

        if (visitsWithoutLineId.length > 0) {
            // Get all tracking visits for this agency to find potential matches
            const { data: allVisits, error: allVisitsError } = await supabase
                .from('agency_tracking_visits')
                .select('visitor_ip, user_agent, line_user_id')
                .eq('agency_id', agencyId)
                .not('line_user_id', 'is', null);

            if (!allVisitsError && allVisits) {
                // Create a map of IP+UserAgent -> line_user_id
                const ipUserAgentMap = {};
                allVisits.forEach(v => {
                    const key = `${v.visitor_ip}|||${v.user_agent}`;
                    if (v.line_user_id) {
                        ipUserAgentMap[key] = v.line_user_id;
                    }
                });

                // Try to match visits without line_user_id
                for (const visit of visitsWithoutLineId) {
                    const key = `${visit.visitor_ip}|||${visit.user_agent}`;
                    if (ipUserAgentMap[key]) {
                        visit.matched_line_user_id = ipUserAgentMap[key];

                        // Add to lineUserIds if not already fetched
                        if (!lineUserIds.includes(ipUserAgentMap[key])) {
                            lineUserIds.push(ipUserAgentMap[key]);

                            // Fetch this profile
                            const { data: profile } = await supabase
                                .from('line_profiles')
                                .select('user_id, display_name, picture_url, created_at')
                                .eq('user_id', ipUserAgentMap[key])
                                .single();

                            if (profile) {
                                lineProfilesMap[profile.user_id] = profile;
                            }
                        }
                    }
                }
            }
        }

        // Get the first visit timestamp for this tracking link
        const { data: firstVisit } = await supabase
            .from('agency_tracking_visits')
            .select('created_at')
            .eq('tracking_link_id', linkId)
            .order('created_at', { ascending: true })
            .limit(1)
            .single();

        const linkCreatedTime = firstVisit ? new Date(firstVisit.created_at) : new Date();

        // Format visits to include LINE display name and existing/new label
        const formattedVisits = (visits || []).map(visit => {
            const effectiveLineUserId = visit.line_user_id || visit.matched_line_user_id;
            const lineProfile = effectiveLineUserId ? lineProfilesMap[effectiveLineUserId] : null;

            // Determine if this is an existing or new friend
            let friendStatus = null;
            if (lineProfile) {
                const profileCreatedTime = new Date(lineProfile.created_at);
                const visitTime = new Date(visit.created_at);

                // If LINE profile was created before this visit, it's an existing friend
                // If LINE profile was created after the link was created, it's a new friend
                if (profileCreatedTime < linkCreatedTime) {
                    friendStatus = '既存';
                } else {
                    friendStatus = '新規';
                }
            }

            return {
                ...visit,
                line_user_id: effectiveLineUserId || visit.line_user_id,
                line_display_name: lineProfile?.display_name || null,
                line_picture_url: lineProfile?.picture_url || null,
                friend_status: friendStatus
            };
        });

        // Get total count for pagination info
        const { count: totalCount } = await supabase
            .from('agency_tracking_visits')
            .select('*', { count: 'exact', head: true })
            .eq('tracking_link_id', linkId);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                visits: formattedVisits,
                total: totalCount || 0,
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
