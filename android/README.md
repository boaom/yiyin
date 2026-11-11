# 壹印 · Android 移植版

把 [ggchivalrous/yiyin](https://github.com/ggchivalrous/yiyin)（壹印，照片印框工具，GPL-3.0）的桌面 Electron 版移植成**纯离线安卓 App**。

## 怎么做的

桌面版的图像处理在 Electron 主进程里跑 `sharp` + `ffmpeg`（libvips / ffmpeg 没有可用的 Android 构建），所以整体换了一套实现，但**算法逐行对齐**：

| 桌面版 | 安卓版 |
|---|---|
| `sharp` 解码 / 旋转 / 缩放 / 合成 | Canvas 2D（`createImageBitmap` + `imageOrientation: from-image`） |
| `ffmpeg boxblur` 背景模糊 | 缩小 → `ctx.filter: blur()` → 放大（等效模糊强度换算见 `js/core/render.js`） |
| `exiftool` 二进制读 EXIF | [ExifReader](https://github.com/mattiasw/ExifReader)（纯 JS，`vendor/exif-reader.js`） |
| 文字图片 / 阴影遮罩（本来就是渲染进程 Canvas） | 原样移植（`js/core/text.js`） |
| Electron IPC `window.api.*` | 直接调用同一个 JS 引擎（`js/app.js`） |
| 写文件到输出目录 | `MediaStore` 写入相册 `Pictures/壹印`，或 `ACTION_SEND` 分享 |

排版算法（`clacBgImgSize` / `calcContentHeight` / 圆角 / 阴影 / 文字堆积）与原版一致，所以同参数下输出构图相同。

## 目录

```
android/
  app/src/main/
    java/com/yiyin/app/MainActivity.java   单 Activity + WebView 宿主
    assets/www/                            前端（无构建步骤，直接打包）
      index.html  css/app.css  js/app.js
      js/core/{fields,exif,text,render}.js 从 Electron 版移植的算法
      vendor/exif-reader.js                EXIF 解析（UMD）
      assets/{font,logo}/                  内置字体与相机 Logo
    res/                                   Manifest 资源（主题 / 图标）
  signing/yiyin.p12                        固定开发签名（store/key 口令都是 yiyinapk）
  app/build.gradle                         AGP 8.5.2 / compileSdk 34 / minSdk 24
.github/workflows/android-apk.yml         CI：出 release APK artifact
```

## 构建

CI（推荐）：push 到 `android-port` 分支 → Actions 跑 `gradle assembleRelease` → 下载 `yiyin-android-apk` artifact。

本机：
```bash
cd android && gradle assembleRelease
# 产物 app/build/outputs/apk/release/yiyin-android-1.0.0-release.apk
```

本地预览前端（不需要安卓工具链）：
```bash
cd android/app/src/main/assets/www
python3 -m http.server 8899    # 浏览器打开 http://127.0.0.1:8899/index.html
```
（浏览器模式下没有 `YiyinAndroid` 桥，保存会退化成下载文件）

## 安卓侧与桌面版的行为差异

- **不再读取/写入原图的 EXIF**（桌面版会带 `density`），输出是干净的 JPEG。
- **输出长边默认限制 3072px**（原版输出原图）。手机 WebView 的 canvas 内存有限，50MP 原图直接全尺寸合成容易 OOM；「印框 → 输出尺寸」可切 2K/3K/4K/原图。
- 预览用长边 1400 的缩略图实时重算，导出时才用全尺寸重跑一遍。
- 字体：系统字体 + 内置 4 款（春风楷 / 千图小兔 / FrederickatheGreat / Neoneon）+ 自己导入的字体（存 IndexedDB，不联网）。
- 相册路径：`Pictures/壹印/`；Android 9 及以下需要一次性存储权限。

## 已知限制

- 只支持单张/多张静态图，没有桌面版的批量队列 UI（一次选多张，逐张切换生成）。
- HEIC/RAW：HEIC 依赖系统解码器（Android 9+ 一般可用）；RAW（DNG/CR3）不支持。
- 大图（> 8000px 长边）用「原图」档可能失败，建议 4K。

## 许可

跟随上游 GPL-3.0。算法与界面来自 ggchivalrous/yiyin，安卓移植部分同样以 GPL-3.0 发布。