// @ts-nocheck
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
    buildStationResponseProfile,
    buildCacheOverview,
    buildCheapestResults,
    buildNearbyResults,
    buildMostExpensiveResults,
    buildRawData,
    buildRegionList,
    buildSearchResults,
    buildSummary,
    getPricesData,
    listPriceCacheSnapshots,
    loadCachedPricesByKey,
    loadCachedPrices,
    refreshPrices,
} from "./prices.js";
import { routeQuestion } from "./router.js";
import {
    buildDistrictAreaCount,
    buildDistrictAreaLookup,
    buildDistrictDetails,
    buildDistrictList,
    buildDistrictResponseProfile,
    cachedDistrictsSchema,
    createDistrictResolver,
    getDistrictsData,
    listDistrictCacheSnapshots,
    loadCachedDistrictsByKey,
    loadCachedDistricts,
    refreshDistricts,
} from "./districts.js";

const server = new McpServer({
    name: "cygaz-ai",
    version: "0.1.0",
});

const logPrefix = "[cygaz-ai]";

function logServerEvent(message: string, details?: unknown): void {
    if (details === undefined) {
        console.error(`${logPrefix} ${message}`);
        return;
    }

    console.error(`${logPrefix} ${message}`, details);
}

function toTextResponse(payload: unknown) {
    return {
        content: [
            {
                type: "text" as const,
                text: JSON.stringify(payload, null, 2),
            },
        ],
    };
}

async function loadPriceAndDistrictData(refresh?: boolean) {
    const [prices, districts] = await Promise.all([
        getPricesData({ refresh }),
        getDistrictsData({ refresh }),
    ]);

    return { prices, districts };
}

function withToolLogging(
    toolName: string,
    handler: (...args: any[]) => Promise<any>,
): (options: any, extra: any) => Promise<any> {
    return async (options: any, extra: any) => {
        const startedAt = Date.now();

        logServerEvent(`tool ${toolName} start`, options);

        try {
            const result = await handler(options, extra);

            logServerEvent(`tool ${toolName} done`, {
                durationMs: Date.now() - startedAt,
            });

            return result;
        } catch (error) {
            logServerEvent(`tool ${toolName} failed`, {
                durationMs: Date.now() - startedAt,
                error:
                    error instanceof Error ? error.message : String(error),
            });

            throw error;
        }
    };
}

function registerLoggedTool(...args: any[]): void {
    const [name, description, inputSchema, handler] = args;
    const registerTool = (server as any).registerTool.bind(server);
    const loggedHandler: any = withToolLogging(name, handler);

    registerTool(name, { description, inputSchema }, loggedHandler);
}

registerLoggedTool(
    "cygaz_ask",
    "Answer a natural-language question about prices, stations, districts, nearby stations, or summaries",
    {
        query: z.string(),
        latitude: z.coerce.number().optional(),
        longitude: z.coerce.number().optional(),
        radiusKm: z.coerce.number().positive().max(250).optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
        refresh: z.boolean().optional(),
    },
    async (options) => {
        const { prices, districts } = await loadPriceAndDistrictData(
            options.refresh,
        );

        return toTextResponse(
            routeQuestion(
                { prices, districts },
                {
                    query: options.query,
                    latitude: options.latitude,
                    longitude: options.longitude,
                    radiusKm: options.radiusKm,
                    limit: options.limit,
                    refresh: options.refresh,
                },
            ),
        );
    },
);

registerLoggedTool(
    "cygaz_route",
    "Return the detected intent and inferred parameters for a natural-language question",
    {
        query: z.string(),
        latitude: z.coerce.number().optional(),
        longitude: z.coerce.number().optional(),
        radiusKm: z.coerce.number().positive().max(250).optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
        refresh: z.boolean().optional(),
    },
    async (options) => {
        const { prices, districts } = await loadPriceAndDistrictData(
            options.refresh,
        );

        return toTextResponse(
            routeQuestion(
                { prices, districts },
                {
                    query: options.query,
                    latitude: options.latitude,
                    longitude: options.longitude,
                    radiusKm: options.radiusKm,
                    limit: options.limit,
                    refresh: options.refresh,
                },
            ),
        );
    },
);

