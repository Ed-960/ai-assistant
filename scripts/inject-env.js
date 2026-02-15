#!/usr/bin/env node
/**
 * Читает .env и генерирует config.generated.js для фронтенда (браузер не читает .env).
 * Запуск: node scripts/inject-env.js или npm run inject
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const envPath = join(root, ".env");
const outPath = join(root, "config.generated.js");

function parseEnv(content) {
    const vars = {};
    for (const line of content.split("\n")) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
    return vars;
}

let env = {};
try {
    env = parseEnv(readFileSync(envPath, "utf-8"));
} catch {
    console.warn("No .env found. Run: cp .env.example .env");
}

const key = env.GROQ_API_KEY || "";
const out = `// Generated from .env — do not edit
CONFIG = typeof CONFIG !== "undefined" ? CONFIG : {};
CONFIG.groqApiKey = ${JSON.stringify(key)};
`;

writeFileSync(outPath, out, "utf-8");
console.log("config.generated.js written");
