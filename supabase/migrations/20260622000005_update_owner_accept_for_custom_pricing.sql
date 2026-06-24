-- Drop old function to avoid overloading signature conflicts
DROP FUNCTION IF EXISTS owner_accept(UUID);

-- Redefine owner_accept to support custom_price
CREATE OR REPLACE FUNCTION owner_accept(
    match_id UUID,
    custom_price NUMERIC DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    m RECORD;
    doc_id TEXT;
    final_price NUMERIC;
BEGIN
    SELECT * INTO m FROM match_queue WHERE id = match_id AND status = 'waiting_owner';
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'error', 'message', 'ไม่พบคิวหรือหมดเวลา');
    END IF;
    
    -- Use custom partner pricing or fall back to system calculated pricing
    final_price := COALESCE(custom_price, m.quoted_price);
    
    -- Update status and price in match queue
    UPDATE match_queue 
    SET status = 'accepted',
        quoted_price = final_price
    WHERE id = match_id;
    
    -- Generate document id
    doc_id := 'BQ-' || to_char(now(), 'YYYYMMDD') || '-' || substr(match_id::text, 1, 4);
    
    -- Insert into documents
    INSERT INTO documents (
        id,
        document_type,
        document_number,
        status,
        issue_date,
        party_name,
        show_qr_code,
        discount_amount,
        vat_enabled,
        withholding_tax_percent,
        subtotal_amount,
        base_amount,
        vat_amount,
        gross_amount,
        withholding_amount,
        interest_amount,
        net_amount,
        data,
        source
    )
    VALUES (
        gen_random_uuid(),
        'boq',
        doc_id,
        'confirmed', -- Status limit: 16 chars
        now()::date,
        COALESCE(m.customer_request->>'contact_name', 'ลูกค้าทั่วไป'),
        false,
        0.00,
        false,
        0.00,
        final_price,
        final_price,
        0.00,
        final_price,
        0.00,
        0.00,
        final_price,
        jsonb_build_object(
            'match_id', match_id,
            'customer_line_id', m.customer_line_id,
            'pit_id', m.pit_id,
            'driver_id', m.driver_id,
            'quoted_price', final_price,
            'status', 'confirmed',
            'created_via', 'matcher_engine'
        ),
        'matcher_engine'
    );
    
    -- Notify customer channel
    PERFORM pg_notify('customer_notify', jsonb_build_object(
        'customer_line_id', m.customer_line_id,
        'doc_id', doc_id,
        'price', final_price
    )::text);
    
    RETURN jsonb_build_object('status', 'success', 'doc_id', doc_id, 'price', final_price);
END;
$$;
