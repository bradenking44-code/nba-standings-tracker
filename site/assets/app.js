const NUMERIC_FIELDS = new Set([
  "rank", "wins", "losses", "win_pct", "points_for_pg", "points_against_pg",
  "point_diff_pg", "games_back"
]);
const CHART_COLORS = ["#ff885d", "#77b8ff", "#5bd3ad", "#ffc36a", "#c397ff", "#ff777d"];
const TEAM_CHART_COLORS = {
  "Atlanta Hawks": "#E03A3E", "Boston Celtics": "#00A651", "Brooklyn Nets": "#F4F4F4",
  "Charlotte Hornets": "#00A6A6", "Chicago Bulls": "#CE1141", "Cleveland Cavaliers": "#FDBB30",
  "Dallas Mavericks": "#0088CC", "Denver Nuggets": "#FEC524", "Detroit Pistons": "#C8102E",
  "Golden State Warriors": "#FFC72C", "Houston Rockets": "#E03A3E", "Indiana Pacers": "#FDBB30",
  "LA Clippers": "#E31837", "Los Angeles Lakers": "#FDB927", "Memphis Grizzlies": "#83A9D8",
  "Miami Heat": "#F9A01B", "Milwaukee Bucks": "#EEE1C6", "Minnesota Timberwolves": "#78BE20",
  "New Orleans Pelicans": "#C8102E", "New York Knicks": "#F58426", "Oklahoma City Thunder": "#EF3B24",
  "Orlando Magic": "#28A4E8", "Philadelphia 76ers": "#1D8FE1", "Phoenix Suns": "#E56020",
  "Portland Trail Blazers": "#E03A3E", "Sacramento Kings": "#A47BC2", "San Antonio Spurs": "#C4CED4",
  "Toronto Raptors": "#CE1141", "Utah Jazz": "#68B7E8", "Washington Wizards": "#E31837"
};
const TEAM_LOGO_CODES = {
  "Atlanta Hawks": "atl", "Boston Celtics": "bos", "Brooklyn Nets": "bkn",
  "Charlotte Hornets": "cha", "Chicago Bulls": "chi", "Cleveland Cavaliers": "cle",
  "Dallas Mavericks": "dal", "Denver Nuggets": "den", "Detroit Pistons": "det",
  "Golden State Warriors": "gs", "Houston Rockets": "hou", "Indiana Pacers": "ind",
  "LA Clippers": "lac", "Los Angeles Lakers": "lal", "Memphis Grizzlies": "mem",
  "Miami Heat": "mia", "Milwaukee Bucks": "mil", "Minnesota Timberwolves": "min",
  "New Orleans Pelicans": "no", "New York Knicks": "ny", "Oklahoma City Thunder": "okc",
  "Orlando Magic": "orl", "Philadelphia 76ers": "phi", "Phoenix Suns": "phx",
  "Portland Trail Blazers": "por", "Sacramento Kings": "sac", "San Antonio Spurs": "sa",
  "Toronto Raptors": "tor", "Utah Jazz": "scoreboard/utah", "Washington Wizards": "wsh"
};
const STORAGE_KEY = "nba-standings-shortlist-v1";
const appState = { history: [], status: {}, latest: [], previous: [], latestDate: "", previousDate: "", stars: new Set(), sortKey: "rank", sortDir: 1, shortlistOnly: false, redrawHistory: null };

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.filter(values => values.some(value => value !== "")).map(values => {
    const record = {};
    headers.forEach((header, index) => {
      const value = values[index] ?? "";
      record[header] = NUMERIC_FIELDS.has(header) && value !== "" ? Number(value) : value;
    });
    return record;
  });
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function groupByDate(rows) {
  const grouped = new Map();
  rows.forEach(row => {
    if (!grouped.has(row.date)) grouped.set(row.date, []);
    grouped.get(row.date).push(row);
  });
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function byRecord(a, b) {
  return Number(b.win_pct) - Number(a.win_pct)
    || Number(b.wins) - Number(a.wins)
    || Number(b.point_diff_pg) - Number(a.point_diff_pg)
    || String(a.item_id).localeCompare(String(b.item_id));
}

function rankedTeams(rows) {
  return [...rows].sort(byRecord).map((row, index) => ({ ...row, rank: index + 1 }));
}

function teamInitials(name) {
  const parts = String(name).replace("LA ", "Los Angeles ").split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0]?.slice(0, 3).toUpperCase() ?? "NBA";
  const last = parts[parts.length - 1];
  return (parts[0][0] + last.slice(0, 2)).toUpperCase();
}

