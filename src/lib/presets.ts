import {
  cloneDefaultSettings,
  createEffectStackItem,
  isProcessingEffectId,
  type EffectSettings,
  type EffectStackItem,
  type ProcessingEffectId,
} from './effects'

const STORAGE_KEY = 'bitform-custom-presets-v1'
const MAX_PRESETS = 30
const MAX_STACK_ITEMS = 30

export type BuiltInPreset = { id: string; name: string; stack: () => EffectStackItem[] }
export type CustomPreset = { id: string; name: string; stack: EffectStackItem[] }

function presetItem(effect: ProcessingEffectId, apply: (settings: EffectSettings) => void) {
  const item = createEffectStackItem(effect)
  apply(item.settings)
  return item
}

export const builtInPresets: BuiltInPreset[] = [
  { id: 'dirty-film', name: 'Dirty Film', stack: () => [presetItem('grain', (settings) => Object.assign(settings.grain, { amount: 48, size: 2, monochrome: true })), presetItem('blackWhite', (settings) => Object.assign(settings.blackWhite, { contrast: 24 }))] },
  { id: 'halftone-print', name: 'Halftone Print', stack: () => [presetItem('halftone', (settings) => Object.assign(settings.halftone, { size: 7, angle: 45, contrast: 46 }))] },
  { id: 'digital-noise', name: 'Digital Noise', stack: () => [presetItem('grain', (settings) => Object.assign(settings.grain, { amount: 35, size: 1, monochrome: false }))] },
  { id: 'photocopy', name: 'Photocopy', stack: () => [presetItem('blackWhite', (settings) => Object.assign(settings.blackWhite, { contrast: 52 })), presetItem('edgeDetection', (settings) => Object.assign(settings.edgeDetection, { threshold: 48, strength: 135 }))] },
  { id: 'crt', name: 'CRT', stack: () => [presetItem('grain', (settings) => Object.assign(settings.grain, { amount: 24, size: 1, monochrome: false })), presetItem('blackWhite', (settings) => Object.assign(settings.blackWhite, { contrast: 18 }))] },
  { id: 'pixel-art', name: 'Pixel Art', stack: () => [presetItem('pixelate', (settings) => Object.assign(settings.pixelate, { size: 12 })), presetItem('dithering', (settings) => Object.assign(settings.dithering, { levels: 4, intensity: 90 }))] },
]

export function loadCustomPresets(): CustomPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizePreset).filter((preset): preset is CustomPreset => preset !== null).slice(0, MAX_PRESETS)
  } catch {
    return []
  }
}

export function saveCustomPreset(name: string, stack: EffectStackItem[]): CustomPreset | null {
  const cleanName = name.trim().slice(0, 60)
  if (!cleanName || stack.length === 0) return null
  const preset: CustomPreset = { id: createId(), name: cleanName, stack: stack.map((item) => ({ id: item.id, effect: item.effect, enabled: item.enabled, settings: normalizeSettings(item.settings) })) }
  const next = [...loadCustomPresets(), preset].slice(-MAX_PRESETS)
  persist(next)
  return preset
}

export function renameCustomPreset(id: string, name: string): CustomPreset[] {
  const cleanName = name.trim().slice(0, 60)
  if (!cleanName) return loadCustomPresets()
  const next = loadCustomPresets().map((preset) => preset.id === id ? { ...preset, name: cleanName } : preset)
  persist(next)
  return next
}

export function deleteCustomPreset(id: string): CustomPreset[] {
  const next = loadCustomPresets().filter((preset) => preset.id !== id)
  persist(next)
  return next
}

export function cloneStack(stack: EffectStackItem[]): EffectStackItem[] {
  return stack.map((item) => ({ id: createId(), effect: item.effect, enabled: item.enabled, settings: normalizeSettings(item.settings) }))
}

