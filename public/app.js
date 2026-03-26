const state = {
  events: [],
  summary: null,
  filter: "",
  loadingEvents: false,
  loadingSummary: false,
};

const elements = {
  yearSelect: document.querySelector("#year-select"),
  eventSelect: document.querySelector("#event-select"),
  refreshButton: document.querySelector("#refresh-button"),
  statusBanner: document.querySelector("#status-banner"),
  summary: document.querySelector("#event-summary"),
  tableSubtitle: document.querySelector("#table-subtitle"),
  tableBody: document.querySelector("#teams-table-body"),
  teamFilter: document.querySelector("#team-filter"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function currentSeasonYear() {
  return new Date().getFullYear();
}

function buildSeasonOptions() {
  const year = currentSeasonYear();
  const seasons = [];

  for (let season = year; season >= Math.max(2024, year - 4); season -= 1) {
    seasons.push(season);
  }

  elements.yearSelect.innerHTML = seasons
    .map((season) => `<option value="${season}">${season}</option>`)
    .join("");
}

function setStatus(message, type = "") {
  elements.statusBanner.textContent = message;
  elements.statusBanner.className = `status-banner ${type}`.trim();
}

function formatDateRange(startDate, endDate) {
  if (!startDate) {
    return "Date unavailable";
  }

  const start = new Date(`${startDate}T12:00:00`);
  const end = endDate ? new Date(`${endDate}T12:00:00`) : start;
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  const year = start.getFullYear();

  if (startDate === endDate) {
    return `${formatter.format(start)}, ${year}`;
  }

  if (start.getMonth() === end.getMonth()) {
    return `${formatter.format(start)}-${end.getDate()}, ${year}`;
  }

  return `${formatter.format(start)} - ${formatter.format(end)}, ${year}`;
}

function formatEventOption(event) {
  const city = event.city || event.state_prov || "California";
  return `${event.name} (${city})`;
}

function buildSummaryCards(summary) {
  const cards = [
    { label: "Selected Event", value: summary.event.name, long: true },
    { label: "Event Dates", value: formatDateRange(summary.event.start_date, summary.event.end_date) },
    { label: "Teams Loaded", value: String(summary.teams.length) },
    { label: "District Rankings Found", value: String(summary.teams.filter((team) => team.ca_rank !== null).length) },
  ];

  elements.summary.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <span class="label">${card.label}</span>
          <span class="value ${card.long ? "long" : ""}">${escapeHtml(card.value)}</span>
        </article>
      `,
    )
    .join("");
}

function renderTable() {
  if (!state.summary) {
    elements.tableBody.innerHTML =
      '<tr><td colspan="4" class="empty-state">Event data will appear here.</td></tr>';
    return;
  }

  const filter = state.filter.trim().toLowerCase();
  const teams = state.summary.teams.filter((team) => {
    if (!filter) {
      return true;
    }

    const haystack = `${team.team_number} ${team.nickname || ""}`.toLowerCase();
    return haystack.includes(filter);
  });

  if (!teams.length) {
    elements.tableBody.innerHTML =
      '<tr><td colspan="4" class="empty-state">No teams match the current filter.</td></tr>';
    return;
  }

  elements.tableBody.innerHTML = teams
    .map((team) => {
      const previous = team.previous_ca_event;
      const previousEventName = previous?.name || "No earlier CA event found";
      const previousDetail =
        previous && previous.rank !== null
          ? `<span class="previous-rank">${previous.rank} / ${previous.team_count}</span>`
          : '<span class="muted">No ranking available</span>';

      return `
        <tr>
          <td>
            <span class="team-id">#${escapeHtml(team.team_number)} ${escapeHtml(team.nickname || "Unknown Team")}</span>
            <span class="team-meta">${escapeHtml(team.city || "")}${team.city && team.state_prov ? ", " : ""}${escapeHtml(team.state_prov || "")}</span>
          </td>
          <td>
            <span class="rank-pill ${team.ca_rank === null ? "unranked" : ""}">
              ${team.ca_rank === null ? "N/A" : `#${team.ca_rank}`}
            </span>
          </td>
          <td>${escapeHtml(previousEventName)}</td>
          <td>${previousDetail}</td>
        </tr>
      `;
    })
    .join("");
}

function renderSummary() {
  if (!state.summary) {
    elements.summary.innerHTML = "";
    elements.tableSubtitle.textContent = "Choose an event to load team performance details.";
    renderTable();
    return;
  }

  buildSummaryCards(state.summary);
  elements.tableSubtitle.textContent = `Showing ${state.summary.teams.length} teams for ${state.summary.event.name}.`;
  renderTable();
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

async function loadEvents() {
  const year = elements.yearSelect.value;
  state.loadingEvents = true;
  elements.yearSelect.disabled = true;
  elements.eventSelect.disabled = true;
  elements.refreshButton.disabled = true;
  setStatus("Loading California district events...");

  try {
    const payload = await fetchJson(`/api/tba?mode=events&year=${year}`);
    state.events = payload.events || [];

    if (!state.events.length) {
      elements.eventSelect.innerHTML = '<option value="">No California district events found</option>';
      state.summary = null;
      renderSummary();
      setStatus(`No California district events were returned for ${year}.`);
      return;
    }

    elements.eventSelect.innerHTML = state.events
      .map((event) => `<option value="${escapeHtml(event.key)}">${escapeHtml(formatEventOption(event))}</option>`)
      .join("");
    elements.eventSelect.disabled = false;

    setStatus(`Loaded ${state.events.length} California district events for ${year}.`);
    await loadEventSummary();
  } catch (error) {
    state.summary = null;
    renderSummary();
    elements.eventSelect.innerHTML = '<option value="">Unable to load events</option>';
    setStatus(error.message, "error");
  } finally {
    state.loadingEvents = false;
    elements.yearSelect.disabled = false;
    elements.refreshButton.disabled = false;
  }
}

async function loadEventSummary() {
  const eventKey = elements.eventSelect.value;

  if (!eventKey) {
    state.summary = null;
    renderSummary();
    return;
  }

  state.loadingSummary = true;
  elements.yearSelect.disabled = true;
  elements.eventSelect.disabled = true;
  elements.refreshButton.disabled = true;
  setStatus("Pulling teams, district rankings, and previous California results...");

  try {
    state.summary = await fetchJson(`/api/tba?mode=eventSummary&eventKey=${eventKey}`);
    renderSummary();
    setStatus(`Loaded ${state.summary.teams.length} teams for ${state.summary.event.name}.`);
  } catch (error) {
    state.summary = null;
    renderSummary();
    setStatus(error.message, "error");
  } finally {
    state.loadingSummary = false;
    elements.refreshButton.disabled = false;
    elements.yearSelect.disabled = false;
    elements.eventSelect.disabled = state.events.length === 0;
  }
}

function attachEventListeners() {
  elements.yearSelect.addEventListener("change", () => {
    state.filter = "";
    elements.teamFilter.value = "";
    loadEvents();
  });

  elements.eventSelect.addEventListener("change", () => {
    state.filter = "";
    elements.teamFilter.value = "";
    loadEventSummary();
  });

  elements.refreshButton.addEventListener("click", () => {
    if (state.loadingEvents || state.loadingSummary) {
      return;
    }

    if (state.summary) {
      loadEventSummary();
      return;
    }

    loadEvents();
  });

  elements.teamFilter.addEventListener("input", (event) => {
    state.filter = event.target.value;
    renderTable();
  });
}

function init() {
  buildSeasonOptions();
  attachEventListeners();
  loadEvents();
}

init();
