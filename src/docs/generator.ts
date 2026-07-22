import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const TOOLS = [
  {
    category: 'Wiki (RAG)',
    items: [
      {
        name: 'ingest_pipeline',
        desc: 'End-to-end ingest: raw → wiki pages → lint',
        params: 'title?, content?, file_path?, concepts?, raw_id?, skip_raw?, lint_mode?',
        example: '"README.md를 위키에 ingest 해줘"',
      },
      {
        name: 'query_wiki',
        desc: 'Semantic search → full page content + citations',
        params: 'query, top_k?',
        example: '"위키에서 결제 시스템 검색해줘"',
      },
      {
        name: 'ingest_raw',
        desc: 'Store immutable original in vault/raw/',
        params: 'title, content?, file_path?, source_uri?',
        example: '"이 문서를 raw로 저장해줘"',
      },
      {
        name: 'ingest_source',
        desc: 'Create/update one wiki concept page',
        params: 'title, content, tags?, subdir?',
        example: '"결제모듈 페이지 생성해줘"',
      },
      {
        name: 'update_wiki_page',
        desc: 'Update existing wiki page (cross-links, fixes)',
        params: 'title, content, tags?, subdir?',
        example: '"위키 페이지 내용 업데이트해줘"',
      },
      {
        name: 'file_back',
        desc: 'Save durable query synthesis back to wiki',
        params: 'title, content, tags?, citations?, subdir?',
        example: '"이 내용 file_back 해줘"',
      },
      {
        name: 'lint_wiki',
        desc: 'Wiki health check (orphans, index coverage, links)',
        params: 'deep?, stale_days?',
        example: '"위키 lint 돌려줘"',
      },
      {
        name: 'get_wiki_schema',
        desc: 'Read vault wiki schema (AGENTS.md)',
        params: '',
        example: '"스키마 읽어줘"',
      },
    ],
  },
  {
    category: 'Wiki MR (change proposals)',
    items: [
      {
        name: 'propose_wiki_change',
        desc: 'Create a wiki MR proposal (diff stored)',
        params: 'title, content, rationale?, subdir?',
        example: '"이 변경사항 MR로 제안해줘"',
      },
      {
        name: 'list_wiki_proposals',
        desc: 'List wiki change proposals',
        params: 'status? (pending|applied|rejected)',
        example: '"MR 목록 봐줘"',
      },
      {
        name: 'apply_wiki_proposal',
        desc: 'Apply a pending wiki proposal',
        params: 'id, resolver?',
        example: '"MR 적용해줘"',
      },
      {
        name: 'reject_wiki_proposal',
        desc: 'Reject a pending wiki proposal',
        params: 'id, reason?',
        example: '"MR 반려해줘"',
      },
      {
        name: 'wiki_diff',
        desc: 'Preview diff lines for proposed change',
        params: 'title, content, subdir?',
        example: '"차이점 미리보기"',
      },
    ],
  },
  {
    category: 'Session Management',
    items: [
      {
        name: 'spawn_session',
        desc: 'Create independent AI session for task',
        params: 'task, sessionId?, timeout_ms?',
        example: '"이 기능 분석하는 세션 띄워줘"',
      },
      {
        name: 'check_inbox',
        desc: 'Check child session completion reports',
        params: '',
        example: '"인박스 확인"',
      },
      {
        name: 'report_result',
        desc: 'Report current session result to parent',
        params: 'summary, status, payload?',
        example: '"결과 보고할게"',
      },
      {
        name: 'send_message',
        desc: 'Send message to running session',
        params: 'sessionId, message',
        example: '"세션에 메시지 보내줘"',
      },
      {
        name: 'get_session',
        desc: 'Get session status / output',
        params: 'sessionId',
        example: '"세션 상태 확인"',
      },
      {
        name: 'close_session',
        desc: 'Clean up completed session',
        params: 'sessionId',
        example: '"세션 종료해줘"',
      },
      { name: 'list_sessions', desc: 'List all sessions', params: '', example: '"세션 목록"' },
      {
        name: 'synthesize_results',
        desc: 'Synthesize results from multiple child sessions',
        params: 'sessionIds, goal?',
        example: '"결과 종합해줘"',
      },
    ],
  },
  {
    category: 'DAG (parallel task execution)',
    items: [
      {
        name: 'plan_task',
        desc: 'Deep planning → task decomposition',
        params: 'goal',
        example: '"이 기능 계획 세워줘"',
      },
      {
        name: 'execute_dag',
        desc: 'Create DAG → topological sort → layer-parallel execution',
        params: 'goal, tasks?, resume?',
        example: '"태스크 병렬 실행해줘"',
      },
    ],
  },
  {
    category: 'Branch Hunt (parallel debugging)',
    items: [
      {
        name: 'scan_issues',
        desc: 'DFS-based issue scan + branching',
        params: 'paths?, sessionId?',
        example: '"버그 스캔해줘"',
      },
      {
        name: 'collect_results',
        desc: 'Collect branched session results',
        params: 'sessionIds',
        example: '"결과 수집해줘"',
      },
      {
        name: 'get_branch_status',
        desc: 'Branch Hunt status summary',
        params: 'sessionId',
        example: '"상태 요약"',
      },
    ],
  },
  {
    category: 'Harness (project setup)',
    items: [
      {
        name: 'bootstrap_harness',
        desc: 'Generate AGENTS.md, rules, hooks, MCP config from wiki',
        params: 'targets?, force?, profile?',
        example: '"하네스 구성해줘"',
      },
      {
        name: 'domain_context',
        desc: 'Project-aware context packing',
        params: 'task, format? (path|full)',
        example: '"컨텍스트 줘"',
      },
      {
        name: 'seed_stack_playbooks',
        desc: 'Seed stack playbooks under wiki/stacks/',
        params: '',
        example: '"스택 시드"',
      },
      {
        name: 'design_architecture',
        desc: 'Wiki + stack architecture → docs/architecture.md',
        params: '',
        example: '"아키텍쳐 설계"',
      },
      {
        name: 'brainstorm_design',
        desc: 'Multi-turn design brainstorm with wiki context',
        params: 'topic, answers?, skip_questions?',
        example: '"브레인스토밍"',
      },
      {
        name: 'generate_usage_guide',
        desc: 'Generate MCP tool usage guide in docs/mcp-guide/',
        params: '',
        example: '"사용 가이드 생성해줘"',
      },
    ],
  },
  {
    category: 'Operations & Approval',
    items: [
      {
        name: 'request_approval',
        desc: 'Request human approval for risky operation',
        params: 'title, description, context?',
        example: '"승인 요청"',
      },
      {
        name: 'resolve_approval',
        desc: 'Resolve a pending approval',
        params: 'id, approved, comment?',
        example: '"승인"',
      },
      {
        name: 'list_approvals',
        desc: 'List pending approvals',
        params: '',
        example: '"승인 목록"',
      },
      { name: 'run_doctor', desc: 'Run system diagnostics', params: '', example: '"진단 실행"' },
      { name: 'get_events', desc: 'Get event log', params: 'limit?', example: '"이벤트 로그"' },
    ],
  },
  {
    category: 'Vault & Knowledge (legacy)',
    items: [
      { name: 'list_vaults', desc: 'List registered vaults', params: '', example: '"볼트 목록"' },
      {
        name: 'register_vault',
        desc: 'Register a vault',
        params: 'name, path',
        example: '"볼트 등록"',
      },
      {
        name: 'scan_raw_inbox',
        desc: 'Process files in vault/raw-inbox/',
        params: '',
        example: '"인박스 스캔"',
      },
      {
        name: 'recall_knowledge',
        desc: 'Deprecated — use query_wiki',
        params: 'query, topK?',
        example: '',
      },
      {
        name: 'store_knowledge',
        desc: 'Deprecated — use ingest_pipeline / file_back',
        params: 'title, content, tags?',
        example: '',
      },
    ],
  },
]

