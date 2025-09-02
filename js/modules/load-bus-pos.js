'use strict'

/****************** GEO & UTILS ******************/
// Radians conversion + clamp
function toRad (d) {
  return (d * Math.PI) / 180
}
function clamp (v, a, b) {
  return Math.max(a, Math.min(b, v))
}

// Human‑friendly distance formatting
function formatDistance (meters) {
  const m = Math.abs(meters)
  if (m >= 1000) return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`
  if (m >= 100) return `${Math.round(m)} m`
  return `${Math.max(1, Math.round(m))} m`
}

function formatSecond (seconds) {
  let txtTimeLeft = ''
  if (seconds < 60) {
    txtTimeLeft = `${Math.round(seconds)} s`
  } else {
    txtTimeLeft = `${Math.floor(seconds / 60)} min`
  }
  return txtTimeLeft
}

// Time → HH:MM:SS (24h)
function dateToStringHHMMSS (d) {
  const dt = d instanceof Date ? d : new Date(d)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`
}

// Truncate text with ellipsis to fit max width
function truncateText (ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text
  const ellipsis = '…'
  let lo = 0,
    hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth)
      lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + ellipsis
}

// Haversine distance (meters)
function haversineDistance (lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function hexToRgb (hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      }
    : null
}

// Simple lat/lon → XY projection (equirectangular around origin)
class GeoProjector {
  constructor (lat0 = 0, lon0 = 0) {
    this.setOrigin(lat0, lon0)
  }
  setOrigin (lat0, lon0) {
    this.lat0 = lat0
    this.lon0 = lon0
    this.R = 6371000
    this.cosLat0 = Math.cos(toRad(lat0))
  }
  toXY (lat, lon) {
    const x = this.R * toRad(lon - this.lon0) * this.cosLat0
    const y = this.R * toRad(lat - this.lat0)
    return { x, y }
  }
}

/****************** CORE MODELS ******************/
class GPS {
  constructor (lat, lon) {
    this.lat = lat
    this.lon = lon
  }
  static equal (gps1, gps2) {
    return gps1.lat === gps2.lat && gps1.lon === gps2.lon
  }
  static approxEqualMeters (gps1, gps2, epsMeters = 1) {
    return (
      haversineDistance(gps1.lat, gps1.lon, gps2.lat, gps2.lon) <= epsMeters
    )
  }
}

// Base entity with GPS and linear position
class Entity {
  constructor (position_gps) {
    this.position_gps = position_gps
    this.position_x = 0 // cumulative distance from origin (m)
  }
}

// Bus with smoothing and history
class Bus extends Entity {
  constructor (id) {
    super(new GPS(0, 0))
    this.position_x_goal = 0.0
    this.id = id
    this.date = null
    this.OldBus = []
    this._xFiltered = null // smoothing filter
    this._lastTs = null
    this.is_the_next = false
  }
  updateGps (position_gps, date = null) {
    const newPosition = !GPS.approxEqualMeters(
      this.position_gps,
      position_gps,
      0.5
    )
    if (newPosition) {
      this.position_gps = position_gps
      this.date = date == null ? new Date() : date
      this._lastTs = +this.date
    }
    return newPosition
  }
  // Time‑aware EMA smoothing so variable message rates behave well
  // tau controls responsiveness (seconds). Smaller → snappier.
  smoothX (x, nowMs = Date.now(), tau = 4) {
    if (this._xFiltered == null || this._lastTs == null) {
      this._xFiltered = x
      this._lastTs = nowMs
      return this._xFiltered
    }
    const dt = Math.max(0, (nowMs - this._lastTs) / 1000)
    const alpha = 1 - Math.exp(-dt / Math.max(0.001, tau))
    this._xFiltered = this._xFiltered + alpha * (x - this._xFiltered)
    this._lastTs = nowMs
    return this._xFiltered
  }

  isTheNext(is_the_next){
    this.is_the_next = is_the_next;
  }

  savePosition () {
    // Keep a light snapshot instead of deep‑cloning the whole object
    this.OldBus.push({
      position_x: this.position_x,
      date: this.date,
      position_x_goal: this.position_x_goal
    })
    if (this.OldBus.length > 12) this.OldBus.shift()
  }
}

class Station extends Entity {
  constructor (name, id, position_gps) {
    super(position_gps)
    this.name = name
    this.id = id
  }
}

