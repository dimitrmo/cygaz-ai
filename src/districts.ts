import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { appConfig } from "./config.js";

export const districtAreaSchema = z
    .object({
        name_en: z.string(),
        name_el: z.string(),
    })
    .passthrough();

export const districtSchema = z
    .object({
        id: z.string(),
        district_en: z.string(),
        district_el: z.string(),
        areas: z.array(districtAreaSchema),
    })
    .passthrough();

export const districtsResponseSchema = z.array(districtSchema);

export const cachedDistrictsSchema = z
    .object({
        cache_key: z.string(),
        cached_at: z.string(),
        source_url: z.string(),
        districts: districtsResponseSchema,
    })
    .passthrough();

export type DistrictArea = z.infer<typeof districtAreaSchema>;
export type District = z.infer<typeof districtSchema>;
export type DistrictsResponse = z.infer<typeof districtsResponseSchema>;
export type CachedDistricts = z.infer<typeof cachedDistrictsSchema>;

export type DistrictCacheSnapshot = {
    cache_key: string;
    cached_at: string;
    source_url: string;
    district_count: number;
    area_count: number;
    file_name: string;
    file_size_bytes: number;
};

export type DistrictResolver = {
    byAreaName: Map<string, District>;
    byDistrictName: Map<string, District>;
};

const districtAliasGroups = [
    ["paphos", "pafos"],
    ["nicosia", "lefkosia", "leucosia"],
    ["limassol", "lemesos"],
    ["larnaca", "larnaka"],
    ["famagusta", "ammochostos", "amochostos"],
] as const;

function normalizeText(value: string): string {
    return value.trim().toLowerCase();
}

function registerDistrictAliases(
    district: District,
    byDistrictName: Map<string, District>,
): void {
    const districtKeys = new Set([
        normalizeText(district.id),
        normalizeText(district.district_en),
        normalizeText(district.district_el),
    ]);

    for (const aliasGroup of districtAliasGroups) {
        if (!aliasGroup.some((alias) => districtKeys.has(alias))) {
            continue;
        }

        for (const alias of aliasGroup) {
            byDistrictName.set(alias, district);
        }
    }
}

function cacheFilePath(cacheKey: string): string {
    return join(appConfig.districtsCacheDir, `${cacheKey}.json`);
}

function latestCacheFilePath(): string {
    return join(appConfig.districtsCacheDir, "latest.json");
}

function buildCacheEntry(districts: DistrictsResponse): CachedDistricts {
    const cacheKey = String(Date.now());

    return {
        cache_key: cacheKey,
        cached_at: new Date().toISOString(),
        source_url:
            process.env.CYGAZ_DISTRICTS_URL ??
            "https://cygaz.p.rapidapi.com/districts",
        districts,
    };
}

async function writeCacheEntry(
    entry: CachedDistricts,
): Promise<CachedDistricts> {
    await mkdir(appConfig.districtsCacheDir, { recursive: true });

    const serializedCache = JSON.stringify(entry, null, 2);

    await writeFile(cacheFilePath(entry.cache_key), serializedCache, "utf8");
    await writeFile(latestCacheFilePath(), serializedCache, "utf8");

    return entry;
}

async function readCacheFile(
    filePath: string,
): Promise<CachedDistricts | null> {
    try {
        const rawContent = await readFile(filePath, "utf8");
        return cachedDistrictsSchema.parse(JSON.parse(rawContent));
    } catch {
        return null;
    }
}

