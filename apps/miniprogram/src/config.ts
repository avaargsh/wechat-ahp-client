import Taro from '@tarojs/taro';

export const RELAY_HTTP_ORIGIN = 'http://127.0.0.1:8787';
const MOBILE_TOKEN_KEY = 'mobileToken';

export function mobileToken(): string {
  return String(Taro.getStorageSync(MOBILE_TOKEN_KEY) || '');
}

export function hasMobileToken(): boolean {
  return Boolean(mobileToken());
}

export function setMobileToken(token: string): void {
  Taro.setStorageSync(MOBILE_TOKEN_KEY, token);
}

export function clearMobileToken(): void {
  Taro.removeStorageSync(MOBILE_TOKEN_KEY);
}
