/**
 * eberron-facilities.js
 *
 * PROOF OF CONCEPT — facilities from another source book (Eberron: Forge of the
 * Artificer) added "as if from another module".
 *
 * This file deliberately imports NOTHING from the Bastion Manager internals. It
 * talks only to the public API surface a third-party module would use:
 *
 *     game.modules.get("dnd-2024-bastion-manager").api.registerFacilityType(...)
 *
 * In a real distribution this would live in its own Foundry module with its own
 * module.json `esmodules` entry (and typically its own compendium of facility
 * Items). Here it is loaded via a single `import` from main.js purely so the
 * `ready` hook below runs — the registration path itself is exactly what an
 * external module would do.
 *
 * Source: "Eberron: Forge of the Artificer" — Ch. 3 "Bastions in Khorvaire"
 * Special Facilities table (Level / Facility / Prerequisite / Order). The detailed
 * per-turn effect text is not reproduced here; the custom order labels below are
 * illustrative of the crafting theme and demonstrate the registry's `orders`
 * config (base-order injection + level-gated special orders).
 */

const BASTION_MODULE_ID = "dnd-2024-bastion-manager";

/**
 * Inline facility Item data. Using `itemData` (rather than `itemUuid`) lets this
 * module register a working, buildable facility without shipping a compendium.
 * The dnd5e "facility" DataModel fills in every field we don't specify.
 */
const ARTIFICERS_FORGE_ITEM = {
    name: "Artificer's Forge",
    type: "facility",
    img: "systems/dnd5e/icons/svg/items/facility.svg",
    system: {
        type: { value: "special" },
        size: "roomy",
        level: 13,
        order: "craft",
        description: {
            value: "<p>An arcane workshop where artisan's tools double as a spellcasting "
                 + "focus. From here, an artificer can produce fine wares and, with skill "
                 + "and renown, replicate potent magic items.</p>"
                 + "<p><em>Prerequisite: ability to use Artisan's Tools as a Spellcasting Focus.</em></p>"
        }
    }
};

Hooks.once("ready", () => {
    const api = game.modules.get(BASTION_MODULE_ID)?.api;
    if (!api?.registerFacilityType) {
        console.warn("Eberron Bastions | Bastion Manager API not found — Eberron facilities not registered.");
        return;
    }

    api.registerFacilityType({
        id: "efa.artificers-forge",
        name: "Artificer's Forge",
        type: "special",
        level: 13,
        itemData: ARTIFICERS_FORGE_ITEM,
        // Craft facility: inject the Craft base order, then replace it with the
        // facility's special crafting options. Level gates demonstrate that a
        // registered facility can tier its orders exactly like the built-ins.
        orders: {
            base: ["craft"],
            craft: [
                "Craft: Artisan's Wares",
                { label: "Craft: Replicate Magic Item", minLevel: 13 },
                { label: "Craft: Magic Item (Legendary)", minLevel: 17 }
            ]
        }
    });

    console.log("Eberron Bastions | Registered Artificer's Forge via Bastion Manager API.");
});
