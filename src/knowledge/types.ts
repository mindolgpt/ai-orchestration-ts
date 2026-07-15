export interface KnowledgeDoc {
  path: string;
  title: string;
  content: string;
  tags: string[];
  links: string[];
  createdAt: string;
}

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  snippet: string;
  tags: string[];
}

export interface Issue {
  id: string;
  description: string;
  file: string;
  severity: "low" | "medium" | "high" | "critical";
  resolved: boolean;
  resolution?: string;
}