# AI 无人机编导

在小镇中输入主题，或让 AI 即兴创作一份节目单，再由现有 Three.js 演出引擎播放。AI 仅生成受限 JSON 数据，不能运行代码、下载模型或控制真实无人机。

## 使用方式

1. 打开小镇中的 **AI 编导** 入口。
2. 选择「命题创作」并输入最多 400 字的主题，或选择「即兴创作」，可附加灵感方向。
3. 当前公网功能标注「开发中 · 仅供测试」，生成前需输入测试密码并确认。成功后查看章节、配色和总时长，点击「立即观看」。起飞、归航与熄灯由引擎自动补齐。
4. 可保存到本机，之后载入回放，不再调用模型。

当前版本仅供**个人观演**，不会广播给整个联机房间。它不是专业无人机飞控系统，不承诺现实飞行安全间距、可导出航线、自动配乐或配音。复杂人物、文字与任意物体的精准造型不在第一版能力保证内。

## 独立灯点与轮廓呈现

AI 演出用独立发光点组成图案，不用连续线条连接无人机。编译器按固定身份和约 0.9 个世界单位的视觉间距选择发光点，避免把整支机群挤进细线、眼睛或重叠轮廓；多余灯点平滑熄灯，但每架无人机仍保留自己的轨迹和起降位置。这个间距仅用于虚拟画面辨识，不是现实飞行安全标准。

AI 灯点使用紧凑亮核、有限小光晕和非叠加混色，不渲染运动拖线；原有精选演出的材质与拖尾不变。高低画质保留同一套固定身份及编队采样，低档螺旋也保留双链。既有本机节目会自动使用新渲染方式，无须重新生成或再次调用模型。

回归检查：`node --test tests/ai-drone-show.test.js tests/ai-drone-particle-spacing.test.js tests/ai-drone-particle-renderer.test.js`。同时应在真实后期处理下检查星形、圆环、鲸鱼、城市、自定义轮廓以及手机宽度，不能仅用无泛光的单元测试代替实屏验收。

## 服务端启用

运行环境与主项目一致：**Node.js 24.13.0 或更新的 24.x**。后端使用内置 `node:sqlite`，无须为此新增数据库依赖。

AI 编导默认关闭。收费能力必须由部署者主动启用并承担供应商费用。当前适配器复用服务端的 NPC DeepSeek 配置，固定使用模型标识 `deepseek-flash` 和 DeepSeek 官方 API 地址。模型标识以本适配器代码为准，不会根据宣传名称自动换模型或路由到其他供应商。

将以下配置写入本机私有 `.env`，不要提交真实密钥：

```dotenv
# Both switches are required by the shared server-only provider configuration.
AI_DRONE_ENABLED=true
NPC_LLM_ENABLED=true
NPC_LLM_API_KEY=
NPC_LLM_BASE_URL=https://api.deepseek.com/v1
NPC_LLM_MODEL=deepseek-flash

# Durable private SQLite file, relative to the process working directory.
AI_DRONE_DB=.data/ai-drone.sqlite

# Explicit 0 disables only the guest daily / IP daily count caps.
# If omitted or invalid, conservative defaults remain 5 / 30.
AI_DRONE_DAILY_LIMIT=0
AI_DRONE_IP_MINUTE_LIMIT=3
AI_DRONE_IP_DAILY_LIMIT=0

# Development access gate. The server stores a salted scrypt hash, never plaintext.
# Supply a privately generated hash; do not commit it or place it in VITE_* variables.
AI_DRONE_ACCESS_REQUIRED=true
AI_DRONE_ACCESS_PASSWORD_HASH=
```

只在本机私有配置中填写自己的 `NPC_LLM_API_KEY`。现有 `npm run dev` 和 `npm start` 不会自动加载 `.env`，需显式启动：

```bash
npm ci
node --env-file=.env scripts/dev.mjs
```

生产运行先构建，再启动：

```bash
npm run build
node --env-file=.env server/index.js
```

`NPC_LLM_ENABLED=true` 同时启用项目原有的 NPC 文字聊天；它有独立的费用和限流设置。若只希望启用无人机编导而关闭 NPC 聊天，需要先拆分服务端配置，不能假定上述设置只影响编导。

