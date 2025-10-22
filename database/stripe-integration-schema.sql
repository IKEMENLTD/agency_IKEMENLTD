-- Stripe Integration Schema Extension
-- Extends existing agency tracking system for Stripe payment tracking

-- 1. Add Stripe payment tracking table
CREATE TABLE IF NOT EXISTS stripe_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
    stripe_customer_id VARCHAR(255),
    agency_id UUID REFERENCES agencies(id),
    tracking_link_id UUID REFERENCES agency_tracking_links(id),
    visit_id UUID REFERENCES agency_tracking_visits(id),
    line_user_id VARCHAR(255), -- Link to LINE user who made payment
    amount_total INTEGER NOT NULL, -- Amount in cents
    currency VARCHAR(3) DEFAULT 'jpy',
    payment_status VARCHAR(50) NOT NULL, -- succeeded, pending, failed, canceled
    metadata JSONB DEFAULT '{}',
    stripe_created_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Add user sessions table for better tracking attribution
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id VARCHAR(255) UNIQUE NOT NULL,
    agency_id UUID REFERENCES agencies(id),
    tracking_link_id UUID REFERENCES agency_tracking_links(id),
    visit_id UUID REFERENCES agency_tracking_visits(id),
    line_user_id VARCHAR(255), -- When user becomes LINE friend
    stripe_customer_id VARCHAR(255), -- When user makes payment
    user_agent TEXT,
    ip_address VARCHAR(50),
    utm_source VARCHAR(255),
    utm_medium VARCHAR(255),
    utm_campaign VARCHAR(255),
    utm_term VARCHAR(255),
    utm_content VARCHAR(255),
    first_visit_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    line_friend_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'
);

-- 3. Update agency_conversions table to include Stripe payments
ALTER TABLE agency_conversions ADD COLUMN IF NOT EXISTS stripe_payment_id UUID REFERENCES stripe_payments(id);
ALTER TABLE agency_conversions ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES user_sessions(id);
ALTER TABLE agency_conversions ADD COLUMN IF NOT EXISTS commission_amount DECIMAL(10,2);
ALTER TABLE agency_conversions ADD COLUMN IF NOT EXISTS commission_status VARCHAR(50) DEFAULT 'pending';

