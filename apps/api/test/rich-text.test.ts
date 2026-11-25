import { describe, expect, it } from 'vitest';
import { normalizeRichText, richTextToPlainText, sanitizeRichText } from '../src/common/rich-text';

describe('sanitizeRichText', () => {
  it('移除脚本、事件属性与危险协议', () => {
    const html =
      '<p>正常内容</p><script>alert(1)</script><img src="x" onerror="alert(1)" /><a href="javascript:alert(1)">链接</a>';
    const cleaned = sanitizeRichText(html);
    expect(cleaned).not.toContain('<script');
    expect(cleaned).not.toContain('onerror');
    expect(cleaned).not.toContain('javascript:');
    expect(cleaned).toContain('正常内容');
  });

  it('保留排版标签与附件图片属性', () => {
    const html =
      '<p><strong>加粗</strong><em>斜体</em><u>下划线</u></p><ul><li>条目</li></ul>' +
      '<img src="/api/attachments/abc/download" data-attachment-id="abc" alt="截图.png" />';
    const cleaned = sanitizeRichText(html);
    expect(cleaned).toContain('<strong>加粗</strong>');
    expect(cleaned).toContain('<em>斜体</em>');
    expect(cleaned).toContain('<u>下划线</u>');
    expect(cleaned).toContain('<li>条目</li>');
    expect(cleaned).toContain('data-attachment-id="abc"');
    expect(cleaned).toContain('src="/api/attachments/abc/download"');
  });

  it('提单场景下保留待上传图片占位', () => {
    const cleaned = sanitizeRichText('<p>描述</p><img data-pending-image="0" alt="粘贴图片" />');
    expect(cleaned).toContain('data-pending-image="0"');
  });

  it('丢弃没有来源的图片（例如残留的 blob 预览或相对路径）', () => {
    const cleaned = sanitizeRichText('<p>描述</p><img src="blob:http://localhost/xxx" /><img src="x" />');
    expect(cleaned).not.toContain('blob:');
    expect(cleaned).not.toContain('<img');
  });

  it('给链接补充安全 rel 属性', () => {
    const cleaned = sanitizeRichText('<a href="https://example.com">文档</a>');
    expect(cleaned).toContain('rel="noopener noreferrer"');
  });
});

describe('richTextToPlainText', () => {
  it('按块级元素与换行还原纯文本，供邮件/通知降级展示', () => {
    const html = '<p>第一段</p><p>第二段<br />换行</p><ul><li>条目一</li><li>条目二</li></ul>';
    const text = richTextToPlainText(html);
    expect(text).toContain('第一段');
    expect(text).toContain('第二段\n换行');
    expect(text).toContain('条目一');
    expect(text).not.toContain('<');
  });

  it('解码常见 HTML 实体', () => {
    expect(richTextToPlainText('<p>a &amp; b &lt;c&gt; &quot;d&quot;&nbsp;e</p>')).toBe('a & b <c> "d" e');
  });

  it('纯文本历史数据保持原样并去除首尾空白', () => {
    expect(richTextToPlainText('  历史描述第一行\n第二行  ')).toBe('历史描述第一行\n第二行');
  });
});

describe('normalizeRichText', () => {
  it('同时返回清洗后的 HTML 与纯文本', () => {
    const result = normalizeRichText('<p>问题 <strong>描述</strong></p><script>alert(1)</script>');
    expect(result.html).toBe('<p>问题 <strong>描述</strong></p>');
    expect(result.text).toBe('问题 描述');
  });
});
