// agency-services.js
// 代理店がアクセスできるサービス一覧を取得

const { createClient } = require('@supabase/supabase-js');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const headers = getCorsHeaders(event, {
    // Secure CORS - see getCorsHeaders(),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agency-Id',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // JWT認証
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Missing or invalid authorization header' })
      };
    }

    const token = authHeader.substring(7);
    let agencyId;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      agencyId = decoded.agencyId;
    } catch (err) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }

    // 代理店の確認
    const { data: agency, error: agencyError } = await supabase
      .from('agencies')
      .select('id, status')
      .eq('id', agencyId)
      .single();

    if (agencyError || !agency) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Agency not found' })
      };
    }

    if (agency.status !== 'active') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Agency is not active' })
      };
    }

    // アクティブなサービス一覧を取得
    // まず全サービスを取得してログ出力（デバッグ用）
    const { data: allServices } = await supabase
      .from('services')
      .select('id, name, status')
      .order('name');

    console.log('📋 All services in database:', allServices?.length || 0);
    if (allServices && allServices.length > 0) {
      console.log('All service names:', allServices.map(s => `${s.name} (${s.status})`));
    }

    // すべてのアクティブなサービスを取得
    const { data: services, error: servicesError } = await supabase
      .from('services')
      .select('id, name, description, domain, default_commission_rate, default_referral_rate, subscription_price, status')
      .eq('status', 'active')
      .order('name');

    if (servicesError) {
      console.error('Error fetching services:', servicesError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch services', details: servicesError.message })
      };
    }

    // デバッグ用ログ
    console.log('✅ Services fetched from DB:', services?.length || 0, 'services');
    if (services && services.length > 0) {
      console.log('Service names:', services.map(s => s.name));
    } else {
      console.warn('⚠️ No services found! Check database or filter conditions.');
    }

    // 代理店×サービスのカスタム設定を取得
    const { data: settings, error: settingsError } = await supabase
      .from('agency_service_settings')
      .select('service_id, commission_rate, referral_rate, is_active')
      .eq('agency_id', agencyId);

    if (settingsError) {
      console.error('Error fetching agency service settings:', settingsError);
    }

    // サービスにカスタム設定をマージ
    const servicesWithSettings = services.map(service => {
      const setting = settings?.find(s => s.service_id === service.id);

      return {
        id: service.id,
        name: service.name,
        description: service.description,
        domain: service.domain,
        commission_rate: setting?.commission_rate ?? service.default_commission_rate,
        referral_rate: setting?.referral_rate ?? service.default_referral_rate,
        subscription_price: service.subscription_price,
        status: service.status,
        is_active: setting?.is_active ?? true
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        services: servicesWithSettings
      })
    };

  } catch (error) {
    console.error('Agency services error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
