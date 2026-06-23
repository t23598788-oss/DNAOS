# DNAOS Prompt Assembly Analysis Report

รายงานนี้วิเคราะห์โค้ดฟังก์ชัน `askGeminiAgent()` ในไฟล์ `line-webhook/index.ts` เพื่อระบุตำแหน่งที่มีการประกอบบริบท (Prompt Assembly) และค้นหาจุดบกพร่องที่ทำให้ข้อมูลประวัติบทสนทนาสูญหายไประหว่างกระบวนการส่งต่อข้อมูลไปยัง Gemini API

---

## 1. historyEvents ถูกส่งเข้า Gemini ตรงไหน (Where historyEvents is Sent)
*   **ไม่มีจุดใดเลยที่ส่งเข้า API**: 
    *   ในฟังก์ชันด่านหน้าของ webhook มีการดึงประวัติบทสนทนาย้อนหลัง 6 ข้อความมาเก็บในตัวแปร `history` แล้วส่งผ่านพารามิเตอร์ของฟังก์ชัน:
        ```typescript
        let replyText = await askGeminiAgent(text, history, contextData)
        ```
    *   อย่างไรก็ตาม เมื่อเข้าสู่ภายในตัวฟังก์ชัน `askGeminiAgent` ตัวแปร `history` **ไม่มีการนำไปอ้างอิงหรือประมวลผลต่อเพื่อส่งไปยัง API ของ Gemini เลยแม้แต่จุดเดียว**

---

## 2. historyEvents ถูก discard ตรงไหน (Where historyEvents is Discarded)
*   **ถูกละทิ้งภายในขอบเขตฟังก์ชัน `askGeminiAgent`**:
    *   อาร์กิวเมนต์ `history: any[]` ถูกระบุอยู่ใน Parameter Signature ของฟังก์ชันเพื่อรับค่าเข้ามา
    *   แต่เมื่อมีการส่งคำสั่งผ่านคำสั่ง Fetch เพื่อเรียก API ของ Gemini ไปที่ endpoint `generativelanguage.googleapis.com` ตัวแปร `history` กลับไม่ถูกแปลงหรือใส่ร่วมในฟิลด์ JSON ของ Body เลย
    *   ค่าในตัวแปรนี้จึงสลายตัวไปจากการทำ Garbage Collection ของ Deno ทันทีหลังจากรันฟังก์ชัน `askGeminiAgent` เสร็จสิ้น

---

## 3. contextData ถูกประกอบเป็น Prompt อย่างไร (How contextData is Composed)
*   **ขั้นตอนการแปลงและแทรก**:
    1.  ระบบใช้คำสั่ง `JSON.stringify(contextData, null, 2)` เพื่อแปลงโครงสร้างของตัวแปรอาร์เรย์/ออบเจกต์ของ `contextData` ให้เป็นสตริงข้อความ JSON
    2.  ตัวแปรสตริง JSON ดังกล่าวจะถูกเชื่อมต่อเข้าท้ายประโยคของตัวแปร `systemPrompt` (ซึ่งระบุข้อห้ามคำว่า "ลูกค้า" และโครง BOQ) ภายใต้หัวข้อ `Context variables:` ดังนี้:
        ```typescript
        Context variables:
        ${JSON.stringify(contextData, null, 2)}
        ```
    3.  จากนั้น ตัวแปร `systemPrompt` ทั้งหมดนี้จะถูกนำส่งเข้าไปใน JSON Body ส่วนของฟิลด์ `systemInstruction`

---

## 4. systemInstruction ถูกส่งเข้า Gemini อย่างไร (How systemInstruction is Sent)
*   **ขั้นตอนการยิง API**:
    *   ส่งผ่านฟิลด์โครงสร้าง `systemInstruction` ในระดับบนสุด (Top-level Field) ของออบเจกต์ที่ส่งไปยัง API ของ Gemini ดังคำสั่ง:
        ```typescript
        systemInstruction: { parts: [{ text: systemPrompt }] }
        ```
    *   โครงสร้างนี้จะทำหน้าที่เป็นคำสั่งระบบ (System Prompt) เพื่อจัดทัศนคติ บทบาท (Persona) และกฎข้อห้ามของ AI ตัวบอท

