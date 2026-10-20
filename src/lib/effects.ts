export type EffectId = 'original' | 'grain' | 'blackWhite' | 'halftone' | 'dithering' | 'pixelate' | 'edgeDetection' | 'sketch' | 'posterize' | 'chrome' | 'xray' | 'thermalVision' | 'ascii' | 'clayRender' | 'rootRot' | 'madness'
export type ProcessingEffectId = Exclude<EffectId, 'original'>
const processingEffectIds: ProcessingEffectId[] = ['grain', 'blackWhite', 'halftone', 'dithering', 'pixelate', 'edgeDetection', 'sketch', 'posterize', 'chrome', 'xray', 'thermalVision', 'ascii', 'clayRender', 'rootRot', 'madness']

export function isProcessingEffectId(value: unknown): value is ProcessingEffectId {
  return typeof value === 'string' && processingEffectIds.includes(value as ProcessingEffectId)
}

export type EffectSettings = {
  grain: { amount: number; size: number; monochrome: boolean }
  blackWhite: { contrast: number }
  halftone: { size: number; angle: number; contrast: number }
  dithering: { levels: number; intensity: number }
  pixelate: { size: number }
  edgeDetection: { threshold: number; strength: number }
  sketch: { detail: number; intensity: number }
  posterize: { levels: number; contrast: number }
  chrome: { mode: 'photo' | 'graphic'; intensity: number; contrast: number; reflections: number }
  xray: { intensity: number; contrast: number; edgeDetail: number; glow: number; threshold: number; invert: boolean }
  thermalVision: { intensity: number; contrast: number; heatSensitivity: number; smoothing: number; monochrome: boolean }
  clayRender: { intensity: number; smoothness: number; relief: number; lighting: number; contrast: number }
  ascii: { cellSize: number; contrast: number; intensity: number; color: boolean; invert: boolean }
  rootRot: { threshold: number; joinParts: number; bodySwell: number; roughness: number; breathingRoom: number; guardGaps: number; protectOpenings: boolean; spikes: number }
  madness: { density: number; cloudSize: number; minParticleSize: number; maxParticleSize: number; chaos: number; grain: number; threshold: number; contrast: number; detail: number; seed: number }
}

export type EffectStackItem = {
  id: string
  effect: ProcessingEffectId
  settings: EffectSettings
  enabled: boolean
}

export const defaultEffectSettings: EffectSettings = {
  grain: { amount: 28, size: 1, monochrome: true },
  blackWhite: { contrast: 0 },
  halftone: { size: 8, angle: 45, contrast: 12 },
  dithering: { levels: 4, intensity: 72 },
  pixelate: { size: 10 },
  edgeDetection: { threshold: 70, strength: 100 },
  sketch: { detail: 7, intensity: 85 },
  posterize: { levels: 5, contrast: 0 },
  chrome: { mode: 'graphic', intensity: 82, contrast: 18, reflections: 5 },
  xray: { intensity: 88, contrast: 42, edgeDetail: 58, glow: 18, threshold: 0, invert: false },
  thermalVision: { intensity: 100, contrast: 18, heatSensitivity: 50, smoothing: 12, monochrome: false },
  clayRender: { intensity: 92, smoothness: 58, relief: 48, lighting: 68, contrast: 4 },
  ascii: { cellSize: 8, contrast: 18, intensity: 100, color: false, invert: false },
  rootRot: { threshold: 144, joinParts: 1.5, bodySwell: 0.7, roughness: 0.35, breathingRoom: 0.5, guardGaps: 4, protectOpenings: true, spikes: 44 },
  madness: { density: 2400, cloudSize: 1.15, minParticleSize: 1, maxParticleSize: 5, chaos: 0.55, grain: 72, threshold: 172, contrast: 32, detail: 68, seed: 1 },
}

const MAX_PREVIEW_EDGE = 1800
const MAX_PREVIEW_PIXELS = 2_000_000
const MAX_EXPORT_PIXELS = 64_000_000
const bayer4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]

export function createEffectStackItem(effect: ProcessingEffectId): EffectStackItem {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    effect,
    settings: cloneDefaultSettings(),
    enabled: true,
  }
}

export function cloneDefaultSettings(): EffectSettings {
  return {
    grain: { ...defaultEffectSettings.grain },
    blackWhite: { ...defaultEffectSettings.blackWhite },
    halftone: { ...defaultEffectSettings.halftone },
    dithering: { ...defaultEffectSettings.dithering },
    pixelate: { ...defaultEffectSettings.pixelate },
    edgeDetection: { ...defaultEffectSettings.edgeDetection },
    sketch: { ...defaultEffectSettings.sketch },
    posterize: { ...defaultEffectSettings.posterize },
    chrome: { ...defaultEffectSettings.chrome },
    xray: { ...defaultEffectSettings.xray },
    thermalVision: { ...defaultEffectSettings.thermalVision },
    clayRender: { ...defaultEffectSettings.clayRender },
    ascii: { ...defaultEffectSettings.ascii },
    rootRot: { ...defaultEffectSettings.rootRot },
    madness: { ...defaultEffectSettings.madness },
  }
}

/** Creates a reduced canvas for responsive on-screen previews. */
export async function renderEffectPreview(sourceUrl: string, stack: EffectStackItem[]): Promise<string> {
  const canvas = await renderCanvas(sourceUrl, stack, true)
  return canvas.toDataURL('image/png')
}

