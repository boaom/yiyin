// 壹印 Android · 移动端 UI 与流程
import { parseExif } from './core/exif.js'
import { renderYiyin } from './core/render.js'
import { createCanvas } from './core/text.js'
import { defaultConfig, normalizeConfig, defFieldItem, getDefTemp, exifFields } from './core/fields.js'

const BRIDGE = window.YiyinAndroid || null
const LS_KEY = 'yiyin.config.v1'
const PREVIEW_EDGE = 1400
const BUILTIN_FONTS = [
  { name: '春风楷', file: 'assets/font/chunfengkai.ttf' },
  { name: '千图小兔', file: 'assets/font/qiantuxiaotu.ttf' },
  { name: 'FrederickatheGreat', file: 'assets/font/FrederickatheGreat.ttf' },
  { name: 'Neoneon', file: 'assets/font/Neoneon.otf' },
]

const state = {
  config: loadConfig(),
  images: [],
  activeId: '',
  tab: 'frame',
  fonts: [],
  lastBlob: null,
  lastUrl: '',
  busy: false,
  previewSeq: 0,
}

const $ = s => document.querySelector(s)
const previewCanvas = $('#preview')

/* ---------------- 基础工具 ---------------- */

function uuid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return defaultConfig()
    return normalizeConfig(JSON.parse(raw))
  }
  catch (e) {
    return defaultConfig()
  }
}

let saveTimer = 0
function persistConfig() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.config)) }
    catch (e) { console.warn('配置保存失败', e) }
  }, 250)
}

function toast(msg, ms = 1800) {
  const el = $('#toast')
  el.textContent = msg
  el.classList.add('on')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => el.classList.remove('on'), ms)
}

function el(tag, attrs, kids) {
  const node = document.createElement(tag)
  if (attrs) {
    for (const k in attrs) {
      if (k === 'class') node.className = attrs[k]
      else if (k === 'text') node.textContent = attrs[k]
      else if (k === 'html') node.innerHTML = attrs[k]
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k])
      else if (attrs[k] !== undefined && attrs[k] !== null) node.setAttribute(k, attrs[k])
    }
  }
  for (const c of [].concat(kids || [])) {
    if (c === null || c === undefined) continue
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

/* ---------------- 图片解码 ---------------- */

async function parseFileMeta(file) {
  let exif = null
  try {
    const buf = await file.arrayBuffer()
    exif = parseExif(buf)
  }
  catch (e) { console.warn('exif', e) }

  const bmp = await decodeBitmap(file)
  const w = bmp.width
  const h = bmp.height
  bmp.close && bmp.close()
  return { exif, w, h }
}

async function decodeBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  }
  catch (e) {
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = URL.createObjectURL(file)
    })
    return img
  }
}

function drawToCanvas(bmp, w, h) {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  return c
}

async function makeSourceCanvas(file, cap) {
  const bmp = await decodeBitmap(file)
  const long = Math.max(bmp.width, bmp.height)
  const s = cap ? Math.min(1, cap / long) : 1
  const w = Math.max(1, Math.round(bmp.width * s))
  const h = Math.max(1, Math.round(bmp.height * s))
  const c = drawToCanvas(bmp, w, h)
  bmp.close && bmp.close()
  return c
}

async function getPreviewSource(img) {
  if (img.previewCanvas) return img.previewCanvas
  const c = await makeSourceCanvas(img.file, PREVIEW_EDGE)
  img.previewCanvas = c
  return c
}

/* ---------------- 预览渲染 ---------------- */

let previewTimer = 0
function queuePreview(delay = 220) {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(renderPreview, delay)
}

async function renderPreview() {
  const img = activeImage()
  if (!img || state.busy) return
  const seq = ++state.previewSeq
  try {
    const src = await getPreviewSource(img)
    const conf = state.config
    const res = await renderYiyin({
      source: src,
      exif: img.exif || {},
      options: conf.options,
      tempFields: conf.tempFields,
      customTempFields: conf.customTempFields,
      temps: conf.temps,
      logoBase: 'assets/logo/',
    })
    if (seq !== state.previewSeq) return
    previewCanvas.width = res.canvas.width
    previewCanvas.height = res.canvas.height
    const ctx = previewCanvas.getContext('2d')
    ctx.drawImage(res.canvas, 0, 0)
    previewCanvas.classList.add('on')
    $('#empty').classList.add('hide')
  }
  catch (e) {
    console.error('预览失败', e)
    toast(`预览失败：${e.message || e}`)
  }
}

