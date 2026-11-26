import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/common/secret-box';
import { buildExternalRequestBody, mapExternalItems, parseKbMapping, renderTemplate } from '../src/ai/external-http';

describe('配置密钥加密', () => {
  it('加密后可解密，且每次密文不同', () => {
    const plain = 'sk-test-123456';
    const first = encryptSecret(plain);
    const second = encryptSecret(plain);
    expect(first).not.toBe(second);
    expect(first.startsWith('v1:')).toBe(true);
    expect(decryptSecret(first)).toBe(plain);
  });

  it('损坏密文或空值返回空字符串', () => {
    expect(decryptSecret('')).toBe('');
    expect(decryptSecret('not-a-secret')).toBe('');
    expect(decryptSecret('v1:bad:bad:bad')).toBe('');
  });
});

describe('外部知识库适配', () => {
  it('模板变量递归替换并解析为 JSON', () => {
    const body: any = buildExternalRequestBody(
      '{"query":"{{query}}","topK":{{topK}},"scope":"{{scope}}"}',
      { query: '如何提单', topK: 5, scope: 'PUBLIC' },
    );
    expect(body).toEqual({ query: '如何提单', topK: 5, scope: 'PUBLIC' });
    expect(renderTemplate({ a: ['{{query}}'] }, { query: 'x' })).toEqual({ a: ['x'] });
  });

  it('按映射转换条目并丢弃无正文内容', () => {
    const mapping = parseKbMapping(
      '{"itemsPath":"data.items","id":"docId","title":"name","content":"body","url":"link","visibility":"level","enterpriseId":"tenant","score":"rank"}',
    );
    const hits = mapExternalItems(
      [
        { docId: 'd1', name: '标题', body: '正文', link: 'https://x', level: 'INTERNAL', tenant: 'e1', rank: 0.9 },
        { docId: 'd2', name: '无正文' },
      ],
      mapping,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      source: 'EXTERNAL_HTTP',
      id: 'd1',
      title: '标题',
      content: '正文',
      visibility: 'INTERNAL',
      enterpriseId: 'e1',
      score: 0.9,
    });
  });
});
