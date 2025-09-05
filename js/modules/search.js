// Labels

const TIME_BETWEEN_REQ_ACCEPTABLE = 200 // [ms]
let language = "fr"

const LABELS = {
  en: {
    searching: 'Searching',
    noresult: 'No result',
    btnsearch: "Search",
    title: "Search Station"
  },
  fr: {
    searching: 'Recherche en cours',
    noresult: 'Pas de résultat',
    btnsearch: "Chercher",
    title: "Rechercher Arrêt"
  }
}

function getLabel(key) {
  const lang = LABELS[language] || LABELS['en']
  return lang[key]
}

function getLangFromURL() {
  return new URLSearchParams(window.location.search).get('lang')
}

// Events

document.addEventListener('DOMContentLoaded', () => {
  const paramLang = getLangFromURL()
  language = paramLang ? paramLang.toLowerCase() : navigator.language.split('-')[0]
  
  document.getElementById("btn-search").textContent = getLabel("btnsearch")
  document.getElementById("title").textContent = getLabel("title")
})

function debounce(fn, delay) {
  let timeout
  return function (...args) {
    clearTimeout(timeout)
    timeout = setTimeout(() => fn.apply(this, args), delay)
  }
}

async function do_req_search(e){
  e.preventDefault()
  const keyword = document.getElementById("searchInput").value.trim()
  if (!keyword) return

  const url = `https://api.oisemob.cityway.fr/search/all?keywords=${encodeURIComponent(keyword)}&maxitems=200&objectTypes=2&includedPoiCategories=3`
  const resultsDiv = document.getElementById("results")
  // resultsDiv.innerHTML = `<div class="text-muted">${getLabel("searching")}...</div>`

  try {
    const res = await fetch(url)
    const data = await res.json()

    if (!data.length) {
      resultsDiv.innerHTML = `<div class="text-danger">${getLabel("noresult")}.</div>`
      return
    }

    resultsDiv.innerHTML = ""
    data.forEach(item => {
      const link = document.createElement("a")
      link.href = `index.html?stationID=${item.Id}`
      link.className = "list-group-item list-group-item-action"
      link.innerHTML = `
        <strong>${item.Name}</strong> 
        <small class="text-primary">(${item.CityName || ""})</small>
      `
      resultsDiv.appendChild(link)
    })
  } catch (err) {
    resultsDiv.innerHTML = `<div class="text-danger">Fail during searching</div>`
    console.error(err)
  }
}

document.getElementById("searchForm").addEventListener("input", debounce(async e => {
  do_req_search(e)
}, TIME_BETWEEN_REQ_ACCEPTABLE))

document.getElementById("searchForm").addEventListener("submit", async e => {do_req_search(e)})
