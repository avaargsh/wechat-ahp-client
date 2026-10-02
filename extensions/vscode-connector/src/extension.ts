import * as vscode from 'vscode';
import { AhpAdapter, type AhpBinding } from './ahp/adapter.js';
import { RelayClient } from './relayClient.js';
import { showPairingQr } from './pairingView.js';

const BINDING_KEY = 'wechatAhp.binding';

let relay: RelayClient | undefined;
let adapter: AhpAdapter | undefined;

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

  const stop = async () => {
    relay?.stop();
    relay = undefined;
    await adapter?.stop();
    adapter = undefined;
  };

  const start = async () => {
    await stop();
    const config = configuration();

    adapter = new AhpAdapter({
      machineId: config.machineId,
      onAttention: attention => relay?.publish(attention),
      onResolved: attention => relay?.publishResolved(attention),
      log: message => output.appendLine(message),
    });

    relay = new RelayClient({
      ...config,
      displayName: vscode.env.machineId.slice(0, 12),
      log: message => output.appendLine(message),
      onConnected: () => {
        relay?.sync(adapter?.listPending() ?? []);
      },
      onResolve: (id, decision, expectedVersion) => {
        if (!adapter) throw new Error('AHP adapter is not running');
        return adapter.resolve(id, decision, expectedVersion);
      },
    });
    relay.start();

    const binding = context.globalState.get<AhpBinding>(BINDING_KEY);
    if (!binding) {
      output.appendLine('No AHP chat selected. Run "WeChat AHP Client: Select Agent Host Chat".');
      return;
    }

    try {
      await adapter.start(binding);
      relay?.sync(adapter.listPending());
    } catch (error) {
      output.appendLine(
        `AHP start failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  };

  const selectChat = async () => {
    const choices = await AhpAdapter.selectBinding();
    if (!choices.length) {
      void vscode.window.showWarningMessage(
        'No compatible local VS Code Agent Host chat was found. Open a Codex Agent Host session first.',
      );
      return;
    }

    const picked = await vscode.window.showQuickPick(
      choices.map(binding => ({ label: binding.label, binding })),
      { placeHolder: 'Select the exact Agent Host chat to expose to WeChat' },
    );
    if (!picked) return;

    await context.globalState.update(BINDING_KEY, picked.binding);
    await start();
    void vscode.window.showInformationMessage(`WeChat AHP bound to: ${picked.binding.label}`);
  };

  const showPairingCode = async () => {
    if (!relay) await start();
    if (!relay) throw new Error('relay connector is unavailable');

    try {
      const ticket = await relay.createPairing();
      await vscode.window.showInformationMessage(
        `Pairing code: ${ticket.code} · expires ${new Date(ticket.expiresAt).toLocaleTimeString()}`,
        { modal: true },
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Cannot create pairing code: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  };

  const showPairingQrCode = async () => {
    if (!relay) await start();
    if (!relay) throw new Error('relay connector is unavailable');

    try {
      const ticket = await relay.createPairing();
      await showPairingQr(ticket);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Cannot create pairing QR: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('wechatAhp.selectChat', selectChat),
    vscode.commands.registerCommand('wechatAhp.showPairingCode', showPairingCode),
    vscode.commands.registerCommand('wechatAhp.showPairingQr', showPairingQrCode),
    vscode.commands.registerCommand('wechatAhp.start', start),
    vscode.commands.registerCommand('wechatAhp.stop', stop),
  );

  void start();
}

export function deactivate(): Thenable<void> | void {
  relay?.stop();
  return adapter?.stop();
}
