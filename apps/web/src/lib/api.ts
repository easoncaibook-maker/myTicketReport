import type { Role } from '@ticketreport/shared';

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: any;

  constructor(status: number, payload: any) {
    const message =
      (payload && (payload.message || (Array.isArray(payload.message) ? payload.message[0] : ''))) ||
      `请求失败（${status}）`;
    super(Array.isArray(payload?.message) ? payload.message[0] : message);
    this.status = status;
    this.code = payload?.code;
    this.details = payload?.details;
  }
}

export function getToken() {
  return accessToken;
}

export function setToken(token: string | null) {
  accessToken = token;
}

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) return false;
    const data = await res.json();
    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

async function request<T = any>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as any) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`/api${path}`, { ...options, headers, credentials: 'include' });

  if (res.status === 401 && retry && !path.startsWith('/auth/login')) {
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    const ok = await refreshPromise;
    if (ok) return request<T>(path, options, false);
  }

  if (!res.ok) {
    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    throw new ApiError(res.status, payload);
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return (await res.json()) as T;
  return undefined as T;
}

export const api = {
  get: <T = any>(path: string) => request<T>(path),
  post: <T = any>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T = any>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T = any>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T = any>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T = any>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>(path, { method: 'POST', body: form });
  },
  async download(path: string, filename: string) {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`/api${path.replace(/^\/api/, '')}`, { headers, credentials: 'include' });
    if (!res.ok) throw new ApiError(res.status, null);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  roleLabel?: string;
  enterpriseId?: string | null;
  enterpriseName?: string | null;
  groupIds: string[];
  siteName?: string;
}

export async function refreshSession(): Promise<CurrentUser | null> {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    accessToken = data.accessToken;
    return data.user as CurrentUser;
  } catch {
    return null;
  }
}

export function errorMessage(e: unknown) {
  if (e instanceof ApiError) return e.message;
  return (e as Error)?.message || '操作失败';
}
