-- Promote existing dev users to pm so they can exercise warehouse + CSPO flows.
-- Safe to re-run; only touches viewer accounts in the default org.
UPDATE public.profiles
SET role = 'pm'
WHERE role = 'viewer'
  AND org_id = '00000000-fffe-0000-0001-000000000001';
