# @mindol1004/aio-mcp

병렬 AI 오케스트레이션 MCP 서버 (`aio`).  
세션 스폰, Task DAG, 지식/위키(RAG), Branch Hunt를 Cursor·Claude Code·OpenCode 등에서 사용할 수 있습니다.

**Node.js >= 20** · 현재 버전 **2.4.0**

## 설치 / 실행

```bash
npm install
npm run build

npx aio init                 # 3계층 vault (raw/wiki/schema) + 인덱스
npx aio bootstrap-harness    # 도메인 하네스 (AGENTS.md, rules, hooks, MCP 설정)
npx aio wiki-lint --fail     # wiki 구조 lint (CI)
npx aio mcp-serve            # stdio MCP (Cursor 등)
npx aio serve                # SSE MCP (기본 http://127.0.0.1:8910/sse)
npx aio recall "재고 예약"   # 시맨틱 검색
npx aio status               # 프로젝트/vault/인덱스 경로 확인
npx aio example              # DAG 파이프라인 데모
```

npm 배포본:

```bash
npx -y @mindol1004/aio-mcp mcp-serve
```

## AI 도구별 MCP 설정

표준 MCP(stdio / SSE)를 지원하는 클라이언트에서 모두 사용할 수 있습니다.  
공통으로 쓰는 실행 명령은 다음과 같습니다.

```text
npx -y @mindol1004/aio-mcp mcp-serve
```

vault를 **현재 프로젝트**에 두려면 `AIO_PROJECT_ROOT`(또는 `AIO_VAULT_PATH`)를 프로젝트 절대 경로로 넘기세요.  
Cursor만 `${workspaceFolder}` 변수를 자동 치환합니다. 다른 도구는 경로를 직접 적거나, 해당 도구의 cwd/프로젝트 루트 기능을 쓰세요.

---

### 1) Cursor

**설정 파일**

| 범위 | 경로 |
|------|------|
| 전역 | `~/.cursor/mcp.json` (Windows: `%USERPROFILE%\.cursor\mcp.json`) |
| 프로젝트 | `<project>/.cursor/mcp.json` |

```json
{
  "mcpServers": {
    "aio-mcp": {
      "command": "npx",
      "args": ["-y", "@mindol1004/aio-mcp", "mcp-serve"],
      "env": {
        "AIO_PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

Settings → MCP에서 서버 상태를 확인한 뒤, 변경 시 MCP를 재시작하세요.

---

### 2) Claude Code (Anthropic CLI)

**설정 파일**

| 범위 | 경로 |
|------|------|
| 사용자(전역) | `~/.claude.json` 의 `mcpServers` |
| 프로젝트 | 프로젝트 루트 `.mcp.json` |

CLI로 추가:

```bash
claude mcp add --scope user aio-mcp -- npx -y @mindol1004/aio-mcp mcp-serve
```

또는 `.mcp.json` (프로젝트):

```json
{
  "mcpServers": {
    "aio-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@mindol1004/aio-mcp", "mcp-serve"],
      "env": {
        "AIO_PROJECT_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

세션을 새로 연 뒤 `claude mcp list`로 연결을 확인하세요.  
(`~/.claude/mcp.json` 같은 경로는 사용되지 않습니다.)

---

### 3) Claude Desktop

**설정 파일**

| OS | 경로 |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "aio-mcp": {
      "command": "npx",
      "args": ["-y", "@mindol1004/aio-mcp", "mcp-serve"],
      "env": {
        "AIO_PROJECT_ROOT": "C:/Users/you/projects/my-app"
      }
    }
  }
}
```

저장 후 Claude Desktop을 완전히 종료했다가 다시 실행하세요.

---

### 4) OpenAI Codex / ChatGPT Codex (GPT 계열 CLI·IDE)

**설정 파일:** `~/.codex/config.toml` (또는 프로젝트 `.codex/config.toml`)

```toml
[mcp_servers.aio-mcp]
command = "npx"
args = ["-y", "@mindol1004/aio-mcp", "mcp-serve"]

