import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUrl,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  hotp,
  maskEmail,
  normalizeRecoveryCode,
  totpStep,
  verifyTotpCode,
} from '../src/auth/totp';

/** RFC 6238 附录 B 测试向量（SHA1） */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it('匹配 RFC 6238 SHA1 测试向量', () => {
    expect(hotp(RFC_SECRET, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(hotp(RFC_SECRET, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(hotp(RFC_SECRET, Math.floor(1111111111 / 30), 8)).toBe('14050471');
  });

  it('默认生成 6 位且 Base32 解码后为 20 字节', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(secret).length).toBe(20);
  });

  it('校验窗口 ±1 并拒绝过期步骤', () => {
    const now = 1_700_000_000_000;
    const secret = generateTotpSecret();
    const step = totpStep(now);
    const current = hotp(secret, step);
    expect(verifyTotpCode(secret, current, { now }).ok).toBe(true);

    const previous = hotp(secret, step - 1);
    expect(verifyTotpCode(secret, previous, { now }).ok).toBe(true);
    expect(verifyTotpCode(secret, previous, { now, lastStep: step - 1 }).ok).toBe(false);
    expect(verifyTotpCode(secret, previous, { now, window: 0 }).ok).toBe(false);
  });

  it('拒绝非 6 位或错误动态码', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, '12345').ok).toBe(false);
    expect(verifyTotpCode(secret, 'abcdef').ok).toBe(false);
    expect(verifyTotpCode(secret, '000000').ok).toBe(false);
  });

  it('otpauth 链接包含必要参数', () => {
    const url = buildOtpauthUrl('ABCDEFGHIJKLMNOP', 'agent@example.com');
    expect(url.startsWith('otpauth://totp/')).toBe(true);
    expect(url).toContain('secret=ABCDEFGHIJKLMNOP');
    expect(url).toContain('digits=6');
    expect(url).toContain('period=30');
  });
});

describe('恢复码', () => {
  it('格式为 XXXXX-XXXXX 且不重复', () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    codes.forEach((c) => expect(c).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/));
    expect(new Set(codes).size).toBe(10);
  });

  it('归一化后可匹配哈希（大小写与分隔符无关）', () => {
    const code = 'AB12C-D34EF';
    expect(normalizeRecoveryCode(code)).toBe('AB12CD34EF');
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode('ab12c d34ef'));
    expect(hashRecoveryCode(code)).not.toBe(hashRecoveryCode('AB12CD34EG'));
  });
});

describe('邮箱掩码', () => {
  it('保留首字母与域名', () => {
    expect(maskEmail('alice@acme.com')).toBe('a****@acme.com');
    expect(maskEmail('b@x.com')).toBe('b**@x.com');
  });
});
