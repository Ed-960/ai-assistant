/**
 * Single-shot dialog generation: one LLM call per dialogue or per batch.
 */

import { generateProfile } from "./profileGenerator.js";
import { loadMenu, searchMenu, enrichMenuForKids, formatMenuForContext } from "./menuLoader.js";
import { callGroq } from "./api.js";
import { extractFinalOrder } from "./orderState.js";
import { validateDialog } from "./validation.js";

function buildSingleShotPrompt(profile, menuContext) {
    const lang = profile?.lang === "ru" ? "Russian" : "English";
    const restr =
        Object.keys(profile?.restrictions || {}).length > 0
            ? `\nClient restrictions: ${Object.keys(profile.restrictions).join(", ")}. Cashier offers ONLY items that fit. Client does NOT order restricted items.`
            : "";
    const kidsBlock =
        profile?.childQuant > 0
            ? `\n⚠ FAMILY: Client has ${profile.childQuant} child(ren). Cashier MUST ask "What about the kids?" and suggest McNuggets, Fries, soft drinks. Client orders FOR EACH PERSON.`
            : "";
    const companionsBlock =
        profile?.companions > 0
            ? `\n⚠ COMPANIONS: Client has ${profile.companions} companion(s). Cashier MUST say "Shall we start with your order?" then "What for your companion?" — client orders SEPARATELY for each person.`
            : "";

    return `Generate a complete fast-food restaurant dialogue between Cashier and Client in one response.

CLIENT PROFILE: ${profile?.text}
${restr}${kidsBlock}${companionsBlock}

LANGUAGE: ${lang}. Speak ONLY in ${lang === "Russian" ? "Russian" : "English"}. No mixing.

RULES (RAG — use ONLY items from MENU below):
- Cashier greets: "Hello! What would you like?" (no dish listing).
- Client orders. If vague ("something with chicken") — Cashier suggests from MENU (e.g. Chicken McNuggets®).
- Cashier MUST suggest drink: "Would you like a drink?" — client picks from menu.
- Cashier MUST ask "Anything else?" before finalizing.
- At end: Cashier reads back FULL order WITH sizes (e.g. "Fries 154g, McNuggets 320g"). Client confirms. Goodbye.
- 12–18 turns. NO shortcuts. Full flow: greet → main order → drink suggestion → "anything else?" → readback → confirm → goodbye.

OUTPUT FORMAT (one line per turn):
Cashier: [text]
Client: [text]
...

MENU (use EXACT names, filter by restrictions):
${menuContext}
`;
}

/** Parse "Cashier: ..." / "Client: ..." lines into turns */
function parseDialogText(raw) {
    const turns = [];
    const lines = (raw || "").split(/\n/).map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
        const m = line.match(/^(Cashier|Client|Кассир|Клиент):\s*(.*)$/i);
        if (m) {
            const speaker = /cashier|кассир/i.test(m[1]) ? "cashier" : "client";
            const text = m[2].trim();
            if (text) turns.push({ speaker, text });
        }
    }
    return turns;
}

/**
 * @returns {Promise<{history, profile, final_order, flags}>}
 */
export async function generateDialogSingleShot(menu) {
    const profile = generateProfile();
    const baseMenu = searchMenu(menu, "", profile, 999);
    const menuContext = formatMenuForContext(enrichMenuForKids(baseMenu, profile, 999));

    const prompt = buildSingleShotPrompt(profile, menuContext);
    const system = "You are a dialogue generator. Output ONLY the dialogue in the required format. No explanations.";
    const raw = await callGroq(
        [{ role: "system", content: system }, { role: "user", content: prompt }],
        0.5,
        3,
        3072
    );

    let history = parseDialogText(raw);

    // Ensure cashier starts and we have at least 2 turns
    if (history.length === 0) {
        history = [
            { speaker: "cashier", text: profile.lang === "ru" ? "Здравствуйте! Чем могу помочь?" : "Hello! What would you like?" },
            { speaker: "client", text: profile.lang === "ru" ? "Бургер и колу, пожалуйста." : "A burger and coke, please." },
        ];
    }
    if (history[0]?.speaker === "client") {
        const greeting = profile.lang === "ru"
            ? "Здравствуйте! Чем могу помочь?"
            : "Hello! What would you like?";
        history.unshift({ speaker: "cashier", text: greeting });
    }

    const final_order = await extractFinalOrder(history, menu, profile);
    const flags = validateDialog(history, profile, final_order, menu);

    return { history, profile, final_order, flags };
}

