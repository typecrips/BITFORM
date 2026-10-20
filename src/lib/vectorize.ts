export type VectorOptions = {
  mode: 'logo' | 'color'
  threshold: number
  colors: number
  detail: number
  smoothing: number
  removeBackground: boolean
}

type Point = { x: number; y: number }
type VectorShape = { color: string; d: string }
export type VectorResult = { svg: string; width: number; height: number; shapes: VectorShape[]; palette: string[] }

function hex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
}

function pointKey(p: Point) { return `${p.x},${p.y}` }
function area(points: Point[]) {
  let value = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) value += points[j].x * points[i].y - points[i].x * points[j].y
  return value / 2
}
function distanceToLine(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / Math.hypot(dx, dy)
}
function simplifyOpen(points: Point[], tolerance: number): Point[] {
  if (points.length <= 3) return points
  let max = 0, index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToLine(points[i], points[0], points[points.length - 1])
    if (d > max) { max = d; index = i }
  }
  if (max <= tolerance) return [points[0], points[points.length - 1]]
  const left = simplifyOpen(points.slice(0, index + 1), tolerance)
  const right = simplifyOpen(points.slice(index), tolerance)
  return left.slice(0, -1).concat(right)
}
function simplifyClosed(points: Point[], tolerance: number): Point[] {
  if (points.length <= 5) return points
  // Split at the point farthest from the first point to avoid the closed-ring RDP degeneracy.
  let far = 1, max = 0
  for (let i = 1; i < points.length; i++) { const d = Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y); if (d > max) { max = d; far = i } }
  const a = simplifyOpen(points.slice(0, far + 1), tolerance)
  const b = simplifyOpen(points.slice(far).concat(points.slice(0, 1)), tolerance)
  const merged = a.slice(0, -1).concat(b.slice(0, -1))
  return merged.length >= 3 ? merged : points
}

function contoursForLabel(labels: Int16Array, width: number, height: number, label: number): Point[][] {
  // Trace the exposed sides of each labelled pixel. Directed edges keep the filled area on the right.
  const edges: { a: Point; b: Point }[] = []
  const at = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? -1 : labels[y * width + x]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (at(x, y) !== label) continue
    if (at(x, y - 1) !== label) edges.push({ a: { x, y }, b: { x: x + 1, y } })
    if (at(x + 1, y) !== label) edges.push({ a: { x: x + 1, y }, b: { x: x + 1, y: y + 1 } })
    if (at(x, y + 1) !== label) edges.push({ a: { x: x + 1, y: y + 1 }, b: { x, y: y + 1 } })
    if (at(x - 1, y) !== label) edges.push({ a: { x, y: y + 1 }, b: { x, y } })
  }
  const starts = new Map<string, number[]>()
  edges.forEach((edge, i) => { const key = pointKey(edge.a); const list = starts.get(key) ?? []; list.push(i); starts.set(key, list) })
  const used = new Uint8Array(edges.length)
  const contours: Point[][] = []
  for (let seed = 0; seed < edges.length; seed++) {
    if (used[seed]) continue
    const points: Point[] = [edges[seed].a]
    let edgeIndex = seed, guard = 0
    while (!used[edgeIndex] && guard++ <= edges.length + 1) {
      const edge = edges[edgeIndex]; used[edgeIndex] = 1; points.push(edge.b)
      if (pointKey(edge.b) === pointKey(points[0])) break
      const candidates = starts.get(pointKey(edge.b)) ?? []
      let next = -1
      // Prefer the tightest right-hand turn at diagonal contacts to keep separate regions separate.
      const incoming = Math.atan2(edge.b.y - edge.a.y, edge.b.x - edge.a.x)
      let bestTurn = Infinity
      for (const ci of candidates) if (!used[ci]) {
        const candidate = edges[ci], angle = Math.atan2(candidate.b.y - candidate.a.y, candidate.b.x - candidate.a.x)
        let turn = (angle - incoming + Math.PI * 2) % (Math.PI * 2)
        if (turn < bestTurn) { bestTurn = turn; next = ci }
      }
      if (next < 0) break
      edgeIndex = next
    }
    if (points.length >= 5 && pointKey(points[0]) === pointKey(points[points.length - 1])) {
      points.pop()
      if (Math.abs(area(points)) >= 1) contours.push(points)
    }
  }
  return contours
}

