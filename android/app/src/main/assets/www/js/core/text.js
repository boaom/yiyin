// 移植自 web/modules/text-tool/index.ts + web/modules/temp-field/index.ts
import { ExifFormat } from './exif.js'

export function roundDecimalPlaces(n, place = 0) {
  const m = 10 ** place
  return Math.round(n * m) / m
}

export function matchFields(str, matcher = /\{([A-Z0-9]+)\}/gi) {
  if (!str) return null
  const matchList = str.match(matcher)
  if (!matchList) return null
  const fields = {}
  for (const match of matchList) {
    const field = match.substring(1, match.length - 1)
    if (field) fields[field] = { temp: match, field }
  }
  return fields
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    if (!url) { reject(new Error('empty url')); return }
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`图片加载失败 ${url}`))
    img.src = url
  })
}

export function createCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w || 1))
  c.height = Math.max(1, Math.round(h || 1))
  return c
}

// ---- temp-field ----

export async function getFieldTempInfo(exifInfo, opt) {
  const tempFieldRecord = {}
  for (const filed of opt.fields) {
    tempFieldRecord[filed.key] = Object.assign({}, filed, {
      font: filed.font && Object.assign({}, filed.font, {
        size: filed.font.size ? Math.round(opt.bgHeight * (filed.font.size / 100)) : 0,
      }),
    })
  }
  return fillTempFieldInfo(tempFieldRecord, opt.logoBase, exifInfo)
}

export function getTextTempList(temps, opts) {
  return temps.map(temp => Object.assign({}, temp, {
    font: Object.assign({}, temp.font, {
      font: temp.font.font || opts.defFont,
      color: temp.font.color || opts.color,
      size: opts.bgHeight * (temp.font.size / 100),
    }),
  })).filter(i => i.use)
}

async function fillTempFieldInfo(tempFieldConf, logoBase, exifInfo) {
  const exif = new ExifFormat(exifInfo || {})
  const tempFieldInfo = {}

  for (const field in tempFieldConf) {
    const info = tempFieldConf[field]
    const fn = exif._[field]
    const value = typeof fn === 'function' ? (fn.call(exif._, undefined) ?? '') : ''
    const _info = Object.assign({}, info, {
      type: 'text',
      bImg: '',
      wImg: '',
      value: value === null || value === undefined ? '' : value,
    })
    tempFieldInfo[field] = JSON.parse(JSON.stringify(_info))

    if (field === 'Make' && exif.oriExif.Make) {
      const key = String(exif.oriExif.Make).toLowerCase()
      const wImg = `${logoBase}${key}-w.svg`
      const bImg = `${logoBase}${key}-b.svg`
      const w = await loadImage(wImg).catch(() => false)
      if (w) {
        tempFieldInfo[field].wImg = wImg
        tempFieldInfo[field].type = 'img'
      }
      const b = await loadImage(bImg).catch(() => false)
      if (b) {
        tempFieldInfo[field].bImg = bImg
        tempFieldInfo[field].type = 'img'
      }
    }

    if (info.use && (info.forceUse || !tempFieldInfo[field].value)) {
      tempFieldInfo[field].type = info.type || 'text'
      tempFieldInfo[field].value = `${info.value || ''}`
      tempFieldInfo[field].bImg = `${info.bImg || ''}`
      tempFieldInfo[field].wImg = `${info.wImg || ''}`
      tempFieldInfo[field].font = info.font || tempFieldInfo[field].font
    }
  }

  return tempFieldInfo
}

// ---- text-tool ----

