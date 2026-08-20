/* =====================================================================
   GeoCam — logique applicative
   Caméra (getUserMedia) + Géolocalisation + Boussole (DeviceOrientation)
   + Minimap Leaflet/OSM orientée Nord fixe avec cône de visée rotatif.
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

  const latVal = document.getElementById("latVal");
  const lonVal = document.getElementById("lonVal");
  const altVal = document.getElementById("altVal");
  const accVal = document.getElementById("accVal");

  const compassDial = document.getElementById("compassDial");
  const headingVal = document.getElementById("headingVal");
  const cardinalVal = document.getElementById("cardinalVal");
  const fovCone = document.getElementById("fovCone");

  // ---------- État courant ----------
  let currentPosition = null; // {lat, lon, alt, acc}
  let currentHeading = null;  // degrés 0-360, 0 = Nord
  let map = null;
  let mapReady = false;
  let firstFix = true;

  // ---------- Graduations de la boussole (tous les 30°) ----------
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
  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  }

  // ---------- Géolocalisation ----------
  function startGeolocation() {
    if (!("geolocation" in navigator)) throw new Error("Géolocalisation indisponible sur cet appareil.");
    navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, altitude, accuracy } = pos.coords;
        currentPosition = { lat: latitude, lon: longitude, alt: altitude, acc: accuracy };
        latVal.textContent = formatCoord(latitude);
        lonVal.textContent = formatCoord(longitude);
        altVal.textContent = altitude === null ? "--" : Math.round(altitude) + " m";
        accVal.textContent = "± " + Math.round(accuracy) + " m";
        updateMinimapPosition(latitude, longitude);
      },
      (err) => {
        showToast("Position indisponible : " + err.message);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  // ---------- Minimap (Leaflet / OpenStreetMap, toujours orientée Nord) ----------
  function initMinimap(lat, lon) {
    map = L.map("minimap", {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      keyboard: false,
      tap: false,
    }).setView([lat, lon], 18);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      subdomains: "abc",
    }).addTo(map);

    mapReady = true;
  }

  function updateMinimapPosition(lat, lon) {
    if (!mapReady) {
      initMinimap(lat, lon);
      return;
    }
    map.panTo([lat, lon], { animate: firstFix === false });
    firstFix = false;
  }

  // ---------- Boussole ----------
  function updateCompassUI(heading) {
    currentHeading = heading;
    // Le cadran tourne dans le sens opposé au cap pour que "N" pointe
    // vers le vrai Nord ; le repère fixe en haut représente l'axe caméra.
    compassDial.style.transform = `rotate(${-heading}deg)`;
    headingVal.textContent = Math.round(heading) + "°";
    cardinalVal.textContent = cardinalFromHeading(heading);
    // Le cône sur la minimap (orientée Nord fixe) tourne, lui, dans le
    // sens direct : il représente la direction visée sur une carte Nord-up.
    fovCone.style.transform = `rotate(${heading}deg)`;
  }

  function handleOrientation(event) {
    let heading = null;
    if (typeof event.webkitCompassHeading === "number") {
      // iOS Safari : déjà un cap absolu par rapport au Nord magnétique.
      heading = event.webkitCompassHeading;
    } else if (event.absolute && event.alpha !== null) {
      heading = 360 - event.alpha;
    } else if (event.alpha !== null) {
      // Fallback : peut dériver sans capteur "absolute", mais reste utile.
      heading = 360 - event.alpha;
    }
    if (heading === null || isNaN(heading)) return;
    heading = (heading + 360) % 360;
    updateCompassUI(heading);
  }

  async function startCompass() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      // iOS 13+ : permission explicite requise, déclenchée par un geste utilisateur.
      const res = await DOE.requestPermission();
      if (res !== "granted") throw new Error("Permission boussole refusée.");
    }
    const eventName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(eventName, handleOrientation, true);
  }

  // ---------- Capture photo ----------
  function buildOverlayText() {
    if (!currentPosition) return "Position en cours d'acquisition…";
    const { lat, lon, alt, acc } = currentPosition;
    const headingTxt = currentHeading === null ? "--" : `${Math.round(currentHeading)}° ${cardinalFromHeading(currentHeading)}`;
    const altTxt = alt === null || alt === undefined ? "--" : `${Math.round(alt)} m`;
    return `${lat.toFixed(6)}°, ${lon.toFixed(6)}°  •  alt ${altTxt}  •  ±${Math.round(acc)} m  •  cap ${headingTxt}`;
  }

  function capturePhoto() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) { showToast("Caméra pas encore prête."); return; }

    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, vw, vh);

    // Bandeau d'informations "brûlé" en bas de l'image, comme un instrument de terrain.
    const bandH = Math.round(vh * 0.055);
    ctx.fillStyle = "rgba(11,14,17,0.72)";
    ctx.fillRect(0, vh - bandH, vw, bandH);
    ctx.fillStyle = "#E8E6E1";
    const fontSize = Math.max(14, Math.round(bandH * 0.42));
    ctx.font = `${fontSize}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textBaseline = "middle";
    ctx.fillText(buildOverlayText(), Math.round(vw * 0.02), vh - bandH / 2);

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
      showToast("Photo enregistrée dans Téléchargements");
    }, "image/jpeg", 0.92);
  }

  shutterBtn.addEventListener("click", capturePhoto);

  // ---------- Démarrage (déclenché par un geste utilisateur, requis par iOS/Android) ----------
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
