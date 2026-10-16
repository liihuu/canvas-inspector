type BeforeCall = (method: string, args: unknown[]) => (duration: number) => void
interface ContextHook {
  listeners: Set<BeforeCall>
  restore: Array<() => void>
}
const hooks = new WeakMap<CanvasRenderingContext2D, ContextHook>()

/** Shared per-context hooks also capture references obtained before attachment. */
export function subscribeContext(context: CanvasRenderingContext2D, methods: ReadonlySet<string>, listener: BeforeCall): () => void {
  let hook = hooks.get(context)
  if (!hook) {
    hook = { listeners: new Set(), restore: [] }
    const active = hook
    try {
      for (const method of methods) {
        const target = context as unknown as Record<string, unknown>
        const original = target[method]
        if (typeof original !== 'function') {
          continue
        }
        const descriptor = Object.getOwnPropertyDescriptor(context, method)
        const wrapped = function (this: CanvasRenderingContext2D, ...args: unknown[]): unknown {
          if (this !== context) {
            return Reflect.apply(original, this, args)
          }
          const callbacks = [...active.listeners].map((before) => before(method, args))
          const start = performance.now()
          const result = Reflect.apply(original, this, args)
          const duration = performance.now() - start
          for (const callback of callbacks) {
            callback(duration)
          }
          return result
        }
        Object.defineProperty(context, method, { configurable: true, writable: true, value: wrapped })
        active.restore.push(() => {
          if (target[method] === wrapped) {
            if (descriptor) {
              Object.defineProperty(context, method, descriptor)
            } else {
              Reflect.deleteProperty(context, method)
            }
          }
        })
      }
    } catch (error) {
      for (const restore of active.restore.reverse()) {
        restore()
      }
      throw error
    }
    hooks.set(context, hook)
  }
  hook.listeners.add(listener)
  const shared = hook
  return () => {
    shared.listeners.delete(listener)
    if (!shared.listeners.size) {
      for (const restore of shared.restore.reverse()) {
        restore()
      }
      hooks.delete(context)
    }
  }
}
