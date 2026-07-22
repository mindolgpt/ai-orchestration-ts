import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

interface ToolItem {
  name: string
  desc: string
  params: string
  exampleKo: string
  exampleEn: string
}

const TOOLS: { category: string; items: ToolItem[] }[] = [
  {
    category: 'Wiki (RAG)',
    items: [
      { name: 'ingest_pipeline', desc: 'End-to-end ingest: raw → wiki pages → lint', params: 'file_path?, title?, content?, concepts?, lint_mode? (summary|none), raw_id?, skip_raw?', exampleKo: '"README.md를 위키에 ingest 해줘"', exampleEn: '"ingest this README" | "ingest_pipeline({ file_path: \'README.md\' })"' },
      { name: 'query_wiki', desc: 'Semantic search → full page content + citations', params: 'query, top_k? (default 10)', exampleKo: '"위키에서 결제 시스템 검색해줘"', exampleEn: '"search the wiki for cart" | "query_wiki({ query: \'checkout saga\' })"' },
      { name: 'ingest_raw', desc: 'Store immutable original in vault/raw/', params: 'title, content?, file_path?, source_uri?', exampleKo: '"이 문서를 raw로 저장해줘"', exampleEn: '"save this as raw" | "ingest_raw({ title: \'API spec\', file_path: \'./spec.md\' })"' },
      { name: 'ingest_source', desc: 'Create/update one wiki concept page', params: 'title, content, tags?, subdir?', exampleKo: '"결제모듈 페이지 생성해줘"', exampleEn: '"create a wiki page for payment" | "ingest_source({ title: \'Payment\', content: \'...\' })"' },
      { name: 'ingest_source_batch', desc: 'Batch create wiki pages from structured input', params: 'pages[] (title, content, tags?, subdir?)', exampleKo: '"여러 페이지 한번에 생성해줘"', exampleEn: '"batch create wiki pages" | "ingest_source_batch({ pages: [...] })"' },
      { name: 'update_wiki_page', desc: 'Update existing wiki page (cross-links, fixes)', params: 'title, content, tags?, subdir?', exampleKo: '"위키 페이지 내용 업데이트해줘"', exampleEn: '"update the wiki page for cart" | "update_wiki_page({ title: \'Cart\', content: \'...\' })"' },
      { name: 'file_back', desc: 'Save durable query synthesis back to wiki', params: 'title, content, tags?, citations?, subdir?', exampleKo: '"이 내용 file_back 해줘"', exampleEn: '"file_back this result" | "file_back({ title: \'Checkout FAQ\', content: \'...\' })"' },
      { name: 'lint_wiki', desc: 'Wiki health check (orphans, index coverage, links)', params: 'deep?, stale_days?', exampleKo: '"위키 lint 돌려줘"', exampleEn: '"lint the wiki" | "lint_wiki({ deep: true })"' },
      { name: 'get_wiki_schema', desc: 'Read vault wiki schema (AGENTS.md)', params: 'mode? (excerpt|full)', exampleKo: '"스키마 읽어줘"', exampleEn: '"get the wiki schema" | "get_wiki_schema({ mode: \'excerpt\' })"' },
    ],
  },
  {
    category: 'Wiki MR (change proposals)',
    items: [
      { name: 'propose_wiki_change', desc: 'Create a wiki MR proposal (diff stored)', params: 'title, content, rationale?, subdir?', exampleKo: '"이 변경사항 MR로 제안해줘"', exampleEn: '"propose a wiki change" | "propose_wiki_change({ title: \'...\', content: \'...\' })"' },
      { name: 'list_wiki_proposals', desc: 'List wiki change proposals', params: 'status? (pending|applied|rejected)', exampleKo: '"MR 목록 봐줘"', exampleEn: '"list wiki proposals" | "list_wiki_proposals()"' },
      { name: 'apply_wiki_proposal', desc: 'Apply a pending wiki proposal', params: 'id, resolver?', exampleKo: '"MR 적용해줘"', exampleEn: '"apply proposal" | "apply_wiki_proposal({ id })"' },
      { name: 'reject_wiki_proposal', desc: 'Reject a pending wiki proposal', params: 'id, reason?', exampleKo: '"MR 반려해줘"', exampleEn: '"reject proposal" | "reject_wiki_proposal({ id, reason })"' },
      { name: 'wiki_diff', desc: 'Preview diff lines for proposed change', params: 'title, content, subdir?', exampleKo: '"차이점 미리보기"', exampleEn: '"preview wiki diff" | "wiki_diff({ title, content })"' },
    ],
  },
  {
    category: 'Session Management',
    items: [
      { name: 'spawn_session', desc: 'Create independent AI session for task', params: 'task, sessionId?, timeout_ms?, runtime?, worktree?, context?', exampleKo: '"이 기능 분석하는 세션 띄워줘"', exampleEn: '"spawn a session to analyze this" | "spawn_session({ task: \'analyze module\' })"' },
      { name: 'check_inbox', desc: 'Check child session completion reports', params: 'session_id?, status?', exampleKo: '"인박스 확인"', exampleEn: '"check my inbox" | "check_inbox()"' },
      { name: 'report_result', desc: 'Report current session result to parent', params: 'summary, status? (completed|failed), payload?', exampleKo: '"결과 보고할게"', exampleEn: '"report result" | "report_result({ summary: \'done\', status: \'completed\' })"' },
      { name: 'send_message', desc: 'Send message to running session', params: 'sessionId, message', exampleKo: '"세션에 메시지 보내줘"', exampleEn: '"send message to session" | "send_message({ sessionId, message })"' },
      { name: 'get_session', desc: 'Get session status / output', params: 'sessionId', exampleKo: '"세션 상태 확인"', exampleEn: '"get session status" | "get_session({ sessionId })"' },
      { name: 'close_session', desc: 'Clean up completed session', params: 'sessionId', exampleKo: '"세션 종료해줘"', exampleEn: '"close session" | "close_session({ sessionId })"' },
      { name: 'list_sessions', desc: 'List all sessions', params: '', exampleKo: '"세션 목록"', exampleEn: '"list sessions" | "list_sessions()"' },
      { name: 'synthesize_results', desc: 'Synthesize results from multiple child sessions', params: 'session_ids[], plan_id?, goal?, format? (markdown|json)', exampleKo: '"결과 종합해줘"', exampleEn: '"synthesize results" | "synthesize_results({ session_ids: [...], goal })"' },
    ],
  },
  {
    category: 'DAG (parallel task execution)',
    items: [
      { name: 'plan_task', desc: 'Deep planning → task decomposition into DAG stubs', params: 'title, description, success_criteria?, constraints?', exampleKo: '"결제 리팩토링 계획 세워줘"', exampleEn: '"plan the payment refactoring" | "plan_task({ title: \'Payment refactor\', description: \'...\' })"' },
      { name: 'execute_dag', desc: 'Create DAG → topological sort → layer-parallel execution with Ralph retry+verify', params: 'plan_id, tasks[], fail_fast?, resume?, max_parallel?, worktree?, ralph_max_retries?, ralph_verify?', exampleKo: '"정의된 태스크로 DAG 실행해줘"', exampleEn: '"execute the dag" | "execute_dag({ plan_id, tasks })"' },
    ],
  },
  {
    category: 'Branch Hunt (parallel debugging)',
    items: [
      { name: 'scan_issues', desc: 'DFS-based issue scan + branching for fix sessions', params: 'paths?, sessionId?, pattern?', exampleKo: '"버그 스캔해줘"', exampleEn: '"scan for issues" | "scan_issues({ paths: [\'src\'] })"' },
      { name: 'collect_results', desc: 'Collect branched session results', params: 'sessionIds', exampleKo: '"결과 수집해줘"', exampleEn: '"collect results" | "collect_results({ sessionIds })"' },
      { name: 'get_branch_status', desc: 'Branch Hunt status summary', params: 'sessionId?', exampleKo: '"상태 요약"', exampleEn: '"get branch status" | "get_branch_status()"' },
    ],
  },
  {
    category: 'Harness (project setup)',
    items: [
      { name: 'aio_prompt', desc: 'Natural language router — routes to any tool by keyword (KO+EN)', params: 'message, execute? (default true), params?', exampleKo: '"위키 검색해줘" / "DAG 실행해줘"', exampleEn: '"search the wiki" / "run the dag" | "aio_prompt({ message })"' },
      { name: 'list_tool_keywords', desc: 'List all keyword-routable tools and their patterns', params: '', exampleKo: '"도구 목록"', exampleEn: '"list tools" | "list_tool_keywords()"' },
      { name: 'bootstrap_harness', desc: 'Generate AGENTS.md, rules, hooks, MCP config from wiki', params: 'domain?, description?, backend?, frontend?, force?', exampleKo: '"하네스 구성해줘"', exampleEn: '"bootstrap harness" | "bootstrap_harness({ domain: \'ecommerce\' })"' },
      { name: 'domain_context', desc: 'Project-aware context packing (replaces bootstrap_domain + loop)', params: 'task, format? (path|full), top_k?, extra_queries?, include_plan?', exampleKo: '"컨텍스트 줘"', exampleEn: '"give me context" | "domain_context({ task, format: \'path\' })"' },
      { name: 'seed_stack_playbooks', desc: 'Seed stack playbooks under wiki/stacks/ (37 stacks)', params: 'include_patterns?', exampleKo: '"스택 시드"', exampleEn: '"seed stacks" | "seed_stack_playbooks()"' },
      { name: 'design_architecture', desc: 'Wiki + stack architecture → docs/architecture.md', params: 'intent?, answers?', exampleKo: '"아키텍쳐 설계"', exampleEn: '"design architecture" | "design_architecture({ intent })"' },
      { name: 'brainstorm_design', desc: 'Multi-turn design brainstorm with wiki context', params: 'topic, answers?, skip_questions?, response_format? (markdown|structured), write_docs?', exampleKo: '"브레인스토밍"', exampleEn: '"brainstorm design" | "brainstorm_design({ topic })"' },
      { name: 'bootstrap_domain', desc: 'Deprecated — use domain_context', params: 'domain, description?', exampleKo: '', exampleEn: '' },
      { name: 'run_domain_loop', desc: 'Deprecated — use domain_context with include_plan: true', params: '', exampleKo: '', exampleEn: '' },
      { name: 'get_domain_profile', desc: 'Read current domain profile', params: '', exampleKo: '"프로필 조회"', exampleEn: '"get domain profile" | "get_domain_profile()"' },
      { name: 'save_domain_profile', desc: 'Save domain profile', params: 'domain?, description?, backend?, frontend?', exampleKo: '"프로필 저장"', exampleEn: '"save domain profile" | "save_domain_profile({ domain })"' },
      { name: 'list_stack_playbooks', desc: 'List available stack playbook IDs', params: '', exampleKo: '"스택 목록"', exampleEn: '"list stacks" | "list_stack_playbooks()"' },
      { name: 'generate_usage_guide', desc: 'Generate MCP tool usage guide in docs/mcp-guide/', params: '', exampleKo: '"사용 가이드 생성해줘"', exampleEn: '"generate usage guide" | "generate_usage_guide()"' },
    ],
  },
  {
    category: 'Operations & Approval',
    items: [
      { name: 'request_approval', desc: 'Request human approval for risky operation', params: 'action, reason, risk? (low|medium|high), meta?', exampleKo: '"승인 요청"', exampleEn: '"request approval" | "request_approval({ action: \'git push\', reason: \'...\' })"' },
      { name: 'resolve_approval', desc: 'Resolve a pending approval', params: 'id, approved, comment?', exampleKo: '"승인"', exampleEn: '"resolve approval" | "resolve_approval({ id, approved: true })"' },
      { name: 'list_approvals', desc: 'List pending approvals', params: '', exampleKo: '"승인 목록"', exampleEn: '"list approvals" | "list_approvals()"' },
      { name: 'run_doctor', desc: 'Run system diagnostics', params: 'json?, fail?', exampleKo: '"진단 실행"', exampleEn: '"run doctor" | "run_doctor()"' },
      { name: 'get_events', desc: 'Get event log', params: 'limit?', exampleKo: '"이벤트 로그"', exampleEn: '"get events" | "get_events({ limit: 20 })"' },
      { name: 'list_worktrees', desc: 'List git worktrees', params: '', exampleKo: '"워크트리 목록"', exampleEn: '"list worktrees" | "list_worktrees()"' },
      { name: 'remove_worktree', desc: 'Remove a git worktree', params: 'path', exampleKo: '"워크트리 제거"', exampleEn: '"remove worktree" | "remove_worktree({ path })"' },
    ],
  },
  {
    category: 'Vault & Knowledge',
    items: [
      { name: 'list_vaults', desc: 'List registered vaults', params: '', exampleKo: '"볼트 목록"', exampleEn: '"list vaults" | "list_vaults()"' },
      { name: 'register_vault', desc: 'Register a vault', params: 'name, path, description?, default?', exampleKo: '"볼트 등록"', exampleEn: '"register vault" | "register_vault({ name, path })"' },
      { name: 'scan_raw_inbox', desc: 'Process files in vault/raw-inbox/', params: 'run_lint?', exampleKo: '"인박스 스캔"', exampleEn: '"scan inbox" | "scan_raw_inbox()"' },
      { name: 'get_dashboard_stats', desc: 'Get dashboard statistics (coverage, proposals, events)', params: '', exampleKo: '"대시보드 통계"', exampleEn: '"get dashboard stats" | "get_dashboard_stats()"' },
      { name: 'recall_knowledge', desc: 'Deprecated — use query_wiki', params: 'query, topK?', exampleKo: '', exampleEn: '' },
      { name: 'store_knowledge', desc: 'Deprecated — use ingest_pipeline / file_back', params: 'title, content, tags?', exampleKo: '', exampleEn: '' },
    ],
  },
]