registerLoggedTool(
    "echo",
    "Echo back a message",
    {
        message: z.string().describe("Text to echo back."),
    },
    async ({ message }) => {
        return {
            content: [
                {
                    type: "text",
                    text: `echo: ${message}`,
                },
            ],
        };
    },
);

registerLoggedTool(
    "prices_refresh",
    "Download the latest prices and update the local cache",
    {},
    async () => toTextResponse(buildCacheOverview(await refreshPrices())),
);

registerLoggedTool(
    "prices_status",
    "Inspect the local cache status",
    {},
    async () => {
        const cachedPrices = await loadCachedPrices();

        if (!cachedPrices) {
            return toTextResponse({ cached: false });
        }

        return toTextResponse({
            cached: true,
            ...buildCacheOverview(cachedPrices),
        });
    },
);

registerLoggedTool(
    "prices_cache_list",
    "List available cached prices snapshots with timestamps and counts",
    {
        limit: z.coerce.number().int().positive().max(200).default(20),
    },
    async ({ limit }) =>
        toTextResponse({ snapshots: await listPriceCacheSnapshots(limit) }),
);

registerLoggedTool(
    "prices_cache_get",
    "Load a cached prices snapshot by cache key, or latest when omitted",
    {
        cacheKey: z.string().optional(),
        region: z.string().optional(),
    },
    async ({ cacheKey, region }) => {
        const data = cacheKey
            ? await loadCachedPricesByKey(cacheKey)
            : await loadCachedPrices();

        if (!data) {
            return toTextResponse({
                found: false,
                cache_key: cacheKey ?? "latest",
            });
        }

        return toTextResponse({
            found: true,
            cache_key: data.cache_key,
            data: buildRawData(data, { region }),
        });
    },
);

registerLoggedTool(
    "prices_response_profile",
    "Summarize available station fields and GPS coordinate coverage in cached prices data",
    {
        cacheKey: z.string().optional(),
        refresh: z.boolean().optional(),
    },
    async ({ cacheKey, refresh }) => {
        const data = cacheKey
            ? await loadCachedPricesByKey(cacheKey)
            : await getPricesData({ refresh });

        if (!data) {
            return toTextResponse({
                found: false,
                cache_key: cacheKey ?? "latest",
            });
        }

        return toTextResponse({
            found: true,
            ...buildStationResponseProfile(data),
        });
    },
);

registerLoggedTool(
    "prices_regions",
    "List regions, counts, and offline totals",
    { refresh: z.boolean().optional() },
    async ({ refresh }) => {
        const data = await getPricesData({ refresh });
        return toTextResponse({
            cache_key: data.cache_key,
            cached_at: data.cached_at,
            updated_at: data.updated_at,
            updated_at_str: data.updated_at_str,
            regions: buildRegionList(data),
        });
    },
);

registerLoggedTool(
    "districts_refresh",
    "Download the latest district map and update the local cache",
    {},
    async () => {
        const data = await refreshDistricts();

        return toTextResponse({
            cache_key: data.cache_key,
            cached_at: data.cached_at,
            source_url: data.source_url,
            districts: buildDistrictList(data.districts),
        });
    },
);

registerLoggedTool(
    "districts_status",
    "Inspect the local district cache status",
    {},
    async () => {
        const cachedDistricts = await loadCachedDistricts();

        if (!cachedDistricts) {
            return toTextResponse({ cached: false });
        }

        return toTextResponse({
            cached: true,
            cache_key: cachedDistricts.cache_key,
            cached_at: cachedDistricts.cached_at,
            source_url: cachedDistricts.source_url,
            district_count: cachedDistricts.districts.length,
            area_count: cachedDistricts.districts.reduce(
                (sum, district) => sum + district.areas.length,
                0,
            ),
        });
    },
);

