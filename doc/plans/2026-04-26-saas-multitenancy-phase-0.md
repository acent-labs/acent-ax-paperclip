# Phase 0 SaaS Multitenancy Plan

Date: 2026-04-26
Status: Draft
Related: `docs/MULTI-TENANT-ARCHITECTURE.md`

## 1. Goal

Paperclip 기반 AX Sprint를 단일 Fly backend와 단일 Supabase database에서 운영 가능한 멀티테넌트 SaaS로 준비한다.

Phase 0의 목표는 고객별 인프라를 늘리는 것이 아니다. 모든 요청, 데이터, 실행 작업, evidence에 tenant/company boundary가 빠지지 않게 만드는 것이다.

## 2. Confirmed Direction

Phase 0 기준 결정:

- Fly.io에는 Paperclip API/UI backend를 단일 SaaS app으로 올린다.
- Supabase project는 하나로 시작한다.
- Postgres schema는 tenant별로 나누지 않고 shared schema를 사용한다.
- `tenant_id`는 SaaS 계정, 계약, 권한, 과금 단위다.
- `company_id`는 Paperclip의 운영 조직, agent, issue, approval, budget 단위다.
- Phase 0에서는 tenant와 primary company를 1:1로 시작한다.
- `companies.tenant_id`를 추가해 tenant와 company 관계를 명시한다. 기존 local/imported company 호환을 위해 DB 컬럼은 nullable로 시작하고, hosted mode에서만 필수 정책으로 강제한다.
- 기존 Paperclip core tables는 대부분 `company_id`를 유지하고, 모든 접근에서 `company_id -> tenant_id` 검증을 강제한다.
- audit, usage, OpenClaw job, evidence처럼 SaaS 운영/보안/과금에 직접 쓰이는 테이블에는 `tenant_id`를 직접 둔다.
- RLS는 Phase 0부터 적용한다. application guard가 1차 방어선이고 RLS는 백스톱이다.
- OpenClaw는 Paperclip과 같은 backend process에 넣지 않고 별도 Fly worker app으로 둔다.
- OpenClaw worker app은 tenant별로 나누지 않는다. worker pool은 공유하고, job/profile/evidence/secret boundary를 tenant별로 분리한다.

이 결정은 schema-per-tenant나 customer-per-project 구조를 거부한다. 나중에 물리 격리가 필요한 고객이 생기면 schema-per-tenant보다 dedicated cell 또는 dedicated Supabase project를 예외로 검토한다.

## 3. Non-Goals

- 고객별 Fly app 생성
- 고객별 Supabase project 생성
- schema-per-tenant 마이그레이션
- Kubernetes 도입
- Vault 도입
- self-serve provisioning UI
- enterprise SAML/RBAC 전체 구현
- Tailscale/tailnet 기반 hosted 배포. Tailscale은 로컬 개발/운영자 접근 보조 수단으로만 보고, SaaS tenant routing은 public Fly host + DNS 기준으로 설계한다.

## 4. Workstream

### A. Tenant Identity

Deliverables:

- `tenants` table
- `tenant_memberships` table
- `tenant_domains` table
- `companies.tenant_id`
- Phase 0 rule: one tenant has one primary company
- seed/provision command for tenant + primary company

Acceptance criteria:

- tenant slug is unique
- a user can belong to one or more tenants
- every hosted-mode company belongs to exactly one tenant
- tenant and primary company can be created together
- disabled tenant blocks login/API access

### B. Tenant Routing

Deliverables:

- host-based tenant resolver middleware
- `req.tenantContext` or equivalent server context
- mismatch handling for host tenant vs requested company
- tests for unknown host, inactive tenant, and cross-tenant company access
- local/dev bypass rules documented for `local_trusted`

Acceptance criteria:

- `acme.ax.acent.com` resolves to tenant `acme`
- API calls cannot request another tenant's company by ID
- internal/admin routes can intentionally bypass host tenancy only with admin authorization
- local trusted mode can still run without a public tenant host

### C. Auth And Membership

