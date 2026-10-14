-- ROLLBACK of 20261015000001_revoke_spatial_ref_sys_anon.sql — restore exactly
-- the pre-hardening grant state measured on the local PostGIS 3.6.4 test DB
-- (Supabase-style default grants + PostGIS-installed PUBLIC SELECT).
GRANT ALL ON TABLE public.spatial_ref_sys TO anon;
GRANT ALL ON TABLE public.spatial_ref_sys TO authenticated;
GRANT SELECT ON TABLE public.spatial_ref_sys TO PUBLIC;
