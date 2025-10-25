const { createClient } = require('@supabase/supabase-js');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event, context) => {
    // Handle CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                // Secure CORS - see getCorsHeaders(),
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, POST, PUT'
            }
        };
    }

    // Allow GET and POST methods
    if (!['GET', 'POST', 'PUT'].includes(event.httpMethod)) {
        return {
            statusCode: 405,
            headers: {
                // Secure CORS - see getCorsHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const sessionId = event.queryStringParameters?.session_id ||
                         (event.body ? JSON.parse(event.body).session_id : null);

        if (!sessionId) {
            return {
                statusCode: 400,
                headers: {
                    // Secure CORS - see getCorsHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ error: 'Session ID is required' })
            };
        }

        let result;

        switch (event.httpMethod) {
            case 'GET':
                result = await getSessionInfo(sessionId);
                break;
            case 'POST':
                result = await updateSessionActivity(sessionId, JSON.parse(event.body));
                break;
            case 'PUT':
                result = await linkSessionToUser(sessionId, JSON.parse(event.body));
                break;
        }

        return {
            statusCode: 200,
            headers: {
                // Secure CORS - see getCorsHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('Session tracking error:', error);

        return {
            statusCode: 500,
            headers: {
                // Secure CORS - see getCorsHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                error: 'Internal server error: ' + error.message
            })
        };
    }
};

// Get session information
async function getSessionInfo(sessionId) {
    const { data: session, error } = await supabase
        .from('user_sessions')
        .select(`
            *,
            agencies (
                id,
                name,
                commission_rate
            ),
            agency_tracking_links (
                id,
                name,
                tracking_code,
                utm_source,
                utm_medium,
                utm_campaign
            )
        `)
        .eq('session_id', sessionId)
        .single();

    if (error) {
        throw new Error('Session not found');
    }

    return {
        success: true,
        session: session
    };
}

// Update session activity
async function updateSessionActivity(sessionId, data) {
    const updateData = {
        last_activity_at: new Date().toISOString()
    };

    // Add any additional data provided
    if (data.page_url) {
        updateData.metadata = supabase.raw(`
            COALESCE(metadata, '{}') || '{"last_page": "${data.page_url}"}'::jsonb
        `);
    }

    if (data.time_spent) {
        updateData.metadata = supabase.raw(`
            COALESCE(metadata, '{}') || '{"total_time_spent": ${data.time_spent}}'::jsonb
        `);
    }

    const { data: session, error } = await supabase
        .from('user_sessions')
        .update(updateData)
        .eq('session_id', sessionId)
        .select()
        .single();

    if (error) {
        throw error;
    }

    return {
        success: true,
        session: session
    };
}

// Link session to LINE user or Stripe customer
async function linkSessionToUser(sessionId, data) {
    const updateData = {
        last_activity_at: new Date().toISOString()
    };

    // Link LINE user
    if (data.line_user_id) {
        updateData.line_user_id = data.line_user_id;
        updateData.line_friend_at = new Date().toISOString();

        // Record LINE friend conversion funnel step
        const { data: session } = await supabase
            .from('user_sessions')
            .select('id, agency_id')
            .eq('session_id', sessionId)
            .single();

        if (session) {
            await supabase
                .from('conversion_funnels')
                .insert([{
                    session_id: session.id,
                    agency_id: session.agency_id,
                    step_name: 'line_friend',
                    step_data: {
                        line_user_id: data.line_user_id,
                        timestamp: new Date().toISOString()
                    }
                }]);
        }
    }

    // Link Stripe customer
    if (data.stripe_customer_id) {
        updateData.stripe_customer_id = data.stripe_customer_id;
    }

    // Update metadata
    if (data.metadata) {
        updateData.metadata = supabase.raw(`
            COALESCE(metadata, '{}') || '${JSON.stringify(data.metadata)}'::jsonb
        `);
    }

    const { data: session, error } = await supabase
        .from('user_sessions')
        .update(updateData)
        .eq('session_id', sessionId)
        .select()
        .single();

    if (error) {
        throw error;
    }

    // If this is a LINE friend link, create conversion record
    if (data.line_user_id && session.agency_id) {
        await createLineConversion(session, data.line_user_id);
    }

    return {
        success: true,
        session: session
    };
}

// Create LINE friend conversion record
async function createLineConversion(session, lineUserId) {
    try {
        // Check if conversion already exists
        const { data: existingConversion } = await supabase
            .from('agency_conversions')
            .select('id')
            .eq('session_id', session.id)
            .eq('conversion_type', 'line_friend')
            .single();

        if (existingConversion) {
            return; // Already recorded
        }

        // Get agency commission rate
        const { data: agency } = await supabase
            .from('agencies')
            .select('commission_rate')
            .eq('id', session.agency_id)
            .single();

        const conversionData = {
            agency_id: session.agency_id,
            tracking_link_id: session.tracking_link_id,
            visit_id: session.visit_id,
            session_id: session.id,
            line_user_id: lineUserId,
            conversion_type: 'line_friend',
            conversion_value: 0, // LINE friend has no direct monetary value
            metadata: {
                session_data: session.metadata
            }
        };

        const { error: conversionError } = await supabase
            .from('agency_conversions')
            .insert([conversionData]);

        if (conversionError) {
            console.error('Error creating LINE conversion:', conversionError);
        } else {
            console.log('LINE friend conversion recorded for agency:', session.agency_id);

            // Update tracking link conversion count
            await supabase
                .from('agency_tracking_links')
                .update({
                    conversion_count: supabase.raw('conversion_count + 1')
                })
                .eq('id', session.tracking_link_id);
        }

    } catch (error) {
        console.error('Error creating LINE conversion:', error);
    }
}

// Validate environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
}