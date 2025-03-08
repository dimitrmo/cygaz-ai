import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { appConfig } from "./config.js";
import {
    createDistrictResolver,
    districtToText,
    resolveDistrictByArea,
    resolveDistrictByName,
    type DistrictResolver,
    type DistrictsResponse,
} from "./districts.js";

export const fuelPriceSchema = z
    .object({
        kind: z.number(),
        id: z.string(),
        label: z.string(),
        value: z.string(),
    })
    .passthrough();

export const stationSchema = z
    .object({
        brand: z.string(),
        offline: z.boolean(),
        company: z.string(),
        address: z.string(),
        latitude: z.string(),
        longitude: z.string(),
        area_en: z.string(),
        area_el: z.string(),
        prices: z.array(fuelPriceSchema),
    })
    .passthrough();

export const pricesResponseSchema = z
    .object({
        updated_at: z.number().int(),
        updated_at_str: z.string(),
        prices: z.record(z.string(), z.array(stationSchema)),
    })
    .passthrough();

export const cachedPricesSchema = pricesResponseSchema
    .extend({
        cache_key: z.string(),
        cached_at: z.string(),
        source_url: z.string(),
    })
    .passthrough();

export type FuelPrice = z.infer<typeof fuelPriceSchema>;
export type Station = z.infer<typeof stationSchema>;
export type PricesResponse = z.infer<typeof pricesResponseSchema>;
export type CachedPrices = z.infer<typeof cachedPricesSchema>;

export type PriceCacheSnapshot = {
    cache_key: string;
    updated_at: number;
    updated_at_str: string;
    cached_at: string;
    source_url: string;
    region_count: number;
    station_count: number;
    file_name: string;
    file_size_bytes: number;
};

type FilterOptions = {
    query?: string;
    region?: string;
    district?: string;
    area?: string;
    brand?: string;
    company?: string;
    fuelId?: string;
    offline?: boolean;
};

type SearchOptions = FilterOptions & {
    limit?: number;
};

type PriceRankOptions = FilterOptions & {
    limit?: number;
};

type NearbyOptions = {
    latitude: number;
    longitude: number;
    radiusKm?: number;
    limit?: number;
    fuelId?: string;
    region?: string;
    district?: string;
    offline?: boolean;
};

type PriceDistrictMeta = {
    id: string;
    district_en: string;
    district_el: string;
} | null;

function cacheFilePath(updatedAt: number): string {
    return join(appConfig.pricesCacheDir, `${updatedAt}.json`);
}

function latestCacheFilePath(): string {
    return join(appConfig.pricesCacheDir, "latest.json");
}

function normalizeText(value: string): string {
    return value.trim().toLowerCase();
}

function numericPrice(value: string): number | null {
    const parsedValue = Number(value);

    return Number.isFinite(parsedValue) ? parsedValue : null;
}

function buildDistrictResolver(
    districts?: DistrictsResponse,
): DistrictResolver | null {
    if (!districts) {
        return null;
    }

    return createDistrictResolver(districts);
}

function getStationDistrict(
    station: Station,
    districtResolver: DistrictResolver | null,
    region?: string,
): PriceDistrictMeta {
    if (!districtResolver) {
        if (!region) {
            return null;
        }

        return {
            id: region,
            district_en: region,
            district_el: region,
        };
    }

    const areaMatch =
        resolveDistrictByArea(districtResolver, station.area_en) ??
        resolveDistrictByArea(districtResolver, station.area_el);

    if (areaMatch) {
        return districtToText(areaMatch);
    }

    if (region) {
        const regionMatch = resolveDistrictByName(districtResolver, region);

        if (regionMatch) {
            return districtToText(regionMatch);
        }
    }

    return null;
}

function parseCoordinate(value: string): number | null {
    const parsedValue = Number(value);

    return Number.isFinite(parsedValue) ? parsedValue : null;
}

