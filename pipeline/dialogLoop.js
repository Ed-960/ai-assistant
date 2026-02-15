/**
 * Generate one dialogue: Client vs Cashier, loop until terminate.
 */

import { generateProfile } from "./profileGenerator.js";
import { loadMenu, searchMenu, enrichMenuForKids } from "./menuLoader.js";
import { clientAgent, cashierAgent } from "./agents.js";
import { extractFinalOrder } from "./orderState.js";
import { validateDialog } from "./validation.js";
import { PIPELINE_CONFIG } from "./config.js";

const TERMINATE_PHRASES = [
    "yes", "да", "подтверждаю", "всё", "all", "that's all",
    "готово", "готов", "ок", "ok", "да, всё", "всё верно",
    "нет спасибо", "больше ничего", "на этом всё", "nothing else",
    "no thanks", "no thank you", "that's it", "no more",
    "всё, спасибо", "всё спасибо", "больше не надо",
];

/** Кассир уже попрощался — диалог завершён */
const CASHIER_CLOSING_PHRASES = [
    "приятного", "спасибо за заказ", "до свидания", "хорошего дня",
    "have a nice", "thank you for your order", "goodbye", "have a good",
];

function needsMenuSearch(text) {
    const t = (text || "").toLowerCase();
    return (
        t.includes("что") || t.includes("what") || t.includes("menu") ||
        t.includes("можно") || t.includes("есть") || t.includes("have") ||
        t.includes("without") || t.includes("без") || t.includes("с")
    );
}

function terminate(history, turnCount) {
    if (turnCount >= PIPELINE_CONFIG.maxTurns) return true;
    const last = history[history.length - 1];
    if (!last) return false;

    const t = (last.text || "").toLowerCase();
    // Клиент сказал «всё», «больше ничего» — завершаем
    if (last.speaker === "client" && TERMINATE_PHRASES.some((p) => t.includes(p))) return true;
    // Кассир попрощался — диалог естественно завершён
    if (last.speaker === "cashier" && CASHIER_CLOSING_PHRASES.some((p) => t.includes(p))) return true;
    return false;
}

/**
 * @returns {Promise<{history, profile, final_order, flags}>}
 */
export async function generateDialog(menu) {
    const profile = generateProfile();
    const history = [];
    let turnCount = 0;

    // First cashier greeting (retry до 2 раз). Если есть дети — добавляем McNuggets, Fries в контекст.
    const baseMenu = searchMenu(menu, "", profile, 30);
    const menuContext = enrichMenuForKids(baseMenu, profile, 25);
    let greeting = "";
    for (let a = 0; a < 2; a++) {
        greeting = (await cashierAgent(profile, [], { items: [] }, menuContext, true)).trim();
        if (greeting && greeting.length >= 3) break;
    }
    if (!greeting || greeting.length < 3) {
        greeting = profile.lang === "ru"
            ? "Здравствуйте! Чем могу помочь? Что желаете заказать?"
            : "Hello! How can I help you? What would you like to order?";
    }
    history.push({ speaker: "cashier", text: greeting });

    const clientFallbacks = {
        ru: ["Хочу заказать обед.", "Дайте бургер и колу.", "Что посоветуете?"],
        en: ["I'd like to order lunch.", "A burger and coke, please.", "What do you recommend?"],
    };
    const clientFallbacksChoice = {
        ru: ["Первый вариант.", "Давайте первый из предложенных.", "Подойдёт."],
        en: ["The first one, please.", "I'll take the first option.", "That works."],
    };
    const clientFallbacksDone = {
        ru: ["Всё, спасибо.", "Больше ничего.", "Готово."],
        en: ["That's all, thanks.", "Nothing else.", "I'm done."],
    };

    function pickClientFallback(lastCashierText, profile, turnCount) {
        const t = (lastCashierText || "").toLowerCase();
        const lang = profile.lang === "ru" ? "ru" : "en";
        if (turnCount === 0) {
            const arr = clientFallbacks[lang] || clientFallbacks.en;
            return arr[Math.floor(Math.random() * arr.length)];
        }
        if (/\b(else|ещё|друго|more|что ещё|anything else)\b/i.test(t)) {
            const arr = clientFallbacksDone[lang] || clientFallbacksDone.en;
            return arr[Math.floor(Math.random() * arr.length)];
        }
        const arr = clientFallbacksChoice[lang] || clientFallbacksChoice.en;
        return arr[Math.floor(Math.random() * arr.length)];
    }

    async function getClientResponse() {
        for (let attempt = 0; attempt < 3; attempt++) {
            const text = (await clientAgent(profile, history)).trim();
            if (text && text.length >= 2) return text;
        }
        const lastCashier = history.filter((h) => h.speaker === "cashier").pop();
        return turnCount < 6 ? pickClientFallback(lastCashier?.text, profile, turnCount) : null;
    }

    while (!terminate(history, turnCount)) {
        // Client turn (retry до 3 раз при пустом ответе)
        let clientText = await getClientResponse();
        if (!clientText) break;
        history.push({ speaker: "client", text: clientText });

        // RAG if needed
        let ragContext = menuContext;
        if (needsMenuSearch(clientText)) {
            const searched = searchMenu(menu, clientText, profile, 25);
            ragContext = enrichMenuForKids(searched, profile, 25);
        }

        // Cashier turn (retry до 3 раз при пустом ответе)
        const orderState = { items: [] };
        let cashierText = "";
        for (let a = 0; a < 3; a++) {
            cashierText = (await cashierAgent(profile, history, orderState, ragContext)).trim();
            if (cashierText && cashierText.length >= 2) break;
        }
        if (!cashierText || cashierText.length < 2) {
            cashierText = profile.lang === "ru" ? "Что ещё желаете?" : "Anything else?";
        }
        history.push({ speaker: "cashier", text: cashierText });

        turnCount++;
    }

    const final_order = await extractFinalOrder(history, menu, profile);
    const flags = validateDialog(history, profile, final_order, menu);

    return { history, profile, final_order, flags };
}
