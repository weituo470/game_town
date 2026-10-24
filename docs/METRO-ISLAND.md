# 临湾都会

现代都市岛位于世界坐标 (20,-285)，约280×220米，24栋建筑，最高140米。shared/metro-layout.json 是Blender建模、道路、建筑碰撞和多人导航的唯一布局来源。

运行项目后访问 ?landmark=metro-island，从观景控制进入街区；WASD移动，空格跳跃/长按喷气，H悬停。低空不能穿楼，可飞越楼顶。三个观景机位、昼夜窗灯和10辆实例化车流沿用同一世界；reduced-motion停止车流。

已使用本机Blender 5.2离线制作原创GLB与贴图，并非通过Blender MCP操控。安装Blender后在仓库根目录运行：

~~~sh
blender --background --python scripts/build-metro-island.py
~~~

输出 public/metro-island/city.glb、city.blend 与 manifest.json。GLB 为局部Y-up，前端只平移一次 [20,0,-285]。生成器同步写 shared/metro-asset.json，使用模型SHA256前16位作为浏览器缓存版本。几何预算和许可见manifest；原创建模与生成贴图适用MIT，Blender自身软件许可证不等于模型许可证。

检验：node --test tests/metro-*.test.js。

## Editable project privacy

The pre-generated city.blend is intentionally not distributed because it contains local workstation metadata. The complete original generator is provided and creates an editable city.blend on your own machine. The runtime GLB, shared collision layout and original textures are included; this omission does not remove playable city geometry.
