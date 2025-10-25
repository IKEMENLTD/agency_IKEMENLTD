exports.handler = async (event, context) => {
    // CORS対応
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                // Secure CORS - see getCorsHeaders(),
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            }
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { username, password } = JSON.parse(event.body);

        // 環境変数から認証情報を取得
        const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TaskMate2024Admin!';

        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            return {
                statusCode: 200,
                headers: {
                    // Secure CORS - see getCorsHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    success: true,
                    token: 'authenticated'
                })
            };
        } else {
            return {
                statusCode: 401,
                headers: {
                    // Secure CORS - see getCorsHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid credentials'
                })
            };
        }
    } catch (error) {
        return {
            statusCode: 500,
            headers: {
                // Secure CORS - see getCorsHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                error: 'Server error',
                details: error.message
            })
        };
    }
};