function haversineDistance (lat1, lon1, lat2, lon2) {
  const R = 6371 * 1000 // Rayon de la Terre en m
  const radLat1 = (lat1 * Math.PI) / 180
  const radLat2 = (lat2 * Math.PI) / 180
  const deltaLat = radLat2 - radLat1
  const deltaLon = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(radLat1) *
      Math.cos(radLat2) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c // Distance en m
}

class GPS {
  constructor (lat, lon) {
    this.lat = lat
    this.lon = lon
  }

  static equal (gps1, gps2) {
    return gps1.lat == gps2.lat && gps1.lon == gps2.lon
  }
}

class Element {
  constructor (position_gps) {
    this.position_gps = position_gps
    this.position_x = 0
  }
}

class Bus extends Element {
  constructor (id) {
    super(new GPS(0, 0))
    this.position_x_goal = 0.0
    this.id = id
    this.date = null
    this.OldBus = []
  }

  updateGps (position_gps, date = null) {
    const newPosition = !GPS.equal(this.position_gps, position_gps)
    if (newPosition) {
      this.position_gps = position_gps
      if(date == null){
        this.date = new Date()
      }else{
        this.date = date
      }
    }
    return newPosition
  }

  savePosition () {
    this.OldBus.push(structuredClone(this))
    if (this.OldBus.length > 10) {
      this.OldBus.shift()
    }
  }
}

class Station extends Element {
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

class StatusConnection {
  static WAIT_CONNECTION = 0
  static NO_CONNECTED = 1
  static CONNECTED = 2
}

class LineBusApp {
  static BASE_URL_GET_STOPS =
    'https://api.oisemob.cityway.fr:443/api/map/v2/GetLineStops/json'
  static BASE_URL_VEHICLE = 'wss://api.oisemob.cityway.fr/sdh/vehicles'
  static BASE_URL_NEGOCIATE =
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
    // const
    this.lineId = lineId
    this.lineDirection = lineDirection
    this.lineColor = lineColor
    this.lineName = lineName
    this.lineDestination = lineDestination
    this.stationGoalId = stationGoalId
    this.numberStations = numberStations
    // vars
    this.stations = []
    this.stationOrigin = null
    this.stationGoal = null
    this.stationGoalIndex = null
    this.busList = []

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
  }

  loadBusStations () {
    const params = new URLSearchParams({
      Line: this.lineId,
      Direction: this.lineDirection
    })
    const url = `${LineBusApp.BASE_URL_GET_STOPS}?${params.toString()}`
    // console.log(url)
    fetch(url, {
      method: 'GET'
    })
      .then(response => {
        if (!response.ok) {
          throw new Error('Network response was not ok')
        }
        return response.json()
      })
      .then(data => {
        this.updateStations(data.Data)
        this.updateStationGoal(this.stationGoalId)
        this.setupDraw()
        this.fetchConnectionToken()
        return data
      })
      .catch(error => {
        console.error(`An error occurred: ${error}`)
        return null
      })
  }

  hasBusPositionLoaded () {
    return this.busList.length() > 0
  }

  computeRegressionLine (stationA, stationB) {
    const m =
      (stationB.position_gps.lat - stationA.position_gps.lat) /
      (stationB.position_gps.lon - stationA.position_gps.lon)
    const b = stationA.position_gps.lat - m * stationA.position_gps.lon
    return { m, b }
  }

  findClosestStationPair (bus) {
    let closestDistance = Infinity
    let closestStationPair = null

    for (let i = 0; i < this.stations.length - 1; i++) {
      const stationA = this.stations[i]
      const stationB = this.stations[i + 1]
      const { m, b: intercept } = this.computeRegressionLine(stationA, stationB)

      const lonMin = Math.min(
        stationA.position_gps.lon,
        stationB.position_gps.lon
      )
      const lonMax = Math.max(
        stationA.position_gps.lon,
        stationB.position_gps.lon
      )
      const latMin = Math.min(
        stationA.position_gps.lat,
        stationB.position_gps.lat
      )
      const latMax = Math.max(
        stationA.position_gps.lat,
        stationB.position_gps.lat
      )

      // is in ?
      if (
        bus.position_gps.lon >= lonMin &&
        bus.position_gps.lon <= lonMax &&
        bus.position_gps.lat >= latMin &&
        bus.position_gps.lat <= latMax
      ) {
        const distance =
          Math.abs(
            m * bus.position_gps.lon - bus.position_gps.lat + intercept
          ) / Math.sqrt(m * m + 1)

        if (distance < closestDistance) {
          closestDistance = distance
          closestStationPair = [stationA, stationB]
        }
      } else {
        // Vérifier la proximité avec les points extrêmes
        const distanceToA = Math.sqrt(
          Math.pow(bus.position_gps.lon - stationA.position_gps.lon, 2) +
            Math.pow(bus.position_gps.lat - stationA.position_gps.lat, 2)
        )
        const distanceToB = Math.sqrt(
          Math.pow(bus.position_gps.lon - stationB.position_gps.lon, 2) +
            Math.pow(bus.position_gps.lat - stationB.position_gps.lat, 2)
        )

        if (distanceToA < closestDistance) {
          closestDistance = distanceToA
          closestStationPair = [
            stationA,
            i > 0 ? this.stations[i - 1] : stationB
          ]
        }
        if (distanceToB < closestDistance) {
          closestDistance = distanceToB
          closestStationPair = [
            stationB,
            i + 1 < this.stations.length - 1 ? this.stations[i + 2] : stationA
          ]
        }
      }
    }
    return closestStationPair
  }

