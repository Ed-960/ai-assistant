/**
 * LLM API client (Groq / Z.ai) with retry on 429 rate limit.
 */

import { PIPELINE_CONFIG } from "./config.js";

function getApiSettings() {
    const p = PIPELINE_CONFIG.apiProvider || "ollama";
    if (p === "ollama") {
        return { url: PIPELINE_CONFIG.ollamaUrl, key: "ollama" };
    }
    if (p === "zai") {
        const url = PIPELINE_CONFIG.zaiApiUrl;
        const key = PIPELINE_CONFIG.zaiApiKey;
        if (!url || !key) throw new Error("Z.ai: раскомментируйте zaiApiUrl и zaiApiKey в pipeline/config.js");
        return { url, key };
    }
    return {
        url: "https://api.groq.com/openai/v1/chat/completions",
        key: process.env.GROQ_API_KEY || "",
    };
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(errText) {
    const s = errText || "";
    let sec = 15;
    const mSec = s.match(/try again in (\d+)m([\d.]+)s/i);
    const secOnly = s.match(/try again in ([\d.]+)s/i);
    if (mSec) sec = parseInt(mSec[1], 10) * 60 + Math.ceil(parseFloat(mSec[2]));
    else if (secOnly) sec = Math.ceil(parseFloat(secOnly[1])) + 2;
    return Math.max(sec, 10);
}

/**
 * @param {Array} messages
 * @param {number} temperature
 * @param {number} maxRetries
 */
export async function callGroq(messages, temperature = 0.4, maxRetries = 3) {
    let lastErr;

    const { url, key } = getApiSettings();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const headers = { "Content-Type": "application/json" };
        if (key && key !== "ollama") headers.Authorization = `Bearer ${key}`;

        const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: PIPELINE_CONFIG.model,
                messages,
                temperature,
            }),
        });

        const errText = await res.text();

        if (res.ok) {
            const data = JSON.parse(errText);
            const content = data.choices?.[0]?.message?.content?.trim() || "";
            const isOllama = PIPELINE_CONFIG.apiProvider === "ollama";
            if (!isOllama && PIPELINE_CONFIG.delayAfterCall) {
                await sleep(PIPELINE_CONFIG.delayAfterCall);
            }
            return content;
        }

        if (res.status === 429 && attempt < maxRetries) {
            const waitSec = parseRetryAfter(errText);
            const isDaily = /tokens per day|TPD/i.test(errText);
            console.warn(`   Rate limit (${isDaily ? "daily" : "per-minute"}), waiting ${waitSec}s...`);
            await sleep(waitSec * 1000);
            continue;
        }

        const provider = PIPELINE_CONFIG.apiProvider || "groq";
        lastErr = res.status === 429 && /tokens per day|TPD/i.test(errText)
            ? new Error(
                `${provider} daily limit exceeded. Wait ~7 min or switch provider/model.`
            )
            : new Error(`${provider} API error: ${res.status} ${errText}`);
    }

    throw lastErr;
}
