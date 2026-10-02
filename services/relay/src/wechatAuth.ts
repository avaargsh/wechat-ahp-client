export interface WeChatIdentity {
  openId: string;
  unionId?: string;
}

interface Code2SessionResponse {
  openid?: string;
  unionid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

export class WeChatAuth {
  readonly enabled: boolean;

  constructor(
    private readonly appId = process.env.WX_APPID,
    private readonly appSecret = process.env.WX_APP_SECRET,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (Boolean(appId) !== Boolean(appSecret)) {
      throw new Error('WX_APPID and WX_APP_SECRET must be configured together');
    }
    this.enabled = Boolean(appId && appSecret);
  }

  async exchange(code: string | undefined): Promise<WeChatIdentity | undefined> {
    if (!this.enabled) return;
    if (!code) throw new Error('WeChat login code is required');

    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', this.appId!);
    url.searchParams.set('secret', this.appSecret!);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');

    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`WeChat code2Session HTTP ${response.status}`);
    }

    const body = await response.json() as Code2SessionResponse;
    if (body.errcode || !body.openid) {
      throw new Error(body.errmsg || `WeChat code2Session failed: ${body.errcode ?? 'missing openid'}`);
    }

    // session_key is intentionally not returned or exposed to the Mini Program.
    return {
      openId: body.openid,
      unionId: body.unionid,
    };
  }
}
