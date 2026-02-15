#!/usr/bin/env node
/**
 * Импорт диалогов pizza-ordering и coffee-ordering из Taskmaster TM-1-2019.
 * Конвертирует в формат проекта: turns [{ speaker, text }], client_profile, final_order.
 *
 * Usage: node scripts/import-taskmaster.js
 *        node scripts/import-taskmaster.js --woz-only
 *        node scripts/import-taskmaster.js --self-only
 */

import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TM1_WOZ = join(ROOT, "Taskmaster/TM-1-2019/woz-dialogs.json");
const TM1_SELF = join(ROOT, "Taskmaster/TM-1-2019/self-dialogs.json");
const DIALOGS_DIR = join(ROOT, "data/dialogs_taskmaster");
const REG_PATH = join(ROOT, "data/reg_profiles_taskmaster.txt");

const FOOD_DOMAINS = ["pizza-ordering-1", "coffee-ordering-1"];

function parseArgs() {
    const args = process.argv.slice(2);
    return {
        wozOnly: args.includes("--woz-only"),
        selfOnly: args.includes("--self-only"),
    };
}

function convertToOurFormat(dialog, source, dialogId) {
    const domain = dialog.instruction_id || "unknown";
    const turns = (dialog.utterances || []).map((u) => ({
        speaker: u.speaker === "USER" ? "client" : "cashier",
        text: u.text || "",
    }));

    // Минимальный профиль (TM-1 не содержит возраст, аллергии и т.д.)
    const client_profile = {
        source: "taskmaster-1",
        domain,
        text: `Taskmaster: ${domain.replace("-1", "")} order.`,
        regLine: `source=taskmaster domain=${domain} dialog_id=${dialogId}`,
    };

    // Извлечь упоминания товаров из сегментов (для справки)
    const mentions = new Set();
    for (const u of dialog.utterances || []) {
        for (const seg of u.segments || []) {
            const ann = seg.annotations?.[0]?.name || "";
            if (ann.includes("drink") || ann.includes("pizza") || ann.includes("topping")) {
                mentions.add(seg.text || "");
            }
        }
    }

    const final_order = {
        items: [...mentions].filter(Boolean).map((name) => ({ name, quantity: 1, energy: 0 })),
        total_energy: 0,
        allergens_in_order: [],
    };

    return {
        dialog_id: dialogId,
        client_profile,
        turns,
        final_order,
        total_energy: 0,
        validation_flags: {
            allergen_violation: false,
            calorie_warning: false,
            hallucination: false,
            incomplete_order: false,
        },
        source: `taskmaster-1-${source}`,
        original_conversation_id: dialog.conversation_id,
        created_at: new Date().toISOString(),
    };
}

async function loadDialogs(path, domains) {
    const raw = await readFile(path, "utf-8");
    const arr = JSON.parse(raw);
    return arr.filter((d) => domains.includes(d.instruction_id));
}

async function getNextDialogNumber() {
    try {
        const files = await readdir(DIALOGS_DIR);
        const numbers = files
            .filter((f) => /^dialog-(\d+)\.json$/.test(f))
            .map((f) => parseInt(f.match(/^dialog-(\d+)\.json$/)[1], 10));
        return numbers.length ? Math.max(...numbers) + 1 : 1;
    } catch {
        return 1;
    }
}

async function main() {
    const { wozOnly, selfOnly } = parseArgs();
    await mkdir(DIALOGS_DIR, { recursive: true });

    let nextNum = await getNextDialogNumber();
    let imported = 0;
    const regLines = [];

    const runSource = (source, path) => {
        return loadDialogs(path, FOOD_DOMAINS).then((dialogs) => {
            console.log(`${source}: found ${dialogs.length} food dialogs`);
            return dialogs.map((d) => ({ ...d, _source: source }));
        });
    };

    let allDialogs = [];
    if (!selfOnly) {
        try {
            const woz = await runSource("woz", TM1_WOZ);
            allDialogs = allDialogs.concat(woz);
        } catch (e) {
            console.warn("woz-dialogs.json not found:", e.message);
        }
    }
    if (!wozOnly) {
        try {
            const self = await runSource("self", TM1_SELF);
            allDialogs = allDialogs.concat(self);
        } catch (e) {
            console.warn("self-dialogs.json not found:", e.message);
        }
    }

    for (const d of allDialogs) {
        const record = convertToOurFormat(d, d._source, nextNum);
        const filePath = join(DIALOGS_DIR, `dialog-${String(nextNum).padStart(6, "0")}.json`);
        await writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");
        if (record.client_profile?.regLine) {
            regLines.push(`dialog_id=${nextNum} ${record.client_profile.regLine}`);
        }
        nextNum++;
        imported++;
    }

    if (regLines.length) {
        const { appendFile } = await import("fs/promises");
        await mkdir(dirname(REG_PATH), { recursive: true });
        await appendFile(REG_PATH, regLines.join("\n") + "\n", "utf-8");
    }

    console.log(`\nImported ${imported} dialogs to ${DIALOGS_DIR}`);
    if (regLines.length) console.log(`Appended ${regLines.length} profiles to ${REG_PATH}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
