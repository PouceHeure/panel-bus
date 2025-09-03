'use strict'

/****************** GEO & UTILS ******************/

const averageKmPerHBus = 25.0;

// Conversions + math
function toRad(d) {
  return (d * Math.PI) / 180
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v))
}

// Distance + time formatting
function formatDistance(meters) {
  const m = Math.abs(meters)
  if (m >= 1000) return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`
  if (m >= 100) return `${Math.round(m)} m`
  return `${Math.max(1, Math.round(m))} m`
}
function formatSecond(seconds) {
  return seconds < 60
    ? `${Math.round(seconds)} s`
    : `${Math.floor(seconds / 60)} min`
}
function dateToStringHHMMSS(d) {
  const dt = d instanceof Date ? d : new Date(d)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`
}

// Text helpers
function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text
  const ellipsis = '…'
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + ellipsis
}

// Geometry
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null
}

// Simple lat/lon → XY projection (equirectangular around origin)
class GeoProjector {
  constructor(lat0 = 0, lon0 = 0) {
    this.setOrigin(lat0, lon0)
  }
  setOrigin(lat0, lon0) {
    this.lat0 = lat0
    this.lon0 = lon0
    this.R = 6371000
    this.cosLat0 = Math.cos(toRad(lat0))
  }
  toXY(lat, lon) {
    const x = this.R * toRad(lon - this.lon0) * this.cosLat0
    const y = this.R * toRad(lat - this.lat0)
    return { x, y }
  }
}

/****************** CORE MODELS ******************/

// GPS wrapper
class GPS {
  constructor(lat, lon) {
    this.lat = lat
    this.lon = lon
  }
  static equal(g1, g2) {
    return g1.lat === g2.lat && g1.lon === g2.lon
  }
  static approxEqualMeters(g1, g2, epsMeters = 1) {
    return haversineDistance(g1.lat, g1.lon, g2.lat, g2.lon) <= epsMeters
  }
}

// Base entity
class Entity {
  constructor(position_gps) {
    this.position_gps = position_gps
    this.position_x = 0 // cumulative distance from origin (m)
  }
}

// Bus with smoothing + history
class Bus extends Entity {
  constructor(id) {
    super(new GPS(0, 0))
    this.id = id
    this.date = null
    this.position_x_goal = 0
    this.OldBus = []
    this._xFiltered = null
    this._lastTs = null
    this.is_the_next = false
  }
  updateGps(position_gps, date = null) {
    const moved = !GPS.approxEqualMeters(this.position_gps, position_gps, 0.5)
    if (moved) {
      this.position_gps = position_gps
      this.date = date ?? new Date()
      this._lastTs = +this.date
    }
    return moved
  }
  smoothX(x, nowMs = Date.now(), tau = 4) {
    if (this._xFiltered == null || this._lastTs == null) {
      this._xFiltered = x
      this._lastTs = nowMs
      return this._xFiltered
    }
    const dt = Math.max(0, (nowMs - this._lastTs) / 1000)
    const alpha = 1 - Math.exp(-dt / Math.max(0.001, tau))
    this._xFiltered += alpha * (x - this._xFiltered)
    this._lastTs = nowMs
    return this._xFiltered
  }
  isTheNext(v) {
    this.is_the_next = v
  }
  savePosition() {
    this.OldBus.push({
      position_x: this.position_x,
      position_x_goal: this.position_x_goal,
      date: this.date
    })
    if (this.OldBus.length > 12) this.OldBus.shift()
  }
}

// Station
class Station extends Entity {
  constructor(name, id, gps) {
    super(gps)
    this.name = name
    this.id = id
  }
}

function computeDistanceXYElements(e1, e2) {
  return haversineDistance(e1.position_gps.lat, e1.position_gps.lon, e2.position_gps.lat, e2.position_gps.lon)
}

const StatusConnection = Object.freeze({
  WAIT_CONNECTION: 0,
  NO_CONNECTED: 1,
  CONNECTED: 2
})

/****************** APP ******************/

class LineBusApp {
  static BASE_URL_GET_STOPS = 'https://api.oisemob.cityway.fr:443/api/map/v2/GetLineStops/json'
  static BASE_URL_VEHICLE = 'wss://api.oisemob.cityway.fr/sdh/vehicles'
  static BASE_URL_NEGOTIATE = 'https://api.oisemob.cityway.fr/sdh/vehicles/negotiate?negotiateVersion=1'

