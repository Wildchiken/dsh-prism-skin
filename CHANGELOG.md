# 更新记录 · Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。0.3.1 及以前的版本都没有发布过，只在本地测试和桌面版实测中使用。

All versions up to 0.3.1 were never published; they were used only for local testing and on the desktop app.

## [0.7.0] - 2026-11-08

### 新增

- 示例主题 Material 3（`themes/material-3.json`）：配色用 Material 动态取色跟着强调色变；组件尺寸、圆角、状态层、动效照 material-web 和安卓 16 设置页（AOSP SettingsLib）；宿主的图标全部换成 Material Symbols；Google Sans 字体（要本机装了才有）。生成脚本在 `themes/src/`。
- Material 动态取色：主题文件和「我的主题」可以带 `material` 字段，写「宿主变量 → Material 3 配色角色」的对应关系（例如 `"--dsw-alias-bg-base": "surface"`、`"--m3-hover": "onSurface/8"`）。选中这样的主题时，棱镜用 Google 官方的 material-color-utilities（Apache-2.0）按当前强调色现算整套配色，换强调色整套跟着变，和安卓的 Material You 一样。可选方案：tonal（安卓默认）、vibrant、expressive、fidelity、content、neutral、monochrome、rainbow、fruit-salad；规格 2021 或 2025。
- 当前主题带 Material 动态取色时，侧栏面板里直接出一排强调色。
- 按压位置：主题在要出涟漪的元素上写 `--prism-ripple: 1`，按下时棱镜在这个元素上写 `--prism-x` / `--prism-y`（按下点相对元素左上角的距离），主题的伪元素用 `left: var(--prism-x, 50%)` 就能从按下的地方扩散，像安卓的水波纹；键盘触发时没有坐标，从中心开始。
- `scripts/audit-theme.mjs`：主题体检。在隔离的真宿主里用会调工具的假模型造一段对话，逐个画面（对话、轨迹、插件、各个菜单、右侧栏、设置每一页）亮暗各看一遍：同一个元素有无主题时比较折行、截断、消失、重叠，主题下查对比度、圆角档位、图标和字体，再逐个元素悬停看会不会动。中英文界面都能跑（`--locale`）。

### 改动

- 变量覆盖的单个值上限从 400 字放宽到 1024 字：主题换图标时要把整条图标路径写进变量，Material Symbols 里齿轮、太阳、分享这类复杂图标压缩后仍有 400～650 字。
- 示例主题赛博朋克 HUD：未选中的标签页文字对比度从 4.41 调到 4.5 以上；亮色下轨迹页「助手」标签改用正文色（原来 3.2:1）。生成脚本收进 `themes/src/cyberpunk-hud.mjs`。
- 去掉悬停预览（设置页主题画廊、侧栏面板的主题圆点、代码配色）：悬停会把整套界面换掉，带字体、图标、尺寸的主题一换，鼠标下面的东西跟着移动，鼠标就落到另一个主题上，来回闪。现在点了才换，悬停只显示名字。拖动滑块时的实时预览保留。
- 自定义 CSS（包括主题自带的）上限从 8192 字符放宽到 16384：带完整设计语言的主题（比如 Material 3）8192 不够用。
- 客户端分块合计的体积上限从 160 KB 放宽到 260 KB（实际 246 KB）：多出来的是官方配色算法，只在按需加载的设置分块里，开机加载的入口仍在 25 KB 以内。host 半改成去空白、简化语法（函数名不改），出问题时堆栈还看得懂。
- 官方配色算法打包了一份进 `src/vendor/`（`node scripts/vendor-mcu.mjs` 生成），许可证全文在 `licenses/`，随包发布。

### Added

