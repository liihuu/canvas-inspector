import { discoverCanvases } from './core'
import type { CanvasDevtoolsRegistry } from './registry'
import type { CanvasMetadata, DrawCall, PanelOptions } from './types'

const panelStylesFile = 'panel.css'
const panelStylesUrl = new URL(panelStylesFile, import.meta.url).href

export interface MountPanelOptions extends PanelOptions {
  devtools: CanvasDevtoolsRegistry
}

export interface CanvasDevtoolsPanel {
  readonly element: HTMLElement
  open: () => void
  close: () => void
  destroy: () => void
  selectCanvas: (canvas: HTMLCanvasElement) => void
}

type ViewName = 'inspector' | 'render' | 'profiler'

const escapeHtml = (value: unknown): string =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      })[character] ?? character
  )

const formatArgument = (value: unknown): string => (typeof value === 'string' ? `"${value}"` : (JSON.stringify(value) ?? String(value)))

export function mountCanvasDevtools(options: MountPanelOptions): CanvasDevtoolsPanel {
  const target = options.target ?? document.body
  const host = document.createElement('canvas-devtools-panel')
  host.setAttribute('data-canvas-devtools-internal', '')
  const root = host.attachShadow({ mode: 'open' })
  const stylesheet = document.createElement('link')
  stylesheet.rel = 'stylesheet'
  stylesheet.href = panelStylesUrl
  root.append(stylesheet)
  const panelRoot = document.createElement('div')
  panelRoot.innerHTML = `
    <section class="shell ${options.position ?? 'bottom'}" style="${options.position === 'right' ? '' : `height:${options.height ?? 430}px`}">
      <header class="topbar">
        <div class="brand"><span class="brand-mark"><i></i><i></i><i></i></span><span>Canvas DevTools</span></div>
        <nav class="tabs"><button class="tab active" data-view="inspector">Inspector</button><button class="tab" data-view="render">Render</button><button class="tab" data-view="profiler">Profiler</button></nav>
        <div class="actions"><button class="button active" data-action="pause"><span>●</span> Recording</button><button class="button" data-action="clear">Clear</button><button class="icon" data-action="close" title="关闭面板" aria-label="关闭面板">×</button></div>
      </header>
      <div class="body">
        <aside class="sidebar"><div class="section-head"><span>Canvases</span><span data-count="canvas">0</span></div><div class="canvas-list"></div><div class="section-head"><span>Frames</span><span data-count="frame">0</span></div><div class="frame-list"></div></aside>
        <main class="main">
          <section class="view inspector" data-panel="inspector"><div class="toolbar"><div class="identity"><strong>No Canvas</strong><small>等待 2D 上下文</small></div><button class="button active" data-overlay="grid">Grid</button><button class="button active" data-overlay="crosshair">Crosshair</button><button class="button active" data-overlay="bounds">Bounds</button></div><div class="stage"><div class="preview-wrap"><img class="preview" alt="Canvas snapshot"><span class="coordinate">x: — y: —</span></div></div></section>
          <section class="view render" data-panel="render" hidden><div class="render-tools"><input class="input" type="search" placeholder="搜索方法、参数或堆栈"><select class="select"><option value="all">All calls</option><option value="fill">Fill</option><option value="stroke">Stroke</option><option value="path">Path</option><option value="image">Image</option><option value="transform">Transform</option><option value="state">State</option><option value="clear">Clear</option></select></div><div class="command-list"></div></section>
          <section class="view profiler" data-panel="profiler" hidden><div class="metrics"></div><div class="profile-grid"><article class="card"><h3>调用热点</h3><div class="hotspots"></div></article><article class="card"><h3>重复绘制</h3><div class="repeats"></div></article><article class="card"><h3>交互轨迹</h3><div class="interactions"></div></article><article class="card"><h3>最近慢帧</h3><div class="slow-frames"></div></article></div></section>
        </main>
        <aside class="details"><div class="details-title">Details</div><div class="detail-scroll"></div></aside>
      </div>
      <footer class="status"><span class="status-canvas">0 canvases</span><span class="status-fps">— FPS</span><span class="status-calls">0 calls</span></footer>
    </section>
    <button class="launcher" hidden title="打开 Canvas DevTools" aria-label="打开 Canvas DevTools">C2D</button>
    <div class="page-overlay" hidden><i class="cross-x"></i><i class="cross-y"></i><i class="bounds"></i></div>
  `
  root.append(panelRoot)
  target.append(host)

  const query = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector)
    if (!element) {
      throw new Error(`Canvas DevTools panel element not found: ${selector}`)
    }
    return element
  }
  const shell = query<HTMLElement>('.shell')
  const launcher = query<HTMLButtonElement>('.launcher')
  const pageOverlay = query<HTMLElement>('.page-overlay')
  let selectedCanvas: HTMLCanvasElement | null = null
  let selectedEvent: DrawCall | null = null
  let view: ViewName = 'inspector'
  let paused = false
  const overlays = { grid: true, crosshair: true, bounds: true }
  let renderQueued = false

  const currentInspector = () => (selectedCanvas ? options.devtools.getInspector(selectedCanvas) : null)
  const currentMetadata = (): CanvasMetadata | null => discoverCanvases().find((item) => item.canvas === selectedCanvas) ?? null

  function selectCanvas(canvas: HTMLCanvasElement): void {
    selectedCanvas = canvas
    selectedEvent = options.devtools.getInspector(canvas)?.events.at(-1) ?? null
    render()
  }

  function renderSidebar(): void {
    const canvases = discoverCanvases()
    if (!selectedCanvas || !canvases.some((item) => item.canvas === selectedCanvas)) {
      selectedCanvas = options.devtools.inspectors.keys().next().value ?? canvases[0]?.canvas ?? null
    }
    query<HTMLElement>('[data-count=canvas]').textContent = String(canvases.length)
    query<HTMLElement>('.canvas-list').innerHTML = canvases.length
      ? canvases
          .map(
            (item) => `
      <button class="canvas-row ${item.canvas === selectedCanvas ? 'active' : ''}" data-canvas="${item.index}"><span><strong>#${escapeHtml(item.id)}</strong><small>${item.width} × ${item.height} · DPR ${item.dpr}</small></span><span class="tag">${item.contextType}</span></button>`
          )
          .join('')
      : '<div class="empty">未发现 Canvas</div>'
    const inspector = currentInspector()
    const frames = [...(inspector?.frames ?? [])].reverse()
    query<HTMLElement>('[data-count=frame]').textContent = String(frames.length)
    query<HTMLElement>('.frame-list').innerHTML = frames.length
      ? frames.map((frame) => `<button class="frame-row ${frame.slow ? 'slow' : ''}"><span>#${frame.index}</span><span class="bar"><i style="--w:${Math.min(100, (frame.duration / 25) * 100)}%"></i></span><span>${frame.duration.toFixed(1)}ms</span></button>`).join('')
      : '<div class="empty">等待帧数据</div>'
  }

  function renderInspector(): void {
    const metadata = currentMetadata()
    const inspector = currentInspector()
    const identity = query<HTMLElement>('.identity')
    if (!metadata) {
      identity.innerHTML = '<strong>No Canvas</strong><small>等待 2D 上下文</small>'
      query<HTMLImageElement>('.preview').removeAttribute('src')
      return
    }
    identity.innerHTML = `<strong>#${escapeHtml(metadata.id)}</strong><small>${metadata.width} × ${metadata.height} · CSS ${metadata.cssWidth} × ${metadata.cssHeight} · DPR ${metadata.dpr} · ${metadata.contextType}</small>`
    const latestSnapshot = inspector?.frames.at(-1)?.snapshot
    const image = query<HTMLImageElement>('.preview')
    if (latestSnapshot) {
      image.src = latestSnapshot
    } else {
      try {
        image.src = metadata.canvas.toDataURL('image/png')
      } catch {
        image.removeAttribute('src')
      }
    }
    const interaction = inspector?.interactions.at(-1)
    query<HTMLElement>('.coordinate').textContent = interaction ? `x: ${interaction.x}  y: ${interaction.y}` : 'x: —  y: —'
  }

  function renderCommands(): void {
    const inspector = currentInspector()
    const search = query<HTMLInputElement>('.render-tools input').value.trim().toLowerCase()
    const category = query<HTMLSelectElement>('.render-tools select').value
    const events = (inspector?.events ?? [])
      .filter((event) => {
        const text = `${event.name} ${event.args.join(' ')} ${event.stack.join(' ')}`.toLowerCase()
        return (!search || text.includes(search)) && (category === 'all' || event.category === category)
      })
      .slice(-200)
      .reverse()
    query<HTMLElement>('.command-list').innerHTML = events.length
      ? events.map((event) => `<button class="command-row ${event === selectedEvent ? 'active' : ''}" data-event="${event.index}"><span>#${event.index}</span><strong>${event.name}</strong><span>${escapeHtml(event.args.map(formatArgument).join(', '))}</span><span>${event.duration.toFixed(3)}ms</span></button>`).join('')
      : '<div class="empty">没有匹配的绘制调用</div>'
  }

  function renderProfiler(): void {
    const inspector = currentInspector()
    const frames = inspector?.frames ?? []
    const averageDuration = frames.length ? frames.reduce((sum, frame) => sum + frame.duration, 0) / frames.length : 0
    const averageFps = frames.length ? frames.reduce((sum, frame) => sum + frame.fps, 0) / frames.length : 0
    const slow = frames.filter((frame) => frame.slow)
    query<HTMLElement>('.metrics').innerHTML = [
      ['平均 FPS', frames.length ? averageFps.toFixed(0) : '—', `${frames.length} frames`],
      ['平均帧耗时', frames.length ? `${averageDuration.toFixed(2)} ms` : '—', '16.7 ms budget'],
      ['绘制调用', inspector?.events.length ?? 0, `${frames.length ? ((inspector?.events.length ?? 0) / frames.length).toFixed(1) : 0} / frame`],
      ['慢帧', slow.length, '> 16.7 ms']
    ]
      .map(([label, value, note]) => `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`)
      .join('')
    const hotspots = inspector?.getHotspots() ?? []
    const maxHot = hotspots[0]?.total || 1
    query<HTMLElement>('.hotspots').innerHTML = hotspots.length ? hotspots.map((item) => `<div class="hot-row"><span>${item.name}</span><span class="bar"><i style="--w:${(item.total / maxHot) * 100}%"></i></span><span>${item.total.toFixed(2)}ms</span></div>`).join('') : '<div class="empty">暂无数据</div>'
    const repeats = inspector?.getRepeatedDraws().slice(0, 8) ?? []
    query<HTMLElement>('.repeats').innerHTML = repeats.length ? repeats.map((item) => `<div class="hot-row"><span>${escapeHtml(item.signature.split(':')[0])}</span><span>${escapeHtml(item.signature.slice(0, 80))}</span><span>×${item.count}</span></div>`).join('') : '<div class="empty">未检测到重复绘制</div>'
    const interactions = inspector?.interactions.slice(-8).reverse() ?? []
    query<HTMLElement>('.interactions').innerHTML = interactions.length ? interactions.map((item) => `<div class="hot-row"><span>${item.type}</span><span>x ${item.x}, y ${item.y}</span><span>F${item.frame}</span></div>`).join('') : '<div class="empty">暂无交互</div>'
    query<HTMLElement>('.slow-frames').innerHTML = slow.length
      ? slow
          .slice(-8)
          .reverse()
          .map((frame) => `<div class="hot-row"><span>Frame ${frame.index}</span><span>${frame.callCount} calls</span><span>${frame.duration.toFixed(1)}ms</span></div>`)
          .join('')
      : '<div class="empty">没有慢帧</div>'
  }

  function renderDetails(): void {
    const metadata = currentMetadata()
    const inspector = currentInspector()
    const container = query<HTMLElement>('.detail-scroll')
    if (selectedEvent) {
      const bounds = selectedEvent.bounds
      container.innerHTML = `<section class="detail-section"><h3>绘制调用</h3><pre class="code">ctx.${selectedEvent.name}(${escapeHtml(selectedEvent.args.map(formatArgument).join(', '))})</pre></section>
        <section class="detail-section"><h3>包围盒</h3><dl class="properties">${bounds ? `<dt>x / y</dt><dd>${bounds.x} / ${bounds.y}</dd><dt>width / height</dt><dd>${bounds.width} / ${bounds.height}</dd>` : '<dt>Bounds</dt><dd>不可推断</dd>'}</dl></section>
        <section class="detail-section"><h3>Canvas 状态</h3><dl class="properties">${Object.entries(selectedEvent.state)
          .slice(0, 16)
          .map(([key, value]) => `<dt>${key}</dt><dd>${escapeHtml(Array.isArray(value) ? value.join(', ') : value)}</dd>`)
          .join('')}</dl></section>
        <section class="detail-section"><h3>调用堆栈</h3><pre class="stack">${selectedEvent.stack.length ? escapeHtml(selectedEvent.stack.join('\n')) : '未捕获堆栈'}</pre></section>`
      return
    }
    container.innerHTML = metadata
      ? `<section class="detail-section"><h3>Canvas</h3><dl class="properties"><dt>Element</dt><dd>#${escapeHtml(metadata.id)}</dd><dt>Buffer</dt><dd>${metadata.width} × ${metadata.height}</dd><dt>CSS size</dt><dd>${metadata.cssWidth} × ${metadata.cssHeight}</dd><dt>DPR</dt><dd>${metadata.dpr}</dd><dt>Context</dt><dd>${metadata.contextType}</dd><dt>Calls</dt><dd>${inspector?.events.length ?? 0}</dd></dl></section>`
      : '<div class="empty">选择一个 Canvas</div>'
  }

  function renderPageOverlay(): void {
    const metadata = currentMetadata()
    if (!metadata || view !== 'inspector') {
      pageOverlay.hidden = true
      return
    }
    const rect = metadata.canvas.getBoundingClientRect()
    pageOverlay.hidden = false
    pageOverlay.style.left = `${rect.left}px`
    pageOverlay.style.top = `${rect.top}px`
    pageOverlay.style.width = `${rect.width}px`
    pageOverlay.style.height = `${rect.height}px`
    pageOverlay.style.backgroundImage = overlays.grid ? '' : 'none'
    const interaction = currentInspector()?.interactions.at(-1)
    const crossX = query<HTMLElement>('.cross-x')
    const crossY = query<HTMLElement>('.cross-y')
    crossX.hidden = crossY.hidden = !overlays.crosshair || !interaction
    if (interaction) {
      crossX.style.top = `${(interaction.y / metadata.height) * rect.height}px`
      crossY.style.left = `${(interaction.x / metadata.width) * rect.width}px`
    }
    const bounds = query<HTMLElement>('.bounds')
    bounds.hidden = !overlays.bounds || !selectedEvent?.bounds
    if (selectedEvent?.bounds) {
      bounds.style.left = `${(selectedEvent.bounds.x / metadata.width) * rect.width}px`
      bounds.style.top = `${(selectedEvent.bounds.y / metadata.height) * rect.height}px`
      bounds.style.width = `${(selectedEvent.bounds.width / metadata.width) * rect.width}px`
      bounds.style.height = `${(selectedEvent.bounds.height / metadata.height) * rect.height}px`
    }
  }

  function render(): void {
    renderQueued = false
    renderSidebar()
    renderInspector()
    renderCommands()
    renderProfiler()
    renderDetails()
    renderPageOverlay()
    const inspector = currentInspector()
    const frames = inspector?.frames ?? []
    query<HTMLElement>('.status-canvas').textContent = `${discoverCanvases().length} canvases`
    query<HTMLElement>('.status-fps').textContent = frames.length ? `${frames.at(-1)?.fps.toFixed(0)} FPS` : '— FPS'
    query<HTMLElement>('.status-calls').textContent = `${inspector?.events.length ?? 0} calls`
  }

  function scheduleRender(): void {
    if (renderQueued) {
      return
    }
    renderQueued = true
    window.setTimeout(render, 16)
  }

  root.addEventListener('click', (event) => {
    const targetElement = (event.target as Element).closest<HTMLElement>('button')
    if (!targetElement) {
      return
    }
    const tab = targetElement.dataset.view as ViewName | undefined
    if (tab) {
      view = tab
      root.querySelectorAll('.tab').forEach((item) => {
        item.classList.toggle('active', item === targetElement)
      })
      root.querySelectorAll<HTMLElement>('[data-panel]').forEach((item) => {
        item.hidden = item.dataset.panel !== view
      })
      renderPageOverlay()
      return
    }
    const canvasIndex = targetElement.dataset.canvas
    if (canvasIndex != null) {
      const metadata = discoverCanvases()[Number(canvasIndex)]
      if (metadata) {
        selectCanvas(metadata.canvas)
      }
      return
    }
    const eventIndex = targetElement.dataset.event
    if (eventIndex != null) {
      selectedEvent = currentInspector()?.getEvent(Number(eventIndex)) ?? null
      renderCommands()
      renderDetails()
      renderPageOverlay()
      return
    }
    const overlay = targetElement.dataset.overlay as keyof typeof overlays | undefined
    if (overlay) {
      overlays[overlay] = !overlays[overlay]
      targetElement.classList.toggle('active', overlays[overlay])
      renderPageOverlay()
      return
    }
    switch (targetElement.dataset.action) {
      case 'pause':
        paused = !paused
        for (const inspector of options.devtools.inspectors.values()) {
          inspector.setPaused(paused)
        }
        targetElement.classList.toggle('active', !paused)
        targetElement.innerHTML = paused ? 'Resume' : '<span>●</span> Recording'
        break
      case 'clear':
        currentInspector()?.clear()
        selectedEvent = null
        render()
        break
      case 'close':
        controller.close()
        break
    }
  })
  root.addEventListener('input', (event) => {
    if ((event.target as Element).closest('.render-tools')) {
      renderCommands()
    }
  })
  launcher.addEventListener('click', () => controller.open())
  const updateListener = (): void => scheduleRender()
  options.devtools.addEventListener('update', updateListener)

  const controller: CanvasDevtoolsPanel = {
    element: host,
    open: () => {
      shell.classList.remove('closed')
      launcher.hidden = true
      render()
    },
    close: () => {
      shell.classList.add('closed')
      launcher.hidden = false
      pageOverlay.hidden = true
    },
    destroy: () => {
      options.devtools.removeEventListener('update', updateListener)
      host.remove()
    },
    selectCanvas
  }
  if (options.startOpen === false) {
    controller.close()
  } else {
    controller.open()
  }
  return controller
}
