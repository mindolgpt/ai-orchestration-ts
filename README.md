# AI Orchestration System (TypeScript)

병렬 AI 오케스트레이션 시스템

## Quick start

```bash
npm install
npm run build
npx aio init                     # vault + 임베딩 인덱스 초기화
npx aio mcp-serve                # OpenCode용 stdio MCP 서버
npx aio serve                    # SSE MCP 서버 (포트 8910)
npx aio recall "결제 시스템"      # 시맨틱 검색
npx aio status                   # 시스템 상태 확인
```

## Commands

| 명령 | 설명 |
|---|---|
| `aio init` | Obsidian vault + FAISS 검색 인덱스 초기화 |
| `aio mcp-serve` | stdio MCP 서버 실행 (OpenCode 자동 연결) |
| `aio serve` | SSE MCP 서버 실행 (포트 8910) |
| `aio recall <query>` | 지식 베이스 시맨틱 검색 |
| `aio status` | 시스템 상태 확인 |
| `aio example` | 전체 파이프라인 예제 실행 |

## Verification

```bash
npm run lint      # ESLint
npm run typecheck # TypeScript 타입 체크
npm test          # Vitest 테스트
```

순서: `lint -> typecheck -> test`

## Architecture

```
src/
├── cli.ts                     # CLI 엔트리포인트 (aio)
├── knowledge/                 # 지식 축적 시스템
│   ├── vault.ts               # Obsidian vault 관리
│   ├── embedder.ts            # 로컬/OpenAI 임베딩
│   └── search.ts              # FAISS 시맨틱 검색
├── dag/                       # Task DAG 엔진
│   ├── types.ts               # TaskStatus, TaskNode 타입
│   ├── dag.ts                 # DAG 클래스 + 팩토리 함수
│   └── engine.ts              # Layer별 병렬 실행기
├── ralph/                     # Ralph Loop
│   ├── loop.ts                # 자동 구현→검증→재시도
│   └── verifier.ts            # build→typecheck→test
├── mcp/                       # MCP 서버 + 툰
│   ├── server.ts              # McpServer 래퍼 (stdio/SSE 트랜스포트)
│   ├── inbox.ts               # 메시지 인박스 (결과 수집)
│   └── tools/                 # 17개 MCP 툴 (도메인별 분리)
│       ├── session-tools.ts   # 세션 관리 (7)
│       ├── knowledge-tools.ts # 지식 관리 (2)
│       ├── dag-tools.ts       # DAG 병렬화 (2)
│       ├── branch-tools.ts    # Branch Hunt (3)
│       └── wiki-tools.ts      # LLM Wiki (3)
└── orchestrator/              # 실행 스킬
    ├── planner.ts             # 심층 인터뷰 플래너
    ├── dag-orchestrator.ts    # DAG 기반 구현 병렬화
    └── branch-hunt.ts         # DFS 기반 디버깅 병렬화
```

## MCP Tools (17개)

표준 MCP 프로토콜로 동작 — OpenCode / Claude Code / Cursor / Cotext / Windsurf 등 모든 MCP 클라이언트에서 사용 가능.

```bash
npx aio mcp-serve   # stdio (자동 연결)
npx aio serve       # SSE (포트 8910)
```

### 세션 관리 (7)

| 툴 | 설명 | 입력 |
|---|---|---|
| `spawn_session` | 독립 AI 세션 생성, 태스크 실행 | `task`, `sessionId?` |
| `check_inbox` | 자식 세션 완료 보고 확인 | – |
| `report_result` | 현재 세션 결과를 부모에게 보고 | `summary`, `status`, `payload?` |
| `send_message` | 실행 중인 세션에 추가 지시 | `sessionId`, `message` |
| `get_session` | 세션 상태/출력 조회 | `sessionId` |
| `close_session` | 완료된 세션 정리 | `sessionId` |
| `list_sessions` | 전체 세션 목록 | – |

### 지식 관리 (2)

| 툴 | 설명 | 입력 |
|---|---|---|
| `recall_knowledge` | FAISS 시맨틱 검색 | `query`, `topK?` |
| `store_knowledge` | Obsidian vault 저장 | `title`, `content`, `tags?` |

### DAG 병렬화 (2)

| 툴 | 설명 | 입력 |
|---|---|---|
| `plan_task` | 심층 플래닝 → 태스크 분해 | `goal` |
| `execute_dag` | DAG 생성 → 위상정렬 → Layer별 병렬 실행 | `goal`, `tasks` |

### Branch Hunt (3)

| 툴 | 설명 | 입력 |
|---|---|---|
| `scan_issues` | DFS 기반 이슈 스캔 + 분기 | `paths?`, `sessionId?` |
| `collect_results` | 분기 세션 결과 수집 | `sessionIds` |
| `get_branch_status` | Branch Hunt 상태 요약 | `sessionId` |

### LLM Wiki (3)

| 툴 | 설명 | 입력 |
|---|---|---|
| `ingest_source` | 원본 소스 → wiki 페이지 생성/갱신, 교차참조, index/log 업데이트 | `title`, `content`, `source?` |
| `query_wiki` | FAISS 시맨틱 검색 → 전체 페이지 내용 반환 | `query`, `topK?` |
| `lint_wiki` | 위키 상태 검사 (고아페이지, 인덱스 커버리지, 링크 현황) | – |

### OpenCode에서 수동 확인

```bash
opencode mcp list            # 연결된 MCP 서버 목록
opencode mcp debug aio       # aio MCP 디버깅
```

### Claude Code / Cursor / Cotext 설정

```json
{
  "mcpServers": {
    "aio": { "command": "npx", "args": ["aio", "mcp-serve"] }
  }
}
```

## Core concepts

1. **지식 축적** — Obsidian vault + 로컬 FAISS 임베딩 (`@xenova/transformers`, 외부 API 불필요)
2. **Task DAG** — 위상 정렬 기반 Layer별 병렬 실행, 의존성 자동 해결
3. **Ralph Loop** — 무인 자동 실행 → 검증 (`lint` → `typecheck` → `test`) → 재시도 (3회)
4. **Branch Hunt** — DFS 스캔 중 이슈 발견 시 독립 세션 분기, 부모 컨텍스트 보존
5. **Session Spawn** — 부모-자식 세션 컨텍스트 불공유, 독립 실행으로 오염 방지
6. **LLM Wiki** — `ingest_source` / `query_wiki` / `lint_wiki` 로 Karpathy 스타일 개인 위키 운영

## Key constraints

- 부모-자식 세션 간 컨텍스트 **불공유** — 독립 세션으로 컨텍스트 오염 방지
- `@xenova/transformers` + `faiss-node`는 첫 실행 시 모델 다운로드 필요 (느림)
- Obsidian vault는 GUI 없이 파일 기반으로 동작 (MCP로 읽기/쓰기)
- `.env` 파일로 설정 오버라이드 가능

## Docker

```bash
docker compose build && docker compose up
docker compose --profile setup run knowledge-indexer   # 1회: 지식 인덱싱
```

## OpenCode skills

- `.opencode/skills/dag-orchestrator/` — DAG 병렬화 스킬
- `.opencode/skills/branch-hunt/` — 디버깅 병렬화 스킬
- `opencode.json`에서 자동 로드

## Example

```bash
npx aio example
```

이렇게 실행하면:

1. 플래닝 (`DeepInterviewPlanner`)
2. DAG 분해 (5개 태스크, 3개 Layer)
3. DAG 오케스트레이션 (병렬 실행 + Ralph Loop)
4. 결과 요약