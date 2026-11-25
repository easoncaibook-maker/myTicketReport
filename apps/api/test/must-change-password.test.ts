import { describe, expect, it } from 'vitest';
import { isAllowedWhileMustChangePassword } from '../src/common/must-change-password';

describe('强制改密接口白名单', () => {
  it('允许查看自身信息、修改密码与退出登录', () => {
    expect(isAllowedWhileMustChangePassword('GET', '/api/auth/me')).toBe(true);
    expect(isAllowedWhileMustChangePassword('PATCH', '/api/auth/me/password')).toBe(true);
    expect(isAllowedWhileMustChangePassword('POST', '/api/auth/logout')).toBe(true);
  });

  it('忽略查询参数与尾斜杠', () => {
    expect(isAllowedWhileMustChangePassword('get', '/api/auth/me/?x=1')).toBe(true);
  });

  it('拦截其他业务接口', () => {
    expect(isAllowedWhileMustChangePassword('GET', '/api/tickets')).toBe(false);
    expect(isAllowedWhileMustChangePassword('POST', '/api/tickets')).toBe(false);
    expect(isAllowedWhileMustChangePassword('POST', '/api/auth/refresh')).toBe(false);
    expect(isAllowedWhileMustChangePassword('PATCH', '/api/admin/users/u1')).toBe(false);
  });
});
