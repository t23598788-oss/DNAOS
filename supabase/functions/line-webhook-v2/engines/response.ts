import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";
import { sanitizePricing, RawPricingData } from "../middleware/sanitizer.ts";

async function logErrorToDb(errorMsg: string) {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data: latestEvent } = await supabase
        .from('line_events')
        .select('id, admin_note')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestEvent) {
        let note = {};
        try {
          note = JSON.parse(latestEvent.admin_note || '{}');
        } catch {
          note = { raw_note: latestEvent.admin_note };
        }
        const updatedNote = { ...note, webhook_v2_error: errorMsg };
        await supabase
          .from('line_events')
          .update({ admin_note: JSON.stringify(updatedNote) })
          .eq('id', latestEvent.id);
      }
    }
  } catch (e) {
    console.error('Failed to log error to DB:', e);
  }
}

/**
 * STRICTLY PRIVATE: replyToLine.
 * Dispatches raw messages directly to the LINE Messaging API.
 */
async function replyToLine(replyToken: string, text: string) {
  const lineAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
  if (!lineAccessToken) {
    console.log(`[LINE Reply Mock] Reply Token: ${replyToken}, Message: ${text}`);
    return;
  }

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lineAccessToken}`
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text }]
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Failed to reply to LINE:', errorText);
      await logErrorToDb(`Failed to reply to LINE: ${errorText}`);
    }
  } catch (err) {
    console.error('Error sending reply to LINE:', err);
    await logErrorToDb(`Error sending reply to LINE: ${(err as any).message || err}`);
  }
}

/**
 * STRICTLY PRIVATE: pushToLine.
 * Dispatches raw messages directly to the LINE Messaging API via push endpoint.
 */
async function pushToLine(to: string, text: string) {
  const lineAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
  if (!lineAccessToken) {
    console.log(`[LINE Push Mock] To: ${to}, Message: ${text}`);
    return;
  }

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lineAccessToken}`
      },
      body: JSON.stringify({
        to,
        messages: [{ type: 'text', text }]
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Failed to push to LINE:', errorText);
      await logErrorToDb(`Failed to push to LINE: ${errorText}`);
    }
  } catch (err) {
    console.error('Error sending push to LINE:', err);
    await logErrorToDb(`Error sending push to LINE: ${(err as any).message || err}`);
  }
}

/**
 * STRICTLY PRIVATE: sendLineNotify.
 * Dispatches raw notifications to the CEO administrative group.
 */
async function sendLineNotify(message: string) {
  const lineNotifyToken = Deno.env.get('LINE_NOTIFY_TOKEN');
  if (!lineNotifyToken) {
    console.log(`[LINE Notify Mock] CEO Alert: ${message}`);
    return;
  }

  try {
    await fetch('https://notify-api.line.me/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${lineNotifyToken}`
      },
      body: new URLSearchParams({ message }).toString()
    });
  } catch (err) {
    console.error('Error sending LINE Notify:', err);
  }
}

/**
 * STRICTLY PRIVATE: askGeminiAgent.
 * Queries the Gemini LLM for conversational sales styling.
 */
async function askGeminiAgent(userMessage: string, history: any[], contextData: any): Promise<string | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return null;

  try {
    const systemPrompt = `You are a warm, highly professional Thai B2B materials coordinator and project quotation helper for DNA OS.
Your goal is to answer queries and present calculated pricing structures.
CRITICAL CONSTRAINT RULES (RULES THAT MUST NOT BE VIOLATED):
1. NEVER use the word "ลูกค้า" (customer) under any circumstances. Use words like "คุณ", "ท่าน", or "โครงการ" instead.
2. NEVER use the word "ขาย" (sell/sales/close sales) under any circumstances. Use terms like "จัดหา", "เสนอราคา", "ประสานงานจองคิวรถจัดส่ง" instead.
3. Always speak in polite, project-oriented Thai (use particles like ครับ, ค่ะ, ท่าน, คุณ).
Context variables:
${JSON.stringify(contextData, null, 2)}`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `User message: "${userMessage}"` }] }
        ],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { maxOutputTokens: 300, temperature: 0.5 }
      })
    });

    if (!res.ok) {
      console.warn('Gemini Agent API call failed:', await res.text());
      return null;
    }

    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error('Gemini Agent Error:', err);
    return null;
  }
}

export type ResponsePayload = 
  | { type: 'VALIDATION_ERROR'; message: string }
  | { type: 'LOCATION_RECEIVED'; address: string; pitName: string; distance: number }
  | { type: 'PRELIMINARY_PRICING'; rawPricing: RawPricingData; missingFieldsText: string }
  | { type: 'BOQ_DRAFT'; rawPricing: RawPricingData; draftId: string; projectName: string; contactName: string; contactPhone: string; payer_name: string; address: string; vehicleLabel: string; routingText: string; history: any[] }
  | { type: 'CEO_DRAFT_ALERT'; draftId: string; projectName: string; contactName: string; contactPhone: string; totalPrice: number };

