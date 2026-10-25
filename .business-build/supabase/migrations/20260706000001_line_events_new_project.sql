-- LINE Events table for new project (xeytcavxejhyzxwevgto)
-- Stores every inbound LINE webhook event as immutable record
CREATE TABLE IF NOT EXISTS public.line_events (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    line_user_id     TEXT,
    group_id         TEXT,
    raw_text         TEXT,
    raw_type         TEXT        NOT NULL,
    reply_token      TEXT,
    line_message_id  TEXT,
    event_timestamp  TIMESTAMPTZ,
    status           TEXT        NOT NULL DEFAULT 'new',
    extracted        JSONB,
    raw_json         JSONB,
    admin_note       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_line_events_user   ON public.line_events(line_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_line_events_status ON public.line_events(status);
CREATE INDEX IF NOT EXISTS idx_line_events_type   ON public.line_events(raw_type);

ALTER TABLE public.line_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access to line_events"
    ON public.line_events FOR ALL TO service_role
    USING (true) WITH CHECK (true);