const WORKFLOWS = [
  {
    title: 'New project onboarding',
    steps: [
      'aio init → MCP 연결 → "이 프로젝트 구조를 위키에 저장해줘" → "도메인 분석해서 하네스 구성해줘"',
    ],
  },
  {
    title: 'Feature implementation',
    steps: [
      '"컨텍스트 줘" (domain_context) → "계획 세워줘" (plan_task) → "병렬 실행해줘" (execute_dag) → "결과 file_back 해줘" → "위키 lint"',
    ],
  },
  {
    title: 'Parallel research',
    steps: [
      '"세션 3개 띄워서 각각 분석해줘" → "인박스 확인" (check_inbox) → "결과 종합해줘" (synthesize_results)',
    ],
  },
  {
    title: 'Bug hunting',
    steps: ['"이슈 스캔해줘" (scan_issues) → "결과 수집해줘" (collect_results)'],
  },
  {
    title: 'Document ingest',
    steps: ['"이 README ingest 해줘" (ingest_pipeline) → "위키에서 검색해줘" (query_wiki)'],
  },
]

const PHASES = [
  {
    title: '1단계: 프로젝트 초기화',
    body: `aio-mcp를 프로젝트에 연결하는 첫 단계입니다.

\`\`\`bash
# 프로젝트 루트에서 실행
npx -y @mindol1004/aio-mcp init          # 3계층 vault + wiki 구조 생성
npx -y @mindol1004/aio-mcp doctor         # 상태 진단
npx -y @mindol1004/aio-mcp mcp-serve      # MCP 서버 실행 (Cursor/Claude Code 연동)
\`\`\`

**목표:** MCP가 프로젝트에 연결되고, AI가 wiki에 접근할 수 있는 상태가 됩니다.
**결과물:** \`vault/\` 디렉토리 (raw/, wiki/, .index/), \`vault/AGENTS.md\` (스키마)`,
  },
  {
    title: '2단계: 지식 축적 (Knowledge Ingest)',
    body: `프로젝트의 문서, 코드, 아키텍처 정보를 wiki에 저장합니다. AI가 검색할 수 있는 **프로젝트 영구 기억**을 만듭니다.

| 패턴 | 사용법 | 효과 |
|---|---|---|
| 파일 ingest | "README.md ingest 해줘" | 단일 파일 → wiki 페이지 |
| 폴더 ingest | "src/ 디렉토리 구조 ingest 해줘" | 디렉토리 전체 탐색 |
| 개념 정의 | "결제 시스템 wiki 페이지 생성해줘" | 수동 지식 입력 |
| URL ingest | (파일 다운로드 후 ingest) | 외부 문서 흡수 |
| raw-inbox | 파일을 \`vault/raw-inbox/\`에 넣고 "인박스 스캔" | 배치 ingest |

**목표:** 프로젝트의 주요 개념, 용어, 아키텍처가 wiki에 모두 정리됨.
**확인:** "위키 lint 돌려줘" (lint_wiki) → 정합성 검증`,
  },
  {
    title: '3단계: 설계 & 계획',
    body: `축적된 지식을 바탕으로 AI와 협력하여 설계하고 태스크를 계획합니다.

\`\`\`
# 컨텍스트 파악
"컨텍스트 줘" → domain_context: 현재 프로젝트 상태 요약

# 기술 스택 분석
"스택 시드" → seed_stack_playbooks: 37개 스택별 모범 사례 생성

# 아키텍처 설계
"결제 시스템 아키텍처 설계해줘" → design_architecture: wiki + 스택 → docs/architecture.md

# 브레인스토밍
"주문 시스템 개선 방안 브레인스토밍" → brainstorm_design: 다중 턴 설계 토론

# 태스크 분해
"결제 리팩토링 계획 세워줘" → plan_task: 세부 태스크 + DAG 구조 생성
\`\`\`

**목표:** 실행할 태스크 목록과 의존성 그래프(DAG)가 준비됨.`,
  },
  {
    title: '4단계: 병렬 실행',
    body: `독립적인 AI 세션을 여러 개 띄워 동시에 작업합니다. 각 세션은 서로 영향을 받지 않고 독립적으로 실행됩니다.

**Session — 독립 작업자**
\`\`\`
"세션 3개 띄워서 각 모듈 분석해줘" → spawn_session × 3
"인박스 확인" → check_inbox: 완료된 작업 확인
"결과 종합해줘" → synthesize_results: 여러 세션 결과 통합
\`\`\`

**DAG — 의존성 기반 병렬 실행**
\`\`\`
"정의된 태스크로 DAG 실행해줘" → execute_dag: 자동 위상정렬 + 레이어별 병렬 실행
\`\`\`

**Branch Hunt — 버그 병렬 수정**
\`\`\`
"이슈 스캔 후 병렬로 수정해줘" → scan_issues → collect_results
\`\`\`

**목표:** 여러 작업이 동시에 진행되어 생산성 극대화.
**팁:** \`aio approval list\` / \`resolve\` 로 위험한 작업은 사람 승인 후 진행.`,
  },
  {
    title: '5단계: 검토 & 환류',
    body: `실행 결과를 wiki에 기록하고, lint로 정합성을 확인한 후 다음 작업으로 넘어갑니다.

\`\`\`
# 결과를 wiki에 저장
"이 결과를 wiki에 file_back 해줘" → file_back: 세션 결과 → 영구 저장

# Wiki 정합성 검증
"위키 lint" → lint_wiki: 미링크 페이지, 오래된 문서, 인덱스 커버리지

# 품질 관리
"변경 제안" → propose_wiki_change: MR 방식 변경 관리
"wiki diff" → wiki_diff: 변경 내용 미리보기
\`\`\`

**목표:** 작업 결과가 wiki에 축적되어 다음 반복에 활용됨.`,
  },
  {
    title: '6단계: 인계 & 문서화',
    body: `프로젝트 지식을 다음 개발자/AI가 활용할 수 있도록 포장합니다.

\`\`\`
# Harness: wiki → 프로젝트 규칙
"하네스 구성해줘" → bootstrap_harness: AGENTS.md, 룰, 훅, MCP 설정 자동 생성

# 도구 사용 가이드
"사용 가이드 생성해줘" → generate_usage_guide: docs/mcp-guide/README

# 진단
aio doctor --fail: 전체 상태 점검
\`\`\`

**목표:** 새로 합류한 개발자나 AI가 프로젝트 컨텍스트를 즉시 파악 가능.`,
  },
]

