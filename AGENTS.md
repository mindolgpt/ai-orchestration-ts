# AGENTS.md — AI Orchestration System (TypeScript)

컬리 기술 블로그 "AI 에이전트 15개를 동시에 굴리는 법" 기반 병렬 AI 오케스트레이션 시스템 — TypeScript 리라이트.

## Quick start

```bash
cd /projects/ai-orchestration-ts
npm install
npm run build
npx aio init                     # vault + 임베딩 인덱스 초기화
npx aio mcp-serve                # stdio MCP 서버 (OpenCode/Claude Code)
npx aio serve                    # SSE MCP 서버 (포트 8910, Cursor/Cotext/Windsurf)
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

## MCP Tools (표준 프로토콜 — 모든 AI 도구 호환)

`aio` MCP 서버는 표준 MCP 프로토콜로 동작하여 **OpenCode / Claude Code / Cursor / Cotext / Windsurf** 등 모든 MCP 클라이언트에서 사용 가능.

**17개 툴 제공:**

| 카테고리 | 툴 | 설명 |
|---|---|---|
| **세션 관리** | `spawn_session` | 독립 AI 세션 생성하여 태스크 실행 |
| | `check_inbox` | 자식 세션 완료 보고 확인 |
| | `report_result` | 현재 세션 결과를 부모에게 보고 |
| | `send_message` | 실행 중인 세션에 추가 지시 |
| | `get_session` | 세션 상태/출력 조회 |
| | `close_session` | 완료된 세션 정리 |
| | `list_sessions` | 전체 세션 목록 |
| **지식 관리** | `recall_knowledge` | FAISS 시맨틱 검색 |
| | `store_knowledge` | Obsidian vault 저장 |
| **DAG 병렬화** | `plan_task` | 심층 플래닝 → 태스크 분해 |
| | `execute_dag` | DAG 생성 → 위상정렬 → Layer별 병렬 실행 |
| **Branch Hunt** | `scan_issues` | DFS 기반 이슈 스캔 + 분기 |
| | `collect_results` | 분기 세션 결과 수집 |
| | `get_branch_status` | Branch Hunt 상태 요약 |
| **LLM Wiki** | `ingest_source` | 원본 소스 → wiki 페이지 생성/갱신, 교차참조, index/log 업데이트 |
| | `query_wiki` | FAISS 시맨틱 검색 → 전체 페이지 내용 반환 |
| | `lint_wiki` | 위키 상태 검사 (고아페이지, 인덱스 커버리지, 링크 현황) |

수동 확인:
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
├── cli.ts                    # CLI 엔트리포인트 (aio)
├── knowledge/                # 지식 축적 시스템
│   ├── vault.ts              # Obsidian vault 관리
│   ├── embedder.ts           # 로컬 임베딩 (OpenAI / @xenova/transformers)
│   └── search.ts             # FAISS 시맨틱 검색
├── dag/                      # Task DAG 엔진
│   ├── types.ts              # TaskNode, DAG, 위상 정렬
│   └── engine.ts             # Layer별 병렬 실행기
├── ralph/                    # Ralph Loop
│   ├── loop.ts               # 자동 구현→검증→재시도
│   └── verifier.ts           # build→typecheck→test
├── mcp/                      # Session Spawn MCP
│   ├── server.ts             # 세션 스폰/관리 (stdio/SSE 트랜스포트)
│   └── inbox.ts              # 메시지 인박스 (결과 수집)
└── orchestrator/             # 실행 스킬
    ├── planner.ts            # 심층 인터뷰 플래너
    ├── dag-orchestrator.ts   # DAG 기반 구현 병렬화
    └── branch-hunt.ts        # DFS 기반 디버깅 병렬화
```

## Core concepts (from blog)

1. **지식 축적** — Obsidian vault + 로컬 FAISS 임베딩 (외부 API 불필요, 프라이빗 데이터 안전)
2. **Task DAG** — 위상 정렬 기반 Layer별 병렬 실행, 의존성 자동 해결
3. **Ralph Loop** — 무인 자동 실행, 검증 내장 (수정 2회마다), 3회 연속 실패 시 중단
4. **Branch Hunt** — DFS 스캔 중 이슈 발견 시 독립 세션 분기, 부모 컨텍스트 보존
5. **Session Spawn MCP** — `spawn_session` / `check_inbox` / `report_result` / `send_message` / `get_session` / `close_session`
6. **MCP 표준화** — 모든 기능이 MCP 프로토콜로 노출되어 OpenCode/Claude Code/Cursor/Cotext/Windsurf 등 모든 AI 도구에서 동일하게 사용 가능
7. **LLM Wiki** — `ingest_source` / `query_wiki` / `lint_wiki` 로 Karpathy 스타일 개인 위키 운영 (Obsidian vault + FAISS)

## Key constraints

- 부모-자식 세션 간 컨텍스트 **불공유** — 독립 세션으로 컨텍스트 오염 방지
- `@xenova/transformers` + `faiss-node`는 첫 실행 시 모델 다운로드 필요 (느림)
- Obsidian vault는 **열린 프로젝트의 `vault/`** 에 생성 (기본: `$AIO_PROJECT_ROOT/vault` 또는 `<cwd 프로젝트>/vault`)
- Cursor MCP 설정에 `"AIO_PROJECT_ROOT": "${workspaceFolder}"` 를 넣어야 home이 아닌 워크스페이스에 vault가 생김
- Obsidian vault는 GUI 없이 파일 기반으로 동작 (MCP로 읽기/쓰기)
- `.env` 파일로 설정 오버라이드 가능

## Docker

```bash
docker compose build && docker compose up
docker compose --profile setup run knowledge-indexer   # 1회: 지식 인덱싱
```

## Example

```bash
npx aio example
```

이렇게 실행하면:

1. 플래닝 (`DeepInterviewPlanner`)
2. DAG 분해 (5개 태스크, 3개 Layer)
3. DAG 오케스트레이션 (병렬 실행 + Ralph Loop)
4. 결과 요약

## LLM Wiki 사용 예시

```bash
npx aio mcp-serve
```

그러면 AI가 자동으로 MCP 툴 description의 워크플로를 읽고 다음처럼 동작합니다:

```
"이 PRD 문서를 위키에 저장해줘"
→ AI가 ingest_source description의 워크플로 확인
→ 개념별로 분할: ingest_source("쇼핑몰-개요", ...)
                  ingest_source("회원-시스템", ...)
                  ingest_source("주문-결제", ...)
→ 각 페이지 자동 생성 + 교차참조 + index/log 업데이트
```