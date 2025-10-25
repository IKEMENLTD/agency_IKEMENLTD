const { getSecureCookieOptions } = require('./utils/csrf-protection');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');

exports.handler = async (event) => {
    // CORS headers
    const headers = getCorsHeaders(event, {
        // Secure CORS - see getCorsHeaders(),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Credentials': 'true'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // セキュアなCookie設定を取得（期限切れに設定してクリア）
        const cookieOptions = getSecureCookieOptions().replace('Max-Age=604800', 'Max-Age=0');

        // HttpOnly Cookieをクリア（期限切れにする）
        const clearCookieHeaders = [
            `agencyAuthToken=; ${cookieOptions}`,
            `agencyId=; ${cookieOptions.replace('HttpOnly; ', '')}`
        ];

        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Set-Cookie': clearCookieHeaders.join(', ')
            },
            body: JSON.stringify({
                success: true,
                message: 'ログアウトしました'
            })
        };
    } catch (error) {
        console.error('Logout error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'ログアウト処理中にエラーが発生しました'
            })
        };
    }
};
