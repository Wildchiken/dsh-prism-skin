# 更新记录 · Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。0.3.1 及以前的版本都没有发布过，只在本地测试和桌面版实测中使用。

All versions up to 0.3.1 were never published; they were used only for local testing and on the desktop app.

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
