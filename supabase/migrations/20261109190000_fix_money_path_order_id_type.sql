-- ============================================================================
-- แก้ order_id บนเส้นทางเงิน: cancellation_evidence + payout_audit_log
--
-- ปัญหา: ทั้งสองตารางประกาศ order_id เป็น text แต่ customer_orders.id เป็น uuid
--        แล้วยังพยายาม FK text -> uuid ซึ่ง Postgres ปฏิเสธตั้งแต่ตอนสร้างตาราง
--        (ERROR: foreign key constraint ... cannot be implemented,
--         Key columns "order_id" ... and "id" ... are of incompatible types: text and uuid)
--
-- ทำไมสำคัญ: สองตารางนี้คือหลักฐานการคืนเงิน (cancellation_evidence) และร่องรอย
--        การอนุมัติ/จ่ายเงิน (payout_audit_log) ถ้าไม่มี FK จริง แถวหนึ่งแถว
--        สามารถชี้ไปยังออเดอร์ที่ไม่มีอยู่ได้ และไม่มีอะไรรับประกันว่าเงินที่คืน
--        หรือจ่ายออกไปผูกกับออเดอร์จริง — เป็นบั๊กบนเส้นทางเงิน ไม่ใช่เรื่องหน้าตา
--
-- ที่มาของงาน: fresh-DB migration replay ล้ม 26 ไฟล์ และในนั้นมี 2 ไฟล์ที่ล้ม
--        ด้วยเหตุผลนี้เป๊ะ (text vs uuid) ไฟล์นี้คือการแก้ 2 ใน 26 นั้น
--        (อีก 24 ไฟล์เป็นคนละสาเหตุ — อยู่ในรายงาน)
--
-- Idempotent: ถ้า order_id เป็น uuid อยู่แล้วจะข้าม, ถ้ามี FK ชื่อนี้อยู่แล้วจะข้าม,
--        ไม่ลบข้อมูล ไม่ backfill ไม่แตะ writer
--        index เดิมบน order_id ถูก rebuild โดย ALTER TYPE เอง จึงไม่ drop/create
--        ถ้าตารางยังไม่มี (replay ที่ล้มก่อนถึงไฟล์นี้) จะข้ามอย่างปลอดภัย
-- ============================================================================

do $$
declare
  t         text;
  col_type  text;
  fk_name   text;
  converted int := 0;
  fk_added  int := 0;
  skipped   int := 0;
begin
  foreach t in array array['cancellation_evidence', 'payout_audit_log'] loop
    -- ตารางอาจไม่มีอยู่จริง — ข้าม ไม่ให้ migration ล้มทั้งไฟล์
    if to_regclass('public.' || t) is null then
      raise notice '%: skip — table not found', t;
      skipped := skipped + 1;
      continue;
    end if;

    select c.data_type into col_type
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name  = t
      and c.column_name = 'order_id';

    if col_type is null then
      raise notice '%: skip — no order_id column', t;
      skipped := skipped + 1;
      continue;
    end if;

    -- 1) แปลงชนิดข้อมูลโดยไม่ทำข้อมูลหาย (ค่าว่าง/ช่องว่าง -> null)
    if col_type <> 'uuid' then
      execute format(
        'alter table public.%I alter column order_id type uuid using nullif(btrim(order_id), %L)::uuid',
        t, ''
      );
      raise notice '%: converted order_id % -> uuid', t, col_type;
      converted := converted + 1;
    end if;

    -- 2) FK ไป customer_orders(id) — เพิ่มเฉพาะเมื่อยังไม่มีชื่อนี้
    fk_name := 'fk_' || t || '_order';
    if not exists (
      select 1
      from pg_constraint
      where conrelid = ('public.' || t)::regclass
        and conname  = fk_name
        and contype  = 'f'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (order_id) references public.customer_orders (id) on delete cascade',
        t, fk_name
      );
      raise notice '%: added FK %', t, fk_name;
      fk_added := fk_added + 1;
    end if;
  end loop;

  raise notice 'done: converted=% fk_added=% skipped=%', converted, fk_added, skipped;
end
$$;
