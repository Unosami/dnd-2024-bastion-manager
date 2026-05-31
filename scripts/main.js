import { BastionManager } from "./bastion-app.js"; 
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * FLOATING TURN CONTROL
 * A small UI that appears when the Bastion Advancement tool is selected in the sidebar.
 */
class BastionTurnControl extends HandlebarsApplicationMixin(ApplicationV2) {
    static instance = null;
    static DEFAULT_OPTIONS = {
        id: "bastion-turn-control",
        window: { frame: true, title: "Bastion Advancement", icon: "fa-solid fa-play" },
        position: { width: 240, height: "auto", left: 120, top: 60 },
        classes: ["bastion-app", "bastion-floating-control"],
        actions: {
            advance: function(event, target) {
                const actor = game.user.character || game.actors.find(a => a.items.some(i => i.type === "facility") && a.isOwner) || game.actors.find(a => a.items.some(i => i.type === "facility"));
                if (actor) BastionManager.onAdvanceGlobalTurn.call({ actor, element: this.element }, event, target);
                else ui.notifications.warn("No owned actor with a Bastion found.");
            }
        }
    };

    static PARTS = {
        main: { template: "modules/dnd-2024-bastion-manager/templates/bastion-advance-turn.hbs" }
    };

    static toggle() {
        if (this.instance) { this.instance.close(); this.instance = null; }
        else { this.instance = new BastionTurnControl(); this.instance.render({ force: true }); }
    }

    async _prepareContext(options) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const activeNonGMs = game.users.filter(u => u.active && !u.isGM);
        const bastionActors = game.actors.filter(a => {
            const isAllowedType = a.type === "character" || a.type === "npc";
            const hasFacilities = a.items.some(i => i.type === "facility") || a.getFlag(MODULE_ID, "groupFacilities")?.length > 0;
            const ownedByActivePlayer = activeNonGMs.some(u => a.testUserPermission(u, "OWNER"));
            return isAllowedType && hasFacilities && ownedByActivePlayer;
        });
        return {
            readyCount: bastionActors.filter(a => a.getFlag(MODULE_ID, "isReady")).length,
            totalBastions: bastionActors.length
        };
    }

    _onRender(context, options) {
        // v13: Prevent canvas interaction while typing or clicking in the box
        this.element.addEventListener("mousedown", ev => ev.stopPropagation(), { capture: true });
        this.element.addEventListener("keydown", ev => ev.stopPropagation());
    }
}

/**
 * Placeholder Layer for Bastion Management
 * Required in v13 to support a dedicated sidebar category icon.
 */
class BastionLayer extends (foundry.canvas.layers.InteractionLayer || InteractionLayer) {
    static get layerOptions() {
        return foundry.utils.mergeObject(super.layerOptions, { name: "bastion" });
    }
}

/**
 * Toolbar Integration: Add a new control group to the Scene Controls (left sidebar)
 */
Hooks.on("getSceneControlButtons", (sceneControls) => {
    if ( !game.user?.isGM || !sceneControls ) return;

    // Prepare the Bastion control configuration
    const bastionControl = {
        name: "bastion",
        title: "Bastion Management",
        icon: "fa-solid fa-chess-rook",
        layer: "bastion",
        visible: true,
        activeTool: "advanceTurn", 
        tools: [
            // Tool 1: Advance Turn (Selectable). Clicking this makes it active and opens the prompt.
            { name: "advanceTurn", title: "Advance Bastion Turn", icon: "fa-solid fa-play", visible: true },
            // Tool 2: The Manager button.
            { 
                name: "manager", title: "Open Bastion Manager", icon: "fa-solid fa-gauge-high", 
                button: true, visible: true,
                onChange: () => {
                    const actor = game.user.character || game.actors.find(a => a.items.some(i => i.type === "facility") && a.isOwner) || game.actors.find(a => a.items.some(i => i.type === "facility"));
                    if (actor) new BastionManager(actor).render({ force: true });
                    else ui.notifications.warn("No actor with a Bastion found.");
                }
            }
        ]
    };

    // v13 Stability: SceneControls (ApplicationV2) requires tools to be an Object Map.
    // We manually convert the array to a map here to prevent lookup crashes during layer switching.
    const toolsMap = bastionControl.tools.reduce((map, t) => {
        map[t.name] = t;
        return map;
    }, {});
    bastionControl.tools = toolsMap;

    // Handle both the standard Array structure and the Object map structure seen in your console log
    if ( Array.isArray(sceneControls) ) {
        if ( !sceneControls.some(c => c.name === "bastion") ) {
            console.log("Bastion Manager | Pushing Bastion category to sidebar array.");
            sceneControls.push(bastionControl);
        }
    } else {
        // sceneControls is an Object (Record<string, ControlGroup>)
        if ( !sceneControls.bastion ) {
            sceneControls.bastion = bastionControl;
        }
    }
});

