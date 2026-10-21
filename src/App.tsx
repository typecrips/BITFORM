import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  cloneDefaultSettings,
  createEffectStackItem,
  exportProcessedImage,
  renderProcessedCanvas,
  renderEffectPreview,
  type EffectId,
  type EffectSettings,
  type EffectStackItem,
  type ProcessingEffectId,
} from './lib/effects'
import { disposeLocalImage, loadLocalImage, type LocalImage } from './lib/imageProcessing'
import { builtInPresets, cloneStack, deleteCustomPreset, loadCustomPresets, renameCustomPreset, saveCustomPreset, type CustomPreset } from './lib/presets'
import { downloadBlob, traceCanvas, vectorPdf, type VectorOptions, type VectorResult } from './lib/vectorize'
import './App.css'

const effects: { id: EffectId; name: string; note: string }[] = [
  { id: 'original', name: 'Original', note: 'No effect' },
  { id: 'grain', name: 'Grain', note: 'Fine film texture' },
  { id: 'blackWhite', name: 'Black & White', note: 'Tonal contrast' },
  { id: 'halftone', name: 'Halftone', note: 'Printed dot pattern' },
  { id: 'dithering', name: 'Dithering', note: 'Ordered tonal texture' },
  { id: 'pixelate', name: 'Pixelate', note: 'Blocky resolution' },
  { id: 'edgeDetection', name: 'Edge Detection', note: 'Sobel linework' },
  { id: 'sketch', name: 'Sketch', note: 'Pencil rendering' },
  { id: 'posterize', name: 'Posterize', note: 'Reduced color steps' },
  { id: 'chrome', name: 'Chrome', note: 'Polished metal reflections' },
  { id: 'xray', name: 'X-Ray', note: 'Monochrome radiographic glow' },
  { id: 'thermalVision', name: 'Thermal Vision', note: 'False-color heat mapping' },
  { id: 'ascii', name: 'ASCII', note: 'Image rendered with characters' },
  { id: 'clayRender', name: 'Clay Render', note: 'Monochrome sculpted plastic look' },
  { id: 'rootRot', name: 'Root Rot', note: 'Thorned ink silhouettes' },
  { id: 'madness', name: 'Madness', note: 'Character-cloud rendering' },
]

type RangeControlProps = { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }

function RangeControl({ label, value, min, max, step = 1, suffix = '', onChange }: RangeControlProps) {
  return <label className="range-control"><span><span>{label}</span><output>{value}{suffix}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
}

