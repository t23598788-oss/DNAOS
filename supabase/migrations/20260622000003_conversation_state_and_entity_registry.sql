-- Create table for storing conversation states
CREATE TABLE public.conversation_states (
    line_user_id VARCHAR(255) PRIMARY KEY,
    current_intent VARCHAR(100),
    material VARCHAR(100),
    quantity NUMERIC,
    vehicle_type VARCHAR(50),
    concrete_type VARCHAR(100),
    pickup VARCHAR(255),
    destination_text VARCHAR(255),
    destination_location JSONB, -- Coordinates: {"lat": 16.4, "lng": 102.8, "address": "ขอนแก่น"}
    tax_id VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'COMPLETED', 'EXPIRED'
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for expiring states
CREATE INDEX idx_conversation_states_expiry ON public.conversation_states(expires_at);

-- Trigger function to update updated_at automatically
CREATE OR REPLACE FUNCTION public.update_conversation_states_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to execute on update
CREATE OR REPLACE TRIGGER trigger_update_conversation_states_updated_at
    BEFORE UPDATE ON public.conversation_states
    FOR EACH ROW
    EXECUTE FUNCTION public.update_conversation_states_updated_at();

-- Enable RLS for conversation_states
ALTER TABLE public.conversation_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow service_role full access to conversation_states" 
    ON public.conversation_states 
    FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);

-- Create table for auditing extracted entities
CREATE TABLE public.entity_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    line_user_id VARCHAR(255) NOT NULL,
    event_id UUID NOT NULL REFERENCES public.line_events(id) ON DELETE CASCADE,
    entity_type VARCHAR(100) NOT NULL, -- 'material', 'quantity', 'vehicle_type', 'destination_location', 'destination_text', 'concrete_type', 'tax_id', 'pickup'
    entity_value JSONB NOT NULL, -- Stored actual value: {"value": "ทรายถม"}, {"lat": 16.4, "lng": 102.8}
    confidence NUMERIC NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for searching entities
CREATE INDEX idx_entity_registry_search ON public.entity_registry(line_user_id, created_at DESC);

-- Enable RLS for entity_registry
ALTER TABLE public.entity_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow service_role full access to entity_registry" 
    ON public.entity_registry 
    FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);
