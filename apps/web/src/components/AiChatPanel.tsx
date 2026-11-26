import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Popover,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  AI_KB_SOURCE_LABELS,
  AI_TICKET_DRAFT_CONTRACT,
  type AiChatMessageView,
  type AiConversationView,
  type AiStatusView,
  formatDate,
} from '@ticketreport/shared';
import { api, errorMessage } from '../lib/api';

const CITATION_SOURCE_LABELS: Record<string, string> = {
  FAQ: 'FAQ',
  EXTERNAL_HTTP: '外部知识库',
  INTERNAL: '内部知识库',
};

interface Props {
  /** 悬浮抽屉内使用紧凑布局：隐藏左侧会话列表 */
  compact?: boolean;
}

export default function AiChatPanel({ compact }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiChatMessageView[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: status } = useQuery<AiStatusView>({
    queryKey: ['ai-status'],
    queryFn: () => api.get('/ai/status'),
  });

  const { data: conversations = [], refetch: refetchConversations } = useQuery<AiConversationView[]>({
    queryKey: ['ai-conversations'],
    queryFn: () => api.get('/ai/conversations'),
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    // 完整页面默认打开最近一次对话，悬浮抽屉保持空白新建
    if (!compact && !activeId && conversations.length > 0) {
      loadConversation(conversations[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length, compact]);

  async function loadConversation(id: string) {
    setActiveId(id);
    setLoadingMessages(true);
    try {
      const data = await api.get(`/ai/conversations/${id}`);
      setMessages(data.messages || []);
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setLoadingMessages(false);
    }
  }

  const newConversation = () => {
    setActiveId(null);
    setMessages([]);
    setInput('');
  };

  const removeConversation = async (id: string) => {
    try {
      await api.del(`/ai/conversations/${id}`);
      if (activeId === id) newConversation();
      refetchConversations();
    } catch (error) {
      message.error(errorMessage(error));
    }
  };

  const send = async (preset?: string) => {
    const content = (preset ?? input).trim();
    if (!content || sending) return;
    setSending(true);
    const optimistic: AiChatMessageView = {
      id: `tmp-${Date.now()}`,
      role: 'USER',
      content,
      citations: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput('');
    try {
      const result = await api.post('/ai/chat', {
        message: content,
        conversationId: activeId || undefined,
      });
      setActiveId(result.conversationId);
      setMessages((prev) => [
        ...prev.filter((item) => item.id !== optimistic.id),
        { ...optimistic, id: `user-${Date.now()}` },
        result.message,
      ]);
      refetchConversations();
    } catch (error) {
      setMessages((prev) => prev.filter((item) => item.id !== optimistic.id));
      setInput(content);
      message.error(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const chatArea = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {status && !status.configured && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="AI 助手暂不可用"
          description={status.notice}
        />
      )}
      {status && (
        <Space size={6} wrap style={{ marginBottom: 8 }}>
          <Tag color="blue">知识来源：{AI_KB_SOURCE_LABELS[status.kbSource] || status.kbSource}</Tag>
          {!status.kbConfigured && <Tag color="orange">知识库未配置，将使用内置 FAQ 兜底</Tag>}
          <Tag>每分钟最多 {status.rateLimitPerMinute} 次提问</Tag>
        </Space>
      )}

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: compact ? 320 : 420,
          overflowY: 'auto',
          background: '#fafafa',
          borderRadius: 8,
          padding: 12,
        }}
      >
        {loadingMessages ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : messages.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="向 AI 助手提问，回答会标注知识来源"
            style={{ paddingTop: 32 }}
          >
            {!!status?.suggestedQuestions?.length && (
              <Space direction="vertical" size={6} style={{ marginTop: 8 }}>
                {status.suggestedQuestions.slice(0, 4).map((question) => (
                  <Button key={question} size="small" onClick={() => send(question)}>
                    {question}
                  </Button>
                ))}
              </Space>
            )}
          </Empty>
        ) : (
          messages.map((item) => (
            <div key={item.id} style={{ marginBottom: 14 }}>
              <div style={{ textAlign: item.role === 'USER' ? 'right' : 'left' }}>
                <div
                  style={{
                    display: 'inline-block',
                    maxWidth: '86%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: 10,
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.7,
                    background: item.role === 'USER' ? '#1668dc' : '#ffffff',
                    color: item.role === 'USER' ? '#fff' : 'inherit',
                    border: item.role === 'USER' ? 'none' : '1px solid #f0f0f0',
                  }}
                >
                  {item.content}
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#999', marginTop: 4, textAlign: item.role === 'USER' ? 'right' : 'left' }}>
                {formatDate(item.createdAt)}
              </div>
              {item.role === 'ASSISTANT' && (
                <div style={{ marginTop: 6 }}>
                  {item.citations?.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        参考来源：
                      </Typography.Text>
                      <Space size={4} wrap>
                        {item.citations.map((citation) => (
                          <Popover
                            key={`${item.id}-${citation.index}`}
                            title={`[${citation.index}] ${citation.title}`}
                            content={
                              <div style={{ maxWidth: 360 }}>
                                <Typography.Paragraph style={{ marginBottom: 6 }}>
                                  {citation.snippet}
                                </Typography.Paragraph>
                                <Space size={8}>
                                  <Tag>{CITATION_SOURCE_LABELS[citation.source] || citation.source}</Tag>
                                  {citation.url && (
                                    <a href={citation.url} target="_blank" rel="noreferrer">
                                      查看原文
                                    </a>
                                  )}
                                </Space>
                              </div>
                            }
                          >
                            <Tag color="blue" style={{ cursor: 'pointer' }}>
                              [{citation.index}] {citation.title}
                            </Tag>
                          </Popover>
                        ))}
                      </Space>
                    </div>
                  )}
                  <Button size="small" onClick={() => setDraftOpen(true)}>
                    上报为工单
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
        {sending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#888' }}>
            <Spin size="small" /> AI 正在检索知识并生成回答…
          </div>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <Input.TextArea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            status?.configured
              ? '输入问题，Enter 发送，Shift+Enter 换行'
              : 'AI 助手尚未配置完成，仍可浏览历史对话'
          }
          autoSize={{ minRows: 2, maxRows: 5 }}
          maxLength={status?.maxMessageChars ?? 4000}
          showCount
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => send()}>
            发送
          </Button>
        </div>
      </div>
    </div>
  );

  const conversationList = (
    <div style={{ width: 232, borderRight: '1px solid #f0f0f0', paddingRight: 12, display: 'flex', flexDirection: 'column' }}>
      <Button type="dashed" icon={<PlusOutlined />} onClick={newConversation} style={{ marginBottom: 8 }}>
        新对话
      </Button>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <List
          size="small"
          dataSource={conversations}
          locale={{ emptyText: '暂无对话' }}
          renderItem={(item) => (
            <List.Item
              style={{
                cursor: 'pointer',
                paddingInline: 8,
                borderRadius: 6,
                background: activeId === item.id ? '#e6f0ff' : undefined,
              }}
              onClick={() => loadConversation(item.id)}
              actions={[
                <Popconfirm
                  key="delete"
                  title="删除该对话？"
                  description="对话记录不可恢复"
                  onConfirm={(event) => {
                    event?.stopPropagation();
                    removeConversation(item.id);
                  }}
                  onCancel={(event) => event?.stopPropagation()}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(event) => event.stopPropagation()}
                  />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={<Typography.Text ellipsis style={{ fontSize: 13 }}>{item.title}</Typography.Text>}
                description={
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {formatDate(item.lastMessageAt)}
                  </Typography.Text>
                }
              />
            </List.Item>
          )}
        />
      </div>
    </div>
  );

  return (
    <>
      <div style={{ display: 'flex', gap: 12, height: compact ? '100%' : 'calc(100vh - 150px)' }}>
        {!compact && conversationList}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {compact && (
            <Space style={{ marginBottom: 8, width: '100%' }} size={6}>
              <Select
                style={{ width: 220 }}
                placeholder="选择历史对话"
                value={activeId ?? undefined}
                options={conversations.map((item) => ({ value: item.id, label: item.title }))}
                onChange={(value) => loadConversation(value)}
                allowClear
                onClear={newConversation}
              />
              <Button icon={<PlusOutlined />} onClick={newConversation}>
                新对话
              </Button>
            </Space>
          )}
          {chatArea}
        </div>
      </div>

      <Modal
        title="上报为工单（设计预览）"
        open={draftOpen}
        onCancel={() => setDraftOpen(false)}
        footer={
          <Button type="primary" onClick={() => setDraftOpen(false)}>
            我知道了
          </Button>
        }
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="本版本尚未实现，不会创建任何工单"
          description="以下为后续版本的交互方案与接口契约，当前仅用于评审。"
        />
        <Typography.Paragraph>
          交互方案：用户在 AI 回答下点击「上报为工单」→ 系统调用大模型，从当前对话上下文生成工单草稿（标题、描述、
          分类、优先级）→ 在弹窗中展示草稿供用户编辑确认 → 用户确认后才跳转到「提交工单」页并预填，最终仍调用现有
          <Typography.Text code>POST /api/tickets</Typography.Text> 创建，AI 侧不直接落库。
        </Typography.Paragraph>
        <Divider style={{ margin: '10px 0' }} />
        <Typography.Text strong>接口契约</Typography.Text>
        <pre style={{ background: '#f6f8fa', padding: 10, borderRadius: 6, fontSize: 12, overflow: 'auto' }}>
          {JSON.stringify(AI_TICKET_DRAFT_CONTRACT, null, 2)}
        </pre>
      </Modal>
    </>
  );
}