/**
 * Toggle the floating advancement UI when the sidebar tool is active
 */
Hooks.on("renderSceneControls", (app, html, data) => {
    if ( !game.user?.isGM || !app?.control ) return;
    
    // v13 Stability: Use activeTool and control.name for reliable state detection
    const isBastion = app.control.name === "bastion";
    const isAdvanceActive = isBastion && app.tool?.name === "advanceTurn";

    if (isAdvanceActive) {
        if (!BastionTurnControl.instance) {
            BastionTurnControl.instance = new BastionTurnControl();
            BastionTurnControl.instance.render({ force: true });
        }
    } else if (BastionTurnControl.instance) {
        BastionTurnControl.instance.close();
        BastionTurnControl.instance = null;
    }
});

/**
 * INTEGRATION ENGINE: Mutation-Based Injection
 * Since v13 sheets don't always trigger hooks on tab swap, we watch the DOM.
 */
const integrateBastionDashboard = (bastionTab) => {
    // 2. Identify the Actor (Foundry v13 / ApplicationV2 support)
    // We check both the modern instances list and the legacy windows list
    const app = Array.from(foundry.applications.instances.values()).find(a => a.element?.contains(bastionTab))
             || Object.values(ui.windows).find(w => (w.element?.[0] || w.element)?.contains(bastionTab));

    const actor = app?.document || app?.actor;
    if (!actor || actor.documentName !== "Actor") return;
    if (!["character", "npc", "group"].includes(actor.type)) return;

    const MODULE_ID = "dnd-2024-bastion-manager";
    const combinedId = actor.getFlag(MODULE_ID, "combinedGroupId");
    const unify = game.settings.get(MODULE_ID, "unifyCombinedTurns");
    let turnCount = actor.getFlag(MODULE_ID, "turnCount") || 0;
    
    if (unify && combinedId) {
        const group = game.actors.get(combinedId);
        if (group) turnCount = group.getFlag(MODULE_ID, "turnCount") || 0;
    }

    // 3. Create the Suite UI using the native 2024 Cream/Gold theme variables
    if (!bastionTab.querySelector(".bastion-manager-suite")) {
        const suite = document.createElement("div");
        suite.className = "bastion-manager-suite";
        suite.style.cssText = "margin: 5px 0 15px 0; border: 1px solid var(--dnd5e-color-gold); border-radius: 5px; background: var(--dnd5e-color-cream); padding: 12px; font-family: var(--dnd5e-font-roboto); color: var(--dnd5e-color-black); box-shadow: 0 0 5px rgba(0,0,0,0.1);";
        
        suite.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <i class="fa-solid fa-chess-rook" style="font-size: 2em; color: var(--dnd5e-color-iron);"></i>
                    <div>
                        <h3 style="margin: 0; border: none; font-size: 1.1em; font-weight: bold; text-transform: uppercase;">Bastion Management</h3>
                        <div style="font-size: 0.9em; opacity: 0.8;">Module Tracking: <b>Turn ${turnCount}</b></div>
                    </div>
                </div>
                <button type="button" class="launch-bastion-dashboard" style="width: auto; padding: 6px 15px; font-weight: bold; background: var(--dnd5e-color-iron); color: white; border: none; border-radius: 4px; cursor: pointer;">
                    <i class="fa-solid fa-gauge-high"></i> Launch Advanced Controls
                </button>
            </div>
        `;

        bastionTab.prepend(suite);
        
        console.log(`Bastion Manager | Injected management suite for ${actor.name}`);

        // 4. Attach Event Listener
        suite.querySelector(".launch-bastion-dashboard").addEventListener("click", (ev) => {
            ev.preventDefault();
            new BastionManager(actor).render({ force: true });
        });
    }

    // 5. Integrate Memorial Wall button into the native Defenders section
    // Look for the header containing "Defenders" within the bastion tab
    const defenderHeader = Array.from(bastionTab.querySelectorAll('h3, .label')).find(el => el.textContent.includes("Defenders"));
    if (defenderHeader && !defenderHeader.querySelector(".bastion-graveyard-btn")) {
        const graveyardBtn = document.createElement("button");
        graveyardBtn.type = "button";
        graveyardBtn.className = "bastion-graveyard-btn";
        graveyardBtn.title = "View Memorial Wall (Fallen Defenders)";
        graveyardBtn.innerHTML = '<i class="fa-solid fa-tombstone"></i>';
        graveyardBtn.style.cssText = "width: auto; padding: 0 4px; border: none; background: none; cursor: pointer; color: var(--dnd5e-color-iron); vertical-align: middle; font-size: 0.8em; margin-left: 5px;";
        
        defenderHeader.appendChild(graveyardBtn);
        graveyardBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            BastionManager.onViewGraveyard.call({ actor }, ev, graveyardBtn);
        });
    }

    // 6. Replace native "Add Facility" buttons and placeholders, respecting capacity
    const actorLevel = actor.system.details?.level || 0;
    let specCap = 0;
    if (actorLevel >= 17) specCap = 6;
    else if (actorLevel >= 13) specCap = 5;
    else if (actorLevel >= 9) specCap = 4;
    else if (actorLevel >= 5) specCap = 2;

    const groupFacilities = actor.getFlag(MODULE_ID, "groupFacilities") || [];
    const currentSpecials = actor.items.filter(i => i.type === "facility" && i.system?.type?.value === "special").length + 
                           groupFacilities.filter(f => !f.system?.type?.value || f.system?.type?.value === "special").length;

    const atSpecCap = currentSpecials >= specCap;

    const nativeBuildButtons = bastionTab.querySelectorAll('[data-action="createChild"][data-type="facility"], [data-action="findItem"][data-item-type="facility"]');
    nativeBuildButtons.forEach(btn => {
        if (btn.classList.contains("bastion-replaced")) return;
        
        // Check if this is a "Special" slot specifically for capacity checks
        const isSpecialSlot = btn.dataset.facilityType === "special";

        // If this is a special facility slot and we are at the cap, hide it entirely
        if (isSpecialSlot && atSpecCap) {
            btn.style.setProperty("display", "none", "important");
            btn.classList.add("bastion-replaced");
            return;
        }

        // Aggressively hide native
        btn.style.setProperty("display", "none", "important");
        btn.classList.add("bastion-replaced");

        // Create replacement (LI for placeholders, button/a for section buttons)
        const isPlaceholder = btn.tagName === "LI";
        const newBtn = document.createElement(btn.tagName);
        newBtn.className = btn.className.replace("bastion-replaced", "") + " bastion-build-injected";
        newBtn.innerHTML = btn.innerHTML.replace("Add Facility", "Build Facility");
        newBtn.title = "Establish Facility (Bastion Manager)";
        
        if (btn.tagName === "BUTTON") newBtn.type = "button";
        if (isPlaceholder) newBtn.style.cursor = "pointer";

        btn.insertAdjacentElement('beforebegin', newBtn);

        newBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            new BastionManager(actor)._promptBuildFacility();
        });
    });

    // 7. Inject Special Facilities currently under construction
    // Native dnd5e 5.2.x uses a specific list for special facilities
    const specialList = bastionTab.querySelector('.bastion-section.special .features-list, [data-facility-type="special"] .features-list, .special ul');
    if (specialList) {
        const groupFacilities = actor.getFlag(MODULE_ID, "groupFacilities") || [];
        // Filter for special facilities (no size yet or specifically marked as building)
        const buildingSpecials = groupFacilities.filter(f => {
            const isSpec = !f.system?.type?.value || f.system?.type?.value === "special";
            return isSpec && f.flags?.[MODULE_ID]?.upgradeTurns > 0;
        });

        buildingSpecials.forEach(fac => {
            const facId = fac._id;
            // Prevent duplicates
            if (specialList.querySelector(`[data-bastion-building="${facId}"]`)) return;

            const fFlags = fac.flags[MODULE_ID];
            const progress = fFlags.upgradeProgress || 0;
            const total = fFlags.upgradeTurns || 1;
            const pct = Math.round((progress / total) * 100);
            const label = fFlags.size ? "Enlarging" : "Founding";

            const li = document.createElement("li");
            li.className = "item facility building-placeholder";
            li.dataset.bastionBuilding = facId;
            // Matching native dnd5e "Modern" list item styles with a construction twist
            li.style.cssText = "opacity: 0.75; border-left: 4px solid var(--dnd5e-color-gold); padding: 8px; margin-bottom: 6px; background: rgba(0,0,0,0.03); border-radius: 4px; list-style: none; position: relative;";
            
            li.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px;">
                    <img src="${fac.img}" width="32" height="32" style="border: none; border-radius: 4px; filter: grayscale(1) sepia(0.5);">
                    <div style="flex: 1;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-family: var(--dnd5e-font-roboto); font-weight: bold; font-size: 1.05em; color: var(--dnd5e-color-black);">${fac.name} <span style="font-weight: normal; font-size: 0.8em; opacity: 0.7;">(${label})</span></span>
                            <a data-action="deleteFacility" data-item-id="${facId}" data-is-flag="true" title="Cancel Construction" style="color: var(--dnd5e-color-iron);"><i class="fa-solid fa-circle-xmark"></i></a>
                        </div>
                        <div class="progress-bar" style="height: 14px; background: rgba(0,0,0,0.1); border: 1px solid #7a7971; border-radius: 3px; position: relative; overflow: hidden;">
                            <div style="width: ${pct}%; height: 100%; background: var(--dnd5e-color-gold); transition: width 0.5s; border-right: 1px solid #7a7971;"></div>
                            <span style="position: absolute; top: 0; left: 0; width: 100%; text-align: center; font-size: 0.75em; line-height: 14px; color: #111; font-weight: bold; text-shadow: 0 0 2px white;">${progress} / ${total} Turns</span>
                        </div>
                    </div>
                </div>
            `;

            // Prepend so new constructions appear at the top of the list
            specialList.prepend(li);

            // Re-attach delete logic for cancellation
            li.querySelector('[data-action="deleteFacility"]').addEventListener("click", (ev) => {
                ev.preventDefault();
                BastionManager.onDeleteFacility.call({ actor }, ev, ev.currentTarget);
            });
        });
    }

    // 8. Inject Basic Facilities currently under construction
    const basicList = bastionTab.querySelector('.bastion-section.basic .features-list, [data-facility-type="basic"] .features-list, .basic ul');
    if (basicList) {
        const groupFacilities = actor.getFlag(MODULE_ID, "groupFacilities") || [];
        const buildingBasics = groupFacilities.filter(f => {
            return f.system?.type?.value === "basic" && f.flags?.[MODULE_ID]?.upgradeTurns > 0;
        });

        buildingBasics.forEach(fac => {
            const facId = fac._id;
            if (basicList.querySelector(`[data-bastion-building="${facId}"]`)) return;

            const fFlags = fac.flags[MODULE_ID];
            const progress = fFlags.upgradeProgress || 0;
            const total = fFlags.upgradeTurns || 1;
            const pct = Math.round((progress / total) * 100);
            const label = fFlags.size ? "Enlarging" : "Building";

            const li = document.createElement("li");
            li.className = "item facility building-placeholder";
            li.dataset.bastionBuilding = facId;
            li.style.cssText = "opacity: 0.75; border-left: 4px solid var(--dnd5e-color-iron); padding: 6px; margin-bottom: 4px; background: rgba(0,0,0,0.03); border-radius: 4px; list-style: none;";
            
            li.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <img src="${fac.img}" width="24" height="24" style="border: none; border-radius: 2px; filter: grayscale(1);">
                    <div style="flex: 1;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; font-family: var(--dnd5e-font-roboto);">
                            <span style="font-family: var(--dnd5e-font-roboto); font-weight: bold; font-size: 0.9em; color: var(--dnd5e-color-black);">${fac.name} <span style="font-weight: normal; font-size: 0.85em; opacity: 0.7;">(${label})</span></span>
                            <a data-action="deleteFacility" data-item-id="${facId}" data-is-flag="true" title="Cancel Construction" style="color: var(--dnd5e-color-iron); font-size: 0.8em;"><i class="fa-solid fa-circle-xmark"></i></a>
                        </div>
                        <div class="progress-bar" style="height: 10px; background: rgba(0,0,0,0.1); border: 1px solid #7a7971; border-radius: 2px; position: relative; overflow: hidden;">
                            <div style="width: ${pct}%; height: 100%; background: #7a7971; transition: width 0.5s;"></div>
                            <span style="position: absolute; top: 0; left: 0; width: 100%; text-align: center; font-size: 0.7em; line-height: 10px; color: white; font-weight: bold; text-shadow: 0 0 2px black;">${progress} / ${total}</span>
                        </div>
                    </div>
                </div>
            `;

            basicList.prepend(li);

            li.querySelector('[data-action="deleteFacility"]').addEventListener("click", (ev) => {
                ev.preventDefault();
                // We can use the static method directly since we are passing context via .call
                BastionManager.onDeleteFacility.call({ actor }, ev, ev.currentTarget);
            });
        });
    }

    // 9. Inject turn input next to native advance button on sheet
    const nativeAdvanceBtn = bastionTab.querySelector('[data-action="advanceBastionTurn"]');
    if ( nativeAdvanceBtn && !nativeAdvanceBtn.parentElement.querySelector(".bastion-turn-input-injected") ) {
        const input = document.createElement("input");
        input.type = "number";
        input.className = "bastion-turn-input-injected";
        input.name = "bastion-manager-turns";
        input.value = "1";
        input.min = "1";
        input.style.cssText = "width: 45px; height: 24px; text-align: center; margin-left: 5px; border: 1px solid var(--dnd5e-color-gold); border-radius: 4px; background: var(--dnd5e-color-cream); color: var(--dnd5e-color-black); font-weight: bold; font-family: var(--dnd5e-font-roboto); pointer-events: auto;";
        input.title = "Number of turns to advance (Bastion Manager)";
        
        // Ensure the input is editable by stopping event propagation
        input.addEventListener("mousedown", (ev) => ev.stopPropagation());
        input.addEventListener("click", (ev) => ev.stopPropagation());

        nativeAdvanceBtn.after(input);
    }
};

/**
 * DOM OBSERVER
 * This runs in the background and watches for the Bastion tab being shown.
 */
const observer = new MutationObserver(() => {
    // Check all elements matching the bastion tab selector
    document.querySelectorAll('section[data-tab="bastion"], div[data-tab="bastion"]').forEach(bastionTab => {
        if (!bastionTab.classList.contains('item') && !bastionTab.classList.contains('anchor')) {
            // In ApplicationV2, the tab is always in the DOM but hidden via display: none
            const style = window.getComputedStyle(bastionTab);
            if (style.display !== 'none') {
                integrateBastionDashboard(bastionTab);
            }
        }
    });
});
observer.observe(document.body, { childList: true, subtree: true });

/**
 * INITIALIZATION
 */
Hooks.once("init", () => {
    const MODULE_ID = "dnd-2024-bastion-manager";
    Handlebars.registerHelper({ ge: (a, b) => a >= b, div: (a, b) => a / b, mult: (a, b) => a * b });

    // v13: Define and register dummy layer inside init to ensure namespaces are ready
    CONFIG.Canvas.layers.bastion = { 
        layerClass: BastionLayer, 
        group: "interface" 
    };

    // --- Settings Registration ---
    game.settings.register(MODULE_ID, "ignoreConstructionCosts", { name: "Construction: Ignore All Requirements", scope: "world", config: true, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "disableNeglect", { name: "Disable Bastion Neglect", scope: "world", config: true, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "disableSpecialCap", { name: "Disable Special Facility Cap", scope: "world", config: true, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "disableDuplicateLimit", { name: "Disable One-Per-Bastion Limit", scope: "world", config: true, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "globalCostMultiplier", { scope: "world", config: false, type: Number, default: 100 });
    game.settings.register(MODULE_ID, "globalTimeMultiplier", { scope: "world", config: false, type: Number, default: 100 });

    const defaultValues = { buildCrampedCost: 500, buildCrampedTime: 3, buildRoomyCost: 1000, buildRoomyTime: 7, buildVastCost: 3000, buildVastTime: 18, enlargeRoomyCost: 500, enlargeRoomyTime: 4, enlargeVastCost: 2000, enlargeVastTime: 12 };
    for (const [key, val] of Object.entries(defaultValues)) game.settings.register(MODULE_ID, key, { scope: "world", config: false, type: Number, default: val });

    game.settings.registerMenu(MODULE_ID, "constructionConfigBtn", { name: "Construction Configuration", label: "Configure Construction", icon: "fas fa-hammer", type: ConstructionConfigApp, restricted: true });
    game.settings.register(MODULE_ID, "advancePermission", { name: "Advance Turn Permission", scope: "world", config: true, type: Number, choices: { 1: "Player", 2: "Trusted Player", 3: "Assistant GM", 4: "Game Master" }, default: 4 });
    game.settings.register(MODULE_ID, "groupInheritsFacilities", { name: "Group Inherits Member Facilities", scope: "world", config: true, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "unifyCombinedTurns", { name: "Unify Combined Bastion Turns", scope: "world", config: true, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "globalTurnCount", { name: "Global Turn Count", scope: "world", config: true, type: Number, default: 0 });
    game.settings.registerMenu(MODULE_ID, "resetAllTurnsBtn", { name: "Reset All Bastion Turns", label: "Reset Global Turns", icon: "fas fa-rotate-left", type: ResetBastionsApp, restricted: true });
    game.settings.register(MODULE_ID, "recruitMode", { name: "Recruit Order Mode", scope: "world", config: true, type: String, default: "roll", choices: { "roll": "Roll Dice", "max": "Maximum Allowed", "manual": "Manual Prompt" } });
    game.settings.register(MODULE_ID, "nameHirelings", { name: "Prompt for Hireling/Defender Names", scope: "world", config: true, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "specialFacilitiesBuildTime", { name: "Special Facilities Have Build Times", scope: "world", config: true, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "calculationMode", { name: "Crafting Calculation Mode", scope: "world", config: true, type: String, default: "turns", choices: { "turns": "Bastion Turns", "days": "Days" } });
    game.settings.register(MODULE_ID, "daysPerTurn", { name: "Days per Bastion Turn", scope: "world", config: true, type: Number, default: 7 });
    game.settings.register(MODULE_ID, "scaleWeekToTurnLength", { name: "Scale Weekly Durations", scope: "world", config: true, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "autoNameHirelings", { name: "Auto-Generate Hireling Names", scope: "world", config: true, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "autoNameDefenders", { name: "Auto-Generate Defender Names", scope: "client", config: true, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "createActorsForHirelings", { name: "Create Actors for Staff", scope: "world", config: true, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "ignoreFacilityPrereqs", { name: "Ignore Facility Prerequisites", scope: "world", config: true, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "promptAllEvents", { name: "Prompt for Every Event", scope: "world", config: true, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "manualEventSelection", { name: "Manually Choose Events", scope: "world", config: true, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "excludedSourcesData", { scope: "world", config: false, type: Array, default: [] });
    game.settings.register(MODULE_ID, "excludedFacilitiesData", { scope: "world", config: false, type: Array, default: [] });
    game.settings.registerMenu(MODULE_ID, "exclusionMenuBtn", { name: "Manage Facility Availability", label: "Filter Facilities", icon: "fas fa-filter", type: FacilityExclusionApp, restricted: true });
});

Hooks.once("ready", async () => {
    console.log("Bastion Manager | Foundry is ready.");
    game.modules.get("dnd-2024-bastion-manager").api = { BastionManager };
    await BastionManager.loadProfessions();

    // v13: Force control refresh to ensure the Bastion category appears for the GM
    if ( game.user.isGM ) { console.log("Bastion Manager | Forcing sidebar re-render."); ui.controls.render(true); }

    // Hide native floating Bastion button
    const style = document.createElement("style");
    style.innerHTML = `#bastion-turn { display: none !important; }`;
    document.head.appendChild(style);

    // Robust Link: Override the native advance method on the Bastion data model.
    // This acts as a logic-level fallback if the UI hijack is bypassed.
    const BastionData = game.dnd5e?.dataModels?.actor?.BastionData;
    if ( BastionData ) {
        const originalAdvance = BastionData.prototype.advance;
        let isAdvancing = false;
        
        BastionData.prototype.advance = async function(options = {}) {
            if ( game.user.isGM && !isAdvancing ) {
                isAdvancing = true;
                try {
                    // Redirect to the module's Global Advance engine
                    const actor = this.parent instanceof Actor ? this.parent : this.parent?.parent;
                    if ( actor ) {
                        await BastionManager.onAdvanceGlobalTurn.call({ actor }, new Event("click"), null);
                        return []; // Return empty array to prevent the native chat summary from generating
                    }
                } finally {
                    // Short debounce to handle concurrent calls from the map sidebar
                    setTimeout(() => isAdvancing = false, 500);
                }
            }
            if ( isAdvancing ) return []; 
            return originalAdvance.call(this, options);
        };
    }

    // Robust Hijack: Intercept native Bastion Turn Advancement UI clicks.
    // We use a capture-phase listener on the window to stop the event before dnd5e handlers can trigger the native confirmation prompt.
    window.addEventListener("click", (event) => {
        // Target native actions from the sheet and the canvas sidebar (floating button is hidden)
        const btn = event.target.closest('[data-action="advanceBastionTurn"], [data-action="advance"], [data-action="advance-turn"]');
        if ( !btn || !game.user.isGM || btn.closest('.bastion-app') ) return;

        // Kill the event immediately to prevent the native confirmation dialog
        event.stopImmediatePropagation();
        event.stopPropagation();
        event.preventDefault();

        // Determine the Actor context from the parent application
        const app = Array.from(foundry.applications.instances.values()).find(a => a.element?.contains(btn))
                 || Object.values(ui.windows).find(w => (w.element?.[0] || w.element)?.contains(btn));
        
        // If we can't find the app, find an owned actor with a Bastion to act as the context
        const actor = app?.document || app?.actor || game.actors.find(a => a.items.some(i => i.type === "facility") && a.isOwner);

        if ( actor ) {
            console.log(`Bastion Manager | Hijacking native advancement for ${actor.name}.`);
            BastionManager.onAdvanceGlobalTurn.call({ actor, element: btn.parentElement }, event, btn);
        }
    }, { capture: true });

    // Socket listeners
    game.socket.on("module.dnd-2024-bastion-manager", (data) => {
        if (data.action === "globalAdvance") {
            for (const app of foundry.applications.instances.values()) {
                if (app.constructor.name === "BastionManager") app.render();
            }
        } else if (data.action === "theaterJoinRequest") {
            if (!game.user.isGM) return;
            const actor = game.actors.get(data.actorId);
            if (actor) BastionManager.updateTheaterContributors(actor, data.itemId, data.isFlag, data.characterData);
        } else if (data.action === "theaterLeaveRequest") {
            if (!game.user.isGM) return;
            const actor = game.actors.get(data.actorId);
            if (actor) BastionManager.removeTheaterContributor(actor, data.itemId, data.isFlag, data.characterId);
        }
    });
});

/**
 * RE-RENDER REACTIVITY
 * Re-render our advanced manager if actor data changes.
 */
Hooks.on("updateActor", (actor, changes) => {
    const MODULE_ID = "dnd-2024-bastion-manager";
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) {
        for (const app of foundry.applications.instances.values()) {
            if (app.constructor.name === "BastionManager" && app.actor.id === actor.id) app.render();
        }
    }
});

