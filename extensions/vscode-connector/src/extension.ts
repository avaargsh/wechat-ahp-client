import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { AttentionProjection } from '@wechat-ahp/protocol';
import { RelayClient } from './relayClient.js';

let client: RelayClient | undefined;
const demoAttentions = new Map<string, AttentionProjection>();

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('WeChat AHP Client');
  context.subscriptions.push(output);

  const configuration = () => {
    const config = vscode.workspace.getConfiguration('wechatAhp');
    return {
      relayUrl: config.get<string>('relayUrl', 'ws://127.0.0.1:8787/connector'),
      machineId: config.get<string>('machineId', 'devbox'),
      connectorToken: config.get<string>('connectorToken', 'dev-connector'),
    };
  };

  const start = () => {
    client?.stop();
    const config = configuration();
    client = new RelayClient({
      ...config,
      displayName: vscode.env.machineId.slice(0, 12),
      log: message => output.appendLine(message),
      onResolve: async (id, decision, expectedVersion) => {
        // Transport MVP only. AHP dispatch replaces this in the next slice.
        const current = demoAttentions.get(id);
        if (!current) throw new Error('attention no longer exists');
        if (current.state !== 'pending') return current;
        if (current.version !== expectedVersion) throw new Error('attention version changed');

        const next: AttentionProjection = {
          ...current,
          state: decision === 'allow_once' ? 'resolved_allow' : 'resolved_reject',
          version: current.version + 1,
          resolvedAt: new Date().toISOString(),
        };
        demoAttentions.set(id, next);
        output.appendLine(
          `Demo approval resolved: ${decision}. Next step: dispatch AHP chat/toolCallConfirmed.`,
        );
        return next;
      },
    });
    client.start();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('wechatAhp.start', start),
    vscode.commands.registerCommand('wechatAhp.stop', () => {
      client?.stop();
      client = undefined;
    }),
    vscode.commands.registerCommand('wechatAhp.emitDemoApproval', () => {
      if (!client) start();
      const config = configuration();
      const id = `att_${randomUUID()}`;
      const attention: AttentionProjection = {
        id,
        machineId: config.machineId,
        sessionId: 'demo-session',
        resourceUri: 'ahp-chat://demo',
        kind: 'command',
        projectName: vscode.workspace.name ?? 'demo-project',
        title: '运行命令',
        summary: 'npm test -- --coverage',
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        impact: ['本机命令执行'],
        state: 'pending',
        version: 1,
        observedAt: new Date().toISOString(),
      };
      demoAttentions.set(id, attention);
      client?.publish(attention);
      void vscode.window.showInformationMessage('Demo approval sent to relay.');
    }),
  );

  start();
}

export function deactivate(): void {
  client?.stop();
}