Deliverables:

- Supabase Auth integration plan for single project
- tenant membership check in API actor resolution
- email domain allowlist for first tenants
- ACENT operator/admin access model

Acceptance criteria:

- user without tenant membership cannot access tenant data
- tenant admin can invite or activate users for the same tenant
- ACENT operator actions are audit logged with operator identity

### D. Database Boundary And RLS

Deliverables:

- table inventory of all company-scoped records
- table inventory of records that need direct `tenant_id`
- RLS policy baseline for company/tenant-owned tables
- transaction-local DB context helper
- policy test suite for cross-tenant read/write attempts

Acceptance criteria:

- normal runtime DB role does not bypass RLS
- every tenant-owned query runs with tenant/company context
- cross-tenant access fails at application guard and RLS
- migrations and repair scripts use separate explicit admin path

Initial schema inventory:

- Company-scoped tables already exist across the core model: agents, projects, goals, issues, issue comments, approvals, activity log, costs, secrets, routines, environments, execution workspaces, workspace runtime services, plugin company settings, feedback records, documents, assets, labels, and related issue/workspace join tables.
- Instance/user/global tables do not currently carry company scope: auth users/sessions/accounts/verifications, board API keys, instance settings, instance user roles, user sidebar preferences, plugin registry/config/database/job/log/state tables, and plugin webhooks/entities.
- Phase 0 should not add `tenant_id` to every company-scoped table. Keep core work rows company-scoped and use `companies.tenant_id` for tenant resolution. Add direct `tenant_id` only to SaaS operating tables such as usage rollups, OpenClaw jobs, evidence metadata, and tenant audit surfaces.

### E. OpenClaw Worker Pool

Deliverables:

- `openclaw_jobs` or equivalent queue contract with `tenant_id`, `company_id`, `actor_id`
- tenant/company/profile key naming convention
- profile lock mechanism
- evidence output path convention
- single-worker Phase 0 deployment shape
- Paperclip -> OpenClaw job enqueue API
- OpenClaw -> Paperclip result callback API

Acceptance criteria:

- one worker app can execute jobs for multiple tenants
- jobs cannot start without tenant/company context
- two jobs cannot mutate the same browser profile concurrently
- evidence is written under tenant/company-scoped paths
- failed jobs do not leak profile or secret material into logs

OpenClaw Phase 0 flow:

```text
Paperclip approval/action
  -> create OpenClaw job
  -> worker leases job
  -> worker verifies tenant/company context
  -> worker locks profile_key
  -> worker starts browser with tenant/company profile
  -> worker executes browser/SaaS action
  -> worker writes evidence under tenant/company path
  -> worker posts result back to Paperclip
  -> Paperclip records issue comment/activity/evidence reference
```

Initial deployment:

- Fly app: `acent-ax-api` (`https://acent-ax-api.fly.dev`)
- Fly app: `openclaw-worker`
- Supabase project: one shared SaaS project
- OpenClaw profile storage: start with one worker machine and persistent volume
- Evidence storage: tenant/company-scoped path, with storage abstraction so it can move to object storage later

Do not put OpenClaw execution into the Paperclip API process. Chrome/browser automation has different memory, crash, and security behavior from the control plane.

### F. Secrets

Deliverables:

- tenant/company access checks around existing `company_secrets`
- secret read audit events
- OpenClaw short-lived secret fetch contract
- KMS hardening backlog item

Acceptance criteria:

- a tenant cannot list or read another tenant's secrets
- OpenClaw receives only scoped, time-limited access
- plaintext secrets are not persisted in job payloads or evidence

### G. Audit, Evidence, Export

Deliverables:

- tenant context in activity/audit logs
- tenant/company-scoped evidence IDs
- export package v0 spec
- manual export command

Acceptance criteria:

- a customer can receive a ZIP/manifest export for its own tenant/company
- export excludes other tenants by construction
- audit log can reconstruct who did what, for which tenant, and through which actor

### H. Usage And Billing Foundation

Deliverables:

- `tenant_usage_daily` or equivalent rollup table
- metrics: issues closed, OpenClaw actions, approvals, automation rate
- daily rollup job

Acceptance criteria:

- usage can be reported by tenant and date
- billing does not require scanning raw event history every time
- internal admin can inspect usage without customer data leakage

## 5. Implementation Order

1. Tenant identity tables and seed/provision command
2. Host resolver and tenant context propagation
3. Company access hardening with tenant checks
4. RLS baseline and policy tests
5. Auth membership flow
6. OpenClaw job/profile/evidence isolation contract
7. Secret access hardening
8. Export package v0
9. Usage rollup

## 6. Current Implementation Status

Implemented foundation:

- Tenant identity tables: `tenants`, `tenant_memberships`, `tenant_domains`
- Nullable `companies.tenant_id` for local/import compatibility
- Hosted tenant resolver enabled for `authenticated + public` deployments
- Tenant/company access checks in board and agent authorization paths
- Tenant-scoped company list and company stats behavior
- Internal CLI command: `paperclipai tenant:provision`
- RLS helper schema and policy baseline using `paperclip.tenant_id`
- RLS regression test for non-owner runtime role isolation across tenant/company rows
- Supabase app runtime role: `paperclip_app_user`
- RLS-safe tenant resolver function: `paperclip_app.resolve_tenant_by_domain(host)`
- Request-scoped DB proxy and transaction-local tenant context middleware for hosted runtime

Provisioning command shape:

```sh
paperclipai tenant:provision \
  --slug acme \
  --name "Acme Corp" \
  --domain acme.ax.acent.com \
  --owner-user-id <auth-user-id>
```

The command creates or reuses the tenant, activates the domain mapping, creates or attaches the primary company, ensures the default local environment, and optionally grants owner membership at both tenant and company levels.

RLS baseline scope:

- Direct tenant tables: `tenants`, `tenant_memberships`, `tenant_domains`
- Company boundary tables: `companies`, `company_memberships`, `agents`, `projects`, `goals`, `issues`, `issue_comments`, `approvals`, `activity_log`, `cost_events`, `environments`, `heartbeat_runs`
- Secret boundary tables: `company_secrets`, `company_secret_versions`

Runtime caveat:

- RLS is effective only for a non-owner app DB role. Migration/admin connections and Supabase service-role style connections can bypass it. Fly runtime should use a dedicated app role and set transaction-local `paperclip.tenant_id` before tenant-owned queries.
- Supabase Shared Pooler app runtime URL should use `paperclip_app_user.<project-ref>` as the user. Migration/admin work should continue to use the owner/admin URL separately.

## 7. First PR Scope

The first implementation PR should stay narrow.

Recommended first PR:

- add tenant identity schema
- add `companies.tenant_id`
- add resolver middleware
- add tenant/company access guard tests
- document Supabase RLS strategy

Do not include OpenClaw worker changes in the same PR. OpenClaw has different failure modes and should be a separate integration PR after the API tenant boundary is stable.

## 8. Second PR Scope

Recommended second PR:

- add RLS context helper
- add initial RLS policies for high-risk company-owned tables
- add cross-tenant RLS regression tests
- ensure normal hosted runtime connection does not rely on Supabase service role

This PR should prove the boundary with tests before broadening coverage to every table.

## 8. Third PR Scope

Recommended third PR:

- add OpenClaw job contract
- add job enqueue path from Paperclip
- add worker lease/result callback contract
- add profile key and lock model
- add evidence path convention

This PR can stub actual browser execution at first. The important contract is tenant/company context propagation and profile/evidence isolation.

## 9. Remaining Open Questions

1. Which auth library path will own Supabase Auth session verification in the Paperclip API?
2. Which tables currently lack `company_id` but hold tenant-owned data?
3. Which OpenClaw profile storage abstraction should be introduced before the first customer?
4. What is the minimum customer export package that is useful in a sales demo?
5. Which model execution path ships first for hosted mode: provider API only, BYOK, or ACENT-managed plus BYOK later?