const RALPH_SECTION_KO = `## Ralph Loop (재시도 + 검증 엔진)

\`execute_dag\` 실행 시 각 DAG 노드는 Ralph를 통해 동작합니다:

1. **구현 (implement)** — AI 세션을 생성하여 태스크 실행
2. **검증 (verify)** — \`npm run build\` → \`lint\` → \`test\` 순차 검증
3. **재시도** — 실패 시 지수 백오프 + 지터로 최대 3회 재시도

| 기능 | 설명 |
|---|---|
| 최대 재시도 | \`ralph_max_retries\` 파라미터 (기본 3) |
| 백오프 | 지수 + 지터 (\`baseBackoffMs=500\`, 최대 8초) |
| 검증 단계 | \`AIO_VERIFY_STEPS=build,lint,test,custom\` |
| 커스텀 명령 | \`AIO_VERIFY_CUSTOM_CMD\` + \`AIO_VERIFY_CUSTOM_ARGS\` (JSON 배열) |
| 진행 상황 | 이벤트 로그로 전송 (\`ralph.progress\`) |
| 비활성화 | \`ralph_max_retries: 0\` + \`ralph_verify: false\` |
`

const RALPH_SECTION_EN = `## Ralph Loop (retry + verify engine)

Each \`execute_dag\` node runs through Ralph:

1. **Implement** — spawn AI session to execute task
2. **Verify** — \`npm run build\` → \`lint\` → \`test\` sequential ladder
3. **Retry** — exponential backoff + jitter, max 3 retries on failure

| Feature | Detail |
|---|---|
| Max retries | \`ralph_max_retries\` param (default 3) |
| Backoff | Exponential + jitter (\`baseBackoffMs=500\`, up to 8s) |
| Verify steps | \`AIO_VERIFY_STEPS=build,lint,test,custom\` |
| Custom command | \`AIO_VERIFY_CUSTOM_CMD\` + \`AIO_VERIFY_CUSTOM_ARGS\` (JSON array) |
| Progress | Events emitted to event log (\`ralph.progress\`) |
| Disable | \`ralph_max_retries: 0\` + \`ralph_verify: false\` |
`

