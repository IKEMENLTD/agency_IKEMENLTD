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
        const {
            name,
            service_id,
            agency_id,
            utm_source,
            utm_medium,
            utm_campaign
        } = JSON.parse(event.body);

        // Validate required fields
        if (!name) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: 'Missing required field: name'
                })
            };
        }

        if (!service_id) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: 'サービスを選択してください'
                })
            };
        }

        if (!agency_id) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: 'Missing required field: agency_id'
                })
            };
        }

        // Verify service exists
        const { data: service, error: serviceError } = await supabase
            .from('services')
            .select('id, name, line_official_url')
            .eq('id', service_id)
            .eq('status', 'active')
            .single();

        if (serviceError || !service) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: '無効なサービスが選択されています'
                })
            };
        }

        // Generate unique tracking code
        let tracking_code = generateTrackingCode();

        // Check if tracking code already exists (very unlikely but better to be safe)
        const { data: existing } = await supabase
            .from('agency_tracking_links')
            .select('id')
            .eq('tracking_code', tracking_code)
            .single();

        if (existing) {
            // Generate a new code if collision occurs
            tracking_code = generateTrackingCode() + Date.now().toString().slice(-3);
        }

        // Insert new tracking link with service_id and agency_id
        const { data, error } = await supabase
            .from('agency_tracking_links')
            .insert([
                {
                    agency_id: agency_id,
                    service_id: service_id,
                    name: name.trim(),
                    tracking_code,
                    utm_source: utm_source?.trim() || null,
                    utm_medium: utm_medium?.trim() || null,
                    utm_campaign: utm_campaign?.trim() || null,
                    destination_url: service.line_official_url,
                    is_active: true,
                    visit_count: 0
                }
            ])
            .select()
            .single();

        if (error) {
            console.error('Supabase error:', error);
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: 'Failed to create tracking link: ' + error.message
                })
            };
        }

        // Return success response
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                tracking_code: data.tracking_code,
                tracking_url: `https://agency.ikemen.ltd/t/${data.tracking_code}`,
                service_name: service.name,
                id: data.id,
                name: data.name
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

// Helper function to generate tracking code
function generateTrackingCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';

    for (let i = 0; i < 8; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    return result;
}

// Validate environment variables on cold start
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY');
}