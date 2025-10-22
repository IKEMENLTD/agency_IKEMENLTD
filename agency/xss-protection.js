/**
 * XSS Protection Utility
 * クライアントサイドでのXSS攻撃防止用ユーティリティ
 */

/**
 * HTML特殊文字をエスケープ
 * @param {string} unsafe - エスケープ対象の文字列
 * @returns {string} エスケープされた安全な文字列
 */
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
        return unsafe;
    }

    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;'
    };

    return unsafe.replace(/[&<>"'\/]/g, (char) => map[char]);
}

/**
 * URLパラメータをサニタイズ
 * @param {string} param - URLパラメータ
 * @returns {string} サニタイズされたパラメータ
 */
function sanitizeUrlParam(param) {
    if (typeof param !== 'string') {
        return '';
    }

    // 危険な文字を除去
    return param.replace(/[<>'"]/g, '');
}

/**
 * URLが安全かどうか検証
 * @param {string} url - 検証対象のURL
 * @returns {boolean} 安全ならtrue
 */
function isSafeUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }

    // javascript:, data:, vbscript: などの危険なプロトコルを拒否
    const dangerousProtocols = /^(javascript|data|vbscript|file|about):/i;
    if (dangerousProtocols.test(url.trim())) {
        return false;
    }

    // 相対URLまたはhttp(s)のみ許可
    return /^(https?:)?\/\//i.test(url) || /^\/[^\/]/.test(url) || /^[^:/?#]+/.test(url);
}

/**
 * HTMLコンテンツをサニタイズ（基本的なホワイトリスト方式）
 * @param {string} dirty - サニタイズ対象のHTML
 * @returns {string} サニタイズされたHTML
 */
function sanitizeHtml(dirty) {
    if (typeof dirty !== 'string') {
        return '';
    }

    // 許可するタグのホワイトリスト
    const allowedTags = ['b', 'i', 'em', 'strong', 'span', 'p', 'br', 'ul', 'ol', 'li'];
    const tagPattern = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;

    return dirty.replace(tagPattern, (match, tagName) => {
        if (allowedTags.includes(tagName.toLowerCase())) {
            // 許可されたタグは属性を除去して返す
            return `<${tagName}>`;
        }
        // 許可されないタグはエスケープ
        return escapeHtml(match);
    });
}

/**
 * オブジェクトの全プロパティをサニタイズ
 * @param {Object} obj - サニタイズ対象のオブジェクト
 * @returns {Object} サニタイズされたオブジェクト
 */
function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') {
        return obj;
    }

    const sanitized = Array.isArray(obj) ? [] : {};

    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const value = obj[key];

            if (typeof value === 'string') {
                sanitized[key] = escapeHtml(value);
            } else if (typeof value === 'object' && value !== null) {
                sanitized[key] = sanitizeObject(value);
            } else {
                sanitized[key] = value;
            }
        }
    }

    return sanitized;
}

/**
 * JSON文字列をパースしてサニタイズ
 * @param {string} jsonString - JSON文字列
 * @returns {Object} サニタイズされたオブジェクト
 */
function sanitizeJson(jsonString) {
    try {
        const obj = JSON.parse(jsonString);
        return sanitizeObject(obj);
    } catch (error) {
        console.error('JSON parse error:', error);
        return null;
    }
}

/**
 * Alpine.jsのx-text用に安全な文字列を返す
 * @param {string} text - 表示するテキスト
 * @returns {string} エスケープされたテキスト
 */
function safeText(text) {
    return escapeHtml(text);
}

/**
 * イベントハンドラー用の安全な値を返す
 * @param {string} value - 検証する値
 * @param {string} type - 値の型 ('url', 'number', 'email' など)
 * @returns {string|null} 安全な値、または null
 */
function validateInput(value, type = 'text') {
    if (!value || typeof value !== 'string') {
        return null;
    }

    switch (type) {
        case 'url':
            return isSafeUrl(value) ? value : null;

        case 'email':
            const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            return emailPattern.test(value) ? value : null;

        case 'number':
            const num = parseFloat(value);
            return !isNaN(num) ? num : null;

        case 'alphanumeric':
            const alphanumericPattern = /^[a-zA-Z0-9_-]+$/;
            return alphanumericPattern.test(value) ? value : null;

        default:
            return escapeHtml(value);
    }
}

/**
 * DOMPurifyが利用可能な場合はそれを使用、なければフォールバック
 * @param {string} dirty - サニタイズ対象のHTML
 * @returns {string} サニタイズされたHTML
 */
function purifyHtml(dirty) {
    // DOMPurifyがロードされているかチェック
    if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(dirty, {
            ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'span', 'p', 'br', 'ul', 'ol', 'li', 'a'],
            ALLOWED_ATTR: ['href', 'title', 'target'],
            ALLOW_DATA_ATTR: false
        });
    }

    // フォールバック: 基本的なサニタイゼーション
    return sanitizeHtml(dirty);
}

// グローバルに公開（Alpine.jsから使用できるように）
window.XSSProtection = {
    escapeHtml,
    sanitizeHtml,
    sanitizeUrlParam,
    isSafeUrl,
    sanitizeObject,
    sanitizeJson,
    safeText,
    validateInput,
    purifyHtml
};

// デフォルトエクスポート（モジュールとして使用する場合）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        escapeHtml,
        sanitizeHtml,
        sanitizeUrlParam,
        isSafeUrl,
        sanitizeObject,
        sanitizeJson,
        safeText,
        validateInput,
        purifyHtml
    };
}
