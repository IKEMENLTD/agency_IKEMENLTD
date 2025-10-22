/**
 * LINE Login Client Utilities
 *
 * Provides functions for LINE Login integration:
 * - Generate LINE Login authorization URL
 * - Validate LINE configuration
 */

const logger = require('./logger');

/**
 * Generate LINE Login authorization URL
 *
 * @param {string} redirectUri - Callback URL after LINE authentication
 * @param {string} state - CSRF protection state parameter
 * @returns {string} LINE Login authorization URL
 */
function generateLineLoginUrl(redirectUri, state) {
    const channelId = process.env.LINE_LOGIN_CHANNEL_ID;

    if (!channelId) {
        logger.error('LINE_LOGIN_CHANNEL_ID is not configured');
        throw new Error('LINE Login is not configured');
    }

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: channelId,
        redirect_uri: redirectUri,
        state: state,
        scope: 'profile openid',
        // bot_prompt: 'normal' // Optional: prompt user to add bot
    });

    const authUrl = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;

    logger.log('LINE Login URL generated');
    logger.log('- Redirect URI:', redirectUri);
    logger.log('- State:', state);

    return authUrl;
}

/**
 * Validate LINE Login configuration
 *
 * @returns {boolean} true if configuration is valid
 * @throws {Error} if configuration is invalid
 */
function validateLineConfig() {
    const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
    const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
    const callbackUrl = process.env.LINE_LOGIN_CALLBACK_URL;

    if (!channelId) {
        throw new Error('LINE_LOGIN_CHANNEL_ID is not configured');
    }

    if (!channelSecret) {
        throw new Error('LINE_LOGIN_CHANNEL_SECRET is not configured');
    }

    if (!callbackUrl) {
        throw new Error('LINE_LOGIN_CALLBACK_URL is not configured');
    }

    logger.log('✅ LINE Login configuration is valid');
    return true;
}

/**
 * Generate secure state parameter for CSRF protection
 *
 * @returns {string} Random state string
 */
function generateState() {
    const crypto = require('crypto');
    return crypto.randomBytes(16).toString('hex');
}

module.exports = {
    generateLineLoginUrl,
    validateLineConfig,
    generateState
};
