/**
 * LLM agents: Client (customer) and Cashier.
 * Algorithm 3: InitAgents — системные промпты по диплому.
 */

import { formatMenuForContext } from "./menuLoader.js";
import { callGroq } from "./api.js";

const PERSONALITY_STYLES = {
    friendly: "Тепло, благодарно, 2–4 развёрнутые фразы (например: «Спасибо! Вы так помогаете. Давайте бургер и колу.»)",
    impatient: "Коротко и прямо — минимум слов (например: «Бургер. Кола. Всё.»)",
    indecisive: "Сомнения, просьба совета (например: «Хм, не знаю... Что бы вы взяли на моём месте?»)",
    polite_and_respectful: "Формально, вежливо (например: «Будьте добры, один бургер и напиток»)",
    regular: "Нейтрально, стандартно.",
};

const PERSONALITY_STYLES_EN = {
    friendly: "Warm, thankful, 2–4 phrases (e.g. «Thanks! That helps. I'll take a burger and coke.»)",
    impatient: "Short and direct — minimal words (e.g. «Burger. Coke. Done.»)",
    indecisive: "Hesitant, ask for advice (e.g. «Hmm, not sure... What would you get?»)",
    polite_and_respectful: "Formal, polite (e.g. «Could I have one burger and a drink, please»)",
    regular: "Neutral, standard.",
};

/**
 * SystemPromptClient per Algorithm 3:
 * Role: customer at a fast-food restaurant.
 * Goals: place an order for self and companions; ask clarifying questions when needed.
 * Requirements: respect dietary restrictions and allergies in client profile.
 * Separate style block for each personality type.
 */
function buildClientPrompt(profile) {
    const lang = profile.lang === "ru" ? "Russian" : "English";
    const styleMap = lang === "Russian" ? PERSONALITY_STYLES : PERSONALITY_STYLES_EN;
    const styleBlock = styleMap[profile.personality] || styleMap.regular;

    const restr =
        Object.keys(profile.restrictions || {}).length > 0
            ? `\nКРИТИЧНО: У клиента ограничения: ${Object.keys(profile.restrictions).join(", ")}. НЕ заказывай позиции, нарушающие эти ограничения.`
            : "";
    const spouseFish =
        profile.spouseAllergyFish
            ? (lang === "Russian" ? "\nУ спутника аллергия на рыбу — не заказывай рыбные блюда." : "\nCompanion has fish allergy — do not order fish items.")
            : "";

    const kidsBlock =
        profile.childQuant > 0
            ? (lang === "Russian"
                ? `\nОБЯЗАТЕЛЬНО: У тебя ${profile.childQuant} ребёнок/дети. Ты заказываешь ДЛЯ ВСЕХ — включи еду для детей (McNuggets, Fries, напитки без алкоголя). Если kidsDislikeSweets — не бери сладкие десерты для детей.`
                : `\nREQUIRED: You have ${profile.childQuant} child(ren). Order FOR EVERYONE — include kid items (McNuggets, Fries, soft drinks). If kidsDislikeSweets — no sweet desserts for kids.`)
            : "";

    const companionsBlock =
        profile.companions > 0
            ? (lang === "Russian"
                ? `\nУ тебя ${profile.companions} сопровождающих — закажи и для них.`
                : `\nYou have ${profile.companions} companion(s) — order for them too.`)
            : "";

    return `Ты КЛИЕНТ (покупатель) в ресторане быстрого питания. Говори СТРОГО на ${lang === "Russian" ? "русском" : "английском"}. ЗАПРЕЩЕНО: китайский, иероглифы — только латиница/кириллица.

КРИТИЧНО: Ты ЗАКАЗЫВАЕШЬ, кассир ПРЕДЛАГАЕТ. Ты НЕ спрашиваешь «что выбрать», «какой взять» — это говорит кассир. Ты только ОТВЕЧАЕШЬ на вопросы кассира и ЗАКАЗЫВАЕШЬ еду. Никогда не говори от лица кассира.

Ты НЕ знаешь меню. Можешь просить «невозможное». Если кассир не может — он скажет, ты выберешь альтернативу.

Профиль: ${profile.text}
${restr}${spouseFish}${kidsBlock}${companionsBlock}

Цели: сделать заказ для себя + детей + сопровождающих; соблюдать ограничения. Когда заказ готов — скажи явно: «Всё, спасибо» / «That's all» / «Больше ничего».

Стиль (personality=${profile.personality}): ${styleBlock}

Ответь 1–4 фразами. Коротко. Только кириллица/латиница.`;
}

/**
 * SystemPromptCashier per Algorithm 3:
 * Role: cashier at a fast-food restaurant.
 * Duties: greet; clarify order; suggest add-ons (drinks, desserts, kids meals); check allergen conflicts; DO NOT confirm if conflicts remain; always read back full order.
 * Constraints: only items from RAG context; do not invent menu items; polite neutral tone.
 */
