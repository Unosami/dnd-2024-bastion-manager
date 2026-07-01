/**
 * bastion-facility-registry.js
 *
 * Single source of truth for "what facility is this, and how does it behave?".
 *
 * Historically the module identified facilities with hundreds of inline
 * `item.name.includes("Smithy")` style checks scattered across bastion-app.js.
 * That made facility identity fragile (a renamed facility silently lost its
 * behavior) and made it impossible for another module to add a facility without
 * editing the monolith.
 *
 * This file replaces that with a descriptor registry:
 *   - Built-in facilities are described once, declaratively (identity + passive +
 *     flag-select + special-order config).
 *   - External modules register their own facilities through the same shape via
 *     `game.modules.get("dnd-2024-bastion-manager").api.registerFacilityType(...)`.
 *
 * The registry is intentionally framework-light: it does no Foundry document I/O,
 * so it is safe to import from any module file (matching bastion-data.js).
 */

import { MODULE_ID, PASSIVE_INFO } from "./bastion-data.js";

// ─── Small shared helpers ─────────────────────────────────────────────────────

/**
 * Resolve a compendium folder's parent-folder id across the several shapes the
 * dnd5e / Foundry data model has used (`parentId`, `folder.id`, or a raw id).
 * This expression appeared inline dozens of times; centralize it.
 * @param {object} folder
 * @returns {string|null}
 */
export function folderParentId(folder) {
    if (!folder) return null;
    return folder.parentId || folder.folder?.id || folder.folder || null;
}

/**
 * Debug-gated logger. Logs only when the `debugLogging` setting is enabled, so
 * normal play stays quiet but troubleshooting can be turned on without an edit.
 * Falls back to silent if settings aren't registered yet (early boot).
 * @param {...any} args
 */
export function bastionLog(...args) {
    let on = false;
    try { on = game?.settings?.get(MODULE_ID, "debugLogging"); } catch { on = false; }
    if (on) console.log("Bastion Manager |", ...args);
}

// ─── Facility descriptor registry ─────────────────────────────────────────────
//
// A descriptor describes one facility *type*:
//   id            unique, dot-namespaced for external modules (e.g. "my-mod.foo")
//   name          display name (used by the Build dialog)
//   names         name substrings that identify an instance of this facility
//   excludeNames  substrings that disqualify a match (e.g. Library excludes Trophy)
//   type          "special" | "basic"  (Build dialog section; custom only)
//   level         minimum character level hint (Build dialog; custom only)
//   itemUuid      compendium Item UUID to add when built (custom only)
//   flagSelect    { selector, flagKey, render } for a per-facility <select> whose
//                 value is stored on the facility's module flags
//   passive       PASSIVE_INFO-shaped object for the character-sheet info block
//   orders        optional declarative order config (custom facilities):
//                   { base: ["craft"], craft: ["Craft: X", {label, minLevel}] }
//                 Each base-order key maps to the label(s) that REPLACE it.