function computeDistanceXYElements (e1, e2) {
  return haversineDistance(
    e1.position_gps.lat,
    e1.position_gps.lon,
    e2.position_gps.lat,
    e2.position_gps.lon
  )
}

const StatusConnection = Object.freeze({
  WAIT_CONNECTION: 0,
  NO_CONNECTED: 1,
  CONNECTED: 2
})

/****************** APP ******************/
class LineBusApp {
  static BASE_URL_GET_STOPS =
    'https://api.oisemob.cityway.fr:443/api/map/v2/GetLineStops/json'
  static BASE_URL_VEHICLE = 'wss://api.oisemob.cityway.fr/sdh/vehicles'
  static BASE_URL_NEGOTIATE =
    'https://api.oisemob.cityway.fr/sdh/vehicles/negotiate?negotiateVersion=1'

  constructor (
    lineId,
    lineDirection,
    lineName,
    lineDestination,
    lineColor,
    stationGoalId,
    numberStations,
    canvas
  ) {
    this.lineId = lineId
    this.lineDirection = lineDirection
    this.lineColor = lineColor
    this.lineName = lineName
    this.lineDestination = lineDestination
    this.stationGoalId = stationGoalId
    this.numberStations = numberStations

    this.stations = []
    this.stationOrigin = null
    this.stationGoal = null
    this.stationGoalIndex = null
    this.busList = []
    this.segments = []
    this.projector = new GeoProjector()

    this.elementDrawer = new ElementDrawer(
      this.lineDirection,
      canvas,
      this.lineColor
    )
    this.drawerLine = new DrawBusLine(
      this.elementDrawer,
      this.lineName,
      this.lineDestination,
      this.stationGoalId
    )
    this.statutConnection = StatusConnection.WAIT_CONNECTION

    // Resize handling (debounced)
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

  async loadBusStations () {
    const params = new URLSearchParams({
      Line: this.lineId,
      Direction: this.lineDirection
    })
    const url = `${LineBusApp.BASE_URL_GET_STOPS}?${params.toString()}`
    try {
      const r = await fetch(url, { method: 'GET' })
      if (!r.ok) throw new Error(`Network response was not ok: ${r.status}`)
      const data = await r.json()
      this.updateStations(data.Data)
      this.updateStationGoal(this.stationGoalId)
      this.setupDraw()
      await this.fetchConnectionToken()
      return data
    } catch (error) {
      console.error(`An error occurred: ${error}`)
    }
  }

  hasBusPositionLoaded () {
    return this.busList.length > 0
  }

  searchStation (field, value) {
    return this.stations.find(x => String(x[field]) === String(value))
  }
  searchStationByIndex (field, value) {
    return this.stations.findIndex(x => String(x[field]) === String(value))
  }

  updateStationGoal (id) {
    this.stationGoal = this.searchStation('id', id) || null
    this.stationGoalIndex = this.searchStationByIndex('id', id)
    this.stationGoalId = id
  }

  // Build stations list + projected segments
  updateStations (array_stations) {
    this.stations = []
    let distance = 0.0

    const tmp = (array_stations || []).map(
      e =>
        new Station(e.Name, e.LogicalStopId, new GPS(e.Latitude, e.Longitude))
    )
    if (tmp.length === 0) return

    // projection origin = first station
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

    // build projected segments
    this.segments = []
    for (let i = 0; i < this.stations.length - 1; i++) {
      const A = this.stations[i],
        B = this.stations[i + 1]
      const ABx = B._xy.x - A._xy.x
      const ABy = B._xy.y - A._xy.y
      const lenXY2 = ABx * ABx + ABy * ABy || 1e-6
      const lenMeters = computeDistanceXYElements(A, B)
      this.segments.push({
        i,
        A,
        B,
        ax: A._xy.x,
        ay: A._xy.y,
        bx: B._xy.x,
        by: B._xy.y,
        abx: ABx,
        aby: ABy,
        lenXY2,
        lenMeters,
        cumStartMeters: A.position_x
      })
    }
  }

  computeDistanceXFromOrigin (bus) {
    if (!this.segments.length) return 0
    const p = this.projector.toXY(bus.position_gps.lat, bus.position_gps.lon)
    let best = { d2: Infinity, x: 0 }
    for (const s of this.segments) {
      const APx = p.x - s.ax,
        APy = p.y - s.ay
      let t = (APx * s.abx + APy * s.aby) / s.lenXY2
      t = clamp(t, 0, 1)
      const projx = s.ax + t * s.abx
      const projy = s.ay + t * s.aby
      const dx = p.x - projx,
        dy = p.y - projy
      const d2 = dx * dx + dy * dy
      if (d2 < best.d2) best = { d2, x: s.cumStartMeters + t * s.lenMeters }
    }
    return best.x
  }

  computeDistanceXElements (bus, station) {
    return station.position_x - bus.position_x
  }
  computeDistanceToGoal (bus) {
    return this.stationGoal
      ? this.computeDistanceXElements(bus, this.stationGoal)
      : 0
  }

  doTruncStations (beginIdx, endIdx) {
    const b = clamp(beginIdx, 0, Math.max(0, this.stations.length - 1))
    const e = clamp(endIdx, 0, Math.max(0, this.stations.length - 1))
    return this.stations.slice(Math.min(b, e), Math.max(b, e) + 1)
  }

  setupDraw () {
    if (this.stationGoalIndex == null || this.stationGoalIndex < 0) return
    let stationStartIndex = this.stationGoalIndex - this.numberStations
    if (stationStartIndex < 0) stationStartIndex = 0
    const stationsTrunc = this.doTruncStations(
      stationStartIndex,
      this.stationGoalIndex
    )
    this.drawerLine.updateStations(stationsTrunc)
    this.draw()
  }

  draw () {
    this.elementDrawer.clearCanvas()
    this.drawerLine.updateStatus(this.statutConnection)
    this.drawerLine.draw()

    const drawerBus = new DrawBus(this.elementDrawer)
    this.busList.forEach(b => {
      drawerBus.updateBus(b)
      drawerBus.draw()
      b.OldBus.forEach(bOld => {
        // draw trail snapshots
        drawerBus.updateBus(
          Object.assign(new Bus(b.id), {
            position_x: bOld.position_x,
            position_x_goal: bOld.position_x_goal,
            date: bOld.date
          }),
          true
        )
        drawerBus.draw()
      })
    })
  }

  sendInitialMessages (ws) {
    ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + '\u001E')
    ws.send(
      JSON.stringify({
        arguments: [`#lineId:${this.lineId}:${this.lineDirection}`],
        invocationId: '0',
        target: 'Join',
        type: 1
      }) + '\u001E'
    )
  }