function buildCashierPrompt(menuContext, orderState, profile, isFirstGreeting = false) {
    const lang = profile?.lang === "ru" ? "Russian" : "English";
    const orderStr = orderState.items.length
        ? JSON.stringify(orderState.items, null, 2)
        : "[]";
    let restr =
        profile?.restrictions && Object.keys(profile.restrictions).length
            ? `\nКРИТИЧНО: У клиента ограничения ${Object.keys(profile.restrictions).join(", ")}. Предлагай ТОЛЬКО позиции из списка ниже (уже отфильтрованы).`
            : "";
    if (profile?.spouseAllergyFish) {
        restr += lang === "Russian"
            ? "\nУ спутника аллергия на рыбу — не предлагай рыбные позиции."
            : "\nCompanion has fish allergy — do not suggest fish items.";
    }

    const kidsBlock =
        profile?.childQuant > 0
            ? (lang === "Russian"
                ? `\nОБЯЗАТЕЛЬНО: У клиента ${profile.childQuant} детей. Предложи детские позиции: McNuggets, Fries (картофель фри), напитки. Если kidsDislikeSweets — не предлагай McFlurry/Sundae для детей.`
                : `\nREQUIRED: Client has ${profile.childQuant} child(ren). Suggest kid items: McNuggets, Fries, drinks. If kidsDislikeSweets — no McFlurry/Sundae for kids.`)
            : "";

    const companionsBlock =
        profile?.companions > 0
            ? (lang === "Russian"
                ? `\nУ клиента ${profile.companions} сопровождающих — предложи еду и для них.`
                : `\nClient has ${profile.companions} companion(s) — suggest food for them too.`)
            : "";

    return `Ты КАССИР в ресторане быстрого питания. Говори СТРОГО на ${lang === "Russian" ? "русском" : "английском"}. ЗАПРЕЩЕНО: китайский, иероглифы — только кириллица/латиница.

ПРОФИЛЬ КЛИЕНТА: childQuant=${profile?.childQuant || 0}, companions=${profile?.companions || 0}, kidsDislikeSweets=${profile?.kidsDislikeSweets || false}, ограничения: ${Object.keys(profile?.restrictions || {}).join(", ") || "нет"}
${isFirstGreeting ? (lang === "Russian" ? "\n⚠ ПЕРВОЕ ПРИВЕТСТВИЕ. Ответь ТОЛЬКО на русском. Текст: приветствие + «Чем могу помочь? Что желаете заказать?» Без перечисления блюд." : "\n⚠ FIRST GREETING. Reply ONLY in English. Say: hello + «What would you like to order?» No menu items.") : ""}
${kidsBlock}${companionsBlock}

ОБЯЗАННОСТИ:
1. Приветствовать клиента.
2. Уточнять детали заказа.
3. Предлагать дополнения: напитки, десерты. Если есть дети — ОБЯЗАТЕЛЬНО предложи McNuggets, Fries.
4. Проверять аллергены. НЕ подтверждать заказ при конфликте.
5. В конце зачитать полный заказ для подтверждения.
6. Если клиент сказал «всё», «больше ничего», «ничего» — ЗАВЕРШИ диалог: кратко подтверди заказ, поблагодари, попрощайся. НЕ спрашивай снова «что ещё?».

ОГРАНИЧЕНИЯ: Только позиции из меню ниже. Вежливый тон. Диалог должен быть коротким — 4–8 реплик обычно достаточно.

МЕНЮ:
${menuContext}
${restr}

Текущий заказ: ${orderStr}

Ответь 2–4 предложениями. Только кириллица или латиница.`;
}

/** Удаляет китайские/японские/корейские иероглифы — оставляет кириллицу и латиницу */
function stripCJK(text) {
    if (!text || typeof text !== "string") return text;
    return text.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Убирает префиксы «Кассир:» / «Client:» из ответа модели */
function stripSpeakerPrefix(text) {
    if (!text || typeof text !== "string") return text;
    return text.replace(/^(Кассир|Клиент|Cashier|Client):\s*/gi, "").trim();
}

/**
 * Client agent: generates next customer utterance
 */
export async function clientAgent(profile, history) {
    const system = buildClientPrompt(profile);
    const lang = profile?.lang === "ru" ? "ru" : "en";
    const messages = [{ role: "system", content: system }];
    const prefix = lang === "ru" ? { cashier: "Кассир: ", client: "Клиент: " } : { cashier: "Cashier: ", client: "Client: " };

    for (const turn of history) {
        const role = turn.speaker === "client" ? "assistant" : "user";
        const content = `${turn.speaker === "cashier" ? prefix.cashier : prefix.client}${turn.text}`;
        messages.push({ role, content });
    }

    let text = await callGroq(messages, 0.6);
    text = stripCJK(text);
    text = stripSpeakerPrefix(text);
    return text;
}

/**
 * Cashier agent: generates next cashier response
 */
export async function cashierAgent(profile, history, orderState, menuContext, isFirstGreeting = false) {
    const context = formatMenuForContext(menuContext);
    const system = buildCashierPrompt(context, orderState, profile, isFirstGreeting);
    const messages = [{ role: "system", content: system }];
    const lang = profile?.lang === "ru" ? "ru" : "en";
    const prefix = lang === "ru" ? { cashier: "Кассир: ", client: "Клиент: " } : { cashier: "Cashier: ", client: "Client: " };

    for (const turn of history) {
        const role = turn.speaker === "cashier" ? "assistant" : "user";
        const content = `${turn.speaker === "cashier" ? prefix.cashier : prefix.client}${turn.text}`;
        messages.push({ role, content });
    }

    let text = await callGroq(messages, 0.3);
    text = stripCJK(text);
    text = stripSpeakerPrefix(text);
    return text;
}
