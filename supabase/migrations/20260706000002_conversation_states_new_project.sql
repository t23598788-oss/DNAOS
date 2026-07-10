-- Conversation state table for new project (xeytcavxejhyzxwevgto)
-- Per-user session state; includes all business fields from later ALTERs
CREATE TABLE IF NOT EXISTS public.conversation_states (
    line_user_id       VARCHAR(255) PRIMARY KEY,
    current_intent     VARCHAR(100),
    material           VARCHAR(100),
    quantity           NUMERIC,
    vehicle_type       VARCHAR(50),
    concrete_type      VARCHAR(100),
    pickup             VARCHAR(255),
    destination_text   VARCHAR(255),
    destination_location JSONB,
    tax_id             VARCHAR(50),
    project_name       VARCHAR(255),
    contact_name       VARCHAR(255),
    contact_phone      VARCHAR(50),
    payer_name         VARCHAR(255),
    status             VARCHAR(50)  NOT NULL DEFAULT 'ACTIVE',
    expires_at         TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_states_expiry ON public.conversation_states(expires_at);

CREATE OR REPLACE FUNCTION public.set_conversation_states_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_conversation_states_updated_at
    BEFORE UPDATE ON public.conversation_states
    FOR EACH ROW EXECUTE FUNCTION public.set_conversation_states_updated_at();

ALTER TABLE public.conversation_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access to conversation_states"
    ON public.conversation_states FOR ALL TO service_role
    USING (true) WITH CHECK (true);