  constructor(lineId, lineDirection, lineName, lineDestination, lineColor, stationGoalId, numberStations, canvas) {
    this.lineId = lineId
    this.lineDirection = lineDirection
    this.lineName = lineName
    this.lineDestination = lineDestination
    this.lineColor = lineColor
    this.stationGoalId = stationGoalId
    this.numberStations = numberStations

    this.stations = []
    this.stationOrigin = null
    this.stationGoal = null
    this.stationGoalIndex = null
    this.busList = []
    this.segments = []
    this.projector = new GeoProjector()

    this.elementDrawer = new ElementDrawer(lineDirection, canvas, lineColor)
    this.drawerLine = new DrawBusLine(this.elementDrawer, lineName, lineDestination, stationGoalId)
    this.statutConnection = StatusConnection.WAIT_CONNECTION

    // Debounced resize
    this._resizeRaf = null
    window.addEventListener('resize', () => {
      cancelAnimationFrame(this._resizeRaf)
      this._resizeRaf = requestAnimationFrame(() => {
        this.elementDrawer.getHTMLElements()
        this.drawerLine.updateScale()
        this.draw()
      })
    })
  }

  /* ----- Stations ----- */
  async loadBusStations() {

  this.statutConnection = StatusConnection.WAIT_CONNECTION
  this.draw()

  const params = new URLSearchParams({ Line: this.lineId, Direction: this.lineDirection })
  const url = `${LineBusApp.BASE_URL_GET_STOPS}?${params.toString()}`
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`Network response not ok: ${r.status}`)
    const data = await r.json()
    this.updateStations(data.Data)
    this.updateStationGoal(this.stationGoalId)
    this.setupDraw()
    await this.fetchConnectionToken()
    return data
  } catch (e) {
    console.error('Error loading bus stations:', e)
  }
}

  updateStations(raw) {
    this.stations = []
    let distance = 0
    const tmp = (raw || []).map(e => new Station(e.Name, e.LogicalStopId, new GPS(e.Latitude, e.Longitude)))
    if (!tmp.length) return
    this.projector.setOrigin(tmp[0].position_gps.lat, tmp[0].position_gps.lon)

    for (let i = 0; i < tmp.length; i++) {
      const st = tmp[i]
      if (i === 0) {
        st.position_x = 0
        this.stationOrigin = st
      } else {
        distance += computeDistanceXYElements(tmp[i - 1], st)
        st.position_x = distance
      }
      st._xy = this.projector.toXY(st.position_gps.lat, st.position_gps.lon)
      this.stations.push(st)
    }

    // Build projected segments
    this.segments = []
    for (let i = 0; i < this.stations.length - 1; i++) {
      const A = this.stations[i], B = this.stations[i + 1]
      const ABx = B._xy.x - A._xy.x
      const ABy = B._xy.y - A._xy.y
      const lenXY2 = ABx * ABx + ABy * ABy || 1e-6
      const lenMeters = computeDistanceXYElements(A, B)
      this.segments.push({ i, A, B, ax: A._xy.x, ay: A._xy.y, bx: B._xy.x, by: B._xy.y, abx: ABx, aby: ABy, lenXY2, lenMeters, cumStartMeters: A.position_x })
    }
  }
  updateStationGoal(id) {
    this.stationGoal = this.stations.find(s => String(s.id) === String(id)) || null
    this.stationGoalIndex = this.stations.findIndex(s => String(s.id) === String(id))
    this.stationGoalId = id
  }
  doTruncStations(b, e) {
    b = clamp(b, 0, this.stations.length - 1)
    e = clamp(e, 0, this.stations.length - 1)
    return this.stations.slice(Math.min(b, e), Math.max(b, e) + 1)
  }
  setupDraw() {
    if (this.stationGoalIndex == null || this.stationGoalIndex < 0) return
    let startIdx = this.stationGoalIndex - this.numberStations
    if (startIdx < 0) startIdx = 0
    this.drawerLine.updateStations(this.doTruncStations(startIdx, this.stationGoalIndex))
    this.draw()
  }

  /* ----- Bus positions ----- */
  computeDistanceXFromOrigin(bus) {
    if (!this.segments.length) return 0
    const p = this.projector.toXY(bus.position_gps.lat, bus.position_gps.lon)
    let best = { d2: Infinity, x: 0 }
    for (const s of this.segments) {
      const APx = p.x - s.ax, APy = p.y - s.ay
      let t = (APx * s.abx + APy * s.aby) / s.lenXY2
      t = clamp(t, 0, 1)
      const projx = s.ax + t * s.abx, projy = s.ay + t * s.aby
      const d2 = (p.x - projx) ** 2 + (p.y - projy) ** 2
      if (d2 < best.d2) best = { d2, x: s.cumStartMeters + t * s.lenMeters }
    }
    return best.x
  }
  computeDistanceToGoal(bus) {
    return this.stationGoal ? this.stationGoal.position_x - bus.position_x : 0
  }

  /* ----- Drawing ----- */
  draw() {
    this.elementDrawer.clearCanvas()
    this.drawerLine.updateStatus(this.statutConnection)
    this.drawerLine.draw()


    const drawerBus = new DrawBus(this.elementDrawer)
    this.busList.forEach(b => {
      drawerBus.updateBus(b)
      drawerBus.draw()
      b.OldBus.forEach(bOld => {
        drawerBus.updateBus(Object.assign(new Bus(b.id), bOld), true)
        drawerBus.draw()
      })
    })
  }

  /* ----- WebSocket ----- */
  sendInitialMessages(ws) {
    ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + '\u001E')
    ws.send(JSON.stringify({
      arguments: [`#lineId:${this.lineId}:${this.lineDirection}`],
      invocationId: '0',
      target: 'Join',
      type: 1
    }) + '\u001E')
  }
  openWebSocket(url) {
    try { if (this.ws) this.ws.close() } catch {}
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.statutConnection = StatusConnection.CONNECTED
      this.sendInitialMessages(this.ws)
    }
    this.ws.onmessage = msg => this.handleMessage(msg.data)

    const markDown = () => { this.statutConnection = StatusConnection.NO_CONNECTED }
    this.ws.onerror = markDown
    this.ws.onclose = markDown
  }
  handleMessage(data) {
    if (!data) { this.statutConnection = StatusConnection.NO_CONNECTED; return }
    const packets = [].concat(this.processReceivedData(data) || [])
    for (const d of packets) {
      if (!d?.Latitude || !d?.Longitude) continue
      const id = d.VJourneyId || d.VehicleJourneyId || d.Id
      let bus = this.busList.find(b => b.id == id)
      if (!bus) { bus = new Bus(id); this.busList.push(bus) }
      const gps = new GPS(d.Latitude, d.Longitude)
      const moved = bus.updateGps(gps, new Date(d.RecordedAtTime || Date.now()))
      if (moved) {
        bus.position_x = this.computeDistanceXFromOrigin(bus)
        bus.position_x_goal = this.computeDistanceToGoal(bus)
        bus.savePosition()
        this.draw()
      }
    }
  }
  async fetchConnectionToken() {
    if (this._negotiated) return
    try {
      const r = await fetch(LineBusApp.BASE_URL_NEGOTIATE, { method: 'POST', body: '' })
      const data = await r.json()
      const token = data.connectionToken || data.ConnectionToken || data.connectionId
      if (!token) throw new Error('No connection token')
      this._negotiated = true
      this._wsToken = token
      this.openWebSocket(`${LineBusApp.BASE_URL_VEHICLE}?id=${token}`)
    } catch (e) {
      console.error('Error fetching token:', e)
    }
  }
  processReceivedData(raw) {
    return String(raw).split('\u001E').filter(Boolean).map(str => {
      try {
        const parsed = JSON.parse(str)
        if (Array.isArray(parsed.arguments) && parsed.arguments.length > 1) {
          return JSON.parse(parsed.arguments[1])
        }
      } catch {}
      return null
    }).filter(Boolean)
  }
  shutdown() {
    if (this.ws) this.ws.close()
  }
}

