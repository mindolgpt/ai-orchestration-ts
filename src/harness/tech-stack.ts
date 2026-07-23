import { LanguageId } from '@/harness/language-rules'

export type PackageManager = 'npm' | 'pnpm' | 'yarn'
export type MonorepoTool = 'npm-workspaces' | 'pnpm-workspaces' | 'turborepo' | 'none'

export interface TechStackChoice {
  side: 'frontend' | 'backend'
  language: LanguageId
  framework: string
  ui?: string
  state?: string
  data_fetching?: string
  orm?: string
  validation?: string
  messaging?: string
  test_unit?: string
  test_e2e?: string
  package_manager?: PackageManager
  monorepo_tool?: MonorepoTool
  extras?: string[]
}

interface StackOption {
  framework: string
  label: string
  defaults?: Partial<TechStackChoice>
}

const FE_BY_LANG: Partial<Record<LanguageId, StackOption[]>> = {
  typescript: [
    {
      framework: 'nextjs',
      label: 'Next.js',
      defaults: {
        ui: 'tailwind',
        state: 'zustand',
        data_fetching: 'tanstack-query',
        test_unit: 'vitest',
        test_e2e: 'playwright',
        validation: 'zod',
      },
    },
    {
      framework: 'react',
      label: 'React (Vite)',
      defaults: {
        ui: 'tailwind',
        state: 'zustand',
        data_fetching: 'tanstack-query',
        test_unit: 'vitest',
      },
    },
    {
      framework: 'vue',
      label: 'Vue 3',
      defaults: { ui: 'tailwind', test_unit: 'vitest' },
    },
    {
      framework: 'nuxt',
      label: 'Nuxt 3',
      defaults: { ui: 'tailwind', test_unit: 'vitest' },
    },
  ],
  javascript: [
    {
      framework: 'react',
      label: 'React',
      defaults: { test_unit: 'vitest' },
    },
  ],
  dart: [
    {
      framework: 'flutter',
      label: 'Flutter',
      defaults: { test_unit: 'flutter_test' },
    },
  ],
}

const BE_BY_LANG: Partial<Record<LanguageId, StackOption[]>> = {
  typescript: [
    {
      framework: 'nestjs',
      label: 'NestJS',
      defaults: { orm: 'prisma', validation: 'zod', test_unit: 'vitest' },
    },
    {
      framework: 'express',
      label: 'Express',
      defaults: { orm: 'prisma', validation: 'zod', test_unit: 'vitest' },
    },
    {
      framework: 'fastify',
      label: 'Fastify',
      defaults: { orm: 'prisma', validation: 'zod', test_unit: 'vitest' },
    },
  ],
  java: [
    {
      framework: 'spring-boot',
      label: 'Spring Boot',
      defaults: { orm: 'jpa', validation: 'bean-validation', test_unit: 'junit' },
    },
  ],
  kotlin: [
    {
      framework: 'spring-boot',
      label: 'Spring Boot (Kotlin)',
      defaults: { orm: 'jpa', validation: 'bean-validation', test_unit: 'junit' },
    },
  ],
  python: [
    {
      framework: 'fastapi',
      label: 'FastAPI',
      defaults: { orm: 'sqlalchemy', validation: 'pydantic', test_unit: 'pytest' },
    },
    {
      framework: 'django',
      label: 'Django',
      defaults: { orm: 'django-orm', test_unit: 'pytest' },
    },
  ],
  go: [
    {
      framework: 'chi',
      label: 'Go chi',
      defaults: { test_unit: 'go-test' },
    },
    {
      framework: 'echo',
      label: 'Go echo',
      defaults: { test_unit: 'go-test' },
    },
    {
      framework: 'fiber',
      label: 'Go fiber',
      defaults: { test_unit: 'go-test' },
    },
  ],
  rust: [
    {
      framework: 'axum',
      label: 'Axum',
      defaults: { test_unit: 'cargo-test' },
    },
  ],
  csharp: [
    {
      framework: 'aspnet',
      label: 'ASP.NET Core',
      defaults: { orm: 'efcore', test_unit: 'xunit' },
    },
  ],
}

export function listStackOptions(
  side: 'frontend' | 'backend',
  language: LanguageId
): StackOption[] {
  const map = side === 'frontend' ? FE_BY_LANG : BE_BY_LANG
  return map[language] || []
}

export function recommendTechStack(
  side: 'frontend' | 'backend',
  language: LanguageId,
  partial?: Partial<TechStackChoice>
): TechStackChoice {
  const options = listStackOptions(side, language)
  const picked = options.find((o) => o.framework === partial?.framework) ||
    options[0] || {
      framework: side === 'frontend' ? 'react' : 'express',
      label: 'default',
      defaults: {},
    }
  return {
    package_manager: partial?.package_manager || 'npm',
    monorepo_tool: partial?.monorepo_tool || 'npm-workspaces',
    ...picked.defaults,
    ...partial,
    side,
    language,
    framework: partial?.framework || picked.framework,
  }
}

export function renderTechStackSection(choices: {
  frontend?: TechStackChoice
  backend?: TechStackChoice
  package_manager?: PackageManager
  monorepo_tool?: MonorepoTool
}): string {
  const lines: string[] = ['# Tech stack', '']
  if (choices.package_manager || choices.monorepo_tool) {
    lines.push('## Workspace')
    lines.push('')
    if (choices.package_manager) lines.push(`- Package manager: **${choices.package_manager}**`)
    if (choices.monorepo_tool) lines.push(`- Monorepo: **${choices.monorepo_tool}**`)
    lines.push('')
  }
  for (const [label, stack] of [
    ['Frontend', choices.frontend],
    ['Backend', choices.backend],
  ] as const) {
    if (!stack) continue
    lines.push(`## ${label} tech stack (${stack.language})`)
    lines.push('')
    lines.push(`- Framework: **${stack.framework}**`)
    for (const [k, v] of Object.entries(stack)) {
      if (
        ['side', 'language', 'framework', 'extras', 'package_manager', 'monorepo_tool'].includes(k)
      )
        continue
      if (v) lines.push(`- ${k}: **${v}**`)
    }
    if (stack.extras?.length) lines.push(`- extras: ${stack.extras.join(', ')}`)
    lines.push('')
  }
  return lines.join('\n')
}
