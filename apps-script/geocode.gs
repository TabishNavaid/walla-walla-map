// Fills in Lat and Lng on the "Map" tab when someone types an Address and leaves them empty.
// Install once: Extensions → Apps Script, paste this file, Save, pick installTrigger in the
// toolbar, Run, and allow access. (A simple onEdit trigger isn't allowed to use Maps.)

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("fillCoordinates").forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
}

function fillCoordinates(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== "Map") return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim().toLowerCase());
  const [address, lat, lng] = ["address", "lat", "lng"].map(h => headers.indexOf(h) + 1);
  if (!address || !lat || !lng || address < e.range.getColumn() || address > e.range.getLastColumn()) return;

  for (let row = Math.max(e.range.getRow(), 2); row <= e.range.getLastRow(); row++) {
    const text = String(sheet.getRange(row, address).getValue()).trim();
    if (!text || sheet.getRange(row, lat).getValue() !== "" || sheet.getRange(row, lng).getValue() !== "") continue;

    // "4 N Colville St / 103 E Main St" → first address; "51 & 53 E Main St" → "51 E Main St"
    const query = text.split(" / ")[0].replace(/\s*&\s*\d+/, "") + ", Walla Walla, WA";
    const result = Maps.newGeocoder().geocode(query).results[0];
    // Skip vague matches (just the street or the city) and anything outside Walla Walla
    if (!result || !/street_address|premise/.test(result.types.join())) continue;
    const { lat: y, lng: x } = result.geometry.location;
    if (y < 45.9 || y > 46.2 || x < -118.6 || x > -118.1) continue;

    sheet.getRange(row, lat).setValue(Math.round(y * 1e6) / 1e6);
    sheet.getRange(row, lng).setValue(Math.round(x * 1e6) / 1e6);
  }
}
