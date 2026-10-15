# 第三方资源说明

本项目的早期界面设计基于 Figma Make 产物演进，当前代码已使用真实 API 架构，并继续使用开源 UI 思路与少量示例图片资源。

- shadcn/ui 相关组件思想与基础能力遵循 MIT License。
- Unsplash 图片仅用于设计规范示例和 TikTok 发布界面的视觉占位，不作为真实业务数据。

正式启用对应 TikTok 发布能力前，应将占位图片和演示文案替换为自有素材或已授权素材。

## 火山引擎 Seedream 5.0 Pro 交互编辑教程

AI 图片工作区的“交互编辑教程”弹窗可以展示火山引擎官方教程中的演示媒体。这些媒体版权归火山引擎所有，没有再分发授权，**不随本仓库分发**；仓库里只保留下方的来源与校验记录。部署方如需展示，自行从官方地址下载并转码后放到静态目录（例如 `public/tutorials/`，该路径下的 `seedream-interactive-*` 已被 git 忽略），再设置 `VITE_SEEDREAM_TUTORIAL_MEDIA_BASE_URL=/tutorials`；未设置时弹窗只显示功能描述和官方教程链接。官方教程页面为 <https://docs.volcengine.com/docs/82379/2582774?lang=zh>。

原始素材：

- 视频 `edite-model.mov`：<https://arkdocs.tos-cn-beijing.volces.com/videos/image-generation/edite-model.mov>；2352×1134、25.838167 秒、34,479,664 字节；ETag `c1ec604c23956a5ee863f1532e589940`；原始 SHA-256 `49fdc39aba62792610826bc2ae53df308a8449e68708f17dd87752d89db9ca02`。
- 输入图 `image-20260711-161109-398.png`：<https://arkdocs.tos-cn-beijing.volces.com/images/image-generation/image-20260711-161109-398.png>；2374×1612、4,764,895 字节；ETag `c77c52c781a485b1e45747a94380ecbc`；原始 SHA-256 `04b520d2552c0e96c579bf0c624016b71808805a054c7d29c9c4287e1ce923e8`。
- 输出图 `edit-image.png`：<https://arkdocs.tos-cn-beijing.volces.com/images/image-generation/edit-image.png>；1824×2448、6,911,705 字节；ETag `bd6a3c014a8fd54e0a2a20785dc7a3bc`；原始 SHA-256 `c5daf863ed9f7a6edb72dbf7d97cffac707ce05a6f5e70668d9b3a204df2b617`。

本地成品（文件名固定，放在 `VITE_SEEDREAM_TUTORIAL_MEDIA_BASE_URL` 指向的目录下）：

- `public/tutorials/seedream-interactive-editing.mp4`：720p 档 H.264 网页视频，保留原音轨（如有），4,453,224 字节；SHA-256 `cd9ec04f5bf9605d301f1cb710d5830c350c2616c24b9b4527733548f96de93a`。
- `public/tutorials/seedream-interactive-editing-poster.webp`：1280×617 首帧海报，63,134 字节；SHA-256 `98b45cb8c680bb0636c100a459acdd3a19c3972f43768b7b9d5b11f187bc2e99`。
- `public/tutorials/seedream-interactive-input.webp`：1600×1086，135,450 字节；SHA-256 `a61f20208c4904c80567ad0683e88f5afdaff960e91c634713e3f6b44c2e1386`。
- `public/tutorials/seedream-interactive-output.webp`：1192×1600，220,944 字节；SHA-256 `c6a6581d9b6919f4b852380dffff641c3602690e03a3b572eb5a2ce37130192c`。

## 首页 iPhone 样机

`public/landing/iphone17pro-*` 导出自 Figma 社区文件 [iPhone 16 & 17 Free Mockup](https://www.figma.com/community/file/1064512555184175821)（作者 Richard，CC BY 4.0），导出与裁切过程见 `src/imports/landing-masters/PROVENANCE.md`。iPhone 是 Apple Inc. 的商标，样机只用于展示发布预览。

## 字体

MiSans（小米许可）与 Geist（OFL）随仓库分发，许可文件在 `public/fonts/`，说明见 `public/fonts/说明.md`。完整清单见 `NOTICE`。
