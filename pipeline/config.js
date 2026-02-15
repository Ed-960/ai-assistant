/** Pipeline configuration (читает .env через dotenv) */
import "dotenv/config";

export const PIPELINE_CONFIG = {
    /** API provider: "ollama" | "groq" | "zai" */
    apiProvider: process.env.API_PROVIDER || "ollama",

    // --- Ollama (локально, без лимитов) ---
    ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434/v1/chat/completions",

    // --- Groq (раскомментировать при необходимости) ---
    // groqApiKey: process.env.GROQ_API_KEY || "gsk_...",

    // --- Z.ai (раскомментировать при необходимости) ---
    // zaiApiKey: process.env.ZAI_API_KEY || "...",
    // zaiApiUrl: "https://api.z.ai/api/paas/v4/chat/completions",

    /** Model: qwen3:1.7b — компромисс скорость/качество (1.4GB). Варианты: qwen3:1.7b, qwen3:4b, qwen3:8b */
    model: process.env.API_MODEL || "qwen3:1.7b",
    menuPath: "mcd.csv",
    dialogsDir: "data/dialogs",
    /** База знаний REG: профили в формате "ключ=значение ключ2=значение2" */
    regProfilesPath: "data/reg_profiles.txt",
    maxTurns: 20,
    calorieThreshold: 0.2, // 30% deviation from target
    /** Delay (ms) after each API call (0 для ollama) */
    delayAfterCall: 6000,
};

/** Allergen mapping: profile restriction key -> menu allergy keywords */
export const ALLERGEN_MAP = {
    noMilk: ["Milk", "milk", "diary", "Diary"],
    noFish: ["Fish", "fish"],
    noNuts: ["Nuts", "nuts", "Nut"],
    noEgg: ["Egg", "egg"],
    noGluten: ["gluten", "Gluten", "Cereal containing gluten"],
    noSoya: ["Soya", "soya", "Soy"],
    noSulphites: ["Sulphites", "sulphites"],
    noBeef: ["Beef", "beef", "говядин"],
};
