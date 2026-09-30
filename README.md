# Timeline MCP

An MCP server that lets an AI assistant answer questions about your Google Timeline: *"Where was I on 3 March?"*, *"When was I at the bakery in Meppel?"*, *"How far did I cycle last week?"*.

It reads a Timeline export, indexes it into SQLite, and serves it over MCP's streamable HTTP transport. Your data stays on your machine, except for the optional place lookups described below.

## Export your Timeline (Android)

Google Timeline data is stored on your phone, not in your Google account, so you export it from the device:

1. Open the **Settings** app → **Location** → **Location services** → **Timeline**.
   (Alternatively: Google Maps → your profile picture → **Your Timeline** → ⋮ → **Location & privacy settings**.)
2. Tap **Export Timeline data** and choose where to save the file.
3. Copy the resulting JSON file (e.g. `Timeline.json`, or `Tijdlijn.json` on a Dutch phone) to the machine that runs the server.

Menu names can differ slightly per Android version and manufacturer.

This server supports the **new on-device export format**: one JSON file with a top-level `semanticSegments` array. The older Google Takeout export (`Records.json`, `Semantic Location History/`) is not supported.

## Quick start (Docker)

```bash
docker build -t timeline-mcp .

docker run --rm -p 3000:3000 \
  -e TIMELINE_JSON_PATH=/data/Timeline.json \
  -e TIMELINE_DB_PATH=/data/state/timeline.db \
  -e TIMELINE_GEOCODER_USER_AGENT="timeline-mcp (you@example.com)" \
  -v "$PWD/Timeline.json:/data/Timeline.json:ro" \
  -v "$PWD/.timeline-data:/data/state" \
  timeline-mcp
```

The MCP endpoint is `http://localhost:3000/mcp`, and `http://localhost:3000/health` returns `ok`. Connect a client, for example:

```bash
claude mcp add --transport http timeline http://localhost:3000/mcp
```

The index is built on startup and rebuilt automatically when the export file has changed, so restart the server after replacing the file.

### Without Docker

Requires Node.js 22+.

```bash
npm install
TIMELINE_JSON_PATH=/path/to/Timeline.json TIMELINE_DB_PATH=/path/to/timeline.db npm run dev
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `TIMELINE_JSON_PATH` | *required* | Path to the Timeline export. |
| `TIMELINE_DB_PATH` | *required* | Path to the SQLite index (created if missing). |
| `TIMELINE_HTTP_HOST` | `0.0.0.0` | Address to listen on. |
| `TIMELINE_HTTP_PORT` | `3000` | Port to listen on. |
| `TIMELINE_ALIASES_PATH` | | Optional [aliases file](#aliases). |
| `TIMELINE_GEOCODER_USER_AGENT` | `timeline-mcp/0.1.0` | Identifies you to OpenStreetMap; set this to something with contact info. |
| `TIMELINE_GOOGLE_PLACES_API_KEY` | | Enables [place names](#place-names). |
| `TIMELINE_GOOGLE_PLACES_LANGUAGE` | Google's default | Language for place names and categories, e.g. `nl`. |
| `TIMELINE_GOOGLE_PLACES_REQUESTS_PER_MINUTE` | `60` | Pace of Google lookups. |
| `TIMELINE_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN`, or `ERROR`. Logs go to stderr. |
| `TIMELINE_LOG_FILE` | | Also append logs to this file. |

### Full Docker example

Every setting, with the export, aliases file, database, and log file on the host:

```bash
docker run -d --name timeline-mcp --restart unless-stopped \
  -p 3000:3000 \
  -e TIMELINE_JSON_PATH=/data/Timeline.json \
  -e TIMELINE_DB_PATH=/data/state/timeline.db \
  -e TIMELINE_HTTP_HOST=0.0.0.0 \
  -e TIMELINE_HTTP_PORT=3000 \
  -e TIMELINE_ALIASES_PATH=/data/aliases.json \
  -e TIMELINE_GEOCODER_USER_AGENT="timeline-mcp (you@example.com)" \
  -e TIMELINE_GOOGLE_PLACES_API_KEY=your-google-api-key \
  -e TIMELINE_GOOGLE_PLACES_LANGUAGE=nl \
  -e TIMELINE_GOOGLE_PLACES_REQUESTS_PER_MINUTE=60 \
  -e TIMELINE_LOG_LEVEL=INFO \
  -e TIMELINE_LOG_FILE=/data/state/timeline-mcp.log \
  -v "$PWD/Timeline.json:/data/Timeline.json:ro" \
  -v "$PWD/aliases.json:/data/aliases.json:ro" \
  -v "$PWD/.timeline-data:/data/state" \
  timeline-mcp
