# cygaz-ai MCP Server

MCP server for Cyprus fuel prices and district mapping.

It provides:

1. Natural language routing for user questions.
2. Station search, ranking, and nearby lookups.
3. District lookup and area mapping.
4. Cache status, cache snapshots, and response profile tools.

## Features

1. Strict schema validation with Zod for prices and districts payloads.
2. Local cache for prices and districts under `.cygaz-cache`.
3. Routing layer (`cygaz_ask`, `cygaz_route`) for natural language questions.
4. Station responses now include full available station fields, including GPS coordinates.
5. Tools for cache introspection and data quality profiling.

## Available Copilot Skills

1. `coding-style`
    - Description: Apply repository coding style and formatting conventions for TypeScript changes.
    - Source: `.github/skills/coding-style/SKILL.md`

## Requirements

1. Node.js 20+.
2. npm.
3. RapidAPI key for cygaz.

## Environment Variables

Create a `.env` file in the project root:

```env
CYGAZ_RAPIDAPI_KEY=your_key_here
CYGAZ_RAPIDAPI_HOST=cygaz.p.rapidapi.com
CYGAZ_PRICES_URL=https://cygaz.p.rapidapi.com/prices
CYGAZ_DISTRICTS_URL=https://cygaz.p.rapidapi.com/districts
```

`CYGAZ_RAPIDAPI_KEY` is required.

## Install

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build And Start

```bash
npm run build
npm start
```

## Tests

```bash
npm test
```

## MCP Tools

### Routing

1. `cygaz_ask`: Answer a natural-language question by routing to the matching behavior.
2. `cygaz_route`: Return detected intent and inferred parameters.

### Prices Cache And Metadata

1. `prices_refresh`: Pull latest prices and update local cache.
2. `prices_status`: Show current cache status and summary.
3. `prices_cache_list`: List cached prices snapshots with counts and file metadata.
4. `prices_cache_get`: Load a prices snapshot by `cacheKey` or latest.
5. `prices_response_profile`: Show station field coverage and GPS coverage.
6. `prices_raw`: Return raw cached prices payload (optionally one region).
7. `prices_regions`: List region-level station counts and offline counts.

### Prices Query Tools

1. `prices_search`: Search by text, district, region, brand, company, area, fuel, or offline state.
2. `prices_station_lookup`: Focused station search for a query.
3. `prices_cheapest`: Cheapest stations for a fuel id.
4. `prices_most_expensive`: Most expensive stations for a fuel id.
5. `prices_nearby`: Nearby stations from GPS coordinates.
6. `prices_summary`: Aggregate counts and fuel stats.

### Districts Cache And Metadata

1. `districts_refresh`: Pull latest districts map and cache it.
2. `districts_status`: Show districts cache status.
3. `districts_cache_list`: List district cache snapshots with counts and file metadata.
4. `districts_cache_get`: Load a district snapshot by `cacheKey` or latest.
5. `districts_response_profile`: Show district/area field coverage and sample payload.

### Districts Query Tools

1. `districts_list`: List districts and areas.
2. `districts_lookup`: Find district by district or area name.
3. `districts_area_count`: Return area count for a district query (alias-aware).
4. `districts_area_map`: Return area to district mapping.

### Utility

1. `echo`: Basic connectivity and transport test.

## Example Questions

1. What are the cheapest stations near me for Unlead 95?
2. Which stations are within 10 km and currently online?
3. Which district does Agia Napa belong to?
4. Which areas belong to Famagusta district?
5. Compare cheapest Unlead 95 across Famagusta and Larnaca.
6. Show nearby stations inside Larnaca district.
7. Give me station details including coordinates for diesel in Kiti.
8. Show cache snapshots and latest update times.

## Cache Layout

1. Prices snapshots: `.cygaz-cache/prices/{updated_at}.json`.
2. District snapshots: `.cygaz-cache/districts/{cache_key}.json`.
3. Latest shortcuts: `.cygaz-cache/prices/latest.json` and `.cygaz-cache/districts/latest.json`.

## Inspector Quick Start

1. Build:

```bash
npm run build
```

2. Launch Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/server.js
```

3. Verify with `echo`:

```json
{
    "message": "hello"
}
```