const PROCESS_DIAGRAM = `
\`\`\`
① 초기화 ──→ ② 지식 축적 ──→ ③ 설계/계획 ──→ ④ 병렬 실행 ──→ ⑤ 검토/환류 ──→ ⑥ 인계
   init         ingest           plan             execute          review           harness
   doctor       lint_wiki        brainstorm        spawn_session    file_back        bootstrap
   mcp-serve    query_wiki       design_arch       execute_dag      lint_wiki        usage_guide
                                 plan_task         scan_issues      wiki_mr
                                     ↑                                 │
                                     └────────── 반복(iterate) ────────┘
\`\`\`
`

const KO_INTRO = `# AIO MCP 도구 사용 가이드

## aio-mcp란?

aio-mcp는 **AI 어시스턴트(Cursor, Claude Code, OpenCode 등)를 위한 프로젝트 지식 + 오케스트레이션 도구**입니다.

### 핵심 개념

| 개념 | 설명 | 비유 |
|---|---|---|
| **Wiki (RAG)** | 3계층 영구 지식 저장소 (raw → wiki → schema). 벡터 검색으로 관련 정보 즉시 조회 | 프로젝트의 두뇌 |
| **Session** | 독립적인 AI 작업자. 각각 별도 컨텍스트로 병렬 작업 | 병렬 부하 직원 |
| **DAG** | 태스크 의존성 그래프 → 위상정렬 → 레이어별 병렬 실행 | 공정 관리도 |
| **Branch Hunt** | 코드 이슈를 DFS로 탐색 → 세션으로 분기 → 결과 수집 | 버그 사냥 |
| **Harness** | Wiki 지식 → AGENTS.md / 룰 / 훅 / MCP 설정 | 프로젝트 인수인계 |

### 프로젝트 활용 프로세스 (6단계)

${PROCESS_DIAGRAM}

### 시작하기

\`\`\`bash
npx -y @mindol1004/aio-mcp init          # 프로젝트 초기화
npx -y @mindol1004/aio-mcp mcp-serve      # MCP 서버 실행
\`\`\`

### 자연어로 사용하기

AI 어시스턴트에 MCP 연결 후 **도구 이름을 몰라도 자연어로 명령**하면 됩니다.

| 한국어 예시 | 영어 예시 | 실행되는 도구 |
|---|---|---|
| "위키 검색해줘" | "search the wiki" | \`query_wiki\` |
| "이 문서 ingest 해줘" | "ingest this file" | \`ingest_pipeline\` |
| "세션 띄워줘" | "spawn a session" | \`spawn_session\` |
| "계획 세워줘" | "plan the task" | \`plan_task\` |
| "하네스 구성해줘" | "bootstrap harness" | \`bootstrap_harness\` |
| "위키 lint" | "lint the wiki" | \`lint_wiki\` |
| "디버깅 스캔" | "scan for issues" | \`scan_issues\` |
| "인박스 확인" | "check inbox" | \`check_inbox\` |
`

