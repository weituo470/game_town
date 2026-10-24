# 雾岬岛

自然海岸岛位于世界坐标 (280,120)，约220×170米。渲染、多人服务端和喷气物理共用 shared/realistic-island.js 的高度场。

运行 npm install、npm run build 与 npm start 后，访问本机服务的 ?landmark=realistic-island。可从小镇地图观景或登岛；WASD移动，空格跳跃/长按喷气，H悬停，右键环视。包含鸟瞰、海岸、步道三机位，支持日夜预览与手机布局。原创程序化地形、细叶植被、岩石、木栈道按项目MIT提供；没有新增外部下载场景包。

检验：node --test tests/realistic-island*.test.js。小镇、海面、天空、人物和联机房间均不切换。
