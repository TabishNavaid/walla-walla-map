// Downtown Walla Walla business & vacancy map.
// Reads the published Google Sheet (CSV), groups its rows into buildings,
// and shows them on a Leaflet map with a list beside it that mirrors the map.
import { SHEET_CSV_URL } from "./config.js";

const SAVED_KEY = "wwmap-last-good-sheet";
const AREA = { minLat: 45.9, maxLat: 46.2, minLng: -118.6, maxLng: -118.1 };   // around Walla Walla

// A building's marker shows the combined status of its spaces. Shape repeats
// the colour so it still reads for colour-blind visitors.
const ROLLUP = {
  vacant:   { label: "All vacant",     color: "#1e7b46", shape: "square" },
  partial:  { label: "Some vacancy",   color: "#b45309", shape: "diamond" },
  occupied: { label: "Fully occupied", color: "#b3362a", shape: "circle" },
  unknown:  { label: "Status unknown", color: "#596570", shape: "triangle" },
};

// Sheet headers are matched lowercased with spaces and punctuation removed.
const COLUMNS = {
  address: ["address"], unit: ["unit"], status: ["status"], name: ["businessname"],
  use: ["whatitsusedfor"], category: ["category"], note: ["publicnote"], show: ["showonmap"],
  lat: ["lat", "latitude"], lng: ["lng", "longitude"], pin: ["mappin"],
};

const tidy = value => String(value ?? "").replace(/\s+/g, " ").trim();
const headerKey = h => h.toLowerCase().replace(/[^a-z0-9]/g, "");


// ---------- Reading the sheet ----------

// Quoted fields may contain commas, line breaks and "" (an escaped quote).
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false, quoteRow = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') { quoted = true; quoteRow = rows.length + 1; }
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return { rows, unclosedQuoteRow: quoted ? quoteRow : 0 };
}

// Lat + Lng, or both numbers in one cell ("46.068, -118.337", as Google Maps copies them).
function readCoords(lat, lng, pin, warn) {
  if (!lat && !lng && !pin) return null;
  const c = lat && lng ? [Number(lat), Number(lng)]
    : (lat || pin).replace(/[()°]/g, "").split(/[\s,;]+/).filter(Boolean).map(Number);
  const inArea = ([y, x]) => y > AREA.minLat && y < AREA.maxLat && x > AREA.minLng && x < AREA.maxLng;

  if (c.length !== 2 || c.some(Number.isNaN)) {
    warn(`“${[lat, lng, pin].filter(Boolean).join(" / ")}” isn't a pair of coordinates, so it's not on the map.`);
    return null;
  }
  if (inArea(c)) return c;
  if (inArea([c[1], c[0]])) {
    warn("Lat and Lng look swapped, so they were swapped back. Please fix them in the sheet.");
    return [c[1], c[0]];
  }
  warn(`${c.join(", ")} is outside Walla Walla, so it's not on the map.`);
  return null;
}

// Returns { error, buildings, warnings }. `error` means the file is unusable;
// smaller problems become warnings that name the sheet row.
export function parseSheet(text) {
  const warnings = [];
  const fail = error => ({ error, buildings: [], warnings });

  text = String(text ?? "").replace(/^﻿/, "");
  if (!text.trim()) return fail("The sheet is empty.");
  if (/^\s*</.test(text)) return fail("The link returned a web page, not CSV. Publish the tab as “Comma-separated values (.csv)”.");
  const { rows, unclosedQuoteRow } = parseCSV(text);
  if (unclosedQuoteRow) return fail(`Row ${unclosedQuoteRow} has an opening quote (") with no closing quote.`);

  const col = {};
  rows[0].forEach((h, i) => {
    const name = Object.keys(COLUMNS).find(k => COLUMNS[k].includes(headerKey(h)));
    if (name && !(name in col)) col[name] = i;
  });
  const missing = ["Address", "Status"].filter(h => !(h.toLowerCase() in col));
  if (missing.length) {
    return fail(`Missing column: ${missing.join(", ")}. Columns found: ${rows[0].map(tidy).filter(Boolean).join(", ")}.`);
  }
  if (rows.slice(1).every(cells => !cells.some(tidy))) return fail("The sheet has headers but no rows.");

  const byAddress = new Map();
  rows.slice(1).forEach((cells, i) => {
    const get = name => tidy(cells[col[name]]);
    if (!cells.some(tidy) || /^(false|no|0)$/i.test(get("show"))) return;   // blank or hidden

    const name = get("name");
    let address = get("address");
    const warn = msg => warnings.push(`Row ${i + 2} (${address || name || "no address"}): ${msg}`);
    if (!address) {
      warn("Address is blank.");
      address = `${name || "Unnamed"} (address not listed)`;
    }
    let status = get("status").toLowerCase();
    if (!["occupied", "vacant", "unknown"].includes(status)) {
      warn(`Status “${get("status")}” isn't Occupied, Vacant or Unknown, so it's shown as Unknown.`);
      status = "unknown";
    }
    const coords = readCoords(get("lat"), get("lng"), get("pin"), warn);

    // Same building = same address, ignoring case and extra spaces
    const key = address.toLowerCase();
    if (!byAddress.has(key)) byAddress.set(key, { address, lat: null, lng: null, spaces: [] });
    const building = byAddress.get(key);
    if (coords && building.lat === null) [building.lat, building.lng] = coords;
    building.spaces.push({
      unit: get("unit"), status, name, use: get("use"), category: get("category") || "Unknown", note: get("note"),
    });
  });

  return { error: null, buildings: [...byAddress.values()].map((b, i) => ({ ...b, id: i + 1 })), warnings };
}

