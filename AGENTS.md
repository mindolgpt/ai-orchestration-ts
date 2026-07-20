# AGENTS.md (repo)

Rules for agents editing **aio-mcp source** in this repository.  
For end-user MCP setup and Wiki usage, see **[README.md](./README.md)**.

## Three different `AGENTS.md` files

| File                  | Location                                        | Purpose                                            |
| --------------------- | ----------------------------------------------- | -------------------------------------------------- |
| **This file**         | repo root `AGENTS.md`                           | Source-development rules for `@mindol1004/aio-mcp` |
| **Wiki schema**       | `vault/AGENTS.md` (seeded by `aio init`)        | Knowledge-wiki maintenance rules (3-layer vault)   |
| **Harness AGENTS.md** | consumer project root (via `bootstrap_harness`) | Domain harness instructions for that project       |

Do not confuse them. Wiki schema is seeded from `src/knowledge/wiki-schema.ts` on `aio init`.  
Never overwrite this repo’s root `AGENTS.md` with harness output when developing aio-mcp itself.

## Runtime

- Node `>= 20` (`package.json` `engines`)
- Package `@mindol1004/aio-mcp` — version from `package.json`
- **No dotenv auto-load** — set env in the shell or MCP `env` (see `.env.example`)
- Do not document Docker or skills that do not exist in this repo

## Architecture map

| Area         | Paths                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Wiki / vault | `src/knowledge/vault.ts`, `wiki-ops.ts`, `wiki-schema.ts`, `wiki-ingest-pipeline.ts`, `vault-registry.ts`                  |
| Vector store | `src/knowledge/vector-store*.ts`, `search.ts` — `faiss` \| `qdrant` \| `chroma` \| `pinecone` \| `weaviate` \| `pgvector`  |
| MCP tools    | `src/mcp/server.ts`, `src/mcp/tools/` (`wiki-`, `session-`, `dag-`, `ops-`, `branch-`, `harness-`, `vault-`, `knowledge-`) |
| Security     | `src/security/` — path containment, child-env allowlist, SSE/dashboard HTTP auth, embedding allowlist                      |
| Harness      | `src/harness/` — bootstrap, prompt-router/executor, profiles, stack playbooks                                              |
| Orchestrator | `src/orchestrator/` — approval, branch-hunt, worktree, DAG orchestration                                                   |
| Other        | `src/doctor/`, `src/dashboard/`, `src/dag/`, `src/ralph/`, `src/observability/`                                            |

Security regression tests: `tests/security-hardening.test.ts`.

## Bilingual routing (KO + EN)

- `aio_prompt` / `TOOL_KEYWORDS` must keep **Korean and English** aliases for user-facing tools
- Weight alone must never match — require at least one keyword/pattern hit
- Prefer natural EN phrases with optional articles (`search the wiki`, `spawn a session`)
- Add/extend pairs in `tests/prompt-router.test.ts` when changing keywords

## Wiki invariants

- `raw/` is immutable
- `wiki/index.md` ≠ `wiki/log.md`
- Schema lives in `vault/AGENTS.md` (not this file)

## Security defaults (do not weaken casually)

Defaults are secure. `AIO_ALLOW_*=1` flags are intentional escape hatches — document why if you change behavior.

- Non-loopback SSE / dashboard binds require tokens (`AIO_SSE_TOKEN`, `AIO_DASHBOARD_TOKEN`)
- Child process env is allowlisted (`AIO_CHILD_ENV_PASSTHROUGH` / `AIO_CHILD_ENV_EXTRA` to expand)
- Approval resolve and `report_result` secret checks are enforced unless explicitly opted out
- Local embedding models are allowlisted (`AIO_ALLOW_UNTRUSTED_EMBEDDING_MODEL=1` to bypass)
- Vault paths must stay under the project root unless `AIO_ALLOW_EXTERNAL_VAULT_PATH=1`

## Verification

```bash
# Primary (build + tests + types)
npm run build && npm test && npm run typecheck

# Static quality (no build/test)
npm run check:all

# Optional
npm run wiki-lint          # needs dist/
npx aio doctor --fail
```
