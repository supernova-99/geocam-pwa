/* =====================================================================
   GeoCam — logique applicative
   Caméra (getUserMedia) + Géolocalisation + Boussole (DeviceOrientation)
   + Minimap (OpenStreetMap ↔ ASIT-VD EPSG:2056) + capture fidèle à l'UI.
===================================================================== */
(() => {
  "use strict";

  // ---------- Références DOM ----------
  const video = document.getElementById("video");
  const canvas = document.getElementById("captureCanvas");
  const gate = document.getElementById("gate");
  const startBtn = document.getElementById("startBtn");
  const gateError = document.getElementById("gateError");
  const shutterBtn = document.getElementById("shutterBtn");
  const toastEl = document.getElementById("toast");
  const minimapWrap = document.querySelector(".minimap-wrap");
  const minimapEl = document.getElementById("minimap");

  const xVal = document.getElementById("xVal");
  const yVal = document.getElementById("yVal");
  const altBesselVal = document.getElementById("altBesselVal");
  const latVal = document.getElementById("latVal");
  const lonVal = document.getElementById("lonVal");
  const accVal = document.getElementById("accVal");

  const compassDial = document.getElementById("compassDial");
  const headingVal = document.getElementById("headingVal");
  const cardinalVal = document.getElementById("cardinalVal");
  const fovCone = document.getElementById("fovCone");

  // ---------- État courant ----------
  let currentPosition = null; // {lat, lon, alt, acc}
  let currentHeading = null;  // degrés 0-360, 0 = Nord
  let swissCoords = null;     // {x, y, altBessel} — calculés via l'API REFRAME
  let map = null;
  let currentTileLayer = null;
  let tileErrorShown = false;

  // ---------- Conversion LV95 / Bessel via l'API REFRAME de swisstopo ----------
  // Doc : https://geodesy.geo.admin.ch/reframe/  (Report 16-03, swisstopo, 2016)
  let lastReframeCall = 0;
  let lastReframeLat = null, lastReframeLon = null;
  let reframeErrorShown = false;

  async function updateSwissCoords(lat, lon, wgsAlt) {
    const now = Date.now();
    const movedEnough =
      lastReframeLat === null ||
      Math.abs(lat - lastReframeLat) > 0.00001 ||
      Math.abs(lon - lastReframeLon) > 0.00001;
    if (!movedEnough || now - lastReframeCall < 2500) return; // throttle : max 1 appel / 2.5 s
    lastReframeCall = now;
    lastReframeLat = lat;
    lastReframeLon = lon;

    let url = `https://geodesy.geo.admin.ch/reframe/wgs84tolv95?easting=${lon}&northing=${lat}&format=json`;
    if (wgsAlt !== null && wgsAlt !== undefined) url += `&altitude=${wgsAlt}`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      swissCoords = {
        x: parseFloat(data.easting),
        y: parseFloat(data.northing),
        altBessel: data.altitude !== undefined ? parseFloat(data.altitude) : null,
      };
      xVal.textContent = swissCoords.x.toFixed(2) + " m";
      yVal.textContent = swissCoords.y.toFixed(2) + " m";
      altBesselVal.textContent = swissCoords.altBessel !== null ? swissCoords.altBessel.toFixed(1) + " m" : "--";
      reframeErrorShown = false;
    } catch (e) {
      if (!reframeErrorShown) {
        reframeErrorShown = true;
        showToast("Coordonnées LV95/Bessel indisponibles (API swisstopo)");
      }
    }
  }

  // ---------- Sélecteur de caméra ----------
  const cameraSwitchBtn = document.getElementById("cameraSwitchBtn");
  let availableCameras = []; // deviceId list, caméras arrière/externes uniquement
  let currentCameraIndex = 0;
  let currentStream = null;

  // ---------- Fonds de carte disponibles ----------
  // OSM : projection standard Web Mercator (celle de Leaflet par défaut).
  // ASIT-VD : grille officielle suisse EPSG:2056 (LV95), 30 niveaux,
  // origine et résolutions lues directement dans le GetCapabilities du
  // service (https://wmts.asit-asso.ch/wmts/1.0.0/WMTSCapabilities.xml).
  proj4.defs(
    "EPSG:2056",
    "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs"
  );
  const SWISS_RESOLUTIONS = [
    4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250,
    1000, 750, 650, 500, 250, 100, 50, 20, 10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25,
    0.1, 0.05,
  ];
  const SWISS_ORIGIN = [2420000, 1350000];
  const swissCRS = new L.Proj.CRS("EPSG:2056", proj4.defs("EPSG:2056"), {
    resolutions: SWISS_RESOLUTIONS,
    origin: SWISS_ORIGIN,
    bounds: L.bounds([2420000, 130000], [2900000, 1350000]),
  });

  const BASEMAPS = {
    osm: {
      label: "OpenStreetMap",
      crs: L.CRS.EPSG3857,
      zoom: 18,
      makeLayer: () =>
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          subdomains: "abc",
          crossOrigin: "anonymous",
        }),
    },
    asitvd: {
      label: "ASIT-VD — cadastral",
      crs: swissCRS,
      zoom: 25,
      makeLayer: () =>
        L.tileLayer(
          "https://wmts.asit-asso.ch/wmts/1.0.0/asitvd.fond_cadastral/default/default/0/2056/{z}/{y}/{x}.png",
          { maxZoom: 29, minZoom: 0, crossOrigin: "anonymous" }
        ),
    },
  };
  let currentBasemap = "osm";

  // ---------- Graduations de la boussole (tous les 30°), une fois ----------
  (function drawTicks() {
    const ticksGroup = document.getElementById("ticks");
    const cx = 50, cy = 50, rOuter = 47, rInner = 41;
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = (deg * Math.PI) / 180;
      const x1 = cx + rOuter * Math.sin(rad);
      const y1 = cy - rOuter * Math.cos(rad);
      const x2 = cx + rInner * Math.sin(rad);
      const y2 = cy - rInner * Math.cos(rad);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x1.toFixed(2));
      line.setAttribute("y1", y1.toFixed(2));
      line.setAttribute("x2", x2.toFixed(2));
      line.setAttribute("y2", y2.toFixed(2));
      ticksGroup.appendChild(line);
    }
  })();

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  // ---------- Formatage ----------
  function formatCoord(v) {
    return v === null || v === undefined ? "--" : v.toFixed(6) + "°";
  }
  function cardinalFromHeading(h) {
    const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
    return dirs[Math.round(h / 45) % 8];
  }

  // ---------- Caméra ----------
  async function openCameraStream(deviceId) {
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
    }
    const videoConstraints = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } };
    currentStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    video.srcObject = currentStream;
    await video.play();
  }

  async function startCamera() {
    await openCameraStream(null); // démarrage : caméra arrière par défaut
    await detectCameras();
  }

  async function detectCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === "videoinput");
      // On exclut les caméras avant / selfie (détection par le libellé, disponible
      // une fois la permission caméra accordée). Tout le reste (arrière, grand-angle,
      // téléobjectif, caméras externes…) est proposé au balayage.
      availableCameras = videoInputs.filter((d) => {
        const label = (d.label || "").toLowerCase();
        return !(label.includes("front") || label.includes("user") || label.includes("selfie") || label.includes("face"));
      });
      if (availableCameras.length === 0) availableCameras = videoInputs; // repli si aucun libellé exploitable
      cameraSwitchBtn.classList.toggle("hidden", availableCameras.length <= 1);
      // Aligne l'index courant sur le device réellement actif au démarrage.
      const activeTrack = currentStream && currentStream.getVideoTracks()[0];
      const activeId = activeTrack && activeTrack.getSettings().deviceId;
      const idx = availableCameras.findIndex((d) => d.deviceId === activeId);
      currentCameraIndex = idx >= 0 ? idx : 0;
      // Diagnostic visible une seule fois au démarrage (utile en cas de doute
      // sur le nombre de caméras réellement exposées par le téléphone/navigateur).
      showToast(
        videoInputs.length <= 1
          ? "1 caméra détectée"
          : `${videoInputs.length} caméras détectées (${availableCameras.length} arrière/externe)`
      );
    } catch (e) {
      cameraSwitchBtn.classList.add("hidden");
    }
  }

  cameraSwitchBtn.addEventListener("click", async () => {
    if (availableCameras.length <= 1) return;
    currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
    const cam = availableCameras[currentCameraIndex];
    try {
      await openCameraStream(cam.deviceId);
      const label = cam.label || `Caméra ${currentCameraIndex + 1}/${availableCameras.length}`;
      showToast(label);
    } catch (e) {
      // Repli : certains navigateurs refusent la contrainte deviceId "exact"
      // pour certains capteurs (OverconstrainedError). On retente en "ideal".
      try {
        currentStream && currentStream.getTracks().forEach((t) => t.stop());
        currentStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { ideal: cam.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        video.srcObject = currentStream;
        await video.play();
        showToast(cam.label || `Caméra ${currentCameraIndex + 1}/${availableCameras.length}`);
      } catch (e2) {
        showToast("Impossible de basculer sur cette caméra (" + e2.name + ")");
      }
    }
  });

  // ---------- Géolocalisation ----------
  function startGeolocation() {
    if (!("geolocation" in navigator)) throw new Error("Géolocalisation indisponible sur cet appareil.");
    navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, altitude, accuracy } = pos.coords;
        currentPosition = { lat: latitude, lon: longitude, alt: altitude, acc: accuracy };
        latVal.textContent = formatCoord(latitude);
        lonVal.textContent = formatCoord(longitude);
        accVal.textContent = "± " + Math.round(accuracy) + " m";
        updateMinimapPosition(latitude, longitude);
        updateSwissCoords(latitude, longitude, altitude);
      },
      (err) => showToast("Position indisponible : " + err.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  // ---------- Minimap ----------
  // Le CRS (projection) est fixé à la création de la carte Leaflet ; comme
  // OSM (Web Mercator) et ASIT-VD (EPSG:2056) utilisent des projections
  // différentes, changer de fond de carte recrée la carte plutôt que de
  // simplement permuter la couche de tuiles.
  function buildMap(basemapKey, lat, lon) {
    if (map) {
      map.remove();
      map = null;
    }
    tileErrorShown = false;
    const cfg = BASEMAPS[basemapKey];
    map = L.map(minimapEl, {
      crs: cfg.crs,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      keyboard: false,
      tap: false,
      inertia: false,
    }).setView([lat, lon], cfg.zoom);

    currentTileLayer = cfg.makeLayer().addTo(map);
    currentTileLayer.on("tileerror", () => {
      if (tileErrorShown) return;
      tileErrorShown = true;
      showToast(
        basemapKey === "asitvd"
          ? "Tuiles ASIT-VD inaccessibles (droits d'accès ASIT ?)"
          : "Tuiles de carte inaccessibles (connexion ?)"
      );
    });
  }

  function updateMinimapPosition(lat, lon) {
    if (!map) {
      buildMap(currentBasemap, lat, lon);
      return;
    }
    map.panTo([lat, lon], { animate: true });
  }

  minimapWrap.addEventListener("click", () => {
    currentBasemap = currentBasemap === "osm" ? "asitvd" : "osm";
    showToast("Fond de carte : " + BASEMAPS[currentBasemap].label);
    if (currentPosition) {
      buildMap(currentBasemap, currentPosition.lat, currentPosition.lon);
    }
  });

  // ---------- Boussole ----------
  function updateCompassUI(heading) {
    currentHeading = heading;
    compassDial.style.transform = `rotate(${-heading}deg)`;
    headingVal.textContent = Math.round(heading) + "°";
    cardinalVal.textContent = cardinalFromHeading(heading);
    fovCone.style.transform = `rotate(${heading}deg)`;
  }

  function handleOrientation(event) {
    let heading = null;
    if (typeof event.webkitCompassHeading === "number") {
      heading = event.webkitCompassHeading; // iOS Safari : cap absolu déjà fourni
    } else if (event.alpha !== null) {
      heading = 360 - event.alpha; // Android (absolute) et repli générique
    }
    if (heading === null || isNaN(heading)) return;
    heading = (heading + 360) % 360;
    updateCompassUI(heading);
  }

  async function startCompass() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      const res = await DOE.requestPermission();
      if (res !== "granted") throw new Error("Permission boussole refusée.");
    }
    const eventName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(eventName, handleOrientation, true);
  }

  // ---------- Dessin (utilitaires canvas) ----------
  function roundedRect(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = Math.max(1, r * 0.06); ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function drawCompassOnCanvas(ctx, cx, cy, r, heading) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(11,14,17,0.78)";
    ctx.fill();
    ctx.lineWidth = r * 0.035;
    ctx.strokeStyle = "rgba(232,230,225,0.3)";
    ctx.stroke();

    ctx.save();
    ctx.rotate((-heading * Math.PI) / 180);
    ctx.strokeStyle = "#4FD1C5";
    ctx.lineWidth = r * 0.035;
    for (let deg = 0; deg < 360; deg += 30) {
      const a = (deg * Math.PI) / 180;
      const x1 = Math.sin(a) * r * 0.86, y1 = -Math.cos(a) * r * 0.86;
      const x2 = Math.sin(a) * r * 0.98, y2 = -Math.cos(a) * r * 0.98;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.font = `700 ${Math.round(r * 0.26)}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#FF8A00"; ctx.fillText("N", 0, -r * 0.72);
    ctx.fillStyle = "#E8E6E1";
    ctx.fillText("E", r * 0.72, 0);
    ctx.fillText("S", 0, r * 0.72);
    ctx.fillText("O", -r * 0.72, 0);
    ctx.restore();

    // Repère fixe = direction de la caméra
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.04);
    ctx.lineTo(-r * 0.15, -r * 0.78);
    ctx.lineTo(r * 0.15, -r * 0.78);
    ctx.closePath();
    ctx.fillStyle = "#FF8A00";
    ctx.fill();
    ctx.restore();
  }

  // Composite minimap dessiné sur un canvas SÉPARÉ, pour pouvoir détecter
  // un éventuel canvas "souillé" (tuiles cross-origin sans CORS) sans faire
  // échouer la capture de la photo entière.
  function buildMinimapCanvas(diameter, heading) {
    const off = document.createElement("canvas");
    off.width = diameter;
    off.height = diameter;
    const octx = off.getContext("2d");
    const r = diameter / 2;

    function paint(withTiles) {
      octx.clearRect(0, 0, diameter, diameter);
      octx.save();
      octx.beginPath();
      octx.arc(r, r, r, 0, Math.PI * 2);
      octx.clip();
      octx.fillStyle = "#14181c";
      octx.fillRect(0, 0, diameter, diameter);
      if (withTiles) {
        const mapRect = minimapEl.getBoundingClientRect();
        const tiles = minimapEl.querySelectorAll("img.leaflet-tile-loaded");
        tiles.forEach((img) => {
          const rect = img.getBoundingClientRect();
          const relX = (rect.left - mapRect.left) / mapRect.width;
          const relY = (rect.top - mapRect.top) / mapRect.height;
          const relW = rect.width / mapRect.width;
          const relH = rect.height / mapRect.height;
          try {
            octx.drawImage(img, relX * diameter, relY * diameter, relW * diameter, relH * diameter);
          } catch (e) { /* tuile individuelle illisible : ignorée */ }
        });
      }
      // Cône de visée + point de position (vectoriel, jamais "souillé")
      octx.save();
      octx.translate(r, r);
      octx.rotate((heading * Math.PI) / 180);
      octx.beginPath();
      octx.moveTo(0, 0);
      octx.lineTo(-r * 0.5, -r);
      octx.lineTo(r * 0.5, -r);
      octx.closePath();
      const grad = octx.createLinearGradient(0, 0, 0, -r);
      grad.addColorStop(0, "rgba(255,138,0,0.55)");
      grad.addColorStop(1, "rgba(255,138,0,0)");
      octx.fillStyle = grad;
      octx.fill();
      octx.restore();
      octx.beginPath();
      octx.arc(r, r, r * 0.09, 0, Math.PI * 2);
      octx.fillStyle = "#FF8A00";
      octx.fill();
      octx.lineWidth = r * 0.03;
      octx.strokeStyle = "#E8E6E1";
      octx.stroke();
      octx.restore();

      // Bordure + repère Nord
      octx.beginPath();
      octx.arc(r, r, r * 0.97, 0, Math.PI * 2);
      octx.lineWidth = r * 0.05;
      octx.strokeStyle = "rgba(232,230,225,0.35)";
      octx.stroke();
      octx.fillStyle = "#FF8A00";
      octx.font = `700 ${Math.round(r * 0.2)}px ui-monospace, Menlo, Consolas, monospace`;
      octx.textAlign = "center";
      octx.textBaseline = "middle";
      octx.fillText("N", r, r * 0.16);
    }

    paint(true);
    let tilesOK = true;
    try {
      octx.getImageData(0, 0, 1, 1); // déclenche une SecurityError si souillé
    } catch (e) {
      tilesOK = false;
      paint(false); // on redessine proprement, sans les tuiles
    }
    return { canvas: off, tilesOK };
  }

  // ---------- Capture photo (composite fidèle à l'aperçu) ----------
  function capturePhoto() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) { showToast("Caméra pas encore prête."); return; }

    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, vw, vh);

    const margin = vw * 0.03;

    // --- Boussole, en haut à droite ---
    const compassR = vw * 0.1;
    const compassCX = vw - margin - compassR;
    const compassCY = margin + compassR;
    if (currentHeading !== null) {
      drawCompassOnCanvas(ctx, compassCX, compassCY, compassR, currentHeading);
      const label = `${cardinalFromHeading(currentHeading)} ${Math.round(currentHeading)}°`;
      ctx.font = `600 ${Math.round(compassR * 0.32)}px ui-monospace, Menlo, Consolas, monospace`;
      const textW = ctx.measureText(label).width;
      const pillW = textW + compassR * 0.6;
      const pillH = compassR * 0.5;
      const pillY = compassCY + compassR + vh * 0.012;
      roundedRect(ctx, compassCX - pillW / 2, pillY, pillW, pillH, pillH / 2, "rgba(11,14,17,0.74)", "rgba(232,230,225,0.16)");
      ctx.fillStyle = "#E8E6E1";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, compassCX, pillY + pillH / 2);
    }

    // --- Tableau de coordonnées, pleine largeur, tout en bas (2 colonnes × 3 lignes) ---
    const rowH = vh * 0.03;
    const panelH = rowH * 3 + vh * 0.016;
    const panelX = margin;
    const panelW = vw - margin * 2;
    const panelY = vh - margin - panelH;
    const colW = (panelW - vw * 0.02) / 2;
    const colGap = vw * 0.02;
    const leftColX = panelX;
    const rightColX = panelX + colW + colGap;

    roundedRect(ctx, panelX, panelY, panelW, panelH, 12, "rgba(11,14,17,0.74)", "rgba(232,230,225,0.16)");
    ctx.strokeStyle = "rgba(232,230,225,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rightColX - colGap / 2, panelY + 10);
    ctx.lineTo(rightColX - colGap / 2, panelY + panelH - 10);
    ctx.stroke();

    const tableRows = [
      ["X (LV95)", swissCoords ? swissCoords.x.toFixed(2) + " m" : "--", "LAT", currentPosition ? currentPosition.lat.toFixed(6) + "°" : "--"],
      ["Y (LV95)", swissCoords ? swissCoords.y.toFixed(2) + " m" : "--", "LON", currentPosition ? currentPosition.lon.toFixed(6) + "°" : "--"],
      ["ALT (Bessel)", swissCoords && swissCoords.altBessel !== null ? swissCoords.altBessel.toFixed(1) + " m" : "--", "PRÉC.", currentPosition ? "± " + Math.round(currentPosition.acc) + " m" : "--"],
    ];
    const fs = Math.max(13, rowH * 0.58);
    ctx.font = `${fs}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textBaseline = "middle";
    tableRows.forEach(([lLabel, lValue, rLabel, rValue], i) => {
      const y = panelY + vh * 0.009 + rowH * i + rowH / 2;
      ctx.textAlign = "left"; ctx.fillStyle = "#9AA0A6";
      ctx.fillText(lLabel, leftColX + 14, y);
      ctx.fillText(rLabel, rightColX + 14, y);
      ctx.textAlign = "right"; ctx.fillStyle = "#4FD1C5";
      ctx.fillText(lValue, leftColX + colW - 14, y);
      ctx.fillText(rValue, rightColX + colW - 14, y);
    });

    // --- Minimap, au-dessus du tableau, alignée à droite ---
    const minimapR = vw * 0.125;
    const minimapCX = vw - margin - minimapR;
    const minimapCY = panelY - margin - minimapR;
    let tilesOK = true;
    if (currentPosition) {
      const { canvas: mapCanvas, tilesOK: ok } = buildMinimapCanvas(minimapR * 2, currentHeading || 0);
      tilesOK = ok;
      ctx.drawImage(mapCanvas, minimapCX - minimapR, minimapCY - minimapR, minimapR * 2, minimapR * 2);
    }

    canvas.toBlob((blob) => {
      if (!blob) { showToast("Échec de la capture."); return; }
      const ts = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const filename = `geocam_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.jpg`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast(tilesOK ? "Photo enregistrée dans Téléchargements" : "Photo enregistrée (carte non intégrée : accès restreint)");
    }, "image/jpeg", 0.92);
  }

  shutterBtn.addEventListener("click", capturePhoto);

  // ---------- Démarrage (geste utilisateur requis par iOS/Android) ----------
  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    gateError.classList.add("hidden");
    try {
      await startCamera();
      startGeolocation();
      await startCompass();
      gate.classList.add("hidden");
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("sw.js").catch(() => {});
      }
    } catch (err) {
      gateError.textContent = "Erreur : " + err.message + " — vérifie les autorisations dans les réglages du navigateur.";
      gateError.classList.remove("hidden");
      startBtn.disabled = false;
    }
  });
})();
