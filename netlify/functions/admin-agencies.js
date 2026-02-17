const { createClient } = require('@supabase/supabase-js');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    const headers = getCorsHeaders(event, {
        // Secure CORS - see getCorsHeaders(),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    // Simple admin authentication check
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer admin:')) {
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: 'Unauthorized' })
        };
    }

    if (event.httpMethod === 'GET') {
        try {
            // Fetch all agencies with owner information
            const { data: agencies, error } = await supabase
                .from('agencies')
                .select(`
                    *,
                    agency_users!inner(
                        name,
                        email
                    )
                `)
                .eq('agency_users.role', 'owner')
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Format the response
            const formattedAgencies = agencies.map(agency => ({
                id: agency.id,
                code: agency.code,
                name: agency.name,
                company_name: agency.company_name,
                contact_email: agency.contact_email,
                contact_phone: agency.contact_phone,
                address: agency.address,
                status: agency.status || 'pending',
                commission_rate: agency.commission_rate,
                created_at: agency.created_at,
                owner_name: agency.agency_users[0]?.name || 'N/A',
                owner_email: agency.agency_users[0]?.email || agency.contact_email
            }));

            // Calculate statistics
            const stats = {
                total: formattedAgencies.length,
                pending_approval: formattedAgencies.filter(a => a.status === 'pending_approval').length,
                pending: formattedAgencies.filter(a => ['pending', 'pending_line_verification', 'pending_friend_add'].includes(a.status)).length,
                active: formattedAgencies.filter(a => a.status === 'active').length,
                rejected: formattedAgencies.filter(a => a.status === 'rejected').length,
                suspended: formattedAgencies.filter(a => a.status === 'suspended').length
            };

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    agencies: formattedAgencies,
                    stats
                })
            };

        } catch (error) {
            console.error('Error fetching agencies:', error);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Failed to fetch agencies' })
            };
        }
    }

    if (event.httpMethod === 'POST') {
        try {
            const { action, agencyId } = JSON.parse(event.body);

            if (!action || !agencyId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Missing action or agencyId' })
                };
            }

            let newStatus;
            switch (action) {
                case 'approve':
                    newStatus = 'active';
                    break;
                case 'reject':
                    newStatus = 'rejected';
                    break;
                case 'suspend':
                    newStatus = 'suspended';
                    break;
                case 'activate':
                    newStatus = 'active';
                    break;
                default:
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({ error: 'Invalid action' })
                    };
            }

            // Update agency status
            const { data, error } = await supabase
                .from('agencies')
                .update({
                    status: newStatus,
                    updated_at: new Date().toISOString()
                })
                .eq('id', agencyId)
                .select()
                .single();

            if (error) throw error;

            // If approving, also activate the owner user account
            if (action === 'approve') {
                await supabase
                    .from('agency_users')
                    .update({ is_active: true })
                    .eq('agency_id', agencyId)
                    .eq('role', 'owner');
            }

            // If rejecting or suspending, deactivate all user accounts
            if (action === 'reject' || action === 'suspend') {
                await supabase
                    .from('agency_users')
                    .update({ is_active: false })
                    .eq('agency_id', agencyId);
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    agency: data,
                    message: `代理店を${getActionMessage(action)}しました`
                })
            };

        } catch (error) {
            console.error('Error updating agency:', error);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Failed to update agency status' })
            };
        }
    }

    return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Method not allowed' })
    };
};

function getActionMessage(action) {
    const messages = {
        'approve': '承認',
        'reject': '非承認',
        'suspend': '一時停止',
        'activate': '再開'
    };
    return messages[action] || action;
}