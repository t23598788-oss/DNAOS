import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ""
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ""
    const googleApiKey = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? ""
    const lineNotifyToken = Deno.env.get('LINE_NOTIFY_TOKEN') ?? ""

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse payload
    const body = await req.json()
    const { job_id, project_name, latitude, longitude } = body

    if (!job_id || !latitude || !longitude) {
      return new Response(JSON.stringify({ error: "Missing required parameters: job_id, latitude, longitude" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`Scouting for project: ${project_name} at coordinates: ${latitude}, ${longitude}`)

    // 1. Call spatial RPC function in database to check partners within 20km (20,000 meters)
    const { data: partners, error: rpcError } = await supabase.rpc('find_partners_in_range', {
      job_lat: latitude,
      job_lng: longitude,
      range_meters: 20000
    })

    if (rpcError) {
      console.error("RPC Error:", rpcError)
      throw rpcError
    }

    // 2. If there are partners in range, stop and return them
    if (partners && partners.length > 0) {
      console.log(`Found ${partners.length} partners within 20km. No need to scout.`)
      return new Response(JSON.stringify({ status: "skipped", message: "Partners exist within range", partners }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log("No partners found within 20km. Triggering AI Scout system via Google Maps Places API...")

    // 3. Call Google Places Text Search to scout for material shops or pits nearby
    let scoutedPlaces = []
    if (googleApiKey) {
      const query = encodeURIComponent("บ่อดิน บ่อทราย ร้านวัสดุก่อสร้าง")
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&location=${latitude},${longitude}&radius=20000&key=${googleApiKey}`
      
      const res = await fetch(url)
      const data = await res.json()
      
      if (data.status === "OK" && data.results) {
        scoutedPlaces = data.results.slice(0, 3).map((place: any) => ({
          name: place.name,
          address: place.formatted_address,
          place_id: place.place_id,
          rating: place.rating || "N/A",
          latitude: place.geometry?.location?.lat,
          longitude: place.geometry?.location?.lng,
        }))
      }
    } else {
      return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY is not set — ห้าม mock data (Rule 94)" }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 4. Send LINE Notify alert to CEO
    if (lineNotifyToken && scoutedPlaces.length > 0) {
      let message = `\n📢 [AI Scout Alert] ค้นพบหน้างานใหม่แต่ไม่มีคู่ค้าในรัศมี 20 กม.\n\n📍 งาน: ${project_name}\n📌 พิกัดหน้างาน: ${latitude}, ${longitude}\n\n🔍 เสนอรายชื่อผู้ผลิต/คู่ค้าใกล้เคียงเพื่อเจรจา:\n`
      
      scoutedPlaces.forEach((place, index) => {
        message += `\n${index + 1}. ${place.name}\n📍 ที่ตั้ง: ${place.address}\n⭐ เรตติ้ง: ${place.rating}\n🔗 แผนที่: https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}\n`
      })
      
      const lineUrl = "https://notify-api.line.me/api/notify"
      const response = await fetch(lineUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Bearer ${lineNotifyToken}`
        },
        body: new URLSearchParams({ message }).toString()
      })
      
      if (!response.ok) {
        console.error("Failed to send LINE Notify:", await response.text())
      } else {
        console.log("Successfully sent LINE Notify alert to CEO.")
      }
    } else {
      console.warn("LINE_NOTIFY_TOKEN is not configured or no places scouted. Skipping notification.")
    }

    return new Response(JSON.stringify({ status: "scouted", count: scoutedPlaces.length, places: scoutedPlaces }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error("Error executing scout-map:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
