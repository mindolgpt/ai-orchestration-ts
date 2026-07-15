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
├── cli.ts                    # CLI 엔트리포인트 (aio)
├── knowledge/                # 지식 축적 시스템
│   ├── vault.ts              # Obsidian vault 관리
│   ├── embedder.ts           # 로컬 임베딩 (sentence-transformers)
│   └── search.ts             # FAISS 시맨틱 검색
├── dag/                      # Task DAG 엔진
│   ├── types.ts              # TaskNode, DAG, 위상 정렬
│   └── engine.ts             # Layer별 병렬 실행기
├── ralph/                    # Ralph Loop
│   ├── loop.ts               # 자동 구현→검증→재시도
│   └── verifier.ts           # build→typecheck→test
├── mcp/                      # Session Spawn MCP
│   ├── server.ts             # 세션 스폰/관리
│   ├── inbox.ts              # 메시지 인박스 (결과 수집)
│   └── mcp-stdio.ts          # stdio MCP 서버
└── orchestrator/             # 실행 스킬
    ├── planner.ts            # 심층 인터뷰 플래너
    ├── dag_orchestrator.ts   # DAG 기반 구현 병렬화
    └── branch_hunt.ts        # DFS 기반 디버깅 병렬화
```

## Core concepts (from blog)

1. **지식 축적** — Obsidian vault + 로컬 FAISS 임베딩 (외부 API 불필요, 프라이빗 데이터 안전)
2. **Task DAG** — 위상 정렬 기반 Layer별 병렬 실행, 의존성 자동 해결
3. **Ralph Loop** — 무인 자동 실행, 검증 내장 (수정 2회마다), 3회 연속 실패 시 중단
4. **Branch Hunt** — DFS 스캔 중 이슈 발견 시 독립 세션 분기, 부모 컨텍스트 보존
5. **Session Spawn MCP** — `spawn_session` / `check_inbox` / `report_result` / `send_message` / `get_session` / `close_session`

## Key constraints

- 부모-자식 세션 간 컨텍스트 **불공유** — 독립 세션으로 컨텍스트 오염 방지
- `sentence-transformers` + `faiss-node`는 첫 실행 시 모델 다운로드 필요 (느림)
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