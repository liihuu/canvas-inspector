import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RingBuffer } from '../dist/buffer.js'
import { createDebugger } from '../dist/debugger.js'
import { CanvasDevtoolsRegistry } from '../dist/registry.js'

class Context {
  fillStyle = '#000'
  font = '12px sans-serif'
  matrix = [1, 0, 0, 1, 0, 0]
  dash = []
  calls = []
  getTransform() {
    const [a, b, c, d, e, f] = this.matrix
    return { a, b, c, d, e, f }
  }
  getLineDash() {
    return this.dash.slice()
  }
  setLineDash(value) {
    this.dash = value.slice()
  }
  setTransform(...value) {
    this.matrix = value
  }
  fillRect(...args) {
    this.calls.push({ method: 'fillRect', args, style: this.fillStyle, transform: this.matrix.slice() })
  }
  clearRect(...args) {
    this.calls.push({ method: 'clearRect', args })
  }
}
class Canvas extends EventTarget {
  dataset = {}
  width = 300
  height = 150
  isConnected = true
  context = new Context()
  getContext(type) {
    return type === '2d' ? this.context : null
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 300, height: 150 }
  }
  hasAttribute() {
    return false
  }
  toDataURL() {
    return 'data:image/png;base64,'
  }
}
globalThis.CanvasRenderingContext2D = Context
globalThis.HTMLCanvasElement = Canvas
globalThis.HTMLImageElement = class {}
globalThis.DOMMatrix = class {}
globalThis.document = { querySelectorAll: () => [] }
globalThis.window = {
  requestAnimationFrame: () => 1,
  setTimeout,
  clearTimeout,
  devicePixelRatio: 1
}

const options = { captureFrameSnapshots: false }

test('fixed capacity preserves FIFO order through multiple wraps', () => {
  const buffer = new RingBuffer(3)
  for (let i = 0; i < 100; i++) buffer.push(i)
  assert.deepEqual(buffer.toArray(), [97, 98, 99])
  buffer.clear()
  assert.deepEqual(buffer.toArray(), [])
  assert.throws(() => new RingBuffer(0), RangeError)
})

test('attach is inert, captures existing context references on start, and detaches exactly', () => {
  const canvas = new Canvas()
  const context = canvas.getContext('2d')
  const original = context.fillRect
  const debug = createDebugger(options)
  const detach = debug.attach(canvas)
  assert.equal(context.fillRect, original)
  context.fillRect(1, 2, 3, 4)
  assert.equal(debug.getCommands().length, 0)
  debug.start()
  debug.beginFrame('explicit')
  context.fillStyle = 'red'
  context.fillRect(1, 2, 3, 4)
  debug.endFrame()
  assert.equal(debug.getCommands().length, 1)
  assert.equal(debug.getCommands()[0].state.fillStyle, 'red')
  debug.stop()
  assert.equal(context.fillRect, original)
  context.fillRect(0, 0, 1, 1)
  assert.equal(debug.getCommands().length, 1)
  debug.start()
  detach()
  detach()
  assert.equal(context.fillRect, original)
  assert.equal(Object.hasOwn(context, 'fillRect'), false)
  debug.dispose()
  assert.throws(() => debug.start(), /disposed/)
})

test('shared context hooks survive either owner stopping', () => {
  const canvas = new Canvas()
  const original = canvas.context.fillRect
  const a = createDebugger(options)
  const b = createDebugger(options)
  a.attach(canvas)
  b.attach(canvas)
  a.start()
  b.start()
  canvas.context.fillRect(0, 0, 1, 1)
  a.dispose()
  canvas.context.fillRect(1, 1, 1, 1)
  assert.equal(a.getCommands().length, 0)
  assert.equal(b.getCommands().length, 2)
  b.dispose()
  assert.equal(canvas.context.fillRect, original)
})

test('frame statistics count evicted commands and stable command ids survive overflow', () => {
  const canvas = new Canvas()
  const debug = createDebugger({ ...options, maxCommands: 3 })
  debug.attach(canvas)
  debug.start()
  debug.beginFrame('overflow')
  for (let i = 0; i < 10; i++) canvas.context.fillRect(i, 0, 2, 2)
  const [frame] = debug.endFrame()
  assert.equal(frame.callCount, 10)
  assert.equal(frame.methodCounts.fillRect, 10)
  assert.equal(frame.startEvent, 0)
  assert.equal(frame.endEvent, 9)
  assert.deepEqual(
    debug.getCommands().map((command) => command.index),
    [7, 8, 9]
  )
  const inspector = debug.getInspector(canvas)
  assert.equal(inspector.getEvent(7).args[0], 7)
  assert.equal(inspector.getEvent(0), null)
  assert.equal(inspector.getRepeatedDraws(1).length, 3)
  const replay = inspector.replayFrame(frame.index, new Canvas())
  assert.ok(replay.warnings.some((warning) => warning.includes('evicted')))
  debug.dispose()
})

test('step replay uses original state and leaves the source canvas untouched', () => {
  const canvas = new Canvas()
  const debug = createDebugger(options)
  debug.attach(canvas)
  debug.start()
  debug.beginFrame()
  canvas.context.fillStyle = 'red'
  canvas.context.fillRect(1, 2, 3, 4)
  canvas.context.fillStyle = 'blue'
  canvas.context.fillRect(5, 6, 7, 8)
  const [frame] = debug.endFrame()
  const inspector = debug.getInspector(canvas)
  const target = new Canvas()
  const result = inspector.replayFrame(frame.index, target, 0)
  assert.equal(result.applied, 1)
  assert.equal(target.context.calls[0].style, 'red')
  assert.equal(canvas.context.calls.length, 2)
  assert.throws(() => inspector.replayFrame(frame.index, canvas), /separate/)
  debug.dispose()
})

test('disabled capture options omit data and report replay limitations', () => {
  const canvas = new Canvas()
  const debug = createDebugger({ ...options, captureArgs: false, captureState: false })
  debug.attach(canvas)
  debug.start()
  debug.beginFrame()
  canvas.context.fillRect(1, 2, 3, 4)
  const [frame] = debug.endFrame()
  assert.deepEqual(debug.getCommands()[0].args, [])
  assert.deepEqual(debug.getCommands()[0].rawArgs, [])
  assert.equal(debug.getCommands()[0].stack.length, 0)
  assert.equal(debug.getInspector(canvas).replayFrame(frame.index, new Canvas()).applied, 0)
  debug.dispose()
})

test('global hooks are shared and restore the exact original descriptors', () => {
  const contextDescriptor = Object.getOwnPropertyDescriptor(Canvas.prototype, 'getContext')
  const rafDescriptor = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame')
  const a = new CanvasDevtoolsRegistry({ ...options, observe: false }).install()
  const b = new CanvasDevtoolsRegistry({ ...options, observe: false }).install()
  const canvas = new Canvas()
  canvas.getContext('2d').fillRect(1, 2, 3, 4)
  assert.equal(a.getInspector(canvas).events.length, 1)
  assert.equal(b.getInspector(canvas).events.length, 1)
  a.uninstall()
  canvas.getContext('2d').fillRect(2, 3, 4, 5)
  assert.equal(b.getInspector(canvas).events.length, 2)
  b.uninstall()
  assert.deepEqual(Object.getOwnPropertyDescriptor(Canvas.prototype, 'getContext'), contextDescriptor)
  assert.deepEqual(Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame'), rafDescriptor)
})
