# Myriad figure

Myriad 的 2.5D 形象：在浏览器里演她的 rig 的运行时，和从分层的图做出一套 rig 的处理工具。

- **运行时**：`anime25drig/`（网格变形、头壳转头与关键形、头发和胸的物理、表情、嘴形、WebGL 渲染、播放器）、`motion/`（行为排程、表演、说话和唱歌时的身体、触摸）、`expressionShapes/`（特殊表情的形状）、`singing/`（音乐信号、节拍、歌词时间线）、`speech/`（韵律、口型、重音）、`interaction/`（触摸手势和反应）、`events/`（表演事件和表演契约）、`performance/`（表演类型、心情分档）。
- **处理工具**：`rig/`（PSD 与拆层导入、图集、骨骼、部件、补遮挡、转头和转身关键形的拟合与放置），PSD 解码在 Worker 里跑。
- **通道、错误、记录**：`channel.ts`、`errors.ts`、`trace.ts`。形象没有页面级的状态：页面为它演的那一个形象建一个 `FigureChannel`，表演、说话、她的状态、对方在打字都派发在这条通道上，当前是哪一轮、她最后的状态也记在这里，再交给那个形象的运行时。报错是带错误码和参数的 `FigureError`，消息是英文兜底，页面按错误码换成自己的话。API 地址和一轮对话的记录（`FigureTrace`）由建播放器、协调器、运行时、导入的人在构造时给。

谁在用：[Myriad](https://github.com/Myriad-You/Myriad) 的站点以子模块 `figure/` 钉住本仓库，作为 pnpm workspace 包 `@myriad/figure` 引用。Myriad 的 macOS 原生 App 和 Android XR 端按钉住的提交照本仓库移植。

## 入口

外面只能经 `package.json` 的 `exports` 取，按用途分：

- `@myriad/figure`：通道、错误、记录（上面那三样）。
- 演她的页面用：`anime25drig`（播放器和它的驱动补丁）、`motion`（运行时、协调器、动作源、把一帧写到 rig）、`events`（表演和状态事件）、`speech`（说话事件、韵律、口型）、`singing`（音乐信号、歌词）、`interaction`（触摸）、`performance`（导演写给她、她回报的类型）、`rig`（导入、清单、诊断）。
- `workbench`：调 rig 的工作台才需要的（表情预设、姿势修正与它在屏幕上的位置、动作包络探针、表情与节拍词表、PSD 对账颜色、预览范围）。演她的页面不需要。
- `testing`：从外面驱动形象的测试用的夹具和零件。生产页面不用，随测试改。

入口列出的就是对外的全部，目录里别的文件都是内部的，可以随时改名、拆分。站点要用一个还没列出的东西，先在这里想清楚它属于哪个用途，再加进那个入口。

`performance` 的词表以核心的表演契约为准：每份词表在 `src/performance/vocabulary.ts` 里只写一次，类型由它推导，`vocabulary.contract.test.ts` 逐字对照契约。

## 共用核心

rig 契约和表演契约的源头在共用核心（[Myriad-You/myriad-core](https://github.com/Myriad-You/myriad-core)）的 `shared/` 里：核心的 Rust 从它们生成代码，她发给各端的表演指令也用这套词表。本仓库在 `contracts/` 带一份逐字节的副本，只读这份，不依赖 myriad-core，单独克隆就能装、能测。

副本不手改。契约在 myriad-core 里改，再在 Myriad 里跑 `scripts/extra/figure-contracts.sh sync` 拷过来；Myriad 的 CI 检查副本是 core 历史上出现过的某一版（core 可以单独往前升，但形象不能带一份核心没有过的契约）。本仓库常量与核心 Rust 源码的对照（行为词表、资源、心情分档）也在 Myriad 里检查，见那边的 `frontend/src/features/merope/figureCore.test.ts`。

## 开发

```sh
git clone --recursive https://github.com/Myriad-You/myriad-figure.git
cd myriad-figure
pnpm install
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
```

在 Myriad 里，`frontend/` 的 `pnpm install` 会一起装好本仓库的依赖，`pnpm test:unit` 和 `pnpm typecheck` 也会跑本仓库的测试和类型检查。浏览器测试（`tests/browser/`：真实 Worker 导入、真实 WebGL 下的播放器、触摸、换装，以及只经公开接口的形象探针）在本仓库里用 `pnpm test:browser` 跑。探针在 CI 上用合成素材；设 `FIGURE_REAL_ASSETS` 指向本机的形象包目录，就同样在真实素材上跑，说明见 `tests/browser/README.md`。

本仓库 2026-10-31 带着历史从 Myriad 拆出来，之前的提交记录照原样保留（提交说明里的 `#数字` 指 Myriad 的 PR）。

## 许可

AGPL-3.0-only，见 [LICENSE](LICENSE)。`src/anime25drig/vendor/` 是运行时参照的 Anime2.5DRig 的 MIT 许可和说明。