  openWebSocket (url) {
    // Close any previous socket once; no auto-re-negotiate
    try {
      if (this.ws) this.ws.close()
    } catch {}

    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.statutConnection = StatusConnection.CONNECTED
      this.sendInitialMessages(this.ws)
    }

    this.ws.onmessage = message => {
      if (message.data == null) {
        this.statutConnection = StatusConnection.NO_CONNECTED
        return
      }
      const items = this.processReceivedData(message.data)
      const packetList = Array.isArray(items) ? items : items ? [items] : []
      if (!packetList.length) return
      for (const data of packetList) {
        const getGps =
          data != null &&
          (data.Latitude ?? null) != null &&
          (data.Longitude ?? null) != null
        if (getGps) {
          this.statutConnection = StatusConnection.CONNECTED
          const id = data.VJourneyId || data.VehicleJourneyId || data.Id
          let indexBus = this.busList.findIndex(x => x.id == id)
          if (indexBus === -1) {
            this.busList.push(new Bus(id))
            indexBus = this.busList.length - 1
          }

          const bus = this.busList[indexBus]
          const busGps = new GPS(data.Latitude, data.Longitude)
          const isNewPosition = bus.updateGps(
            busGps,
            new Date(data.RecordedAtTime || Date.now())
          )
          if (isNewPosition) {
            const xraw = this.computeDistanceXFromOrigin(bus)
            bus.position_x = xraw //bus.smoothX(xraw, bus.date ? +bus.date : Date.now())
            bus.position_x_goal = this.computeDistanceToGoal(bus)
            bus.savePosition()
            this.draw()
          }
        }
      }
    }