// The live sheet if it's usable; otherwise the last good copy from this browser.
async function loadSheet() {
  let problem;
  try {
    if (!/^https?:\/\//.test(SHEET_CSV_URL)) throw new Error("SHEET_CSV_URL in js/config.js isn't set.");
    const res = await fetch(SHEET_CSV_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`The sheet link answered with HTTP ${res.status}.`);
    const csv = await res.text();
    const result = parseSheet(csv);
    if (!result.error) {
      try { localStorage.setItem(SAVED_KEY, JSON.stringify({ csv, savedAt: Date.now() })); } catch {}
      return { ...result, savedAt: null };
    }
    problem = result.error;
  } catch (err) {
    problem = err.message;
  }
  console.warn(`Map data: couldn't use the live sheet. ${problem}`);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SAVED_KEY)); } catch {}   // blocked in some iframes
  if (saved) return { ...parseSheet(saved.csv), savedAt: saved.savedAt };
  throw new Error(problem);
}


// ---------- Map page ----------

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const plural = (n, word) => `${n} ${n === 1 ? word : word + "s"}`;
const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

let map, markerLayer, buildings = [], visible = [], markers = {};
let selectedId = null, returnFocus = null, pendingFit = null, hasBoundary = false;

// Add what the page needs: street for grouping, rollup, display names, search text.
function prepare(list) {
  const seen = {};
  list.forEach(b => {
    const counts = { vacant: 0, occupied: 0, unknown: 0 };
    b.spaces.forEach(s => {
      counts[s.status]++;
      s.title = s.name || { vacant: "Vacant space", unknown: "Occupant unknown" }[s.status] || s.use || "Name not recorded";
      s.search = [s.name, s.use, s.category, s.unit, b.address].join(" ").toLowerCase();
    });
    b.spaces.sort((x, y) => (x.status !== "vacant") - (y.status !== "vacant") ||
      x.unit.localeCompare(y.unit, undefined, { numeric: true }));
    b.counts = counts;
    b.rollup = counts.vacant === b.spaces.length ? "vacant" : counts.vacant ? "partial" : counts.unknown ? "unknown" : "occupied";

    // "13 1/2 E Main St" → street "E Main St", number 13.5 (for sorting the list)
    const m = b.address.split(" / ")[0].match(/^(\d+)(\s+\d+\/\d+)?(?:\s*&\s*\d+)?\s+(.+)$/);
    b.street = m ? m[3] : null;
    b.number = m ? Number(m[1]) + (m[2] ? 0.5 : 0) : Infinity;

    // Buildings at the exact same point (13 and 13 1/2 E Main) are nudged apart so both can be clicked
    b.hasPin = b.lat !== null;
    if (b.hasPin) {
      const key = `${b.lat.toFixed(6)},${b.lng.toFixed(6)}`;
      seen[key] = (seen[key] || 0) + 1;
      b.pos = [b.lat, b.lng + (seen[key] - 1) * 0.00005];
    }
  });
  return list;
}

function shape(rollup, size) {
  const { color, shape } = ROLLUP[rollup];
  const s = size, h = s / 2, w = 2;
  const el = {
    circle:   `<circle cx="${h}" cy="${h}" r="${h - w}"/>`,
    square:   `<rect x="${w + 0.5}" y="${w + 0.5}" width="${s - 2 * w - 1}" height="${s - 2 * w - 1}" rx="1.5"/>`,
    diamond:  `<polygon points="${h},${w - 0.5} ${s - w + 0.5},${h} ${h},${s - w + 0.5} ${w - 0.5},${h}"/>`,
    triangle: `<polygon points="${h},${w - 0.5} ${s - w + 0.5},${s - w} ${w - 0.5},${s - w}"/>`,
  }[shape];
  return `<svg class="shape" width="${s}" height="${s}" aria-hidden="true" focusable="false">` +
    `<g fill="${color}" stroke="#fff" stroke-width="${w}" stroke-linejoin="round">${el}</g></svg>`;
}