const ENV_SECTION_KO = `## 환경 변수

주요 환경 변수:

| 변수 | 기본값 | 설명 |
|---|---|---|
| \`AIO_PROJECT_ROOT\` | 자동 감지 | 프로젝트 루트 경로 |
| \`AIO_VAULT_PATH\` | \`<project>/vault\` | 볼트 경로 |
| \`EMBEDDING_PROVIDER\` | \`local\` | \`local\` \\| \`openai\` |
| \`VECTOR_STORE\` | \`faiss\` | \`faiss\` \\| \`qdrant\` \\| \`chroma\` \\| \`pinecone\` \\| \`weaviate\` \\| \`pgvector\` |
| \`AIO_MCP_TOOL_SET\` | \`full\` | \`core\` \\| \`wiki\` \\| \`full\` |
| \`AIO_SESSION_RUNTIME\` | – | 세션 런타임 (opencode/claude/cursor/codex/custom) |
| \`AIO_VERIFY_STEPS\` | \`build,lint,test\` | Ralph 검증 단계 |
| \`AIO_EVENTS\` | \`1\` | \`0\`으로 설정 시 이벤트 로그 비활성화 |
| \`AIO_SSE_TOKEN\` | – | SSE 서버 인증 토큰 (non-loopback 필요) |
| \`AIO_DASHBOARD_TOKEN\` | – | 대시보드 인증 토큰 (non-loopback 필요) |

전체 목록은 프로젝트 README의 "Environment variables" 섹션을 참고하세요.
`