  searchStation (field, value) {
    return this.stations.find(x => x[field] == value)
  }

  searchStationByIndex (field, value) {
    return this.stations.findIndex(x => x[field] == value)
  }

  computeDistanceXFromOrigin (bus) {
    let closest_stations = this.findClosestStationPair(bus)
    return (
      closest_stations[0].position_x +
      computeDistanceXYElements(closest_stations[0], bus)
    )
  }

  computeDistanceXElements (bus, station) {
    return station.position_x - bus.position_x
  }

  computeDistanceToGoal (bus) {
    return this.computeDistanceXElements(bus, this.stationGoal)
  }

  doTruncStations (stationBeginIndex, stationEndIndex) {
    return this.stations.slice(stationBeginIndex, stationEndIndex + 1)
  }

  updateStationGoal (id) {
    this.stationGoal = this.searchStation('id', id)
    this.stationGoalIndex = this.searchStationByIndex('id', id)
    this.stationGoalId = id
  }

  updateStations (array_stations) {
    let distance = 0.0
    let stations_tmp = []
    array_stations.forEach(element => {
      let station = new Station(
        element.Name,
        element.LogicalStopId,
        new GPS(element.Latitude, element.Longitude)
      )
      stations_tmp.push(station)
    })

    stations_tmp.forEach(station => {
      let is_first_station = this.stations.length == 0
      if (is_first_station) {
        this.stationOrigin = station
        // console.log(station);
      } else {
        distance += computeDistanceXYElements(
          this.stations[this.stations.length - 1],
          station
        )
      }
      station.position_x = distance
      this.stations.push(station)
    })
  }

  isConnected(){
    return this.statutConnection ==  StatusConnection.CONNECTED;
  }

  setupDraw () {
    let stationStartIndex = this.stationGoalIndex - this.numberStations
    if (stationStartIndex < 0) {
      stationStartIndex = 0
    }
    const stationsTrunc = this.doTruncStations(
      stationStartIndex,
      this.stationGoalIndex
    )
    this.drawerLine.updateStations(stationsTrunc)
    this.draw()
  }

  draw () {
    this.elementDrawer.clearCanvas()

    const timeIn = new Date()
    this.drawerLine.updateStatus(this.statutConnection)
    this.drawerLine.draw()

    this.busList.forEach(b => {
      const drawerBus = new DrawBus(this.elementDrawer)
      drawerBus.updateBus(b)
      drawerBus.draw()

      b.OldBus.forEach(bOld => {
        drawerBus.updateBus(bOld, true)
        drawerBus.draw()
      })
    })
    const timeOut = new Date()
    // console.log((timeOut - timeIn)/1000);
  }

  sendInitialMessages (ws) {
    // First message: Set protocol and version
    const protocolMessage = JSON.stringify({ protocol: 'json', version: 1 })
    ws.send(protocolMessage + '\u001E') // Appending the record separator character

    // Second message: Join a specific line ID
    const joinMessage = JSON.stringify({
      arguments: [`#lineId:${this.lineId}:${this.lineDirection}`],
      invocationId: '0',
      target: 'Join',
      type: 1
    })
    ws.send(joinMessage + '\u001E') // Appending the record separator character
  }

  openWebSocket (url) {
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      // console.log('WebSocket connection established')
      this.sendInitialMessages(this.ws)
    }

