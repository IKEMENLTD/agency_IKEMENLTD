const { getCorsHeaders } = require('./utils/cors-headers');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    const headers = getCorsHeaders(event, {
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
    });

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // 管理者認証チェック
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
        if (event.httpMethod === 'GET') {
            // サービス一覧取得
            const { data: services, error } = await supabase
                .from('services')
                .select('*')
                .order('created_at', { ascending: true });

            if (error) {
                throw error;
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ services })
            };
        }

        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };

    } catch (error) {
        console.error('サービス一覧取得エラー:', error);
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
