/**
 * Per-language coding rules catalog and helpers.
 *
 * Used by the harness bootstrap wizard to inject language-optimized
 * conventions into tool-specific rule files (Cursor rules, CLAUDE.md,
 * Windsurf rules, Continue rules, AGENTS.md, OpenCode instructions).
 *
 * Rules are advisory — agents should follow them unless the user says
 * otherwise. Keep rule text short and actionable so rule files stay
 * readable across all AI coding tools.
 */

export type LanguageId =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'kotlin'
  | 'csharp'
  | 'php'
  | 'ruby'
  | 'swift'
  | 'elixir'
  | 'scala'
  | 'dart'

export interface LanguageRules {
  /** Canonical lower-case id (matches LanguageId) */
  id: LanguageId
  /** Human label */
  label: string
  /** Aliases that may appear in detection text or wiki notes */
  aliases: string[]
  /** File extensions used to confirm membership (e.g. ['.ts', '.tsx']) */
  extensions: string[]
  /** Package manifest files that signal this language is in use */
  manifests: string[]
  /** Short rule body for each section. Omitted sections are skipped. */
  rules: {
    naming?: string
    structure?: string
    style?: string
    lint?: string
    testing?: string
    formatter?: string
    errorHandling?: string
    docRef?: string
  }
}

