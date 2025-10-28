const jwt = require('jsonwebtoken');
const { getCorsHeaders } = require('./utils/cors-headers');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    const headers = getCorsHeaders(event, {
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agency-Id',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    });

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // JWT認証
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
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!agencyId || decoded.agencyId !== agencyId) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'アクセス権限がありません' })
            };
        }

        // クエリパラメータ
        const params = event.queryStringParameters || {};
        const status = params.status; // draft, issued, sent, paid, cancelled
        const limit = parseInt(params.limit) || 50;
        const offset = parseInt(params.offset) || 0;

        // 請求書一覧取得
        let query = supabase
            .from('invoices')
            .select(`
                id,
                invoice_number,
                invoice_date,
                payment_due_date,
                agency_name,
                period_start,
                period_end,
                subtotal,
                tax_amount,
                withholding_tax_amount,
                total_amount,
                status,
                is_qualified_invoice,
                email_sent_at,
                email_status,
                pdf_generated_at,
                created_at
            `)
            .eq('agency_id', agencyId)
            .order('invoice_date', { ascending: false })
            .range(offset, offset + limit - 1);

        if (status) {
            query = query.eq('status', status);
        }

        const { data: invoices, error: invoicesError } = await query;

        if (invoicesError) {
            throw invoicesError;
        }

        // 各請求書の明細件数を取得
        const invoiceIds = invoices.map(inv => inv.id);

        let itemCounts = {};
        if (invoiceIds.length > 0) {
            const { data: items, error: itemsError } = await supabase
                .from('invoice_items')
                .select('invoice_id')
                .in('invoice_id', invoiceIds);

            if (!itemsError && items) {
                itemCounts = items.reduce((acc, item) => {
                    acc[item.invoice_id] = (acc[item.invoice_id] || 0) + 1;
                    return acc;
                }, {});
            }
        }

        // フォーマット
        const formattedInvoices = invoices.map(invoice => ({
            ...invoice,
            item_count: itemCounts[invoice.id] || 0,
            period: `${formatDate(invoice.period_start)} - ${formatDate(invoice.period_end)}`,
            formatted_invoice_date: formatDate(invoice.invoice_date),
            formatted_payment_due_date: formatDate(invoice.payment_due_date)
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                invoices: formattedInvoices,
                pagination: {
                    limit,
                    offset,
                    total: formattedInvoices.length
                }
            })
        };

    } catch (error) {
        console.error('請求書一覧取得エラー:', error);

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
                error: '請求書一覧の取得に失敗しました',
                details: error.message
            })
        };
    }
};

function formatDate(dateString) {
    const date = new Date(dateString);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