其他可选配置沿用项目已有的 `GUEST_SECRET`、`ALLOWED_ORIGINS`、主机与端口设置。公开部署应配置稳定的游客签名密钥、HTTPS、可信反向代理和持久化私有数据目录；不要为绕过跨域或限流直接信任任意客户端的代理头。子路径部署的客户端 API 使用 `appUrl`，前端构建 base 与服务器路由前缀须一致。

设置 `AI_DRONE_ENABLED=false` 并重启后端即可关闭新生成。关闭或配置缺失时，界面明确显示未开放，**不会伪造 AI 节目**；已有本机节目仍可载入回放。

## 开发中测试门禁

公网在功能验收完成前启用服务端密码门禁。界面显示「开发中 · 仅供测试」，命题和即兴都必须通过校验后才开始编排；已有本机节目的回放不调用模型，不需要测试密码。

`AI_DRONE_ACCESS_REQUIRED=true` 时必须提供有效的 `AI_DRONE_ACCESS_PASSWORD_HASH`。它的格式为 `scrypt1$<32位十六进制盐>$<64位十六进制摘要>`，固定参数 N=16384、r=8、p=1、输出 32 字节。缺失或格式错误时仅 AI 生成功能关闭，不允许静默退回无门禁状态。默认不启用门禁仅用于兼容自主部署；公网应同时检查状态接口的 `accessRequired`、`development` 和 `enabled`。

密码仅临时保留于创作面板的组件内存，经 HTTPS 发送给本站服务端校验，不保存进浏览器存储、节目、数据库、日志，也不发送给 DeepSeek。服务端异步 scrypt 后使用固定时间摘要比较；错误验证有独立短时限制，且在预占请求、调用模型、重放服务器结果之前执行。密码不是游客签名的替代品，同源和游客身份验证仍保留。

不要把明文密码或其摘要放进源码、构建产物、截图、测试夹具或开源仓库。摘要在服务器现有受保护的运行时配置中保存；需要轮换时生成新盐和摘要并更新私有配置。错误密码不会产生模型调用，也不会消耗生成请求计数；客户端不自动重试。

## 生成次数、并发与失败语义

本项目公网版本已取消游客每日次数与同 IP 每日次数上限。部署者可通过上面的两个显式 `0` 启用不限次；未配置时仍使用下表中的保守默认值：

| 项目 | 默认值 |
| --- | --- |
| 每位游客每天 | 5 次，北京时间 00:00 重置 |
| 同一 IP 每分钟 | 3 次 |
| 同一 IP 每天 | 30 次 |
| 全服务同时编导 | 2 个请求 |
| 同一游客同时编导 | 1 个请求 |
| 供应商请求时限 | 45 秒 |
| 客户端生成全链时限 | 60 秒，包含游客身份建立 |

前三项可通过上述环境变量调整。仅 `AI_DRONE_DAILY_LIMIT` 和 `AI_DRONE_IP_DAILY_LIMIT` 支持显式 `0` 表示不限次数；空值、负数、小数等无效输入不会意外关闭限制。每分钟请求频率仍须为正整数，全局与游客并发限制固定在服务端。界面读取服务状态，自动显示不限次数或实际有限额度，不再写死每日 5 次。不限次数并不代表不限瞬时请求速率，也不代表免费：部署者仍承担供应商费用，应设置供应商预算和告警。

服务端先原子登记请求，再开始模型调用。不限次模式仍保留请求计数、持久化幂等和并发保护，只跳过对应的每日总数检查，不清空历史数据库。有限模式中，已开始的请求即使超时、取消、返回无效 JSON 或服务重启，也计入使用量。浏览器的取消按钮会中断等待并向后端传播取消，但不能保证供应商未产生费用。

请求以游客身份和 UUID `requestId` 做持久化幂等处理。同一请求号不会再次调用供应商；重复取回已完成请求返回 `replayed: true`，复用请求号但更换主题会被拒绝。客户端不会自动重试收费请求，401 也不会自动重新建身份并重发。

