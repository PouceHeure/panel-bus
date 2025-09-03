// =======================
// Global Constants
// =======================
const APP_VERSION = '2.0.1'
const AUTO_REFRESH_DEFAULT = true
const REFRESH_REQUEST_INTERVAL = 10 * 1000 // ms
const REFRESH_DATE_INTERVAL = 10 * 1000 // ms (only if no data refresh)

// =======================
// Global State
// =======================
let stationID = 31500 // Default station
let stationName = null
let appState = ""
let filterLines = null
let lastUpdateData = null
let lastUpdateTime = null
let autoRefreshInterval = null
let language = 'fr'
let trackMode = false
let busApp = null

// =======================
// Labels (multilingual)
// =======================
const LABELS = {
  en: {
    serviceOFF: 'Service OFF',
    legend: 'Legend',
    realTime: 'Real Time',
    scheduledTime: 'Scheduled Time',
    autoRefresh: 'Auto Refresh',
    waitingConnection: 'Waiting Connection',
    search: "Search station",
    update: 'Update',
    station: 'Station',
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
    search: "Chercher arrêt",
    station: 'Arrêt',
    status: 'Status',
    statusConnected: 'Connecté',
    statusWaitConnection: 'Connexion En Cours',
    statusNotConnected: 'Non Connecté',
    infoClickTrack: 'Cliquer pour voir la position du bus'
  }
}

// =======================
// Helpers
// =======================
function getLabel(key) {
  const lang = LABELS[language] || LABELS['en']
  return lang[key]
}

// URL Param Helpers
function getStationIDFromURL() {
  return new URLSearchParams(window.location.search).get('stationID')
}
function getLangFromURL() {
  return new URLSearchParams(window.location.search).get('lang')
}
function getTrackModeFromURL() {
  return new URLSearchParams(window.location.search).get('track')
}
function getFilterLinesFromURL() {
  const filterParam = new URLSearchParams(window.location.search).get('filterlines')
  return filterParam ? filterParam.split(',') : null
}

function getHideBarFromURL() {
  return new URLSearchParams(window.location.search).get('hidebar')
}

// DOM Helpers
function clearContainer(el) {
  el.innerHTML = ''
}
function bodyIsEmpty(id) {
  return document.getElementById(id)?.textContent.trim() === ''
}

// Date Helpers
function dateToStringHHMMSS(d) {
  return d.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function dateToStringHHMM(d) {
  return d.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' })
}
function getDiffTimeMinutes(a, b) {
  return (a - b) / 60000
}

// =======================
// UI Updates
// =======================

function hideBar() {
  document.getElementById("searchLegendContainer").style.display = "none";
}


function updateHeadText() {
  const legendContainer = document.getElementById('legend')
  legendContainer.innerHTML = `
    <span class="d-flex align-items-center gap-1">
      <i class="bi bi-broadcast-pin text-primary"></i> ${getLabel('realTime')}
    </span>
    <span class="d-flex align-items-center gap-1">
      <i class="bi bi-clock text-secondary"></i> ${getLabel('scheduledTime')}
    </span>
  `
  appState = getLabel('waitingConnection')
}

function updateDateRefresh(d) {
  document.getElementById('updateDate').textContent = `${getLabel('update')}: ${dateToStringHHMMSS(d)}`
}

function updateDateAndNameStation() {
  const currentTimeStr = new Date().toLocaleTimeString(navigator.language, {
    hour: '2-digit',
    minute: '2-digit'
  })

  let title, siteName
  if (stationName) {
    const stationWorld = getLabel('station')
    title = `${currentTimeStr} - ${stationWorld}: ${stationName}`
    siteName = `Bus: ${stationName}`
  } else {
    title = `${currentTimeStr} - ${appState}`
    siteName = appState
  }

  document.getElementById('currentTime').textContent = title
  document.title = siteName
}

// =======================
// Auto Refresh
// =======================
function toggleAutoRefresh(isEnabled) {
  if (isEnabled) {
    if (!autoRefreshInterval) {
      autoRefreshInterval = setInterval(fetchAndDisplayBusSchedule, REFRESH_REQUEST_INTERVAL)
    }
  } else {
    setInterval(updateDateAndNameStation, REFRESH_DATE_INTERVAL)
    clearInterval(autoRefreshInterval)
    autoRefreshInterval = null
  }
}

// =======================
// Data Fetching
// =======================
function fetchAndDisplayBusSchedule() {
  let serviceIsOFF = false
  fetch(`https://api.oisemob.cityway.fr/media/api/v1/fr/Schedules/LogicalStop/${stationID}/NextDeparture?realTime=true&lineId=&direction=`)
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
        const hasRealTime = data?.[0]?.lines.some(l => l.times.some(t => t.realDateTime))
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
        appState = getLabel('serviceOFF')
        stationName = null
      }
      updateDateAndNameStation()
    })
    .catch(err => console.error('Error fetching data:', err))
}

