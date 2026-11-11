// 移植自 electron/src/modules/exiftool/index.ts + common/modules/exif-format/*
// 桌面版靠外部 exiftool 二进制；安卓版改用纯 JS 的 ExifReader（vendor/exif-reader.js）

/* global ExifReader */

function pick(tag) {
  if (!tag) return ''
  if (tag.description !== undefined && tag.description !== null && tag.description !== '') return tag.description
  if (tag.value !== undefined) {
    if (Array.isArray(tag.value)) return tag.value.join(', ')
    return tag.value
  }
  return ''
}

function num(tag) {
  if (!tag) return ''
  let v = tag.value
  if (Array.isArray(v)) {
    if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && v[1] !== 0) v = v[0] / v[1]
    else v = v[0]
  }
  const n = Number(v)
  if (Number.isFinite(n)) return n
  // 退化成从 description 里抠数字（如 "f/7.1"、"135 mm"）
  const m = String(tag.description || '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : ''
}

function fmtDate(str) {
  // "2024:05:01 12:00:00" / "2024-05-01T12:00:00" → "2024/05/01 12:00:00"
  if (!str) return ''
  const m = String(str).match(/(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return String(str)
  return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}:${m[6]}`
}

function mapExposureProgram(tag) {
  const d = String(pick(tag) || '')
  const n = num(tag)
  const low = d.toLowerCase()
  if (low.includes('manual')) return 'M'
  if (low.includes('aperture')) return 'A'
  if (low.includes('shutter')) return 'S'
  if (low.includes('auto')) return 'Auto'
  if (low.includes('program')) return 'P'
  switch (n) {
    case 0: return 'Auto'
    case 1: return 'M'
    case 2: return 'P'
    case 3: return 'A'
    case 4: return 'S'
    default: return d
  }
}

function mapMeteringMode(tag) {
  const d = String(pick(tag) || '').toLowerCase()
  if (!d) return ''
  if (d.includes('multi') || d.includes('evaluative') || d.includes('pattern')) return '评价测光'
  if (d.includes('spot')) return '点测光'
  if (d.includes('partial')) return '局部测光'
  if (d.includes('average') && d.includes('center')) return '中央重点测光'
  if (d.includes('average')) return '平均测光'
  if (d.includes('highlight')) return '斑马测光'
  return ''
}

function mapWhiteBalance(tag) {
  const d = String(pick(tag) || '')
  const low = d.toLowerCase()
  if (!d) return ''
  if (low.includes('auto')) return 'Auto'
  if (low.includes('manual')) return '手动'
  return d
}

function fmtExposureCompensation(tag) {
  if (!tag) return ''
  const n = num(tag)
  if (n === '' ) return ''
  if (n === 0) return '0'
  return n > 0 ? `+${n}` : `${n}`
}

export function parseExif(buffer) {
  let tags = {}
  try {
    tags = ExifReader.load(buffer, { expanded: false }) || {}
  }
  catch (e) {
    console.warn('EXIF 解析失败', e)
    return null
  }

  const exif = {
    Make: String(pick(tags.Make) || '').trim(),
    Model: String(pick(tags.Model) || '').trim(),
    LensMake: String(pick(tags.LensMake) || '').trim(),
    LensModel: String(pick(tags.LensModel) || '').trim(),
    FNumber: (() => {
      const n = num(tags.FNumber)
      if (n !== '') return String(n)
      const d = String(pick(tags.FNumber) || '').replace(/^f\/?/i, '')
      return d
    })(),
    ISO: String(pick(tags.ISOSpeedRatings) || pick(tags.PhotographicSensitivity) || pick(tags.ISOSpeed) || '').replace(/^ISO\s*/i, ''),
    FocalLength: (() => {
      const n = num(tags.FocalLength)
      if (n !== '') return String(Math.round(n))
      return String(pick(tags.FocalLength) || '').replace(/[^\d.]/g, '').split('.')[0]
    })(),
    FocalLengthIn35mmFormat: (() => {
      const n = num(tags.FocalLengthIn35mmFormat)
      if (n !== '') return String(Math.round(n))
      const fb = num(tags.FocalLength)
      return fb !== '' ? String(Math.round(fb)) : ''
    })(),
    ExposureTime: (() => {
      const d = String(pick(tags.ExposureTime) || '')
      if (d && !/^[\d.]+$/.test(d)) return d
      const n = num(tags.ExposureTime)
      if (n === '') return d
      return n < 1 ? `1/${Math.round(1 / n)}` : String(n)
    })(),
    DateTimeOriginal: fmtDate(pick(tags.DateTimeOriginal) || pick(tags.CreateDate) || ''),
    ExposureCompensation: fmtExposureCompensation(tags.ExposureBiasValue || tags.ExposureCompensation),
    WhiteBalance: mapWhiteBalance(tags.WhiteBalance),
    ExposureProgram: mapExposureProgram(tags.ExposureProgram),
    MeteringMode: mapMeteringMode(tags.MeteringMode),
    Orientation: num(tags.Orientation) || 1,
    ImageWidth: num(tags['Image Width']) || num(tags.ImageWidth) || 0,
    ImageHeight: num(tags['Image Height']) || num(tags.ImageHeight) || 0,
  }

  const meaningful = ['Make', 'Model', 'LensMake', 'LensModel', 'ExposureTime', 'FNumber', 'ISO',
    'FocalLength', 'FocalLengthIn35mmFormat', 'ExposureProgram', 'DateTimeOriginal',
    'ExposureCompensation', 'MeteringMode', 'WhiteBalance']
  if (meaningful.every(k => exif[k] === '' || exif[k] === undefined)) return null

  return exif
}

// ---- ExifFormat 移植 ----

function toRoman(num) {
  const table = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let out = ''
  for (const [v, s] of table) {
    while (num >= v) { out += s; num -= v }
  }
  return out
}

class ExifBase {
  constructor(exif) {
    this.exif = exif || {}
  }

  Make(v = this.exif.Make) {
    return v ? v[0] + v.slice(1).toLowerCase() : ''
  }

  Model(v = this.exif.Model) {
    return v ? v.toLowerCase() : ''
  }

  DateTimeOriginal(v = this.exif.DateTimeOriginal) { return v }

  ExposureTime(v = this.exif.ExposureTime) {
    if (!v) return ''
    if (+v < 1 && +v > 0 && Number.isFinite(+v)) return `1/${Math.round(1 / +v)}`
    return v
  }

  FNumber(v = this.exif.FNumber) { return v }

  FocalLength(v = this.exif.FocalLength) { return v ? Math.round(+v) : '' }

  FocalLengthIn35mmFormat(v = this.exif.FocalLengthIn35mmFormat) { return v ? Math.round(+v) : '' }

  ISO(v = this.exif.ISO) { return v || '' }

  ExposureProgram(v = this.exif.ExposureProgram) { return v }

  LensModel() { return this.exif.LensModel || '' }

  LensMake() { return this.exif.LensMake || '' }

  ExposureCompensation() { return this.exif.ExposureCompensation }

  MeteringMode() { return this.exif.MeteringMode }

  Flash() { return '' }

  ExposureMode() { return '' }

  WhiteBalance() { return this.exif.WhiteBalance }
}

class NikonExif extends ExifBase {
  Model() {
    const raw = this.exif.Model || ''
    let v = raw.replace((this.exif.Make || '').toUpperCase(), '').replace(/Z/gi, 'ℤ')
    const arr = v.split('_')
    if (arr.length > 1) {
      const i = arr.pop()
      if (i && !Number.isNaN(+i)) return `${arr.join(' ')} ${toRoman(+i)}`.trim()
      return `${arr.join(' ')} ${i}`.trim()
    }
    return v.trim()
  }
}

class SonyExif extends ExifBase {
  Model() {
    return String(this.exif.Model || '').replace('ILCE-', 'α').toLowerCase()
  }
}

export class ExifFormat {
  constructor(exif) {
    this.exif = exif || {}
    if (this.exif.Make) this.exif.Make = String(this.exif.Make).replace('CORPORATION', '').trim()
    const map = { NIKON: NikonExif, SONY: SonyExif }
    const Cls = map[this.exif.Make]
    this.exifIns = Cls ? new Cls(this.exif) : new ExifBase(this.exif)
  }

  get _() { return this.exifIns }

  get oriExif() { return this.exif }
}