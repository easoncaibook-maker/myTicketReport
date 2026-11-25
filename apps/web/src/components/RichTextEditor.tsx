import React, { useEffect, useRef } from 'react';
import { Button, Divider, Space, Tooltip } from 'antd';
import {
  BoldOutlined,
  CodeOutlined,
  ItalicOutlined,
  OrderedListOutlined,
  RedoOutlined,
  StrikethroughOutlined,
  UnderlineOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { hydrateAttachmentImages, normalizeEditorHtml } from '../lib/rich-text';

export type UploadImageResult = { attachmentId?: string; pendingIndex?: number };
export type UploadImageHandler = (file: File) => Promise<UploadImageResult>;

/** 附件图片扩展：额外保留附件 id 与待上传占位标记 */
const AttachmentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-attachment-id': {
        default: null,
        parseHTML: (element) => element.getAttribute('data-attachment-id'),
        renderHTML: (attributes) =>
          attributes['data-attachment-id'] ? { 'data-attachment-id': attributes['data-attachment-id'] } : {},
      },
      'data-pending-image': {
        default: null,
        parseHTML: (element) => element.getAttribute('data-pending-image'),
        renderHTML: (attributes) =>
          attributes['data-pending-image'] !== null && attributes['data-pending-image'] !== undefined
            ? { 'data-pending-image': attributes['data-pending-image'] }
            : {},
      },
    };
  },
});

interface Props {
  value?: string;
  onChange?: (html: string) => void;
  /** 粘贴/拖拽图片时的处理逻辑，返回附件 id 或提单阶段的占位序号 */
  uploadImage?: UploadImageHandler;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
}

export default function RichTextEditor({ value, onChange, uploadImage, placeholder, minHeight = 140, disabled }: Props) {
  const lastValue = useRef(value ?? '');
  const uploadRef = useRef(uploadImage);
  const changeRef = useRef(onChange);
  const editorRef = useRef<Editor | null>(null);
  uploadRef.current = uploadImage;
  changeRef.current = onChange;

  const handleImageFiles = (files: FileList | null | undefined) => {
    const images = Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return false;
    images.forEach(async (file) => {
      const handler = uploadRef.current;
      const current = editorRef.current;
      if (!handler || !current) return;
      try {
        const result = await handler(file);
        const attrs: any = { src: URL.createObjectURL(file), alt: file.name };
        if (result?.attachmentId) attrs['data-attachment-id'] = result.attachmentId;
        if (result?.pendingIndex !== undefined) attrs['data-pending-image'] = String(result.pendingIndex);
        current.chain().focus().setImage(attrs).run();
      } catch {
        // 上传失败由调用方提示，这里不打断编辑
      }
    });
    return true;
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      AttachmentImage.configure({ allowBase64: false }),
    ],
    content: value ?? '',
    editable: !disabled,
    editorProps: {
      attributes: {
        class: 'rich-editor-content',
        style: `min-height:${minHeight}px`,
        'data-placeholder': placeholder ?? '',
      },
      handlePaste: (_view, event) => handleImageFiles(event.clipboardData?.files),
      handleDrop: (_view, event, _slice, moved) =>
        moved ? false : handleImageFiles((event as DragEvent).dataTransfer?.files),
    },
    onUpdate: ({ editor: instance }) => {
      const html = normalizeEditorHtml(instance.getHTML());
      lastValue.current = html;
      changeRef.current?.(html);
    },
  });

  editorRef.current = editor;

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) =>
      instance
        ? {
            bold: instance.isActive('bold'),
            italic: instance.isActive('italic'),
            underline: instance.isActive('underline'),
            strike: instance.isActive('strike'),
            bullet: instance.isActive('bulletList'),
            ordered: instance.isActive('orderedList'),
            code: instance.isActive('codeBlock'),
            canUndo: instance.can().undo(),
            canRedo: instance.can().redo(),
          }
        : null,
  });

  // 外部值变化（例如弹窗回填）时同步到编辑器
  useEffect(() => {
    if (!editor) return;
    if ((value ?? '') === lastValue.current) return;
    lastValue.current = value ?? '';
    editor.commands.setContent(value ?? '', { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  // 编辑器内的附件图片用带登录态的 blob 地址展示
  useEffect(() => {
    if (!editor) return;
    let cleanup: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      cleanup = hydrateAttachmentImages(editor.view.dom as HTMLElement);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      cleanup?.();
    };
  }, [editor, value]);

  const run = (fn: (instance: Editor) => void) => {
    if (!editor) return;
    fn(editor);
  };

  const tools = [
    { key: 'bold', icon: <BoldOutlined />, title: '加粗', active: state?.bold, action: (e: Editor) => e.chain().focus().toggleBold().run() },
    { key: 'italic', icon: <ItalicOutlined />, title: '斜体', active: state?.italic, action: (e: Editor) => e.chain().focus().toggleItalic().run() },
    {
      key: 'underline',
      icon: <UnderlineOutlined />,
      title: '下划线',
      active: state?.underline,
      action: (e: Editor) => e.chain().focus().toggleUnderline().run(),
    },
    {
      key: 'strike',
      icon: <StrikethroughOutlined />,
      title: '删除线',
      active: state?.strike,
      action: (e: Editor) => e.chain().focus().toggleStrike().run(),
    },
    {
      key: 'bullet',
      icon: <UnorderedListOutlined />,
      title: '无序列表',
      active: state?.bullet,
      action: (e: Editor) => e.chain().focus().toggleBulletList().run(),
    },
    {
      key: 'ordered',
      icon: <OrderedListOutlined />,
      title: '有序列表',
      active: state?.ordered,
      action: (e: Editor) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      key: 'code',
      icon: <CodeOutlined />,
      title: '代码块',
      active: state?.code,
      action: (e: Editor) => e.chain().focus().toggleCodeBlock().run(),
    },
  ];

  return (
    <div className={`rich-editor ${disabled ? 'rich-editor-disabled' : ''}`}>
      <div className="rich-editor-toolbar">
        <Space size={2} wrap>
          {tools.map((tool) => (
            <Tooltip key={tool.key} title={tool.title}>
              <Button
                size="small"
                type={tool.active ? 'primary' : 'text'}
                icon={tool.icon}
                disabled={disabled}
                onClick={() => run(tool.action)}
              />
            </Tooltip>
          ))}
          <Divider type="vertical" />
          <Tooltip title="撤销">
            <Button
              size="small"
              type="text"
              icon={<UndoOutlined />}
              disabled={disabled || !state?.canUndo}
              onClick={() => run((e) => e.chain().focus().undo().run())}
            />
          </Tooltip>
          <Tooltip title="重做">
            <Button
              size="small"
              type="text"
              icon={<RedoOutlined />}
              disabled={disabled || !state?.canRedo}
              onClick={() => run((e) => e.chain().focus().redo().run())}
            />
          </Tooltip>
        </Space>
      </div>
      <EditorContent editor={editor} />
      {!disabled && (
        <div className="rich-editor-hint">支持加粗、列表等格式，可直接粘贴或拖拽图片（作为附件保存）</div>
      )}
    </div>
  );
}
