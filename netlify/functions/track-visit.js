const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
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

    // Only allow POST method
    if (event.httpMethod !== 'POST') {
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
        const trackingData = JSON.parse(event.body);

        // Validate required fields
        if (!trackingData.tracking_code) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: 'Missing tracking_code'
                })
            };
        }

        // Get tracking link information
        const { data: trackingLink, error: linkError } = await supabase
            .from('tracking_links')
            .select('*')
            .eq('tracking_code', trackingData.tracking_code)
            .eq('is_active', true)
            .single();

        if (linkError || !trackingLink) {
            return {
                statusCode: 404,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: 'Invalid tracking code'
                })
            };
        }

        // Get client IP from headers if not provided
        let clientIP = trackingData.ip_address;
        if (!clientIP || clientIP === 'unknown') {
            clientIP = getClientIPFromHeaders(event.headers);
        }

        // Create visit record
        const visitData = {
            tracking_link_id: trackingLink.id,
            ip_address: clientIP,
            user_agent: trackingData.user_agent || 'Unknown',
            referrer: trackingData.referrer,
            utm_source: trackingData.utm_source || trackingLink.utm_source,
            utm_medium: trackingData.utm_medium || trackingLink.utm_medium,
            utm_campaign: trackingData.utm_campaign || trackingLink.utm_campaign,
            screen_resolution: trackingData.screen_resolution,
            language: trackingData.language,
            timezone: trackingData.timezone,
            visited_at: trackingData.visited_at || new Date().toISOString(),
            session_id: generateSessionId()
        };

        // Check for duplicate visits within the last 5 minutes from same IP
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: recentVisit } = await supabase
            .from('tracking_visits')
            .select('id')
            .eq('tracking_link_id', trackingLink.id)
            .eq('ip_address', clientIP)
            .gte('visited_at', fiveMinutesAgo)
            .single();

        let visitId = null;
        if (!recentVisit) {
            // Insert visit record
            const { data: visit, error: visitError } = await supabase
                .from('tracking_visits')
                .insert([visitData])
                .select()
                .single();

            if (visitError) {
                console.error('Error creating visit:', visitError);
                // Don't fail the request if visit tracking fails
            } else {
                visitId = visit.id;
            }
        }

        // Store visit info in session for potential LINE user linking
        const sessionData = {
            visit_id: visitId,
            tracking_link_id: trackingLink.id,
            utm_params: {
                source: visitData.utm_source,
                medium: visitData.utm_medium,
                campaign: visitData.utm_campaign
            },
            timestamp: new Date().toISOString()
        };

        // Return tracking link's LINE friend URL and session info
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json',
                'Set-Cookie': `tracking_session=${JSON.stringify(sessionData)}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=3600`
            },
            body: JSON.stringify({
                success: true,
                line_friend_url: trackingLink.line_friend_url,
                tracking_link: {
                    name: trackingLink.name,
                    utm_source: trackingLink.utm_source,
                    utm_medium: trackingLink.utm_medium,
                    utm_campaign: trackingLink.utm_campaign
                },
                visit_id: visitId,
                session_id: visitData.session_id
            })
        };

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

// Helper function to extract client IP from headers
function getClientIPFromHeaders(headers) {
    // Check various headers for client IP
    const ipHeaders = [
        'x-forwarded-for',
        'x-real-ip',
        'x-client-ip',
        'cf-connecting-ip',  // Cloudflare
        'x-forwarded',
        'forwarded-for',
        'forwarded'
    ];

    for (const header of ipHeaders) {
        const value = headers[header];
        if (value) {
            // x-forwarded-for can contain multiple IPs, get the first one
            return value.split(',')[0].trim();
        }
    }

    return 'unknown';
}

// Helper function to generate session ID
function generateSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Validate environment variables on cold start
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY');
}