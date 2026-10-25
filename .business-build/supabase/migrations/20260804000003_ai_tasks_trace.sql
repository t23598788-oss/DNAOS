-- Task Stage Tracer (owner, 2026-08-04): "เวลายิงคำสั่งไป...ลองดูว่าคำสั่ง
-- นั้นถูกแปลสภาพกลับขึ้นมาเป็นคำตอบไหม หรือว่าจะไปค้างอยู่ที่ระบบไหน...
-- ถ้ามันไม่มีเครื่องตรวจสอบคำสั่งต่างๆของตัวเอง มนุษย์ก็จะไม่รู้ว่าระบบไป
-- ถึงไฟล์หรือโค้ดตัวไหนแล้ว" — real gap: ai_tasks already tracks pending/
-- done/failed (2026-07-25) but a task stuck mid-flight (e.g. waiting on the
-- RunPod pod to wake up, or the remote Ollama call itself hanging) shows
-- as "pending" forever with zero visibility into which stage it's actually
-- stuck at. `trace` is a real, append-only stage log written by
-- ai-task-watcher.mjs at each real step (dequeued/pod_ensuring/pod_ready/
-- ollama_request_sent/ollama_response_received/callback_posted/etc), not
-- a guess at what "should" happen — extends the existing ai_tasks table
-- (Rule 103), not a second queue/log table.
alter table public.ai_tasks
  add column if not exists trace jsonb not null default '[]'::jsonb;

comment on column public.ai_tasks.trace is
  'Append-only array of {stage: text, at: timestamptz, detail?: text} — real stage timestamps written live by ai-task-watcher.mjs, used to see exactly where a task is stuck instead of just "still pending".';