/**
 * CONFIGURATION CLASSES
 */
class FacilityExclusionApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "facility-exclusion-app", tag: "form",
        window: { title: "Manage Facility Availability", resizable: true },
        position: { width: 600, height: 700 }, classes: ["bastion-app"],
        form: { handler: FacilityExclusionApp.processForm, closeOnSubmit: true }
    };
    static PARTS = { main: { template: "modules/dnd-2024-bastion-manager/templates/facility-exclusions.hbs" } };
    async _prepareContext() {
        const pack = game.packs.get("dnd-2024-bastion-manager.bastion-facilities");
        if (!pack) return { sources: [], facilities: [] };
        const allDocs = await pack.getDocuments();
        let excludedSources = game.settings.get("dnd-2024-bastion-manager", "excludedSourcesData") || [];
        let excludedFacilities = game.settings.get("dnd-2024-bastion-manager", "excludedFacilitiesData") || [];
        let sourceMap = new Map();
        let facilityList = [];
        for (const item of allDocs) {
            let source = item.system?.source?.label || item.system?.source || "Unknown";
            if (!sourceMap.has(source)) sourceMap.set(source, { name: source, excluded: excludedSources.includes(source) });
            facilityList.push({ id: item.id, name: item.name, source, excluded: excludedFacilities.includes(item.id) });
        }
        return { sources: Array.from(sourceMap.values()), facilities: facilityList };
    }
    static async processForm(event, form, formData) {
        let sources = [], facs = [];
        for (let [k, v] of Object.entries(formData.object)) {
            if (v) {
                if (k.startsWith("source_")) sources.push(k.replace("source_", ""));
                else if (k.startsWith("fac_")) facs.push(k.replace("fac_", ""));
            }
        }
        await game.settings.set("dnd-2024-bastion-manager", "excludedSourcesData", sources);
        await game.settings.set("dnd-2024-bastion-manager", "excludedFacilitiesData", facs);
        location.reload();
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
        id: "construction-config-app", tag: "form",
        window: { title: "Construction Configuration", resizable: true },
        position: { width: 450, height: "auto" }, classes: ["bastion-app"],
        form: { handler: ConstructionConfigApp.processForm, closeOnSubmit: true }
    };
    static PARTS = { main: { template: "modules/dnd-2024-bastion-manager/templates/construction-config.hbs" } };
    async _prepareContext() {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const context = { globalCost: game.settings.get(MODULE_ID, "globalCostMultiplier"), globalTime: game.settings.get(MODULE_ID, "globalTimeMultiplier") };
        for (const s of ["buildCramped", "buildRoomy", "buildVast", "enlargeRoomy", "enlargeVast"]) {
            context[`${s}Cost`] = game.settings.get(MODULE_ID, `${s}Cost`);
            context[`${s}Time`] = game.settings.get(MODULE_ID, `${s}Time`);
        }
        context.buildStages = ["buildCramped", "buildRoomy", "buildVast"];
        context.enlargeStages = ["enlargeRoomy", "enlargeVast"];
        const calculatePreview = (entries) => entries.map(([key, base]) => {
            const sCost = context[`${key}Cost`], sTime = context[`${key}Time`], costPinned = sCost !== base.gp, timePinned = sTime !== base.turns;
            let finalTurns = timePinned ? sTime : Math.floor(base.turns * (context.globalTime / 100));
            return { key, label: base.name, gp: costPinned ? sCost : Math.floor(base.gp * (context.globalCost / 100)), turns: finalTurns, days: timePinned ? Math.floor(base.days * (sTime / base.turns)) : Math.floor(base.days * (context.globalTime / 100)) };
        });
        const baseEntries = Object.entries(ConstructionConfigApp.BASES);
        context.previewAdd = calculatePreview(baseEntries.filter(([k]) => k.startsWith("build")));
        context.previewEnlarge = calculatePreview(baseEntries.filter(([k]) => k.startsWith("enlarge")));
        return context; 
    }
    _onRender(context, options) {
        super._onRender(context, options);
        this.element.addEventListener("input", event => {
            const form = this.element, data = new foundry.applications.ux.FormDataExtended(form).object;
            for (const [key, base] of Object.entries(ConstructionConfigApp.BASES)) {
                const sCost = Number(data[`${key}Cost`]), sTime = Number(data[`${key}Time`]);
                const finalGP = sCost !== base.gp ? sCost : Math.floor(base.gp * (Number(data.globalCost) / 100));
                const gpEl = form.querySelector(`[data-preview="${key}-gp"]`);
                if (gpEl) gpEl.innerText = `${finalGP} GP`;
            }
        });
    }
    static async processForm(event, form, formData) {
        const MODULE_ID = "dnd-2024-bastion-manager", data = formData.object;
        await game.settings.set(MODULE_ID, "globalCostMultiplier", Number(data.globalCost));
        await game.settings.set(MODULE_ID, "globalTimeMultiplier", Number(data.globalTime));
        for (const s of ["buildCramped", "buildRoomy", "buildVast", "enlargeRoomy", "enlargeVast"]) {
            await game.settings.set(MODULE_ID, `${s}Cost`, Number(data[`${s}Cost`]));
            await game.settings.set(MODULE_ID, `${s}Time`, Number(data[`${s}Time`]));
        }
        ui.notifications.info("Bastion Manager | Configuration saved.");
    }
}

class ResetBastionsApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = { id: "reset-bastions-app", window: { title: "Reset Global Bastion Turns", frame: true }, position: { width: 300, height: "auto" } };
    async _renderHTML() { return `<p style="padding: 10px; text-align: center;">Resetting Turns...</p>`; }
    async _onFirstRender() {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const confirm = await DialogV2.confirm({ window: { title: "Reset All Turns" }, content: `<p>Are you sure you want to reset ALL bastion turns to 0?</p>` });
        if (confirm) {
            await game.settings.set(MODULE_ID, "globalTurnCount", 0);
            for (const actor of game.actors) await actor.unsetFlag(MODULE_ID, "turnCount");
            ui.notifications.info("Bastion turns globally reset.");
        }
        this.close();
    }
}

/**
 * HEADER CONTROLS
 * Add a 3-dot menu option to open the manager directly for any actor sheet.
 */
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const actor = app.document;
    if (!(actor instanceof Actor) || !["character", "npc", "group"].includes(actor.type)) return;
    controls.unshift({ label: "Bastion Manager", icon: "fa-solid fa-chess-rook", action: "openBastionManager" });
    if (!app.options.actions) app.options.actions = {};
    app.options.actions.openBastionManager = () => new BastionManager(actor).render({ force: true });
});

// Header hook for legacy Actor Sheets (V1/V2 backward compatibility)
Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
    buttons.unshift({
        label: "Bastion", class: "bastion-header-btn", icon: "fa-solid fa-chess-rook",
        onclick: () => new BastionManager(app.actor).render({ force: true })
    });
});