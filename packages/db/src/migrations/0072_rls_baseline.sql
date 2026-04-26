CREATE SCHEMA IF NOT EXISTS "paperclip_app";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "paperclip_app"."current_tenant_id"()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('paperclip.tenant_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "paperclip_app"."current_user_id"()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('paperclip.user_id', true), '')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "paperclip_app"."set_request_context"(
  "tenant_id" uuid,
  "user_id" text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('paperclip.tenant_id', "tenant_id"::text, true);
  IF "user_id" IS NOT NULL THEN
    PERFORM set_config('paperclip.user_id', "user_id", true);
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "paperclip_app"."can_access_tenant"("tenant_id" uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT "tenant_id" IS NOT NULL
    AND "tenant_id" = "paperclip_app"."current_tenant_id"()
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "paperclip_app"."can_access_company"("company_id" uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, paperclip_app
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = "company_id"
      AND c.tenant_id = "paperclip_app"."current_tenant_id"()
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "paperclip_app"."can_access_secret"("secret_id" uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, paperclip_app
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_secrets s
    INNER JOIN public.companies c ON c.id = s.company_id
    WHERE s.id = "secret_id"
      AND c.tenant_id = "paperclip_app"."current_tenant_id"()
  )
$$;
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_rls" ON "tenants";
--> statement-breakpoint
CREATE POLICY "tenant_rls" ON "tenants"
  FOR ALL
  USING ("paperclip_app"."can_access_tenant"("id"))
  WITH CHECK ("paperclip_app"."can_access_tenant"("id"));
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_memberships_rls" ON "tenant_memberships";
--> statement-breakpoint
CREATE POLICY "tenant_memberships_rls" ON "tenant_memberships"
  FOR ALL
  USING ("paperclip_app"."can_access_tenant"("tenant_id"))
  WITH CHECK ("paperclip_app"."can_access_tenant"("tenant_id"));
--> statement-breakpoint
ALTER TABLE "tenant_domains" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_domains_rls" ON "tenant_domains";
--> statement-breakpoint
CREATE POLICY "tenant_domains_rls" ON "tenant_domains"
  FOR ALL
  USING ("paperclip_app"."can_access_tenant"("tenant_id"))
  WITH CHECK ("paperclip_app"."can_access_tenant"("tenant_id"));
--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "companies_tenant_rls" ON "companies";
--> statement-breakpoint
CREATE POLICY "companies_tenant_rls" ON "companies"
  FOR ALL
  USING ("tenant_id" IS NOT NULL AND "paperclip_app"."can_access_tenant"("tenant_id"))
  WITH CHECK ("tenant_id" IS NOT NULL AND "paperclip_app"."can_access_tenant"("tenant_id"));
--> statement-breakpoint
ALTER TABLE "company_memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "company_memberships_company_rls" ON "company_memberships";
--> statement-breakpoint
CREATE POLICY "company_memberships_company_rls" ON "company_memberships"
  FOR ALL
  USING ("paperclip_app"."can_access_company"("company_id"))
  WITH CHECK ("paperclip_app"."can_access_company"("company_id"));
--> statement-breakpoint
ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "agents_company_rls" ON "agents";
--> statement-breakpoint
CREATE POLICY "agents_company_rls" ON "agents"
  FOR ALL
  USING ("paperclip_app"."can_access_company"("company_id"))
  WITH CHECK ("paperclip_app"."can_access_company"("company_id"));
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "projects_company_rls" ON "projects";
--> statement-breakpoint
CREATE POLICY "projects_company_rls" ON "projects"
  FOR ALL
  USING ("paperclip_app"."can_access_company"("company_id"))
  WITH CHECK ("paperclip_app"."can_access_company"("company_id"));
--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "goals_company_rls" ON "goals";
--> statement-breakpoint
CREATE POLICY "goals_company_rls" ON "goals"
  FOR ALL
  USING ("paperclip_app"."can_access_company"("company_id"))
  WITH CHECK ("paperclip_app"."can_access_company"("company_id"));
--> statement-breakpoint
ALTER TABLE "issues" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "issues_company_rls" ON "issues";
--> statement-breakpoint
CREATE POLICY "issues_company_rls" ON "issues"
  FOR ALL
  USING ("paperclip_app"."can_access_company"("company_id"))
  WITH CHECK ("paperclip_app"."can_access_company"("company_id"));
--> statement-breakpoint
ALTER TABLE "issue_comments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "issue_comments_company_rls" ON "issue_comments";
--> statement-breakpoint
CREATE POLICY "issue_comments_company_rls" ON "issue_comments"
  FOR ALL
  USING ("paperclip_app"."can_access_company"("company_id"))
  WITH CHECK ("paperclip_app"."can_access_company"("company_id"));
--> statement-breakpoint
ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "approvals_company_rls" ON "approvals";
--> statement-breakpoint
CREATE POLICY "approvals_company_rls" ON "approvals"
  FOR ALL
  USING ("paperclip_app"."can_access_company"("company_id"))
  WITH CHECK ("paperclip_app"."can_access_company"("company_id"));
--> statement-breakpoint
ALTER TABLE "activity_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "activity_log_company_rls" ON "activity_log";
--> statement-breakpoint
CREATE POLICY "activity_log_company_rls" ON "activity_log"
  FOR ALL
  USING ("paperclip_app"."can_access_company"("company_id"))
  WITH CHECK ("paperclip_app"."can_access_company"("company_id"));
--> statement-breakpoint
ALTER TABLE "cost_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "cost_events_company_rls" ON "cost_events";
--> statement-breakpoint
CREATE POLICY "cost_events_company_rls" ON "cost_events"
  FOR ALL
  USING ("paperclip_app"."can_access_company"("company_id"))
  WITH CHECK ("paperclip_app"."can_access_company"("company_id"));
--> statement-breakpoint
ALTER TABLE "environments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "environments_company_rls" ON "environments";
--> statement-breakpoint
CREATE POLICY "environments_company_rls" ON "environments"
  FOR ALL
  USING ("paperclip_app"."can_access_company"("company_id"))
  WITH CHECK ("paperclip_app"."can_access_company"("company_id"));
--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "heartbeat_runs_company_rls" ON "heartbeat_runs";
--> statement-breakpoint
CREATE POLICY "heartbeat_runs_company_rls" ON "heartbeat_runs"
  FOR ALL
  USING ("paperclip_app"."can_access_company"("company_id"))
  WITH CHECK ("paperclip_app"."can_access_company"("company_id"));
--> statement-breakpoint
ALTER TABLE "company_secrets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "company_secrets_company_rls" ON "company_secrets";
--> statement-breakpoint
CREATE POLICY "company_secrets_company_rls" ON "company_secrets"
  FOR ALL
  USING ("paperclip_app"."can_access_company"("company_id"))
  WITH CHECK ("paperclip_app"."can_access_company"("company_id"));
--> statement-breakpoint
ALTER TABLE "company_secret_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "company_secret_versions_secret_rls" ON "company_secret_versions";
--> statement-breakpoint
CREATE POLICY "company_secret_versions_secret_rls" ON "company_secret_versions"
  FOR ALL
  USING ("paperclip_app"."can_access_secret"("secret_id"))
  WITH CHECK ("paperclip_app"."can_access_secret"("secret_id"));