export const LANGUAGE_RULES: Record<LanguageId, LanguageRules> = {
  typescript: {
    id: 'typescript',
    label: 'TypeScript',
    aliases: ['typescript', 'ts', '타입스크립트', 'tsx'],
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    manifests: ['package.json', 'tsconfig.json'],
    rules: {
      naming:
        'PascalCase for types/classes/components, camelCase for functions/variables, UPPER_SNAKE for constants, kebab-case for file names of non-component modules.',
      structure:
        'Feature folders: src/features/<domain>/{ui,hooks,api,types}. Each bounded context maps to one package; share only DTOs via contracts/. Never colocate cross-BC logic.',
      style:
        'Prefer `type` for unions/aliases and `interface` for object contracts. Avoid `any` — use `unknown` + narrowing. Prefer `readonly` on public DTO fields. No unused imports.',
      lint: 'ESLint (typescript-eslint recommended, strict) + Prettier. Enable `no-floating-promises`, `no-misused-promises`. `@typescript-eslint/no-explicit-any` should error.',
      testing:
        'Vitest + @testing-library. Unit tests next to source (*.test.ts). MSW for HTTP mocks. Playwright for e2e. Prefer behavior over implementation tests.',
      formatter:
        'Prettier defaults: single quotes, trailing comma "all", 2-space indent, 100 col. Run on save and in CI.',
      errorHandling:
        'Discriminated unions for errors (Result/Either preferred); never `throw string`. Wrap external calls with typed error envelopes at feature boundaries.',
      docRef: 'Cite [[stacks/typescript]] and vault wiki bounded contexts.',
    },
  },
  javascript: {
    id: 'javascript',
    label: 'JavaScript',
    aliases: ['javascript', 'js', '자바스크립트'],
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    manifests: ['package.json'],
    rules: {
      naming:
        'camelCase for functions/variables, PascalCase for React components/classes, UPPER_SNAKE for constants, kebab-case for test/data files.',
      structure:
        'Feature folders: src/features/<domain>/{ui,hooks,api}. Prefer ES modules; CommonJS only when required by tooling.',
      style:
        'Prefer modern syntax (optional chaining, nullish coalescing). No unused variables. Use `const` by default; `let` only when reassignment is required.',
      lint: 'ESLint (eslint:recommended) + Prettier. For Node-targeted code enable `no-process-exit` at module scope except entry files.',
      testing: 'Vitest or Jest; colocate *.test.js files. MSW for network mocks.',
      formatter: 'Prettier: single quotes, trailing comma "all", 2-space indent, 100 col.',
      errorHandling:
        'Return explicit error objects rather than throwing strings. Validate at boundaries with zod/valibot when types are unavailable.',
      docRef: 'Cite relevant wiki bounded contexts for domain rules.',
    },
  },
  python: {
    id: 'python',
    label: 'Python',
    aliases: ['python', '파이썬', 'py', 'fastapi', 'django', 'flask'],
    extensions: ['.py', '.pyi'],
    manifests: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'],
    rules: {
      naming:
        'PEP 8: snake_case for functions/variables, PascalCase for classes, UPPER_SNAKE for module constants. Private members with leading underscore.',
      structure:
        'Per bounded context: `app/domains/<bc>/{router,service,models,schemas}`. One package per BC — do not share ORM entities across contexts.',
      style:
        'Type hints required on all public functions. Prefer `dataclasses` or Pydantic v2 models for DTO boundaries. Use `from __future__ import annotations` when targeting < 3.10.',
      lint: 'ruff (lint + format) preferred over legacy flake8/black/isort combo. Enable pyupgrade, bugbear. mypy strict (or pyright) on public APIs.',
      testing:
        'pytest + httpx (async). Tests in `tests/<bc>/` mirroring package layout. Use fixtures, not setup/teardown methods. Factory-boy for complex objects.',
      formatter: 'ruff format (black-compatible, 88 col). 4-space indent.',
      errorHandling:
        'Domain errors as exception classes per BC; map to HTTP status at routing boundary. Never swallow exceptions silently — log context then re-raise or convert.',
      docRef:
        'Cite [[stacks/python-fastapi]] or [[stacks/python-django]] and wiki bounded contexts.',
    },
  },
  go: {
    id: 'go',
    label: 'Go',
    aliases: ['go', 'golang', '고'],
    extensions: ['.go'],
    manifests: ['go.mod'],
    rules: {
      naming:
        'Exported = PascalCase, unexported = camelCase. Acronyms as TitleCase (`HTTPServer`, not `HttpServer`). Interface names are often verb-led (`Reader`, `Store`).',
      structure:
        '`internal/<bc>/` per bounded context with handler, service, repo layers. Share only via explicit exported interfaces — no cross-package reaching into unexported fields.',
      style:
        '`gofmt`/`goimports` is canonical. Keep functions short; prefer table-driven tests. Pass `context.Context` as first argument on all IO-bound functions.',
      lint: 'golangci-lint with `errcheck`, `gosec`, `govet`, `staticcheck`, `revive` enabled at minimum.',
      testing:
        '`testing` stdlib + `testify` for assertions only when it improves readability. Place `*_test.go` next to source. Use `httptest` and testcontainers for integrations.',
      formatter: 'gofmt / goimports — no alternative formatters. `gofmt -s` for simplify.',
      errorHandling:
        'Always check errors; never `_ = err`. Wrap with `fmt.Errorf("op: %w", err)` at boundaries. Sentinel errors per BC, mapped at API handlers.',
      docRef: 'Cite [[stacks/go-gin]] or [[stacks/go-fiber]] and wiki bounded contexts.',
    },
  },
  rust: {
    id: 'rust',
    label: 'Rust',
    aliases: ['rust', '러스트', 'rs'],
    extensions: ['.rs'],
    manifests: ['Cargo.toml'],
    rules: {
      naming: `snake_case for functions/variables/modules, UpperCamelCase for types/traits, UPPER_SNAKE for constants. Lifetime parameters: short lowercase (\`'a\`).`,
      structure:
        'Crate or module per bounded context. `src/<bc>/{handler,domain,infra}`. Prefer traits for port abstractions; keep domain free of framework imports.',
      style:
        '`clippy::pedantic` enabled with project-level allows for noisy lints. Prefer iterators over index loops. Use `?` for error propagation instead of match arms.',
      lint: 'clippy (default + pedantic subset), `rustfmt`. `cargo deny` for supply chain. CI runs `cargo fmt --check`.',
      testing:
        '`cargo test` with `#[tokio::test]` for async. `mockall` for trait mocks. Property tests with `proptest` for parsing/algo modules.',
      formatter: 'rustfmt — edition-appropriate. 4-space indent.',
      errorHandling:
        'Domain errors as `thiserror` enums; intra-crate `Result<T, E>` per BC. `anyhow` only at binary/CLI boundary, never in library code shared between BCs.',
      docRef: 'Cite [[stacks/rust-actix]] and wiki bounded contexts.',
    },
  },
  java: {
    id: 'java',
    label: 'Java',
    aliases: ['java', '자바', 'jvm', 'spring'],
    extensions: ['.java'],
    manifests: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    rules: {
      naming:
        'PascalCase for classes/interfaces, camelCase for methods/variables, UPPER_SNAKE for constants. Package names all lowercase, reverse-DNS.',
      structure:
        'Gradle/Maven multi-module: one module per bounded context (`auth`, `catalog`, ...). Layers: controller → application service → domain → infrastructure. No anemic models.',
      style:
        'Prefer records for DTOs. Use `var` only when type is obvious. No `public` fields — use accessors. Keep methods short; composition over inheritance.',
      lint: 'Spotless + Checkstyle (Google style baseline) or spotbugs. Errorprone for high-confidence bug patterns. CI: `./gradlew spotlessCheck check`.',
      testing:
        'JUnit 5 + AssertJ (fluent) + Mockito. Testcontainers for DB/kafka integration. One test class per production class is a starting point, not law.',
      formatter:
        'Spotless with google-java-format or palantir-java-format (project pick). 4-space indent.',
      errorHandling:
        'Domain exceptions per BC, translated to HTTP status at controller boundary. `@Transactional` on application services, never on controllers. Use outbox for cross-BC events.',
      docRef: 'Cite [[stacks/spring-boot]] or [[stacks/quarkus]] and wiki bounded contexts.',
    },
  },
  kotlin: {
    id: 'kotlin',
    label: 'Kotlin',
    aliases: ['kotlin', '코틀린', 'kt'],
    extensions: ['.kt', '.kts'],
    manifests: ['build.gradle.kts', 'build.gradle'],
    rules: {
      naming:
        'PascalCase for classes, camelCase for functions/properties, UPPER_SNAKE for constants. Packages lowercase. Use backticks in test method names for prose.',
      structure:
        'Same BC-per-module split as Java. Prefer data classes for DTOs, sealed classes/interfaces for domain hierarchies. Coroutines for IO; prefer `suspend` over callbacks.',
      style:
        'Official Kotlin Coding Conventions. Prefer `val`. Use scope functions (`let`, `also`, ...) only when they aid readability. No platform types from Java — annotate boundaries.',
      lint: 'detekt (default config + code-complexity flavor) + ktlint for format. CI: `./gradlew detekt ktlintCheck`.',
      testing:
        'JUnit 5 + Kotest assertions + MockK. Coroutines tests with `runTest`. Awaitility for async/eventual flows.',
      formatter: 'ktlint or Spotless kotlin plugin — 4-space indent, no trailing whitespace.',
      errorHandling:
        'Sealed `Result` hierarchies per BC; `Result<T>` or typed exceptions. Domain errors must not leak JVM exception types through API boundaries.',
      docRef:
        'Cite [[stacks/kotlin-spring]] or [[stacks/kotlin-android]] and wiki bounded contexts.',
    },
  },
  csharp: {
    id: 'csharp',
    label: 'C# / .NET',
    aliases: ['csharp', 'c#', 'dotnet', '닷넷', '.net'],
    extensions: ['.cs', '.csx'],
    manifests: ['*.csproj', 'Directory.Build.props'],
    rules: {
      naming:
        'PascalCase for public members, camelCase for local variables/params, `_camelCase` for private fields. Interfaces prefixed with `I`.',
      structure:
        'Solution per BC OR Clean Architecture layers per module (`<BC>.Domain`, `<BC>.Application`, `<BC>.Infrastructure`, `<BC>.Api`). EF Core `DbContext` should be BC-scoped, not global.',
      style:
        'Prefer top-level statements for entrypoints. Use `record` for DTOs. Nullable reference types enabled project-wide (`<Nullable>enable</Nullable>`).',
      lint: 'dotnet format + Roslyn analyzers (StyleCop, Sonar, .NET analyzer). CI: `dotnet format --verify-no-changes`.',
      testing:
        'xUnit + FluentAssertions. NSubstitute for mocks. EF in-memory or Testcontainers for integration. Verify for snapshot tests when appropriate.',
      formatter:
        '`dotnet format` (EditorConfig-driven). 4-space indent, Allman braces (project default may vary).',
      errorHandling:
        'Domain exceptions per BC, mapped to ProblemDetails at API boundary. Result<T> pattern preferred for application services returning domain outcomes.',
      docRef: 'Cite [[stacks/dotnet-csharp]] and wiki bounded contexts.',
    },
  },
  php: {
    id: 'php',
    label: 'PHP',
    aliases: ['php', 'laravel', '라라벨'],
    extensions: ['.php'],
    manifests: ['composer.json', 'artisan'],
    rules: {
      naming:
        'PascalCase for classes, camelCase for methods/variables, snake_case for array keys and DB columns. PSR-1/12 baseline.',
      structure:
        'Modules or packages per domain. Form Requests for validation, controllers thin, services own use-cases. Avoid fat models — extract to domain services.',
      style:
        'Strict types declared (`declare(strict_types=1)`). Typed properties and return types on public APIs. Prefer readonly classes for immutable DTOs.',
      lint: 'PHPStan level 6+ (target 8), Larastan for Laravel, PHP-CS-Fixer or Laravel Pint for format. CI: `composer lint && composer test`.',
      testing:
        'Pest or PHPUnit + Mockery. Feature tests with fresh DB transaction per test. Use factories, not manual construction.',
      formatter: 'Laravel Pint (PHP-CS-Fixer preset). PSR-12 baseline; 4-space indent.',
      errorHandling:
        'Custom exception classes per BC, mapped to HTTP responses in handler. Never `die()` or echo errors in domain code.',
      docRef: 'Cite [[stacks/php-laravel]] and wiki bounded contexts.',
    },
  },
  ruby: {
    id: 'ruby',
    label: 'Ruby',
    aliases: ['ruby', 'rails', '레일즈', '루비'],
    extensions: ['.rb'],
    manifests: ['Gemfile', '*.gemspec', 'Rakefile'],
    rules: {
      naming:
        'snake_case for methods/variables/modules, CamelCase (CamelCase) for classes/modules, UPPER_SNAKE for constants. Predicates end with `?`, bang methods with `!`.',
      structure:
        'Rails engines or Packwerk packages per bounded context. Fat models are an anti-pattern — extract to service objects. Keep controllers thin.',
      style:
        'RuboCop defaults (Ruby-style-guide). Prefer frozen string literals. Use symbols for identifiers, strings for user content.',
      lint: 'RuboCop (rails, rspec, performance packs) + StandardRB as alternative. CI: `rubocop --parallel`.',
      testing:
        'RSpec + FactoryBot + Faker. System tests via Cuprite or Playwright. One describe per class, its/context for clarity.',
      formatter: 'RuboCop auto-correct or StandardRB. 2-space indent, no trailing whitespace.',
      errorHandling:
        'Custom exception classes per BC, rescued only at boundary. Avoid `rescue Exception` — narrow to expected types. Result objects for expected domain outcomes.',
      docRef: 'Cite [[stacks/ruby-rails]] and wiki bounded contexts.',
    },
  },
  swift: {
    id: 'swift',
    label: 'Swift',
    aliases: ['swift', '스위프트', 'ios'],
    extensions: ['.swift'],
    manifests: ['Package.swift', '*.xcodeproj', 'Podfile'],
    rules: {
      naming:
        'UpperCamelCase for types/protocols, lowerCamelCase for functions/variables/properties. Enums use lowerCamelCase cases. Acronyms fully uppercased in type names.',
      structure:
        'Feature modules with SwiftUI views + domain services. Repository protocol per BC. SPM packages preferred over CocoaPods.',
      style:
        'Swift API Design Guidelines. Use value types (struct) by default; classes only when identity/sharing needed. Prefer `guard` early-exit over deep nested `if`.',
      lint: 'SwiftLint (opt-in rules selectively) + swift-format (Apple). CI: `swiftlint --strict && swift format lint`.',
      testing:
        'XCTest or Swift Testing (new framework). Point-free snapshot testing for UI. Dependency injection via protocols for mockability.',
      formatter: 'swift-format (Apple) — 4-space default with project overrides.',
      errorHandling:
        'Typed `throws` errors per BC; `Result<Success, Failure>` for async APIs. Map domain errors to UI states at view-model boundary.',
      docRef: 'Cite [[stacks/swift-ios]] and wiki bounded contexts.',
    },
  },
  elixir: {
    id: 'elixir',
    label: 'Elixir',
    aliases: ['elixir', 'phoenix', '엘릭서'],
    extensions: ['.ex', '.exs'],
    manifests: ['mix.exs'],
    rules: {
      naming:
        'snake_case for modules/functions/variables, CamelCase module names (`MyApp.Cart`). Predicate/function ending in `?` returns boolean, bang `!` raises on failure.',
      structure:
        'Phoenix contexts = bounded contexts. One context per domain.Keep context APIs explicit; no cross-context calls into private functions.',
      style:
        'Community style guide (christopheradams/elixir_style_guide). Prefer pattern matches over guards. Use `with` for happy-path pipelining.',
      lint: 'Credo + ElixirLS formatter. Dialyxir for type checking (Warnings strict in CI over time). CI: `mix credo --strict`.',
      testing:
        'ExUnit (built-in). `Mox` for behaviour mocks. Feature tests via Phoenix.LiveViewTest. Async tests default — keep them independent.',
      formatter: 'mix format (built-in, no config recommand) — 2-space indent, line length 98.',
      errorHandling:
        'Tagged tuples `{:ok, _} | {:error, _}` for expected outcomes; `raise` only for unrecoverable. Custom exception modules per BC.',
      docRef: 'Cite [[stacks/elixir-phoenix]] and wiki bounded contexts.',
    },
  },
  scala: {
    id: 'scala',
    label: 'Scala',
    aliases: ['scala', 'play', '스칼라'],
    extensions: ['.scala', '.sc'],
    manifests: ['build.sbt', 'build.sc', 'plugins.sbt'],
    rules: {
      naming:
        'CamelCase for types/traits/objects, camelCase for methods/vals. Constants in UpperCamelCase per Scala style guide (not UPPER_SNAKE).',
      structure:
        'Modules per BC. Functional core, imperative shell — domain in pure functions, framework at edges. Avoid `null` — use `Option`/`Either`.',
      style:
        'scalafmt config committed. Prefer immutable collections (`List`, `Map`). Use `Future` over `try`/`throw`. Tagged types or newtypes for primitive IDs.',
      lint: 'scalafmt + scalafix (ExplicitNonNull, RemoveUnused) + wartremover. CI enforces scalafmtCheckAll.',
      testing:
        'ScalaTest or munit + cats-effect IO runtime. Property-based tests via ScalaCheck. Testcontainers for DB.',
      formatter: 'scalafmt — 2-space indent, project-defined max line length (default 120).',
      errorHandling:
        '`Either[DomainError, A]` or `IO[Either[Error, A]]` per BC. No exceptions in domain code — reserve for JVM-level failures only.',
      docRef: 'Cite [[stacks/scala-play]] and wiki bounded contexts.',
    },
  },
  dart: {
    id: 'dart',
    label: 'Dart / Flutter',
    aliases: ['dart', 'flutter', '플러터'],
    extensions: ['.dart'],
    manifests: ['pubspec.yaml'],
    rules: {
      naming:
        'lowerCamelCase for functions/variables, UpperCamelCase for classes/enums/typedefs, lowercase_with_underscores for files/libraries. Constants: lowerCamelCase (Dart official).',
      structure:
        'Clean architecture: presentation / domain / data per feature. Feature folders under lib/features/<bc>/. Shared widgets in lib/shared/.',
      style:
        'Dart style guide / Effective Dart. Prefer `final`/`const`. Use nullable types (`T?`) over sentinel values. Avoid `dynamic` outside generated code.',
      lint: '`flutter analyze` with `package:flutter_lints` or strict `lint` set. CI: `dart format --output=none --set-exit-if-changed`.',
      testing:
        'flutter_test (built-in) + integration_test for e2e. mocktail preferred over mockito-style. Golden tests for stable UI.',
      formatter: '`dart format` — 2-space indent, 80 col default.',
      errorHandling:
        'Either/Failure packages (fpdart or dartz) or typed Result; avoid throwing in domain. Riverpod/Bloc propagate failure as state.',
      docRef: 'Cite [[stacks/flutter]] and wiki bounded contexts.',
    },
  },
}