function App() {
  const [image, setImage] = useState<LocalImage | null>(null)
  const [stack, setStack] = useState<EffectStackItem[]>([])
  const [activeStackId, setActiveStackId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(() => loadCustomPresets())
  const [presetName, setPresetName] = useState('')
  const [showOriginal, setShowOriginal] = useState(false)
  const [isComparing, setIsComparing] = useState(false)
  const [comparisonPosition, setComparisonPosition] = useState(50)
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg'>('png')
  const [jpegQuality, setJpegQuality] = useState(92)
  const [isExporting, setIsExporting] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const [vectorMode, setVectorMode] = useState(false)
  const [vectorOptions, setVectorOptions] = useState<VectorOptions>({ mode: 'logo', threshold: 150, colors: 6, detail: 90, smoothing: 20, removeBackground: false })
  const [vectorResult, setVectorResult] = useState<VectorResult | null>(null)
  const [vectorBusy, setVectorBusy] = useState(false)
  const [zoom, setZoom] = useState(100)
  const inputRef = useRef<HTMLInputElement>(null)
  const previewScrollRef = useRef<HTMLDivElement>(null)
  const previewPanRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const activeItem = stack.find((item) => item.id === activeStackId) ?? null

  useEffect(() => () => { if (image) disposeLocalImage(image) }, [image])

  useEffect(() => {
    let cancelled = false
    if (!image || stack.length === 0) return () => { cancelled = true }
    const timer = window.setTimeout(() => {
      void renderEffectPreview(image.url, stack)
        .then((url) => { if (!cancelled) setPreviewUrl(url) })
        .catch((caughtError) => { if (!cancelled) setError(caughtError instanceof Error ? caughtError.message : 'The preview could not be rendered.') })
    }, 30)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [image, stack])

  useEffect(() => {
    let cancelled = false
    if (!image || !vectorMode) { setVectorResult(null); return }
    setVectorBusy(true)
    const timer = window.setTimeout(() => {
      void renderProcessedCanvas(image.url, stack)
        .then((canvas) => traceCanvas(canvas, vectorOptions))
        .then((result) => { if (!cancelled) setVectorResult(result) })
        .catch((caughtError) => { if (!cancelled) setError(caughtError instanceof Error ? caughtError.message : 'Vectorization failed.') })
        .finally(() => { if (!cancelled) setVectorBusy(false) })
    }, 60)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [image, vectorMode, vectorOptions, stack])

  function updateVectorOptions(update: Partial<VectorOptions>) { setVectorOptions((current) => ({ ...current, ...update })) }
  function exportVectorSvg() { if (vectorResult && image) downloadBlob(new Blob([vectorResult.svg], { type: 'image/svg+xml;charset=utf-8' }), `${image.name.replace(/\.[^/.]+$/, '') || 'bitform-image'}-vector.svg`) }
  function exportVectorPdf() { if (vectorResult && image) downloadBlob(vectorPdf(vectorResult, image.width, image.height), `${image.name.replace(/\.[^/.]+$/, '') || 'bitform-image'}-vector.pdf`) }

  async function handleFile(file?: File) {
    if (!file) return
    try {
      const nextImage = await loadLocalImage(file)
      setError('')
      setVectorMode(false)
      setVectorResult(null)
      setStack([])
      setActiveStackId(null)
      setPreviewUrl(null)
      setShowOriginal(false)
      setIsComparing(false)
      setIsSettingsOpen(false)
      setIsExportOpen(false)
      setZoom(100)
      setImage(nextImage)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'That image could not be opened.')
    }
  }

  function chooseFile() { inputRef.current?.click() }
  function onInputChange(event: ChangeEvent<HTMLInputElement>) { void handleFile(event.target.files?.[0]); event.target.value = '' }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setIsDragging(false); void handleFile(event.dataTransfer.files[0]) }
  function clearImage() { setVectorMode(false); setVectorResult(null); setImage(null); setStack([]); setActiveStackId(null); setPreviewUrl(null); setShowOriginal(false); setIsComparing(false); setIsSettingsOpen(false); setIsExportOpen(false); setZoom(100); setError('') }
  function selectOriginal() { setStack([]); setActiveStackId(null); setPreviewUrl(null); setIsSettingsOpen(false) }
  function addEffect(effect: ProcessingEffectId) { const item = createEffectStackItem(effect); setStack((current) => [...current, item]); setActiveStackId(item.id); setIsSettingsOpen(true); setError('') }
  function resetActiveEffect() { if (activeItem) setStack((current) => current.map((item) => item.id === activeItem.id ? { ...item, settings: cloneDefaultSettings() } : item)) }

  function applyStack(nextStack: EffectStackItem[]) { setStack(nextStack); setActiveStackId(nextStack[0]?.id ?? null); setIsSettingsOpen(nextStack.length > 0); setPreviewUrl(null); setError('') }
  function applyBuiltInPreset(id: string) { const preset = builtInPresets.find((item) => item.id === id); if (preset) applyStack(preset.stack()) }
  function applyCustomPreset(preset: CustomPreset) { applyStack(cloneStack(preset.stack)) }
  function savePreset() {
    const preset = saveCustomPreset(presetName, stack)
    if (!preset) { setError(stack.length === 0 ? 'Add an effect before saving a preset.' : 'Enter a name for your preset.'); return }
    setCustomPresets(loadCustomPresets())
    setPresetName('')
  }
  function renamePreset(preset: CustomPreset) {
    const nextName = window.prompt('Rename preset', preset.name)
    if (nextName === null) return
    setCustomPresets(renameCustomPreset(preset.id, nextName))
  }
  function deletePreset(id: string) { setCustomPresets(deleteCustomPreset(id)) }
  function toggleEffect(id: string) { setStack((current) => current.map((item) => item.id === id ? { ...item, enabled: !item.enabled } : item)) }
  function resetZoom() { setZoom(100); window.requestAnimationFrame(() => { if (previewScrollRef.current) { previewScrollRef.current.scrollLeft = 0; previewScrollRef.current.scrollTop = 0 } }) }
  function startPan(event: ReactPointerEvent<HTMLDivElement>) { const viewport = previewScrollRef.current; if (!viewport || zoom <= 100) return; viewport.setPointerCapture(event.pointerId); previewPanRef.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop } }
  function movePan(event: ReactPointerEvent<HTMLDivElement>) { const viewport = previewScrollRef.current; const pan = previewPanRef.current; if (!viewport || !pan) return; viewport.scrollLeft = pan.left - (event.clientX - pan.x); viewport.scrollTop = pan.top - (event.clientY - pan.y) }
  function endPan() { previewPanRef.current = null }

  function updateSettings<K extends ProcessingEffectId>(effect: K, update: Partial<EffectSettings[K]>) {
    if (!activeItem) return
    setStack((current) => current.map((item) => item.id === activeItem.id ? { ...item, settings: { ...item.settings, [effect]: { ...item.settings[effect], ...update } } } : item))
  }

  function removeEffect(id: string) {
    const index = stack.findIndex((item) => item.id === id)
    const nextActive = stack[index - 1]?.id ?? stack[index + 1]?.id ?? null
    setStack((current) => current.filter((item) => item.id !== id))
    if (activeStackId === id) { setActiveStackId(nextActive); setIsSettingsOpen(nextActive !== null) }
  }

  function moveEffect(id: string, direction: -1 | 1) {
    setStack((current) => {
      const index = current.findIndex((item) => item.id === id)
      const destination = index + direction
      if (index < 0 || destination < 0 || destination >= current.length) return current
      const reordered = [...current]
      ;[reordered[index], reordered[destination]] = [reordered[destination], reordered[index]]
      return reordered
    })
  }

  async function handleExport() {
    if (!image || isExporting) return
    setError('')
    setIsExporting(true)
    try {
      const blob = await exportProcessedImage(image.url, stack, exportFormat, jpegQuality / 100)
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `${image.name.replace(/\.[^/.]+$/, '') || 'bitform-image'}-bitform.${exportFormat === 'jpeg' ? 'jpg' : 'png'}`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Export failed. Please try a smaller image.')
    } finally {
      setIsExporting(false)
      setIsExportOpen(false)
    }
  }

  function renderControls() {
    if (!activeItem) return <p className="effect-empty-state">Choose an effect to add it to your stack. Your original image is always kept intact.</p>
    const settings = activeItem.settings
    if (activeItem.effect === 'grain') return <><RangeControl label="Amount" value={settings.grain.amount} min={0} max={100} suffix="%" onChange={(amount) => updateSettings('grain', { amount })} /><RangeControl label="Grain size" value={settings.grain.size} min={1} max={6} suffix=" px" onChange={(size) => updateSettings('grain', { size })} /><label className="toggle-control"><span>Monochrome grain</span><input type="checkbox" checked={settings.grain.monochrome} onChange={(event) => updateSettings('grain', { monochrome: event.target.checked })} /></label></>
    if (activeItem.effect === 'blackWhite') return <RangeControl label="Contrast" value={settings.blackWhite.contrast} min={-100} max={100} onChange={(contrast) => updateSettings('blackWhite', { contrast })} />
    if (activeItem.effect === 'halftone') return <><RangeControl label="Dot size" value={settings.halftone.size} min={3} max={24} suffix=" px" onChange={(size) => updateSettings('halftone', { size })} /><RangeControl label="Angle" value={settings.halftone.angle} min={0} max={90} suffix="°" onChange={(angle) => updateSettings('halftone', { angle })} /><RangeControl label="Contrast" value={settings.halftone.contrast} min={-100} max={100} onChange={(contrast) => updateSettings('halftone', { contrast })} /></>
    if (activeItem.effect === 'dithering') return <><RangeControl label="Tonal levels" value={settings.dithering.levels} min={2} max={8} onChange={(levels) => updateSettings('dithering', { levels })} /><RangeControl label="Intensity" value={settings.dithering.intensity} min={0} max={100} suffix="%" onChange={(intensity) => updateSettings('dithering', { intensity })} /></>
    if (activeItem.effect === 'pixelate') return <RangeControl label="Pixel size" value={settings.pixelate.size} min={2} max={60} suffix=" px" onChange={(size) => updateSettings('pixelate', { size })} />
    if (activeItem.effect === 'edgeDetection') return <><RangeControl label="Threshold" value={settings.edgeDetection.threshold} min={0} max={255} onChange={(threshold) => updateSettings('edgeDetection', { threshold })} /><RangeControl label="Edge strength" value={settings.edgeDetection.strength} min={0} max={200} suffix="%" onChange={(strength) => updateSettings('edgeDetection', { strength })} /></>
    if (activeItem.effect === 'sketch') return <><RangeControl label="Detail" value={settings.sketch.detail} min={1} max={12} onChange={(detail) => updateSettings('sketch', { detail })} /><RangeControl label="Intensity" value={settings.sketch.intensity} min={0} max={100} suffix="%" onChange={(intensity) => updateSettings('sketch', { intensity })} /></>
    if (activeItem.effect === 'posterize') return <><RangeControl label="Color levels" value={settings.posterize.levels} min={2} max={16} onChange={(levels) => updateSettings('posterize', { levels })} /><RangeControl label="Contrast" value={settings.posterize.contrast} min={-100} max={100} onChange={(contrast) => updateSettings('posterize', { contrast })} /></>
    if (activeItem.effect === 'chrome') return <><label className="select-control"><span>Mode</span><select value={settings.chrome.mode} onChange={(event) => updateSettings('chrome', { mode: event.target.value as 'photo' | 'graphic' })}><option value="photo">Photo</option><option value="graphic">Graphic</option></select></label><RangeControl label="Intensity" value={settings.chrome.intensity} min={0} max={100} suffix="%" onChange={(intensity) => updateSettings('chrome', { intensity })} /><RangeControl label="Contrast" value={settings.chrome.contrast} min={-100} max={100} onChange={(contrast) => updateSettings('chrome', { contrast })} /><RangeControl label="Reflections" value={settings.chrome.reflections} min={1} max={10} onChange={(reflections) => updateSettings('chrome', { reflections })} /></>
    if (activeItem.effect === 'xray') return <><RangeControl label="Intensity" value={settings.xray.intensity} min={0} max={100} suffix="%" onChange={(intensity) => updateSettings('xray', { intensity })} /><RangeControl label="Contrast" value={settings.xray.contrast} min={-100} max={100} onChange={(contrast) => updateSettings('xray', { contrast })} /><RangeControl label="Edge detail" value={settings.xray.edgeDetail} min={0} max={100} suffix="%" onChange={(edgeDetail) => updateSettings('xray', { edgeDetail })} /><RangeControl label="Glow" value={settings.xray.glow} min={0} max={100} suffix="%" onChange={(glow) => updateSettings('xray', { glow })} /><RangeControl label="Threshold" value={settings.xray.threshold} min={0} max={255} onChange={(threshold) => updateSettings('xray', { threshold })} /><label className="toggle-control"><span>Invert tones</span><input type="checkbox" checked={settings.xray.invert} onChange={(event) => updateSettings('xray', { invert: event.target.checked })} /></label></>
    if (activeItem.effect === 'thermalVision') return <><RangeControl label="Intensity" value={settings.thermalVision.intensity} min={0} max={100} suffix="%" onChange={(intensity) => updateSettings('thermalVision', { intensity })} /><RangeControl label="Contrast" value={settings.thermalVision.contrast} min={-100} max={100} onChange={(contrast) => updateSettings('thermalVision', { contrast })} /><RangeControl label="Heat sensitivity" value={settings.thermalVision.heatSensitivity} min={0} max={100} suffix="%" onChange={(heatSensitivity) => updateSettings('thermalVision', { heatSensitivity })} /><RangeControl label="Smoothing" value={settings.thermalVision.smoothing} min={0} max={100} suffix="%" onChange={(smoothing) => updateSettings('thermalVision', { smoothing })} /><label className="toggle-control"><span>Black &amp; white</span><input type="checkbox" checked={settings.thermalVision.monochrome} onChange={(event) => updateSettings('thermalVision', { monochrome: event.target.checked })} /></label></>
    if (activeItem.effect === 'clayRender') return <><RangeControl label="Intensity" value={settings.clayRender.intensity} min={0} max={100} suffix="%" onChange={(intensity) => updateSettings('clayRender', { intensity })} /><RangeControl label="Smoothness" value={settings.clayRender.smoothness} min={0} max={100} suffix="%" onChange={(smoothness) => updateSettings('clayRender', { smoothness })} /><RangeControl label="Relief" value={settings.clayRender.relief} min={0} max={100} suffix="%" onChange={(relief) => updateSettings('clayRender', { relief })} /><RangeControl label="Lighting" value={settings.clayRender.lighting} min={0} max={100} suffix="%" onChange={(lighting) => updateSettings('clayRender', { lighting })} /><RangeControl label="Contrast" value={settings.clayRender.contrast} min={-100} max={100} onChange={(contrast) => updateSettings('clayRender', { contrast })} /></>
    if (activeItem.effect === 'ascii') return <><RangeControl label="Character size" value={settings.ascii.cellSize} min={4} max={20} suffix=" px" onChange={(cellSize) => updateSettings('ascii', { cellSize })} /><RangeControl label="Contrast" value={settings.ascii.contrast} min={-100} max={100} onChange={(contrast) => updateSettings('ascii', { contrast })} /><RangeControl label="Intensity" value={settings.ascii.intensity} min={0} max={100} suffix="%" onChange={(intensity) => updateSettings('ascii', { intensity })} /><label className="toggle-control"><span>Use original colors</span><input type="checkbox" checked={settings.ascii.color} onChange={(event) => updateSettings('ascii', { color: event.target.checked })} /></label><label className="toggle-control"><span>Invert character density</span><input type="checkbox" checked={settings.ascii.invert} onChange={(event) => updateSettings('ascii', { invert: event.target.checked })} /></label></>
    if (activeItem.effect === 'rootRot') return <><p className="control-group-label">Shape</p><RangeControl label="Threshold" value={settings.rootRot.threshold} min={0} max={255} onChange={(threshold) => updateSettings('rootRot', { threshold })} /><RangeControl label="Join parts" value={settings.rootRot.joinParts} min={0} max={4} step={.1} suffix="×" onChange={(joinParts) => updateSettings('rootRot', { joinParts })} /><p className="control-group-label">Body</p><RangeControl label="Body swell" value={settings.rootRot.bodySwell} min={0} max={4} step={.1} suffix="×" onChange={(bodySwell) => updateSettings('rootRot', { bodySwell })} /><RangeControl label="Roughness" value={settings.rootRot.roughness} min={0} max={1} step={.05} onChange={(roughness) => updateSettings('rootRot', { roughness })} /><RangeControl label="Breathing room" value={settings.rootRot.breathingRoom} min={0} max={3} step={.1} suffix="×" onChange={(breathingRoom) => updateSettings('rootRot', { breathingRoom })} /><RangeControl label="Guard gaps up to" value={settings.rootRot.guardGaps} min={1} max={12} suffix=" px" onChange={(guardGaps) => updateSettings('rootRot', { guardGaps })} /><label className="toggle-control"><span>Protect openings</span><input type="checkbox" checked={settings.rootRot.protectOpenings} onChange={(event) => updateSettings('rootRot', { protectOpenings: event.target.checked })} /></label><p className="control-group-label">Growth</p><RangeControl label="Spikes" value={settings.rootRot.spikes} min={0} max={100} suffix="%" onChange={(spikes) => updateSettings('rootRot', { spikes })} /></>
    if (activeItem.effect === 'madness') return <><RangeControl label="Density" value={settings.madness.density} min={100} max={5000} step={100} onChange={(density) => updateSettings('madness', { density })} /><RangeControl label="Cloud size" value={settings.madness.cloudSize} min={.25} max={3} step={.05} suffix="×" onChange={(cloudSize) => updateSettings('madness', { cloudSize })} /><RangeControl label="Min particle size" value={settings.madness.minParticleSize} min={1} max={settings.madness.maxParticleSize} step={.5} suffix=" px" onChange={(minParticleSize) => updateSettings('madness', { minParticleSize })} /><RangeControl label="Max particle size" value={settings.madness.maxParticleSize} min={settings.madness.minParticleSize} max={16} step={.5} suffix=" px" onChange={(maxParticleSize) => updateSettings('madness', { maxParticleSize })} /><RangeControl label="Chaos" value={settings.madness.chaos} min={0} max={1} step={.05} onChange={(chaos) => updateSettings('madness', { chaos })} /><RangeControl label="Grain" value={settings.madness.grain} min={0} max={100} suffix="%" onChange={(grain) => updateSettings('madness', { grain })} /><RangeControl label="Threshold" value={settings.madness.threshold} min={0} max={255} onChange={(threshold) => updateSettings('madness', { threshold })} /><RangeControl label="Contrast" value={settings.madness.contrast} min={-80} max={120} onChange={(contrast) => updateSettings('madness', { contrast })} /><RangeControl label="Fine detail" value={settings.madness.detail} min={0} max={100} suffix="%" onChange={(detail) => updateSettings('madness', { detail })} /><RangeControl label="Variation seed" value={settings.madness.seed} min={1} max={999} onChange={(seed) => updateSettings('madness', { seed })} /></>
  }

  const displayedPreview = stack.length === 0 ? image?.url : previewUrl

  return <main className="editor-shell">
    <header className="topbar"><a className="brand" href={import.meta.env.BASE_URL} aria-label="Bitform home"><span className="brand-mark" aria-hidden="true">B</span><span>bitform</span></a><div className="topbar-actions">{image && <><button className={`quiet-button vectorize-button ${vectorMode ? 'is-active' : ''}`} type="button" onClick={() => { setVectorMode((v) => !v); setIsComparing(false); setShowOriginal(false); setError('') }} aria-pressed={vectorMode}>Vectorize</button>{!vectorMode && <><button className="quiet-button" type="button" onPointerDown={() => setShowOriginal(true)} onPointerUp={() => setShowOriginal(false)} onPointerLeave={() => setShowOriginal(false)} onPointerCancel={() => setShowOriginal(false)} onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') setShowOriginal(true) }} onKeyUp={() => setShowOriginal(false)}>Hold original</button><button className={`quiet-button ${isComparing ? 'is-active' : ''}`} type="button" onClick={() => setIsComparing((current) => !current)} aria-pressed={isComparing}>Compare</button><button className="quiet-button" type="button" onClick={clearImage}>New image</button><button className="export-button" type="button" onClick={() => setIsExportOpen(true)} disabled={isExporting}>{isExporting ? 'Exporting…' : 'Export'}</button></>}{vectorMode && <button className="export-button" type="button" onClick={exportVectorSvg} disabled={!vectorResult || vectorBusy}>Export SVG</button>}{vectorMode && <button className="quiet-button" type="button" onClick={exportVectorPdf} disabled={!vectorResult || vectorBusy}>PDF</button>}</>}</div></header>
    <section className={`editor-layout ${isSettingsOpen && activeItem ? 'has-settings' : ''}`} aria-label="Image editor">
      <aside className="effects-panel">
        <div className="panel-heading"><p className="eyebrow">Effects</p><h1>Make it yours.</h1><p className="panel-copy">Add effects, arrange them, and make something tactile.</p></div>
        <section className="preset-panel" aria-label="Presets"><div className="stack-heading"><p>Presets</p></div><div className="preset-list">{builtInPresets.map((preset) => <button type="button" key={preset.id} onClick={() => applyBuiltInPreset(preset.id)}>{preset.name}</button>)}</div>{customPresets.length > 0 && <><p className="custom-presets-label">Your presets</p><div className="custom-preset-list">{customPresets.map((preset) => <div key={preset.id}><button type="button" onClick={() => applyCustomPreset(preset)}>{preset.name}</button><span><button type="button" onClick={() => renamePreset(preset)} aria-label={`Rename ${preset.name}`}>✎</button><button type="button" onClick={() => deletePreset(preset.id)} aria-label={`Delete ${preset.name}`}>×</button></span></div>)}</div></>}<div className="save-preset"><input value={presetName} maxLength={60} placeholder="Name this stack" onChange={(event) => setPresetName(event.target.value)} /><button type="button" onClick={savePreset} disabled={stack.length === 0}>Save</button></div></section>
        {image && vectorMode && <section className="vector-panel" aria-label="Vectorization settings"><div className="stack-heading"><p>Vectorize image</p><span className="vector-status">{vectorBusy ? 'Tracing…' : vectorResult ? 'Vector ready' : 'Preparing'}</span></div>
          <label className="select-control"><span>Mode</span><select value={vectorOptions.mode} onChange={(e) => updateVectorOptions({ mode: e.target.value as VectorOptions['mode'] })}><option value="logo">Logo / Graphic</option><option value="color">Image / Color</option></select></label>
          {vectorOptions.mode === 'logo' ? <RangeControl label="Threshold" value={vectorOptions.threshold} min={0} max={255} onChange={(threshold) => updateVectorOptions({ threshold })} /> : <RangeControl label="Colors" value={vectorOptions.colors} min={2} max={16} onChange={(colors) => updateVectorOptions({ colors })} />}
          <RangeControl label="Detail" value={vectorOptions.detail} min={20} max={160} onChange={(detail) => updateVectorOptions({ detail })} />
          <RangeControl label="Smoothing" value={vectorOptions.smoothing} min={0} max={100} suffix="%" onChange={(smoothing) => updateVectorOptions({ smoothing })} />
          <label className="toggle-control vector-toggle"><span>Remove white background</span><input type="checkbox" checked={vectorOptions.removeBackground} onChange={(e) => updateVectorOptions({ removeBackground: e.target.checked })} /></label>
          <p className="vector-note">Traces the current full-resolution effect stack. More detail creates a larger file.</p>
        </section>}
        <nav className="effect-list" aria-label="Add an image effect" style={vectorMode ? { opacity: .35, pointerEvents: 'none' } : undefined}><button className={`effect-item ${activeItem === null ? 'is-active' : ''}`} type="button" onClick={selectOriginal}><span className="effect-icon" aria-hidden="true">✦</span><span><strong>Original</strong><small>No effect</small></span>{activeItem === null && <span className="active-dot" aria-label="Selected" />}</button>{effects.filter((effect) => effect.id !== 'original').map((effect) => <button className="effect-item" key={effect.id} type="button" onClick={() => addEffect(effect.id as ProcessingEffectId)}><span className="effect-icon" aria-hidden="true">＋</span><span><strong>{effect.name}</strong><small>{effect.note}</small></span></button>)}</nav>
        {stack.length > 0 && <section className="stack-panel" aria-label="Effect stack"><div className="stack-heading"><p>Effect stack</p><button type="button" onClick={() => { setStack([]); setActiveStackId(null); setPreviewUrl(null); setIsSettingsOpen(false) }}>Clear</button></div><ol>{stack.map((item, index) => <li className={`${item.id === activeStackId ? 'is-selected' : ''} ${item.enabled ? '' : 'is-disabled'}`} key={item.id}><button className="stack-item-name" type="button" onClick={() => { setActiveStackId(item.id); setIsSettingsOpen(true) }}><span>{index + 1}</span>{effects.find((effect) => effect.id === item.effect)?.name}</button><span className="stack-actions"><button type="button" onClick={() => toggleEffect(item.id)} aria-label={`${item.enabled ? 'Disable' : 'Enable'} effect`} aria-pressed={item.enabled}>{item.enabled ? '◉' : '○'}</button><button type="button" onClick={() => moveEffect(item.id, -1)} disabled={index === 0} aria-label="Move effect up">↑</button><button type="button" onClick={() => moveEffect(item.id, 1)} disabled={index === stack.length - 1} aria-label="Move effect down">↓</button><button type="button" onClick={() => removeEffect(item.id)} aria-label="Remove effect">×</button></span></li>)}</ol></section>}
        <p className="panel-footnote">Previews are processed locally. Export always uses your original resolution.</p>
      </aside>
      {isSettingsOpen && activeItem && <aside className="settings-panel" aria-label={`${effects.find((effect) => effect.id === activeItem.effect)?.name ?? 'Effect'} settings`}>
        <div className="settings-panel-heading"><div><p className="eyebrow">Settings</p><h2>{effects.find((effect) => effect.id === activeItem.effect)?.name}</h2></div><button className="panel-close-button" type="button" onClick={() => setIsSettingsOpen(false)} aria-label="Close effect settings">×</button></div>
        <div className="settings-panel-content"><div className="controls-heading"><p>Adjust effect</p><button type="button" onClick={resetActiveEffect}>Reset</button></div>{renderControls()}</div>
        <div className="settings-panel-footer"><span>Changes update the preview automatically.</span></div>
      </aside>}
      <section className="workspace">
        <div className="workspace-topline"><p>{image ? image.name : 'Untitled canvas'}</p>{image && <p>{vectorMode ? 'VECTOR PREVIEW' : `${image.width} × ${image.height}${stack.length > 0 ? ` · ${stack.length} effect${stack.length === 1 ? '' : 's'}` : ''}`}</p>}</div>
        {error && image && <p className="workspace-error" role="alert">{error}</p>}
        {image ? <><div className="image-stage"><div ref={previewScrollRef} className={`preview-scroll ${zoom > 100 ? 'is-pannable' : ''}`} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}><div className={`preview-scaler ${isComparing && !showOriginal && !vectorMode ? 'comparison-stage' : ''}`} style={{ width: `${zoom}%`, height: `${zoom}%` }}>{vectorMode ? (vectorResult ? <img className="vector-preview-image" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(vectorResult.svg)}`} alt="Vectorized preview" /> : <p className="vector-loading">{vectorBusy ? 'Tracing image into vector shapes…' : 'Preparing vector preview…'}</p>) : showOriginal ? <img src={image.url} alt={`${image.name} original`} /> : isComparing && displayedPreview ? <><img className="comparison-image" src={displayedPreview} alt={`${image.name} edited`} /><div className="comparison-before" style={{ clipPath: `inset(0 ${100 - comparisonPosition}% 0 0)` }}><img src={image.url} alt={`${image.name} original`} /></div><span className="comparison-divider" style={{ left: `${comparisonPosition}%` }} aria-hidden="true" /><span className="comparison-label before-label">Original</span><span className="comparison-label after-label">Edited</span><input className="comparison-slider" type="range" min="0" max="100" value={comparisonPosition} onChange={(event) => setComparisonPosition(Number(event.target.value))} aria-label="Original versus edited comparison" /></> : displayedPreview && <img src={displayedPreview} alt={`${image.name} with ${stack.length ? 'effect stack' : 'original image'}`} />}</div></div></div><div className="zoom-bar"><button type="button" onClick={resetZoom} title="Reset zoom to 100%">↺ 100%</button><input type="range" min="25" max="200" step="1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label="Preview zoom" /><output>{zoom}%</output></div></> : <div className={`drop-zone ${isDragging ? 'is-dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false) }} onDrop={onDrop}><div className="drop-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16.5v2A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-2" /></svg></div><h2>Drop an image here</h2><p>or choose a file from your computer</p><button className="primary-button" type="button" onClick={chooseFile}>Choose image</button><small>JPG, PNG, WebP, GIF and more</small>{error && <p className="error-message" role="alert">{error}</p>}</div>}
        <input ref={inputRef} className="visually-hidden" type="file" accept="image/*" onChange={onInputChange} />
      </section>
    </section>
    {isExportOpen && image && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsExportOpen(false) }}>
      <section className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
        <div className="export-modal-heading"><div><p className="eyebrow">Output</p><h2 id="export-modal-title">Export image</h2></div><button className="panel-close-button" type="button" onClick={() => setIsExportOpen(false)} aria-label="Close export dialog">×</button></div>
        <p className="export-modal-copy">Export the current effect stack at the image's original resolution.</p>
        <label className="select-control"><span>Format</span><select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as 'png' | 'jpeg')}><option value="png">PNG — lossless</option><option value="jpeg">JPEG</option></select></label>
        {exportFormat === 'jpeg' && <RangeControl label="JPEG quality" value={jpegQuality} min={60} max={100} suffix="%" onChange={setJpegQuality} />}
        <div className="export-modal-actions"><button className="quiet-button" type="button" onClick={() => setIsExportOpen(false)}>Cancel</button><button className="export-button" type="button" onClick={() => void handleExport()} disabled={isExporting}>{isExporting ? 'Exporting…' : `Export ${exportFormat.toUpperCase()}`}</button></div>
      </section>
    </div>}
  </main>
}

export default App
