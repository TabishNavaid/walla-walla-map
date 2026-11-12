# Downtown Walla Walla — Business & Vacancy Map

A static Leaflet map of downtown buildings, the businesses inside, and which spaces are vacant, for the Downtown Walla Walla Foundation. Staff edit a Google Sheet; the map reads the sheet's published CSV. `index.html`, `css/styles.css` and `js/app.js` are the whole app; `js/config.js` holds the sheet link.

## Setup

1. **Import:** in a new Google Sheet, **File → Import** `data/sheet-template.csv` (*Replace spreadsheet*) and name the tab **Map**. Import `data/staff-notes.csv` as a new tab called **Staff notes**. It stays private.
2. **Dropdowns:** add a **Lists** tab and paste these into A1 (each line lands in its own row):
   ```
   Arts, Culture & Entertainment
   Civic / Nonprofit / Religious
   Finance / Banking
   Health & Fitness
   Other
   Personal Services
   Professional Services / Offices
   Real Estate
   Residential
   Restaurant / Food & Drink
   Retail
   Unknown
   Vacant / Closed
   Wine / Tasting Room
   ```
   On Map, use **Data → Data validation** to add a Status dropdown (`Occupied`, `Vacant`, `Unknown`) and a Category dropdown from `Lists!A1:A14`, both set to *Reject the input*. Select the Show on map column and choose **Insert → Checkbox**.
3. **Formatting:** format Lat and Lng as **Custom number format** `0.000000`. The published CSV uses the displayed value, so fewer decimals would move the pins. Freeze row 1, then **Protect** it (*Data → Protect sheets and ranges → Only you*). The map finds columns by their header names.
4. **Sharing:** share the sheet with staff as Editors, with general access left *Restricted*.
5. **Publish:** **File → Share → Publish to web** → choose the **Map** tab (not the entire document) → *Comma-separated values (.csv)*. Tick *Automatically republish*, publish, and paste the link into `js/config.js`.
6. Optional: install `apps-script/geocode.gs` to fill in map pins automatically (steps at the top of the file).
7. **Boundary:** `data/downtown-boundary.geojson` is the City's official "Downtown Outline" (2008 map), rebuilt along OpenStreetMap streets, alleys and Mill Creek. To change it, edit the file at [geojson.io](https://geojson.io); an empty file is skipped.

To preview locally, run `python3 -m http.server` in this folder and open http://localhost:8000.

**The published tab is public.** Anyone with the link can download every row, including ones with *Show on map* unticked, so private notes belong in Staff notes.

**If the sheet can't be read** (it's unreachable, a required column was renamed, or the link returns a web page), the map shows the last good copy saved in the visitor's browser, with a "Showing saved data" note. The browser console (F12) says what went wrong and names any rows with problems.

## How to update the map: a guide for Foundation staff

Everything on the map comes from the **Map** tab of the Google Sheet. Changes take **a few minutes** to appear, so wait a moment and then refresh the map.

| Column | What goes there |
|---|---|
| Address | Like `7 E Main St`. Businesses in one building must share exactly the same address. |
| Unit | Suite or unit, if any. |
| Status | **Occupied**, **Vacant** or **Unknown** (dropdown). |
| Business Name | The name on the sign. Blank for an empty space. |
| What it's used for | A few words, like "Coffee shop". |
| Category | Pick from the dropdown. |
| Public note | Anyone can read this. |
| Show on map | Ticked = on the map. |
| Lat, Lng | Where the pin goes (see below). |

**A business closes:** find its row (Ctrl+F, or Cmd+F on a Mac), set Status to **Vacant** and Category to **Vacant / Closed**.

**A business moves in:** in the vacant space's row, set Status to **Occupied**, then type the Business Name, Category and What it's used for.

**Add a business:** use the first empty row. Copy the Address (and Lat and Lng) from another business in the same building, fill in the rest, and tick Show on map.

**Hide a business:** untick **Show on map**. It stays in the sheet, so you can bring it back any time. Hiding is better than deleting.

**Map pins:** if automatic pins are set up, they fill in a few seconds after you type a new address. Otherwise, right-click the building in [Google Maps](https://maps.google.com) and click the two numbers at the top of the menu to copy them. Paste both into the **Lat** cell; the map reads them from there. A row with no pin still appears in the list as "location not on map yet".

**Private notes:** use the **Staff notes** tab. Tick *Needs review* while something needs checking.

**Undo a mistake:**
- **Just now:** press Ctrl+Z (or Cmd+Z on a Mac).
- **One cell from earlier:** right-click it → **Show edit history**, then type the old value back.
- **Bigger mix-ups:** **File → Version history → See version history**, pick a time from before the mistake, and click **Restore this version**. This also undoes everyone else's changes made since then, so check with your team first.

**Please don't** rename or move the header row. If it changes, the map keeps showing the last good version until it's fixed.
