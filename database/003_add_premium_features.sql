-- Add premium features to user_states table
ALTER TABLE user_states
ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS premium_activated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS premium_expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS premium_activation_code TEXT,
ADD COLUMN IF NOT EXISTS premium_features JSONB DEFAULT '[]'::jsonb;

-- Create activation codes table for tracking
CREATE TABLE IF NOT EXISTS activation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  code_hash TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'premium',
  used BOOLEAN DEFAULT false,
  used_by VARCHAR(100),
  used_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_activation_codes_hash ON activation_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_user_states_premium ON user_states(is_premium);

-- Function to activate premium
CREATE OR REPLACE FUNCTION activate_premium_plan(
  p_line_user_id VARCHAR(100),
  p_activation_code TEXT,
  p_duration_days INTEGER DEFAULT 365
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_code_hash TEXT;
  v_code_valid BOOLEAN;
BEGIN
  -- Hash the activation code for comparison
  v_code_hash := encode(sha256(p_activation_code::bytea), 'hex');

  -- Check if code exists and is unused
  SELECT EXISTS(
    SELECT 1 FROM activation_codes
    WHERE code_hash = v_code_hash
    AND used = false
    AND (expires_at IS NULL OR expires_at > NOW())
  ) INTO v_code_valid;

  IF NOT v_code_valid THEN
    RETURN FALSE;
  END IF;

  -- Mark code as used
  UPDATE activation_codes
  SET
    used = true,
    used_by = p_line_user_id,
    used_at = NOW()
  WHERE code_hash = v_code_hash;

  -- Activate premium for user
  UPDATE user_states
  SET
    is_premium = true,
    premium_activated_at = NOW(),
    premium_expires_at = NOW() + (p_duration_days || ' days')::interval,
    premium_activation_code = v_code_hash,
    premium_features = '["unlimited_tracking", "advanced_analytics", "api_access", "priority_support"]'::jsonb,
    updated_at = NOW()
  WHERE line_user_id = p_line_user_id;

  RETURN TRUE;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION activate_premium_plan TO service_role;