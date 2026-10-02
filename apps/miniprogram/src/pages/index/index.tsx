import { useCallback, useEffect, useState } from 'react';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import type { AttentionProjection } from '@wechat-ahp/protocol';
import { listPending } from '../../lib/api';
import './index.scss';

export default function InboxPage() {
  const [items, setItems] = useState<AttentionProjection[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setError('');
      setItems(await listPending());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
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

  return (
    <View className='page'>
      <View className='header'>
        <Text className='title'>待审批</Text>
        <Text className='count'>{items.length}</Text>
      </View>

      {loading && <View className='empty'>正在同步 VS Code…</View>}

      {!loading && error && (
        <View className='empty'>
          <Text>{error}</Text>
          <Button className='retry' onClick={() => void refresh()}>重试</Button>
        </View>
      )}

      {!loading && !error && items.length === 0 && (
        <View className='empty'>
          <Text className='ok'>✓</Text>
          <Text>当前没有需要确认的操作</Text>
          <Text className='muted'>Codex 可以继续自己工作。</Text>
        </View>
      )}

      {items.map(item => (
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
