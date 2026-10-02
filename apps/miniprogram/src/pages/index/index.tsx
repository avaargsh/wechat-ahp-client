import { useCallback, useEffect, useState } from 'react';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import type { AttentionProjection } from '@wechat-ahp/protocol';
import { ApiRequestError, listPending } from '../../lib/api';
import { clearMobileToken, hasMobileToken } from '../../config';
import './index.scss';

export default function InboxPage() {
  const [items, setItems] = useState<AttentionProjection[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [paired, setPaired] = useState(hasMobileToken());

  const refresh = useCallback(async () => {
    if (!hasMobileToken()) {
      setPaired(false);
      setItems([]);
      setLoading(false);
      Taro.stopPullDownRefresh();
      return;
    }

    setPaired(true);
    try {
      setError('');
      setItems(await listPending());
    } catch (err) {
      if (err instanceof ApiRequestError && err.statusCode === 401) {
        clearMobileToken();
        setPaired(false);
        setItems([]);
        setError('');
      } else {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    } finally {
      setLoading(false);
      Taro.stopPullDownRefresh();
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useDidShow(() => void refresh());
  usePullDownRefresh(() => void refresh());

  const open = (item: AttentionProjection) => {
    void Taro.navigateTo({
      url: `/pages/approval/index?id=${encodeURIComponent(item.id)}`
    });
  };

  const pair = () => {
    void Taro.navigateTo({ url: '/pages/pair/index' });
  };

  return (
    <View className='page'>
      <View className='header'>
        <Text className='title'>待审批</Text>
        {paired && <Text className='count'>{items.length}</Text>}
      </View>

      {!paired && !loading && (
        <View className='empty'>
          <Text>尚未绑定开发机</Text>
          <Text className='muted'>在 VS Code 中生成一次性配对码后完成绑定。</Text>
          <Button className='retry' onClick={pair}>绑定开发机</Button>
        </View>
      )}

      {paired && loading && <View className='empty'>正在同步 VS Code…</View>}

      {paired && !loading && error && (
        <View className='empty'>
          <Text>{error}</Text>
          <Button className='retry' onClick={() => void refresh()}>重试</Button>
        </View>
      )}

      {paired && !loading && !error && items.length === 0 && (
        <View className='empty'>
          <Text className='ok'>✓</Text>
          <Text>当前没有需要确认的操作</Text>
          <Text className='muted'>Codex 可以继续自己工作。</Text>
        </View>
      )}

      {paired && items.map(item => (
        <View className='card' key={item.id} onClick={() => open(item)}>
          <View className='row'>
            <Text className='kind'>{item.title}</Text>
            <Text className='arrow'>›</Text>
          </View>
          <Text className='summary'>{item.summary}</Text>
          <Text className='meta'>
            {item.projectName || 'VS Code'} · {new Date(item.observedAt).toLocaleTimeString()}
          </Text>
        </View>
      ))}
    </View>
  );
}
