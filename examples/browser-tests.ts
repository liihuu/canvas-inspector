import { createDebugger } from '../src/debugger'

const result = document.querySelector<HTMLPreElement>('#result')!
const button = document.querySelector<HTMLButtonElement>('#run')!
button.addEventListener('click', () => {
  button.disabled = true
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const context = canvas.getContext('2d')!
    const original = context.fillRect
    const debug = createDebugger({ captureFrameSnapshots: false })
    const detach = debug.attach(canvas)
    if (context.fillRect !== original) throw new Error('attach installed hooks before start')
    debug.start()
    debug.beginFrame('pixel-comparison')
    context.fillStyle = '#fa5151'
    context.fillRect(4, 5, 20, 30)
    const firstIndex = debug.getCommands()[0]!.index
    context.save()
    context.translate(40, 20)
    context.rotate(0.3)
    context.beginPath()
    context.rect(0, 0, 40, 40)
    context.clip()
    context.fillStyle = '#246bfe'
    context.fillRect(-10, -10, 80, 80)
    context.restore()
    context.beginPath()
    context.moveTo(10, 90)
    context.lineTo(100, 95)
    context.strokeStyle = '#22bb88'
    context.stroke()
    const [frame] = debug.endFrame()
    const target = document.createElement('canvas')
    const inspector = debug.getInspector(canvas)!
    const replay = inspector.replayFrame(frame!.index, target)
    const sourcePixels = context.getImageData(0, 0, 128, 128).data
    const targetContext = target.getContext('2d')!
    const replayPixels = targetContext.getImageData(0, 0, 128, 128).data
    if (!sourcePixels.every((value, index) => value === replayPixels[index]))
      throw new Error(`Full replay pixels differ: ${sourcePixels.findIndex((value, index) => value !== replayPixels[index])}; ${JSON.stringify(replay)}; ${JSON.stringify(debug.getCommands().map((item) => ({ name: item.name, transform: item.state.transform })))}`)
    inspector.replayFrame(frame!.index, target, firstIndex)
    const firstPixel = targetContext.getImageData(5, 6, 1, 1).data
    const blankPixel = targetContext.getImageData(55, 30, 1, 1).data
    if (firstPixel[0] !== 250 || blankPixel[3] !== 0) throw new Error('Step replay pixels differ')
    detach()
    if (context.fillRect !== original) throw new Error('Hook did not restore')
    debug.dispose()

    const median = (values: number[]): number => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!
    const measure = (): number => {
      const samples = []
      for (let round = 0; round < 5; round++) {
        const start = performance.now()
        for (let index = 0; index < 2000; index++) context.fillRect(index % 120, index % 100, 2, 2)
        samples.push(performance.now() - start)
      }
      return median(samples)
    }
    measure()
    const baseline = measure()
    const profiler = createDebugger({ captureFrameSnapshots: false, maxCommands: 1000 })
    profiler.attach(canvas)
    profiler.start()
    const captured = measure()
    profiler.dispose()
    result.textContent = `PASS: full-frame replay matches all ${sourcePixels.length} RGBA values\nPASS: single-step replay draws only the first command\nPASS: attach is inert; detach restores native methods\n\nBenchmark (median of 5 × 2,000 fillRect calls)\nNative: ${baseline.toFixed(2)} ms\nRecording (args + state, no stacks/snapshots): ${captured.toFixed(2)} ms\nAdded cost: ${(((captured - baseline) / 2000) * 1000).toFixed(2)} µs/call\n\n${replay.applied} commands replayed. ${replay.warnings.join(' ')}`
  } catch (error) {
    result.textContent = `FAIL: ${String(error)}`
  } finally {
    button.disabled = false
  }
})
