const { getCorsHeaders } = require('./utils/cors-headers');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    const headers = getCorsHeaders(event, {
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // 管理者認証チェック（簡易版）
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: '認証が必要です' })
        };
    }

    const credentials = Buffer.from(authHeader.substring(6), 'base64').toString();
    const [username, password] = credentials.split(':');

    if (username !== (process.env.ADMIN_USERNAME || 'admin') ||
        password !== (process.env.ADMIN_PASSWORD || 'TaskMate2024Admin!')) {
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: '認証に失敗しました' })
        };
    }

    try {
        const { httpMethod, path } = event;
        const pathSegments = path.split('/').filter(Boolean);
        const commissionId = pathSegments[pathSegments.length - 1];

        // GET: コミッション一覧取得
        if (httpMethod === 'GET' && !commissionId) {
            return await getCommissions(event, headers);
        }

        // GET: 特定のコミッション取得
        if (httpMethod === 'GET' && commissionId) {
            return await getCommission(commissionId, headers);
        }

        // POST: コミッション手動作成
        if (httpMethod === 'POST') {
            return await createCommission(event, headers);
        }

        // PUT: コミッション更新（承認/否認/金額変更）
        if (httpMethod === 'PUT' && commissionId) {
            return await updateCommission(commissionId, event, headers);
        }

        // DELETE: コミッション削除
        if (httpMethod === 'DELETE' && commissionId) {
            return await deleteCommission(commissionId, headers);
        }

        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };

    } catch (error) {
        console.error('管理画面コミッションAPI エラー:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'サーバーエラーが発生しました',
                details: error.message
            })
        };
    }
};

// コミッション一覧取得
async function getCommissions(event, headers) {
    const params = event.queryStringParameters || {};
    const status = params.status; // pending, approved, paid, rejected
    const agency_id = params.agency_id;
    const service_id = params.service_id;
    const limit = parseInt(params.limit) || 100;
    const offset = parseInt(params.offset) || 0;

    let query = supabase
        .from('agency_commissions')
        .select(`
            *,
            agencies (
                id,
                code,
                name,
                contact_email
            ),
            services (
                id,
                code,
                name,
                line_official_url
            )
        `)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (status) {
        query = query.eq('status', status);
    }

    if (agency_id) {
        query = query.eq('agency_id', agency_id);
    }

    if (service_id) {
        query = query.eq('service_id', service_id);
    }

    const { data: commissions, error } = await query;

    if (error) {
        throw error;
    }

    // 統計情報を計算
    const stats = {
        total: commissions.length,
        pending: commissions.filter(c => c.status === 'pending').length,
        approved: commissions.filter(c => c.status === 'approved').length,
        paid: commissions.filter(c => c.status === 'paid').length,
        rejected: commissions.filter(c => c.status === 'rejected').length,
        total_amount: commissions
            .filter(c => c.status === 'approved' || c.status === 'paid')
            .reduce((sum, c) => sum + parseFloat(c.commission_amount || 0), 0)
    };

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
            commissions,
            stats,
            pagination: {
                limit,
                offset,
                total: commissions.length
            }
        })
    };
}

// 特定のコミッション取得
async function getCommission(commissionId, headers) {
    const { data: commission, error } = await supabase
        .from('agency_commissions')
        .select(`
            *,
            agencies (
                id,
                code,
                name,
                contact_email,
                entity_type,
                payment_info
            ),
            services (
                id,
                code,
                name,
                default_commission_rate,
                line_official_url
            )
        `)
        .eq('id', commissionId)
        .single();

    if (error || !commission) {
        return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'コミッションが見つかりません' })
        };
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ commission })
    };
}

// コミッション手動作成
async function createCommission(event, headers) {
    const body = JSON.parse(event.body || '{}');
    const {
        agency_id,
        service_id,
        period_start,
        period_end,
        total_conversions,
        total_sales,
        gross_profit,
        commission_rate,
        commission_amount,
        notes
    } = body;

    // バリデーション
    if (!agency_id || !service_id || !period_start || !period_end) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
                error: '必須項目が不足しています',
                required: ['agency_id', 'service_id', 'period_start', 'period_end']
            })
        };
    }

    // 代理店情報を取得
    const { data: agency, error: agencyError } = await supabase
        .from('agencies')
        .select('*')
        .eq('id', agency_id)
        .single();

    if (agencyError || !agency) {
        return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: '代理店が見つかりません' })
        };
    }

    // サービス情報を取得
    const { data: service, error: serviceError } = await supabase
        .from('services')
        .select('*')
        .eq('id', service_id)
        .single();

    if (serviceError || !service) {
        return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'サービスが見つかりません' })
        };
    }

    // コミッション率が指定されていない場合はサービスのデフォルト値を使用
    const finalCommissionRate = commission_rate || service.default_commission_rate || 20.00;

    // コミッション金額を計算（粗利益ベース）
    let finalCommissionAmount = commission_amount;
    if (!finalCommissionAmount && gross_profit) {
        finalCommissionAmount = Math.floor(gross_profit * (finalCommissionRate / 100));
    }

    // コミッション作成
    const { data: newCommission, error: insertError } = await supabase
        .from('agency_commissions')
        .insert({
            agency_id,
            service_id,
            period_start,
            period_end,
            total_conversions: total_conversions || 0,
            total_sales: total_sales || 0,
            gross_profit: gross_profit || 0,
            commission_rate: finalCommissionRate,
            commission_amount: finalCommissionAmount || 0,
            status: 'pending',
            notes: notes || null
        })
        .select()
        .single();

    if (insertError) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'コミッションの作成に失敗しました',
                details: insertError.message
            })
        };
    }

    return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
            success: true,
            commission: newCommission,
            message: 'コミッションを作成しました'
        })
    };
}

// コミッション更新（承認/否認/金額変更）
async function updateCommission(commissionId, event, headers) {
    const body = JSON.parse(event.body || '{}');
    const {
        status,
        commission_amount,
        commission_rate,
        gross_profit,
        notes,
        payment_date,
        payment_method,
        payment_reference
    } = body;

    const updateData = {};

    if (status) {
        // ステータス検証
        const validStatuses = ['pending', 'approved', 'paid', 'rejected', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: '無効なステータスです',
                    valid_statuses: validStatuses
                })
            };
        }
        updateData.status = status;
    }

    if (commission_amount !== undefined) updateData.commission_amount = commission_amount;
    if (commission_rate !== undefined) updateData.commission_rate = commission_rate;
    if (gross_profit !== undefined) updateData.gross_profit = gross_profit;
    if (notes !== undefined) updateData.notes = notes;
    if (payment_date) updateData.payment_date = payment_date;
    if (payment_method) updateData.payment_method = payment_method;
    if (payment_reference) updateData.payment_reference = payment_reference;

    updateData.updated_at = new Date().toISOString();

    const { data: updatedCommission, error } = await supabase
        .from('agency_commissions')
        .update(updateData)
        .eq('id', commissionId)
        .select()
        .single();

    if (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'コミッションの更新に失敗しました',
                details: error.message
            })
        };
    }

    if (!updatedCommission) {
        return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'コミッションが見つかりません' })
        };
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
            success: true,
            commission: updatedCommission,
            message: 'コミッションを更新しました'
        })
    };
}

// コミッション削除
async function deleteCommission(commissionId, headers) {
    const { error } = await supabase
        .from('agency_commissions')
        .delete()
        .eq('id', commissionId);

    if (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'コミッションの削除に失敗しました',
                details: error.message
            })
        };
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
            success: true,
            message: 'コミッションを削除しました'
        })
    };
}