const ENV_SECTION_EN = `## Environment Variables

Key environment variables:

| Variable | Default | Description |
|---|---|---|
| \`AIO_PROJECT_ROOT\` | auto-detect | Project root path |
| \`AIO_VAULT_PATH\` | \`<project>/vault\` | Vault path |
| \`EMBEDDING_PROVIDER\` | \`local\` | \`local\` \\| \`openai\` |
| \`VECTOR_STORE\` | \`faiss\` | \`faiss\` \\| \`qdrant\` \\| \`chroma\` \\| \`pinecone\` \\| \`weaviate\` \\| \`pgvector\` |
| \`AIO_MCP_TOOL_SET\` | \`full\` | \`core\` \\| \`wiki\` \\| \`full\` |
| \`AIO_SESSION_RUNTIME\` | – | Session runtime (opencode/claude/cursor/codex/custom) |
| \`AIO_VERIFY_STEPS\` | \`build,lint,test\` | Ralph verify steps |
| \`AIO_EVENTS\` | \`1\` | Set \`0\` to disable event log |
| \`AIO_SSE_TOKEN\` | – | SSE server auth token (required for non-loopback) |
| \`AIO_DASHBOARD_TOKEN\` | – | Dashboard auth token (required for non-loopback) |

See the project README "Environment variables" section for the full list.
`