export async function genTextImages(opts) {
  const { exif, options, temps, fields, bgHeight, logoBase } = opts
  const out = []

  const fieldTemps = await getFieldTempInfo(exif, { bgHeight, fields, logoBase })
  const textTempList = getTextTempList(temps, {
    bgHeight,
    color: options.solid_bg ? '#000' : '#fff',
    defFont: options.font,
  })

  for (const i of textTempList) {
    let text = String(i.temp || '').trim()
    if (!text) continue

    let textList = []
    const slotInfoList = []
    const matchList = matchFields(text)

    if (matchList && Object.keys(matchList).length) {
      for (const field in matchList) {
        const { temp } = matchList[field]
        const fieldTemp = fieldTemps[field] || { show: false, type: 'text', value: '' }
        text = text.replace(temp, fieldTemp.show ? '{---}' : '')
        if (!fieldTemp.show) continue

        const slotInfo = { value: '', font: fieldTemp.font }
        if (fieldTemp.type === 'text') {
          slotInfo.value = `${fieldTemp.value ?? ''}`.trim()
          slotInfoList.push(slotInfo.value ? slotInfo : '')
          continue
        }

        let imgSrc = ''
        if (options.solid_bg) {
          if (fieldTemp.bImg && fieldTemp.bImg !== 'false') imgSrc = fieldTemp.bImg
        }
        else if (fieldTemp.wImg && fieldTemp.wImg !== 'false') {
          imgSrc = fieldTemp.wImg
        }
        if (imgSrc) {
          slotInfo.value = await loadImage(imgSrc).catch(() => '')
        }
        slotInfoList.push(slotInfo.value ? slotInfo : '')
      }

      const arr = text.trim().split('{---}')
      if (
        (arr.length === 1 && !arr[0].trim())
        || (arr.length > 1 && !slotInfoList.filter(Boolean).length)
      ) {
        continue
      }

      for (let j = 0; j < arr.length; j++) {
        const slotInfo = slotInfoList[j]
        let commonText = arr[j]
        if (i.font.caseType === 'lowcase') commonText = commonText.toLowerCase()
        else if (i.font.caseType === 'upcase') commonText = commonText.toUpperCase()

        if (typeof slotInfo === 'string' || !slotInfo || !slotInfo.value) textList.push(commonText)
        else textList.push(commonText, slotInfo)
      }
    }
    else {
      textList.push(text)
    }

    if (textList.length) {
      const img = createTextImg(textList, {
        verticalAlign: i.verticalAlign,
        font: i.font,
        height: i.height,
        bgHeight,
        options,
      })
      if (img) out.push(img)
    }
  }

  return out
}

function getFont(opts, extraOpts) {
  const _opts = Object.assign({}, opts)
  if (extraOpts && extraOpts.use) {
    Object.assign(_opts, extraOpts)
    if (!opts.size) _opts.size = opts.size
  }
  let font = ''
  if (_opts.bold) font += 'bold '
  if (_opts.italic) font += 'italic '
  if (_opts.size) font += `${_opts.size}px `
  if (_opts.font) font += `"${_opts.font}", `
  font += '"PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif'
  return font
}

function getMaxFontParam(fontList, defFont) {
  const maxFontParam = Object.assign({}, defFont)
  for (const font of fontList) {
    if (font && font.use) {
      if (!maxFontParam.bold && font.bold) maxFontParam.bold = true
      if (maxFontParam.size < font.size) maxFontParam.size = font.size
    }
  }
  return maxFontParam
}

function mergeFontParam(def, target) {
  if (!target || !target.use) return Object.assign({}, def, { use: false })
  const cpDef = Object.assign({}, target)
  for (const key in def) {
    if (target && target[key]) cpDef[key] = target[key]
    else cpDef[key] = def[key]
  }
  return cpDef
}

