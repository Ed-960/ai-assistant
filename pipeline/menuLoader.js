/**
 * Loads menu from CSV and provides RAG-style search + allergen filtering.
 */

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Papa from "papaparse";
import { ALLERGEN_MAP } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let menuCache = null;

/**
 * @param {string} csvPath - path relative to project root
 * @returns {Promise<Array>} Menu items with normalized fields
 */
export async function loadMenu(csvPath = "mcd.csv") {
    if (menuCache) return menuCache;

    const absPath = join(ROOT, csvPath);
    const raw = await readFile(absPath, "utf-8");
    const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });

    menuCache = parsed.data
        .filter((r) => r.name && r.name.trim())
        .map((item) => ({
            name: item.name.trim(),
            serving_size: item.serving_size || "",
            ingredients: item.ingredients || "",
            allergy: normalizeAllergy(item.allergy || ""),
            energy: parseFloat(item.energy) || 0,
            description: (item.description || "").trim().replace(/\s+/g, " "),
        }));

    return menuCache;
}

function normalizeAllergy(raw) {
    if (!raw || raw === "No Allergens") return [];
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Check if menu item conflicts with profile restrictions.
 * For noBeef: check ingredients/description (beef may not be in allergy field).
 * spouseAllergyFish: treat as noFish for companion.
 */
export function conflictsWithProfile(item, profile) {
    const restrictions = { ...(profile?.restrictions || {}) };
    if (profile?.spouseAllergyFish) restrictions.noFish = true;

    const itemAllergy = Array.isArray(item.allergy) ? item.allergy : [item.allergy].filter(Boolean);
    const itemText = `${item.ingredients || ""} ${item.description || ""}`.toLowerCase();

    for (const [key, keywords] of Object.entries(ALLERGEN_MAP)) {
        if (!restrictions[key]) continue;
        for (const kw of keywords) {
            const kwLow = kw.toLowerCase();
            if (key === "noBeef") {
                if (itemText.includes(kwLow)) return true;
            } else if (itemAllergy.some((a) => String(a).toLowerCase().includes(kwLow))) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Simple RAG: filter menu by query keywords and profile restrictions.
 * Returns top N items (by keyword overlap + no conflicts).
 */
export function searchMenu(menu, query, profile, limit = 15) {
    const filtered = menu.filter((item) => !conflictsWithProfile(item, profile));
    const q = (query || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!q.length) return filtered.slice(0, limit);

    const scored = filtered
        .map((item) => {
            const text = `${item.name} ${item.description} ${item.ingredients}`.toLowerCase();
            let score = 0;
            for (const w of q) {
                if (text.includes(w)) score += 1;
            }
            return { item, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.item);

    return scored.length ? scored : filtered.slice(0, limit);
}

export function formatMenuForContext(menuItems) {
    return menuItems
        .map(
            (m) =>
                `- ${m.name} (${m.serving_size}) | ${m.energy} kcal | allergens: ${Array.isArray(m.allergy) ? m.allergy.join(", ") : m.allergy || "none"}`
        )
        .join("\n");
}

export function findInMenu(menu, itemName) {
    const n = (itemName || "").trim().toLowerCase();
    return menu.find((m) => m.name.toLowerCase().includes(n) || n.includes(m.name.toLowerCase()));
}

export function existsInMenu(menu, itemName) {
    return !!findInMenu(menu, itemName);
}

/** Позиции, подходящие для детей (Happy Meal, McNuggets, Fries, McFlurry, Soft Serve). */
const KIDS_ITEM_KEYWORDS = [
    "mcnugget", "nugget", "fries", "mcflurry", "soft serve", "sundae",
    "kids", "happy", "child", "маленьк",
];

export function isKidsItem(itemName) {
    const n = (itemName || "").toLowerCase();
    return KIDS_ITEM_KEYWORDS.some((kw) => n.includes(kw));
}

export function hasKidsItems(finalOrderItems, menu) {
    return (finalOrderItems || []).some((i) => isKidsItem(i.name));
}

/**
 * Обогащает контекст меню детскими позициями, если childQuant > 0.
 * McNuggets, Fries ставятся в начало — кассир их увидит и предложит.
 */
export function enrichMenuForKids(menuItems, profile, limit = 25) {
    if (!profile?.childQuant || profile.childQuant <= 0) return menuItems.slice(0, limit);
    const kids = menuItems.filter((m) => isKidsItem(m.name));
    const rest = menuItems.filter((m) => !isKidsItem(m.name));
    return [...kids, ...rest].slice(0, limit);
}
