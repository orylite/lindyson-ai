# 首页商品视觉素材来源

> 本目录只保留来源记录与 `videos/manifest.json`。母版 PNG、Seedance 成片 MP4 和 Figma 导出的透明 PNG 体积约 25 MB，不进入代码仓库，存放在私有运维仓库的 `archive/landing-masters/`；网页实际使用的导出件在 `public/landing/`。

## 生成信息

- 生成日期：2026-07-26
- 生成方式：Codex 内置 ImageGen
- 使用范围：Lindyson AI 官网首页
- 通用限制：虚构商品、无品牌、无商标、无可读文字、无水印、无人物、无产品声明

## 素材组

- `beauty-source.png`：近黑摄影棚中的无品牌玻璃精华液母图。
- `beauty-campaign.png`：保留同一瓶型、材质与颜色，改为紫红和暖金电影广告环境。
- `fashion-source.png`：近黑摄影棚中的无品牌未来感运动鞋母图。
- `fashion-campaign.png`：保留同一鞋体结构与配色，加入电蓝和紫色速度光轨。
- `tech-source.png`：近黑摄影棚中的无品牌金属真无线耳机与充电盒母图。
- `tech-campaign.png`：保留同一产品形态与材质，改为冰蓝体积光广告环境。

广告图均由对应母图进行保真编辑，仅改变环境、灯光、氛围与构图。原始 PNG 保存在本目录；首页实际加载的 1024 × 1280 AVIF/WebP 位于 `public/landing/`，社交分享图为 1200 × 630 JPEG。

## Seedance 动态成片

- 生成日期：2026-07-26
- 供应商与模型：火山方舟 Seedance 2.0，模型 ID `doubao-seedance-2-0-260128`
- 生成规格：9:16、1080p、5 秒、无音频；每条视频都以对应广告图作为精确首帧
- 生成范围：美妆采用慢速环绕、暖金折射和紫红背景呼吸；鞋服采用低机位推进、电蓝光轨和地面微粒；消费电子采用精确环绕、冰蓝体积光和轻微视差
- 保真限制：固定原产品的结构、材质、颜色和轮廓，不增加人物、手、文字、商标、水印、重复产品或镜头切换
- 供应商任务：美妆 `cgt-20260726032941-6xzlt`、鞋服 `cgt-20260726032941-hlwp5`、消费电子 `cgt-20260726032941-gw9sp`
- 用量记录：每条 245,025 Token，三条合计 735,075 Token；本次直接生成没有创建用户任务、数字资产或积分流水
- 母版位置：`src/imports/landing-masters/videos/`，每条 1080 × 1920、约 5.04 秒
- 网页导出：`public/landing/*-campaign.mp4`，H.264、CRF 30、slow preset、720 × 1280、24 fps、无音轨、快速起播，总体积 1,471,510 字节（约 1.47 MB）；静态 AVIF/WebP 继续作为海报与减少动态回退
- 画面审核：三条成片均保持主体身份稳定，没有发现人物、可读文字、商标、水印、重复产品或明显结构变形
- 临时存储：供应商生成所用临时 TOS 对象已清理

精确提示词、任务 ID、文件大小和 SHA-256 记录在 `videos/manifest.json`，用于后续复现与资产审计。

## Figma 橙色 iPhone 17 Pro 样机

- 来源：Figma Community 文件 `iPhone 16 & 17 Free Mockup`，文件键 `g23GLe96N7igoYxiQNKTOS`。
- 受审节点：橙色外层 `2901:5295`、机身 `2901:5301`、屏幕 `2901:5307`、Dynamic Island `2901:5310`。
- 导出方式：在 Figma 内创建临时副本，隐藏原屏幕、锁屏界面和摄像区域后分别导出机身与 Dynamic Island；导出完成即删除临时副本，原社区文件未修改。Figma 导出把 `#e5e5e5` 画布烘进机身位图，网页母版随后只做确定性的背景透明化处理，不重绘机身。
- 透明母版：`figma/iphone17pro-cosmic-orange-shell.png`，650 × 1321，SHA-256 `26c15e5c62a0a9a13d6c594d22f34704682a9d6b1d285894620615b2f4aaccef`；`figma/iphone17pro-dynamic-island.png`，370 × 108，SHA-256 `38c61433d10260d7ca3b106c369941d8dba85e00430ef4522248c09cfd867c9b`。
- 网页导出：`public/landing/iphone17pro-cosmic-orange-shell.*` 与 `public/landing/iphone17pro-dynamic-island.*`，提供 AVIF、WebP 和 PNG 回退。
- 屏幕几何：相对机身左侧 `5%`、顶部 `2.082%`、宽度 `90%`、高度 `95.836%`；Figma 屏幕节点圆角为 `165px`（1170 × 2532），网页换算为 `14.102% / 6.517%` 并同时用于 `border-radius` 与 `clip-path`。Dynamic Island 相对机身左侧 `35.769%`、顶部 `3.596%`、宽度 `28.462%`、高度 `4.088%`；其 Figma 圆角为 `99px`（370 × 108），网页强制使用胶囊裁切。
- 使用边界：样机只用于首页英文 TikTok 发布预览；屏幕内香水视频与界面由 Lindyson AI 组合，不表示 Figma 作者、Apple 或 TikTok 为产品背书，也不表示真实 TikTok API 已完成发布。
