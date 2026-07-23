import { LanguageId } from '@/harness/language-rules'

export type MethodologyId =
  | 'feature-sliced'
  | 'clean'
  | 'hexagonal'
  | 'pages-modules'
  | 'composables-layers'
  | 'modular-monolith'
  | 'layered'
  | 'ddd'
  | 'ddd-lite'
  | 'std-layout'

export interface ArchitectureMethodology {
  id: MethodologyId
  label: string
  side: 'frontend' | 'backend' | 'both'
  applies_to: string[]
  summary: string
  layers: string[]
  folder_layout: string[]
  dependency_rules: string[]
  testing_pyramid: string
  anti_patterns: string[]
}

export const METHODOLOGIES: ArchitectureMethodology[] = [
  {
    id: 'feature-sliced',
    label: 'Feature-Sliced Design',
    side: 'frontend',
    applies_to: ['typescript', 'javascript', 'nextjs', 'react', 'vue', 'nuxt'],
    summary: 'Slice UI by business features; shared only via shared/entities layers.',
    layers: ['app', 'pages/screens', 'features', 'entities', 'shared'],
    folder_layout: [
      'apps/web/src/app',
      'apps/web/src/features/<bc>/{ui,model,api}',
      'apps/web/src/entities/<entity>',
      'apps/web/src/shared',
    ],
    dependency_rules: [
      'features must not import other features directly',
      'shared must not import features/entities',
    ],
    testing_pyramid: 'unit (features) > integration (pages) > e2e smoke',
    anti_patterns: ['god components', 'cross-feature deep imports'],
  },
  {
    id: 'pages-modules',
    label: 'Pages + Modules',
    side: 'frontend',
    applies_to: ['typescript', 'javascript', 'nextjs', 'react'],
    summary: 'Route-centric pages with colocated modules.',
    layers: ['pages', 'modules', 'shared'],
    folder_layout: ['apps/web/src/pages', 'apps/web/src/modules/<name>', 'apps/web/src/shared'],
    dependency_rules: ['pages may import modules; modules must not import pages'],
    testing_pyramid: 'unit > page integration > e2e',
    anti_patterns: ['business logic in page components only'],
  },
  {
    id: 'composables-layers',
    label: 'Composables Layers',
    side: 'frontend',
    applies_to: ['vue', 'nuxt', 'typescript'],
    summary: 'Vue composables + layered presentation/domain/data.',
    layers: ['presentation', 'composables/domain', 'data'],
    folder_layout: ['apps/web/composables', 'apps/web/components', 'apps/web/services'],
    dependency_rules: ['composables must not import components'],
    testing_pyramid: 'unit composables > component > e2e',
    anti_patterns: ['API calls inside components'],
  },
  {
    id: 'clean',
    label: 'Clean Architecture',
    side: 'both',
    applies_to: [
      'typescript',
      'nestjs',
      'express',
      'java',
      'kotlin',
      'spring-boot',
      'python',
      'fastapi',
      'nextjs',
      'react',
    ],
    summary: 'Domain at center; dependencies point inward.',
    layers: ['domain', 'application', 'infrastructure', 'presentation/api'],
    folder_layout: [
      'apps/api/src/domain',
      'apps/api/src/application',
      'apps/api/src/infrastructure',
      'apps/api/src/interfaces',
    ],
    dependency_rules: [
      'domain must not import infrastructure',
      'application depends on domain only via ports',
    ],
    testing_pyramid: 'unit domain/app > integration adapters > e2e API',
    anti_patterns: ['anemic domain with all logic in controllers'],
  },
  {
    id: 'hexagonal',
    label: 'Hexagonal (Ports & Adapters)',
    side: 'backend',
    applies_to: ['typescript', 'nestjs', 'go', 'java', 'kotlin', 'python', 'rust'],
    summary: 'Core application behind ports; adapters for IO.',
    layers: ['domain', 'application/ports', 'adapters/in', 'adapters/out'],
    folder_layout: [
      'apps/api/src/core',
      'apps/api/src/ports',
      'apps/api/src/adapters/http',
      'apps/api/src/adapters/persistence',
    ],
    dependency_rules: ['adapters depend on ports; core must not depend on adapters'],
    testing_pyramid: 'unit core > adapter contract tests > e2e',
    anti_patterns: ['leaking framework types into core'],
  },
  {
    id: 'layered',
    label: 'Classic Layered',
    side: 'backend',
    applies_to: ['java', 'kotlin', 'spring-boot', 'csharp', 'python'],
    summary: 'Controller → Service → Repository layers.',
    layers: ['controller', 'service', 'repository'],
    folder_layout: [
      'apps/api/src/controllers',
      'apps/api/src/services',
      'apps/api/src/repositories',
    ],
    dependency_rules: ['controllers must not call repositories directly'],
    testing_pyramid: 'unit services > slice tests > e2e',
    anti_patterns: ['fat controllers'],
  },
  {
    id: 'modular-monolith',
    label: 'Modular Monolith',
    side: 'backend',
    applies_to: ['typescript', 'nestjs', 'java', 'kotlin', 'spring-boot'],
    summary: 'One deployable with strict module boundaries per BC.',
    layers: ['modules/<bc>/{domain,application,infra,api}'],
    folder_layout: ['apps/api/src/modules/<bc>/{domain,application,infrastructure,api}'],
    dependency_rules: ['cross-module only via public API / events'],
    testing_pyramid: 'module unit > module integration > e2e',
    anti_patterns: ['shared database tables across modules without ownership'],
  },
  {
    id: 'ddd',
    label: 'DDD',
    side: 'backend',
    applies_to: ['java', 'kotlin', 'spring-boot', 'csharp', 'typescript'],
    summary: 'Bounded contexts, aggregates, ubiquitous language.',
    layers: ['domain aggregates', 'application services', 'infrastructure'],
    folder_layout: ['apps/api/src/<bc>/{domain,application,infrastructure}'],
    dependency_rules: ['aggregates enforce invariants; no anemic setters across BC'],
    testing_pyramid: 'domain unit > application > e2e',
    anti_patterns: ['shared kernel dumping ground'],
  },
  {
    id: 'ddd-lite',
    label: 'DDD-lite',
    side: 'backend',
    applies_to: ['typescript', 'nestjs', 'express'],
    summary: 'BC modules with aggregates where complexity warrants it.',
    layers: ['modules/<bc>', 'shared/kernel'],
    folder_layout: ['apps/api/src/modules/<bc>', 'apps/api/src/shared'],
    dependency_rules: ['prefer module public API over deep imports'],
    testing_pyramid: 'unit > integration > e2e',
    anti_patterns: ['over-modeling simple CRUD as aggregates'],
  },
  {
    id: 'std-layout',
    label: 'Language std layout',
    side: 'backend',
    applies_to: ['go', 'rust'],
    summary: 'Idiomatic cmd/internal or src layout.',
    layers: ['cmd', 'internal', 'pkg'],
    folder_layout: ['apps/api/cmd', 'apps/api/internal', 'apps/api/pkg'],
    dependency_rules: ['internal must not be imported by external modules'],
    testing_pyramid: 'unit internal > integration > e2e',
    anti_patterns: ['everything in main package'],
  },
]

