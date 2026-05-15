import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoibmNoYW4wOCIsImEiOiJjbXA3M3B3eDYwMnFsMzJwc3Y0YTIzcGwzIn0.v6vvRF09OHyv5YwIbbqNTQ';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18,
});

// Select SVG overlay
const svg = d3.select('#map').select('svg');

// Global time filter
let timeFilter = -1;

// Scale for departure/arrival color ratio
const stationFlow = d3
    .scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

// Convert station longitude/latitude to screen x/y coordinates
function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
}

// Format minutes since midnight as normal time
function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString('en-US', {
        timeStyle: 'short'
    });
}

// Convert Date object to minutes since midnight
function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

// Filter trips to those that started or ended within 1 hour of selected time
function filterTripsbyTime(trips, timeFilter) {
    return timeFilter === -1
        ? trips
        : trips.filter((trip) => {
            const startedMinutes = minutesSinceMidnight(trip.started_at);
            const endedMinutes = minutesSinceMidnight(trip.ended_at);

            return (
                Math.abs(startedMinutes - timeFilter) <= 60 ||
                Math.abs(endedMinutes - timeFilter) <= 60
            );
        });
}

// Compute arrivals, departures, and total traffic for each station
function computeStationTraffic(stations, trips) {
    const departures = d3.rollup(
        trips,
        v => v.length,
        d => d.start_station_id
    );

    const arrivals = d3.rollup(
        trips,
        v => v.length,
        d => d.end_station_id
    );

    return stations.map((station) => {
        const id = station.short_name;

        const stationArrivals = arrivals.get(id) ?? 0;
        const stationDepartures = departures.get(id) ?? 0;

        return {
            ...station,
            arrivals: stationArrivals,
            departures: stationDepartures,
            totalTraffic: stationArrivals + stationDepartures
        };
    });
}

map.on('load', async () => {
    try {
        // Add Boston bike route source
        map.addSource('boston_route', {
            type: 'geojson',
            data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
        });

        // Add Cambridge bike route source
        map.addSource('cambridge_route', {
            type: 'geojson',
            data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
        });

        // Add Boston bike lane layer
        map.addLayer({
            id: 'boston-bike-lanes',
            type: 'line',
            source: 'boston_route',
            paint: {
                'line-color': '#32D400',
                'line-width': 2.5,
                'line-opacity': 0.6
            }
        });

        // Add Cambridge bike lane layer
        map.addLayer({
            id: 'cambridge-bike-lanes',
            type: 'line',
            source: 'cambridge_route',
            paint: {
                'line-color': '#32D400',
                'line-width': 2.5,
                'line-opacity': 0.6
            }
        });

        const jsonurl = 'bluebikes-stations.json';

        // Load trips CSV and parse date strings into Date objects
        const trips = await d3.csv(
            'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
            (trip) => {
                trip.started_at = new Date(trip.started_at);
                trip.ended_at = new Date(trip.ended_at);
                return trip;
            }
        );

        // Load station JSON
        const jsonData = await d3.json(jsonurl);

        // Keep original station list separate
        const baseStations = jsonData.data.stations;

        // Compute initial station traffic using all trips
        let stations = computeStationTraffic(baseStations, trips);

        console.log('Loaded JSON Data:', jsonData);
        console.log('Stations with traffic:', stations);
        console.log('Trips:', trips);

        // Scale circle radius by total station traffic
        const radiusScale = d3
            .scaleSqrt()
            .domain([0, d3.max(stations, d => d.totalTraffic)])
            .range([0, 25]);

        // Append circles to SVG
        const circles = svg
            .selectAll('circle')
            .data(stations, d => d.short_name)
            .enter()
            .append('circle')
            .attr('r', d => radiusScale(d.totalTraffic))
            .style('--departure-ratio', d =>
                stationFlow(
                    d.totalTraffic === 0
                        ? 0.5
                        : d.departures / d.totalTraffic
                )
            )
            .each(function (d) {
                d3.select(this)
                    .append('title')
                    .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
            });

        // Update circle positions when map moves/zooms
        function updatePositions() {
            circles
                .attr('cx', d => getCoords(d).cx)
                .attr('cy', d => getCoords(d).cy);
        }

        updatePositions();

        map.on('move', updatePositions);
        map.on('zoom', updatePositions);
        map.on('resize', updatePositions);
        map.on('moveend', updatePositions);

        // Slider elements
        const timeSlider = document.getElementById('time-slider');
        const selectedTime = document.getElementById('selected-time');
        const anyTimeLabel = document.getElementById('any-time');

        function updateScatterPlot(timeFilter) {
            // Filter trips based on selected time
            const filteredTrips = filterTripsbyTime(trips, timeFilter);

            // Recompute station traffic using filtered trips
            const filteredStations = computeStationTraffic(baseStations, filteredTrips);

            // Make circles bigger when filtering so they remain visible
            if (timeFilter === -1) {
                radiusScale.range([0, 25]);
            } else {
                radiusScale.range([3, 50]);
            }

            // Update circle radius, color ratio, and tooltip text
            circles
                .data(filteredStations, d => d.short_name)
                .attr('r', d => radiusScale(d.totalTraffic))
                .style('--departure-ratio', d =>
                    stationFlow(
                        d.totalTraffic === 0
                            ? 0.5
                            : d.departures / d.totalTraffic
                    )
                )
                .select('title')
                .text(d =>
                    `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
                );
        }

        function updateTimeDisplay() {
            timeFilter = Number(timeSlider.value);

            if (timeFilter === -1) {
                selectedTime.textContent = '';
                anyTimeLabel.style.display = 'block';
            } else {
                selectedTime.textContent = formatTime(timeFilter);
                anyTimeLabel.style.display = 'none';
            }

            updateScatterPlot(timeFilter);
        }

        timeSlider.addEventListener('input', updateTimeDisplay);
        updateTimeDisplay();

    } catch (error) {
        console.error('Error loading data:', error);
    }
});

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);