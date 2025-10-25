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
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };

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

        if (event.httpMethod === 'GET') {
            // Get agency settings
            const { data: agency, error } = await supabase
                .from('agencies')
                .select('*')
                .eq('id', agencyId)
                .single();

            if (error) {
                console.error('Error fetching settings:', error);
                throw error;
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    agencyInfo: {
                        id: agency.id,
                        code: agency.code,
                        name: agency.name,
                        company_name: agency.company_name,
                        contact_email: agency.contact_email,
                        contact_phone: agency.contact_phone,
                        address: agency.address,
                        commission_rate: agency.commission_rate
                    },
                    paymentInfo: agency.payment_info || {},
                    settings: agency.settings || {}
                })
            };
        }

        if (event.httpMethod === 'POST') {
            const { agencyInfo, paymentInfo } = JSON.parse(event.body);

            // Update agency settings
            const updateData = {};

            if (agencyInfo) {
                if (agencyInfo.name) updateData.name = agencyInfo.name;
                if (agencyInfo.company_name) updateData.company_name = agencyInfo.company_name;
                if (agencyInfo.contact_email) updateData.contact_email = agencyInfo.contact_email;
                if (agencyInfo.contact_phone) updateData.contact_phone = agencyInfo.contact_phone;
                if (agencyInfo.address) updateData.address = agencyInfo.address;
            }

            if (paymentInfo) {
                updateData.payment_info = paymentInfo;
            }

            const { data, error } = await supabase
                .from('agencies')
                .update(updateData)
                .eq('id', agencyId)
                .select()
                .single();

            if (error) {
                console.error('Error updating settings:', error);
                throw error;
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    message: '設定を更新しました',
                    agency: data
                })
            };
        }

        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };

    } catch (error) {
        console.error('Settings error:', error);

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
                error: '設定の処理に失敗しました',
                details: error.message
            })
        };
    }
};