/****************** DRAWING ******************/

class ElementDrawer {
  constructor(direction, canvas, mainColor) {
    this.direction = direction
    this.canvas = canvas
    this.mainColor = mainColor
    this.getHTMLElements()
  }
  getHTMLElements() {
    this.width = Math.round(document.body.clientWidth)
    this.height = (350 / 1000) * this.width
    this.ctx = this.canvas.getContext('2d')
    const scale = window.devicePixelRatio || 1
    this.canvas.width = this.width * scale
    this.canvas.height = this.height * scale
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0)
    this.startDraw = this.width * 0.1
    this.endDraw = this.width * 0.9
    this.distanceDraw = this.endDraw - this.startDraw
    this.heightLine = this.height * 0.75
  }
  getPixelFromPercent(p) { return (p * this.width) / 800 }

  getHeightLine() {
  return this.heightLine
}

 getWidth () {
    return this.width
  }

  getHeight () {
    return this.height
  }

  clearCanvas() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height) }
  transformPositionToPixel(e) {
    return ((e.position_x - this.origin_x) / (this.scale || 1)) * this.distanceDraw + this.startDraw
  }
  updateTF(origin_x, last_x, scale) {
    this.origin_x = origin_x
    this.last_x = last_x
    this.scale = scale || 1
  }
  isIn(x, y) { return x >= 0 && x < this.width && y >= 0 && y < this.height }
  fontSize(basePx) {
    const scale = this.width / 800
    return Math.max(10, Math.min(42, Math.round(basePx * scale)))
  }
  setFont(ctx, weight, px, family = 'system-ui, -apple-system, Segoe UI, Roboto') {
    ctx.font = `${weight} ${px}px ${family}`
  }
}

