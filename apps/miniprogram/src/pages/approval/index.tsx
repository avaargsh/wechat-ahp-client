import { useCallback, useState } from 'react';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import type { AttentionProjection, ResolveDecision } from '@wechat-ahp/protocol';
import {
  ApiRequestError,
  getAttention,
  resolveAttention,
} from '../../lib/api';
import './index.scss';

type SubmitPhase = 'checking' | 'waiting_host';

function resolveErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) {
    return error instanceof Error ? error.message : '提交失败，请刷新后重试';
  }

  switch (error.code) {
    case 'not_pending':
    case 'version_conflict':
      return '请求状态已经变化，已重新读取最新状态。';
    case 'resolution_in_progress':
      return '另一端正在处理这个请求，请等待最新结果。';
    case 'machine_offline':
      return '开发机当前离线，本次操作没有执行。';
    case 'connector_timeout':
      return 'VS Code 未确认本次操作，因此不会把它视为已执行。';
    case 'unauthorized':
      return '当前绑定已失效，请重新绑定开发机。';
    default:
      return error.message || '提交失败，请刷新后重试';
  }
}

export default function ApprovalPage() {
  const router = useRouter();
  const id = String(router.params.id || '');
  const [item, setItem] = useState<AttentionProjection>();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState<ResolveDecision>();
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>();

  const load = useCallback(async () => {
    if (!id) {
      setError('缺少审批请求 ID');
      return;
    }

    try {
      setError('');
      setItem(await getAttention(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [id]);

  useDidShow(() => {
    void load();
  });

  const decide = async (decision: ResolveDecision) => {
    if (!item || item.state !== 'pending' || submitting) return;

    setSubmitting(decision);
    setSubmitPhase('checking');
    setError('');

    try {
      // The detail shown on screen is only a projection. Re-read it immediately
      // before every side effect so a desktop/other-mobile decision wins first.
      const latest = await getAttention(id);
      setItem(latest);

      if (latest.state !== 'pending') {
        setError('该请求已在其他端处理，已显示最新状态。');
        return;
      }

      setSubmitPhase('waiting_host');
      const next = await resolveAttention(latest.id, {
        decision,
        expectedVersion: latest.version,
      });

      setItem(next);
      if (decision === 'allow_once') {
        await Taro.vibrateShort({ type: 'light' });
      }
    } catch (err) {
      setError(resolveErrorMessage(err));

      // A failed resolve can mean the Host beat us in a race. Best-effort
      // refresh makes the terminal state visible without treating failure as
      // success when the Host is offline or timed out.
      try {
        setItem(await getAttention(id));
      } catch {
        // Keep the actionable resolve error if refresh also fails.
      }
    } finally {
      setSubmitting(undefined);
      setSubmitPhase(undefined);
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
  const statusText = submitting
    ? submitPhase === 'checking'
      ? '正在确认请求仍然有效…'
      : '已发送，等待 VS Code 确认…'
    : pending
      ? '等待确认'
      : item.state === 'resolved_allow'
        ? '已允许，Codex 将继续执行'
        : item.state === 'resolved_reject'
          ? '已拒绝'
          : '该请求已处理';

  return (
    <View className='page'>
      <View className={pending ? 'status pending' : 'status resolved'}>
        {statusText}
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
