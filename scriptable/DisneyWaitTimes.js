// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: magic;

// Disney Wait Times
// Detects which Disney park you're in (via GPS) and shows live ride wait times.
// Data: Queue-Times.com (free API, attribution required — shown in the UI).
//
// Usage:
//   - Run in the Scriptable app: shows a sortable table.
//   - Home Screen widget: long-press > Add Widget > Scriptable > choose this script.
//     Widget parameter (optional): a park name fragment, e.g. "Epcot", to pin a park.
//   - Siri/Shortcuts: reads out the 5 longest waits.

const RADIUS_KM = 3;          // "in the park" radius
const MAX_WIDGET_ROWS = 6;
const API = "https://queue-times.com";

// ---------- Location + park detection ----------
function distKm(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function getDisneyParks() {
  const groups = await new Request(`${API}/parks.json`).loadJSON();
  const parks = [];
  for (const g of groups) {
    if (!/disney/i.test(g.name)) continue;
    for (const p of g.parks) {
      parks.push({
        id: p.id, name: p.name,
        lat: parseFloat(p.latitude), lon: parseFloat(p.longitude)
      });
    }
  }
  return parks;
}

async function pickPark(parks) {
  // Widget parameter / query override
  const override = (args.widgetParameter || args.queryParameters?.park || "").trim().toLowerCase();
  if (override) {
    const m = parks.find(p => p.name.toLowerCase().includes(override));
    if (m) return { park: m, distance: null, pinned: true };
  }
  Location.setAccuracyToHundredMeters();
  const loc = await Location.current();
  const ranked = parks
    .map(p => ({ park: p, distance: distKm(loc.latitude, loc.longitude, p.lat, p.lon) }))
    .sort((a, b) => a.distance - b.distance);
  return { ...ranked[0], inPark: ranked[0].distance <= RADIUS_KM };
}

// ---------- Wait times ----------
async function getRides(parkId) {
  const data = await new Request(`${API}/parks/${parkId}/queue_times.json`).loadJSON();
  const rides = [];
  const collect = r => rides.push({
    name: r.name, wait: r.wait_time, open: r.is_open
  });
  (data.lands || []).forEach(l => l.rides.forEach(collect));
  (data.rides || []).forEach(collect);
  return rides;
}

// Headliner / most-recognized attractions across the parks (matched by name fragment).
const POPULAR = [
  "space mountain", "seven dwarfs", "big thunder", "tron", "haunted mansion",
  "pirates of the caribbean", "jungle cruise", "peter pan", "tiana", "splash mountain",
  "buzz lightyear", "guardians of the galaxy", "frozen ever after", "test track",
  "ratatouille", "soarin", "mission: space", "rise of the resistance", "slinky dog",
  "runaway railway", "millennium falcon", "tower of terror", "rock 'n' roller",
  "toy story", "flight of passage", "na'vi river", "everest", "kilimanjaro",
  "dinosaur", "indiana jones", "matterhorn", "star tours", "roger rabbit",
  "radiator springs", "incredicoaster", "web slingers", "mission: breakout",
  "crush's coaster", "hyperspace", "it's a small world", "dumbo", "winnie the pooh",
  "avatar", "star wars", "cars"
];
const norm = n => n.toLowerCase().replace(/[\u2018\u2019]/g, "'");
const isPopular = r => POPULAR.some(k => norm(r.name).includes(k));

// Open rides first, shortest wait -> longest; closed rides last.
const byWait = (a, b) =>
  (b.open - a.open) || (a.wait - b.wait) || a.name.localeCompare(b.name);
const sortRides = rides => rides.slice().sort(byWait);

const waitColor = r => !r.open ? Color.gray()
  : r.wait >= 60 ? Color.red() : r.wait >= 30 ? Color.orange() : Color.green();
const waitText = r => r.open ? `${r.wait} min` : "Closed";

// ---------- UI ----------
async function showTable(info, rides) {
  const table = new UITable();
  table.showSeparators = true;

  const head = new UITableRow();
  head.height = 70;
  const title = head.addText(
    info.park.name,
    info.pinned ? "Pinned park"
      : info.inPark ? "You're here 🏰"
      : `Nearest Disney park: ${info.distance.toFixed(1)} km away`);
  title.titleFont = Font.boldSystemFont(20);
  title.subtitleColor = Color.gray();
  table.addRow(head);

  const addSection = (label, list) => {
    if (!list.length) return;
    const h = new UITableRow();
    h.backgroundColor = new Color("#888888", 0.15);
    h.addText(label).titleFont = Font.boldSystemFont(14);
    table.addRow(h);
    for (const r of sortRides(list)) {
      const row = new UITableRow();
      row.height = 44;
      row.addText(r.name).widthWeight = 70;
      const w = row.addText(waitText(r));
      w.widthWeight = 30; w.rightAligned(); w.titleColor = waitColor(r);
      table.addRow(row);
    }
  };
  addSection("⭐ Popular (shortest wait first)", rides.filter(isPopular));
  addSection("Other attractions (shortest wait first)", rides.filter(r => !isPopular(r)));

  // Lightning Lane (Disney's paid FastPass replacement) can't be booked from a script.
  const ll = new UITableRow();
  const llb = ll.addButton("Open Disney app / Lightning Lane");
  llb.onTap = () => Safari.open("https://disneyworld.disney.go.com/");
  llb.centerAligned();
  table.addRow(ll);

  const foot = new UITableRow();
  const f = foot.addButton("Wait times by Queue-Times.com");
  f.onTap = () => Safari.open(API);
  f.centerAligned();
  table.addRow(foot);

  await table.present();
}

function buildWidget(info, rides) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#0b1d3a");
  w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);

  const t = w.addText(info.park.name);
  t.font = Font.boldSystemFont(14); t.textColor = Color.white();
  if (!info.pinned && !info.inPark) {
    const s = w.addText(`Nearest · ${info.distance.toFixed(0)} km away`);
    s.font = Font.systemFont(10); s.textColor = Color.gray();
  }
  w.addSpacer(4);

  const open = rides.filter(r => r.open);
  const pop = open.filter(isPopular);
  const top = sortRides(pop.length ? pop : open).slice(0, MAX_WIDGET_ROWS);
  for (const r of top) {
    const row = w.addStack();
    const n = row.addText(r.name);
    n.font = Font.systemFont(11); n.textColor = Color.white(); n.lineLimit = 1;
    row.addSpacer();
    const m = row.addText(`${r.wait}`);
    m.font = Font.boldSystemFont(11); m.textColor = waitColor(r);
  }
  w.addSpacer();
  const a = w.addText("Queue-Times.com");
  a.font = Font.systemFont(8); a.textColor = Color.gray();
  return w;
}

// ---------- Main ----------
try {
  const parks = await getDisneyParks();
  const info = await pickPark(parks);
  const rides = await getRides(info.park.id);

  if (config.runsInWidget) {
    Script.setWidget(buildWidget(info, rides));
  } else if (config.runsWithSiri) {
    const open = rides.filter(r => r.open);
    const pop = open.filter(isPopular);
    const top = sortRides(pop.length ? pop : open).slice(0, 5)
      .map(r => `${r.name}, ${r.wait} minutes`).join(". ");
    Speech.speak(`${info.park.name}. Popular rides, shortest wait first: ${top}`);
  } else {
    await showTable(info, rides);
  }
} catch (e) {
  if (config.runsInWidget) {
    const w = new ListWidget();
    w.addText("Error: " + e.message);
    Script.setWidget(w);
  } else {
    const a = new Alert();
    a.title = "Disney Wait Times";
    a.message = String(e.message || e);
    await a.present();
  }
}
Script.complete();
