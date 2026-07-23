import * as fs from 'fs/promises'
import * as path from 'path'
import { resolveProjectRoot } from '@/knowledge/paths'
import type { TechStackChoice, PackageManager, MonorepoTool } from '@/harness/tech-stack'
import type { MethodologyId } from '@/harness/architecture-methodology'
import { getMethodology } from '@/harness/architecture-methodology'

export interface ScaffoldOptions {
  projectRoot?: string
  frontend?: Partial<TechStackChoice>
  backend?: Partial<TechStackChoice>
  package_manager?: PackageManager
  monorepo_tool?: MonorepoTool
  frontend_architecture?: MethodologyId
  backend_architecture?: MethodologyId
  has_source?: boolean
  force?: boolean
  skip_apps?: boolean
  include_contracts?: boolean
}

export interface ScaffoldFileResult {
  path: string
  action: 'created' | 'updated' | 'skipped'
}

export interface ScaffoldResult {
  ok: boolean
  project_root: string
  skipped_reason?: string
  files: ScaffoldFileResult[]
  apps: string[]
}

async function write(
  abs: string,
  content: string,
  force: boolean,
  files: ScaffoldFileResult[]
): Promise<void> {
  try {
    await fs.access(abs)
    if (!force) {
      files.push({ path: abs, action: 'skipped' })
      return
    }
  } catch {
    /* create */
  }
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf-8')
  files.push({ path: abs, action: force ? 'updated' : 'created' })
}

function nextAppFiles(arch?: MethodologyId): Record<string, string> {
  const m = arch ? getMethodology(arch) : undefined
  const layoutNote = m?.folder_layout.join('\n') || 'src/app, src/features, src/shared'
  return {
    'package.json': JSON.stringify(
      {
        name: '@app/web',
        private: true,
        scripts: {
          dev: 'next dev',
          build: 'next build',
          lint: 'echo "add eslint"',
          test: 'echo "add vitest"',
          typecheck: 'tsc -p tsconfig.json --noEmit',
        },
        dependencies: {
          next: '^15.0.0',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          '@app/contracts': '*',
        },
        devDependencies: {
          typescript: '^5.6.0',
          '@types/react': '^19.0.0',
          '@types/node': '^22.0.0',
        },
      },
      null,
      2
    ),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          jsx: 'preserve',
          moduleResolution: 'bundler',
          strict: true,
          skipLibCheck: true,
          paths: { '@app/contracts': ['../../packages/contracts/src'] },
        },
        include: ['src/**/*', 'next-env.d.ts'],
      },
      null,
      2
    ),
    'src/app/page.tsx': `export default function Home() {\n  return <main><h1>Web app</h1></main>\n}\n`,
    'src/app/layout.tsx': `export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html><body>{children}</body></html>\n}\n`,
    'README.md': `# Web\n\nArchitecture layout:\n\`\`\`\n${layoutNote}\n\`\`\`\n`,
  }
}

function nestAppFiles(arch?: MethodologyId): Record<string, string> {
  const m = arch ? getMethodology(arch) : undefined
  const layoutNote =
    m?.folder_layout.join('\n') || 'src/domain, src/application, src/infrastructure'
  return {
    'package.json': JSON.stringify(
      {
        name: '@app/api',
        private: true,
        scripts: {
          dev: 'tsx watch src/main.ts',
          build: 'tsc -p tsconfig.json',
          lint: 'echo "add eslint"',
          test: 'echo "add vitest"',
          typecheck: 'tsc -p tsconfig.json --noEmit',
        },
        dependencies: {
          '@app/contracts': '*',
          '@nestjs/common': '^10.0.0',
          '@nestjs/core': '^10.0.0',
          'reflect-metadata': '^0.2.0',
          rxjs: '^7.8.0',
        },
        devDependencies: { typescript: '^5.6.0', tsx: '^4.0.0', '@types/node': '^22.0.0' },
      },
      null,
      2
    ),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'commonjs',
          strict: true,
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          outDir: 'dist',
          paths: { '@app/contracts': ['../../packages/contracts/src'] },
        },
        include: ['src/**/*'],
      },
      null,
      2
    ),
    'src/main.ts': `console.log('API bootstrap — wire NestJS/Express here')\n`,
    'src/domain/.gitkeep': '',
    'src/application/.gitkeep': '',
    'src/infrastructure/.gitkeep': '',
    'README.md': `# API\n\nArchitecture layout:\n\`\`\`\n${layoutNote}\n\`\`\`\n`,
  }
}

function expressAppFiles(arch?: MethodologyId): Record<string, string> {
  return {
    'package.json': JSON.stringify(
      {
        name: '@app/api',
        private: true,
        scripts: {
          dev: 'tsx watch src/main.ts',
          build: 'tsc -p tsconfig.json',
          typecheck: 'tsc -p tsconfig.json --noEmit',
          test: 'echo "add tests"',
          lint: 'echo "add lint"',
        },
        dependencies: { express: '^4.21.0', '@app/contracts': '*' },
        devDependencies: {
          typescript: '^5.6.0',
          tsx: '^4.0.0',
          '@types/express': '^4.17.0',
          '@types/node': '^22.0.0',
        },
      },
      null,
      2
    ),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'commonjs',
          strict: true,
          esModuleInterop: true,
          outDir: 'dist',
        },
        include: ['src/**/*'],
      },
      null,
      2
    ),
    'src/main.ts': `import express from 'express'\nconst app = express()\napp.get('/health', (_req, res) => res.json({ ok: true }))\napp.listen(3001, () => console.log('api :3001'))\n`,
    'README.md': `# API (Express)\n\nArch: ${arch || 'clean'}\n`,
  }
}

