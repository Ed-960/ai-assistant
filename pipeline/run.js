#!/usr/bin/env node
/**
 * Pipeline runner: generate N dialogues, save to data/dialogs/
 *
 * Usage:
 *   node pipeline/run.js
 *   node pipeline/run.js --count 10
 *   node pipeline/run.js --singleshot --count 5   # single LLM call per dialog (-s)
 *   node pipeline/run.js --batch 4 --count 12     # 3 batches of 4 diverse dialogs each
 */

import { mkdir, writeFile, readdir, appendFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadMenu } from "./menuLoader.js";
import { generateDialog } from "./dialogLoop.js";
import { generateDialogSingleShot, generateDialogsBatch } from "./dialogSingleShot.js";
import { PIPELINE_CONFIG } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIALOGS_DIR = join(ROOT, PIPELINE_CONFIG.dialogsDir);
const REG_PATH = join(ROOT, PIPELINE_CONFIG.regProfilesPath);

function parseArgs() {
    const args = process.argv.slice(2);
    let count = 10;
    let singleShot = false;
    let batchSize = 0; // 0 = not batch mode
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--count" && args[i + 1]) {
            count = Math.max(1, parseInt(args[i + 1], 10) || 10);
            i++;
        } else if (args[i] === "--singleshot" || args[i] === "-s") {
            singleShot = true;
        } else if (args[i] === "--batch") {
            batchSize = args[i + 1] && /^\d+$/.test(args[i + 1])
                ? Math.min(6, Math.max(3, parseInt(args[i + 1], 10)))
                : 4;
            if (args[i + 1] && /^\d+$/.test(args[i + 1])) i++;
        }
    }
    return { count, singleShot, batchSize };
}

/** Найти следующий свободный номер (чтобы не перезаписывать существующие) */
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

async function saveDialog(dialogNumber, record) {
    const path = join(DIALOGS_DIR, `dialog-${String(dialogNumber).padStart(6, "0")}.json`);
    await writeFile(path, JSON.stringify(record, null, 2), "utf-8");
}

async function main() {
    const { count, singleShot, batchSize } = parseArgs();
    const mode = batchSize ? `batch(${batchSize})` : singleShot ? "single-shot" : "turn-by-turn";
    const genFn = batchSize ? null : (singleShot ? generateDialogSingleShot : generateDialog);
    console.log(`Starting pipeline: ${count} dialogues (${mode})`);
    console.log(`Menu: ${PIPELINE_CONFIG.menuPath}`);
    console.log(`Output: ${DIALOGS_DIR}\n`);

    await mkdir(DIALOGS_DIR, { recursive: true });
    await mkdir(dirname(REG_PATH), { recursive: true });
    const menu = await loadMenu(PIPELINE_CONFIG.menuPath);
    console.log(`Menu loaded: ${menu.length} items\n`);

    let nextNum = await getNextDialogNumber();
    let ok = 0;
    let errors = 0;
    const flagCounts = { allergen_violation: 0, calorie_warning: 0, hallucination: 0, incomplete_order: 0 };

    let generated = 0;
    for (let i = 1; generated < count; i++) {
        const todo = batchSize ? Math.min(batchSize, count - generated) : 1;
        process.stdout.write(`[${generated + 1}-${generated + todo}/${count}] Generating${batchSize ? ` batch of ${todo}` : ""}... `);
        try {
            const dialogs = batchSize
                ? await generateDialogsBatch(menu, todo)
                : [(singleShot ? await generateDialogSingleShot(menu) : await generateDialog(menu))];
            for (const { history, profile, final_order, flags } of dialogs) {
                const record = {
                    dialog_id: nextNum,
                    client_profile: profile,
                    turns: history,
                    final_order,
                    total_energy: final_order.total_energy,
                    validation_flags: flags,
                    created_at: new Date().toISOString(),
                };
                await saveDialog(nextNum, record);
                if (profile.regLine) {
                    await appendFile(REG_PATH, `dialog_id=${nextNum} ${profile.regLine}\n`, "utf-8");
                }
                nextNum++;
                if (flags.allergen_violation) flagCounts.allergen_violation++;
                if (flags.calorie_warning) flagCounts.calorie_warning++;
                if (flags.hallucination) flagCounts.hallucination++;
                if (flags.incomplete_order) flagCounts.incomplete_order++;
                ok++;
                generated++;
            }
            const bad = dialogs.reduce((s, d) => s + Object.values(d.flags).filter(Boolean).length, 0);
            console.log(`OK ${bad ? `(${bad} flags)` : ""}`);
        } catch (err) {
            errors++;
            console.log(`ERROR: ${err.message}`);
        }
    }

    console.log(`\nDone. Success: ${ok}, Errors: ${errors}`);
    console.log("Flags:", flagCounts);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
