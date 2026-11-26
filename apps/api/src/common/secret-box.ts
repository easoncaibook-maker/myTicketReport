import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'v1';

/**
 * 配置密钥加密：AES-256-GCM，密钥由环境变量派生。
 * 优先 AI_SECRET_KEY，其次复用 JWT_ACCESS_SECRET；都未配置时使用本地开发默认值。
 * 生产环境应显式设置 AI_SECRET_KEY，避免与访问令牌密钥共用。
 */
function key(): Buffer {
  const raw =
    process.env.AI_SECRET_KEY || process.env.JWT_ACCESS_SECRET || 'ticketreport-local-dev-secret';
  return createHash('sha256').update(raw).digest();
}

/** 加密明文配置；空字符串表示未配置 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

/** 解密；密文损坏或密钥变更时返回空字符串，调用方按「未配置」处理 */
export function decryptSecret(payload: string | null | undefined): string {
  if (!payload) return '';
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) return '';
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
