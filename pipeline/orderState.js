/**
 * Order state management and extraction from dialogue.
 */

import { findInMenu } from "./menuLoader.js";
import { callGroq } from "./api.js";

export function createOrderState() {
    return {
        items: [],
        total_energy: 0,
        allergens_in_order: [],
    };
}

/**
 * Extract final order from full dialogue using LLM
 */
export async function extractFinalOrder(history, menu, profile) {
    const menuNames = menu.map((m) => m.name).join(", ");
    const dialogue = history.map((t) => `${t.speaker}: ${t.text}`).join("\n");

    const menuLines = menu.map((m) => m.name).join("\n");
    const prompt = `Extract the final order from the dialogue as a JSON array.

Rules:
- Client said "first one" / "that one" to "A or B" → order A.
- Client said "yes", "perfect", "that's right" to a dish → it's in the order.
- Cashier read back the full list (e.g. "Fries 154g, McNuggets 320g, Coffee 250ml") and client confirmed → include ALL items with EXACT menu names including size.
- If cashier said "Our World Famous Fries (154g)" use the menu name with 154g. Same for McNuggets 320g, etc.
- "What do you recommend?" without choice → empty [].

MENU (use EXACT names including size):
${menuLines}

Format: [{"name": "exact name from menu", "quantity": 1}]
Output ONLY the JSON array, no other text.

Dialogue:
${dialogue}`;

    let content = await callGroq([{ role: "user", content: prompt }], 0.1) || "[]";
    const start = content.indexOf("[");
    const end = content.lastIndexOf("]") + 1;
    if (start >= 0 && end > start) {
        content = content.slice(start, end);
    }
    let items = [];
    try {
        items = JSON.parse(content);
    } catch {
        items = [];
    }

    const resolved = [];
    for (const it of items) {
        const name = typeof it === "string" ? it : (it?.name || "");
        const qty = typeof it === "object" && it?.quantity != null ? Math.max(1, it.quantity) : 1;
        const found = findInMenu(menu, name);
        if (found) {
            resolved.push({ name: found.name, quantity: qty, energy: found.energy });
        }
    }

    const total_energy = resolved.reduce((s, i) => s + i.energy * i.quantity, 0);
    const allergens_in_order = [...new Set(resolved.flatMap((i) => {
        const m = findInMenu(menu, i.name);
        return m?.allergy || [];
    }))];

    return {
        items: resolved,
        total_energy,
        allergens_in_order,
    };
}
