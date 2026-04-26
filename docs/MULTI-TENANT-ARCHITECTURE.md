# AX Sprint - SaaS Multitenant Architecture

> 이 문서는 AX Sprint를 Paperclip 기반 멀티테넌트 SaaS로 운영하기 위한 아키텍처 기준을 정의한다.
>
> 이전 초안은 고객별 Fly 앱, 고객별 Supabase 프로젝트, per-tenant OpenClaw 컨테이너를 Phase 0 기본값처럼 다뤘다. 그 전제는 5인 미만 팀이 운영할 SaaS에는 과하다. 이 문서는 그 오류를 정정하고, 단일 백엔드와 단일 데이터베이스에서 시작하는 pool model을 Phase 0 기준으로 삼는다.

## 0. 결론

Phase 0의 기본 구조는 다음과 같다.

```text
*.ax.acent.com
        |
        v
Fly.io app: acent-ax-api
  - API + UI
  - tenant resolver
  - application-level authorization
  - admin/internal routes
        |
        v
Supabase project: ax-saas
  - single Postgres database
  - shared schema
  - tenant/company-scoped rows
  - RLS backstop
  - Supabase Auth

Fly.io app: openclaw-worker
  - shared worker pool
  - tenant-scoped jobs
  - tenant-scoped browser profiles
  - tenant-scoped evidence output
```

Phase 0에서 하지 않는다.

- 고객별 Fly backend app 생성
- 고객별 Supabase project 생성
- schema-per-tenant를 기본값으로 채택
- OpenClaw를 고객별 장기 컨테이너로 고정
- Kubernetes, Vault, gVisor, cell packing 선도입
- self-serve provisioning UI 선개발
- Tailscale/tailnet을 hosted tenant routing 경로로 사용

이 구조는 일반적인 SaaS pool model에 맞춘다. 인프라는 공유하고, `tenant_id`/`company_id`, auth membership, RLS, OpenClaw profile isolation으로 고객 경계를 만든다.

## 1. 설계 원칙

1. **SaaS first**. AX Sprint는 고객별 설치형 managed instance가 아니라 중앙 집중 SaaS로 시작한다.
2. **Pool by default, silo by exception**. 기본은 단일 backend와 단일 Supabase project다. 규제, 대형 고객, 강한 망분리 요구가 실제로 생길 때만 dedicated runtime을 검토한다.
3. **Company boundary를 활용한다**. Paperclip의 기존 V1 모델은 모든 핵심 엔티티가 `company_id`로 묶인다. Phase 0에서는 이 경계를 tenant boundary의 실질적 기반으로 사용한다.
4. **RLS는 백스톱이다**. 1차 방어선은 API의 tenant/company access check이고, RLS는 누락된 쿼리나 실수를 막는 마지막 방어선이다.
5. **OpenClaw는 서버가 아니라 profile을 격리한다**. 브라우저 worker pool은 공유해도 되지만, cookies/localStorage/IndexedDB/profile/evidence/secrets는 tenant 단위로 분리한다.
6. **나중에 비싼 마이그레이션만 지금 피한다**. billing, audit, export, tenant identity처럼 나중에 고치기 비싼 경계는 Phase 0에 넣고, 운영 플랫폼성 기능은 미룬다.

## 2. Phase 0 Architecture

### 2.1 Backend

- Fly.io app 1개: `acent-ax-api`
- 기본 Fly 주소: `https://acent-ax-api.fly.dev`
- API와 UI는 같은 app에서 제공한다.
- `Host` header에서 tenant slug를 해석한다.
- 모든 요청에는 `tenantContext`가 붙는다.
- 기존 `assertCompanyAccess` 앞 또는 내부에서 tenant/company membership을 검증한다.
- ACENT 운영자 기능은 별도 제품이 아니라 같은 앱의 `/admin` 또는 internal route로 시작한다.
- Tailscale/tailnet은 로컬 개발 또는 운영자 접근 보조 수단으로만 둔다. hosted SaaS tenant routing은 public Fly hostname과 DNS mapping만 기준으로 한다.

### 2.2 Database

