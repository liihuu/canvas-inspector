# Canvas DevTools

一个使用 TypeScript 编写、零运行时依赖的 Canvas 2D 调试工具库。它可以嵌入任何网页，在页面内提供类似 Chrome DevTools 的 Canvas Inspector、绘制指令记录和逐帧性能分析。

## 安装

```bash
pnpm add -D canvas-inspector
```

工具应该只在开发环境加载。推荐使用显式 `createDebugger()` 接入；也可安装全局发现探针。显式挂载支持业务提前取得的 2D Context 引用（提前缓存或绑定的原生方法不在捕获范围内）。

## 推荐：显式生命周期

```ts
import { createDebugger, mountCanvasDevtools } from "canvas-inspector";

const canvas = document.querySelector<HTMLCanvasElement>("#chart")!;
const debug = createDebugger({
  maxCommands: 10_000,
  maxFrames: 180,
  slowFrameMs: 16.7,
  captureArgs: true,
  captureState: true,
  captureStack: false,
  captureFrameSnapshots: false,
});

// attach 只关联 Canvas，不安装全局 Hook，也不开始录制。
const detach = debug.attach(canvas);
const panel = mountCanvasDevtools({ devtools: debug.registry });
const ctx = canvas.getContext("2d")!;
debug.start();
debug.beginFrame("chart-update");
ctx.fillStyle = "red";
ctx.fillRect(20, 20, 100, 60);
const [frame] = debug.endFrame();

console.table(debug.getCommands());
console.table(debug.getFrames());
console.table(debug.getStats());

// 回放到另一个 Canvas；第三个参数是命令的稳定 index，省略即回放整帧。
const replayCanvas = document.createElement("canvas");
const inspector = debug.getInspector(canvas)!;
const result = inspector.replayFrame(frame!.index, replayCanvas);
console.log(result.applied, result.warnings);

debug.stop(); // 解除方法 Hook，保留已有捕获数据；可再次 start。
detach(); // 解除这个 Canvas 的关联，可重复调用。
panel.destroy();
debug.dispose(); // 释放全部关联；之后不能再次 attach/start。
```

每个 Canvas 有独立的帧编号和容量上限；多画布场景可通过 `getInspector(canvas)` 查询指定画布。`beginFrame()` / `endFrame()` 应成对调用。手动绘制生命周期是可靠的帧边界；全局模式的 RAF 捕获仅把每个回调视为一帧，多个 RAF 回调不等于一个浏览器呈现帧。不要对同一个 Inspector 混用两种分帧方式。

面板点击左侧帧会切换到 Render，显示该帧的命令和独立回放画布。使用 Step 前后单步，点击命令回放到该调用，Full frame 恢复整帧，Live 返回全部实时记录。调查历史帧前建议暂停采集，避免有界缓冲区将其命令淘汰。

## 自动发现与全局接入

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

`installCanvasDevtools` 会代理 `HTMLCanvasElement.prototype.getContext`，因此之后创建的所有 2D Context 都会自动进入 Registry。`requestAnimationFrame` 回调会被自动识别为帧边界。全局发现应在业务第一次调用 `getContext()` 前安装；已经使用的 Canvas 可以通过 `devtools.attach(canvas)` 显式挂载。卸载使用 `uninstallCanvasDevtools()`，或自建 Registry 的 `uninstall()`。多个 Registry 共享全局 Hook，最后一个实例卸载时才恢复原始描述符；如果方法已被第三方替换，则不会覆盖第三方的方法。

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
- 显式分帧或按 `requestAnimationFrame` 回调分帧，统计调用间隔 FPS、帧耗时与调用数量
- 独立画布的基础指令回放、帧选择与前后单步
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
pnpm test
pnpm pack
```

项目使用 pnpm（版本由 `package.json` 的 `packageManager` 字段固定）。Biome 负责代码格式和静态检查；运行 `pnpm check:fix` 自动修复可修复的问题，或运行 `pnpm format` 只格式化代码。

## 模块与性能

- `debugger.ts`：显式生命周期与查询入口；`registry.ts`：自动发现、RAF Hook 与多画布管理。
- `hook-manager.ts`：按 Context 共享方法 Hook，保存属性描述符和原始方法，最后一个订阅者离开时清理。
- `buffer.ts`：固定容量环形缓冲区，单条插入/淘汰 O(1)，不重编号；查询返回保留数据的数组快照。
- `core.ts`：2D 采集适配、显式帧统计、热点与基础回放；`panel.ts`：仅通过这些 API 渲染 Shadow DOM UI。后续渲染器适配器可复用公开数据模型和面板，不应复用 2D 方法 Hook。

默认 `maxEvents=5000`、`maxFrames=180`、`captureArgs=true`、`captureState=true`、`captureStack=false`。快照默认每 5 帧生成一次 PNG；高频场景建议关闭 `captureFrameSnapshots`。每个 Context 的事件、帧、重复签名和交互记录均有数量上限，但单个图片资源和 PNG 的大小没有字节级上限。状态和参数采集可以独立关闭；关闭任一项后无法完整回放。重复检测仅针对当前保留命令，帧调用计数包括已淘汰的调用。

调用耗时只包围原生方法执行，不含状态复制、序列化和事件通知；帧耗时包含帧内的采集开销，不包含 endFrame 的 PNG 编码。FPS 取相邻 beginFrame 的时间间隔，不代表 GPU 耗时或浏览器实际呈现率。

`pnpm test` 会先构建，再运行生命周期、容量溢出、共享 Hook、回放和清理的 7 项测试。开发服务器的 `/browser-tests.html` 另外提供真实 Canvas 像素对比和可重复运行的开销基准。在本次浏览器环境中，5 组各 2,000 次 fillRect 的中位耗时为原生约 0.20 ms，开启参数与状态采集后约 22.00 ms（关闭堆栈/快照，容量 1,000），额外约 10.90 µs/调用。这只是本机测量，复杂路径、状态、图像和浏览器会显著影响结果。

## 当前限制

- 当前完整指令捕获只支持主线程 `CanvasRenderingContext2D`；WebGL/WebGPU Canvas 只参与页面发现，尚无 OffscreenCanvas/Worker 适配器。
- 在 Context 实例上包装方法能捕获已有 Context 引用；提前缓存/绑定的方法、直接调用原型方法和 Canvas 尺寸赋值无法捕获。`patchCanvas` 选项为兼容旧接入保留，当前不再需要替换 `canvas.getContext`。
- 回放从空白画布开始，支持保留帧内的常见原生方法、状态和 save/restore，不恢复之前帧遗留的像素、路径、裁剪和状态栈。命令遭淘汰时会返回警告，不宣称是完整帧。
- Path2D、渐变、Pattern、图片、视频与 Canvas 等资源保留活动引用；资源在捕获后变化会影响回放。JSON 导出用于诊断，不是可移植回放文件。
- 包围盒是根据参数和当前变换矩阵推断的；复杂裁剪区域、Path2D 和曲线极值不做精确几何求解。
- 同一种 Canvas 方法默认复用一次调用堆栈样本；这不是逐调用的完整源位置。

## License

MIT
