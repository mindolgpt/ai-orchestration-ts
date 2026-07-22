# @mindol1004/aio-mcp

Parallel AI orchestration MCP server (`aio`).  
**Node.js >= 20**

→ Spawn AI sessions · run Task DAGs · maintain a knowledge wiki (RAG) · Branch Hunt  
→ Works with Cursor, Claude Code, OpenCode, Windsurf, Cline, Codex, and any MCP client

```bash
npx -y @mindol1004/aio-mcp init          # create vault + search index
npx -y @mindol1004/aio-mcp mcp-serve     # start MCP server (stdio)
```

## Quick start (5 minutes)

| #   | Command                                                           | What it does                   |
| --- | ----------------------------------------------------------------- | ------------------------------ |
| 1   | `npx -y @mindol1004/aio-mcp init`                                 | Create `vault/` + search index |
| 2   | Connect MCP (see [setup by tool](#mcp-setup-by-ai-tool)) + reload |
| 3   | `aio doctor`                                                      | Diagnose install, paths, vault |
| 4   | `npx -y @mindol1004/aio-mcp mcp-serve`                            | Start MCP server               |
| 5   | In chat: "ingest this README" or "wiki lint"                      | Test the pipeline              |

## Features

| Area                 | What it does                                                                | Key tools                                                 |
| -------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Wiki (RAG)**       | Karpathy-style 3-layer wiki: raw → wiki → schema. FAISS or remote vector DB | `ingest_pipeline`, `query_wiki`, `lint_wiki`, `file_back` |
| **Sessions**         | Spawn isolated AI sessions for parallel research/coding                     | `spawn_session`, `check_inbox`, `synthesize_results`      |
| **DAG**              | Auto-plan goals into task graphs, execute layers in parallel                | `plan_task`, `execute_dag`                                |
| **Branch Hunt**      | DFS scan for issues → independent fix sessions per issue                    | `scan_issues`, `collect_results`                          |
| **Brainstorm**       | Multi-turn product design with wiki-backed option comparison                | `brainstorm_design`                                       |
| **Domain context**   | Project-aware context packing from wiki → harness → agent                   | `domain_context`, `bootstrap_harness`                     |
| **Ingest pipeline**  | Drop files → auto-ingest (raw → wiki pages → lint)                          | `ingest_pipeline`, `scan_raw_inbox`, `aio watch`          |
| **Wiki MR**          | Propose → review → apply/reject wiki changes (diff-based)                   | `propose_wiki_change`, `apply_wiki_proposal`              |
| **Natural language** | 50 keyword-routed tools, KO/EN support, auto-plan on `execute_dag`          | `aio_prompt`                                              |

## Latest changes

| Change                                 | Detail                                                          |
| -------------------------------------- | --------------------------------------------------------------- |
| `query_wiki`                           | Default `response_mode: snippets` (use `full` only when needed) |
| `domain_context`                       | Unified tool replacing `bootstrap_domain`/`run_domain_loop`     |
| `AIO_MCP_TOOL_SET`                     | `core` \| `wiki` \| `full` — reduce MCP schema noise            |
| `recall_knowledge` / `store_knowledge` | Deprecated — use `query_wiki` / `ingest_pipeline`               |
| `aio_prompt`                           | `execute` defaults to `true`; dry-run adds `workflow_step`      |
| Tool errors                            | Unified `{ ok, error, hint, fix }` on wiki ingest failures      |
| FAISS fix                              | `aio reindex` recovers empty index (Float32Array → number[])    |

**One-shot health check:** `aio doctor` covers Node, `AIO_PROJECT_ROOT`, vault, wiki count, index, harness files, **active AI tool detection**, alerts for **unused tool files**, MCP config, git, rg, session runtime, and embeddings.

```bash
aio doctor          # human-readable report
aio doctor --json   # CI / scripts
aio doctor --fail   # exit 1 if any check fails
```

From MCP: `run_doctor` or `aio_prompt({ message: "run doctor", execute: true })`.

## Install / run

```bash
# Published package (no install needed)
npx -y @mindol1004/aio-mcp init
npx -y @mindol1004/aio-mcp mcp-serve
npx -y @mindol1004/aio-mcp serve          # SSE (http://127.0.0.1:8910/sse)
npx -y @mindol1004/aio-mcp doctor
npx -y @mindol1004/aio-mcp recall "query"
npx -y @mindol1004/aio-mcp dashboard      # http://127.0.0.1:8920

# Global install for shorter commands
npm i -g @mindol1004/aio-mcp
aio init && aio bootstrap-harness
aio mcp-serve
```

## MCP setup by AI tool

Any client that supports standard MCP (stdio / SSE) can use aio-mcp.  
Common launch command:

```text
npx -y @mindol1004/aio-mcp mcp-serve
```

To keep the vault **inside the current project**, set `AIO_PROJECT_ROOT` (or `AIO_VAULT_PATH`) to the project absolute path.  
Only Cursor auto-expands `${workspaceFolder}`. Other tools need an explicit path or their own project-root substitution.

---

### 1) Cursor

| Scope   | Path                                                             |
| ------- | ---------------------------------------------------------------- |
| Global  | `~/.cursor/mcp.json` (Windows: `%USERPROFILE%\.cursor\mcp.json`) |
| Project | `<project>/.cursor/mcp.json`                                     |

```json
{
  "mcpServers": {
    "aio-mcp": {
      "command": "npx",
      "args": ["-y", "@mindol1004/aio-mcp", "mcp-serve"],
      "env": {
        "AIO_PROJECT_ROOT": "${workspaceFolder}",
        "AIO_MCP_TOOL_SET": "core"
      }
    }
  }
}
```

Confirm the server under Settings → MCP, then restart MCP after config changes.

---

### 2) Claude Code (Anthropic CLI)

| Scope         | Path                             |
| ------------- | -------------------------------- |
| User (global) | `mcpServers` in `~/.claude.json` |
| Project       | `.mcp.json` at project root      |

```bash
claude mcp add --scope user aio-mcp -- npx -y @mindol1004/aio-mcp mcp-serve
```

Or project `.mcp.json`:

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

Open a new session and verify with `claude mcp list`.  
(Paths like `~/.claude/mcp.json` are **not** used.)

---

### 3) Claude Desktop

| OS      | Path                                                              |
| ------- | ----------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json`                     |

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

Fully quit and relaunch Claude Desktop after saving.

---

### 4) OpenAI Codex / ChatGPT Codex (CLI · IDE)

**Manual config:** `~/.codex/config.toml` (or project `.codex/config.toml`)

```toml
[mcp_servers.aio-mcp]
command = "npx"
args = ["-y", "@mindol1004/aio-mcp", "mcp-serve"]

[mcp_servers.aio-mcp.env]
AIO_PROJECT_ROOT = "C:/Users/you/projects/my-app"
```

```bash
codex mcp add aio-mcp --env AIO_PROJECT_ROOT=C:/Users/you/projects/my-app -- npx -y @mindol1004/aio-mcp mcp-serve
codex mcp list
```

Use `/mcp` in a session to confirm tools.  
This is for **Codex CLI / Codex IDE**, not the generic ChatGPT web chat.

`bootstrap_harness` may also emit `.codex/mcp.toml` — that is harness output, separate from the manual `config.toml` above.

---

### 5) OpenCode

**Config:** `opencode.json` (project) or `~/.config/opencode/opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "aio-mcp": {
      "type": "local",
      "command": ["npx", "-y", "@mindol1004/aio-mcp", "mcp-serve"],
      "enabled": true,
      "environment": {
        "AIO_PROJECT_ROOT": "/absolute/path/to/your/project",
        "AIO_MCP_TOOL_SET": "core"
      }
    }
  }
}
```

For remote SSE, run `npx aio serve` first:

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

Check with `opencode mcp list`. Non-localhost binds require `AIO_SSE_TOKEN` (see [Security](#security--hardening)).

---

### 6) Windsurf (Codeium)

**Config:** `~/.codeium/windsurf/mcp_config.json` (path may vary by OS/version)

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

Restart Windsurf and confirm the server under MCP/Tools.

---

### 7) Cline / Continue (VS Code family)

UI differs by extension; typically register a stdio MCP server:

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

- **Cline:** add under MCP Servers in VS Code settings
- **Continue:** register as a stdio server in `config.json` / MCP section

See each extension’s “MCP” docs for the exact UI.

---

### Shared tips

1. **Node.js 20+** and `npx` must be on `PATH`.
2. After config changes, **restart** the AI tool (or MCP server).
3. Vault location: `AIO_PROJECT_ROOT=<absolute project path>` → `<project>/vault`.
4. For OpenAI embeddings, add `EMBEDDING_PROVIDER=openai` and `OPENAI_API_KEY=...` to the same `env`.
5. For a remote vector DB, add `VECTOR_STORE` + store URL/key to the same MCP `env` (see [Vector store](#vector-store)).
6. If corporate networks block `npx` downloads, point at a local build:

```json
"command": "node",
"args": ["/absolute/path/to/ai-orchestration-ts/dist/cli.js", "mcp-serve"]
```

## LLM Wiki — three layers · three operations

Karpathy-style personal/team wiki. With a schema, the agent acts as a **disciplined wiki maintainer**, not a generic chatbot.

### Three layers

```
vault/
  AGENTS.md       # schema — operating rules (change via MR)
  raw/            # immutable sources (no edit/delete)
  raw-inbox/      # drop zone → scan/watch ingest (processed/ · failed/)
  wiki/
    index.md      # content catalog (one-line summaries)
    log.md        # append-only timeline
    *.md          # LLM-generated pages
  .index/         # local FAISS only (skipped when VECTOR_STORE is remote)