const KO_PHASES = `## 상세 프로세스 가이드

${PHASES.map((p) => `### ${p.title}\n\n${p.body}`).join('\n\n')}

## 팁 & 베스트 프랙티스

- **작게 시작하세요.** \`init\` → 1개 파일 ingest → wiki 검색만으로도 생산성이 크게 향상됩니다.
- **lint를 자주 돌리세요.** wiki가 커질수록 링크断裂, 미분류 페이지가 생기기 쉽습니다.
- **세션은 동시 작업, DAG는 순서가 있는 작업**에 적합합니다.
- **file_back을 습관화하세요.** AI가 찾아낸 인사이트는 wiki에 저장해야 다음에도 활용됩니다.
- **\`aio doctor --fail\`** 로 CI/CD 파이프라인에서 전체 상태를 검증할 수 있습니다.
- **위키 MR 시스템**을 사용하면 변경 이력이 추적 가능하고, 롤백이 쉽습니다.
- **하네스(bootstrap_harness)** 로 프로젝트 지식을 표준화하면 팀 온보딩 시간이 단축됩니다.
`

const EN_INTRO = `# AIO MCP Tool Usage Guide

## What is aio-mcp?

aio-mcp is a **project knowledge + orchestration tool for AI assistants** (Cursor, Claude Code, OpenCode, etc.).

### Core Concepts

| Concept | Description | Analogy |
|---|---|---|
| **Wiki (RAG)** | 3-layer persistent knowledge store (raw → wiki → schema). Vector search for instant retrieval | The project's brain |
| **Session** | Independent AI workers, each with separate context, running in parallel | Parallel employees |
| **DAG** | Task dependency graph → topological sort → layer-parallel execution | Manufacturing flowchart |
| **Branch Hunt** | DFS issue scan → branch into sessions → collect results | Bug hunting |
| **Harness** | Wiki knowledge → AGENTS.md / rules / hooks / MCP configs | Project handoff docs |

### Project Lifecycle (6 Phases)

\`\`\`
① Init ─────→ ② Ingest ────→ ③ Design ────→ ④ Execute ───→ ⑤ Review ───→ ⑥ Handoff
   init           ingest         plan            spawn_session    file_back      harness
   doctor         lint_wiki      brainstorm      execute_dag      lint_wiki      bootstrap
   mcp-serve      query_wiki     design_arch     scan_issues      wiki_mr        usage_guide
                                 plan_task
                                     ↑                                 │
                                     └────────── iterate ──────────────┘
\`\`\`

### Quick Start

\`\`\`bash
npx -y @mindol1004/aio-mcp init          # Initialize project
npx -y @mindol1004/aio-mcp mcp-serve      # Start MCP server
\`\`\`

### Using with Natural Language

Once MCP is connected to your AI assistant, use **natural language** — the AI picks the right tool automatically.

| Korean | English | Tool |
|---|---|---|
| "위키 검색해줘" | "search the wiki" | \`query_wiki\` |
| "이 문서 ingest 해줘" | "ingest this file" | \`ingest_pipeline\` |
| "세션 띄워줘" | "spawn a session" | \`spawn_session\` |
| "계획 세워줘" | "plan the task" | \`plan_task\` |
| "하네스 구성해줘" | "bootstrap harness" | \`bootstrap_harness\` |
| "위키 lint" | "lint the wiki" | \`lint_wiki\` |
| "디버깅 스캔" | "scan for issues" | \`scan_issues\` |
| "인박스 확인" | "check inbox" | \`check_inbox\` |
`

