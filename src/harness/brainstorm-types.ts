export type BrainstormFocus =
  | 'planning'
  | 'ux'
  | 'visual_design'
  | 'domain'
  | 'architecture'
  | 'database'
  | 'algorithm'
  | 'api'
  | 'security'
  | 'performance'
  | 'testing'
  | 'devops'
  | 'observability'
  | 'documentation'
  | 'integration'
  | 'process'
  | 'general'

export interface BrainstormOption {
  name: string
  focus: BrainstormFocus
  approach: string
  pros: string[]
  cons: string[]
  when_to_use: string
  complexity: 'low' | 'medium' | 'high'
  wiki_citations: string[]
  stack_hints: string[]
}

export interface BrainstormQuestion {
  id: string
  focus: BrainstormFocus
  question: string
  why: string
  options?: string[]
}

export interface BrainstormLens {
  focus: BrainstormFocus
  label_ko: string
  when: string
  relevant: boolean
}

export interface BrainstormAnswers {
  scale?: 'mvp' | 'growth' | 'enterprise'
  consistency?: 'strong' | 'eventual' | 'mixed'
  traffic?: 'low' | 'medium' | 'high'
  team_experience?: string
  constraints?: string
  preferred_store?: string
  phase?: 'discovery' | 'design' | 'build' | 'ship' | 'operate'
}

export interface BrainstormResult {
  status: 'questions' | 'brief'
  topic: string
  detected_focus: BrainstormFocus[]
  development_lenses: BrainstormLens[]
  detected_stacks: Record<string, string | undefined>
  wiki_citations: string[]
  context_excerpt: string
  clarifying_questions: BrainstormQuestion[]
  options: BrainstormOption[]
  recommendation: {
    primary: string
    rationale: string
    alternatives: string[]
    risks: string[]
  }
  agent_instructions?: string
  markdown?: string
  workflow_hint?: string
  docs_written?: string[]
}