- Supabase project 1개
- Postgres database 1개
- shared schema 1개
- row-level tenancy는 `tenant_id` 또는 기존 `company_id` 기반으로 구현한다.
- `companies.tenant_id`를 추가해 SaaS tenant와 Paperclip company의 관계를 명시한다. 기존 local/imported company 호환을 위해 DB 컬럼은 nullable로 시작하고, hosted mode에서만 필수 정책으로 강제한다.
- Paperclip 기존 core table은 대부분 `company_id`가 있으므로, Phase 0에서는 `company_id -> tenant_id` 검증을 통해 tenant boundary를 강제한다.

중요한 기준:

- Phase 0 기본값은 **shared schema + tenant/company scoped rows**다.
- schema-per-tenant는 Phase 0 기본값이 아니다. 마이그레이션, 롤백, 테스트 비용이 빠르게 커진다.
- Supabase project-per-customer도 Phase 0 기본값이 아니다. 운영자가 고객 수만큼 auth, env, migration, backup, deploy surface를 갖게 된다.
- 업무 테이블은 `company_id` 중심으로 유지하고, audit/usage/evidence/OpenClaw job 같은 SaaS 운영 테이블에는 `tenant_id`를 직접 둔다.

### 2.3 Auth

- Supabase Auth project 1개를 사용한다.
- 사용자 identity pool은 공유한다.
- tenant 접근 권한은 membership table로 분리한다.
- Google OAuth + email domain allowlist로 시작한다.
- SAML/OIDC federation은 큰 고객이 요구할 때 추가한다.

권장 최소 테이블:

```text
tenants
  id uuid primary key
  slug text unique not null
  display_name text not null
  status text not null
  plan text null
  metadata jsonb not null default '{}'
  created_at timestamptz not null
  updated_at timestamptz not null

tenant_memberships
  tenant_id uuid not null references tenants(id)
  user_id text not null
  role text not null
  status text not null
  created_at timestamptz not null
  updated_at timestamptz not null
  primary key (tenant_id, user_id)

tenant_domains
  tenant_id uuid not null references tenants(id)
  domain text not null
  status text not null
  primary key (tenant_id, domain)

companies
  tenant_id uuid null references tenants(id) -- hosted/SaaS mode requires this
```

`companies`와 `tenants`의 관계는 Phase 0에서는 1:1로 시작한다. tenant는 SaaS 계정/계약/권한/과금 단위이고, company는 Paperclip의 운영 조직/agent/issue/approval 단위다. 한 tenant가 여러 company를 운영해야 하는 요구가 실제로 생기면 `tenant_companies` mapping으로 확장한다.

초기 provisioning은 UI가 아니라 내부 CLI로 처리한다.

```sh
paperclipai tenant:provision \
  --slug acme \
  --name "Acme Corp" \
  --domain acme.ax.acent.com \
  --owner-user-id <auth-user-id>
```

이 명령은 tenant, domain mapping, primary company, default environment, owner membership을 한 번에 맞춘다. owner가 아직 가입하지 않은 경우에는 owner 옵션 없이 먼저 tenant/company를 만들고, 가입 후 같은 명령을 다시 실행해 membership만 보강한다.

### 2.4 RLS

RLS 정책은 반드시 Phase 0에 설계한다. 단, RLS만 믿고 application guard를 약화하지 않는다.

권장 방식:

- API 요청 시작 시 tenant/company context를 확정한다.
- DB transaction 안에서 `paperclip.tenant_id`, `paperclip.user_id` 같은 transaction-local setting을 주입한다.
- RLS policy는 이 setting을 기준으로 tenant/company row access를 제한한다.
- 일반 runtime DB 연결은 RLS를 우회하는 role을 쓰지 않는다.
- service role 또는 superuser 성격의 연결은 migration, admin repair, controlled backfill 전용으로 제한한다.
- 현재 baseline은 `tenants`, `tenant_memberships`, `tenant_domains`, `companies`, `company_memberships`, `agents`, `projects`, `goals`, `issues`, `issue_comments`, `approvals`, `activity_log`, `cost_events`, `environments`, `heartbeat_runs`, `company_secrets`, `company_secret_versions`에 적용한다.
- host 기반 tenant resolver는 `paperclip_app.resolve_tenant_by_domain(host)` SECURITY DEFINER 함수를 사용한다. app role은 RLS 때문에 context 없이 `tenant_domains`를 직접 읽을 수 없으므로 resolver 함수가 필요하다.
- Express runtime은 request-scoped DB proxy를 사용하고, tenant가 resolved된 요청은 transaction-local `paperclip.tenant_id`를 설정한 뒤 route/service query를 실행한다.