function pointsToSmoothPath(points: Point[], tolerance: number, smoothing: number): string {
  const simplified = simplifyClosed(points, tolerance)
  if (simplified.length < 3) return ''
  if (smoothing <= 0) return `M${simplified.map(p => `${p.x} ${p.y}`).join('L')}Z`
  // Use quadratic segments through midpoints. This gives compact, smooth paths without losing the contour's topology.
  const factor = smoothing / 100
  const mids = simplified.map((p, i) => {
    const next = simplified[(i + 1) % simplified.length]
    return { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 }
  })
  let d = `M${mids[mids.length - 1].x.toFixed(2)} ${mids[mids.length - 1].y.toFixed(2)}`
  for (let i = 0; i < simplified.length; i++) {
    const p = simplified[i], mid = mids[i]
    const control = { x: mid.x + (p.x - mid.x) * factor, y: mid.y + (p.y - mid.y) * factor }
    d += `Q${control.x.toFixed(2)} ${control.y.toFixed(2)} ${mid.x.toFixed(2)} ${mid.y.toFixed(2)}`
  }
  return `${d}Z`
}

function quantize(samples: {r:number;g:number;b:number;a:number}[], options: VectorOptions) {
  const labels = new Int16Array(samples.length).fill(-1)
  const isBackground = (p: typeof samples[number]) => options.removeBackground && p.r > 235 && p.g > 235 && p.b > 235
  if (options.mode === 'logo') {
    samples.forEach((p, i) => {
      if (p.a <= 0.03 || isBackground(p)) return
      const luma = p.r * .299 + p.g * .587 + p.b * .114
      if (luma < options.threshold) labels[i] = 0
    })
    return { labels, palette: ['#000000'] }
  }
  // Sample deterministically for palette initialization to avoid expensive per-pixel object arrays.
  const k = Math.max(2, Math.min(options.colors, 12))
  const centers: number[][] = []
  const step = Math.max(1, Math.floor(samples.length / 12000))
  for (let c = 0; c < k; c++) {
    let p = samples[Math.min(samples.length - 1, Math.floor((c / k) * samples.length))]
    if (!p) p = { r: 0, g: 0, b: 0, a: 1 }
    centers.push([p.r, p.g, p.b])
  }
  for (let iteration = 0; iteration < 5; iteration++) {
    const sums = centers.map(() => [0,0,0,0])
    for (let i = 0; i < samples.length; i += step) {
      const p = samples[i]; if (p.a <= .03 || isBackground(p)) continue
      let best = 0, bestDist = Infinity
      for (let c = 0; c < centers.length; c++) { const q = centers[c]; const d = (p.r-q[0])**2+(p.g-q[1])**2+(p.b-q[2])**2; if (d < bestDist) { bestDist = d; best = c } }
      sums[best][0] += p.r; sums[best][1] += p.g; sums[best][2] += p.b; sums[best][3]++
    }
    centers.forEach((c,i) => { if (sums[i][3]) { c[0]=sums[i][0]/sums[i][3]; c[1]=sums[i][1]/sums[i][3]; c[2]=sums[i][2]/sums[i][3] } })
  }
  const palette = centers.map(c => hex(c[0],c[1],c[2]))
  samples.forEach((p,i) => {
    if (p.a <= .03 || isBackground(p)) return
    let best = 0, bestDist = Infinity
    centers.forEach((q,c) => { const d=(p.r-q[0])**2+(p.g-q[1])**2+(p.b-q[2])**2; if(d<bestDist){bestDist=d;best=c} })
    labels[i] = best
  })
  return { labels, palette }
}

export async function traceImage(url: string, options: VectorOptions): Promise<VectorResult> {
  const img = new Image(); img.decoding = 'async'; img.src = url
  await new Promise<void>((resolve, reject) => { if (img.complete && img.naturalWidth) resolve(); else { img.onload = () => resolve(); img.onerror = () => reject(new Error('Could not read this image for vectorization.')) } })
  return traceRaster(img, img.naturalWidth, img.naturalHeight, options)
}

/**
 * Trace an already-composited canvas without serialising it to an image URL.
 * This is used for effect stacks so vector output and raster export share the
 * exact same input pixels and alpha channel.
 */
export function traceCanvas(canvas: HTMLCanvasElement, options: VectorOptions): VectorResult {
  return traceRaster(canvas, canvas.width, canvas.height, options)
}