function createTextImg(textList, opts) {
  textList = textList.filter(Boolean)
  if (!textList.length) return null

  let totalText = ''
  let textValIsAllText = true
  const textFonts = []

  for (const item of textList) {
    if (typeof item !== 'string') {
      textFonts.push(item.font)
      if (typeof item.value === 'string') {
        let v = item.value
        if (item.font && item.font.use) {
          if (item.font.caseType === 'lowcase') v = v.toLowerCase()
          else if (item.font.caseType === 'upcase') v = v.toUpperCase()
        }
        totalText += v
      }
      else {
        textValIsAllText = false
      }
      continue
    }
    totalText += item
  }

  const textInfoList = []
  const can = createCanvas(1, 1)
  const ctx = can.getContext('2d')
  const defFont = getFont(opts.font)
  const maxFontParam = getMaxFontParam(textFonts, opts.font)

  ctx.font = getFont(maxFontParam)
  const textInfo = ctx.measureText(textValIsAllText ? totalText : 'QOSyYtl709')
  const defTextMargin = opts.bgHeight * ((opts.options.text_margin || 0) / 100)
  const baseline = Math.ceil(textInfo.actualBoundingBoxAscent || 0)

  can.height = Math.max(1, Math.round(opts.height || Math.ceil(Math.max(
    (textInfo.actualBoundingBoxAscent || 0) + (textInfo.actualBoundingBoxDescent || 0) + defTextMargin * 2,
    maxFontParam.size || 1,
  ))))

  can.width = textList.reduce((n, i, j) => {
    if (!i) return n
    const isStartOrEnd = j === textList.length - 1 || j === 0
    if (isStartOrEnd && typeof i === 'string' && !i.trim()) return n

    const _textInfo = {
      color: opts.font.color,
      font: defFont,
      value: '',
      type: 'img',
      w: 0,
      h: 0,
      x: n,
      y: 0,
    }

    if (typeof i === 'object' && (i.value instanceof HTMLImageElement || i.value instanceof HTMLCanvasElement)) {
      const font = mergeFontParam(opts.font, i.font)
      _textInfo.value = i.value
      _textInfo.font = getFont(opts.font, font)

      ctx.font = _textInfo.font
      const info = ctx.measureText('QSOPNYuiyl90')
      _textInfo.h = Math.ceil(info.actualBoundingBoxAscent || (font.size || 10))
      _textInfo.w = Math.ceil(_textInfo.h * (i.value.width / i.value.height))

      if (opts.verticalAlign === 'center') {
        _textInfo.y = roundDecimalPlaces((can.height - _textInfo.h) / 2, 2)
      }
      else {
        _textInfo.y = roundDecimalPlaces(baseline - _textInfo.h + _textInfo.h * 0.03 + (can.height - baseline) / 2, 2)
      }
    }
    else {
      _textInfo.type = 'text'
      if (typeof i === 'object') {
        const font = mergeFontParam(opts.font, i.font)
        _textInfo.color = (i.font && i.font.color) || opts.font.color
        _textInfo.font = getFont(opts.font, font)
        _textInfo.value = i.value
        if (font.caseType === 'lowcase') _textInfo.value = String(_textInfo.value).toLowerCase()
        else if (font.caseType === 'upcase') _textInfo.value = String(_textInfo.value).toUpperCase()
      }
      else {
        _textInfo.value = i
      }

      ctx.font = _textInfo.font
      const info = ctx.measureText(_textInfo.value)
      _textInfo.h = Math.ceil((info.actualBoundingBoxAscent || 0) + (info.actualBoundingBoxDescent || 0))
      _textInfo.w = Math.max(Math.ceil((info.actualBoundingBoxLeft || 0) + (info.actualBoundingBoxRight || 0)), info.width)

      if (opts.verticalAlign === 'center') {
        _textInfo.y = roundDecimalPlaces(_textInfo.h + (can.height - _textInfo.h) / 2, 2)
      }
      else {
        _textInfo.y = roundDecimalPlaces(baseline + (can.height - baseline) / 2, 2)
      }
    }
    textInfoList.push(_textInfo)
    n += _textInfo.w
    return n
  }, 30)

  can.width = Math.max(1, Math.ceil(can.width + 30))

  for (const info of textInfoList) {
    if (info.type === 'text') {
      ctx.font = info.font
      ctx.fillStyle = info.color || opts.font.color || '#000'
      ctx.fillText(info.value, info.x, info.y)
    }
    else {
      ctx.drawImage(info.value, info.x, info.y, info.w, info.h)
    }
  }

  return { canvas: can, w: can.width, h: can.height }
}