const EN_PHASES = `## Detailed Process Guide

### Phase 1: Project Initialization

Connect aio-mcp to your project.

\`\`\`bash
npx -y @mindol1004/aio-mcp init          # Create 3-layer vault + wiki
npx -y @mindol1004/aio-mcp doctor         # Health check
npx -y @mindol1004/aio-mcp mcp-serve      # Start MCP server
\`\`\`

**Goal:** MCP is connected to the project, AI can access the wiki.
**Output:** \`vault/\` directory (raw/, wiki/, .index/), \`vault/AGENTS.md\` (schema)

### Phase 2: Knowledge Accumulation

Store project docs, code structure, and architecture into the wiki — creating **project persistent memory** that AI can search.

| Pattern | Usage | Effect |
|---|---|---|
| File ingest | "ingest this README" | Single file → wiki page |
| Directory ingest | "ingest the src/ structure" | Full directory scan |
| Concept definition | "create a wiki page for payment system" | Manual knowledge entry |
| URL ingest | (download then ingest) | External document absorption |
| raw-inbox | Drop files in \`vault/raw-inbox/\`, then "scan inbox" | Batch ingest |

**Goal:** All major concepts, terms, and architecture are documented in the wiki.
**Verify:** "lint the wiki" (lint_wiki) → consistency check

### Phase 3: Design & Planning

Collaborate with AI to design and plan tasks using accumulated knowledge.

\`\`\`
# Context gathering
"give me context" → domain_context: project state summary

# Stack analysis
"seed stacks" → seed_stack_playbooks: 37 stack best practices

# Architecture design
"design payment architecture" → design_architecture: wiki + stacks → docs/architecture.md

# Brainstorming
"brainstorm order system improvements" → brainstorm_design: multi-turn design discussion

# Task decomposition
"plan payment refactoring" → plan_task: task list + DAG structure
\`\`\`

**Goal:** Task list with dependency graph (DAG) is ready for execution.

### Phase 4: Parallel Execution

Spawn multiple independent AI sessions to work simultaneously.

**Session — Independent workers**
\`\`\`
"spawn 3 sessions to analyze each module" → spawn_session × 3
"check inbox" → check_inbox: find completed tasks
"synthesize results" → synthesize_results: merge session outputs
\`\`\`

**DAG — Dependency-based parallel execution**
\`\`\`
"execute the DAG with defined tasks" → execute_dag: auto-topological + layer-parallel
\`\`\`

**Branch Hunt — Parallel bug fixing**
\`\`\`
"scan issues and fix in parallel" → scan_issues → collect_results
\`\`\`

**Goal:** Multiple tasks run concurrently, maximizing productivity.
**Tip:** Use \`request_approval\` / \`resolve_approval\` for human-gated risky operations.

### Phase 5: Review & Feedback

Record results in wiki, verify consistency with lint, then iterate.

\`\`\`
# Save results to wiki
"file_back these results" → file_back: session output → persistent storage

# Wiki consistency check
"lint the wiki" → lint_wiki: unlinked pages, stale docs, index coverage

# Quality management
"propose a change" → propose_wiki_change: MR-style change management
"show diff" → wiki_diff: preview changes
\`\`\`

**Goal:** Results accumulate in wiki, available for the next iteration.

### Phase 6: Handoff & Documentation

Package project knowledge for the next developer or AI.

\`\`\`
# Harness: wiki → project rules
"bootstrap harness" → bootstrap_harness: AGENTS.md, rules, hooks, MCP configs

# Usage guide
"generate usage guide" → generate_usage_guide: docs/mcp-guide/README

# Health check
aio doctor --fail: full system validation
\`\`\`

**Goal:** New joiners (human or AI) can immediately understand project context.

## Tips & Best Practices

- **Start small.** \`init\` → ingest one file → search wiki already boosts productivity significantly.
- **Run lint frequently.** As the wiki grows, broken links and uncategorized pages accumulate.
- **Use Sessions for parallel tasks, DAG for ordered tasks** with dependencies.
- **Make file_back a habit.** Insights AI discovers must be stored in wiki for future reuse.
- **\`aio doctor --fail\`** validates full system health in CI/CD pipelines.
- **Use the Wiki MR system** for tracked, revertable changes.
- **Harness (bootstrap_harness)** standardizes project knowledge, reducing team onboarding time.
`

