/**
 * Bot Detection Utility
 *
 * ボット（クローラー）を検出するための統一されたユーティリティ
 * IP、User-Agent、その他のシグナルを使用して総合的に判定
 */

// 既知のボットIPパターン
const BOT_IP_PATTERNS = [
    // Facebook
    /^2a03:2880:/,          // Facebook IPv6
    /^66\.220\./,           // Facebook IPv4
    /^69\.63\./,            // Facebook IPv4
    /^173\.252\./,          // Facebook IPv4
    /^204\.15\.20\./,       // Facebook IPv4
    /^31\.13\./,            // Facebook IPv4
    /^157\.240\./,          // Facebook IPv4

    // Google
    /^2800:3f0:/,           // Google IPv6
    /^66\.249\./,           // Googlebot
    /^64\.233\./,           // Google
    /^72\.14\./,            // Google
    /^209\.85\./,           // Google
    /^216\.239\./,          // Google

    // Twitter/X
    /^199\.16\.157\./,      // Twitter
    /^199\.59\.150\./,      // Twitter

    // LinkedIn
    /^108\.174\./,          // LinkedIn

    // Other crawlers
    /^2001:4860:/,          // Google IPv6
];

// ボットUser-Agentパターン
const BOT_USER_AGENT_PATTERNS = [
    // General bots
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,

    // Specific bots
    /googlebot/i,
    /bingbot/i,
    /slurp/i,               // Yahoo
    /duckduckbot/i,
    /baiduspider/i,
    /yandexbot/i,
    /facebot/i,             // Facebook
    /facebookexternalhit/i, // Facebook
    /twitterbot/i,
    /linkedinbot/i,
    /whatsapp/i,
    /telegrambot/i,
    /discordbot/i,
    /slackbot/i,

    // Monitoring and testing
    /pingdom/i,
    /uptimerobot/i,
    /statuscake/i,
    /headless/i,
    /phantom/i,
    /selenium/i,
    /webdriver/i,

    // Preview services
    /preview/i,
    /rendering/i,
];

/**
 * ボット検出の主要関数
 *
 * @param {string} ip - 訪問者のIPアドレス
 * @param {string} userAgent - User-Agent文字列
 * @returns {Object} 検出結果
 *   - isBot: boolean - ボットかどうか
 *   - botType: string - ボットの種類（nullの場合は非ボット）
 *   - confidence: number - 確信度（0-100）
 *   - reason: string - 判定理由
 */
function detectBot(ip, userAgent) {
    const reasons = [];
    let confidence = 0;
    let botType = null;

    // IP-based detection
    if (ip) {
        for (const pattern of BOT_IP_PATTERNS) {
            if (pattern.test(ip)) {
                confidence += 80;

                // Identify specific bot type
                if (/^2a03:2880:/.test(ip) || /^66\.220\./.test(ip) || /^69\.63\./.test(ip)) {
                    botType = 'facebook_crawler';
                    reasons.push('Facebook crawler IP detected');
                } else if (/^2800:3f0:/.test(ip) || /^66\.249\./.test(ip)) {
                    botType = 'googlebot';
                    reasons.push('Google bot IP detected');
                } else {
                    botType = 'unknown_bot';
                    reasons.push('Known bot IP pattern detected');
                }

                break;
            }
        }
    }

    // User-Agent-based detection
    if (userAgent) {
        const ua = userAgent.toLowerCase();

        for (const pattern of BOT_USER_AGENT_PATTERNS) {
            if (pattern.test(userAgent)) {
                confidence += 60;

                // More specific bot type identification
                if (!botType) {
                    if (/facebook/i.test(userAgent)) {
                        botType = 'facebook_bot';
                        reasons.push('Facebook bot User-Agent');
                    } else if (/google/i.test(userAgent)) {
                        botType = 'googlebot';
                        reasons.push('Google bot User-Agent');
                    } else if (/twitter/i.test(userAgent)) {
                        botType = 'twitterbot';
                        reasons.push('Twitter bot User-Agent');
                    } else if (/linkedin/i.test(userAgent)) {
                        botType = 'linkedinbot';
                        reasons.push('LinkedIn bot User-Agent');
                    } else {
                        botType = 'generic_bot';
                        reasons.push('Generic bot User-Agent pattern');
                    }
                } else {
                    reasons.push('Bot User-Agent pattern confirmed');
                }

                break;
            }
        }

        // Additional heuristics
        // Very short or very long User-Agent
        if (ua.length < 20) {
            confidence += 10;
            reasons.push('Suspiciously short User-Agent');
        }

        // Missing common browser indicators
        if (!ua.includes('mozilla') && !ua.includes('chrome') &&
            !ua.includes('safari') && !ua.includes('firefox') &&
            !ua.includes('edge') && !ua.includes('line')) {
            confidence += 20;
            reasons.push('Missing common browser indicators');
        }
    }

    // Cap confidence at 100
    confidence = Math.min(confidence, 100);

    const isBot = confidence >= 50;

    return {
        isBot,
        botType,
        confidence,
        reason: reasons.join('; ') || 'Normal user detected'
    };
}

/**
 * シンプルなボット判定（後方互換性用）
 *
 * @param {string} ip - 訪問者のIPアドレス
 * @param {string} userAgent - User-Agent文字列
 * @returns {boolean} ボットかどうか
 */
function isBot(ip, userAgent) {
    const result = detectBot(ip, userAgent);
    return result.isBot;
}

/**
 * 訪問データからボットを除外する
 *
 * @param {Array} visits - 訪問データの配列
 * @returns {Array} ボットを除外した訪問データ
 */
function filterBotVisits(visits) {
    if (!Array.isArray(visits)) {
        return visits;
    }

    return visits.filter(visit => {
        const result = detectBot(visit.visitor_ip, visit.user_agent);
        return !result.isBot;
    });
}

/**
 * ボット統計情報を取得
 *
 * @param {Array} visits - 訪問データの配列
 * @returns {Object} 統計情報
 */
function getBotStats(visits) {
    if (!Array.isArray(visits) || visits.length === 0) {
        return {
            total: 0,
            bots: 0,
            humans: 0,
            botPercentage: 0,
            botTypes: {}
        };
    }

    let botCount = 0;
    const botTypes = {};

    visits.forEach(visit => {
        const result = detectBot(visit.visitor_ip, visit.user_agent);
        if (result.isBot) {
            botCount++;
            const type = result.botType || 'unknown';
            botTypes[type] = (botTypes[type] || 0) + 1;
        }
    });

    return {
        total: visits.length,
        bots: botCount,
        humans: visits.length - botCount,
        botPercentage: Math.round((botCount / visits.length) * 100),
        botTypes
    };
}

module.exports = {
    detectBot,
    isBot,
    filterBotVisits,
    getBotStats,
    BOT_IP_PATTERNS,
    BOT_USER_AGENT_PATTERNS
};
