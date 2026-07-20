# @mindol1004/aio-mcp

Parallel AI orchestration MCP server (`aio`).  
Spawn sessions, run Task DAGs, maintain a knowledge wiki (RAG), and Branch Hunt from Cursor, Claude Code, OpenCode, and other MCP clients.

**Node.js >= 20** · current version **2.14.0**

### 2.14 — brainstorm multi-turn · keyword routing fixes

| Change | Detail |
| ------ | ------ |
| Multi-turn `brainstorm_design` | Brief only after **both** `answers.phase` + `answers.scale` (or `skip_questions`). Already-answered questions are dropped from `clarifying_questions`. |
| `aio_prompt` answers | Top-level `answers` accepts brainstorm fields (`phase`, `consistency`, `traffic`, …) and merges into the routed tool. |
| Topic extraction | Stripping `brainstorm` no longer leaves `_design` from `brainstorm_design`; tool ids are removed before free-text extract. |
| Wiki on clarify | Question-status responses still include wiki citations / context excerpt. |
| Agent continue hint | Instructions tell the agent to **re-call with the same topic** + merged answers (not use a short reply like `design` as a new topic). |

```json
// Start
brainstorm_design({ "topic": "위키 기반 ecommerce MVP 설계" })

// Follow-up (same topic!)
brainstorm_design({
  "topic": "위키 기반 ecommerce MVP 설계",
  "answers": { "phase": "design", "scale": "mvp" }
})

// Or via router
aio_prompt({
  "message": "브레인스토밍 위키 기반 ecommerce MVP 설계",
  "execute": true,
  "answers": { "phase": "design", "scale": "mvp" }
})
```

### 2.12 — wiki MR · multi-vault · raw inbox · dashboard

