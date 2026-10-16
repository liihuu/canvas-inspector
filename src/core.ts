import { RingBuffer } from './buffer'
import { subscribeContext } from './hook-manager'
import type { Bounds, CanvasInspectorEvents, CanvasInteraction, CanvasMetadata, CanvasState, DrawCall, DrawCallCategory, FrameProfile, Hotspot, InspectorOptions, RepeatedDraw } from './types'

const RECORDED_METHODS = new Set([
  'arc',
  'arcTo',
  'beginPath',
  'bezierCurveTo',
  'clearRect',
  'clip',
  'closePath',
  'drawImage',
  'ellipse',
  'fill',
  'fillRect',
  'fillText',
  'lineTo',
  'moveTo',
  'quadraticCurveTo',
  'rect',
  'reset',
  'resetTransform',
  'putImageData',
  'restore',
  'rotate',
  'roundRect',
  'save',
  'scale',
  'setLineDash',
  'setTransform',
  'stroke',
  'strokeRect',
  'strokeText',
  'transform',
  'translate'
])

const PIXEL_METHODS = new Set(['clearRect', 'drawImage', 'fill', 'fillRect', 'fillText', 'reset', 'stroke', 'strokeRect', 'strokeText'])

const TRACKED_PROPERTIES = [
  'direction',
  'fillStyle',
  'filter',
  'font',
  'globalAlpha',
  'globalCompositeOperation',
  'imageSmoothingEnabled',
  'imageSmoothingQuality',
  'lineCap',
  'lineDashOffset',
  'lineJoin',
  'lineWidth',
  'miterLimit',
  'shadowBlur',
  'shadowColor',
  'shadowOffsetX',
  'shadowOffsetY',
  'strokeStyle',
  'textAlign',
  'textBaseline'
] as const

const PATH_METHODS = new Set(['arc', 'arcTo', 'bezierCurveTo', 'ellipse', 'lineTo', 'moveTo', 'quadraticCurveTo', 'rect', 'roundRect'])

const round = (value: number): number => Number(value.toFixed(3))

function serializeArgument(value: unknown): unknown {
  if (typeof value === 'number') {
    return round(value)
  }
  if (typeof value === 'string' || typeof value === 'boolean' || value == null) {
    return value
  }
  if (value instanceof HTMLImageElement) {
    return `[Image ${value.naturalWidth}x${value.naturalHeight}]`
  }
  if (value instanceof HTMLCanvasElement) {
    return `[Canvas ${value.width}x${value.height}]`
  }
  if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) {
    return `[ImageBitmap ${value.width}x${value.height}]`
  }
  if (value instanceof DOMMatrix) {
    return `matrix(${[value.a, value.b, value.c, value.d, value.e, value.f].map(round).join(', ')})`
  }
  if (Array.isArray(value)) {
    return value.map(serializeArgument)
  }
  return Object.prototype.toString.call(value).slice(8, -1)
}

function copyState(context: CanvasRenderingContext2D, serialize = true): CanvasState {
  const state: Record<string, unknown> = {}
  const record = context as unknown as Record<string, unknown>
  for (const property of TRACKED_PROPERTIES) {
    state[property] = serialize ? serializeArgument(record[property]) : record[property]
  }
  const matrix = context.getTransform()
  state.transform = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
  state.lineDash = context.getLineDash()
  return state as CanvasState
}

function eventCategory(name: string): DrawCallCategory {
  if (name.startsWith('fill')) {
    return 'fill'
  }
  if (name.startsWith('stroke')) {
    return 'stroke'
  }
  if (['translate', 'rotate', 'scale', 'transform', 'setTransform'].includes(name)) {
    return 'transform'
  }
  if (['save', 'restore', 'clip', 'setLineDash'].includes(name)) {
    return 'state'
  }
  if (name === 'drawImage') {
    return 'image'
  }
  if (name === 'clearRect' || name === 'reset') {
    return 'clear'
  }
  if (PATH_METHODS.has(name) || name === 'beginPath' || name === 'closePath') {
    return 'path'
  }
  return 'other'
}

