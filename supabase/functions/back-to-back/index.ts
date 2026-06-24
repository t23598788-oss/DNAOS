import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Function to send LINE Notify to CEO
async function sendLineNotify(message: string) {
  const lineNotifyToken = Deno.env.get('LINE_NOTIFY_TOKEN')
  if (!lineNotifyToken) {
    console.log(`[LINE Notify Mock] Token not configured. Message: ${message}`)
    return
  }

  try {
    const res = await fetch('https://notify-api.line.me/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${lineNotifyToken}`
      },
      body: new URLSearchParams({ message }).toString()
    })

    if (!res.ok) {
      console.error('Failed to send LINE Notify:', await res.text())
    } else {
      console.log('Successfully sent LINE Notify')
    }
  } catch (err) {
    console.error('Error sending LINE Notify:', err)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return new Response(JSON.stringify({ error: 'Internal configuration error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Webhook Security Verification
    // Retrieve secret token from database config to match trigger header and block unauthorized invocations
    const { data: dbSecretRow } = await supabase
      .from('app_configs')
      .select('data')
      .eq('title', 'webhook-secret-token')
      .maybeSingle()

    const expectedSecret = dbSecretRow?.data || 'clearinghouse_sec_token_999'
    const receivedSecret = req.headers.get('X-Webhook-Secret')

    if (receivedSecret !== expectedSecret) {
      console.error('Security verification failed: X-Webhook-Secret mismatch')
      return new Response(JSON.stringify({ error: 'Unauthorized webhook invocation' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Parse webhook payload
    const body = await req.json()
    console.log('Received Back-to-Back trigger payload:', JSON.stringify(body))

    const { table, type, record } = body

    if (!table || !record) {
      return new Response(JSON.stringify({ error: 'Invalid payload structure' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Resolve the parent invoice document ID
    let parentInvoiceId = null

    if (table === 'invoice_payments' && type === 'INSERT') {
      const debtId = record.invoice_debt_id
      if (!debtId) {
        return new Response(JSON.stringify({ error: 'Missing invoice_debt_id in payment' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Query the debt to find document_id
      const { data: debt, error: debtError } = await supabase
        .from('invoice_debts')
        .select('document_id')
        .eq('id', debtId)
        .single()

      if (debtError || !debt) {
        console.error('Error fetching invoice debt:', debtError)
        return new Response(JSON.stringify({ error: 'Invoice debt not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      parentInvoiceId = debt.document_id

    } else if (table === 'invoice_debts' && record.invoice_status === 'PAID') {
      parentInvoiceId = record.document_id
    } else if (table === 'documents' && type === 'UPDATE') {
      const doc = record
      const isConfirmed = doc.confirmed_at !== null
      const isSent = doc.status === 'confirmed' || doc.status === 'sent'
      const wasSentAlready = doc.data && doc.data.sent_to_line === true

      if ((isConfirmed || isSent) && !wasSentAlready) {
        console.log(`Processing LINE push notification for document: ${doc.document_number}`)
        
        let lineUserId = doc.draft_data?.payload?.customer_line_id
        if (!lineUserId && doc.party_name) {
          const match = doc.party_name.match(/LINE ID:\s*(U[a-f0-9]+)/i)
          if (match) {
            lineUserId = match[1]
          }
        }

        if (lineUserId) {
          const lineAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
          if (!lineAccessToken) {
            console.error('Missing LINE_CHANNEL_ACCESS_TOKEN environment variable')
          } else {
            let docDetailsText = ''
            if (doc.data && Array.isArray(doc.data.items)) {
              docDetailsText = doc.data.items.map((item: any) => 
                `- ${item.description}: ${item.qty} ${item.unit_label || 'หน่วย'} x ${item.unit_price} = ${item.line_total} บาท`
              ).join('\n')
            }

            const messageText = `📄 เอกสารของท่านได้รับการอนุมัติแล้วครับ\n` +
              `เลขที่: ${doc.document_number}\n` +
              `วันที่ออก: ${doc.issue_date}\n` +
              `ผู้ซื้อ: ${doc.party_name}\n\n` +
              `รายการ:\n${docDetailsText}\n\n` +
              `ยอดรวมสุทธิ: ${parseFloat(doc.net_amount || 0).toLocaleString()} บาท\n\n` +
              `ขอบคุณที่ใช้บริการครับ`

            console.log(`Pushing message to LINE user: ${lineUserId}`)
            const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${lineAccessToken}`
              },
              body: JSON.stringify({
                to: lineUserId,
                messages: [{ type: 'text', text: messageText }]
              })
            })

            if (!lineRes.ok) {
              const errTxt = await lineRes.text()
              console.error(`Failed to send LINE push: ${lineRes.status} - ${errTxt}`)
            } else {
              console.log(`LINE push sent successfully to ${lineUserId}`)
              const updatedData = { ...(doc.data || {}), sent_to_line: true }
              await supabase
                .from('documents')
                .update({ data: updatedData })
                .eq('id', doc.id)
            }
          }
        } else {
          console.warn(`Could not resolve LINE user ID for document: ${doc.document_number}`)
        }
      }

      return new Response(JSON.stringify({ status: 'success', message: 'Documents trigger processed' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!parentInvoiceId) {
      console.log('Skipping back-to-back: no valid PAID invoice ID resolved.')
      return new Response(JSON.stringify({ status: 'skipped', message: 'Not a payment/paid invoice trigger' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Fetch the parent invoice and its items
    const { data: invoice, error: invError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', parentInvoiceId)
      .single()

    if (invError || !invoice) {
      console.error('Error fetching parent invoice:', invError)
      return new Response(JSON.stringify({ error: 'Parent invoice not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Prevent duplicate PO creation for the same invoice
    const { data: existingPO } = await supabase
      .from('documents')
      .select('id, document_number')
      .eq('document_type', 'purchase-order')
      .eq('reference_number', invoice.document_number)
      .maybeSingle()

    if (existingPO) {
      console.log(`Back-to-back purchase order already exists for this invoice: ${existingPO.document_number}`)
      return new Response(JSON.stringify({ status: 'skipped', message: 'PO already exists', po: existingPO }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: items, error: itemsError } = await supabase
      .from('document_items')
      .select('*')
      .eq('document_id', parentInvoiceId)

    if (itemsError || !items || items.length === 0) {
      console.error('Error fetching invoice items:', itemsError)
      return new Response(JSON.stringify({ error: 'Invoice items not found or empty' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Determine the Supplier Partner
    const customerId = invoice.partner_id
    let supplierPartner = null

    // Fetch potential suppliers who are not the customer
    const { data: potentialSuppliers, error: supplierError } = await supabase
      .from('partners')
      .select('*')
      .neq('id', customerId || '')
      .in('partner_type_id', ['CORPORATE', 'RESOURCE'])
      .limit(5)

    if (supplierError) {
      console.error('Error fetching suppliers:', supplierError)
    }

    if (potentialSuppliers && potentialSuppliers.length > 0) {
      // Prioritize suppliers matching name keywords like "เคแพค", "ซี พี เอ ซี", "เคที" or select first one
      supplierPartner = potentialSuppliers.find((s: any) => 
        s.name.includes('เคแพค') || s.name.includes('เคที') || s.name.includes('ซี พี เอ ซี')
      ) || potentialSuppliers[0]
    }

    if (!supplierPartner) {
      return new Response(JSON.stringify({ error: 'No suitable supplier partner found in system' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 5. Atomic Counter Update using RPC
    // Prevents duplicate PO numbers during concurrent executions
    const { data: newNumber, error: rpcError } = await supabase
      .rpc('increment_counter', { counter_key: 'purchase-order' })

    if (rpcError || !newNumber) {
      console.error('Atomic RPC counter increment failed:', rpcError)
      throw new Error('Failed to generate atomic purchase order counter')
    }

    const lastNumber = newNumber

    // Format new PO document number
    const today = new Date()
    const yyyymmdd = today.toISOString().split('T')[0].replace(/-/g, '')
    const poNumber = `PO-${yyyymmdd}-${String(lastNumber).padStart(3, '0')}`

    // 6. Calculate offset purchase prices (cost = 80% of selling price to represent cost/markup relation)
    let totalPOBase = 0
    const poItems = items.map((item: any) => {
      const purchaseUnitPrice = parseFloat((parseFloat(item.unit_price) * 0.8).toFixed(2))
      const lineTotal = parseFloat((item.qty * purchaseUnitPrice).toFixed(2))
      totalPOBase += lineTotal

      return {
        line_no: item.line_no,
        description: item.description,
        qty: item.qty,
        unit_key: item.unit_key,
        unit_label: item.unit_label,
        unit_price: purchaseUnitPrice,
        line_total: lineTotal
      }
    })

    const vatEnabled = invoice.vat_enabled || false
    const vatRate = 0.07
    const vatAmount = vatEnabled ? parseFloat((totalPOBase * vatRate).toFixed(2)) : 0
    const grossAmount = totalPOBase + vatAmount
    const netAmount = grossAmount

    // 7. Insert new Purchase Order document
    const { data: newPO, error: poInsertError } = await supabase
      .from('documents')
      .insert({
        document_type: 'purchase-order',
        document_number: poNumber,
        reference_number: invoice.document_number,
        partner_id: supplierPartner.id,
        party_name: supplierPartner.name,
        party_tax_id: supplierPartner.tax_id,
        party_address: supplierPartner.address,
        party_contact: supplierPartner.contact_name,
        party_tel: supplierPartner.phone,
        status: 'saved',
        issue_date: today.toISOString().split('T')[0],
        due_date: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        discount_amount: 0,
        vat_enabled: vatEnabled,
        vat_mode: invoice.vat_mode || 'exclude',
        withholding_tax_percent: 0,
        subtotal_amount: totalPOBase,
        base_amount: totalPOBase,
        vat_amount: vatAmount,
        gross_amount: grossAmount,
        net_amount: netAmount,
        show_qr_code: false
      })
      .select()
      .single()

    if (poInsertError || !newPO) {
      console.error('Error inserting PO:', poInsertError)
      return new Response(JSON.stringify({ error: 'Failed to create PO document', details: poInsertError }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 8. Insert PO items
    const insertedPOItems = poItems.map(item => ({
      ...item,
      document_id: newPO.id
    }))

    const { error: itemsInsertError } = await supabase
      .from('document_items')
      .insert(insertedPOItems)

    if (itemsInsertError) {
      console.error('Error inserting PO items:', itemsInsertError)
      // Rollback PO document if items fail
      await supabase.from('documents').delete().eq('id', newPO.id)
      return new Response(JSON.stringify({ error: 'Failed to create PO items', details: itemsInsertError }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`Successfully generated back-to-back PO: ${poNumber} for supplier: ${supplierPartner.name}`)

    // 9. Trigger LINE Notify to CEO
    const notifyMsg = `\n📢 [AI Back-to-Back Billing]\n` +
      `ใบแจ้งหนี้ ${invoice.document_number} ได้รับการชำระเงินเรียบร้อยแล้ว\n` +
      `ระบบได้ทำการออกใบสั่งซื้อ (PO) แบบ Back-to-Back ชดเชยภาษีอัตโนมัติ:\n` +
      `📄 เลขที่ PO: ${poNumber}\n` +
      `🏢 ซัพพลายเออร์: ${supplierPartner.name}\n` +
      `💰 ยอดจัดซื้อ (ต้นทุน): ${netAmount.toLocaleString()} บาท (ลดภาระภาษีบริษัท)`

    await sendLineNotify(notifyMsg)

    return new Response(JSON.stringify({ status: 'success', po_number: poNumber, supplier: supplierPartner.name }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Unhandled back-to-back error:', error)
    return new Response(JSON.stringify({ error: (error as any).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