const badge = rollup => `<span class="badge rollup-${rollup}">${shape(rollup, 12)}${ROLLUP[rollup].label}</span>`;

function addMarker(b) {
  const summary = `${ROLLUP[b.rollup].label}, ${plural(b.spaces.length, "space")}`;
  const marker = L.marker(b.pos, {
    icon: L.divIcon({ html: shape(b.rollup, 18), className: "bldg-marker", iconSize: [18, 18] }),
    riseOnHover: true,
  })
    .bindTooltip(`<strong>${esc(b.address)}</strong><br>${summary}`, { direction: "top", offset: [0, -8] })
    .on("click", () => select(b.id, marker.getElement()))
    .on("add", () => {
      const el = marker.getElement();
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", `${b.address}: ${summary.toLowerCase()}`);
      el.classList.toggle("is-active", b.id === selectedId);
      // Leaflet only handles Enter on markers that have a popup
      el.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(b.id, el); }
      });
    });
  markers[b.id] = marker;
}

// A CSS class rather than setIcon(), which would replace the element and lose keyboard focus.
function highlight(id) {
  for (const [key, marker] of Object.entries(markers)) {
    marker.getElement()?.classList.toggle("is-active", Number(key) === id);
    marker.setZIndexOffset(Number(key) === id ? 1000 : 0);
  }
}

function checkedCategories() {
  return [...document.querySelectorAll("#f-category-chips input:checked")].map(i => i.value);
}

function clearCategories() {
  document.querySelectorAll("#f-category-chips input").forEach(i => { i.checked = false; });
}

// A building is shown when at least one of its spaces passes every filter.
function applyFilters(announce = true) {
  const status = $("f-status").value;
  const query = $("f-search").value.trim().toLowerCase();
  const cats = checkedCategories();

  visible = buildings
    .map(b => ({ b, matches: b.spaces.filter(s =>
      (status === "all" || s.status === status) && (!cats.length || cats.includes(s.category)) && s.search.includes(query)) }))
    .filter(v => v.matches.length);

  markerLayer.clearLayers();
  visible.forEach(({ b }) => markers[b.id] && markerLayer.addLayer(markers[b.id]));

  $("f-category-summary").textContent = !cats.length ? "All categories" : cats.length === 1 ? cats[0] : `${cats.length} categories`;
  $("f-category").classList.toggle("has-selection", cats.length > 0);
  renderList(status !== "all" || cats.length > 0 || query !== "");
  renderCounts();
  if (selectedId !== null && !visible.some(v => v.b.id === selectedId)) closeDetail(false);
  if (announce) announceResults();
}

function renderList(filtered) {
  const OTHER = "Other locations";
  const streets = new Map();
  visible.forEach(v => {
    const street = v.b.street || OTHER;
    if (!streets.has(street)) streets.set(street, []);
    streets.get(street).push(v);
  });
  const byStreet = ([a], [b]) => (a === OTHER) - (b === OTHER) ||
    a.replace(/^[NSEW] /, "").localeCompare(b.replace(/^[NSEW] /, "")) || a.localeCompare(b);

  $("listing").innerHTML = [...streets].sort(byStreet).map(([street, items]) => `
    <h3 class="street-heading">${esc(street)} <span>${items.length}</span></h3>
    <ul class="building-list">${items.sort((x, y) => x.b.number - y.b.number).map(listItem).join("")}</ul>
  `).join("");
  $("listing").hidden = !visible.length;
  $("empty").hidden = visible.length > 0;
  $("panel-subtitle").textContent = filtered
    ? `${plural(visible.length, "building")} match, of ${buildings.length}.`
    : `${plural(visible.length, "building")}. Select one to see every business inside.`;
}

function listItem({ b, matches }) {
  const names = matches.map(s => s.unit ? `${s.title} (${s.unit})` : s.title);
  const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? `, and ${names.length - 3} more` : "");
  const count = matches.length === b.spaces.length
    ? plural(b.spaces.length, "space") : `${matches.length} of ${plural(b.spaces.length, "space")} match`;
  return `
    <li class="list-item" data-id="${b.id}">
      <button class="list-button" type="button" aria-describedby="desc-${b.id}">${esc(b.address)}</button>
      <div id="desc-${b.id}">
        <div class="meta">${badge(b.rollup)}<span class="list-count">${count}</span>
          ${b.hasPin ? "" : `<span class="location-note">Location not on map yet</span>`}</div>
        <p class="list-names">${esc(shown)}</p>
      </div>
    </li>`;
}