```

| Layer         | Role                                                                           |
| ------------- | ------------------------------------------------------------------------------ |
| **raw/**      | Sources. LLM read-only. Add via `ingest_pipeline` (or deprecated `ingest_raw`) |
| **wiki/**     | Summaries, entities, concept pages                                             |
| **AGENTS.md** | Schema: ingest / query / lint rules                                            |

### Three operations

| Op         | Tools                                                                                                                  | Behavior                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Ingest** | **`ingest_pipeline`** (preferred). Legacy: `ingest_raw` → `ingest_source` / `ingest_source_batch` (deprecated aliases) | raw → wiki page(s) → lint. CLI: `aio ingest --file` |
| **Query**  | **`query_wiki`** (preferred snippets). Deprecated: `recall_knowledge`                                                  | Search + cite → optional `file_back`                |
| **Lint**   | `lint_wiki` / `aio wiki-lint --fail`                                                                                   | Orphans, index coverage, schema/raw. Wire into CI   |

**Wiki MR:** `propose_wiki_change` → review → `apply_wiki_proposal` / `reject_wiki_proposal` (`wiki_diff`, `list_wiki_proposals`).

### Team rollout

1. **schema** (`vault/AGENTS.md`) — one owner; change via MR only
2. **raw/** — commit to git as the shared ledger
3. **lint CI** — see [`templates/wiki-lint.yml`](./templates/wiki-lint.yml) (also `doctor-fail.yml`, `harness-check.yml`)

```bash
npx aio wiki-lint --vault ./vault --fail
```

## Vault · embeddings · search (RAG)

| Kind             | Path / backend                                                     |
| ---------------- | ------------------------------------------------------------------ |
| Schema           | `vault/AGENTS.md`                                                  |
| Raw              | `vault/raw/*.md`                                                   |
| Wiki             | `vault/wiki/*.md`                                                  |
| Vectors (local)  | `vault/.index/index.faiss` + `meta.json` when `VECTOR_STORE=faiss` |
| Vectors (remote) | Qdrant / Chroma / Pinecone / Weaviate / pgvector via env           |

### Embeddings

Default: `EMBEDDING_PROVIDER=local` (`Xenova/multilingual-e5-small`, offline after first download).  
OpenAI: `EMBEDDING_PROVIDER=openai` + `OPENAI_API_KEY` (+ optional `EMBEDDING_MODEL`).

Embedding provider and vector store are **independent** — e.g. local embeddings + Qdrant is fine.

### Vector store

Default is **local FAISS** under `vault/.index/` (no extra services).  
Set `VECTOR_STORE` (alias `AIO_VECTOR_STORE`) to use a remote DB. Ingest, `recall`, and `query_wiki` use the same store automatically.

| `VECTOR_STORE`    | Required env                                        | Optional                                                                   | Notes                                          |
| ----------------- | --------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| `faiss` (default) | —                                                   | —                                                                          | Fully offline; files in `vault/.index/`        |
| `qdrant`          | `QDRANT_URL`                                        | `QDRANT_API_KEY`, `QDRANT_COLLECTION`                                      | REST                                           |
| `chroma`          | `CHROMA_URL`                                        | `CHROMA_API_KEY`, `CHROMA_API=v1\|v2`, `CHROMA_COLLECTION`                 | REST (v2 then v1 fallback)                     |
| `pinecone`        | `PINECONE_API_KEY`, `PINECONE_INDEX`                | `PINECONE_HOST`, `PINECONE_NAMESPACE`, `PINECONE_CLOUD`, `PINECONE_REGION` | Creates serverless index if missing            |
| `weaviate`        | `WEAVIATE_URL`                                      | `WEAVIATE_API_KEY`, `WEAVIATE_CLASS`                                       | Class name must be GraphQL-safe                |
| `pgvector`        | `DATABASE_URL` (or `PGVECTOR_URL` / `POSTGRES_URL`) | `PGVECTOR_TABLE`                                                           | Needs `pg` package + `CREATE EXTENSION vector` |

```bash
# Local (default) — omit VECTOR_STORE or:
VECTOR_STORE=faiss

# Qdrant
VECTOR_STORE=qdrant
QDRANT_URL=http://127.0.0.1:6333

# Chroma
VECTOR_STORE=chroma
CHROMA_URL=http://127.0.0.1:8000

# Pinecone
VECTOR_STORE=pinecone
PINECONE_API_KEY=...
PINECONE_INDEX=aio-vault

# Weaviate
VECTOR_STORE=weaviate
WEAVIATE_URL=http://127.0.0.1:8080

# PostgreSQL + pgvector
VECTOR_STORE=pgvector
DATABASE_URL=postgres://user:pass@127.0.0.1:5432/aio
```

**Naming:** collection / index / class / table defaults to `aio_<vault>`. Override with `VECTOR_COLLECTION` or `VECTOR_COLLECTION_PREFIX`, or store-specific vars (`QDRANT_COLLECTION`, `CHROMA_COLLECTION`, `PINECONE_INDEX`, `WEAVIATE_CLASS`, `PGVECTOR_TABLE`).

**Cursor MCP example** (remote Qdrant):

```json
{
  "mcpServers": {
    "aio-mcp": {
      "command": "npx",
      "args": ["-y", "@mindol1004/aio-mcp", "mcp-serve"],
      "env": {
        "AIO_PROJECT_ROOT": "${workspaceFolder}",
        "VECTOR_STORE": "qdrant",
        "QDRANT_URL": "http://127.0.0.1:6333"
      }
    }
  }
}
```

**Notes**

- Restart MCP/CLI after changing `VECTOR_STORE` or related env.
- Keep embedding dimension consistent with an existing remote collection/index (changing `EMBEDDING_PROVIDER` / model may require a new collection or re-ingest).
- `aio doctor` and `aio status` report the active vector store.
- Vector store connects **lazily** — first `search()` / `addDocument()` triggers connection; no startup delay for idle sessions.
- See [`.env.example`](./.env.example) for the full list.

> `.env` is **not** auto-loaded. Export vars in the shell or MCP `env`.

## CLI

| Command                                                  | Description                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| `aio init [--vault]`                                     | Seed 3-layer vault + schema + local search index               |
| `aio bootstrap-harness`                                  | Wiki → domain harness (AGENTS.md, rules/hooks, MCP configs)    |
| `aio seed-stacks`                                        | Seed stack playbooks under `vault/wiki/stacks/` (37 stacks)    |
| `aio design-architecture`                                | Wiki + stack architecture → `docs/architecture.md`             |
| `aio ingest --file <path>`                               | One-shot ingest pipeline                                       |
| `aio reindex`                                            | Rebuild FAISS index from existing wiki notes                   |
| `aio aio-prompt "<msg>"`                                 | Natural-language routing (`--execute` to run)                  |
| `aio doctor [--json] [--fail]`                           | Onboarding / health diagnostics                                |
| `aio watch-raw` / `aio scan-inbox`                       | Watch or scan `raw-inbox/`                                     |
| `aio vault list` / `aio vault register`                  | Multi-vault registry (`vault-list` / `vault-register` aliases) |
| `aio dashboard`                                          | Coverage / proposals / inbox / events UI                       |
| `aio wiki-lint [--fail]`                                 | Wiki structure lint                                            |
| `aio approval list` / `aio approval resolve`             | Human-in-the-loop approval (CLI resolve is trusted)            |
| `aio mcp-serve` / `aio serve`                            | stdio / SSE MCP                                                |
| `aio recall` / `aio status` / `aio docs` / `aio example` | Search, paths, usage guide, demo                               |

## MCP tools (53)

| Category        | Count | Tools                                                                                                                                                                                                                                                                                   |
| --------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Harness**     | 13    | `aio_prompt`, `list_tool_keywords`, `bootstrap_harness`, `seed_stack_playbooks`, `design_architecture`, `brainstorm_design`, **`domain_context`**, `bootstrap_domain`†, `run_domain_loop`†, `get_domain_profile`, `save_domain_profile`, `list_stack_playbooks`, `generate_usage_guide` |
| **Wiki**        | 14    | `get_wiki_schema`, `ingest_pipeline`, `ingest_raw`†, `ingest_source`†, `ingest_source_batch`†, `update_wiki_page`, `query_wiki`, `file_back`, `lint_wiki`, `propose_wiki_change`, `list_wiki_proposals`, `apply_wiki_proposal`, `reject_wiki_proposal`, `wiki_diff`                     |
| **Vault**       | 4     | `list_vaults`, `register_vault`, `scan_raw_inbox`, `get_dashboard_stats`                                                                                                                                                                                                                |
| **Session**     | 8     | `spawn_session`, `check_inbox`, `report_result`, `send_message`, `get_session`, `close_session`, `list_sessions`, `synthesize_results`                                                                                                                                                  |
| **DAG**         | 2     | `plan_task`, `execute_dag`                                                                                                                                                                                                                                                              |
| **Ops**         | 7     | `request_approval`, `resolve_approval`, `list_approvals`, `get_events`, `list_worktrees`, `remove_worktree`, `run_doctor`                                                                                                                                                               |
| **Branch Hunt** | 3     | `scan_issues`, `collect_results`, `get_branch_status`                                                                                                                                                                                                                                   |
| **Knowledge**   | 2     | `recall_knowledge`†, `store_knowledge`†                                                                                                                                                                                                                                                 |

† **Deprecated** — responses include `deprecated: true` and `use_instead`. Prefer the replacements in [Agent token guide](#agent-token-guide).

**Tier exposure:** `AIO_MCP_TOOL_SET=core` registers 17 core tools; `wiki` adds wiki/MR/vault extras; `full` (default) registers all 53.

### MCP resources

Prefer reading these over repeated tool calls (lower tokens):

| URI                       | Content                       |
| ------------------------- | ----------------------------- |
| `aio://wiki/schema`       | Full `vault/AGENTS.md`        |
| `aio://wiki/stacks/index` | Stack playbook ID list (JSON) |

### Deprecated tool map

| Legacy                                               | Use instead                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `recall_knowledge`                                   | `query_wiki` (default snippets)                             |
| `store_knowledge`                                    | `ingest_pipeline` or `file_back`                            |
| `ingest_raw`, `ingest_source`, `ingest_source_batch` | `ingest_pipeline`                                           |
| `bootstrap_domain`, `run_domain_loop`                | `domain_context` (`include_plan: true` for full loop brief) |

### Keyword routing (`aio_prompt`)

**50** tools are keyword-routable (everything except `aio_prompt` / `list_tool_keywords`). Matching uses scored Korean **and** English keywords/patterns (articles like “the/a/my” are allowed). Unrelated text returns `unknown` — it does not fall through to brainstorm.

Dry-run responses (`execute: false`) include **`workflow_step`**. By default **`execute` is `true`** — natural-language requests run immediately.

`execute_dag` via `aio_prompt` **auto-plans** when `tasks[]` is omitted (creates default criteria tasks and runs the DAG). Ingest accepts filenames in text (`ingest README.md`). Messages mentioning a tool id (e.g. `query_wiki`) route even without keyword hits.

Wiki / ingest failures from MCP tools return a unified shape: `{ "ok": false, "error": "...", "hint": "...", "fix": "..." }`.

| Example (KO / EN)                  | Tool                  |
| ---------------------------------- | --------------------- |
| wiki 검색 / search the wiki        | `query_wiki`          |
| 도메인 컨텍스트 / domain context   | `domain_context`      |
| wiki lint / lint the wiki          | `lint_wiki`           |
| 하네스 / bootstrap harness         | `bootstrap_harness`   |
| 아키텍처 / design the architecture | `design_architecture` |
| 세션 띄 / spawn a session          | `spawn_session`       |
| 인박스 / check my inbox            | `check_inbox`         |
| 작업 계획 / plan task              | `plan_task`           |
| TODO 스캔 / scan for TODOs         | `scan_issues`         |
| 브레인스토밍 / help me design      | `brainstorm_design`   |

```json
aio_prompt({ "message": "search the wiki for cart", "execute": true })
```

Full registry: `list_tool_keywords`.

**`brainstorm_design`** covers the full product lifecycle — planning, UX, visual design, domain, architecture, DB, algorithms, security, testing, DevOps, docs — with wiki-backed option comparison.

**Session flow:** first call returns `status: "questions"` (wiki context included). Collect answers one at a time, then re-call with the **same `topic`** and merged `answers` (`phase` + `scale` required for `status: "brief"`). Bare follow-ups like `design` / `mvp` are parsed when routed explicitly; do not treat them as a new topic.

**Stack playbooks** (`vault/wiki/stacks/`): 37 stacks (React, Next.js, Vue, Spring Boot, FastAPI, Go, Rust, …). List via `list_stack_playbooks`.

Wiki knowledge → project harness in one shot:

| Artifact                                 | Target                                   |
| ---------------------------------------- | ---------------------------------------- |
| `AGENTS.md`                              | Shared (all agents)                      |
| `.cursor/rules/aio-domain-harness.mdc`   | Cursor                                   |
| `.cursor/hooks.json` + `hooks/aio-*.mjs` | Cursor (inject wiki context)             |
| `.cursor/mcp.json`                       | Cursor MCP (merge)                       |
| `CLAUDE.md` + `.mcp.json`                | Claude Code                              |
| `opencode.json`                          | OpenCode                                 |
| `.codex/mcp.toml`                        | Codex CLI (harness output)               |
| `.aio/domain-profile.yaml`               | Domain profile                           |
| `.aio/harness-context.json`              | `domain_context` cache (hooks read this) |

```bash
aio init
aio seed-stacks
aio bootstrap-harness --domain ecommerce --backend spring-boot --frontend react
# Restart MCP, then in chat:
#   "bootstrap harness" / "design architecture"  (aio_prompt)
#   domain_context({ task: "implement login API", format: "path" })
```

### Session notes

- Children get an isolated context: `session_id` in the prompt, `AIO_SESSION_ID` in env
- Runtime adapter: `AIO_SESSION_RUNTIME=opencode|claude|cursor|codex|custom` (+ `AIO_SESSION_COMMAND` / `AIO_SESSION_ARGS`)
- `worktree: true` → git worktree under `.aio/worktrees/<session>`
- Kill on close/timeout (Windows: `taskkill`)
- `maxSessions` counts **running** sessions only
- Inbox: `AIO_INBOX_BACKEND=file|memory|redis` (default `file` → `.aio/inbox/`)
- `report_result` requires the session secret unless `AIO_ALLOW_REPORT_WITHOUT_SECRET=1`

### DAG notes

- `resume: true` resumes from `.aio/checkpoints/`
- Failed deps **skip** dependents; status `completed|partial|failed`
- Risky prompts go through `request_approval` / `resolve_approval`
- Prefer CLI `aio approval resolve` for trusted human resolve; MCP resolve needs `confirm_code` (or `AIO_ALLOW_MCP_APPROVAL_RESOLVE=1`)

### Ralph Loop (retry + verify engine)

Each `execute_dag` node runs through Ralph: **implement** (spawn AI session) → **verify** (build/lint/test) → retry on failure.

| Feature        | Detail                                                                         |
| -------------- | ------------------------------------------------------------------------------ |
| Max retries    | `ralph_max_retries` param (default 3) on `execute_dag`                         |
| Backoff        | Exponential + jitter (`baseBackoffMs=500`, doubles up to 8s)                   |
| Verify steps   | `AIO_VERIFY_STEPS=build,lint,test,custom` sequential ladder                    |
| Custom command | `AIO_VERIFY_CUSTOM_CMD` + `AIO_VERIFY_CUSTOM_ARGS` (JSON array)                |
| Progress       | Events emitted to event log (`ralph.progress`)                                 |
| Disable        | `ralph_max_retries: 0` + `ralph_verify: false`                                 |
| Integration    | `DAGOrchestrator` wraps each DAG node in Ralph; used by `execute_dag` MCP tool |

## Environment variables

### Project / vault / embeddings

| Variable                                                                       | Default                        | Description                                                               |
| ------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------- |
| `AIO_PROJECT_ROOT`                                                             | cwd project detection          | Cursor: `${workspaceFolder}`                                              |
| `AIO_VAULT_PATH` / `OBSIDIAN_VAULT_PATH`                                       | `<project>/vault`              | Explicit vault path                                                       |
| `AIO_VAULT_NAME`                                                               | registry default               | Multi-vault name (set at process start)                                   |
| `EMBEDDING_PROVIDER`                                                           | `local`                        | `local` \| `openai`                                                       |
| `EMBEDDING_MODEL`                                                              | `text-embedding-3-small`       | OpenAI model                                                              |
| `OPENAI_API_KEY`                                                               | –                              | Required for openai                                                       |
| `LOCAL_EMBEDDING_MODEL`                                                        | `Xenova/multilingual-e5-small` | Local model (allowlisted prefixes)                                        |
| `VECTOR_STORE` / `AIO_VECTOR_STORE`                                            | `faiss`                        | `faiss` \| `qdrant` \| `chroma` \| `pinecone` \| `weaviate` \| `pgvector` |
| `VECTOR_COLLECTION` / `VECTOR_COLLECTION_PREFIX`                               | `aio_<vault>`                  | Shared collection / index naming                                          |
| `QDRANT_URL` / `QDRANT_API_KEY` / `QDRANT_COLLECTION`                          | `http://127.0.0.1:6333`        | Qdrant                                                                    |
| `CHROMA_URL` / `CHROMA_API_KEY` / `CHROMA_API` / `CHROMA_COLLECTION`           | `http://127.0.0.1:8000`        | Chroma (`CHROMA_API=v1\|v2`)                                              |
| `PINECONE_API_KEY` / `PINECONE_INDEX` / `PINECONE_HOST` / `PINECONE_NAMESPACE` | –                              | Pinecone                                                                  |
| `WEAVIATE_URL` / `WEAVIATE_API_KEY` / `WEAVIATE_CLASS`                         | `http://127.0.0.1:8080`        | Weaviate                                                                  |
| `DATABASE_URL` / `PGVECTOR_URL` / `PGVECTOR_TABLE`                             | –                              | pgvector (`npm i pg`)                                                     |

### Orchestration

| Variable                                    | Description                                         |
| ------------------------------------------- | --------------------------------------------------- |
| `AIO_SESSION_RUNTIME`                       | Session runtime                                     |
| `AIO_SESSION_COMMAND` / `AIO_SESSION_ARGS`  | Custom spawn                                        |
| `AIO_INBOX_BACKEND` / `AIO_INBOX_REDIS_URL` | Inbox backend                                       |
| `AIO_VERIFY_STEPS`                          | Ralph verify ladder (`build,lint,test,custom`)      |
| `AIO_VERIFY_CUSTOM_CMD`                     | Ralph custom verify command                         |
| `AIO_VERIFY_CUSTOM_ARGS`                    | JSON array of args for custom verify                |
| `AIO_DISABLE_RG`                            | Disable ripgrep in Branch Hunt (falls back to walk) |
| `AIO_EVENTS=0`                              | Disable event log                                   |
| `AIO_HARNESS_TARGET`                        | Force harness target detection                      |
| `AIO_MCP_TOOL_SET`                          | `core` \| `wiki` \| `full` — tool registration tier |
| `AIO_JSON_PRETTY`                           | `1` = pretty JSON tool responses (debug)            |
| `AIO_WORKTREE`                              | Git worktree path for session isolation             |
| `AIO_SESSION_ID`                            | Injected in child session env                       |
| `AIO_SESSION_SECRET`                        | Injected in child session env for `report_result`   |
| `AIO_PARENT_ORCHESTRATOR`                   | Injected in child session env                       |

### Security / hardening

Defaults are secure. `AIO_ALLOW_*=1` flags are intentional escape hatches.

| Variable                                               | Description                                         |
| ------------------------------------------------------ | --------------------------------------------------- |
| `AIO_SSE_TOKEN` / `AIO_SSE_ALLOW_INSECURE`             | Non-loopback `aio serve` requires a token           |
| `AIO_DASHBOARD_TOKEN` / `AIO_DASHBOARD_ALLOW_INSECURE` | Non-loopback `aio dashboard` requires a token       |
| `AIO_ALLOW_SKIP_APPROVAL`                              | Allow DAG `skip_approval`                           |
| `AIO_ALLOW_MCP_APPROVAL_RESOLVE`                       | Allow MCP `resolve_approval` without CLI trust path |
| `AIO_ALLOW_REPORT_WITHOUT_SECRET`                      | Bypass `report_result` session secret               |
| `AIO_ALLOW_EXTERNAL_VAULT_PATH`                        | Register vaults outside the project root            |
| `AIO_CHILD_ENV_PASSTHROUGH` / `AIO_CHILD_ENV_EXTRA`    | Expand child-process env allowlist                  |
| `AIO_ALLOW_UNTRUSTED_EMBEDDING_MODEL`                  | Bypass local embedding model allowlist              |

**Default security behaviors:**

- **Path containment** — all vault/wiki file operations are restricted to the project root by default (`isPathInsideRoot`). Only paths under `AIO_PROJECT_ROOT` are writable.
- **Child env allowlist** — child sessions inherit only `PATH`, `HOME`, `SHELL`, `NODE_PATH`, `npm_*`, and `AIO_*` / `OPENAI_*` / `ANTHROPIC_*` prefixed vars. Expand via `AIO_CHILD_ENV_PASSTHROUGH` or `AIO_CHILD_ENV_EXTRA`.
- **Embedding model allowlist** — local models must start with `Xenova/` or `onnx-community/` prefixes. Set `AIO_ALLOW_UNTRUSTED_EMBEDDING_MODEL=1` to bypass.
- **Dashboard mutation restrictions** — POST endpoints (apply/reject proposals, scan inbox) require loopback connection. Remote dashboard access is read-only.
- **HTTP body size** — JSON body limit is 1 MB (configurable via `AIO_HTTP_MAX_BODY`).

Auth for SSE/dashboard: `Authorization: Bearer …`, `X-Aio-Token`, or `?token=`.

## Agent token guide

Reduce MCP + tool response tokens for AI agents:

| Situation         | Prefer                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Wiki search       | `query_wiki` with default snippets (not `recall_knowledge`)                                       |
| Domain context    | `domain_context({ task, format: "path" })` → read `.aio/harness-context.json`                     |
| Wiki schema       | MCP resource `aio://wiki/schema` or `get_wiki_schema({ mode: "excerpt" })` once per session       |
| Ingest            | `ingest_pipeline({ lint_mode: "summary" })` or `lint_mode: "none"` + separate `lint_wiki`         |
| Brainstorm        | `response_format: "structured"`, `write_docs: false` until brief                                  |
| Natural commands  | `aio_prompt({ message })` — **`execute` defaults to `true`**; set `execute:false` only to dry-run |
| Tool list size    | `AIO_MCP_TOOL_SET=core` in MCP env (17 core tools)                                                |
| Keywords registry | Do not call `list_tool_keywords` repeatedly — use AGENTS.md                                       |
| JSON debug        | `AIO_JSON_PRETTY=1` only when debugging                                                           |

### Workflow cards

```
[New project]     init → bootstrap_harness → seed_stacks → run_doctor
[Implement]       domain_context → plan_task → execute_dag → file_back → lint_wiki
[Design]          brainstorm_design (fixed topic + merged answers)
[Ingest docs]     ingest_pipeline(lint_mode:none) → lint_wiki
[Parallel research] spawn_session × N → check_inbox → synthesize_results
```

| Env                | Values                             | Default |
| ------------------ | ---------------------------------- | ------- |
| `AIO_MCP_TOOL_SET` | `core` \| `wiki` \| `full`         | `full`  |
| `AIO_JSON_PRETTY`  | `1` for pretty JSON tool responses | compact |

## Architecture

```
src/harness/          # profile, context-pack, bootstrap, loop, prompt-router, stack-playbooks
src/mcp/              # server, session-runtime, inbox, tools/*
src/knowledge/        # vault, wiki-*, embedder, search, vector-store (faiss|qdrant|chroma|pinecone|weaviate|pgvector)
src/security/         # path containment, child-env, SSE/dashboard auth, embedding allowlist
src/orchestrator/     # approval, branch-hunt, worktree, planner, DAG orchestration
src/doctor/           # aio doctor / run_doctor (probes active vector store)
src/dashboard/        # aio dashboard / get_dashboard_stats
src/dag/              # engine, checkpoint
src/ralph/            # verify loop
src/observability/    # events
```

## Development

Source-agent rules live in root [AGENTS.md](./AGENTS.md).

```bash
npm run build && npm test && npm run typecheck
npm run check:all    # typecheck + lint + format:check
```

## Troubleshooting

| Symptom                                              | Likely cause                     | Fix                                                                                    |
| ---------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| `aio mcp-serve` starts but tools show as "not found" | MCP config path or env wrong     | Restart AI tool after MCP config changes; verify with `aio doctor`                     |
| Vector search returns 0 results                      | Empty or corrupt FAISS index     | `aio reindex` or delete `vault/.index/` and re-ingest                                  |
| `faiss-node` build error on install                  | Missing native build deps        | Use `VECTOR_STORE=qdrant` with Docker Qdrant, or install `build-essential` / `python3` |
| Session spawn fails / hangs                          | Runtime not found or timeout     | Check `AIO_SESSION_RUNTIME`; increase `timeout_ms`                                     |
| `report_result` returns "forbidden"                  | Missing session secret           | Set `AIO_ALLOW_REPORT_WITHOUT_SECRET=1` for dev                                        |
| Embedding download slow / fails                      | First-time local model download  | Wait; set `EMBEDDING_PROVIDER=openai` + `OPENAI_API_KEY` as alternative                |
| `aio doctor --fail` exits 1                          | One or more checks failed        | Run `aio doctor` (no `--fail`) for detailed report                                     |
| MCP tool returns `{ ok: false, error }`              | Ingest guard, missing deps, etc. | Check `hint` and `fix` fields in the response                                          |
| Dashboard shows no data                              | Event log empty or disabled      | Set `AIO_EVENTS=1` (default); events accumulate in `.aio/events.jsonl`                 |

## Notes

- Semantic contradictions / stale pages are deep-linted by agents per schema. `lint_wiki` is structural.
- Package: `@mindol1004/aio-mcp` · bin: `aio`
