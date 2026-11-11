// 移植自 common/const/{def-fields,def-temps}.ts + electron/src/config.ts
// 安卓版默认值：与桌面版一致的算法参数，仅去掉窗口布局类选项

export const exifFields = [
  { key: 'PersonalSign', name: '个性签名', value: '' },
  { key: 'Make', name: 'Logo', value: '' },
  { key: 'Model', name: '型号', value: '' },
  { key: 'LensMake', name: '镜头Logo', value: '' },
  { key: 'LensModel', name: '镜头型号', value: '' },
  { key: 'ExposureTime', name: '快门', value: '' },
  { key: 'FNumber', name: '光圈', value: '' },
  { key: 'ISO', name: 'ISO', value: '' },
  { key: 'FocalLength', name: '焦距', value: '' },
  { key: 'FocalLengthIn35mmFormat', name: '等效焦距', value: '' },
  { key: 'ExposureProgram', name: '档位', value: '' },
  { key: 'DateTimeOriginal', name: '拍摄日期', value: '' },
  { key: 'ExposureCompensation', name: '曝光补偿', value: '' },
  { key: 'MeteringMode', name: '测光模式', value: '' },
  { key: 'WhiteBalance', name: '白平衡', value: '' },
]

export function defFont() {
  return {
    use: false,
    bold: false,
    italic: false,
    size: 0,
    font: '',
    caseType: 'default',
    color: '',
  }
}

export function defFieldItem(value = '', key = '', name = '') {
  return {
    key,
    name,
    show: true,
    forceUse: false,
    use: false,
    value,
    type: 'text',
    bImg: '',
    wImg: '',
    font: defFont(),
  }
}

export const defTemps = [
  {
    key: 'make-model',
    name: 'Logo型号模版',
    temp: '{Make} {Model}',
    use: true,
    type: 'system',
    verticalAlign: 'baseline',
    font: { size: 3, font: '', bold: true, italic: false, color: '', caseType: 'default' },
  },
  {
    key: 'exif-params',
    name: '参数模版 - 等效焦距',
    temp: '{FocalLengthIn35mmFormat}mm f/{FNumber} {ExposureTime}s ISO{ISO}',
    use: true,
    type: 'system',
    verticalAlign: 'baseline',
    font: { size: 2.2, font: '', bold: true, italic: false, color: '', caseType: 'default' },
  },
  {
    key: 'exif-params-1',
    name: '参数模版 - 原始焦距',
    temp: '{FocalLength}mm f/{FNumber} {ExposureTime}s ISO{ISO}',
    use: false,
    type: 'system',
    verticalAlign: 'baseline',
    font: { size: 2.2, font: '', bold: true, italic: false, color: '', caseType: 'default' },
  },
]

export function getDefTemp(d) {
  return Object.assign({
    key: '',
    name: '',
    temp: '',
    use: false,
    type: 'custom',
    verticalAlign: 'baseline',
  }, d, {
    font: Object.assign({ size: 2.2, font: '', bold: false, italic: false, color: '', caseType: 'default' }, d && d.font),
  })
}

export const defaultOptions = {
  iot: false,
  landscape: false,
  solid_bg: false,
  solid_color: '#ffffff',
  origin_wh_output: false,
  radius: 2.1,
  radius_show: true,
  shadow: 6,
  shadow_show: true,
  bg_rate_show: false,
  bg_rate: { w: 0, h: 0 },
  font: '',
  main_img_w_rate: 90,
  text_margin: 0.4,
  quality: 100,
  mini_top_bottom_margin: 0,
  bg_blur: 100,
  preview_show: true,
  preview_pane_width_ratio: 0.5,
  preview_pane_height_ratio: 0.85,
  // 安卓新增：输出长边上限（0 = 原图）
  max_long_edge: 3072,
}

export function defaultConfig() {
  return {
    version: 1,
    options: JSON.parse(JSON.stringify(defaultOptions)),
    tempFields: exifFields.map(i => defFieldItem(i.value, i.key, i.name)),
    customTempFields: [],
    temps: defTemps.map(i => getDefTemp(i)),
    font: '',
    importedFonts: [],
  }
}

export function normalizeConfig(conf) {
  const def = defaultConfig()
  const out = Object.assign({}, def, conf || {})
  out.options = Object.assign({}, def.options, (conf && conf.options) || {})
  out.options.bg_rate = Object.assign({}, def.options.bg_rate, (conf && conf.options && conf.options.bg_rate) || {})
  if (!Array.isArray(out.tempFields) || !out.tempFields.length) out.tempFields = def.tempFields
  if (!Array.isArray(out.customTempFields)) out.customTempFields = []
  if (!Array.isArray(out.temps) || !out.temps.length) out.temps = def.temps
  if (!Array.isArray(out.importedFonts)) out.importedFonts = []
  // 补齐缺失的预设字段 / 系统模板（与桌面版 getConfig 的补齐逻辑一致）
  const fieldKeys = out.tempFields.map(i => i.key)
  for (const f of def.tempFields) {
    if (!fieldKeys.includes(f.key)) out.tempFields.push(f)
  }
  const tempKeys = out.temps.map(i => i.key)
  for (const t of def.temps) {
    if (!tempKeys.includes(t.key)) out.temps.push(getDefTemp(t))
  }
  return out
}