/** Built-in facility identity. Mirrors the substring tests previously inlined. */
const BUILTIN_DESCRIPTORS = [
    { id: "garden",               name: "Garden",               names: ["Garden"],               excludeNames: ["Greenhouse"] },
    { id: "greenhouse",           name: "Greenhouse",           names: ["Greenhouse"] },
    { id: "library",              name: "Library",              names: ["Library"],              excludeNames: ["Trophy"] },
    { id: "trophy-room",          name: "Trophy Room",          names: ["Trophy Room", "Trophy"] },
    { id: "archive",              name: "Archive",              names: ["Archive"] },
    { id: "pub",                  name: "Pub",                  names: ["Pub"] },
    { id: "arcane-study",         name: "Arcane Study",         names: ["Arcane Study"], flagSelect: { selector: ".arcane-study-focus-select", flagKey: "focusChoice", render: false } },
    { id: "smithy",               name: "Smithy",               names: ["Smithy"],               flagSelect: { selector: ".smithy-item-select",    flagKey: "smithyItemChoice" } },
    { id: "workshop",             name: "Workshop",             names: ["Workshop"],             flagSelect: { selector: ".workshop-item-select",  flagKey: "workshopItemChoice" } },
    { id: "sanctuary",            name: "Sanctuary",            names: ["Sanctuary"] },
    { id: "sacristy",             name: "Sacristy",             names: ["Sacristy"],             flagSelect: { selector: ".sacristy-relic-select", flagKey: "relicItemChoice" } },
    { id: "scriptorium",          name: "Scriptorium",          names: ["Scriptorium"],          flagSelect: { selector: ".scriptorium-scroll-select", flagKey: "scrollChoice" } },
    { id: "laboratory",           name: "Laboratory",           names: ["Laboratory"] },
    { id: "reliquary",            name: "Reliquary",            names: ["Reliquary"] },
    { id: "theater",              name: "Theater",              names: ["Theater"] },
    { id: "demiplane",            name: "Demiplane",            names: ["Demiplane"] },
    { id: "sanctum",              name: "Sanctum",              names: ["Sanctum"] },
    { id: "armory",               name: "Armory",               names: ["Armory"] },
    { id: "storehouse",           name: "Storehouse",           names: ["Storehouse"] },
    { id: "stable",               name: "Stable",               names: ["Stable"] },
    { id: "gaming-hall",          name: "Gaming Hall",          names: ["Gaming Hall"] },
    { id: "barrack",              name: "Barrack",              names: ["Barrack"] },
    { id: "teleportation-circle", name: "Teleportation Circle", names: ["Teleportation Circle"] },
    { id: "menagerie",            name: "Menagerie",            names: ["Menagerie"] },
    { id: "guildhall",            name: "Guildhall",            names: ["Guildhall"] },
    { id: "war-room",             name: "War Room",             names: ["War Room"] },
    { id: "training-area",        name: "Training Area",        names: ["Training Area"] },
    { id: "meditation-chamber",   name: "Meditation Chamber",   names: ["Meditation Chamber"] },
    { id: "observatory",          name: "Observatory",          names: ["Observatory"] },
    // The "magic armament" dropdown lives on the Smithy but writes its own flag.
    // Tracked as an extra flag-select binding rather than a separate facility.
];

// Seed built-in passive abilities (Sanctuary / Sacristy) onto their descriptors.
for (const d of BUILTIN_DESCRIPTORS) {
    if (PASSIVE_INFO[d.name]) d.passive = PASSIVE_INFO[d.name];
}

// Extra flag-select bindings that aren't 1:1 with a facility id (a facility may
// own more than one <select>, e.g. Smithy's magic-armament dropdown, the Arcane
// Study magic-item dropdown, the Garden harvest dropdown).
const EXTRA_FLAG_SELECTS = [
    { selector: ".armament-item-select",     flagKey: "armamentItemChoice" },
    { selector: ".arcane-study-item-select", flagKey: "magicItemChoice" },
    { selector: ".garden-harvest-select",    flagKey: "harvestChoice" },
];

/** Registered custom facility descriptors (added by external modules at runtime). */
const customDescriptors = [];

/**
 * Register (or enrich) a custom facility type. Accepts the original lightweight
 * shape (id/name/type/itemUuid/level) plus the richer descriptor fields above.
 * Returns the stored descriptor, or null on validation failure.
 */
export function registerFacility(config) {
    const required = ["id", "name", "type"];
    for (const field of required) {
        if (!config[field]) { console.error(`Bastion Manager | registerFacilityType: missing required field "${field}".`, config); return null; }
    }
    // A facility must supply the item to build: either a compendium UUID or inline
    // item data. itemData lets a module register a facility without shipping a pack.
    if (!config.itemUuid && !config.itemData) {
        console.error(`Bastion Manager | registerFacilityType: provide either "itemUuid" or "itemData".`, config); return null;
    }
    if (!["special", "basic"].includes(config.type)) {
        console.error(`Bastion Manager | registerFacilityType: "type" must be "special" or "basic".`); return null;
    }
    if (customDescriptors.find(f => f.id === config.id)) {
        console.warn(`Bastion Manager | registerFacilityType: type "${config.id}" is already registered.`); return null;
    }
    const descriptor = {
        names: [config.name],
        excludeNames: [],
        ...config,
    };
    customDescriptors.push(descriptor);
    console.log(`Bastion Manager | Registered custom facility type: "${descriptor.name}" (${descriptor.type})`);
    return descriptor;
}

