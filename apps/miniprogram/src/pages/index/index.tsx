import { useCallback, useEffect, useState } from 'react';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import type { AttentionProjection } from '@wechat-ahp/protocol';
import {
  ApiRequestError,
  getNotificationConfig,
  listPending,
  revokeMobileSession,
  setNotificationsEnabled,
} from '../../lib/api';
import { clearMobileToken, hasMobileToken } from '../../config';
import './index.scss';

export default function InboxPage() {
  const [items, setItems] = useState<AttentionProjection[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [paired, setPaired] = useState(hasMobileToken());
  const [enablingNotifications, setEnablingNotifications] = useState(false);
  const [unpairing, setUnpairing] = useState(false);

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
      const latest = await listPending();
      // A pending refresh must not repaint data after local unpair.
      if (!hasMobileToken()) {
        setPaired(false);
        setItems([]);
        return;
      }
      setItems(latest);
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

  const unpair = async () => {
    if (unpairing) return;
    const decision = await Taro.showModal({
      title: '解除设备绑定',
      content: '将在中继端撤销此手机的访问凭据。其他设备和电脑上的 Codex 任务不受影响。',
      confirmText: '解除绑定',
      confirmColor: '#B42318',
    });
    if (!decision.confirm) return;

    setUnpairing(true);
    try {
      await revokeMobileSession();
      clearMobileToken();
      setPaired(false);
      setItems([]);
      setError('');
      await Taro.showToast({ title: '已解除绑定', icon: 'success' });
    } catch (err) {
      if (err instanceof ApiRequestError && err.statusCode === 401) {
        // The token is already unusable on the server.
        clearMobileToken();
        setPaired(false);
        setItems([]);
        setError('');
      } else {
        // Do not silently clear only local storage on a network failure:
        // that would leave a valid Relay token accessible to whoever has it.
        await Taro.showToast({ title: '撤销未确认，请重试', icon: 'none' });
      }
    } finally {
      setUnpairing(false);
    }
  };

  const open = (item: AttentionProjection) => {
    void Taro.navigateTo({
      url: `/pages/approval/index?id=${encodeURIComponent(item.id)}`
    });
  };

  const pair = () => {
    void Taro.navigateTo({ url: '/pages/pair/index' });
  };

  const enableNextNotification = async () => {
    if (enablingNotifications) return;
    setEnablingNotifications(true);

    try {
      const config = await getNotificationConfig();
      if (!config.enabled || !config.templateId) {
        await Taro.showToast({ title: 'Relay 未配置微信提醒', icon: 'none' });
        return;
      }

      // Taro 4.3's cross-platform type currently makes Alipay entityIds
      // required even for a WeChat-only tmplIds request. Keep the runtime
      // payload strictly WeChat-shaped and narrow through unknown here.
      const subscribeRequest = {
        tmplIds: [config.templateId],
      } as unknown as Parameters<typeof Taro.requestSubscribeMessage>[0];
      const result = await Taro.requestSubscribeMessage(subscribeRequest);
      const decision = (result as unknown as Record<string, unknown>)[config.templateId];

      if (decision !== 'accept') {
        await Taro.showToast({ title: '未开启提醒', icon: 'none' });
        return;
      }

      await setNotificationsEnabled(true);
      await Taro.showToast({ title: '下次审批将微信提醒', icon: 'success' });
    } catch (err) {
      await Taro.showToast({
        title: err instanceof Error ? err.message : '开启提醒失败',
        icon: 'none',
      });
    } finally {
      setEnablingNotifications(false);
    }
  };

  return (
    <View className='page'>
      <View className='header'>
        <View className='headerTitle'>
          <Text className='title'>待审批</Text>
          {paired && <Text className='count'>{items.length}</Text>}
        </View>
        {paired && (
          <Button
            className='notify'
            size='mini'
            loading={enablingNotifications}
            disabled={enablingNotifications}
            onClick={() => void enableNextNotification()}
          >
            开启下次提醒
          </Button>
        )}
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

      {paired && !loading && (
        <Button className='unbind' loading={unpairing} disabled={unpairing} onClick={() => void unpair()}>
          解除本机绑定
        </Button>
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
