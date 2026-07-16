export type StackCategory = "frontend" | "backend" | "mobile" | "api" | "language";

export interface StackPlaybook {
  id: string;
  title: string;
  category: StackCategory;
  tags: string[];
  aliases: string[];
  content: string;
}

function pb(
  id: string,
  title: string,
  category: StackCategory,
  tags: string[],
  aliases: string[],
  sections: Record<string, string>
): StackPlaybook {
  const body = Object.entries(sections)
    .map(([h, t]) => `## ${h}\n\n${t.trim()}`)
    .join("\n\n");
  return {
    id,
    title,
    category,
    tags: ["stack", "playbook", category, ...tags],
    aliases,
    content: [
      `> Stack playbook for **${title}**. Use with domain wiki + \`design_architecture\`.`,
      "",
      body,
      "",
      "## Domain mapping",
      "",
      "- Map each **bounded context** from domain wiki to one module/package.",
      "- Cross-context calls only via application service, API, or events — not shared entities.",
      "- Cite domain wiki pages when choosing module boundaries.",
    ].join("\n"),
  };
}

export const STACK_PLAYBOOKS: StackPlaybook[] = [
  // ── Frontend ──
  pb("react", "React + TypeScript", "frontend", ["react", "typescript", "spa"], ["react", "reactjs", "리액트"], {
    "Folder structure": `
\`\`\`
src/
  app/           # routes, providers
  features/      # feature folders (cart/, auth/)
  shared/        # ui, hooks, utils
  entities/      # types + API clients per domain entity
\`\`\``,
    "Layers": "- UI components → hooks → API client → DTO types\n- No business rules in presentational components\n- Feature flags / auth at route boundary",
    "Testing": "- Vitest + React Testing Library\n- MSW for API mocks\n- E2E: Playwright",
    "Anti-patterns": "- God Context, prop drilling across features\n- Fetch in every component\n- Mixing domain logic in JSX",
  }),
  pb("nextjs", "Next.js (App Router)", "frontend", ["nextjs", "react", "ssr"], ["next", "next.js", "넥스트"], {
    "Folder structure": `
\`\`\`
app/             # App Router pages
  (shop)/
  api/           # Route Handlers (BFF)
features/
lib/             # server actions, clients
\`\`\``,
    "Layers": "- Server Components for read-heavy catalog\n- Client Components for cart/checkout interactivity\n- Route Handlers as BFF — do not expose internal services to browser",
    "Data fetching": "- Prefer server-side fetch + cache tags\n- Mutations via Server Actions or API routes",
    "Anti-patterns": "- Leaking DB credentials to client bundles\n- Putting all logic in page.tsx",
  }),
  pb("vue", "Vue 3 + TypeScript", "frontend", ["vue", "typescript", "spa"], ["vue", "vue3", "뷰"], {
    "Folder structure": "`src/features/<domain>/` with components, composables, stores",
    "State": "- Pinia per bounded feature\n- Composables for reusable logic",
    "Testing": "Vitest + Vue Test Utils",
    "Anti-patterns": "Global mega-store; options API in new code",
  }),
  pb("nuxt", "Nuxt 3", "frontend", ["nuxt", "vue", "ssr"], ["nuxt", "눅스트"], {
    "Structure": "`pages/`, `server/api/` (BFF), `composables/`, `stores/`",
    "SSR": "Use server routes for secrets; hybrid rendering per route",
    "Anti-patterns": "Client-only secrets; monolithic store",
  }),
  pb("angular", "Angular", "frontend", ["angular", "typescript"], ["angular", "앵귤러"], {
    "Structure": "Nx or modular: `libs/<domain>/feature|ui|data-access`",
    "Layers": "Smart/dumb components; services + NgRx/signals per feature",
    "Anti-patterns": "Single giant AppModule; shared mutable singletons",
  }),
  pb("svelte", "Svelte / SvelteKit", "frontend", ["svelte", "spa"], ["svelte", "스벨트"], {
    "Structure": "`src/routes/`, `src/lib/features/`",
    "Patterns": "Stores for feature state; +page.server.ts for data",
    "Anti-patterns": "Global store for all domains",
  }),
  pb("solidjs", "SolidJS", "frontend", ["solid", "reactivity"], ["solid", "solidjs"], {
    "Structure": "Feature folders with fine-grained reactive stores",
    "Patterns": "Signals for local state; resources for async",
  }),
  pb("astro", "Astro", "frontend", ["astro", "static"], ["astro", "아스트로"], {
    "Use when": "Content-heavy storefront, marketing, docs",
    "Islands": "Interactive cart/checkout as React/Vue islands",
  }),
  pb("react-native", "React Native", "mobile", ["react-native", "mobile"], ["react-native", "rn", "리액트네이티브"], {
    "Structure": "`src/features/`, shared navigation, API layer",
    "Patterns": "Feature-based navigation stacks; offline cart cache",
  }),
  pb("flutter", "Flutter / Dart", "mobile", ["flutter", "dart", "mobile"], ["flutter", "플러터"], {
    "Structure": "Clean architecture: presentation / domain / data per feature",
    "State": "Riverpod or Bloc per feature",
  }),

  // ── Backend ──
  pb("spring-boot", "Spring Boot (Java)", "backend", ["java", "spring", "jvm"], ["spring", "spring-boot", "스프링"], {
    "Modules": "Gradle multi-module: `auth`, `catalog`, `cart`, `order`, `payment`",
    "Layers": "controller → application service → domain → infrastructure",
    "Patterns": "Hexagonal ports/adapters; domain events + outbox",
    "Testing": "JUnit5, Testcontainers for integration",
    "Anti-patterns": "Anemic domain; @Transactional on controllers",
  }),
  pb("kotlin-spring", "Kotlin + Spring Boot", "backend", ["kotlin", "spring", "jvm"], ["kotlin", "코틀린", "kt"], {
    "Modules": "Same BC split as Spring; prefer data classes + sealed types for domain",
    "Style": "Coroutines for IO; explicit DTO mapping",
    "Anti-patterns": "Java-style everything in services",
  }),
  pb("node-express", "Node.js + Express", "backend", ["node", "express", "javascript"], ["express", "node", "노드", "익스프레스"], {
    "Structure": "`src/modules/<bc>/` routes, service, repository",
    "Layers": "Thin routes; validation (zod); service owns use-cases",
    "Testing": "Supertest + vitest/jest",
    "Anti-patterns": "Callbacks; logic in route handlers",
  }),
  pb("nestjs", "NestJS", "backend", ["node", "nestjs", "typescript"], ["nestjs", "nest", "네스트"], {
    "Structure": "Module per bounded context; providers for services/repos",
    "Patterns": "CQRS optional per BC; guards for auth boundaries",
    "Anti-patterns": "Circular module imports; god AppModule",
  }),
  pb("fastify", "Fastify", "backend", ["node", "fastify"], ["fastify", "패스티파이"], {
    "Structure": "Plugin per domain; JSON schema validation",
    "When": "High-throughput APIs, BFF layers",
  }),
  pb("python-fastapi", "Python FastAPI", "backend", ["python", "fastapi"], ["fastapi", "파이썬", "fast api"], {
    "Structure": "`app/domains/<bc>/` router, service, models",
    "Layers": "Pydantic schemas; async where IO-bound",
    "Testing": "pytest + httpx",
  }),
  pb("python-django", "Python Django", "backend", ["python", "django"], ["django", "장고"], {
    "Structure": "Django apps per bounded context (not one mega app)",
    "Patterns": "DRF for APIs; Celery for async jobs",
    "Anti-patterns": "Fat models with all business logic",
  }),
  pb("python-flask", "Python Flask", "backend", ["python", "flask"], ["flask", "플라스크"], {
    "Structure": "Blueprints per domain; application factory",
    "When": "Smaller services; pair with SQLAlchemy per BC",
  }),
  pb("go-gin", "Go + Gin", "backend", ["go", "gin"], ["go", "golang", "gin", "고"], {
    "Structure": "`internal/<bc>/` handler, service, repo",
    "Patterns": "Explicit error handling; context propagation",
  }),
  pb("go-fiber", "Go + Fiber", "backend", ["go", "fiber"], ["fiber", "gofiber"], {
    "Structure": "Similar to Gin; middleware per cross-cutting concern",
  }),
  pb("rust-actix", "Rust (Actix-web)", "backend", ["rust", "actix"], ["rust", "actix", "러스트"], {
    "Structure": "Crate or module per BC; actix handlers thin",
    "Patterns": "Domain errors as enums; repository traits",
  }),
  pb("dotnet-csharp", ".NET / ASP.NET Core", "backend", ["csharp", "dotnet"], ["dotnet", "csharp", "c#", "닷넷"], {
    "Structure": "Solution per BC or Clean Architecture layers per module",
    "Patterns": "MediatR for use-cases; EF Core bounded DbContexts",
  }),
  pb("php-laravel", "PHP Laravel", "backend", ["php", "laravel"], ["laravel", "라라벨", "php"], {
    "Structure": "Modules or packages per domain; Form Requests for validation",
  }),
  pb("ruby-rails", "Ruby on Rails", "backend", ["ruby", "rails"], ["rails", "ruby", "레일즈"], {
    "Structure": "Packwerk or engines per bounded context",
    "Anti-patterns": "Fat controllers; callbacks everywhere",
  }),
  pb("elixir-phoenix", "Elixir Phoenix", "backend", ["elixir", "phoenix"], ["phoenix", "elixir", "엘릭서"], {
    "Structure": "Contexts (Phoenix) = bounded contexts",
    "Patterns": "GenServer for process boundaries; Oban for jobs",
  }),
  pb("graphql-apollo", "GraphQL (Apollo)", "api", ["graphql", "api"], ["graphql", "apollo", "그래프ql"], {
    "Structure": "Schema per domain; resolvers delegate to services",
    "BFF": "Federation when splitting services; avoid god Query type",
  }),
  pb("remix", "Remix (React)", "frontend", ["remix", "react", "ssr"], ["remix", "리믹스"], {
    "Structure": "`app/routes/` per feature; loaders/actions for data mutations",
    "Patterns": "Colocate route + UI; BFF in loaders",
    "Anti-patterns": "Fat loaders with cross-domain logic",
  }),
  pb("qwik", "Qwik", "frontend", ["qwik", "resumability"], ["qwik", "퀵"], {
    "Structure": "Feature routes with lazy-loaded interactive islands",
    "When": "SEO + minimal JS storefront",
  }),
  pb("htmx", "HTMX + server templates", "frontend", ["htmx", "hypermedia"], ["htmx", "하이퍼미디어"], {
    "Structure": "Server-rendered pages + partial swaps per feature",
    "When": "Simple admin, BFF-heavy monoliths",
    "Anti-patterns": "SPA reimplemented with fragments",
  }),
  pb("hono", "Hono (Edge/Node)", "backend", ["hono", "typescript", "edge"], ["hono", "호노"], {
    "Structure": "Route modules per BC; Zod validation; thin handlers",
    "When": "Edge workers, lightweight BFF",
  }),
  pb("quarkus", "Quarkus (Java)", "backend", ["java", "quarkus", "jvm"], ["quarkus", "쿼커스"], {
    "Modules": "Maven/Gradle modules per bounded context",
    "Patterns": "CDI + Panache; native build optional",
    "When": "Cloud-native JVM, Kubernetes",
  }),
  pb("deno-fresh", "Deno Fresh", "backend", ["deno", "fresh", "typescript"], ["deno", "fresh", "데노"], {
    "Structure": "`routes/` + `islands/`; KV/DB adapters per domain",
    "When": "Deno deploy, edge-first APIs",
  }),
  pb("scala-play", "Scala Play Framework", "backend", ["scala", "play", "jvm"], ["scala", "play", "스칼라"], {
    "Structure": "Modules per BC; Akka optional for async domains",
    "Patterns": "Functional core, imperative shell",
  }),
  pb("trpc", "tRPC (TypeScript API)", "api", ["trpc", "typescript", "rpc"], ["trpc", "티알피씨"], {
    "Structure": "Router per domain; shared Zod schemas",
    "When": "Full-stack TS monorepo; type-safe BFF",
  }),
  pb("swift-ios", "Swift (iOS)", "mobile", ["swift", "ios", "mobile"], ["swift", "ios", "스위프트"], {
    "Structure": "Feature modules; SwiftUI views + domain services",
    "Patterns": "Repository protocol per BC",
  }),
  pb("kotlin-android", "Kotlin (Android)", "mobile", ["kotlin", "android", "mobile"], ["android", "안드로이드", "kotlin-android"], {
    "Structure": "Gradle modules per feature; Clean Architecture layers",
    "Patterns": "ViewModel + UseCase; Hilt DI",
  }),
  pb("typescript", "TypeScript (general)", "language", ["typescript", "ts"], ["typescript", "타입스크립트", "ts"], {
    "Conventions": "Strict mode; explicit return types on public APIs",
    "Monorepo": "packages per BC; shared types in `contracts` only",
    "Testing": "Vitest preferred; type tests for DTO boundaries",
  }),
];

export function findPlaybookByAlias(text: string): StackPlaybook | undefined {
  const lower = text.toLowerCase();
  return STACK_PLAYBOOKS.find(
    (p) =>
      p.id === lower ||
      p.aliases.some((a) => lower.includes(a.toLowerCase())) ||
      lower.includes(p.id)
  );
}

export function detectStacksFromText(text: string): { frontend?: string; backend?: string; mobile?: string; api?: string } {
  const found: { frontend?: string; backend?: string; mobile?: string; api?: string } = {};
  for (const p of STACK_PLAYBOOKS) {
    if (p.aliases.some((a) => text.toLowerCase().includes(a.toLowerCase())) || text.toLowerCase().includes(p.id)) {
      if (p.category === "frontend" && !found.frontend) found.frontend = p.id;
      if (p.category === "backend" && !found.backend) found.backend = p.id;
      if (p.category === "mobile" && !found.mobile) found.mobile = p.id;
      if (p.category === "api" && !found.api) found.api = p.id;
    }
  }
  return found;
}

export const ALL_STACK_IDS = STACK_PLAYBOOKS.map((p) => p.id);
