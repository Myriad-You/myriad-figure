# Myriad figure

Myriad 的 2.5D 形象：在浏览器里演她的 rig 的运行时，和从分层的图做出一套 rig 的处理工具。

- **渲染层**：舞台（网格变形、头壳转头与关键形、头发和胸的物理、表情形状、WebGL 绘制、触摸命中、姿势）来自依赖 [`@myriad-you/figure-player`](https://github.com/Myriad-You/myriad-figure-player)（MIT），按提交钉在 `package.json` 里。本仓库只经它的入口取：`.`、`./workbench`，以及给表演系统和 rig 工具用的 `./internals`（不作稳定承诺）。
- **运行时**：`anime25drig/`（表演驱动：把行为、说话、唱歌、导演的姿势和触摸合成为每帧的驱动参数，交给舞台；播放器 `Anime25DPlayer`）、`motion/`（行为排程、表演、说话和唱歌时的身体、触摸）、`expressionShapes/`（特殊表情的形状）、`singing/`（音乐信号、节拍、歌词时间线）、`speech/`（韵律、口型、重音）、`interaction/`（触摸手势和反应）、`events/`（表演事件和表演契约）、`performance/`（表演类型、心情分档）。
- **处理工具**：`rig/`（PSD 与拆层导入、图集、骨骼、部件、补遮挡、转头和转身关键形的拟合与放置）。浏览器里导入在 Worker 里跑，画图集用 2D canvas；没有浏览器的地方（服务端）经 `rig/node` 跑同一套导入，画图用它自己的光栅。
- **通道、错误、记录**：`channel.ts`、`errors.ts`、`trace.ts`。形象没有页面级的状态：页面为它演的那一个形象建一个 `FigureChannel`，表演、说话、她的状态、对方在打字都派发在这条通道上，当前是哪一轮、她最后的状态也记在这里，再交给那个形象的运行时。报错是带错误码和参数的 `FigureError`，消息是英文兜底，页面按错误码换成自己的话。API 地址和一轮对话的记录（`FigureTrace`）由建播放器、协调器、运行时、导入的人在构造时给。

谁在用：[Myriad](https://github.com/Myriad-You/Myriad) 的站点以子模块 `figure/` 钉住本仓库，作为 pnpm workspace 包 `@myriad/figure` 引用。Myriad 的 macOS 原生 App 和 Android XR 端按钉住的提交照本仓库移植。

## 入口

外面只能经 `package.json` 的 `exports` 取，按用途分：

- `@myriad/figure`：通道、错误、记录（上面那三样）。
- 演她的页面用：`anime25drig`（播放器和它的驱动补丁）、`motion`（运行时、协调器、动作源、把一帧写到 rig）、`events`（表演和状态事件）、`speech`（说话事件、韵律、口型）、`singing`（音乐信号、歌词）、`interaction`（触摸）、`performance`（导演写给她、她回报的类型）、`rig`（导入、清单、诊断）。
- `workbench`：调 rig 的工作台才需要的（表情预设、姿势修正与它在屏幕上的位置、动作包络探针、表情与节拍词表、PSD 对账颜色、预览范围）。演她的页面不需要。
- `testing`：从外面驱动形象的测试用的夹具和零件。生产页面不用，随测试改。
- `rig/node`：在 Node 里做 rig，不要浏览器（没有 Worker、canvas、DOM）。`compileRigPsdInNode(psd, options)` 收拆层的 PSD 字节、它切自的那张肖像（PNG 或 JPEG 字节）和页面导入收的同样几样（表情重画、手势手臂、骨架、身形、转头关键形），给出页面导入给页面的那份结果（rig、图集和参考图的 PNG、诊断）。它引 Node 的模块，别的入口都不引它，站点的页面打包不会带上它。本仓库和 `@myriad/figure-player` 都按 TypeScript 源码发布，Node 里要经 `tsx` 之类的加载器跑，或者先打包。画出来的和浏览器的差多少见 `tests/browser/README.md` 的「Node 导入」。

入口列出的就是对外的全部，目录里别的文件都是内部的，可以随时改名、拆分。站点要用一个还没列出的东西，先在这里想清楚它属于哪个用途，再加进那个入口。

`performance` 的词表以核心的表演契约为准：每份词表在 `src/performance/vocabulary.ts` 里只写一次，类型由它推导，`vocabulary.contract.test.ts` 逐字对照契约。

## 姿势

一帧画面可以当数据取出来，之后原样画回去：录一段表演逐帧导出、慢放、按别的尺寸重画，或者把摆好的一个姿势存下来给别处用。

```ts
import { blendPoses, poseFromJSON, poseToJSON } from '@myriad/figure/anime25drig'

player.tick(1 / 60)
const pose = player.getPose() // 刚画的这一帧；还没画过是 null
const text = poseToJSON(pose!) // 存下来，数值一位不丢

const back = poseFromJSON(text)
player.renderPose(back) // 画它；不是这套形象的、缺了或坏了的返回 false，什么也不画
player.renderPose(blendPoses(poseA, poseB, 0.5)) // 相邻两帧之间
```

- 同一套形象（同一个包）的任何一个播放器画出来都逐像素相同，在同一台机器、同样的画布尺寸上；换浏览器或显卡一般也认、也画，抗锯齿这类细节会不同；切片或布在那里切得不一样的会被拒绝。换一套服装就不是同一套，`renderPose` 返回 `false`。重新导入过的包只要清单里的图层或手臂有变，也算另一套；只换了图的认不出来。
- `renderPose` 不动她自己的状态：下一次 `tick` 接着她原来的地方走（`tick(0)` 也会走一点）。每帧在 `tick` 的页面要先停下来，姿势才留得住。显示姿势的时候不接触摸和姿势修正。
- 尺寸由画布决定（`resize`，按素材大小和 `devicePixelRatio` 折算，最大到素材本身的两倍）。姿势里没有图，只有顶点和画法，取的时候多大都可以放大来画。
- `blendPoses` 是给很近的两帧用的（慢放、换帧率）：位置直线过渡；画的先后、手臂在哪个手势的图里、某一帧里看不见的层，这类不能过渡的取近的那一帧。
- 一个姿势的 JSON 大约 80–140 KB。逐帧存的话一分钟（60 帧）有几百 MB；长的表演隔帧存、画的时候用 `blendPoses` 补，或者压缩。
- `pose.driver` 是那一刻各驱动的值，只供读，不参与画。

## 共用核心

rig 契约和表演契约的源头在共用核心（[Myriad-You/myriad-core](https://github.com/Myriad-You/myriad-core)）的 `shared/` 里：核心的 Rust 从它们生成代码，她发给各端的表演指令也用这套词表。本仓库在 `contracts/` 带一份逐字节的副本，只读这份，不依赖 myriad-core，单独克隆就能装、能测。

副本不手改。契约在 myriad-core 里改，再在 Myriad 里跑 `scripts/extra/figure-contracts.sh sync` 拷过来；Myriad 的 CI 检查副本是 core 历史上出现过的某一版（core 可以单独往前升，但形象不能带一份核心没有过的契约）。本仓库常量与核心 Rust 源码的对照（行为词表、资源、心情分档）也在 Myriad 里检查，见那边的 `frontend/src/features/merope/figureCore.test.ts`。

## 驱动参数的名字

驱动参数（`Anime25DDriver`，`setTarget`、`getCurrent`、`inspect().driver` 等）用渲染层的名字：`headYaw`、`headPitch`、`headRoll`、`lidL`、`lidR`、`gazeX`、`gazeY`、`jaw`、`lipCurve`、`browLift`、`browTiltL`、`browTiltR`、`browTilt`、`bodyLean`、`torsoFollow`、`rearHairSway`。存下来和交换的格式按版本区分，规格见依赖的 `docs/format.md`：姿势 JSON 写版本 2，`driver` 用这些名字，版本 1（原来的键 `angleX` 等）也读；包的姿势修正的轴在版本 8 是 `headYaw`、`headPitch`、`lidCloseL`、`lidCloseR`、`jaw`，在版本 7 是 `angleX`、`angleY`、`eyeCloseL`、`eyeCloseR`、`mouthOpen`，读的时候按包的 `version` 换成前者。导入现在仍写版本 7（`buildAnime25DPlayback`），等所有读包的一方都认 8 再换；运行时和工作台里的 `PoseCorrection` 一律是版本 8 的轴，存回版本 7 的包之前用 `poseCorrectionsToV7` 换回去；表演契约有自己的词表（`headTurn`、`mouthOpen`、`browLift` 等身体控制），由 `directedPose.ts` 的 `BODY_CONTROL_DRIVERS` 对到驱动参数。表演内部的姿势来源（呼吸、环境动作、思考、唱歌的律动、表演偏移）也保留各自的键，合成时由 `poseArbitration.ts` 的 `POSE_KEY_DRIVER_FIELDS` 写到驱动参数上。

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

AGPL-3.0-only，见 [LICENSE](LICENSE)。`src/anime25drig/vendor/` 是 `src/anime25drig/upstream/`（导入和对照测试参照的 Anime2.5DRig）的 MIT 许可和说明。依赖 `@myriad-you/figure-player` 是 MIT，许可和第三方说明随它自己的仓库。
