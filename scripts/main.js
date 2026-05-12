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
    static BASES = {
        buildCramped: { name: "Add Cramped", gp: 500, turns: 3, days: 20 },
        buildRoomy: { name: "Add Roomy", gp: 1000, turns: 7, days: 45 },
        buildVast: { name: "Add Vast", gp: 3000, turns: 18, days: 125 },
        enlargeRoomy: { name: "Enlarge to Roomy", gp: 500, turns: 4, days: 25 },
        enlargeVast: { name: "Enlarge to Vast", gp: 2000, turns: 12, days: 80 }
    };

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
        const globalCost = game.settings.get(MODULE_ID, "globalCostMultiplier");
        const globalTime = game.settings.get(MODULE_ID, "globalTimeMultiplier");
        
        const settings = ["buildCramped", "buildRoomy", "buildVast", "enlargeRoomy", "enlargeVast"];
        const context = { globalCost, globalTime };
        
        for ( const s of settings ) {
            context[`${s}Cost`] = game.settings.get(MODULE_ID, `${s}Cost`);
            context[`${s}Time`] = game.settings.get(MODULE_ID, `${s}Time`);
        }
        context.buildStages = ["buildCramped", "buildRoomy", "buildVast"];
        context.enlargeStages = ["enlargeRoomy", "enlargeVast"];

        const calculatePreview = (entries) => entries.map(([key, base]) => {
            const sCost = context[`${key}Cost`];
            const sTime = context[`${key}Time`];
            const costPinned = sCost !== base.gp;
            const timePinned = sTime !== base.turns;
            let finalTurns = timePinned ? sTime : Math.floor(base.turns * (globalTime / 100));
            if (!timePinned && globalTime > 0 && base.turns > 0) finalTurns = Math.max(1, finalTurns);
            return {
                key: key,
                label: base.name,
                gp: costPinned ? sCost : Math.floor(base.gp * (globalCost / 100)),
                turns: finalTurns,
                days: timePinned ? Math.floor(base.days * (sTime / base.turns)) : Math.floor(base.days * (globalTime / 100))
            };
        });

        const baseEntries = Object.entries(ConstructionConfigApp.BASES);
        context.previewAdd = calculatePreview(baseEntries.filter(([k]) => k.startsWith("build")));
        context.previewEnlarge = calculatePreview(baseEntries.filter(([k]) => k.startsWith("enlarge")));

        return context; 
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const form = this.element;

        const updateUI = () => {
            const data = new foundry.applications.ux.FormDataExtended(form).object;
            const gCost = Number(data.globalCost);
            const gTime = Number(data.globalTime);

            for (const [key, base] of Object.entries(ConstructionConfigApp.BASES)) {
                const sCost = Number(data[`${key}Cost`]);
                const sTime = Number(data[`${key}Time`]);
                
                const costPinned = sCost !== base.gp;
                const timePinned = sTime !== base.turns;

                const finalGP = costPinned ? sCost : Math.floor(base.gp * (gCost / 100));
                let finalTurns = timePinned ? sTime : Math.floor(base.turns * (gTime / 100));
                if (!timePinned && gTime > 0 && base.turns > 0) finalTurns = Math.max(1, finalTurns);
                const finalDays = timePinned ? Math.floor(base.days * (sTime / base.turns)) : Math.floor(base.days * (gTime / 100));

                const gpEl = form.querySelector(`[data-preview="${key}-gp"]`);
                const timeEl = form.querySelector(`[data-preview="${key}-time"]`);
                if (gpEl) gpEl.innerText = `${finalGP} GP`;
                if (timeEl) timeEl.innerHTML = `${finalTurns} <span style="font-size: 0.9em; color: #888;">(${finalDays}d)</span>`;

                // Visual feedback for pinning
                form.querySelector(`[name="${key}Cost"]`).closest('.form-group').style.opacity = costPinned ? "1" : "0.7";
                form.querySelector(`[name="${key}Time"]`).closest('.form-group').style.opacity = timePinned ? "1" : "0.7";
            }
        };

        form.addEventListener("input", event => {
            const name = event.target.name;
            if (!name) return;
            if (name.endsWith("_num")) {
                form.elements[name.replace("_num", "")].value = event.target.value;
            } else {
                const num = form.elements[`${name}_num`];
                if (num) num.value = event.target.value;
            }
            updateUI();
        });

        form.addEventListener("click", event => {
            const btn = event.target.closest('button[data-action]');
            if (!btn) return;
            
            if (btn.dataset.action === "reset-setting") {
                const target = btn.dataset.target;
                const val = btn.dataset.default;
                form.elements[target].value = val;
                form.elements[`${target}_num`].value = val;
                updateUI();
            } else if (btn.dataset.action === "reset-all") {
                form.elements.globalCost.value = 100;
                form.elements.globalCost_num.value = 100;
                form.elements.globalTime.value = 100;
                form.elements.globalTime_num.value = 100;
                
                for (const [key, base] of Object.entries(ConstructionConfigApp.BASES)) {
                    form.elements[`${key}Cost`].value = base.gp;
                    form.elements[`${key}Cost_num`].value = base.gp;
                    form.elements[`${key}Time`].value = base.turns;
                    form.elements[`${key}Time_num`].value = base.turns;
                }
                updateUI();
            }
        });
    }

    static async processForm(event, form, formData) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const data = formData.object;

        await game.settings.set(MODULE_ID, "globalCostMultiplier", Number(data.globalCost));
        await game.settings.set(MODULE_ID, "globalTimeMultiplier", Number(data.globalTime));

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
        window: { title: "Reset Global Bastion Turns", frame: false },
        position: { width: 400, height: "auto" }
    };

    _renderHTML() { return ""; }
    _replaceHTML() { }

    async _onFirstRender(context, options) {
        this.close();
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

    game.settings.register(MODULE_ID, "disableNeglect", {
        name: "Disable Bastion Neglect",
        hint: "If enabled, Bastions will never decay or be lost due to neglect, even if no orders are issued for long periods.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        order: 1
    });

    game.settings.register(MODULE_ID, "disableSpecialCap", {
        name: "Disable Special Facility Cap",
        hint: "If enabled, characters can build as many special facilities as they wish, ignoring the level-based capacity limits.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        order: 1
    });

    game.settings.register(MODULE_ID, "disableDuplicateLimit", {
        name: "Disable One-Per-Bastion Limit",
        hint: "If enabled, characters can build multiple copies of any special facility, even those not normally allowed by the DMG 2024 rules.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        order: 1
    });

    game.settings.register(MODULE_ID, "globalCostMultiplier", { scope: "world", config: false, type: Number, default: 100 });
    game.settings.register(MODULE_ID, "globalTimeMultiplier", { scope: "world", config: false, type: Number, default: 100 });

    const constructionStages = ["buildCramped", "buildRoomy", "buildVast", "enlargeRoomy", "enlargeVast"];
    const defaultValues = {
        buildCrampedCost: 500, buildCrampedTime: 3,
        buildRoomyCost: 1000, buildRoomyTime: 7,
        buildVastCost: 3000, buildVastTime: 18,
        enlargeRoomyCost: 500, enlargeRoomyTime: 4,
        enlargeVastCost: 2000, enlargeVastTime: 12
    };

    for ( const s of constructionStages ) {
        game.settings.register(MODULE_ID, `${s}Cost`, { scope: "world", config: false, type: Number, default: defaultValues[`${s}Cost`] });
        game.settings.register(MODULE_ID, `${s}Time`, { scope: "world", config: false, type: Number, default: defaultValues[`${s}Time`] });
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

    game.settings.register(MODULE_ID, "specialFacilitiesBuildTime", {
        name: "Special Facilities Have Build Times",
        hint: "If enabled, Special Facilities (except those gained during founding) require gold and time to build based on 'Add Roomy' costs.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "calculationMode", {
        name: "Crafting Calculation Mode",
        hint: "Choose whether multi-turn crafting progress is tracked by Bastion Turns or total Days.",
        scope: "world",
        config: true,
        type: String,
        default: "turns",
        choices: {
            "turns": "Simplified Bastion Turns",
            "days": "Day-by-Day Tracking"
        }
    });

    game.settings.register(MODULE_ID, "daysPerTurn", {
        name: "Days per Bastion Turn",
        hint: "Define how many in-game days are represented by a single Bastion Turn (Default 7).",
        scope: "world",
        config: true,
        type: Number,
        default: 7
    });

    game.settings.register(MODULE_ID, "autoNameHirelings", {
        name: "Auto-Generate Hireling Names",
        hint: "If enabled, leaving a hireling name field blank will result in a name being automatically generated.",
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
