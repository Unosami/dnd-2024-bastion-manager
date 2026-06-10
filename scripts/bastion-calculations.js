/**
 * bastion-calculations.js
 * Pure calculation and utility functions extracted from BastionManager.
 * These functions have no side effects — they take inputs and return values.
 * BastionManager keeps static aliases (e.g. BastionManager._getAllSubfolderIds)
 * so existing call-sites remain unchanged.
 */

import { MODULE_ID } from "./bastion-data.js";

/**
 * Recursively collects all folder IDs under a given parent folder.
 * @param {CompendiumCollection} pack
 * @param {string} parentFolderId
 * @returns {string[]}
 */
export function getAllSubfolderIds(pack, parentFolderId) {
    if (!pack?.folders) return [parentFolderId];
    const subfolders = pack.folders.filter(f => {
        const pid = f.parentId || f.folder?.id || f.folder;
        return pid === parentFolderId;
    });
    return [parentFolderId, ...subfolders.flatMap(f => getAllSubfolderIds(pack, f.id))];
}

/**
 * Extracts a size key from a document (Actor or Item).
 * @param {object} doc
 * @returns {Promise<string>}
 */
export async function extractSize(doc) {
    if (!doc) return "lg";
    let size = doc.system?.size || doc.system?.details?.size || doc.system?.traits?.size;
    if (size && typeof size === "string") return size.toLowerCase();

    let props = doc.system?.properties;
    let propList = (props instanceof Set) ? Array.from(props) : (Array.isArray(props) ? props : (typeof props === "object" && props !== null ? Object.keys(props).filter(k => props[k]) : []));
    const sizeKeys = ["tiny", "sm", "med", "lg", "huge", "grg"];
    const found = propList.find(p => sizeKeys.includes(String(p).toLowerCase()));
    if (found) return found.toLowerCase();

    const desc = doc.system?.description?.value;
    if (desc) {
        const match = desc.match(/@(?:UUID|Actor)\[([^\]]+)\]/);
        if (match) {
            try {
                const linkedDoc = await fromUuid(match[1]);
                if (linkedDoc && linkedDoc.documentName === "Actor") {
                    let linkedSize = linkedDoc.system?.traits?.size || linkedDoc.system?.size;
                    if (linkedSize) return linkedSize.toLowerCase();
                }
            } catch (e) {
                console.error("Bastion Manager | Error resolving linked actor for size:", e);
            }
        }
    }
    return "lg";
}

/**
 * Returns crafting time and gold cost for a spell scroll by name.
 * @param {string} name
 * @returns {{ days: number, gp: number }}
 */
export function getScrollRequirements(name) {
    const n = name.toLowerCase();
    let level = 1;
    const lvlMatch = n.match(/\b(\d)(?:st|nd|rd|th)\b/);
    if (lvlMatch) level = parseInt(lvlMatch[1]);
    else if (n.includes("cantrip")) level = 0;
    else {
        const lvlMatch2 = n.match(/level\s+(\d)/);
        if (lvlMatch2) level = parseInt(lvlMatch2[1]);
    }
    const table = {
        0: { days: 1, gp: 15 }, 1: { days: 1, gp: 25 },
        2: { days: 3, gp: 100 }, 3: { days: 5, gp: 150 },
        4: { days: 10, gp: 1000 }, 5: { days: 25, gp: 1500 },
        6: { days: 40, gp: 10000 }, 7: { days: 50, gp: 12500 },
        8: { days: 60, gp: 15000 }, 9: { days: 120, gp: 50000 }
    };
    return table[level] || table[1];
}

/**
 * Returns standard crafting time and gold costs based on item rarity.
 * @param {string} rarity
 * @returns {{ days: number, gp: number }}
 */
export function getMagicItemRequirements(rarity) {
    const r = String(rarity || "common").toLowerCase();
    const table = {
        "common":    { days: 5, gp: 50 },
        "uncommon":  { days: 10, gp: 200 },
        "rare":      { days: 50, gp: 2000 },
        "veryrare":  { days: 125, gp: 20000 },
        "very rare": { days: 125, gp: 20000 },
        "legendary": { days: 250, gp: 100000 },
        "artifact":  { days: 500, gp: 500000 }
    };
    return table[r] || table.common;
}

/**
 * Returns the slot cost for a Stable mount based on actor size key.
 * @param {string} sizeKey
 * @returns {number}
 */
