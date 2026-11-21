/**
 * 本地演示模式：不依赖任何 AWS 服务，用 localStorage + 真实题目包模拟整套 API。
 *
 * 目的：先把 Web 页面做出来看清楚，再按部署路线逐步接上真实后端。
 * 开启方式：config.json 里 "mock": true（`bash app/dev.sh` 会自动写入）。
 */

import { loadExam } from '../content';
import type {
  AnswerResult,
  CreatedSession,
  MeResponse,
  Question,
  SessionSummary,
  StatsResponse,
} from '../types';

const STORAGE_KEY = 'certstack:mock:v1';
const DAY_MS = 86_400_000;
const RELEARN_MS = 10 * 60_000;

interface MockSession {
  id: string;
  exam: string;
  mode: 'practice' | 'exam' | 'review';
  status: 'active' | 'finished' | 'abandoned';
  count: number;
  questionIds: string[];
  startedAt: string;
  finishedAt?: string;
  score?: number;
  correctCount?: number;
  durationSeconds: number;
  tags: string[];
}

interface MockAnswer {
  selected: string[];
  isCorrect: boolean;
  createdAt: string;
}

interface MockCard {
  questionId: string;
  exam: string;
  dueAt: string;
  intervalDays: number;
  ease: number;
  lapses: number;
  reps: number;
  lastResult: 'correct' | 'wrong';
}

interface MockState {
  profile: {
    displayName: string;
    targetExam: string;
    totalAnswered: number;
    totalCorrect: number;
    sessionsFinished: number;
    createdAt: string;
  };
  settings: { language: 'zh' | 'en'; dailyGoal: number; targetExam: string };
  sessions: MockSession[];
  answers: Record<string, Record<string, MockAnswer>>;
  srs: Record<string, MockCard>;
  tagStats: Record<string, { answered: number; correct: number }>;
  days: Record<string, { answered: number; correct: number }>;
  bookmarks: Record<string, { note: string; exam: string; createdAt: string }>;
}

const TAGS = ['S3', 'EC2', 'Lambda', 'DynamoDB', 'VPC', 'IAM', 'CloudFront', 'RDS'];

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function seed(): MockState {
  const now = new Date();
  const sessions: MockSession[] = [
    {
      id: 'demo-1',
      exam: 'SAA-C03',
      mode: 'exam',
      status: 'finished',
      count: 65,
      questionIds: [],
      startedAt: iso(-2 * DAY_MS),
      finishedAt: iso(-2 * DAY_MS + 5_400_000),
      score: 780,
      correctCount: 49,
      durationSeconds: 7800,
      tags: [],
    },
    {
      id: 'demo-2',
      exam: 'SAA-C03',
      mode: 'practice',
      status: 'finished',
      count: 20,
      questionIds: [],
      startedAt: iso(-DAY_MS),
      finishedAt: iso(-DAY_MS + 1_200_000),
      score: 730,
      correctCount: 14,
      durationSeconds: 1200,
      tags: ['S3'],
    },
    {
      id: 'demo-3',
      exam: 'DOP-C02',
      mode: 'practice',
      status: 'finished',
      count: 10,
      questionIds: [],
      startedAt: iso(-3 * 3600_000),
      finishedAt: iso(-3 * 3600_000 + 540_000),
      score: 640,
      correctCount: 6,
      durationSeconds: 540,
      tags: [],
    },
  ];

  const tagStats: MockState['tagStats'] = {};
  TAGS.forEach((tag, i) => {
    const answered = 8 + i * 3;
    const accuracy = [0.82, 0.64, 0.76, 0.55, 0.7, 0.88, 0.61, 0.5][i] ?? 0.7;
    tagStats[tag] = { answered, correct: Math.round(answered * accuracy) };
  });

  const days: MockState['days'] = {};
  for (let i = 13; i >= 0; i -= 1) {
    const key = new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10);
    const answered = [6, 10, 4, 12, 0, 8, 15, 3, 9, 11, 5, 7, 14, 6][13 - i] ?? 0;
    days[key] = { answered, correct: Math.round(answered * 0.72) };
  }

  return {
    profile: {
      displayName: '本地演示',
      targetExam: 'SAA-C03',
      totalAnswered: Object.values(tagStats).reduce((sum, t) => sum + t.answered, 0),
      totalCorrect: Object.values(tagStats).reduce((sum, t) => sum + t.correct, 0),
      sessionsFinished: sessions.length,
      createdAt: iso(-30 * DAY_MS),
    },
    settings: { language: 'zh', dailyGoal: 20, targetExam: 'SAA-C03' },
    sessions,
    answers: {},
    srs: {},
    tagStats,
    days,
    bookmarks: {},
  };
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    // 损坏的数据直接重建
  }
  const fresh = seed();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

let state: MockState = load();

