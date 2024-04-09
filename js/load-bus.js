// by default
stationID = 31500 // guy denielou 
stationName = "Waiting Connection"

const intervalTimeRefresh = 20 * 1000 // ms
const directionMetaNames = { // "ligne.number": "direction.id"  
    "1": { "1": "Hôpital", "2": "Gare" },
    "2": { "1": "Clairoix", "2": "Venette" },
    "3": { "1": "Belin", "2": "Gare" },
    "4": { "1": "Gare", "2": "Venette" },
    "5": { "1": "Hôpital", "2": "Gare" },
    "6": { "1": "Venette", "2": "Gare" },
    "ARC Express": { "1": "Verberie", "2": "Gare" },
};

function getStationIDFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('stationID'); // "31500" si l'URL est index.html?stationID=31500
}


document.addEventListener('DOMContentLoaded', function() {
    const newStationID = getStationIDFromURL();
    console.log("test" + newStationID);
    if(newStationID){
        stationID = newStationID
    }
    fetchAndDisplayBusSchedule();
    setInterval(fetchAndDisplayBusSchedule, intervalTimeRefresh);
 });


 
 function fetchAndDisplayBusSchedule() {
    fetch('https://api.oisemob.cityway.fr/media/api/v1/fr/Schedules/LogicalStop/'+stationID+'/NextDeparture?realTime=true&lineId=&direction=&userId=TSI_OISEMOB')
    .then(response => response.json())
    .then(data => {
        if (data && data.length > 0 && data[0].lines && data[0].lines.length > 0) {
            // Met à jour stationName avec le nom du premier arrêt trouvé
            stationName = data[0].lines[0].stop.name;
            document.getElementById('currentTime').textContent = `${new Date().toLocaleTimeString(navigator.language, {hour: '2-digit', minute:'2-digit'})} - ${stationName}`;
        }
        displayBusSchedule(data);
    })
    .catch(error => console.error('Erreur lors de la récupération des données:', error));
    document.getElementById('currentTime').textContent = `${new Date().toLocaleTimeString(navigator.language, {hour: '2-digit', minute:'2-digit'})} - ${stationName}`;
    
}

const displayBusSchedule = (busData) => {
    const container = document.getElementById('busInfo');
    container.innerHTML = ''; // Efface les données précédentes

    busData.forEach(transport => {
        if (transport.transportMode === "Bus") {
            transport.lines.forEach(line => {
                const lineContainer = document.createElement('div');
                lineContainer.classList.add('bus-container');

                const lineTitle = document.createElement('div');
                lineTitle.classList.add('line-title');
                lineTitle.style.backgroundColor = `#${line.line.color}`;
                const info_direction = directionMetaNames[line.line.number]?.[line.direction.id] ?? line.direction.name;
                lineTitle.innerHTML = `Ligne ${line.line.number} <span class='direction-title'>(${info_direction})</span>`;
                lineContainer.appendChild(lineTitle);

                const directionContainer = document.createElement('div');
                directionContainer.classList.add('direction-container');
                lineContainer.appendChild(directionContainer);

                const futureTimes = line.times.filter(time => new Date(time.realDateTime || time.dateTime) > new Date())
                    .sort((a, b) => new Date(a.realDateTime || a.dateTime) - new Date(b.realDateTime || b.dateTime));

                futureTimes.forEach((time, index) => {
                    const departTime = new Date(time.realDateTime || time.dateTime);
                    const now = new Date();
                    let diff = (departTime - now) / 60000; // Différence en minutes

                    const timeElement = document.createElement('p');
                    timeElement.classList.add('time-info');

                    // Utiliser timeDifference pour les temps en dessous de 1 minute
                    if (time.realDateTime && diff < 1) {
                        const seconds = time.timeDifference;
                        timeElement.textContent = `(< 1 min) ${seconds} sec`;
                    } else {
                        timeElement.textContent = `${Math.round(diff)} min`;
                    }

                    timeElement.classList.add(time.realDateTime ? 'real-time' : 'scheduled-time');

                    directionContainer.appendChild(timeElement);
                });

                container.appendChild(lineContainer);
            });
        }
    });
};