function reactAppFiles(arch?: MethodologyId): Record<string, string> {
  return {
    'package.json': JSON.stringify(
      {
        name: '@app/web',
        private: true,
        scripts: {
          dev: 'vite',
          build: 'vite build',
          typecheck: 'tsc --noEmit',
          test: 'echo "add vitest"',
          lint: 'echo "add lint"',
        },
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', '@app/contracts': '*' },
        devDependencies: { typescript: '^5.6.0', vite: '^6.0.0', '@types/react': '^19.0.0' },
      },
      null,
      2
    ),
    'index.html': `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`,
    'src/main.tsx': `import { createRoot } from 'react-dom/client'\ncreateRoot(document.getElementById('root')!).render(<h1>Web</h1>)\n`,
    'README.md': `# Web (React)\n\nArch: ${arch || 'feature-sliced'}\n`,
  }
}

function contractsFiles(): Record<string, string> {
  return {
    'package.json': JSON.stringify(
      {
        name: '@app/contracts',
        version: '0.0.1',
        private: true,
        main: 'src/index.ts',
        types: 'src/index.ts',
        scripts: { typecheck: 'tsc -p tsconfig.json --noEmit' },
        devDependencies: { typescript: '^5.6.0', zod: '^3.23.0' },
        dependencies: { zod: '^3.23.0' },
      },
      null,
      2
    ),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          declaration: true,
        },
        include: ['src/**/*'],
      },
      null,
      2
    ),
    'src/index.ts': `import { z } from 'zod'\n\nexport const HealthSchema = z.object({ ok: z.boolean() })\nexport type Health = z.infer<typeof HealthSchema>\n\n/** Shared FE/BE contracts — change here first when APIs evolve. */\nexport const contractsVersion = '0.0.1'\n`,
    'README.md': `# @app/contracts\n\nShared API contracts (zod / DTO). Frontend and backend must import from here.\n`,
  }
}

function springApiFiles(): Record<string, string> {
  return {
    'build.gradle.kts': `plugins {\n  id("org.springframework.boot") version "3.3.0"\n  id("io.spring.dependency-management") version "1.1.5"\n  kotlin("jvm") version "2.0.0"\n  kotlin("plugin.spring") version "2.0.0"\n}\n\ndependencies {\n  implementation("org.springframework.boot:spring-boot-starter-web")\n}\n`,
    'src/main/kotlin/com/app/Application.kt': `package com.app\n\nfun main() {\n  println("Spring API scaffold")\n}\n`,
    'README.md': `# API (Spring Boot skeleton)\n`,
  }
}

export async function scaffoldApps(opts: ScaffoldOptions = {}): Promise<ScaffoldResult> {
  const root = path.resolve(opts.projectRoot || resolveProjectRoot())
  const files: ScaffoldFileResult[] = []
  const force = opts.force === true
  const apps: string[] = []

  if (opts.has_source && !force) {
    return {
      ok: true,
      project_root: root,
      skipped_reason: 'Existing source detected — scaffold skipped (pass force:true to overwrite)',
      files: [],
      apps: [],
    }
  }

  if (opts.skip_apps) {
    return { ok: true, project_root: root, skipped_reason: 'skip_apps', files: [], apps: [] }
  }

  const includeContracts = opts.include_contracts !== false
  if (includeContracts) {
    const cdir = path.join(root, 'packages', 'contracts')
    for (const [rel, body] of Object.entries(contractsFiles())) {
      await write(path.join(cdir, rel), body, force, files)
    }
    apps.push('packages/contracts')
  }

  const feFw = (opts.frontend?.framework || 'nextjs').toLowerCase()
  const beFw = (opts.backend?.framework || 'nestjs').toLowerCase()

  const webFiles = feFw.includes('next')
    ? nextAppFiles(opts.frontend_architecture)
    : reactAppFiles(opts.frontend_architecture)
  const webDir = path.join(root, 'apps', 'web')
  for (const [rel, body] of Object.entries(webFiles)) {
    await write(path.join(webDir, rel), body, force, files)
  }
  apps.push('apps/web')

  let apiFiles: Record<string, string>
  if (beFw.includes('spring')) apiFiles = springApiFiles()
  else if (beFw.includes('express') || beFw.includes('fastify'))
    apiFiles = expressAppFiles(opts.backend_architecture)
  else apiFiles = nestAppFiles(opts.backend_architecture)

  const apiDir = path.join(root, 'apps', 'api')
  for (const [rel, body] of Object.entries(apiFiles)) {
    await write(path.join(apiDir, rel), body, force, files)
  }
  apps.push('apps/api')

  const rootPkgPath = path.join(root, 'package.json')
  let rootPkg: Record<string, unknown> = {
    name: 'app-monorepo',
    private: true,
    workspaces: ['apps/*', 'packages/*'],
    scripts: {
      build: 'npm run build -w @app/web && npm run build -w @app/api',
      lint: 'echo "lint workspaces"',
      test: 'echo "test workspaces"',
      typecheck:
        'npm run typecheck -w @app/contracts && npm run typecheck -w @app/web && npm run typecheck -w @app/api',
    },
  }
  try {
    const existing = JSON.parse(await fs.readFile(rootPkgPath, 'utf-8')) as Record<string, unknown>
    rootPkg = {
      ...existing,
      private: true,
      workspaces: existing.workspaces || rootPkg.workspaces,
      scripts: { ...(existing.scripts as object), ...(rootPkg.scripts as object) },
    }
  } catch {
    /* new */
  }
  await write(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n', force, files)

  return { ok: true, project_root: root, files, apps }
}
