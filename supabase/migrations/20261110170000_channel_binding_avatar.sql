-- Add avatar_url to partner_channel_bindings for dynamic profile picture sync
ALTER TABLE public.partner_channel_bindings
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- Update resolve_or_create_channel_binding to accept avatar
CREATE OR REPLACE FUNCTION public.resolve_or_create_channel_binding(
  p_channel_type    text,
  p_channel_user_id text,
  p_display_name    text default null,
  p_avatar_url      text default null
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_channel_type IS NULL OR p_channel_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
  FROM public.partner_channel_bindings
  WHERE channel_type = p_channel_type
    AND channel_user_id = p_channel_user_id;

  IF v_id IS NOT NULL THEN
    UPDATE public.partner_channel_bindings
       SET last_seen_at = now(),
           display_name = COALESCE(display_name, p_display_name),
           avatar_url = COALESCE(p_avatar_url, avatar_url)
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.partner_channel_bindings
    (channel_type, channel_user_id, display_name, avatar_url, source, verified, confidence)
  VALUES
    (p_channel_type, p_channel_user_id, p_display_name, p_avatar_url, 'AUTO_LEARNED', false, 0.5)
  ON CONFLICT (channel_type, channel_user_id) DO UPDATE
    SET last_seen_at = now(),
        display_name = COALESCE(partner_channel_bindings.display_name, excluded.display_name),
        avatar_url = COALESCE(excluded.avatar_url, partner_channel_bindings.avatar_url)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
