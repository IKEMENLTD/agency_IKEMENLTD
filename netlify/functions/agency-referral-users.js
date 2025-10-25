const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agency-Id',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Verify JWT token
    const authHeader = event.headers.authorization;
    const agencyId = event.headers['x-agency-id'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: '認証が必要です' })
        };
    }

    const token = authHeader.substring(7);

    try {
        // Verify JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!agencyId || decoded.agencyId !== agencyId) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'アクセス権限がありません' })
            };
        }

        // Get all child agencies (up to 4 levels deep)
        const childAgencies = await getChildAgencies(agencyId);
        const childAgencyIds = childAgencies.map(a => a.id);

        if (childAgencyIds.length === 0) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    referralUsers: [],
                    summary: {
                        totalUsers: 0,
                        activeSubscriptions: 0,
                        totalReferralCommission: 0
                    }
                })
            };
        }

        // Get conversions from child agencies (subscription only)
        const { data: conversions, error: conversionsError } = await supabase
            .from('agency_conversions')
            .select('*')
            .in('agency_id', childAgencyIds)
            .eq('conversion_type', 'subscription')
            .order('created_at', { ascending: false });

        if (conversionsError) {
            console.error('Error fetching conversions:', conversionsError);
            throw conversionsError;
        }

        // Get unique LINE user IDs
        const lineUserIds = [...new Set(
            (conversions || [])
                .map(c => c.line_user_id)
                .filter(id => id != null)
        )];

        // Fetch LINE profiles
        let lineProfilesMap = {};
        if (lineUserIds.length > 0) {
            const { data: lineProfiles, error: lineProfilesError } = await supabase
                .from('line_profiles')
                .select('user_id, display_name, picture_url')
                .in('user_id', lineUserIds);

            if (!lineProfilesError && lineProfiles) {
                lineProfilesMap = Object.fromEntries(
                    lineProfiles.map(profile => [profile.user_id, profile])
                );
            }
        }

        // Fetch subscription status from users table
        let subscriptionStatusMap = {};
        if (lineUserIds.length > 0) {
            const { data: users, error: usersError } = await supabase
                .from('users')
                .select('line_user_id, subscription_status, subscription_started_at, subscription_ended_at')
                .in('line_user_id', lineUserIds);

            if (!usersError && users) {
                subscriptionStatusMap = Object.fromEntries(
                    users.map(user => [user.line_user_id, user])
                );
            }
        }

        // Create agencies map for quick lookup
        const agenciesMap = Object.fromEntries(
            childAgencies.map(agency => [agency.id, agency])
        );

        // Calculate referral commission rate based on depth
        const getReferralRate = (depth) => {
            // Depth 1: direct child (2%)
            // Depth 2-4: grandchildren and below (2%)
            return 2.0;
        };

        // Format referral users
        const referralUsers = conversions.map(conversion => {
            const lineProfile = conversion.line_user_id ? lineProfilesMap[conversion.line_user_id] : null;
            const subscriptionInfo = conversion.line_user_id ? subscriptionStatusMap[conversion.line_user_id] : null;
            const agency = agenciesMap[conversion.agency_id];

            // Calculate commission (assuming 10,000 yen per subscription)
            const subscriptionAmount = 10000;
            const referralRate = getReferralRate(agency?.depth || 1);
            const referralCommission = subscriptionAmount * (referralRate / 100);

            const isActive = subscriptionInfo?.subscription_status === 'active';

            return {
                id: conversion.id,
                line_user_id: conversion.line_user_id,
                line_name: lineProfile?.display_name || '(LINE名不明)',
                line_picture: lineProfile?.picture_url || null,
                subscription_status: subscriptionInfo?.subscription_status || 'unknown',
                subscription_started_at: subscriptionInfo?.subscription_started_at || conversion.created_at,
                subscription_ended_at: subscriptionInfo?.subscription_ended_at || null,
                is_active: isActive,
                acquired_agency_id: conversion.agency_id,
                acquired_agency_name: agency?.name || '(代理店名不明)',
                agency_depth: agency?.depth || 1,
                referral_rate: referralRate,
                referral_commission: isActive ? referralCommission : 0,
                created_at: conversion.created_at
            };
        });

        // Calculate summary
        const activeUsers = referralUsers.filter(u => u.is_active);
        const totalReferralCommission = activeUsers.reduce((sum, u) => sum + u.referral_commission, 0);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                referralUsers,
                summary: {
                    totalUsers: referralUsers.length,
                    activeSubscriptions: activeUsers.length,
                    totalReferralCommission: Math.round(totalReferralCommission)
                }
            })
        };

    } catch (error) {
        console.error('Referral users error:', error);

        if (error.name === 'JsonWebTokenError') {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: '無効な認証トークンです' })
            };
        }

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'リファラルユーザー情報の取得に失敗しました',
                details: error.message
            })
        };
    }
};

// Recursively get all child agencies (up to 4 levels)
async function getChildAgencies(parentAgencyId, depth = 0, maxDepth = 4) {
    if (depth >= maxDepth) {
        return [];
    }

    const { data: children, error } = await supabase
        .from('agencies')
        .select('id, code, name, level, parent_agency_id')
        .eq('parent_agency_id', parentAgencyId);

    if (error || !children || children.length === 0) {
        return [];
    }

    // Add depth info
    const childrenWithDepth = children.map(child => ({
        ...child,
        depth: depth + 1
    }));

    // Recursively get grandchildren
    const grandchildren = [];
    for (const child of children) {
        const descendants = await getChildAgencies(child.id, depth + 1, maxDepth);
        grandchildren.push(...descendants);
    }

    return [...childrenWithDepth, ...grandchildren];
}