function normalizePreset(value: unknown): CustomPreset | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || !Array.isArray(value.stack)) return null
  const name = value.name.trim().slice(0, 60)
  if (!name || value.stack.length > MAX_STACK_ITEMS) return null
  const stack = value.stack.map(normalizeStackItem).filter((item): item is EffectStackItem => item !== null)
  return stack.length === value.stack.length ? { id: value.id, name, stack } : null
}

function normalizeStackItem(value: unknown): EffectStackItem | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isProcessingEffectId(value.effect)) return null
  return { id: value.id, effect: value.effect, enabled: typeof value.enabled === 'boolean' ? value.enabled : true, settings: normalizeSettings(value.settings) }
}

function normalizeSettings(value: unknown): EffectSettings {
  const raw = isRecord(value) ? value : {}
  const settings = cloneDefaultSettings()
  const grain = isRecord(raw.grain) ? raw.grain : {}; settings.grain = { amount: numberValue(grain.amount, settings.grain.amount, 0, 100), size: numberValue(grain.size, settings.grain.size, 1, 6), monochrome: typeof grain.monochrome === 'boolean' ? grain.monochrome : settings.grain.monochrome }
  const blackWhite = isRecord(raw.blackWhite) ? raw.blackWhite : {}; settings.blackWhite = { contrast: numberValue(blackWhite.contrast, settings.blackWhite.contrast, -100, 100) }
  const halftone = isRecord(raw.halftone) ? raw.halftone : {}; settings.halftone = { size: numberValue(halftone.size, settings.halftone.size, 3, 24), angle: numberValue(halftone.angle, settings.halftone.angle, 0, 90), contrast: numberValue(halftone.contrast, settings.halftone.contrast, -100, 100) }
  const dithering = isRecord(raw.dithering) ? raw.dithering : {}; settings.dithering = { levels: numberValue(dithering.levels, settings.dithering.levels, 2, 8), intensity: numberValue(dithering.intensity, settings.dithering.intensity, 0, 100) }
  const pixelate = isRecord(raw.pixelate) ? raw.pixelate : {}; settings.pixelate = { size: numberValue(pixelate.size, settings.pixelate.size, 2, 60) }
  const edgeDetection = isRecord(raw.edgeDetection) ? raw.edgeDetection : {}; settings.edgeDetection = { threshold: numberValue(edgeDetection.threshold, settings.edgeDetection.threshold, 0, 255), strength: numberValue(edgeDetection.strength, settings.edgeDetection.strength, 0, 200) }
  const sketch = isRecord(raw.sketch) ? raw.sketch : {}; settings.sketch = { detail: numberValue(sketch.detail, settings.sketch.detail, 1, 12), intensity: numberValue(sketch.intensity, settings.sketch.intensity, 0, 100) }
  const posterize = isRecord(raw.posterize) ? raw.posterize : {}; settings.posterize = { levels: numberValue(posterize.levels, settings.posterize.levels, 2, 16), contrast: numberValue(posterize.contrast, settings.posterize.contrast, -100, 100) }
  const chrome = isRecord(raw.chrome) ? raw.chrome : {}; settings.chrome = { mode: chrome.mode === 'photo' || chrome.mode === 'graphic' ? chrome.mode : settings.chrome.mode, intensity: numberValue(chrome.intensity, settings.chrome.intensity, 0, 100), contrast: numberValue(chrome.contrast, settings.chrome.contrast, -100, 100), reflections: numberValue(chrome.reflections, settings.chrome.reflections, 1, 10) }
  const xray = isRecord(raw.xray) ? raw.xray : {}; settings.xray = { intensity: numberValue(xray.intensity, settings.xray.intensity, 0, 100), contrast: numberValue(xray.contrast, settings.xray.contrast, -100, 100), edgeDetail: numberValue(xray.edgeDetail, settings.xray.edgeDetail, 0, 100), glow: numberValue(xray.glow, settings.xray.glow, 0, 100), threshold: numberValue(xray.threshold, settings.xray.threshold, 0, 255), invert: typeof xray.invert === 'boolean' ? xray.invert : settings.xray.invert }
  const thermalVision = isRecord(raw.thermalVision) ? raw.thermalVision : {}; settings.thermalVision = { intensity: numberValue(thermalVision.intensity, settings.thermalVision.intensity, 0, 100), contrast: numberValue(thermalVision.contrast, settings.thermalVision.contrast, -100, 100), heatSensitivity: numberValue(thermalVision.heatSensitivity, settings.thermalVision.heatSensitivity, 0, 100), smoothing: numberValue(thermalVision.smoothing, settings.thermalVision.smoothing, 0, 100), monochrome: typeof thermalVision.monochrome === 'boolean' ? thermalVision.monochrome : settings.thermalVision.monochrome }
  const clayRender = isRecord(raw.clayRender) ? raw.clayRender : {}; settings.clayRender = { intensity: numberValue(clayRender.intensity, settings.clayRender.intensity, 0, 100), smoothness: numberValue(clayRender.smoothness, settings.clayRender.smoothness, 0, 100), relief: numberValue(clayRender.relief, settings.clayRender.relief, 0, 100), lighting: numberValue(clayRender.lighting, settings.clayRender.lighting, 0, 100), contrast: numberValue(clayRender.contrast, settings.clayRender.contrast, -100, 100) }
  const ascii = isRecord(raw.ascii) ? raw.ascii : {}; settings.ascii = { cellSize: numberValue(ascii.cellSize, settings.ascii.cellSize, 4, 20), contrast: numberValue(ascii.contrast, settings.ascii.contrast, -100, 100), intensity: numberValue(ascii.intensity, settings.ascii.intensity, 0, 100), color: typeof ascii.color === 'boolean' ? ascii.color : settings.ascii.color, invert: typeof ascii.invert === 'boolean' ? ascii.invert : settings.ascii.invert }
  const rootRot = isRecord(raw.rootRot) ? raw.rootRot : {}; settings.rootRot = { threshold: numberValue(rootRot.threshold, settings.rootRot.threshold, 0, 255), joinParts: numberValue(rootRot.joinParts, settings.rootRot.joinParts, 0, 4), bodySwell: numberValue(rootRot.bodySwell, settings.rootRot.bodySwell, 0, 4), roughness: numberValue(rootRot.roughness, settings.rootRot.roughness, 0, 1), breathingRoom: numberValue(rootRot.breathingRoom, settings.rootRot.breathingRoom, 0, 3), guardGaps: numberValue(rootRot.guardGaps, settings.rootRot.guardGaps, 1, 12), protectOpenings: typeof rootRot.protectOpenings === 'boolean' ? rootRot.protectOpenings : settings.rootRot.protectOpenings, spikes: numberValue(rootRot.spikes, settings.rootRot.spikes, 0, 100) }
  const madness = isRecord(raw.madness) ? raw.madness : {}; settings.madness = { density: numberValue(madness.density, settings.madness.density, 100, 5000), cloudSize: numberValue(madness.cloudSize, settings.madness.cloudSize, .25, 3), minParticleSize: numberValue(madness.minParticleSize, settings.madness.minParticleSize, 1, 16), maxParticleSize: numberValue(madness.maxParticleSize, settings.madness.maxParticleSize, 1, 16), chaos: numberValue(madness.chaos, settings.madness.chaos, 0, 1), grain: numberValue(madness.grain, settings.madness.grain, 0, 100), threshold: numberValue(madness.threshold, settings.madness.threshold, 0, 255), contrast: numberValue(madness.contrast, settings.madness.contrast, -80, 120), detail: numberValue(madness.detail, settings.madness.detail, 0, 100), seed: numberValue(madness.seed, settings.madness.seed, 1, 999) }
  if (settings.madness.minParticleSize > settings.madness.maxParticleSize) settings.madness.maxParticleSize = settings.madness.minParticleSize
  return settings
}

function persist(presets: CustomPreset[]) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(presets)) } catch { /* Storage is optional. */ } }
function numberValue(value: unknown, fallback: number, min: number, max: number) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
function createId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}` }