export const ALL_LANGUAGE_IDS = Object.keys(LANGUAGE_RULES) as LanguageId[]

export function findLanguageRules(id: string): LanguageRules | undefined {
  const lower = id.toLowerCase().trim()
  return (
    LANGUAGE_RULES[lower as LanguageId] ||
    ALL_LANGUAGE_IDS.map((l) => LANGUAGE_RULES[l]).find(
      (r) => r.aliases.some((a) => lower.includes(a.toLowerCase())) || lower.includes(r.id)
    )
  )
}

/**
 * Detect languages from existing wiki stack playbooks (e.g. `wiki/stacks/spring-boot`
 * covers java+kotlin). Returns map of languageId => supporting evidence.
 */
export function detectLanguagesFromStacks(
  stacks: { backend?: string; frontend?: string; mobile?: string; infra?: string },
  extras: string[] = []
): LanguageId[] {
  const found = new Set<LanguageId>()
  const haystack = [stacks.backend, stacks.frontend, stacks.mobile, stacks.infra, ...extras]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  for (const lang of ALL_LANGUAGE_IDS) {
    const r = LANGUAGE_RULES[lang]
    if (r.aliases.some((a) => haystack.includes(a.toLowerCase()))) {
      found.add(lang)
    }
  }
  // Backend stack → language mapping hints for frameworks that don't alias-match
  const stackToLang: Record<string, LanguageId> = {
    'spring-boot': 'java',
    'kotlin-spring': 'kotlin',
    'python-fastapi': 'python',
    'python-django': 'python',
    'python-flask': 'python',
    'go-gin': 'go',
    'go-fiber': 'go',
    'rust-actix': 'rust',
    'dotnet-csharp': 'csharp',
    'php-laravel': 'php',
    'ruby-rails': 'ruby',
    'elixir-phoenix': 'elixir',
    'scala-play': 'scala',
    'swift-ios': 'swift',
    'kotlin-android': 'kotlin',
    flutter: 'dart',
    nextjs: 'typescript',
    react: 'typescript',
    vue: 'typescript',
    nuxt: 'typescript',
    angular: 'typescript',
    svelte: 'typescript',
    solidjs: 'typescript',
    remix: 'typescript',
    'react-native': 'typescript',
  }
  for (const [, v] of Object.entries(stacks)) {
    if (!v) continue
    const mapped = stackToLang[v.toLowerCase().replace(/[\s._-]+/g, '-')]
    if (mapped) found.add(mapped)
  }
  return [...found]
}