주의:

- Supabase service role은 RLS를 우회할 수 있다. 일반 API runtime이 service role에 의존하면 RLS가 백스톱이 되지 않는다.
- Supabase pooler를 사용할 때는 connection reuse 때문에 session-level setting 대신 transaction-local setting을 사용해야 한다.
- table owner/superuser도 기본적으로 RLS를 우회한다. Fly runtime에는 migration/admin owner가 아니라 app 전용 DB role을 사용해야 한다.

### 2.5 OpenClaw

OpenClaw는 Phase 0에서도 별도 Fly app으로 둔다. 단, 고객별 app이나 고객별 장기 컨테이너가 아니라 shared worker pool이다.

```text
Paperclip issue/action
  -> openclaw_jobs row { tenant_id, company_id, actor_id, profile_key, action }
  -> worker leases job
  -> worker locks tenant/profile
  -> Chrome starts with tenant profile dir
  -> evidence written under tenant/company scoped path
  -> result returns to Paperclip
```

격리해야 하는 것:

- browser profile
- cookies
- localStorage
- IndexedDB
- ServiceWorker cache
- screenshots
- network logs
- downloaded files
- execution evidence
- SaaS credentials and tokens

Phase 0 구현 기준:

- OpenClaw 실행은 Paperclip API process 안에 넣지 않는다.
- worker app은 공유한다.
- job은 항상 `tenant_id`와 `company_id`를 가진다.
- browser profile은 tenant/company/profile 단위 디렉토리로 분리한다.
- 같은 profile에 대해 동시 실행 lock을 건다.
- secrets는 short-lived access token 또는 scoped secret fetch로 받는다.
- profile/evidence storage는 나중에 worker가 여러 machine으로 늘어날 수 있게 추상화한다.
- 결과는 Paperclip callback/API로 돌아오고, Paperclip이 issue comment/activity/evidence reference를 기록한다.

초기에는 worker machine 1개 + persistent volume으로 충분하다. worker를 여러 machine으로 늘리는 순간에는 profile storage 전략을 결정해야 한다.

선택지는 다음과 같다.

| 방식 | 적합한 시점 | 비고 |
|---|---|---|
| single worker + volume | Phase 0 | 가장 단순. profile 동시성 관리 쉬움 |
| tenant/profile affinity | 초기 확장 | 특정 tenant/profile을 특정 worker에 붙임 |
| encrypted object storage snapshot | worker 수평 확장 | job 전후 profile snapshot pull/push 필요 |
| dedicated worker | 규제/망분리 고객 | 예외 처리. 기본값 아님 |

### 2.6 Secrets

Phase 0에서는 기존 Paperclip secret storage를 tenant/company scope로 강화한다.

- `company_secrets`와 `company_secret_versions`를 우선 활용한다.
- 모든 secret read/write는 tenant/company membership을 검증한다.
- secret material은 app-side encryption으로 저장한다.
- master key 관리는 처음에는 환경/managed secret으로 시작해도 된다.
- KMS envelope encryption은 Phase 0 후반 또는 첫 유료 고객 직전 hardening 항목으로 둔다.
- Vault는 Phase 0에 도입하지 않는다.

### 2.7 Routing

- 고객 진입: `https://{tenant}.ax.acent.com`
- ACENT internal/admin: `https://ops.ax.acent.com` 또는 `/admin`
- wildcard TLS를 사용한다.
- path prefix tenancy는 보조 수단으로만 사용한다.

서브도메인을 쓰는 이유는 SaaS에서도 유효하다.

- 고객 인지와 브랜딩이 좋다.
- OAuth redirect와 allowlist가 명확하다.
- cookie/CSP 정책을 tenant 단위로 강화하기 쉽다.

## 3. Revised Decision Matrix