class Draw { draw() {} }

class DrawBusLine extends Draw {
  constructor(elementDrawer, name, destination, stationGoalId) {
    super()
    this.elementDrawer = elementDrawer
    this.name = name
    this.destination = destination
    this.stationGoalId = stationGoalId
    this.stations = []
    this.statusConnection = StatusConnection.WAIT_CONNECTION
    this.loadingAngle = 0
    this.isAnimatingLoading = false
  }
  updateStations(st) { this.stations = st; this.updateScale() }
  updateStatus(s) { this.statusConnection = s }
  updateScale() {
    let scale = 0, origin_x = 0, last_x = 0
    if (this.stations.length) {
      origin_x = this.stations[0].position_x
      last_x = this.stations[this.stations.length - 1].position_x
      scale = last_x - origin_x
    }
    this.elementDrawer.updateTF(origin_x, last_x, scale)
  }
  drawHeader(ctx, isConnected) {
    ctx.save()
    const titlePx = this.elementDrawer.fontSize(28)
    const subPx = this.elementDrawer.fontSize(14)
    this.elementDrawer.setFont(ctx, '600', titlePx)
    ctx.fillStyle = this.elementDrawer.mainColor
    const title = truncateText(ctx, `${this.name}  ${this.destination}`, this.elementDrawer.getWidth() * 0.84)
    ctx.fillText(title, this.elementDrawer.getPixelFromPercent(30), this.elementDrawer.getPixelFromPercent(35))
    this.elementDrawer.setFont(ctx, '400', subPx)
    const getLabelSafe = typeof getLabel === 'function' ? getLabel : k => ({ status: 'Status', statusConnected: 'Connected', statusWaitConnection: 'Connecting…', statusNotConnected: 'Disconnected' }[k] || k)
    let label = getLabelSafe('statusConnected')
    if (this.statusConnection === StatusConnection.WAIT_CONNECTION) label = getLabelSafe('statusWaitConnection')
    else if (this.statusConnection === StatusConnection.NO_CONNECTED) label = getLabelSafe('statusNotConnected')
    ctx.fillStyle = this.elementDrawer.mainColor
    ctx.fillText(`${getLabelSafe('status')}: ${label}`, this.elementDrawer.getPixelFromPercent(30), this.elementDrawer.getPixelFromPercent(35) + subPx + 6)
    ctx.restore()
  }
  draw() {
    const ctx = this.elementDrawer.ctx
    const y = this.elementDrawer.getHeightLine()
    const isConnected = this.statusConnection === StatusConnection.CONNECTED
    
    if (this.statusConnection === StatusConnection.WAIT_CONNECTION) {
  if (!this.isAnimatingLoading) {
    console.log("ici")
    this.isAnimatingLoading = true
    this.loadingProgress = 0

    const animate = () => {
      if (this.statusConnection !== StatusConnection.WAIT_CONNECTION) {
        return
      }

      const ctx = this.elementDrawer.ctx
      const y = this.elementDrawer.getHeightLine()

      this.elementDrawer.clearCanvas()

      ctx.save()
      ctx.strokeStyle = this.elementDrawer.mainColor
      ctx.lineWidth = this.elementDrawer.getPixelFromPercent(6)
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(this.elementDrawer.width * this.loadingProgress, y)
      ctx.stroke()
      ctx.restore()

      this.loadingProgress += 0.01
      if (this.loadingProgress > 1) {
        this.loadingProgress = 0
      }

      requestAnimationFrame(animate)
    }

    animate()
  }
  return
}


    // Draw line
    ctx.save()
    const w = this.elementDrawer.getPixelFromPercent(6)
    const grad = ctx.createLinearGradient(0, y, this.elementDrawer.width, y)
    grad.addColorStop(0, this.elementDrawer.mainColor)
    grad.addColorStop(1, this.elementDrawer.mainColor)
    ctx.strokeStyle = grad
    ctx.lineWidth = w
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(this.elementDrawer.width, y)
    ctx.stroke()
    ctx.restore()
    // Stations
    this.stations.forEach(st => {
      const x = this.elementDrawer.transformPositionToPixel(st)
      const ringOuter = this.elementDrawer.getPixelFromPercent(st.id == this.stationGoalId ? 11 : 7)
      const ringInner = ringOuter - this.elementDrawer.getPixelFromPercent(1)
      ctx.save()
      ctx.beginPath()
      ctx.arc(x, y, ringOuter, 0, Math.PI * 2)
      ctx.strokeStyle = this.elementDrawer.mainColor
      ctx.lineWidth = this.elementDrawer.getPixelFromPercent(2.5)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x, y, ringInner, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
      // Label
      const namePx = this.elementDrawer.fontSize(12)
      this.elementDrawer.setFont(ctx, '700', namePx)
      const text = truncateText(ctx, st.name.toUpperCase(), this.elementDrawer.getWidth() * 0.38)
      const wtxt = ctx.measureText(text).width
      ctx.save()
      ctx.translate(x, y - this.elementDrawer.getPixelFromPercent(18))
      ctx.rotate(-Math.PI / 4)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      const bgW = wtxt + 12, bgH = namePx + 6
      ctx.fillRect(-6, -namePx - 6, bgW, bgH)
      ctx.fillStyle = '#111'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(text, 0, -namePx)
      ctx.restore()
      ctx.restore()
    })
    this.drawHeader(ctx, isConnected)
  }
}

