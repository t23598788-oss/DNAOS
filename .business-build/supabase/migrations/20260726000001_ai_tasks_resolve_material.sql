-- Owner instruction (2026-07-26): "แม่ปลายทางจะพิมพ์มาในลักษณะหรือคำรูปแบบ
-- ไหน แต่ต้นทางต้องเข้าใจ...ถ้าเกิดว่าปัญหาแค่นี้ยังแก้ไม่ได้ เราต้องไปหาคำ
-- สรรหาคำต่างๆมาแปลภาษา...ไม่ไหวแน่นอน" — hand-patching string normalization
-- rules per material/phrasing forever doesn't scale. Adds a real fallback:
-- when deterministic substring matching (event-followup.ts) can't resolve a
-- material name, the local Ollama model (already running for other tasks)
-- picks the closest real match from the ACTUAL material_types list — closed-
-- set classification against real data, not open generation, so it can't
-- invent a material that doesn't exist. See ai-task-watcher.mjs's
-- resolveMaterialSemantic() and engines/resolve-material-followup.ts.
alter table public.ai_tasks drop constraint if exists ai_tasks_kind_check;
alter table public.ai_tasks add constraint ai_tasks_kind_check
  check (kind in ('handle_text', 'classify_image', 'resolve_material'));

alter table public.ai_tasks add column if not exists business_event_id uuid;
