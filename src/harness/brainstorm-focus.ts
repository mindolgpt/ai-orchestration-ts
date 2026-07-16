import {
  BrainstormFocus,
  BrainstormOption,
  BrainstormQuestion,
  BrainstormLens,
  BrainstormAnswers,
  BrainstormResult,
} from "@/harness/brainstorm-types";

export interface FocusPlaybook {
  id: BrainstormFocus;
  label: string;
  label_ko: string;
  detect: RegExp;
  questions: BrainstormQuestion[];
  options: Omit<BrainstormOption, "wiki_citations">[];
}

/** Full development lifecycle — planning → design → build → ship → operate */
export const FOCUS_PLAYBOOKS: FocusPlaybook[] = [
  {
    id: "planning",
    label: "Product planning",
    label_ko: "기획",
    detect: /기획|요구사항|requirement|prd|mvp|scope|페르소나|persona|user story|유저스토리|로드맵|roadmap|kpi|지표|우선순위|priorit/i,
    questions: [
      {
        id: "plan_goal",
        focus: "planning",
        question: "이 기능의 핵심 사용자 목표 1문장은?",
        why: "범위 creep 방지, success criteria 정의",
      },
      {
        id: "plan_mvp",
        focus: "planning",
        question: "MVP에서 제외할 것은? (must-have vs nice-to-have)",
        why: "출시 속도 vs 완성도",
      },
      {
        id: "plan_metric",
        focus: "planning",
        question: "성공 지표는? (전환율, 이탈, 처리시간, NPS)",
        why: "기획·개발 우선순위 검증",
      },
    ],
    options: [
      {
        name: "Jobs-to-be-Done framing",
        focus: "planning",
        approach: "사용자가 '고용'하는 일(JTBD) → 기능은 job을 완료하는 수단",
        pros: ["기능 중심이 아닌 가치 중심", "우선순위 명확"],
        cons: ["정성 인터뷰 필요"],
        when_to_use: "신규 기능·불명확한 요구",
        complexity: "low",
        stack_hints: [],
      },
      {
        name: "User story map + release slice",
        focus: "planning",
        approach: "활동→스토리 맵 → 첫 릴리스 수평선(walking skeleton)",
        pros: ["전체 흐름 가시화", "점진적 출시"],
        cons: ["워크숍 시간"],
        when_to_use: "멀티스텝 플로우(체크아웃, 온보딩)",
        complexity: "medium",
        stack_hints: [],
      },
      {
        name: "RICE / MoSCoW prioritization",
        focus: "planning",
        approach: "Reach·Impact·Confidence·Effort 또는 Must/Should/Could",
        pros: ["객관적 백로그 정렬"],
        cons: ["추정 편향"],
        when_to_use: "백로그가 많을 때",
        complexity: "low",
        stack_hints: [],
      },
    ],
  },
  {
    id: "ux",
    label: "UX / interaction",
    label_ko: "UX·인터랙션",
    detect: /ux|ui\b|화면|플로우|flow|wireframe|와이어|프로토타입|prototype|사용성|usability|접근성|a11y|accessibility|journey|여정/i,
    questions: [
      {
        id: "ux_primary_flow",
        focus: "ux",
        question: "핵심 해피패스 3~5 스텝은?",
        why: "화면·상태 설계의 뼈대",
      },
      {
        id: "ux_error_states",
        focus: "ux",
        question: "실패/엣지 케이스 UX는? (품절, 결제실패, 네트워크)",
        why: "개발 범위·카피·복구 플로우",
      },
      {
        id: "ux_devices",
        focus: "ux",
        question: "타깃 디바이스? (mobile-first / desktop / both)",
        why: "레이아웃·터치·성능 기준",
      },
    ],
    options: [
      {
        name: "Mobile-first progressive disclosure",
        focus: "ux",
        approach: "핵심 액션 먼저, 상세·옵션은 단계적 노출",
        pros: ["이탈 감소", "구현 단순"],
        cons: ["파워유저 불편"],
        when_to_use: "B2C 쇼핑·온보딩",
        complexity: "low",
        stack_hints: ["react", "nextjs"],
      },
      {
        name: "Wizard / stepped checkout",
        focus: "ux",
        approach: "장바구니→배송→결제 단계별, 진행 표시",
        pros: ["인지 부하 분산", "이탈 지점 분석 용이"],
        cons: ["스텝 많으면 이탈"],
        when_to_use: "복잡한 checkout",
        complexity: "medium",
        stack_hints: [],
      },
      {
        name: "Optimistic UI + skeleton",
        focus: "ux",
        approach: "API 대기 중 즉시 피드백, 실패 시 롤백",
        pros: ["체감 속도↑"],
        cons: ["롤백 UX 설계 필요"],
        when_to_use: "장바구니·좋아요 등 빈번 액션",
        complexity: "medium",
        stack_hints: ["react", "vue"],
      },
    ],
  },
  {
    id: "visual_design",
    label: "Visual / design system",
    label_ko: "비주얼·디자인",
    detect: /디자인|design system|디자인시스템|컴포넌트|figma|브랜드|brand|타이포|색상|color|토큰|token|shadcn|mui|tailwind/i,
    questions: [
      {
        id: "visual_system",
        focus: "visual_design",
        question: "기존 디자인 시스템/라이브러리 있나? (Figma tokens, MUI, shadcn)",
        why: "일관성 vs 커스텀 비용",
      },
      {
        id: "visual_density",
        focus: "visual_design",
        question: "정보 밀도 — 쇼핑몰 그리드 vs 리스트?",
        why: "컴포넌트·반응형 브레이크포인트",
      },
    ],
    options: [
      {
        name: "Design tokens + headless UI",
        focus: "visual_design",
        approach: "CSS variables/tokens + Radix/shadcn, Figma와 동기화",
        pros: ["접근성·테마·다크모드"],
        cons: ["초기 셋업"],
        when_to_use: "장기 제품, 디자인-개발 협업",
        complexity: "medium",
        stack_hints: ["react", "tailwind"],
      },
      {
        name: "Page-level mockup first",
        focus: "visual_design",
        approach: "핵심 3화면만 Figma → 컴포넌트 추출은 이후",
        pros: ["MVP 빠름"],
        cons: ["리팩터링 빚"],
        when_to_use: "초기 검증·데모",
        complexity: "low",
        stack_hints: [],
      },
    ],
  },
  {
    id: "architecture",
    label: "Architecture",
    label_ko: "아키텍처",
    detect: /아키텍처|architecture|모듈|module|msa|모놀리|monolith|마이크로|bounded|레이어|layer/i,
    questions: [
      {
        id: "arch_style",
        focus: "architecture",
        question: "배포 단위는? (monolith / modular-monolith / microservices)",
        why: "팀·트래픽·운영 역량",
      },
    ],
    options: [
      {
        name: "Modular monolith (BC modules)",
        focus: "architecture",
        approach: "단일 배포, Gradle/npm 패키지로 BC 분리",
        pros: ["단순 운영", "명확 경계"],
        cons: ["스케일 한계"],
        when_to_use: "MVP~growth, 소~중팀",
        complexity: "medium",
        stack_hints: ["spring-boot", "nestjs"],
      },
      {
        name: "BFF + core services",
        focus: "architecture",
        approach: "FE용 BFF, 도메인 API는 내부",
        pros: ["FE 요구에 맞춤", "보안 경계"],
        cons: ["BFF 유지보수"],
        when_to_use: "SPA/mobile + 복잡 API",
        complexity: "medium",
        stack_hints: ["nextjs", "nestjs"],
      },
    ],
  },
  {
    id: "security",
    label: "Security",
    label_ko: "보안",
    detect: /보안|security|xss|csrf|인증|권한|rbac|암호|encrypt|pii|개인정보|gdpr|취약/i,
    questions: [
      {
        id: "sec_data",
        focus: "security",
        question: "다루는 민감 데이터는? (PII, 결제, 주소)",
        why: "암호화·마스킹·보관 기간",
      },
    ],
    options: [
      {
        name: "Defense in depth checklist",
        focus: "security",
        approach: "입력검증→인증→인가→감사로그→비밀관리",
        pros: ["누락 방지"],
        cons: ["체크리스트 유지"],
        when_to_use: "항상",
        complexity: "low",
        stack_hints: [],
      },
      {
        name: "RBAC at API boundary",
        focus: "security",
        approach: "역할·권한을 리소스 단위로, 도메인 서비스는 principal만",
        pros: ["명확한 접근 제어"],
        cons: ["역할 폭발"],
        when_to_use: "admin·B2B",
        complexity: "medium",
        stack_hints: ["spring-boot"],
      },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    label_ko: "성능",
    detect: /성능|performance|캐시|cache|cdn|latency|tps|qps|부하|load|scale|스케일/i,
    questions: [
      {
        id: "perf_slo",
        focus: "performance",
        question: "SLO는? (p95 latency, 동시 사용자)",
        why: "캐시·DB·인프라 결정",
      },
    ],
    options: [
      {
        name: "Read-through cache + CDN static",
        focus: "performance",
        approach: "카탈로그 Redis/CDN, mutation은 DB",
        pros: ["구현 단순", "효과 큼"],
        cons: ["캐시 무효화"],
        when_to_use: "read-heavy 쇼핑몰",
        complexity: "medium",
        stack_hints: ["redis", "cloudfront"],
      },
      {
        name: "Measure first (no premature optimize)",
        focus: "performance",
        approach: "MVP는 프로파일링 후 병목만 개선",
        pros: ["비용 절약"],
        cons: ["초기 트래픽 스파이크 위험"],
        when_to_use: "MVP, 불명확한 부하",
        complexity: "low",
        stack_hints: [],
      },
    ],
  },
  {
    id: "testing",
    label: "Testing / QA",
    label_ko: "테스트",
    detect: /테스트|test|qa|e2e|단위|unit|integration|회귀|regression|커버리지|coverage|tdd/i,
    questions: [
      {
        id: "test_pyramid",
        focus: "testing",
        question: "어디에 테스트 투자? (unit / contract / e2e 비율)",
        why: "CI 시간 vs 신뢰도",
      },
    ],
    options: [
      {
        name: "Testing pyramid",
        focus: "testing",
        approach: "unit 많게, integration 적당, e2e 핵심 플로우만",
        pros: ["빠른 CI", "유지보수"],
        cons: ["e2e flaky 관리"],
        when_to_use: "대부분의 팀",
        complexity: "low",
        stack_hints: ["vitest", "playwright"],
      },
      {
        name: "Contract tests at BC boundary",
        focus: "testing",
        approach: "BC 간 API 계약(Pact/OpenAPI) 고정",
        pros: ["MSA/모듈 분리 안전"],
        cons: ["계약 관리"],
        when_to_use: "멀티 모듈·팀",
        complexity: "medium",
        stack_hints: [],
      },
    ],
  },
  {
    id: "devops",
    label: "DevOps / delivery",
    label_ko: "DevOps·배포",
    detect: /devops|ci|cd|배포|deploy|docker|k8s|kubernetes|파이프라인|pipeline|github actions|환경|staging/i,
    questions: [
      {
        id: "devops_env",
        focus: "devops",
        question: "환경 구성은? (dev/staging/prod, feature flag)",
        why: "릴리스 리스크",
      },
    ],
    options: [
      {
        name: "Trunk-based + feature flags",
        focus: "devops",
        approach: "main 배포, 미완성은 flag off",
        pros: ["작은 배치", "빠른 롤백"],
        cons: ["flag 관리"],
        when_to_use: "growth+",
        complexity: "medium",
        stack_hints: [],
      },
      {
        name: "Simple CI (lint/test/build) on PR",
        focus: "devops",
        approach: "PR마다 verify ladder, main은 수동/단순 배포",
        pros: ["MVP에 충분"],
        cons: ["수동 배포 피로"],
        when_to_use: "MVP, 소규모",
        complexity: "low",
        stack_hints: ["github-actions"],
      },
    ],
  },
  {
    id: "observability",
    label: "Observability",
    label_ko: "관측",
    detect: /로그|log|metric|메트릭|trace|트레이스|monitor|모니터|알람|alert|sentry|datadog|observability/i,
    questions: [
      {
        id: "obs_alert",
        focus: "observability",
        question: "알람 받을 장애 시나리오 3가지는?",
        why: "로그/메트릭 설계",
      },
    ],
    options: [
      {
        name: "Structured logs + request_id",
        focus: "observability",
        approach: "JSON log, correlation id across BC",
        pros: ["디버깅 빠름", "저비용 시작"],
        cons: ["로그 볼륨"],
        when_to_use: "MVP~growth",
        complexity: "low",
        stack_hints: [],
      },
      {
        name: "RED metrics + SLO dashboards",
        focus: "observability",
        approach: "Rate/Errors/Duration per service",
        pros: ["운영 가시성"],
        cons: ["계측 코드"],
        when_to_use: "production SLA",
        complexity: "medium",
        stack_hints: ["prometheus"],
      },
    ],
  },
  {
    id: "documentation",
    label: "Documentation",
    label_ko: "문서화",
    detect: /문서|document|readme|adr|api doc|openapi|swagger|온보딩|onboarding|wiki|런북|runbook/i,
    questions: [
      {
        id: "doc_audience",
        focus: "documentation",
        question: "문서 독자는? (개발자 / 운영 / 기획 / 사용자)",
        why: "형식·위치 결정",
      },
    ],
    options: [
      {
        name: "ADR + wiki file_back",
        focus: "documentation",
        approach: "결정마다 ADR, aio file_back으로 wiki 동기화",
        pros: ["결정 이력", "에이전트 컨텍스트"],
        cons: ["작성 습관 필요"],
        when_to_use: "aio-mcp 프로젝트",
        complexity: "low",
        stack_hints: [],
      },
      {
        name: "OpenAPI as contract",
        focus: "documentation",
        approach: "API 스펙 단일 소스, codegen/mock",
        pros: ["FE-BE 병렬"],
        cons: ["스펙 drift"],
        when_to_use: "REST API 팀",
        complexity: "medium",
        stack_hints: ["openapi"],
      },
    ],
  },
  {
    id: "process",
    label: "Team / process",
    label_ko: "프로세스·협업",
    detect: /프로세스|process|애자일|agile|스프린트|sprint|코드리뷰|review|페어|pair|협업|팀/i,
    questions: [
      {
        id: "process_cadence",
        focus: "process",
        question: "배포·리뷰 주기는? (daily ship / weekly sprint)",
        why: "브랜치·PR 크기",
      },
    ],
    options: [
      {
        name: "Small PR + wiki citation in description",
        focus: "process",
        approach: "PR에 wiki 링크·BC 명시, 400줄 이하",
        pros: ["리뷰 품질", "도메인 정합"],
        cons: ["습관화"],
        when_to_use: "aio 도메인 프로젝트",
        complexity: "low",
        stack_hints: [],
      },
    ],
  },
];

export const DEVELOPMENT_LENSES: Array<{ focus: BrainstormFocus; label_ko: string; when: string }> = [
  { focus: "planning", label_ko: "기획", when: "요구사항·MVP·지표" },
  { focus: "ux", label_ko: "UX", when: "플로우·에러·디바이스" },
  { focus: "visual_design", label_ko: "디자인", when: "UI 시스템·Figma" },
  { focus: "domain", label_ko: "도메인", when: "BC·규칙·용어" },
  { focus: "architecture", label_ko: "아키텍처", when: "모듈·배포 형태" },
  { focus: "database", label_ko: "DB", when: "스키마·저장소" },
  { focus: "algorithm", label_ko: "알고리즘", when: "동시성·멱등·패턴" },
  { focus: "api", label_ko: "API", when: "계약·버전·BFF" },
  { focus: "security", label_ko: "보안", when: "인증·PII" },
  { focus: "performance", label_ko: "성능", when: "캐시·SLO" },
  { focus: "testing", label_ko: "테스트", when: "피라미드·계약" },
  { focus: "devops", label_ko: "DevOps", when: "CI/CD·환경" },
  { focus: "observability", label_ko: "관측", when: "로그·알람" },
  { focus: "documentation", label_ko: "문서", when: "ADR·API doc" },
  { focus: "integration", label_ko: "연동", when: "외부 PG·3rd party" },
  { focus: "process", label_ko: "협업", when: "PR·스프린트" },
];

export function detectFocusFromTopic(topic: string, explicit?: BrainstormFocus[]): BrainstormFocus[] {
  if (explicit?.length) return explicit;
  const lower = topic.toLowerCase();
  const found = new Set<BrainstormFocus>();

  for (const pb of FOCUS_PLAYBOOKS) {
    if (pb.detect.test(topic) || pb.detect.test(lower)) found.add(pb.id);
  }

  // Technical signals
  if (/db|database|스키마|테이블|redis|postgres/i.test(lower)) found.add("database");
  if (/알고리즘|동시성|멱등|saga|lock/i.test(lower)) found.add("algorithm");
  if (/api|rest|graphql|bff/i.test(lower)) found.add("api");
  if (/연동|webhook|외부|integration/i.test(lower)) found.add("integration");
  if (/도메인|bc|bounded|aggregate/i.test(lower)) found.add("domain");

  // Broad dev keywords → suggest full lens pass
  if (/개발|만들|구현|기능|feature|서비스|product/i.test(lower) && found.size < 3) {
    found.add("planning");
    found.add("ux");
    found.add("domain");
    found.add("architecture");
    found.add("testing");
  }

  if (!found.size) {
    return ["planning", "ux", "domain", "architecture", "database", "testing", "general"];
  }
  return [...found];
}

export function collectFocusPlaybooks(focuses: BrainstormFocus[]): FocusPlaybook[] {
  return FOCUS_PLAYBOOKS.filter((p) => focuses.includes(p.id));
}
