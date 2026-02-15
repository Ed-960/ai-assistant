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

    const prompt = `Извлеки из диалога итоговый заказ как JSON-массив.

Правила:
- Клиент сказал "первый вариант" / "the first one" на предложение "A или B" → заказан A.
- Клиент сказал "подойдёт", "да", "давайте" на названное блюдо → оно в заказе.
- Кассир зачитал список и клиент подтвердил ("да", "всё верно") → весь зачитанный список в заказе.
- Только "что посоветуете?" без выбора → заказ пустой [].

Меню: ${menuNames}
Формат: [{"name": "точное имя из меню", "quantity": 1}]
Только JSON-массив, без текста.

Диалог:
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
