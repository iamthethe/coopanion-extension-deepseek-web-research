# cortico-world-deepseeksearch

Owner: `src/definition.ts`, `src/world.ts`, `src/client.ts`

为 Coopanion 0.2.10 / Cortico World API 6 提供 DeepSeek 网页搜索与 Markdown 抓取。
聊天模型不必是 DeepSeek，但须支持工具调用。

## 本地安装

1. 在 Coopanion 的 WebUI 打开「扩展」→ World →「手动安装」→「从本机目录安装」，选择：

   `cortico-world-deepseeksearch`

2. 完全退出并重新启动 Coopanion。在「World」→「DeepSeek 网页搜索」的配置中填写「DeepSeek API Key」并保存。
   密钥明文保存在部署 `config.json` 的 `worlds.deepseeksearch.apiKey`，保存后下次请求生效。
   不读取 `.env` 或进程环境密钥；升级自0.1.0时，需要在此重新填写。真实密钥不要写进扩展源码或发给开发助手。

3. 启用「DeepSeek 网页搜索」。默认禁用。
   「API Key 已配置」只表示读到了密钥，不代表远端认证或余额已验证。
4. 如另有 Brave WebSearch，建议停用以减少工具选择歧义。需要登录、交互的任务仍可保留电脑控制能力。

本机目录安装为 link：请保留此包目录。后续改源码后重启应用即可加载，通常不需重复安装。
本扩展不修改桌宠、聊天模型或其他 World，也没有额外运行时依赖。

## 本地验收（第三级）

- 扩展卡片为「已加载」，World 卡片已启用；时间线有 `deepseeksearch.started`（仅归档，不唤醒模型）。
- 对 bot 说：`请优先调用 deepseeksearch_search，搜索 DeepSeek Search API 的官方说明，并给出来源链接。`
  确认工具记录里是 `deepseeksearch_search`，回执有 results 和官方链接；搜索返回空数组时为正常无结果。
- 再说：`请调用 deepseeksearch_fetch 读取 https://api-docs.deepseek.com/zh-cn/guides/search/，根据正文总结接口地址。`
  确认回执含 URL、标题、Markdown 正文，模型按来源回答。
- 再用自然表达验证优先规则：`帮我查一下 DeepSeek 最新的网页搜索接口怎么用，给我官方来源。`
  确认先调用搜索/抓取，而非电脑控制；如未调用，检查 World 是否启用、当前环境提示词有无被部署覆盖、聊天模型是否支持工具调用。
- 若正文过长，回执的 nextOffset 可传给 fetch 的 offset 续读。

只有以上真实行为目击后，才能称第三级通过。World 通过环境提示词表达优先规则，不能强制拦截其他工具；
自定义 Persona 若不嵌入 World 提示词，还需在自己的 system 提示词中加入同样规则。

## 接口与数据

- `deepseeksearch_search(query, count?, need_content?, ori_question?)` → `POST https://api.deepseek.com/v1/tools/search`。
  query / ori_question 为1～128个Unicode字符；count 为1～50，默认5；默认仅摘要，need_content 可带正文。
  支持 `site:`、`lang:`、`after:`、`before:`、引号等官方搜索语法。
- `deepseeksearch_fetch(url, offset?)` → `POST https://api.deepseek.com/v1/tools/fetch`。
  仅接收无用户名/密码的 HTTP(S) URL，最大8192字符。返回title与Markdown，附上请求来源URL。
- 两工具均现读 `worlds.deepseeksearch.apiKey`，不从 `.env` 或进程环境回落。固定官方端点、不跟随HTTP重定向。
- 搜索词、可选原始问题和目标URL发给DeepSeek；不会自动上传聊天历史、文件或其他World状态。
  网页文本标为不可信资料；环境提示词要求忽略网页中的指令。
- 配置即时作用于下一次请求：timeoutMs 默认30000；count 默认5；maxContentChars 默认16000个Unicode字符。
  搜索正文每条裁剪并标contentTruncated；抓取可分页。续读会再次请求远端，可能再次计费且网页可能变化。
- 响应体上限8MiB，无自动重试。取消、停用World会中止在途请求；远端已经完成的请求可能仍计费。
- 401检查密钥，402检查余额，403/404可能为抓取策略或网站限制，429/5xx稍后再试。错误不回显远端正文。

官方接口与计费依据（核对于2026-10-25）：
[使用指南](https://api-docs.deepseek.com/zh-cn/guides/search/)、
[Search Schema](https://api-docs.deepseek.com/zh-cn/api/search/)、
[Fetch Schema](https://api-docs.deepseek.com/zh-cn/api/fetch/)。
Search / Fetch 按成功且有结果的请求计费，当前各5元/1000次；实际以DeepSeek官方说明为准。

