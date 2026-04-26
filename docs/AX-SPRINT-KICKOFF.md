# AX Sprint Kickoff (멀티테넌트 제품화)

> 이 문서는 새 Claude Code 세션을 위한 인수인계 노트입니다. 새 세션을 `~/GitHub/ax-sprint`에서 열어 이 문서를 먼저 읽고 작업을 시작하세요.

## 0. 너는 지금 어디에 있는가

- **저장소**: `acent-labs/ax-sprint` (`~/GitHub/ax-sprint`)
- **base**: Paperclip MIT 오픈소스 (`paperclipai/paperclip`)에서 fresh clone (HEAD: `40782f70`, 2026-04-25 기준)
- **remotes**:
  - `origin` → `acent-labs/ax-sprint` (우리 사업용 fork)
  - `upstream` → `paperclipai/paperclip` (원본, 주기적 sync 대상)
- **관계 저장소**:
  - `~/GitHub/acent-ops` — ACENT 내부 운영용 Paperclip fork (이번 사업용과 완전 분리)
  - upstream Paperclip은 활발히 업데이트 중. 주기적 sync 필수.

## 1. 사업 컨텍스트

ACENT의 AX(AI Transformation) 사업을 **"4주 AX Sprint"**라는 패키지 상품으로 출시한다. 이 저장소는 그 상품의 **운영 시스템 백본**이다.

### 핵심 포지셔닝

> "전문가 군단형 AX"가 아니라 **"AI 운영체계 납품형 AX"**.
> 컨설턴트가 계속 붙어 있어야 굴러가는 모델이 아니라, 고객사 안에 남는 AI 운영 시스템을 4주에 설치해주고 빠진다.

### 경쟁 인식

- **JoCoding AX Partners**: 70만 구독자 + 유명 컨설턴트 brand로 컨설팅·교육형 AX. 우리는 이 게임 안 한다.
- **Zendesk Fin / Intercom Fin / Freshdesk Freddy**: CS AI agent 제품. 정면 경쟁 X. 우리는 그 위에 올라가는 AI 거버넌스 레이어로 포지션.

### 차별점

1. **AI가 실행, 사람이 승인, 모든 결정과 산출물이 기록되는 운영체계** (governance 강조)
2. **고객 자산화**: 운영 결과(정책, 워크플로우, 처리 로그, 증거, 자동화 설정)를 export 가능한 패키지로 고객에 남김. 떠날 수 있다는 신뢰가 lock-in이 된다.
3. **MIT 오픈소스 기반 투명성**: Paperclip/OpenClaw가 OSS임을 숨기지 않고, "검증된 OSS 위에 ACENT의 운영 설계·CS Ops 템플릿·거버넌스·통합을 얹어 제공"한다고 명확히 한다.

### 상품 SKU 초안

- **AX Sprint (4주, entry SKU)**: 진단 → 설계 → 설치 → 인계 + 기본 운영 패키지
- **AX Sprint Extended (8주, 상위 SKU)**: 통합·자동화 확장
- **AX Operate (월 구독)**: 운영 SLA + upgrade + 거버넌스 리포트

## 2. 시스템 아키텍처 그림

```
고객 / 운영자
   ↓ (Slack, Teams, 카카오워크, 이메일, 또는 웹 포털)
ACENT Tenant Gateway  ← NEW (멀티테넌트 진입점, ax-sprint 신규 영역)
   ↓
Paperclip Workspace (per-tenant 격리)
   - CS Ops AI agents (Triage / Reply Drafter / QA / Approval)
   - Issues / Routines / Approvals / Evidence
   ↓
OpenClaw Execution Unit (per-tenant 격리)
   - 외부 SaaS 행동 (Freshdesk, Zendesk, Gmail, CRM, 브라우저 자동화)
   ↓
Evidence + Deliverable → Paperclip
   ↓
Customer Export Package (ZIP / Markdown / JSON)
```

**중요한 결정**: ChatGPT Business를 프론트로 쓰는 안은 **기각**됨 (좌석 과금/상태 분리/한국 망분리 이슈). 대신 고객이 이미 쓰는 협업 도구를 입구로 쓰거나, Paperclip 위에 얇은 chat UI를 얹는 방향.

## 3. 멀티테넌트 핵심 결정 사항

### 결정된 것

1. **Paperclip의 `company`를 곧바로 SaaS tenant로 쓰지 않는다**.
   - 현재 [server/src/routes/authz.ts](../server/src/routes/authz.ts)의 company-scope만으로 SaaS 격리는 부족.
   - tenant를 **상위 개념**으로 두고, 그 안에서 Paperclip company를 "AI 운영 조직"으로 사용.
2. **OpenClaw는 절대 고객사 간 브라우저 세션 공유 금지**.
   - 고객별로 분리되어야 할 것: gateway/execution namespace, 브라우저 profile/cookie, SaaS 로그인 세션, secrets, 실행 로그·screenshot, 네트워크 접근 범위.
3. **운영 모델 권장 진화 경로**:
   - **Phase 1 (지금 ~ 첫 5개 고객)**: 고객사별 전용 Paperclip 인스턴스 + 전용 OpenClaw 실행 유닛. 안전하고 빠름.
   - **Phase 2 (5~20개 고객)**: tenant cell 구조. 5~20개를 하나의 cell에 묶음. 상위 control plane 필요.
   - **Phase 3 (스케일)**: 자동 provisioning, billing, observability를 갖춘 platform.

### 미결정 — 새 세션에서 정해야 할 것

