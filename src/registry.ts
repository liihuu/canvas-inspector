import { CanvasInspector, discoverCanvases } from './core'
import type { CanvasMetadata, InstallOptions } from './types'

export interface RegistrySnapshot {
  canvases: CanvasMetadata[]
  inspectors: CanvasInspector[]
}

export class CanvasDevtoolsRegistry extends EventTarget {
  readonly inspectors = new Map<HTMLCanvasElement, CanvasInspector>()
  readonly options: Required<Pick<InstallOptions, 'autoFrame' | 'observe'>> & InstallOptions
  installed = false

  private readonly subscriptions = new Map<HTMLCanvasElement, () => void>()
  private observer: MutationObserver | null = null
  private updateTimer: number | null = null

  constructor(options: InstallOptions = {}) {
    super()
    this.options = {
      autoFrame: options.autoFrame ?? true,
      observe: options.observe ?? true,
      ...options
    }
  }

  install(): this {
    if (this.installed) {
      return this
    }
    this.installed = true
    addRegistry(this)
    if (this.options.observe) {
      this.observeDocument()
    }
    this.scan()
    this.emitUpdate()
    return this
  }

  uninstall(): void {
    if (this.installed) {
      removeRegistry(this)
    }
    this.observer?.disconnect()
    if (this.updateTimer !== null) {
      window.clearTimeout(this.updateTimer)
      this.updateTimer = null
    }
    for (const canvas of this.inspectors.keys()) {
      this.detach(canvas)
    }
    this.installed = false
    this.emitUpdate()
  }

  scan(root: ParentNode = document): CanvasMetadata[] {
    const canvases = discoverCanvases(root)
    this.dispatchEvent(new CustomEvent('scan', { detail: canvases }))
    return canvases
  }

  attach(canvas: HTMLCanvasElement, context?: CanvasRenderingContext2D, start = true): CanvasInspector {
    const existing = this.inspectors.get(canvas)
    if (existing) {
      return existing
    }
    const rawContext = context ?? nativeGetContext.call(canvas, '2d', this.options.contextAttributes)
    const attached = this.inspectors.get(canvas)
    if (attached) {
      return attached
    }
    if (!(rawContext instanceof CanvasRenderingContext2D)) {
      throw new Error('Unable to attach Canvas 2D inspector')
    }
    const inspector = new CanvasInspector(canvas, {
      ...this.options,
      context: rawContext,
      patchCanvas: false
    })
    if (start) {
      inspector.start()
    }
    this.inspectors.set(canvas, inspector)
    const update = (): void => this.scheduleUpdate()
    inspector.addEventListener('record', update)
    inspector.addEventListener('frame', update)
    inspector.addEventListener('interaction', update)
    inspector.addEventListener('clear', update)
    this.subscriptions.set(canvas, () => {
      for (const type of ['record', 'frame', 'interaction', 'clear']) {
        inspector.removeEventListener(type, update)
      }
    })
    this.dispatchEvent(new CustomEvent('canvasadded', { detail: inspector }))
    this.emitUpdate()
    return inspector
  }

  detach(canvas: HTMLCanvasElement): void {
    const inspector = this.inspectors.get(canvas)
    if (!inspector) {
      return
    }
    inspector.stop()
    this.subscriptions.get(canvas)?.()
    this.subscriptions.delete(canvas)
    this.inspectors.delete(canvas)
    this.dispatchEvent(new CustomEvent('canvasremoved', { detail: inspector }))
    this.emitUpdate()
  }

  getInspector(canvas: HTMLCanvasElement): CanvasInspector | null {
    return this.inspectors.get(canvas) ?? null
  }

  snapshot(): RegistrySnapshot {
    return { canvases: discoverCanvases(), inspectors: [...this.inspectors.values()] }
  }

  private observeDocument(): void {
    this.observer = new MutationObserver((mutations) => {
      let changed = false
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLCanvasElement || (node instanceof Element && node.querySelector('canvas'))) {
            changed = true
          }
        }
        for (const canvas of this.inspectors.keys()) {
          if (!canvas.isConnected) {
            this.detach(canvas)
            changed = true
          }
        }
      }
      if (changed) {
        this.scan()
        this.emitUpdate()
      }
    })
    this.observer.observe(document.documentElement, { childList: true, subtree: true })
  }

  private emitUpdate(): void {
    this.dispatchEvent(new CustomEvent<RegistrySnapshot>('update', { detail: this.snapshot() }))
  }

  private scheduleUpdate(): void {
    if (this.updateTimer !== null) {
      return
    }
    this.updateTimer = window.setTimeout(() => {
      this.updateTimer = null
      this.emitUpdate()
    }, 16)
  }
}

let defaultRegistry: CanvasDevtoolsRegistry | null = null

export function installCanvasDevtools(options: InstallOptions = {}): CanvasDevtoolsRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new CanvasDevtoolsRegistry(options)
  }
  return defaultRegistry.install()
}

export function getCanvasDevtools(): CanvasDevtoolsRegistry | null {
  return defaultRegistry
}

export function uninstallCanvasDevtools(): void {
  defaultRegistry?.uninstall()
  defaultRegistry = null
}

// All registries share one pair of global hooks; the final owner restores descriptors.
const registries = new Set<CanvasDevtoolsRegistry>()
const nativeGetContext = function (this: HTMLCanvasElement, type: string, attributes?: unknown): unknown {
  return this.getContext(type as never, attributes as never)
}
let restoreGlobals: (() => void) | null = null

function addRegistry(registry: CanvasDevtoolsRegistry): void {
  registries.add(registry)
  if (restoreGlobals) {
    return
  }
  const proto = HTMLCanvasElement.prototype
  const contextDescriptor = Object.getOwnPropertyDescriptor(proto, 'getContext')!
  const rafDescriptor = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame')!
  const originalGetContext = proto.getContext
  const originalRaf = window.requestAnimationFrame
  const getContext = function (this: HTMLCanvasElement, type: string, attributes?: unknown): unknown {
    const context = originalGetContext.call(this, type as never, attributes as never)
    this.dataset.canvasContext = type
    if (type === '2d' && context instanceof CanvasRenderingContext2D && !this.hasAttribute('data-canvas-devtools-internal')) {
      for (const owner of registries) {
        owner.attach(this, context)
      }
    }
    return context
  } as HTMLCanvasElement['getContext']
  const requestAnimationFrame = (callback: FrameRequestCallback): number =>
    originalRaf.call(window, (time) => {
      const inspectors = [...new Set([...registries].filter((owner) => owner.options.autoFrame).flatMap((owner) => [...owner.inspectors.values()]))].filter((inspector) => inspector.enabled && !inspector.paused)
      for (const inspector of inspectors) {
        inspector.beginFrame('requestAnimationFrame')
      }
      try {
        callback(time)
      } finally {
        for (const inspector of inspectors) {
          inspector.endFrame()
        }
      }
    })
  Object.defineProperty(proto, 'getContext', { ...contextDescriptor, value: getContext })
  Object.defineProperty(window, 'requestAnimationFrame', { ...rafDescriptor, value: requestAnimationFrame })
  restoreGlobals = () => {
    if (proto.getContext === getContext) {
      Object.defineProperty(proto, 'getContext', contextDescriptor)
    }
    if (window.requestAnimationFrame === requestAnimationFrame) {
      Object.defineProperty(window, 'requestAnimationFrame', rafDescriptor)
    }
  }
}

function removeRegistry(registry: CanvasDevtoolsRegistry): void {
  registries.delete(registry)
  if (!registries.size) {
    restoreGlobals?.()
    restoreGlobals = null
  }
}