function persist(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalize(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  return [...new Set(keys.map((k) => String(k).toLowerCase()).filter(Boolean))].sort();
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function questionsFor(exam: string): Promise<Map<string, Question>> {
  const content = await loadExam(exam);
  return new Map(content.questions.map((q) => [q.id, q]));
}

export const mockApi = {
  async me(): Promise<MeResponse> {
    const dueToday = Object.values(state.srs).filter((c) => c.dueAt <= iso(0)).length;
    const answeredToday = state.days[today()]?.answered ?? 0;
    return {
      profile: { ...state.profile },
      settings: { ...state.settings },
      stats: {
        accuracy: state.profile.totalAnswered
          ? Math.round((state.profile.totalCorrect / state.profile.totalAnswered) * 100)
          : 0,
        dueToday,
        answeredToday,
      },
      recentSessions: [...state.sessions]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 5)
        .map((s) => ({
          id: s.id,
          exam: s.exam,
          mode: s.mode,
          status: s.status,
          score: s.score ?? null,
          correctCount: s.correctCount ?? null,
          total: s.count,
          startedAt: s.startedAt,
          finishedAt: s.finishedAt,
        })),
    };
  },

  async updateMe(patch: {
    language?: 'zh' | 'en';
    targetExam?: string;
    dailyGoal?: number;
    displayName?: string;
  }): Promise<{ settings: MeResponse['settings'] }> {
    state.settings = { ...state.settings, ...patch };
    if (patch.targetExam) state.profile.targetExam = patch.targetExam;
    if (patch.displayName !== undefined) state.profile.displayName = patch.displayName;
    persist();
    return { settings: state.settings };
  },

  async stats(): Promise<StatsResponse> {
    return {
      tagStats: Object.entries(state.tagStats)
        .map(([tag, v]) => ({
          tag,
          answered: v.answered,
          correct: v.correct,
          accuracy: v.answered ? Math.round((v.correct / v.answered) * 100) : 0,
        }))
        .filter((t) => t.answered > 0)
        .sort((a, b) => b.answered - a.answered),
      days: Object.entries(state.days)
        .map(([date, v]) => ({ date, answered: v.answered, correct: v.correct }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-30),
    };
  },

  async createSession(body: {
    exam: string;
    mode: 'practice' | 'exam' | 'review';
    count?: number;
    tags?: string[];
  }): Promise<CreatedSession> {
    const content = await loadExam(body.exam);
    let pool = content.questions;
    if (body.mode === 'review') {
      const dueIds = new Set(
        Object.values(state.srs)
          .filter((card) => card.dueAt <= iso(0) && card.exam === body.exam)
          .map((card) => card.questionId),
      );
      pool = pool.filter((q) => dueIds.has(q.id));
    } else if (body.tags && body.tags.length > 0) {
      const wanted = new Set(body.tags);
      pool = pool.filter((q) => q.tags.some((t) => wanted.has(t)));
    }
    if (pool.length === 0) throw new Error('没有匹配的题目');

    const requested = body.mode === 'exam' ? content.config.totalQuestions : (body.count ?? 20);
    const picked = shuffle(pool).slice(0, Math.min(requested, pool.length));
    const durationSeconds = body.mode === 'exam' ? content.config.minutes * 60 : Math.max(600, picked.length * 60);
    const session: MockSession = {
      id: `demo-${Date.now()}`,
      exam: body.exam,
      mode: body.mode,
      status: 'active',
      count: picked.length,
      questionIds: picked.map((q) => q.id),
      startedAt: iso(0),
      durationSeconds,
      tags: body.tags ?? [],
    };
    state.sessions.push(session);
    state.answers[session.id] = {};
    persist();

    return {
      id: session.id,
      exam: session.exam,
      mode: session.mode,
      count: session.count,
      questionIds: session.questionIds,
      startedAt: session.startedAt,
      deadlineAt: iso(durationSeconds * 1000),
      durationSeconds,
      passingScore: content.config.passingScore,
    };
  },

  async getSession(id: string) {
    const session = state.sessions.find((s) => s.id === id);
    if (!session) throw new Error('会话不存在');
    const content = await loadExam(session.exam);
    const answers = Object.entries(state.answers[id] ?? {}).map(([questionId, a]) => ({
      questionId,
      ...a,
    }));
    return {
      session: {
        ...session,
        deadlineAt: new Date(new Date(session.startedAt).getTime() + session.durationSeconds * 1000).toISOString(),
        passingScore: content.config.passingScore,
      },
      answers,
    };
  },

  async answer(
    sessionId: string,
    questionId: string,
    selected: string[],
    _elapsedMs: number,
  ): Promise<AnswerResult> {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error('会话不存在');
    const questions = await questionsFor(session.exam);
    const question = questions.get(questionId);
    if (!question) throw new Error('题目不存在');

    const correctKeys = normalize(question.correct);
    const chosen = normalize(selected);
    const perSession = (state.answers[sessionId] ??= {});

    if (perSession[questionId]) {
      return {
        saved: true,
        duplicate: true,
        correct: session.mode === 'practice' ? perSession[questionId].isCorrect : undefined,
        correctKeys: session.mode === 'practice' ? correctKeys : undefined,
      };
    }

    const isCorrect = sameSet(chosen, correctKeys);
    perSession[questionId] = { selected: chosen, isCorrect, createdAt: iso(0) };

    state.profile.totalAnswered += 1;
    if (isCorrect) state.profile.totalCorrect += 1;

    for (const tag of question.tags) {
      const bucket = (state.tagStats[tag] ??= { answered: 0, correct: 0 });
      bucket.answered += 1;
      if (isCorrect) bucket.correct += 1;
    }

    const day = (state.days[today()] ??= { answered: 0, correct: 0 });
    day.answered += 1;
    if (isCorrect) day.correct += 1;

    const prev = state.srs[questionId];
    const interval = isCorrect ? Math.max(1, Math.round((prev?.intervalDays ?? 1) * (prev?.ease ?? 2.5))) : 1;
    state.srs[questionId] = {
      questionId,
      exam: session.exam,
      dueAt: iso(isCorrect ? interval * DAY_MS : RELEARN_MS),
      intervalDays: interval,
      ease: isCorrect ? Math.min(2.8, (prev?.ease ?? 2.5) + 0.05) : Math.max(1.3, (prev?.ease ?? 2.5) - 0.2),
      lapses: (prev?.lapses ?? 0) + (isCorrect ? 0 : 1),
      reps: (prev?.reps ?? 0) + 1,
      lastResult: isCorrect ? 'correct' : 'wrong',
    };

    persist();
    return {
      saved: true,
      correct: session.mode === 'practice' ? isCorrect : undefined,
      correctKeys: session.mode === 'practice' ? correctKeys : undefined,
      answeredAt: iso(0),
    };
  },

  async abandon(sessionId: string) {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error('会话不存在');
    if (session.status === 'active') {
      session.status = 'abandoned';
      persist();
    }
    return { sessionId, status: session.status };
  },

  async finish(sessionId: string): Promise<SessionSummary> {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error('会话不存在');
    const questions = await questionsFor(session.exam);
    const answers = Object.entries(state.answers[sessionId] ?? {});

    const total = answers.length;
    const correctCount = answers.filter(([, a]) => a.isCorrect).length;
    const score = total > 0 ? Math.round(100 + (correctCount / total) * 900) : 0;

    if (session.status === 'active') {
      session.status = 'finished';
      session.finishedAt = iso(0);
      session.score = score;
      session.correctCount = correctCount;
      state.profile.sessionsFinished += 1;
      persist();
    }

    const tagBreakdown = new Map<string, { total: number; correct: number }>();
    const sectionBreakdown = new Map<string, { total: number; correct: number }>();
    for (const [qid, answer] of answers) {
      const question = questions.get(qid);
      if (!question) continue;
      for (const tag of question.tags) {
        const bucket = tagBreakdown.get(tag) ?? { total: 0, correct: 0 };
        bucket.total += 1;
        if (answer.isCorrect) bucket.correct += 1;
        tagBreakdown.set(tag, bucket);
      }
      const section = sectionBreakdown.get(question.section) ?? { total: 0, correct: 0 };
      section.total += 1;
      if (answer.isCorrect) section.correct += 1;
      sectionBreakdown.set(question.section, section);
    }

    const content = await loadExam(session.exam);
    return {
      sessionId,
      exam: session.exam,
      mode: session.mode,
      score,
      passed: score >= content.config.passingScore,
      passingScore: content.config.passingScore,
      correctCount,
      total,
      durationSeconds: session.durationSeconds,
      tagBreakdown: [...tagBreakdown.entries()]
        .map(([tag, v]) => ({ tag, ...v, accuracy: Math.round((v.correct / v.total) * 100) }))
        .sort((a, b) => b.total - a.total),
      sectionBreakdown: [...sectionBreakdown.entries()].map(([section, v]) => ({ section, ...v })),
    };
  },

  async due() {
    return {
      items: Object.values(state.srs)
        .filter((c) => c.dueAt <= iso(0))
        .map((c) => ({
          questionId: c.questionId,
          exam: c.exam,
          dueAt: c.dueAt,
          intervalDays: c.intervalDays,
        })),
      count: Object.values(state.srs).filter((c) => c.dueAt <= iso(0)).length,
    };
  },
};

/** 清空演示数据（开发时用：localStorage.removeItem('certstack:mock:v1') 也行）。 */
export function resetMock(): void {
  localStorage.removeItem(STORAGE_KEY);
  state = load();
}
