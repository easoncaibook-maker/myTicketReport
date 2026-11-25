import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Form, Input, Radio, Select, Space, Upload, message } from 'antd';
import { ArrowLeftOutlined, InboxOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PRIORITIES, PRIORITY_LABELS } from '@ticketreport/shared';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import RichTextEditor from '../components/RichTextEditor';
import { richTextToPlainText } from '../lib/rich-text';

export default function TicketCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [files, setFiles] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  /** 描述中粘贴的图片：建立工单后按占位序号上传 */
  const pendingImages = useRef<File[]>([]);
  const ticketType = Form.useWatch('ticketType', form);
  const isOps = user?.role === 'AGENT' || user?.role === 'OPS_LEAD' || user?.role === 'ADMIN';

  const { data: categories } = useQuery({
    queryKey: ['meta-categories'],
    queryFn: () => api.get('/meta/categories'),
  });

  const { data: enterprises } = useQuery({
    queryKey: ['meta-enterprises'],
    queryFn: () => api.get('/meta/enterprises'),
    enabled: isOps,
  });

  const onFinish = async (values: any) => {
    setSubmitting(true);
    try {
      const payload: any = {
        title: values.title.trim(),
        description: values.description,
        categoryId: values.categoryId,
        priority: values.priority,
      };
      if (isOps) {
        payload.ticketType = values.ticketType;
        if (values.ticketType === 'CUSTOMER') payload.enterpriseId = values.enterpriseId;
      }
      const ticket = await api.post('/tickets', payload);
      let failed = 0;
      for (const f of files) {
        try {
          await api.upload(`/tickets/${ticket.id}/attachments`, f.originFileObj as File);
        } catch {
          failed += 1;
        }
      }
      // 描述中粘贴的图片：工单创建后上传为附件，再把占位替换成附件地址
      const uploadedImages = new Map<number, { id: string; downloadUrl: string }>();
      for (let i = 0; i < pendingImages.current.length; i += 1) {
        try {
          const uploaded = await api.upload(`/tickets/${ticket.id}/attachments`, pendingImages.current[i]);
          uploadedImages.set(i, { id: uploaded.id, downloadUrl: uploaded.downloadUrl });
        } catch {
          failed += 1;
        }
      }
      if (uploadedImages.size > 0) {
        const holder = document.createElement('div');
        holder.innerHTML = payload.description;
        holder.querySelectorAll('img[data-pending-image]').forEach((img) => {
          const index = Number(img.getAttribute('data-pending-image'));
          const uploaded = uploadedImages.get(index);
          if (uploaded) {
            img.setAttribute('src', uploaded.downloadUrl);
            img.setAttribute('data-attachment-id', uploaded.id);
          } else {
            img.remove();
          }
          img.removeAttribute('data-pending-image');
        });
        await api.patch(`/tickets/${ticket.id}`, { description: holder.innerHTML });
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
          initialValues={{ priority: 'P3', ticketType: isOps ? 'CUSTOMER' : undefined }}
          requiredMark="optional"
        >
          {isOps && (
            <Form.Item name="ticketType" label="工单归属" rules={[{ required: true }]}>
              <Radio.Group optionType="button" buttonStyle="solid">
                <Radio.Button value="CUSTOMER">代客户提单</Radio.Button>
                <Radio.Button value="INTERNAL">内部工单</Radio.Button>
              </Radio.Group>
            </Form.Item>
          )}
          {isOps && ticketType === 'CUSTOMER' && (
            <Form.Item
              name="enterpriseId"
              label="客户企业"
              rules={[{ required: true, message: '请选择客户企业' }]}
            >
              <Select
                showSearch
                placeholder="请选择代提报的客户企业"
                optionFilterProp="label"
                options={(enterprises ?? []).map((e: any) => ({ value: e.id, label: e.name }))}
              />
            </Form.Item>
          )}
          {isOps && ticketType === 'INTERNAL' && (
            <div style={{ marginBottom: 16, color: '#8c8c8c', fontSize: 13 }}>
              内部工单不关联客户企业，仅运维团队可见，不进入客户满意度统计。
            </div>
          )}
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
              {
                validator: (_, value) => {
                  const length = richTextToPlainText(value).length;
                  if (length === 0) return Promise.reject(new Error('请输入问题描述'));
                  if (length < 10) return Promise.reject(new Error('描述至少 10 个字'));
                  if (length > 5000) return Promise.reject(new Error('描述最多 5000 个字'));
                  return Promise.resolve();
                },
              },
            ]}
          >
            <RichTextEditor
              uploadImage={async (file) => ({ pendingIndex: pendingImages.current.push(file) - 1 })}
              placeholder="请描述现象、发生时间、影响范围、已尝试的操作等，便于快速定位问题。"
              minHeight={160}
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
