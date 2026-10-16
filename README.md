# Canvas DevTools

一个使用 TypeScript 编写、零运行时依赖的 Canvas 2D 调试工具库。它可以嵌入任何网页，在页面内提供类似 Chrome DevTools 的 Canvas Inspector、绘制指令记录和逐帧性能分析。

## 安装

```bash
pnpm add -D canvas-inspector
```

工具应该只在开发环境加载，并且要在业务代码第一次调用 `canvas.getContext("2d")` 之前安装。

## 一行接入

Vite 项目可在应用入口最前面动态导入自动入口：

```ts
if (import.meta.env.DEV) {
  await import("canvas-inspector/auto");
}
```

`auto` 会安装全局探针并在页面底部挂载调试面板。面板关闭后可以通过右下角的 `C2D` 按钮重新打开。

## 程序化接入

```ts
import { installCanvasDevtools } from "canvas-inspector";
import { mountCanvasDevtools } from "canvas-inspector/panel";

const devtools = installCanvasDevtools({
  captureStack: true,
  autoFrame: true,
  maxEvents: 5000,
  snapshotInterval: 5,
});

const panel = mountCanvasDevtools({
  target: document.body,
  devtools,
  position: "bottom",
  height: 430,
});

panel.close();
panel.open();
```

`installCanvasDevtools` 会代理 `HTMLCanvasElement.prototype.getContext`，因此之后创建的所有 2D Context 都会自动进入 Registry。`requestAnimationFrame` 回调会被自动识别为帧边界。

## 只使用核心探针

不需要 UI 时，可以只检查一个 Canvas：

```ts
import { inspectCanvas } from "canvas-inspector/core";

const canvas = document.querySelector<HTMLCanvasElement>("#chart");
if (!canvas) throw new Error("Canvas not found");

const inspector = inspectCanvas(canvas, { captureStack: true });
const context = canvas.getContext("2d");
if (!context) throw new Error("2D context not supported");

inspector.beginFrame("chart-update");
context.fillRect(20, 20, 100, 60);
inspector.endFrame();

console.table(inspector.events);
console.table(inspector.frames);
console.table(inspector.getHotspots());
```

## 能力

- 自动发现页面中的 Canvas，显示缓冲区尺寸、CSS 尺寸、DPR 与上下文类型
- 记录路径、填充、描边、文本、图片、变换和状态调用
- 查看调用参数、Canvas 状态、耗时、推断包围盒和调用堆栈
- 自动按 `requestAnimationFrame` 分帧，统计 FPS、帧耗时与调用数量
- 定位慢帧、调用热点、高频重复绘制和指针交互
- Shadow DOM 隔离的 Inspector / Render / Profiler 嵌入式面板
- JSON 捕获导出 API

## API 入口

| 入口 | 用途 |
| --- | --- |
| `canvas-inspector` | 完整 API 与类型 |
| `canvas-inspector/core` | `inspectCanvas`、`CanvasInspector`、Canvas 发现 |
| `canvas-inspector/panel` | 可嵌入的 Shadow DOM 调试面板 |
| `canvas-inspector/panel.css` | 面板 CSS 资源；面板默认会自动加载 |
| `canvas-inspector/auto` | 自动安装探针并挂载面板 |

## 本地开发

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:4173`。示例业务是一个持续刷新的 K 线 Canvas，调试面板由公开 API 挂载，而不是示例页面的一部分。

示例页面只用于开发调试，不参与生产构建。`dev` 和 `build` 共用 `vite.config.ts`：开发命令以 `examples` 为站点根目录，构建命令只输出 npm 库到 `dist`。

```bash
pnpm check
pnpm typecheck
pnpm build
pnpm pack
```

项目使用 pnpm（版本由 `package.json` 的 `packageManager` 字段固定）。Biome 负责代码格式和静态检查；运行 `pnpm check:fix` 自动修复可修复的问题，或运行 `pnpm format` 只格式化代码。

## 当前限制

- 当前完整指令捕获只支持 `CanvasRenderingContext2D`；WebGL/WebGPU Canvas 只参与页面发现。
- 对已经在安装探针之前取得的 Context，浏览器没有可靠方式替换业务代码手里的原始引用，因此应尽早加载工具。
- 包围盒是根据参数和当前变换矩阵推断的；复杂裁剪区域、`Path2D` 和曲线极值不会做精确几何求解。
- 为降低探针对性能的影响，同一种 Canvas 方法默认复用一次调用堆栈样本。

## License

MIT
