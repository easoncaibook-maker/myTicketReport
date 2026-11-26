export interface FaqLike {
  id: string;
  question: string;
  answer: string;
  keywords?: string | null;
  visibility?: string;
  enterpriseId?: string | null;
}

/**
 * 轻量分词：英文/数字按词，中文按二元组切分。
 * 不引入分词库，保证离线安装包体积与检索性能可控。
 */
export function tokenize(text: string): string[] {
  const lower = String(text || '').toLowerCase();
  const latin = lower.match(/[a-z0-9_]{2,}/g) ?? [];
  const cjkSegments = lower.match(/[\u4e00-\u9fa5]+/g) ?? [];
  const grams: string[] = [];
  for (const segment of cjkSegments) {
    if (segment.length === 1) {
      grams.push(segment);
      continue;
    }
    for (let i = 0; i < segment.length - 1; i += 1) grams.push(segment.slice(i, i + 2));
  }
  return Array.from(new Set([...latin, ...grams]));
}

/** 关键词打分：问题命中权重最高，其次是关键词字段，最后是答案正文 */
export function scoreFaq(query: string, entry: FaqLike): number {
  const tokens = tokenize(query);
  if (!tokens.length) return 0;
  const question = entry.question.toLowerCase();
  const keywords = String(entry.keywords || '').toLowerCase();
  const answer = entry.answer.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (question.includes(token)) score += 3;
    if (keywords.includes(token)) score += 2;
    if (answer.includes(token)) score += 1;
  }
  const normalized = String(query || '').trim().toLowerCase();
  if (normalized && question.includes(normalized)) score += 5;
  return score;
}

/** 排序并截断；同分时问题更短（更聚焦）的排前面 */
export function rankFaq<T extends FaqLike>(query: string, entries: T[], limit: number): Array<T & { score: number }> {
  return entries
    .map((entry) => ({ ...entry, score: scoreFaq(query, entry) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.question.length - b.question.length)
    .slice(0, Math.max(1, limit));
}
