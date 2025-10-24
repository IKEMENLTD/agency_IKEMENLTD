const { createClient } = require('@supabase/supabase-js');
const logger = require('./utils/logger');

// Environment variable check with detailed logging
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.error('❌ CRITICAL: Missing Supabase environment variables');
    logger.error('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'MISSING');
    logger.error('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set' : 'MISSING');
}

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

exports.handler = async (event) => {
    logger.log('🔗 Track-redirect function called');
    logger.log('📍 Full path:', event.path);
    logger.log('🌐 Method:', event.httpMethod);
    logger.log('📨 Headers:', JSON.stringify(event.headers, null, 2));

    // Extract tracking code from path
    const pathParts = event.path.split('/');
    const trackingCode = pathParts[pathParts.length - 1];

    logger.log('🔍 Extracted tracking code:', trackingCode);
    logger.log('📂 Path parts:', pathParts);

    if (!trackingCode || trackingCode === 'track-redirect') {
        logger.error('❌ No tracking code found in path');
        return {
            statusCode: 404,
            headers: {
                'Content-Type': 'text/html'
            },
            body: `
                <!DOCTYPE html>
                <html>
                <head><title>Tracking Code Missing</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1>❌ Tracking Code Not Found</h1>
                    <p>The tracking link appears to be incomplete.</p>
                    <p><strong>Path:</strong> ${event.path}</p>
                    <p>トラッキングリンクが不完全です。代理店にお問い合わせください。</p>
                </body>
                </html>
            `
        };
    }

    try {
        logger.log('🔎 Searching for tracking link in database...');

        // Find tracking link with service information
        const { data: link, error: linkError } = await supabase
            .from('agency_tracking_links')
            .select(`
                *,
                agencies (*),
                services (
                    id,
                    name,
                    line_official_url,
                    domain
                )
            `)
            .eq('tracking_code', trackingCode)
            .eq('is_active', true)
            .single();

        if (linkError) {
            logger.error('❌ Database error when fetching tracking link:', linkError);
            logger.error('Error details:', {
                message: linkError.message,
                code: linkError.code,
                details: linkError.details,
                hint: linkError.hint
            });
        }

        if (!link) {
            logger.warn('⚠️  Tracking link not found:', trackingCode);
            logger.warn('Possible reasons: 1) Link does not exist, 2) Link is inactive, 3) Wrong tracking code');

            return {
                statusCode: 404,
                headers: {
                    'Content-Type': 'text/html'
                },
                body: `
                    <!DOCTYPE html>
                    <html>
                    <head><title>Link Not Found</title></head>
                    <body style="font-family: Arial; text-align: center; padding: 50px;">
                        <h1>🔍 Tracking Link Not Found</h1>
                        <p>The tracking link you're trying to access does not exist or has been deactivated.</p>
                        <p><strong>Tracking Code:</strong> ${trackingCode}</p>
                        <p>トラッキングリンクが存在しないか、無効化されています。代理店にお問い合わせください。</p>
                    </body>
                    </html>
                `
            };
        }

        logger.log('✅ Tracking link found:', {
            id: link.id,
            name: link.name,
            agency_id: link.agency_id,
            service_id: link.service_id,
            service_name: link.services?.name,
            visit_count: link.visit_count
        });

        // Extract visitor information
        const visitorInfo = {
            ip: event.headers['x-forwarded-for'] || event.headers['client-ip'],
            userAgent: event.headers['user-agent'],
            referrer: event.headers['referer'] || event.headers['referrer'],
            // Parse user agent for device info
            deviceType: getUserDeviceType(event.headers['user-agent']),
            browser: getUserBrowser(event.headers['user-agent']),
            os: getUserOS(event.headers['user-agent'])
        };

        // Generate session ID for tracking across conversion funnel
        const sessionId = generateSessionId();
        logger.log('🆔 Generated session ID:', sessionId);

        // Record the visit
        logger.log('💾 Recording visit to database...');
        const { data: visit, error: visitError } = await supabase
            .from('agency_tracking_visits')
            .insert({
                tracking_link_id: link.id,
                agency_id: link.agency_id,
                service_id: link.service_id || null,  // Multi-service support
                visitor_ip: visitorInfo.ip,
                user_agent: visitorInfo.userAgent,
                referrer: visitorInfo.referrer,
                device_type: visitorInfo.deviceType,
                browser: visitorInfo.browser,
                os: visitorInfo.os,
                session_id: sessionId,
                line_user_id: null, // Will be linked when user adds LINE friend
                metadata: {
                    tracking_code: trackingCode,
                    utm_source: link.utm_source,
                    utm_medium: link.utm_medium,
                    utm_campaign: link.utm_campaign,
                    timestamp: new Date().toISOString()
                }
            })
            .select()
            .single();

        if (visitError) {
            logger.error('❌ Error recording visit:', visitError);
            logger.error('Visit error details:', {
                message: visitError.message,
                code: visitError.code,
                details: visitError.details
            });
        } else {
            logger.log('✅ Visit recorded successfully. Visit ID:', visit?.id);
        }

        // Increment visit count
        logger.log('📊 Incrementing visit count...');
        const { error: updateError } = await supabase
            .from('agency_tracking_links')
            .update({
                visit_count: link.visit_count + 1,
                updated_at: new Date().toISOString()
            })
            .eq('id', link.id);

        if (updateError) {
            logger.error('❌ Error updating visit count:', updateError);
        } else {
            logger.log('✅ Visit count updated to:', link.visit_count + 1);
        }

        // Get destination URL from service configuration
        const destinationUrl = link.services?.line_official_url || link.destination_url;

        if (!destinationUrl) {
            logger.error('❌ No destination URL found for tracking link');
            logger.error('Service info:', link.services);
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'text/html' },
                body: `
                    <!DOCTYPE html>
                    <html>
                    <head><title>Configuration Error</title></head>
                    <body style="font-family: Arial; text-align: center; padding: 50px;">
                        <h1>⚙️ Configuration Error</h1>
                        <p>このトラッキングリンクの転送先URLが設定されていません。</p>
                        <p>サービス: ${link.services?.name || '不明'}</p>
                        <p>代理店管理者にお問い合わせください。</p>
                    </body>
                    </html>
                `
            };
        }

        logger.log('🎯 Destination URL:', destinationUrl);
        logger.log('📦 Service:', link.services?.name);

        const url = new URL(destinationUrl);

        // Add tracking parameters to preserve attribution
        url.searchParams.append('tid', trackingCode);
        url.searchParams.append('sid', sessionId);
        url.searchParams.append('aid', link.agency_id);

        // Add UTM parameters if they exist
        if (link.utm_source) url.searchParams.append('utm_source', link.utm_source);
        if (link.utm_medium) url.searchParams.append('utm_medium', link.utm_medium);
        if (link.utm_campaign) url.searchParams.append('utm_campaign', link.utm_campaign);
        if (link.utm_term) url.searchParams.append('utm_term', link.utm_term);
        if (link.utm_content) url.searchParams.append('utm_content', link.utm_content);

        // Set cookie for session tracking (for web-based conversions)
        const cookieValue = JSON.stringify({
            trackingCode,
            sessionId,
            agencyId: link.agency_id,
            timestamp: new Date().toISOString()
        });

        const finalRedirectUrl = url.toString();
        logger.log('🚀 Redirecting to:', finalRedirectUrl);
        logger.log('📊 Total visit count for this link:', link.visit_count + 1);

        return {
            statusCode: 302,
            headers: {
                'Location': finalRedirectUrl,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Set-Cookie': `ikemen_agency_tracking=${Buffer.from(cookieValue).toString('base64')}; Path=/; Max-Age=2592000; SameSite=Lax`
            },
            body: ''
        };

    } catch (error) {
        logger.error('❌❌❌ CRITICAL ERROR in track-redirect ❌❌❌');
        logger.error('Error type:', error.name);
        logger.error('Error message:', error.message);
        logger.error('Error stack:', error.stack);
        logger.error('Event details:', {
            path: event.path,
            method: event.httpMethod,
            headers: event.headers
        });

        // Return error page instead of fallback redirect (multi-service system)
        logger.log('⚠️  Returning error page due to critical error');

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            },
            body: `
                <!DOCTYPE html>
                <html>
                <head><title>System Error</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1>⚠️ System Error</h1>
                    <p>トラッキングシステムでエラーが発生しました。</p>
                    <p>代理店管理者にお問い合わせください。</p>
                    <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">Error ID: ${Date.now()}</p>
                </body>
                </html>
            `
        };
    }
};

function generateSessionId() {
    return 'sess_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function getUserDeviceType(userAgent) {
    if (!userAgent) return 'unknown';

    if (/mobile/i.test(userAgent)) return 'mobile';
    if (/tablet/i.test(userAgent)) return 'tablet';
    if (/bot/i.test(userAgent)) return 'bot';
    return 'desktop';
}

function getUserBrowser(userAgent) {
    if (!userAgent) return 'unknown';

    if (/chrome/i.test(userAgent) && !/edge/i.test(userAgent)) return 'Chrome';
    if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) return 'Safari';
    if (/firefox/i.test(userAgent)) return 'Firefox';
    if (/edge/i.test(userAgent)) return 'Edge';
    if (/line/i.test(userAgent)) return 'LINE';
    return 'other';
}

function getUserOS(userAgent) {
    if (!userAgent) return 'unknown';

    if (/windows/i.test(userAgent)) return 'Windows';
    if (/macintosh|mac os x/i.test(userAgent)) return 'macOS';
    if (/linux/i.test(userAgent)) return 'Linux';
    if (/android/i.test(userAgent)) return 'Android';
    if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
    return 'other';
}