function teamLogo(row) {
  const side = /west/i.test(row.conference) ? "west" : "east";
  const code = TEAM_LOGO_CODES[row.item];
  if (!code) return `<span class="team-badge ${side}" aria-hidden="true">${escapeHTML(teamInitials(row.item))}</span>`;
  return `<span class="team-logo-wrap"><span class="team-badge ${side}" aria-hidden="true">${escapeHTML(teamInitials(row.item))}</span><img class="team-logo" src="https://a.espncdn.com/i/teamlogos/nba/500/${code}.png" alt="" aria-hidden="true" loading="lazy" decoding="async" onerror="this.hidden=true"></span>`;
}

function pct(value, digits = 3) { return Number(value).toFixed(digits).replace(/^0/, ""); }
function signed(value, digits = 1) { return `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(digits)}`; }
function tone(value) { return Number(value) > 0 ? "positive" : Number(value) < 0 ? "negative" : "neutral"; }

async function loadData() {
  const [historyResponse, statusResponse] = await Promise.all([
    fetch("data/history.csv", { cache: "no-cache" }),
    fetch("data/status.json", { cache: "no-cache" })
  ]);
  if (!historyResponse.ok) throw new Error(`History file unavailable (${historyResponse.status})`);
  if (!statusResponse.ok) throw new Error(`Status file unavailable (${statusResponse.status})`);
  const [csv, status] = await Promise.all([historyResponse.text(), statusResponse.json()]);
  appState.history = parseCSV(csv);
  appState.status = status;
  const snapshots = groupByDate(appState.history);
  appState.latestDate = snapshots.at(-1)?.[0] ?? "";
  appState.previousDate = snapshots.at(-2)?.[0] ?? "";
  appState.latest = snapshots.at(-1)?.[1] ?? [];
  appState.previous = snapshots.at(-2)?.[1] ?? [];
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function runLabel() {
  if (!appState.status.run_time) return "No run recorded yet";
  const parsed = new Date(appState.status.run_time);
  return Number.isNaN(parsed.getTime()) ? appState.status.run_time : `Last run ${parsed.toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC`;
}

function findPreviousMap() { return new Map(appState.previous.map(row => [String(row.item_id), row])); }

function deltas() {
  const previous = findPreviousMap();
  return appState.latest.map(row => {
    const old = previous.get(String(row.item_id));
    return { row, old, delta: old ? (Number(row.win_pct) - Number(old.win_pct)) * 100 : null };
  });
}

function renderToday() {
  const sorted = rankedTeams(appState.latest);
  const leader = sorted[0];
  const bestDiff = [...appState.latest].sort((a, b) => Number(b.point_diff_pg) - Number(a.point_diff_pg))[0];
  setText("snapshot-date", appState.latestDate || "Awaiting first run");
  setText("season-label", appState.status.season ? `${String(appState.status.season).replace("-", "–")} REGULAR SEASON · DAILY SNAPSHOT` : "NBA REGULAR SEASON · DAILY SNAPSHOT");
  setText("snapshot-time", runLabel());
  setText("metric-teams", String(appState.latest.length || 0));
  setText("metric-teams-note", `${new Set(appState.latest.map(row => row.conference)).size || 0} conferences`);
  setText("metric-leader", leader?.item ?? "—");
  setText("metric-record", leader ? `${leader.wins}–${leader.losses} · ${pct(leader.win_pct)}` : "Waiting for standings");
  setText("metric-differential", bestDiff ? signed(bestDiff.point_diff_pg) : "—");
  setText("metric-diff-team", bestDiff?.item ?? "—");
  setText("metric-days", String(appState.status.days_with_success ?? 0));
  setText("metric-run-status", `${appState.status.new_today ?? 0} new · ${appState.status.gone_today ?? 0} disappeared`);
  setText("successful-days", String(appState.status.days_with_success ?? 0));
  setText("team-changes", `${appState.status.new_today ?? 0} new · ${appState.status.gone_today ?? 0} gone`);

  const source = appState.status.sources?.[0];
  const pill = document.getElementById("run-pill");
  if (pill) {
    pill.textContent = source?.ok ? "Source healthy" : source ? "Source issue" : "Waiting for run";
    pill.className = `status-pill ${source?.ok ? "status-good" : source ? "status-bad" : "status-unknown"}`;
  }
  setText("source-status", source ? `${source.name} · ${source.ok ? `${source.count} teams returned` : "request failed"}` : "No source run recorded");
  const error = document.getElementById("source-error");
  if (error) {
    error.hidden = !source?.error;
    error.textContent = source?.error ?? "";
  }

  const previous = findPreviousMap();
  const tableBody = document.querySelector("#today-table tbody");
  if (tableBody) {
    if (!sorted.length) tableBody.innerHTML = '<tr><td colspan="7" class="loading-cell">No successful standings snapshot yet.</td></tr>';
    else tableBody.innerHTML = sorted.map(row => {
      const old = previous.get(String(row.item_id));
      const change = old ? (Number(row.win_pct) - Number(old.win_pct)) * 100 : null;
      const changeLabel = change === null ? (appState.previousDate ? "NEW" : "BASELINE") : `${signed(change, 2)} pp`;
      return `<tr>
        <td><span class="rank-number">${escapeHTML(row.rank)}</span></td>
        <td><span class="team-cell">${teamLogo(row)}${escapeHTML(row.item)}</span></td>
        <td>${escapeHTML(row.record)}</td><td>${pct(row.win_pct)}</td>
        <td>${Number(row.points_for_pg).toFixed(1)}</td>
        <td class="${tone(row.point_diff_pg)}">${signed(row.point_diff_pg)}</td>
        <td class="${change === null ? "neutral" : tone(change)}">${changeLabel}</td>
      </tr>`;
    }).join("");
  }

  const moverList = document.getElementById("movers-list");
  if (moverList) {
    const movers = deltas().filter(entry => entry.old && entry.delta !== 0).sort((a, b) => {
      const magnitude = Math.abs(b.delta) - Math.abs(a.delta);
      if (magnitude) return magnitude;
      const aDiff = Math.abs(Number(a.row.point_diff_pg) - Number(a.old.point_diff_pg));
      const bDiff = Math.abs(Number(b.row.point_diff_pg) - Number(b.old.point_diff_pg));
      return bDiff - aDiff || String(a.row.item_id).localeCompare(String(b.row.item_id));
    }).slice(0, 5);
    if (!appState.previousDate) moverList.innerHTML = '<p class="muted">The first run sets the baseline. Daily movement appears after the next successful snapshot.</p>';
    else if (!movers.length) moverList.innerHTML = '<p class="muted">No win-percentage moves since the last successful snapshot.</p>';
    else moverList.innerHTML = movers.map((entry, index) => `<div class="mover-row"><span class="mover-rank">0${index + 1}</span><span><span class="mover-name">${escapeHTML(entry.row.item)}</span><span class="mover-note">${entry.old.record} → ${entry.row.record}</span></span><span class="mover-value ${tone(entry.delta)}">${signed(entry.delta, 2)} pp</span></div>`).join("");
  }
}

function loadStars() {
  try { appState.stars = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]").map(String)); }
  catch { appState.stars = new Set(); }
}

function saveStars() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...appState.stars])); }
  catch { /* The table still works if browser storage is unavailable. */ }
}

