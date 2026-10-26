# cortico-world-deepseeksearch

Owner: `src/definition.ts`, `src/world.ts`, `src/client.ts`

为 Cortico World API 6 提供 DeepSeek 网页搜索与 Markdown 抓取；已在 Coopanion 0.2.10、0.2.11 做过干装载检查。
聊天模型不必是 DeepSeek，但须支持工具调用。

## 本地安装

1. 将仓库下载或克隆到自己的电脑。在 Coopanion 的 WebUI 打开「扩展」→ World →「手动安装」→「从本机目录安装」，选择包含本项目 `package.json` 的扩展目录。

2. 完全退出并重新启动 Coopanion。在「World」→「DeepSeek 网页搜索」→「密钥设置」中填写 API Key 并保存。
   输入框使用密码样式，保存后清空输入，只显示 `••••••••`；不会把已保存的完整密钥返回页面。
   密钥经宿主接口写入部署 `.env` 的 `CORTICO_DEEPSEEK_API_KEY`，下次请求生效；同名非空进程环境值按宿主规则优先。
   从0.1.1升级时，点击「迁移旧配置密钥」并确认，先备份已有 `.env` 和 `config.json`，写入成功后清空旧的 `apiKey` 字段。
   也可填写新密钥替换；空输入不会覆盖已保存值。旧明文配置不再用于请求。
   备份留在部署目录，仍可能包含旧密钥；确认迁移成功后由你决定如何保管。扩展不会自动删除备份或修改其他密钥。

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
- 两工具均经宿主 `secret('CORTICO_DEEPSEEK_API_KEY')` 现读密钥；固定官方端点、不跟随HTTP重定向。
- 搜索词、可选原始问题和目标URL发给DeepSeek；不会自动上传聊天历史、文件或其他World状态。
  网页文本标为不可信资料；环境提示词要求忽略网页中的指令。
- 搜索正文每条裁剪并标contentTruncated；抓取可分页。续读会再次请求远端，可能再次计费且网页可能变化。
- 响应体上限8MiB。取消、停用World会中止在途请求及重试等待；远端已经完成的请求可能仍计费。
- 401检查密钥，402检查余额，403/404可能为抓取策略或网站限制，429/5xx稍后再试。错误不回显远端正文。

## 检索配置（保存后下次请求生效）

| 配置 | 默认 | 可调范围及含义 |
|---|---|---|
| 默认搜索条数 count | 5 | 1～50，模型省略count时使用 |
| 最多搜索条数 maxCount | 50 | 1～50，同时限制默认值与模型指定值，超过时收敛并在回执标明 |
| 返回内容精细度 resultDetail | full | brief仅短摘要，summary仅长摘要，full保留短／长摘要及评分等原有字段 |
| 每条摘要最长字符 maxTextChars | 0 | 0不额外截断，1～100000分别限制短／长摘要，回执标明截断 |
| 搜索默认附带正文 includeContent | false | 模型省略need_content时使用；显式true/false可覆盖 |
| 正文每条／页最长字符 maxContentChars | 16000 | 1000～50000，搜索正文每条与抓取每页的上限 |
| 每次尝试超时 timeoutMs | 30000 | 1000～120000毫秒 |
| 失败重试次数 retries | 0 | 0～5，总尝试次数最多为1加该值 |

现有默认保持：5条／上限50、full完整摘要、摘要不额外裁剪、搜索不默认带正文、正文16000字符、超时30秒、重试0次。
字符长度按Unicode码点计算；精细度控制返回字段，不使用额外模型压缩或改写文本。抓取工具始终返回正文，不受摘要模式影响。
重试只针对网络错误、超时、HTTP408/429/5xx；401/402等其他4xx、无效JSON和响应过大不重试。
失败后按1、2、4、8、8秒等待，每次尝试重新计超时，最多5次重试；增加重试会增加总等待及潜在请求费用。

官方接口与计费依据（核对于2026-10-25）：
[使用指南](https://api-docs.deepseek.com/zh-cn/guides/search/)、
[Search Schema](https://api-docs.deepseek.com/zh-cn/api/search/)、
[Fetch Schema](https://api-docs.deepseek.com/zh-cn/api/fetch/)。
Search / Fetch 按成功且有结果的请求计费，当前各5元/1000次；实际以DeepSeek官方说明为准。

验证范围与已知限制见 [VALIDATION.md](VALIDATION.md)。干装载检查不能代替完整官方校验或真实联网验收。