// =======================
// Rendering
// =======================
function displayBusSchedule(busData) {
  const now = new Date()
  const container = document.getElementById('busInfo')
  clearContainer(container)

  const row = document.createElement('div')
  row.classList.add('row', 'g-3', 'row-cols-2', 'row-cols-lg-3', 'row-cols-xxl-4')
  container.appendChild(row)

  busData.forEach(transport => {
    if (transport.transportMode !== 'Bus') return

    transport.lines.forEach(line => {
      // Filter lines
      if (filterLines) {
        const nameLine = line.line.number
        if (!filterLines.some(f => nameLine.toLowerCase().includes(f.toLowerCase()))) return
      }

      // Card
      const col = document.createElement('div')
      col.classList.add('col')
      row.appendChild(col)

      const card = document.createElement('div')
      card.classList.add('card', 'shadow', 'h-100', 'bus-card', 'transition-soft')
      col.appendChild(card)

      // Header
      const color = `#${String(line.line.color || '').replace(/^#/, '')}CC`
      const header = document.createElement('div')
      header.classList.add('card-header', 'text-white', 'bus-card-header', 'd-flex', 'align-items-center')
      header.style.setProperty('--line-color', color)

      const headerWrap = document.createElement('div')
      headerWrap.classList.add('d-flex', 'align-items-center', 'justify-content-between', 'w-100', 'bus-card-header-title')

      const left = document.createElement('div')
      left.classList.add('d-flex', 'align-items-center', 'gap-2', 'bus-card-header-left')

      const badgeLine = document.createElement('span')
      badgeLine.classList.add('badge', 'rounded-pill', 'bg-dark', 'bg-opacity-50', 'fs-6', 'd-inline-flex', 'align-items-center', 'gap-1')

      const icon = document.createElement('i')
      icon.classList.add('bi', 'bi-bus-front')
      badgeLine.append(icon, document.createTextNode(line.line.number))

      const directionLine = document.createElement('span')
      directionLine.classList.add('d-inline-flex', 'align-items-center', 'rounded-pill', 'gap-2', 'station-title', 'fw-bold')

      const iconDir = document.createElement('i')
      iconDir.classList.add('bi', 'bi-signpost')
      const labelDirection = (line.direction.name || '').split('/')[0].trim()
      directionLine.append(iconDir, document.createTextNode(labelDirection))

      left.append(badgeLine, directionLine)
      headerWrap.append(left)
      header.appendChild(headerWrap)
      card.appendChild(header)

      // Body
      const body = document.createElement('div')
      body.classList.add('card-body', 'pt-3')
      card.appendChild(body)

      const list = document.createElement('div')
      list.classList.add('list-group', 'list-group-flush')

      const futureTimes = (line.times || [])
        .filter(t => new Date(t.realDateTime || t.dateTime) > now)
        .sort((a, b) => new Date(a.realDateTime || a.dateTime) - new Date(b.realDateTime || b.dateTime))
        .slice(0, 6)

      if (futureTimes.length === 0) {
        const empty = document.createElement('div')
        empty.classList.add('text-muted', 'fst-italic')
        body.appendChild(empty)
        return
      }

      futureTimes.forEach(t => {
        const depart = new Date(t.realDateTime || t.dateTime)
        const diff = Math.max(0, Math.round(getDiffTimeMinutes(depart, now)))

        const item = document.createElement('div')
        item.classList.add('list-group-item', 'd-flex', 'align-items-center', 'justify-content-between', 'py-2')

        const leftWrap = document.createElement('div')
        leftWrap.classList.add('d-flex', 'align-items-center', 'gap-2')

        const statusIcon = document.createElement('i')
        if (t.realDateTime) {
          statusIcon.classList.add('bi', 'bi-broadcast-pin', 'text-primary')
          statusIcon.setAttribute('title', 'real-time')
        } else {
          statusIcon.classList.add('bi', 'bi-clock', 'text-secondary')
          statusIcon.setAttribute('title', 'scheduled')
        }
        leftWrap.appendChild(statusIcon)

        const badge = document.createElement('span')
        badge.classList.add('badge', 'rounded-pill', t.realDateTime ? 'bg-primary' : 'bg-secondary', !t.realDateTime && 'bg-opacity-75')
        badge.textContent = diff < 1 ? '< 1 min' : `${diff} min`

        item.append(leftWrap, badge)
        list.appendChild(item)
      })
      body.appendChild(list)

      // Track mode
      if (trackMode) {
        card.style.cursor = 'pointer'
        const hint = document.createElement('div')
        hint.classList.add('mt-3', 'text-muted', 'small', 'd-flex', 'align-items-center', 'gap-2')

        const hintIcon = document.createElement('i')
        hintIcon.classList.add('bi', 'bi-geo-alt')
        hint.append(hintIcon, document.createTextNode(getLabel('infoClickTrack')))
        body.appendChild(hint)

        card.addEventListener('click', () => {
          const canvas = document.getElementById('busCanvas')
          if (busApp != null) {
            busApp.shutdown()
            busApp = null
          }

          const nStations = Math.round(document.body.clientWidth / 150)
          busApp = new LineBusApp(line.line.id, line.direction.id, line.line.number, labelDirection, color, line.stop.logicalId, nStations, canvas)
          busApp.loadBusStations()
          busApp.elementDrawer.canvas.style.display = 'block'

          busApp.elementDrawer.canvas.scrollIntoView({ behavior: 'smooth', block: 'center' })

          card.classList.add('clicked')
          setTimeout(() => card.classList.remove('clicked'), 400)
        })
      }
    })
  })
}

