import { BastionManager } from "./bastion-app.js"; 

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

class FacilityExclusionApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "facility-exclusion-app",
        tag: "form",
        window: { title: "Manage Facility Availability", resizable: true },
        position: { width: 600, height: 700 },
        classes: ["bastion-app"],
        form: {
            handler: FacilityExclusionApp.processForm,
            submitOnChange: false,
            closeOnSubmit: true
    }
    };

    static PARTS = {
        main: { template: "modules/dnd-2024-bastion-manager/templates/facility-exclusions.hbs" }
    };

    async _prepareContext(options) {
        const pack = game.packs.get("dnd-2024-bastion-manager.bastion-facilities");
        if (!pack) return { sources: [], facilities: [] };

        const allDocs = await pack.getDocuments();
        
        let excludedSources = [];
        let excludedFacilities = [];
        
        try {
            excludedSources = game.settings.get("dnd-2024-bastion-manager", "excludedSourcesData") || [];
            excludedFacilities = game.settings.get("dnd-2024-bastion-manager", "excludedFacilitiesData") || [];
        } catch(e) {}

        let sourceMap = new Map();
        let facilityList = [];

        for (const item of allDocs) {
            let source = "Unknown Source";
            if (typeof item.system?.source === "string") source = item.system.source;
            else if (item.system?.source?.custom) source = item.system.source.custom;
            else if (item.system?.source?.book) source = item.system.source.book;
            else if (item.system?.source?.label) source = item.system.source.label;

            source = source.trim();

            if (!sourceMap.has(source)) {
                sourceMap.set(source, {
                    name: source,
                    excluded: excludedSources.includes(source)
                });
            }

            facilityList.push({
                id: item.id,
                name: item.name,
                source: source,
                excluded: excludedFacilities.includes(item.id)
            });
        }

        const sources = Array.from(sourceMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        facilityList.sort((a, b) => a.name.localeCompare(b.name));

        return { sources: sources, facilities: facilityList };
    }

    static async processForm(event, form, formData) {
        event.preventDefault(); // Prevent standard HTML form submission that appends query parameters to the URL
        
        let newExcludedSources = [];
        let newExcludedFacilities = [];

        for (let [key, value] of Object.entries(formData.object)) {
            if (value === true || value === "on") {
                if (key.startsWith("source_")) {
                    newExcludedSources.push(key.replace("source_", ""));
                } else if (key.startsWith("fac_")) {
                    newExcludedFacilities.push(key.replace("fac_", ""));
                }
            }
        }

        await game.settings.set("dnd-2024-bastion-manager", "excludedSourcesData", newExcludedSources);
        await game.settings.set("dnd-2024-bastion-manager", "excludedFacilitiesData", newExcludedFacilities);
        
        const reloadConfirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Reload Required" },
            content: "<p>You have changed the facility exclusion settings. The world needs to reload for these changes to take effect.</p><p>Reload now?</p>",
            rejectClose: false,
            modal: true
        });

        if (reloadConfirm) {
            // Strip any accidental query parameters from the URL before reloading
            window.location.href = window.location.origin + window.location.pathname;
        } else {
            ui.notifications.warn("Facility availability updated. A reload is required for changes to take effect.");
        }
    }
}

class ConstructionConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "construction-config-app",
        tag: "form",
        window: { title: "Construction Configuration", resizable: true },
        position: { width: 450, height: "auto" },
        classes: ["bastion-app"],
        form: {
            handler: ConstructionConfigApp.processForm,
            submitOnChange: false,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        main: { template: "modules/dnd-2024-bastion-manager/templates/construction-config.hbs" }
    };

    async _prepareContext(options) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const settings = ["buildCramped", "buildRoomy", "buildVast", "enlargeRoomy", "enlargeVast"];
        const context = {};
        for ( const s of settings ) {
            context[`${s}Cost`] = game.settings.get(MODULE_ID, `${s}Cost`);
            context[`${s}Time`] = game.settings.get(MODULE_ID, `${s}Time`);
        }
        context.buildStages = ["buildCramped", "buildRoomy", "buildVast"];
        context.enlargeStages = ["enlargeRoomy", "enlargeVast"];
        return context; 
    }

    static async processForm(event, form, formData) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const data = formData.object;
        const settings = ["buildCramped", "buildRoomy", "buildVast", "enlargeRoomy", "enlargeVast"];
        for ( const s of settings ) {
            await game.settings.set(MODULE_ID, `${s}Cost`, Number(data[`${s}Cost`]));
            await game.settings.set(MODULE_ID, `${s}Time`, Number(data[`${s}Time`]));
        }
        ui.notifications.info("Bastion Manager | Construction configuration saved.");
    }
}

class ResetBastionsApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "reset-bastions-app",
        window: { title: "Reset Global Bastion Turns" }
    };

    async _renderFrame(options) {
        const confirm = await DialogV2.confirm({
            window: { title: "Reset All Bastion Turns" },
            content: "<p>Are you sure you want to instantly reset the Bastion Turn count to 0 for every character, NPC, and Group in the world?</p>",
            rejectClose: false,
            modal: true
        });

        if (confirm) {
            const MODULE_ID = "dnd-2024-bastion-manager";
            await game.settings.set(MODULE_ID, "globalTurnCount", 0);
            for (const actor of game.actors) {
                const data = actor.getFlag(MODULE_ID, "data");
                if (data && data.turnCount !== undefined) {
                    await actor.setFlag(MODULE_ID, "data.turnCount", 0);
                }
            }
            ui.notifications.info("Bastion Manager | All Bastion turns have been globally reset to 0.");
        }
    }
}

Hooks.once("init", () => {
    const MODULE_ID = "dnd-2024-bastion-manager";
    
    // --- Construction & Upgrade Settings (Main Menu) ---
    game.settings.register(MODULE_ID, "ignoreConstructionCosts", {
        name: "Construction: Ignore All Requirements",
        hint: "If enabled, facilities are built or upgraded instantly with no gold cost or time investment.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        order: 1
    });

    const constructionStages = ["buildCramped", "buildRoomy", "buildVast", "enlargeRoomy", "enlargeVast"];
    for ( const s of constructionStages ) {
        game.settings.register(MODULE_ID, `${s}Cost`, { scope: "world", config: false, type: Number, default: 100 });
        game.settings.register(MODULE_ID, `${s}Time`, { scope: "world", config: false, type: Number, default: 100 });
    }

    game.settings.registerMenu(MODULE_ID, "constructionConfigBtn", {
        name: "Construction Configuration",
        label: "Configure Construction",
        hint: "Adjust the gold and time costs for building and enlarging facilities.",
        icon: "fas fa-hammer",
        type: ConstructionConfigApp,
        restricted: true,
        order: 2
    });

    game.settings.register(MODULE_ID, "advancePermission", {
        name: "Advance Turn Permission",
        hint: "Minimum permission level required to see the Advance Turn controls on a character sheet.",
        scope: "world",
        config: true,
        type: Number,
        choices: { 1: "Player", 2: "Trusted Player", 3: "Assistant GM", 4: "Game Master" },
        default: 4 
    });

    game.settings.register(MODULE_ID, "groupInheritsFacilities", {
        name: "Group Inherits Member Facilities",
        hint: "If enabled, Group actors will automatically display and roll the Bastion orders of all their individual members.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "globalTurnCount", {
        name: "Global Turn Count",
        scope: "world",
        config: false,
        type: Number,
        default: 0
    });

    game.settings.registerMenu(MODULE_ID, "resetAllTurnsBtn", {
        name: "Reset All Bastion Turns",
        label: "Reset Global Turns",
        hint: "Instantly reset the Bastion Turn count to 0 for every character, NPC, and Group in the world.",
        icon: "fas fa-rotate-left",
        type: ResetBastionsApp,
        restricted: true
    });

    game.settings.register(MODULE_ID, "recruitMode", {
        name: "Recruit Order Mode",
        hint: "How should the number of recruited Bastion Defenders be determined?",
        scope: "world",
        config: true,
        type: String,
        default: "roll",
        choices: {
            "roll": "Roll Dice (e.g., 1d4)",
            "max": "Maximum Allowed (e.g., 4)",
            "manual": "Manual Prompt"
        }
    });

    game.settings.register(MODULE_ID, "nameHirelings", {
        name: "Prompt for Hireling/Defender Names",
        hint: "If enabled, the module will prompt you to name new hirelings when building facilities and new defenders when recruiting.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "autoNameDefenders", {
        name: "Auto-Generate Defender Names",
        hint: "If enabled (and the prompt setting above is enabled), the module will automatically generate random names for recruited Bastion Defenders instead of asking you.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "createActorsForHirelings", {
        name: "Create Actors for Hirelings & Defenders",
        hint: "If enabled, whenever you name a new hireling or recruit a defender, the module will automatically generate an Actor in the world sidebar for them.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "ignoreFacilityPrereqs", {
        name: "Ignore Facility Prerequisites",
        hint: "If enabled, the 'Build Facility' dropdown will show all facilities, bypassing level requirements and other prerequisites.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "promptAllEvents", {
        name: "Prompt for Every Event",
        hint: "If enabled, the DM will be asked if they want to automate or manually resolve every single Bastion event that occurs.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "excludedSourcesData", {
        scope: "world", config: false, type: Array, default: []
    });

    game.settings.register(MODULE_ID, "excludedFacilitiesData", {
        scope: "world", config: false, type: Array, default: []
    });

    game.settings.registerMenu(MODULE_ID, "exclusionMenuBtn", {
        name: "Manage Facility Availability",
        label: "Filter Facilities & Sources",
        hint: "Select specific facility items or entire sourcebooks to hide from the Build dropdown.",
        icon: "fas fa-filter",
        type: FacilityExclusionApp,
        restricted: true
    });


});
// Hook into the modern V13 ApplicationV2 Header Controls (The 3-dot menu)
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    // Only target Actor sheets, not generic apps
    if (!app.document || !(app.document instanceof Actor)) return;
    
    const actor = app.document;

    // Allow Characters, NPCs, and Groups to have Bastions
    const allowedTypes = ["character", "npc", "group"];
    if (!allowedTypes.includes(actor.type)) return;

    controls.unshift({
        label: "Bastion",
        icon: "fa-solid fa-chess-rook",   
        action: "openBastionManager"
    });

    if (!app.options.actions) app.options.actions = {};
    if (!app.options.actions.openBastionManager) {
        app.options.actions.openBastionManager = (event, target) => {
            const manager = new BastionManager(actor);
            manager.render({ force: true });
        };
    }
});

