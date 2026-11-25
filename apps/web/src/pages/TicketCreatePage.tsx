import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Form, Input, Select, Space, Upload, message } from 'antd';
import { ArrowLeftOutlined, InboxOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PRIORITIES, PRIORITY_LABELS } from '@ticketreport/shared';
import { api, errorMessage } from '../lib/api';

export default function TicketCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [files, setFiles] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { data: categories } = useQuery({
    queryKey: ['meta-categories'],
    queryFn: () => api.get('/meta/categories'),
  });

  const onFinish = async (values: any) => {
    setSubmitting(true);
    try {
      const ticket = await api.post('/tickets', {
        title: values.title.trim(),
        description: values.description,
        categoryId: values.categoryId,
        priority: values.priority,
      });
      let failed = 0;
      for (const f of files) {
        try {
          await api.upload(`/tickets/${ticket.id}/attachments`, f.originFileObj as File);
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) message.warning(`工单已提交，但有 ${failed} 个附件上传失败`);
      else message.success(`工单已提交：${ticket.ticketNo}`);
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      navigate(`/tickets/${ticket.id}`, { replace: true });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/tickets')}>
          返回
        </Button>
      </Space>
      <Card>
        <h2 className="page-title">提交工单</h2>
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{ priority: 'P3' }}
          requiredMark="optional"
        >
          <Form.Item
            name="title"
            label="标题"
            rules={[
              { required: true, message: '请输入标题' },
              { min: 5, max: 100, message: '标题需 5–100 字' },
            ]}
          >
            <Input placeholder="简要描述问题，例如：财务系统登录报错" maxLength={100} showCount />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item
              name="categoryId"
              label="分类"
              rules={[{ required: true, message: '请选择分类' }]}
              style={{ flex: 1, minWidth: 260 }}
            >
              <Select
                placeholder="请选择分类"
                options={(categories ?? []).map((c: any) => ({ value: c.id, label: c.name }))}
              />
            </Form.Item>
            <Form.Item name="priority" label="优先级" rules={[{ required: true }]} style={{ width: 180 }}>
              <Select options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
            </Form.Item>
          </Space>
          <Form.Item
            name="description"
            label="问题描述"
            rules={[
              { required: true, message: '请输入问题描述' },
              { min: 10, max: 5000, message: '描述需 10–5000 字' },
            ]}
          >
            <Input.TextArea
              rows={7}
              maxLength={5000}
              showCount
              placeholder="请描述现象、发生时间、影响范围、已尝试的操作等，便于快速定位问题。"
            />
          </Form.Item>
          <Form.Item label="附件（可选，最多 5 个）">
            <Upload.Dragger
              multiple
              maxCount={5}
              beforeUpload={() => false}
              fileList={files}
              onChange={({ fileList }) => setFiles(fileList)}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
              <p className="ant-upload-hint">支持图片、文档、文本与压缩包，单文件不超过设置上限</p>
            </Upload.Dragger>
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={submitting}>
              提交工单
            </Button>
            <Button onClick={() => navigate('/tickets')}>取消</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
