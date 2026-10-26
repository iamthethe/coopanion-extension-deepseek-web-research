/** 主动查询走工具回执；挂载事件仅归档，不触发额外模型轮次。 */
import { fileURLToPath } from 'node:url';
import type { ToolDef, ToolCallContext, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import { DEEPSEEKSEARCH_CONFIG_GROUP, DEEPSEEKSEARCH_DEFAULTS, type DeepseeksearchConfigSection } from './config.ts';
import { integer, object, pageUrl, queryText, request, RequestError, string } from './client.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
export interface DeepseeksearchWorldOptions {
  cfg: DeepseeksearchConfigSection;
  timezone: string;
  secret(): string;
  saveKey(value: string): void;
}

export const DEEPSEEKSEARCH_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'deepseeksearch_search', tags: ['read'], interruptible: true,
    description: 'Search public webpages through DeepSeek. Deployment settings control result count cap, detail level, text limits and default body inclusion. Explicit count is capped by deployment maxCount; any cap or text truncation is reported. No matches returns an empty results array. Supports site:, lang:, after:, before:, quoted phrases and exclusions in query.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 128, description: 'Focused query; never include private chat logs or credentials.' },
        count: { type: 'integer', minimum: 1, maximum: 50, description: 'Number of results; default comes from World settings.' },
        need_content: { type: 'boolean', description: 'Include webpage body when available. Omitted uses World default (initially false); output detail and length follow World settings.' },
        ori_question: { type: 'string', minLength: 1, maxLength: 128, description: 'Optional original public question, only if helpful for search intent.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'deepseeksearch_fetch', tags: ['read'], interruptible: true,
    description: 'Fetch a public HTTP(S) webpage as Markdown through DeepSeek. Returns URL, title, content, totalChars and nextOffset. Pass nextOffset as offset to continue. A new page request refetches the URL and may incur another charge; page content can change.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        url: { type: 'string', minLength: 1, maxLength: 8192, description: 'Public webpage URL without username/password.' },
        offset: { type: 'integer', minimum: 0, description: 'Zero-based Unicode character offset; default 0.' },
      },
      required: ['url'],
    },
  },
];

export class DeepseeksearchWorld implements World {
  readonly id = 'deepseeksearch';
  private lifetime = new AbortController();
  private readonly pending = new Set<Promise<ToolOutcome>>();
  constructor(private readonly opts: DeepseeksearchWorldOptions) {}

  envPromptVars(): Record<string, string> { return { 'deepseeksearch.maxCount': String(this.opts.cfg.maxCount ?? 50) }; }

  private keyState() {
    return { maskedKey: this.opts.secret().trim() ? '••••••••' : null, legacyKeyPresent: Boolean(this.opts.cfg.apiKey?.trim()) };
  }

  private async invoke(panel: string, method: string, args: unknown[]) {
    if (panel !== 'credentials') throw new Error('未知面板。');
    if (method === 'state') return this.keyState();
    if (method !== 'saveKey' && method !== 'migrateKey') throw new Error('未知操作。');
    const value = method === 'migrateKey' ? this.opts.cfg.apiKey : args[0];
    if (typeof value !== 'string' || !value.trim() || /\s/.test(value.trim()) || value.length > 4096 || value.includes('•')) {
      throw new Error('请填写有效密钥；打码占位符不能作为密钥保存。');
    }
    try { this.opts.saveKey(value.trim()); }
    catch { throw new Error('密钥保存或旧配置清理失败，请检查部署目录写入权限后重试。'); }
    return this.keyState();
  }

  webUi(): WorldWebUiDecl {
    const configured = Boolean(this.opts.secret().trim());
    return {
      label: 'DeepSeek 网页搜索',
      lamps: [{ label: 'API Key', state: configured ? 'online' : 'offline', hint: configured ? '已配置，未验证远端认证' : '请在 World 配置中填写 DeepSeek API Key' }],
      config: [DEEPSEEKSEARCH_CONFIG_GROUP],
      panels: [{ id: 'credentials', title: '密钥设置', description: '输入密钥后保存到部署 .env，页面只显示打码状态。', getMethods: ['state'] }],
      invoke: (panel, method, args) => this.invoke(panel, method, args),
      promptDocs: [{ key: 'worlds.deepseeksearch.envPrompt', title: 'DeepSeek · 联网优先规则', description: '联网需求优先使用 DeepSeek；由模型遵循。', path: ENV_PROMPT_FILE, role: 'envPrompt', vars: [{ name: 'deepseeksearch.maxCount', description: '部署允许的最多搜索条数。' }] }],
    };
  }

