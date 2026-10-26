import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ToolCallContext, ToolOutcome } from 'cortico/core/types.ts';
import { dryMountWorld, fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { DEEPSEEKSEARCH } from '../src/definition.ts';
import { DEEPSEEKSEARCH_DEFAULTS } from '../src/config.ts';
import { DeepseeksearchWorld } from '../src/world.ts';
import { API_BASE } from '../src/client.ts';
import { FakeHost } from './helpers/fake-host.ts';

const scratchRoot = resolve('scratch');
mkdirSync(scratchRoot, { recursive: true });
const call = {} as ToolCallContext;
function makeWorld(key = 'test-token') {
  const cfg = { ...DEEPSEEKSEARCH_DEFAULTS, apiKey: key };
  const world = new DeepseeksearchWorld({ cfg, timezone: 'Asia/Shanghai' });
  const run = (name: 'search' | 'fetch', args: Record<string, unknown>, ctx = call) =>
    world.tools().find((tool) => tool.name === `deepseeksearch_${name}`)!.handler(args, ctx) as Promise<ToolOutcome>;
  return { cfg, world, run };
}
const item = { title: 'Article', url: 'https://example.com/a', snippet: 'Short', summary: 'Evidence',
  content: 'Body', site_name: null, site_icon: null, date: null, rerank_score: 2, authority: 3 };
function reply(data: unknown, status = 200) {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(data), { status }));
  vi.stubGlobal('fetch', transport);
  return transport;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('DeepSeek World', () => {
  it('默认配置无密钥可干装载，提示词文件可找到', async () => {
    const report = await dryMountWorld(DEEPSEEKSEARCH, {
      scratchDir: mkdtempSync(join(scratchRoot, 'mount-')), packageDir: resolve('.'),
    });
    expect(report.failures).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
  it('挂载仅归档且不发远端请求', async () => {
    const transport = reply({});
    const { world } = makeWorld();
    const host = new FakeHost();
    await world.start(host);
    expect(host.events[0].type).toBe('deepseeksearch.started');
    expect(host.events[0].origin).toBe('internal');
    expect(host.pushOpts[0]).toEqual({ deliver: false });
    expect(transport).not.toHaveBeenCalled();
    await world.stop();
  });
  it('缺失密钥给出失败回执，不访问网络', async () => {
    const transport = reply({});
    const result = await makeWorld('').run('search', { query: 'public facts' });
    expect(result.failed).toBe(true);
    expect(result.text).toContain('World 配置');
    expect(transport).not.toHaveBeenCalled();
  });
  it('配置密钥保存后搜索与抓取均使用新密钥，状态与回执不回显密钥', async () => {
    const transport = reply({ results: [], title: 'Page', content: 'Body' });
    const { cfg, world, run } = makeWorld();
    await run('search', { query: 'q' });
    cfg.apiKey = 'updated-test-token';
    const result = await run('fetch', { url: 'https://example.com' });
    expect(new Headers(transport.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer test-token');
    expect(new Headers(transport.mock.calls[1][1]!.headers).get('Authorization')).toBe(`Bearer ${cfg.apiKey}`);
    expect(JSON.stringify(world.webUi())).not.toContain(cfg.apiKey);
    expect(result.text).not.toContain(cfg.apiKey);
  });
  it('旧配置缺少apiKey时不回落到宿主secret', async () => {
    const transport = reply({ results: [] });
    const ctx = fakeWorldContext(DEEPSEEKSEARCH, { scratchDir: mkdtempSync(join(scratchRoot, 'legacy-')) });
    delete ctx.cfg.apiKey;
    ctx.secret = () => { throw new Error('不得读取环境密钥'); };
    const world = DEEPSEEKSEARCH.create(ctx);
    const result = await world.tools()[0].handler({ query: 'q' }, call) as ToolOutcome;
    expect(result.failed).toBe(true);
    expect(result.text).toContain('World 配置');
    expect(transport).not.toHaveBeenCalled();
  });
  it('搜索序列化参数并保留证据与来源，配置修改下次请求生效', async () => {
    const transport = reply({ results: [item] });
    const { cfg, run } = makeWorld();
    cfg.count = 2;
    const result = await run('search', { query: 'news site:example.com', ori_question: 'public question', need_content: true });
    const [endpoint, options] = transport.mock.calls[0];
    expect(endpoint).toBe(`${API_BASE}/search`);
    expect(JSON.parse(options!.body as string)).toEqual({ query: 'news site:example.com', count: cfg.count, ori_question: 'public question', need_content: true });
    expect(new Headers(options!.headers).get('Authorization')).toBe('Bearer test-token');
    const parsed = JSON.parse(result.text);
    expect(parsed.data.results[0]).toMatchObject({ url: item.url, summary: item.summary, content: item.content });
    expect(parsed.untrustedContent).toBe(true);
  });
  it('无结果是成功的空数组，不伪造来源', async () => {
    reply({ results: [] });
    const result = await makeWorld().run('search', { query: 'no matches' });
    expect(result.failed).toBeUndefined();
    expect(JSON.parse(result.text).data.results).toEqual([]);
  });
  it('接受128个Unicode字符，拒绝超长、空查询及非法计数', async () => {
    const transport = reply({ results: [] });
    const { run } = makeWorld();
    expect((await run('search', { query: '😀'.repeat(128) })).failed).toBeUndefined();
    for (const args of [{ query: '😀'.repeat(129) }, { query: '  ' }, { query: 'q', count: 1.2 }, { query: 'q', count: 51 }, { query: 'q', need_content: 'false' }]) {
      expect((await run('search', args)).failed).toBe(true);
    }
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('抓取按Unicode字符分页并明确结束位置', async () => {
    const content = '😀'.repeat(1200) + 'end';
    const transport = reply({ title: 'Page', content });
    const { cfg, run } = makeWorld();
    cfg.maxContentChars = 1000;
    const first = JSON.parse((await run('fetch', { url: 'https://example.com/a' })).text).data;
    const second = JSON.parse((await run('fetch', { url: 'https://example.com/a', offset: first.nextOffset })).text).data;
    expect(first.nextOffset).toBe(1000);
    expect(first.totalChars).toBe(1203);
    expect(first.content + second.content).toBe(content);
    expect(second.nextOffset).toBeNull();
    expect(JSON.parse(transport.mock.calls[1][1]!.body as string)).toEqual({ url: 'https://example.com/a' });
  });
  it('拒绝无效URL与偏移，不发送请求', async () => {
    const transport = reply({});
    const { run } = makeWorld();
    for (const url of ['file:///private', 'https://user:password@example.com', 'not-url']) {
      expect((await run('fetch', { url })).failed).toBe(true);
    }
    expect((await run('fetch', { url: 'https://example.com', offset: -1 })).failed).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });
  it('搜索正文截断显式标明，摘要和链接保留', async () => {
    reply({ results: [{ ...item, content: 'x'.repeat(1200) }] });
    const { cfg, run } = makeWorld();
    cfg.maxContentChars = 1000;
    const data = JSON.parse((await run('search', { query: 'q', need_content: true })).text).data.results[0];
    expect(data.content).toHaveLength(cfg.maxContentChars);
    expect(data.contentTruncated).toBe(true);
    expect(data.url).toBe(item.url);
    expect(data.summary).toBe(item.summary);
  });
  it.each([401, 402, 403, 404, 429, 500])('HTTP %s 失败不回显远端正文、不自动重试', async (status) => {
    const transport = reply({ error: { message: 'sensitive-echo' } }, status);
    const result = await makeWorld().run('fetch', { url: 'https://example.com' });
    expect(result.failed).toBe(true);
    expect(result.text).toContain(`HTTP ${status}`);
    expect(result.text).not.toContain('sensitive-echo');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([{ unexpected: [] }, { results: [{}] }])('错误响应结构返回失败', async (data) => {
    reply(data);
    expect((await makeWorld().run('search', { query: 'q' })).failed).toBe(true);
  });
  it('无效JSON和空正文返回失败', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not JSON')));
    expect((await makeWorld().run('fetch', { url: 'https://example.com' })).failed).toBe(true);
    reply({ title: '', content: '' });
    expect((await makeWorld().run('fetch', { url: 'https://example.com' })).failed).toBe(true);
  });
  it('宿主取消和World停止会终止在途请求', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })));
    const { world, run } = makeWorld();
    const controller = new AbortController();
    const first = run('search', { query: 'q' }, { signal: controller.signal } as ToolCallContext);
    controller.abort();
    expect((await first).text).toContain('取消');
    const second = run('fetch', { url: 'https://example.com' });
    await world.stop();
    expect((await second).text).toContain('取消');
  });
  it('超时终止请求并返回明确诊断', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    // Node的AbortSignal.timeout使用内部计时器，单独控制超时信号。
    const timer = new AbortController();
    const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timer.signal);
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    })));
    try {
      const pending = makeWorld().run('search', { query: 'q' });
      timer.abort();
      expect((await pending).text).toContain('超时');
    } finally { spy.mockRestore(); }
  });
  it('响应过大时失败，不把超大内容交给模型', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(8 * 1024 * 1024 + 1))));
    const result = await makeWorld().run('search', { query: 'q' });
    expect(result.failed).toBe(true);
    expect(result.text).toContain('8 MiB');
  });
});