    // If it fails or closes, just mark status; no re-negotiate here
    const markDown = () => {
      this.statutConnection = StatusConnection.NO_CONNECTED
    }
    this.ws.onerror = markDown
    this.ws.onclose = markDown
  }

  shutdown () {
    if (this.ws != null) this.ws.close()
  }

  async fetchConnectionToken () {
    // One-shot negotiate: do it once per app lifetime
    if (this._negotiated) return
    try {
      const r = await fetch(`${LineBusApp.BASE_URL_NEGOTIATE}`, {
        method: 'POST',
        headers: {},
        body: ''
      })
      const data = await r.json()
      const token =
        data.connectionToken || data.ConnectionToken || data.connectionId
      if (!token) throw new Error('No connection token in negotiate response')
      this._negotiated = true
      this._wsToken = token
      const wsUrl = `${LineBusApp.BASE_URL_VEHICLE}?id=${token}` // raw token only
      this.openWebSocket(wsUrl)
    } catch (error) {
      console.error('Error fetching connection token:', error)
    }
  }

  processReceivedData (data) {
    // SignalR JSON messages are delimited with \u001E; sometimes several are batched
    const chunks = String(data).split('\u001E').filter(Boolean)
    const out = []
    for (const raw of chunks) {
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        continue
      }
      // Most relevant payload is usually in arguments[1]
      if (
        parsed &&
        Array.isArray(parsed.arguments) &&
        parsed.arguments.length > 1
      ) {
        try {
          const obj = JSON.parse(parsed.arguments[1])
          if (obj) out.push(obj)
        } catch {
          /* ignore */
        }
      }
    }
    return out
  }
}

/****************** DRAWING ******************/
class ElementDrawer {
  constructor (direction, canvas, mainColor) {
    this.direction = direction
    this.canvas = canvas
    this.mainColor = mainColor
    this.getHTMLElements()
  }
  getPixelFromPercent (percent) {
    return (percent * this.width) / 800
  }
  getHTMLElements () {
    this.width = Math.round(document.body.clientWidth)
    this.height = (350 / 1000) * this.width
    this.ctx = this.canvas.getContext('2d')
    const scale = window.devicePixelRatio || 1
    this.canvas.width = this.width * scale
    this.canvas.height = this.height * scale
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0)

    this.endDraw = this.width * 0.9
    this.startDraw = this.width * 0.1
    this.distanceDraw = this.endDraw - this.startDraw
    this.heightLine = this.height * 0.75
  }
  updateHeight (newHeight) {
    this.height = newHeight
    this.getHTMLElements()
  }
  getWidth () {
    return this.width
  }
  getHeightLine () {
    return this.heightLine
  }
  getHeight () {
    return this.height
  }
  updateTF (origin_x, last_x, scale) {
    this.origin_x = origin_x
    this.last_x = last_x
    this.scale = scale || 1
  }
  clearCanvas () {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }
  transformPositionToPixel (entity) {
    const dist_dir1 =
      ((entity.position_x - this.origin_x) / (this.scale || 1)) *
        this.distanceDraw +
      this.startDraw
    return dist_dir1
  }
  isIn (x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height
  }

  // ---- RESPONSIVE CANVAS TYPOGRAPHY ----
  fontSize (basePx) {
    const scale = this.width / 800
    const px = Math.max(10, Math.min(42, Math.round(basePx * scale)))
    return px
  }
  setFont (
    ctx,
    weight,
    px,
    family = 'system-ui, -apple-system, Segoe UI, Roboto'
  ) {
    ctx.font = `${weight} ${px}px ${family}`
  }
}

class Draw {
  draw () {}
}

class DrawBusLine extends Draw {
  constructor (elementDrawer, name, destination, stationGoalId) {
    super()
    this.elementDrawer = elementDrawer
    this.stations = []
    this.name = name
    this.destination = destination
    this.stationGoalId = stationGoalId
    this.statusConnection = StatusConnection.WAIT_CONNECTION
    this.loadingAngle = 0
  }
  updateStations (stations) {
    this.stations = stations
    this.updateScale()
  }
  updateStatus (statusConnection) {
    this.statusConnection = statusConnection
  }
  updateScale () {
    let scale = 0,
      origin_x = 0,
      last_x = 0
    if (this.stations.length > 0) {
      origin_x = this.stations[0].position_x
      last_x = this.stations[this.stations.length - 1].position_x
      scale = last_x - origin_x
    }
    this.elementDrawer.updateTF(origin_x, last_x, scale)
  }