/** Order-type hints to force variety across batch */
const ORDER_TYPES = [
    "burger + fries + drink (e.g. McChicken, Fries, Cold Coffee)",
    "McNuggets + fries + soft drink",
    "vegetarian meal (McAloo Tikki, McVeggie, or Paneer burger + drink)",
    "dessert + coffee (McFlurry or Sundae + Cold Coffee / Black Coffee)",
    "wrap + drink (Spicy Chicken or Paneer Wrap)",
    "quick snack (Fries + Iced Tea or Black Coffee)",
    "family order: 2 different burgers + fries + 2 drinks",
];

/**
 * Generate N different dialogues in ONE API call. Each has a different profile and order type.
 * @param {Array} menu
 * @param {number} batchSize - 3–6 recommended (fits in context, stays diverse)
 * @returns {Promise<Array<{history, profile, final_order, flags}>>}
 */
export async function generateDialogsBatch(menu, batchSize = 4) {
    const n = Math.min(Math.max(3, batchSize), 6);
    const profiles = [];
    const usedPersonalities = new Set();
    let hasFamily = false;
    for (let i = 0; i < n; i++) {
        let p = generateProfile();
        while (usedPersonalities.has(p.personality) && usedPersonalities.size < 5) {
            p = generateProfile();
        }
        if (i === 0 && !hasFamily) {
            for (let k = 0; k < 15 && (p.childQuant === 0 && p.companions === 0); k++) {
                const alt = generateProfile();
                if (alt.childQuant > 0 || alt.companions > 0) {
                    p = alt;
                    break;
                }
            }
        }
        if (p.childQuant > 0 || p.companions > 0) hasFamily = true;
        usedPersonalities.add(p.personality);
        profiles.push(p);
    }

    const shuffled = [...ORDER_TYPES].sort(() => Math.random() - 0.5);
    const orderHints = shuffled.slice(0, n).map((h, i) => `Dialog ${i + 1}: ${h}`).join("\n");

    const dialogBlocks = [];
    for (let i = 0; i < n; i++) {
        const p = profiles[i];
        const baseMenu = searchMenu(menu, "", p, 999);
        const ragMenu = enrichMenuForKids(baseMenu, p, 999);
        const menuCtx = formatMenuForContext(ragMenu);
        let flow = "";
        if (p.companions > 0) flow += ` Cashier MUST ask "What for your companion?" — order for each.`;
        if (p.childQuant > 0) flow += ` Cashier MUST ask "What about the kids?" — McNuggets, Fries, drinks.`;
        const restr = Object.keys(p.restrictions || {}).length ? ` Restrictions: ${Object.keys(p.restrictions).join(", ")}.` : "";
        dialogBlocks.push(`=== DIALOG ${i + 1} PROFILE ===
${p.text}${restr} Lang: ${p.lang}. Personality: ${p.personality}.${flow}

MENU (RAG, use ONLY these for Dialog ${i + 1}):
${menuCtx}`);
    }

    const prompt = `Generate ${n} DIFFERENT fast-food dialogues. Each dialog uses ONLY its own MENU (RAG-filtered).

${dialogBlocks.join("\n\n")}

ORDER DIVERSITY: ${orderHints}

RULES (12–18 turns per dialog):
- Greet → order (per person if companions/kids) → suggest drink → "Anything else?" → readback with sizes → confirm → goodbye.
- Format: Cashier: [text] or Client: [text]

OUTPUT — separate each with ===DIALOG N===
===DIALOG 1===
Cashier: Hello! What would you like?
Client: ...
===DIALOG 2===
...
`;

    const system = "Output ONLY the dialogues. No explanations. Each dialog must use DIFFERENT menu items.";
    const raw = await callGroq(
        [{ role: "system", content: system }, { role: "user", content: prompt }],
        0.6,
        3,
        6144
    );

    const chunks = (raw || "").split(/===\s*DIALOG\s+\d+\s*===/i).map((s) => s.trim()).filter(Boolean);
    const results = [];

    for (let i = 0; i < Math.min(n, chunks.length); i++) {
        let history = parseDialogText(chunks[i]);
        const profile = profiles[i];

        if (history.length < 2) {
            history = [
                { speaker: "cashier", text: profile.lang === "ru" ? "Здравствуйте! Чем могу помочь?" : "Hello! What would you like?" },
                { speaker: "client", text: profile.lang === "ru" ? "Бургер и колу." : "A burger and coke, please." },
            ];
        }
        if (history[0]?.speaker === "client") {
            history.unshift({
                speaker: "cashier",
                text: profile.lang === "ru" ? "Здравствуйте! Чем могу помочь?" : "Hello! What would you like?",
            });
        }

        const final_order = await extractFinalOrder(history, menu, profile);
        const flags = validateDialog(history, profile, final_order, menu);
        results.push({ history, profile, final_order, flags });
    }

    return results;
}