class DrawBus extends Draw {
  constructor(ed) { super(); this.ed = ed }
  updateBus(bus, old = false) { this.bus = bus; this.old = old }
  draw() {
    const ctx = this.ed.ctx, y = this.ed.getHeightLine()
    let x = this.ed.transformPositionToPixel(this.bus)
    let outZone = false
    if (x < 0) { x = 0; outZone = true }
    else if (x > this.ed.getWidth()) { x = this.ed.getWidth() - 1; outZone = true }
    if (!this.ed.isIn(x, y)) return
    ctx.save()
    if (this.old) {
      ctx.beginPath()
      ctx.arc(x, y, this.ed.getPixelFromPercent(3.5), 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,0,0,1.0)'
      ctx.fill()
      ctx.restore()
      return
    }
    const w = this.ed.getPixelFromPercent(24), h = this.ed.getPixelFromPercent(16), r = this.ed.getPixelFromPercent(6)
    const rgb = hexToRgb(this.ed.mainColor) || { r: 0, g: 0, b: 0 }
    ctx.beginPath()
    ctx.arc(x, y, r * 3, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.10)`
    ctx.fill()
    // Pill
    const left = x - w / 2, top = y - h / 2, right = x + w / 2, bottom = y + h / 2
    ctx.beginPath()
    ctx.moveTo(left + r, top)
    ctx.lineTo(right - r, top)
    ctx.quadraticCurveTo(right, top, right, top + r)
    ctx.lineTo(right, bottom - r)
    ctx.quadraticCurveTo(right, bottom, right - r, bottom)
    ctx.lineTo(left + r, bottom)
    ctx.quadraticCurveTo(left, bottom, left, bottom - r)
    ctx.lineTo(left, top + r)
    ctx.quadraticCurveTo(left, top, left + r, top)
    ctx.closePath()
    ctx.fillStyle = '#fff'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = this.ed.mainColor
    ctx.stroke()
    // Label
    if (!outZone) {
      const txtPx = this.ed.fontSize(13)
      this.ed.setFont(ctx, '600', txtPx)
      ctx.fillStyle = '#000'
      const dist = formatDistance(this.bus.position_x_goal)
      const timeLeft = formatSecond(this.bus.position_x_goal / (averageKmPerHBus / 3.6))
      const raw = `${dateToStringHHMMSS(this.bus.date)} • ${dist} • ~${timeLeft}`
      const label = truncateText(ctx, raw, this.ed.getWidth() * 0.6)
      ctx.fillText(label, x - ctx.measureText(label).width / 2, y + this.ed.getPixelFromPercent(35))
    }
    ctx.restore()
  }
}
