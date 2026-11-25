/**
 * 强制改密期间允许访问的接口白名单。
 * 只有查看自身信息、修改密码与退出登录可以放行，其余一律拦截。
 */
export function isAllowedWhileMustChangePassword(method: string, path: string): boolean {
  const m = String(method || '').toUpperCase();
  const p = String(path || '')
    .split('?')[0]
    .replace(/\/+$/, '');
  return (
    (m === 'GET' && p.endsWith('/auth/me')) ||
    (m === 'PATCH' && p.endsWith('/auth/me/password')) ||
    (m === 'POST' && p.endsWith('/auth/logout'))
  );
}