async function getNewestCacheFile(): Promise<string | null> {
    try {
        const entries = await readdir(appConfig.districtsCacheDir, {
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
            ? join(appConfig.districtsCacheDir, numberedFiles[0])
            : null;
    } catch {
        return null;
    }
}

async function getSortedCacheFiles(): Promise<string[]> {
    try {
        const entries = await readdir(appConfig.districtsCacheDir, {
            withFileTypes: true,
        });

        return entries
            .filter(
                (entry) =>
                    entry.isFile() &&
                    entry.name.endsWith(".json") &&
                    entry.name !== "latest.json",
            )
            .map((entry) => join(appConfig.districtsCacheDir, entry.name))
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

export async function loadCachedDistrictsByKey(
    cacheKey: string,
): Promise<CachedDistricts | null> {
    if (!cacheKey || cacheKey === "latest") {
        return loadCachedDistricts();
    }

    const snapshot = await readCacheFile(cacheFilePath(cacheKey));

    if (!snapshot) {
        return null;
    }

    return snapshot.cache_key === cacheKey ? snapshot : null;
}

export async function listDistrictCacheSnapshots(
    limit = 20,
): Promise<DistrictCacheSnapshot[]> {
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

            return {
                cache_key: cached.cache_key,
                cached_at: cached.cached_at,
                source_url: cached.source_url,
                district_count: cached.districts.length,
                area_count: cached.districts.reduce(
                    (sum, district) => sum + district.areas.length,
                    0,
                ),
                file_name: filePath.split("/").pop() ?? "unknown.json",
                file_size_bytes: fileStats.size,
            } satisfies DistrictCacheSnapshot;
        }),
    );

    return snapshots.filter(
        (entry): entry is DistrictCacheSnapshot => entry !== null,
    );
}

export function createDistrictResolver(
    districts: DistrictsResponse,
): DistrictResolver {
    const byAreaName = new Map<string, District>();
    const byDistrictName = new Map<string, District>();

    for (const district of districts) {
        byDistrictName.set(normalizeText(district.id), district);
        byDistrictName.set(normalizeText(district.district_en), district);
        byDistrictName.set(normalizeText(district.district_el), district);
        registerDistrictAliases(district, byDistrictName);

        for (const area of district.areas) {
            byAreaName.set(normalizeText(area.name_en), district);
            byAreaName.set(normalizeText(area.name_el), district);
        }
    }

    return {
        byAreaName,
        byDistrictName,
    };
}

export function resolveDistrictByArea(
    resolver: DistrictResolver,
    areaName: string,
): District | null {
    return resolver.byAreaName.get(normalizeText(areaName)) ?? null;
}

export function resolveDistrictByName(
    resolver: DistrictResolver,
    districtName: string,
): District | null {
    return resolver.byDistrictName.get(normalizeText(districtName)) ?? null;
}

export function districtToText(district: District) {
    return {
        id: district.id,
        district_en: district.district_en,
        district_el: district.district_el,
        area_count: district.areas.length,
    };
}

export function buildDistrictList(districts: DistrictsResponse) {
    return districts
        .map((district) => ({
            id: district.id,
            district_en: district.district_en,
            district_el: district.district_el,
            area_count: district.areas.length,
            areas: district.areas,
        }))
        .sort((left, right) => right.area_count - left.area_count);
}

export function buildDistrictAreaLookup(districts: DistrictsResponse) {
    return districts.flatMap((district) =>
        district.areas.map((area) => ({
            area_en: area.name_en,
            area_el: area.name_el,
            district_id: district.id,
            district_en: district.district_en,
            district_el: district.district_el,
        })),
    );
}

export function buildDistrictResponseProfile(data: CachedDistricts) {
    const districts = data.districts;
    const allAreas = districts.flatMap((district) => district.areas);

    return {
        cache_key: data.cache_key,
        cached_at: data.cached_at,
        source_url: data.source_url,
        district_count: districts.length,
        area_count: allAreas.length,
        average_areas_per_district:
            districts.length === 0
                ? 0
                : Number((allAreas.length / districts.length).toFixed(3)),
        district_name_coverage: {
            district_en_present: districts.filter(
                (district) => district.district_en.trim().length > 0,
            ).length,
            district_el_present: districts.filter(
                (district) => district.district_el.trim().length > 0,
            ).length,
        },
        area_name_coverage: {
            area_en_present: allAreas.filter(
                (area) => area.name_en.trim().length > 0,
            ).length,
            area_el_present: allAreas.filter(
                (area) => area.name_el.trim().length > 0,
            ).length,
        },
        sample_district: districts[0] ?? null,
    };
}

export function buildDistrictDetails(
    districts: DistrictsResponse,
    query?: string,
) {
    if (!query) {
        return null;
    }

    const normalizedQuery = normalizeText(query);
    const resolver = createDistrictResolver(districts);
    const exactMatch = resolveDistrictByName(resolver, normalizedQuery);

    if (exactMatch) {
        return {
            match_type: "district",
            district: districtToText(exactMatch),
            areas: exactMatch.areas,
        };
    }

    const areaMatch = resolveDistrictByArea(resolver, normalizedQuery);

    if (areaMatch) {
        const matchedArea = areaMatch.areas.find(
            (area) =>
                normalizeText(area.name_en) === normalizedQuery ||
                normalizeText(area.name_el) === normalizedQuery,
        );

        return {
            match_type: "area",
            area: matchedArea ?? { name_en: query, name_el: query },
            district: districtToText(areaMatch),
            areas: areaMatch.areas,
        };
    }

    const filteredDistricts = districts.filter((district) =>
        district.areas.some(
            (area) =>
                normalizeText(area.name_en).includes(normalizedQuery) ||
                normalizeText(area.name_el).includes(normalizedQuery) ||
                normalizeText(district.district_en).includes(normalizedQuery) ||
                normalizeText(district.district_el).includes(normalizedQuery),
        ),
    );

    return {
        match_type: "search",
        query,
        districts: filteredDistricts.map(districtToText),
    };
}

export function buildDistrictAreaCount(
    districts: DistrictsResponse,
    query?: string,
) {
    if (!query) {
        return null;
    }

    const details = buildDistrictDetails(districts, query);

    if (!details) {
        return null;
    }

    if (details.match_type === "district" || details.match_type === "area") {
        const areas = Array.isArray(details.areas) ? details.areas : [];

        return {
            match_type: details.match_type,
            query,
            district: details.district,
            area_count: areas.length,
            areas,
        };
    }

    const districtMatches = Array.isArray(details.districts)
        ? details.districts
        : [];
    const topMatch = districtMatches[0];

    if (!topMatch) {
        return {
            match_type: "search",
            query,
            district: null,
            area_count: null,
            areas: [],
        };
    }

    const resolver = createDistrictResolver(districts);
    const resolvedDistrict = resolveDistrictByName(resolver, topMatch.id);

    return {
        match_type: "search",
        query,
        district: topMatch,
        area_count: topMatch.area_count,
        areas: resolvedDistrict?.areas ?? [],
    };
}

export async function loadCachedDistricts(): Promise<CachedDistricts | null> {
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

export async function refreshDistricts(): Promise<CachedDistricts> {
    const response = await fetch(
        process.env.CYGAZ_DISTRICTS_URL ??
            "https://cygaz.p.rapidapi.com/districts",
        {
            headers: {
                "Content-Type": "application/json",
                "x-rapidapi-host": appConfig.rapidApiHost,
                "x-rapidapi-key": appConfig.rapidApiKey,
            },
        },
    );

    if (!response.ok) {
        throw new Error(
            `Districts request failed with status ${response.status} ${response.statusText}`,
        );
    }

    const parsedResponse = districtsResponseSchema.parse(await response.json());
    return writeCacheEntry(buildCacheEntry(parsedResponse));
}

export async function getDistrictsData(
    options: { refresh?: boolean } = {},
): Promise<CachedDistricts> {
    if (options.refresh) {
        return refreshDistricts();
    }

    const cachedDistricts = await loadCachedDistricts();

    if (cachedDistricts) {
        return cachedDistricts;
    }

    return refreshDistricts();
}