function traceRaster(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, options: VectorOptions): VectorResult {
  // Trace at a bounded resolution, retaining enough detail without generating millions of vector nodes.
  const maxSide = Math.round(420 + options.detail * 5.5)
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale)), height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('Canvas is not available in this browser.')
  if (options.smoothing > 0) ctx.filter = `blur(${(options.smoothing / 100) * 0.7}px)`
  ctx.drawImage(source, 0, 0, width, height); ctx.filter = 'none'
  const data = ctx.getImageData(0, 0, width, height).data
  const samples = new Array(data.length / 4)
  for (let i=0,j=0;i<data.length;i+=4,j++) samples[j]={r:data[i],g:data[i+1],b:data[i+2],a:data[i+3]/255}
  const { labels, palette } = quantize(samples, options)
  // Detail controls source sampling; contour tolerance separately controls node count.
  // The old tolerance stayed below ~2.2px and followed tiny raster fluctuations too closely.
  // This wider, nonlinear range removes pixel-scale chatter while preserving larger features.
  const detailLevel = Math.max(0, Math.min(1, (options.detail - 20) / 140))
  const tolerance = 4.2 - detailLevel * 3.25
  const smooth = options.smoothing
  const shapes: VectorShape[] = []
  // Trace each class as contours, including inner loops for holes; avoid one rectangle per source pixel.
  for (let label = 0; label < palette.length; label++) {
    const contours = contoursForLabel(labels, width, height, label)
    const paths = contours.map(c => pointsToSmoothPath(c, tolerance, smooth)).filter(Boolean)
    if (paths.length) shapes.push({ color: palette[label], d: paths.join('') })
  }
  const svgShapes = shapes.map(s => `<path fill="${s.color}" fill-rule="evenodd" clip-rule="nonzero" d="${s.d}"/>`).join('')
  // Keep geometry in trace-pixel coordinates. The viewBox scales it to the intrinsic
  // document size automatically; applying an additional transform here double-scaled it
  // and caused only a magnified fragment to appear in the preview.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sourceWidth}" height="${sourceHeight}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${svgShapes}</svg>`
  return { svg, width, height, shapes, palette: shapes.map(s=>s.color) }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function rgbFromHex(color: string) { const n = parseInt(color.slice(1),16); return [((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255] }
function pdfNum(n: number) { return Number(n.toFixed(3)).toString() }
export function vectorPdf(result: VectorResult, originalWidth: number, originalHeight: number): Blob {
  const pageW=595.28,pageH=841.89,margin=28
  const scale=Math.min((pageW-margin*2)/originalWidth,(pageH-margin*2)/originalHeight)
  const drawW=originalWidth*scale,drawH=originalHeight*scale,left=(pageW-drawW)/2,bottom=(pageH-drawH)/2
  const sx=drawW/result.width, sy=drawH/result.height
  let content='q\n'
  for (const shape of result.shapes) {
    const [r,g,b]=rgbFromHex(shape.color); content += `${pdfNum(r)} ${pdfNum(g)} ${pdfNum(b)} rg\n`
    // SVG paths contain M/L/Q/Z; translate to PDF operators, converting quadratic curves to cubic Béziers.
    const tokens=shape.d.match(/[MLQZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
    let i=0,cur={x:0,y:0},start={x:0,y:0}
    const X=(x:number)=>left+x*sx, Y=(y:number)=>bottom+drawH-y*sy
    while(i<tokens.length){ const cmd=tokens[i++]; if(cmd==='M'||cmd==='L'){ const x=Number(tokens[i++]),y=Number(tokens[i++]); cur={x,y}; if(cmd==='M'){start={x,y};content+=`${pdfNum(X(x))} ${pdfNum(Y(y))} m\n`}else content+=`${pdfNum(X(x))} ${pdfNum(Y(y))} l\n` } else if(cmd==='Q'){ const qx=Number(tokens[i++]),qy=Number(tokens[i++]),x=Number(tokens[i++]),y=Number(tokens[i++]); const c1={x:cur.x+2/3*(qx-cur.x),y:cur.y+2/3*(qy-cur.y)},c2={x:x+2/3*(qx-x),y:y+2/3*(qy-y)}; content+=`${pdfNum(X(c1.x))} ${pdfNum(Y(c1.y))} ${pdfNum(X(c2.x))} ${pdfNum(Y(c2.y))} ${pdfNum(X(x))} ${pdfNum(Y(y))} c\n`;cur={x,y} } else if(cmd==='Z'){content+='h\n';cur=start} }
    content+='f*\n'
  }
  content+='Q\n'
  const enc = new TextEncoder(); const stream=enc.encode(content)
  const objects=[enc.encode('<< /Type /Catalog /Pages 2 0 R >>'),enc.encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),enc.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << >> /Contents 4 0 R >>`),enc.encode(`<< /Length ${stream.length} >>\nstream\n${content}endstream`)]
  const chunks: Uint8Array[]=[]; let offset=0; const offsets=[0]
  const push=(s:string|Uint8Array)=>{const b=typeof s==='string'?enc.encode(s):s;chunks.push(b);offset+=b.length}
  push('%PDF-1.4\n%DITHER\n')
  objects.forEach((obj,i)=>{offsets.push(offset);push(`${i+1} 0 obj\n`);push(obj);push('\nendobj\n')})
  const xref=offset;push(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`);offsets.slice(1).forEach(o=>push(`${String(o).padStart(10,'0')} 00000 n \n`));push(`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)
  const total=chunks.reduce((n,c)=>n+c.length,0), out=new Uint8Array(total);let pos=0;for(const c of chunks){out.set(c,pos);pos+=c.length}
  return new Blob([out],{type:'application/pdf'})
}
