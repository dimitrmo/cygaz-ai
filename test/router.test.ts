import assert from "node:assert/strict";
import test from "node:test";

import type { CachedDistricts } from "../src/districts.js";
import type { CachedPrices } from "../src/prices.js";

process.env.CYGAZ_RAPIDAPI_KEY ??= "test-rapidapi-key";
process.env.CYGAZ_RAPIDAPI_HOST ??= "cygaz.p.rapidapi.com";
process.env.CYGAZ_PRICES_URL ??= "https://cygaz.p.rapidapi.com/prices";
process.env.CYGAZ_DISTRICTS_URL ??= "https://cygaz.p.rapidapi.com/districts";

const { routeQuestion } = await import("../src/router.js");
const { buildDistrictAreaCount, buildDistrictDetails } = await import(
    "../src/districts.js"
);

type RouterResult = ReturnType<typeof routeQuestion>;

type DistrictLookupResult = {
    intent: "district_lookup";
    district: { id: string } | null;
    area: { name_en: string; name_el: string } | null;
};

type DistrictComparisonResult = {
    intent: "district_comparison";
    ranking_metric: string;
    district_ids: string[];
    results: Array<{
        district: { id: string };
        average_price?: number | null;
        cheapest_price?: number | null;
        cheapest_station?: {
            latitude: string;
            longitude: string;
            prices: Array<{ id: string; value: string }>;
        } | null;
    }>;
};

type CheapestResult = {
    intent: "cheapest";
    results: Array<{
        latitude: string;
        longitude: string;
        address: string;
        prices: Array<{ id: string; value: string }>;
    }>;
};

function expectDistrictLookup(result: RouterResult): DistrictLookupResult {
    assert.equal(result.intent, "district_lookup");
    assert.ok("district" in result);
    assert.ok("area" in result);
    return result as DistrictLookupResult;
}

function expectDistrictComparison(result: RouterResult): DistrictComparisonResult {
    assert.equal(result.intent, "district_comparison");
    assert.ok("results" in result);
    assert.ok("district_ids" in result);
    assert.ok("ranking_metric" in result);
    return result as DistrictComparisonResult;
}

function expectCheapest(result: RouterResult): CheapestResult {
    assert.equal(result.intent, "cheapest");
    assert.ok("results" in result);
    return result as CheapestResult;
}

const baseDistricts: CachedDistricts = {
    cache_key: "district-cache",
    cached_at: "2026-05-28T00:00:00.000Z",
    source_url: "https://cygaz.p.rapidapi.com/districts",
    districts: [
        {
            id: "famagusta",
            district_en: "Famagusta",
            district_el: "Αμμόχωστος",
            areas: [
                { name_en: "Agia Napa", name_el: "Αγία Νάπα" },
                { name_en: "Protaras", name_el: "Πρωταράς" },
            ],
        },
        {
            id: "larnaca",
            district_en: "Larnaca",
            district_el: "Λάρνακα",
            areas: [{ name_en: "Larnaca", name_el: "Λάρνακα" }],
        },
    ],
};

const basePrices: CachedPrices = {
    updated_at: 1,
    updated_at_str: "2026-05-28 00:00:00.000 UTC",
    cache_key: "price-cache",
    cached_at: "2026-05-28T00:00:00.000Z",
    source_url: "https://cygaz.p.rapidapi.com/prices",
    prices: {
        famagusta: [
            {
                brand: "SHELL",
                offline: false,
                company: "Example Famagusta A",
                address: "Street 1",
                latitude: "35.0",
                longitude: "33.0",
                area_en: "Agia Napa",
                area_el: "Αγία Νάπα",
                prices: [
                    {
                        kind: 1,
                        id: "unlead_95",
                        label: "Unlead 95",
                        value: "1.00",
                    },
                    {
                        kind: 2,
                        id: "unlead_98",
                        label: "Unlead 98",
                        value: "1.10",
                    },
                ],
            },
            {
                brand: "ESSO",
                offline: false,
                company: "Example Famagusta B",
                address: "Street 2",
                latitude: "35.1",
                longitude: "33.1",
                area_en: "Protaras",
                area_el: "Πρωταράς",
                prices: [
                    {
                        kind: 1,
                        id: "unlead_95",
                        label: "Unlead 95",
                        value: "1.10",
                    },
                    {
                        kind: 2,
                        id: "unlead_98",
                        label: "Unlead 98",
                        value: "1.20",
                    },
                ],
            },
        ],
        larnaca: [
            {
                brand: "EKO",
                offline: false,
                company: "Example Larnaca A",
                address: "Street 3",
                latitude: "34.9",
                longitude: "33.4",
                area_en: "Larnaca",
                area_el: "Λάρνακα",
                prices: [
                    {
                        kind: 1,
                        id: "unlead_95",
                        label: "Unlead 95",
                        value: "1.25",
                    },
                    {
                        kind: 2,
                        id: "unlead_98",
                        label: "Unlead 98",
                        value: "1.35",
                    },
                ],
            },
        ],
    },
};