  drawHeader (ctx, isConnected) {
    ctx.save()
    const titlePx = this.elementDrawer.fontSize(28)
    const subPx = this.elementDrawer.fontSize(14)

    this.elementDrawer.setFont(ctx, '600', titlePx)
    ctx.fillStyle = this.elementDrawer.mainColor
    const title = `${this.name}  ${this.destination}`
    const xTitle = this.elementDrawer.getPixelFromPercent(30)
    const yTitle = this.elementDrawer.getPixelFromPercent(35)
    const maxTitleW = this.elementDrawer.getWidth() * 0.84
    const titleClamped = truncateText(ctx, title, maxTitleW)
    ctx.fillText(titleClamped, xTitle, yTitle)

    this.elementDrawer.setFont(ctx, '400', subPx)
    const getLabelSafe =
      typeof getLabel === 'function'
        ? getLabel
        : k =>
            ({
              status: 'Status',
              statusConnected: 'Connected',
              statusWaitConnection: 'Connecting…',
              statusNotConnected: 'Disconnected'
            }[k] || k)

    let labelConnection = getLabelSafe('statusConnected')
    if (this.statusConnection === StatusConnection.WAIT_CONNECTION)
      labelConnection = getLabelSafe('statusWaitConnection')
    else if (this.statusConnection === StatusConnection.NO_CONNECTED)
      labelConnection = getLabelSafe('statusNotConnected')

    // ctx.fillStyle = isConnected ? '#198754' : '#6c757d'
    ctx.fillStyle = this.elementDrawer.mainColor
    const status = `${getLabelSafe('status')}: ${labelConnection}`
    ctx.fillText(status, xTitle, yTitle + subPx + 6)

    ctx.restore()
  }