/** The canonical full-resolution raster used by export and vector tracing. */
export async function renderProcessedCanvas(sourceUrl: string, stack: EffectStackItem[]): Promise<HTMLCanvasElement> {
  return renderCanvas(sourceUrl, stack, false)
}

/** Renders from the source file at its native dimensions, then encodes a download-ready Blob. */
export async function exportProcessedImage(sourceUrl: string, stack: EffectStackItem[], format: 'png' | 'jpeg', quality: number): Promise<Blob> {
  try {
    const canvas = await renderProcessedCanvas(sourceUrl, stack)
    const exportCanvas = format === 'jpeg' ? flattenOnWhite(canvas) : canvas
    const blob = await canvasToBlob(exportCanvas, format === 'png' ? 'image/png' : 'image/jpeg', quality)
    if (!blob) throw new Error('Your browser could not encode this image.')
    return blob
  } catch (error) {
    if (error instanceof Error && error.message) throw error
    throw new Error('Export failed. Try a smaller image or fewer effects.')
  }
}

async function renderCanvas(sourceUrl: string, stack: EffectStackItem[], preview: boolean): Promise<HTMLCanvasElement> {
  const source = await loadSourceImage(sourceUrl)
  const sourcePixels = source.naturalWidth * source.naturalHeight
  if (!preview && sourcePixels > MAX_EXPORT_PIXELS) {
    throw new Error('This image is too large to export in this browser. Please use an image below 64 megapixels.')
  }
  const { width, height } = preview ? previewDimensions(source.naturalWidth, source.naturalHeight) : { width: source.naturalWidth, height: source.naturalHeight }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas processing is not supported in this browser.')
  context.drawImage(source, 0, 0, width, height)
  for (const item of stack) if (item.enabled) applyEffect(context, width, height, item)
  return canvas
}

function applyEffect(context: CanvasRenderingContext2D, width: number, height: number, item: EffectStackItem) {
  if (item.effect === 'grain') applyGrain(context, width, height, item.settings.grain)
  if (item.effect === 'blackWhite') applyBlackWhite(context, width, height, item.settings.blackWhite.contrast)
  if (item.effect === 'halftone') applyHalftone(context, width, height, item.settings.halftone)
  if (item.effect === 'dithering') applyDithering(context, width, height, item.settings.dithering)
  if (item.effect === 'pixelate') applyPixelate(context, width, height, item.settings.pixelate.size)
  if (item.effect === 'edgeDetection') applyEdgeDetection(context, width, height, item.settings.edgeDetection)
  if (item.effect === 'sketch') applySketch(context, width, height, item.settings.sketch)
  if (item.effect === 'posterize') applyPosterize(context, width, height, item.settings.posterize)
  if (item.effect === 'chrome') applyChrome(context, width, height, item.settings.chrome)
  if (item.effect === 'xray') applyXray(context, width, height, item.settings.xray)
  if (item.effect === 'thermalVision') applyThermalVision(context, width, height, item.settings.thermalVision)
  if (item.effect === 'ascii') applyAscii(context, width, height, item.settings.ascii)
  if (item.effect === 'clayRender') applyClayRender(context, width, height, item.settings.clayRender)
  if (item.effect === 'rootRot') applyRootRot(context, width, height, item.settings.rootRot)
  if (item.effect === 'madness') applyMadness(context, width, height, item.settings.madness)
}

function loadSourceImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The original image could not be read.'))
    image.src = url
  })
}

function previewDimensions(sourceWidth: number, sourceHeight: number) {
  const edgeScale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(sourceWidth, sourceHeight))
  const pixelScale = Math.min(1, Math.sqrt(MAX_PREVIEW_PIXELS / (sourceWidth * sourceHeight)))
  const scale = Math.min(edgeScale, pixelScale)
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) }
}

function applyGrain(context: CanvasRenderingContext2D, width: number, height: number, settings: EffectSettings['grain']) {
  const imageData = context.getImageData(0, 0, width, height)
  const { data } = imageData
  const amplitude = settings.amount * 0.52
  const cellSize = Math.max(1, settings.size)
  const cellColumns = Math.ceil(width / cellSize)
  const noise = new Float32Array(cellColumns * Math.ceil(height / cellSize))
  for (let index = 0; index < noise.length; index += 1) noise[index] = (Math.random() * 2 - 1) * amplitude
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4
    const grain = noise[Math.floor(y / cellSize) * cellColumns + Math.floor(x / cellSize)]
    data[index] = clamp(data[index] + grain)
    data[index + 1] = clamp(data[index + 1] + (settings.monochrome ? grain : grain * (0.65 + Math.random() * 0.7)))
    data[index + 2] = clamp(data[index + 2] + (settings.monochrome ? grain : grain * (0.65 + Math.random() * 0.7)))
  }
  context.putImageData(imageData, 0, 0)
}

function applyBlackWhite(context: CanvasRenderingContext2D, width: number, height: number, contrast: number) {
  const imageData = context.getImageData(0, 0, width, height)
  const { data } = imageData
  const factor = Math.pow((contrast + 100) / 100, 2)
  for (let index = 0; index < data.length; index += 4) {
    const luminance = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722
    const adjusted = clamp(((luminance / 255 - 0.5) * factor + 0.5) * 255)
    data[index] = adjusted
    data[index + 1] = adjusted
    data[index + 2] = adjusted
  }
  context.putImageData(imageData, 0, 0)
}