```

- Inside the container, keep `TIMELINE_HTTP_HOST=0.0.0.0`. If you change `TIMELINE_HTTP_PORT`, change the container side of `-p` to match, e.g. `-p 3000:4000`.
- `.timeline-data/` on the host holds the database and log file, so enrichment results survive container restarts.
- To avoid putting the API key in your shell history, use `--env-file timeline.env` with the same `NAME=value` lines instead of `-e`.

**Security:** the server has no authentication. By default it is reachable from your local network, so only run it on trusted networks. To allow only the local machine, publish the port as `-p 127.0.0.1:3000:3000` in Docker, or set `TIMELINE_HTTP_HOST=127.0.0.1` when running without Docker.

## Tools

| Tool | What it does |
|---|---|
| `where_was_i_at` | Where you were at a given moment. |
| `where_was_i_between` | All visits and trips in a time range. |
| `summarize_day` | Visits, trips, and total distance for one day. |
| `how_did_i_travel` | Travel modes and distances in a time range. |
| `search_places` | Find places you have visited, with visit counts. |
| `when_was_i_at_place` | All visits to a place, optionally within a time range. |
| `enrich_places` | Look up names and addresses for visited places (see below). |

Resources: `timeline://stats`, `timeline://day/{date}`, and `timeline://segment/{id}`.

## Place names

The export only contains coordinates and Google place IDs (like `ChIJN1t_tDeuEmsRUsoyG83frY4`), not names. Run the `enrich_places` tool once after the first start, and again after importing a new export, to look them up:

- **OpenStreetMap** (free, always on): turns coordinates into an address, city, and country. Limited to 1 request per second, so the first run can take a while.
- **Google Places** (optional, set `TIMELINE_GOOGLE_PLACES_API_KEY`): turns place IDs into real names like "Albert Heijn", plus a category ("Supermarket"), address, and Google Maps link. The key needs **Places API (New)** enabled. Each lookup is billed as a Place Details (Pro) request.

Results are cached in the database, so each place is looked up only once. If Google rate-limits you, `enrich_places` stops, keeps what it has, and reports how many places are `remaining`. Run it again later to continue.

A visit is labelled using the first available of: your alias, Home/Work from Google, the Google place name, then the OpenStreetMap address.

## Searching places

`search_places` and `when_was_i_at_place` take a free-text query. A place matches when **every word** of the query appears somewhere in what is known about it: its name, address, postcode, city, category, or Google type. Partial words count, capitals and accents don't matter, and small words like *in*, *at*, *the*, *bij*, and *de* are ignored.

| Query | Finds |
|---|---|
| `Bakker in Meppel` | "Bakkerij Jansen, Hoofdstraat 1, Meppel", but not bakeries in other towns |
| `Meppel` | every place in Meppel |
| `bakery` | every place Google classifies as a bakery |
| `cafe` | "Café de Kroon" |

The assistant typically calls `search_places` first to see which places match and how often you went there. It then passes the chosen place's `placeKey` to `when_was_i_at_place` to get the dates.

Names and categories come from `enrich_places`, so run that first. With `TIMELINE_GOOGLE_PLACES_LANGUAGE=nl`, Dutch words like *bakker* and *supermarkt* work as well as English ones.

## Aliases

Optionally give places your own names with a JSON file set in `TIMELINE_ALIASES_PATH`:

```json
{
  "placeIds": {
    "ChIJN1t_tDeuEmsRUsoyG83frY4": "Favourite office"
  },
  "semanticTypes": {
    "WORK": "Office"
  }
}
```

## Development

```bash
npm test
npm run build
```

## License

[MIT](LICENSE)
