# NCAA API

Free API to return consumable data from ncaa.com.

Works with scores, stats, rankings, standings, schedules, brackets, history, logos, news, and game details (box score, play by play, scoring summary, team stats).

Try it out here: <https://ncaa-api.henrygd.me/openapi>

## Usage

Make a GET request using the same path as the URL on ncaa.com. You'll get a JSON response with the data.

You can test using the [demo API](https://ncaa-api.henrygd.me/openapi). [Host your own](#deployment) if you need it to be reliable long term.

> Note: The public API is limited to 5 requests per second per IP.

## Parameters

The following URL parameters are supported:

| Parameter | Description                 |
| --------- | --------------------------- |
| `page`    | Page number. Defaults to 1. |

## Routes

All routes can be tested here: <https://ncaa-api.henrygd.me/openapi>

### Scoreboard

Fetches live scores for a given sport, division, and date.

Website: <https://www.ncaa.com/scoreboard/football/fbs/2023/13/all-conf>

`GET /scoreboard/football/fbs/2023/13/all-conf`

### Stats

Website: <https://www.ncaa.com/stats/football/fbs/current/team/28>

`GET /stats/football/fbs/current/team/28`

Website: <https://www.ncaa.com/stats/football/fbs/current/individual/750>

`GET /stats/football/fbs/current/individual/750`

### Rankings

Website: <https://www.ncaa.com/rankings/football/fbs/associated-press>

`GET /rankings/football/fbs/associated-press`

### Standings

Website: <https://www.ncaa.com/standings/basketball-women/d1>

`GET /standings/basketball-women/d1`

### Game

Provides details of a single game.

Website: <https://www.ncaa.com/game/6305900>

- `GET /game/6305900` returns general information
- `GET /game/6305900/boxscore` returns box score
- `GET /game/6305900/play-by-play` returns play by play
- `GET /game/6305900/scoring-summary` returns scoring summary if available
- `GET /game/6305900/team-stats` returns team stats if available

### History

Website: <https://www.ncaa.com/history/bowling/nc>

`GET /history/bowling/nc`

### Schedule

Returns game dates for a given sport, division, and date range.

This is the only route that doesn't exactly match a website URL. The website doesn't have schedule pages, but the sport and division are consistent with other URLs.

It also requires different dates for different sports. Football uses YYYY, while basketball, hockey, and others use YYYY/MM.

`GET /schedule/basketball-men/d1/2023/02`

### Brackets

Tournament bracket for a given sport, division, and year, including live scores.

Like the official website, this endpoint does not include FBS football brackets prior to 2025.

Website: <https://www.ncaa.com/brackets/basketball-men/d1/2026>

`GET /brackets/basketball-men/d1/2026`

### News

News articles and videos for a given sport and division. Returns parsed RSS feed data in JSON format.

Website: <https://www.ncaa.com/news/basketball-men/d1/rss.xml>

`GET /news/basketball-men/d1`

### Schools Index

Returns a list of all schools.

Website: <https://www.ncaa.com/schools-index>

`GET /schools-index`

### Logos

Logos for all NCAA schools. Use the school `slug` or `team_seo` property.

- `GET /logo/michigan.svg`
- `GET /logo/michigan.svg?dark=true` returns a version of the logo that works better on dark backgrounds.

## Deployment

Use the included [docker-compose.yml](/docker-compose.yml) or run directly with Docker:

```bash
docker run --rm -p 3000:3000 henrygd/ncaa-api
```

The app should be available at [http://localhost:3000](http://localhost:3000/history/bowling/nc).

## Caching, Redis and failover

Responses are cached in-process (45s for scores/games, 30m for most other routes). When `REDIS_URL` is set the same entries are also written to Redis, so multiple instances and restarts share the cache, and a **last-known-good** copy of every response is kept for 7 days (`CACHE_LAST_GOOD_TTL_SECONDS`).

If ncaa.com (or another upstream) is down or timing out, a route whose fresh cache has expired returns the last-known-good copy with `200`, plus:

```
X-CLN-Stale: true
X-CLN-Data-Age: <seconds since it was fetched>
Warning: 110 - "Response is Stale"
```

Only when nothing was ever cached for that URL does the route return `502`. A per-host circuit breaker stops hammering an upstream after `UPSTREAM_BREAKER_THRESHOLD` (5) consecutive failures for `UPSTREAM_BREAKER_COOLDOWN_MS` (30s); while open, requests fail fast and are served from last-known-good.

Without `REDIS_URL` everything still works on a single instance: the last-known-good copies live in memory until the process restarts.

`GET /health` reports upstream counters, open circuits, and Redis connectivity; it returns `503` after 5 consecutive upstream failures.

### Railway setup

1. In the Railway project, **+ New → Database → Redis**.
2. On the `ncaa-api` service → **Variables → + New Variable → Add Reference**, pick the Redis service's `REDIS_URL` (Railway injects the private-network URL, e.g. `redis://default:...@redis.railway.internal:6379`).
3. Redeploy. `GET /health` should show `"cache": { "backend": "redis", "redisConnected": true, ... }`.
4. Optional: **Settings → Health Check Path** = `/health`.

## /v1 — normalized lacrosse API (website + mobile app)

`/v1` is the stable, versioned contract shared by collegelacrossenews.com and the mobile app. A background poller keeps it warm: every lacrosse board (men/women × D1/D2/D3) for today is refreshed on an adaptive interval (`POLL_LIVE_MS` 20s while games are live, `POLL_IDLE_MS` 2m otherwise, `POLL_OFFSEASON_MS` 15m July–December), live games get box score + team stats + play-by-play on every tick, and recent finals are re-pulled once for late stat corrections. Set `POLLER_ENABLED=false` to turn it off.

| Route | Returns |
|---|---|
| `GET /v1/games/:sport/:division[/:date]` | games on a board (`lacrosse-men`\|`lacrosse-women`, `d1`\|`d2`\|`d3`, `YYYY-MM-DD`, default today ET) |
| `GET /v1/live` | every game currently in progress across all boards |
| `GET /v1/game/:id` | one game: teams, score, status/clock/period, quarter-by-quarter linescore, venue, broadcast network, attendance |
| `GET /v1/game/:id/boxscore` | team + player lines: goals, assists, shots, SOG, GB, TO, CT, faceoffs, clears, saves, goals allowed, penalties, EMO |
| `GET /v1/game/:id/plays` | typed play-by-play (goal/shot/save/faceoff/clear/turnover/groundball/penalty/timeout/period) with scorer/assist parsed |
| `GET /v1/stream` | Server-Sent Events push of game changes (see below) |
| `GET /v1/status` | poller + service + stream counters |

Every response is `{ data, meta: { updatedAt, stale } }` with an `ETag` (send `If-None-Match` to get `304`), `Cache-Control: public, max-age=10` for live payloads / `60` otherwise, and the same `X-CLN-Stale` headers as the legacy routes when NCAA is unreachable and the stored copy is served.

**Accuracy notes.** Fields NCAA does not supply are `null` (attendance, network, venue are often missing). `linescoreSource` is `"ncaa"` or `"pbp"`: NCAA regularly publishes an all-zero linescore for finished lacrosse games, so when the published one doesn't sum to the final score it is rebuilt from goal events in the play-by-play. Likewise the box score's `derived` object says which of `faceoffs`, `saves`, `clears` were rebuilt from PBP (NCAA has no per-player faceoff or goalie lines for lacrosse and often reports `clears: 0`). Nothing is derived when there is no play-by-play.

### /v1/stream — real-time push (SSE)

`GET /v1/stream` is a `text/event-stream` that pushes a small event every time the poller sees a game change, so the website and app don't have to poll. Optional filters: `?sport=`, `?division=`, `?date=YYYY-MM-DD`, `?game=<id>` (any combination).

The first frame is `event: hello` with the current live games matching the filter and the latest event id. Then, as the poller persists changes:

| Event | When |
|---|---|
| `game.new` | a game is seen for the first time |
| `game.state` | `pre → live → final` (also postponed/canceled); carries `previousState` |
| `game.score` | a team's score went up; carries `scored: { side, by }` |
| `game.clock` | period or clock changed with no other change |
| `game.linescore` | quarter-by-quarter scoring changed; carries the new `linescore` |
| `game.details` | box score / play-by-play were refreshed for the game (re-fetch `/v1/game/:id/boxscore` or `/plays`) |

Every event carries `gameId`, `sport`, `division`, `date`, the current `status` and both teams' `id`/`name`/`score`. Frames have increasing `id`s; on reconnect the browser `EventSource` (or your client) sends `Last-Event-ID` and missed events are replayed from a ring buffer of the last `STREAM_BUFFER` (500) events. A comment heartbeat is sent every `STREAM_HEARTBEAT_MS` (15s) so proxies keep the connection open.

```js
const es = new EventSource("https://ncaa-api-production-1586.up.railway.app/v1/stream?sport=lacrosse-men&division=d1");
es.addEventListener("game.score", (e) => console.log(JSON.parse(e.data)));
```

The event bus is in-process: the poller and the API must run in the same service (they do on Railway).

### Postgres (durable store)

Games and details are persisted in Postgres when `DATABASE_URL` is set (schema is created automatically: `games`, `game_details`); otherwise they live in memory. On Railway: **+ New → Database → PostgreSQL**, then on `ncaa-api` **Variables → Add Reference → DATABASE_URL**. `GET /health` shows `"store": { "backend": "postgres", "reachable": true }`.

## Limiting Access

If you host your own instance, you may specify a custom header value to be present in all requests as a way to restrict access to the API.

To do this, set the `NCAA_HEADER_KEY` environment variable to the desired value and include the header `x-ncaa-key` in your requests. See the [docker-compose.yml](/docker-compose.yml) for an example.

## Development

This is an [ElysiaJS](https://elysiajs.com/) application. To start the development server run:

```bash
bun run dev
```

To run tests:

```bash
bun test
```

Contributions welcome.
