import { describe, expect, it } from 'vitest';
import { hashPassword, hashToken, randomToken, verifyPassword } from '../src/common/password';

describe('password', () => {
  it('生成 scrypt 哈希并可校验', () => {
    const stored = hashPassword('Passw0rd!');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('Passw0rd!', stored)).toBe(true);
    expect(verifyPassword('wrong-password', stored)).toBe(false);
  });

  it('同一密码两次哈希不同（随机盐）', () => {
    expect(hashPassword('Passw0rd!')).not.toBe(hashPassword('Passw0rd!'));
  });

  it('空哈希校验失败', () => {
    expect(verifyPassword('anything', null)).toBe(false);
    expect(verifyPassword('anything', '')).toBe(false);
    expect(verifyPassword('anything', 'bcrypt$xx$yy')).toBe(false);
  });

  it('令牌随机且哈希稳定', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
  });
});
