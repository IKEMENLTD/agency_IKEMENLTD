const { createClient } = require('@supabase/supabase-js');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const jwt = require('jsonwebtoken');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event, context) => {
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

    if (!['GET', 'POST'].includes(event.httpMethod)) {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // Verify JWT token for agency access
        const token = event.headers.authorization?.replace('Bearer ', '');
        const agencyId = event.headers['x-agency-id'];

        if (!token || !agencyId) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: '認証が必要です' })
            };
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: '無効なトークンです' })
            };
        }

        // Verify agency ID matches token
        if (decoded.agencyId !== agencyId) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'アクセス権限がありません' })
            };
        }

        let result;

        switch (event.httpMethod) {
            case 'GET':
                result = await getCommissionData(agencyId, event.queryStringParameters);
                break;
            case 'POST':
                result = await calculateCommission(agencyId, JSON.parse(event.body));
                break;
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('Commission API error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'サーバーエラーが発生しました' })
        };
    }
};

// Get commission data for agency
async function getCommissionData(agencyId, queryParams) {
    const period = queryParams?.period || 'current_month';
    const year = queryParams?.year ? parseInt(queryParams.year) : new Date().getFullYear();
    const month = queryParams?.month ? parseInt(queryParams.month) : new Date().getMonth() + 1;

    let periodStart, periodEnd;

    switch (period) {
        case 'current_month':
            periodStart = new Date(year, month - 1, 1);
            periodEnd = new Date(year, month, 0);
            break;
        case 'last_month':
            const lastMonth = month === 1 ? 12 : month - 1;
            const lastMonthYear = month === 1 ? year - 1 : year;
            periodStart = new Date(lastMonthYear, lastMonth - 1, 1);
            periodEnd = new Date(lastMonthYear, lastMonth, 0);
            break;
        case 'current_year':
            periodStart = new Date(year, 0, 1);
            periodEnd = new Date(year, 11, 31);
            break;
        case 'custom':
            periodStart = new Date(queryParams.start_date);
            periodEnd = new Date(queryParams.end_date);
            break;
        default:
            periodStart = new Date(year, month - 1, 1);
            periodEnd = new Date(year, month, 0);
    }

    // Get basic commission data
    const { data: commissionData } = await supabase
        .rpc('calculate_agency_commission', {
            p_agency_id: agencyId,
            p_period_start: periodStart.toISOString().split('T')[0],
            p_period_end: periodEnd.toISOString().split('T')[0]
        });

    // Get detailed conversions
    const { data: conversions } = await supabase
        .from('agency_conversions')
        .select(`
            *,
            agency_tracking_links (
                name,
                tracking_code,
                utm_campaign
            ),
            stripe_payments (
                amount_total,
                currency,
                payment_status
            )
        `)
        .eq('agency_id', agencyId)
        .gte('created_at', periodStart.toISOString())
        .lte('created_at', periodEnd.toISOString())
        .order('created_at', { ascending: false });

    // Get payment statistics
    const { data: paymentStats } = await supabase
        .from('stripe_payments')
        .select('amount_total, payment_status, created_at')
        .eq('agency_id', agencyId)
        .eq('payment_status', 'succeeded')
        .gte('created_at', periodStart.toISOString())
        .lte('created_at', periodEnd.toISOString());

    // Calculate summary statistics
    const totalRevenue = paymentStats?.reduce((sum, payment) => sum + payment.amount_total, 0) || 0;
    const lineConversions = conversions?.filter(c => c.conversion_type === 'line_friend').length || 0;
    const paymentConversions = conversions?.filter(c => c.conversion_type === 'stripe_payment').length || 0;

    // Get funnel analysis
    const { data: funnelData } = await supabase
        .from('conversion_funnels')
        .select('step_name, created_at')
        .eq('agency_id', agencyId)
        .gte('created_at', periodStart.toISOString())
        .lte('created_at', periodEnd.toISOString());

    const funnelStats = {
        visits: funnelData?.filter(f => f.step_name === 'visit').length || 0,
        line_friends: funnelData?.filter(f => f.step_name === 'line_friend').length || 0,
        payments: funnelData?.filter(f => f.step_name === 'payment').length || 0
    };

    // Calculate conversion rates
    const visitToLineRate = funnelStats.visits > 0 ?
        ((funnelStats.line_friends / funnelStats.visits) * 100).toFixed(2) : 0;
    const lineToPaymentRate = funnelStats.line_friends > 0 ?
        ((funnelStats.payments / funnelStats.line_friends) * 100).toFixed(2) : 0;
    const overallConversionRate = funnelStats.visits > 0 ?
        ((funnelStats.payments / funnelStats.visits) * 100).toFixed(2) : 0;

    return {
        success: true,
        period: {
            start: periodStart.toISOString().split('T')[0],
            end: periodEnd.toISOString().split('T')[0],
            type: period
        },
        commission: commissionData?.[0] || {
            agency_id: agencyId,
            total_payments: 0,
            total_revenue_cents: 0,
            commission_rate: 0,
            commission_amount: 0
        },
        summary: {
            total_revenue_yen: Math.round(totalRevenue / 100),
            total_revenue_cents: totalRevenue,
            line_conversions: lineConversions,
            payment_conversions: paymentConversions,
            total_conversions: lineConversions + paymentConversions
        },
        funnel: {
            visits: funnelStats.visits,
            line_friends: funnelStats.line_friends,
            payments: funnelStats.payments,
            visit_to_line_rate: parseFloat(visitToLineRate),
            line_to_payment_rate: parseFloat(lineToPaymentRate),
            overall_conversion_rate: parseFloat(overallConversionRate)
        },
        conversions: conversions || [],
        payment_history: paymentStats || []
    };
}

