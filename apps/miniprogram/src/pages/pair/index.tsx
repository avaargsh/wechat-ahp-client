import { useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { claimPairing } from '../../lib/api';
import './index.scss';

export default function PairPage() {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const normalized = code.replace(/\s+/g, '').toUpperCase();
    if (!normalized) {
      setError('请输入 VS Code 中显示的配对码');
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

      await claimPairing({ code: normalized, deviceName });
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

  return (
    <View className='page'>
      <View className='card'>
        <Text className='title'>绑定 VS Code</Text>
        <Text className='hint'>
          在 VS Code 命令面板运行 “WeChat AHP Client: Show Pairing Code”，
          将一次性配对码输入下方。
        </Text>

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
        配对码 5 分钟内有效且仅能使用一次。小程序只获得该开发机的移动会话令牌。
      </Text>
    </View>
  );
}
