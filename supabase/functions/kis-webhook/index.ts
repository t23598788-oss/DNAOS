import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper to parse duration string (e.g. "3 hours 30 minutes" -> 3.5 hours)
function parseDurationToHours(text: string): number {
  const durationMatch = text.match(/Duration:\s*(\d+)\s*hours?\s*(\d+)\s*minutes?/i)
  if (durationMatch) {
    const hours = parseInt(durationMatch[1], 10)
    const minutes = parseInt(durationMatch[2], 10)
    return hours + (minutes / 60)
  }
  // Try matching just minutes
  const minutesMatch = text.match(/Duration:\s*(\d+)\s*minutes?/i)
  if (minutesMatch) {
    return parseInt(minutesMatch[1], 10) / 60
  }
  // Try matching decimal hours
  const decimalMatch = text.match(/Duration:\s*([\d\.]+)\s*hours?/i)
  if (decimalMatch) {
    return parseFloat(decimalMatch[1])
  }
  return 0
}

// Helper to extract values using RegExp
function extractValue(text: string, label: string): string {
  const regex = new RegExp(`${label}:\\s*(.+)`, 'i')
  const match = text.match(regex)
  return match ? match[1].trim() : ""
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ""
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ""
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse the payload (expecting JSON from email webhook like SendGrid Inbound Parse)
    const payload = await req.json()
    console.log("Received KIS Email webhook:", JSON.stringify(payload))

    const bodyText = payload.text || ""
    
    // Extract metadata from the email body
    const machine = extractValue(bodyText, "Machine") || "Kubota Excavator"
    const event = extractValue(bodyText, "Event") || "Engine Stop"
    const jobId = extractValue(bodyText, "Job ID")
    const startTimeStr = extractValue(bodyText, "Start Time")
    const stopTimeStr = extractValue(bodyText, "Stop Time")
    
    const durationHours = parseDurationToHours(bodyText)

    if (!jobId) {
      console.warn("No Job ID found in email payload. Skipping transaction entry.")
      return new Response(JSON.stringify({ error: "Missing Job ID in email body text" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (durationHours <= 0) {
      console.log(`Event is ${event} (Duration: 0). Skipping resource transaction log.`);
      return new Response(JSON.stringify({ status: "skipped", message: "Duration is 0 or event is not a stopping event" }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 1. Fetch dynamic config (e.g., fuel price ref, backhoe rate) from app_configs to prevent hardcoding
    const { data: configRows, error: configError } = await supabase
      .from('app_configs')
      .select('title, data')
      .in('title', ['fuel_price_ref', 'machinery_base_rate_per_hour'])

    if (configError) {
      console.error("Failed to fetch app_configs:", configError)
    }

    let fuelPriceRef = 35.00 // Default fallback fuel price
    let baseRateRef = 600.00 // Default fallback hourly rate

    if (configRows) {
      configRows.forEach((row: any) => {
        if (row.title === 'fuel_price_ref') {
          fuelPriceRef = parseFloat(row.data) || fuelPriceRef
        } else if (row.title === 'machinery_base_rate_per_hour') {
          baseRateRef = parseFloat(row.data) || baseRateRef
        }
      })
    }

    // 2. Calculate dynamic cost and pricing structure
    // Dynamic formula: hourly cost = base machinery rate + (fuel consumption * fuel price)
    const fuelConsumptionPerHour = 8.5 // liters per hour for Kubota U-55
    const unitCost = baseRateRef + (fuelConsumptionPerHour * fuelPriceRef)
    
    // Dynamic markup margin based on pricing model (e.g., 25% markup)
    const markupMargin = unitCost * 0.25
    const unitPrice = unitCost + markupMargin

    const totalCost = durationHours * unitCost
    const totalPrice = durationHours * unitPrice

    // 3. Save to public.resource_transactions
    const { data: tx, error: txError } = await supabase
      .from('resource_transactions')
      .insert({
        job_id: jobId,
        resource_type: 'machinery_hours',
        resource_label: machine,
        quantity: durationHours,
        unit: 'ชั่วโมง',
        unit_cost: parseFloat(unitCost.toFixed(2)),
        unit_price: parseFloat(unitPrice.toFixed(2)),
        markup_margin: parseFloat(markupMargin.toFixed(2)),
        total_cost: parseFloat(totalCost.toFixed(2)),
        total_price: parseFloat(totalPrice.toFixed(2)),
        note: `อีเมลแจ้งเตือนอัตโนมัติจากระบบ Kubota KIS (${event})\nStart: ${startTimeStr}\nStop: ${stopTimeStr}`,
        meta: {
          raw_email_subject: payload.subject,
          start_time: startTimeStr,
          stop_time: stopTimeStr,
          raw_body: bodyText,
          calculated_using: {
            fuel_price: fuelPriceRef,
            base_hourly_rate: baseRateRef,
            fuel_consumption_rate: fuelConsumptionPerHour
          }
        }
      })
      .select()
      .single()

    if (txError) {
      console.error("Failed to insert resource transaction:", txError)
      throw txError
    }

    console.log("Successfully inserted resource transaction:", tx)

    return new Response(JSON.stringify({ status: "success", transaction: tx }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error("Error executing KIS Webhook:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
