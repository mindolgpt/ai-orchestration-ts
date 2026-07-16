# AGENTS.md (repo)

이 저장소 **코드**를 수정하는 에이전트용 지침입니다.  
엔드유저 MCP 설정·Wiki 사용법은 **[README.md](./README.md)** 참고.

## vault schema와의 구분

| 파일 | 위치 | 용도 |
|------|------|------|
| **이 파일** | repo 루트 `AGENTS.md` | aio-mcp **소스** 개발 규칙 |
| **Wiki schema** | `vault/AGENTS.md` | 지식 위키 **유지보수** 규율 (3계층) |

혼동하지 마세요. Wiki schema는 `aio init` 시 vault에 시드됩니다.

## 개발 시 지킬 것

- Node >= 20, 패키지 `@mindol1004/aio-mcp`, 버전은 package.json 따름
- Wiki: `raw/` 불변, `wiki/index.md` ≠ `wiki/log.md`, schema는 `vault/AGENTS.md`
- 핵심 코드: `src/knowledge/vault.ts`, `wiki-ops.ts`, `wiki-schema.ts`, `mcp/tools/wiki-tools.ts`
- `.env` 자동 로드 없음
- Docker / 없는 skills를 문서에 쓰지 말 것

## 검증

```bash
npm run build && npm test && npm run typecheck
```