  draw() {
    const ctx = this.elementDrawer.ctx
    const y = this.elementDrawer.getHeightLine()
    const isConnected = this.statusConnection === StatusConnection.CONNECTED

    // ---- LOADING STATE ----
    if (this.statusConnection === StatusConnection.WAIT_CONNECTION) {
      const cx = this.elementDrawer.getWidth() / 2
      const cy = this.elementDrawer.getHeight() / 2
      const r = 30
      const start = this.loadingAngle
      const end = start + Math.PI * 1.2

      ctx.save()
      ctx.lineWidth = 5
      ctx.strokeStyle = this.elementDrawer.mainColor
      ctx.beginPath()
      ctx.arc(cx, cy, r, start, end)
      ctx.stroke()
      ctx.restore()

      // avancer l’angle pour l’animation
      this.loadingAngle += 0.08
      requestAnimationFrame(() => this.elementDrawer.clearCanvas() || this.draw())
      return
    }

    const xStartLine = 0.0
    const xEndLine = this.elementDrawer.width

    // main line with round caps + slight gradient
    ctx.save()
    const w = this.elementDrawer.getPixelFromPercent(6)
    const grad = ctx.createLinearGradient(xStartLine, y, xEndLine, y)
    // grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.0, this.elementDrawer.mainColor)
    grad.addColorStop(1.0, this.elementDrawer.mainColor)
    // grad.addColorStop(1, '#ffffff')
    ctx.strokeStyle = grad
    ctx.lineWidth = w
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(xStartLine, y)
    ctx.lineTo(xEndLine, y)
    ctx.stroke()
    ctx.restore()

    // stations (rings)
    this.stations.forEach(station => {
      const x = this.elementDrawer.transformPositionToPixel(station)
      const ringOuter = this.elementDrawer.getPixelFromPercent(
        station.id == this.stationGoalId ? 11 : 7
      )
      const ringInner = ringOuter - this.elementDrawer.getPixelFromPercent(1)

      ctx.save()
      // outer ring
      ctx.beginPath()
      ctx.arc(x, y, ringOuter, 0, Math.PI * 2)
      ctx.strokeStyle = this.elementDrawer.mainColor
      ctx.lineWidth = this.elementDrawer.getPixelFromPercent(2.5)
      ctx.stroke()

      // inner disc
      ctx.beginPath()
      ctx.arc(x, y, ringInner, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()

      // diagonal label (~ -45°)
      const namePx = this.elementDrawer.fontSize(12)
      this.elementDrawer.setFont(ctx, '700', namePx)

      const maxLabelW = this.elementDrawer.getWidth() * 0.38
      const textRaw = `${station.name}`.toUpperCase()
      const text = truncateText(ctx, textRaw, maxLabelW)
      const wtxt = ctx.measureText(text).width
      const padX = 6,
        padY = Math.max(6, Math.round(namePx * 0.5))

      ctx.save()
      ctx.translate(x, y - this.elementDrawer.getPixelFromPercent(18))
      ctx.rotate(-Math.PI / 4)

      // rounded rect background
      const bgW = wtxt + padX * 2
      const bgH = namePx + padY
      const r = Math.min(6, namePx / 2)

      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.beginPath()
      ctx.moveTo(-padX + r, -namePx - padY / 2)
      ctx.lineTo(-padX + bgW - r, -namePx - padY / 2)
      ctx.quadraticCurveTo(
        -padX + bgW,
        -namePx - padY / 2,
        -padX + bgW,
        -namePx - padY / 2 + r
      )
      ctx.lineTo(-padX + bgW, -namePx + bgH - r)
      ctx.quadraticCurveTo(
        -padX + bgW,
        -namePx + bgH,
        -padX + bgW - r,
        -namePx + bgH
      )
      ctx.lineTo(-padX + r, -namePx + bgH)
      ctx.quadraticCurveTo(-padX, -namePx + bgH, -padX, -namePx + bgH - r)
      ctx.lineTo(-padX, -namePx - padY / 2 + r)
      ctx.quadraticCurveTo(
        -padX,
        -namePx - padY / 2,
        -padX + r,
        -namePx - padY / 2
      )
      ctx.closePath()
      ctx.fill()

      // text
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
  constructor (elementDrawer) {
    super()
    this.elementDrawer = elementDrawer
  }
  updateBus (bus, old = false) {
    this.bus = bus
    this.old = old
  }

  draw () {
    const ctx = this.elementDrawer.ctx
    const y = this.elementDrawer.getHeightLine()
    let x = this.elementDrawer.transformPositionToPixel(this.bus)
    let outZone = false
    if (x < 0) {
      x = 0
      outZone = true
    } else if (x > this.elementDrawer.getWidth()) {
      x = this.elementDrawer.getWidth() - 1
      outZone = true
    }
    if (!this.elementDrawer.isIn(x, y)) return

    ctx.save()

    if (this.old) {
      // small trail dots
      ctx.beginPath()
      ctx.arc(x, y, this.elementDrawer.getPixelFromPercent(3.5), 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,0,0,1.0)'
      ctx.fill()
      ctx.restore()
      return
    }

    // bus pill + halo
    const w = this.elementDrawer.getPixelFromPercent(24)
    const h = this.elementDrawer.getPixelFromPercent(16)
    const r = this.elementDrawer.getPixelFromPercent(6)

    // halo

    const rgb = hexToRgb(this.elementDrawer.mainColor)
    const radius_hallo = r * 3.0

    ctx.beginPath()
    ctx.arc(x, y, radius_hallo, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.10)`
    ctx.fill()

    // pill
    const left = x - w / 2,
      top = y - h / 2
    const right = x + w / 2,
      bottom = y + h / 2
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
    ctx.strokeStyle = this.elementDrawer.mainColor
    ctx.stroke()

    // label (time • distance)
    if (!outZone) {
      const txtPx = this.elementDrawer.fontSize(13)
      this.elementDrawer.setFont(ctx, '600', txtPx)
      ctx.fillStyle = '#000'

      const kmPerh__ref = 30.0
      const mPers__ref = kmPerh__ref / 3.6

      const timeleft_s = this.bus.position_x_goal / mPers__ref;
      const txtTimeLeft = formatSecond(timeleft_s);

      const dist = formatDistance(this.bus.position_x_goal)
      const raw = `${dateToStringHHMMSS(
        this.bus.date
      )} • ${dist} • ~${txtTimeLeft}`

      const maxW = this.elementDrawer.getWidth() * 0.6
      const label = truncateText(ctx, raw, maxW)
      const tw = ctx.measureText(label).width
      ctx.fillText(
        label,
        x - tw / 2,
        y + this.elementDrawer.getPixelFromPercent(35)
      )
    }

    ctx.restore()
  }
}
