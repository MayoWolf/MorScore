const TBA_API_BASE = "https://www.thebluealliance.com/api/v3";
const DISTRICT_SUFFIX = "ca";
const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
};
const cache = new Map();

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(body),
  };
}

function getAuthKey() {
  return process.env.TBA_AUTH_KEY || process.env.X_TBA_AUTH_KEY || "";
}

function getDistrictKey(year) {
  return `${year}${DISTRICT_SUFFIX}`;
}

function getCacheTtlMs(headers) {
  const cacheControl = headers.get("cache-control");

  if (!cacheControl) {
    return 5 * 60 * 1000;
  }

  const maxAgePart = cacheControl
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.startsWith("max-age="));

  if (!maxAgePart) {
    return 5 * 60 * 1000;
  }

  const seconds = Number(maxAgePart.split("=")[1]);
  return Number.isFinite(seconds) ? seconds * 1000 : 5 * 60 * 1000;
}

async function tbaRequest(path) {
  const cached = cache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const authKey = getAuthKey();
  if (!authKey) {
    throw new Error("Missing TBA auth key. Set TBA_AUTH_KEY in Netlify environment variables.");
  }

  const response = await fetch(`${TBA_API_BASE}${path}`, {
    headers: {
      "X-TBA-Auth-Key": authKey,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    const error = new Error(`TBA request failed for ${path}: ${response.status} ${message}`);
    error.statusCode = response.status;
    throw error;
  }

  const data = await response.json();
  cache.set(path, {
    data,
    expiresAt: Date.now() + getCacheTtlMs(response.headers),
  });
  return data;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function sortByDate(events) {
  return [...events].sort((left, right) => {
    const leftDate = left.start_date || left.end_date || "";
    const rightDate = right.start_date || right.end_date || "";
    return leftDate.localeCompare(rightDate) || left.name.localeCompare(right.name);
  });
}

function parseRankingsPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.rankings)) {
    return payload.rankings;
  }

  return [];
}

function buildDistrictRankMap(rankings) {
  const rankMap = new Map();

  for (const item of rankings) {
    if (!item?.team_key) {
      continue;
    }

    const rank = Number(item.rank);
    rankMap.set(item.team_key, Number.isFinite(rank) ? rank : null);
  }

  return rankMap;
}

function buildEventRankMap(rankingsPayload) {
  const rankings = parseRankingsPayload(rankingsPayload);
  const rankMap = new Map();

  for (const item of rankings) {
    if (!item?.team_key) {
      continue;
    }

    const rank = Number(item.rank);
    rankMap.set(item.team_key, Number.isFinite(rank) ? rank : null);
  }

  return {
    rankMap,
    teamCount: rankings.length,
  };
}

function pickPreviousCaliforniaEvent(teamEvents, currentEvent) {
  const currentStart = currentEvent.start_date || currentEvent.end_date;
  const previousEvents = sortByDate(teamEvents)
    .filter((event) => {
      if (!event?.key || event.key === currentEvent.key) {
        return false;
      }

      if (event.state_prov !== "California") {
        return false;
      }

      if (!currentStart) {
        return false;
      }

      const eventEnd = event.end_date || event.start_date;
      return Boolean(eventEnd) && eventEnd < currentStart;
    });

  return previousEvents[previousEvents.length - 1] || null;
}

function buildTeamRecord(team, districtRankMap, previousEventMap) {
  const previous = previousEventMap.get(team.key) || null;

  return {
    key: team.key,
    team_number: team.team_number,
    nickname: team.nickname || "",
    city: team.city || "",
    state_prov: team.state_prov || "",
    ca_rank: districtRankMap.get(team.key) ?? null,
    previous_ca_event: previous,
  };
}

async function getCaliforniaDistrictEvents(year) {
  const districtKey = getDistrictKey(year);
  try {
    const events = await tbaRequest(`/district/${districtKey}/events/simple`);
    return sortByDate(events);
  } catch (error) {
    if (error.statusCode === 404) {
      return [];
    }

    throw error;
  }
}

