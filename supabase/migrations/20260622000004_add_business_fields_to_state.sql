-- Add business qualification fields to public.conversation_states table
ALTER TABLE public.conversation_states 
ADD COLUMN IF NOT EXISTS project_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS payer_name VARCHAR(255);