const WORKFLOWS = [
  {
    title: 'New project onboarding',
    steps: ['aio init → MCP 연결 → "이 프로젝트 구조를 위키에 저장해줘" → "도메인 분석해서 하네스 구성해줘"'],
  },
  {
    title: 'Feature implementation',
    steps: ['"컨텍스트 줘" (domain_context) → "계획 세워줘" (plan_task) → "병렬 실행해줘" (execute_dag) → "결과 file_back 해줘" → "위키 lint"'],
  },
  {
    title: 'Parallel research',
    steps: ['"세션 3개 띄워서 각각 분석해줘" → "인박스 확인" (check_inbox) → "결과 종합해줘" (synthesize_results)'],
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
npx -y @mindol1004/aio-mcp init          # 3계층 vault + wiki 구조 생성
npx -y @mindol1004/aio-mcp doctor         # 상태 진단
npx -y @mindol1004/aio-mcp mcp-serve      # MCP 서버 실행 (Cursor/Claude Code 연동)
\`\`\`

**목표:** MCP가 프로젝트에 연결되고, AI가 wiki에 접근할 수 있는 상태.
**결과물:** \`vault/\` 디렉토리 (raw/, wiki/, .index/), \`vault/AGENTS.md\``,
  },
  {
    title: '2단계: 지식 축적 (Knowledge Ingest)',
    body: `프로젝트의 문서, 코드, 아키텍처 정보를 wiki에 저장합니다. AI가 검색할 수 있는 **프로젝트 영구 기억**을 만듭니다.

| 패턴 | 사용법 | 효과 |
|---|---|---|
| 파일 ingest | "README.md ingest 해줘" | 단일 파일 → wiki 페이지 |
| 폴더 ingest | "src/ 디렉토리 구조 ingest 해줘" | 디렉토리 전체 탐색 |
| 개념 정의 | "결제 시스템 wiki 페이지 생성해줘" | 수동 지식 입력 |
| raw-inbox | 파일을 \`vault/raw-inbox/\`에 넣고 "인박스 스캔" | 배치 ingest |

**목표:** 주요 개념, 용어, 아키텍처가 wiki에 정리됨.
**확인:** "위키 lint 돌려줘" (lint_wiki) → 정합성 검증`,
  },
  {
    title: '3단계: 설계 & 계획',
    body: `축적된 지식을 바탕으로 AI와 협력하여 설계하고 태스크 계획.

\`\`\`
"컨텍스트 줘" → domain_context: 프로젝트 상태 요약
"스택 시드" → seed_stack_playbooks: 스택별 모범 사례
"아키텍처 설계해줘" → design_architecture: wiki + 스택 → docs/architecture.md
"브레인스토밍" → brainstorm_design: 다중 턴 설계 토론
"계획 세워줘" → plan_task: 태스크 + DAG 구조
\`\`\`

**목표:** 실행할 태스크 목록과 DAG 준비.`,
  },
  {
    title: '4단계: 병렬 실행 (with Ralph)',
    body: `독립적인 AI 세션을 여러 개 띄워 동시에 작업. Ralph가 각 노드의 재시도 + 검증을 자동 처리.

**Session — 독립 작업자**
\`\`\`
"세션 3개 띄워서 각 모듈 분석해줘" → spawn_session × 3
"인박스 확인" → check_inbox
"결과 종합해줘" → synthesize_results
\`\`\`

**DAG + Ralph — 의존성 기반 병렬 실행 + 자동 재시도/검증**
\`\`\`
"DAG 실행해줘" → execute_dag: 각 노드 실패 시 재시도, 성공 시 build/lint/test 검증
\`\`\`

**Branch Hunt — 버그 병렬 수정**
\`\`\`
"이슈 스캔 후 병렬로 수정해줘" → scan_issues → collect_results
\`\`\``,
  },
  {
    title: '5단계: 검토 & 환류',
    body: `실행 결과를 wiki에 기록, lint로 정합성 확인, MR로 변경 관리.

\`\`\`
"결과를 wiki에 file_back 해줘" → file_back: 영구 저장
"위키 lint" → lint_wiki: 미링크 페이지, 오래된 문서
"변경 제안" → propose_wiki_change: MR 방식 변경 관리
\`\`\``,
  },
  {
    title: '6단계: 인계 & 문서화',
    body: `프로젝트 지식을 다음 개발자/AI가 활용할 수 있도록 포장.

\`\`\`
"하네스 구성해줘" → bootstrap_harness: AGENTS.md, 룰, 훅, MCP 설정
"사용 가이드 생성해줘" → generate_usage_guide: docs/mcp-guide/README
aio doctor --fail: 전체 상태 점검
\`\`\``,
  },
]

