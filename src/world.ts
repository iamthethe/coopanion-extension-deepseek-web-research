/** 主动查询走工具回执；挂载事件仅归档，不触发额外模型轮次。 */
import { fileURLToPath } from 'node:url';
import type { ToolDef, ToolCallContext, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import { DEEPSEEKSEARCH_CONFIG_GROUP, type DeepseeksearchConfigSection } from './config.ts';
import { integer, object, pageUrl, queryText, request, RequestError, string } from './client.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
export interface DeepseeksearchWorldOptions {
  cfg: DeepseeksearchConfigSection;
  timezone: string;
}

export const DEEPSEEKSEARCH_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'deepseeksearch_search', tags: ['read'], interruptible: true,
    description: 'Search public webpages through DeepSeek. Returns source URLs, titles, dates and summaries; optional body content is capped per result. No matches returns an empty results array. Supports site:, lang:, after:, before:, quoted phrases and exclusions in query.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 128, description: 'Focused query; never include private chat logs or credentials.' },
        count: { type: 'integer', minimum: 1, maximum: 50, description: 'Number of results; default comes from World settings.' },
        need_content: { type: 'boolean', default: false, description: 'Include webpage body when available; summaries are always returned.' },
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

  envPromptVars(): Record<string, string> { return {}; }

  webUi(): WorldWebUiDecl {
    const configured = Boolean(this.opts.cfg.apiKey?.trim());
    return {
      label: 'DeepSeek 网页搜索',
      lamps: [{ label: 'API Key', state: configured ? 'online' : 'offline', hint: configured ? '已配置，未验证远端认证' : '请在 World 配置中填写 DeepSeek API Key' }],
      config: [DEEPSEEKSEARCH_CONFIG_GROUP],
      promptDocs: [{ key: 'worlds.deepseeksearch.envPrompt', title: 'DeepSeek · 联网优先规则', description: '联网需求优先使用 DeepSeek；由模型遵循。', path: ENV_PROMPT_FILE, role: 'envPrompt' }],
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
      const { cfg } = this.opts;
      const limit = integer(cfg.maxContentChars, 'maxContentChars', 1000, 50000);
      let result: unknown;
      if (name === 'deepseeksearch_search') {
        const query = queryText(args.query);
        const count = integer(args.count ?? cfg.count, 'count', 1, 50);
        if (args.need_content !== undefined && typeof args.need_content !== 'boolean') throw new RequestError('need_content 必须为布尔值。');
        const body: Record<string, unknown> = { query, count, need_content: args.need_content ?? false };
        if (args.ori_question !== undefined) body.ori_question = queryText(args.ori_question, 'ori_question');
        const data = await request('search', body, cfg.apiKey?.trim() ?? '', cfg.timeoutMs, signal);
        if (!Array.isArray(data.results)) throw new RequestError('DeepSeek 搜索响应缺少 results 数组。');
        result = { query, results: data.results.slice(0, count).map((value) => {
          const item = object(value);
          const content = body.need_content ? [...string(item.content)] : [];
          return { title: string(item.title), url: string(item.url), snippet: string(item.snippet),
            summary: string(item.summary), date: item.date ?? null, site_name: item.site_name ?? null,
            rerank_score: item.rerank_score, authority: item.authority,
            content: content.slice(0, limit).join(''), contentTruncated: content.length > limit,
          };
        }) };
      } else {
        const url = pageUrl(args.url);
        const offset = integer(args.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER);
        const data = await request('fetch', { url }, cfg.apiKey?.trim() ?? '', cfg.timeoutMs, signal);
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