export function getMountSlotCost(sizeKey) {
    const s = String(sizeKey || "lg").toLowerCase();
    if (["tiny", "sm", "med", "small", "medium"].includes(s)) return 0.5;
    if (s === "lg" || s === "large") return 1.0;
    if (s === "huge" || s === "hg") return 3.0;
    return 999;
}

/**
 * Returns the slot cost for a Menagerie creature based on size key.
 * Large+ = 1 slot, smaller = 0.25 slots (4 per Large slot).
 * @param {string} sizeKey
 * @returns {number}
 */
export function getMenagerieSlotCost(sizeKey) {
    const s = String(sizeKey || "med").toLowerCase();
    return ["lg", "large", "huge", "grg", "gargantuan"].includes(s) ? 1 : 0.25;
}

/**
 * GP cost for a Menagerie creature — table lookup with CR-based fallback.
 * @param {string} name
 * @param {string|number} cr
 * @returns {number}
 */
export function getMenagerieCost(name, cr) {
    const TABLE = {
        "Ape": 500, "Black Bear": 500, "Brown Bear": 1000,
        "Constrictor Snake": 250, "Crocodile": 500, "Dire Wolf": 1000,
        "Giant Vulture": 1000, "Hyena": 50, "Jackal": 50,
        "Lion": 1000, "Owlbear": 3500, "Panther": 250, "Tiger": 1000
    };
    if (TABLE[name] !== undefined) return TABLE[name];
    let crNum = 0;
    if (typeof cr === "string") {
        if (cr === "1/8") crNum = 0.125;
        else if (cr === "1/4") crNum = 0.25;
        else if (cr === "1/2") crNum = 0.5;
        else crNum = parseFloat(cr) || 0;
    } else crNum = cr || 0;
    if (crNum <= 0.125) return 50;
    if (crNum <= 0.25) return 250;
    if (crNum <= 0.5) return 500;
    if (crNum <= 1) return 1000;
    if (crNum <= 2) return 2000;
    if (crNum <= 3) return 3500;
    const XP_BY_CR = [10,25,50,100,200,450,700,1100,1800,2300,2900,3900,5000,5900,7200,8400,10000,11500,13000,15000,18000,20000,22000,25000,33000,41000,50000,62000,75000,90000,105000,120000,135000,155000];
    const crIdx = Math.min(Math.floor(crNum) + 3, XP_BY_CR.length - 1);
    return Math.round(XP_BY_CR[crIdx] * 5 / 5) * 5;
}

/**
 * Returns the defender die type for a Menagerie creature based on CR and world settings.
 * @param {number} crNum
 * @returns {string}
 */
export function getMenagerieDie(crNum) {
    const mode = game.settings.get(MODULE_ID, "menagerieDiceMode");
    if (mode === "raw") return "d6";
    if (mode === "digital") {
        const CR_TIERS = [0,0.125,0.25,0.5,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30];
        let idx = 0;
        for (let i = 0; i < CR_TIERS.length; i++) { if (crNum >= CR_TIERS[i]) idx = i; }
        return `d${idx + 2}`;
    }
    if (mode === "physical") {
        if (crNum >= 6) return "d20";
        if (crNum >= 3) return "d12";
        if (crNum >= 2) return "d10";
        if (crNum >= 1) return "d8";
        if (crNum >= 0.125) return "d6";
        return "d4";
    }
    let table;
    try { table = JSON.parse(game.settings.get(MODULE_ID, "menagerieCrDiceTable")); } catch { return "d6"; }
    const thresholds = Object.keys(table).map(Number).sort((a, b) => b - a);
    for (const t of thresholds) {
        if (crNum >= t) return String(table[String(t)] || "d6").toLowerCase();
    }
    return "d6";
}

/**
 * Returns the effective number of days for a project, scaling multiples of 7
 * if the 'scaleWeekToTurnLength' setting is enabled.
 * @param {number} baseDays
 * @returns {number}
 */
export function getEffectiveDays(baseDays) {
    const scale = game.settings.get(MODULE_ID, "scaleWeekToTurnLength");
    if (!scale || baseDays % 7 !== 0) return baseDays;
    const daysPerTurn = game.settings.get(MODULE_ID, "daysPerTurn") || 7;
    return (baseDays / 7) * daysPerTurn;
}

/**
 * Returns the special facility cap for the given actor level per DMG 2024.
 * @param {number} actorLevel
 * @param {boolean} [ignoreFacilityPrereqs=false]
 * @returns {number}
 */
export function getSpecialFacilityCap(actorLevel, ignoreFacilityPrereqs = false) {
    if (actorLevel >= 17) return 6;
    if (actorLevel >= 13) return 5;
    if (actorLevel >= 9) return 4;
    if (actorLevel >= 5) return 2;
    return ignoreFacilityPrereqs ? 2 : 0;
}