// Calculate and process commission for a period
async function calculateCommission(agencyId, data) {
    const { period_start, period_end, auto_approve = false } = data;

    try {
        // Get or create commission record
        let { data: existingCommission, error: fetchError } = await supabase
            .from('agency_commissions')
            .select('*')
            .eq('agency_id', agencyId)
            .eq('period_start', period_start)
            .eq('period_end', period_end)
            .single();

        if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows returned
            throw fetchError;
        }

        // Calculate commission using database function
        const { data: calculatedCommission } = await supabase
            .rpc('calculate_agency_commission', {
                p_agency_id: agencyId,
                p_period_start: period_start,
                p_period_end: period_end
            });

        if (!calculatedCommission || calculatedCommission.length === 0) {
            throw new Error('Failed to calculate commission');
        }

        const commissionInfo = calculatedCommission[0];

        if (existingCommission) {
            // Update existing commission record
            const { data: updatedCommission, error: updateError } = await supabase
                .from('agency_commissions')
                .update({
                    total_conversions: commissionInfo.total_payments,
                    total_sales: commissionInfo.total_revenue_cents / 100,
                    commission_rate: commissionInfo.commission_rate,
                    commission_amount: commissionInfo.commission_amount,
                    status: auto_approve ? 'approved' : 'pending',
                    updated_at: new Date().toISOString()
                })
                .eq('id', existingCommission.id)
                .select()
                .single();

            if (updateError) {
                throw updateError;
            }

            return {
                success: true,
                commission: updatedCommission,
                message: 'Commission updated successfully',
                calculated: commissionInfo
            };
        } else {
            // Create new commission record
            const { data: newCommission, error: insertError } = await supabase
                .from('agency_commissions')
                .insert([{
                    agency_id: agencyId,
                    period_start,
                    period_end,
                    total_conversions: commissionInfo.total_payments,
                    total_sales: commissionInfo.total_revenue_cents / 100,
                    commission_rate: commissionInfo.commission_rate,
                    commission_amount: commissionInfo.commission_amount,
                    status: auto_approve ? 'approved' : 'pending'
                }])
                .select()
                .single();

            if (insertError) {
                throw insertError;
            }

            return {
                success: true,
                commission: newCommission,
                message: 'Commission calculated and recorded',
                calculated: commissionInfo
            };
        }

    } catch (error) {
        console.error('Error calculating commission:', error);
        throw error;
    }
}

// Validate environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
}