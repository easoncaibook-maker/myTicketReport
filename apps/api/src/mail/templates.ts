export type EmailTemplateName =
  | 'invite'
  | 'resetPassword'
  | 'loginCode'
  | 'ticketCreated'
  | 'ticketAssigned'
  | 'ticketComment'
  | 'ticketPendingConfirm'
  | 'ticketClosed'
  | 'ticketReopened'
  | 'ticketCancelled';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(title: string, lines: string[], link?: string, linkText = '查看详情'): string {
  const body = lines.map((l) => `<p style="margin:0 0 12px;line-height:1.7;color:#333">${l}</p>`).join('');
  const button = link
    ? `<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 20px;background:#1677ff;color:#fff;border-radius:6px;text-decoration:none">${linkText}</a></p>
       <p style="font-size:12px;color:#999;word-break:break-all">若按钮无法点击，请复制链接：${escapeHtml(link)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:28px">
    <h2 style="margin:0 0 20px;font-size:18px;color:#111">${escapeHtml(title)}</h2>
    ${body}${button}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
    <p style="font-size:12px;color:#999;margin:0">本邮件由运维工单系统自动发送，请勿直接回复。</p>
  </div></body></html>`;
}

export function renderEmail(template: EmailTemplateName, data: Record<string, any>): RenderedEmail {
  const link = data.link as string | undefined;
  const ticketNo = data.ticketNo ? `【${data.ticketNo}】` : '';
  switch (template) {
    case 'invite':
      return {
        subject: '【运维工单系统】账号开通邀请',
        html: layout(
          '账号开通邀请',
          [
            `${escapeHtml(data.name)}，您好：`,
            `${escapeHtml(data.enterpriseName)} 已为您开通运维工单系统账号（${escapeHtml(data.email)}）。`,
            '请点击下方链接设置密码完成激活，链接 72 小时内有效。',
          ],
          link,
          '设置密码',
        ),
        text: `${data.name}，您好：${data.enterpriseName} 已为您开通账号，请访问 ${link} 设置密码（72 小时内有效）。`,
      };
    case 'resetPassword':
      return {
        subject: '【运维工单系统】重置密码',
        html: layout(
          '重置密码',
          [`${escapeHtml(data.name)}，您好：`, '我们收到了重置密码的请求，请点击下方链接设置新密码，链接 2 小时内有效。', '如非本人操作请忽略本邮件。'],
          link,
          '重置密码',
        ),
        text: `${data.name}，您好：请访问 ${link} 重置密码（2 小时内有效）。`,
      };
    case 'loginCode':
      return {
        subject: '【运维工单系统】登录验证码',
        html: layout(
          '登录验证码',
          [
            `${escapeHtml(data.name)}，您好：`,
            `您正在登录运维工单系统，本次验证码为：`,
            `<span style="display:inline-block;padding:10px 20px;background:#f2f4f8;border-radius:6px;font-size:26px;letter-spacing:6px;font-weight:600;color:#1668dc">${escapeHtml(
              data.code,
            )}</span>`,
            `验证码 ${escapeHtml(data.minutes ?? 10)} 分钟内有效，请勿转发给他人。如非本人操作，请及时修改密码。`,
          ],
        ),
        text: `您正在登录运维工单系统，验证码：${data.code}（${data.minutes ?? 10} 分钟内有效）。`,
      };
    case 'ticketCreated':
      return {
        subject: `【运维工单系统】工单已提交 ${ticketNo}`,
        html: layout(
          `工单已提交 ${ticketNo}`,
          [
            `${escapeHtml(data.name)}，您好：`,
            `您提交的工单「${escapeHtml(data.title)}」已进入 ${escapeHtml(data.groupName)} 处理队列，我们会尽快处理。`,
          ],
          link,
        ),
        text: `工单 ${data.ticketNo}「${data.title}」已提交，将尽快处理。${link}`,
      };
    case 'ticketAssigned':
      return {
        subject: `【运维工单系统】工单已受理 ${ticketNo}`,
        html: layout(
          `工单已受理 ${ticketNo}`,
          [
            `${escapeHtml(data.name)}，您好：`,
            `您的工单「${escapeHtml(data.title)}」已由运维团队受理，当前处理人：${escapeHtml(data.assigneeName || '待指定')}。`,
          ],
          link,
        ),
        text: `工单 ${data.ticketNo} 已受理，处理人：${data.assigneeName || '待指定'}。${link}`,
      };
    case 'ticketComment':
      return {
        subject: `【运维工单系统】工单有新回复 ${ticketNo}`,
        html: layout(
          `工单有新回复 ${ticketNo}`,
          [
            `${escapeHtml(data.name)}，您好：`,
            `${escapeHtml(data.actorName)} 回复了工单「${escapeHtml(data.title)}」：`,
            `<span style="display:block;padding:12px;background:#f6f8fa;border-radius:6px;white-space:pre-wrap">${escapeHtml(data.content)}</span>`,
          ],
          link,
        ),
        text: `${data.actorName} 回复了工单 ${data.ticketNo}：${data.content}。${link}`,
      };
    case 'ticketPendingConfirm':
      return {
        subject: `【运维工单系统】工单待您确认 ${ticketNo}`,
        html: layout(
          `工单待您确认 ${ticketNo}`,
          [
            `${escapeHtml(data.name)}，您好：`,
            `工单「${escapeHtml(data.title)}」的处理结果已提交，请确认问题是否解决。`,
            `<span style="display:block;padding:12px;background:#f6f8fa;border-radius:6px;white-space:pre-wrap">${escapeHtml(data.resolution)}</span>`,
          ],
          link,
          '去确认',
        ),
        text: `工单 ${data.ticketNo} 待确认，处理结果：${data.resolution}。${link}`,
      };
    case 'ticketClosed':
      return {
        subject: `【运维工单系统】工单已关闭 ${ticketNo}`,
        html: layout(
          `工单已关闭 ${ticketNo}`,
          [
            `${escapeHtml(data.name)}，您好：`,
            `工单「${escapeHtml(data.title)}」已关闭${data.reason ? `，关闭原因：${escapeHtml(data.reason)}` : ''}。`,
            data.reopenHint ? escapeHtml(data.reopenHint) : '',
          ].filter(Boolean),
          link,
        ),
        text: `工单 ${data.ticketNo} 已关闭。${link}`,
      };
    case 'ticketReopened':
      return {
        subject: `【运维工单系统】工单已重开 ${ticketNo}`,
        html: layout(
          `工单已重开 ${ticketNo}`,
          [`工单「${escapeHtml(data.title)}」已由提报人重开，请继续跟进。`],
          link,
        ),
        text: `工单 ${data.ticketNo} 已重开，请继续跟进。${link}`,
      };
    case 'ticketCancelled':
      return {
        subject: `【运维工单系统】工单已撤回 ${ticketNo}`,
        html: layout(
          `工单已撤回 ${ticketNo}`,
          [`工单「${escapeHtml(data.title)}」已由提报人撤回，无需继续处理。`],
          link,
        ),
        text: `工单 ${data.ticketNo} 已撤回。${link}`,
      };
    default:
      return { subject: '运维工单系统通知', html: layout('通知', []), text: '运维工单系统通知' };
  }
}