| # | 항목 | Phase 0 결정 | 나중에 확장 |
|---|---|---|---|
| 1 | tenant model | `tenants` + `tenant_memberships` + `companies.tenant_id`, core work boundary는 기존 `company_id` 활용 | multi-company tenant가 필요하면 `tenant_companies` 추가 |
| 2 | routing | wildcard subdomain + host 기반 resolver | custom domain |
| 3 | database tenancy | single Supabase project, shared schema, tenant/company-scoped rows, RLS | cell별 DB 또는 dedicated DB는 규제/대형 고객 때 |
| 4 | secrets | 기존 company secrets + tenant/company access check + app-side encryption | KMS envelope, 이후 Vault |
| 5 | OpenClaw | shared worker pool + tenant profile/evidence isolation | profile storage 확장, dedicated worker 예외 |
| 6 | auth | Supabase Auth 1개 + tenant memberships + domain allowlist | tenant-level SAML/OIDC |
| 7 | export | tenant/company export package v0 | signed export, replay, customer handoff bundle |
| 8 | billing | tenant usage rollup | billing automation |

## 4. Escalation Triggers

아래 신호가 생기기 전까지는 Phase 0 pool model을 유지한다.

| 신호 | 다음 조치 |
|---|---|
| 특정 고객이 계약상 dedicated runtime 요구 | 해당 고객만 dedicated worker 또는 dedicated cell 검토 |
| 금융/공공/의료처럼 망분리 또는 강한 컴플라이언스 요구 | 첫 고객으로 맞는지 재검토. 받는다면 예외 silo |
| RLS/application guard 검증 비용이 높아짐 | policy test suite와 query lint 강화 |
| 고객 10명 이상, OpenClaw job 대기 증가 | worker pool 수평 확장, profile affinity 도입 |
| 고객 20명 이상, noisy neighbor 발생 | cell architecture 검토 |
| DB size 또는 workload가 tenant별로 크게 갈림 | heavy tenant 전용 cell 검토 |
| SAML 요구 고객 등장 | tenant-level federation 추가 |
| 엔터프라이즈 보안 질문지에서 key isolation 요구 | KMS envelope encryption 도입 |

## 5. Phase 0 Must-Haves

Phase 0에서 반드시 넣어야 하는 것은 나중에 빠지면 데이터 마이그레이션이나 신뢰 문제가 큰 항목이다.

| Must-have | 이유 |
|---|---|
| tenant slug와 membership | SaaS account boundary의 출발점 |
| host 기반 tenant resolver | 모든 요청에 tenant context를 강제 |
| company/tenant scoped authorization | Paperclip 기존 guard를 SaaS boundary로 확장 |
| RLS policy baseline | app bug의 백스톱 |
| audit/activity log에 tenant context | 사고 조사와 고객 신뢰 |
| OpenClaw job에 tenant/company context | 외부 실행 결과의 소유권 분리 |
| browser profile lock/isolation | SaaS cookie 누출 방지 |
| tenant/company export v0 | 고객 자산화 약속의 실체 |
| usage daily rollup | billing과 운영 KPI의 기반 |

## 6. Phase 0 Non-Goals

아래는 지금 하지 않는다.

- schema-per-tenant
- customer-per-Supabase-project
- customer-per-Fly-backend
- customer-per-OpenClaw-app
- Kubernetes
- Vault
- gVisor/Firecracker
- self-serve provisioning UI
- full enterprise RBAC
- full SAML federation matrix
- automated signed replay package

## 7. Product Framing

영업 메시지는 dedicated infrastructure가 아니라 SaaS 운영 신뢰로 잡는다.

- "고객별 데이터와 실행 컨텍스트는 tenant boundary로 분리됩니다."
- "모든 작업, 승인, 실행 evidence는 고객별로 추적됩니다."
- "브라우저 자동화 세션과 profile은 고객별로 분리됩니다."
- "계약 종료 시 export package로 운영 산출물을 회수할 수 있습니다."
- "대형 고객이나 규제 고객은 dedicated cell로 확장할 수 있습니다."

주의할 표현:

- Phase 0에서는 "고객별 전용 백엔드/전용 DB"라고 말하지 않는다.
- 대신 "shared SaaS control plane with tenant isolation"으로 말한다.

## 8. Next Plan

구현 계획은 [Phase 0 SaaS Multitenancy Plan](../doc/plans/2026-04-26-saas-multitenancy-phase-0.md)을 따른다.

첫 구현의 목표는 인프라를 늘리는 것이 아니라, 단일 backend와 단일 database 안에서 tenant boundary가 항상 따라다니게 만드는 것이다.