- [ ] **tenant 모델 데이터 스키마**: tenant ↔ company ↔ user ↔ agent 관계
- [ ] **tenant routing 메커니즘**: 서브도메인 / path prefix / header 중 무엇
- [ ] **secrets 격리 방식**: per-tenant vault, env scope, 또는 KMS
- [ ] **OpenClaw 격리 구현 수준**: 컨테이너/VM/profile 분리
- [ ] **Auth boundary**: tenant-level auth vs company-level auth 통합 방법
- [ ] **고객 데이터 export 패키지 스펙**: ZIP 구조, 메타데이터, 재현 가능성
- [ ] **billing/usage 측정 단위**: 처리 건수, 자동화율, 사용자 수 중 무엇

## 4. 이 저장소의 IP 정의 (이게 진짜 상품의 본질)

오픈소스 위에 ACENT가 얹어야 할 IP. **이게 productize 안 되면 "그냥 OSS 래퍼" 비판이 통한다.**

1. **CS Ops용 표준 agent 정의**
   - Intake / Triage / Knowledge / Reply Drafter / QA / Approval Agent
   - 각 agent의 역할, 프롬프트, 평가 기준
2. **승인 정책 템플릿**
   - 어떤 상황에 자동 처리, 어떤 상황에 인간 승인
   - escalation rule, SLA policy
3. **Evidence schema**
   - 무엇을, 어떤 형식으로, 어디에 남기는지 표준
   - Paperclip의 issue document/work product/deliverable/action evidence 활용
4. **고객 인계 패키지 포맷**
   - ZIP 구조, 메타데이터 표준, 재현 가능성
   - Markdown/HTML 보고서 + CSV 지표 + JSON/YAML 정책 + 첨부 evidence
5. **운영 리포팅 템플릿**
   - 주간/월간 운영 리포트, 개선 전후 지표

→ 새 세션에서 `docs/AX-SPRINT-IP.md`로 별도 문서 작성 권장.

## 5. upstream sync 워크플로우 (필수)

upstream Paperclip은 활발히 업데이트되며 외부 PR에 반응이 느림. 다음을 처음부터 잡아둔다.

- **주기**: 주 1회 (월요일 권장)
- **브랜치 prefix**:
  - `upstream-sync/YYYY-MM-DD` — upstream 머지
  - `feat/ax-*` — AX Sprint 신규 기능
  - `fix/ax-*` — AX Sprint 버그 수정
  - `chore/ax-*` — 운영 변경
- **사전 테스트**: `pnpm typecheck && pnpm test && pnpm build` + UI 스모크 + DB 마이그레이션 dry-run
- **GitHub Actions**: `.github/workflows/upstream-sync.yml`로 자동 sync PR 생성 권장
- **OpenClaw 회귀 패치 (#4042)** 를 로컬에 유지. upstream master에 아직 안 머지됨. [paperclipai/paperclip#4042](https://github.com/paperclipai/paperclip/pull/4042) 참고.

## 6. 새 세션이 첫 턴에 해야 할 것

1. 이 문서를 처음부터 끝까지 읽기
2. `~/GitHub/ax-sprint`에서 git status / 최근 커밋 / remote 확인
3. 다음 우선순위 중 하나를 사용자와 합의:
   - (A) **`docs/AX-SPRINT-IP.md` 작성** — ACENT IP 정의 (CS Ops agent, 승인 정책, evidence schema, 인계 패키지)
   - (B) **멀티테넌트 아키텍처 설계 문서** — `docs/MULTI-TENANT-ARCHITECTURE.md`. 위 4번의 미결정 항목을 결정.
   - (C) **upstream sync 워크플로우 셋업** — `.github/workflows/upstream-sync.yml` + 회귀 패치 (#4042) 적용
   - (D) **README/CLAUDE.md 교체** — 운영용 acent-ops와 다른 사업용 컨텍스트 명시

   **추천 순서**: B → A → C → D. 멀티테넌트 결정이 IP 설계 방향을 좌우하기 때문.

4. ACENT 메모리 시스템 별도 셋업: `~/.claude/projects/-Users-alan-GitHub-ax-sprint/memory/`에 사업용 메모리 누적

## 7. 절대 잊지 말 것

- **이 저장소는 ACENT 내부 운영용이 아니다.** 사업용·고객용이다. 운영 데이터 / Supabase / Google auth / alan@acent.com 도메인 한정 설정 등 acent-ops 변경분을 무심코 가져오지 말 것.
- **고객 데이터·PII 리스크가 크다.** CS Ops는 이메일·이름·계약·불만·내부 메모가 섞인다. redaction, 접근 권한, 보관 정책, 로그 노출 제한 처음부터 설계.
- **OpenClaw 자동화는 불안정하다.** SaaS UI 변경 / 로그인 / 2FA / 세션 만료 / rate limit. 운영 모드에서 낙관하지 말 것.
- **첫 3~5개 reference customer가 시스템 완성도보다 우선이다.** 시스템을 다 짜놓고 고객을 찾지 말고, 첫 고객과 함께 만든다.
- **ChatGPT Business 프론트 안은 기각됨**. 다시 제안되면 이 문서의 2장 참고.

## 8. 참고 자료

- 이전 세션 결론들이 이 문서의 base. 추가 맥락이 필요하면 acent-ops 저장소의 `docs/handover.md` 참고.
- Paperclip 제품 모델: 상위 폴더의 `PRODUCT.md`, `SPEC-implementation.md`, `DEVELOPING.md`
- 회사 단위 컨셉: `packages/db/src/schema/` 와 `server/src/routes/authz.ts`
- Command Center (산출물 검토): `ui/src/` Command Center 관련 모듈

---

**작성**: 2026-04-26 (acent-ops 세션에서 새 세션용으로 작성)
**다음 액션**: 새 Claude Code 세션을 `~/GitHub/ax-sprint`에서 열고 이 문서로 시작.
