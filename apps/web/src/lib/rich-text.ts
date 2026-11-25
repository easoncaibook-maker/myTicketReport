import { api } from './api';

/** 富文本 HTML 转纯文本，用于前端字数校验 */
export function richTextToPlainText(html?: string): string {
  if (!html) return '';
  const withBreaks = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-4]|blockquote|pre)>/gi, '\n');
  const div = document.createElement('div');
  div.innerHTML = withBreaks;
  return (div.textContent || '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 序列化编辑器内容：本地预览用的 blob 地址统一还原为附件下载地址，
 * 未上传成功的本地图片保留 data-pending-image 占位（提单场景），其余丢弃。
 */
export function normalizeEditorHtml(html: string): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('img').forEach((img) => {
    const attachmentId = img.getAttribute('data-attachment-id');
    if (attachmentId) {
      img.setAttribute('src', `/api/attachments/${attachmentId}/download`);
      return;
    }
    if ((img.getAttribute('src') || '').startsWith('blob:')) {
      if (img.getAttribute('data-pending-image') === null) img.remove();
      else img.removeAttribute('src');
    }
  });
  return div.innerHTML;
}

/**
 * 富文本中的附件图片需要携带登录态才能下载，
 * 这里逐个拉取为 blob 地址后替换 src，并在卸载时释放。
 */
export function hydrateAttachmentImages(root: HTMLElement): () => void {
  const objectUrls: string[] = [];
  let cancelled = false;

  root.querySelectorAll('img[data-attachment-id]').forEach((img) => {
    const id = img.getAttribute('data-attachment-id');
    const src = img.getAttribute('src') || '';
    if (!id || src.startsWith('blob:')) return;
    api
      .blob(`/attachments/${id}/download`)
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        img.setAttribute('src', url);
      })
      .catch(() => {
        // 附件已被删除或无权限时保持原样，不影响正文展示
      });
  });

  return () => {
    cancelled = true;
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
  };
}