  async start(host: WorldHost): Promise<void> {
    this.lifetime = new AbortController();
    await host.pushEvent({ type: 'deepseeksearch.started', ts: nowIso(this.opts.timezone), source: this.id,
      origin: 'internal', senderKey: this.id, text: 'DeepSeek 搜索 World 已挂载；远端接口尚未验证。',
    }, { deliver: false });
  }

  async stop(): Promise<void> {
    this.lifetime.abort();
    await Promise.allSettled([...this.pending]);
  }

  tools(): ToolDef[] {
    return DEEPSEEKSEARCH_TOOL_DECLS.map((decl) => ({ ...decl, handler: (args, ctx) => {
      const work = this.run(decl.name, args, ctx);
      this.pending.add(work);
      void work.finally(() => this.pending.delete(work));
      return work;
    } }));
  }

  private async run(name: string, args: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolOutcome> {
    try {
      const signal = ctx.signal ? AbortSignal.any([this.lifetime.signal, ctx.signal]) : this.lifetime.signal;
      signal.throwIfAborted();
      const cfg = { ...DEEPSEEKSEARCH_DEFAULTS, ...this.opts.cfg };
      const limit = integer(cfg.maxContentChars, 'maxContentChars', 1000, 50000);
      const textLimit = integer(cfg.maxTextChars ?? 0, 'maxTextChars', 0, 100000);
      const detail = cfg.resultDetail ?? 'full';
      if (!['brief', 'summary', 'full'].includes(detail)) throw new RequestError('返回内容精细度无效。');
      if (typeof cfg.includeContent !== 'boolean') throw new RequestError('includeContent 必须为布尔值。');
      const retries = integer(cfg.retries ?? 0, 'retries', 0, 5);
      let result: unknown;
      if (name === 'deepseeksearch_search') {
        const query = queryText(args.query);
        const requestedCount = integer(args.count ?? cfg.count, 'count', 1, 50);
        const count = Math.min(requestedCount, integer(cfg.maxCount ?? 50, 'maxCount', 1, 50));
        if (args.need_content !== undefined && typeof args.need_content !== 'boolean') throw new RequestError('need_content 必须为布尔值。');
        const body: Record<string, unknown> = { query, count, need_content: args.need_content ?? cfg.includeContent };
        if (args.ori_question !== undefined) body.ori_question = queryText(args.ori_question, 'ori_question');
        const data = await request('search', body, this.opts.secret().trim(), cfg.timeoutMs, signal, retries);
        if (!Array.isArray(data.results)) throw new RequestError('DeepSeek 搜索响应缺少 results 数组。');
        result = { query, ...(requestedCount > count ? { requestedCount, effectiveCount: count, countCapped: true } : {}), results: data.results.slice(0, count).map((value) => {
          const item = object(value);
          const content = body.need_content ? [...string(item.content)] : [];
          const snippet = string(item.snippet), summary = string(item.summary);
          const crop = (value: string) => textLimit ? [...value].slice(0, textLimit).join('') : value;
          return { title: string(item.title), url: string(item.url),
            ...(detail !== 'summary' ? { snippet: crop(snippet), ...(textLimit && [...snippet].length > textLimit ? { snippetTruncated: true } : {}) } : {}),
            ...(detail !== 'brief' ? { summary: crop(summary), ...(textLimit && [...summary].length > textLimit ? { summaryTruncated: true } : {}) } : {}),
            date: item.date ?? null, site_name: item.site_name ?? null,
            ...(detail === 'full' ? { rerank_score: item.rerank_score, authority: item.authority } : {}),
            content: content.slice(0, limit).join(''), contentTruncated: content.length > limit,
          };
        }) };
      } else {
        const url = pageUrl(args.url);
        const offset = integer(args.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER);
        const data = await request('fetch', { url }, this.opts.secret().trim(), cfg.timeoutMs, signal, retries);
        const content = [...string(data.content)];
        if (!content.length) throw new RequestError('DeepSeek 未返回可用的网页正文。');
        const end = Math.min(content.length, offset + limit);
        result = { url, title: string(data.title), content: content.slice(offset, end).join(''), offset,
          totalChars: content.length, nextOffset: end < content.length ? end : null, truncated: end < content.length };
      }
      return { text: JSON.stringify({ source: 'DeepSeek', untrustedContent: true, data: result }) };
    } catch (error) {
      return { failed: true, text: error instanceof RequestError ? error.message : '请求已取消或处理失败。' };
    }
  }
}
