import * as vscode from 'vscode';
import QRCode from 'qrcode';
import type { PairingTicket } from '@wechat-ahp/protocol';

export async function showPairingQr(ticket: PairingTicket): Promise<void> {
  const payload = `wechat-ahp://pair?code=${encodeURIComponent(ticket.code)}`;
  const image = await QRCode.toDataURL(payload, {
    width: 360,
    margin: 2,
    errorCorrectionLevel: 'M',
  });

  const panel = vscode.window.createWebviewPanel(
    'wechatAhpPairing',
    'WeChat AHP Client · Pair Device',
    vscode.ViewColumn.Active,
    { enableScripts: false },
  );

  const expires = new Date(ticket.expiresAt).toLocaleTimeString();
  panel.webview.html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 32px;
      text-align: center;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .card { max-width: 460px; margin: 0 auto; }
    img { width: min(360px, 80vw); border-radius: 12px; background: white; padding: 8px; }
    .code { font: 700 24px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 3px; margin-top: 18px; }
    .muted { color: var(--vscode-descriptionForeground); line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Pair WeChat Mini Program</h2>
    <p class="muted">Open “绑定开发机” in the Mini Program and scan this QR code.</p>
    <img src="${image}" alt="Pairing QR code">
    <div class="code">${ticket.code}</div>
    <p class="muted">One-time code · expires at ${expires}</p>
  </div>
</body>
</html>`;
}
