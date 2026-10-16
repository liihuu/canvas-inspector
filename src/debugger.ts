import { CanvasDevtoolsRegistry } from './registry'
import type { InspectorOptions } from './types'

export interface DebuggerOptions extends InspectorOptions {
  maxCommands?: number
  slowFrameMs?: number
}

/** Explicit attachment never patches global APIs or starts recording. */
export function createDebugger(options: DebuggerOptions = {}) {
  const registry = new CanvasDevtoolsRegistry({
    ...options,
    maxEvents: options.maxCommands ?? options.maxEvents,
    slowFrameThreshold: options.slowFrameMs ?? options.slowFrameThreshold,
    autoFrame: false,
    observe: false
  })
  let running = false
  let disposed = false
  const assertActive = (): void => {
    if (disposed) {
      throw new Error('Canvas debugger has been disposed')
    }
  }
  return {
    registry,
    attach(canvas: HTMLCanvasElement): () => void {
      assertActive()
      if (registry.inspectors.has(canvas)) {
        throw new Error('Canvas is already attached')
      }
      const inspector = registry.attach(canvas, undefined, running)
      return () => {
        if (registry.getInspector(canvas) === inspector) {
          registry.detach(canvas)
        }
      }
    },
    start(): void {
      assertActive()
      running = true
      for (const inspector of registry.inspectors.values()) {
        inspector.start()
      }
    },
    stop(): void {
      running = false
      for (const inspector of registry.inspectors.values()) {
        inspector.stop()
      }
    },
    beginFrame(label?: string): void {
      assertActive()
      if (running) {
        for (const inspector of registry.inspectors.values()) {
          inspector.beginFrame(label)
        }
      }
    },
    endFrame() {
      assertActive()
      return running ? [...registry.inspectors.values()].map((inspector) => inspector.endFrame()) : []
    },
    getCommands: () => [...registry.inspectors.values()].flatMap((inspector) => inspector.events),
    getFrames: () => [...registry.inspectors.values()].flatMap((inspector) => inspector.frames),
    getStats: () => [...registry.inspectors.values()].map((inspector) => ({ canvas: inspector.canvas, calls: inspector.events.length, frames: inspector.frames.length, hotspots: inspector.getHotspots() })),
    getInspector: (canvas: HTMLCanvasElement) => registry.getInspector(canvas),
    dispose(): void {
      registry.uninstall()
      running = false
      disposed = true
      registry.dispatchEvent(new Event('update'))
    }
  }
}
