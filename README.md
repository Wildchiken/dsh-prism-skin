# 棱镜 dsh-prism-skin

中文 | [English](README.en.md)

DeepSeek Harness（DSH）的换肤插件。几个种子（色相、彩度、中性色调、对比度、明暗、强调色）生成整套配色，亮色和暗色成对出现，文字对比度自动达标。网页版和桌面版都能用。

![晨雾 · 亮色](https://raw.githubusercontent.com/Wildchiken/dsh-prism-skin/main/docs/screenshots/mist-light.png)

| 暖砂 · 暗色 | 深海 · 暗色 |
|---|---|
| ![暖砂暗色](https://raw.githubusercontent.com/Wildchiken/dsh-prism-skin/main/docs/screenshots/sand-dark.png) | ![深海暗色](https://raw.githubusercontent.com/Wildchiken/dsh-prism-skin/main/docs/screenshots/abyss-dark.png) |

| 图片壁纸 · 暗色 | 渐变壁纸 · 亮色 |
|---|---|
| ![图片壁纸暗色](https://raw.githubusercontent.com/Wildchiken/dsh-prism-skin/main/docs/screenshots/wall-image-dark.png) | ![渐变壁纸亮色](https://raw.githubusercontent.com/Wildchiken/dsh-prism-skin/main/docs/screenshots/wall-gradient-light.png) |

| 代码配色 Dracula · 暗色 | 高级：变量搜索编辑 |
|---|---|
| ![代码配色](https://raw.githubusercontent.com/Wildchiken/dsh-prism-skin/main/docs/screenshots/p3-code-dracula-dark.png) | ![高级](https://raw.githubusercontent.com/Wildchiken/dsh-prism-skin/main/docs/screenshots/p3-advanced-dark.png) |

| 设置 → 棱镜 | 侧栏快捷面板 |
|---|---|
| ![设置页](https://raw.githubusercontent.com/Wildchiken/dsh-prism-skin/main/docs/screenshots/settings-light.png) | ![侧栏面板](https://raw.githubusercontent.com/Wildchiken/dsh-prism-skin/main/docs/screenshots/panel-dark.png) |

十套主题的亮暗截图都在 [docs/screenshots/](docs/screenshots/)。截图都在临时环境里录制，用的是示例会话。

## 特点

- **整套重算**：一套主题覆盖宿主全部 224 个颜色变量（含 8 个 markdown、8 个 diff、11 个代码高亮变量），亮暗各一份。换强调色时，按钮、链接、气泡、选中态、代码高亮全部跟着重算。
- **怎么调都看得清**：每套主题逐对检查 258 组文字和背景，WCAG 和 APCA 两个标准都要过，不够就只调明度直到达标。悬停时的文字也按 4.5:1 要求。
- **首屏不闪**：已保存的配色在页面第一次绘制之前就生效，不会先闪一下默认的白色或黑色。重启服务、换端口后设置也不会丢。
- **轻**：开机只加载约 20 KB 的入口；配色引擎和设置界面约 91 KB，第一次打开设置页或快捷面板时才加载；壁纸处理约 5 KB、高级和导入导出约 32 KB，用到才加载。不开实时模糊，不挂整页的 DOM 监听。
- **壁纸和玻璃**：图片（选文件、拖进来、粘贴链接）、渐变、纯色、链接轮播、文件夹轮播，一根「玻璃感」滑杆管所有表面。图片只模糊一次，不开实时 `backdrop-filter`。文字对比度按壁纸上最暗和最亮的地方算，不够就自动降低透明度。一键从壁纸取色。
- **省电模式**：跟随系统 / 开 / 关。系统开「减少透明度」，或电量低于 20% 且没在充电时自动省电：关掉玻璃，表面换成按壁纸算出的纯色。设置页会写明省电是否生效、因为什么。
- **深度自定义**：
  - 字体和字号：和「通用 → 字体」是同一份设置。
  - 代码配色：可以单独选 GitHub、One、Solarized、Dracula、Monokai、Nord，对比度照样自动达标。
  - 圆角倍数。
  - 按名字搜宿主全部变量直接改，能看到当前值和来自哪一层。
  - 自定义 CSS：有大小上限，禁止 `@import` 和外部链接的 `url()`。
- **导入导出**：
  - 主题文件就是一小段种子 JSON。
  - 分享码很短，也能放进链接。
  - 一键从 dream-skin 迁移，兼容导入 dream-skin 主题包。
  - 导出成 skin-center 皮肤（下载 zip）。
- **能撤销**：主题 → 我的调整 → 高级覆盖，三层叠加，每层能单独重置，每一步都能撤销。悬停预览，点击才生效。

## 安装

需要 DSH 0.2.1-rc.5 及以上、0.3 以下。已在 0.2.1-rc.5（网页版）和 0.2.2-rc.1（网页版、macOS 桌面版）上实测。

从 GitHub Release 安装（目前还没有发布到 npm）：

```bash
dsh plugin --profile <名字> add https://github.com/Wildchiken/dsh-prism-skin/releases/latest/download/dsh-prism-skin.tgz
```

这个链接总是指向最新版。想固定某个版本，换成 `https://github.com/Wildchiken/dsh-prism-skin/releases/download/v<版本>/dsh-prism-skin-<版本>.tgz`，版本号见 [Releases](https://github.com/Wildchiken/dsh-prism-skin/releases)。

**macOS 桌面版**：先用 ⌘Q 完全退出 DeepSeek Harness，再用桌面版自带的命令行装到 `desktop` 配置，装完重新打开：

```bash
cd ~ && "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add https://github.com/Wildchiken/dsh-prism-skin/releases/latest/download/dsh-prism-skin.tgz
```

## 使用

- **侧栏底部「换肤」**：换主题、切明暗、随机一套、撤销。
- **设置 → 棱镜**：主题画廊、强调色、背景与玻璃、省电、字体、代码配色、微调滑块和圆角、高级覆盖（变量和自定义 CSS）、导入导出、对比度检查结果。
- 选「宿主默认」且不设壁纸时，插件完全让位，回到宿主自带的配色。

设置保存在 `$DSH_HOME/dsh-prism-skin/state.json`（默认 `~/.dsh/dsh-prism-skin/state.json`，权限 0600），壁纸存在同目录的 `wallpapers/` 里。浏览器的 localStorage 只做缓存，多个标签页之间实时同步。

## 和 skin-center、claude-style 共存

棱镜不用 `!important`，也不依赖宿主的哈希类名。它只通过宿主正式的主题接口（`overrideTokens`）改颜色变量。

skin-center 和 claude-style 会用自己的样式盖住这些变量。检测到它们正在生效时，棱镜只在设置页和快捷面板上提示，不去抢。想让棱镜的配色完整显示，请在 skin-center 里切回「官方默认」，或者停用 claude-style。

棱镜可以把当前配色导出成 skin-center 皮肤，在 skin-center 里用。

## 已知限制

- **圆角约三成改不到**：宿主约七成的圆角走 `--dsw-radius-*` 变量，会跟着「圆角」滑块变；其余约三成（多是 1–4px 的细节）写死在宿主样式里。棱镜不靠宿主的哈希类名去补。
- **桌面版之间分享用分享码**：分享链接里带的是当前地址，桌面版每次启动端口都不一样，所以链接在别的电脑上打不开。请复制分享码，在对方的「导入」框里粘贴。
- **字体改动不进撤销**：字体和字号写的是宿主「通用」里的设置，不在棱镜的撤销历史里；导入主题文件时带的字体也不能撤销（导入前的预览会写明）。
- **还没在桌面版上实测的**：真实窗口下的 GPU 占用、低电量自动省电（电池状态接口只在模拟电池上测过）、选本地图片作壁纸时的系统选择框。
- **快捷面板跳不到设置页**：宿主目前没有让侧栏插件「打开设置并定位到某一栏」的接口，所以快捷面板底部只写了一句说明，没有做成链接。
- **dream-skin 迁移不会一模一样**：主题按底色、强调色、明暗换算成种子，其余颜色重算并保证对比度。偏亮的暗色底（如 Nord）会更深一点，因为暗色表面有明度上限（保证白字 7:1）。
- **壁纸目录不会自动清理**：换下来的图片会一直留在 `wallpapers/` 里。
- Safari 和 Firefox 没有电池状态接口，在这两个浏览器里「跟随系统」只看「减少透明度」。

## 开发

```bash
npm install
npm test                 # 单测，含体积门和对比度审计
npm run build            # 产物在 lib/
npm run audit:contrast   # 逐套主题、逐套代码配色打印对比度审计
```

真宿主上的冒烟和截图需要一份本地安装的宿主（`npm install @deepseek-ai/dsh@<版本>`）：

```bash
node scripts/smoke.mjs --host <宿主目录> [--host <另一个版本>]
node scripts/shots.mjs --host <宿主目录> --extras --wallpapers --p3
```

两个脚本都用 `~/.dsh-prism-*` 作临时 `DSH_HOME`，用完删掉，不碰你自己的 `~/.dsh`。

改动记录见 [CHANGELOG.md](CHANGELOG.md)。

## 致谢

配色思路参考 dsh-dream-skin，见 [NOTICE](NOTICE)。

## 许可

[MIT](LICENSE)
