import type { AppConfig, ContentIndex, ExamContent } from './types';
import { get as idbGet, set as idbSet } from 'idb-keyval';

let config: AppConfig | undefined;

export async function loadConfig(): Promise<AppConfig> {
  if (config) return config;
  const path = import.meta.env.DEV ? '/config.dev.json' : '/config.json';
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(
      `无法加载 ${path}（HTTP ${res.status}）。生产环境由 CDK 写入；本地开发请先运行 scripts/dev-config.sh。`,
    );
  }
  config = (await res.json()) as AppConfig;
  return config;
}

export function getConfig(): AppConfig {
  if (!config) throw new Error('config not loaded');
  return config;
}

let indexPromise: Promise<ContentIndex> | undefined;

export function getContentIndex(): Promise<ContentIndex> {
  indexPromise ??= fetch(`${getConfig().contentBaseUrl}/index.json`, { cache: 'no-store' }).then(
    (res) => {
      if (!res.ok) throw new Error(`内容索引加载失败（HTTP ${res.status}）`);
      return res.json() as Promise<ContentIndex>;
    },
  );
  return indexPromise;
}

const examPromises = new Map<string, Promise<ExamContent>>();

/** 每门考试只拉一次；按内容 hash 写入 IndexedDB，版本不变就不再请求。 */
export function loadExam(exam: string): Promise<ExamContent> {
  const existing = examPromises.get(exam);
  if (existing) return existing;

  const promise = (async () => {
    const index = await getContentIndex();
    const entry = index.exams[exam];
    if (!entry) throw new Error(`未知考试：${exam}`);
    const cacheKey = `certstack:content:${exam}:${entry.version}`;
    const cached = await idbGet<ExamContent>(cacheKey);
    if (cached) return cached;

    const res = await fetch(`${getConfig().contentBaseUrl}/${exam}/${entry.version}/questions.json`);
    if (!res.ok) throw new Error(`题目加载失败（HTTP ${res.status}）`);
    const data = (await res.json()) as ExamContent;
    await idbSet(cacheKey, data);
    return data;
  })();

  examPromises.set(exam, promise);
  promise.catch(() => examPromises.delete(exam));
  return promise;
}

export async function questionsById(exam: string, ids: string[]): Promise<Map<string, import('./types').Question>> {
  const content = await loadExam(exam);
  const wanted = new Set(ids);
  const map = new Map<string, import('./types').Question>();
  for (const q of content.questions) {
    if (wanted.has(q.id)) map.set(q.id, q);
  }
  return map;
}
