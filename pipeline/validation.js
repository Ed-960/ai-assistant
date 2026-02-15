/**
 * Validate dialogue result: allergen violations, calories, hallucination, incomplete order.
 */

import { conflictsWithProfile, existsInMenu, findInMenu, hasKidsItems } from "./menuLoader.js";
import { PIPELINE_CONFIG } from "./config.js";

export function validateDialog(history, profile, final_order, menu) {
    const flags = {
        allergen_violation: false,
        calorie_warning: false,
        hallucination: false,
        incomplete_order: false,
    };

    // Allergen check
    for (const item of final_order.items || []) {
        const entry = findInMenu(menu, item.name);
        if (entry && conflictsWithProfile(entry, profile)) {
            flags.allergen_violation = true;
        }
    }

    // Calorie check
    const total = final_order.total_energy || 0;
    const target = profile?.calApprValue || 2000;
    const threshold = PIPELINE_CONFIG.calorieThreshold;
    if (target > 0 && Math.abs(total - target) > threshold * target) {
        flags.calorie_warning = true;
    }

    // Hallucination: item not in menu
    for (const item of final_order.items || []) {
        if (!existsInMenu(menu, item.name)) {
            flags.hallucination = true;
        }
    }

    // Incomplete: kids in profile but no kids items (McNuggets, Fries, McFlurry, etc.)
    const childQuant = profile?.childQuant || 0;
    if (childQuant > 0 && !hasKidsItems(final_order.items || [], menu)) {
        flags.incomplete_order = true;
    }

    return flags;
}
