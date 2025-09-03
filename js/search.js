document.getElementById("searchForm").addEventListener("submit", async e => {
  e.preventDefault()
  const keyword = document.getElementById("searchInput").value.trim()
  if (!keyword) return

  const url = `https://api.oisemob.cityway.fr/search/all?keywords=${encodeURIComponent(keyword)}&maxitems=200&objectTypes=2&includedPoiCategories=3`
  const resultsDiv = document.getElementById("results")
  resultsDiv.innerHTML = `<div class="text-muted">Searching...</div>`

  try {
    const res = await fetch(url)
    const data = await res.json()

    if (!data.length) {
      resultsDiv.innerHTML = `<div class="text-danger">No result.</div>`
      return
    }

    resultsDiv.innerHTML = ""
    data.forEach(item => {
      const link = document.createElement("a")
      link.href = `index.html?stationID=${item.Id}&name=${encodeURIComponent(item.Name)}`
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