function applyHalftone(context: CanvasRenderingContext2D, width: number, height: number, settings: EffectSettings['halftone']) {
  const source = context.getImageData(0, 0, width, height)
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const target = output.getContext('2d')
  if (!target) return
  target.fillStyle = '#f7f4eb'
  target.fillRect(0, 0, width, height)
  target.fillStyle = '#111416'
  const radians = settings.angle * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const cell = settings.size
  const diagonal = Math.sqrt(width * width + height * height)
  const halfWidth = width / 2
  const halfHeight = height / 2
  const contrastFactor = Math.pow((settings.contrast + 100) / 100, 2)
  for (let gridY = -diagonal / 2; gridY <= diagonal / 2; gridY += cell) for (let gridX = -diagonal / 2; gridX <= diagonal / 2; gridX += cell) {
    const x = gridX * cosine - gridY * sine + halfWidth
    const y = gridX * sine + gridY * cosine + halfHeight
    if (x < 0 || x >= width || y < 0 || y >= height) continue
    const luminance = sampleLuminance(source, width, height, x, y, Math.max(1, Math.floor(cell / 4)))
    const adjusted = clamp(((luminance / 255 - 0.5) * contrastFactor + 0.5) * 255)
    const radius = (1 - adjusted / 255) * cell * 0.58
    if (radius < 0.3) continue
    target.beginPath()
    target.arc(x, y, radius, 0, Math.PI * 2)
    target.fill()
  }
  target.globalCompositeOperation = 'destination-in'
  target.drawImage(context.canvas, 0, 0)
  context.clearRect(0, 0, width, height)
  context.drawImage(output, 0, 0)
}

function applyDithering(context: CanvasRenderingContext2D, width: number, height: number, settings: EffectSettings['dithering']) {
  const imageData = context.getImageData(0, 0, width, height)
  const { data } = imageData
  const levels = settings.levels - 1
  const step = 255 / levels
  const intensity = settings.intensity / 100
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4
    const threshold = (bayer4[y % 4][x % 4] + 0.5) / 16 - 0.5
    for (let channel = 0; channel < 3; channel += 1) {
      const original = data[index + channel]
      const quantized = clamp(Math.round((original + threshold * step * intensity) / step) * step)
      data[index + channel] = original + (quantized - original) * intensity
    }
  }
  context.putImageData(imageData, 0, 0)
}

function applyPixelate(context: CanvasRenderingContext2D, width: number, height: number, size: number) {
  const scaled = document.createElement('canvas')
  scaled.width = Math.max(1, Math.ceil(width / size))
  scaled.height = Math.max(1, Math.ceil(height / size))
  const scaledContext = scaled.getContext('2d')
  if (!scaledContext) return
  scaledContext.imageSmoothingEnabled = true
  scaledContext.drawImage(context.canvas, 0, 0, scaled.width, scaled.height)
  context.clearRect(0, 0, width, height)
  context.imageSmoothingEnabled = false
  context.drawImage(scaled, 0, 0, scaled.width, scaled.height, 0, 0, width, height)
}

function applyEdgeDetection(context: CanvasRenderingContext2D, width: number, height: number, settings: EffectSettings['edgeDetection']) {
  const imageData = context.getImageData(0, 0, width, height)
  const source = new Uint8ClampedArray(imageData.data)
  const luminance = new Float32Array(width * height)
  for (let index = 0, pixel = 0; index < source.length; index += 4, pixel += 1) luminance[pixel] = source[index] * 0.2126 + source[index + 1] * 0.7152 + source[index + 2] * 0.0722
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const gx = sampleLuma(luminance, width, height, x + 1, y - 1) + 2 * sampleLuma(luminance, width, height, x + 1, y) + sampleLuma(luminance, width, height, x + 1, y + 1) - sampleLuma(luminance, width, height, x - 1, y - 1) - 2 * sampleLuma(luminance, width, height, x - 1, y) - sampleLuma(luminance, width, height, x - 1, y + 1)
    const gy = sampleLuma(luminance, width, height, x - 1, y + 1) + 2 * sampleLuma(luminance, width, height, x, y + 1) + sampleLuma(luminance, width, height, x + 1, y + 1) - sampleLuma(luminance, width, height, x - 1, y - 1) - 2 * sampleLuma(luminance, width, height, x, y - 1) - sampleLuma(luminance, width, height, x + 1, y - 1)
    const magnitude = Math.sqrt(gx * gx + gy * gy) / 4
    const edge = clamp((magnitude - settings.threshold) * settings.strength / 100)
    const index = (y * width + x) * 4
    const shade = 255 - edge
    imageData.data[index] = shade
    imageData.data[index + 1] = shade
    imageData.data[index + 2] = shade
    imageData.data[index + 3] = source[index + 3]
  }
  context.putImageData(imageData, 0, 0)
}

function applySketch(context: CanvasRenderingContext2D, width: number, height: number, settings: EffectSettings['sketch']) {
  const imageData = context.getImageData(0, 0, width, height)
  const { data } = imageData
  const pixelCount = width * height
  const grayscale = new Float32Array(pixelCount)
  const inverted = new Float32Array(pixelCount)
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    grayscale[pixel] = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722
    inverted[pixel] = 255 - grayscale[pixel]
  }
  const blurred = boxBlur(inverted, width, height, Math.max(1, 13 - settings.detail))
  const intensity = settings.intensity / 100
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    const dodge = blurred[pixel] >= 254.5 ? 255 : Math.min(255, grayscale[pixel] * 255 / (255 - blurred[pixel]))
    const shade = grayscale[pixel] + (dodge - grayscale[pixel]) * intensity
    data[index] = shade
    data[index + 1] = shade
    data[index + 2] = shade
  }
  context.putImageData(imageData, 0, 0)
}

