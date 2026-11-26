import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AI_KB_SOURCE_DESCRIPTIONS,
  AI_KB_SOURCE_LABELS,
  AI_KB_SOURCES,
  FAQ_VISIBILITIES,
  FAQ_VISIBILITY_LABELS,
  formatDate,
  type AiKbSource,
} from '@ticketreport/shared';
import { api, errorMessage } from '../../lib/api';

const FAQ_IMPORT_PLACEHOLDER = `Q: 如何重置密码？
A: 在登录页点击「忘记密码」，通过邮箱重置；若邮箱不可用请联系管理员。

Q: 工单多久响应？
A: 提交后进入对应处理组队列，紧急问题优先响应。`;

export default function AiSettingsPage() {
  const queryClient = useQueryClient();
  const [llmForm] = Form.useForm();
  const [kbForm] = Form.useForm();
  const [saving, setSaving] = useState<'llm' | 'kb' | null>(null);
  const [faqKeyword, setFaqKeyword] = useState('');
  const [faqPage, setFaqPage] = useState(1);
  const [faqModalOpen, setFaqModalOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<any>(null);
  const [faqForm] = Form.useForm();
  const [importOpen, setImportOpen] = useState(false);
  const [importForm] = Form.useForm();
  const kbSource = Form.useWatch('kbSource', kbForm);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-ai-settings'],
    queryFn: () => api.get('/admin/ai/settings'),
  });

  const { data: faqData, isLoading: faqLoading, refetch: refetchFaq } = useQuery({
    queryKey: ['admin-faq', faqKeyword, faqPage],
    queryFn: () =>
      api.get(`/admin/faq?keyword=${encodeURIComponent(faqKeyword)}&page=${faqPage}&pageSize=10`),
  });

  const { data: enterprises = [] } = useQuery({
    queryKey: ['admin-enterprises-for-faq'],
    queryFn: () => api.get('/admin/enterprises'),
  });

  useEffect(() => {
    if (!data) return;
    llmForm.setFieldsValue({
      aiEnabled: data.aiEnabled,
      aiBaseUrl: data.aiBaseUrl,
      aiModel: data.aiModel,
      aiTemperature: data.aiTemperature,
      aiTimeoutMs: data.aiTimeoutMs,
      aiMaxTokens: data.aiMaxTokens,
      aiTopK: data.aiTopK,
      aiRateLimitPerMinute: data.aiRateLimitPerMinute,
      aiMaxMessageChars: data.aiMaxMessageChars,
      aiHistoryMessages: data.aiHistoryMessages,
      aiApiKey: '',
    });
    kbForm.setFieldsValue({
      kbSource: data.kbSource,
      kbEndpoint: data.kbEndpoint,
      kbTimeoutMs: data.kbTimeoutMs,
      kbAuthHeader: data.kbAuthHeader,
      kbAuthPrefix: data.kbAuthPrefix,
      kbRequestTemplate: data.kbRequestTemplate,
      kbResponseMapping: data.kbResponseMapping,
      kbApiKey: '',
    });
  }, [data, llmForm, kbForm]);

  const save = async (section: 'llm' | 'kb') => {
    try {
      const form = section === 'llm' ? llmForm : kbForm;
      const values = await form.validateFields();
      setSaving(section);
      await api.patch('/admin/ai/settings', values);
      message.success('配置已保存并立即生效');
      queryClient.invalidateQueries({ queryKey: ['admin-ai-settings'] });
      queryClient.invalidateQueries({ queryKey: ['ai-status'] });
      if (section === 'llm') llmForm.setFieldValue('aiApiKey', '');
      else kbForm.setFieldValue('kbApiKey', '');
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(errorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  const clearKey = async (kind: 'ai' | 'kb') => {
    try {
      await api.patch('/admin/ai/settings', kind === 'ai' ? { clearAiApiKey: true } : { clearKbApiKey: true });
      message.success('密钥已清除');
      refetch();
    } catch (error) {
      message.error(errorMessage(error));
    }
  };

  const openFaqModal = (record?: any) => {
    setEditingFaq(record || null);
    faqForm.resetFields();
    if (record) {
      faqForm.setFieldsValue({
        question: record.question,
        answer: record.answer,
        keywords: record.keywords,
        visibility: record.visibility,
        status: record.status,
        enterpriseId: record.enterpriseId,
      });
    } else {
      faqForm.setFieldsValue({ visibility: 'PUBLIC', status: 'ACTIVE' });
    }
    setFaqModalOpen(true);
  };

  const submitFaq = async () => {
    try {
      const values = await faqForm.validateFields();
      if (editingFaq) await api.patch(`/admin/faq/${editingFaq.id}`, values);
      else await api.post('/admin/faq', values);
      message.success(editingFaq ? 'FAQ 已更新' : 'FAQ 已创建');
      setFaqModalOpen(false);
      refetchFaq();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(errorMessage(error));
    }
  };

  const removeFaq = async (id: string) => {
    try {
      await api.del(`/admin/faq/${id}`);
      message.success('FAQ 已删除');
      refetchFaq();
    } catch (error) {
      message.error(errorMessage(error));
    }
  };

  const submitImport = async () => {
    try {
      const values = await importForm.validateFields();
      const result = await api.post('/admin/faq/import', values);
      message.success(`已导入 ${result.created} 条问答`);
      setImportOpen(false);
      importForm.resetFields();
      refetchFaq();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(errorMessage(error));
    }
  };

  const llmTab = (
    <Card loading={isLoading} style={{ maxWidth: 820 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="OpenAI 兼容协议：请求 POST {Base URL}/chat/completions"
        description="API Key 使用 AES-256-GCM 加密存储，前端不回显明文；建议通过环境变量 AI_SECRET_KEY 单独设置加密密钥。"
      />
      <Form form={llmForm} layout="vertical" requiredMark={false}>
        <Form.Item name="aiEnabled" label="启用 AI 助手" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="aiBaseUrl" label="Base URL" extra="例如 https://api.openai.com/v1 或自建兼容网关地址">
          <Input placeholder="https://api.openai.com/v1" maxLength={300} />
        </Form.Item>
        <Form.Item
          name="aiApiKey"
          label="API Key"
          extra={
            data?.aiApiKeyConfigured ? (
              <Space size={8}>
                <Tag color="green">已配置（加密存储）</Tag>
                <Popconfirm title="清除已保存的 API Key？" onConfirm={() => clearKey('ai')}>
                  <Typography.Link type="danger">清除</Typography.Link>
                </Popconfirm>
              </Space>
            ) : (
              '未配置'
            )
          }
        >
          <Input.Password
            placeholder={data?.aiApiKeyConfigured ? '留空表示不修改' : '请输入 API Key'}
            maxLength={500}
            autoComplete="new-password"
          />
        </Form.Item>
        <Space size={16} wrap>
          <Form.Item name="aiModel" label="模型名">
            <Input style={{ width: 240 }} placeholder="gpt-4o-mini" maxLength={100} />
          </Form.Item>
          <Form.Item name="aiTemperature" label="温度">
            <InputNumber min={0} max={2} step={0.1} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="aiTimeoutMs" label="超时（毫秒）">
            <InputNumber min={1000} max={120000} step={1000} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="aiMaxTokens" label="最大输出 Token">
            <InputNumber min={100} max={4000} step={100} style={{ width: 140 }} />
          </Form.Item>
        </Space>
        <Space size={16} wrap>
          <Form.Item name="aiTopK" label="知识片段数（TopK）">
            <InputNumber min={1} max={10} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="aiRateLimitPerMinute" label="每用户每分钟限流">
            <InputNumber min={1} max={120} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="aiMaxMessageChars" label="单条问题字数上限">
            <InputNumber min={200} max={8000} step={100} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="aiHistoryMessages" label="携带历史条数">
            <InputNumber min={0} max={20} style={{ width: 140 }} />
          </Form.Item>
        </Space>
        <Button type="primary" loading={saving === 'llm'} onClick={() => save('llm')}>
          保存大模型配置
        </Button>
      </Form>
    </Card>
  );

  const kbTab = (
    <Card loading={isLoading} style={{ maxWidth: 820 }}>
      <Form form={kbForm} layout="vertical" requiredMark={false}>
        <Form.Item name="kbSource" label="知识来源" extra={kbSource ? AI_KB_SOURCE_DESCRIPTIONS[kbSource] : undefined}>
          <Select
            options={AI_KB_SOURCES.map((source) => ({
              value: source,
              label: AI_KB_SOURCE_LABELS[source],
            }))}
          />
        </Form.Item>

        {kbSource === 'INTERNAL' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="内部知识库为预留占位"
            description="当前实现遵循同一适配器契约但不返回任何内容，检索会自动回退到内置 FAQ；后续接入内部检索服务时无需改动业务代码。"
          />
        )}

        {kbSource === 'EXTERNAL_HTTP' && (
          <>
            <Form.Item
              name="kbEndpoint"
              label="检索接口地址"
              extra="POST JSON；请求体由下方模板渲染，超时与鉴权可配置"
            >
              <Input placeholder="https://kb.example.com/api/search" maxLength={300} />
            </Form.Item>
            <Form.Item
              name="kbApiKey"
              label="接口 Key"
              extra={
                data?.kbApiKeyConfigured ? (
                  <Space size={8}>
                    <Tag color="green">已配置（加密存储）</Tag>
                    <Popconfirm title="清除已保存的知识库 Key？" onConfirm={() => clearKey('kb')}>
                      <Typography.Link type="danger">清除</Typography.Link>
                    </Popconfirm>
                  </Space>
                ) : (
                  '未配置'
                )
              }
            >
              <Input.Password
                placeholder={data?.kbApiKeyConfigured ? '留空表示不修改' : '可选'}
                maxLength={500}
                autoComplete="new-password"
              />
            </Form.Item>
            <Space size={16} wrap>
              <Form.Item name="kbTimeoutMs" label="超时（毫秒）">
                <InputNumber min={500} max={60000} step={500} style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name="kbAuthHeader" label="鉴权 Header">
                <Input style={{ width: 200 }} placeholder="Authorization" maxLength={50} />
              </Form.Item>
              <Form.Item name="kbAuthPrefix" label="鉴权前缀">
                <Input style={{ width: 140 }} placeholder="Bearer " maxLength={50} />
              </Form.Item>
            </Space>
            <Form.Item
              name="kbRequestTemplate"
              label="请求体模板（JSON）"
              extra="支持变量：{{query}}、{{topK}}、{{enterpriseId}}、{{scope}}、{{userId}}"
            >
              <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} />
            </Form.Item>
            <Form.Item
              name="kbResponseMapping"
              label="响应字段映射（JSON）"
              extra="itemsPath 支持点路径，如 data.items；未提供的字段使用默认值"
            >
              <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} />
            </Form.Item>
          </>
        )}

        {kbSource === 'FAQ' && (
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
            message="内置 FAQ 已启用"
            description="在「FAQ 管理」中维护问答条目；检索按关键词打分，客户仅能看到公开且属于本企业或全局的条目。"
          />
        )}

        <Button type="primary" loading={saving === 'kb'} onClick={() => save('kb')}>
          保存知识库配置
        </Button>
      </Form>
    </Card>
  );

  const faqTab = (
    <Card
      loading={faqLoading}
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="搜索问题/答案/关键词"
            style={{ width: 240 }}
            onSearch={(value) => {
              setFaqPage(1);
              setFaqKeyword(value);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => refetchFaq()}>
            刷新
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => openFaqModal()}>
            新建
          </Button>
          <Button onClick={() => setImportOpen(true)}>批量导入</Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        size="small"
        dataSource={faqData?.items ?? []}
        pagination={{
          current: faqPage,
          pageSize: 10,
          total: faqData?.total ?? 0,
          onChange: (page) => setFaqPage(page),
        }}
        columns={[
          { title: '问题', dataIndex: 'question', ellipsis: true },
          {
            title: '可见范围',
            dataIndex: 'visibility',
            width: 130,
            render: (value: string) => (
              <Tag color={value === 'PUBLIC' ? 'green' : 'orange'}>
                {FAQ_VISIBILITY_LABELS[value as 'PUBLIC' | 'INTERNAL'] ?? value}
              </Tag>
            ),
          },
          {
            title: '所属企业',
            dataIndex: 'enterpriseName',
            width: 150,
            render: (value: string | null) => (value ? value : <Tag>全局</Tag>),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (value: string) => <Tag color={value === 'ACTIVE' ? 'blue' : 'default'}>{value === 'ACTIVE' ? '启用' : '停用'}</Tag>,
          },
          { title: '更新时间', dataIndex: 'updatedAt', width: 150, render: (value: string) => formatDate(value) },
          {
            title: '操作',
            width: 140,
            render: (_: any, record: any) => (
              <Space size={4}>
                <Button type="link" size="small" onClick={() => openFaqModal(record)}>
                  编辑
                </Button>
                <Popconfirm title="删除该 FAQ？" onConfirm={() => removeFaq(record.id)}>
                  <Button type="link" size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );

  return (
    <div>
      <h2 className="page-title">AI 问答配置</h2>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="所有配置变更都会写入审计日志；密钥类字段只记录「是否变更」，不记录明文。"
      />
      <Tabs
        items={[
          { key: 'llm', label: '大模型', children: llmTab },
          { key: 'kb', label: '知识库', children: kbTab },
          { key: 'faq', label: 'FAQ 管理', children: faqTab },
        ]}
      />

      <Modal
        title={editingFaq ? '编辑 FAQ' : '新建 FAQ'}
        open={faqModalOpen}
        onCancel={() => setFaqModalOpen(false)}
        onOk={submitFaq}
        okText="保存"
        width={640}
      >
        <Form form={faqForm} layout="vertical">
          <Form.Item name="question" label="问题" rules={[{ required: true, message: '请输入问题' }]}>
            <Input maxLength={200} showCount />
          </Form.Item>
          <Form.Item name="answer" label="答案" rules={[{ required: true, message: '请输入答案' }]}>
            <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} maxLength={5000} showCount />
          </Form.Item>
          <Form.Item name="keywords" label="检索关键词" extra="可选，用逗号分隔，可提高命中率">
            <Input maxLength={200} />
          </Form.Item>
          <Space size={16} wrap>
            <Form.Item name="visibility" label="可见范围" style={{ width: 220 }}>
              <Select
                options={FAQ_VISIBILITIES.map((value) => ({
                  value,
                  label: FAQ_VISIBILITY_LABELS[value],
                }))}
              />
            </Form.Item>
            <Form.Item name="enterpriseId" label="所属企业" style={{ width: 240 }}>
              <Select
                allowClear
                placeholder="全局（所有企业）"
                options={(enterprises as any[]).map((item: any) => ({ value: item.id, label: item.name }))}
              />
            </Form.Item>
            {editingFaq && (
              <Form.Item name="status" label="状态" style={{ width: 140 }}>
                <Select
                  options={[
                    { value: 'ACTIVE', label: '启用' },
                    { value: 'DISABLED', label: '停用' },
                  ]}
                />
              </Form.Item>
            )}
          </Space>
        </Form>
      </Modal>

      <Modal
        title="批量导入 FAQ"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={submitImport}
        okText="导入"
        width={680}
      >
        <Form form={importForm} layout="vertical" initialValues={{ visibility: 'PUBLIC' }}>
          <Form.Item
            name="text"
            label="问答文本"
            extra="格式：每条以「Q: 问题 / A: 答案」书写，条目之间空一行；一次最多 200 条"
            rules={[{ required: true, message: '请输入问答文本' }]}
          >
            <Input.TextArea autoSize={{ minRows: 10, maxRows: 16 }} placeholder={FAQ_IMPORT_PLACEHOLDER} />
          </Form.Item>
          <Space size={16}>
            <Form.Item name="visibility" label="可见范围" style={{ width: 220 }}>
              <Select
                options={FAQ_VISIBILITIES.map((value) => ({
                  value,
                  label: FAQ_VISIBILITY_LABELS[value],
                }))}
              />
            </Form.Item>
            <Form.Item name="enterpriseId" label="所属企业" style={{ width: 240 }}>
              <Select
                allowClear
                placeholder="全局（所有企业）"
                options={(enterprises as any[]).map((item: any) => ({ value: item.id, label: item.name }))}
              />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