registerLoggedTool(
    "districts_cache_list",
    "List available district cache snapshots with district and area counts",
    {
        limit: z.coerce.number().int().positive().max(200).default(20),
    },
    async ({ limit }) =>
        toTextResponse({ snapshots: await listDistrictCacheSnapshots(limit) }),
);

registerLoggedTool(
    "districts_cache_get",
    "Load a cached districts snapshot by cache key, or latest when omitted",
    {
        cacheKey: z.string().optional(),
    },
    async ({ cacheKey }) => {
        const data = cacheKey
            ? await loadCachedDistrictsByKey(cacheKey)
            : await loadCachedDistricts();

        if (!data) {
            return toTextResponse({
                found: false,
                cache_key: cacheKey ?? "latest",
            });
        }

        return toTextResponse({ found: true, cache_key: data.cache_key, data });
    },
);

registerLoggedTool(
    "districts_response_profile",
    "Summarize district and area field availability in cached district data",
    {
        cacheKey: z.string().optional(),
        refresh: z.boolean().optional(),
    },
    async ({ cacheKey, refresh }) => {
        const data = cacheKey
            ? await loadCachedDistrictsByKey(cacheKey)
            : await getDistrictsData({ refresh });

        if (!data) {
            return toTextResponse({
                found: false,
                cache_key: cacheKey ?? "latest",
            });
        }

        return toTextResponse({
            found: true,
            ...buildDistrictResponseProfile(data),
        });
    },
);

registerLoggedTool(
    "districts_list",
    "List districts and their contained areas",
    { refresh: z.boolean().optional() },
    async ({ refresh }) => {
        const data = await getDistrictsData({ refresh });

        return toTextResponse({
            cache_key: data.cache_key,
            cached_at: data.cached_at,
            source_url: data.source_url,
            districts: buildDistrictList(data.districts),
        });
    },
);

registerLoggedTool(
    "districts_lookup",
    "Find which district contains an area or match a district name",
    {
        query: z.string(),
        refresh: z.boolean().optional(),
    },
    async ({ query, refresh }) => {
        const data = await getDistrictsData({ refresh });

        return toTextResponse({
            cache_key: data.cache_key,
            cached_at: data.cached_at,
            source_url: data.source_url,
            result: buildDistrictDetails(data.districts, query),
        });
    },
);

registerLoggedTool(
    "districts_area_count",
    "Return the number of areas for a district query with alias-aware matching",
    {
        query: z.string(),
        refresh: z.boolean().optional(),
    },
    async ({ query, refresh }) => {
        const data = await getDistrictsData({ refresh });

        return toTextResponse({
            cache_key: data.cache_key,
            cached_at: data.cached_at,
            source_url: data.source_url,
            result: buildDistrictAreaCount(data.districts, query),
        });
    },
);

registerLoggedTool(
    "districts_area_map",
    "Return the full area to district mapping",
    { refresh: z.boolean().optional() },
    async ({ refresh }) => {
        const data = await getDistrictsData({ refresh });

        return toTextResponse({
            cache_key: data.cache_key,
            cached_at: data.cached_at,
            source_url: data.source_url,
            areas: buildDistrictAreaLookup(data.districts),
        });
    },
);

registerLoggedTool(
    "prices_search",
    "Search stations by query, region, brand, company, area, fuel id, or offline status",
    {
        query: z.string().optional(),
        region: z.string().optional(),
        district: z.string().optional(),
        area: z.string().optional(),
        brand: z.string().optional(),
        company: z.string().optional(),
        fuelId: z.string().optional(),
        offline: z.boolean().optional(),
        limit: z.number().int().positive().max(100).default(20),
        refresh: z.boolean().optional(),
    },
    async (options) => {
        const { prices, districts } = await loadPriceAndDistrictData(
            options.refresh,
        );
        return toTextResponse(
            buildSearchResults(prices, options, districts.districts),
        );
    },
);

