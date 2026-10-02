import { useEffect, useState } from 'react';
import Taro, { useRouter } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import type { AttentionProjection, ResolveDecision } from '@wechat-ahp/protocol';
import { getAttention, resolveAttention } from '../../lib/api';
import './index.scss';

export default function ApprovalPage() {
  const router = useRouter();
  const id = String(router.params.id || '');
  const [item, setItem] = useState<AttentionProjection>();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState<ResolveDecision>();

  const load = async () => {
    if (!id) return;
    try {
      setError('');
      setItem(await getAttention(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const decide = async (decision: ResolveDecision) => {
    if (!item || item.state !== 'pending' || submitting) return;
    setSubmitting(decision);
    try {
      const next = await resolveAttention(item.id, {
        decision,
        expectedVersion: item.version
      });
      setItem(next);
      if (decision === 'allow_once') Taro.vibrateShort({ type: 'light' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请刷新后重试');
      await load();
    } finally {
      setSubmitting(undefined);
    }
  };

  if (error && !item) {
    return (
      <View className='page state'>
        <Text>{error}</Text>
        <Button onClick={() => void load()}>重试</Button>
      </View>
    );
  }

  if (!item) return <View className='page state'>正在读取最新状态…</View>;

  const pending = item.state === 'pending';

  return (
    <View className='page'>
      <View className={pending ? 'status pending' : 'status resolved'}>
        {pending
          ? '等待确认'
          : item.state === 'resolved_allow'
            ? '已允许，Codex 将继续执行'
            : item.state === 'resolved_reject'
              ? '已拒绝'
              : '该请求已处理'}
      </View>

      <View className='meta'>{item.projectName || 'VS Code'} · {item.sessionId}</View>

      <View className='section'>
        <Text className='label'>请求类型</Text>
        <Text className='value'>{item.title}</Text>
      </View>

      <View className='section'>
        <Text className='label'>内容</Text>
        <Text selectable className='code'>{item.summary}</Text>
      </View>

      {item.cwd && (
        <View className='section'>
          <Text className='label'>工作目录</Text>
          <Text selectable className='code mutedCode'>{item.cwd}</Text>
        </View>
      )}

      {item.impact?.length ? (
        <View className='section'>
          <Text className='label'>影响范围</Text>
          {item.impact.map(value => (
            <Text key={value} className='value'>• {value}</Text>
          ))}
        </View>
      ) : null}

      {error && <View className='error'>{error}</View>}

      {pending && (
        <View className='actions'>
          <Button
            className='deny'
            loading={submitting === 'reject'}
            disabled={Boolean(submitting)}
            onClick={() => void decide('reject')}
          >
            拒绝
          </Button>
          <Button
            className='allow'
            loading={submitting === 'allow_once'}
            disabled={Boolean(submitting)}
            onClick={() => void decide('allow_once')}
          >
            允许一次
          </Button>
        </View>
      )}
    </View>
  );
}