/**
 * Render language rules into a compact markdown section suitable for injection
 * into tool rule files (Cursor MDC, CLAUDE.md, AGENTS.md, etc.). Sections that
 * are absent are omitted to keep files tight.
 */
export function renderLanguageRulesSection(
  languages: LanguageId[],
  opts?: { strictness?: 'strict' | 'standard' | 'loose' }
): string {
  if (!languages.length) return ''
  const strictness = opts?.strictness || 'standard'
  const strictnessLine = {
    strict: 'Enforce all rules as errors in CI. Fail builds on violations.',
    standard: 'Apply rules with CI warnings; failures on lint nightlies.',
    loose: 'Recommend these rules; CI only reports violations without failing.',
  }[strictness]

  const blocks: string[] = [
    '## Language coding rules (auto-detected)',
    '',
    `Applicable languages: ${languages.map((l) => LANGUAGE_RULES[l].label).join(', ')}.`,
    '',
    `**Enforcement:** ${strictnessLine}`,
    '',
  ]

  for (const langId of languages) {
    const r = LANGUAGE_RULES[langId]
    blocks.push(`### ${r.label}`)
    blocks.push('')
    const entries = Object.entries(r.rules) as [keyof LanguageRules['rules'], string | undefined][]
    for (const [key, value] of entries) {
      if (!value) continue
      blocks.push(`- **${headerFor(key)}**: ${value}`)
    }
    blocks.push('')
  }

  return blocks.join('\n').trimEnd()
}

function headerFor(key: keyof LanguageRules['rules']): string {
  const labels: Record<keyof LanguageRules['rules'], string> = {
    naming: 'Naming',
    structure: 'Structure',
    style: 'Style',
    lint: 'Lint',
    testing: 'Testing',
    formatter: 'Formatter',
    errorHandling: 'Error handling',
    docRef: 'References',
  }
  return labels[key] || key
}
