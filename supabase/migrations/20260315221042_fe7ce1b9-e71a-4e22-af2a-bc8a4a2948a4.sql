-- Allow users to view profiles in the same tenant
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view tenant profiles"
  ON public.profiles FOR SELECT TO public
  USING (tenant_id = get_user_tenant_id());

-- Allow users to view roles in the same tenant
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view tenant roles"
  ON public.user_roles FOR SELECT TO public
  USING (tenant_id = get_user_tenant_id());