function renderBrowse() {
  loadStars();
  const rankedLatest = rankedTeams(appState.latest);
  const conferenceFilter = document.getElementById("conference-filter");
  const divisionFilter = document.getElementById("division-filter");
  const search = document.getElementById("team-search");
  const shortlistButton = document.getElementById("shortlist-toggle");
  const body = document.querySelector("#browse-table tbody");
  const count = document.getElementById("browse-count");
  if (!body) return;

  for (const [select, field] of [[conferenceFilter, "conference"], [divisionFilter, "division"]]) {
    const values = [...new Set(rankedLatest.map(row => row[field]).filter(Boolean))].sort();
    values.forEach(value => select?.insertAdjacentHTML("beforeend", `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`));
  }
  function render() {
    const query = search?.value.trim().toLocaleLowerCase() ?? "";
    let visible = rankedLatest.filter(row => {
      return (!conferenceFilter?.value || row.conference === conferenceFilter.value)
        && (!divisionFilter?.value || row.division === divisionFilter.value)
        && (!query || String(row.item).toLocaleLowerCase().includes(query))
        && (!appState.shortlistOnly || appState.stars.has(String(row.item_id)));
    });
    const sortKey = appState.sortKey;
    visible.sort((a, b) => {
      let cmp;
      if (NUMERIC_FIELDS.has(sortKey)) cmp = Number(a[sortKey]) - Number(b[sortKey]);
      else cmp = String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""));
      return appState.sortDir * cmp || String(a.item_id).localeCompare(String(b.item_id));
    });
    if (count) count.textContent = `${visible.length} of ${rankedLatest.length} teams`;
    if (!visible.length) { body.innerHTML = '<tr><td colspan="12" class="loading-cell">No teams match these filters.</td></tr>'; return; }
    body.innerHTML = visible.map(row => `<tr>
      <td><span class="rank-number">${escapeHTML(row.rank)}</span></td><td><span class="team-cell">${teamLogo(row)}${escapeHTML(row.item)}</span></td>
      <td>${escapeHTML(row.conference)}</td><td>${escapeHTML(row.division)}</td><td>${row.wins}</td><td>${row.losses}</td>
      <td>${pct(row.win_pct)}</td><td>${Number(row.points_for_pg).toFixed(1)}</td><td>${Number(row.points_against_pg).toFixed(1)}</td>
      <td class="${tone(row.point_diff_pg)}">${signed(row.point_diff_pg)}</td><td>${Number(row.games_back).toFixed(1)}</td>
      <td><button class="star-button ${appState.stars.has(String(row.item_id)) ? "starred" : ""}" data-star="${escapeHTML(row.item_id)}" type="button" aria-label="${appState.stars.has(String(row.item_id)) ? "Remove" : "Add"} ${escapeHTML(row.item)} ${appState.stars.has(String(row.item_id)) ? "from" : "to"} shortlist" aria-pressed="${appState.stars.has(String(row.item_id))}">${appState.stars.has(String(row.item_id)) ? "★" : "☆"}</button></td>
    </tr>`).join("");
  }
  search?.addEventListener("input", render);
  conferenceFilter?.addEventListener("change", render);
  divisionFilter?.addEventListener("change", render);
  shortlistButton?.addEventListener("click", () => {
    appState.shortlistOnly = !appState.shortlistOnly;
    shortlistButton.setAttribute("aria-pressed", String(appState.shortlistOnly));
    render();
  });
  document.querySelectorAll("#browse-table [data-sort]").forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.sort;
    appState.sortDir = appState.sortKey === key ? -appState.sortDir : (key === "item" || key === "conference" || key === "division" ? 1 : -1);
    appState.sortKey = key;
    render();
  }));
  body.addEventListener("click", event => {
    const button = event.target.closest("[data-star]");
    if (!button) return;
    const id = String(button.dataset.star);
    appState.stars.has(id) ? appState.stars.delete(id) : appState.stars.add(id);
    saveStars();
    render();
  });
  render();
}

