/**
 * bastion-data.js
 * Pure data: IDs, lookup tables, name maps, and display constants.
 * No logic, no Foundry API calls — safe to import from any module file.
 */

export const MODULE_ID = "dnd-2024-bastion-manager";

// ─── Compendium Folder IDs ────────────────────────────────────────────────────
export const SPECIAL_ROOT_ID             = "jvwwGTr0bMORqJD4";
export const BASIC_ROOT_ID               = "oocJkCsQvkXOWJbL";
export const GARDEN_ROOT_ID              = "HYjssa08njsoKbTO";
export const ARCANE_STUDY_ROOT_ID        = "8yYUu27NcOQJc3qx";
export const ARCANE_FOCUSES_FOLDER_ID    = "ByVgJZyPE5H3M5tV";
export const DRUID_FOCUS_FOLDER_ID       = "RTYj3BJ6ZRvuKxPq";
export const HOLY_SYMBOL_FOLDER_ID       = "BiV5sM1bdzI3ZWS6";
export const SMITHY_ROOT_ID              = "wti6MOvq9leZqgp9";
export const WORKSHOP_ROOT_ID            = "XkNDvStirzNpw8G2";
export const LAB_ALCH_FOLDER_ID          = "mqk8IahDyEIKpvcj";
export const LAB_POISON_FOLDER_ID        = "fwyUIxfHsEGOLHYc";
export const ARCHIVE_BOOKS_FOLDER_ID     = "1gNhp4TlPZmeUuND";
export const MEDITATION_FOLDER_ID        = "MHEBG1MAdvgjzJk1";
export const OBSERVATORY_ROOT_FOLDER_ID  = "e88xHkwROqUs8TGK";
export const ARCHIVE_ROOT_FOLDER_ID      = "abF82Om5im6lVTmF";
export const ARTISANS_TOOLS_FOLDER_ID    = "6BSYdjswSgM0HRib";
export const GREENHOUSE_ROOT_ID          = "L5IXLxn3kjBeN7Vx";
export const GUILDHALL_ROOT_ID           = "ni06boefwcrUwFQa";
export const LABORATORY_ROOT_ID          = "ZGn3LuZo6zyzHOoK";
export const SACRISTY_ROOT_ID            = "hU4DDWFnK13sSUSP";
export const SANCTUARY_ROOT_ID           = "B6m3PJWbZ81SSYeW";
export const SCRIPTORIUM_ROOT_ID         = "RbGD7EB1jyD26fq6";
export const STABLE_ROOT_ID              = "7fgBYawFLeER4MtQ";
export const MENAGERIE_ROOT_ID           = "2NJBOp0l0PxvBN6B";
export const TELEPORTATION_CIRCLE_ROOT_ID = "7Iiukg7IXSfJxnXS";
export const TRAINING_AREA_ROOT_ID       = "cxAgMJ71ADZ2APKu";
export const PUB_ROOT_ID                 = "soSkXpUmtteM4mgD";
export const BASE_ITEMS_FOLDER_ID        = "AQ0XdVgHpL5IaNjC";
export const RELIQUARY_ROOT_ID           = "zOMONoelQli72ZI7";
export const SANCTUM_ROOT_ID             = "eqeKF3pxcKuI6EX0";

// ─── Orders ───────────────────────────────────────────────────────────────────
export const BASTION_ORDERS = ["Maintain", "Craft", "Harvest", "Recruit", "Research", "Trade", "Empower"];

// ─── Bastion Events Table ─────────────────────────────────────────────────────
export const BASTION_EVENTS_LIST = [
    { label: "All Is Well (01-50)", roll: 1 },
    { label: "Attack (51-55)", roll: 51 },
    { label: "Criminal Hireling (56-58)", roll: 56 },
    { label: "Extraordinary Opportunity (59-63)", roll: 59 },
    { label: "Friendly Visitors (64-72)", roll: 64 },
    { label: "Guest (73-76)", roll: 73 },
    { label: "Lost Hirelings (77-79)", roll: 77 },
    { label: "Magical Discovery (80-83)", roll: 80 },
    { label: "Refugees (84-91)", roll: 84 },
    { label: "Request for Aid (92-98)", roll: 92 },
    { label: "Treasure (99-00)", roll: 99 }
];

// ─── Facility Build Config ────────────────────────────────────────────────────
export const FACILITY_CONFIG = {
    "Workshop": {
        type: "tools",
        options: [
            "Carpenter's Tools", "Cobbler's Tools", "Glassblower's Tools", "Jeweler's Tools",
            "Leatherworker's Tools", "Mason's Tools", "Painter's Supplies", "Potter's Tools",
            "Tinker's Tools", "Weaver's Tools", "Woodcarver's Tools"
        ]
    }
};

// ─── Order Icon Maps (used by character-sheet tab augmentation) ───────────────
export const ORDER_SVG_MAP = {
    "maintain":         "systems/dnd5e/icons/svg/facilities/maintain.svg",
    "craft":            "systems/dnd5e/icons/svg/facilities/craft.svg",
    "trade":            "systems/dnd5e/icons/svg/facilities/trade.svg",
    "recruit":          "systems/dnd5e/icons/svg/facilities/recruit.svg",
    "research":         "systems/dnd5e/icons/svg/facilities/research.svg",
    "harvest":          "systems/dnd5e/icons/svg/facilities/harvest.svg",
    "empower":          "systems/dnd5e/icons/svg/facilities/empower.svg",
    "change type":      "systems/dnd5e/icons/svg/facilities/change.svg",
    "continue project": "systems/dnd5e/icons/svg/facilities/build.svg",
    "progress queue":   "systems/dnd5e/icons/svg/facilities/craft.svg",
};

export const ORDER_ICON_MAP = {
    "maintain":         "fa-solid fa-broom",
    "craft":            "fa-solid fa-hammer",
    "trade":            "fa-solid fa-coins",
    "recruit":          "fa-solid fa-person-circle-plus",
    "research":         "fa-solid fa-book-open",
    "harvest":          "fa-solid fa-seedling",
    "empower":          "fa-solid fa-star",
    "change type":      "fa-solid fa-arrows-rotate",
    "continue project": "fa-solid fa-forward",
    "progress queue":   "fa-solid fa-list-ol",
};

// ─── Facility Passive Abilities (character-sheet info block) ──────────────────
export const PASSIVE_INFO = {
    "Sanctuary": {
        icon: "fa-solid fa-heart-pulse",   color: "#ef9a9a",
        name: "Healing Word Charm",
        restIcon: "fa-solid fa-moon",          rest: "Long Rest",
        tip: "After each Long Rest in your Bastion, you may cast Healing Word as a Charm (no spell slot required)."
    },
    "Sacristy": {
        icon: "fa-solid fa-wand-sparkles", color: "#ef9a9a",
        name: "Sacred Spellcasting",
        restIcon: "fa-solid fa-hourglass-half", rest: "Short Rest",
        tip: "After a Short Rest in your Bastion, you regain one expended spell slot of level 5 or lower."
    },
};
