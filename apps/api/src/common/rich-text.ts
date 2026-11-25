import sanitizeHtml from 'sanitize-html';

/**
 * 富文本白名单清洗：只保留排版与图片相关的安全标签，
 * 去除 script/style/事件属性、javascript: 等协议，防止存储型 XSS。
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'code',
    'pre',
    'a',
    'img',
    'hr',
  ],
  allowedAttributes: {
    a: ['href', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'data-attachment-id', 'data-pending-image'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  transformTags: {
    b: 'strong',
    i: 'em',
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: 'noopener noreferrer' },
    }),
  },
  // 只保留系统附件、待上传占位或明确的外链图片；其余（blob:、相对路径等）直接丢弃
  exclusiveFilter: (frame) => {
    if (frame.tag !== 'img') return false;
    if (frame.attribs['data-attachment-id'] || frame.attribs['data-pending-image'] !== undefined) {
      return false;
    }
    return !/^(https?:\/\/|\/api\/attachments\/)/i.test(frame.attribs.src || '');
  },
};

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(input: string): string {
  return input.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITY_MAP[m] ?? m);
}

/** 清洗富文本 HTML，返回可直接入库的安全内容 */
export function sanitizeRichText(input: string): string {
  return sanitizeHtml(String(input ?? ''), SANITIZE_OPTIONS).trim();
}

/** 从富文本 HTML 提取纯文本，用于邮件 / 站内通知等纯文本场景的降级展示 */
export function richTextToPlainText(html: string): string {
  const withBreaks = String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-4]|blockquote|pre)>/gi, '\n');
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return decodeEntities(stripped)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 同时得到安全的 HTML 与对应的纯文本 */
export function normalizeRichText(input: string): { html: string; text: string } {
  const html = sanitizeRichText(input);
  return { html, text: richTextToPlainText(html) };
}