const context = {
    prices: basePrices,
    districts: baseDistricts,
};

test("routes an area-to-district lookup", () => {
    const result = routeQuestion(context, {
        query: "Which district does Agia Napa belong to?",
    });

    const districtLookup = expectDistrictLookup(result);
    assert.equal(districtLookup.district?.id, "famagusta");
    assert.equal(districtLookup.area?.name_en, "Agia Napa");
});

test("ranks districts for a best-district question", () => {
    const result = routeQuestion(context, {
        query: "best district for Unlead 95",
    });

    const comparison = expectDistrictComparison(result);
    assert.equal(comparison.ranking_metric, "average");
    assert.equal(comparison.results[0].district.id, "famagusta");
    assert.equal(comparison.results[0].average_price, 1.05);
    assert.equal(comparison.results[1].district.id, "larnaca");
});

test("compares specific districts for a fuel question", () => {
    const result = routeQuestion(context, {
        query: "compare cheapest Unlead 95 across Famagusta and Larnaca districts",
    });

    const comparison = expectDistrictComparison(result);
    assert.deepEqual(comparison.district_ids, ["famagusta", "larnaca"]);
    assert.equal(comparison.results[0].district.id, "famagusta");
    assert.equal(comparison.results[1].district.id, "larnaca");
    assert.equal(comparison.results[0].cheapest_price, 1.0);
    assert.equal(comparison.results[1].cheapest_price, 1.25);
});

test("includes full station payload with coordinates in cheapest results", () => {
    const result = routeQuestion(context, { query: "cheapest unlead 95" });

    const cheapest = expectCheapest(result);
    assert.equal(cheapest.results[0].latitude, "35.0");
    assert.equal(cheapest.results[0].longitude, "33.0");
    assert.equal(cheapest.results[0].address, "Street 1");
    assert.equal(cheapest.results[0].prices.length, 2);
});

test("includes full station payload with coordinates in district comparison extremes", () => {
    const result = routeQuestion(context, {
        query: "best district for Unlead 95",
    });

    const comparison = expectDistrictComparison(result);
    assert.ok(comparison.results[0].cheapest_station);
    assert.equal(comparison.results[0].cheapest_station?.latitude, "35.0");
    assert.equal(comparison.results[0].cheapest_station?.longitude, "33.0");
    assert.equal(comparison.results[0].cheapest_station?.prices.length, 2);
});

test("supports district alias matching for pafos in district details", () => {
    const details = buildDistrictDetails(
        [
            {
                id: "paphos",
                district_en: "Paphos",
                district_el: "Πάφος",
                areas: [
                    { name_en: "Kato Paphos", name_el: "Κάτω Πάφος" },
                    { name_en: "Chloraka", name_el: "Χλώρακα" },
                ],
            },
        ],
        "pafos",
    );

    assert.ok(details);
    assert.equal(details?.match_type, "district");
    assert.equal(details?.district.id, "paphos");
});

test("returns area count for alias-aware district queries", () => {
    const result = buildDistrictAreaCount(
        [
            {
                id: "paphos",
                district_en: "Paphos",
                district_el: "Πάφος",
                areas: [
                    { name_en: "Kato Paphos", name_el: "Κάτω Πάφος" },
                    { name_en: "Chloraka", name_el: "Χλώρακα" },
                    { name_en: "Yeroskipou", name_el: "Γεροσκήπου" },
                ],
            },
        ],
        "pafos",
    );

    assert.ok(result);
    assert.equal(result?.district.id, "paphos");
    assert.equal(result?.area_count, 3);
});
