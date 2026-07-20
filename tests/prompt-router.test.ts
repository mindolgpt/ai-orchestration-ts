/// <reference types="vitest/globals" />
import {
  extractBrainstormAnswersFromMessage,
  routePrompt,
  routePromptToTool,
} from '../src/harness/prompt-router'
import { detectStacksFromText } from '../src/harness/stack-playbooks'
import { ALL_TOOL_IDS, scoreToolMatch, TOOL_KEYWORDS } from '../src/harness/tool-keywords'

describe('keyword routePrompt — harness', () => {
  test('brainstorm topic does not leave _design remnant', () => {
    const r = routePrompt('brainstorm_design MCP 버그 수정과 clarifying answers')
    expect(r.tool).toBe('brainstorm_design')
    expect(String(r.extracted_params?.topic)).not.toMatch(/^_/)
    expect(String(r.extracted_params?.topic)).toMatch(/MCP|버그|clarifying/i)
  })

  test('bare design follow-up extracts phase answer', () => {
    expect(extractBrainstormAnswersFromMessage('design')).toEqual({ phase: 'design' })
    expect(extractBrainstormAnswersFromMessage('phase: build')).toEqual({ phase: 'build' })
    expect(extractBrainstormAnswersFromMessage('결제 UX 디자인 방향')).toEqual({})
    const r = routePromptToTool('design', 'brainstorm_design')
    expect(r.extracted_params?.answers).toMatchObject({ phase: 'design' })
  })

  test('brainstorm keyword does not substring-match tool id only noise', () => {
    // "brainstorm" alone inside snake_case id is handled via explicit tool-id match
    const r = routePrompt('please run brainstorm_design')
    expect(r.tool).toBe('brainstorm_design')
    expect(String(r.extracted_params?.topic).toLowerCase()).not.toContain('brainstorm_design')
  })

  test('하네스 구성 keyword', () => {
    const r = routePrompt('하네스 구성해줘')
    expect(r.tool).toBe('bootstrap_harness')
    expect(r.score).toBeGreaterThan(0)
  })

  test('bare harness does not false-match', () => {
    expect(routePrompt('just mention harness in passing').tool).toBe('unknown')
  })

  test('bare immutable does not route ingest_raw', () => {
    expect(routePrompt('immutable storage discussion').tool).toBe('unknown')
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

  test('wiki search (English)', () => {
    const r = routePrompt('wiki search cart rules')
    expect(r.tool).toBe('query_wiki')
    expect(String(r.extracted_params?.query)).toMatch(/cart/i)
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

describe('bilingual KO/EN pairs', () => {
  const pairs: Array<[string, string, string]> = [
    ['wiki 검색 장바구니', 'search the wiki for cart', 'query_wiki'],
    ['위키 검색 규칙', 'look up wiki rules', 'query_wiki'],
    ['위키에서 찾아줘', 'find in the wiki cart', 'query_wiki'],
    ['wiki lint', 'lint the wiki', 'lint_wiki'],
    ['위키 건강 체크', 'check wiki health', 'lint_wiki'],
    ['하네스 구성해줘', 'bootstrap harness', 'bootstrap_harness'],
    ['에이전트 규칙 만들어줘', 'generate agents.md', 'bootstrap_harness'],
    ['아키텍처 설계', 'design the architecture', 'design_architecture'],
    ['시스템 설계해줘', 'design system architecture', 'design_architecture'],
    ['세션 띄워 API', 'spawn a session for API', 'spawn_session'],
    ['자식 에이전트 실행', 'run a child agent', 'spawn_session'],
    ['인박스 확인', 'check my inbox', 'check_inbox'],
    ['세션 결과', 'poll session results', 'check_inbox'],
    ['작업 계획 결제', 'plan task payment', 'plan_task'],
    ['태스크 쪼개줘', 'break this down into tasks', 'plan_task'],
    ['DAG 실행', 'run the dag', 'execute_dag'],
    ['체크포인트에서 재개', 'resume from checkpoint', 'execute_dag'],
    ['TODO 스캔', 'scan for TODOs', 'scan_issues'],
    ['프로젝트 진단', 'run doctor', 'run_doctor'],
    ['설치 상태 확인', 'is my setup ok', 'run_doctor'],
    ['승인 요청', 'need human approval', 'request_approval'],
    ['지식 검색', 'recall knowledge', 'recall_knowledge'],
    ['기억에서 찾아줘', 'search my notes', 'recall_knowledge'],
    ['지식 저장', 'store this knowledge', 'store_knowledge'],
    ['노트에 저장', 'save this note', 'store_knowledge'],
    ['wiki 반영', 'file this back to wiki', 'file_back'],
    ['vault 목록', 'list vaults', 'list_vaults'],
    ['멀티 볼트 목록', 'show registered vaults', 'list_vaults'],
    ['대시보드', 'dashboard stats', 'get_dashboard_stats'],
    ['커버리지 보여줘', 'show wiki coverage', 'get_dashboard_stats'],
    ['브레인스토밍 결제', 'help me design checkout', 'brainstorm_design'],
    ['결과 수집', 'collect results', 'collect_results'],
    ['브랜치 상태', 'branch hunt status', 'get_branch_status'],
    ['위키 변경 제안해줘', 'propose a wiki change', 'propose_wiki_change'],
    ['제안 목록 보여줘', 'show wiki proposals', 'list_wiki_proposals'],
    ['제안 적용해줘', 'merge the wiki proposal', 'apply_wiki_proposal'],
    ['제안 거부해줘', 'reject the wiki proposal', 'reject_wiki_proposal'],
    ['이 문서 인제스트', 'ingest this document', 'ingest_pipeline'],
    ['raw에 저장해줘', 'save to raw', 'ingest_raw'],
    ['결과 합쳐줘', 'merge session results', 'synthesize_results'],
    ['세션 죽여줘', 'kill the session', 'close_session'],
    ['플레이북 시드해줘', 'seed the playbooks', 'seed_stack_playbooks'],
    ['볼트 등록해줘', 'register a vault', 'register_vault'],
    ['프로필 저장해줘', 'save the domain profile', 'save_domain_profile'],
  ]

  test.each(pairs)('KO %s ↔ EN %s → %s', (ko, en, tool) => {
    expect(routePrompt(ko).tool).toBe(tool)
    expect(routePrompt(en).tool).toBe(tool)
  })
})

describe('ingest_pipeline routing safety', () => {
  test('chat re-ingest command does not set content to message', () => {
    const r = routePrompt('raw 파일보고 ingest pipeline 다시 해줘')
    expect(r.tool).toBe('ingest_pipeline')
    expect(r.extracted_params?.content).toBeUndefined()
    expect(r.extracted_params?.file_path).toBeUndefined()
  })

  test('extracts vault raw path and raw_id', () => {
    const r = routePrompt('ingest pipeline vault/raw/a117f128--foo.md raw_id=a117f128')
    expect(r.tool).toBe('ingest_pipeline')
    expect(String(r.extracted_params?.file_path)).toContain('vault/raw/a117f128')
    expect(r.extracted_params?.raw_id).toBe('a117f128')
  })
})

describe('no catch-all / false positives', () => {
  test('unrelated text is unknown (not brainstorm)', () => {
    const r = routePrompt('hello world completely unrelated')
    expect(r.tool).toBe('unknown')
    expect(r.matched_keywords).toEqual([])
  })

  test('weight alone never scores', () => {
    const brainstorm = TOOL_KEYWORDS.find((t) => t.id === 'brainstorm_design')!
    const { score, matched } = scoreToolMatch(brainstorm, 'zzzz unrelated noise')
    expect(score).toBe(0)
    expect(matched).toEqual([])
  })

  test('short tokens do not false-match', () => {
    expect(routePrompt('build the package').tool).toBe('unknown')
    expect(routePrompt('onboarding users to the app').tool).toBe('unknown')
    expect(routePrompt('calendar events tomorrow').tool).toBe('unknown')
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

  test('each tool has both Korean and English surface forms', () => {
    for (const def of TOOL_KEYWORDS) {
      const hasKo =
        def.keywords.some((k) => /[가-힣]/.test(k)) ||
        (def.patterns || []).some((p) => /[가-힣]/.test(p.source))
      const hasEn =
        def.keywords.some((k) => /[a-zA-Z]{3,}/.test(k)) ||
        (def.patterns || []).some((p) => /[a-zA-Z]{3,}/.test(p.source))
      expect({ id: def.id, hasKo, hasEn }).toEqual({ id: def.id, hasKo: true, hasEn: true })
    }
  })
})
