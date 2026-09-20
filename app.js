(() => {
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
  const gateEl = $("locGate");
  const sheetEl = $("sheet");

  let map, marker;
  let frames = [];
  let frameIndex = 0;
  let radarLayer = null;
  let playing = false;
  let timer = null;
  let current = loadSavedPlace() || { lat: 39.8283, lon: -98.5795, name: "Finding you\u2026" };
  let latestPastIndex = 0;

  function loadSavedPlace() {
    try {
      const p = JSON.parse(localStorage.getItem("simpleradar-place") || "");
      if (p && typeof p.lat === "number" && typeof p.lon === "number") return p;
    } catch (_) {}
    return null;
  }
  function savePlace(place) {
    try { localStorage.setItem("simpleradar-place", JSON.stringify(place)); } catch (_) {}
  }
  function dismissedKey(id) { return `simpleradar-alert-${id}`; }
  function pad(n) { return String(n).padStart(2, "0"); }
  function iemStamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes());
  }

  function toast(msg, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), ms);
  }
  function compass(deg) {
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
  }
  function wxInfo(code) { return WX[code] || ["Conditions unavailable", "\uD83C\uDF21\uFE0F"]; }
  function formatFrameTime(unix) {
    return new Date(unix * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function initMap() {
    map = L.map("map", {
      zoomControl: false,
      attributionControl: true,
      minZoom: 4,
      maxZoom: 14
    }).setView([current.lat, current.lon], current.name === "Finding you\u2026" ? 4 : 8);

    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles \u00a9 Esri",
      maxZoom: 16
    }).addTo(map);

    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 16,
      opacity: 0.9
    }).addTo(map);

    marker = L.circleMarker([current.lat, current.lon], {
      radius: 8,
      color: "#3ce0c4",
      weight: 2,
      fillColor: "#3ce0c4",
      fillOpacity: 0.9
    }).addTo(map);
  }

  function moveTo(lat, lon, name, zoom = 10) {
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
      const data = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`)).json();
      const city = data.city || data.locality || data.principalSubdivision;
      const region = data.principalSubdivision;
      if (city && region && city !== region) return `${city}, ${region}`;
      return city || region || "Your location";
    } catch (_) {
      return "Your location";
    }
  }

  function buildRadarFrames() {
    const end = new Date();
    end.setUTCSeconds(0, 0);
    const snap = end.getUTCMinutes() - (end.getUTCMinutes() % 5) - 5;
    end.setUTCMinutes(snap);
    const out = [];
    for (let i = 12; i >= 1; i -= 1) {
      const d = new Date(end.getTime() - i * 10 * 60 * 1000);
      d.setUTCSeconds(0, 0);
      d.setUTCMinutes(d.getUTCMinutes() - (d.getUTCMinutes() % 5));
      out.push({ time: Math.floor(d.getTime() / 1000), stamp: iemStamp(d), kind: "past" });
    }
    out.push({ time: Math.floor(Date.now() / 1000), stamp: null, kind: "live" });
    return out;
  }

  function loadRadar() {
    pause();
    frames = buildRadarFrames();
    latestPastIndex = frames.length - 1;
    $("slider").max = String(frames.length - 1);
    frameIndex = latestPastIndex;
    showFrame(frameIndex);
  }

  function radarUrl(frame) {
    if (frame.kind === "live") {
      return "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png";
    }
    return `https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::USCOMP-N0Q-${frame.stamp}/{z}/{x}/{y}.png`;
  }

  function showFrame(index) {
    if (!frames.length) return;
    frameIndex = Math.max(0, Math.min(frames.length - 1, index));
    const frame = frames[frameIndex];
    $("slider").value = String(frameIndex);
    $("frameTime").textContent = formatFrameTime(frame.time);
    $("frameHint").textContent = frame.kind === "live" ? "live" : "recent scan";

    const layer = L.tileLayer(radarUrl(frame), {
      opacity: 0.82,
      tileSize: 256,
      maxNativeZoom: 10,
      maxZoom: 14,
      detectRetina: false,
      className: "radar-layer",
      attribution: "Radar \u00a9 Iowa State IEM / NWS"
    });
    layer.addTo(map);
    if (radarLayer) {
      const old = radarLayer;
      layer.once("load", () => map.removeLayer(old));
      setTimeout(() => { if (map.hasLayer(old)) map.removeLayer(old); }, 1200);
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
    timer = setTimeout(step, next === latestPastIndex ? 900 : 380);
  }

  async function loadWeather() {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", current.lat);
    url.searchParams.set("longitude", current.lon);
    url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m");
    url.searchParams.set("hourly", "temperature_2m,precipitation_probability,weather_code");
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_hours", "24");

    try {
      const data = await (await fetch(url)).json();
      const cur = data.current || {};
      const hourly = data.hourly || {};
      const [label, emoji] = wxInfo(cur.weather_code);
      $("temp").innerHTML = `${Math.round(cur.temperature_2m)}<span>\u00b0</span>`;
      $("condition").textContent = label;
      $("wxIcon").textContent = emoji;
      $("feels").textContent = `${Math.round(cur.apparent_temperature)}\u00b0`;
      $("wind").textContent = `${Math.round(cur.wind_speed_10m)} ${compass(cur.wind_direction_10m)}`;
      const pops = hourly.precipitation_probability || [];
      const maxPop = pops.length ? Math.max(...pops) : null;
      $("rain").textContent = maxPop == null ? "--" : `${maxPop}%`;

      const now = Date.now();
      $("hourly").innerHTML = (hourly.time || []).map((stamp, i) => {
        const t = new Date(stamp);
        const isNow = Math.abs(t.getTime() - now) < 45 * 60 * 1000;
        const hourLabel = isNow ? "Now" : t.toLocaleTimeString([], { hour: "numeric" });
        const [, icon] = wxInfo(hourly.weather_code[i]);
        return `<div class="hour${isNow ? " is-now" : ""}">
          <div class="d">${hourLabel}</div>
          <div class="e">${icon}</div>
          <div class="t">${Math.round(hourly.temperature_2m[i])}\u00b0</div>
          <div class="r">${hourly.precipitation_probability[i] ?? 0}%</div>
        </div>`;
      }).join("");
    } catch (_) {
      $("condition").textContent = "Weather unavailable";
    }
  }

  async function loadAlerts() {
    alertsEl.hidden = true;
    alertsEl.innerHTML = "";
    try {
      const res = await fetch(`https://api.weather.gov/alerts/active?point=${current.lat},${current.lon}`, {
        headers: { Accept: "application/geo+json" }
      });
      if (!res.ok) return;
      const data = await res.json();
      const features = data.features || [];
      if (!features.length) return;
      const top = features[0];
      const props = top.properties || {};
      const id = props.id || top.id || props.event;
      if (id && sessionStorage.getItem(dismissedKey(id))) return;
      alertsEl.innerHTML = `<div class="alert-copy">
        <strong>${props.event || "Weather alert"}</strong>
        <p>${props.headline || props.description || "Active National Weather Service alert."}</p>
      </div>
      <button class="alert-close" type="button" aria-label="Dismiss alert">\u00d7</button>`;
      alertsEl.hidden = false;
      alertsEl.querySelector(".alert-close").addEventListener("click", () => {
        if (id) sessionStorage.setItem(dismissedKey(id), "1");
        alertsEl.hidden = true;
      });
    } catch (_) {}
  }

  async function searchPlaces(q) {
    if (!q || q.trim().length < 2) {
      resultsEl.classList.remove("open");
      resultsEl.innerHTML = "";
      return;
    }
    try {
      const data = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`)).json();
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
    if (err && err.code === 1) toast("Settings \u2192 Safari \u2192 Location \u2192 Allow this site");
    else toast("Couldn\u2019t get GPS. Use Safari and tap Allow.");
  }

  function locate() {
    if (!navigator.geolocation) {
      toast("This browser cannot share location");
      return Promise.resolve(false);
    }
    toast("Finding you\u2026");
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const name = await placeName(lat, lon);
        moveTo(lat, lon, name, 10);
        gateEl.classList.add("hidden");
        toast("Using your location");
        resolve(true);
      }, (err) => {
        geoError(err);
        resolve(false);
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
  }

  function bind() {
    $("playBtn").addEventListener("click", () => (playing ? pause() : play()));
    $("slider").addEventListener("input", (e) => {
      pause();
      showFrame(Number(e.target.value));
    });
    $("locateBtn").addEventListener("click", () => locate());
    $("useLocationBtn").addEventListener("click", () => locate());
    $("sheetToggle").addEventListener("click", () => sheetEl.classList.toggle("collapsed"));
    $("placeName").parentElement.addEventListener("click", () => sheetEl.classList.toggle("collapsed"));

    let t;
    $("search").addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => searchPlaces(e.target.value), 280);
    });
    resultsEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-lat]");
      if (!btn) return;
      gateEl.classList.add("hidden");
      moveTo(Number(btn.dataset.lat), Number(btn.dataset.lon), btn.dataset.name, 10);
      $("search").value = "";
      resultsEl.classList.remove("open");
    });
  }

  async function start() {
    initMap();
    bind();
    $("placeName").textContent = current.name || "Finding you\u2026";
    if (current.name && current.name !== "Finding you\u2026") {
      loadWeather();
      loadAlerts();
    }
    loadRadar();
    setInterval(loadRadar, 5 * 60 * 1000);
    setInterval(loadWeather, 10 * 60 * 1000);
    setInterval(loadAlerts, 5 * 60 * 1000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js?v=9").catch(() => {});
  }

  start();
})();