async function buildEventSummary(eventKey) {
  const event = await tbaRequest(`/event/${eventKey}/simple`);
  const districtKey = getDistrictKey(event.year);

  const [teams, districtRankings] = await Promise.all([
    tbaRequest(`/event/${eventKey}/teams/simple`),
    tbaRequest(`/district/${districtKey}/rankings`).catch((error) => {
      if (error.statusCode === 404) {
        return [];
      }

      throw error;
    }),
  ]);

  const districtRankMap = buildDistrictRankMap(parseRankingsPayload(districtRankings));
  const teamEvents = await mapWithConcurrency(teams, 8, async (team) => {
    const events = await tbaRequest(`/team/${team.key}/events/${event.year}/simple`);
    return {
      teamKey: team.key,
      previousEvent: pickPreviousCaliforniaEvent(events, event),
    };
  });

  const previousEventKeys = [...new Set(teamEvents.map((item) => item.previousEvent?.key).filter(Boolean))];
  const previousEventRankings = await mapWithConcurrency(previousEventKeys, 6, async (previousEventKey) => {
    try {
      return {
        eventKey: previousEventKey,
        rankings: buildEventRankMap(await tbaRequest(`/event/${previousEventKey}/rankings`)),
      };
    } catch (error) {
      if (error.statusCode === 404) {
        return {
          eventKey: previousEventKey,
          rankings: {
            rankMap: new Map(),
            teamCount: null,
          },
        };
      }

      throw error;
    }
  });

  const previousEventRankingMap = new Map(
    previousEventRankings.map((item) => [item.eventKey, item.rankings]),
  );

  const previousEventMap = new Map();
  for (const item of teamEvents) {
    if (!item.previousEvent) {
      previousEventMap.set(item.teamKey, null);
      continue;
    }

    const rankingDetails = previousEventRankingMap.get(item.previousEvent.key);
    const teamRank = rankingDetails?.rankMap.get(item.teamKey) ?? null;

    previousEventMap.set(item.teamKey, {
      key: item.previousEvent.key,
      name: item.previousEvent.name,
      rank: teamRank,
      team_count: rankingDetails?.teamCount ?? null,
    });
  }

  const summaryTeams = [...teams]
    .map((team) => buildTeamRecord(team, districtRankMap, previousEventMap))
    .sort((left, right) => {
      if (left.ca_rank === null && right.ca_rank === null) {
        return left.team_number - right.team_number;
      }

      if (left.ca_rank === null) {
        return 1;
      }

      if (right.ca_rank === null) {
        return -1;
      }

      return left.ca_rank - right.ca_rank || left.team_number - right.team_number;
    });

  return {
    event: {
      key: event.key,
      name: event.name,
      start_date: event.start_date,
      end_date: event.end_date,
      city: event.city || "",
      state_prov: event.state_prov || "",
    },
    teams: summaryTeams,
  };
}

exports.handler = async function handler(event) {
  try {
    const url = new URL(event.rawUrl);
    const mode = url.searchParams.get("mode");

    if (mode === "events") {
      const year = Number(url.searchParams.get("year"));

      if (!Number.isInteger(year) || year < 1992) {
        return jsonResponse(400, { error: "A valid season year is required." });
      }

      const events = await getCaliforniaDistrictEvents(year);
      return jsonResponse(200, { events });
    }

    if (mode === "eventSummary") {
      const eventKey = url.searchParams.get("eventKey");

      if (!eventKey) {
        return jsonResponse(400, { error: "An eventKey query parameter is required." });
      }

      const summary = await buildEventSummary(eventKey);
      return jsonResponse(200, summary);
    }

    return jsonResponse(400, { error: "Unsupported mode. Use mode=events or mode=eventSummary." });
  } catch (error) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return jsonResponse(500, {
        error: "TBA rejected the auth key. Verify TBA_AUTH_KEY in Netlify environment variables.",
      });
    }

    return jsonResponse(500, { error: error.message || "Unexpected server error." });
  }
};
