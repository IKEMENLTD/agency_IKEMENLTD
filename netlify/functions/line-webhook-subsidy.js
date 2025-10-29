const { getCorsHeaders } = require('./utils/cors-headers');
const {
    supabase,
    verifySignature,
    extractBrowser,
    getClientIPFromHeaders,
    forwardToExternal,
    sendLineReply,
    getOrCreateLineUser
} = require('./utils/line-webhook-common');

// 補助金ナビゲーター LINE Configuration
const SERVICE_CODE = 'SUBSIDY_NAV';
const LINE_CHANNEL_SECRET = process.env.SUBSIDY_LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.SUBSIDY_LINE_CHANNEL_ACCESS_TOKEN;

exports.handler = async (event, context) => {
    console.log('🧭 補助金ナビゲーター Webhook受信');

    // Handle CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Headers': 'Content-Type, X-Line-Signature',
                'Access-Control-Allow-Methods': 'POST'
            }
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const signature = event.headers['x-line-signature'];
        const body = event.body;

        // Verify signature
        if (!verifySignature(body, signature, LINE_CHANNEL_SECRET)) {
            console.error('❌ Invalid signature for 補助金ナビゲーター webhook');
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Invalid signature' })
            };
        }

        const webhookBody = JSON.parse(body);
        const events = webhookBody.events;

        // Prevent infinite loop
        const isForwarded = event.headers['x-forwarded-from'];
        if (isForwarded) {
            console.log('⚠️ Request already forwarded from:', isForwarded);
        }

        // Process events
        for (const lineEvent of events) {
            await processLineEvent(lineEvent, event.headers);
        }

        // Forward to external service (L Message) if configured
        if (!isForwarded && process.env.SUBSIDY_EXTERNAL_WEBHOOK_URL) {
            forwardToExternal(body, signature, process.env.SUBSIDY_EXTERNAL_WEBHOOK_URL).catch(err => {
                console.error('Background forward to external webhook failed:', err);
            });
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, service: '補助金ナビゲーター' })
        };

    } catch (error) {
        console.error('❌ 補助金ナビゲーター webhook error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error: ' + error.message
            })
        };
    }
};

// Process individual LINE events
async function processLineEvent(event, headers) {
    try {
        switch (event.type) {
            case 'follow':
                await handleFollowEvent(event, headers);
                break;
            case 'unfollow':
                await handleUnfollowEvent(event);
                break;
            case 'message':
                await handleMessageEvent(event);
                break;
            case 'postback':
                await handlePostbackEvent(event);
                break;
            default:
                console.log('Unhandled event type:', event.type);
        }
    } catch (error) {
        console.error('Error processing LINE event:', error);
    }
}

// Handle follow events (user adds bot as friend)
async function handleFollowEvent(event, headers) {
    const userId = event.source.userId;

    try {
        console.log('=== 補助金ナビゲーター FOLLOW EVENT ===');
        console.log('LINE User ID:', userId);

        // Get user profile from LINE API
        const userProfile = await getLineUserProfile(userId);

        if (!userProfile) {
            console.error('Failed to get user profile for:', userId);
            return;
        }

        console.log('✅ User Profile取得成功:', userProfile.displayName);

        // Get or create user
        const user = await getOrCreateLineUser(userProfile, SERVICE_CODE);
        console.log('✅ User登録/更新完了:', user.id);

        // Link to tracking visit
        await linkUserToTracking(userId, user.id, headers);

        // Record conversion
        await recordConversion(user.id, userId);

        // Send welcome message
        if (event.replyToken) {
            await sendWelcomeMessage(event.replyToken, userProfile.displayName);
        }

    } catch (error) {
        console.error('❌ Follow event処理エラー:', error);
    }
}

// Handle unfollow events
async function handleUnfollowEvent(event) {
    const userId = event.source.userId;

    try {
        console.log('=== 補助金ナビゲーター UNFOLLOW EVENT ===');
        console.log('LINE User ID:', userId);

        // Update user status
        const { error } = await supabase
            .from('users')
            .update({
                line_blocked: true,
                updated_at: new Date().toISOString()
            })
            .eq('line_user_id', userId);

        if (error) {
            console.error('Failed to update user blocked status:', error);
        } else {
            console.log('✅ User blocked status updated');
        }

    } catch (error) {
        console.error('❌ Unfollow event処理エラー:', error);
    }
}

// Handle message events
async function handleMessageEvent(event) {
    const userId = event.source.userId;
    const messageType = event.message.type;

    console.log('📨 補助金ナビゲーター Message Event:', messageType);

    try {
        if (messageType === 'text') {
            const text = event.message.text.trim();

            // Simple keyword response (expand as needed)
            if (text.includes('補助金') || text.includes('助成金')) {
                if (event.replyToken) {
                    await sendLineReply(
                        event.replyToken,
                        [{
                            type: 'text',
                            text: 'ご質問ありがとうございます！\n補助金・助成金に関するご相談は、担当者が詳しくご案内いたします。\n\nまずは、以下の情報をお聞かせください：\n・事業内容\n・従業員数\n・年商規模'
                        }],
                        LINE_CHANNEL_ACCESS_TOKEN
                    );
                }
            }
        }

    } catch (error) {
        console.error('❌ Message event処理エラー:', error);
    }
}

// Handle postback events (for button interactions)
async function handlePostbackEvent(event) {
    console.log('🔘 Postback Event:', event.postback.data);
    // Handle button clicks, form submissions, etc.
}