// =======================
// Events
// =======================
function drawBus() {
  if (busApp != null && busApp.isConnected()) busApp.draw()
}
function runPositionBus() {
  if (busApp != null && busApp.stations.length > 0) busApp.draw()
}

// Page events
window.addEventListener('pageshow', e => { if (e.persisted) window.location.reload(true) })
window.addEventListener('resize', () => {
  if (busApp != null) {
    busApp.elementDrawer.getHTMLElements()
    busApp.draw()
  }
})
window.addEventListener('beforeunload', () => { if (busApp != null) busApp.shutdown() })

// =======================
// DOM Ready Init
// =======================
document.addEventListener('DOMContentLoaded', () => {
  const paramStationID = getStationIDFromURL()
  if (paramStationID) stationID = paramStationID

  const paramFilterLines = getFilterLinesFromURL()
  if (paramFilterLines) filterLines = paramFilterLines

  const paramHideBar = getHideBarFromURL()
  if(paramHideBar != null && paramHideBar.toLowerCase() == 'true'){
    hideBar()
  };

  const paramLang = getLangFromURL()
  language = paramLang ? paramLang.toLowerCase() : navigator.language.split('-')[0]

  document.getElementById("text-search").textContent = getLabel("search")

  toggleAutoRefresh(true)
  fetchAndDisplayBusSchedule()
  updateHeadText()

  document.getElementById('versionNumber').textContent = APP_VERSION
  updateDateAndNameStation()

  const paramTrack = getTrackModeFromURL()
  if (paramTrack) trackMode = paramTrack.toLowerCase() === 'true'
})
