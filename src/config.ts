import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(filePath: string): void {
    if (!existsSync(filePath)) {
        return;
    }

    const content = readFileSync(filePath, "utf8");

    for (const line of content.split(/\r?\n/)) {
        const trimmedLine = line.trim();

        if (!trimmedLine || trimmedLine.startsWith("#")) {
            continue;
        }

        const separatorIndex = trimmedLine.indexOf("=");

        if (separatorIndex === -1) {
            continue;
        }

        const key = trimmedLine.slice(0, separatorIndex).trim();
        let value = trimmedLine.slice(separatorIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}

loadEnvFile(resolve(process.cwd(), ".env"));

const rapidApiKey = process.env.CYGAZ_RAPIDAPI_KEY;

if (!rapidApiKey) {
    throw new Error(
        "Missing CYGAZ_RAPIDAPI_KEY. Add it to .env or your process environment.",
    );
}

export const appConfig = {
    rapidApiKey,
    rapidApiHost: process.env.CYGAZ_RAPIDAPI_HOST ?? "cygaz.p.rapidapi.com",
    rapidApiUrl:
        process.env.CYGAZ_PRICES_URL ?? "https://cygaz.p.rapidapi.com/prices",
    pricesCacheDir: resolve(process.cwd(), ".cygaz-cache", "prices"),
    districtsCacheDir: resolve(process.cwd(), ".cygaz-cache", "districts"),
};