const KO_INTRO = `# AIO MCP 도구 사용 가이드

## aio-mcp란?

aio-mcp는 **AI 어시스턴트(Cursor, Claude Code, OpenCode 등)를 위한 프로젝트 지식 + 오케스트레이션 도구**입니다.

### 핵심 개념

| 개념 | 설명 | 비유 |
|---|---|---|
| **Wiki (RAG)** | 3계층 영구 지식 저장소 (raw → wiki → schema). 벡터 검색으로 즉시 조회 | 프로젝트의 두뇌 |
| **Session** | 독립적인 AI 작업자. 각각 별도 컨텍스트로 병렬 작업 | 병렬 부하 직원 |
| **DAG + Ralph** | 태스크 의존성 그래프 → 위상정렬 → 레이어별 병렬 실행 + 재시도/검증 | 공정 관리도 |
| **Branch Hunt** | 코드 이슈를 DFS로 탐색 → 세션으로 분기 → 결과 수집 | 버그 사냥 |
| **Harness** | Wiki 지식 → AGENTS.md / 룰 / 훅 / MCP 설정 | 프로젝트 인수인계 |

### 프로젝트 활용 프로세스 (6단계)

\`\`\`
① 초기화 ──→ ② 지식 축적 ──→ ③ 설계/계획 ──→ ④ 병렬 실행 ──→ ⑤ 검토/환류 ──→ ⑥ 인계
   init         ingest           plan             execute          review           harness
   doctor       lint_wiki        brainstorm        spawn_session    file_back        bootstrap
   mcp-serve    query_wiki       design_arch       execute_dag      lint_wiki        usage_guide
                                 plan_task         scan_issues      wiki_mr
                                     ↑                                 │
                                     └────────── 반복(iterate) ────────┘
\`\`\`

### 시작하기

\`\`\`bash
npx -y @mindol1004/aio-mcp init          # 프로젝트 초기화
npx -y @mindol1004/aio-mcp mcp-serve      # MCP 서버 실행
\`\`\`

### 자연어로 사용하기

**도구 이름을 몰라도 자연어로 명령**하면 AI가 적절한 도구를 선택합니다.

| 한국어 예시 | 영어 예시 | 도구 |
|---|---|---|
| "위키 검색해줘" | "search the wiki" | \`query_wiki\` |
| "이 문서 ingest 해줘" | "ingest this file" | \`ingest_pipeline\` |
| "세션 띄워줘" | "spawn a session" | \`spawn_session\` |
| "계획 세워줘" | "plan the task" | \`plan_task\` |
| "DAG 실행해줘" | "run the dag" | \`execute_dag\` |
| "하네스 구성해줘" | "bootstrap harness" | \`bootstrap_harness\` |
| "위키 lint" | "lint the wiki" | \`lint_wiki\` |
| "이슈 스캔" | "scan for issues" | \`scan_issues\` |
| "인박스 확인" | "check inbox" | \`check_inbox\` |
`

