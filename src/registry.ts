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

  private originalGetContext: HTMLCanvasElement['getContext'] | null = null
  private originalRequestAnimationFrame: typeof window.requestAnimationFrame | null = null
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
    this.patchGetContext()
    if (this.options.autoFrame) {
      this.patchAnimationFrame()
    }
    if (this.options.observe) {
      this.observeDocument()
    }
    this.scan()
    this.emitUpdate()
    return this
  }

  uninstall(): void {
    if (!this.installed) {
      return
    }
    if (this.originalGetContext) {
      HTMLCanvasElement.prototype.getContext = this.originalGetContext
    }
    if (this.originalRequestAnimationFrame) {
      window.requestAnimationFrame = this.originalRequestAnimationFrame
    }
    this.observer?.disconnect()
    if (this.updateTimer !== null) {
      window.clearTimeout(this.updateTimer)
    }
    for (const inspector of this.inspectors.values()) {
      inspector.stop()
    }
    this.inspectors.clear()
    this.installed = false
    this.emitUpdate()
  }

  scan(root: ParentNode = document): CanvasMetadata[] {
    const canvases = discoverCanvases(root)
    this.dispatchEvent(new CustomEvent('scan', { detail: canvases }))
    return canvases
  }

  attach(canvas: HTMLCanvasElement, context?: CanvasRenderingContext2D): CanvasInspector {
    const existing = this.inspectors.get(canvas)
    if (existing) {
      return existing
    }
    const rawContext = context ?? this.originalGetContext?.call(canvas, '2d', this.options.contextAttributes)
    if (!(rawContext instanceof CanvasRenderingContext2D)) {
      throw new Error('Unable to attach Canvas 2D inspector')
    }
    const inspector = new CanvasInspector(canvas, {
      ...this.options,
      context: rawContext,
      patchCanvas: false
    }).start()
    this.inspectors.set(canvas, inspector)
    const update = (): void => this.scheduleUpdate()
    inspector.addEventListener('record', update)
    inspector.addEventListener('frame', update)
    inspector.addEventListener('interaction', update)
    inspector.addEventListener('clear', update)
    this.dispatchEvent(new CustomEvent('canvasadded', { detail: inspector }))
    this.emitUpdate()
    return inspector
  }

  getInspector(canvas: HTMLCanvasElement): CanvasInspector | null {
    return this.inspectors.get(canvas) ?? null
  }

  snapshot(): RegistrySnapshot {
    return { canvases: discoverCanvases(), inspectors: [...this.inspectors.values()] }
  }

  private patchGetContext(): void {
    const registry = this
    this.originalGetContext = HTMLCanvasElement.prototype.getContext
    const original = this.originalGetContext
    HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, contextId: string, options?: unknown): unknown {
      const context = original.call(this, contextId as never, options as never) as unknown
      this.dataset.canvasContext = contextId
      if (contextId === '2d' && context instanceof CanvasRenderingContext2D && !this.hasAttribute('data-canvas-devtools-internal')) {
        return registry.attach(this, context).context
      }
      return context
    } as HTMLCanvasElement['getContext']
  }

  private patchAnimationFrame(): void {
    this.originalRequestAnimationFrame = window.requestAnimationFrame.bind(window)
    const original = this.originalRequestAnimationFrame
    window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
      original((time) => {
        const inspectors = [...this.inspectors.values()].filter((inspector) => inspector.enabled && !inspector.paused)
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
        for (const node of mutation.removedNodes) {
          if (node instanceof HTMLCanvasElement) {
            const inspector = this.inspectors.get(node)
            if (inspector) {
              inspector.stop()
              this.inspectors.delete(node)
              this.dispatchEvent(new CustomEvent('canvasremoved', { detail: inspector }))
              changed = true
            }
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
    defaultRegistry = new CanvasDevtoolsRegistry(options).install()
  }
  return defaultRegistry
}

export function getCanvasDevtools(): CanvasDevtoolsRegistry | null {
  return defaultRegistry
}

export function uninstallCanvasDevtools(): void {
  defaultRegistry?.uninstall()
  defaultRegistry = null
}