    this.ws.onmessage = message => {
      if (message.data == null) {
        console.log(message)
        this.statutConnection = StatusConnection.NO_CONNECTED
        return
      }
      const data = this.processReceivedData(message.data)
      
      const getGps = data != null && (data.Latitude ?? null) != null
      if (getGps) {
        this.statutConnection = StatusConnection.CONNECTED
        const id = data.VJourneyId
        let indexBus = this.busList.findIndex(x => x.id == id)

        if (indexBus == -1) {
          const busAdd = new Bus(id)
          this.busList.push(busAdd)
          indexBus = this.busList.length - 1
        }

        const bus = this.busList[indexBus];
        const busGps = new GPS(data.Latitude, data.Longitude);
        const isNewPosition = bus.updateGps(busGps,new Date(data.RecordedAtTime));
        if (isNewPosition) {
          bus.position_x = this.computeDistanceXFromOrigin(bus);
          bus.position_x_goal = this.computeDistanceToGoal(bus);
          bus.savePosition();

          // console.log(`${bus.id} - ${bus.position_x_goal} : ${bus.position_x}`)
          this.draw()
        }
      } else {
        
      }
    }

    this.ws.onerror = error => {
      console.log('WebSocket Error:', error)
      this.statutConnection = StatusConnection.NO_CONNECTED
    }

