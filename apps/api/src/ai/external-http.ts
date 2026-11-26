import type { KnowledgeHit } from './ai.types';

/** 外部知识库字段映射：把任意响应结构转换为统一命中结构 */
export interface ExternalKbMapping {
  itemsPath: string;
  id: string;
  title: string;
  content: string;
  url: string;
  visibility: string;
  enterpriseId: string;
  score: string;
}

export const DEFAULT_KB_MAPPING: ExternalKbMapping = {
  itemsPath: 'items',
  id: 'id',
  title: 'title',
  content: 'content',
  url: 'url',
  visibility: 'visibility',
  enterpriseId: 'enterpriseId',
  score: 'score',
};

export function parseKbMapping(raw: string | null | undefined): ExternalKbMapping {
  if (!raw) return { ...DEFAULT_KB_MAPPING };
  try {
    const parsed = JSON.parse(raw);
    const mapping: ExternalKbMapping = { ...DEFAULT_KB_MAPPING };
    for (const key of Object.keys(DEFAULT_KB_MAPPING) as (keyof ExternalKbMapping)[]) {
      if (typeof parsed?.[key] === 'string' && parsed[key]) mapping[key] = parsed[key];
    }
    return mapping;
  } catch {
    return { ...DEFAULT_KB_MAPPING };
  }
}

/** 递归替换模板中的 {{变量}}；变量值原样注入（JSON 模板由调用方保证结构） */
export function renderTemplate(value: unknown, vars: Record<string, string | number>): any {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) =>
      name in vars ? String(vars[name]) : '',
    );
  }
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, vars));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = renderTemplate(item, vars);
    }
    return out;
  }
  return value;
}

export function getByPath(source: any, path: string): any {
  if (!path) return source;
  return path.split('.').reduce((current: any, key: string) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, source);
}

/** 将外部响应中的条目映射成 KnowledgeHit；缺少正文的条目直接丢弃 */
export function mapExternalItems(items: any[], mapping: ExternalKbMapping): KnowledgeHit[] {
  if (!Array.isArray(items)) return [];
  const hits: KnowledgeHit[] = [];
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const content = String(getByPath(item, mapping.content) ?? '').trim();
    if (!content) return;
    const title = String(getByPath(item, mapping.title) ?? '').trim() || content.slice(0, 40);
    const rawVisibility = String(getByPath(item, mapping.visibility) ?? 'PUBLIC').toUpperCase();
    const rawScore = Number(getByPath(item, mapping.score));
    hits.push({
      source: 'EXTERNAL_HTTP',
      id: String(getByPath(item, mapping.id) ?? `external-${index + 1}`),
      title,
      content,
      url: getByPath(item, mapping.url) ? String(getByPath(item, mapping.url)) : null,
      visibility: rawVisibility === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC',
      enterpriseId: getByPath(item, mapping.enterpriseId)
        ? String(getByPath(item, mapping.enterpriseId))
        : null,
      score: Number.isFinite(rawScore) ? rawScore : undefined,
    });
  });
  return hits;
}

/**
 * 在原始 JSON 模板上做变量插值：字符串内的变量按转义处理，字符串外的变量按 JSON 值写入，
 * 因此模板可同时支持 "topK":"{{topK}}" 与 "topK":{{topK}}。
 */
export function interpolateJsonTemplate(template: string, vars: Record<string, string | number>): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < template.length; i += 1) {
    const char = template[i];
    if (inString) {
      if (escaped) {
        out += char;
        escaped = false;
      } else if (char === '\\') {
        out += char;
        escaped = true;
      } else if (char === '"') {
        inString = false;
        out += char;
      } else if (char === '{' && template[i + 1] === '{') {
        const end = template.indexOf('}}', i);
        const name = end > 0 ? template.slice(i + 2, end).trim() : '';
        if (end > 0 && name in vars) {
          out += JSON.stringify(String(vars[name])).slice(1, -1);
          i = end + 1;
        } else {
          out += char;
        }
      } else {
        out += char;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '{' && template[i + 1] === '{') {
      const end = template.indexOf('}}', i);
      const name = end > 0 ? template.slice(i + 2, end).trim() : '';
      if (end > 0 && name in vars) {
        out += JSON.stringify(vars[name]);
        i = end + 1;
      } else {
        out += char;
      }
    } else {
      out += char;
    }
  }
  return out;
}

/** 解析请求模板；模板必须是 JSON 对象，非法时返回 null */
export function buildExternalRequestBody(
  template: string,
  vars: Record<string, string | number>,
): unknown | null {
  const raw = template || '{"query":"{{query}}","topK":{{topK}}}';
  try {
    return JSON.parse(interpolateJsonTemplate(raw, vars));
  } catch {
    return null;
  }
}
