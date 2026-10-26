// @ts-check
/** @param {import('cortico/web/shared/client-panel.ts').WebUiPanelContext} ctx */
async function mount(ctx) {
  const { root, ui, signal } = ctx;
  const title = ui.h('h3', null, 'DeepSeek API Key');
  const status = ui.h('p'); status.setAttribute('aria-live', 'polite');
  const input = ui.h('input', 'field'); input.type = 'password'; input.name = 'apiKey';
  input.autocomplete = 'new-password'; input.maxLength = 4096;
  input.setAttribute('aria-label', '新的 DeepSeek API Key');
  const hint = ui.h('p', null, '留空保留已保存的密钥。保存到部署 .env，页面不读取完整密钥；下次请求生效。检索条数、精细度、长度及重试次数在「配置」页调整。');
  const save = ui.button('保存密钥', { variant: 'primary' });
  const migrate = ui.button('迁移旧配置密钥'); migrate.hidden = true;
  const message = ui.h('p'); message.setAttribute('role', 'status');
  const actions = ui.actions(); actions.append(save, migrate);
  root.append(title, status, input, hint, actions, message);
  let busy = true;
  let legacy = false;
  ctx.guardLeave(() => input.value ? '密钥尚未保存，确定离开？' : null);
  /** @param {boolean} value */
  const setBusy = (value) => { busy = value; input.disabled = value; save.disabled = value; migrate.disabled = value; };
  /** @param {{maskedKey: string|null, legacyKeyPresent: boolean}} state */
  const apply = (state) => {
    legacy = state.legacyKeyPresent;
    status.textContent = state.maskedKey ? `已保存：${state.maskedKey}` : '尚未保存密钥';
    input.placeholder = state.maskedKey ? '已配置；填写新密钥可替换' : '粘贴 DeepSeek API Key';
    migrate.hidden = !legacy;
    if (legacy) message.textContent = '检测到旧 config.json 明文密钥。点击迁移后备份相关文件、写入 .env 并清空旧字段；备份仍含旧密钥。';
  };
  /** @param {'saveKey'|'migrateKey'} method */
  const submit = async (method) => {
    if (busy) return;
    if (method === 'saveKey' && !input.value.trim()) { message.textContent = '未填写新密钥，保留当前值。'; return; }
    if (method === 'migrateKey' && !(await ui.confirm({ title: '迁移旧密钥？', body: '将替换当前部署 .env 的 DeepSeek 密钥，并清空 config.json 中的旧字段。修改前会备份，备份中仍含旧密钥。' }))) return;
    if (signal.aborted) return;
    setBusy(true);
    try {
      const state = await ctx.invoke(method, method === 'saveKey' ? [input.value.trim()] : []);
      if (signal.aborted) return;
      input.value = ''; apply(/** @type {{maskedKey: string|null, legacyKeyPresent: boolean}} */ (state));
      message.textContent = '已保存到部署 .env，下次请求生效。';
      await ctx.refresh();
    } catch { if (!signal.aborted) message.textContent = '保存未完成，请检查部署目录权限后重试。'; }
    finally { if (!signal.aborted) setBusy(false); }
  };
  save.addEventListener('click', () => { void submit('saveKey'); }, { signal });
  migrate.addEventListener('click', () => { void submit('migrateKey'); }, { signal });
  signal.addEventListener('abort', () => { input.value = ''; }, { once: true });
  setBusy(true);
  try { const state = await ctx.invoke('state'); if (!signal.aborted) apply(/** @type {{maskedKey: string|null, legacyKeyPresent: boolean}} */ (state)); }
  catch { if (!signal.aborted) message.textContent = '密钥状态读取失败，请重新打开面板。'; }
  finally { if (!signal.aborted) setBusy(false); }
}

/** @type {import('cortico/web/shared/client-panel.ts').WebUiClientBundle} */
const bundle = { panels: { credentials: { mount } } };
export default bundle;