function fitCanvas(canvas) {
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(280, Math.floor(canvas.clientWidth));
  const height = Math.max(120, Math.floor(canvas.clientHeight));
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  return { context, width, height };
}

function teamChartColor(name, id = name) {
  if (TEAM_CHART_COLORS[name]) return TEAM_CHART_COLORS[name];
  let hash = 2166136261;
  for (const char of String(id)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const hue = (hash >>> 0) % 360;
  return `hsl(${hue} 76% 68%)`;
}

function drawLineChart(canvas, dates, series, metric, metricLabel, emptyMessage = "More daily snapshots will build this trend.") {
  if (!canvas) return;
  const { context: ctx, width, height } = fitCanvas(canvas);
  const left = 62, right = 14, top = 20, bottom = 48;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = series.flatMap(item => item.values.filter(Number.isFinite));
  if (!dates.length || !values.length) {
    ctx.fillStyle = "#8999ad";
    ctx.font = "12px sans-serif";
    ctx.fillText(emptyMessage, left, height / 2);
    return;
  }
  const isRank = metric === "rank";
  let min = isRank ? 1 : Math.min(...values);
  let max = isRank ? 30 : Math.max(...values);
  if (!isRank) {
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * .1;
    min -= pad;
    max += pad;
  }
  ctx.font = "9px monospace";
  ctx.strokeStyle = "rgba(146,166,190,.16)";
  ctx.fillStyle = "#8090a5";
  for (let tick = 0; tick <= 4; tick += 1) {
    const y = top + (plotHeight * tick) / 4;
    const value = max - ((max - min) * tick) / 4;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
    const label = isRank ? String(Math.round(value)) : value.toFixed(2);
    ctx.textAlign = "right";
    ctx.fillText(label, left - 8, y + 3);
  }
  ctx.strokeStyle = "rgba(146,166,190,.48)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, top + plotHeight); ctx.lineTo(width - right, top + plotHeight); ctx.stroke();
  const labelStep = Math.max(1, Math.ceil(dates.length / 6));
  dates.forEach((day, index) => {
    if (index % labelStep !== 0 && index !== dates.length - 1) return;
    const x = left + (dates.length < 2 ? plotWidth / 2 : (plotWidth * index) / (dates.length - 1));
    ctx.fillStyle = "#8090a5";
    ctx.textAlign = "center";
    ctx.fillText(day.slice(5), x, top + plotHeight + 14);
  });
  series.forEach(item => {
    const color = item.color || "#77b8ff";
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = series.length > 12 ? 1.15 : 2;
    let started = false;
    item.values.forEach((value, index) => {
      if (!Number.isFinite(value)) { started = false; return; }
      const x = left + (dates.length < 2 ? plotWidth / 2 : (plotWidth * index) / (dates.length - 1));
      const y = top + ((max - value) / (max - min)) * plotHeight;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    item.values.forEach((value, index) => {
      if (!Number.isFinite(value)) return;
      const x = left + (dates.length < 2 ? plotWidth / 2 : (plotWidth * index) / (dates.length - 1));
      const y = top + ((max - value) / (max - min)) * plotHeight;
      ctx.beginPath(); ctx.fillStyle = color; ctx.arc(x, y, series.length > 12 ? 2 : 2.6, 0, Math.PI * 2); ctx.fill();
    });
  });
  ctx.fillStyle = "#aab6c4";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Snapshot date", left + plotWidth / 2, height - 5);
  ctx.save();
  ctx.translate(14, top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(isRank ? "League rank (1 = best; 30 = worst)" : metricLabel, 0, 0);
  ctx.restore();
}

function drawSnapshotChart(canvas, series, metric, metricLabel, emptyMessage = "Choose teams to show this snapshot.") {
  if (!canvas) return;
  const { context: ctx, width, height } = fitCanvas(canvas);
  const left = Math.min(156, Math.max(130, width * .34));
  const right = 20, top = 24, bottom = 52;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const rows = [...series].filter(item => Number.isFinite(item.values[0]))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  if (!rows.length) {
    ctx.fillStyle = "#8999ad";
    ctx.font = "12px sans-serif";
    ctx.fillText(emptyMessage, left, height / 2);
    return;
  }

  const isRank = metric === "rank";
  let min = isRank ? 1 : Math.min(...rows.map(item => item.values[0]));
  let max = isRank ? 30 : Math.max(...rows.map(item => item.values[0]));
  if (!isRank) {
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * .08;
    min -= pad;
    max += pad;
  }
  const xFor = value => left + ((isRank ? max - value : value - min) / (max - min)) * plotWidth;
  const rowHeight = plotHeight / rows.length;

  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "#8090a5";
  ctx.strokeStyle = "rgba(146,166,190,.16)";
  const ticks = isRank
    ? (plotWidth < 250 ? [30, 15, 1] : Array.from({ length: 7 }, (_, index) => max - ((max - min) * index) / 6))
    : Array.from({ length: 7 }, (_, index) => min + ((max - min) * index) / 6);
  ticks.forEach(value => {
    const x = xFor(value);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + plotHeight); ctx.stroke();
    ctx.fillText(isRank ? String(Math.round(value)) : value.toFixed(2), x, top + plotHeight + 16);
  });

  rows.forEach((item, index) => {
    const y = top + rowHeight * (index + .5);
    ctx.strokeStyle = "rgba(146,166,190,.09)";
    ctx.beginPath(); ctx.moveTo(left, y + rowHeight / 2); ctx.lineTo(width - right, y + rowHeight / 2); ctx.stroke();
    ctx.textAlign = "right";
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#c0cad6";
    ctx.fillText(item.name, left - 10, y + 3);
    ctx.beginPath();
    ctx.fillStyle = item.color || "#77b8ff";
    ctx.arc(xFor(item.values[0]), y, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.strokeStyle = "rgba(146,166,190,.48)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, top + plotHeight); ctx.lineTo(width - right, top + plotHeight); ctx.stroke();
  ctx.fillStyle = "#aab6c4";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(isRank ? "League rank (30 left → 1 right)" : metricLabel, left + plotWidth / 2, height - 5);
  ctx.save();
  ctx.translate(13, top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Teams, ordered by league rank", 0, 0);
  ctx.restore();
}

function drawBars(canvas, values, suffix = "") {
  if (!canvas) return;
  const { context: ctx, width, height } = fitCanvas(canvas);
  const left = 90, right = 28, top = 8, bottom = 8;
  if (!values.length) { ctx.fillStyle = "#8999ad"; ctx.font = "11px sans-serif"; ctx.fillText("History is still building.", 8, height / 2); return; }
  const maximum = Math.max(0.001, ...values.map(item => Math.abs(Number(item.value))));
  const barHeight = Math.min(18, (height - top - bottom) / values.length - 7);
  values.slice(0, 5).forEach((item, index) => {
    const y = top + index * ((height - top - bottom) / Math.min(5, values.length));
    ctx.font = "9px sans-serif"; ctx.fillStyle = "#c0c9d4";
    const label = String(item.label).length > 14 ? `${String(item.label).slice(0, 13)}…` : String(item.label);
    ctx.fillText(label, 0, y + barHeight - 3);
    const barWidth = Math.max(2, ((width - left - right) * Math.abs(Number(item.value))) / maximum);
    ctx.fillStyle = Number(item.value) >= 0 ? CHART_COLORS[index % CHART_COLORS.length] : "#ff777d";
    ctx.fillRect(left, y, barWidth, barHeight);
    ctx.fillStyle = "#aeb9c7";
    ctx.fillText(`${Number(item.value) > 0 ? "+" : ""}${Number(item.value).toFixed(2)}${suffix}`, Math.min(left + barWidth + 6, width - 45), y + barHeight - 3);
  });
}

function latestByTeam() {
  return new Map(appState.latest.map(row => [String(row.item_id), row]));
}

function renderFindings() {
  const snapshots = groupByDate(appState.history).map(([day, rows]) => [day, rankedTeams(rows)]);
  const latestRanked = rankedTeams(appState.latest);
  const first = snapshots[0]?.[1] ?? [];
  const firstMap = new Map(first.map(row => [String(row.item_id), row]));
  const changes = appState.latest.map(row => {
    const starting = firstMap.get(String(row.item_id));
    return starting ? { item: row.item, value: (Number(row.win_pct) - Number(starting.win_pct)) * 100 } : null;
  }).filter(Boolean).sort((a, b) => b.value - a.value);
  if (changes.length) {
    const best = changes[0], low = changes.at(-1);
    const bestText = best.value > 0
      ? `${best.item} has gained ${signed(best.value, 2)} percentage points in win percentage since ${snapshots[0][0]}.`
      : best.value < 0
        ? `${best.item} has the smallest decline at ${signed(best.value, 2)} percentage points since ${snapshots[0][0]}; no team has a net gain.`
        : low.value < 0
          ? `${best.item} is unchanged since the opening snapshot on ${snapshots[0][0]}; no team has a net gain.`
          : `No team has changed its win percentage since the opening snapshot on ${snapshots[0][0]}.`;
    const lowText = low.value < 0 ? `${low.item} is down ${Math.abs(low.value).toFixed(2)} points.` : "No tracked team has a net decline from its opening snapshot.";
    setText("finding-1-copy", `${bestText} Change is latest win% minus each team’s first recorded win%. ${lowText}`);
    drawBars(document.getElementById("finding-1-chart"), changes.slice(0, 5));
  } else {
    setText("finding-1-copy", "A season comparison will appear after the first successful snapshot.");
    drawBars(document.getElementById("finding-1-chart"), []);
  }

  const daily = [];
  for (let index = 1; index < snapshots.length; index += 1) {
    const [priorDate, priorRows] = snapshots[index - 1];
    const [date, rows] = snapshots[index];
    const priorMap = new Map(priorRows.map(row => [String(row.item_id), row]));
    rows.forEach(row => {
      const old = priorMap.get(String(row.item_id));
      if (!old) return;
      daily.push({ item: row.item, date, value: (Number(row.win_pct) - Number(old.win_pct)) * 100, priorDate });
    });
  }
  daily.sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.date.localeCompare(b.date));
  if (daily.length) {
    const top = daily[0];
    setText("finding-2-copy", `${top.item} moved ${signed(top.value, 2)} percentage points from ${top.priorDate} to ${top.date}, the largest single-step change in the archive. Each adjacent successful snapshot is compared team by team.`);
    drawBars(document.getElementById("finding-2-chart"), daily.slice(0, 5).map(item => ({ label: `${item.item} · ${item.date.slice(5)}`, value: item.value })));
  } else {
    setText("finding-2-copy", "A day-to-day comparison will appear after two successful snapshots.");
    drawBars(document.getElementById("finding-2-chart"), []);
  }

  const bestDiff = [...appState.latest].sort((a, b) => Number(b.point_diff_pg) - Number(a.point_diff_pg));
  if (bestDiff.length) {
    const leader = bestDiff[0];
    setText("finding-3-copy", `${leader.item} leads the current field at ${signed(leader.point_diff_pg)} points per game. Point differential is points scored per game minus opponent points per game in the latest snapshot.`);
    drawBars(document.getElementById("finding-3-chart"), bestDiff.slice(0, 5).map(row => ({ label: row.item, value: row.point_diff_pg })), "");
  } else {
    setText("finding-3-copy", "Point differential leaders will appear after the first successful snapshot.");
    drawBars(document.getElementById("finding-3-chart"), []);
  }

  const conferenceValues = [...new Set(latestRanked.map(row => row.conference))].sort().map(conference => {
    const rows = latestRanked.filter(row => row.conference === conference).sort((a, b) => Number(a.rank) - Number(b.rank));
    if (rows.length < 10) return null;
    const gap = (Number(rows[0].win_pct) - Number(rows[9].win_pct)) * 100;
    return { label: conference, value: gap, leader: rows[0].item, tenth: rows[9].item };
  }).filter(Boolean);
  if (conferenceValues.length) {
    setText("finding-4-copy", conferenceValues.map(item => `${item.label}: ${item.value.toFixed(2)} percentage points from ${item.leader} (1st) to ${item.tenth} (10th). The gap uses conference rank and the current win percentages.`).join(" "));
    drawBars(document.getElementById("finding-4-chart"), conferenceValues);
  } else {
    setText("finding-4-copy", "The conference race comparison will appear after the first successful snapshot.");
    drawBars(document.getElementById("finding-4-chart"), []);
  }
}

function renderTrends() {
  const snapshots = groupByDate(appState.history).map(([day, rows]) => [day, rankedTeams(rows)]);
  const dates = snapshots.map(([day]) => day);
  setText("history-date-count", `${dates.length} successful ${dates.length === 1 ? "date" : "dates"}`);
  const teams = rankedTeams(appState.latest);
  const teamFilterList = document.getElementById("team-filter-list");
  const teamSearch = document.getElementById("team-search");
  const clearTeamFilter = document.getElementById("clear-team-filter");
  const selectAllTeams = document.getElementById("select-all-teams");
  if (!teamFilterList) return;
  teamFilterList.innerHTML = "";
  teams.forEach(team => {
    const label = document.createElement("label");
    label.className = "team-filter-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(team.item_id);
    checkbox.checked = true;
    checkbox.setAttribute("aria-label", `Include ${team.item} in the graph`);
    const name = document.createElement("span");
    name.textContent = team.item;
    label.append(checkbox, name);
    teamFilterList.append(label);
  });
  const metricSelect = document.getElementById("metric-select");
  const labels = { win_pct: "Winning percentage", wins: "Wins", losses: "Losses", rank: "League rank", points_for_pg: "Points per game", points_against_pg: "Opponent points per game", point_diff_pg: "Point differential per game", games_back: "Games back" };
  function drawHistory() {
    const metric = metricSelect?.value || "win_pct";
    const selected = [...teamFilterList.querySelectorAll("input:checked")].map(input => input.value);
    const labelsById = new Map(teams.map(row => [String(row.item_id), row.item]));
    const ranksById = new Map(teams.map(row => [String(row.item_id), row.rank]));
    const series = selected.map(id => ({
      name: labelsById.get(id) ?? id,
      rank: ranksById.get(id) ?? 31,
      color: teamChartColor(labelsById.get(id), id),
      values: snapshots.map(([, rows]) => {
        const row = rows.find(entry => String(entry.item_id) === id);
        const value = row ? Number(row[metric]) : NaN;
        return Number.isFinite(value) ? value : NaN;
      })
    }));
    const isSingleSnapshot = dates.length === 1 && selected.length > 0;
    setText("history-chart-title", isSingleSnapshot ? `${labels[metric]} · ${dates[0]} snapshot` : `${labels[metric]} over time`);
    const chartMessage = !dates.length
      ? "Waiting for the first successful snapshot."
      : !selected.length
        ? "Choose one or more teams in the filter above."
        : "No values are available for this selection.";
    const chart = document.getElementById("history-chart");
    const chartWrap = chart?.parentElement;
    if (chartWrap) {
      chartWrap.style.height = isSingleSnapshot ? `${Math.max(200, series.length * 22 + 74)}px` : "";
    }
    if (isSingleSnapshot) drawSnapshotChart(chart, series, metric, labels[metric], chartMessage);
    else drawLineChart(chart, dates, series, metric, labels[metric], chartMessage);
    const filterCount = document.getElementById("team-filter-count");
    if (filterCount) filterCount.textContent = `${selected.length} of ${teams.length} teams selected`;
    const chartStatus = !selected.length
      ? "No teams selected. Choose teams above to show their values."
      : dates.length === 1
        ? metric === "rank"
          ? "One successful date is saved. Dots use team colors, with rank 30 on the left and rank 1 on the right. Trends over time will appear as daily snapshots accumulate."
          : `One successful date is saved. Dots use team colors; teams are ordered by league rank, and the horizontal scale shows ${labels[metric].toLowerCase()}. Trends over time will appear as daily snapshots accumulate.`
        : `${dates.length} daily snapshots are available. The horizontal axis shows snapshot date; the vertical axis shows ${labels[metric].toLowerCase()}.`;
    setText("chart-status", chartStatus);
    if (chart) chart.setAttribute("aria-label", isSingleSnapshot
      ? `${labels[metric]} for ${selected.length} selected teams on ${dates[0]}, teams ordered by league rank`
      : `${labels[metric]} by snapshot date for ${selected.length} selected teams`);
    const legend = document.getElementById("history-legend");
    if (legend) legend.innerHTML = isSingleSnapshot ? "" : series.map(item => `<span class="legend-item"><i class="legend-dot" style="background:${item.color}"></i>${escapeHTML(item.name)}</span>`).join("");
  }
  metricSelect?.addEventListener("change", drawHistory);
  teamFilterList.addEventListener("change", event => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    drawHistory();
  });
  teamSearch?.addEventListener("input", () => {
    const query = teamSearch.value.trim().toLocaleLowerCase();
    teamFilterList.querySelectorAll(".team-filter-option").forEach(option => {
      option.hidden = !option.textContent.toLocaleLowerCase().includes(query);
    });
  });
  clearTeamFilter?.addEventListener("click", () => {
    teamFilterList.querySelectorAll("input:checked").forEach(input => { input.checked = false; });
    drawHistory();
  });
  selectAllTeams?.addEventListener("click", () => {
    teamFilterList.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = true; });
    drawHistory();
  });
  appState.redrawHistory = drawHistory;
  drawHistory();
  renderFindings();
}

function renderDataError(error) {
  document.querySelectorAll("tbody").forEach(body => { body.innerHTML = `<tr><td colspan="12" class="loading-cell">Data unavailable: ${escapeHTML(error.message)}.</td></tr>`; });
  document.querySelectorAll(".movers-list").forEach(list => { list.innerHTML = `<p class="muted">${escapeHTML(error.message)}.</p>`; });
  ["snapshot-date", "source-status", "snapshot-time"].forEach(id => setText(id, "Data unavailable"));
  ["finding-1-copy", "finding-2-copy", "finding-3-copy", "finding-4-copy"].forEach(id => setText(id, "The history file could not be loaded. Reconnect to the network and reload the page."));
}

async function init() {
  setText("footer-year", String(new Date().getFullYear()));
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    try {
      await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;
    } catch { /* The pages can still load normally when service workers are unavailable. */ }
  }
  try {
    await loadData();
    if (document.body.dataset.page === "today") renderToday();
    if (document.body.dataset.page === "browse") renderBrowse();
    if (document.body.dataset.page === "trends") renderTrends();
  } catch (error) { renderDataError(error); }
}

init();
window.addEventListener("resize", () => {
  if (document.body.dataset.page === "trends") appState.redrawHistory?.();
});

