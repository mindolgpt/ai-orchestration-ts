/// <reference types="vitest/globals" />
import { describe, expect, it } from 'vitest'
import '@/static-analysis'
import { expressRouteExtractor } from '@/static-analysis/routes/express'
import { fastifyRouteExtractor } from '@/static-analysis/routes/fastify'
import { nestjsRouteExtractor } from '@/static-analysis/routes/nestjs'
import { springRouteExtractor } from '@/static-analysis/routes/spring'
import { fastapiRouteExtractor } from '@/static-analysis/routes/fastapi'
import { djangoRouteExtractor } from '@/static-analysis/routes/django'
import { ginRouteExtractor } from '@/static-analysis/routes/gin'
import { axumRouteExtractor } from '@/static-analysis/routes/axum'
import { typescriptPlugin } from '@/static-analysis/languages/typescript'
import { pythonPlugin } from '@/static-analysis/languages/python'
import { goPlugin } from '@/static-analysis/languages/go'
import { rustPlugin } from '@/static-analysis/languages/rust'

describe('route extractors (regression: exec("") bug)', () => {
  it('express: extracts from rawContent (was empty-string bug)', () => {
    const src = `import express from 'express'
const app = express()
app.get('/users', (req, res) => res.json([]))
router.post('/items', handler)`
    const f = typescriptPlugin.parse(src, '/x/routes.ts')
    const routes = expressRouteExtractor.extract([f])
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(['GET /users', 'POST /items'])
    )
  })

  it('fastify: extracts from rawContent', () => {
    const src = `app.get('/health', async () => ({ ok: true }))
server.post('/orders', createOrder)`
    const f = typescriptPlugin.parse(src, '/x/fast.ts')
    const routes = fastifyRouteExtractor.extract([f])
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(['GET /health', 'POST /orders'])
    )
  })

  it('nestjs: composes controller base + method path', () => {
    const src = `@Controller('/api/users')
export class UsersController {
  @Get('/:id') findOne() {}
  @Post('/') create() {}
}`
    const f = typescriptPlugin.parse(src, '/x/users.controller.ts')
    const routes = nestjsRouteExtractor.extract([f])
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(['GET /api/users/:id', 'POST /api/users/'])
    )
    expect(routes.every((r) => r.controller === 'UsersController')).toBe(true)
  })

  it('spring: composes class-level @RequestMapping with method mappings', () => {
    const src = `@RestController
@RequestMapping("/api")
public class UsersController {
  @GetMapping("/users") public List<User> list() {}
  @PostMapping("/users") public User create() {}
}`
    const f = typescriptPlugin.parse(src, '/x/UsersController.java')
    // Spring extractor is language='java'; feed a CodeFile with language='java'
    const javaFile = { ...f, language: 'java', rawContent: src }
    const routes = springRouteExtractor.extract([javaFile])
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(['GET /api/users', 'POST /api/users'])
    )
  })

  it('fastapi: extracts @app.get / @router.post', () => {
    const src = `from fastapi import APIRouter
router = APIRouter()

@router.get("/items")
async def list_items(): pass

@app.post("/orders")
async def create_order(): pass`
    const f = pythonPlugin.parse(src, '/x/api.py')
    const routes = fastapiRouteExtractor.extract([f])
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(['GET /items', 'POST /orders'])
    )
  })

  it('django: extracts path() entries inside urlpatterns', () => {
    const src = `from django.urls import path
from . import views

urlpatterns = [
    path('users/', views.user_list),
    path('users/<int:pk>/', views.user_detail),
]`
    const f = pythonPlugin.parse(src, '/x/urls.py')
    const routes = djangoRouteExtractor.extract([f])
    expect(routes.map((r) => r.path)).toEqual(expect.arrayContaining(['users/', 'users/<int:pk>/']))
  })

  it('gin: extracts r.GET / router.POST', () => {
    const src = `func main() {
  r := gin.Default()
  r.GET("/ping", ping)
  router.POST("/submit", submit)
}`
    const f = goPlugin.parse(src, '/x/main.go')
    const routes = ginRouteExtractor.extract([f])
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(['GET /ping', 'POST /submit'])
    )
  })

  it('axum: extracts .route("/path", get(handler))', () => {
    const src = `let app = Router::new()
    .route("/health", get(health))
    .route("/users", post(create_user));`
    const f = rustPlugin.parse(src, '/x/main.rs')
    const routes = axumRouteExtractor.extract([f])
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(['GET /health', 'POST /users'])
    )
  })
})
