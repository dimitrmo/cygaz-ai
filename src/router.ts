import type { CachedDistricts } from "./districts.js";
import {
    createDistrictResolver,
    districtToText,
    resolveDistrictByArea,
    resolveDistrictByName,
} from "./districts.js";
import type { CachedPrices, Station } from "./prices.js";

type RouterContext = {
    prices: CachedPrices;
    districts: CachedDistricts;
};

type AskOptions = {
    query: string;
    latitude?: number;
    longitude?: number;
    radiusKm?: number;
    limit?: number;
    refresh?: boolean;
};

type Intent =
    | "district_lookup"
    | "district_areas"
    | "district_stations"
    | "district_comparison"
    | "search"
    | "cheapest"
    | "most_expensive"
    | "nearby"
    | "summary"
    | "regions"
    | "raw";

function normalizeText(value: string): string {
    return value.trim().toLowerCase();
}

function numericPrice(value: string): number | null {
    const parsedValue = Number(value);

    return Number.isFinite(parsedValue) ? parsedValue : null;
}

function stationPrice(station: Station, fuelId?: string): number | null {
    if (!fuelId) {
        return null;
    }

    const price = station.prices.find((entry) => entry.id === fuelId);

    return price ? numericPrice(price.value) : null;
}

function containsAny(text: string, terms: string[]): boolean {
    return terms.some((term) => text.includes(term));
}

function inferFuelId(query: string): string | undefined {
    const normalizedQuery = normalizeText(query);

    if (containsAny(normalizedQuery, ["unlead 95", "unleaded 95", "95"])) {
        return "unlead_95";
    }

    if (containsAny(normalizedQuery, ["unlead 98", "unleaded 98", "98"])) {
        return "unlead_98";
    }

    if (
        containsAny(normalizedQuery, ["diesel auto", "auto diesel", "diesel"])
    ) {
        return "diesel_auto";
    }

    if (
        containsAny(normalizedQuery, [
            "diesel heat",
            "heating diesel",
            "heat diesel",
        ])
    ) {
        return "diesel_heat";
    }

    if (containsAny(normalizedQuery, ["kerosene"])) {
        return "unlead_kerosene";
    }

    return undefined;
}

function inferIntent(query: string): Intent {
    const normalizedQuery = normalizeText(query);

    if (
        containsAny(normalizedQuery, [
            "what district",
            "which district",
            "district does",
            "belongs to",
        ])
    ) {
        return "district_lookup";
    }

    if (
        containsAny(normalizedQuery, [
            "areas belong to",
            "list areas",
            "all areas in",
            "areas in district",
        ])
    ) {
        return "district_areas";
    }

    if (
        containsAny(normalizedQuery, [
            "stations in",
            "stations inside",
            "stations for the district",
            "stations belonging to",
        ])
    ) {
        return "district_stations";
    }

    if (
        containsAny(normalizedQuery, [
            "best district",
            "compare districts",
            "district comparison",
            "which district is best",
        ]) ||
        (containsAny(normalizedQuery, ["districts", "district"]) &&
            containsAny(normalizedQuery, [
                "compare",
                "cheapest",
                "lowest",
                "best",
                "most expensive",
                "rank",
            ]))
    ) {
        return "district_comparison";
    }

    if (
        containsAny(normalizedQuery, [
            "nearest",
            "near me",
            "nearby",
            "closest",
        ])
    ) {
        return "nearby";
    }

    if (
        containsAny(normalizedQuery, [
            "cheapest",
            "lowest",
            "best price",
            "cheaper",
        ])
    ) {
        return "cheapest";
    }

    if (
        containsAny(normalizedQuery, [
            "most expensive",
            "highest price",
            "priciest",
        ])
    ) {
        return "most_expensive";
    }

    if (
        containsAny(normalizedQuery, [
            "average",
            "compare",
            "summary",
            "count",
            "how many",
        ])
    ) {
        return "summary";
    }

    if (
        containsAny(normalizedQuery, [
            "all regions",
            "regions",
            "districts",
            "map",
        ])
    ) {
        return "regions";
    }

    if (containsAny(normalizedQuery, ["raw", "json", "payload", "data"])) {
        return "raw";
    }

    return "search";
}

