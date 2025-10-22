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
            utm_source,
            utm_medium,
            utm_campaign
        } = JSON.parse(event.body);

        // Get LINE Official URL from environment variable
        const line_friend_url = process.env.LINE_OFFICIAL_URL;

        // 環境変数チェック
        if (!line_friend_url || line_friend_url.includes('@your-line-id')) {
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: 'LINE_OFFICIAL_URL環境変数が設定されていません'
                })
            };
        }

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

        // Generate unique tracking code
        let tracking_code = generateTrackingCode();

        // Check if tracking code already exists (very unlikely but better to be safe)
        const { data: existing } = await supabase
            .from('tracking_links')
            .select('id')
            .eq('tracking_code', tracking_code)
            .single();

        if (existing) {
            // Generate a new code if collision occurs
            tracking_code = generateTrackingCode() + Date.now().toString().slice(-3);
        }

        // Insert new tracking link
        const { data, error } = await supabase
            .from('tracking_links')
            .insert([
                {
                    name: name.trim(),
                    tracking_code,
                    utm_source: utm_source?.trim() || null,
                    utm_medium: utm_medium?.trim() || null,
                    utm_campaign: utm_campaign?.trim() || null,
                    line_friend_url: line_friend_url.trim(),
                    created_at: new Date().toISOString(),
                    is_active: true
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
                tracking_url: `https://taskmateai.net/t/${data.tracking_code}`,
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