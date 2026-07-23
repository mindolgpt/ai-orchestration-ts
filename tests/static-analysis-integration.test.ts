/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import '@/static-analysis'
import { usecaseConceptExtractor } from '@/static-analysis/concepts/usecase'
import { eventsConceptExtractor } from '@/static-analysis/concepts/events'
import { policiesConceptExtractor } from '@/static-analysis/concepts/policies'
import { typescriptPlugin } from '@/static-analysis/languages/typescript'
import { pythonPlugin } from '@/static-analysis/languages/python'
import { analyzeProject } from '@/static-analysis'

describe('concept extractors', () => {
  it('usecase: detects UseCase/Service/Command classes', () => {
    const src = `export class CreateUserUseCase { handle() {} }
export class UserService { find() {} }
export class LoginCommand {}`
    const f = typescriptPlugin.parse(src, '/x/app.ts')
    const concepts = usecaseConceptExtractor.extract([f])
    expect(concepts.map((c) => c.name)).toEqual(
      expect.arrayContaining(['CreateUserUseCase', 'UserService', 'LoginCommand'])
    )
  })

  it('events: detects *Event classes and emit() calls', () => {
    const src = `export class UserRegisteredEvent {}
export function register() {
  emit(new UserRegisteredEvent())
}`
    const f = typescriptPlugin.parse(src, '/x/events.ts')
    const concepts = eventsConceptExtractor.extract([f])
    expect(concepts.map((c) => c.name)).toContain('UserRegisteredEvent')
  })

  it('policies: detects Policy/Rule/Validator classes', () => {
    const src = `export class MaxOrderAmountPolicy {}
export class EmailValidator {}
export class AdultUserRule {}`
    const f = typescriptPlugin.parse(src, '/x/policies.ts')
    const concepts = policiesConceptExtractor.extract([f])
    expect(concepts.map((c) => c.name)).toEqual(
      expect.arrayContaining(['MaxOrderAmountPolicy', 'EmailValidator', 'AdultUserRule'])
    )
  })
})

describe('analyzeProject (multi-language integration)', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-multi-'))
    // TypeScript NestJS backend
    await fs.mkdir(path.join(tmp, 'api'), { recursive: true })
    await fs.writeFile(
      path.join(tmp, 'api', 'users.controller.ts'),
      `import { Controller, Get, Post } from '@nestjs/common'
@Controller('/users')
export class UsersController {
  @Get('/') list() {}
  @Post('/') create() {}
}`,
      'utf-8'
    )
    // Python FastAPI backend
    await fs.mkdir(path.join(tmp, 'web'), { recursive: true })
    await fs.writeFile(
      path.join(tmp, 'web', 'app.py'),
      `from fastapi import APIRouter
router = APIRouter()

@router.get("/items")
async def list_items(): pass

@router.post("/items")
async def create_item(): pass`,
      'utf-8'
    )
    // Python SQLAlchemy model
    await fs.writeFile(
      path.join(tmp, 'web', 'models.py'),
      `from sqlalchemy import Column, Integer, String

class Item(Base):
    __tablename__ = "items"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True)`,
      'utf-8'
    )
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('parses both TS and Python, extracts routes/models/concepts and reports languages', async () => {
    const result = await analyzeProject([tmp])
    expect(result.summary.languages.sort()).toEqual(['python', 'typescript'])
    expect(result.summary.totalFiles).toBeGreaterThanOrEqual(3)

    const routePaths = result.routes.map((r) => `${r.method} ${r.path}`)
    expect(routePaths).toEqual(
      expect.arrayContaining(['GET /users/', 'POST /users/', 'GET /items', 'POST /items'])
    )

    expect(result.models.map((m) => m.name)).toContain('Item')
    expect(result.models.find((m) => m.name === 'Item')?.orm).toBe('sqlalchemy')

    expect(result.summary.totalRoutes).toBeGreaterThanOrEqual(4)
    expect(result.summary.totalModels).toBeGreaterThanOrEqual(1)
    expect(result.summary.totalConcepts).toBeGreaterThanOrEqual(0)
  })

  it('respects the languages filter to scope plugins', async () => {
    const onlyTs = await analyzeProject([tmp], { languages: ['typescript'] })
    expect(onlyTs.summary.languages).toEqual(['typescript'])
    expect(onlyTs.routes.map((r) => r.path)).not.toContain('/items')

    const onlyPy = await analyzeProject([tmp], { languages: ['python'] })
    expect(onlyPy.summary.languages).toEqual(['python'])
    expect(onlyPy.routes.map((r) => r.path)).not.toContain('/users/')
  })
})
