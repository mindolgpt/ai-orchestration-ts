/// <reference types="vitest/globals" />
import { routePrompt, routePromptToTool } from '../src/harness/prompt-router'
import { detectStacksFromText } from '../src/harness/stack-playbooks'
import { ALL_TOOL_IDS } from '../src/harness/tool-keywords'

describe('keyword routePrompt — harness', () => {
  test('하네스 keyword', () => {
    const r = routePrompt('하네스 좀')
    expect(r.tool).toBe('bootstrap_harness')
    expect(r.score).toBeGreaterThan(0)
  })

  test('architecture keyword', () => {
    const r = routePrompt('Spring React 아키텍처')
    expect(r.tool).toBe('design_architecture')
  })

  test('planning keyword routes brainstorm', () => {
    const r = routePrompt('체크아웃 기획 도와줘')
    expect(r.tool).toBe('brainstorm_design')
  })

  test('ux design keyword', () => {
    const r = routePrompt('결제 화면 UX 디자인 방향')
    expect(r.tool).toBe('brainstorm_design')
  })
})

describe('keyword routePrompt — wiki', () => {
  test('wiki 검색', () => {
    const r = routePrompt('wiki 검색 장바구니 규칙')
    expect(r.tool).toBe('query_wiki')
    expect(r.extracted_params?.query).toContain('장바구니')
  })

  test('wiki lint', () => {
    const r = routePrompt('wiki lint deep')
    expect(r.tool).toBe('lint_wiki')
  })

  test('file back', () => {
    const r = routePrompt('결정사항 wiki 반영')
    expect(r.tool).toBe('file_back')
  })
})

describe('keyword routePrompt — session', () => {
  test('spawn session', () => {
    const r = routePrompt('병렬 세션 띄워서 API 만들어')
    expect(r.tool).toBe('spawn_session')
  })

  test('check inbox', () => {
    const r = routePrompt('인박스 확인')
    expect(r.tool).toBe('check_inbox')
  })

  test('list sessions', () => {
    const r = routePrompt('세션 목록')
    expect(r.tool).toBe('list_sessions')
  })
})

describe('keyword routePrompt — dag & branch', () => {
  test('plan task', () => {
    const r = routePrompt('결제 모듈 plan task')
    expect(r.tool).toBe('plan_task')
  })

  test('execute dag', () => {
    const r = routePrompt('DAG 실행 resume')
    expect(r.tool).toBe('execute_dag')
  })

  test('scan issues', () => {
    const r = routePrompt('TODO 스캔 fix')
    expect(r.tool).toBe('scan_issues')
  })
})

describe('keyword routePrompt — ops & knowledge', () => {
  test('run doctor keyword', () => {
    const r = routePrompt('프로젝트 진단 해줘')
    expect(r.tool).toBe('run_doctor')
  })

  test('recall knowledge', () => {
    const r = routePrompt('지식 검색 결제')
    expect(r.tool).toBe('recall_knowledge')
  })

  test('request approval', () => {
    const r = routePrompt('배포 승인 요청')
    expect(r.tool).toBe('request_approval')
  })
})

describe('routePromptToTool explicit', () => {
  test('forces tool by id', () => {
    const r = routePromptToTool('anything', 'lint_wiki')
    expect(r.tool).toBe('lint_wiki')
    expect(r.confidence).toBe(1)
  })
})

describe('detectStacksFromText', () => {
  test('extracts next and kotlin', () => {
    const s = detectStacksFromText('Next.js frontend with Kotlin backend')
    expect(s.frontend).toBe('nextjs')
    expect(s.backend).toBe('kotlin-spring')
  })
})

describe('tool coverage', () => {
  test('registry covers major tools', () => {
    expect(ALL_TOOL_IDS.length).toBeGreaterThanOrEqual(35)
    expect(ALL_TOOL_IDS).toContain('query_wiki')
    expect(ALL_TOOL_IDS).toContain('spawn_session')
    expect(ALL_TOOL_IDS).toContain('scan_issues')
  })
})