function renderCounts() {
  const spaces = visible.flatMap(v => v.matches);
  const count = status => spaces.filter(s => s.status === status).length;
  $("kpi-buildings").textContent = visible.length;
  $("kpi-businesses").textContent = count("occupied");
  $("kpi-vacant").textContent = count("vacant");
  $("kpi-unknown").textContent = count("unknown");
  $("stats").innerHTML = Object.keys(ROLLUP).map(r => `
    <li class="stat rollup-${r}">${shape(r, 14)}<span><strong>${visible.filter(v => v.b.rollup === r).length}</strong>
      ${ROLLUP[r].label.toLowerCase()}</span></li>`).join("");
}

// Screen-reader summary, delayed so typing in the search box doesn't announce every keystroke.
const announceResults = debounce(() => {
  const spaces = visible.reduce((n, v) => n + v.matches.length, 0);
  $("results-status").textContent = visible.length
    ? `Showing ${plural(visible.length, "building")} with ${plural(spaces, "matching space")}.`
    : "No buildings match these filters.";
}, 450);

function setPanelOpen(open) {
  $("app").classList.toggle("sidebar-collapsed", !open);
  $("panel-toggle").textContent = open ? "Hide list" : "Show list";
  $("panel-toggle").setAttribute("aria-expanded", String(open));
}

function select(id, origin) {
  const b = buildings.find(x => x.id === id);
  if (selectedId === null) returnFocus = origin;
  selectedId = id;
  setPanelOpen(true);
  highlight(id);
  if (b.hasPin) {
    const zoom = Math.max(map.getZoom(), 18);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) map.setView(b.pos, zoom);
    else map.flyTo(b.pos, zoom, { duration: 0.6 });
  }

  const parts = ["vacant", "occupied", "unknown"].filter(st => b.counts[st]).map(st => `${b.counts[st]} ${st}`);
  $("detail-content").innerHTML = `
    <h2 id="detail-title" class="detail-address" tabindex="-1">${esc(b.address)}</h2>
    <div class="detail-summary">${badge(b.rollup)}
      <span>${plural(b.spaces.length, "space")}${b.spaces.length > 1 ? ": " + parts.join(", ") : ""}</span></div>
    ${b.hasPin ? "" : `<p class="location-note">Location not on map yet.</p>`}
    <h3 class="detail-heading">Businesses and spaces</h3>
    <ul>${b.spaces.map(s => `
      <li class="space-card status-${s.status}">
        <div class="space-head"><h4>${esc(s.title)}</h4>
          <span class="badge status-${s.status}">${s.status[0].toUpperCase() + s.status.slice(1)}</span></div>
        <dl>${[["Unit", s.unit], ["Category", s.category], ["Use", s.name && s.use]].filter(([, v]) => v)
          .map(([k, v]) => `<div class="detail-row"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
        ${s.note ? `<p class="notes-box">${esc(s.note)}</p>` : ""}
      </li>`).join("")}
    </ul>`;
  $("listing-view").hidden = true;
  $("detail-panel").hidden = false;
  $("detail-content").scrollTop = 0;
  $("detail-title").focus({ preventScroll: innerWidth > 900 });
}

// Back to the list, with focus on whatever opened the detail.
function closeDetail(restoreFocus = true) {
  const id = selectedId;
  $("detail-panel").hidden = true;
  $("listing-view").hidden = false;
  selectedId = null;
  highlight(null);
  if (!restoreFocus) return;
  // The list may have been re-rendered since, so look the button up again
  const target = returnFocus?.classList.contains("list-button")
    ? document.querySelector(`.list-item[data-id="${id}"] .list-button`) : returnFocus;
  (target?.isConnected ? target : $("listing-heading")).focus();
  returnFocus = null;
}

// A map inside a hidden iframe or tab measures 0×0, and fitting then shows the whole world,
// so wait until it has a size.
function fit(bounds, options = {}) {
  pendingFit = () => map.fitBounds(bounds, { animate: false, ...options });
  if (map.getSize().x > 0) { pendingFit(); pendingFit = null; }
}

async function loadData() {
  $("listing").innerHTML = `<div class="load-state"><span class="spinner" aria-hidden="true"></span>Loading downtown businesses…</div>`;
  $("panel-subtitle").textContent = "Loading…";
  let data;
  try {
    data = await loadSheet();
  } catch (err) {
    console.error(`Map data: ${err.message}`);
    $("listing").innerHTML = `
      <div class="load-state is-error" role="alert">
        <strong>We couldn't load the map data.</strong>
        Please check your internet connection and try again. If this keeps happening, contact the Downtown Walla Walla Foundation.
        <button id="retry" class="text-button" type="button">Try again</button>
      </div>`;
    $("panel-subtitle").textContent = "Data unavailable.";
    $("retry").onclick = loadData;
    return;
  }

  data.warnings.forEach(w => console.warn(`Map data: ${w}`));
  buildings = prepare(data.buildings);
  markers = {};
  buildings.filter(b => b.hasPin).forEach(addMarker);

  const categories = {};
  buildings.forEach(b => b.spaces.forEach(s => { categories[s.category] = (categories[s.category] || 0) + 1; }));
  $("f-category-chips").innerHTML = Object.keys(categories).sort().map(c => `
    <label class="chip"><input type="checkbox" value="${esc(c)}"> ${esc(c)} <span class="chip-count">${categories[c]}</span></label>`).join("");
  applyFilters(false);

  $("data-status").hidden = !data.savedAt;
  if (data.savedAt) {
    const when = new Date(data.savedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    $("data-status").textContent = `Showing saved data from ${when}. The latest updates couldn't be loaded.`;
  }
  const pins = buildings.filter(b => b.hasPin).map(b => b.pos);
  if (!hasBoundary && pins.length) fit(L.latLngBounds(pins).pad(0.12), { maxZoom: 18 });
}

