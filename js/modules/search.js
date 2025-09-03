// Labels

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
    title: "Recherche Arrêt"
  }
}

function getLabel(key) {
  const lang = LABELS[language] || LABELS['en']
  return lang[key]
}

// Events

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById("btn-search").textContent = getLabel("btnsearch")
  document.getElementById("title").textContent = getLabel("title")
})

document.getElementById("searchForm").addEventListener("submit", async e => {
  e.preventDefault()
  const keyword = document.getElementById("searchInput").value.trim()
  if (!keyword) return

  const url = `https://api.oisemob.cityway.fr/search/all?keywords=${encodeURIComponent(keyword)}&maxitems=200&objectTypes=2&includedPoiCategories=3`
  const resultsDiv = document.getElementById("results")
  resultsDiv.innerHTML = `<div class="text-muted">${getLabel("searching")}...</div>`

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
        <small class="text-muted">(${item.CityName || ""})</small>
      `
      resultsDiv.appendChild(link)
    })
  } catch (err) {
    resultsDiv.innerHTML = `<div class="text-danger">Erreur lors de la recherche</div>`
    console.error(err)
  }
})
