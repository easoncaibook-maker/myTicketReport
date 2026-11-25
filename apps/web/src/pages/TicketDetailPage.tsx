import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Result,
  Select,
  Space,
  Spin,
  Tag,
  Timeline,
  Upload,
  message,
} from 'antd';
import { ArrowLeftOutlined, DownloadOutlined, PaperClipOutlined, SendOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  Role,
  STATUS_LABELS,
  TRANSITIONS,
  TransitionDef,
  availableActions,
  canEditWorkHours,
  formatDate,
} from '@ticketreport/shared';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ACTION_LABELS, EVENT_DOT_COLORS, PriorityTag, RoleTag, StatusTag, formatBytes, formatHours } from '../lib/ui';

export default function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [actionDef, setActionDef] = useState<TransitionDef | null>(null);
  const [actionForm] = Form.useForm();
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>();
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [commentFiles, setCommentFiles] = useState<any[]>([]);
  const [posting, setPosting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [workHoursOpen, setWorkHoursOpen] = useState(false);
  const [workHoursForm] = Form.useForm();

  const { data: ticket, isLoading, error } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.get(`/tickets/${id}`),
  });

  const { data: categories } = useQuery({
    queryKey: ['meta-categories'],
    queryFn: () => api.get('/meta/categories'),
  });

  const { data: groups } = useQuery({
    queryKey: ['meta-groups'],
    queryFn: () => api.get('/meta/groups'),
    enabled: user?.role !== 'REPORTER',
  });

  const { data: agents } = useQuery({
    queryKey: ['meta-agents', selectedGroupId],
    queryFn: () => api.get(`/meta/agents?groupId=${selectedGroupId}`),
    enabled: !!selectedGroupId && user?.role !== 'REPORTER',
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    queryClient.invalidateQueries({ queryKey: ['tickets'] });
    queryClient.invalidateQueries({ queryKey: ['unread-count'] });
  };

  const actions = useMemo(() => {
    if (!ticket || !user) return [];
    return availableActions(ticket.status, user.role as Role).filter((def) => {
      if (['CONFIRM', 'REJECT', 'REOPEN', 'CANCEL'].includes(def.action)) return ticket.reporterId === user.id;
      if (def.action === 'CLAIM') return user.role === 'AGENT' && user.groupIds?.includes(ticket.groupId);
      if (def.action === 'RESOLVE' || def.action === 'TRANSFER') {
        return user.role !== 'AGENT' || ticket.assigneeId === user.id;
      }
      return true;
    });
  }, [ticket, user]);

  const canEditHours = useMemo(() => {
    if (!ticket || !user) return false;
    if (!canEditWorkHours(user.role as Role, ticket.status)) return false;
    return user.role !== 'AGENT' || ticket.assigneeId === user.id;
  }, [ticket, user]);

  const openAction = (def: TransitionDef) => {
    setActionDef(def);
    actionForm.resetFields();
    setSelectedGroupId(ticket?.groupId);
    if (def.action === 'ASSIGN' || def.action === 'TRANSFER') {
      actionForm.setFieldsValue({ groupId: ticket?.groupId });
    }
  };

  const submitAction = async () => {
    if (!actionDef) return;
    try {
      const values = await actionForm.validateFields();
      const path = actionDef.action.toLowerCase().replace('_', '-');
      const body: any = {};
      if (actionDef.action === 'ASSIGN' || actionDef.action === 'TRANSFER') {
        body.groupId = values.groupId;
        body.assigneeId = values.assigneeId || null;
        if (values.reason) body.reason = values.reason;
      }
      if (['RESOLVE'].includes(actionDef.action)) body.resolution = values.resolution;
      if (['REJECT', 'FORCE_CLOSE'].includes(actionDef.action)) body.reason = values.reason;
      if (actionDef.action === 'CANCEL') body.reason = values.reason;

      await api.post(`/tickets/${id}/${path}`, body);
      message.success(`${actionDef.label}成功`);
      setActionDef(null);
      invalidate();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(errorMessage(e));
    }
  };

  const postComment = async () => {
    if (!comment.trim()) {
      message.warning('请输入评论内容');
      return;
    }
    setPosting(true);
    try {
      const attachmentIds: string[] = [];
      for (const f of commentFiles) {
        const uploaded = await api.upload(`/tickets/${id}/attachments`, f.originFileObj as File);
        attachmentIds.push(uploaded.id);
      }
      await api.post(`/tickets/${id}/comments`, {
        content: comment.trim(),
        visibility: internal ? 'INTERNAL' : 'PUBLIC',
        attachmentIds,
      });
      setComment('');
      setCommentFiles([]);
      setInternal(false);
      message.success('已发布');
      invalidate();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setPosting(false);
    }
  };

  const deleteComment = async (commentId: string) => {
    try {
      await api.del(`/comments/${commentId}`);
      message.success('评论已撤回');
      invalidate();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const submitEdit = async () => {
    try {
      const values = await editForm.validateFields();
      await api.patch(`/tickets/${id}`, values);
      message.success('已保存');
      setEditOpen(false);
      invalidate();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(errorMessage(e));
    }
  };

  const submitWorkHours = async () => {
    try {
      const values = await workHoursForm.validateFields();
      await api.patch(`/tickets/${id}/work-hours`, { workHours: values.workHours });
      message.success('处理工时已保存');
      setWorkHoursOpen(false);
      invalidate();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(errorMessage(e));
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !ticket) {
    return <Result status="404" title="工单不存在或无权访问" extra={<Button onClick={() => navigate('/tickets')}>返回列表</Button>} />;
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/tickets')}>
          返回列表
        </Button>
      </Space>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <Space wrap style={{ marginBottom: 8 }}>
              <span className="mono" style={{ color: '#8c8c8c' }}>
                {ticket.ticketNo}
              </span>
              <StatusTag status={ticket.status} />
              <PriorityTag priority={ticket.priority} />
              {ticket.groupName && <Tag color="blue">{ticket.groupName}</Tag>}
              {ticket.categoryName && <Tag>{ticket.categoryName}</Tag>}
            </Space>
            <h2 style={{ margin: 0, fontSize: 20 }}>{ticket.title}</h2>
          </div>
          <Space wrap>
            {actions.map((def) => (
              <Button
                key={def.action}
                type={def.action === 'CONFIRM' || def.action === 'CLAIM' ? 'primary' : 'default'}
                danger={def.danger}
                onClick={() => openAction(def)}
              >
                {def.label}
              </Button>
            ))}
            {user?.role === 'REPORTER' && ticket.reporterId === user.id && ticket.status === 'PENDING' && (
              <Button
                onClick={() => {
                  editForm.setFieldsValue({
                    title: ticket.title,
                    description: ticket.description,
                    categoryId: ticket.categoryId,
                    priority: ticket.priority,
                  });
                  setEditOpen(true);
                }}
              >
                编辑
              </Button>
            )}
          </Space>
        </div>

        {ticket.status === 'CANCELLED' && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 16 }}
            message={`该工单已由提报人撤回${ticket.cancelReason ? `：${ticket.cancelReason}` : '，如需继续跟进请新建工单'}`}
          />
        )}
        {ticket.status === 'CLOSED' && ticket.closeReason && (
          <Alert type="warning" showIcon style={{ marginTop: 16 }} message={`关闭原因：${ticket.closeReason}`} />
        )}

        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small" style={{ marginTop: 16 }}>
          <Descriptions.Item label="提报人">
            {ticket.reporterName}
            {ticket.reporterEmail ? `（${ticket.reporterEmail}）` : ''}
          </Descriptions.Item>
          <Descriptions.Item label="处理人">{ticket.assigneeName || '未分配'}</Descriptions.Item>
          <Descriptions.Item label="处理组">{ticket.groupName || '-'}</Descriptions.Item>
          <Descriptions.Item label="企业">{ticket.enterpriseName || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{formatDate(ticket.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{formatDate(ticket.lastActivityAt)}</Descriptions.Item>
          {ticket.closedAt && <Descriptions.Item label="关闭时间">{formatDate(ticket.closedAt)}</Descriptions.Item>}
          {ticket.cancelledAt && <Descriptions.Item label="撤回时间">{formatDate(ticket.cancelledAt)}</Descriptions.Item>}
          <Descriptions.Item label="重开次数">{ticket.reopenCount ?? 0}</Descriptions.Item>
          <Descriptions.Item label="处理工时">
            <Space size={4}>
              <span>{formatHours(ticket.workHours)}</span>
              {canEditHours && (
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    workHoursForm.setFieldsValue({ workHours: ticket.workHours ?? undefined });
                    setWorkHoursOpen(true);
                  }}
                >
                  {ticket.workHours === null || ticket.workHours === undefined ? '填写' : '修改'}
                </Button>
              )}
            </Space>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="问题描述" style={{ marginBottom: 16 }}>
        <div className="ticket-description">{ticket.description}</div>
        {ticket.resolution && (
          <>
            <Divider orientation="left">处理结果</Divider>
            <div className="ticket-description">{ticket.resolution}</div>
          </>
        )}
        {ticket.attachments?.length > 0 && (
          <>
            <Divider orientation="left">附件</Divider>
            <Space direction="vertical">
              {ticket.attachments.map((a: any) => (
                <Space key={a.id}>
                  <PaperClipOutlined />
                  <span>{a.originalName}</span>
                  <span style={{ color: '#8c8c8c' }}>{formatBytes(a.size)}</span>
                  <Button
                    type="link"
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => api.download(a.downloadUrl, a.originalName).catch((e) => message.error(errorMessage(e)))}
                  >
                    下载
                  </Button>
                </Space>
              ))}
            </Space>
          </>
        )}
      </Card>

      <Card title="处理时间线" style={{ marginBottom: 16 }}>
        {ticket.events?.length ? (
          <Timeline
            items={ticket.events.map((e: any) => ({
              color: EVENT_DOT_COLORS[e.action] || 'blue',
              children: (
                <div>
                  <Space wrap>
                    <strong>{e.actorName}</strong>
                    <span>{ACTION_LABELS[e.action] ?? e.action}</span>
                    {e.action === 'WORK_HOURS' ? (
                      <Tag color="cyan">
                        {e.fromValue ?? '未填写'} → {e.toValue ?? '未填写'} 小时
                      </Tag>
                    ) : (
                      <>
                        {e.fromValue && <Tag>{e.fromValue}</Tag>}
                        {e.toValue && <Tag color="blue">{e.toValue}</Tag>}
                      </>
                    )}
                    {e.visible === 'INTERNAL' && <Tag color="gold">内部</Tag>}
                  </Space>
                  <div style={{ fontSize: 12, color: '#8c8c8c' }}>{formatDate(e.createdAt)}</div>
                  {e.reason && <div style={{ marginTop: 4, color: '#595959' }}>说明：{e.reason}</div>}
                </div>
              ),
            }))}
          />
        ) : (
          <Empty description="暂无记录" />
        )}
      </Card>

      <Card title={`评论与备注（${ticket.comments?.length ?? 0}）`}>
        <List
          dataSource={ticket.comments ?? []}
          locale={{ emptyText: '暂无评论' }}
          renderItem={(c: any) => (
            <div className="comment-item">
              <div style={{ flex: 1 }}>
                <div className="comment-meta">
                  <Space wrap size={8}>
                    <strong style={{ color: '#303030' }}>{c.authorName}</strong>
                    <RoleTag role={c.authorRole} />
                    {c.visibility === 'INTERNAL' && <Tag color="gold">内部备注</Tag>}
                    <span>{formatDate(c.createdAt)}</span>
                    {c.authorId === user?.id && (
                      <Button type="link" size="small" danger onClick={() => deleteComment(c.id)}>
                        撤回
                      </Button>
                    )}
                  </Space>
                </div>
                <div className={`comment-content ${c.visibility === 'INTERNAL' ? 'comment-internal' : ''}`}>{c.content}</div>
                {c.attachments?.length > 0 && (
                  <Space direction="vertical" style={{ marginTop: 6 }}>
                    {c.attachments.map((a: any) => (
                      <Button
                        key={a.id}
                        type="link"
                        size="small"
                        icon={<PaperClipOutlined />}
                        onClick={() => api.download(a.downloadUrl, a.originalName).catch((e) => message.error(errorMessage(e)))}
                      >
                        {a.originalName}
                      </Button>
                    ))}
                  </Space>
                )}
              </div>
            </div>
          )}
        />

        <Divider />
        {user?.role !== 'REPORTER' && (
          <Space style={{ marginBottom: 8 }}>
            <Select
              value={internal ? 'INTERNAL' : 'PUBLIC'}
              onChange={(v) => setInternal(v === 'INTERNAL')}
              style={{ width: 150 }}
              options={[
                { value: 'PUBLIC', label: '公开评论' },
                { value: 'INTERNAL', label: '内部备注' },
              ]}
            />
            <span style={{ color: '#8c8c8c', fontSize: 12 }}>
              {internal ? '内部备注仅运维可见，不发送客户邮件' : '公开评论双方可见'}
            </span>
          </Space>
        )}
        <Input.TextArea
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={5000}
          showCount
          placeholder={internal ? '填写内部处理记录…' : '填写公开评论…'}
        />
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <Upload
            multiple
            maxCount={5}
            beforeUpload={() => false}
            fileList={commentFiles}
            onChange={({ fileList }) => setCommentFiles(fileList)}
          >
            <Button icon={<PaperClipOutlined />}>添加附件</Button>
          </Upload>
          <Button type="primary" icon={<SendOutlined />} loading={posting} onClick={postComment}>
            发布
          </Button>
        </div>
      </Card>

      <Modal
        open={!!actionDef}
        title={actionDef?.label}
        onCancel={() => setActionDef(null)}
        onOk={submitAction}
        okText="确认"
        cancelText="取消"
        okButtonProps={{ danger: actionDef?.danger }}
        destroyOnClose
      >
        <Form form={actionForm} layout="vertical" style={{ marginTop: 12 }}>
          {actionDef?.requiresResolution && (
            <Form.Item name="resolution" label="处理结果" rules={[{ required: true, message: '请填写处理结果' }, { min: 5 }]}>
              <Input.TextArea rows={4} placeholder="说明问题的原因与处理方式" />
            </Form.Item>
          )}
          {(actionDef?.action === 'ASSIGN' || actionDef?.action === 'TRANSFER') && (
            <>
              <Form.Item name="groupId" label="目标处理组" rules={[{ required: true, message: '请选择处理组' }]}>
                <Select
                  placeholder="请选择处理组"
                  options={(groups ?? []).map((g: any) => ({ value: g.id, label: g.name }))}
                  onChange={(v) => {
                    setSelectedGroupId(v);
                    actionForm.setFieldValue('assigneeId', undefined);
                  }}
                />
              </Form.Item>
              <Form.Item name="assigneeId" label="指定处理人（可选）">
                <Select
                  allowClear
                  placeholder={actionDef.action === 'TRANSFER' ? '不指定则工单回落为待受理' : '不指定则等待组内认领'}
                  options={(agents ?? []).map((a: any) => ({ value: a.id, label: a.name }))}
                />
              </Form.Item>
              <Form.Item
                name="reason"
                label="原因"
                rules={actionDef.action === 'TRANSFER' ? [{ required: true, message: '请填写转派原因' }] : []}
              >
                <Input.TextArea rows={2} placeholder="记录改派 / 转派原因" />
              </Form.Item>
            </>
          )}
          {['REJECT', 'FORCE_CLOSE'].includes(actionDef?.action ?? '') && (
            <Form.Item name="reason" label="原因" rules={[{ required: true, message: '请填写原因' }]}>
              <Input.TextArea rows={3} placeholder="请填写原因，操作将记入日志" />
            </Form.Item>
          )}
          {actionDef?.action === 'CANCEL' && (
            <>
              <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="撤回后工单将作废且不可恢复，如需继续跟进请重新提交。" />
              <Form.Item name="reason" label="撤回原因（可选）">
                <Input.TextArea rows={3} placeholder="例如：重复提交、误报" />
              </Form.Item>
            </>
          )}
          {['CONFIRM', 'REOPEN', 'CLAIM', 'RELEASE'].includes(actionDef?.action ?? '') && (
            <div style={{ color: '#595959' }}>
              {actionDef?.action === 'CONFIRM' && '确认问题已解决后，工单将关闭。'}
              {actionDef?.action === 'REOPEN' && `重开后工单回到处理中；仅关闭后 ${7} 天内可重开（以系统设置为准）。`}
              {actionDef?.action === 'CLAIM' && '认领后工单进入处理中，处理人为你本人。'}
              {actionDef?.action === 'RELEASE' && '撤回认领后工单回到待受理，由组内重新认领。'}
            </div>
          )}
        </Form>
      </Modal>

      <Modal
        open={workHoursOpen}
        title="填写处理工时"
        onCancel={() => setWorkHoursOpen(false)}
        onOk={submitWorkHours}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={workHoursForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="workHours"
            label="处理工时（小时）"
            rules={[{ required: true, message: '请输入处理工时' }]}
          >
            <InputNumber min={0} max={999.9} step={0.1} precision={1} style={{ width: '100%' }} placeholder="例如 2.5" />
          </Form.Item>
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>支持一位小数，修改会记录到工单时间线。</div>
        </Form>
      </Modal>

      <Modal open={editOpen} title="编辑工单" onCancel={() => setEditOpen(false)} onOk={submitEdit} okText="保存" destroyOnClose>
        <Form form={editForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true }, { min: 5, max: 100 }]}>
            <Input maxLength={100} showCount />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item name="categoryId" label="分类" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={(categories ?? []).map((c: any) => ({ value: c.id, label: c.name }))} />
            </Form.Item>
            <Form.Item name="priority" label="优先级" rules={[{ required: true }]} style={{ width: 150 }}>
              <Select options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="问题描述" rules={[{ required: true }, { min: 10 }]}>
            <Input.TextArea rows={6} maxLength={5000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
