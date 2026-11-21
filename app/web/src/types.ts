export type Lang = 'zh' | 'en';

export interface AppConfig {
  /** 当前部署阶段，例如 "01-static-web" */
  stage?: string;
  /** 本地演示模式：不调用后端，用 localStorage 模拟 */
  mock?: boolean;
  env: string;
  region: string;
  /** 以下字段随着部署阶段逐步补齐 */
  userPoolId?: string;
  userPoolClientId?: string;
  apiBaseUrl?: string;
  contentBaseUrl?: string;
  features?: {
    content?: boolean;
    api?: boolean;
    auth?: boolean;
  };
  builtAt?: string;
}

export interface LocalizedText {
  en?: string;
  zh?: string;
}

export interface QuestionOption {
  key: string;
  position: number;
  html: LocalizedText;
  text: LocalizedText;
}

export interface Question {
  id: string;
  exam: string;
  set: string;
  position: number;
  type: 'single' | 'multi';
  section: string;
  studyDomain: number | null;
  difficulty: string | null;
  stem: { html: LocalizedText; text: LocalizedText };
  options: QuestionOption[];
  correct: string[];
  explanation: { en: string; enHtml?: string; zh?: string; zhHtml?: string };
  tags: string[];
  source: { url: string; answerSource: string; communityVotes: string };
  translation: { available: boolean; translator: string | null };
  hash: string;
}

export interface ExamDomain {
  id: number;
  name: string;
  weight: number;
}

export interface ExamConfig {
  title: string;
  shortTitle: string;
  totalQuestions: number;
  minutes: number;
  passingScore: number;
  scoreScale: [number, number];
  domains: ExamDomain[];
}

export interface ExamContent {
  exam: string;
  config: ExamConfig;
  generatedAt: string;
  version: string;
  count: number;
  questions: Question[];
}

export interface ContentIndexEntry {
  count: number;
  version: string;
  basePath: string;
  translated: number;
  withExplanation: number;
  multiSelect: number;
  tags: Record<string, number>;
  sets: string[];
}

export interface ContentIndex {
  generatedAt: string;
  exams: Record<string, ContentIndexEntry>;
}

export interface MeResponse {
  profile: {
    displayName: string;
    targetExam: string;
    totalAnswered: number;
    totalCorrect: number;
    sessionsFinished: number;
    createdAt: string;
  };
  settings: { language: Lang; dailyGoal: number; targetExam: string };
  stats: { accuracy: number; dueToday: number; answeredToday: number };
  recentSessions: {
    id: string;
    exam: string;
    mode: string;
    status: string;
    score: number | null;
    correctCount: number | null;
    total: number;
    startedAt: string;
    finishedAt?: string;
  }[];
}

export interface StatsResponse {
  tagStats: { tag: string; answered: number; correct: number; accuracy: number }[];
  days: { date: string; answered: number; correct: number }[];
}

export interface CreatedSession {
  id: string;
  exam: string;
  mode: 'practice' | 'exam' | 'review';
  count: number;
  questionIds: string[];
  startedAt: string;
  deadlineAt: string;
  durationSeconds: number;
  passingScore: number;
}

export interface AnswerResult {
  saved: boolean;
  duplicate?: boolean;
  correct?: boolean;
  correctKeys?: string[];
  answeredAt?: string;
}

export interface SessionSummary {
  sessionId: string;
  exam: string;
  mode: string;
  score: number;
  passed: boolean;
  passingScore: number;
  correctCount: number;
  total: number;
  durationSeconds: number;
  tagBreakdown: { tag: string; total: number; correct: number; accuracy: number }[];
  sectionBreakdown: { section: string; total: number; correct: number }[];
}