/** All custom descriptors (build-dialog listing, etc.). */
export function getCustomDescriptors() {
    return customDescriptors;
}

/** All descriptors, built-in first then custom. */
export function getAllDescriptors() {
    return [...BUILTIN_DESCRIPTORS, ...customDescriptors];
}

/** True if `name` matches the descriptor's name/exclude rules. */
function descriptorMatchesName(descriptor, name) {
    if (!name) return false;
    if (descriptor.excludeNames?.some(ex => name.includes(ex))) return false;
    return descriptor.names?.some(n => name.includes(n)) ?? false;
}

/**
 * Resolve the descriptor for a facility (Item document, groupFacilities entry,
 * or a raw name string). Custom descriptors win over built-ins so a module can
 * intentionally re-skin a facility name. Returns null if nothing matches.
 */
export function getFacilityDescriptor(facilityOrName) {
    const name = typeof facilityOrName === "string" ? facilityOrName : facilityOrName?.name;
    if (!name) return null;
    return customDescriptors.find(d => descriptorMatchesName(d, name))
        || BUILTIN_DESCRIPTORS.find(d => descriptorMatchesName(d, name))
        || null;
}

/** Convenience: does this facility match a given descriptor id? */
export function facilityMatches(facilityOrName, id) {
    return getFacilityDescriptor(facilityOrName)?.id === id;
}

/**
 * Combined passive-info map (built-in PASSIVE_INFO plus custom descriptors that
 * declare a `passive`). Keyed by display name for `name.includes(key)` lookups,
 * matching the original PASSIVE_INFO consumption in main.js.
 */
export function getAllPassiveInfo() {
    const merged = { ...PASSIVE_INFO };
    for (const d of customDescriptors) {
        if (d.passive) merged[d.name] = d.passive;
    }
    return merged;
}

/**
 * Every flag-select binding the dashboard should wire up: built-in facility
 * selects, the extra non-facility selects, and any custom facility that declared
 * a `flagSelect`. Used by the dashboard's single data-driven select binder.
 * @returns {{selector:string, flagKey:string, render:boolean}[]}
 */
export function getFlagSelectBindings() {
    const out = [];
    for (const d of [...BUILTIN_DESCRIPTORS, ...customDescriptors]) {
        if (d.flagSelect?.selector && d.flagSelect?.flagKey) out.push({ render: true, ...d.flagSelect });
    }
    for (const b of EXTRA_FLAG_SELECTS) out.push({ render: true, ...b });
    return out;
}

/**
 * Apply a custom facility's declarative `orders` config to a computed
 * availableOrders array. Built-in facilities are untouched (their order logic
 * still lives inline in buildFacilityOrderState); this only gives *registered*
 * facilities a way to contribute special orders without editing the monolith.
 *
 * @param {object} descriptor  A custom descriptor with an `orders` block.
 * @param {string[]} availableOrders  Mutated in place.
 * @param {{actorLevel:number, subType:string}} ctx
 */
export function applyCustomOrders(descriptor, availableOrders, ctx) {
    const orders = descriptor?.orders;
    if (!orders) return;
    const { actorLevel = 1 } = ctx || {};

    // Ensure declared base orders are present so the replacement step can find them.
    for (const base of (orders.base || [])) {
        const cap = base.charAt(0).toUpperCase() + base.slice(1);
        if (!availableOrders.includes(cap)) availableOrders.push(cap);
    }

    // Replace each base order with its declared labels (honoring minLevel gates).
    for (const [base, labels] of Object.entries(orders)) {
        if (base === "base" || !Array.isArray(labels)) continue;
        const cap = base.charAt(0).toUpperCase() + base.slice(1);
        const idx = availableOrders.indexOf(cap);
        if (idx === -1) continue;
        const resolved = labels
            .map(l => (typeof l === "string" ? { label: l } : l))
            .filter(l => !l.minLevel || actorLevel >= l.minLevel)
            .map(l => l.label);
        if (resolved.length) availableOrders.splice(idx, 1, ...resolved);
    }
}
