-- SEED: SAND BUSINESS CATALOG — 2026-11-13
-- Idempotent seed for a ready-to-run sand supply business profile.

do $$
declare
  v_business_id uuid;
  v_catalog_id uuid;
begin
  -- business profile
  select id into v_business_id
  from public.business_profiles
  where company_name = 'บ่อทรายขอนแก่น (DNA OS Seed)'
  limit 1;

  if v_business_id is null then
    insert into public.business_profiles (company_name, business_type, verified_status, channel_origin)
    values ('บ่อทรายขอนแก่น (DNA OS Seed)', 'CONSTRUCTION_MATERIALS', true, 'FACEBOOK')
    returning id into v_business_id;
  end if;

  -- catalog
  select id into v_catalog_id
  from public.catalogs
  where business_id = v_business_id and title = 'ทรายและบริการจัดส่ง'
  limit 1;

  if v_catalog_id is null then
    insert into public.catalogs (business_id, title, description)
    values (v_business_id, 'ทรายและบริการจัดส่ง', 'รายการทรายและบริการจัดส่งสำหรับลูกค้าในโซนขอนแก่น')
    returning id into v_catalog_id;
  end if;

  -- products
  insert into public.products (catalog_id, business_id, name, specs, price, status)
  select v_catalog_id, v_business_id, p.name, p.specs::jsonb, p.price, 'AVAILABLE'
  from (values
    ('ทรายหยาบ',
     '{"grade":"coarse","unit":"cubic_meter","delivery":{"lat":16.4322,"lng":102.8236,"radius_km":50,"note":"โซนขอนแก่นและจังหวัดใกล้เคียง"},"min_order_qty":1}',
     450.00),
    ('ทรายละเอียด',
     '{"grade":"fine","unit":"cubic_meter","delivery":{"lat":16.4322,"lng":102.8236,"radius_km":50,"note":"โซนขอนแก่นและจังหวัดใกล้เคียง"},"min_order_qty":1}',
     500.00),
    ('ทรายถม',
     '{"grade":"fill","unit":"cubic_meter","delivery":{"lat":16.4322,"lng":102.8236,"radius_km":50,"note":"โซนขอนแก่นและจังหวัดใกล้เคียง"},"min_order_qty":5}',
     300.00)
  ) as p(name, specs, price)
  where not exists (
    select 1 from public.products pr
    where pr.business_id = v_business_id and pr.name = p.name
  );
end $$;