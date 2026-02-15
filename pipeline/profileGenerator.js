/**
 * Генератор профилей клиентов (REG — Referring Expression Generation).
 * База знаний: профиль P в формате JSON + текстовая строка для LLM.
 * Соответствует требованиям: «набор данных через пробелы, описывающий покупателя».
 */

const PERSONALITIES = ["friendly", "impatient", "indecisive", "polite_and_respectful", "regular"];
const LANGUAGES = ["ru", "en"];
const GENDERS = ["male", "female"];
const AGE_GROUPS = [
    { min: 18, max: 25, label: "young" },
    { min: 26, max: 40, label: "adult" },
    { min: 41, max: 55, label: "middle" },
    { min: 56, max: 70, label: "senior" },
];

/** Целевая калорийность по полу и возрасту (ккал) */
const CALORIE_RANGES = {
    young: [1800, 2800],
    adult: [2000, 2500],
    middle: [1800, 2200],
    senior: [1600, 2000],
};

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function coin(probability = 0.5) {
    return Math.random() < probability;
}

/**
 * Генерирует профиль P по алгоритму «бросания монетки».
 * @returns {Object} Профиль клиента (структурированный, JSON)
 */
export function generateProfile() {
    const gender = pick(GENDERS);
    const ageGroup = pick(AGE_GROUPS);
    const age = randomInt(ageGroup.min, ageGroup.max);
    const personality = pick(PERSONALITIES);
    const lang = pick(LANGUAGES);

    // Пищевые ограничения (логические признаки)
    const noMilk = coin(0.15);
    const noFish = coin(0.08);
    const noNuts = coin(0.1);
    const noEgg = coin(0.05);
    const noGluten = coin(0.05);
    const noSoya = coin(0.05);
    const noBeef = coin(0.08);
    const noSulphites = coin(0.02);

    const restrictions = {};
    if (noMilk) restrictions.noMilk = true;
    if (noFish) restrictions.noFish = true;
    if (noNuts) restrictions.noNuts = true;
    if (noEgg) restrictions.noEgg = true;
    if (noGluten) restrictions.noGluten = true;
    if (noSoya) restrictions.noSoya = true;
    if (noBeef) restrictions.noBeef = true;
    if (noSulphites) restrictions.noSulphites = true;

    // Семья и сопровождающие (небольшие целочисленные диапазоны)
    const childQuant = coin(0.25) ? randomInt(1, 3) : 0;
    const companions = coin(0.3) ? randomInt(0, 2) : 0;
    const hasPregnantWife = coin(0.05) && gender === "male";

    // Доп. признаки (по тексту диплома)
    const overweight = coin(0.2);
    const kidsDislikeSweets = coin(0.15) && childQuant > 0;
    const spouseAllergyFish = coin(0.05);

    // Целевая калорийность (по полу и возрастной группе)
    const [calMin, calMax] = CALORIE_RANGES[ageGroup.label];
    const calApprValue = randomInt(calMin, calMax);

    const profile = {
        gender,
        age,
        ageGroup: ageGroup.label,
        personality,
        lang,
        restrictions,
        childQuant,
        companions,
        hasPregnantWife,
        calApprValue,
        overweight: overweight || undefined,
        kidsDislikeSweets: kidsDislikeSweets || undefined,
        spouseAllergyFish: spouseAllergyFish || undefined,
    };

    profile.text = describeProfile(profile);
    profile.regLine = toRegLine(profile);
    return profile;
}

/**
 * REG-строка: «набор данных через пробелы» для базы знаний.
 * Формат: gender= male age= 38 personality= impatient noMilk childQuant= 2 ...
 */
export function toRegLine(p) {
    const parts = [];
    parts.push(`gender=${p.gender}`, `age=${p.age}`, `personality=${p.personality}`, `lang=${p.lang}`);
    Object.keys(p.restrictions || {}).forEach((k) => parts.push(k));
    if (p.childQuant) parts.push(`childQuant=${p.childQuant}`);
    if (p.companions) parts.push(`companions=${p.companions}`);
    if (p.hasPregnantWife) parts.push("hasPregnantWife");
    parts.push(`calApprValue=${p.calApprValue}`);
    if (p.overweight) parts.push("overweight");
    if (p.kidsDislikeSweets) parts.push("kidsDislikeSweets");
    if (p.spouseAllergyFish) parts.push("spouseAllergyFish");
    return parts.join(" ");
}

/**
 * Человекочитаемое описание для LLM (образ посетителя).
 * Примеры из диплома: «одинокий мужчина 38 лет», «еврей, отец семейства, две дочери, беременная жена».
 */
function describeProfile(p) {
    const lang = p.lang === "ru" ? "ru" : "en";
    const parts = [];

    if (lang === "ru") {
        parts.push(`${p.age} лет, ${p.gender === "male" ? "мужчина" : "женщина"}`);
        if (p.companions === 0 && p.childQuant === 0) parts.push("одинокий посетитель");
        if (p.childQuant) parts.push(`${p.childQuant} ребёнок/дети`);
        if (p.companions) parts.push(`${p.companions} сопровождающих`);
        if (p.hasPregnantWife) parts.push("беременная жена (осторожность с питанием)");
        if (p.overweight) parts.push("повышенный вес");
        if (p.spouseAllergyFish) parts.push("у спутника аллергия на рыбу");
        if (p.kidsDislikeSweets) parts.push("дети не любят сладкое");
        if (Object.keys(p.restrictions).length) {
            parts.push(`ограничения: ${Object.keys(p.restrictions).join(", ")}`);
        }
        parts.push(`целевые калории ≈${p.calApprValue} ккал`);
    } else {
        parts.push(`${p.age}-year-old ${p.gender}`);
        if (p.companions === 0 && p.childQuant === 0) parts.push("alone");
        if (p.childQuant) parts.push(`${p.childQuant} child(ren)`);
        if (p.companions) parts.push(`${p.companions} companion(s)`);
        if (p.hasPregnantWife) parts.push("pregnant wife (dietary caution)");
        if (p.overweight) parts.push("overweight");
        if (p.spouseAllergyFish) parts.push("companion has fish allergy");
        if (p.kidsDislikeSweets) parts.push("kids dislike sweets");
        if (Object.keys(p.restrictions).length) {
            parts.push(`restrictions: ${Object.keys(p.restrictions).join(", ")}`);
        }
        parts.push(`target calories ≈${p.calApprValue} kcal`);
    }

    return parts.join(". ") + ". ";
}
