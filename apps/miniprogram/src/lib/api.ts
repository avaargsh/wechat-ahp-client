import Taro from '@tarojs/taro';
import type {
  AttentionProjection,
  ResolveAttentionInput,
} from '@wechat-ahp/protocol';
import { mobileToken, RELAY_HTTP_ORIGIN } from '../config';

async function request<T>(
  url: string,
  method: 'GET' | 'POST' = 'GET',
  data?: unknown,
): Promise<T> {
  const response = await Taro.request<T>({
    url: `${RELAY_HTTP_ORIGIN}${url}`,
    method,
    data,
    header: {
      Authorization: `Bearer ${mobileToken()}`,
      'content-type': 'application/json'
    }
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      (response.data as { error?: string })?.error ?? `HTTP ${response.statusCode}`,
    );
  }

  return response.data;
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