const KO_PHASES = `## 상세 프로세스 가이드

${PHASES.map(p => `### ${p.title}\n\n${p.body}`).join('\n\n')}

### 팁 & 베스트 프랙티스

- **작게 시작.** \`init\` → 1개 파일 ingest → wiki 검색만으로 생산성 향상
- **lint 자주 실행.** wiki가 커질수록 링크断裂, 미분류 페이지 발생
- **세션은 동시 작업, DAG+RALPH는 순서 작업**에 적합 (재시도+검증 자동)
- **file_back 습관화.** AI 인사이트를 wiki에 저장해야 재사용 가능
- **\`aio doctor --fail\`** 로 CI/CD 상태 검증
- **위키 MR 시스템**으로 변경 이력 추적 및 롤백
- **하네스(bootstrap_harness)** 로 팀 온보딩 시간 단축
`

const EN_INTRO = `# AIO MCP Tool Usage Guide

## What is aio-mcp?

aio-mcp is a **project knowledge + orchestration tool for AI assistants** (Cursor, Claude Code, OpenCode, etc.).

### Core Concepts

| Concept | Description | Analogy |
|---|---|---|
| **Wiki (RAG)** | 3-layer persistent knowledge store (raw → wiki → schema). Vector search for instant retrieval | The project's brain |
| **Session** | Independent AI workers, each with separate context, running in parallel | Parallel employees |
| **DAG + Ralph** | Task dependency graph → topological sort → layer-parallel execution + retry/verify | Manufacturing flowchart |
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

Use **natural language** — the AI picks the right tool automatically.

| Korean | English | Tool |
|---|---|---|
| "위키 검색해줘" | "search the wiki" | \`query_wiki\` |
| "이 문서 ingest 해줘" | "ingest this file" | \`ingest_pipeline\` |
| "세션 띄워줘" | "spawn a session" | \`spawn_session\` |
| "계획 세워줘" | "plan the task" | \`plan_task\` |
| "DAG 실행해줘" | "run the dag" | \`execute_dag\` |
| "하네스 구성해줘" | "bootstrap harness" | \`bootstrap_harness\` |
| "위키 lint" | "lint the wiki" | \`lint_wiki\` |
| "이슈 스캔" | "scan for issues" | \`scan_issues\` |
| "인박스 확인" | "check inbox" | \`check_inbox\` |
`

