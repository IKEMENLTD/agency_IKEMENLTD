const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client with SERVICE_ROLE_KEY
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Verify LINE webhook signature
 * @param {string} body - Request body as string
 * @param {string} signature - X-Line-Signature header
 * @param {string} channelSecret - LINE Channel Secret
 * @returns {boolean}
 */
function verifySignature(body, signature, channelSecret) {
    if (!channelSecret || !signature) {
        return false;
    }

    const hash = crypto
        .createHmac('sha256', channelSecret)
        .update(body)
        .digest('base64');

    return hash === signature;
}

/**
 * Extract browser type from User-Agent string
 * @param {string} userAgent - User-Agent header
 * @returns {string}
 */
function extractBrowser(userAgent) {
    const ua = userAgent.toLowerCase();
    if (ua.includes('edg/')) return 'edge';
    if (ua.includes('chrome/') && !ua.includes('edg/')) return 'chrome';
    if (ua.includes('firefox/')) return 'firefox';
    if (ua.includes('safari/') && !ua.includes('chrome/')) return 'safari';
    if (ua.includes('line/')) return 'line';
    if (ua.includes('opera/') || ua.includes('opr/')) return 'opera';
    return 'unknown';
}

/**
 * Get client IP address from request headers
 * @param {object} headers - Request headers
 * @returns {string}
 */
function getClientIPFromHeaders(headers) {
    const ipHeaders = [
        'x-forwarded-for',
        'x-real-ip',
        'x-client-ip',
        'cf-connecting-ip',
        'x-forwarded',
        'forwarded-for',
        'forwarded'
    ];

    for (const header of ipHeaders) {
        const value = headers[header];
        if (value) {
            return value.split(',')[0].trim();
        }
    }

    return 'unknown';
}

/**
 * Forward webhook to Render service
 * @param {string} body - Request body
 * @param {string} signature - X-Line-Signature
 */
async function forwardToRender(body, signature) {
    const renderWebhookUrl = process.env.RENDER_WEBHOOK_URL || 'https://gasgenerator.onrender.com/api/webhook';

    if (!renderWebhookUrl) {
        console.log('⚠️ RENDER_WEBHOOK_URL not configured, skipping forward to Render');
        return;
    }

    try {
        console.log('📤 Forwarding to Render:', renderWebhookUrl);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(renderWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Line-Signature': signature
            },
            body: body,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn('⚠️ Render forward failed with status:', response.status);
        } else {
            console.log('✅ Render forward successful');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('⏱️ Render forward timeout (30s) - Render may be sleeping');
        } else {
            console.error('❌ Render forward error:', error.message);
        }
    }
}

/**
 * Forward webhook to external service (L Message, etc.)
 * @param {string} body - Request body
 * @param {string} signature - X-Line-Signature
 * @param {string} externalWebhookUrl - External webhook URL (optional, uses env var if not provided)
 */
async function forwardToExternal(body, signature, externalWebhookUrl = null) {
    const webhookUrl = externalWebhookUrl || process.env.EXTERNAL_WEBHOOK_URL;

    if (!webhookUrl) {
        console.log('⚠️ EXTERNAL_WEBHOOK_URL not configured, skipping forward to external service');
        return;
    }

    try {
        console.log('📤 Forwarding to External Webhook:', webhookUrl);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Line-Signature': signature
            },
            body: body,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn('⚠️ External webhook forward failed with status:', response.status);
        } else {
            console.log('✅ External webhook forward successful');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('⏱️ External webhook forward timeout (10s)');
        } else {
            console.error('❌ External webhook forward error:', error.message);
        }
    }
}

/**
 * Send LINE reply message
 * @param {string} replyToken - LINE reply token
 * @param {array} messages - Array of LINE message objects
 * @param {string} accessToken - LINE Channel Access Token
 */
async function sendLineReply(replyToken, messages, accessToken) {
    if (!accessToken) {
        throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
    }

    const response = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
            replyToken,
            messages
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LINE API error: ${response.status} - ${errorText}`);
    }

    return response.json();
}

/**
 * Get or create LINE user in database
 * @param {object} profile - LINE user profile
 * @param {string} serviceCode - Service code (e.g., 'TASKMATE_AI', 'SUBSIDY_NAV')
 * @returns {object} User record
 */
async function getOrCreateLineUser(profile, serviceCode) {
    const { userId, displayName, pictureUrl, statusMessage } = profile;

    // Check if user exists
    let { data: existingUser, error: selectError } = await supabase
        .from('users')
        .select('*')
        .eq('line_user_id', userId)
        .single();

    if (existingUser) {
        // Update user profile
        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({
                line_display_name: displayName,
                line_picture_url: pictureUrl,
                line_status_message: statusMessage,
                updated_at: new Date().toISOString()
            })
            .eq('line_user_id', userId)
            .select()
            .single();

        if (updateError) {
            console.error('Failed to update user:', updateError);
            return existingUser;
        }

        return updatedUser;
    }

    // Create new user
    const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({
            line_user_id: userId,
            line_display_name: displayName,
            line_picture_url: pictureUrl,
            line_status_message: statusMessage,
            service_code: serviceCode,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .select()
        .single();

    if (insertError) {
        console.error('Failed to create user:', insertError);
        throw insertError;
    }

    return newUser;
}

module.exports = {
    supabase,
    verifySignature,
    extractBrowser,
    getClientIPFromHeaders,
    forwardToRender,
    forwardToExternal,
    sendLineReply,
    getOrCreateLineUser
};
