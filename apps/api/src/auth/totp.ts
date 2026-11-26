import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** 生成 Base32 编码的 TOTP 密钥（默认 160 bit，兼容 Google Authenticator） */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = String(input || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 4226 HOTP */
export function hotp(secret: string, counter: number, digits = TOTP_DIGITS): string {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter % 0x100000000, 4);
  const digest = createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

/** 当前时间步（RFC 6238：默认 30 秒） */
export function totpStep(now = Date.now(), period = TOTP_PERIOD_SECONDS): number {
  return Math.floor(now / 1000 / period);
}

export function totpCodeAt(secret: string, step: number, digits = TOTP_DIGITS): string {
  return hotp(secret, step, digits);
}

export function totpCode(secret: string, now = Date.now()): string {
  return totpCodeAt(secret, totpStep(now));
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * 校验 TOTP 动态码（RFC 6238，窗口 ±window 个时间步）。
 * lastStep 用于防止同一动态码在有效窗口内被重放。
 */
export function verifyTotpCode(
  secret: string,
  code: string,
  options: { now?: number; window?: number; lastStep?: number | null } = {},
): { ok: boolean; step?: number } {
  const normalized = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return { ok: false };
  const current = totpStep(options.now ?? Date.now());
  const window = options.window ?? 1;
  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (options.lastStep != null && step <= options.lastStep) continue;
    if (safeEqual(totpCodeAt(secret, step), normalized)) return { ok: true, step };
  }
  return { ok: false };
}

export function buildOtpauthUrl(secret: string, account: string, issuer = '运维工单系统'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** 恢复码：10 位大写字母数字，展示为 XXXXX-XXXXX */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export interface StoredRecoveryCode {
  hash: string;
  usedAt: string | null;
}

export function parseRecoveryCodes(input: string | null | undefined): StoredRecoveryCode[] {
  if (!input) return [];
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x.hash === 'string') : [];
  } catch {
    return [];
  }
}

/** 生成 6 位数字验证码 */
export function generateEmailCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function maskEmail(email: string): string {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return email;
  const visible = name.slice(0, 1) || '*';
  return `${visible}${'*'.repeat(Math.max(2, Math.min(4, name.length - 1)))}@${domain}`;
}
