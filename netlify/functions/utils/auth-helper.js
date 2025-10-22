/**
 * 認証ヘルパーユーティリティ
 * Cookie-based認証とHeader-based認証の両方をサポート
 */

const jwt = require('jsonwebtoken');

/**
 * CookieヘッダーからCookieを解析
 * @param {string} cookieHeader - Cookie ヘッダー文字列
 * @returns {Object} Cookie名と値のマップ
 */
function parseCookies(cookieHeader) {
    if (!cookieHeader) return {};

    return cookieHeader
        .split(';')
        .map(cookie => cookie.trim())
        .reduce((acc, cookie) => {
            const [name, value] = cookie.split('=');
            if (name && value) {
                acc[name] = decodeURIComponent(value);
            }
            return acc;
        }, {});
}

/**
 * リクエストから認証トークンを取得（Cookie優先、フォールバックでHeader）
 * @param {Object} event - Netlify Function eventオブジェクト
 * @returns {string|null} JWT トークン
 */
function getAuthToken(event) {
    // 1. Cookieから取得を試みる（推奨方法）
    const cookieHeader = event.headers.cookie || event.headers.Cookie;
    if (cookieHeader) {
        const cookies = parseCookies(cookieHeader);
        if (cookies.agencyAuthToken) {
            return cookies.agencyAuthToken;
        }
    }

    // 2. フォールバック: Authorizationヘッダーから取得（下位互換性）
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.replace('Bearer ', '');
    }

    return null;
}

/**
 * リクエストからAgency IDを取得（Cookie優先、フォールバックでHeader）
 * @param {Object} event - Netlify Function eventオブジェクト
 * @returns {string|null} Agency ID
 */
function getAgencyId(event) {
    // 1. Cookieから取得を試みる（推奨方法）
    const cookieHeader = event.headers.cookie || event.headers.Cookie;
    if (cookieHeader) {
        const cookies = parseCookies(cookieHeader);
        if (cookies.agencyId) {
            return cookies.agencyId;
        }
    }

    // 2. フォールバック: X-Agency-Idヘッダーから取得（下位互換性）
    return event.headers['x-agency-id'] || event.headers['X-Agency-Id'];
}

/**
 * JWTトークンを検証してデコード
 * @param {string} token - JWT トークン
 * @returns {Object} { valid: boolean, decoded: Object|null, error: string|null }
 */
function verifyToken(token) {
    if (!token) {
        return {
            valid: false,
            decoded: null,
            error: 'No token provided'
        };
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret');
        return {
            valid: true,
            decoded,
            error: null
        };
    } catch (error) {
        return {
            valid: false,
            decoded: null,
            error: error.message
        };
    }
}

/**
 * リクエストを認証してユーザー情報を取得
 * @param {Object} event - Netlify Function eventオブジェクト
 * @returns {Object} { authenticated: boolean, user: Object|null, agencyId: string|null, error: string|null }
 */
function authenticateRequest(event) {
    const token = getAuthToken(event);
    const agencyId = getAgencyId(event);

    if (!token) {
        return {
            authenticated: false,
            user: null,
            agencyId: null,
            error: 'No authentication token provided'
        };
    }

    if (!agencyId) {
        return {
            authenticated: false,
            user: null,
            agencyId: null,
            error: 'No agency ID provided'
        };
    }

    const { valid, decoded, error } = verifyToken(token);

    if (!valid) {
        return {
            authenticated: false,
            user: null,
            agencyId: null,
            error: `Invalid token: ${error}`
        };
    }

    // Agency IDがトークン内のIDと一致するか確認
    if (decoded.agencyId !== agencyId) {
        return {
            authenticated: false,
            user: null,
            agencyId: null,
            error: 'Agency ID mismatch'
        };
    }

    return {
        authenticated: true,
        user: {
            userId: decoded.userId,
            agencyId: decoded.agencyId,
            email: decoded.email,
            role: decoded.role
        },
        agencyId: decoded.agencyId,
        error: null
    };
}

/**
 * 認証エラーレスポンスを生成
 * @param {string} error - エラーメッセージ
 * @param {number} statusCode - HTTPステータスコード (デフォルト: 401)
 * @returns {Object} Netlify Function response
 */
function createAuthErrorResponse(error, statusCode = 401) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff'
        },
        body: JSON.stringify({
            error: '認証エラー',
            details: process.env.NODE_ENV === 'development' ? error : undefined
        })
    };
}

/**
 * Cookieをクリア（ログアウト時）
 * @returns {Array<string>} Set-Cookie ヘッダー配列
 */
function clearAuthCookies() {
    const expiredCookie = 'Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';

    return [
        `agencyAuthToken=; ${expiredCookie}; HttpOnly; Secure; SameSite=Strict`,
        `agencyId=; ${expiredCookie}; Secure; SameSite=Strict`
    ];
}

module.exports = {
    parseCookies,
    getAuthToken,
    getAgencyId,
    verifyToken,
    authenticateRequest,
    createAuthErrorResponse,
    clearAuthCookies
};