function applyPosterize(context: CanvasRenderingContext2D, width: number, height: number, settings: EffectSettings['posterize']) {
  const imageData = context.getImageData(0, 0, width, height)
  const { data } = imageData
  const step = 255 / (settings.levels - 1)
  const contrast = Math.pow((settings.contrast + 100) / 100, 2)
  for (let index = 0; index < data.length; index += 4) for (let channel = 0; channel < 3; channel += 1) {
    const adjusted = clamp(((data[index + channel] / 255 - 0.5) * contrast + 0.5) * 255)
    data[index + channel] = clamp(Math.round(adjusted / step) * step)
  }
  context.putImageData(imageData, 0, 0)
}


/**
 * Creates a metallic chrome treatment. Photo mode keeps more of the source's
 * tonal structure; Graphic mode pushes tones into sharper black/white reflections.
 */
function applyChrome(context: CanvasRenderingContext2D, width: number, height: number, settings: EffectSettings['chrome']) {
  const imageData = context.getImageData(0, 0, width, height)
  const data = imageData.data
  const source = new Uint8ClampedArray(data)
  const pixelCount = width * height
  const luminance = new Float32Array(pixelCount)
  const intensity = settings.intensity / 100
  const contrast = Math.pow((settings.contrast + 100) / 100, 2)
  const reflections = Math.max(1, Math.min(10, settings.reflections))
  const graphic = settings.mode === 'graphic'

  // Map reflections from each pixel's own tone, not its vertical canvas position.
  for (let pixel = 0, index = 0; pixel < pixelCount; pixel += 1, index += 4) {
    luminance[pixel] = (source[index] * 0.2126 + source[index + 1] * 0.7152 + source[index + 2] * 0.0722) / 255
  }

  const sample = (x: number, y: number) => luminance[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))]
  const tonalFrequency = Math.PI * (1.4 + reflections * 0.48)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x
      const index = pixel * 4
      const originalLuma = luminance[pixel]
      const tonal = Math.max(0, Math.min(1, (originalLuma - 0.5) * contrast + 0.5))

      // Chrome's alternating highlight/shadow ramps are driven by source tone,
      // so they conform to the artwork instead of covering the entire canvas.
      const ramp = (Math.cos(tonal * tonalFrequency * 2 + 0.7) + 1) * 0.5
      const sharpRamp = Math.pow(ramp, graphic ? 2.3 : 1.55)
      const base = graphic ? Math.pow(tonal, 0.72) : tonal * 0.62 + Math.pow(tonal, 0.82) * 0.38
      let chrome = base * 0.48 + sharpRamp * 0.52

      // Subtle local-gradient highlights help preserve the shape and edge detail.
      const gx = sample(x + 1, y) - sample(x - 1, y)
      const gy = sample(x, y + 1) - sample(x, y - 1)
      const edge = Math.min(1, Math.sqrt(gx * gx + gy * gy) * (graphic ? 2.8 : 1.8))
      chrome = Math.max(0, Math.min(1, chrome + edge * (tonal > 0.48 ? 0.16 : 0.08)))

      if (graphic) {
        chrome = Math.max(0, Math.min(1, (chrome - 0.5) * 2.15 + 0.5))
      } else {
        chrome = chrome * 0.72 + tonal * 0.28
      }

      const chromeValue = chrome * 255
      const outputLuma = originalLuma * 255 + (chromeValue - originalLuma * 255) * intensity
      const colorRetention = graphic ? 0 : 0.16 * (1 - intensity)
      data[index] = outputLuma + (source[index] - originalLuma * 255) * colorRetention
      data[index + 1] = outputLuma + (source[index + 1] - originalLuma * 255) * colorRetention
      data[index + 2] = outputLuma + (source[index + 2] - originalLuma * 255) * colorRetention
      data[index + 3] = source[index + 3]
    }
  }
  context.putImageData(imageData, 0, 0)
}


/** Monochrome X-ray treatment: dark field, inverted tonal structure, edge detail and restrained phosphor-like glow. */
function applyXray(context: CanvasRenderingContext2D, width: number, height: number, settings: EffectSettings['xray']) {
  const imageData = context.getImageData(0, 0, width, height)
  const source = new Uint8ClampedArray(imageData.data)
  const pixelCount = width * height
  const luminance = new Float32Array(pixelCount)
  const intensity = settings.intensity / 100
  const contrast = Math.pow((settings.contrast + 100) / 100, 2)
  const edgeStrength = settings.edgeDetail / 100
  const threshold = settings.threshold

  for (let pixel = 0, index = 0; pixel < pixelCount; pixel += 1, index += 4) {
    luminance[pixel] = source[index] * 0.2126 + source[index + 1] * 0.7152 + source[index + 2] * 0.0722
  }

  const edgeMap = new Float32Array(pixelCount)
  const tonalMap = new Float32Array(pixelCount)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x
      const left = luminance[y * width + Math.max(0, x - 1)]
      const right = luminance[y * width + Math.min(width - 1, x + 1)]
      const top = luminance[Math.max(0, y - 1) * width + x]
      const bottom = luminance[Math.min(height - 1, y + 1) * width + x]
      const edge = Math.min(255, Math.sqrt((right - left) ** 2 + (bottom - top) ** 2) * 1.15)
      edgeMap[pixel] = edge
      const original = luminance[pixel]
      const tone = settings.invert ? original : 255 - original
      tonalMap[pixel] = clamp(((tone / 255 - 0.5) * contrast + 0.5) * 255)
    }
  }

  const glowRadius = Math.max(1, Math.min(10, Math.round(settings.glow / 10)))
  const glowMap = settings.glow > 0 ? boxBlur(tonalMap, width, height, glowRadius) : tonalMap
  const data = imageData.data
  for (let pixel = 0, index = 0; pixel < pixelCount; pixel += 1, index += 4) {
    let shade = tonalMap[pixel] * 0.76 + edgeMap[pixel] * edgeStrength * 0.95
    if (settings.glow > 0) shade += glowMap[pixel] * (settings.glow / 100) * 0.58
    if (threshold > 0) shade = shade >= threshold ? 255 : shade * 0.12
    shade = clamp(shade)
    const finalShade = source[index] * (1 - intensity) + shade * intensity
    data[index] = finalShade
    data[index + 1] = finalShade
    data[index + 2] = finalShade
    data[index + 3] = source[index + 3]
  }
  context.putImageData(imageData, 0, 0)
}

