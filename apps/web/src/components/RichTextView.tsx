import React, { useEffect, useRef } from 'react';
import { hydrateAttachmentImages } from '../lib/rich-text';

interface Props {
  html?: string;
  className?: string;
}

/** 只读富文本渲染：内容已在服务端清洗，附件图片用带登录态的 blob 地址展示 */
export default function RichTextView({ html, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    return hydrateAttachmentImages(ref.current);
  }, [html]);

  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html || '' }} />;
}