请求账本存于 SQLite，服务重启不会自然归零。默认数据库位于私有 `.data/`，不得放进静态资源目录或提交到 Git。当前版本没有自动历史清理任务；运营者需规划私有访问权限、备份和保留策略，不应随意删除账本来“修复”额度。

## 接口契约

以下路径相对于应用 base。接口使用同源请求，后端会校验游客签名；模型密钥不发送给浏览器。

| 接口 | 用途 |
| --- | --- |
| `GET /api/drone-director/status` | 查询是否启用、模型及限制；不建立游客、不调用模型 |
| `POST /api/guest` | 首次生成时建立游客身份，客户端存入独立 `sessionStorage` 项 |
| `POST /api/drone-director/usage` | 请求体 `{ "token": "当前游客签名凭据" }`；只读查询额度 |
| `POST /api/drone-director/generate` | 请求体含 `token`、`requestId`、`mode`、`prompt`；启用门禁时另传 `accessPassword`，只用于本站验证 |

`mode` 为 `prompt` 或 `improv`。命题需要非空主题，即兴可留空。成功响应结构：

```text
{
  show: { id, createdAt, mode, prompt, provider, model, score },
  usage: { limit, used, remaining, resetAt },
  replayed: false
}
```

`createdAt` 和 `resetAt` 均为 Unix 毫秒时间戳；`resetAt` 是服务端计算的下一次北京时间零点。使用量接口返回 `{ usage }`。失败返回安全错误码、中文说明、`charged`、`replayed`，可包含 `usage`；不能把 `charged: false` 理解为“供应商的最终账单已核验”。

不限次时，使用量结构为 `{ unlimited: true, limit: null, remaining: null, used, resetAt }`，其中 `used` 仍是当天真实登记次数，`resetAt` 只表示统计日切换，并非等待额度恢复。状态接口顶层返回 `unlimited: true, limit: null`；`limits.daily` / `limits.ipDaily` 保留配置值 `0`。有限配置保持原使用量格式。客户端先读取状态，即使本标签页仍缓存旧的剩余 0 次，也不会在已切换不限次后锁住生成按钮。

门禁状态只公开布尔值 `accessRequired` 和 `development`，不公开摘要、盐或密码。错误密码返回 `AI_DRONE_ACCESS_DENIED`（403）；错误验证过快返回 `AI_DRONE_ACCESS_RATE_LIMIT`（429）。这些拒绝发生在模型调用和使用量登记之前。

模型输出不保证每次合规：格式校验失败时不会启动演出，也不会偷偷重试。界面明确区分格式不合规、上游失败和超时，不把取消次数限制当作放宽节目安全校验。运维排查只记录限定枚举的失败阶段/原因及完成时间，不记录原始模型响应或凭据。旧失败记录可能缺少结束时间，不能用响应头耗时或超时租约推算完整生成耗时。

客户端在有限配置的重置时刻、标签页重新可见时刷新状态，也提供手动状态检查。这些只读操作不触发模型生成；无限模式不展示剩余次数、午夜恢复或扣次提示。本机节目库的 5 份是浏览器存储上限，不是生成次数限制。

## 生成反馈

点击生成后立即显示真实阶段（连接身份、AI 编排、准备舞台）和已等待秒数，不显示推算的完成百分比。耗时较长时会提醒可以取消，客户端整次请求最多等待 60 秒。生成中尚未取得最新额度时，不再显示“生成前不调用模型”。成功与失败都会将反馈区带到可见位置；成功后可直接点“立即观看”，无需先翻完分幕说明。成功不会自动播放，也不会自动重试失败请求。

## JSON 与渲染边界

`shared/aiDroneScore.js` 是服务端与客户端共用的严格校验器。成功返回独立、深冻结的规范化节目；失败不启动演出。它拒绝未知字段、无效枚举、非有限数值和不支持的版本，不使用 `eval`、`new Function` 或动态资源 URL。

