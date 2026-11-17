import { getIdToken } from './auth';
import { getConfig } from './content';
import { mockApi } from './mock/api';
import type {
  AnswerResult,
  CreatedSession,
  MeResponse,
  SessionSummary,
  StatsResponse,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new ApiError(401, 'NO_SESSION', '登录状态已失效，请重新登录');

  const res = await fetch(`${getConfig().apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 204) return undefined as T;

  let payload: unknown = undefined;
  try {
    payload = await res.json();
  } catch {
    // 非 JSON 响应（例如 CloudFront 错误页）走下面的兜底。
  }

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; requestId?: string } })?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `请求失败（HTTP ${res.status}）`,
      err?.requestId,
    );
  }
  return payload as T;
}

function useMock(): boolean {
  return getConfig().mock === true;
}

export const api = {
  me: () => (useMock() ? mockApi.me() : request<MeResponse>('/api/me')),

  updateMe: (patch: {
    language?: 'zh' | 'en';
    targetExam?: string;
    dailyGoal?: number;
    displayName?: string;
  }) =>
    useMock()
      ? mockApi.updateMe(patch)
      : request<{ settings: MeResponse['settings'] }>('/api/me', {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),

  stats: () => (useMock() ? mockApi.stats() : request<StatsResponse>('/api/stats')),

  createSession: (body: {
    exam: string;
    mode: 'practice' | 'exam';
    count?: number;
    tags?: string[];
  }) =>
    useMock()
      ? mockApi.createSession(body)
      : request<CreatedSession>('/api/sessions', {
          method: 'POST',
          body: JSON.stringify(body),
        }),

  getSession: (id: string) =>
    useMock()
      ? mockApi.getSession(id)
      : request<{ session: Record<string, unknown>; answers: Record<string, unknown>[] }>(
          `/api/sessions/${id}`,
        ),

  answer: (sessionId: string, questionId: string, selected: string[], elapsedMs: number) =>
    useMock()
      ? mockApi.answer(sessionId, questionId, selected, elapsedMs)
      : request<AnswerResult>(`/api/sessions/${sessionId}/answers/${questionId}`, {
          method: 'PUT',
          body: JSON.stringify({ selected, elapsedMs }),
        }),

  finish: (sessionId: string) =>
    useMock()
      ? mockApi.finish(sessionId)
      : request<SessionSummary>(`/api/sessions/${sessionId}/finish`, { method: 'POST' }),

  due: (exam?: string, limit = 20) =>
    useMock()
      ? mockApi.due()
      : request<{ items: { questionId: string; exam: string; dueAt: string; intervalDays: number }[]; count: number }>(
          `/api/srs/due?limit=${limit}${exam ? `&exam=${encodeURIComponent(exam)}` : ''}`,
        ),
};
