const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
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

        // Get commissions for the agency
        const { data: commissions, error } = await supabase
            .from('agency_commissions')
            .select('*')
            .eq('agency_id', agencyId)
            .order('period_start', { ascending: false });

        if (error) {
            console.error('Error fetching commissions:', error);
            throw error;
        }

        // Calculate totals
        const totalPending = commissions
            .filter(c => c.status === 'pending')
            .reduce((sum, c) => sum + parseFloat(c.commission_amount || 0), 0);

        const totalPaid = commissions
            .filter(c => c.status === 'paid')
            .reduce((sum, c) => sum + parseFloat(c.commission_amount || 0), 0);

        const totalApproved = commissions
            .filter(c => c.status === 'approved')
            .reduce((sum, c) => sum + parseFloat(c.commission_amount || 0), 0);

        // Get current month commission
        const currentDate = new Date();
        const currentMonthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const currentMonthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

        const currentMonthCommission = commissions.find(c => {
            const periodStart = new Date(c.period_start);
            return periodStart >= currentMonthStart && periodStart <= currentMonthEnd;
        });

        // Format commissions (map to HTML expected field names)
        const formattedCommissions = commissions.map(commission => ({
            id: commission.id,
            period: `${formatDate(commission.period_start)} - ${formatDate(commission.period_end)}`,
            period_start: commission.period_start,
            period_end: commission.period_end,
            // HTML expects these field names
            conversions: commission.total_conversions || 0,
            sales: parseFloat(commission.total_sales || 0),
            rate: parseFloat(commission.commission_rate || 0),
            amount: parseFloat(commission.commission_amount || 0),
            // Keep original names for API compatibility
            total_conversions: commission.total_conversions,
            total_sales: parseFloat(commission.total_sales || 0),
            commission_rate: parseFloat(commission.commission_rate),
            commission_amount: parseFloat(commission.commission_amount || 0),
            status: commission.status,
            payment_date: commission.payment_date,
            payment_method: commission.payment_method,
            payment_reference: commission.payment_reference,
            notes: commission.notes
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                commissions: formattedCommissions,
                summary: {
                    totalPending,
                    totalApproved,
                    totalPaid,
                    currentMonth: currentMonthCommission ?
                        parseFloat(currentMonthCommission.commission_amount || 0) : 0
                }
            })
        };

    } catch (error) {
        console.error('Commissions error:', error);

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
                error: '手数料データの取得に失敗しました',
                details: error.message
            })
        };
    }
};

function formatDate(dateString) {
    const date = new Date(dateString);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}