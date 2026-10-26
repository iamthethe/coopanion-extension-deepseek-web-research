import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
  const cfg = { ...DEEPSEEKSEARCH_DEFAULTS };
  let savedKey = key;
  const world = new DeepseeksearchWorld({ cfg, timezone: 'Asia/Shanghai', secret: () => savedKey,
    saveKey: (value) => { savedKey = value; cfg.apiKey = ''; } });
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
      scratchDir: mkdtempSync(join(scratchRoot, 'mount-')), packageDir: resolve('.'), hasWebUiClient: true,
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
    const { world, run } = makeWorld();
    await run('search', { query: 'q' });
    await world.webUi().invoke!('credentials', 'saveKey', ['updated-test-token']);
    const result = await run('fetch', { url: 'https://example.com' });
    expect(new Headers(transport.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer test-token');
    expect(new Headers(transport.mock.calls[1][1]!.headers).get('Authorization')).toBe('Bearer updated-test-token');
    expect(JSON.stringify(world.webUi())).not.toContain('updated-test-token');
    expect(result.text).not.toContain('updated-test-token');
  });
  it('旧明文配置未迁移时不用于请求，状态不回显旧密钥', async () => {
    const transport = reply({ results: [] });
    const ctx = fakeWorldContext(DEEPSEEKSEARCH, { scratchDir: mkdtempSync(join(scratchRoot, 'legacy-')) });
    ctx.cfg.apiKey = 'legacy-fixture-token';
    ctx.secret = () => '';
    const world = DEEPSEEKSEARCH.create(ctx);
    const result = await world.tools()[0].handler({ query: 'q' }, call) as ToolOutcome;
    expect(result.failed).toBe(true);
    expect(result.text).toContain('World 配置');
    expect(transport).not.toHaveBeenCalled();
    const state = await world.webUi!().invoke!('credentials', 'state', []);
    expect(state).toEqual({ maskedKey: null, legacyKeyPresent: true });
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
  it('默认和显式搜索条数都受部署上限约束并报告裁剪', async () => {
    const transport = reply({ results: Array.from({ length: 6 }, () => item) });
    const { cfg, run } = makeWorld();
    cfg.count = 5; cfg.maxCount = 2;
    for (const args of [{ query: 'q' }, { query: 'q', count: 4 }]) {
      const data = JSON.parse((await run('search', args)).text).data;
      expect(data.results).toHaveLength(2);
      expect(data.countCapped).toBe(true);
      expect(data.effectiveCount).toBe(2);
    }
    expect(transport.mock.calls.map(([, options]) => JSON.parse(options!.body as string).count)).toEqual([2, 2]);
  });
  it('保留当前完整返回默认；简短和摘要模式仅返回所选信息', async () => {
    reply({ results: [item] });
    const { cfg, run } = makeWorld();
    const full = JSON.parse((await run('search', { query: 'q' })).text).data.results[0];
    expect(full).toMatchObject({ snippet: item.snippet, summary: item.summary, rerank_score: item.rerank_score });
    cfg.resultDetail = 'brief';
    const brief = JSON.parse((await run('search', { query: 'q' })).text).data.results[0];
    expect(brief.snippet).toBe(item.snippet); expect(brief.summary).toBeUndefined(); expect(brief.authority).toBeUndefined();
    cfg.resultDetail = 'summary';
    const summary = JSON.parse((await run('search', { query: 'q' })).text).data.results[0];
    expect(summary.summary).toBe(item.summary); expect(summary.snippet).toBeUndefined();
  });
  it('摘要按Unicode限制且明确标记，0保留原文', async () => {
    reply({ results: [{ ...item, snippet: '😀'.repeat(5), summary: '正文'.repeat(5) }] });
    const { cfg, run } = makeWorld(); cfg.maxTextChars = 3;
    const cropped = JSON.parse((await run('search', { query: 'q' })).text).data.results[0];
    expect(cropped.snippet).toBe('😀😀😀'); expect(cropped.summary).toBe('正文正');
    expect(cropped.snippetTruncated).toBe(true); expect(cropped.summaryTruncated).toBe(true);
    cfg.maxTextChars = 0;
    expect(JSON.parse((await run('search', { query: 'q' })).text).data.results[0].summary).toBe('正文'.repeat(5));
  });
  it('默认正文开关可热改，显式参数可覆盖', async () => {
    const transport = reply({ results: [item] });
    const { cfg, run } = makeWorld(); cfg.includeContent = true;
    expect(JSON.parse((await run('search', { query: 'q' })).text).data.results[0].content).toBe(item.content);
    expect(JSON.parse((await run('search', { query: 'q', need_content: false })).text).data.results[0].content).toBe('');
    expect(transport.mock.calls.map(([, options]) => JSON.parse(options!.body as string).need_content)).toEqual([true, false]);
  });
  it('密钥保存只返回打码状态，拒绝占位符和未知面板', async () => {
    const { world } = makeWorld();
    const invoke = world.webUi().invoke!;
    expect(await invoke('credentials', 'state', [])).toEqual({ maskedKey: '••••••••', legacyKeyPresent: false });
    for (const key of ['', 'has space', '••••••••']) await expect(invoke('credentials', 'saveKey', [key])).rejects.toThrow();
    await expect(invoke('other', 'saveKey', ['fixture-token'])).rejects.toThrow();
    const group = world.webUi().config![0];
    expect(group.schema.properties).not.toHaveProperty('worlds.deepseeksearch.apiKey');
  });
  it('用户迁移时先备份.env和旧配置，再写密钥并清空旧字段', async () => {
    const ctx = fakeWorldContext(DEEPSEEKSEARCH, { scratchDir: mkdtempSync(join(scratchRoot, 'migration-')) });
    ctx.cfg.apiKey = 'legacy-fixture-token';
    const envPath = join(ctx.botDir, '.env'), configPath = join(ctx.botDir, 'config.json');
    writeFileSync(envPath, 'OTHER_KEY=other-fixture\n');
    writeFileSync(configPath, JSON.stringify({ worlds: { deepseeksearch: ctx.cfg } }));
    let saved = '';
    ctx.secret = () => saved;
    ctx.storeSecret = (_name, value) => { saved = value; writeFileSync(envPath, `OTHER_KEY=other-fixture\nCORTICO_DEEPSEEK_API_KEY=${value}\n`); };
    const world = DEEPSEEKSEARCH.create(ctx);
    const result = await world.webUi!().invoke!('credentials', 'migrateKey', []);
    expect(result).toEqual({ maskedKey: '••••••••', legacyKeyPresent: false });
    expect(saved).toBe('legacy-fixture-token'); expect(ctx.cfg.apiKey).toBe('');
    const backups = readdirSync(ctx.botDir).filter((name) => name.endsWith('.bak'));
    expect(backups).toHaveLength(2);
    expect(readFileSync(join(ctx.botDir, backups.find((name) => name.startsWith('.env.'))!), 'utf8')).toBe('OTHER_KEY=other-fixture\n');
    expect(readFileSync(join(ctx.botDir, backups.find((name) => name.startsWith('config.json.'))!), 'utf8')).toContain('legacy-fixture-token');
  });
  it('密钥写入失败保留旧配置，不回显含密钥的底层错误', async () => {
    const ctx = fakeWorldContext(DEEPSEEKSEARCH, { scratchDir: mkdtempSync(join(scratchRoot, 'failed-migration-')) });
    ctx.cfg.apiKey = 'legacy-fixture-token';
    ctx.storeSecret = () => { throw new Error('echo legacy-fixture-token'); };
    const world = DEEPSEEKSEARCH.create(ctx);
    await expect(world.webUi!().invoke!('credentials', 'migrateKey', [])).rejects.toThrow('保存或旧配置清理失败');
    expect(ctx.cfg.apiKey).toBe('legacy-fixture-token');
  });
  it('瞬时故障按重试次数恢复，不重试401、402或无效JSON', async () => {
    vi.useFakeTimers();
    const transport = reply({ results: [] });
    transport.mockImplementationOnce(async () => new Response('{}', { status: 503 }));
    const { cfg, run } = makeWorld(); cfg.retries = 2;
    const pending = run('search', { query: 'q' });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).failed).toBeUndefined(); expect(transport).toHaveBeenCalledTimes(2);
    for (const status of [401, 402]) {
      transport.mockClear(); transport.mockImplementation(async () => new Response('{}', { status }));
      expect((await run('search', { query: 'q' })).failed).toBe(true); expect(transport).toHaveBeenCalledTimes(1);
    }
    transport.mockClear(); transport.mockImplementation(async () => new Response('bad-json'));
    expect((await run('search', { query: 'q' })).failed).toBe(true); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('持续429总尝试次数为1加重试次数；等待期间可取消', async () => {
    vi.useFakeTimers();
    const transport = reply({}, 429);
    const { cfg, run } = makeWorld(); cfg.retries = 2;
    const pending = run('search', { query: 'q' });
    await vi.advanceTimersByTimeAsync(3100);
    expect((await pending).failed).toBe(true); expect(transport).toHaveBeenCalledTimes(3);
    transport.mockClear();
    const controller = new AbortController();
    const cancelled = run('search', { query: 'q' }, { signal: controller.signal } as ToolCallContext);
    await vi.advanceTimersByTimeAsync(0); controller.abort();
    expect((await cancelled).text).toContain('取消'); expect(transport).toHaveBeenCalledTimes(1);
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
