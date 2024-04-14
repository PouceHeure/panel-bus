// Global variables
const versionApp = "1.0.3";
// station info
let stationID = 31500; // Guy Denielou
let stationName = "";
// last update info
let lastUpdateData = null;
let lastUpdateTime = null;
// auto refresh
const autoRefreshDefault = true;
let autoRefreshInterval = null; 
const intervalTimeRefreshRequest = 10 * 1000; // milliseconds
const intervalTimeRefreshDate = 10 * 1000; // milliseconds (only if no data refresh)
const timeOutForceRefresh = 2; // minutes
// language
let language = "fr";

const labels = {
    "en": {
        "serviceOFF": "Service OFF",
        "legend": "Legend",
        "realTime": "Real Time",
        "scheduledTime": "Scheduled Time",
        "autoRefresh": "Auto Refresh",
        "waitingConnection": "Waiting Connection"
    },
    "fr": {
        "serviceOFF": "Service Arrêté",
        "legend": "Légende",
        "realTime": "Temps Réel",
        "scheduledTime": "Temps Planifié",
        "autoRefresh": "Actualiser",
        "waitingConnection": "Connexion En Cours"
    }
}

function getLabel(key){
   const lang = labels[language] || labels['en'];
   return lang[key];
}

function updateHeadText() {
    const legendContainer = document.getElementById('legend');
    legendContainer.innerHTML = `
        ${getLabel("legend")}: 
        <span class="real-time">${getLabel("realTime")}</span>,
        <span class="scheduled-time">${getLabel("scheduledTime")}</span>
    `;
    const label = document.querySelector('label[for="autoRefreshCheckbox"]');
    label.textContent = `${getLabel("autoRefresh")}`;

    stationName = getLabel("waitingConnection");
}


// Events
document.addEventListener('DOMContentLoaded', function() {
    const paramStationID = getStationIDFromURL();
    if (paramStationID) {
        stationID = paramStationID;
    }
    fetchAndDisplayBusSchedule();

    const paramLang = getLangFromURL();
    if(paramLang){
        language = paramLang.toLocaleLowerCase();
    }else{
        language = navigator.language.split('-')[0];
    }
    updateHeadText();

    document.getElementById('autoRefreshCheckbox').checked = autoRefreshDefault;
    toggleAutoRefresh(autoRefreshDefault);
    document.getElementById('autoRefreshCheckbox').addEventListener('change', function() {
        toggleAutoRefresh(this.checked);
    });

    document.getElementById('versionNumber').textContent = versionApp;
    updateDateAndNameStation();
});

window.addEventListener('pageshow', function(event) {
    if (event.persisted) {
        window.location.reload(true);
    }
});


// Retrieve station ID from URL
function getStationIDFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('stationID');
}

function getLangFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('lang');
}


// Toggle the auto-refresh state
function toggleAutoRefresh(isEnabled) {
    if (isEnabled) {
        if (!autoRefreshInterval) {
            autoRefreshInterval = setInterval(fetchAndDisplayBusSchedule, intervalTimeRefreshRequest);
        }
    } else {
        setInterval(updateDateAndNameStation, intervalTimeRefreshDate);
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

// Update the date and station name in the UI
function updateDateAndNameStation() {
    const title =  `${new Date().toLocaleTimeString(navigator.language, {hour: '2-digit', minute: '2-digit'})} - ${stationName}`;
    document.getElementById('currentTime').textContent = title;
    document.title = `Bus: ${stationName}`;
}

// Check if a body element is empty
function bodyIsEmpty(elementId) {
    const element = document.getElementById(elementId);
    return element && element.textContent.trim() === '';
}

// Determine if it is service time
function isServiceTime(time) {
    return time > 5 && time < 22;
}

// Fetch and display bus schedule
function fetchAndDisplayBusSchedule() {
    let serviceIsOFF = false;
    fetch(`https://api.oisemob.cityway.fr/media/api/v1/fr/Schedules/LogicalStop/${stationID}/NextDeparture?realTime=true&lineId=&direction=`)
    .then(response => {
            if(response.status === 204){
                serviceIsOFF = true;
                return {};
            }
            return response.json()
        }
    )
    .then(data => {
        if(!serviceIsOFF){
            const now = new Date();
            // check it's necessary to update
            const dataEmpty = data.length == 0;
            const hasRealTimeData = data && data.length > 0 
                                 && data[0].lines.some(line => line.times.some(time => time.realDateTime));
            const stateIsFirstLoad = lastUpdateTime == null;
            const updateIsTooOld = stateIsFirstLoad || getDiffTimeMinutes(lastUpdateTime,now) > timeOutForceRefresh;
            const okToUpdateData = !dataEmpty && (hasRealTimeData || updateIsTooOld);
            // update data
            if(okToUpdateData) {
                updateDateRefresh(now);
                lastUpdateTime = now;
                lastUpdateData = data;
            }else{
                console.log("No real-time data available for this refresh cycle.");
                data = lastUpdateData;
            }
            
            if (data[0].lines && data[0].lines.length > 0) {
                stationName = data[0].lines[0].stop.name;
            }
            displayBusSchedule(data);
        }else{
            clearContainer(document.getElementById('busInfo'));
            stationName = getLabel("serviceOFF");
        }
        updateDateAndNameStation();
    }
    )
    .catch(error => {
        console.error('Error fetching data:', error);
    });
}

// Clear HTML content of a container
function clearContainer(container) {
    container.innerHTML = '';
}

// Update the refresh date display
function updateDateRefresh(date) {
    document.getElementById('updateDate').textContent = `(Sync: ${date.toLocaleTimeString(navigator.language, {hour: '2-digit', minute: '2-digit', second: '2-digit'})})`;
}

// Get time difference in minutes between 2 Date
function getDiffTimeMinutes(tA, tB){
    return (tA - tB) / 60000;
}

// Display the bus schedule in the UI
const displayBusSchedule = (busData) => {
    const now = new Date();
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

                const lineNumber = document.createElement('span');
                lineNumber.classList.add('line-number');
                lineNumber.textContent = line.line.number;
                const labelDirection = line.direction.name.split("/")[0].trim();
                
                let size = 40 - line.line.number.length;
                lineNumber.style.fontSize = `${size}px`;
                
                lineTitle.appendChild(lineNumber);
                lineTitle.innerHTML += `<span class='direction-title'> ${labelDirection}</span>`;
                lineContainer.appendChild(lineTitle);

                const directionContainer = document.createElement('div');
                directionContainer.classList.add('direction-container');
                lineContainer.appendChild(directionContainer);

                const futureTimes = line.times.filter(time => new Date(time.realDateTime || time.dateTime) > now)
                    .sort((a, b) => new Date(a.realDateTime || a.dateTime) - new Date(b.realDateTime || b.dateTime));

                futureTimes.forEach((time, index) => {
                    const departTime = new Date(time.realDateTime || time.dateTime);
                    let diff = getDiffTimeMinutes(departTime, now);
                    
                    const timeElement = document.createElement('p');
                    timeElement.classList.add('time-info');
                    timeElement.textContent = diff < 1 ? "< 1 min" : `${Math.round(diff)} min`;
                    timeElement.classList.add(time.realDateTime ? 'real-time' : 'scheduled-time');

                    directionContainer.appendChild(timeElement);
                });

                container.appendChild(lineContainer);
            });
        }
    });
};