function toolTable(category: {
  category: string
  items: { name: string; desc: string; params: string; example: string }[]
}): string {
  let md = `## ${category.category}\n\n`
  md += '| Tool | Description | Parameters | Example |\n'
  md += '|---|---|---|---|\n'
  for (const t of category.items) {
    md += `| \`${t.name}\` | ${t.desc} | \`${t.params || '-'}\` | ${t.example || '-'} |\n`
  }
  md += '\n'
  return md
}

function workflowsSection(title: string, workflows: { title: string; steps: string[] }[]): string {
  let md = `## Workflow Examples\n\n`
  for (const w of workflows) {
    md += `### ${w.title}\n\n`
    for (const s of w.steps) {
      md += `1. ${s}\n`
    }
    md += '\n'
  }
  return md
}

export async function generateDocs(): Promise<{ ko: string; en: string }> {
  const toolsMd = TOOLS.map(toolTable).join('\n')
  const workflowsKo = workflowsSection('워크플로우 예시', WORKFLOWS)
  const workflowsEn = workflowsSection(
    'Workflow Examples',
    WORKFLOWS.map((w) => ({
      title: w.title,
      steps: w.steps.map((s) => s.replace(/「.*?」/g, '')),
    }))
  )

  const ko = KO_INTRO + KO_PHASES + toolsMd + workflowsKo
  const en = EN_INTRO + EN_PHASES + toolsMd + workflowsEn
  return { ko, en }
}

export async function writeDocs(projectRoot: string): Promise<string[]> {
  const { ko, en } = await generateDocs()
  const dir = join(projectRoot, 'docs', 'mcp-guide')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'README-ko.md'), ko, 'utf-8')
  writeFileSync(join(dir, 'README-en.md'), en, 'utf-8')
  return [join(dir, 'README-ko.md'), join(dir, 'README-en.md')]
}
