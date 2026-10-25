-- Entity registry table for new project (xeytcavxejhyzxwevgto)
-- Audit trail: every entity extracted from LINE events by Gemini
CREATE TABLE IF NOT EXISTS public.entity_registry (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    line_user_id  TEXT        NOT NULL,
    event_id      UUID        NOT NULL REFERENCES public.line_events(id) ON DELETE CASCADE,
    entity_type   TEXT        NOT NULL,
    entity_value  JSONB       NOT NULL,
    confidence    NUMERIC     NOT NULL DEFAULT 1.0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_registry_user ON public.entity_registry(line_user_id, created_at DESC);

ALTER TABLE public.entity_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access to entity_registry"
    ON public.entity_registry FOR ALL TO service_role
    USING (true) WITH CHECK (true);