function captureStack(): string[] {
  return (new Error().stack?.split('\n').slice(3) ?? [])
    .filter((line) => !line.includes('canvas-inspector') && !line.includes('/core.'))
    .slice(0, 6)
    .map((line) => line.trim().replace(/^at\s+/, ''))
}

function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) {
    return b ? { ...b } : null
  }
  if (!b) {
    return { ...a }
  }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x: round(x), y: round(y), width: round(right - x), height: round(bottom - y) }
}

function rectFromPoints(points: Array<{ x: number; y: number }>): Bounds | null {
  if (!points.length) {
    return null
  }
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    x: round(x),
    y: round(y),
    width: round(Math.max(...xs) - x),
    height: round(Math.max(...ys) - y)
  }
}

function transformPoint(context: CanvasRenderingContext2D, x: number, y: number): { x: number; y: number } {
  const matrix = context.getTransform()
  return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f }
}

function boundsForCall(context: CanvasRenderingContext2D, name: string, args: unknown[], pathBounds: Bounds | null): Bounds | null {
  const numbers = args as number[]
  const numberAt = (index: number): number => numbers[index] ?? 0
  const box = (x: number, y: number, width: number, height: number): Bounds | null => rectFromPoints([transformPoint(context, x, y), transformPoint(context, x + width, y), transformPoint(context, x + width, y + height), transformPoint(context, x, y + height)])
  if (['fillRect', 'strokeRect', 'clearRect'].includes(name)) {
    return box(numberAt(0), numberAt(1), numberAt(2), numberAt(3))
  }
  if (name === 'fillText' || name === 'strokeText') {
    const metrics = context.measureText(String(args[0]))
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent || parseFloat(context.font) || 12
    return box(numberAt(1), numberAt(2) - height, metrics.width, height)
  }
  if (name === 'fill' || name === 'stroke' || name === 'clip') {
    return pathBounds
  }
  return null
}

function updatePathBounds(context: CanvasRenderingContext2D, name: string, args: unknown[], current: Bounds | null): Bounds | null {
  const numbers = args as number[]
  const numberAt = (index: number): number => numbers[index] ?? 0
  if (name === 'beginPath') {
    return null
  }
  if (name === 'moveTo' || name === 'lineTo') {
    return unionBounds(current, rectFromPoints([transformPoint(context, numberAt(0), numberAt(1))]))
  }
  if (name === 'rect' || name === 'roundRect') {
    return unionBounds(current, boundsForCall(context, 'fillRect', args, current))
  }
  if (name === 'arc' || name === 'ellipse') {
    const center = transformPoint(context, numberAt(0), numberAt(1))
    const radiusX = Math.abs(numberAt(2))
    const radiusY = name === 'ellipse' ? Math.abs(numberAt(3)) : radiusX
    return unionBounds(current, {
      x: center.x - radiusX,
      y: center.y - radiusY,
      width: radiusX * 2,
      height: radiusY * 2
    })
  }
  if (['bezierCurveTo', 'quadraticCurveTo', 'arcTo'].includes(name)) {
    const points: Array<{ x: number; y: number }> = []
    for (let index = 0; index + 1 < numbers.length; index += 2) {
      points.push(transformPoint(context, numberAt(index), numberAt(index + 1)))
    }
    return unionBounds(current, rectFromPoints(points))
  }
  return current
}

export function discoverCanvases(root: ParentNode = document): CanvasMetadata[] {
  return [...root.querySelectorAll<HTMLCanvasElement>('canvas:not([data-canvas-devtools-internal])')].map((canvas, index) => {
    const rect = canvas.getBoundingClientRect()
    const contextType = (canvas.dataset.canvasContext as CanvasMetadata['contextType'] | undefined) ?? 'unknown'
    return {
      id: canvas.id || `canvas-${index + 1}`,
      index,
      canvas,
      contextType,
      width: canvas.width,
      height: canvas.height,
      cssWidth: round(rect.width),
      cssHeight: round(rect.height),
      dpr: round(rect.width ? canvas.width / rect.width : window.devicePixelRatio || 1),
      visible: rect.width > 0 && rect.height > 0
    }
  })
}

