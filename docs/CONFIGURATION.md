# 配置说明

## 1. 默认无密钥运行

首次运行只需 Node 24.13.0+（推荐 24.x）和 `npm ci`，然后 `npm run dev`。默认监听本机：页面 5173、API/联机 2567。

未提供服务密钥时，LLM 和合成人声会报告未配置；图片/3D 工坊还需要独立的启用开关及非零预算。固定 NPC 台词、移动、小游戏、演出与本地联机不需要付费服务。开源占位图与黑洞视觉不等同于原线上素材。

`node:sqlite` 可能输出实验性 API 提示；这本身不是服务启动失败。项目生成的 `.data/` 包含本地会话或工坊数据，不能提交或当作静态资源发布。

## 2. 环境文件不会自动加载

复制根目录 `.env.example` 为 `.env`：

```bash
# macOS / Linux
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

然后选择一个启动命令：

```bash
# 开发：Vite + 联机服务
node --env-file=.env scripts/dev.mjs

# 单服务：先 npm run build
node --env-file=.env server/index.js
```

`npm run dev` 和 `npm start` 本身没有 `.env` 加载器；不要只复制文件就认为配置已生效。已有进程环境变量优先于 `--env-file` 中的同名值，排错时也要检查当前终端环境。

## 3. 基础服务

| 变量 | 默认或示例 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 默认只允许本机访问。公开监听需自行评估网络安全。 |
| `PORT` | `2567` | Node API/联机端口；开发代理跟随此值。Vite 开发页面仍固定为 5173。 |
| `GUEST_SECRET` | 留空 | 留空时使用进程内随机签名，重启后游客凭据失效。持久化签名需要私下生成至少 32 字节的随机值。 |
| `ALLOWED_ORIGINS` | 逗号分隔本地来源 | 外部网页来源须显式添加；不要设置通配符。 |
| `TRUST_PROXY_LOOPBACK` | `false` | 只有确认可信本机反向代理拓扑后才启用。 |

不要使用公开示例字符串作为长期 `GUEST_SECRET`，不要把任何密钥放进 `VITE_*` 或客户端源文件。

## 4. NPC LLM 与合成人声（可选、可能收费）

### DeepSeek 对话

- 保持关闭：`NPC_LLM_ENABLED=false`。
- 启用时设置 `NPC_LLM_ENABLED=true`、`NPC_LLM_API_KEY`，并确认供应商账户和费用。
- 当前代码约束模型为 `deepseek-flash`，地址为 `https://api.deepseek.com/v1`；不是任意 OpenAI-compatible 路由器。
- `NPC_LLM_TIMEOUT_MS`、`NPC_LLM_MAX_TOKENS` 控制超时与回复长度。
- `NPC_LLM_DAILY_LIMIT` 为进程内 24 小时窗口请求限额，默认 500；不是自然日零点重置。重启会清空内存计数，请求计数也不等于供应商计费次数，不能作为账单硬上限。

### Doubao 合成人声

- 保持关闭：`NPC_TTS_ENABLED=false`。
- 启用时设置 `NPC_TTS_ENABLED=true`、`NPC_TTS_API_KEY`，并确保账户有对应音色/资源权限。
- 使用固定供应商 SSE 端点；`NPC_TTS_RESOURCE_ID` 默认 `seed-tts-2.0`，`NPC_TTS_TIMEOUT_MS` 默认 30000。
- NPC 配音依据角色配置分配。`NPC_TTS_SPEAKER` 是可选回退音色，不要用它替代角色身份匹配。
- `NPC_TTS_DAILY_LIMIT` 默认 500。对话打开时的自动问候、聊天回复播报均可能消耗调用额度；浏览器也可能要求用户手势才能播放声音。

**注意：`NPC_LLM_DAILY_LIMIT=0` 与 `NPC_TTS_DAILY_LIMIT=0` 表示无限额度，不是关闭。** 要关闭请用对应 `*_ENABLED=false` 并移除服务密钥。示例保留正数限额。