// Get LINE user profile
async function getLineUserProfile(userId) {
    if (!LINE_CHANNEL_ACCESS_TOKEN) {
        throw new Error('SUBSIDY_LINE_CHANNEL_ACCESS_TOKEN not configured');
    }

    const response = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
        headers: {
            'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
        }
    });

    if (!response.ok) {
        console.error('LINE API error:', response.status, await response.text());
        return null;
    }

    return response.json();
}

// Send welcome message
async function sendWelcomeMessage(replyToken, displayName) {
    try {
        await sendLineReply(
            replyToken,
            [{
                type: 'text',
                text: `${displayName}様\n\n補助金ナビゲーターへようこそ！🎉\n\n最適な補助金・助成金をご提案し、申請書類の作成までトータルでサポートいたします。\n\nまずは、お気軽にご相談ください！`
            }],
            LINE_CHANNEL_ACCESS_TOKEN
        );
        console.log('✅ Welcome message sent');
    } catch (error) {
        console.error('Failed to send welcome message:', error);
    }
}

// Link user to tracking visit (high accuracy matching)
async function linkUserToTracking(lineUserId, userId, headers) {
    try {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        // Get webhook request info
        const lineWebhookIP = getClientIPFromHeaders(headers);
        const lineWebhookUserAgent = headers['user-agent'] || '';

        console.log('📍 LINE Webhook情報:');
        console.log('- IP:', lineWebhookIP);
        console.log('- User-Agent:', lineWebhookUserAgent.substring(0, 100));

        // Get candidate visits
        const { data: candidateVisits, error } = await supabase
            .from('agency_tracking_visits')
            .select('*')
            .is('line_user_id', null)
            .gte('created_at', tenMinutesAgo)
            .order('created_at', { ascending: false });

        if (error || !candidateVisits || candidateVisits.length === 0) {
            console.log('⚠️ 過去10分以内の未紐付け訪問なし');
            return null;
        }

        console.log(`📊 候補訪問数: ${candidateVisits.length}件`);

        // Scoring-based matching
        let bestMatch = null;
        let bestScore = 0;

        for (const visit of candidateVisits) {
            let score = 0;

            // IP match: +10 points
            if (visit.visitor_ip === lineWebhookIP && lineWebhookIP !== 'unknown') {
                score += 10;
            }

            // User-Agent match: +10 (exact), +7 (LINE), +3 (browser)
            if (visit.user_agent && lineWebhookUserAgent) {
                const visitUA = visit.user_agent.toLowerCase();
                const webhookUA = lineWebhookUserAgent.toLowerCase();

                if (visitUA === webhookUA) {
                    score += 10;
                } else if (visitUA.includes('line') && webhookUA.includes('line')) {
                    score += 7;
                } else if (extractBrowser(visitUA) === extractBrowser(webhookUA)) {
                    score += 3;
                }
            }

            // Time proximity: 0-10 points
            const ageMinutes = (Date.now() - new Date(visit.created_at).getTime()) / 60000;
            score += Math.max(0, 10 - ageMinutes);

            // Session ID: +20 points
            if (visit.session_id) score += 20;

            // Tracking link: +15 points
            if (visit.tracking_link_id) score += 15;

            // Browser info: +5 points
            if (visit.browser) score += 5;

            // Official site penalty: -50 points
            if (visit.referrer && !visit.tracking_link_id) {
                const isOfficialSite = visit.referrer.includes('subsidy-navigator.jp') ||
                                       visit.referrer.includes('agency.ikemen.ltd');
                if (isOfficialSite) score -= 50;
            }

            if (score > bestScore) {
                bestScore = score;
                bestMatch = visit;
            }
        }

        if (bestMatch && bestScore > 0) {
            const { error: updateError } = await supabase
                .from('agency_tracking_visits')
                .update({ line_user_id: lineUserId })
                .eq('id', bestMatch.id);

            if (!updateError) {
                console.log(`✅ 訪問紐付け成功 (Score: ${bestScore})`);
                return bestMatch;
            }
        }

        console.log('⚠️ 適切な訪問マッチなし');
        return null;

    } catch (error) {
        console.error('❌ Tracking紐付けエラー:', error);
        return null;
    }
}

// Record conversion
async function recordConversion(userId, lineUserId) {
    try {
        // Find linked visit
        const { data: linkedVisit } = await supabase
            .from('agency_tracking_visits')
            .select('*, tracking_links(*)')
            .eq('line_user_id', lineUserId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (!linkedVisit || !linkedVisit.tracking_link_id) {
            console.log('⚠️ トラッキングリンク経由ではない（直接追加）');
            return;
        }

        const trackingLink = linkedVisit.tracking_links;

        // Check if conversion already exists
        const { data: existingConversion } = await supabase
            .from('agency_conversions')
            .select('id')
            .eq('user_id', userId)
            .eq('tracking_link_id', trackingLink.id)
            .single();

        if (existingConversion) {
            console.log('⚠️ コンバージョン既に記録済み');
            return;
        }

        // Record new conversion
        const { error: conversionError } = await supabase
            .from('agency_conversions')
            .insert({
                user_id: userId,
                agency_id: trackingLink.agency_id,
                tracking_link_id: trackingLink.id,
                service_code: SERVICE_CODE,
                conversion_type: 'friend_add',
                created_at: new Date().toISOString()
            });

        if (conversionError) {
            console.error('Failed to record conversion:', conversionError);
        } else {
            console.log('✅ コンバージョン記録成功');
        }

    } catch (error) {
        console.error('❌ Conversion記録エラー:', error);
    }
}

// Validation
if (!LINE_CHANNEL_SECRET || !LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('❌ Missing 補助金ナビゲーター LINE environment variables');
    console.error('Required: SUBSIDY_LINE_CHANNEL_SECRET, SUBSIDY_LINE_CHANNEL_ACCESS_TOKEN');
}
