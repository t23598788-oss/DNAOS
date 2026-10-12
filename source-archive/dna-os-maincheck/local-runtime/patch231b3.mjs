// patch231b3: planning prompt + coverage enforcement (node script — utf8 safe)
import { readFileSync, writeFileSync } from "node:fs"
const path = "/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/local-runtime/cline-worker/worker.mjs"
let s = readFileSync(path, "utf8")

if (!s.includes("PLAN JSON")) {
  const marker = "ask ใช้เฉพาะเมื่อไม่มีชื่อและบริบทก็ว่างจริง ๆ · ตอบ JSON เท่านั้น"
  const idx = s.indexOf(marker)
  const end = s.indexOf("`;", idx) + 1
  const add = ` ส่วนแผน (PLAN JSON): {"plan":{"steps":[{"command":"...","payload":{}}],"conditions":["เงื่อนไขที่สกัดได้ทั้งหมด"],"uncovered":["เงื่อนไขที่ไม่มีเครื่องมือรองรับ"]},"ask":null,"command":null,"payload":null}
กติกาแผน: สกัดเงื่อนไขครบ (ชนิด-entity/ประเภทธุรกิจ/สถานที่/เวลา/วัสดุ/ความสัมพันธ์/เงื่อนไขธุรกิจ/ผลที่ต้องการ) — ห้ามทิ้ง filter เงียบ ๆ · เทียบกับ PROJECTIONS/KNOWN_GAPS: ถ้าเงื่อนไขหลักไม่มีเครื่องมือรองรับ (เช่นสภาพอากาศนอกขอนแก่น/พายุ/ระยะทาง/ราคาน้ำมันตลาด/ตารางรถ) → ใส่ uncovered แล้วตั้ง command:null พร้อม ask บอกตรง ๆ ว่าระบบยังไม่มีส่วนนั้น (ห้ามตอบผ่านโดยทิ้งเงื่อนไข) · steps สูงสุด2 เป็น dependent read ที่ระบบรองรับเท่านั้น (partner.find→partner_id / invoice.latest→document_id) · ถ้ามี plan ให้ใส่ command/payload = step แรกด้วย (compat) · ตอบ JSON เท่านั้น`
  s = s.slice(0, end - 1) + add + s.slice(end - 1)
  writeFileSync(path, s)
  console.log("planning prompt added")
} else console.log("planning prompt exists")

s = readFileSync(path, "utf8")
const oldMark = 'if (!ALLOWED_COMMANDS.has(command)) throw new Error(`CAPABILITY_UNAVAILABLE: ${command} ไม่อยู่ในชุดคำสั่งที่อนุญาต`);'
const addBlock = `${oldMark}
    // DNA-000231: เงื่อนไขหลักที่ไม่มีเครื่องมือรองรับ → ห้ามตอบ SUCCESS โดยทิ้งเงื่อนไข
    const uncovered = parsed?.plan?.uncovered;
    if (Array.isArray(uncovered) && uncovered.length > 0) {
      await db.from("ai_tasks").update({ session_cookie: null }).eq("id", task.id);
      const gapText = uncovered.slice(0, 3).join(", ");
      const delivered = await postCallback(task.id, { result: { answer: \`ยังไม่สามารถตอบส่วนนี้ได้ครับ — ระบบยังไม่มีข้อมูล/เครื่องมือสำหรับ: \${gapText}\`, result: null, ask: null, fail_reason: "CAPABILITY_UNAVAILABLE", missing: uncovered, worker: WORKER_ID, durationMs: Date.now() - t0 } });
      if (!delivered) throw new Error("callback delivery failed after 3 attempts");
      console.log(\`[cline-worker] task \${task.id} done-gap (\${Date.now() - t0}ms, missing=\${gapText})\`);
      return;
    }`
if (s.includes("done-gap")) console.log("enforcement exists")
else {
  if (!s.includes(oldMark)) throw new Error("enforcement marker missing")
  s = s.replace(oldMark, addBlock)
  writeFileSync(path, s)
  console.log("coverage enforcement added")
}
