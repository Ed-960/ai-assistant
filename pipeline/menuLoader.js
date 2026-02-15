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
            total_sugar: parseFloat(item.total_sugar) || 0,
            added_sugar: parseFloat(item.added_sugar) || 0,
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
function isSugarFree(item) {
    return (item.total_sugar || 0) < 1 && (item.added_sugar || 0) < 1;
}

export function searchMenu(menu, query, profile, limit = 50) {
    const filtered = menu.filter((item) => !conflictsWithProfile(item, profile));
    const q = (query || "").toLowerCase();
    const qWords = q.split(/\s+/).filter(Boolean);

    const wantsWaterOrSugarFree = /water|вода|sugar|сахар|без\s*сахара|sugar-free|no\s*sugar/.test(q);
    if (wantsWaterOrSugarFree) {
        const sugarFree = filtered.filter((i) => isSugarFree(i));
        if (sugarFree.length) return [...sugarFree, ...filtered.filter((i) => !isSugarFree(i))].slice(0, limit);
    }

    if (!qWords.length) return filtered.slice(0, limit);

    const scored = filtered
        .map((item) => {
            const text = `${item.name} ${item.description} ${item.ingredients}`.toLowerCase();
            let score = 0;
            for (const w of qWords) {
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
        .map((m) => {
            const sugar = (m.total_sugar ?? 0) + (m.added_sugar ?? 0);
            const sugarStr = sugar > 0 ? ` | sugar: ${sugar}g` : " | sugar: 0g";
            return `- ${m.name} (${m.serving_size}) | ${m.energy} kcal${sugarStr} | allergens: ${Array.isArray(m.allergy) ? m.allergy.join(", ") : m.allergy || "none"}`;
        })
        .join("\n");
}

/** Extract size pattern (e.g. 154g, 320g) from name for better matching */
function extractSize(name) {
    const m = (name || "").match(/(\d+)\s*g/i);
    return m ? m[1] : null;
}

export function findInMenu(menu, itemName) {
    const n = (itemName || "").trim().toLowerCase();
    const wantSize = extractSize(itemName);
    const candidates = menu.filter(
        (m) => m.name.toLowerCase().includes(n) || n.includes(m.name.toLowerCase().replace(/®/g, ""))
    );
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];
    if (wantSize) {
        const withSize = candidates.find((m) => m.name.includes(wantSize + "g") || m.name.includes(wantSize + " g"));
        if (withSize) return withSize;
    }
    return candidates[0];
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