function pickDistrict(
    query: string,
    context: RouterContext,
): string | undefined {
    const normalizedQuery = normalizeText(query);

    for (const district of context.districts.districts) {
        if (
            normalizedQuery.includes(normalizeText(district.district_en)) ||
            normalizedQuery.includes(normalizeText(district.district_el)) ||
            normalizedQuery.includes(normalizeText(district.id))
        ) {
            return district.id;
        }

        for (const area of district.areas) {
            if (
                normalizedQuery.includes(normalizeText(area.name_en)) ||
                normalizedQuery.includes(normalizeText(area.name_el))
            ) {
                return district.id;
            }
        }
    }

    return undefined;
}

function extractDistrictIds(query: string, context: RouterContext): string[] {
    const normalizedQuery = normalizeText(query);
    const matchedDistricts = new Set<string>();

    for (const district of context.districts.districts) {
        if (
            normalizedQuery.includes(normalizeText(district.district_en)) ||
            normalizedQuery.includes(normalizeText(district.district_el)) ||
            normalizedQuery.includes(normalizeText(district.id))
        ) {
            matchedDistricts.add(district.id);
        }

        for (const area of district.areas) {
            if (
                normalizedQuery.includes(normalizeText(area.name_en)) ||
                normalizedQuery.includes(normalizeText(area.name_el))
            ) {
                matchedDistricts.add(district.id);
            }
        }
    }

    return Array.from(matchedDistricts);
}

function resolveStationDistrict(
    context: RouterContext,
    station: Station,
    region?: string,
) {
    const resolver = createDistrictResolver(context.districts.districts);

    return (
        resolveDistrictByArea(resolver, station.area_en) ??
        resolveDistrictByArea(resolver, station.area_el) ??
        (region ? resolveDistrictByName(resolver, region) : null)
    );
}

function buildStationCards(context: RouterContext, districtId?: string) {
    const districtResolver = createDistrictResolver(
        context.districts.districts,
    );

    return Object.entries(context.prices.prices).flatMap(([region, stations]) =>
        stations
            .map((station) => {
                const district = resolveStationDistrict(
                    context,
                    station,
                    region,
                );

                return {
                    region,
                    station,
                    district: district ? districtToText(district) : null,
                };
            })
            .filter(({ district }) => {
                if (!districtId) {
                    return true;
                }

                return (
                    district?.id === districtId ||
                    district?.district_en.toLowerCase() ===
                        normalizeText(districtId) ||
                    district?.district_el.toLowerCase() ===
                        normalizeText(districtId)
                );
            }),
    );
}

function districtStations(context: RouterContext, districtId: string) {
    return buildStationCards(context, districtId).filter(
        ({ district }) => district?.id === districtId,
    );
}

function stationWithContext(
    station: Station,
    district: ReturnType<typeof districtToText> | null,
    region: string,
) {
    return {
        ...station,
        region,
        district,
    };
}

