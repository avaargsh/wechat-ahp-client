import type { AttentionKind, AttentionProjection } from '@wechat-ahp/protocol';

interface AccessTokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

interface SendResponse {
  errcode?: number;
  errmsg?: string;
  msgid?: number;
}

type TemplateData = Record<string, string>;

export interface NotificationPublicConfig {
  enabled: boolean;
  templateId?: string;
}

export class WeChatNotificationError extends Error {
  constructor(
    message: string,
    readonly errcode?: number,
  ) {
    super(message);
    this.name = 'WeChatNotificationError';
  }
}

export class NotificationJournal {
  private readonly attempted = new Set<string>();

  begin(openId: string, attentionId: string): boolean {
    const key = `${openId}:${attentionId}`;
    if (this.attempted.has(key)) return false;
    this.attempted.add(key);
    return true;
  }
}

export class WeChatNotifier {
  readonly enabled: boolean;
  private readonly templateData?: TemplateData;
  private cachedAccessToken?: { value: string; expiresAt: number };

  constructor(
    private readonly appId = process.env.WX_APPID,
    private readonly appSecret = process.env.WX_APP_SECRET,
    private readonly templateId = process.env.WX_SUBSCRIBE_TEMPLATE_ID,
    templateDataJson = process.env.WX_SUBSCRIBE_TEMPLATE_DATA,
    private readonly miniProgramState = process.env.WX_MINIPROGRAM_STATE ?? 'developer',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const credentialsReady = Boolean(appId && appSecret);
    const notificationReady = Boolean(templateId && templateDataJson);

    if (notificationReady && !credentialsReady) {
      throw new Error('WX_SUBSCRIBE_TEMPLATE_ID requires WX_APPID and WX_APP_SECRET');
    }

    if (templateDataJson) {
      const parsed = JSON.parse(templateDataJson) as unknown;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.values(parsed).some(value => typeof value !== 'string')
      ) {
        throw new Error('WX_SUBSCRIBE_TEMPLATE_DATA must be a JSON object of string values');
      }
      this.templateData = parsed as TemplateData;
    }

    if (!['developer', 'trial', 'formal'].includes(this.miniProgramState)) {
      throw new Error('WX_MINIPROGRAM_STATE must be developer, trial, or formal');
    }

    this.enabled = credentialsReady && notificationReady && Boolean(this.templateData);
  }

  publicConfig(): NotificationPublicConfig {
    return {
      enabled: this.enabled,
      templateId: this.enabled ? this.templateId : undefined,
    };
  }

  async send(openId: string, attention: AttentionProjection): Promise<void> {
    if (!this.enabled || !this.templateId || !this.templateData) {
      throw new WeChatNotificationError('WeChat notifications are not configured');
    }

    const accessToken = await this.accessToken();
    const url = new URL('https://api.weixin.qq.com/cgi-bin/message/subscribe/send');
    url.searchParams.set('access_token', accessToken);

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        touser: openId,
        template_id: this.templateId,
        page: `pages/approval/index?id=${encodeURIComponent(attention.id)}`,
        miniprogram_state: this.miniProgramState,
        lang: 'zh_CN',
        data: Object.fromEntries(
          Object.entries(this.templateData).map(([key, value]) => [
            key,
            { value: renderSafeTemplate(value, attention.kind) },
          ]),
        ),
      }),
    });

    if (!response.ok) {
      throw new WeChatNotificationError(
        `WeChat subscribeMessage HTTP ${response.status}`,
      );
    }

    const body = await response.json() as SendResponse;
    if (body.errcode && body.errcode !== 0) {
      throw new WeChatNotificationError(
        body.errmsg || `WeChat subscribeMessage failed: ${body.errcode}`,
        body.errcode,
      );
    }
  }

  private async accessToken(now = Date.now()): Promise<string> {
    if (
      this.cachedAccessToken &&
      this.cachedAccessToken.expiresAt - 120_000 > now
    ) {
      return this.cachedAccessToken.value;
    }

    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', this.appId!);
    url.searchParams.set('secret', this.appSecret!);

    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new WeChatNotificationError(
        `WeChat access token HTTP ${response.status}`,
      );
    }

    const body = await response.json() as AccessTokenResponse;
    if (!body.access_token || body.errcode) {
      throw new WeChatNotificationError(
        body.errmsg || `WeChat access token failed: ${body.errcode ?? 'missing token'}`,
        body.errcode,
      );
    }

    const ttlMs = Math.max(60_000, (body.expires_in ?? 7_200) * 1_000);
    this.cachedAccessToken = {
      value: body.access_token,
      expiresAt: now + ttlMs,
    };

    return body.access_token;
  }
}

function renderSafeTemplate(template: string, kind: AttentionKind): string {
  const rendered = template.replaceAll('{{kind}}', safeKindLabel(kind));

  // Notification templates intentionally expose no summary, command, cwd,
  // session title, prompt, or file path placeholders.
  return [...rendered.replace(/[\r\n\t\0]/g, ' ').replace(/\s+/g, ' ').trim()]
    .slice(0, 20)
    .join('');
}

function safeKindLabel(kind: AttentionKind): string {
  switch (kind) {
    case 'command':
      return '命令执行';
    case 'file_write':
      return '文件修改';
    case 'network':
      return '网络访问';
    case 'permission':
      return '权限请求';
    case 'question':
      return '需要回复';
  }
}