/**
 * Universal Response Gateway.
 * Enforces sanitization pipelines before message delivery.
 */
export class ResponseGateway {
  static async pushMessage(to: string, text: string) {
    await pushToLine(to, text);
  }

  static async pushFacebookMessage(pageId: string, text: string) {
    console.log(`[Facebook Push Integration] Page: ${pageId}, Message: ${text}`);
    const fbAccessToken = Deno.env.get('FACEBOOK_PAGE_ACCESS_TOKEN');
    if (!fbAccessToken) return;

    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${fbAccessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: pageId },
          message: { text }
        })
      });
      if (!res.ok) {
        console.error('Failed to notify Facebook partner:', await res.text());
      }
    } catch (err) {
      console.error('Error sending FB message:', err);
    }
  }

  static async pushTikTokMessage(tiktokUserId: string, text: string) {
    console.log(`[TikTok Push Integration] User: ${tiktokUserId}, Message: ${text}`);
    const tiktokAccessToken = Deno.env.get('TIKTOK_ACCESS_TOKEN');
    if (!tiktokAccessToken) return;

    try {
      const res = await fetch(`https://open.tiktokapis.com/v2/chat/message/send/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tiktokAccessToken}`
        },
        body: JSON.stringify({
          recipient_user_id: tiktokUserId,
          message: { text }
        })
      });
      if (!res.ok) {
        console.error('Failed to notify TikTok partner:', await res.text());
      }
    } catch (err) {
      console.error('Error sending TikTok message:', err);
    }
  }

  static async dispatchResponse(
    replyToken: string | null,
    payload: ResponsePayload,
    channel: 'CUSTOMER_LINE' | 'CEO_NOTIFY'
  ) {
    // Route CEO Administrative alerts
    if (channel === 'CEO_NOTIFY') {
      if (payload.type === 'CEO_DRAFT_ALERT') {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://tmxkiripdvorrcnuezvm.supabase.co';
        const approvalLink = `${supabaseUrl}/dashboard/drafts/${payload.draftId}`;
        const formattedPrice = (payload.totalPrice ?? 0).toLocaleString();

        const msg = `\n[AI Quote Request] ลูกค้าขอใบเสนอราคาใหม่ผ่านไลน์\n` +
          `โครงการ: ${payload.projectName}\n` +
          `ผู้ติดต่อ: ${payload.contactName} (${payload.contactPhone})\n` +
          `ยอดเสนอประเมิน: ${formattedPrice} บาท\n` +
          `อนุมัติเอกสารคลิก: ${approvalLink}`;
        await sendLineNotify(msg);
      }
      return;
    }

    if (!replyToken) return;

    let replyText = "";

    switch (payload.type) {
      case 'VALIDATION_ERROR': {
        replyText = payload.message;
        break;
      }
      case 'LOCATION_RECEIVED': {
        const genericPit = "บ่อวัสดุในระบบ";
        replyText = `ระบบทำการบันทึกพิกัดโครงการจัดส่งเรียบร้อยแล้วครับ\n` +
          `จุดส่ง: ${payload.address}\n` +
          `แหล่งผลิต: ${genericPit} (ระยะจริง ${payload.distance.toFixed(2)} กม.)\n\n` +
          `ท่านสามารถระบุวัสดุและจำนวนที่ต้องการ (เช่น ทรายถม 200 คิว หรือ ดินถม 100 คิว) เพื่อจัดทำร่างเอกสารประมาณราคาเสนอผู้บริหารได้ทันทีครับ`;
        break;
      }
      case 'PRELIMINARY_PRICING': {
        const sanitized = sanitizePricing(payload.rawPricing);
        
        const getOptionText = (label: string, cap: number) => {
          const trips = Math.ceil(sanitized.quantity / cap);
          const totalTransport = trips * sanitized.customerTransportUnitPrice;
          const total = sanitized.customerMaterialTotal + totalTransport;
          return `- ${label} (บรรจุ ${cap} คิว - ${trips} เที่ยว):\n` +
                 `  - ค่าส่ง: ${sanitized.customerTransportUnitPrice.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})} บาท/เที่ยว (รวม ${totalTransport.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})} บาท)\n` +
                 `  - รวมวัสดุ+ค่าส่ง: ${total.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})} บาท`;
        };

        let transportOptionsText = "";
        const vehicle = payload.rawPricing.vehicle_type;
        if (vehicle) {
          const cap = vehicle === 'trailer' ? 30.00 : (vehicle === '6_wheeler' ? 5.00 : 10.00);
          const label = vehicle === 'trailer' ? 'รถพ่วง' : (vehicle === '6_wheeler' ? 'รถหกล้อ' : 'รถสิบล้อ');
          transportOptionsText = getOptionText(label, cap);
        } else {
          transportOptionsText = getOptionText('รถหกล้อ', 5.00) + '\n' +
                                 getOptionText('รถสิบล้อ', 10.00) + '\n' +
                                 getOptionText('รถพ่วง', 30.00);
        }

        replyText = `ราคาประเมินเบื้องต้น\n\n` +
          `วัสดุ: ${sanitized.resolvedMatName}\n` +
          `ปริมาณ: ${sanitized.quantity} คิว\n` +
          `จุดส่ง: ${sanitized.targetDistance} กม. (${sanitized.matchedPitName})\n` +
          `ราคาวัสดุ: ${sanitized.customerMaterialUnitPrice.toLocaleString()} บาท/คิว (รวม: ${sanitized.customerMaterialTotal.toLocaleString()} บาท)\n\n` +
          `[ค่าขนส่งและยอดรวมประเมิน]:\n` +
          `${transportOptionsText}\n\n` +
          `ข้อมูลไม่เพียงพอสำหรับการจัดทำ BOQ / ใบเสนอราคาอย่างเป็นทางการ\n\n` +
          `รบกวนแจ้งข้อมูลโครงการและข้อมูลติดต่อเพิ่มเติมดังนี้ครับ:\n` +
          `${payload.missingFieldsText}\n\n` +
          `เมื่อได้รับข้อมูลครบถ้วนแล้ว ระบบจะออกใบร่างเสนอราคา BOQ อัตโนมัติทันทีครับ`;
        break;
      }
      case 'BOQ_DRAFT': {
        const sanitized = sanitizePricing(payload.rawPricing);
        
        const boqText = `ร่างประมาณราคา (BOQ Draft)\n\n` +
          `[ข้อมูลโครงการจัดส่ง]\n` +
          `โครงการ: ${payload.projectName}\n` +
          `ผู้ติดต่อ: ${payload.contactName} (โทร ${payload.contactPhone})\n` +
          `ผู้ชำระเงิน: ${payload.payer_name}\n` +
          `จุดส่ง: ${payload.address}\n` +
          `แหล่งผลิต: ${sanitized.matchedPitName} (${sanitized.targetDistance} กม.)\n\n` +
          `[ตารางประมาณราคา]\n` +
          `1. วัสดุ: ${sanitized.resolvedMatName}\n` +
          `   - ปริมาณ: ${sanitized.quantity} คิว\n` +
          `   - ราคาวัสดุ: ${sanitized.customerMaterialUnitPrice} บาท/คิว\n` +
          `   - รวมค่าวัสดุ: ${sanitized.customerMaterialTotal.toLocaleString()} บาท\n` +
          `2. ค่าส่ง (${sanitized.trips} เที่ยวด้วย${payload.vehicleLabel}):\n` +
          `   - อัตราค่าส่ง: ${sanitized.customerTransportUnitPrice.toLocaleString()} บาท/เที่ยว\n` +
          `   - รวมค่าขนส่ง: ${sanitized.customerTransportTotal.toLocaleString()} บาท\n\n` +
          `ยอดรวมสุทธิ: ${sanitized.customerNetTotal.toLocaleString()} บาท\n` +
          `เลขอ้างอิง: ${payload.draftId}\n\n` +
          `ข้อมูลนี้ได้ถูกบันทึกเข้าระบบเป็นใบร่าง BOQ เรียบร้อยแล้วครับ และส่งแจ้งเตือนผู้บริหารเพื่ออนุมัติเงื่อนไขในระบบเรียบร้อยแล้วครับ สะดวกให้เข้าจัดส่งในช่วงวันไหนดีครับ?`;

        replyText = boqText;

        // Dynamic LLM Customization using Sanitized context
        const apiKey = Deno.env.get('GEMINI_API_KEY');
        if (apiKey) {
          // Sanitized context sent to LLM to prevent internal leakage
          const contextData = {
            resolvedMatName: sanitized.resolvedMatName,
            quantity: sanitized.quantity,
            targetDistance: sanitized.targetDistance,
            trips: sanitized.trips,
            totalPrice: sanitized.customerNetTotal,
            vehicleLabel: payload.vehicleLabel
          };
          const geminiReply = await askGeminiAgent(payload.routingText, payload.history, contextData);
          if (geminiReply) {
            let cleanGemini = geminiReply.replace(/\[CREATE_DRAFT:\s*({.+?})\]/, '').trim();
            replyText = cleanGemini.length > 0 ? `${cleanGemini}\n\n${boqText}` : boqText;
          }
        }
        break;
      }
    }

    await replyToLine(replyToken, replyText);
  }
}