// Draw the downtown outline if the file has a shape; otherwise skip it quietly.
async function loadBoundary() {
  try {
    const geojson = await (await fetch("data/downtown-boundary.geojson")).json();
    const layer = L.geoJSON(geojson, {
      interactive: false,
      style: { color: "#1d3542", weight: 2.5, dashArray: "6 5", fillColor: "#1d3542", fillOpacity: 0.04 },
    });
    if (!layer.getLayers().length) return;
    hasBoundary = true;
    layer.addTo(map);
    fit(layer.getBounds(), { padding: [12, 12] });
    document.querySelector(".legend-boundary").hidden = false;
  } catch {}
}

function start() {
  map = L.map("map").setView([46.0674, -118.3389], 17);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = () => Object.assign(document.createElement("div"), {
    className: "map-legend",
    innerHTML: `<strong>Map key</strong><ul>
      ${Object.keys(ROLLUP).map(r => `<li class="legend-item">${shape(r, 14)}${ROLLUP[r].label}</li>`).join("")}
      <li class="legend-item legend-boundary" hidden><span class="legend-line"></span>Downtown boundary</li></ul>`,
  });
  legend.addTo(map);

  // Leaflet puts its controls after the markers, so keyboard users would tab
  // through every building before reaching zoom. Moving them first is invisible.
  const mapEl = map.getContainer();
  mapEl.prepend(mapEl.querySelector(".leaflet-control-container"));

  // Leaflet only re-measures on window resize; this also catches the panel
  // collapsing and a hidden embed becoming visible.
  new ResizeObserver(() => {
    map.invalidateSize({ pan: false });
    if (pendingFit && map.getSize().x > 0) { pendingFit(); pendingFit = null; }
  }).observe(mapEl);

  $("panel-toggle").onclick = () => setPanelOpen($("app").classList.contains("sidebar-collapsed"));
  $("detail-back").onclick = () => closeDetail();
  $("detail-panel").onkeydown = e => { if (e.key === "Escape") closeDetail(); };
  $("listing").onclick = e => {
    const item = e.target.closest(".list-item");
    if (item) select(Number(item.dataset.id), item.querySelector(".list-button"));
  };
  $("f-status").onchange = $("f-category-chips").onchange = () => applyFilters();
  $("f-search").oninput = debounce(applyFilters, 150);
  $("f-category-clear").onclick = () => { clearCategories(); applyFilters(); };
  $("clear-filters").onclick = () => {
    $("f-status").value = "all";
    $("f-search").value = "";
    clearCategories();
    applyFilters();
  };

  // Category menu closes on Escape or a click outside it
  const menu = $("f-category");
  menu.onkeydown = e => {
    if (e.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary").focus(); }
  };
  document.addEventListener("click", e => { if (menu.open && !menu.contains(e.target)) menu.open = false; });

  loadBoundary();
  loadData();
}

// Only start the page in a browser, so the parser above can also be tested on its own.
if (typeof document !== "undefined") start();
