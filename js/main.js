// Global constants / variables
const versionApp = '2.0.0'
let stationID = 31500 // Default station
let stationName = ''
let lastUpdateData = null
let lastUpdateTime = null
const autoRefreshDefault = true
let autoRefreshInterval = null
const intervalTimeRefreshRequest = 10 * 1000 // ms
const intervalTimeRefreshDate = 10 * 1000 // ms (only if no data refresh)
let language = 'fr'
let trackMode = false

// Labels (multilingual)
const labels = {
  en: {
    serviceOFF: 'Service OFF',
    legend: 'Legend',
    realTime: 'Real Time',
    scheduledTime: 'Scheduled Time',
    autoRefresh: 'Auto Refresh',
    waitingConnection: 'Waiting Connection',
    update: 'Update',
    status: 'Status',
    statusConnected: 'Connected',
    statusWaitConnection: 'Waiting Connection',
    statusNotConnected: 'Not Connected',
    infoClickTrack: 'Click to display bus position'
  },
  fr: {
    serviceOFF: 'Service Arrêté',
    legend: 'Légende',
    realTime: 'Temps Réel',
    scheduledTime: 'Temps Planifié',
    autoRefresh: 'Actualiser',
    waitingConnection: 'Connexion En Cours',
    update: 'Mise à Jour',
    status: 'Status',
    statusConnected: 'Connecté',
    statusWaitConnection: 'Connexion En Cours',
    statusNotConnected: 'Non Connecté',
    infoClickTrack: 'Cliquer pour voir la position du bus'
  }
}

// Return translated label
function getLabel (key) {
  const lang = labels[language] || labels['en']
  return lang[key]
}

// Update legend + switch label in header
function updateHeadText () {
  const legendContainer = document.getElementById('legend')
  legendContainer.innerHTML = `
    <span class="d-flex align-items-center gap-1">
      <i class="bi bi-broadcast-pin text-primary"></i> ${getLabel('realTime')}
    </span>
    <span class="d-flex align-items-center gap-1">
      <i class="bi bi-clock text-secondary"></i> ${getLabel('scheduledTime')}
    </span>
  `
  // const label = document.querySelector('label[for="autoRefreshCheckbox"]')
  // label.textContent = getLabel('autoRefresh')
  stationName = getLabel('waitingConnection')
}

// DOM ready
document.addEventListener('DOMContentLoaded', function () {
  const paramStationID = getStationIDFromURL()
  if (paramStationID) stationID = paramStationID
  fetchAndDisplayBusSchedule()

  const paramLang = getLangFromURL()
  language = paramLang
    ? paramLang.toLowerCase()
    : navigator.language.split('-')[0]

  updateHeadText()

  toggleAutoRefresh(true)
  // document.getElementById('autoRefreshCheckbox').checked = autoRefreshDefault
  // toggleAutoRefresh(autoRefreshDefault)
  // document.getElementById('autoRefreshCheckbox')
  //   .addEventListener('change', function () {
  //     toggleAutoRefresh(this.checked)
  //   })

  document.getElementById('versionNumber').textContent = versionApp
  console.log(versionApp)
  updateDateAndNameStation()

  const paramTrack = getTrackMode()
  if (paramTrack) trackMode = paramTrack.toLowerCase() === 'true'
})

// Redraw buses every tick (if connected)
function drawBus () {
  if (busApp != null && busApp.isConnected()) busApp.draw()
}

// Page events
window.addEventListener('pageshow', e => {
  if (e.persisted) window.location.reload(true)
})
window.addEventListener('resize', () => {
  if (busApp != null) {
    busApp.elementDrawer.getHTMLElements()
    busApp.draw()
  }
})
window.addEventListener('beforeunload', () => {
  if (busApp != null) busApp.shutdown()
})

// Helpers: read URL params
function getStationIDFromURL () {
  return new URLSearchParams(window.location.search).get('stationID')
}
function getLangFromURL () {
  return new URLSearchParams(window.location.search).get('lang')
}
function getTrackMode () {
  return new URLSearchParams(window.location.search).get('track')
}