-- 4. Add conversion funnel tracking table
CREATE TABLE IF NOT EXISTS conversion_funnels (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES user_sessions(id),
    agency_id UUID NOT NULL REFERENCES agencies(id),
    step_name VARCHAR(100) NOT NULL, -- 'visit', 'line_friend', 'payment'
    step_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_stripe_payments_agency_id ON stripe_payments(agency_id);
CREATE INDEX idx_stripe_payments_stripe_intent_id ON stripe_payments(stripe_payment_intent_id);
CREATE INDEX idx_stripe_payments_line_user_id ON stripe_payments(line_user_id);
CREATE INDEX idx_stripe_payments_created_at ON stripe_payments(created_at);

CREATE INDEX idx_user_sessions_session_id ON user_sessions(session_id);
CREATE INDEX idx_user_sessions_agency_id ON user_sessions(agency_id);
CREATE INDEX idx_user_sessions_line_user_id ON user_sessions(line_user_id);
CREATE INDEX idx_user_sessions_stripe_customer_id ON user_sessions(stripe_customer_id);
CREATE INDEX idx_user_sessions_first_visit_at ON user_sessions(first_visit_at);

CREATE INDEX idx_conversion_funnels_session_id ON conversion_funnels(session_id);
CREATE INDEX idx_conversion_funnels_agency_id ON conversion_funnels(agency_id);
CREATE INDEX idx_conversion_funnels_step_name ON conversion_funnels(step_name);

-- Row Level Security
ALTER TABLE stripe_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversion_funnels ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Agencies can view own stripe payments" ON stripe_payments
    FOR SELECT USING (agency_id = auth.jwt() ->> 'agency_id'::uuid);

CREATE POLICY "Agencies can view own user sessions" ON user_sessions
    FOR SELECT USING (agency_id = auth.jwt() ->> 'agency_id'::uuid);

CREATE POLICY "Agencies can view own conversion funnels" ON conversion_funnels
    FOR SELECT USING (agency_id = auth.jwt() ->> 'agency_id'::uuid);

-- Public policies for webhook access (system functions)
CREATE POLICY "Allow system insert on stripe_payments" ON stripe_payments
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow system update on stripe_payments" ON stripe_payments
    FOR UPDATE USING (true);

CREATE POLICY "Allow system insert on user_sessions" ON user_sessions
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow system update on user_sessions" ON user_sessions
    FOR UPDATE USING (true);

CREATE POLICY "Allow system insert on conversion_funnels" ON conversion_funnels
    FOR INSERT WITH CHECK (true);

-- Triggers for updated_at
CREATE TRIGGER update_stripe_payments_updated_at
    BEFORE UPDATE ON stripe_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Views for analytics
CREATE OR REPLACE VIEW agency_performance AS
SELECT
    a.id as agency_id,
    a.name as agency_name,
    a.commission_rate,
    COUNT(DISTINCT atl.id) as total_links,
    COUNT(DISTINCT atv.id) as total_visits,
    COUNT(DISTINCT ac.id) as total_conversions,
    COUNT(DISTINCT sp.id) as total_payments,
    COALESCE(SUM(sp.amount_total), 0) as total_revenue_cents,
    COALESCE(SUM(ac.commission_amount), 0) as total_commission,
    CASE
        WHEN COUNT(DISTINCT atv.id) > 0
        THEN ROUND((COUNT(DISTINCT ac.id)::numeric / COUNT(DISTINCT atv.id)) * 100, 2)
        ELSE 0
    END as conversion_rate,
    CASE
        WHEN COUNT(DISTINCT ac.id) > 0
        THEN ROUND((COUNT(DISTINCT sp.id)::numeric / COUNT(DISTINCT ac.id)) * 100, 2)
        ELSE 0
    END as payment_rate
FROM agencies a
LEFT JOIN agency_tracking_links atl ON a.id = atl.agency_id
LEFT JOIN agency_tracking_visits atv ON atl.id = atv.tracking_link_id
LEFT JOIN agency_conversions ac ON a.id = ac.agency_id
LEFT JOIN stripe_payments sp ON a.id = sp.agency_id
WHERE a.status = 'active'
GROUP BY a.id, a.name, a.commission_rate;

-- Commission calculation function
CREATE OR REPLACE FUNCTION calculate_agency_commission(
    p_agency_id UUID,
    p_period_start DATE,
    p_period_end DATE
)
RETURNS TABLE (
    agency_id UUID,
    period_start DATE,
    period_end DATE,
    total_payments INTEGER,
    total_revenue_cents BIGINT,
    commission_rate DECIMAL(5,2),
    commission_amount DECIMAL(12,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.id as agency_id,
        p_period_start as period_start,
        p_period_end as period_end,
        COUNT(sp.id)::INTEGER as total_payments,
        COALESCE(SUM(sp.amount_total), 0)::BIGINT as total_revenue_cents,
        a.commission_rate,
        ROUND(
            (COALESCE(SUM(sp.amount_total), 0) * a.commission_rate / 100.0) / 100.0,
            2
        ) as commission_amount
    FROM agencies a
    LEFT JOIN stripe_payments sp ON a.id = sp.agency_id
        AND sp.payment_status = 'succeeded'
        AND sp.created_at >= p_period_start::timestamp
        AND sp.created_at < (p_period_end + interval '1 day')::timestamp
    WHERE a.id = p_agency_id
    GROUP BY a.id, a.commission_rate;
END;
$$ LANGUAGE plpgsql;

-- Function to link payment to agency via session tracking
CREATE OR REPLACE FUNCTION link_payment_to_agency(
    p_stripe_payment_intent_id VARCHAR(255),
    p_stripe_customer_id VARCHAR(255) DEFAULT NULL,
    p_line_user_id VARCHAR(255) DEFAULT NULL
)
RETURNS TABLE (
    agency_id UUID,
    tracking_link_id UUID,
    session_id UUID
) AS $$
DECLARE
    found_session user_sessions%ROWTYPE;
BEGIN
    -- Try to find session by LINE user ID first (most reliable)
    IF p_line_user_id IS NOT NULL THEN
        SELECT * INTO found_session
        FROM user_sessions us
        WHERE us.line_user_id = p_line_user_id
        AND us.is_active = true
        ORDER BY us.last_activity_at DESC
        LIMIT 1;
    END IF;

    -- If not found and we have Stripe customer ID, try that
    IF found_session IS NULL AND p_stripe_customer_id IS NOT NULL THEN
        SELECT * INTO found_session
        FROM user_sessions us
        WHERE us.stripe_customer_id = p_stripe_customer_id
        AND us.is_active = true
        ORDER BY us.last_activity_at DESC
        LIMIT 1;
    END IF;

    -- If still not found, try to find recent session (within last 24 hours)
    IF found_session IS NULL THEN
        SELECT * INTO found_session
        FROM user_sessions us
        WHERE us.last_activity_at >= NOW() - INTERVAL '24 hours'
        AND us.is_active = true
        ORDER BY us.last_activity_at DESC
        LIMIT 1;
    END IF;

    -- Return the found session info
    IF found_session IS NOT NULL THEN
        RETURN QUERY
        SELECT found_session.agency_id, found_session.tracking_link_id, found_session.id;
    ELSE
        RETURN QUERY
        SELECT NULL::UUID, NULL::UUID, NULL::UUID;
    END IF;
END;
$$ LANGUAGE plpgsql;