import { useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { claimPairing } from '../../lib/api';
import './index.scss';

export default function PairPage() {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const bind = async (rawCode: string) => {
    const normalized = rawCode.replace(/\s+/g, '').toUpperCase();
    if (!normalized) {
      setError('请输入或扫描 VS Code 中显示的配对码');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      let deviceName = 'WeChat Mini Program';
      try {
        deviceName = Taro.getSystemInfoSync().model || deviceName;
      } catch {
        // Device metadata is optional.
      }

      let wechatCode: string | undefined;
      try {
        const login = await Taro.login();
        wechatCode = login.code || undefined;
      } catch {
        // Tourist/dev builds can pair when relay WeChat auth is disabled.
      }

      await claimPairing({ code: normalized, deviceName, wechatCode });
      await Taro.showToast({ title: '绑定成功', icon: 'success' });
      setTimeout(() => {
        void Taro.navigateBack();
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '绑定失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async () => {
    await bind(code);
  };

  const scan = async () => {
    setError('');

    try {
      const result = await Taro.scanCode({
        onlyFromCamera: false,
        scanType: ['qrCode'],
      });

      const match = result.result.match(/^wechat-ahp:\/\/pair\?code=([A-F0-9]+)$/i);
      if (!match?.[1]) {
        setError('这不是 wechat-ahp-client 配对二维码');
        return;
      }

      setCode(match[1].toUpperCase());
      await bind(match[1]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/cancel/i.test(message)) setError('扫码失败，请改用手动配对码');
    }
  };

  return (
    <View className='page'>
      <View className='card'>
        <Text className='title'>绑定 VS Code</Text>
        <Text className='hint'>
          推荐在 VS Code 命令面板运行 “WeChat AHP Client: Show Pairing QR”
          并直接扫码；也可以输入一次性配对码。
        </Text>

        <Button
          className='scan'
          disabled={submitting}
          onClick={() => void scan()}
        >
          扫描配对二维码
        </Button>

        <View className='divider'>
          <View className='line' />
          <Text className='or'>或手动输入</Text>
          <View className='line' />
        </View>

        <Input
          className='codeInput'
          value={code}
          maxlength={16}
          placeholder='输入配对码'
          onInput={event => setCode(event.detail.value)}
        />

        {error && <Text className='error'>{error}</Text>}

        <Button
          className='submit'
          loading={submitting}
          disabled={submitting}
          onClick={() => void submit()}
        >
          绑定开发机
        </Button>
      </View>

      <Text className='security'>
        配对码 5 分钟内有效且仅能使用一次。二维码只编码一次性配对码，不包含移动会话令牌。
      </Text>
    </View>
  );
}
