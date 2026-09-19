(() => {
  const FALLBACK = {
    lat: 33.4054,
    lon: -86.8114,
    name: "Current area"
  };

  const WX = {
    0: ["Clear", "\u2600\uFE0F"],
    1: ["Mostly clear", "\uD83C\uDF24\uFE0F"],
    2: ["Partly cloudy", "\u26C5"],
    3: ["Overcast", "\u2601\uFE0F"],
    45: ["Fog", "\uD83C\uDF2B\uFE0F"],
    48: ["Icy fog", "\uD83C\uDF2B\uFE0F"],
    51: ["Light drizzle", "\uD83C\uDF26\uFE0F"],
    53: ["Drizzle", "\uD83C\uDF26\uFE0F"],
    55: ["Heavy drizzle", "\uD83C\uDF27\uFE0F"],
    56: ["Freezing drizzle", "\uD83C\uDF27\uFE0F"],
    57: ["Freezing drizzle", "\uD83C\uDF27\uFE0F"],
    61: ["Light rain", "\uD83C\uDF27\uFE0F"],
    63: ["Rain", "\uD83C\uDF27\uFE0F"],
    65: ["Heavy rain", "\uD83C\uDF27\uFE0F"],
    66: ["Freezing rain", "\uD83C\uDF27\uFE0F"],
    67: ["Freezing rain", "\uD83C\uDF27\uFE0F"],
    71: ["Light snow", "\uD83C\uDF28\uFE0F"],
    73: ["Snow", "\u2744\uFE0F"],
    75: ["Heavy snow", "\u2744\uFE0F"],
    77: ["Snow grains", "\uD83C\uDF28\uFE0F"],
    80: ["Light showers", "\uD83C\uDF26\uFE0F"],
    81: ["Showers", "\uD83C\uDF27\uFE0F"],
    82: ["Heavy showers", "\uD83C\uDF27\uFE0F"],
    85: ["Snow showers", "\uD83C\uDF28\uFE0F"],
    86: ["Heavy snow showers", "\uD83C\uDF28\uFE0F"],
    95: ["Thunderstorm", "\u26C8\uFE0F"],
    96: ["Storm with hail", "\u26C8\uFE0F"],
    99: ["Storm with hail", "\u26C8\uFE0F"]
  };

  const $ = (id) => document.getElementById(id);
  const toastEl = $("toast");
  const resultsEl = $("results");
  const alertsEl = $("alerts");

  let map;
  let marker;
  let apiData = null;
  let frames = [];
  let frameIndex = 0;
  let radarLayer = null;
  let playing = false;
  let timer = null;
  let current = loadSavedPlace() || { ...FALLBACK };
  let radarRange = 24;

  function loadSavedPlace() {
    try {
      const raw = localStorage.getItem("simpleradar-place");
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p.lat === "number" && typeof p.lon === "number") return p;
    } catch (_) {}
    return null;
  }

  function savePlace(place) {
    try {
      localStorage.setItem("simpleradar-place", JSON.stringify(place));
    } catch (_) {}
  }

  function toast(msg, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), ms);
  }

  function compass(deg) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round(deg / 45) % 8];
  }

  function wxInfo(code) {
    return WX[code] || ["Conditions unavailable", "\uD83C\uDF21\uFE0F"];
  }

  function formatFrameTime(unix) {
    const d = new Date(unix * 1000);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay) return time;
    const day = d.toLocaleDateString([], { weekday: "short" });
    return `${day} ${time}`;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function iemStamp(date) {
    return (
      date.getUTCFullYear() +
      pad(date.getUTCMonth() + 1) +
      pad(date.getUTCDate()) +
      pad(date.getUTCHours()) +
      pad(date.getUTCMinutes())
    );
  }

  function buildIemFrames(hours = 24, stepMin = 10) {
    const end = new Date();
    end.setSeconds(0, 0);
    end.setMinutes(end.getMinutes() - (end.getMinutes() % 5) - 10);
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
    const out = [];
    for (let t = start.getTime(); t <= end.getTime(); t += stepMin * 60 * 1000) {
      const d = new Date(t);
      d.setSeconds(0, 0);
      const minutes = d.getUTCMinutes() - (d.getUTCMinutes() % 5);
      d.setUTCMinutes(minutes);
      out.push({
        source: "iem",
        time: Math.floor(d.getTime() / 1000),
        stamp: iemStamp(d)
      });
    }
    return out;
  }

  function weekday(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString([], { weekday: "short" });
  }

  function initMap() {
    map = L.map("map", {
      zoomControl: false,
      attributionControl: true,
      maxZoom: 12
    }).setView([current.lat, current.lon], 8);

    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles \u00a9 Esri",
      maxZoom: 16
    }).addTo(map);

    marker = L.circleMarker([current.lat, current.lon], {
      radius: 7,
      color: "#2ee6c8",
      weight: 2,
      fillColor: "#2ee6c8",
      fillOpacity: 0.85
    }).addTo(map);
  }

  function moveTo(lat, lon, name, zoom = 9) {
    current = { lat, lon, name };
    savePlace(current);
    map.setView([lat, lon], zoom);
    marker.setLatLng([lat, lon]);
    $("placeName").textContent = name;
    loadWeather();
    loadAlerts();
  }

  async function placeName(lat, lon) {
    try {
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
      const data = await (await fetch(url)).json();
      const city = data.city || data.locality || data.principalSubdivision;
      const region = data.principalSubdivision;
      if (city && region && city !== region) return `${city}, ${region}`;
      if (city) return city;
      if (region) return region;
    } catch (_) {}
    return "Your location";
  }

  async function loadRadar() {
    pause();
    if (radarLayer && map.hasLayer(radarLayer)) {
      map.removeLayer(radarLayer);
      radarLayer = null;
    }
    if (radarRange === 24) {
      frames = buildIemFrames(24, 10);
      $("frameHint").textContent = "last 24 hours";
      if (!frames.length) {
        $("frameTime").textContent = "No radar";
        return;
      }
      $("slider").max = String(frames.length - 1);
      frameIndex = frames.length - 1;
      $("slider").value = String(frameIndex);
      showFrame(frameIndex);
      return;
    }
    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
      apiData = await res.json();
      frames = ((apiData.radar && apiData.radar.past) ? apiData.radar.past : []).map((f) => ({
        source: "rainviewer",
        time: f.time,
        path: f.path
      }));
      $("frameHint").textContent = "last 2 hours";
      if (!frames.length) {
        $("frameTime").textContent = "No radar";
        return;
      }
      $("slider").max = String(frames.length - 1);
      frameIndex = frames.length - 1;
      $("slider").value = String(frameIndex);
      showFrame(frameIndex);
    } catch (err) {
      $("frameTime").textContent = "Radar offline";
    }
  }

  function radarUrl(frame) {
    if (frame.source === "iem") {
      return `https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::USCOMP-N0Q-${frame.stamp}/{z}/{x}/{y}.png`;
    }
    const size = window.devicePixelRatio >= 2 ? 512 : 256;
    return `${apiData.host}${frame.path}/${size}/{z}/{x}/{y}/2/1_1.png`;
  }

  function showFrame(index) {
    if (!frames.length) return;
    frameIndex = Math.max(0, Math.min(frames.length - 1, index));
    const frame = frames[frameIndex];
    $("slider").value = String(frameIndex);
    $("frameTime").textContent = formatFrameTime(frame.time);
    const latest = frameIndex === frames.length - 1;
    if (radarRange === 24) {
      $("frameHint").textContent = latest ? "latest \u00b7 24 hr" : "past scan \u00b7 24 hr";
    } else {
      $("frameHint").textContent = latest ? "latest \u00b7 2 hr" : "past scan \u00b7 2 hr";
    }

    const layer = L.tileLayer(radarUrl(frame), {
      opacity: 0.72,
      tileSize: 256,
      maxNativeZoom: frame.source === "iem" ? 8 : 7,
      maxZoom: 12,
      attribution: frame.source === "iem" ? "Radar \u00a9 Iowa State IEM / NWS" : "Radar \u00a9 RainViewer"
    });

    layer.addTo(map);
    if (radarLayer) {
      const old = radarLayer;
      layer.once("load", () => map.removeLayer(old));
      setTimeout(() => {
        if (map.hasLayer(old)) map.removeLayer(old);
      }, 1400);
    }
    radarLayer = layer;
  }

  function play() {
    if (!frames.length) return;
    playing = true;
    $("playIcon").innerHTML = '<path d="M7 6h3v12H7zm7 0h3v12h-3z"/>';
    step();
  }

  function pause() {
    playing = false;
    clearTimeout(timer);
    $("playIcon").innerHTML = '<path d="M8 5v14l11-7z"/>';
  }

  function step() {
    if (!playing) return;
    const next = frameIndex + 1 >= frames.length ? 0 : frameIndex + 1;
    showFrame(next);
    const delay = next === frames.length - 1 ? 1100 : (radarRange === 24 ? 160 : 420);
    timer = setTimeout(step, delay);
  }

  async function loadWeather() {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", current.lat);
    url.searchParams.set("longitude", current.lon);
    url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m");
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "7");

    try {
      const data = await (await fetch(url)).json();
      const cur = data.current || {};
      const daily = data.daily || {};
      const [label, emoji] = wxInfo(cur.weather_code);
      $("temp").innerHTML = `${Math.round(cur.temperature_2m)}<span>\u00b0</span>`;
      $("condition").textContent = label;
      $("wxIcon").textContent = emoji;
      $("feels").textContent = `${Math.round(cur.apparent_temperature)}\u00b0`;
      $("wind").textContent = `${Math.round(cur.wind_speed_10m)} ${compass(cur.wind_direction_10m)}`;
      const todayPop = daily.precipitation_probability_max ? daily.precipitation_probability_max[0] : null;
      $("rain").textContent = todayPop == null ? "--" : `${todayPop}%`;

      const html = (daily.time || []).map((day, i) => {
        const [dLabel, dEmoji] = wxInfo(daily.weather_code[i]);
        const pop = daily.precipitation_probability_max[i];
        return `<div class="day" title="${dLabel}">
          <div class="d">${i === 0 ? "Today" : weekday(day)}</div>
          <div class="e">${dEmoji}</div>
          <div class="t">${Math.round(daily.temperature_2m_max[i])}\u00b0 / ${Math.round(daily.temperature_2m_min[i])}\u00b0</div>
          <div class="r">${pop ?? 0}%</div>
        </div>`;
      }).join("");
      $("forecast").innerHTML = html;
    } catch (err) {
      $("condition").textContent = "Weather unavailable";
    }
  }

  async function loadAlerts() {
    alertsEl.classList.remove("show");
    alertsEl.innerHTML = "";
    try {
      const res = await fetch(
        `https://api.weather.gov/alerts/active?point=${current.lat},${current.lon}`,
        { headers: { Accept: "application/geo+json" } }
      );
      if (!res.ok) return;
      const data = await res.json();
      const features = data.features || [];
      if (!features.length) return;
      const top = features[0].properties || {};
      alertsEl.innerHTML = `<div>
        <strong>${top.event || "Weather alert"}</strong>
        <p>${top.headline || top.description || "Active National Weather Service alert for this area."}</p>
      </div>`;
      alertsEl.classList.add("show");
    } catch (_) {}
  }

  async function searchPlaces(q) {
    if (!q || q.trim().length < 2) {
      resultsEl.classList.remove("open");
      resultsEl.innerHTML = "";
      return;
    }
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
    try {
      const data = await (await fetch(url)).json();
      const results = data.results || [];
      if (!results.length) {
        resultsEl.innerHTML = `<button type="button">No matches</button>`;
        resultsEl.classList.add("open");
        return;
      }
      resultsEl.innerHTML = results.map((r) => {
        const bits = [r.name, r.admin1, r.country].filter(Boolean).join(", ");
        return `<button type="button" data-lat="${r.latitude}" data-lon="${r.longitude}" data-name="${bits}">
          ${r.name}<span>${[r.admin1, r.country].filter(Boolean).join(" \u00b7 ")}</span>
        </button>`;
      }).join("");
      resultsEl.classList.add("open");
    } catch (_) {
      toast("Search failed");
    }
  }

  function geoError(err) {
    const code = err && err.code;
    if (code === 1) {
      toast("Allow Location for this site in iPhone Settings");
    } else if (code === 3) {
      toast("Location timed out. Tap the target button.");
    } else {
      toast("Couldn\u2019t get location. Tap the target button.");
    }
  }

  function locate(opts = {}) {
    const quiet = !!opts.quiet;
    if (!navigator.geolocation) {
      if (!quiet) toast("Location not available on this device");
      return Promise.resolve(false);
    }
    if (!quiet) toast("Finding you\u2026");
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const name = await placeName(lat, lon);
          moveTo(lat, lon, name, 9);
          resolve(true);
        },
        (err) => {
          if (!quiet) geoError(err);
          resolve(false);
        },
        {
          enableHighAccuracy: false,
          timeout: 12000,
          maximumAge: 60000
        }
      );
    });
  }

  function bind() {
    $("playBtn").addEventListener("click", () => (playing ? pause() : play()));
    $("slider").addEventListener("input", (e) => {
      pause();
      showFrame(Number(e.target.value));
    });
    $("locateBtn").addEventListener("click", () => locate());
    document.querySelectorAll(".pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = Number(btn.dataset.range);
        if (next === radarRange) return;
        radarRange = next;
        document.querySelectorAll(".pill").forEach((b) => b.classList.toggle("active", Number(b.dataset.range) === radarRange));
        loadRadar();
      });
    });

    let t;
    $("search").addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => searchPlaces(e.target.value), 280);
    });
    $("search").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const first = resultsEl.querySelector("button[data-lat]");
        if (first) first.click();
      }
    });
    resultsEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-lat]");
      if (!btn) return;
      moveTo(Number(btn.dataset.lat), Number(btn.dataset.lon), btn.dataset.name, 8);
      $("search").value = "";
      resultsEl.classList.remove("open");
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-wrap") && !e.target.closest("#results")) {
        resultsEl.classList.remove("open");
      }
    });
  }

  async function start() {
    initMap();
    bind();
    $("placeName").textContent = current.name || "Finding you\u2026";
    await Promise.all([loadRadar(), loadWeather(), loadAlerts()]);
    await locate({ quiet: true });
    setInterval(loadRadar, 5 * 60 * 1000);
    setInterval(loadWeather, 10 * 60 * 1000);
    setInterval(loadAlerts, 5 * 60 * 1000);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  start();
})();
