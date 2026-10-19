# 游戏小镇

一个可步行、跳跃、飞行和联机探索的 3D 网页小镇：通过小游戏体验认识玩家偏好，也可以观看无人机演出、游逛园区、与 NPC 交互。

开源版基于稳定版本 `20261018-055758`。为避免分发授权未明确的素材，NPC 图像和原黑洞着色器使用原创占位替代；**开源版与[线上演示](https://www.shenliu.cc/game-town/)并非完全相同画面**。这不是商业游戏、专业能力测评或心理诊断工具。

## 快速开始

使用 **Node.js 24.13.0 或更新的 24.x**，配套 npm。该项目使用 `node:sqlite`，不要仅按 Vite 的最低要求安装 Node 20。原稳定版本的验证环境为 Node 24.13.0 / npm 11.6.2。

```bash
git clone https://github.com/weituo470/game_town.git
cd game_town
npm ci
npm run dev
```

打开 <http://127.0.0.1:5173/>。此命令同时启动 Vite 页面和 `127.0.0.1:2567` 联机/API 服务；两个端口须空闲。

**不需要服务密钥即可游玩小镇、小游戏、演出和本地联机。** 没有配置时，NPC LLM、合成人声、图片生成和 3D 生成功能不可用；不会随仓库附带任何服务凭据。已有固定台词和本地资源不依赖模型调用。

构建并以单一服务运行：

```bash
npm run build
npm start
```

打开 <http://127.0.0.1:2567/>。`npm start` 需要已有 `dist/`；不要将开发用的 Vite 页面服务误当成完整生产后端。

## 主要功能

- 最多 8 人的小镇房间、邀请码加入、位置同步与断线恢复。
- 多种视角、跳跃、喷气飞行与悬停；昼夜循环和环境音效。
- 小游戏、玩家体验画像、NPC 活动与身份化对话接口。
- 无人机编队演出、编队第一人称观演、可探索园区和天空事件。
- 可选 AI 无人机编导：命题或即兴创作、章节预览、个人观演、本机保存与免费回放；默认关闭新生成。

常用操作：`WASD` 移动，地面 `Space` 跳跃、飞行时按住上升，`H` 切换悬停；视角及完整操作以页面提示为准。两人测试可在不同浏览器会话中创建、加入同一邀请码房间。

## 可选 AI 与配置

详见 [配置说明](docs/CONFIGURATION.md)。`.env.example` 默认关闭所有收费能力，服务密钥留空。

AI 命题 / 即兴演出的启用、每日额度、JSON 安全边界与使用限制见 [AI 无人机编导](docs/AI_DRONE_DIRECTOR.md)。模型仅生成受限节目数据，不执行代码，也不控制真实无人机。

复制为 `.env` 后，需要**显式加载**：

```bash
node --env-file=.env scripts/dev.mjs
# 或先完成构建，再运行：
node --env-file=.env server/index.js
```

现有 `npm run dev` / `npm start` 不会自动读取 `.env`。LLM、语音与生成服务由使用者自行申请、配置和承担费用；开启 NPC 合成语音后，打开对话的自动问候也可能产生调用。

## 检查

```bash
npm run test:ci
npm run check:opensource
npm run check:readability
npm run build
npm run check:loading
```

`test:ci` 使用串行测试进程，避免部分 Windows 环境中 Node 并发测试运行器的反序列化错误；`npm test` 保留并发执行方式。

字号静态检查不能代替真实桌面及约 390px 手机宽度验收；构建体积预算也不等于实测网络速度或 GPU 帧率。

## 目录与边界

`src/` 为 React/Three.js 客户端，`shared/` 为玩法与协议，`server/` 为 Node/Colyseus 服务，`public/` 为可分发资源，`tests/` 为回归检查。

本仓库不包含原站服务器配置、部署凭据、用户照片、数据库或内部发布记录。运行产生的 `.data/`、本地配置及密钥不得提交。公开部署还需自行配置 HTTPS、WebSocket 反向代理、持久化数据、来源限制和费用额度。

项目自有代码采用 MIT，见 [LICENSE](LICENSE)。依赖及第三方素材保留各自许可；MIT 不自动授予第三方角色、商标或素材权利。完整来源与范围见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，部署前请阅读 [安全说明](SECURITY.md)。