function applyThermalVision(context: CanvasRenderingContext2D, width: number, height: number, settings: EffectSettings['thermalVision']) {
  const imageData = context.getImageData(0, 0, width, height)
  const data = imageData.data
  const count = width * height
  const intensity = settings.intensity / 100
  const contrast = 1 + settings.contrast / 100
  const sensitivity = settings.heatSensitivity / 100
  const luma = new Float32Array(count)

  // Estimate heat from image luminance, then remap it through a thermal-camera palette.
  // Sensitivity shifts the heat range; smoothing softens noisy transitions without losing detail.
  for (let pixel = 0, index = 0; pixel < count; pixel += 1, index += 4) {
    const gray = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722
    const centered = (gray / 255 - 0.5) * contrast + 0.5
    luma[pixel] = clamp((centered - 0.5) * (1.35 + sensitivity * 1.3) * 255 + 127.5 - sensitivity * 30)
  }
  const radius = Math.round(settings.smoothing / 20)
  const heat = radius > 0 ? boxBlur(luma, width, height, radius) : luma
  const palette: [number, number, number, number][] = [
    [0, 0, 0, 35],       // near-black / cold
    [22, 9, 90, 75],      // deep violet
    [20, 38, 180, 115],   // blue
    [0, 185, 220, 155],   // cyan
    [30, 220, 100, 190],  // green
    [245, 230, 30, 220],  // yellow
    [255, 125, 15, 245],  // orange
    [225, 20, 20, 255],   // red
    [255, 245, 220, 255], // hottest white
  ]
  for (let pixel = 0, index = 0; pixel < count; pixel += 1, index += 4) {
    const position = (heat[pixel] / 255) * (palette.length - 1)
    const segment = Math.min(palette.length - 2, Math.floor(position))
    const mix = position - segment
    const a = palette[segment]
    const b = palette[segment + 1]
    const thermalR = a[0] + (b[0] - a[0]) * mix
    const thermalG = a[1] + (b[1] - a[1]) * mix
    const thermalB = a[2] + (b[2] - a[2]) * mix
    const thermalGray = settings.monochrome ? heat[pixel] : thermalR * 0.2126 + thermalG * 0.7152 + thermalB * 0.0722
    const targetR = settings.monochrome ? thermalGray : thermalR
    const targetG = settings.monochrome ? thermalGray : thermalG
    const targetB = settings.monochrome ? thermalGray : thermalB
    data[index] = data[index] * (1 - intensity) + targetR * intensity
    data[index + 1] = data[index + 1] * (1 - intensity) + targetG * intensity
    data[index + 2] = data[index + 2] * (1 - intensity) + targetB * intensity
    // Preserve transparent pixels while making visible cold regions nearly black.
    data[index + 3] = data[index + 3]
  }
  context.putImageData(imageData, 0, 0)
}

/**
 * A local, model-free fallback for clay rendering.  It deliberately estimates
 * *broad* shape rather than running an edge filter: gradients are sampled from
 * a low-frequency height field, while a separate mid-frequency field preserves
 * folds and facial features. This is the path used when a device has no bundled
 * monocular-depth runtime available, so source pixels never leave the browser.
 */
