CREATE OR REPLACE FUNCTION "paperclip_app"."resolve_tenant_by_domain"("host" text)
RETURNS TABLE("tenant_id" uuid, "slug" text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, paperclip_app
AS $$
  SELECT t.id AS tenant_id, t.slug
  FROM public.tenant_domains td
  INNER JOIN public.tenants t ON t.id = td.tenant_id
  WHERE td.domain = lower("host")
    AND td.status = 'active'
    AND t.status = 'active'
  LIMIT 1
$$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paperclip_app_user') THEN
    GRANT EXECUTE ON FUNCTION "paperclip_app"."resolve_tenant_by_domain"(text) TO paperclip_app_user;
  END IF;
END $$;
