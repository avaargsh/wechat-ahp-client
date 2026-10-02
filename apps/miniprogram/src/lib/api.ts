import Taro from '@tarojs/taro';
import type {
  ApiError,
  AttentionProjection,
  MobileSession,
  PairingClaimInput,
  ResolveAttentionInput,
} from '@wechat-ahp/protocol';
import { mobileToken, RELAY_HTTP_ORIGIN, setMobileToken } from '../config';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: ApiError['code'],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(
  url: string,
  method: 'GET' | 'POST' = 'GET',
  data?: unknown,
  authenticated = true,
): Promise<T> {
  const token = authenticated ? mobileToken() : '';
  const header: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token) header.Authorization = `Bearer ${token}`;

  const response = await Taro.request<T>({
    url: `${RELAY_HTTP_ORIGIN}${url}`,
    method,
    data,
    header,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const body = response.data as Partial<ApiError>;
    throw new ApiRequestError(
      body.error ?? `HTTP ${response.statusCode}`,
      response.statusCode,
      body.code,
    );
  }

  return response.data;
}

export async function claimPairing(input: PairingClaimInput): Promise<MobileSession> {
  const session = await request<MobileSession>(
    '/api/pairing/claim',
    'POST',
    input,
    false,
  );
  setMobileToken(session.token);
  return session;
}

export async function listPending(): Promise<AttentionProjection[]> {
  const result = await request<{ items: AttentionProjection[] }>(
    '/api/attention?state=pending',
  );
  return result.items;
}

export function getAttention(id: string): Promise<AttentionProjection> {
  return request(`/api/attention/${encodeURIComponent(id)}`);
}

export function resolveAttention(
  id: string,
  input: ResolveAttentionInput,
): Promise<AttentionProjection> {
  return request(
    `/api/attention/${encodeURIComponent(id)}/resolve`,
    'POST',
    input,
  );
}

export interface NotificationConfig {
  enabled: boolean;
  templateId?: string;
}

export function getNotificationConfig(): Promise<NotificationConfig> {
  return request('/api/notifications/config');
}

export function setNotificationsEnabled(enabled = true): Promise<MobileSession> {
  return request('/api/notifications/enable', 'POST', { enabled });
}