/**
 * Recursively builds a nested option structure for select menus matching folder hierarchy.
 */
export async function getNestedCompendiumOptions(pack, rootFolderId, selectedValue, calculationMode, daysPerTurn, progressLabel, isMagicItem = true, folderNamesFilter = null, folderNamesExclude = null, showDetails = true) {
    const index = await pack.getIndex({ fields: ["folder", "system.rarity", "system.price", "system.quantity", "system.requirements.level", "system.size", "system.properties", "system.description.value"] });
    const allRelevantFolderIds = getAllSubfolderIds(pack, rootFolderId);

    let rootItems = [];
    let subGroups = [];

    const rarityOrder = { "common": 1, "uncommon": 2, "rare": 3, "veryrare": 4, "very rare": 4, "legendary": 5, "artifact": 6 };
    const sizeMap = { "tiny": "Tiny", "sm": "Small", "med": "Medium", "lg": "Large", "huge": "Huge", "grg": "Gargantuan" };

    for (const fId of allRelevantFolderIds) {
        const folder = pack.folders.get(fId);
        if (!folder) continue;

        if (folderNamesFilter && String(fId) !== String(rootFolderId) && !folderNamesFilter.includes(folder.name)) continue;

        if (folderNamesExclude) {
            const exclusions = folderNamesExclude.toLowerCase().split("|");
            let check = folder;
            let excluded = false;
            while (check && !excluded) {
                const folderName = check.name.toLowerCase();
                if (exclusions.some(ex => folderName.includes(ex))) excluded = true;
                check = check.parentId ? pack.folders.get(check.parentId) : null;
            }
            if (excluded) continue;
        }

        const items = index.filter(i => {
            let itemFolderId = i.folder?.id || i.folder;
            if (!itemFolderId) return false;
            if (typeof itemFolderId !== "string") itemFolderId = String(itemFolderId);
            return itemFolderId === String(fId) || itemFolderId.endsWith(`.${fId}`);
        });
        if (items.length === 0) continue;

        const processedItems = await Promise.all(items.map(async i => {
            const rarity = i.system.rarity || "common";
            let price = i.system.price?.value ?? i.system.price ?? 0;
            if (typeof price === "string") price = parseFloat(price.replace(/[^0-9.]/g, "")) || 0;
            const size = await extractSize(i);
            const slots = getMountSlotCost(size);
            const qty = i.system.quantity || 1;

            let days, gp;
            const isScroll = i.name.toLowerCase().includes("spell scroll");
            if (isScroll) {
                const reqs = getScrollRequirements(i.name);
                days = reqs.days;
                gp = reqs.gp;
            } else if (isMagicItem) {
                const reqs = getMagicItemRequirements(rarity);
                days = reqs.days;
                gp = reqs.gp;
            } else {
                const isMount = folder?.name.toLowerCase().includes("mount") || folder?.name.toLowerCase().includes("stable");
                const isPoison = folder?.name.toLowerCase().includes("poison");

                if (isMount) {
                    days = getEffectiveDays(7);
                    gp = Number(price);
                    let label = i.name;
                    if (showDetails) label = `${i.name} (${gp} GP, ${sizeMap[size] || "Unknown"} - ${slots} slots)`;
                    return {
                        value: i.name,
                        label: label,
                        selected: i.name === selectedValue,
                        slots,
                        rarity, time: 1, price: gp,
                        uuid: i.uuid || `Compendium.dnd-2024-bastion-manager.bastion-output-items.Item.${i._id || i.id}`
                    };
                }

                if (isPoison) {
                    days = getEffectiveDays(7);
                } else {
                    days = Math.max(1, Math.ceil(Number(price) / 10));
                }
                gp = Math.floor(Number(price) / 2);
            }

            const tCount = calculationMode === "days" ? days : Math.ceil(days / daysPerTurn);
            let label = i.name;
            if (showDetails) {
                label = `${i.name} (${rarity.charAt(0).toUpperCase() + rarity.slice(1)}: ${gp} GP, ${tCount} ${progressLabel})${qty > 1 ? ` [x${qty}]` : ''}`;
            }
            return {
                value: i.name,
                label: label,
                selected: i.name === selectedValue,
                rarity,
                time: tCount,
                price: gp,
                uuid: i.uuid || `Compendium.dnd-2024-bastion-manager.bastion-output-items.Item.${i._id || i.id}`
            };
        }));

        const sortedItems = processedItems.sort((a, b) => {
            if (isMagicItem) {
                const aOrder = rarityOrder[a.rarity] || 0;
                const bOrder = rarityOrder[b.rarity] || 0;
                if (aOrder !== bOrder) return aOrder - bOrder;
            }
            return a.label.localeCompare(b.label);
        });

        if (String(fId) === String(rootFolderId)) {
            rootItems = sortedItems;
        } else {
            subGroups.push({ label: folder.name, groupOptions: sortedItems });
        }
    }

    subGroups.sort((a, b) => a.label.localeCompare(b.label));
    return [...rootItems, ...subGroups];
}