export function listMethodologies(
  side: 'frontend' | 'backend',
  language: LanguageId,
  framework?: string
): ArchitectureMethodology[] {
  const keys = [language, framework || ''].map((s) => s.toLowerCase())
  return METHODOLOGIES.filter((m) => {
    if (m.side !== side && m.side !== 'both') return false
    return m.applies_to.some((a) => keys.includes(a.toLowerCase()))
  })
}

export function recommendMethodology(
  side: 'frontend' | 'backend',
  language: LanguageId,
  framework?: string
): ArchitectureMethodology {
  const list = listMethodologies(side, language, framework)
  if (side === 'frontend') {
    return list.find((m) => m.id === 'feature-sliced') || list[0] || METHODOLOGIES[0]
  }
  if (language === 'go') {
    return list.find((m) => m.id === 'hexagonal') || list[0] || METHODOLOGIES[4]
  }
  return list.find((m) => m.id === 'clean') || list[0] || METHODOLOGIES[3]
}

export function getMethodology(id: MethodologyId): ArchitectureMethodology | undefined {
  return METHODOLOGIES.find((m) => m.id === id)
}

export function renderArchitectureMethodologySection(opts: {
  frontend?: MethodologyId
  backend?: MethodologyId
}): string {
  const lines = ['# Architecture methodologies', '']
  for (const [label, id] of [
    ['Frontend', opts.frontend],
    ['Backend', opts.backend],
  ] as const) {
    if (!id) continue
    const m = getMethodology(id)
    if (!m) continue
    lines.push(`## ${label} architecture (${m.id})`)
    lines.push('')
    lines.push(m.summary)
    lines.push('')
    lines.push('### Layers')
    lines.push(...m.layers.map((l) => `- ${l}`))
    lines.push('')
    lines.push('### Folder layout')
    lines.push(...m.folder_layout.map((l) => `- \`${l}\``))
    lines.push('')
    lines.push('### Dependency rules')
    lines.push(...m.dependency_rules.map((l) => `- ${l}`))
    lines.push('')
    lines.push(`### Testing: ${m.testing_pyramid}`)
    lines.push('')
    lines.push('### Anti-patterns')
    lines.push(...m.anti_patterns.map((l) => `- ${l}`))
    lines.push('')
  }
  return lines.join('\n')
}