| Feature                                          | CLI                                                                               | MCP                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| Drop files into `vault/raw-inbox/` → auto ingest | `aio watch-raw`, `aio scan-inbox`                                                 | `scan_raw_inbox`                                |
| Multi-vault registry                             | `aio vault list`, `aio vault register` (aliases: `vault-list` / `vault-register`) | `list_vaults`, `register_vault`                 |
| Wiki MR (propose → approve → merge)              | —                                                                                 | `propose_wiki_change`, `apply_wiki_proposal`, … |
| Coverage dashboard                               | `aio dashboard` (http://127.0.0.1:8920)                                           | `get_dashboard_stats`                           |

**Multi-vault:** register entries in `.aio/vaults.yaml`. The active vault is chosen when the MCP/CLI process **starts** (`AIO_VAULT_NAME` → registry default → `vault/`). `register_vault` only updates YAML — restart MCP after switching names.

## 5-minute onboarding (any project)

Attach aio-mcp to a new repo with this sequence. In about five minutes you have MCP + vault + harness.

| #   | Command                                                 | What it does                                                       |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `npx -y @mindol1004/aio-mcp init`                       | Create `vault/` + search index                                     |
| 2   | `npx -y @mindol1004/aio-mcp bootstrap-harness`          | Auto-detect **one** tool (e.g. Cursor). All tools: `--targets all` |
| 3   | Connect MCP + **Reload**                                | Set `AIO_PROJECT_ROOT: "${workspaceFolder}"` in `.cursor/mcp.json` |
| 4   | `npx -y @mindol1004/aio-mcp doctor`                     | Diagnose install, paths, vault, harness                            |
| 5   | `aio ingest --file README.md` or chat `ingest pipeline` | raw → wiki → lint in one pass                                      |
| 6   | `aio aio-prompt "wiki lint" --execute`                  | Keyword-routing smoke test                                         |

**One-shot health check:** `aio doctor` covers Node, `AIO_PROJECT_ROOT`, vault, wiki count, index, harness files, **active AI tool detection**, alerts for **unused tool files**, MCP config, git, rg, session runtime, and embeddings.

```bash
aio doctor          # human-readable report
aio doctor --json   # CI / scripts
aio doctor --fail   # exit 1 if any check fails
```

From MCP: `run_doctor` or `aio_prompt({ message: "run doctor", execute: true })`.

## Install / run

```bash
npm install
npm run build

npx aio init                 # 3-layer vault (raw/wiki/schema) + index
npx aio bootstrap-harness    # domain harness (AGENTS.md, rules, hooks, MCP config)
npx aio wiki-lint --fail     # wiki structure lint (CI)
npx aio mcp-serve            # stdio MCP (Cursor, etc.)
npx aio serve                # SSE MCP (default http://127.0.0.1:8910/sse)
npx aio dashboard            # coverage UI (default http://127.0.0.1:8920)
npx aio recall "inventory reservation"
npx aio status
npx aio example              # DAG pipeline demo
```

Published package:

```bash
npx -y @mindol1004/aio-mcp mcp-serve
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
        "AIO_PROJECT_ROOT": "${workspaceFolder}"
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
        "AIO_PROJECT_ROOT": "/absolute/path/to/your/project"
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

| Layer         | Role                                              |
| ------------- | ------------------------------------------------- |
| **raw/**      | Sources. LLM read-only. Add only via `ingest_raw` |
| **wiki/**     | Summaries, entities, concept pages                |
| **AGENTS.md** | Schema: ingest / query / lint rules               |

### Three operations

| Op         | Tools                                                                      | Behavior                                             |
| ---------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Ingest** | `ingest_pipeline` / `ingest_raw` → `ingest_source` / `ingest_source_batch` | raw → wiki page(s) → lint. CLI: `aio ingest --file`  |
| **Query**  | `query_wiki` → (optional) `file_back`                                      | Search + cite → fold good answers back into the wiki |
| **Lint**   | `lint_wiki` / `aio wiki-lint --fail`                                       | Orphans, index coverage, schema/raw. Wire into CI    |

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
- See [`.env.example`](./.env.example) for the full list.

> `.env` is **not** auto-loaded. Export vars in the shell or MCP `env`.

## CLI

| Command                                      | Description                                                    |
| -------------------------------------------- | -------------------------------------------------------------- |
| `aio init [--vault]`                         | Seed 3-layer vault + schema + local search index               |
| `aio bootstrap-harness`                      | Wiki → domain harness (AGENTS.md, rules/hooks, MCP configs)    |
| `aio seed-stacks`                            | Seed stack playbooks under `vault/wiki/stacks/` (37 stacks)    |
| `aio design-architecture`                    | Wiki + stack architecture → `docs/architecture.md`             |
| `aio ingest --file <path>`                   | One-shot ingest pipeline                                       |
| `aio aio-prompt "<msg>"`                     | Natural-language routing (`--execute` to run)                  |
| `aio doctor [--json] [--fail]`               | Onboarding / health diagnostics                                |
| `aio watch-raw` / `aio scan-inbox`           | Watch or scan `raw-inbox/`                                     |
| `aio vault list` / `aio vault register`      | Multi-vault registry (`vault-list` / `vault-register` aliases) |
| `aio dashboard`                              | Coverage / proposals / inbox / events UI                       |
| `aio wiki-lint [--fail]`                     | Wiki structure lint                                            |
| `aio approval list` / `aio approval resolve` | Human-in-the-loop approval (CLI resolve is trusted)            |
| `aio mcp-serve` / `aio serve`                | stdio / SSE MCP                                                |
| `aio recall` / `aio status` / `aio example`  | Search, paths, demo                                            |

## MCP tools (51)

| Category        | Count | Tools                                                                                                                                                                                                                                                            |
| --------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Harness**     | 11    | `aio_prompt`, `list_tool_keywords`, `bootstrap_harness`, `seed_stack_playbooks`, `design_architecture`, `brainstorm_design`, `bootstrap_domain`, `run_domain_loop`, `get_domain_profile`, `save_domain_profile`, `list_stack_playbooks`                          |
| **Wiki**        | 14    | `get_wiki_schema`, `ingest_raw`, `ingest_source`, `ingest_source_batch`, `ingest_pipeline`, `update_wiki_page`, `query_wiki`, `file_back`, `lint_wiki`, `propose_wiki_change`, `list_wiki_proposals`, `apply_wiki_proposal`, `reject_wiki_proposal`, `wiki_diff` |
| **Vault**       | 4     | `list_vaults`, `register_vault`, `scan_raw_inbox`, `get_dashboard_stats`                                                                                                                                                                                         |
| **Session**     | 8     | `spawn_session`, `check_inbox`, `report_result`, `send_message`, `get_session`, `close_session`, `list_sessions`, `synthesize_results`                                                                                                                           |
| **DAG**         | 2     | `plan_task`, `execute_dag`                                                                                                                                                                                                                                       |
| **Ops**         | 7     | `request_approval`, `resolve_approval`, `list_approvals`, `get_events`, `list_worktrees`, `remove_worktree`, `run_doctor`                                                                                                                                        |
| **Branch Hunt** | 3     | `scan_issues`, `collect_results`, `get_branch_status`                                                                                                                                                                                                            |
| **Knowledge**   | 2     | `store_knowledge`, `recall_knowledge`                                                                                                                                                                                                                            |

### Keyword routing (`aio_prompt`)

**49** tools are keyword-routable (everything except `aio_prompt` / `list_tool_keywords`). Matching uses scored Korean **and** English keywords/patterns (articles like “the/a/my” are allowed). Unrelated text returns `unknown` — it does not fall through to brainstorm.

| Example (KO / EN)                  | Tool                  |
| ---------------------------------- | --------------------- |
| wiki 검색 / search the wiki        | `query_wiki`          |
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

| Artifact                                 | Target                                     |
| ---------------------------------------- | ------------------------------------------ |
| `AGENTS.md`                              | Shared (all agents)                        |
| `.cursor/rules/aio-domain-harness.mdc`   | Cursor                                     |
| `.cursor/hooks.json` + `hooks/aio-*.mjs` | Cursor (inject wiki context)               |
| `.cursor/mcp.json`                       | Cursor MCP (merge)                         |
| `CLAUDE.md` + `.mcp.json`                | Claude Code                                |
| `opencode.json`                          | OpenCode                                   |
| `.codex/mcp.toml`                        | Codex CLI (harness output)                 |
| `.aio/domain-profile.yaml`               | Domain profile                             |
| `.aio/harness-context.json`              | `bootstrap_domain` cache (hooks read this) |

```bash
aio init
aio seed-stacks
aio bootstrap-harness --domain ecommerce --backend spring-boot --frontend react
# Restart MCP, then in chat:
#   "bootstrap harness" / "design architecture"  (aio_prompt)
#   run_domain_loop({ task: "implement login API" })
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

### Ralph Loop (internal)

`AIO_VERIFY_STEPS=build,lint,test,custom` · `AIO_VERIFY_CUSTOM_CMD` · backoff + jitter

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

| Variable                                    | Description                    |
| ------------------------------------------- | ------------------------------ |
| `AIO_SESSION_RUNTIME`                       | Session runtime                |
| `AIO_SESSION_COMMAND` / `AIO_SESSION_ARGS`  | Custom spawn                   |
| `AIO_INBOX_BACKEND` / `AIO_INBOX_REDIS_URL` | Inbox backend                  |
| `AIO_VERIFY_STEPS`                          | Ralph verify ladder            |
| `AIO_EVENTS=0`                              | Disable event log              |
| `AIO_HARNESS_TARGET`                        | Force harness target detection |

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

Auth for SSE/dashboard: `Authorization: Bearer …`, `X-Aio-Token`, or `?token=`.

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

## Notes

- Semantic contradictions / stale pages are deep-linted by agents per schema. `lint_wiki` is structural.
- Package: `@mindol1004/aio-mcp` · bin: `aio`