[mcp_servers.aio-mcp.env]
AIO_PROJECT_ROOT = "C:/Users/you/projects/my-app"
```

CLI:

```bash
codex mcp add aio-mcp --env AIO_PROJECT_ROOT=C:/Users/you/projects/my-app -- npx -y @mindol1004/aio-mcp mcp-serve
codex mcp list
```

세션에서 `/mcp`로 도구 연결을 확인할 수 있습니다.  
ChatGPT 웹 UI 일반 채팅이 아니라 **Codex CLI / Codex IDE 확장** 기준입니다.

---

### 5) OpenCode

**설정 파일:** `opencode.json` (프로젝트) 또는 `~/.config/opencode/opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "aio-mcp": {
      "type": "local",
      "command": ["npx", "-y", "@mindol1004/aio-mcp", "mcp-serve"],
      "enabled": true,
      "environment": {
        "AIO_PROJECT_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

원격(SSE)으로 붙이려면 먼저 `npx aio serve`로 서버를 띄운 뒤:

```json
{
  "mcp": {
    "aio-mcp": {
      "type": "remote",
      "url": "http://127.0.0.1:8910/sse",
      "enabled": true
    }
  }
}
```

`opencode mcp list`로 상태를 확인하세요.

---

### 6) Windsurf (Codeium)

**설정 파일:** `~/.codeium/windsurf/mcp_config.json` (버전·OS에 따라 경로가 다를 수 있음)

Cursor와 유사한 `mcpServers` JSON:

```json
{
  "mcpServers": {
    "aio-mcp": {
      "command": "npx",
      "args": ["-y", "@mindol1004/aio-mcp", "mcp-serve"],
      "env": {
        "AIO_PROJECT_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

Windsurf를 재시작한 뒤 MCP/Tools 설정에서 서버가 켜졌는지 확인하세요.

---

### 7) Cline / Continue 등 VS Code 계열

도구마다 UI는 다르지만, 대개 **MCP 설정 JSON**에 아래 형태를 넣습니다.

```json
{
  "aio-mcp": {
    "command": "npx",
    "args": ["-y", "@mindol1004/aio-mcp", "mcp-serve"],
    "env": {
      "AIO_PROJECT_ROOT": "/absolute/path/to/your/project"
    }
  }
}
```

- **Cline:** VS Code 설정에서 MCP Servers 항목에 추가  
- **Continue:** `config.json` / MCP 섹션에 stdio 서버로 등록  

상세 UI는 각 확장 문서의 “MCP” 항목을 참고하세요.

---

### 공통 팁

1. **Node.js 20+** 와 `npx`가 PATH에 있어야 합니다.  
2. 설정 변경 후 해당 AI 도구(또는 MCP 서버)를 **재시작**하세요.  
3. vault 위치: `AIO_PROJECT_ROOT=<프로젝트절대경로>` → `<프로젝트>/vault`  
4. OpenAI 임베딩을 쓰려면 같은 `env`에 `EMBEDDING_PROVIDER=openai`, `OPENAI_API_KEY=...` 를 추가하세요.  
5. 방화벽/회사망에서 `npx` 다운로드가 막히면, 로컬 빌드 경로로 바꿔도 됩니다.

```json
"command": "node",
"args": ["/absolute/path/to/ai-orchestration-ts/dist/cli.js", "mcp-serve"]
```

## LLM Wiki — 3계층 · 3대 운영

Karpathy-style personal/team wiki. Schema가 있으면 에이전트는 generic chatbot이 아니라 **disciplined wiki maintainer**입니다.

### 3계층

```
vault/
  AGENTS.md     # schema — 운영 규율 (MR로 관리)
  raw/          # immutable 원본 (수정·삭제 금지)
  wiki/
    index.md    # content catalog (한 줄 요약)
    log.md      # append-only 타임라인
    *.md        # LLM 생성 페이지
  .index/       # FAISS + meta.json
```

| 계층 | 역할 |
|------|------|
| **raw/** | 원본. LLM은 읽기만. `ingest_raw`로만 추가 |
| **wiki/** | LLM 요약·엔티티·개념 페이지 |
| **AGENTS.md** | schema. ingest/query/lint 규율 |

### 3대 운영

| 운영 | 툴 | 동작 |
|------|-----|------|
| **Ingest** | `ingest_raw` → `ingest_source` → `update_wiki_page` | 원본 고정 → 개념 페이지 → 관련 페이지 횡단 갱신 + index/log |
| **Query** | `query_wiki` → (선택) `file_back` | 검색·인용 합성 → 좋은 답은 위키에 환류 |
| **Lint** | `lint_wiki` / `aio wiki-lint --fail` | 고아·index 커버리지·schema/raw. CI 연결 |

### 팀 도입

1. **schema** (`vault/AGENTS.md`) — 책임자 1명, MR로만 변경
2. **raw/** — git에 커밋해 공유 원장으로 사용
3. **lint CI** — `templates/wiki-lint.yml` 참고

```bash
npx aio wiki-lint --vault ./vault --fail
```

## Vault · 임베딩 · 검색 (RAG)

| 구분 | 경로 |
|------|------|
| Schema | `vault/AGENTS.md` |
| Raw | `vault/raw/*.md` |
| Wiki | `vault/wiki/*.md` |
| 벡터 | `vault/.index/index.faiss` |
| 메타 | `vault/.index/meta.json` |

기본 임베딩: `EMBEDDING_PROVIDER=local` (`Xenova/multilingual-e5-small`).  
OpenAI: `EMBEDDING_PROVIDER=openai` + `OPENAI_API_KEY`.

### 환경 변수

| 변수 | 기본 | 설명 |
|------|------|------|
| `AIO_PROJECT_ROOT` | cwd 프로젝트 탐지 | Cursor는 `${workspaceFolder}` |
| `AIO_VAULT_PATH` / `OBSIDIAN_VAULT_PATH` | `<project>/vault` | vault 직접 지정 |
| `EMBEDDING_PROVIDER` | `local` | `local` \| `openai` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI 모델 |
| `OPENAI_API_KEY` | – | openai 필수 |
| `LOCAL_EMBEDDING_MODEL` | `Xenova/multilingual-e5-small` | 로컬 모델 |

> `.env` 자동 로드 없음.

## CLI

| 명령 | 설명 |
|------|------|
| `aio init [--vault]` | 3계층 vault + schema + FAISS 시드 |
| `aio bootstrap-harness` | wiki → 도메인 하네스 (AGENTS.md, Cursor rules/hooks, Claude/OpenCode MCP) |
| `aio wiki-lint [--vault] [--fail]` | 구조 lint (CI용 `--fail`) |
| `aio mcp-serve` / `aio serve` | stdio / SSE MCP |
| `aio recall` / `aio status` / `aio example` | 검색·상태·데모 |

## MCP Tools

### Harness (5) — **도메인 컨텍스트 자동화**

`bootstrap_harness` · `bootstrap_domain` · `run_domain_loop` · `get_domain_profile` · `save_domain_profile`

wiki 지식 → 프로젝트 하네스 일괄 생성:

| 생성물 | 대상 |
|--------|------|
| `AGENTS.md` | 공통 (모든 에이전트) |
| `.cursor/rules/aio-domain-harness.mdc` | Cursor |
| `.cursor/hooks.json` + `hooks/aio-*.mjs` | Cursor (세션/프롬프트 시 wiki 컨텍스트 주입) |
| `.cursor/mcp.json` | Cursor MCP (merge) |
| `CLAUDE.md` + `.mcp.json` | Claude Code |
| `opencode.json` | OpenCode |
| `.codex/mcp.toml` | Codex CLI |
| `.aio/domain-profile.yaml` | 도메인 프로필 |
| `.aio/harness-context.json` | `bootstrap_domain` 캐시 (hook이 읽음) |

**시작 순서**

```bash
aio init
aio bootstrap-harness --domain ecommerce --backend spring-boot --frontend react
# MCP 재시작 후
# run_domain_loop({ task: "로그인 API 구현" })
```

### Wiki (7)

`get_wiki_schema` · `ingest_raw` · `ingest_source` · `update_wiki_page` · `query_wiki` · `file_back` · `lint_wiki`

### Session (8)

`spawn_session` · `check_inbox` · `report_result` · `send_message` · `get_session` · `close_session` · `list_sessions` · `synthesize_results`

- 자식은 격리 컨텍스트: 프롬프트에 `session_id` 주입, `AIO_SESSION_ID` env
- **런타임 어댑터**: `AIO_SESSION_RUNTIME=opencode|claude|cursor|codex|custom` (+ `AIO_SESSION_COMMAND` / `AIO_SESSION_ARGS`)
- `worktree: true` 시 `.aio/worktrees/<session>` git worktree 격리
- 종료/타임아웃 시 프로세스 kill (Windows `taskkill`)
- `maxSessions`는 **running** 세션만 카운트
- Inbox: `AIO_INBOX_BACKEND=file|memory|redis` (기본 file → `.aio/inbox/`)

### DAG (2)

`plan_task` · `execute_dag`

- `resume: true`로 체크포인트(`.aio/checkpoints/`)에서 재개
- dep 실패 시 종속 노드 **skip**, status `completed|partial|failed`
- 위험 프롬프트 시 `request_approval` / `resolve_approval` 게이트

### Ops (6)

`request_approval` · `resolve_approval` · `list_approvals` · `get_events` · `list_worktrees` · `remove_worktree`

### Branch Hunt (3)

`scan_issues` · `collect_results` · `get_branch_status`

- `rg` + `.gitignore` (없으면 walk), worktree 옵션

### Knowledge (2)

`store_knowledge` · `recall_knowledge`

### Ralph Loop (내부)

`AIO_VERIFY_STEPS=build,lint,test,custom` · `AIO_VERIFY_CUSTOM_CMD` · backoff + jitter

### 환경 변수 (오케스트레이션)

| 변수 | 설명 |
|------|------|
| `AIO_SESSION_RUNTIME` | 세션 런타임 |
| `AIO_SESSION_COMMAND` / `AIO_SESSION_ARGS` | 커스텀 spawn |
| `AIO_INBOX_BACKEND` / `AIO_INBOX_REDIS_URL` | inbox 백엔드 |
| `AIO_VERIFY_STEPS` | 검증 사다리 |
| `AIO_EVENTS=0` | 이벤트 로그 끄기 |

## 아키텍처

```
src/harness/          # profile, context-pack, bootstrap, loop, templates
src/mcp/tools/harness-tools.ts
src/mcp/session-runtime.ts · inbox.ts · tools/*
src/dag/engine.ts · checkpoint.ts
src/ralph/loop.ts · verifier.ts
src/orchestrator/branch-hunt.ts · approval.ts · worktree.ts
src/observability/events.ts
src/knowledge/vault.ts · wiki-*
```

## 개발

```bash
npm run build && npm test && npm run typecheck
```

## 참고

- 의미적 모순/stale은 schema에 따라 에이전트가 심층 lint. `lint_wiki`는 구조 검사.
- 패키지: `@mindol1004/aio-mcp` · bin: `aio`
