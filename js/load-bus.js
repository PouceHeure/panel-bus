// by default
let stationID = 31500 // guy denielou 
let stationName = "Waiting Connection"

const intervalTimeRefresh = 10 * 1000 // ms
const directionMetaNames = { // "line.number": {"direction.id": <label>}  
    "1": { "1": "Hôpital", "2": "Gare" },
    "2": { "1": "Clairoix", "2": "Venette" },
    "3": { "1": "Belin", "2": "Gare" },
    "4": { "1": "Gare", "2": "Venette" },
    "5": { "1": "Hôpital", "2": "Gare" },
    "6": { "1": "Venette", "2": "Gare" },
    "ARC Express": { "1": "Verberie", "2": "Gare" },
};


// events

document.addEventListener('DOMContentLoaded', function() {
    const newStationID = getStationIDFromURL();
    if(newStationID){
        stationID = newStationID
    }
    fetchAndDisplayBusSchedule();
    
    document.getElementById('autoRefreshCheckbox').addEventListener('change', function() {
        toggleAutoRefresh(this.checked);
    });
 });



function getStationIDFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('stationID'); // index.html?stationID=31500
}



let autoRefreshInterval = null;

function toggleAutoRefresh(isEnabled) {
    if (isEnabled) {
        if (!autoRefreshInterval) {
            fetchAndDisplayBusSchedule();
            autoRefreshInterval = setInterval(fetchAndDisplayBusSchedule, intervalTimeRefresh);
        }
    } else {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

function updateDateAndNameStation(){
    document.getElementById('currentTime').textContent = `${new Date().toLocaleTimeString(navigator.language, {hour: '2-digit', minute:'2-digit'})} - ${stationName}`;
}

function fetchAndDisplayBusSchedule() {
    const now = new Date();
    const currentHour = now.getHours();
    
    fetch(`https://api.oisemob.cityway.fr/media/api/v1/fr/Schedules/LogicalStop/${stationID}/NextDeparture?realTime=true&lineId=&direction=&userId=TSI_OISEMOB`)
    .then(response => response.json())
    .then(data => {
        let hasRealTimeData = data && data.length > 0 && data[0].lines.some(line => line.times.some(time => time.realDateTime));

        // Check if the current time is outside of the service hours (6 AM to 9 PM)
        if (currentHour < 6 || currentHour > 21) {
            console.log("Outside service hours. Refreshing continues without real-time data condition.");
            hasRealTimeData = true; // Ensures the rest of the function executes normally outside the specified hours
        }

        // sometimes, the API returns not update information from real time data
        if (!hasRealTimeData) {
            console.log("No real-time data available for this refresh cycle.");
            // Skip this refresh cycle but keep the auto-refresh active
            return;
        }

        // If real-time data is present, proceed with updating the display
        if (data[0].lines && data[0].lines.length > 0) {
            // Update stationName with the name of the first stop found
            stationName = data[0].lines[0].stop.name;
            updateDateAndNameStation();
        }

        displayBusSchedule(data);
    })
    .catch(error => console.error('Error fetching data:', error));
    
    updateDateAndNameStation();
}

function updateDateAndNameStation(){
    document.getElementById('currentTime').textContent = `${new Date().toLocaleTimeString(navigator.language, {hour: '2-digit', minute:'2-digit'})} - ${stationName}`;
}

function clearContainer(container){
    container.innerHTML = ''; 
}

const displayBusSchedule = (busData) => {
    const container = document.getElementById('busInfo');
    clearContainer(container);
    busData.forEach(transport => {
        if (transport.transportMode === "Bus") {
            transport.lines.forEach(line => {
                const lineContainer = document.createElement('div');
                lineContainer.classList.add('bus-container');

                const lineTitle = document.createElement('div');
                lineTitle.classList.add('line-title');
                lineTitle.style.backgroundColor = `#${line.line.color}`;
                const info_direction = directionMetaNames[line.line.number]?.[line.direction.id] ?? line.direction.name.split("/")[0].trim();
                lineTitle.innerHTML = `Line ${line.line.number} <span class='direction-title'>${info_direction}</span>`;
                lineContainer.appendChild(lineTitle);

                const directionContainer = document.createElement('div');
                directionContainer.classList.add('direction-container');
                lineContainer.appendChild(directionContainer);

                const futureTimes = line.times.filter(time => new Date(time.realDateTime || time.dateTime) > new Date())
                    .sort((a, b) => new Date(a.realDateTime || a.dateTime) - new Date(b.realDateTime || b.dateTime));

                futureTimes.forEach((time, index) => {
                    const departTime = new Date(time.realDateTime || time.dateTime);
                    const now = new Date();
                    let diff = (departTime - now) / 60000;

                    const timeElement = document.createElement('p');
                    timeElement.classList.add('time-info');

                    if (diff < 1) {
                        timeElement.textContent = "< 1 min";
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