// ─── Name Generation ──────────────────────────────────────────────────────────

const RANDOM_NAMES = ["Adrik", "Alberich", "Baern", "Barendd", "Brottor", "Bruenor", "Dain", "Darrak", "Delg", "Eberk", "Einkil", "Fargrim", "Flint", "Gardain", "Harbek", "Kildrak", "Oskar", "Rangrim", "Rurik", "Thoradin", "Thorin", "Tordek", "Traubon", "Travok", "Ulfgar", "Veit", "Vondal", "Amber", "Artin", "Audhild", "Bardryn", "Dagnal", "Diesa", "Eldeth", "Falkrunn", "Finellen", "Gunnloda", "Gurdis", "Helja", "Hlin", "Kathra", "Kristryd", "Ilde", "Liftrasa", "Mardred", "Riswynn", "Sannl", "Torbera", "Torgga", "Vistra", "Aseir", "Bardeid", "Haseid", "Khemed", "Mehmen", "Sudeiman", "Zasheir", "Atala", "Ceidil", "Hama", "Jasmal", "Meilil", "Seipora", "Yasheira", "Zasheida", "Bor", "Fodel", "Glar", "Grigor", "Igan", "Ivor", "Kosef", "Mival", "Orel", "Pavel", "Sergor", "Alethra", "Kara", "Katernin", "Mara", "Natali", "Olma", "Tana", "Zora", "Ander", "Blath", "Bran", "Frath", "Geth", "Lander", "Luth", "Lucan", "Murn", "Muth", "Stedd", "Amafrey", "Betha", "Catelyn", "Ethani", "Ilda", "Lisvet", "Lura", "Madel", "Miri", "Nala", "Quara", "Selise", "Viana", "Anton", "Diero", "Falcone", "Federico", "Geno", "Luigi", "Marcello", "Nico", "Piero", "Tommaso", "Arveene", "Esvele", "Jhessail", "Kerri", "Lureene", "Miri", "Rowan", "Shandri", "Tessele", "Aoth", "Barakas", "Damakos", "Iados", "Kairon", "Leucis", "Melech", "Mordai", "Morthos", "Pelaios", "Skamos", "Therai", "Akta", "Anakis", "Bryseis", "Criella", "Damaia", "Ea", "Kallista", "Lerissa", "Makaria", "Nemeia", "Orianna", "Phelia", "Rieta"];

const SPELLCASTER_TITLES = ["the Magnificent", "the Conjurer", "the Wise", "the Eternal", "the Architect", "the Weaver", "the Gazer", "the Archmage", "the Adept", "the Radiant", "the Shadow", "the Timeless", "the Resplendent", "the Unfettered"];

export function generateRandomName() {
    return RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
}

export function generateSpellcasterName() {
    const title = SPELLCASTER_TITLES[Math.floor(Math.random() * SPELLCASTER_TITLES.length)];
    return `${generateRandomName()} ${title}`;
}

/**
 * Returns a profession string for a hireling based on their facility.
 * @param {object|null} professionsMap - BastionManager._professionsMap
 * @param {string} facName
 * @param {string|undefined} subType
 * @returns {string}
 */
export function getHirelingProfession(professionsMap, facName, subType) {
    if (!professionsMap) return "(Hireling)";
    const name = facName.trim();
    const sub = subType?.trim();

    if (sub) {
        const specKey = `${name} (${sub})`;
        if (professionsMap[specKey]) return `the ${professionsMap[specKey]}`;
    }

    if (professionsMap[name]) return `the ${professionsMap[name]}`;

    const lowerName = name.toLowerCase();
    const entry = Object.entries(professionsMap).find(([k]) => {
        const lowerK = k.toLowerCase();
        return lowerName.includes(lowerK) || lowerK.includes(lowerName);
    });

    if (entry) return `the ${entry[1]}`;
    return "(Hireling)";
}