服务状态可通过 `/api/npc/chat/status`、`/api/npc/speech/status` 查看；状态为 enabled 不能代替真实生成或浏览器播放验收。

## 5. 图片与 3D 工坊（可选）

### 图片生成

默认 `GAME_IMAGE_ENABLED=false`、`GAME_IMAGE_DAILY_BUDGET=0`。本仓库只有桥接客户端，**不附带外部图片生成桥服务或其凭据**。

启用需要 `GAME_IMAGE_ENABLED=true`、正数 `GAME_IMAGE_DAILY_BUDGET`，以及自行运行的 `GAME_IMAGE_BRIDGE_URL` 和私有 `GAME_IMAGE_BRIDGE_TOKEN_FILE`。可用 `GAME_IMAGE_CONFIG` 指定自有 JSON 配置。不要把令牌文件放进 `public/` 或提交到仓库。

### Meshy 3D

默认 `GAME_CHARACTER_ENABLED=false`、`GAME_CHARACTER_TOTAL_BUDGET=0`、`GAME_CHARACTER_CREDIT_BUDGET=0`。启用需要自备 `MESHY_API_KEY`，开启开关并设置合理总次数和积分预算。图片到人物的完整流程还依赖图片工坊提供的输入。

代码中的每角色预估积分只是预算估计，不是供应商报价；启用前核对实际服务支持和价格。`GAME_IMAGE_DB` / `GAME_CHARACTER_DB` 可指定私有持久化数据库位置。

**与 NPC 限额不同，图片日预算 0、3D 总次数或积分预算 0 表示不接纳新的生成任务。** 不要把两种 0 值语义混用。

## 6. 三份 JSON 示例的作用

根目录提供安全的 `npc-llm.example.json`、`npc-tts.example.json`、`game-characters.example.json`，没有密钥或个人机器路径。需要时复制为对应的 `*.local.json`，或通过 `NPC_LLM_CONFIG`、`NPC_TTS_CONFIG`、`GAME_CHARACTER_CONFIG` 指向自有配置。

- LLM JSON 示例仅调节超时/回复长度，密钥仍使用 `NPC_LLM_API_KEY`；在 JSON 中增加任意 `apiKey` 字段不会被该加载器识别。
- TTS JSON 示例仅调节公开端点/资源/超时，密钥使用 `NPC_TTS_API_KEY`。
- 3D JSON 示例默认关闭且预算为 0，密钥使用 `MESHY_API_KEY`。
- LLM/TTS 的启停由环境变量控制，不要在这些 JSON 中自行添加 `enabled:false` 并误以为它会生效。

## 7. 可选 NPC 文案导入

正常启动不需要重新导入；仓库已有运行所需的公开 NPC 设定。维护者若有符合格式且获授权的自有角色配置，可显式指定目录：

```bash
node scripts/import-npc-personas.mjs ./my-personas
```

脚本没有个人机器默认路径，只导出白名单字段，目标是 `server/data/npc-personas.json`；运行会覆盖该生成文件，请先备份并审查自己的输入。缺少参数会失败，不会搜索本机素材。

## 8. 发布前检查

### AI 无人机编导

该可选功能默认 `AI_DRONE_ENABLED=false`，使用独立的每日额度账本。启用需同时提供有效的服务端 NPC DeepSeek 配置，并将 `NPC_LLM_ENABLED` 和 `AI_DRONE_ENABLED` 设为 `true`；这也会启用原有 NPC 文字聊天。新增生成默认每游客按北京时间每天 5 次，另有同 IP 与并发限制；本机载入回放不消耗次数。完整公开配置、接口、存储和限制见 [AI 无人机编导](AI_DRONE_DIRECTOR.md)。

### 公网检查

不要提交 `.env`、`*.local.json`、`.data/`、真实令牌、用户上传图片或供应商返回的私有素材。公网部署应额外设置 HTTPS、WebSocket 升级代理、可信来源、持久化签名、备份与供应商侧硬额度。原站的 SSH、Nginx、PM2 配置不属于本开源仓库。