服务端在严格校验前，仅对形状、运动和转场做最多 7 幕 × 3 字段的大小写/首尾空白规范化，以及少量语义明确的别名映射（如 `circle → ring`、`rotate → turn`、`pulse → breathe`、`fade → morph`）。不会把任意未知形状替换成默认图形，不修改 renderer 的允许范围，不增加模型调用。枚举拒绝仅记录固定 `field` 和 0–6 的 `sceneIndex`，不存原始拒绝值。

沿用现有 Chat Completions `json_object` 接口；它保证 JSON 形式而不是应用枚举，不能把格式化输出等同于业务校验通过。参见 [DeepSeek Chat Completions 官方接口](https://api-docs.deepseek.com/api/create-chat-completion/)。

节目结构示例：

```json
{
  "version": 1,
  "title": "山海相逢",
  "synopsis": "飞鸟越过山峦，鲸鱼游向星海。",
  "seed": 2026,
  "scenes": [
    { "name": "群山醒来", "description": "山峦在暖金色中呼吸。", "shape": "mountain", "color": "#FFD38C", "accent": "#FFF1CE", "duration": 12, "motion": "breathe", "transition": "morph" },
    { "name": "飞鸟过海", "description": "蓝色飞鸟轻轻起伏。", "shape": "bird", "color": "#77CCFF", "accent": "#FFFFFF", "duration": 12, "motion": "wave", "transition": "sweep" },
    { "name": "鲸游星海", "description": "鲸鱼缓缓转身。", "shape": "whale", "color": "#70B8FF", "accent": "#C0E8FF", "duration": 12, "motion": "turn", "transition": "morph" },
    { "name": "相逢之环", "description": "灯光重聚成温暖的环。", "shape": "ring", "color": "#FFD38C", "accent": "#FFFAE8", "duration": 12, "motion": "still", "transition": "burst" }
  ]
}
```

主要边界：

- 4–7 幕，每幕整数 8–18 秒；这些时长不包含引擎自动加入的起飞和回收。
- `shape`：`ring`、`sphere`、`heart`、`star`、`galaxy`、`helix`、`flower`、`bird`、`whale`、`mountain`、`city`、`outline`。
- `motion`：`still`、`turn`、`breathe`、`wave`；`transition`：`morph`、`sweep`、`burst`。
- 颜色仅接受 `#RRGGBB`；`seed` 是 1–2147483647 的整数，相同节目可确定性回放。
- 仅 `outline` 可附加二维 `paths`：最多 6 条折线，每条 2–24 个点，总计最多 120 点，坐标范围 `[-1, 1]`。
- 节目最多 32 KiB；供应商整个响应最多 64 KiB。不是任意 3D 模型生成接口。

编导面板和几何编译器按需懒加载。首屏不需要为尚未打开的 AI 创作面板解析全部造型代码；加载预算脚本校验实际构建依赖图，不能用它代替真实设备帧率测试。

## 本机保存与隐私

本机节目库最多保留 5 份，保存第 6 份会替换最早保存的一份。只保存经过校验的节目和 `id`、创作模式、创建/保存时间，不保存模型密钥、游客凭据或完整接口响应。损坏、过大或旧版本数据会被安全跳过；浏览器存储不可用时会明确报错，不假称保存成功。

游客签名凭据单独保存在 `sessionStorage`，同一标签页刷新不会主动更换身份；凭据过期或被服务端拒绝后，下一次主动生成才重新建立身份。它不是跨设备账号，也不能替代账号级防滥用机制。

主题会发送给 DeepSeek，不要填写隐私。服务端为幂等、额度和结果取回保存游客标识、请求记录、带服务端随机盐的 IP 摘要、成功节目及其主题，以及安全错误结果。节目库删除仅删除浏览器副本，不代表删除供应商或服务端历史。

## 验证

以下命令不需要模型密钥，不会产生供应商费用：

```bash
node --test tests/ai-drone-*.test.js
npm run check:readability
npm run build
node scripts/check-loading-budget.mjs
```

运行真实生成之前应单独确认费用预算。验收至少包含命题与即兴、取消/超时、服务关闭、不限次跨过旧每日阈值、有限配置兼容、短时限流和并发、本机保存回放、桌面与约 390px 手机宽度。单元测试、静态字号检查和构建通过都不等于真实浏览器视觉验收通过。
