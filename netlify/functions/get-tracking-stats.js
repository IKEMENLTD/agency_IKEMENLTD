const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

exports.handler = async (event, context) => {
    // Handle CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE'
            }
        };
    }

    // Only allow GET method
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const queryParams = event.queryStringParameters || {};
        const type = queryParams.type;

        switch (type) {
            case 'links':
                return await getTrackingLinks();
            case 'visits':
                return await getVisits();
            case 'users':
                return await getLineUsers();
            default:
                return await getOverallStats();
        }

    } catch (error) {
        console.error('Function error:', error);

        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                error: 'Internal server error: ' + error.message
            })
        };
    }
};

// Get overall statistics
async function getOverallStats() {
    try {
        // Get total links
        const { count: totalLinks, error: linksError } = await supabase
            .from('tracking_links')
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true);

        if (linksError) throw linksError;

        // Get total visits
        const { count: totalVisits, error: visitsError } = await supabase
            .from('tracking_sessions')
            .select('*', { count: 'exact', head: true });

        if (visitsError) {
            console.error('Visits error:', visitsError);
            // Use 0 if table doesn't exist
        }

        // Get LINE users count
        const { count: lineUsers, error: usersError } = await supabase
            .from('user_states')
            .select('*', { count: 'exact', head: true });

        if (usersError) {
            console.error('Users error:', usersError);
            // Use 0 if table doesn't exist
        }

        // Calculate conversion rate
        const conversionRate = totalVisits > 0 ? ((lineUsers / totalVisits) * 100).toFixed(2) : 0;

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                totalLinks: totalLinks || 0,
                totalVisits: totalVisits || 0,
                lineUsers: lineUsers || 0,
                conversionRate: parseFloat(conversionRate)
            })
        };

    } catch (error) {
        throw error;
    }
}

// Get tracking links with visit counts
async function getTrackingLinks() {
    try {
        // Get tracking links
        const { data: links, error } = await supabase
            .from('tracking_links')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // For each link, get visit count from tracking_sessions
        const linksWithStats = await Promise.all(links.map(async (link) => {
            const { count: visitCount } = await supabase
                .from('tracking_sessions')
                .select('*', { count: 'exact', head: true })
                .eq('tracking_link_id', link.id);

            return {
                ...link,
                visit_count: visitCount || link.click_count || 0
            };
        }));

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                links: linksWithStats || []
            })
        };

    } catch (error) {
        throw error;
    }
}

// Get recent visits with tracking link info
async function getVisits() {
    try {
        const { data: visits, error } = await supabase
            .from('tracking_sessions')
            .select(`
                *,
                tracking_links(name, code)
            `)
            .order('created_at', { ascending: false })
            .limit(100); // Limit to latest 100 visits

        if (error) throw error;

        // Transform data for better frontend consumption
        const visitsWithInfo = visits.map(visit => ({
            ...visit,
            tracking_link: visit.tracking_links,
            line_user: visit.line_users
        }));

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                visits: visitsWithInfo
            })
        };

    } catch (error) {
        throw error;
    }
}

// Get LINE users with tracking information
async function getLineUsers() {
    try {
        const { data: users, error } = await supabase
            .from('line_users')
            .select(`
                *,
                tracking_visits(
                    tracking_links(name, utm_source, utm_medium, utm_campaign)
                )
            `)
            .order('created_at', { ascending: false })
            .limit(200); // Limit to latest 200 users

        if (error) throw error;

        // Transform data to include tracking source info
        const usersWithTracking = users.map(user => {
            let trackingSource = 'Direct';

            if (user.tracking_visits?.length > 0) {
                const visit = user.tracking_visits[0];
                const link = visit.tracking_links;

                if (link) {
                    const sources = [link.utm_source, link.utm_medium, link.utm_campaign].filter(Boolean);
                    trackingSource = sources.length > 0 ? sources.join(' / ') : link.name;
                }
            }

            return {
                ...user,
                tracking_source: trackingSource
            };
        });

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                users: usersWithTracking
            })
        };

    } catch (error) {
        throw error;
    }
}

// Validate environment variables on cold start
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY');
}