const EN_PHASES = `## Detailed Process Guide

### Phase 1: Project Initialization

\`\`\`bash
npx -y @mindol1004/aio-mcp init          # Create 3-layer vault + wiki
npx -y @mindol1004/aio-mcp doctor         # Health check
npx -y @mindol1004/aio-mcp mcp-serve      # Start MCP server
\`\`\`

**Goal:** MCP connected, AI can access wiki.
**Output:** \`vault/\` directory, \`vault/AGENTS.md\`

### Phase 2: Knowledge Accumulation

Store project docs, code, and architecture into the wiki — **project persistent memory**.

| Pattern | Usage | Effect |
|---|---|---|
| File ingest | "ingest this README" | Single file → wiki page |
| Directory ingest | "ingest the src/ structure" | Full directory scan |
| Concept definition | "create a wiki page for payment" | Manual knowledge entry |
| raw-inbox | Drop files in \`vault/raw-inbox/\`, then "scan inbox" | Batch ingest |

**Goal:** All major concepts documented in wiki.
**Verify:** "lint the wiki" (lint_wiki)

### Phase 3: Design & Planning

\`\`\`
"give me context" → domain_context: project state summary
"seed stacks" → seed_stack_playbooks: 37 stack best practices
"design architecture" → design_architecture: wiki + stacks → docs/architecture.md
"brainstorm" → brainstorm_design: multi-turn design discussion
"plan task" → plan_task: task list + DAG structure
\`\`\`

**Goal:** Task list with dependency graph (DAG) ready for execution.

### Phase 4: Parallel Execution (with Ralph)

**Session — Independent workers**
\`\`\`
"spawn 3 sessions to analyze each module" → spawn_session × 3
"check inbox" → check_inbox
"synthesize results" → synthesize_results
\`\`\`

**DAG + Ralph — Dependency-based execution with auto-retry/verify**
\`\`\`
"run the dag" → execute_dag: each node retries on failure, verifies build/lint/test on success
\`\`\`

**Branch Hunt — Parallel bug fixing**
\`\`\`
"scan issues and fix in parallel" → scan_issues → collect_results
\`\`\`

### Phase 5: Review & Feedback

\`\`\`
"file_back these results" → file_back: persistent storage
"lint the wiki" → lint_wiki: unlinked pages, stale docs
"propose a change" → propose_wiki_change: MR-style change management
\`\`\`

### Phase 6: Handoff & Documentation

\`\`\`
"bootstrap harness" → bootstrap_harness: AGENTS.md, rules, hooks, MCP configs
"generate usage guide" → generate_usage_guide: docs/mcp-guide/README
aio doctor --fail: full system validation
\`\`\`

### Tips & Best Practices

- **Start small.** \`init\` → ingest one file → search wiki boosts productivity
- **Run lint frequently.** Broken links and uncategorized pages accumulate
- **Use Sessions for parallel tasks, DAG+Ralph for ordered tasks** with auto-retry
- **Make file_back a habit.** Insights must be stored in wiki for reuse
- **\`aio doctor --fail\`** validates full system health in CI/CD
- **Use the Wiki MR system** for tracked, revertable changes
- **Harness (bootstrap_harness)** standardizes project knowledge
`

function toolTable(category: { category: string; items: ToolItem[] }, locale: 'ko' | 'en'): string {
  let md = `## ${category.category}\n\n`
  md += '| Tool | Description | Parameters | Example |\n'
  md += '|---|---|---|---|\n'
  for (const t of category.items) {
    const example = locale === 'ko' ? t.exampleKo : t.exampleEn
    md += `| \`${t.name}\` | ${t.desc} | \`${t.params || '-'}\` | ${example || '-'} |\n`
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
  const toolsKo = TOOLS.map(c => toolTable(c, 'ko')).join('\n')
  const toolsEn = TOOLS.map(c => toolTable(c, 'en')).join('\n')
  const workflowsKo = workflowsSection('워크플로우 예시', WORKFLOWS)
  const workflowsEn = workflowsSection('Workflow Examples', WORKFLOWS.map(w => ({
    title: w.title,
    steps: w.steps.map(s => s.replace(/「.*?」/g, '')),
  })))

  const ko = KO_INTRO + KO_PHASES + RALPH_SECTION_KO + ENV_SECTION_KO + toolsKo + workflowsKo
  const en = EN_INTRO + EN_PHASES + RALPH_SECTION_EN + ENV_SECTION_EN + toolsEn + workflowsEn
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
