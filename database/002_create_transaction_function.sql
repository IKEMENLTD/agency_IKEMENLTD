-- Create transaction function for token verification
CREATE OR REPLACE FUNCTION process_token_verification(
  p_session_id UUID,
  p_line_user_id VARCHAR(100),
  p_tracking_link_id UUID,
  p_display_name VARCHAR(255),
  p_picture_url TEXT,
  p_status_message TEXT,
  p_language VARCHAR(10)
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Start transaction

  -- Update session with LINE user ID
  UPDATE tracking_sessions
  SET
    line_user_id = p_line_user_id,
    friend_added_at = NOW()
  WHERE
    id = p_session_id
    AND line_user_id IS NULL
    AND expires_at > NOW();

  -- Check if update was successful
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Increment friend count
  UPDATE tracking_links
  SET friend_count = friend_count + 1
  WHERE id = p_tracking_link_id;

  -- Upsert user state
  INSERT INTO user_states (
    line_user_id,
    display_name,
    picture_url,
    status_message,
    language,
    state,
    updated_at
  ) VALUES (
    p_line_user_id,
    p_display_name,
    p_picture_url,
    p_status_message,
    p_language,
    jsonb_build_object(
      'step', 'completed',
      'registered_at', NOW()
    ),
    NOW()
  )
  ON CONFLICT (line_user_id)
  DO UPDATE SET
    display_name = EXCLUDED.display_name,
    picture_url = EXCLUDED.picture_url,
    status_message = EXCLUDED.status_message,
    language = EXCLUDED.language,
    state = user_states.state || EXCLUDED.state,
    updated_at = NOW();

  RETURN TRUE;

EXCEPTION
  WHEN OTHERS THEN
    -- Rollback is automatic in case of error
    RAISE NOTICE 'Error in process_token_verification: %', SQLERRM;
    RETURN FALSE;
END;
$$;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION process_token_verification TO service_role;