// Toggle auto-refresh
function toggleAutoRefresh (isEnabled) {
  if (isEnabled) {
    if (!autoRefreshInterval) {
      autoRefreshInterval = setInterval(
        fetchAndDisplayBusSchedule,
        intervalTimeRefreshRequest
      )
    }
  } else {
    setInterval(updateDateAndNameStation, intervalTimeRefreshDate)
    clearInterval(autoRefreshInterval)
    autoRefreshInterval = null
  }
}

// Update header date + station
function updateDateAndNameStation () {
  const title = `${new Date().toLocaleTimeString(navigator.language, {
    hour: '2-digit',
    minute: '2-digit'
  })} - ${stationName}`
  document.getElementById('currentTime').textContent = title
  document.title = `Bus: ${stationName}`
}

// Misc helpers
function bodyIsEmpty (id) {
  return document.getElementById(id)?.textContent.trim() === ''
}
function isServiceTime (h) {
  return h > 5 && h < 22
}
function clearContainer (el) {
  el.innerHTML = ''
}
function dateToStringHHMMSS (d) {
  return d.toLocaleTimeString(navigator.language, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}
function dateToStringHHMM (d) {
  return d.toLocaleTimeString(navigator.language, {
    hour: '2-digit',
    minute: '2-digit'
  })
}
function updateDateRefresh (d) {
  document.getElementById('updateDate').textContent = `${getLabel(
    'update'
  )}: ${dateToStringHHMMSS(d)}`
}
function getDiffTimeMinutes (a, b) {
  return (a - b) / 60000
}

// Fetch and render schedule
function fetchAndDisplayBusSchedule () {
  let serviceIsOFF = false
  fetch(
    `https://api.oisemob.cityway.fr/media/api/v1/fr/Schedules/LogicalStop/${stationID}/NextDeparture?realTime=true&lineId=&direction=`
  )
    .then(res => {
      if (res.status === 204) {
        serviceIsOFF = true
        return {}
      }
      return res.json()
    })
    .then(data => {
      if (!serviceIsOFF) {
        const now = new Date()
        const empty = data.length === 0
        const hasRealTime = data?.[0]?.lines.some(l =>
          l.times.some(t => t.realDateTime)
        )
        const firstLoad = lastUpdateTime == null
        const updateOK = !empty && (hasRealTime || firstLoad)

        if (updateOK) {
          updateDateRefresh(now)
          lastUpdateTime = now
          lastUpdateData = data
        } else {
          console.log('No real-time data available this cycle.')
          data = lastUpdateData
        }

        if (data?.[0]?.lines?.length > 0) {
          stationName = data[0].lines[0].stop.name
        }
        displayBusSchedule(data)
      } else {
        clearContainer(document.getElementById('busInfo'))
        stationName = getLabel('serviceOFF')
      }
      updateDateAndNameStation()
    })
    .catch(err => console.error('Error fetching data:', err))
}

// Render bus schedule cards
const displayBusSchedule = busData => {
  const now = new Date()
  const container = document.getElementById('busInfo')
  clearContainer(container)

  const row = document.createElement('div')
  row.classList.add(
    'row',
    'g-3',
    'row-cols-2',
    'row-cols-lg-3',
    'row-cols-xxl-4'
  )

  container.appendChild(row)

  busData.forEach(transport => {
    if (transport.transportMode !== 'Bus') return

    transport.lines.forEach(line => {
      // Col
      const col = document.createElement('div')
      col.classList.add('col')
      row.appendChild(col)

      // Card
      const card = document.createElement('div')
      card.classList.add(
        'card',
        'shadow',
        'h-100',
        'bus-card',
        'transition-soft'
      )
      col.appendChild(card)

      // Header
      const color = `#${String(line.line.color || '').replace(/^#/, '')}`
      const header = document.createElement('div')
      header.classList.add(
        'card-header',
        'text-white',
        'bus-card-header',
        'd-flex',
        'align-items-center'
      )
      header.style.setProperty('--line-color', color)

      const headerWrap = document.createElement('div')
      // headerWrap.classList.add('d-flex', 'align-items-center', 'justify-content-between', 'w-100', 'bus-card-header-title','badge')
      headerWrap.classList.add(
        'd-flex',
        'align-items-center',
        'justify-content-between',
        'w-100',
        'bus-card-header-title'
      )

      const left = document.createElement('div')
      left.classList.add('d-flex', 'align-items-center', 'gap-2')

      const badgeLine = document.createElement('span', 'fw-bold')
      badgeLine.classList.add(
        'badge',
        'rounded-pill',
        'bg-dark',
        'bg-opacity-50',
        'fs-6'
      )
      badgeLine.textContent = line.line.number

      const title = document.createElement('div')
      title.classList.add('station-title', 'fw-bold')
      const labelDirection = (line.direction.name || '').split('/')[0].trim()
      title.textContent = labelDirection

      left.append(badgeLine, title)

      const right = document.createElement('div')
      right.classList.add('opacity-75', 'd-flex', 'align-items-center', 'gap-1')
      const iconHdr = document.createElement('i')
      iconHdr.classList.add('bi', 'bi-bus-front')
      right.appendChild(iconHdr)

      headerWrap.append(left, right)
      header.appendChild(headerWrap)
      card.appendChild(header)

      // Body
      const body = document.createElement('div')
      body.classList.add('card-body', 'pt-3')
      card.appendChild(body)

      // List times
      const list = document.createElement('div')
      list.classList.add('list-group', 'list-group-flush')

      const futureTimes = (line.times || [])
        .filter(t => new Date(t.realDateTime || t.dateTime) > now)
        .sort(
          (a, b) =>
            new Date(a.realDateTime || a.dateTime) -
            new Date(b.realDateTime || b.dateTime)
        )
        .slice(0, 6)

      if (futureTimes.length === 0) {
        const empty = document.createElement('div')
        empty.classList.add('text-muted', 'fst-italic')
        empty.textContent = 'Aucun passage imminent'
        body.appendChild(empty)
      } else {
        futureTimes.forEach(t => {
          const depart = new Date(t.realDateTime || t.dateTime)
          const diff = Math.max(0, Math.round(getDiffTimeMinutes(depart, now)))

          const item = document.createElement('div')
          item.classList.add(
            'list-group-item',
            'd-flex',
            'align-items-center',
            'justify-content-between',
            'py-2'
          )

          const leftWrap = document.createElement('div')
          leftWrap.classList.add('d-flex', 'align-items-center', 'gap-2')

          const statusIcon = document.createElement('i')
          if (t.realDateTime) {
            statusIcon.classList.add('bi', 'bi-broadcast-pin', 'text-primary')
            statusIcon.setAttribute('title', 'Temps réel')
          } else {
            statusIcon.classList.add('bi', 'bi-clock', 'text-secondary')
            statusIcon.setAttribute('title', 'Planifié')
          }
          leftWrap.appendChild(statusIcon)

          const badge = document.createElement('span')
          badge.classList.add(
            'badge',
            'rounded-pill',
            t.realDateTime ? 'bg-primary' : 'bg-secondary',
            !t.realDateTime && 'bg-opacity-75'
          )
          badge.textContent = diff < 1 ? '< 1 min' : `${diff} min`

          item.append(leftWrap, badge)
          list.appendChild(item)
        })
        body.appendChild(list)
      }

      // Track mode (click card to show bus pos)
      if (trackMode) {
        card.style.cursor = 'pointer'
        const hint = document.createElement('div')
        hint.classList.add(
          'mt-3',
          'text-muted',
          'small',
          'd-flex',
          'align-items-center',
          'gap-2'
        )
        const hintIcon = document.createElement('i')
        hintIcon.classList.add('bi', 'bi-geo-alt')
        hint.append(
          hintIcon,
          document.createTextNode(getLabel('infoClickTrack'))
        )
        body.appendChild(hint)

        card.addEventListener('click', () => {
          const canvas = document.getElementById('busCanvas')
          if (busApp != null) {
            busApp.shutdown()
            busApp = null
          }

          const nStations = Math.round(document.body.clientWidth / 150)
          busApp = new LineBusApp(
            line.line.id,
            line.direction.id,
            line.line.number,
            labelDirection,
            color,
            line.stop.logicalId,
            nStations,
            canvas
          )
          busApp.loadBusStations()
          busApp.elementDrawer.canvas.style.display = 'block'

          // Smooth scroll to canvas
          busApp.elementDrawer.canvas.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          })

          // Tiny click animation
          card.classList.add('clicked')
          setTimeout(() => card.classList.remove('clicked'), 400)
        })
      }
    })
  })
}

// Bus app instance
let busApp = null
function runPositionBus () {
  if (busApp != null && busApp.stations.length > 0) busApp.draw()
}