/* ---------------- 生成 / 保存 ---------------- */

function setBusy(on, text = '渲染中', pct = 0) {
  state.busy = on
  $('#busy').classList.toggle('on', on)
  $('#busytext').textContent = pct ? `${text} ${pct}%` : text
  $('#busybar').style.width = `${pct}%`
  $('#btn-render').disabled = on || !state.images.length
}

async function renderFull() {
  const img = activeImage()
  if (!img) return null
  const cap = state.config.options.max_long_edge || 0
  const src = await makeSourceCanvas(img.file, cap)
  const conf = state.config
  const res = await renderYiyin({
    source: src,
    exif: img.exif || {},
    options: conf.options,
    tempFields: conf.tempFields,
    customTempFields: conf.customTempFields,
    temps: conf.temps,
    logoBase: 'assets/logo/',
    onProgress: p => setBusy(true, '生成中', p),
  })
  return res
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('导出失败'))), 'image/jpeg', Math.min(1, Math.max(0.3, quality / 100)))
  })
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const s = String(fr.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    fr.onerror = reject
    fr.readAsDataURL(blob)
  })
}

function outName(img) {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const base = (img.name || 'yiyin').replace(/\.[^.]+$/, '').slice(0, 24)
  return `壹印_${base}_${stamp}.jpg`
}

