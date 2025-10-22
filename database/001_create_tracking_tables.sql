-- Create tracking_links table
CREATE TABLE IF NOT EXISTS tracking_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(10) UNIQUE NOT NULL,
  source VARCHAR(50) NOT NULL,
  campaign_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by VARCHAR(100) NOT NULL,
  click_count INTEGER DEFAULT 0,
  friend_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);

-- Create tracking_sessions table
CREATE TABLE IF NOT EXISTS tracking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_link_id UUID REFERENCES tracking_links(id) ON DELETE CASCADE,
  auth_token VARCHAR(10) NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  user_agent TEXT NOT NULL,
  referer TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_bot BOOLEAN DEFAULT false,
  line_user_id VARCHAR(100),
  friend_added_at TIMESTAMP WITH TIME ZONE
);

-- Create user_states table
CREATE TABLE IF NOT EXISTS user_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id VARCHAR(100) UNIQUE NOT NULL,
  display_name VARCHAR(255),
  picture_url TEXT,
  status_message TEXT,
  language VARCHAR(10),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  state JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for better performance
CREATE INDEX idx_tracking_links_code ON tracking_links(code);
CREATE INDEX idx_tracking_links_campaign ON tracking_links(campaign_name);
CREATE INDEX idx_tracking_links_active ON tracking_links(is_active);
CREATE INDEX idx_tracking_sessions_token ON tracking_sessions(auth_token);
CREATE INDEX idx_tracking_sessions_link_id ON tracking_sessions(tracking_link_id);
CREATE INDEX idx_tracking_sessions_line_user ON tracking_sessions(line_user_id);
CREATE INDEX idx_tracking_sessions_expires ON tracking_sessions(expires_at);
CREATE INDEX idx_user_states_line_user ON user_states(line_user_id);

-- Create functions for incrementing counters
CREATE OR REPLACE FUNCTION increment_click_count(link_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE tracking_links
  SET click_count = click_count + 1
  WHERE id = link_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_friend_count(link_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE tracking_links
  SET friend_count = friend_count + 1
  WHERE id = link_id;
END;
$$ LANGUAGE plpgsql;

-- Create Row Level Security (RLS) policies
ALTER TABLE tracking_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_states ENABLE ROW LEVEL SECURITY;

-- Create policies for service role (full access)
CREATE POLICY "Service role has full access to tracking_links"
  ON tracking_links
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to tracking_sessions"
  ON tracking_sessions
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to user_states"
  ON user_states
  FOR ALL
  USING (auth.role() = 'service_role');

-- Create policies for anon role (read-only for specific operations)
CREATE POLICY "Anon can read active tracking links"
  ON tracking_links
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Anon can read their own sessions"
  ON tracking_sessions
  FOR SELECT
  USING (true);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_states_updated_at
  BEFORE UPDATE ON user_states
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add sample data for testing (optional - remove in production)
INSERT INTO tracking_links (code, source, campaign_name, created_by)
VALUES
  ('DEMO01', 'Twitter', 'Summer Campaign 2024', 'admin@example.com'),
  ('DEMO02', 'Instagram', 'Product Launch', 'admin@example.com'),
  ('DEMO03', 'Blog', 'Tutorial Series', 'admin@example.com')
ON CONFLICT (code) DO NOTHING;