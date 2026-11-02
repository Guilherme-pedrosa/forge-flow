-- Migration2300 revoked grants on all private functions. These two immutable,
-- invoker-only validators contain no table access and are used by public CHECK
-- constraints. Restore only their authenticated execution privileges.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM(VALUES
  ('erp_private.valid_number(numeric,numeric)','a036da7fbf69f95bd1225c9e09679b77'),
  ('erp_private.product_shipping_package_valid(jsonb)','4fd6eabeafd4a60b9c633f38678ebdb7')
 ) expected(signature,source_hash) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
 WHERE md5(replace(p.prosrc,chr(13),'')) IS DISTINCT FROM expected.source_hash OR p.provolatile IS DISTINCT FROM 'i' OR p.prosecdef IS DISTINCT FROM false
  OR NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
   JOIN pg_depend d ON d.classid='pg_constraint'::regclass AND d.objid=c.oid AND d.refclassid='pg_proc'::regclass AND d.refobjid=p.oid
   WHERE c.contype='c' AND n.nspname='public')) THEN
  RAISE EXCEPTION 'Review the pure CHECK validators before restoring their grants.';
 END IF;
END $$;
GRANT EXECUTE ON FUNCTION erp_private.valid_number(numeric,numeric),erp_private.product_shipping_package_valid(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
