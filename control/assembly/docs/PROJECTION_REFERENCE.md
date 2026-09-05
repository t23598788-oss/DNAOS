# หน้าจอและแหล่งข้อมูล

> สร้างอัตโนมัติจาก control/assembly/data — ห้ามแก้ด้วยมือ

| projection | หน้าจอ | แหล่งข้อมูล | capability | สิทธิ์ | การรีเฟรช |
| --- | --- | --- | --- | --- | --- |
| prj.line.chat | LINE chat | business_events | chat.reply.send | ผู้ใช้ในห้องแชทนั้น | EVENT |
| prj.admin.inbox | deadboard /admin (กล่องข้อความ) | line_events | line.message.ingest | ADMIN_TIER | REQUEST |
| prj.admin.documents | deadboard /admin/documents | invoices, standalone_documents | document.issue | ADMIN_TIER | REQUEST |
| prj.admin.receipts | deadboard /admin/receipt-documents | receipt_documents | payment.claim.record | ADMIN_TIER | REQUEST |
| prj.admin.debt | deadboard /admin/debt-trackings | debt_snapshots, debt_events | payment.match | ADMIN_TIER | REQUEST |
| prj.admin.equipment | deadboard /admin/equipment | equipment_assets, maintenance_tickets | equipment.control | ADMIN_TIER | REQUEST |
| prj.admin.sites | deadboard /admin (หน้างาน) | customer_sites | site.location.capture | ADMIN_TIER | REQUEST |
| prj.admin.orders | deadboard /admin (คำสั่งซื้อ) | customer_orders | - | ADMIN_TIER | REQUEST |
