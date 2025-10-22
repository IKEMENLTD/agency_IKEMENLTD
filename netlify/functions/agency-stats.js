const { createClient } = require('@supabase/supabase-js');
const { authenticateRequest, createAuthErrorResponse } = require('./utils/auth-helper');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agency-Id',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Credentials': 'true',  // Cookie認証のために必要
        'X-Content-Type-Options': 'nosniff'
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

    try {
        // Cookie-based認証（Header-basedもフォールバックでサポート）
        const auth = authenticateRequest(event);

        if (!auth.authenticated) {
            return createAuthErrorResponse(auth.error);
        }

        const agencyId = auth.agencyId;

        // Multi-service support: Get service_id from query params
        const queryParams = event.queryStringParameters || {};
        const serviceId = queryParams.service_id;
        const filterByService = serviceId && serviceId !== 'all';

        // Get total links count
        let linksQuery = supabase
            .from('agency_tracking_links')
            .select('*', { count: 'exact', head: true })
            .eq('agency_id', agencyId);

        if (filterByService) {
            linksQuery = linksQuery.eq('service_id', serviceId);
        }

        const { count: totalLinks } = await linksQuery;

        // Get total clicks (visits)
        let clickQuery = supabase
            .from('agency_tracking_links')
            .select('visit_count')
            .eq('agency_id', agencyId);

        if (filterByService) {
            clickQuery = clickQuery.eq('service_id', serviceId);
        }

        const { data: clickData } = await clickQuery;

        const totalClicks = clickData?.reduce((sum, link) => sum + (link.visit_count || 0), 0) || 0;

        // Get total conversions
        let conversionQuery = supabase
            .from('agency_tracking_links')
            .select('conversion_count')
            .eq('agency_id', agencyId);

        if (filterByService) {
            conversionQuery = conversionQuery.eq('service_id', serviceId);
        }

        const { data: conversionData } = await conversionQuery;

        const totalConversions = conversionData?.reduce((sum, link) => sum + (link.conversion_count || 0), 0) || 0;

        // Calculate conversion rate
        const conversionRate = totalClicks > 0
            ? Math.round((totalConversions / totalClicks) * 100 * 10) / 10
            : 0;

        // Get current month commission
        const currentDate = new Date();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

        let currentMonthQuery = supabase
            .from('agency_commissions')
            .select('commission_amount')
            .eq('agency_id', agencyId)
            .gte('period_start', startOfMonth.toISOString())
            .lte('period_end', endOfMonth.toISOString());

        if (filterByService) {
            currentMonthQuery = currentMonthQuery.eq('service_id', serviceId);
        }

        const { data: currentMonthCommission } = await currentMonthQuery.single();

        // Get last month commission
        const startOfLastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
        const endOfLastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0);

        let lastMonthQuery = supabase
            .from('agency_commissions')
            .select('commission_amount')
            .eq('agency_id', agencyId)
            .gte('period_start', startOfLastMonth.toISOString())
            .lte('period_end', endOfLastMonth.toISOString());

        if (filterByService) {
            lastMonthQuery = lastMonthQuery.eq('service_id', serviceId);
        }

        const { data: lastMonthCommission } = await lastMonthQuery.single();

        // Get total commission
        let totalCommissionQuery = supabase
            .from('agency_commissions')
            .select('commission_amount')
            .eq('agency_id', agencyId)
            .eq('status', 'paid');

        if (filterByService) {
            totalCommissionQuery = totalCommissionQuery.eq('service_id', serviceId);
        }

        const { data: totalCommissionData } = await totalCommissionQuery;

        const totalCommission = totalCommissionData?.reduce(
            (sum, commission) => sum + (commission.commission_amount || 0), 0
        ) || 0;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                totalLinks: totalLinks || 0,
                totalClicks,
                totalConversions,
                conversionRate,
                monthlyCommission: currentMonthCommission?.commission_amount || 0,
                lastMonthCommission: lastMonthCommission?.commission_amount || 0,
                totalCommission
            })
        };
    } catch (error) {
        console.error('Stats error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: '統計情報の取得に失敗しました'
            })
        };
    }
};