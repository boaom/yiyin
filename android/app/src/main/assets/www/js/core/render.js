// 移植自 electron/src/modules/image-tool/index.ts（sharp + ffmpeg 流程）
// 用 Canvas 2D 重写：背景模糊、主图阴影遮罩、最终合成
import { createCanvas, genTextImages } from './text.js'

export function computeSizeInfo(srcW, srcH, opt) {
  const sizeInfo = { w: srcW, h: srcH, resetW: srcW, resetH: srcH }

  if (opt.bg_rate_show && opt.bg_rate && opt.bg_rate.w && opt.bg_rate.h) {
    const rate = +opt.bg_rate.w / +opt.bg_rate.h
    if (sizeInfo.w >= sizeInfo.h) sizeInfo.resetH = Math.round(sizeInfo.w / rate)
    else sizeInfo.resetW = Math.round(sizeInfo.h * rate)
  }

  const landscapeFlip = opt.landscape && sizeInfo.resetW < sizeInfo.resetH
  const width = landscapeFlip ? sizeInfo.resetH : sizeInfo.resetW
  const height = landscapeFlip ? sizeInfo.resetW : sizeInfo.resetH
  sizeInfo.resetW = width
  sizeInfo.resetH = height
  return sizeInfo
}

export function calcBgImgSize(sizeInfo, opt, height) {
  let resetHeight = sizeInfo.resetH
  let resetWidth = sizeInfo.resetW
  const whRate = resetWidth / resetHeight

  if (height) {
    resetHeight = height
    resetWidth = Math.ceil(resetHeight * whRate)
  }
  else {
    const validHeight = sizeInfo.h > resetHeight ? sizeInfo.h : resetHeight
    resetHeight = validHeight
    resetWidth = Math.ceil(resetHeight * whRate)
  }

  const mainImgWidthRate = (opt.main_img_w_rate || 90) / 100
  if (sizeInfo.w / resetWidth > mainImgWidthRate) {
    resetWidth = Math.ceil(sizeInfo.w / mainImgWidthRate)
    resetHeight = Math.ceil(resetWidth / whRate)
  }

  // 主体宽度限制可能把高度压低，导致文字溢出画布；内容高度必须优先满足
  if (height && resetHeight < height) {
    resetHeight = height
    resetWidth = Math.max(Math.ceil(resetHeight * whRate), Math.ceil(sizeInfo.w / mainImgWidthRate))
    resetHeight = Math.ceil(resetWidth / whRate)
  }

  return { w: resetWidth, h: resetHeight, top: 0, left: 0 }
}

function averageBrightness(canvas) {
  const s = 64
  const tmp = createCanvas(s, Math.max(1, Math.round(s * canvas.height / canvas.width)))
  const tctx = tmp.getContext('2d', { willReadFrequently: true })
  tctx.drawImage(canvas, 0, 0, tmp.width, tmp.height)
  const data = tctx.getImageData(0, 0, tmp.width, tmp.height).data
  let total = 0
  for (let i = 0; i < data.length; i += 4) total += (data[i] + data[i + 1] + data[i + 2]) / 3
  return total / (tmp.width * tmp.height)
}

function solidBg(w, h, color) {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = color || '#fff'
  ctx.fillRect(0, 0, w, h)
  return c
}

/**
 * 背景模糊：桌面版 = 先缩到 3025×3025 再从 ffmpeg boxblur(radius=200*bg_blur/100) 放大到目标尺寸。
 * 这里按同样的等效模糊强度做高斯近似：先缩小 k 倍，在该尺寸上模糊，再放大回目标尺寸。
 */
function blurBg(src, w, h, opt) {
  const radius = Math.ceil(200 * ((opt.bg_blur === undefined ? 100 : opt.bg_blur) / 100)) // 3025 宽下的 box blur 半径
  // box blur 半径 → 高斯 sigma → CSS blur 半径(2σ)
  const cssRadiusAtFull = 1.155 * radius * (w / 3025)
  const k = Math.max(1, Math.min(8, Math.floor(cssRadiusAtFull / 6) || 1))
  const smallW = Math.max(4, Math.round(w / k))
  const smallH = Math.max(4, Math.round(h / k))

  const small = createCanvas(smallW, smallH)
  const sctx = small.getContext('2d')
  sctx.imageSmoothingEnabled = true
  sctx.imageSmoothingQuality = 'high'
  try { sctx.filter = `blur(${Math.max(0.5, cssRadiusAtFull / k).toFixed(2)}px)` } catch (e) {}
  sctx.drawImage(src, 0, 0, smallW, smallH)
  sctx.filter = 'none'

  const out = createCanvas(w, h)
  const octx = out.getContext('2d')
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(small, 0, 0, w, h)
  return out
}

// 移植 web/modules/image-tool/index.ts#genMainImgShadow
function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

