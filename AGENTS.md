# AGENTS.md

이 저장소에서 코딩 에이전트(Cursor, Claude Code, Codex, OpenCode 등)가 참고하는 **개발용 지침**입니다.  
엔드유저용 설치·도구별 MCP 설정은 **[README.md](./README.md)** 를 보세요.

## 이 파일이 뭔가

| | README.md | AGENTS.md |
|--|-----------|-----------|
| 대상 | 패키지 사용자 | 이 repo를 수정하는 AI/개발자 |
| npm 배포 | 포함됨 (`files`) | **포함 안 됨** |
| 필수 여부 | 패키지 문서 | **선택** (없어도 `aio-mcp`는 동작함) |

에이전트가 이 프로젝토리에서 작업할 때 관습적으로 읽습니다. 없어도 빌드/배포/실행에는 영향 없습니다.

## 작업 시 지킬 것

- Node **>= 20**, 패키지명 `@mindol1004/aio-mcp`, CLI bin은 `aio`
- vault 기본 경로: `<AIO_PROJECT_ROOT>/vault` (없으면 cwd에서 프로젝트 탐지)
- 임베딩 기본: `EMBEDDING_PROVIDER=local` (`Xenova/multilingual-e5-small`)
- `.env` **자동 로드 없음** — MCP는 클라이언트 `env`, CLI는 셸 환경 변수
- Docker / `.opencode/skills` 는 이 repo에 **없음** — 문서에 넣지 말 것
- `faiss-node`는 ESM에서 `default.IndexFlatIP` 로 노출될 수 있음 → `src/knowledge/faiss.ts`의 interop 유지
- Windows에서 vault 상대 경로는 POSIX(`wiki/foo.md`)로 정규화 (`toPosixPath`)

## 자주 건드리는 경로

```
src/knowledge/   vault, paths, embedder, faiss, search
src/mcp/         server + tools/*
src/cli.ts       init / mcp-serve / serve / recall / status
```

## 검증

```bash
npm run build
npm run typecheck
npm test
npm run lint
```

## 사용자 문서

도구별 MCP 설정(Cursor / Claude Code / Claude Desktop / Codex / OpenCode / Windsurf / Cline 등), vault·RAG·환경 변수는 **README.md** 한곳만 유지하세요. 여기와 중복으로 길게 쓰지 마세요.
