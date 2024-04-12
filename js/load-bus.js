// Global variables
let stationID = 31500; // Guy Denielou
let stationName = "Waiting Connection";
let stateIsFirstLoad = true;
let versionApp = "1.0.1";
let previousData = null;
let autoRefreshInterval = null;

const autoRefreshDefault = true;
const intervalTimeRefresh = 10 * 1000; // milliseconds

// Events
document.addEventListener('DOMContentLoaded', function() {
    const newStationID = getStationIDFromURL();
    if (newStationID) {
        stationID = newStationID;
    }
    fetchAndDisplayBusSchedule();

    document.getElementById('autoRefreshCheckbox').checked = autoRefreshDefault;
    toggleAutoRefresh(autoRefreshDefault);
    document.getElementById('autoRefreshCheckbox').addEventListener('change', function() {
        toggleAutoRefresh(this.checked);
    });

    document.getElementById('versionNumber').textContent = versionApp;

    updateDateAndNameStation();
});

// Retrieve station ID from URL
function getStationIDFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('stationID');
}


// Toggle the auto-refresh state
function toggleAutoRefresh(isEnabled) {
    if (isEnabled) {
        if (!autoRefreshInterval) {
            autoRefreshInterval = setInterval(fetchAndDisplayBusSchedule, intervalTimeRefresh);
        }
    } else {
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
    fetch(`https://api.oisemob.cityway.fr/media/api/v1/fr/Schedules/LogicalStop/${stationID}/NextDeparture?realTime=true&lineId=&direction=&userId=TSI_OISEMOB`)
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
            let hasRealTimeData = data && data.length > 0 && data[0].lines.some(line => line.times.some(time => time.realDateTime));

            if (!hasRealTimeData && !stateIsFirstLoad) {
                console.log("No real-time data available for this refresh cycle.");
                data = previousData;
            } else {
                updateDateRefresh(new Date());
            }

            if (data[0].lines && data[0].lines.length > 0) {
                stationName = data[0].lines[0].stop.name;
                // updateDateAndNameStation();
            }
            displayBusSchedule(data);
            stateIsFirstLoad = false;
            previousData = data;
        }else{
            clearContainer(document.getElementById('busInfo'));
            stationName = "Service Off";
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
                    let diff = (departTime - now) / 60000;
                    
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