    this.ws.onclose = event => {
      console.log('WebSocket connection closed:', event.code, event.reason)
    }
  }


  shutdown () {
    if (this.ws != null) {
      this.ws.close();
    }
  }

  fetchConnectionToken () {
    const url = `${LineBusApp.BASE_URL_NEGOCIATE}`
    const headers = {}

    const options = {
      method: 'POST',
      headers: headers,
      body: '' // No body content is needed for this request as per your setup
    }

    fetch(url, options)
      .then(response => response.json())
      .then(data => {
        const wsConnectionUrl = `${LineBusApp.BASE_URL_VEHICLE}?id=${data.connectionToken}`
        // Proceed to open WebSocket connection
        this.openWebSocket(wsConnectionUrl)
        // console.log('Received connectionToken:', data.connectionToken)
        // Use the connectionToken to open WebSocket or other operations
      })
      .catch(error => {
        console.error('Error fetching connection token:', error)
      })
  }

  processReceivedData (data) {
    // Remove any non-JSON trailing characters (e.g., record separators or timestamps)
    const cleanData = data.split('\u001E')[0]

    // Parse the JSON string
    let parsedData
    try {
      parsedData = JSON.parse(cleanData)
    } catch (error) {
      return
    }

    if (parsedData.arguments && parsedData.arguments.length > 1) {
      let embeddedJson
      try {
        embeddedJson = JSON.parse(parsedData.arguments[1])
      } catch (error) {
        return
      }
      return embeddedJson
    }
  }
}

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

    const scale = window.devicePixelRatio
    this.canvas.width = this.width * scale
    this.canvas.height = this.height * scale
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.ctx.scale(scale, scale)

    this.endDraw = this.width * 0.8
    this.startDraw = this.width * 0.12
    this.distanceDraw = this.endDraw - this.startDraw

    this.heightLine = this.height * 0.55
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
    this.scale = scale
  }

  clearCanvas () {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  transformPositionToPixel (element) {
    const dist_dir1 =
      ((element.position_x - this.origin_x) / this.scale) * this.distanceDraw +
      this.startDraw
    if (this.direction == 1) return dist_dir1
    // return this.width - dist_dir1;
    return dist_dir1
  }

  isIn (x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height
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
  }

  updateStations (stations) {
    this.stations = stations
    this.updateScale()
  }

  updateStatus (statusConnection) {
    this.statusConnection = statusConnection
  }

  updateScale () {
    let scale = 0
    let origin_x = 0
    let last_x = 0
    if (this.stations.length > 0) {
      origin_x = this.stations[0].position_x
      last_x = this.stations[this.stations.length - 1].position_x
      scale = last_x - origin_x
    }
    this.elementDrawer.updateTF(origin_x, last_x, scale)
  }

  transformPositionToPixel (element) {
    return (
      ((element.position_x - this.origin_x) / this.scale) * this.distanceDraw +
      this.startDraw
    )
  }

  draw () {
    const isConnected = this.statusConnection == StatusConnection.CONNECTED
    const heightLine = this.elementDrawer.getHeightLine()
    const widthLine = this.elementDrawer.getPixelFromPercent(5)
    const ctx = this.elementDrawer.ctx
    ctx.fillStyle = isConnected ? this.elementDrawer.mainColor : '#000'
    ctx.stroke()
    ctx.fillRect(
      0,
      heightLine - widthLine / 2,
      this.elementDrawer.getWidth(),
      widthLine
    )
    // ctx.font = `${this.elementDrawer.getPixelFromPercent(20)}px Bold`;
    ctx.font = `${30}px Bold`
    ctx.fillText(
      `${this.name}  ${this.destination}`,
      this.elementDrawer.getPixelFromPercent(20),
      this.elementDrawer.getHeight() -
        this.elementDrawer.getPixelFromPercent(25)
    )

    ctx.font = `${13}px Bold`
    let labelConnection = getLabel('statusConnected')
    if (this.statusConnection == StatusConnection.WAIT_CONNECTION) {
      labelConnection = getLabel('statusWaitConnection')
    } else if (this.statusConnection == StatusConnection.NO_CONNECTED) {
      labelConnection = getLabel('statusNotConnected')
    }
    const labelStatus = `Status: ${labelConnection}`
    const labelStatusWidth = ctx.measureText(labelStatus).width
    ctx.fillText(
      labelStatus,
      this.elementDrawer.getPixelFromPercent(20),
      this.elementDrawer.getHeight() - this.elementDrawer.getPixelFromPercent(5)
    )

    this.stations.forEach(station => {
      const stopX = this.elementDrawer.transformPositionToPixel(station)
      ctx.fillStyle = '#444'
      ctx.beginPath()
      ctx.strokeStyle = isConnected ? this.elementDrawer.mainColor : '#000'
      ctx.lineWidth = this.elementDrawer.getPixelFromPercent(10)
      let radius = this.elementDrawer.getPixelFromPercent(5)
      if (station.id == this.stationGoalId) {
        ctx.lineWidth = this.elementDrawer.getPixelFromPercent(15)
        radius = this.elementDrawer.getPixelFromPercent(10)
      }
      ctx.arc(stopX, heightLine, radius, 0, 2 * Math.PI, true)
      ctx.stroke()
      ctx.fillStyle = '#FFF'
      ctx.fill()
      ctx.fillStyle = '#000'
      // ctx.font = `${this.elementDrawer.getPixelFromPercent(13)}px Bold`
      ctx.font = `${20}px Bold`
      ctx.save()
      ctx.translate(
        stopX,
        heightLine - this.elementDrawer.getPixelFromPercent(18)
      )
      ctx.rotate(-Math.PI / 6)
      ctx.fillText(`${station.name}`.toUpperCase(), 0, 0)
      ctx.restore()
    })
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
    let stopPosition = this.elementDrawer.transformPositionToPixel(this.bus)
    let outZone = false
    if (stopPosition < 0) {
      stopPosition = 0
      outZone = true
    } else if (stopPosition > this.elementDrawer.getWidth()) {
      stopPosition = this.elementDrawer.getWidth() - 1
      outZone = true
    }
    const heightLine = this.elementDrawer.getHeightLine()
    if (!this.elementDrawer.isIn(stopPosition, heightLine)) {
      return
    }

    const ctx = this.elementDrawer.ctx
    ctx.beginPath()
    let width = this.elementDrawer.getPixelFromPercent(20)
    let height = this.elementDrawer.getPixelFromPercent(20)
    const fontSize = this.elementDrawer.getPixelFromPercent(20)
    ctx.font = `${fontSize}px`
    ctx.strokeStyle = 'black'
    ctx.fillStyle = 'white'

    if (this.old) {
      width = this.elementDrawer.getPixelFromPercent(10)
      height = this.elementDrawer.getPixelFromPercent(10)
      const radius = this.elementDrawer.getPixelFromPercent(5)
      ctx.arc(stopPosition, heightLine, radius, 0, 2 * Math.PI, true)
      ctx.fillStyle = 'black'
      ctx.fill()
    } else if (!this.old) {
      if (!outZone) {
        let labelDistance = `${Math.trunc(this.bus.position_x_goal)} m`
        if (Math.abs(this.bus.position_x_goal) > 1000) {
          labelDistance = `${
            Math.trunc(this.bus.position_x_goal / 10) / 100
          } km`
        }
        
        // const label = `${Math.round((new Date() - this.bus.date)/1000)}s - ${labelDistance}`
        const label = `${dateToStringHHMMSS(this.bus.date)} - ${labelDistance}`
        ctx.fillStyle = 'black'
        const widthLabel = ctx.measureText(label).width
        ctx.fillText(
          label,
          stopPosition - widthLabel / 2,
          heightLine + this.elementDrawer.getPixelFromPercent(35)
        )
      }
      ctx.rect(stopPosition - width / 2, heightLine - height / 2, width, height)
    }

    ctx.lineWidth = this.elementDrawer.getPixelFromPercent(3)
    ctx.stroke()
  }
}