function applyClayRender(context: CanvasRenderingContext2D, width: number, height: number, settings: EffectSettings['clayRender']) {
  const image = context.getImageData(0, 0, width, height)
  const { data } = image
  const count = width * height
  const source = new Float32Array(count)
  const intensity = settings.intensity / 100
  const smoothness = settings.smoothness / 100
  const relief = settings.relief / 100
  const lighting = settings.lighting / 100
  const contrast = settings.contrast / 100

  for (let pixel = 0, index = 0; pixel < count; pixel += 1, index += 4) {
    source[pixel] = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722
  }

  const shortSide = Math.max(1, Math.min(width, height))
  // Three smooth scales split source tone into material form, soft features,
  // and broad scene illumination. The normal field never sees raw pixels.
  const denoiseRadius = Math.max(1, Math.round(shortSide * (0.0015 + smoothness * 0.004)))
  const featureRadius = Math.max(2, Math.round(shortSide * (0.005 + smoothness * 0.008)))
  const formRadius = Math.max(featureRadius + 2, Math.round(shortSide * (0.03 + smoothness * 0.02)))
  const denoised = blurTwice(source, width, height, denoiseRadius)
  const features = blurTwice(denoised, width, height, featureRadius)
  const broad = blurTwice(features, width, height, formRadius)
  const normalStep = Math.max(1, Math.round(shortSide * 0.008))

  // A large, diffuse upper-left studio softbox. High ambient light keeps the
  // background neutral gray and prevents black embossed contours.
  const [lx, ly, lz] = normalize3(-0.46, -0.55, 0.70)
  const reliefScale = (0.38 + relief * 1.4) / 255
  const ambient = 0.66 + (1 - lighting) * 0.12
  const diffuseAmount = 0.18 + lighting * 0.28
  const sourceToneAmount = 0.46 + relief * 0.10
  const cavityAmount = 0.05 + relief * 0.10
  const featureAmount = 0.24 + (1 - smoothness) * 0.24

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x
      const index = pixel * 4
      const form = broad[pixel]
      const mid = denoised[pixel] - form
      const cavity = Math.max(0, form - denoised[pixel])

      // Surface normals come from the broad height field only. This is the key
      // distinction from embossing: fine edges cannot become dark outlines.
      const dx = sampleLuma(broad, width, height, x + normalStep, y) - sampleLuma(broad, width, height, x - normalStep, y)
      const dy = sampleLuma(broad, width, height, x, y + normalStep) - sampleLuma(broad, width, height, x, y - normalStep)
      const [nx, ny, nz] = normalize3(-dx * reliefScale, -dy * reliefScale, 1)
      const lambert = Math.max(0, nx * lx + ny * ly + nz * lz)
      const broadLight = ambient + lambert * diffuseAmount
      const discontinuity = clamp((Math.abs(mid) - 18) / 48)
      const surfaceWeight = 1 - discontinuity * 0.88
      const highlight = Math.pow(Math.max(0, lambert - 0.52) / 0.48, 2.6) * (4 + lighting * 10) * surfaceWeight

      // Soft tonal remapping gives a consistent grey plastic base. Form and
      // local occlusion stay separate from the normal term so creases darken
      // naturally without drawing a halo around every contrast boundary.
      // Material is based on a denoised tonal albedo, not a blurred one. This
      // keeps clothing folds, faces, and object silhouettes recognizable while
      // the separate broad field above supplies all lighting normals.
      const materialTone = (denoised[pixel] - 128) * sourceToneAmount
      const retainedFeature = mid * featureAmount * surfaceWeight
      const occlusion = cavity * cavityAmount
      const flatArea = clamp(1 - Math.abs(mid) / 8)
      let clay = 132 + materialTone + retainedFeature - occlusion + highlight
      clay += (broadLight - 0.88) * 28 * surfaceWeight
      // Compress large, flat, bright areas into neutral studio grey rather
      // than turning a photo's background into a blank white field.
      clay -= flatArea * 11
      clay = 150 + (clay - 150) * (0.86 + contrast * 0.36)
      clay = Math.min(214, clamp(clay))

      const finalGray = source[pixel] * (1 - intensity) + clay * intensity
      data[index] = finalGray
      data[index + 1] = finalGray
      data[index + 2] = finalGray
    }
  }
  context.putImageData(image, 0, 0)
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

function blurTwice(source: Float32Array, width: number, height: number, radius: number) {
  return boxBlur(boxBlur(source, width, height, radius), width, height, radius)
}

function applyAscii(context: CanvasRenderingContext2D, width: number, height: number, settings: EffectSettings['ascii']) {
  const source = context.getImageData(0, 0, width, height)
  const data = source.data
  const cell = Math.max(4, Math.round(settings.cellSize))
  const contrast = 1 + settings.contrast / 100
  const intensity = settings.intensity / 100
  // Characters are ordered from visually dense to sparse, producing readable tonal ASCII.
  const ramp = settings.invert
    ? '@%#*+=-:. '
    : ' .:-=+*#%@'
  const columns = Math.ceil(width / cell)
  const rows = Math.ceil(height / Math.max(1, cell * 1.65))
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const out = output.getContext('2d')
  if (!out) return
  // Leave the canvas transparent. This preserves alpha from a preceding
  // background-removal step instead of filling every ASCII render with black.
  out.clearRect(0, 0, width, height)
  out.textBaseline = 'top'
  out.font = `bold ${Math.max(5, Math.round(cell * 1.55))}px monospace`
  const charWidth = cell
  const charHeight = cell * 1.65

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const x0 = col * cell
      const y0 = Math.round(row * charHeight)
      const x1 = Math.min(width, x0 + cell)
      const y1 = Math.min(height, y0 + Math.max(1, Math.round(charHeight)))
      let weighted = 0
      let red = 0
      let green = 0
      let blue = 0
      let count = 0
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index = (y * width + x) * 4
          const alpha = data[index + 3] / 255
          if (alpha <= 0) continue
          const r = data[index]
          const g = data[index + 1]
          const b = data[index + 2]
          weighted += (r * 0.2126 + g * 0.7152 + b * 0.0722) * alpha
          red += r * alpha
          green += g * alpha
          blue += b * alpha
          count += alpha
        }
      }
      if (count <= 0) continue
      let luminance = weighted / count
      luminance = Math.max(0, Math.min(255, (luminance - 127.5) * contrast + 127.5))
      const rampIndex = Math.max(0, Math.min(ramp.length - 1, Math.round((luminance / 255) * (ramp.length - 1))))
      const character = ramp[rampIndex]
      if (character === ' ') continue
      if (settings.color) {
        out.fillStyle = `rgb(${Math.round(red / count)},${Math.round(green / count)},${Math.round(blue / count)})`
      } else {
        const tone = Math.round(40 + luminance * 0.84)
        out.fillStyle = `rgb(${tone},${tone},${tone})`
      }
      out.fillText(character, x0, y0, charWidth + 1)
    }
  }

  context.save()
  context.globalAlpha = intensity
  context.drawImage(output, 0, 0)
  context.restore()
}

