import Taro from '@tarojs/taro';

export const RELAY_HTTP_ORIGIN = 'http://127.0.0.1:8787';

export function mobileToken(): string {
  return String(Taro.getStorageSync('mobileToken') || 'dev-mobile');
}
