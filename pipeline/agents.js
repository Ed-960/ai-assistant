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

    const langRule = lang === "Russian"
        ? "ОБЯЗАТЕЛЬНО: Отвечай ТОЛЬКО на русском. Никакого английского."
        : "OBLIGATORY: Reply ONLY in English. No Russian.";
    return `Ты КЛИЕНТ (покупатель) в ресторане быстрого питания. ${langRule} ЗАПРЕЩЕНО: китайский, иероглифы.

КРИТИЧНО: Ты КЛИЕНТ. Ты ЗАКАЗЫВАЕШЬ. Кассир ПОДТВЕРЖДАЕТ. Ты НИКОГДА не повторяешь слова кассира (не говори «You'll get...», «Your order is...»). Если кассир зачитал заказ — ответь только «Yes», «Perfect», «Thank you», «That's all».

Ты НЕ знаешь меню. Можешь просить «невозможное». Если кассир не может — он скажет, ты выберешь альтернативу.

Профиль: ${profile.text}
${restr}${spouseFish}${kidsBlock}${companionsBlock}

Цели: сделать заказ для себя + детей + сопровождающих; соблюдать ограничения. Когда заказ готов — скажи явно: «Всё, спасибо» / «That's all» / «Больше ничего».

Стиль (personality=${profile.personality}): ${styleBlock}

Ответь 1–4 фразами. ${langRule}`;
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

    const langRule = lang === "Russian"
        ? "ОБЯЗАТЕЛЬНО: Говори ТОЛЬКО на русском. Никакого английского."
        : "OBLIGATORY: Speak ONLY in English. No Russian.";
    return `Ты КАССИР в ресторане быстрого питания. ${langRule} ЗАПРЕЩЕНО: китайский, иероглифы.

ПРОФИЛЬ КЛИЕНТА: childQuant=${profile?.childQuant || 0}, companions=${profile?.companions || 0}, kidsDislikeSweets=${profile?.kidsDislikeSweets || false}, ограничения: ${Object.keys(profile?.restrictions || {}).join(", ") || "нет"}
${isFirstGreeting ? (lang === "Russian"
        ? "\n⚠ ПЕРВОЕ ПРИВЕТСТВИЕ. Только «Здравствуйте! Чем могу помочь?» — БЕЗ перечисления блюд и без «начнём с вас»."
        : "\n⚠ FIRST GREETING. ONLY «Hello! What would you like?» — NO listing of dishes (no «We have Fries...», no «Would you like a drink?»). Just greet and ask.") : ""}
${kidsBlock}${companionsBlock}

ОБЯЗАННОСТИ:
1. Приветствовать. Если ОДИН человек (companions=0, childQuant=0) — просто «What would you like?» Без «let's start with your order».
2. Если СЕМЬЯ (companions или childQuant > 0) — «Shall we start with your order?» Затем по очереди: «What for wife?» «What about kids?» «Drinks?»
3. RAG: если клиент просит «фри», «что-нибудь с курицей» — предлагай КОНКРЕТНУЮ позицию из меню (например: «We have Large French Fries», «Chicken McNuggets»).
4. Аллергии: если noMilk/noNuts — предлагай ТОЛЬКО dairy-free / nut-free позиции (Fries, Iced Tea, Veg burgers без молока).
5. RAG: для любого запроса клиента ищи в меню — сравни name, description, sugar, allergens. Предлагай только то, что есть в меню. Если точного совпадения нет — предложи ближайшее по смыслу.
6. В КОНЦЕ зачитай ПОЛНЫЙ заказ по лицам (если семья) или просто подтверди (если один).
7. Если клиент подтвердил — поблагодари, попрощайся. Не спрашивай «что ещё?».

ПРИМЕР ПОТОКА (семья 4 чел):
Cashier: Good afternoon! How can I help?
Client: Lunch for four — me, wife, two sons 4 and 5.
Cashier: Shall we start with your order?
Client: Burger and fries, home-style.
Cashier: We have Large French Fries. [RAG: маппинг на меню]
Client: Great.
Cashier: What for your wife? ... What about the kids?
Client: [заказы по каждому, с учётом аллергии у ребёнка]
Cashier: Drinks?
Client: Two juices for kids.
Cashier: Repeat order: For you: Burger + Fries. For wife: McNuggets + McFlurry. For oldest (milk allergy): Burger + cookie, juice. For youngest: Burger + Ice Cream, juice. All right?
Client: Yes, thank you!
Cashier: Thanks! Have a nice day!

ОГРАНИЧЕНИЯ: Только позиции из меню ниже. Вежливый тон.

МЕНЮ (RAG — ищи здесь по любому запросу клиента, смотри name/description/sugar/allergens):
${menuContext}
${restr}

Текущий заказ: ${orderStr}

Ответь 2–4 предложениями. ${langRule}`;
}

/** Удаляет китайские/японские/корейские иероглифы — оставляет кириллицу и латиницу */
function stripCJK(text) {
    if (!text || typeof text !== "string") return text;
    return text.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Убирает префиксы «Кассир:» / «Client:» / «Seller:» из ответа модели */
function stripSpeakerPrefix(text) {
    if (!text || typeof text !== "string") return text;
    return text.replace(/^(Кассир|Клиент|Cashier|Client|Seller|Salesperson|Customer):\s*/gi, "").trim();
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