/**
 * Root Rot is an ink silhouette with unstable, root-like growth at its edges.
 * Every control below intentionally contributes to the generated mask or the
 * boundary marks; it is not a cosmetic control surface.
 */
function applyRootRot(context: CanvasRenderingContext2D, width: number, height: number, settings: EffectSettings['rootRot']) {
  const source = context.getImageData(0, 0, width, height)
  const luminance = new Float32Array(width * height)
  for (let pixel = 0, index = 0; pixel < luminance.length; pixel += 1, index += 4) {
    luminance[pixel] = source.data[index + 3] === 0 ? 255 : source.data[index] * .2126 + source.data[index + 1] * .7152 + source.data[index + 2] * .0722
  }
  const joinRadius = Math.max(0, Math.min(4, Math.round(settings.joinParts * 1.35)))
  const joined = joinRadius ? boxBlur(luminance, width, height, joinRadius) : luminance
  const mask = new Uint8Array(width * height)
  const threshold = settings.threshold + settings.bodySwell * 18 - settings.breathingRoom * 12
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const raw = luminance[pixel]
    const soft = joined[pixel]
    const noise = (seededNoise(pixel * 0.618) - .5) * settings.roughness * 68
    const tone = raw * (1 - Math.min(.65, settings.joinParts * .18)) + soft * Math.min(.65, settings.joinParts * .18) + noise
    mask[pixel] = tone < threshold ? 1 : 0
  }
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const out = output.getContext('2d')
  if (!out) return
  out.fillStyle = '#fff'
  out.fillRect(0, 0, width, height)
  const result = out.getImageData(0, 0, width, height)
  for (let pixel = 0, index = 0; pixel < mask.length; pixel += 1, index += 4) {
    if (!mask[pixel]) continue
    result.data[index] = 8
    result.data[index + 1] = 10
    result.data[index + 2] = 9
  }
  out.putImageData(result, 0, 0)

  const stride = Math.max(3, Math.round(13 - settings.spikes / 12))
  const length = 2 + settings.spikes * .16
  let drawn = 0
  out.strokeStyle = '#080a09'
  out.lineWidth = Math.max(1, settings.bodySwell * 1.3)
  out.lineCap = 'round'
  out.beginPath()
  for (let y = 1; y < height - 1 && drawn < 2600; y += stride) for (let x = 1; x < width - 1 && drawn < 2600; x += stride) {
    const pixel = y * width + x
    if (!mask[pixel] || seededNoise(pixel * 2.17) > settings.spikes / 100) continue
    const directions: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
    const direction = directions.find(([dx, dy]) => !mask[(y + dy) * width + x + dx])
    if (!direction) continue
    if (settings.protectOpenings && isEnclosedGap(mask, width, height, x + direction[0] * Math.max(1, Math.round(settings.guardGaps)), y + direction[1] * Math.max(1, Math.round(settings.guardGaps)))) continue
    const jitter = (seededNoise(pixel * 6.43) - .5) * settings.roughness * length
    out.moveTo(x, y)
    out.lineTo(x + direction[0] * length + (direction[1] ? jitter : 0), y + direction[1] * length + (direction[0] ? jitter : 0))
    drawn += 1
  }
  out.stroke()
  context.clearRect(0, 0, width, height)
  context.drawImage(output, 0, 0)
}

function applyMadness(context: CanvasRenderingContext2D, width: number, height: number, settings: EffectSettings['madness']) {
  const source = context.getImageData(0, 0, width, height)
  const pixelCount = width * height
  const luminance = new Float32Array(pixelCount)
  for (let pixel = 0, index = 0; pixel < pixelCount; pixel += 1, index += 4) {
    luminance[pixel] = source.data[index + 3] ? source.data[index] * .2126 + source.data[index + 1] * .7152 + source.data[index + 2] * .0722 : 255
  }
  // The blurred field keeps the source's large tonal forms while the local
  // difference below protects outlines, folds, and other fine structures.
  const broad = boxBlur(luminance, width, height, Math.max(2, Math.round(settings.cloudSize * 5)))
  const local = boxBlur(luminance, width, height, 1)
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const out = output.getContext('2d')
  if (!out) return
  const result = out.createImageData(width, height)
  const grainAmount = settings.grain / 100
  const contrast = 1 + settings.contrast / 100
  const cloudScale = Math.max(3, settings.cloudSize * 19)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const pixel = y * width + x
    const index = pixel * 4
    const tone = Math.max(0, Math.min(255, (broad[pixel] - 128) * contrast + 128))
    const structure = Math.min(1, Math.abs(luminance[pixel] - local[pixel]) / 42) * settings.detail / 100
    const cloud = fractalNoise(x, y, cloudScale, settings.seed)
    const grain = latticeNoise(pixel, 0, settings.seed * 17 + 1)
    const darkness = Math.max(0, Math.min(1, (settings.threshold - tone) / 255 + .42))
    const density = Math.max(0, Math.min(1, darkness * (.56 + cloud * .76) + structure * .42 + (grain - .5) * grainAmount * .30 + (cloud - .5) * settings.chaos * .44))
    const ink = grain < density
    const shade = ink ? Math.round(4 + (1 - density) * 34 + cloud * 11) : Math.round(246 + grain * 9)
    result.data[index] = shade
    result.data[index + 1] = shade
    result.data[index + 2] = shade
    result.data[index + 3] = source.data[index + 3]
  }
  out.putImageData(result, 0, 0)

  // Uneven circular particles add clustered, natural granularity without any
  // typographic or regular dot-screen primitives.
  const random = seededRandom(settings.seed * 7919 + width * 31 + height)
  const count = Math.min(9000, Math.max(500, Math.round(settings.density * width * height / 1_400_000)))
  const minSize = Math.min(settings.minParticleSize, settings.maxParticleSize)
  const maxSize = Math.max(settings.minParticleSize, settings.maxParticleSize)
  out.fillStyle = '#080909'
  for (let attempt = 0; attempt < count; attempt += 1) {
    const x = Math.floor(random() * width)
    const y = Math.floor(random() * height)
    const pixel = y * width + x
    const tone = broad[pixel]
    const cloud = fractalNoise(x, y, cloudScale, settings.seed)
    const chance = Math.max(0, Math.min(1, (settings.threshold - tone) / 255 + cloud * .34 + settings.chaos * .18))
    if (random() > chance) continue
    const radius = minSize + (maxSize - minSize) * Math.pow(random(), 1.8)
    out.globalAlpha = .08 + random() * .23 + chance * .28
    out.beginPath()
    out.arc(x + (random() - .5) * settings.chaos * 8, y + (random() - .5) * settings.chaos * 8, radius, 0, Math.PI * 2)
    out.fill()
  }
  out.globalAlpha = 1
  context.clearRect(0, 0, width, height)
  context.drawImage(output, 0, 0)
}