function genMask(bgCanvas, mainCanvas, mainTop, opt, rate) {
  const W = Math.max(1, Math.floor(bgCanvas.width * rate))
  const H = Math.max(1, Math.floor(bgCanvas.height * rate))
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  ctx.drawImage(bgCanvas, 0, 0, W, H)

  if (!opt.solid_bg) {
    const average = averageBrightness(canvas)
    if (average < 15) ctx.fillStyle = 'rgba(180, 180, 180, 0.2)'
    else if (average < 20) ctx.fillStyle = 'rgba(158, 158, 158, 0.2)'
    else if (average < 40) ctx.fillStyle = 'rgba(128, 128, 128, 0.2)'
    else ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'black'
  }

  const contentOffsetX = Math.ceil((W - mainCanvas.width * rate) / 2) + 1
  const contentOffsetY = Math.floor(mainTop * rate)
  const blur = opt.shadow_show ? Math.ceil(mainCanvas.height * rate) * ((opt.shadow || 6) / 100) : 0

  if (blur) {
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
    ctx.shadowBlur = blur
    ctx.shadowColor = 'rgba(0, 0, 0, 1)'
  }

  const rectX = contentOffsetX || ctx.shadowBlur
  const rectY = contentOffsetY || ctx.shadowBlur
  const rectWidth = Math.floor(mainCanvas.width * rate) - 2
  const rectHeight = Math.floor(mainCanvas.height * rate) - 2
  const cornerRadius = opt.radius_show ? Math.ceil(mainCanvas.height * rate) * ((opt.radius || 2.1) / 100) : 0

  const path = () => {
    ctx.beginPath()
    ctx.moveTo(rectX + cornerRadius, rectY)
    ctx.lineTo(rectX + rectWidth - cornerRadius, rectY)
    ctx.arcTo(rectX + rectWidth, rectY, rectX + rectWidth, rectY + cornerRadius, cornerRadius)
    ctx.lineTo(rectX + rectWidth, rectY + rectHeight - cornerRadius)
    ctx.arcTo(rectX + rectWidth, rectY + rectHeight, rectX + rectWidth - cornerRadius, rectY + rectHeight, cornerRadius)
    ctx.lineTo(rectX + cornerRadius, rectY + rectHeight)
    ctx.arcTo(rectX, rectY + rectHeight, rectX, rectY + rectHeight - cornerRadius, cornerRadius)
    ctx.lineTo(rectX, rectY + cornerRadius)
    ctx.arcTo(rectX, rectY, rectX + cornerRadius, rectY, cornerRadius)
    ctx.closePath()
  }

  path()
  ctx.fill()

  path()
  ctx.clip()
  ctx.clearRect(rectX, rectY, rectWidth, rectHeight)

  return canvas
}

/**
 * 完整渲染
 * @param {object} p
 * @param {HTMLCanvasElement} p.source 已按 EXIF 方向摆正的源图（可预先缩放）
 */
export async function renderYiyin(p) {
  const { source, exif, options: opt, tempFields, customTempFields, temps, logoBase } = p
  const onProgress = p.onProgress || (() => {})

  onProgress(5)
  const sizeInfo = computeSizeInfo(source.width, source.height, opt)
  let bg = calcBgImgSize(sizeInfo, opt, sizeInfo.h)

  onProgress(15)
  const textImages = await genTextImages({
    exif,
    options: opt,
    temps,
    fields: [...tempFields, ...customTempFields],
    bgHeight: bg.h,
    logoBase,
  })

  onProgress(35)
  const main = { canvas: source, w: sizeInfo.w, h: sizeInfo.h, top: 0, left: 0 }

  // ---- calcContentHeight ----
  const mainImgTopOffset = bg.h * (opt.mini_top_bottom_margin / 100)
  const textButtomOffset = bg.h * 0.027
  let contentTop = Math.ceil(mainImgTopOffset)
  let mainImgOffset = contentTop * 2

  if (opt.shadow_show) {
    const shadowHeight = Math.ceil(main.h * ((opt.shadow || 0) / 100))
    contentTop = Math.max(contentTop, shadowHeight)
    mainImgOffset = contentTop * 2
  }

  if (textImages.length) {
    mainImgOffset *= 3 / 4
    mainImgOffset += textButtomOffset
  }

  const textH = textImages.reduce((n, i) => n + i.h, 0)
  const contentH = Math.ceil(textH + main.h + mainImgOffset)

  main.top = contentTop
  if (textImages.length) textImages[textImages.length - 1].h += textButtomOffset

  onProgress(45)
  bg = calcBgImgSize(sizeInfo, opt, contentH)
  main.left = Math.round((bg.w - main.w) / 2)
  main.top += Math.round((bg.h - contentH) / 2)

  onProgress(55)
  const bgCanvas = opt.solid_bg ? solidBg(bg.w, bg.h, opt.solid_color) : blurBg(main.canvas, bg.w, bg.h, opt)

  onProgress(75)
  let rate = 1
  if (bg.w > 10240) rate = 10240 / bg.w
  const maskCanvas = genMask(bgCanvas, main.canvas, main.top, opt, rate)

  onProgress(90)
  const out = createCanvas(bg.w, bg.h)
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, bg.w, bg.h)

  // 主图：圆角直接裁切照片本身（抗锯齿），不靠蒙层遮挡
  const cornerR = opt.radius_show ? Math.ceil(main.h * ((opt.radius || 2.1) / 100)) : 0
  ctx.save()
  if (cornerR > 0) {
    roundedRectPath(ctx, main.left, main.top, main.w, main.h, cornerR)
    ctx.clip()
  }
  ctx.drawImage(main.canvas, main.left, main.top, main.w, main.h)
  ctx.restore()

  ctx.drawImage(maskCanvas, 0, 0, bg.w, bg.h)

  // 文字：用（可能含底部留白的）布局高度定位，但按 canvas 原始尺寸绘制，不能拉伸
  for (let i = textImages.length - 1, top = bg.h; i >= 0; i--) {
    const t = textImages[i]
    top -= t.h
    ctx.drawImage(t.canvas, Math.round((bg.w - t.canvas.width) / 2), Math.round(top), t.canvas.width, t.canvas.height)
  }

  onProgress(100)
  return { canvas: out, width: bg.w, height: bg.h }
}