registerLoggedTool(
    "prices_station_lookup",
    "Find a station or a small set of matching stations by text",
    {
        query: z.string(),
        region: z.string().optional(),
        district: z.string().optional(),
        limit: z.number().int().positive().max(20).default(5),
        refresh: z.boolean().optional(),
    },
    async (options) => {
        const { prices, districts } = await loadPriceAndDistrictData(
            options.refresh,
        );
        return toTextResponse(
            buildSearchResults(
                prices,
                {
                    query: options.query,
                    region: options.region,
                    district: options.district,
                    limit: options.limit,
                },
                districts.districts,
            ),
        );
    },
);

registerLoggedTool(
    "prices_cheapest",
    "Find the cheapest stations for a fuel id",
    {
        fuelId: z.string(),
        region: z.string().optional(),
        district: z.string().optional(),
        area: z.string().optional(),
        brand: z.string().optional(),
        company: z.string().optional(),
        offline: z.boolean().optional(),
        limit: z.number().int().positive().max(100).default(10),
        refresh: z.boolean().optional(),
    },
    async (options) => {
        const { prices, districts } = await loadPriceAndDistrictData(
            options.refresh,
        );
        return toTextResponse(
            buildCheapestResults(prices, options, districts.districts),
        );
    },
);

registerLoggedTool(
    "prices_most_expensive",
    "Find the most expensive stations for a fuel id",
    {
        fuelId: z.string(),
        region: z.string().optional(),
        district: z.string().optional(),
        area: z.string().optional(),
        brand: z.string().optional(),
        company: z.string().optional(),
        offline: z.boolean().optional(),
        limit: z.number().int().positive().max(100).default(10),
        refresh: z.boolean().optional(),
    },
    async (options) => {
        const { prices, districts } = await loadPriceAndDistrictData(
            options.refresh,
        );
        return toTextResponse(
            buildMostExpensiveResults(prices, options, districts.districts),
        );
    },
);

registerLoggedTool(
    "prices_nearby",
    "Find nearby stations from GPS coordinates for driver and mobile use cases",
    {
        latitude: z.coerce.number(),
        longitude: z.coerce.number(),
        radiusKm: z.coerce.number().positive().max(250).default(25),
        limit: z.coerce.number().int().positive().max(100).default(10),
        fuelId: z.string().optional(),
        region: z.string().optional(),
        district: z.string().optional(),
        offline: z.boolean().optional(),
        refresh: z.boolean().optional(),
    },
    async (options) => {
        const { prices, districts } = await loadPriceAndDistrictData(
            options.refresh,
        );
        return toTextResponse(
            buildNearbyResults(prices, options, districts.districts),
        );
    },
);

registerLoggedTool(
    "prices_summary",
    "Summarize counts and price statistics for a region or all regions",
    {
        region: z.string().optional(),
        district: z.string().optional(),
        area: z.string().optional(),
        brand: z.string().optional(),
        company: z.string().optional(),
        fuelId: z.string().optional(),
        offline: z.boolean().optional(),
        refresh: z.boolean().optional(),
    },
    async (options) => {
        const { prices, districts } = await loadPriceAndDistrictData(
            options.refresh,
        );
        return toTextResponse(
            buildSummary(prices, options, districts.districts),
        );
    },
);

registerLoggedTool(
    "prices_raw",
    "Return the raw cached response, optionally filtered to one region",
    {
        region: z.string().optional(),
        refresh: z.boolean().optional(),
    },
    async (options) => {
        const data = await getPricesData({ refresh: options.refresh });
        return toTextResponse(buildRawData(data, { region: options.region }));
    },
);

const main = async () => {
    const transport = new StdioServerTransport();
    logServerEvent("starting MCP server transport");
    await server.connect(transport);
    logServerEvent("MCP server connected");
};

main().catch((error) => {
    console.error("MCP server failed:", error);
    process.exit(1);
});