function isEnclosedGap(mask: Uint8Array, width: number, height: number, x: number, y: number) {
  if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return false
  return Boolean(mask[y * width + x - 1] && mask[y * width + x + 1] && mask[(y - 1) * width + x] && mask[(y + 1) * width + x])
}

function fractalNoise(x: number, y: number, scale: number, seed: number) {
  let total = 0
  let weight = 0
  let amplitude = 1
  for (let octave = 0; octave < 3; octave += 1) {
    total += smoothValueNoise(x / scale, y / scale, seed + octave * 101) * amplitude
    weight += amplitude
    amplitude *= .5
    scale *= .48
  }
  return total / weight
}

function smoothValueNoise(x: number, y: number, seed: number) {
  const left = Math.floor(x)
  const top = Math.floor(y)
  const horizontal = x - left
  const vertical = y - top
  const fadeX = horizontal * horizontal * (3 - horizontal * 2)
  const fadeY = vertical * vertical * (3 - vertical * 2)
  const a = latticeNoise(left, top, seed)
  const b = latticeNoise(left + 1, top, seed)
  const c = latticeNoise(left, top + 1, seed)
  const d = latticeNoise(left + 1, top + 1, seed)
  return (a + (b - a) * fadeX) * (1 - fadeY) + (c + (d - c) * fadeX) * fadeY
}

function latticeNoise(x: number, y: number, seed: number) {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)
  value = Math.imul(value ^ value >>> 13, 1274126177)
  return ((value ^ value >>> 16) >>> 0) / 4294967296
}

function seededNoise(value: number) { const noise = Math.sin(value * 12.9898) * 43758.5453; return noise - Math.floor(noise) }
function seededRandom(seed: number) { let value = seed >>> 0; return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 } }


function sampleLuma(data: Float32Array, width: number, height: number, x: number, y: number) { return data[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))] }

function boxBlur(source: Float32Array, width: number, height: number, radius: number) {
  const horizontal = new Float32Array(source.length)
  const output = new Float32Array(source.length)
  const span = radius * 2 + 1
  for (let y = 0; y < height; y += 1) {
    let sum = 0
    for (let offset = -radius; offset <= radius; offset += 1) sum += source[y * width + Math.max(0, Math.min(width - 1, offset))]
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = sum / span
      sum += source[y * width + Math.min(width - 1, x + radius + 1)] - source[y * width + Math.max(0, x - radius)]
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let offset = -radius; offset <= radius; offset += 1) sum += horizontal[Math.max(0, Math.min(height - 1, offset)) * width + x]
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / span
      sum += horizontal[Math.min(height - 1, y + radius + 1) * width + x] - horizontal[Math.max(0, y - radius) * width + x]
    }
  }
  return output
}

function flattenOnWhite(canvas: HTMLCanvasElement) {
  const flattened = document.createElement('canvas')
  flattened.width = canvas.width
  flattened.height = canvas.height
  const context = flattened.getContext('2d')
  if (!context) throw new Error('Canvas processing is not supported in this browser.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, flattened.width, flattened.height)
  context.drawImage(canvas, 0, 0)
  return flattened
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

function sampleLuminance(imageData: ImageData, width: number, height: number, x: number, y: number, radius: number) {
  let total = 0
  let count = 0
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
    const sampleX = Math.max(0, Math.min(width - 1, Math.round(x + offsetX)))
    const sampleY = Math.max(0, Math.min(height - 1, Math.round(y + offsetY)))
    const index = (sampleY * width + sampleX) * 4
    total += imageData.data[index] * 0.2126 + imageData.data[index + 1] * 0.7152 + imageData.data[index + 2] * 0.0722
    count += 1
  }
  return total / count
}

function clamp(value: number) { return Math.max(0, Math.min(255, value)) }