- Example theme Material 3 (`themes/material-3.json`): colors follow the accent through Material dynamic color; component sizes, shapes, state layers and motion follow material-web and the Android 16 settings app (AOSP SettingsLib); every host icon is replaced with Material Symbols; Google Sans fonts (if installed). The generator lives in `themes/src/`.
- Material dynamic color: theme files and My themes can carry a `material` field that maps host variables to Material 3 color roles (e.g. `"--dsw-alias-bg-base": "surface"`, `"--m3-hover": "onSurface/8"`). When such a theme is selected, Prism computes the whole palette from the current accent with Google's material-color-utilities (Apache-2.0); changing the accent recolors everything, like Material You on Android. Schemes: tonal (Android default), vibrant, expressive, fidelity, content, neutral, monochrome, rainbow, fruit-salad; spec 2021 or 2025.
- When the current theme uses Material dynamic color, the sidebar panel shows a row of accent swatches.
- Press position: a theme marks ripple elements with `--prism-ripple: 1`; on press, Prism writes `--prism-x` / `--prism-y` (the press point relative to the element's top-left corner) on that element, so a pseudo-element with `left: var(--prism-x, 50%)` spreads from where you pressed, like the Android ripple. Keyboard activation has no coordinates and starts from the center.
- `scripts/audit-theme.mjs`: a theme audit. It seeds a conversation in an isolated real host with a mock model that calls tools, then walks every screen (chat, trajectory, plugins, each menu, right sidebar, every settings page) in light and dark: the same element with and without the theme is compared for wrapping, truncation, disappearing and overlap; under the theme it checks contrast, corner radii, icons and fonts; then it hovers every element to see whether anything moves. Runs on the Chinese or English UI (`--locale`).

### Changed

- A single override value can now be 1024 characters (was 400): themes that replace icons put the whole icon path into a variable, and complex Material Symbols (settings gear, sun, share) are still 400–650 characters after compression.
- Example theme Cyberpunk HUD: unselected tab labels go from 4.41 to above 4.5 contrast; in light mode the trajectory "Assistant" tag uses the body text color (was 3.2:1). Its generator now lives in `themes/src/cyberpunk-hud.mjs`.
- Hover preview is gone (settings gallery, sidebar panel theme dots, code colors): hovering swapped the whole interface, and with themes that change fonts, icons and sizes the content moved under the pointer, landing it on another theme and flickering back and forth. Themes now change on click; hovering only shows the name. Live preview while dragging sliders stays.
- The custom CSS limit (including a theme's own CSS) goes from 8192 to 16384 characters: themes with a full design language (like Material 3) need more than 8192.
- The size limit for all client chunks goes from 160 KB to 260 KB (actual 246 KB). The extra is the official color algorithm, only in the lazily loaded settings chunk; the startup entry stays under 25 KB. The host half is now whitespace- and syntax-minified (names kept), so stack traces stay readable.
- A copy of the official color library is bundled into `src/vendor/` (generated by `node scripts/vendor-mcu.mjs`); its full license is in `licenses/` and ships with the package.

## [0.6.0] - 2026-11-07

### 新增

- 「我的主题」可以改名：选中后在设置页顶上点「改名」。
- 删除「我的主题」后，画廊上方会出现「撤销」，8 秒内点一下就放回原位（删之前正在用的会重新选上）。
- 省电生效时，`body` 上标出 `data-prism-saving`（值是原因：manual / transparency / battery），主题自带的 CSS 可以据此停掉动画。赛博朋克 HUD 已经用上。
- `scripts/check-theme.mjs`：在隔离的真宿主里检查主题文件依赖的宿主选择器还能不能匹配，DSH 升级后先跑一遍。

### 改动

- 悬停预览主题时连同它自带的 CSS 一起预览，和点下去看到的一样（以前只预览配色）。

### Added

- My themes can be renamed: select one and click Rename at the top of the settings page.
- After deleting a My theme, an Undo button above the gallery puts it back for 8 seconds (reselecting it if it was in use).
- While power saving is active, `body` carries `data-prism-saving` (the reason: manual / transparency / battery), so a theme's own CSS can stop animations. The Cyberpunk HUD uses it.
- `scripts/check-theme.mjs` checks, on an isolated real host, whether the host selectors a theme file relies on still match; run it after a DSH upgrade.

### Changed

- Hover previews now include the theme's own CSS, matching what you get on click (before, only colors were previewed).

## [0.5.1] - 2026-11-07

### 修复

- 中文界面里「我的调整」「高级覆盖」、存为我的主题、导入导出一共 11 处说明文字显示成了英文。加了单元测试：中文文案里出现整句英文会报错。
- 在「宿主默认」上「存为我的主题」，选回来时沿用宿主自己的配色（以前会换成和宿主接近的生成配色）。

### 改动

- 冒烟测试和截图脚本启动宿主时，主目录、用户名、时区、工作目录都换成临时的：宿主会把这些写进系统提示词，录素材时不能带出本机信息。本机假模型支持英文示例。
- README：横幅重画；示例主题的动图在完全隔离的环境里重录，英文版用英文对话；设置页、侧栏面板等截图换成 0.5 的界面。

### Fixed

- In the Chinese UI, 11 descriptions (My adjustments, Advanced overrides, Save as my theme, import/export) showed in English. A unit test now fails if a Chinese string contains an English sentence.
- A My theme saved on top of Host default now keeps the host's own palette when picked (before, it switched to a close generated palette).

### Changed

- The smoke and screenshot scripts start the host with a throwaway home directory, user name, time zone and working directory: the host writes these into the system prompt, and recordings must not leak local details. The local mock model can answer in English.
- README: redrawn banner; the example theme's animations were re-recorded in a fully isolated environment, the English one with an English conversation; settings and quick-panel screenshots show the 0.5 UI.

## [0.5.0] - 2026-11-07

### 新增

- 示例主题「赛博朋克 HUD」（`themes/cyberpunk-hud.json`，Release 里也有）：一个主题文件，靠变量覆盖和自定义 CSS 把侧栏、按钮、代码块、消息改成 HUD 框体，带扫描线和收敛的动画，系统开「减少动态效果」时停下。框体依赖宿主内部类名，宿主升级后可能要更新这个文件。
- README 重写：横幅和十套主题一览图由 `scripts/readme-art.mjs` 用配色引擎现算出 SVG，不再是一排截图；加上示例主题的动图、主题与修改的分层说明。

### 改动

- **主题是一整套**：导入的主题文件（含变量覆盖、自定义 CSS、圆角）带着名字存进新的「我的主题」，在画廊和侧栏面板里和内置主题并列。以前导入后只显示「自定义配色」，CSS 和覆盖还混在「高级覆盖」里，点「宿主默认」或「重置」界面看不出变化。
- **修改单独一层**：选任何主题（包括「宿主默认」）都整套换上，之前在上面做的修改（微调、圆角、变量覆盖、自定义 CSS）一起清掉，可撤销；对比度和明暗照旧保留。
- 设置页顶上新增当前主题条：主题名、「已修改」标记、「丢弃修改」「存为我的主题」「恢复默认」。去掉主题、我的调整、高级覆盖三处各自的「重置」按钮。
- 「恢复默认」清掉主题、修改和背景，回到宿主原样，可撤销；「我的主题」保留。
- 「我的主题」最多 24 个；卡片悬停时右上角可以删除，要点两次，删除不能撤销。存档新增 `library` 键，不进撤销历史；旧版看不懂这个键会原样保留。
- 侧栏面板显示当前主题名，改过时加「已修改」。
- 导出主题文件时带上主题自带的覆盖和 CSS；合起来超过 8192 字符时提示，不导出导不回来的文件。从 dream-skin 迁移的主题也带名字进「我的主题」。
- 客户端分块合计的体积上限从 150 KB 放宽到 160 KB（实际 155.6 KB）：多出来的在按需加载的设置分块里，开机加载的入口仍在 25 KB 以内。

### Added

- Example theme "Cyberpunk HUD" (`themes/cyberpunk-hud.json`, also attached to the release): a single theme file whose variable overrides and custom CSS turn the sidebar, buttons, code blocks and messages into HUD frames, with scanlines and restrained motion that stops under Reduce motion. The frames depend on host class names and may need an updated file after a host upgrade.
- README rewritten: the banner and the ten-theme overview are SVGs computed by `scripts/readme-art.mjs` from the color engine instead of a wall of screenshots; adds the example theme's animation and an explanation of themes vs. your changes.

### Changed

- **Themes are bundles.** An imported theme file (including variable overrides, custom CSS and radius) is saved with its name to the new My themes and shows up next to the built-in themes in the gallery and the sidebar panel. Before, an import showed only as "Custom", its CSS and overrides sat in Advanced overrides, and picking Host default or Reset left the UI looking unchanged.
- **Your changes are a separate layer.** Picking any theme, Host default included, applies the whole bundle and clears your changes on top (tuning, radius, variable overrides, custom CSS); undoable. Contrast and depth are still kept.
- A current-theme bar at the top of the settings page shows the name, a Modified marker, and Discard changes / Save as my theme / Restore defaults. The separate Reset buttons for theme, adjustments and advanced overrides are gone.
- Restore defaults clears the theme, your changes and the background; undoable; My themes are kept.
- My themes holds up to 24; hover a card to delete it from the top-right corner (two clicks, not undoable). The state file gains a `library` key that is not part of undo history; older versions keep unknown keys as they are.
- The sidebar panel shows the current theme name and marks it Modified when changed.
- Exported theme files include the theme's own overrides and CSS; if the combined CSS is over 8192 characters you get a message instead of a file that would not import back. Themes migrated from dream-skin keep their names in My themes.
- The size limit for all client chunks goes from 150 KB to 160 KB (actual 155.6 KB). The extra is in the lazily loaded settings chunk; the startup entry stays under 25 KB.

## [0.4.0] - 2026-11-07

首个公开版本。以下是发布前的准备；功能见 0.1.0 至 0.3.1 各节。

- `engines.dsh` 写成带显式预发布分支的范围 `>=0.2.1-rc.5 <0.2.2-0 || >=0.2.2-rc.1 <0.3.0-0`。宿主自己检查时本来就放行预发布版，这样第三方商店按默认规则检查时，也会把实测过的 0.2.2-rc.1 当作兼容。
- 补全 `repository`、`homepage`、`bugs`、`author`、关键词；`files` 只放运行和说明需要的文件，加上 `NOTICE`、`CHANGELOG.md`、英文说明。
- 中文 `README.md`、英文 `README.en.md`：安装方法（GitHub Release 安装包、macOS 桌面版；暂未发布到 npm）、和 skin-center / claude-style 共存、已知限制。截图改成仓库绝对地址，并在临时环境里按当前界面全部重录。
- 新增 `NOTICE`（致谢 dsh-dream-skin，注明迁移用的 8 套内置主题颜色取自它）、`screenshots.json`（给插件市场详情页用）。

## [0.3.1] - 2026-11-07

- 导出主题文件、导出成 skin-center 皮肤之后只提示「已开始下载」。网页拿不到用户在「存储为」窗口里有没有点取消。
- 快捷面板底部改成说明文字。宿主没有让侧栏插件打开设置并定位到某一栏的接口，原来那行看着像链接却点不了。

## [0.3.0] - 2026-11-07

深度自定义。

- 字体：直接读写宿主「通用」里的字体设置（界面字体、代码字体、正文和代码字号）。
- 代码配色：GitHub、One、Solarized、Dracula、Monokai、Nord，可以独立于主题选，照样过对比度检查。
- 圆角倍数滑块。实测宿主约七成的圆角走变量，设置里写明了。
- 高级覆盖：按名字搜宿主全部变量，看当前值和来源，单个改、单个恢复；自定义 CSS（上限 8192 字，禁止 `@import`、外部 `url()`、`image-set()`），首屏不闪。
- 主题、我的调整、高级覆盖三层各自可重置，全部可撤销。
- 导入导出：种子 JSON 主题文件、分享码和分享链接；导入先整份校验，失败自动撤回。
- dream-skin 迁移（只读它的设置）和 dream-skin 主题包导入。
- 导出成 skin-center v2 皮肤（zip 下载）。

## [0.2.3] - 2026-11-07

- 侧栏快捷面板挂到页面最外层，不再被桌面版的会话列表盖住。

## [0.2.2] - 2026-11-07

- 省电模式：跟随系统 / 开 / 关。系统开「减少透明度」或电量低于 20% 且没在充电时，关掉玻璃，表面换成按壁纸算出的纯色；设置页写明原因。

## [0.2.1] - 2026-11-07

- 带壁纸滚动时的开销降下来：输入框改成纯色，不再每帧重绘。
- 悬停、按下状态下的文字对比度也要求 4.5:1；不够时先把悬停底色调淡，再调文字。

## [0.2.0] - 2026-11-06

壁纸与玻璃。

- 图片（选文件、拖入、粘贴链接）、渐变、纯色、链接轮播、文件夹轮播。
- 一根「玻璃感」滑杆管所有表面；图片只模糊一次，不开实时 `backdrop-filter`；对比度按壁纸最暗和最亮处计算。
- 从壁纸取色；系统「减少透明度」时自动关玻璃；窗口隐藏时暂停轮播。

## [0.1.0] - 2026-11-06

首个版本。

- 配色引擎：种子生成宿主全部颜色变量，亮暗成对，WCAG 和 APCA 对比度自动达标。
- 10 套主题、强调色、五个微调滑块、撤销历史。
- 首屏不闪；设置存在 host 文件里，多标签同步，重启换端口不丢。
- 设置页和侧栏快捷面板；检测到 skin-center、claude-style 时只提示。