async function saveBlob(blob, name, mode) {
  if (BRIDGE && BRIDGE.beginWrite) {
    const b64 = await blobToBase64(blob)
    BRIDGE.beginWrite(name, mode || 'gallery')
    const CH = 256 * 1024
    for (let i = 0; i < b64.length; i += CH) BRIDGE.writeChunk(b64.slice(i, i + CH))
    const raw = BRIDGE.endWrite()
    let res = {}
    try { res = JSON.parse(raw || '{}') } catch (e) { res = { ok: false, error: raw } }
    if (!res.ok) throw new Error(res.error || '保存失败')
    return res.path || ''
  }
  // 浏览器兜底：直接下载
  const url = URL.createObjectURL(blob)
  const a = el('a', { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return name
}

async function doRenderAndSave(share) {
  const img = activeImage()
  if (!img || state.busy) return
  state.previewSeq++
  setBusy(true, '生成中', 1)
  try {
    const res = await renderFull()
    const blob = await canvasToBlob(res.canvas, state.config.options.quality)
    state.lastBlob = blob
    state.lastUrl = URL.createObjectURL(blob)
    const name = outName(img)
    const path = await saveBlob(blob, name, share ? 'share' : 'gallery')
    $('#btn-share').disabled = false
    $('#btn-save').disabled = false
    if (share) {
      toast('已调起分享')
    }
    else {
      toast(path ? `已保存：${path.split('/').pop()}` : '已保存到相册', 2400)
    }
    if (BRIDGE && BRIDGE.toastMsg) BRIDGE.toastMsg(share ? '已调起分享' : '已保存到相册')
  }
  catch (e) {
    console.error(e)
    toast(`失败：${e.message || e}`, 2600)
  }
  finally {
    setBusy(false)
  }
}

/* ---------------- 图片列表 ---------------- */

function activeImage() {
  return state.images.find(i => i.id === state.activeId) || null
}

async function addFiles(files) {
  const list = [...files].filter(f => f && f.type && f.type.startsWith('image/'))
  if (!list.length) { toast('请选择图片文件'); return }
  toast(`读取 ${list.length} 张…`, 1200)
  for (const file of list) {
    try {
      const meta = await parseFileMeta(file)
      const item = {
        id: uuid(),
        name: file.name,
        file,
        exif: meta.exif,
        w: meta.w,
        h: meta.h,
        thumbUrl: URL.createObjectURL(file),
        previewCanvas: null,
      }
      state.images.push(item)
      if (!state.activeId) state.activeId = item.id
    }
    catch (e) {
      console.warn('图片读取失败', file.name, e)
      toast(`${file.name} 读取失败`)
    }
  }
  renderThumbs()
  const img = activeImage()
  if (img) {
    $('#btn-render').disabled = false
    $('#btn-save').disabled = false
  }
  queuePreview(60)
}

function renderThumbs() {
  const wrap = $('#thumbs')
  wrap.innerHTML = ''
  for (const img of state.images) {
    const thumb = el('div', { class: `thumb${img.id === state.activeId ? ' on' : ''}` }, [
      el('img', { src: img.thumbUrl, alt: img.name }),
      el('span', { class: `dot${img.exif ? ' ok' : ''}` }),
      el('span', { class: 'del', text: '删除', onclick: (e) => { e.stopPropagation(); removeImage(img.id) } }),
    ])
    thumb.addEventListener('click', () => {
      if (state.activeId === img.id) return
      state.activeId = img.id
      renderThumbs()
      queuePreview(40)
    })
    wrap.appendChild(thumb)
  }
  wrap.appendChild(el('label', { class: 'thumb-add', for: 'file', text: '＋' }))
}

function removeImage(id) {
  const idx = state.images.findIndex(i => i.id === id)
  if (idx < 0) return
  const [img] = state.images.splice(idx, 1)
  if (img.thumbUrl) URL.revokeObjectURL(img.thumbUrl)
  if (state.activeId === id) state.activeId = state.images[0] ? state.images[0].id : ''
  renderThumbs()
  if (!state.images.length) {
    previewCanvas.classList.remove('on')
    $('#empty').classList.remove('hide')
    $('#btn-render').disabled = true
    $('#btn-save').disabled = true
    $('#btn-share').disabled = true
  }
  else {
    queuePreview(40)
  }
}

/* ---------------- 字体 ---------------- */

async function loadFonts() {
  const list = []
  for (const f of BUILTIN_FONTS) {
    const ok = await registerFont(f.name, f.file).catch(() => false)
    if (ok) list.push({ name: f.name, source: 'builtin' })
  }
  const imported = await idbAll()
  for (const f of imported) {
    try {
      const url = URL.createObjectURL(new Blob([f.bytes], { type: 'font/ttf' }))
      const ok = await registerFont(f.name, url).catch(() => false)
      if (ok) list.push({ name: f.name, source: 'imported', id: f.id })
    }
    catch (e) { console.warn('字体注册失败', f.name, e) }
  }
  state.fonts = list
}

function registerFont(name, url) {
  return new FontFace(name, `url("${url}")`).load().then((face) => {
    document.fonts.add(face)
    return true
  })
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('yiyin-fonts', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbAll() {
  try {
    const db = await idbOpen()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('fonts', 'readonly')
      const req = tx.objectStore('fonts').getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  }
  catch (e) { return [] }
}

async function idbPut(rec) {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fonts', 'readwrite')
    tx.objectStore('fonts').put(rec)
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDel(id) {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fonts', 'readwrite')
    tx.objectStore('fonts').delete(id)
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => reject(tx.error)
  })
}

async function importFontFile(file) {
  if (!file) return
  const name = file.name.replace(/\.[^.]+$/, '')
  if (state.fonts.some(f => f.name === name)) { toast('同名字体已存在'); return }
  const bytes = new Uint8Array(await file.arrayBuffer())
  await idbPut({ id: uuid(), name, bytes })
  const url = URL.createObjectURL(new Blob([bytes]))
  const ok = await registerFont(name, url).catch(() => false)
  if (!ok) { toast('字体解析失败'); return }
  state.fonts.push({ name, source: 'imported' })
  state.config.options.font = name
  persistConfig()
  renderTab()
  queuePreview(30)
  toast(`已导入并应用：${name}`)
}/* ---------------- 表单构件 ---------------- */

function opt() { return state.config.options }

function changed(rebuild) {
  persistConfig()
  if (rebuild) renderTab()
  queuePreview(180)
}

function switchNode(get, set) {
  const node = el('div', { class: `switch${get() ? ' on' : ''}` })
  node.addEventListener('click', () => {
    const v = !get()
    set(v)
    node.classList.toggle('on', v)
    changed()
  })
  return node
}

function switchRow(title, sub, get, set) {
  return el('div', { class: 'row' }, [
    el('div', { class: 'k' }, [title, sub ? el('small', { text: sub }) : null]),
    switchNode(get, set),
  ])
}

function rangeRow(title, sub, min, max, step, get, set, fmt) {
  const out = el('span', { class: 'v', text: fmt(get()) })
  const input = el('input', {
    type: 'range', min, max, step, value: get(),
  })
  input.addEventListener('input', () => {
    const v = Number(input.value)
    set(v)
    out.textContent = fmt(v)
    changed()
  })
  return el('div', { class: 'row' }, [
    el('div', { class: 'k' }, [title, sub ? el('small', { text: sub }) : null]),
    el('div', { class: 'range' }, [input, out]),
  ])
}

function segRow(title, sub, options, get, set) {
  const wrap = el('div', { class: 'seg' })
  for (const o of options) {
    const b = el('button', { class: get() === o.value ? 'on' : '', text: o.label })
    b.addEventListener('click', () => {
      if (get() === o.value) return
      set(o.value)
      for (const c of wrap.children) c.classList.remove('on')
      b.classList.add('on')
      changed()
    })
    wrap.appendChild(b)
  }
  return el('div', { class: 'row' }, [
    el('div', { class: 'k' }, [title, sub ? el('small', { text: sub }) : null]),
    wrap,
  ])
}

function colorRow(title, get, set) {
  const input = el('input', { type: 'color', value: get() })
  input.addEventListener('input', () => { set(input.value); changed() })
  return el('div', { class: 'row' }, [el('div', { class: 'k', text: title }), input])
}

function miniRow(label, child) {
  return el('div', { class: 'mini' }, [el('label', { text: label }), el('div', { class: 'grow' }, [child])])
}

/* ---------------- 印框 ---------------- */

function buildFrameTab() {
  const body = el('div')
  const o = () => state.config.options

  body.appendChild(switchRow('横屏输出', '竖图转横版', () => o().landscape, v => { o().landscape = v }))
  body.appendChild(switchRow('纯色背景', '不用原图做模糊底', () => o().solid_bg, v => { o().solid_bg = v }))
  body.appendChild(colorRow('背景颜色', () => o().solid_color || '#ffffff', v => { o().solid_color = v }))
  body.appendChild(rangeRow('背景模糊', '背景虚化强度', 0, 200, 5, () => o().bg_blur, v => { o().bg_blur = v }, v => `${v}%`))
  body.appendChild(rangeRow('主图宽度', '照片占画面比例', 40, 100, 1, () => o().main_img_w_rate, v => { o().main_img_w_rate = v }, v => `${v}%`))
  body.appendChild(switchRow('圆角', '照片圆角显示', () => o().radius_show, v => { o().radius_show = v }))
  body.appendChild(rangeRow('圆角大小', '', 0, 20, 0.1, () => o().radius, v => { o().radius = v; o().radius_show = true }, v => `${v.toFixed(1)}%`))
  body.appendChild(switchRow('阴影', '主体投影', () => o().shadow_show, v => { o().shadow_show = v }))
  body.appendChild(rangeRow('阴影大小', '', 0, 20, 0.5, () => o().shadow, v => { o().shadow = v; o().shadow_show = true }, v => `${v}%`))
  body.appendChild(rangeRow('上下留白', '画面边缘到主体的距离', 0, 12, 0.5, () => o().mini_top_bottom_margin, v => { o().mini_top_bottom_margin = v }, v => `${v}%`))
  body.appendChild(rangeRow('文字边距', '文字块内边距', 0, 3, 0.1, () => o().text_margin, v => { o().text_margin = v }, v => `${v.toFixed(1)}%`))
  body.appendChild(switchRow('背景比例', '强制画面宽高比', () => o().bg_rate_show, v => { o().bg_rate_show = v }))
  if (o().bg_rate_show) {
    const w = el('input', { type: 'number', value: o().bg_rate.w || 4, min: 1 })
    const h = el('input', { type: 'number', value: o().bg_rate.h || 5, min: 1 })
    w.addEventListener('input', () => { o().bg_rate.w = Number(w.value) || 0; changed() })
    h.addEventListener('input', () => { o().bg_rate.h = Number(h.value) || 0; changed() })
    body.appendChild(el('div', { class: 'row' }, [
      el('div', { class: 'k', text: '比例 宽 : 高' }),
      el('div', { class: 'range' }, [w, el('span', { class: 'v', text: ':' }), h]),
    ]))
  }
  body.appendChild(rangeRow('输出画质', 'JPEG 压缩质量', 60, 100, 1, () => o().quality, v => { o().quality = v }, v => `${v}`))
  body.appendChild(segRow('输出尺寸', '长边上限（越大越慢）', [
    { label: '2K', value: 2048 },
    { label: '3K', value: 3072 },
    { label: '4K', value: 4096 },
    { label: '原图', value: 0 },
  ], () => o().max_long_edge, v => { o().max_long_edge = v }))

  body.appendChild(el('button', {
    class: 'btn-line',
    text: '还原默认参数',
    onclick: () => {
      state.config.options = Object.assign({}, defaultConfig().options)
      persistConfig()
      renderTab()
      queuePreview(60)
      toast('已还原默认参数')
    },
  }))
  return body
}

/* ---------------- 文字模板 ---------------- */

function buildTextTab() {
  const body = el('div')
  const conf = state.config

  conf.temps.forEach((temp, idx) => {
    const card = el('div', { class: `card${temp.use ? ' open' : ''}` })
    const nameInput = null

    const sw = switchNode(() => temp.use, v => { temp.use = v; card.classList.toggle('open', v) })
    const head = el('div', { class: 'card-head' }, [
      sw,
      el('div', { class: 'name' }, [
        el('div', { text: temp.name || `模板 ${idx + 1}` }),
        el('small', { class: 'idx', text: temp.type === 'system' ? '系统模板' : '自定义模板' }),
      ]),
      el('button', { class: 'iconbtn ghost', text: '▾', onclick: () => card.classList.toggle('open') }),
    ])
    card.appendChild(head)

    const textInput = el('input', { type: 'text', value: temp.temp })
    textInput.addEventListener('input', () => { temp.temp = textInput.value; changed() })

    const sizeOut = el('span', { class: 'v', text: `${temp.font.size}%` })
    const sizeInput = el('input', { type: 'range', min: 0.6, max: 12, step: 0.1, value: temp.font.size })
    sizeInput.addEventListener('input', () => {
      temp.font.size = Number(sizeInput.value)
      sizeOut.textContent = `${temp.font.size.toFixed(1)}%`
      changed()
    })

    const bBtn = el('button', { class: temp.font.bold ? 'on' : '', text: 'B' })
    bBtn.style.fontWeight = '700'
    bBtn.addEventListener('click', () => { temp.font.bold = !temp.font.bold; bBtn.classList.toggle('on', temp.font.bold); changed() })

    const iBtn = el('button', { class: temp.font.italic ? 'on' : '', text: 'I' })
    iBtn.style.fontStyle = 'italic'
    iBtn.addEventListener('click', () => { temp.font.italic = !temp.font.italic; iBtn.classList.toggle('on', temp.font.italic); changed() })

    const colorInput = el('input', { type: 'color', value: temp.font.color || '#ffffff' })
    colorInput.addEventListener('input', () => { temp.font.color = colorInput.value; changed() })

    const alignSeg = el('div', { class: 'seg' })
    for (const a of [{ label: '基线', value: 'baseline' }, { label: '居中', value: 'center' }]) {
      const b = el('button', { class: temp.verticalAlign === a.value ? 'on' : '', text: a.label })
      b.addEventListener('click', () => {
        temp.verticalAlign = a.value
        for (const c of alignSeg.children) c.classList.remove('on')
        b.classList.add('on')
        changed()
      })
      alignSeg.appendChild(b)
    }

    const caseSeg = el('div', { class: 'seg' })
    for (const a of [{ label: 'Aa', value: 'default' }, { label: 'AA', value: 'upcase' }, { label: 'aa', value: 'lowcase' }]) {
      const b = el('button', { class: (temp.font.caseType || 'default') === a.value ? 'on' : '', text: a.label })
      b.addEventListener('click', () => {
        temp.font.caseType = a.value
        for (const c of caseSeg.children) c.classList.remove('on')
        b.classList.add('on')
        changed()
      })
      caseSeg.appendChild(b)
    }

    const bodyEl = el('div', { class: 'card-body' }, [
      miniRow('文本', textInput),
      miniRow('字号', el('div', { class: 'range' }, [sizeInput, sizeOut])),
      miniRow('样式', el('div', { class: 'toggle-mini' }, [bBtn, iBtn, colorInput])),
      miniRow('对齐', alignSeg),
      miniRow('大小写', caseSeg),
      temp.type === 'system'
        ? null
        : el('button', {
            class: 'btn-line',
            text: '删除此模板',
            onclick: () => {
              const i = conf.temps.indexOf(temp)
              if (i >= 0) conf.temps.splice(i, 1)
              persistConfig()
              renderTab()
              queuePreview(30)
            },
          }),
    ])
    card.appendChild(bodyEl)
    body.appendChild(card)
  })

  body.appendChild(el('button', {
    class: 'btn-line',
    text: '＋ 新增文字模板',
    onclick: () => {
      const t = getDefTemp({ name: `自定义模板 ${conf.temps.filter(i => i.type === 'custom').length + 1}`, temp: '{PersonalSign}', use: true, type: 'custom' })
      t.key = `custom-${uuid()}`
      conf.temps.push(t)
      persistConfig()
      renderTab()
      queuePreview(30)
    },
  }))
  body.appendChild(el('div', { class: 'hint', html: '用 <b>{字段}</b> 插入相机参数，比如 <b>{Make} {Model}</b>、<b>{FocalLengthIn35mmFormat}mm f/{FNumber} {ExposureTime}s ISO{ISO}</b>。字段值可在「字段」页覆盖。' }))
  return body
}

/* ---------------- 字段 ---------------- */

function buildFieldTab() {
  const body = el('div')
  const conf = state.config
  const img = activeImage()
  const exif = (img && img.exif) || {}

  if (!img) {
    body.appendChild(el('div', { class: 'hint', text: '先选一张照片，这里会显示它读到的相机参数。' }))
  }
  else if (!img.exif) {
    body.appendChild(el('div', { class: 'hint', text: '这张图没有读到相机参数（可能被修图软件抹掉了 EXIF）。可以打开「强制」自己填值。' }))
  }

  const buildFieldCard = (field, isCustom) => {
    const card = el('div', { class: 'card' })
    const sw = switchNode(() => field.show !== false, v => { field.show = v })
    const makeChip = () => {
      let text = ''
      if (exifFields.some(f => f.key === field.key) && field.type !== 'img') text = exif[field.key] ? String(exif[field.key]) : ''
      if (field.key === 'Make' && exif.Make) text = exif.Model ? `${exif.Make} · ${exif.Model}` : exif.Make
      if (field.use) text = `覆盖：${field.value || '空'}`
      return el('span', { class: `chip${text ? '' : ' warn'}`, text: text || '无数据' })
    }
    const chip = makeChip()

    const head = el('div', { class: 'card-head' }, [
      sw,
      el('div', { class: 'name' }, [el('div', { text: field.name || field.key }), el('small', { class: 'idx', text: field.key })]),
      chip,
      el('button', { class: 'iconbtn ghost', text: '▾', onclick: () => card.classList.toggle('open') }),
    ])
    card.appendChild(head)

    const valueInput = el('input', { type: 'text', value: field.value || '', placeholder: '自定义值（留空则用图片 EXIF）' })
    valueInput.addEventListener('input', () => {
      field.value = valueInput.value
      field.use = !!valueInput.value
      chip.textContent = field.use ? `覆盖：${field.value || '空'}` : (exif[field.key] ? String(exif[field.key]) : '无数据')
      chip.classList.toggle('warn', !field.use && !exif[field.key])
      changed()
    })

    const forceRow = el('div', { class: 'mini' }, [
      el('label', { text: '强制' }),
      el('div', { class: 'grow', text: '开启后即使图片没参数也用这个值' }),
      switchNode(() => !!field.forceUse, v => { field.forceUse = v; field.use = v || !!field.value; changed() }),
    ])

    const bodyEl = el('div', { class: 'card-body' }, [
      miniRow('值', valueInput),
      forceRow,
      isCustom
        ? el('button', {
            class: 'btn-line',
            text: '删除此字段',
            onclick: () => {
              const i = conf.customTempFields.indexOf(field)
              if (i >= 0) conf.customTempFields.splice(i, 1)
              persistConfig()
              renderTab()
              queuePreview(30)
            },
          })
        : null,
    ])
    card.appendChild(bodyEl)
    return card
  }

  body.appendChild(el('div', { class: 'hint', text: '开关 = 是否印到图上；值 = 覆盖图片里的原始参数；强制 = 没有参数也印。' }))
  for (const f of conf.tempFields) body.appendChild(buildFieldCard(f, false))

  if (conf.customTempFields.length) {
    body.appendChild(el('div', { class: 'hint', text: '自定义字段' }))
    for (const f of conf.customTempFields) body.appendChild(buildFieldCard(f, true))
  }

  body.appendChild(el('button', {
    class: 'btn-line',
    text: '＋ 新增自定义字段',
    onclick: () => openSheet('新增字段', [
      el('div', { class: 'row' }, [el('div', { class: 'k', text: '字段名' }), el('input', { id: 'nf-name', type: 'text', placeholder: '如 地点 / 镜头' })]),
      el('div', { class: 'row' }, [el('div', { class: 'k', text: '值' }), el('input', { id: 'nf-value', type: 'text', placeholder: '如 杭州' })]),
      el('button', {
        class: 'btn-line',
        text: '确定新增',
        onclick: () => {
          const name = ($('#nf-name').value || '').trim()
          const value = ($('#nf-value').value || '').trim()
          if (!name) { toast('请填字段名'); return }
          const key = `c_${uuid()}`
          const item = defFieldItem(value, key, name)
          item.use = !!value
          state.config.customTempFields.push(item)
          persistConfig()
          closeSheet()
          renderTab()
          queuePreview(30)
        },
      }),
    ])
  }))
  return body
}

/* ---------------- 字体 ---------------- */

function buildFontTab() {
  const body = el('div')
  const o = () => state.config.options

  const makeRow = (name, sub, value, extra) => {
    const row = el('div', { class: 'row' }, [
      el('div', { class: 'k' }, [name, el('small', { text: sub })]),
      extra || null,
      el('div', { class: `switch${o().font === value ? ' on' : ''}` }),
    ])
    row.addEventListener('click', (e) => {
      if (e.target.closest('.del-font')) return
      o().font = value
      persistConfig()
      renderTab()
      queuePreview(60)
    })
    return row
  }

  body.appendChild(makeRow('系统默认', '苹方 / Noto Sans CJK', '', null))
  for (const f of state.fonts) {
    const extra = f.source === 'imported'
      ? el('button', {
          class: 'iconbtn ghost del-font',
          text: '删',
          onclick: async (e) => {
            e.stopPropagation()
            await idbDel(f.id || '')
            state.fonts = state.fonts.filter(x => x.name !== f.name)
            if (o().font === f.name) o().font = ''
            persistConfig()
            renderTab()
            queuePreview(30)
            toast('已删除字体')
          },
        })
      : null
    body.appendChild(makeRow(f.name, f.source === 'builtin' ? '内置字体' : '已导入', f.name, extra))
  }

  const fontInput = el('input', { type: 'file', accept: '.ttf,.otf,font/*', hidden: true })
  fontInput.addEventListener('change', () => {
    importFontFile(fontInput.files && fontInput.files[0])
    fontInput.value = ''
  })
  body.appendChild(fontInput)
  body.appendChild(el('button', { class: 'btn-line', text: '＋ 导入字体文件', onclick: () => fontInput.click() }))
  body.appendChild(el('div', { class: 'hint', text: '导入的字体只保存在本机（IndexedDB），不会联网。支持 .ttf / .otf。' }))
  return body
}

/* ---------------- Tab 与 Sheet ---------------- */

function renderTab() {
  const host = $('#tabbody')
  host.innerHTML = ''
  const map = { frame: buildFrameTab, text: buildTextTab, field: buildFieldTab, font: buildFontTab }
  host.appendChild((map[state.tab] || buildFrameTab)())
  for (const b of $('#tabs').children) b.classList.toggle('on', b.dataset.tab === state.tab)
}

function openSheet(title, nodes) {
  $('#sheet-title').textContent = title
  const body = $('#sheet-body')
  body.innerHTML = ''
  for (const n of nodes) if (n) body.appendChild(n)
  $('#sheet').classList.add('on')
}

function closeSheet() {
  $('#sheet').classList.remove('on')
}

/* ---------------- 启动 ---------------- */

function bind() {
  $('#file').addEventListener('change', (e) => {
    addFiles(e.target.files)
    e.target.value = ''
  })

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]')
    if (!b) return
    state.tab = b.dataset.tab
    renderTab()
  })

  $('#btn-render').addEventListener('click', () => doRenderAndSave(false))
  $('#btn-share').addEventListener('click', () => doRenderAndSave(true))
  $('#btn-save').addEventListener('click', async () => {
    if (state.lastBlob) {
      const img = activeImage()
      await saveBlob(state.lastBlob, outName(img || {}), 'gallery').then(p => toast(p ? `已保存：${p.split('/').pop()}` : '已保存', 2200)).catch(err => toast(`保存失败：${err.message}`))
      return
    }
    doRenderAndSave(false)
  })

  $('#sheet-close').addEventListener('click', closeSheet)
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet() })

  $('#btn-more').addEventListener('click', () => {
    openSheet('更多', [
      el('div', { class: 'row' }, [
        el('div', { class: 'k' }, ['壹印 Android', el('small', { text: BRIDGE ? `外壳 v${BRIDGE.version()}` : '浏览器预览模式' })]),
      ]),
      el('div', { class: 'hint', html: '水印算法移植自 <b>ggchivalrous/yiyin</b>（壹印，GPL-3.0）。桌面版用 sharp/ffmpeg，这里全部改成 Canvas 在本机完成，不上传任何图片。' }),
      el('button', {
        class: 'btn-line',
        text: '清空已导入字体',
        onclick: async () => {
          for (const f of state.fonts.filter(x => x.source === 'imported')) await idbDel(f.id)
          await loadFonts()
          if (!state.fonts.some(f => f.name === state.config.options.font)) state.config.options.font = ''
          persistConfig()
          closeSheet()
          renderTab()
          queuePreview(30)
          toast('已清空导入字体')
        },
      }),
      el('button', {
        class: 'btn-line',
        text: '恢复全部默认设置',
        onclick: () => {
          state.config = defaultConfig()
          persistConfig()
          closeSheet()
          renderTab()
          queuePreview(30)
          toast('已恢复默认设置')
        },
      }),
    ])
  })

  window.addEventListener('resize', () => queuePreview(260))

  // 安卓返回键：先关弹层，再交回原生
  window.__yiyinBack = () => {
    if ($('#sheet').classList.contains('on')) { closeSheet(); return true }
    return false
  }

  // 从别的 App 用「壹印」打开图片：原生分块灌 base64 进来
  let incoming = null
  window.__yiyinOpenBegin = (name) => { incoming = { name, parts: [] } }
  window.__yiyinOpenChunk = (chunk) => { if (incoming && chunk) incoming.parts.push(chunk) }
  window.__yiyinOpenEnd = async () => {
    if (!incoming) return
    const { name, parts } = incoming
    incoming = null
    try {
      const bin = atob(parts.join(''))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const type = /\.png$/i.test(name) ? 'image/png' : (/\.(heic|heif)$/i.test(name) ? 'image/heic' : 'image/jpeg')
      await addFiles([new File([bytes], name, { type })])
      state.tab = 'frame'
      renderTab()
    }
    catch (e) {
      console.error(e)
      toast(`打开图片失败：${e.message || e}`)
    }
  }
}

async function boot() {
  bind()
  renderTab()
  try {
    await loadFonts()
    if (state.fonts.length) renderTab()
  }
  catch (e) { console.warn('字体加载失败', e) }
  renderThumbs()
  document.documentElement.classList.add('ready')
  window.__yiyin = { state, addFiles, renderPreview, renderFull, doRenderAndSave, toast }
}

boot()