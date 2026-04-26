CREATE TABLE IF NOT EXISTS "tenants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "display_name" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "plan" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_unique_idx"
  ON "tenants" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenants_status_idx"
  ON "tenants" USING btree ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_memberships" (
  "tenant_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "role" text DEFAULT 'member' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_memberships_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_memberships_user_status_idx"
  ON "tenant_memberships" USING btree ("user_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_memberships_tenant_status_idx"
  ON "tenant_memberships" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_domains" (
  "tenant_id" uuid NOT NULL,
  "domain" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_domains_tenant_id_domain_pk" PRIMARY KEY("tenant_id","domain")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_domains_domain_status_idx"
  ON "tenant_domains" USING btree ("domain","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_domains_domain_unique_idx"
  ON "tenant_domains" USING btree ("domain");
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_tenant_idx"
  ON "companies" USING btree ("tenant_id");
