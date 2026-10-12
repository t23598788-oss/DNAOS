# แผนที่โค้ดสำหรับตรวจของเดิม

ทุก path ด้านล่าง relative ต่อ root ของ DNA OS ไม่ใช่ต่อไฟล์ ZIP

| ส่วน | จุดตรวจ |
| --- | --- |
| ทางเข้าจริง / auth / loader | app/workspace/page.tsx |
| ตัวประกอบหน้าจอ | app/workspace/BusinessWorkspace.tsx |
| กล่อง Settings | app/workspace/WorkspaceSettings.tsx |
| ค่าจัดวาง | app/workspace/_lib/workspaceAppearance.ts |
| ทางเรียกเครื่องมือ | app/workspace/_lib/toolBindings.ts |
| ไอคอน/ชื่อเครื่องมือ | app/workspace/_lib/businessTools.ts |
| คู่ค้า | app/workspace/_lib/partnerDisplayModel.ts |
| งาน | app/workspace/_lib/jobDisplayModel.ts |
| ข้อมูล contract ของ Connect | app/workspace/_lib/connectDisplayModel.ts |
| สิทธิ์กลาง | core/navigation/resolveCapabilityAccess.ts, registry/permissions.json |
| รูปแบบผลลัพธ์และ renderer | app/admin/ui-gallery/_lib/businessDisplayModel.ts, BusinessDisplayRenderer.tsx |
| ชิ้นส่วนแสดงผล | presentation/ |
| คู่มือประกอบเดิม | app/workspace/README.md |
| ทดสอบ | scripts/workspace-tool-bindings-test.tsx, scripts/workspace-capability-access-test.ts, scripts/workspace-job-path-test.ts |

หน้าอ้างอิงออนไลน์: https://dna-workspace-frame.t23598788.chatgpt.site

HTML ในแพ็กตรงกับ Sites source commit `8de014989e9d964597c1caba248a39ea513e012c`
(ฉบับเอาปุ่มแชทออก) ไม่ใช่ภาพ screenshot และไม่ใช่ production React component

DNA OS HEAD ขณะเตรียมแพ็ก: `aff5fd3a2f9aa03d35d8393d1c4c27c8a4b4e319`
มีการแก้ไขที่ยังไม่ commit และงานอื่นดำเนินอยู่ จึงไม่แนบสำเนา backend ที่อาจล้าสมัย
ให้ตรวจ checkout จริงและห้าม reset กลับ commit นี้