---

## 5. userMessage ถูก merge กับ history หรือไม่ (Is userMessage Merged with History?)
**ไม่ได้ถูกนำมารวมกัน (No Merging)**:
*   ฟิลด์ `contents` ซึ่งเป็นฟิลด์หลักเก็บการสนทนาใน API ถูกระบุแบบ Hardcode โดยใช้เฉพาะข้อความล่าลุด `userMessage` ของลูกค้าที่ป้อนเข้ามาในปัจจุบันเท่านั้น:
    ```typescript
    contents: [
      { role: 'user', parts: [{ text: `User message: "${userMessage}"` }] }
    ]
    ```
*   ไม่มีส่วนใดของโค้ดที่ทำหน้าที่นำสตริง `userMessage` มาต่อเชื่อมหรือควบรวมกับข้อมูลในอาร์เรย์ `history` เลย

---

## 6. จุดแก้ไขน้อยที่สุดที่ทำให้ Gemini เห็นประวัติ 6 ข้อความล่าสุด (Minimal Fix Required)
เนื่องจากระบบบันทึกเฉพาะข้อความขาเข้าของผู้ใช้ลงในตาราง `line_events` เท่านั้น (ไม่ได้บันทึกข้อความตอบกลับของบอท) การพยายามแปลง `history` ไปใส่โครงสร้างสลับบทสนทนา (`user` ➔ `model` ➔ `user`) จะทำได้ยากและอาจส่งผลให้เกิดข้อผิดพลาดของ Gemini API เรื่องสิทธิ์การสลับ Role (Role Alternation Error)

**จุดแก้ไขที่น้อยและปลอดภัยที่สุด (Minimal Code Patch)**:
แก้ไขเฉพาะในฟังก์ชัน `askGeminiAgent()` โดยการจัดรูปแบบประวัติข้อความของลูกค้าให้อยู่ในรูปของสตริงข้อความ แล้วนำไปส่งร่วมกับ `userMessage` ล่าสุด ภายในอาเรย์ `contents` ดังนี้:

```typescript
// 1. แปลงอาร์เรย์ history ให้เป็นข้อความสตริงประวัติย้อนหลัง
const formattedHistory = history && history.length > 0 
  ? history.map(h => `- [ก่อนหน้า] User: ${h.text}`).join('\n') 
  : "ไม่มีประวัติการคุยก่อนหน้านี้";

// 2. นำไปจัดรวมส่งในส่วน contents ของ API Fetch
body: JSON.stringify({
  contents: [
    { 
      role: 'user', 
      parts: [{ 
        text: `Conversation History:\n${formattedHistory}\n\nLatest User message: "${userMessage}"` 
      }] 
    }
  ],
  systemInstruction: { parts: [{ text: systemPrompt }] },
  generationConfig: { maxOutputTokens: 600, temperature: 0.5 }
})
```

*   **ผลลัพธ์ของวิธีนี้**:
    *   ใช้การแก้ไขโค้ดเพียงแค่ 2-3 บรรทัดเฉพาะภายในฟังก์ชัน `askGeminiAgent`
    *   ทำให้ Gemini รับรู้เรื่องราวการแชทก่อนหน้าได้ทันที (เช่น ลูกค้าเพิ่งแชร์พิกัดมา หรือเพิ่งแจ้งเลือกวัสดุไป)
    *   ป้องกันข้อผิดพลาดในการเรียกใช้ API ของ Gemini ได้อย่างสมบูรณ์เนื่องจากข้อมูลอยู่ภายใต้ Role `user` เดียวกัน
    *   ไม่ต้องการการทำ Database Migration หรือแก้ไข Schema ใด ๆ ทั้งสิ้น