function distanceKm(
    fromLatitude: number,
    fromLongitude: number,
    toLatitude: number,
    toLongitude: number,
): number {
    const earthRadiusKm = 6371;
    const latitudeDelta = ((toLatitude - fromLatitude) * Math.PI) / 180;
    const longitudeDelta = ((toLongitude - fromLongitude) * Math.PI) / 180;
    const startLatitude = (fromLatitude * Math.PI) / 180;
    const endLatitude = (toLatitude * Math.PI) / 180;

    const a =
        Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
        Math.sin(longitudeDelta / 2) *
            Math.sin(longitudeDelta / 2) *
            Math.cos(startLatitude) *
            Math.cos(endLatitude);

    return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function stationMatchesQuery(station: Station, query: string): boolean {
    const normalizedQuery = normalizeText(query);

    if (!normalizedQuery) {
        return true;
    }

    const searchableValues = [
        station.brand,
        station.company,
        station.address,
        station.area_en,
        station.area_el,
        ...station.prices.map((price) => price.label),
        ...station.prices.map((price) => price.id),
    ]
        .join(" ")
        .toLowerCase();

    return searchableValues.includes(normalizedQuery);
}

function stationMatchesFilters(
    station: Station,
    filters: FilterOptions,
): boolean {
    if (
        typeof filters.offline === "boolean" &&
        station.offline !== filters.offline
    ) {
        return false;
    }

    if (filters.area) {
        const normalizedArea = normalizeText(filters.area);

        if (
            !station.area_en.toLowerCase().includes(normalizedArea) &&
            !station.area_el.toLowerCase().includes(normalizedArea)
        ) {
            return false;
        }
    }

    if (
        filters.brand &&
        !station.brand.toLowerCase().includes(normalizeText(filters.brand))
    ) {
        return false;
    }

    if (
        filters.company &&
        !station.company.toLowerCase().includes(normalizeText(filters.company))
    ) {
        return false;
    }

    if (
        filters.fuelId &&
        !station.prices.some((price) => price.id === filters.fuelId)
    ) {
        return false;
    }

    return stationMatchesQuery(station, filters.query ?? "");
}

function getFuelPrice(station: Station, fuelId: string): FuelPrice | undefined {
    return station.prices.find((price) => price.id === fuelId);
}

function flattenStations(
    data: PricesResponse,
): Array<{ region: string; station: Station }> {
    return Object.entries(data.prices).flatMap(([region, stations]) =>
        stations.map((station) => ({ region, station })),
    );
}

function filterStations(
    data: PricesResponse,
    filters: FilterOptions,
    districtResolver: DistrictResolver | null = null,
): Array<{ region: string; station: Station }> {
    return flattenStations(data).filter(({ region, station }) => {
        if (
            filters.region &&
            region.toLowerCase() !== normalizeText(filters.region)
        ) {
            return false;
        }

        if (filters.district && districtResolver) {
            const stationDistrict = getStationDistrict(
                station,
                districtResolver,
                region,
            );

            if (
                !stationDistrict ||
                (normalizeText(stationDistrict.id) !==
                    normalizeText(filters.district) &&
                    normalizeText(stationDistrict.district_en) !==
                        normalizeText(filters.district) &&
                    normalizeText(stationDistrict.district_el) !==
                        normalizeText(filters.district))
            ) {
                return false;
            }
        }

        return stationMatchesFilters(station, filters);
    });
}

function mapStationResult(
    region: string,
    station: Station,
    districtResolver: DistrictResolver | null = null,
) {
    return {
        region,
        district: getStationDistrict(station, districtResolver, region),
        brand: station.brand,
        company: station.company,
        area_en: station.area_en,
        area_el: station.area_el,
        offline: station.offline,
        address: station.address,
        latitude: station.latitude,
        longitude: station.longitude,
        prices: station.prices.map((price) => ({
            ...price,
            numeric_value: numericPrice(price.value),
        })),
    };
}

async function writeCacheEntry(data: PricesResponse): Promise<CachedPrices> {
    await mkdir(appConfig.pricesCacheDir, { recursive: true });

    const cacheEntry: CachedPrices = {
        ...data,
        cache_key: String(data.updated_at),
        cached_at: new Date().toISOString(),
        source_url: appConfig.rapidApiUrl,
    };

    const serializedCache = JSON.stringify(cacheEntry, null, 2);

    await writeFile(cacheFilePath(data.updated_at), serializedCache, "utf8");
    await writeFile(latestCacheFilePath(), serializedCache, "utf8");

    return cacheEntry;
}

async function readCacheFile(filePath: string): Promise<CachedPrices | null> {
    try {
        const rawContent = await readFile(filePath, "utf8");
        return cachedPricesSchema.parse(JSON.parse(rawContent));
    } catch {
        return null;
    }
}

async function getNewestCacheFile(): Promise<string | null> {
    try {
        const entries = await readdir(appConfig.pricesCacheDir, {
            withFileTypes: true,
        });
        const numberedFiles = entries
            .filter(
                (entry) =>
                    entry.isFile() &&
                    entry.name.endsWith(".json") &&
                    entry.name !== "latest.json",
            )
            .map((entry) => entry.name)
            .sort(
                (left, right) =>
                    Number(right.replace(/\.json$/, "")) -
                    Number(left.replace(/\.json$/, "")),
            );

        return numberedFiles[0]
            ? join(appConfig.pricesCacheDir, numberedFiles[0])
            : null;
    } catch {
        return null;
    }
}

async function getSortedCacheFiles(): Promise<string[]> {
    try {
        const entries = await readdir(appConfig.pricesCacheDir, {
            withFileTypes: true,
        });

        return entries
            .filter(
                (entry) =>
                    entry.isFile() &&
                    entry.name.endsWith(".json") &&
                    entry.name !== "latest.json",
            )
            .map((entry) => join(appConfig.pricesCacheDir, entry.name))
            .sort((left, right) => {
                const leftKey = Number(
                    left
                        .split("/")
                        .pop()
                        ?.replace(/\.json$/, "") ?? "0",
                );
                const rightKey = Number(
                    right
                        .split("/")
                        .pop()
                        ?.replace(/\.json$/, "") ?? "0",
                );
                return rightKey - leftKey;
            });
    } catch {
        return [];
    }
}

export async function loadCachedPricesByKey(
    cacheKey: string,
): Promise<CachedPrices | null> {
    if (!cacheKey || cacheKey === "latest") {
        return loadCachedPrices();
    }

    const snapshot = await readCacheFile(cacheFilePath(Number(cacheKey)));

    if (!snapshot) {
        return null;
    }

    return snapshot.cache_key === cacheKey ? snapshot : null;
}

export async function listPriceCacheSnapshots(
    limit = 20,
): Promise<PriceCacheSnapshot[]> {
    const files = await getSortedCacheFiles();
    const snapshots = await Promise.all(
        files.slice(0, Math.max(1, limit)).map(async (filePath) => {
            const [cached, fileStats] = await Promise.all([
                readCacheFile(filePath),
                stat(filePath),
            ]);

            if (!cached) {
                return null;
            }

            const stationCount = flattenStations(cached).length;

            return {
                cache_key: cached.cache_key,
                updated_at: cached.updated_at,
                updated_at_str: cached.updated_at_str,
                cached_at: cached.cached_at,
                source_url: cached.source_url,
                region_count: Object.keys(cached.prices).length,
                station_count: stationCount,
                file_name: filePath.split("/").pop() ?? "unknown.json",
                file_size_bytes: fileStats.size,
            } satisfies PriceCacheSnapshot;
        }),
    );

    return snapshots.filter(
        (entry): entry is PriceCacheSnapshot => entry !== null,
    );
}

function isPresent(value: unknown): boolean {
    if (typeof value === "string") {
        return value.trim().length > 0;
    }

    if (Array.isArray(value)) {
        return value.length > 0;
    }

    return value !== null && value !== undefined;
}

export function buildStationResponseProfile(data: CachedPrices) {
    const flattened = flattenStations(data);
    const totalStations = flattened.length;
    const trackedFields = [
        "brand",
        "offline",
        "company",
        "address",
        "latitude",
        "longitude",
        "area_en",
        "area_el",
        "prices",
    ] as const;

    const fieldCoverage = Object.fromEntries(
        trackedFields.map((field) => {
            const availableCount = flattened.filter(({ station }) =>
                isPresent(station[field]),
            ).length;

            return [
                field,
                {
                    available_count: availableCount,
                    missing_count: totalStations - availableCount,
                    available_ratio:
                        totalStations === 0
                            ? 0
                            : Number(
                                  (availableCount / totalStations).toFixed(4),
                              ),
                },
            ];
        }),
    );

    const gpsCoverage = flattened.filter(({ station }) => {
        const latitude = parseCoordinate(station.latitude);
        const longitude = parseCoordinate(station.longitude);
        return latitude !== null && longitude !== null;
    }).length;

    return {
        cache_key: data.cache_key,
        cached_at: data.cached_at,
        updated_at: data.updated_at,
        updated_at_str: data.updated_at_str,
        total_regions: Object.keys(data.prices).length,
        total_stations: totalStations,
        gps_coordinates: {
            available_count: gpsCoverage,
            missing_count: totalStations - gpsCoverage,
            available_ratio:
                totalStations === 0
                    ? 0
                    : Number((gpsCoverage / totalStations).toFixed(4)),
        },
        field_coverage: fieldCoverage,
        sample_station: flattened[0]
            ? {
                  region: flattened[0].region,
                  ...flattened[0].station,
              }
            : null,
    };
}

export async function loadCachedPrices(): Promise<CachedPrices | null> {
    const latestCache = await readCacheFile(latestCacheFilePath());

    if (latestCache) {
        return latestCache;
    }

    const newestCacheFile = await getNewestCacheFile();

    if (!newestCacheFile) {
        return null;
    }

    return readCacheFile(newestCacheFile);
}

export async function refreshPrices(): Promise<CachedPrices> {
    const response = await fetch(appConfig.rapidApiUrl, {
        headers: {
            "Content-Type": "application/json",
            "x-rapidapi-host": appConfig.rapidApiHost,
            "x-rapidapi-key": appConfig.rapidApiKey,
        },
    });

    if (!response.ok) {
        throw new Error(
            `Prices request failed with status ${response.status} ${response.statusText}`,
        );
    }

    const parsedResponse = pricesResponseSchema.parse(await response.json());
    return writeCacheEntry(parsedResponse);
}

export async function getPricesData(
    options: { refresh?: boolean } = {},
): Promise<CachedPrices> {
    if (options.refresh) {
        return refreshPrices();
    }

    const cachedPrices = await loadCachedPrices();

    if (cachedPrices) {
        return cachedPrices;
    }

    return refreshPrices();
}

export function buildCacheOverview(data: CachedPrices) {
    const stations = flattenStations(data);

    return {
        cache_key: data.cache_key,
        cached_at: data.cached_at,
        source_url: data.source_url,
        updated_at: data.updated_at,
        updated_at_str: data.updated_at_str,
        region_count: Object.keys(data.prices).length,
        station_count: stations.length,
        region_summary: Object.fromEntries(
            Object.entries(data.prices).map(([region, regionStations]) => [
                region,
                {
                    station_count: regionStations.length,
                    offline_count: regionStations.filter(
                        (station) => station.offline,
                    ).length,
                },
            ]),
        ),
    };
}

export function buildRegionList(data: CachedPrices) {
    return Object.entries(data.prices)
        .map(([region, stations]) => ({
            region,
            station_count: stations.length,
            offline_count: stations.filter((station) => station.offline).length,
        }))
        .sort((left, right) => right.station_count - left.station_count);
}

export function buildSearchResults(
    data: CachedPrices,
    options: SearchOptions,
    districts?: DistrictsResponse,
) {
    const districtResolver = buildDistrictResolver(districts);
    const matchedStations = filterStations(data, options, districtResolver);
    const limitedStations = matchedStations.slice(0, options.limit ?? 20);

    return {
        cache_key: data.cache_key,
        cached_at: data.cached_at,
        updated_at: data.updated_at,
        updated_at_str: data.updated_at_str,
        query: options,
        result_count: matchedStations.length,
        results: limitedStations.map(({ region, station }) =>
            mapStationResult(region, station, districtResolver),
        ),
    };
}

function rankStationsByFuelPrice(
    stations: Array<{ region: string; station: Station }>,
    fuelId: string,
) {
    return stations
        .map(({ region, station }) => {
            const fuelPrice = getFuelPrice(station, fuelId);

            if (!fuelPrice) {
                return null;
            }

            const numericValue = numericPrice(fuelPrice.value);

            if (numericValue === null) {
                return null;
            }

            return {
                region,
                station,
                fuelPrice,
                numericValue,
            };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort((left, right) => left.numericValue - right.numericValue);
}

export function buildCheapestResults(
    data: CachedPrices,
    options: PriceRankOptions,
    districts?: DistrictsResponse,
) {
    const districtResolver = buildDistrictResolver(districts);
    const rankedStations = rankStationsByFuelPrice(
        filterStations(data, options, districtResolver),
        options.fuelId ?? "",
    );

    const limitedStations = rankedStations.slice(0, options.limit ?? 10);

    return {
        cache_key: data.cache_key,
        cached_at: data.cached_at,
        updated_at: data.updated_at,
        updated_at_str: data.updated_at_str,
        fuel_id: options.fuelId ?? null,
        result_count: rankedStations.length,
        results: limitedStations.map(
            ({ region, station, fuelPrice, numericValue }) => ({
                region,
                district: getStationDistrict(station, districtResolver, region),
                brand: station.brand,
                company: station.company,
                area_en: station.area_en,
                area_el: station.area_el,
                offline: station.offline,
                address: station.address,
                latitude: station.latitude,
                longitude: station.longitude,
                fuel_price: {
                    ...fuelPrice,
                    numeric_value: numericValue,
                },
            }),
        ),
    };
}

export function buildMostExpensiveResults(
    data: CachedPrices,
    options: PriceRankOptions,
    districts?: DistrictsResponse,
) {
    const districtResolver = buildDistrictResolver(districts);
    const rankedStations = rankStationsByFuelPrice(
        filterStations(data, options, districtResolver),
        options.fuelId ?? "",
    ).reverse();

    const limitedStations = rankedStations.slice(0, options.limit ?? 10);

    return {
        cache_key: data.cache_key,
        cached_at: data.cached_at,
        updated_at: data.updated_at,
        updated_at_str: data.updated_at_str,
        fuel_id: options.fuelId ?? null,
        result_count: rankedStations.length,
        results: limitedStations.map(
            ({ region, station, fuelPrice, numericValue }) => ({
                region,
                district: getStationDistrict(station, districtResolver, region),
                brand: station.brand,
                company: station.company,
                area_en: station.area_en,
                area_el: station.area_el,
                offline: station.offline,
                address: station.address,
                latitude: station.latitude,
                longitude: station.longitude,
                fuel_price: {
                    ...fuelPrice,
                    numeric_value: numericValue,
                },
            }),
        ),
    };
}

export function buildNearbyResults(
    data: CachedPrices,
    options: NearbyOptions,
    districts?: DistrictsResponse,
) {
    const districtResolver = buildDistrictResolver(districts);
    const flattenedStations = flattenStations(data)
        .filter(({ station, region }) => {
            if (
                options.region &&
                region.toLowerCase() !== normalizeText(options.region)
            ) {
                return false;
            }

            if (
                typeof options.offline === "boolean" &&
                station.offline !== options.offline
            ) {
                return false;
            }

            if (options.district && districtResolver) {
                const stationDistrict = getStationDistrict(
                    station,
                    districtResolver,
                    region,
                );

                if (
                    !stationDistrict ||
                    (normalizeText(stationDistrict.id) !==
                        normalizeText(options.district) &&
                        normalizeText(stationDistrict.district_en) !==
                            normalizeText(options.district) &&
                        normalizeText(stationDistrict.district_el) !==
                            normalizeText(options.district))
                ) {
                    return false;
                }
            }

            if (
                options.fuelId &&
                !station.prices.some((price) => price.id === options.fuelId)
            ) {
                return false;
            }

            return true;
        })
        .map(({ region, station }) => {
            const stationLatitude = parseCoordinate(station.latitude);
            const stationLongitude = parseCoordinate(station.longitude);

            if (stationLatitude === null || stationLongitude === null) {
                return null;
            }

            return {
                region,
                station,
                district: getStationDistrict(station, districtResolver, region),
                distance_km: distanceKm(
                    options.latitude,
                    options.longitude,
                    stationLatitude,
                    stationLongitude,
                ),
            };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .filter((entry) => entry.distance_km <= (options.radiusKm ?? 25))
        .sort((left, right) => left.distance_km - right.distance_km);

    const limitedStations = flattenedStations.slice(0, options.limit ?? 10);

    return {
        cache_key: data.cache_key,
        cached_at: data.cached_at,
        updated_at: data.updated_at,
        updated_at_str: data.updated_at_str,
        search: {
            latitude: options.latitude,
            longitude: options.longitude,
            radius_km: options.radiusKm ?? 25,
            limit: options.limit ?? 10,
            fuel_id: options.fuelId ?? null,
            region: options.region ?? null,
            district: options.district ?? null,
            offline: options.offline ?? null,
        },
        result_count: flattenedStations.length,
        results: limitedStations.map(({ region, station, distance_km }) => ({
            region,
            district: getStationDistrict(station, districtResolver, region),
            distance_km: Number(distance_km.toFixed(2)),
            brand: station.brand,
            company: station.company,
            area_en: station.area_en,
            area_el: station.area_el,
            offline: station.offline,
            address: station.address,
            latitude: station.latitude,
            longitude: station.longitude,
            prices: station.prices.map((price) => ({
                ...price,
                numeric_value: numericPrice(price.value),
            })),
        })),
    };
}

function summarizeFuelPrices(stations: Station[], fuelId: string) {
    const pricedStations = stations
        .map((station) => {
            const fuelPrice = getFuelPrice(station, fuelId);

            if (!fuelPrice) {
                return null;
            }

            const numericValue = numericPrice(fuelPrice.value);

            if (numericValue === null) {
                return null;
            }

            return {
                station,
                fuelPrice,
                numericValue,
            };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (pricedStations.length === 0) {
        return null;
    }

    const prices = pricedStations.map((entry) => entry.numericValue);
    const average =
        prices.reduce((sum, value) => sum + value, 0) / prices.length;
    const cheapest = pricedStations.reduce((current, candidate) =>
        candidate.numericValue < current.numericValue ? candidate : current,
    );
    const mostExpensive = pricedStations.reduce((current, candidate) =>
        candidate.numericValue > current.numericValue ? candidate : current,
    );

    return {
        count: pricedStations.length,
        average: Number(average.toFixed(3)),
        min: {
            value: cheapest.numericValue,
            station: cheapest.station.company,
            brand: cheapest.station.brand,
            area_en: cheapest.station.area_en,
        },
        max: {
            value: mostExpensive.numericValue,
            station: mostExpensive.station.company,
            brand: mostExpensive.station.brand,
            area_en: mostExpensive.station.area_en,
        },
    };
}

export function buildSummary(
    data: CachedPrices,
    options: FilterOptions,
    districts?: DistrictsResponse,
) {
    const districtResolver = buildDistrictResolver(districts);
    const regions = options.region
        ? [options.region]
        : Object.keys(data.prices);

    return {
        cache_key: data.cache_key,
        cached_at: data.cached_at,
        updated_at: data.updated_at,
        updated_at_str: data.updated_at_str,
        region: options.region ?? null,
        fuel_id: options.fuelId ?? null,
        regions: regions.map((region) => {
            const stations = data.prices[region] ?? [];
            const filteredStations = stations.filter((station) => {
                if (!stationMatchesFilters(station, options)) {
                    return false;
                }

                if (options.district && districtResolver) {
                    const district = getStationDistrict(
                        station,
                        districtResolver,
                        region,
                    );

                    if (
                        !district ||
                        (normalizeText(district.id) !==
                            normalizeText(options.district) &&
                            normalizeText(district.district_en) !==
                                normalizeText(options.district) &&
                            normalizeText(district.district_el) !==
                                normalizeText(options.district))
                    ) {
                        return false;
                    }
                }

                return true;
            });

            const districtCounts = new Map<
                string,
                {
                    district: {
                        id: string;
                        district_en: string;
                        district_el: string;
                    };
                    count: number;
                }
            >();

            if (districtResolver) {
                for (const station of filteredStations) {
                    const district = getStationDistrict(
                        station,
                        districtResolver,
                        region,
                    );

                    if (!district) {
                        continue;
                    }

                    const existingDistrict = districtCounts.get(district.id);

                    if (existingDistrict) {
                        existingDistrict.count += 1;
                    } else {
                        districtCounts.set(district.id, {
                            district: {
                                id: district.id,
                                district_en: district.district_en,
                                district_el: district.district_el,
                            },
                            count: 1,
                        });
                    }
                }
            }

            const summary = {
                region,
                station_count: filteredStations.length,
                offline_count: filteredStations.filter(
                    (station) => station.offline,
                ).length,
                district_breakdown: Array.from(districtCounts.values()).map(
                    (entry) => ({
                        ...entry.district,
                        station_count: entry.count,
                    }),
                ),
            };

            if (!options.fuelId) {
                return summary;
            }

            return {
                ...summary,
                fuel_summary: summarizeFuelPrices(
                    filteredStations,
                    options.fuelId,
                ),
            };
        }),
    };
}

export function buildRawData(
    data: CachedPrices,
    options: { region?: string } = {},
) {
    if (!options.region) {
        return data;
    }

    return {
        ...data,
        prices: {
            [options.region]: data.prices[options.region] ?? [],
        },
    };
}