export class CanvasInspector extends EventTarget {
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  private readonly eventStore: RingBuffer<DrawCall>
  private readonly frameStore: RingBuffer<FrameProfile>
  get events(): DrawCall[] {
    return this.eventStore.toArray()
  }
  get frames(): FrameProfile[] {
    return this.frameStore.toArray()
  }
  readonly interactions: CanvasInteraction[] = []
  readonly options: Required<Omit<InspectorOptions, 'contextAttributes' | 'context'>> & Pick<InspectorOptions, 'contextAttributes'>
  enabled = false
  paused = false
  frame = 0

  private readonly rawContext: CanvasRenderingContext2D
  private unsubscribe: (() => void) | null = null
  private nextEventIndex = 0
  private frameCallCount = 0
  private framePixelCalls = 0
  private frameMethodCounts: Record<string, number> = {}
  private readonly replayStates = new WeakMap<DrawCall, CanvasState>()
  private frameStart = performance.now()
  private previousFrameStart: number | null = null
  private frameInterval = 0
  private frameEventStart = 0
  private frameLabel: string | null = null
  private pathBounds: Bounds | null = null
  private readonly signatureCounts = new Map<string, number>()
  private readonly stackCache = new Map<string, string[]>()

  constructor(canvas: HTMLCanvasElement, options: InspectorOptions = {}) {
    super()
    this.canvas = canvas
    const rawContext = options.context ?? canvas.getContext('2d', options.contextAttributes)
    if (!(rawContext instanceof CanvasRenderingContext2D)) {
      throw new Error('CanvasInspector supports CanvasRenderingContext2D only')
    }
    this.rawContext = rawContext
    this.options = {
      maxEvents: options.maxEvents ?? 5000,
      maxFrames: options.maxFrames ?? 180,
      captureFrameSnapshots: options.captureFrameSnapshots ?? true,
      snapshotInterval: Math.max(1, options.snapshotInterval ?? 5),
      captureStack: options.captureStack ?? false,
      slowFrameThreshold: options.slowFrameThreshold ?? 16.7,
      patchCanvas: options.patchCanvas ?? true,
      contextAttributes: options.contextAttributes,
      captureArgs: options.captureArgs ?? true,
      captureState: options.captureState ?? true
    }
    this.eventStore = new RingBuffer(this.options.maxEvents)
    this.frameStore = new RingBuffer(this.options.maxFrames)
    this.context = rawContext
    canvas.dataset.canvasContext = '2d'
  }

  on<K extends keyof CanvasInspectorEvents>(type: K, listener: (detail: CanvasInspectorEvents[K]) => void): () => void {
    const handler = (event: Event): void => listener((event as CustomEvent<CanvasInspectorEvents[K]>).detail)
    this.addEventListener(type, handler)
    return () => this.removeEventListener(type, handler)
  }

