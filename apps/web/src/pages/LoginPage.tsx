import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Checkbox, Form, Input, Space, Typography } from 'antd';
import { FileTextOutlined, LockOutlined, MailOutlined, SafetyOutlined } from '@ant-design/icons';
import QRCode from 'qrcode';
import { errorMessage } from '../lib/api';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import SliderCaptcha, { SliderPuzzle } from '../components/SliderCaptcha';

type Stage = 'credentials' | 'slider' | 'email' | 'totp' | 'enroll' | 'recovery';

const DEVICE_KEY = 'tr_trusted_device';

export default function LoginPage() {
  const { completeLogin, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [stage, setStage] = useState<Stage>('credentials');
  const [payload, setPayload] = useState<any>(null);
  const [pendingResult, setPendingResult] = useState<any>(null);
  const [emailCode, setEmailCode] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [enrollQr, setEnrollQr] = useState<string | null>(null);

  const storedDevice = useMemo(() => {
    try {
      return localStorage.getItem(DEVICE_KEY);
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((v) => v - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (stage !== 'enroll' || !payload?.otpauthUrl) {
      setEnrollQr(null);
      return;
    }
    QRCode.toDataURL(payload.otpauthUrl, { width: 180, margin: 1 })
      .then(setEnrollQr)
      .catch(() => setEnrollQr(null));
  }, [stage, payload]);

  if (user) {
    return <Navigate to={user.mustChangePassword ? '/change-password' : location.state?.from || '/tickets'} replace />;
  }

  const go = (target: string) => navigate(target, { replace: true });

  const finish = (result: any) => {
    if (result.trustedDeviceToken) {
      try {
        localStorage.setItem(DEVICE_KEY, result.trustedDeviceToken);
      } catch {
        // 忽略本地存储不可用
      }
    }
    if (result.recoveryCodes?.length) {
      setPendingResult(result);
      setStage('recovery');
      return;
    }
    completeLogin(result.accessToken, result.user);
    go(result.user.mustChangePassword ? '/change-password' : location.state?.from || '/tickets');
  };

  const resetToCredentials = () => {
    setStage('credentials');
    setPayload(null);
    setPendingResult(null);
    setEmailCode('');
    setTotpCode('');
    setUseRecoveryCode(false);
    setError(null);
    setNotice(null);
  };

  const onCredentials = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post('/auth/login', {
        email: values.email.trim(),
        password: values.password,
        ...(storedDevice ? { deviceToken: storedDevice } : {}),
      });
      if (res.accessToken) {
        finish(res);
        return;
      }
      setPayload(res);
      if (res.requiresTotpSetup) {
        setStage('enroll');
      } else if (res.mode === 'SLIDER') {
        setStage('slider');
        if (res.fallbackReason === 'TOTP_NOT_BOUND') {
          setNotice('该账号尚未绑定验证器，本次使用滑块验证；登录后可在个人设置中绑定。');
        }
      } else if (res.mode === 'EMAIL_CODE') {
        setStage('email');
        setCountdown(res.resendAfterSeconds ?? 60);
        if (res.devCode) setNotice(`未配置 SMTP，本次验证码：${res.devCode}`);
      } else {
        setStage('totp');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const onSliderVerify = async (x: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/login/verify', { challengeId: payload.challengeId, sliderX: x });
      finish(res);
    } catch (e) {
      setError(errorMessage(e));
      try {
        const next = await api.post('/auth/login/slider/refresh', { challengeId: payload.challengeId });
        setPayload(next);
      } catch {
        // 挑战已失效时返回第一步重新登录
        resetToCredentials();
      }
    } finally {
      setLoading(false);
    }
  };

  const onEmailVerify = async () => {
    if (!/^\d{6}$/.test(emailCode.trim())) {
      setError('请输入 6 位验证码');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/login/verify', {
        challengeId: payload.challengeId,
        code: emailCode.trim(),
        rememberDevice,
      });
      finish(res);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/login/email-code', { challengeId: payload.challengeId });
      setCountdown(res.resendAfterSeconds ?? 60);
      setNotice(res.devCode ? `验证码已重新发送；未配置 SMTP，本次验证码：${res.devCode}` : '验证码已重新发送');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const onTotpVerify = async () => {
    if (!totpCode.trim()) {
      setError('请输入验证码或恢复码');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body = useRecoveryCode
        ? { challengeId: payload.challengeId, recoveryCode: totpCode.trim() }
        : { challengeId: payload.challengeId, code: totpCode.trim() };
      const res = await api.post('/auth/login/verify', body);
      finish(res);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const onEnroll = async () => {
    if (!/^\d{6}$/.test(totpCode.trim())) {
      setError('请输入验证器中的 6 位动态码');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/login/totp/enroll', {
        enrollToken: payload.enrollToken,
        code: totpCode.trim(),
      });
      finish(res);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const onRecoverySaved = () => {
    if (!pendingResult) return;
    completeLogin(pendingResult.accessToken, pendingResult.user);
    go(pendingResult.user.mustChangePassword ? '/change-password' : location.state?.from || '/tickets');
  };

  const title = {
    credentials: '账号登录',
    slider: '安全验证',
    email: '邮箱验证',
    totp: '验证器验证',
    enroll: '绑定验证器',
    recovery: '保存恢复码',
  }[stage];

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <FileTextOutlined style={{ fontSize: 34, color: '#1668dc' }} />
          <h1>运维工单系统</h1>
          <p>{stage === 'credentials' ? '客户报障 · 运维受理 · 全程可追溯' : title}</p>
        </div>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        {notice && <Alert type="info" message={notice} showIcon style={{ marginBottom: 16 }} />}

        {stage === 'credentials' && (
          <>
            <Form layout="vertical" onFinish={onCredentials} requiredMark={false} size="large">
              <Form.Item
                name="email"
                label="邮箱"
                rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '邮箱格式不正确' }]}
              >
                <Input prefix={<MailOutlined />} placeholder="name@company.com" autoComplete="username" />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 12 }}>
                <Button type="primary" htmlType="submit" block loading={loading}>
                  登录
                </Button>
              </Form.Item>
            </Form>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography.Text type="secondary">账号由管理员邀请创建</Typography.Text>
              <Link to="/forgot-password">忘记密码？</Link>
            </div>
          </>
        )}

        {stage === 'slider' && payload?.slider && (
          <SliderCaptcha
            puzzle={payload.slider as SliderPuzzle}
            disabled={loading}
            onVerify={onSliderVerify}
            onRefresh={async () => {
              setError(null);
              try {
                const next = await api.post('/auth/login/slider/refresh', { challengeId: payload.challengeId });
                setPayload(next);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          />
        )}

        {stage === 'email' && (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`验证码已发送至 ${payload?.maskedEmail || '账号邮箱'}，10 分钟内有效`}
            />
            <Input
              size="large"
              maxLength={6}
              value={emailCode}
              onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ''))}
              placeholder="请输入 6 位验证码"
              style={{ letterSpacing: 6, textAlign: 'center', marginBottom: 12 }}
            />
            <Checkbox checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} style={{ marginBottom: 16 }}>
              信任此设备（{payload?.trustedDeviceDays ?? 7} 天内免验证，可在个人设置中撤销）
            </Checkbox>
            <Button type="primary" block loading={loading} onClick={onEmailVerify}>
              验证并登录
            </Button>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between' }}>
              <Button type="link" size="small" onClick={onResend} disabled={loading || countdown > 0}>
                {countdown > 0 ? `重新发送（${countdown}s）` : '重新发送验证码'}
              </Button>
              <Button type="link" size="small" onClick={resetToCredentials}>
                返回
              </Button>
            </div>
          </div>
        )}

        {stage === 'totp' && (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`请输入验证器中的 6 位动态码（${payload?.maskedEmail || ''}）`}
            />
            <Input
              size="large"
              maxLength={useRecoveryCode ? 16 : 6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder={useRecoveryCode ? '请输入一次性恢复码' : '6 位动态码'}
              prefix={<SafetyOutlined />}
              style={{ marginBottom: 12, letterSpacing: useRecoveryCode ? 1 : 6, textAlign: 'center' }}
            />
            <Checkbox checked={useRecoveryCode} onChange={(e) => { setUseRecoveryCode(e.target.checked); setTotpCode(''); }} style={{ marginBottom: 16 }}>
              使用恢复码（每个恢复码仅可使用一次）
            </Checkbox>
            <Button type="primary" block loading={loading} onClick={onTotpVerify}>
              验证并登录
            </Button>
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Button type="link" size="small" onClick={resetToCredentials}>
                返回
              </Button>
            </div>
          </div>
        )}

        {stage === 'enroll' && (
          <div>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="根据安全策略，运维账号必须绑定验证器后才能登录"
            />
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              1. 使用 Google Authenticator / Microsoft Authenticator 扫描二维码，或手动添加密钥：
            </Typography.Paragraph>
            {enrollQr && <img src={enrollQr} alt="TOTP 二维码" width={160} height={160} style={{ marginBottom: 12 }} />}
            <Typography.Paragraph copyable={{ text: payload?.secret }} code style={{ wordBreak: 'break-all' }}>
              {payload?.secret}
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ wordBreak: 'break-all' }}>
              otpauth 链接：{payload?.otpauthUrl}
            </Typography.Paragraph>
            <Input
              size="large"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
              placeholder="输入验证器中的 6 位动态码完成绑定"
              style={{ letterSpacing: 6, textAlign: 'center', marginBottom: 12 }}
            />
            <Button type="primary" block loading={loading} onClick={onEnroll}>
              完成绑定并登录
            </Button>
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Button type="link" size="small" onClick={resetToCredentials}>
                返回
              </Button>
            </div>
          </div>
        )}

        {stage === 'recovery' && pendingResult && (
          <div>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="请立即保存以下恢复码，页面关闭后将无法再次查看"
            />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
                padding: 12,
                background: '#f6f8fa',
                borderRadius: 8,
                fontFamily: 'Consolas, monospace',
                marginBottom: 16,
              }}
            >
              {pendingResult.recoveryCodes.map((code: string) => (
                <span key={code}>{code}</span>
              ))}
            </div>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Typography.Text copyable={{ text: pendingResult.recoveryCodes.join('\n') }} type="secondary">
                复制全部恢复码
              </Typography.Text>
              <Button type="primary" block onClick={onRecoverySaved}>
                我已保存，进入系统
              </Button>
            </Space>
          </div>
        )}
      </div>
    </div>
  );
}
