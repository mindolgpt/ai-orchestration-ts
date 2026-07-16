# @mindol1004/aio-mcp

병렬 AI 오케스트레이션 MCP 서버 (`aio`).  
세션 스폰, Task DAG, 지식/위키(RAG), Branch Hunt를 Cursor·Claude Code·OpenCode 등에서 사용할 수 있습니다.

**Node.js >= 20** · 현재 버전 **2.0.2**

## 설치 / 실행

```bash
npm install
npm run build

npx aio init                 # <프로젝트>/vault + 검색 인덱스 생성
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

## Vault · 임베딩 · 검색 (RAG)

에이전트가 위키 본문을 정리·저장하고, 로컬 임베딩 + FAISS로 **의미 검색**합니다. (간단한 RAG)

| 구분 | 경로 / 역할 |
|------|-------------|
| 원문 | `<project>/vault/**/*.md`, 위키는 `vault/wiki/` |
| 벡터 인덱스 | `vault/.index/index.faiss` (바이너리) |
| 문서 메타 | `vault/.index/meta.json` |

기본 임베딩은 **로컬**입니다 (`EMBEDDING_PROVIDER=local`).

- 모델: `Xenova/multilingual-e5-small` (`@xenova/transformers`)
- 첫 실행 시 Hugging Face에서 받아 **PC 캐시**에 두고 이후 로컬 실행
- OpenAI API로 보내려면 `EMBEDDING_PROVIDER=openai` + `OPENAI_API_KEY`

`query_wiki` / `recall_knowledge` 호출 시 질문도 같은 모델로 임베딩한 뒤 FAISS에서 유사 문서를 찾습니다.  
프롬프트만 친다고 자동 실행되는 것은 아니고, **에이전트가 해당 MCP 툴을 호출할 때** 돌아갑니다.

### 환경 변수

| 변수 | 기본 | 설명 |
|------|------|------|
| `AIO_PROJECT_ROOT` | cwd에서 프로젝트 탐지 | 열린 워크스페이스 루트. Cursor는 `${workspaceFolder}` 권장 |
| `AIO_VAULT_PATH` / `OBSIDIAN_VAULT_PATH` | `<project>/vault` | vault 경로 직접 지정 |
| `EMBEDDING_PROVIDER` | `local` | `local` \| `openai` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI일 때 모델명 |
| `OPENAI_API_KEY` | – | `openai`일 때 필수 |
| `LOCAL_EMBEDDING_MODEL` | `Xenova/multilingual-e5-small` | 로컬 임베딩 모델 |

CLI에서도 `--vault <path>` 로 vault를 지정할 수 있습니다.

mcp.json 예시 (OpenAI 임베딩):

```json
"env": {
  "AIO_PROJECT_ROOT": "${workspaceFolder}",
  "EMBEDDING_PROVIDER": "openai",
  "OPENAI_API_KEY": "sk-...",
  "EMBEDDING_MODEL": "text-embedding-3-small"
}
```

> `.env` 자동 로드는 지원하지 않습니다. MCP는 `mcp.json`의 `env`, CLI는 셸 환경 변수를 사용하세요.

## CLI

| 명령 | 설명 |
|------|------|
| `aio init [--vault]` | vault + FAISS 인덱스 초기화 |
| `aio mcp-serve [--vault] [--max-sessions]` | stdio MCP |
| `aio serve [--host] [--port] [--vault] [--max-sessions]` | SSE MCP |
| `aio recall <query> [--top-k] [--vault]` | 시맨틱 검색 |
| `aio status [--vault]` | 경로·문서 수 확인 |
| `aio example` | 플래닝 → DAG 병렬 실행 데모 |

## MCP Tools

### 세션 (7)

| 툴 | 설명 |
|----|------|
| `spawn_session` | 새 AI 세션에서 작업 실행 (`task`, `context?`) |
| `check_inbox` | 자식 세션 결과 폴링 |
| `report_result` | 부모에게 결과 보고 |
| `send_message` | 실행 중 세션에 추가 지시 |
| `get_session` | 세션 상태 조회 |
| `close_session` | 세션 정리 |
| `list_sessions` | 세션 목록 |

### 지식 (2)

| 툴 | 설명 |
|----|------|
| `store_knowledge` | vault에 노트 저장 + 임베딩 인덱싱 (`path`, `content`, `tags?`, `links?`) |
| `recall_knowledge` | 지식 베이스 시맨틱 검색 (`query`, `top_k?`) |

### Wiki (3)

| 툴 | 설명 |
|----|------|
| `ingest_source` | 개념 단위 위키 페이지 생성/갱신 (`title`, `content`, `tags?`, `source_path?`) |
| `query_wiki` | 위키 시맨틱 검색 + 본문 반환 (`query`, `top_k?`) |
| `lint_wiki` | 고아 페이지·인덱스 커버리지 점검 |

### DAG (2)

| 툴 | 설명 |
|----|------|
| `plan_task` | 작업을 서브태스크로 분해 (`title`, `description`, …) |
| `execute_dag` | 의존성 Layer별 병렬 실행 (`plan_id`, `tasks`) |

### Branch Hunt (3)

| 툴 | 설명 |
|----|------|
| `scan_issues` | 코드베이스 스캔 후 수정 세션 분기 |
| `collect_results` | 분기 결과 수집 |
| `get_branch_status` | 상태 요약 |

## 아키텍처

```
src/
├── cli.ts
├── knowledge/
│   ├── vault.ts      # 마크다운 vault I/O
│   ├── paths.ts      # 프로젝트/vault 경로 해석
│   ├── embedder.ts   # local(Xenova) / OpenAI
│   ├── faiss.ts      # faiss-node ESM interop + mock fallback
│   └── search.ts     # FAISS 시맨틱 검색
├── dag/              # Task DAG
├── ralph/            # 구현→검증→재시도 루프
├── mcp/              # MCP 서버 (stdio / SSE) + tools/
└── orchestrator/     # planner, DAG 실행, branch-hunt
```

핵심 동작:

1. **Vault** — Obsidian 호환 마크다운 (GUI 불필요)
2. **임베딩 + FAISS** — 저장/검색용 벡터 인덱스 (기본 로컬)
3. **Session spawn** — 부모·자식 컨텍스트 불공유
4. **DAG** — 위상 정렬 후 Layer 단위 병렬 실행
5. **Ralph Loop** — 구현 후 검증·재시도
6. **Branch Hunt** — 이슈 발견 시 독립 세션 분기

## 개발

```bash
npm run build
npm run typecheck
npm test
npm run lint
```

## 참고

- 로컬 임베딩·`faiss-node`는 첫 실행이 느릴 수 있습니다.
- 외부 벡터 DB(Qdrant, pgvector 등)는 현재 미연동입니다. 인덱스는 로컬 `vault/.index`입니다.
- 패키지명: `@mindol1004/aio-mcp` · bin: `aio`