  start(): this {
    if (this.enabled) {
      return this
    }
    this.unsubscribe = subscribeContext(this.rawContext, RECORDED_METHODS, (name, args) => {
      if (!this.enabled || this.paused) {
        return () => {
          /* Recording is paused. */
        }
      }
      const state = this.options.captureState ? copyState(this.rawContext) : { transform: [], lineDash: [] }
      const rawState = this.options.captureState ? copyState(this.rawContext, false) : null
      return (duration) => this.record(name, args, duration, state, rawState)
    })
    this.enabled = true
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click', 'wheel']) {
      this.canvas.addEventListener(type, this.handlePointer, { passive: true })
    }
    this.beginFrame()
    this.emit('statechange', { enabled: true })
    return this
  }

  stop(): this {
    if (!this.enabled) {
      return this
    }
    this.enabled = false
    this.unsubscribe?.()
    this.unsubscribe = null
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click', 'wheel']) {
      this.canvas.removeEventListener(type, this.handlePointer)
    }
    this.emit('statechange', { enabled: false })
    return this
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.emit('statechange', { paused })
  }

  beginFrame(label: string | null = null): void {
    const now = performance.now()
    this.frameInterval = this.previousFrameStart === null ? 0 : now - this.previousFrameStart
    this.previousFrameStart = now
    this.frameStart = now
    this.frameEventStart = this.nextEventIndex
    this.frameCallCount = this.framePixelCalls = 0
    this.frameMethodCounts = {}
    this.frameLabel = label
  }

  endFrame(): FrameProfile {
    const end = performance.now()
    const duration = end - this.frameStart
    let snapshot: string | null = null
    if (this.options.captureFrameSnapshots && this.frame % this.options.snapshotInterval === 0) {
      try {
        snapshot = this.canvas.toDataURL('image/png')
      } catch {
        snapshot = null
      }
    }
    const profile: FrameProfile = {
      index: this.frame,
      label: this.frameLabel,
      startEvent: this.frameEventStart,
      endEvent: this.nextEventIndex - 1,
      duration: round(duration),
      fps: round(this.frameInterval > 0 ? 1000 / this.frameInterval : 0),
      callCount: this.frameCallCount,
      pixelCalls: this.framePixelCalls,
      slow: duration > this.options.slowFrameThreshold,
      methodCounts: { ...this.frameMethodCounts },
      timestamp: end,
      snapshot
    }
    this.frameStore.push(profile)
    this.emit('frame', profile)
    this.frame += 1
    return profile
  }

  getEvent(index: number): DrawCall | null {
    return this.events.find((event) => event.index === index) ?? null
  }
  getFrame(index: number): FrameProfile | null {
    return this.frames.find((frame) => frame.index === index) ?? null
  }

  getHotspots(limit = 8): Hotspot[] {
    const aggregates = new Map<string, Omit<Hotspot, 'average'>>()
    for (const event of this.events) {
      const current = aggregates.get(event.name) ?? {
        name: event.name,
        calls: 0,
        total: 0,
        max: 0
      }
      current.calls += 1
      current.total += event.duration
      current.max = Math.max(current.max, event.duration)
      aggregates.set(event.name, current)
    }
    return [...aggregates.values()]
      .map((item) => ({
        ...item,
        total: round(item.total),
        average: round(item.total / item.calls),
        max: round(item.max)
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit)
  }

  getRepeatedDraws(minimum = 2): RepeatedDraw[] {
    return [...this.signatureCounts.entries()]
      .filter(([, count]) => count >= minimum)
      .map(([signature, count]) => ({ signature, count }))
      .sort((a, b) => b.count - a.count)
  }

  clear(): void {
    this.eventStore.clear()
    this.frameStore.clear()
    this.nextEventIndex = 0
    this.interactions.length = 0
    this.signatureCounts.clear()
    this.stackCache.clear()
    this.frame = 0
    this.previousFrameStart = null
    this.pathBounds = null
    this.beginFrame()
    this.emit('clear', undefined)
  }

  export(): string {
    const metadata = discoverCanvases().find((item) => item.canvas === this.canvas)
    return JSON.stringify(
      {
        version: 3,
        capturedAt: new Date().toISOString(),
        canvas: metadata ? { ...metadata, canvas: undefined } : null,
        frames: this.frames.map(({ snapshot: _snapshot, ...frame }) => frame),
        interactions: this.interactions,
        hotspots: this.getHotspots(),
        repeatedDraws: this.getRepeatedDraws(),
        events: this.events.map(({ rawArgs: _rawArgs, ...event }) => event)
      },
      null,
      2
    )
  }

  /** Replays retained commands into a separate canvas, never into the inspected target. */
  replayFrame(frameIndex: number, target: HTMLCanvasElement, through = Infinity): { applied: number; warnings: string[] } {
    if (target === this.canvas) {
      throw new Error('Replay requires a separate canvas')
    }
    const frame = this.getFrame(frameIndex)
    if (!frame) {
      throw new Error('Frame is no longer retained')
    }
    const commands = this.events.filter((event) => event.frame === frameIndex && event.index <= through)
    target.width = this.canvas.width
    target.height = this.canvas.height
    const context = target.getContext('2d')
    if (!context) {
      throw new Error('Replay requires a 2D context')
    }
    const warnings = new Set<string>(['Replay starts on a blank canvas; pixels, paths and clips inherited from earlier frames are not restored.'])
    const retained = this.events.filter((event) => event.frame === frameIndex)
    if (retained.length < frame.callCount) {
      warnings.add('Some commands in this frame have been evicted.')
    }
    let applied = 0
    for (const event of commands) {
      const state = this.replayStates.get(event)
      if (!state || !this.options.captureArgs) {
        warnings.add('Replay requires captureArgs and captureState.')
        break
      }
      for (const property of TRACKED_PROPERTIES) {
        Reflect.set(context, property, state[property])
      }
      // Preserve native transform composition; resetting each call changes rasterization precision.
      if (applied === 0) {
        context.setTransform(...(state.transform as [number, number, number, number, number, number]))
      }
      context.setLineDash(state.lineDash)
      try {
        const method = Reflect.get(context, event.name) as (...args: unknown[]) => unknown
        Reflect.apply(method, context, event.rawArgs)
        applied += 1
        if (event.rawArgs.some((arg) => typeof arg === 'object' && arg !== null && !Array.isArray(arg))) {
          warnings.add('Resource objects are live references; subsequent mutations can affect replay.')
        }
      } catch {
        warnings.add(`Unable to replay command #${event.index} (${event.name}).`)
      }
    }
    return { applied, warnings: [...warnings] }
  }

  private record(name: string, rawArgs: unknown[], duration: number, state: CanvasState, rawState: CanvasState | null): void {
    this.pathBounds = updatePathBounds(this.rawContext, name, rawArgs, this.pathBounds)
    const bounds = boundsForCall(this.rawContext, name, rawArgs, this.pathBounds)
    const args = this.options.captureArgs ? rawArgs.map(serializeArgument) : []
    const signature = PIXEL_METHODS.has(name) ? `${name}:${JSON.stringify(args)}:${JSON.stringify(bounds)}` : null
    const repeated = signature ? (this.signatureCounts.get(signature) ?? 0) + 1 : 0
    if (signature) {
      this.signatureCounts.set(signature, repeated)
    }
    const stack = this.options.captureStack ? (this.stackCache.get(name) ?? captureStack()) : []
    if (this.options.captureStack && !this.stackCache.has(name)) {
      this.stackCache.set(name, stack)
    }
    const event: DrawCall = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${this.events.length}`,
      index: this.nextEventIndex++,
      frame: this.frame,
      name,
      category: eventCategory(name),
      args,
      rawArgs: this.options.captureArgs ? rawArgs.slice() : [],
      state,
      bounds,
      duration: round(duration),
      timestamp: round(performance.now()),
      stack,
      signature,
      repeated
    }
    if (rawState) {
      this.replayStates.set(event, rawState)
    }
    this.frameCallCount += 1
    this.framePixelCalls += PIXEL_METHODS.has(name) ? 1 : 0
    this.frameMethodCounts[name] = (this.frameMethodCounts[name] ?? 0) + 1
    const evicted = this.eventStore.push(event)
    if (evicted?.signature) {
      const remaining = (this.signatureCounts.get(evicted.signature) ?? 1) - 1
      if (remaining > 0) {
        this.signatureCounts.set(evicted.signature, remaining)
      } else {
        this.signatureCounts.delete(evicted.signature)
      }
    }
    this.emit('record', event)
  }

  private readonly handlePointer = (event: Event): void => {
    const pointer = event as PointerEvent & WheelEvent
    const rect = this.canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) {
      return
    }
    const interaction: CanvasInteraction = {
      type: event.type,
      frame: this.frame,
      x: round(((pointer.clientX - rect.left) * this.canvas.width) / rect.width),
      y: round(((pointer.clientY - rect.top) * this.canvas.height) / rect.height),
      buttons: pointer.buttons,
      deltaY: round(pointer.deltaY ?? 0),
      timestamp: round(performance.now())
    }
    const previous = this.interactions.at(-1)
    if (event.type !== 'pointermove' || !previous || performance.now() - previous.timestamp > 50) {
      this.interactions.push(interaction)
      if (this.interactions.length > 500) {
        this.interactions.shift()
      }
      this.emit('interaction', interaction)
    }
  }

  private emit<K extends keyof CanvasInspectorEvents>(type: K, detail: CanvasInspectorEvents[K]): void {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }
}

export function inspectCanvas(canvas: HTMLCanvasElement, options?: InspectorOptions): CanvasInspector {
  return new CanvasInspector(canvas, options).start()
}