// Also inject a button directly into the V2 sheet or V1 sheet tabs
Hooks.on("renderActorSheet", (app, html, data) => {
    // Only target Actor sheets
    if (!app.document || !(app.document instanceof Actor)) return;
    
    const actor = app.document;
    const allowedTypes = ["character", "npc", "group"];
    if (!allowedTypes.includes(actor.type)) return;

    // Simplest approach: Add to sheet header for generic compatibility
    let header = html.find(".window-header .window-title");
    if (header.length > 0 && html.find(".bastion-header-btn").length === 0) {
        let btn = `<a class="bastion-header-btn" title="Open Bastion Manager"><i class="fa-solid fa-chess-rook"></i> Bastion</a>`;
        header.after(btn);
        html.find(".bastion-header-btn").click(ev => {
            ev.preventDefault();
            const manager = new BastionManager(actor);
            manager.render({ force: true });
        });
    }

    // Add as a side tab based on standard 5e character sheets
    let tabs = html.find(".sheet-navigation, nav.tabs, .tabs[data-group='primary']");
    
    if (tabs.length > 0 && html.find(".bastion-tab-btn").length === 0) {
        // Find existing tabs to append to
        let tabBtn = `<a class="item bastion-tab-btn" data-tab="bastion"><i class="fa-solid fa-chess-rook"></i> Bastion</a>`;
        tabs.append(tabBtn);
        
        // Use a persistent object for rendering if possible so it manages state properly
        html.find(".bastion-tab-btn").click(ev => {
            ev.preventDefault();
            const manager = new BastionManager(actor);
            manager.render({ force: true });
        });
    }
});