function buildDistrictComparison(
    context: RouterContext,
    query: string,
    options: AskOptions,
) {
    const normalizedQuery = normalizeText(query);
    const fuelId = inferFuelId(query) ?? "unlead_95";
    const districtIds = extractDistrictIds(query, context);
    const rankedBy = containsAny(normalizedQuery, [
        "most expensive",
        "highest",
        "priciest",
    ])
        ? "max"
        : "average";
    const sortDirection = containsAny(normalizedQuery, [
        "most expensive",
        "highest",
        "priciest",
    ])
        ? -1
        : 1;

    const targetDistricts =
        districtIds.length > 0
            ? districtIds
            : context.districts.districts.map((district) => district.id);

    const districtSummaries = targetDistricts
        .map((districtId) => {
            const district = context.districts.districts.find(
                (entry) => entry.id === districtId,
            );

            if (!district) {
                return null;
            }

            const stations = districtStations(context, districtId);
            const pricedStations = stations
                .map(({ region, station }) => {
                    const price = station.prices.find(
                        (entry) => entry.id === fuelId,
                    );

                    if (!price) {
                        return null;
                    }

                    const numericValue = numericPrice(price.value);

                    return numericValue === null
                        ? null
                        : {
                              region,
                              station,
                              price,
                              numericValue,
                          };
                })
                .filter(
                    (entry): entry is NonNullable<typeof entry> =>
                        entry !== null,
                )
                .sort((left, right) => left.numericValue - right.numericValue);

            if (pricedStations.length === 0) {
                return {
                    district: districtToText(district),
                    station_count: stations.length,
                    priced_station_count: 0,
                    metric: rankedBy,
                    fuel_id: fuelId,
                    average_price: null,
                    cheapest_price: null,
                    most_expensive_price: null,
                    cheapest_station: null,
                    most_expensive_station: null,
                };
            }

            const prices = pricedStations.map((entry) => entry.numericValue);
            const average =
                prices.reduce((sum, value) => sum + value, 0) / prices.length;
            const cheapest = pricedStations[0];
            const mostExpensive = pricedStations[pricedStations.length - 1];

            return {
                district: districtToText(district),
                station_count: stations.length,
                priced_station_count: pricedStations.length,
                metric: rankedBy,
                fuel_id: fuelId,
                average_price: Number(average.toFixed(3)),
                cheapest_price: cheapest.numericValue,
                most_expensive_price: mostExpensive.numericValue,
                cheapest_station: {
                    ...stationWithContext(
                        cheapest.station,
                        (() => {
                            const cheapestDistrict = resolveStationDistrict(
                                context,
                                cheapest.station,
                                cheapest.region,
                            );
                            return cheapestDistrict
                                ? districtToText(cheapestDistrict)
                                : null;
                        })(),
                        cheapest.region,
                    ),
                    fuel_price: cheapest.price,
                },
                most_expensive_station: {
                    ...stationWithContext(
                        mostExpensive.station,
                        (() => {
                            const expensiveDistrict = resolveStationDistrict(
                                context,
                                mostExpensive.station,
                                mostExpensive.region,
                            );
                            return expensiveDistrict
                                ? districtToText(expensiveDistrict)
                                : null;
                        })(),
                        mostExpensive.region,
                    ),
                    fuel_price: mostExpensive.price,
                },
            };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort((left, right) => {
            const leftValue =
                rankedBy === "max"
                    ? (left.most_expensive_price ?? -Infinity)
                    : (left.average_price ?? -Infinity);
            const rightValue =
                rankedBy === "max"
                    ? (right.most_expensive_price ?? -Infinity)
                    : (right.average_price ?? -Infinity);

            return sortDirection * (leftValue - rightValue);
        });

    return {
        intent: "district_comparison",
        query,
        district_ids: targetDistricts,
        fuel_id: fuelId,
        ranking_metric: rankedBy,
        result_count: districtSummaries.length,
        results: districtSummaries.slice(0, options.limit ?? 10),
    };
}

function buildSearchResults(
    context: RouterContext,
    query: string,
    options: AskOptions,
) {
    const districtId = pickDistrict(query, context);
    const fuelId = inferFuelId(query);
    const queryLower = normalizeText(query);

    const matchedStations = buildStationCards(context, districtId).filter(
        ({ station, region }) => {
            const searchable = [
                station.brand,
                station.company,
                station.address,
                station.area_en,
                station.area_el,
                region,
                ...station.prices.map((price) => price.label),
                ...station.prices.map((price) => price.id),
            ]
                .join(" ")
                .toLowerCase();

            if (
                fuelId &&
                !station.prices.some((price) => price.id === fuelId)
            ) {
                return false;
            }

            return (
                searchable.includes(queryLower) ||
                queryLower
                    .split(/\s+/)
                    .some((term) => term && searchable.includes(term))
            );
        },
    );

    return {
        intent: "search",
        query,
        district_id: districtId ?? null,
        fuel_id: fuelId ?? null,
        result_count: matchedStations.length,
        results: matchedStations
            .slice(0, options.limit ?? 10)
            .map(({ region, station, district }) =>
                stationWithContext(station, district, region),
            ),
    };
}

function buildRankedResponse(
    context: RouterContext,
    query: string,
    options: AskOptions,
    mode: "cheapest" | "most_expensive",
) {
    const fuelId = inferFuelId(query) ?? "unlead_95";
    const districtId = pickDistrict(query, context);
    const queryLower = normalizeText(query);

    const ranked = buildStationCards(context, districtId)
        .filter(({ station, region }) => {
            if (queryLower.includes("online") && station.offline) {
                return false;
            }

            if (queryLower.includes("offline") && !station.offline) {
                return false;
            }

            if (
                queryLower.includes("area") &&
                !station.area_en &&
                !station.area_el
            ) {
                return false;
            }

            return station.prices.some(
                (price) =>
                    price.id === fuelId && numericPrice(price.value) !== null,
            );
        })
        .map(({ region, station }) => ({
            region,
            station,
            price: stationPrice(station, fuelId) ?? Number.POSITIVE_INFINITY,
        }))
        .sort((left, right) => left.price - right.price);

    const ordered = mode === "most_expensive" ? ranked.reverse() : ranked;

    return {
        intent: mode,
        query,
        district_id: districtId ?? null,
        fuel_id: fuelId,
        result_count: ordered.length,
        results: ordered
            .slice(0, options.limit ?? 10)
            .map(({ region, station, price }) => ({
                ...stationWithContext(
                    station,
                    (() => {
                        const stationDistrict = resolveStationDistrict(
                            context,
                            station,
                            region,
                        );
                        return stationDistrict
                            ? districtToText(stationDistrict)
                            : null;
                    })(),
                    region,
                ),
                fuel_price: {
                    id: fuelId,
                    value: String(price),
                    numeric_value: price,
                },
            })),
    };
}

export function routeQuestion(context: RouterContext, options: AskOptions) {
    const intent = inferIntent(options.query);
    const districtId = pickDistrict(options.query, context);
    const queryLower = normalizeText(options.query);

    if (intent === "district_lookup") {
        const district = context.districts.districts.find((entry) =>
            entry.areas.some(
                (area) =>
                    queryLower.includes(normalizeText(area.name_en)) ||
                    queryLower.includes(normalizeText(area.name_el)) ||
                    queryLower.includes(normalizeText(entry.district_en)) ||
                    queryLower.includes(normalizeText(entry.district_el)) ||
                    queryLower.includes(normalizeText(entry.id)),
            ),
        );

        if (!district) {
            return {
                intent,
                query: options.query,
                result: null,
            };
        }

        const matchedArea = district.areas.find(
            (area) =>
                queryLower.includes(normalizeText(area.name_en)) ||
                queryLower.includes(normalizeText(area.name_el)),
        );

        return {
            intent,
            query: options.query,
            district: districtToText(district),
            area: matchedArea ?? null,
            areas: district.areas,
        };
    }

    if (intent === "district_areas") {
        const district = context.districts.districts.find(
            (entry) =>
                queryLower.includes(normalizeText(entry.district_en)) ||
                queryLower.includes(normalizeText(entry.district_el)) ||
                queryLower.includes(normalizeText(entry.id)),
        );

        return {
            intent,
            query: options.query,
            district: district ? districtToText(district) : null,
            areas: district?.areas ?? [],
        };
    }

    if (intent === "district_stations") {
        return {
            intent,
            query: options.query,
            district_id: districtId ?? null,
            results: buildSearchResults(context, options.query, options)
                .results,
        };
    }

    if (intent === "district_comparison") {
        return buildDistrictComparison(context, options.query, options);
    }

    if (intent === "cheapest" || intent === "most_expensive") {
        return buildRankedResponse(context, options.query, options, intent);
    }

    if (intent === "nearby") {
        return {
            intent,
            query: options.query,
            note: "Use prices_nearby when latitude and longitude are available. This router detected a nearby-style question, but it needs GPS coordinates to rank distances reliably.",
            district_id: districtId ?? null,
            fuel_id: inferFuelId(options.query) ?? null,
        };
    }

    if (intent === "summary") {
        return {
            intent,
            query: options.query,
            district_id: districtId ?? null,
            fuel_id: inferFuelId(options.query) ?? null,
            result: {
                message:
                    "Use prices_summary for structured summaries, averages, and counts.",
            },
        };
    }

    if (intent === "regions") {
        return {
            intent,
            query: options.query,
            districts: context.districts.districts.map((district) =>
                districtToText(district),
            ),
        };
    }

    if (intent === "raw") {
        return {
            intent,
            query: options.query,
            message:
                "Use prices_raw or districts_area_map for full structured payloads.",
        };
    }

    return buildSearchResults(context, options.query, options);
}
