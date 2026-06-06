import { BastionManager } from "./bastion-app.js";
const MODULE_ID = "dnd-2024-bastion-manager";
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

    async _prepareContext(options) {
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
    if ( !sceneControls ) return;
    const isGM = game.user?.isGM ?? false;

    // Prepare the Bastion control configuration
    const bastionControl = {
        name: "bastion",
        title: "Bastion Management",
        icon: "fa-solid fa-chess-rook",
        layer: "bastion",
        visible: true,
        activeTool: isGM ? "advanceTurn" : "manager",
        tools: [
            // Tool 1: Advance Bastion Turn — GM only
            { name: "advanceTurn", title: "Advance Bastion Turn", icon: "fa-solid fa-play", visible: isGM },
            // Tool 2: Open Bastion Manager — available to all users (players open their own bastion)
            { 
                name: "manager", title: "Open Bastion Manager", icon: "fa-solid fa-gauge-high", 
                button: true, visible: true,
                onChange: async () => {
                    if (!isGM) {
                        // Players: open their assigned character's bastion dashboard.
                        // No facility guard — the dashboard itself handles the founding flow.
                        const playerActor = game.user.character;
                        if (!playerActor) return ui.notifications.warn("No character is assigned to your user. Ask your GM to assign one.");
                        return new BastionManager(playerActor).render({ force: true });
                    }

                    // GMs: pick from all bastions
                    const bastionActors = game.actors.filter(a => 
                        a.items.some(i => i.type === "facility") || 
                        (a.getFlag(MODULE_ID, "groupFacilities")?.length > 0)
                    );

                    if (bastionActors.length === 0) return ui.notifications.warn("No actor with a Bastion found.");
                    if (bastionActors.length === 1) return new BastionManager(bastionActors[0]).render({ force: true });

                    // If multiple bastions exist, let the GM choose which one to open
                    const options = bastionActors.map(a => `<option value="${a.id}">${a.name}</option>`).join("");
                    const selectedId = await DialogV2.prompt({
                        window: { title: "Select Bastion to Manage", icon: "fa-solid fa-chess-rook" },
                        content: `<p>Which character's Bastion would you like to manage?</p><div class="form-group"><label>Character:</label><select name="actorId">${options}</select></div>`,
                        ok: { label: "Open Manager", callback: (event, button) => button.form.elements.actorId.value },
                        rejectClose: false
                    });

                    if (selectedId) {
                        const actor = game.actors.get(selectedId);
                        if (actor) new BastionManager(actor).render({ force: true });
                    }
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

    // v13 Stability: Use game.actors.get to ensure we have the most current DB state,
    // as app references can be stale during asynchronous render cycles.
    const actor = game.actors.get((app?.document || app?.actor)?.id);
    if (!actor || actor.documentName !== "Actor") return;
    if (!["character", "npc", "group"].includes(actor.type)) return;

    // Inject bastion tab CSS overrides once into document.head (idempotent)
    if (!document.getElementById('bastion-manager-tab-styles')) {
        const style = document.createElement('style');
        style.id = 'bastion-manager-tab-styles';
        style.textContent = `
            /* Facility title: white text + dark text-shadow for readability over any image overlay */
            .dnd5e2 .tab[data-tab="bastion"] li.facility:not(.empty) .facility-header .name-stacked .title {
                color: white !important;
                text-shadow: 0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6) !important;
            }
            /* Hide native facility subtitle — it shows system.size which defaults to "Cramped"
               for all facilities since the module stores real sizes in flags.
               Module shows size contextually via enlarging/building progress bars. */
            .dnd5e2 .tab[data-tab="bastion"] li.facility:not(.empty) .facility-header .name-stacked .subtitle {
                display: none !important;
            }
            .tab[data-tab="bastion"] li.facility .bastion-order-block,
            .tab[data-tab="bastion"] li.facility .bastion-augmented-info {
                background: rgba(15, 12, 8, 0.82) !important;
                color: #e8e4d9 !important;
                position: relative !important;
                z-index: 1 !important;
            }
            .tab[data-tab="bastion"] li.facility .bastion-order-block label,
            .tab[data-tab="bastion"] li.facility .bastion-order-block div,
            .tab[data-tab="bastion"] li.facility .bastion-augmented-info div,
            .tab[data-tab="bastion"] li.facility .bastion-augmented-info b {
                color: #e8e4d9 !important;
            }
            /* Progress bar track — needs light bg to be visible on dark block */
            .tab[data-tab="bastion"] li.facility .bastion-augmented-info div[style*="height:6px"] {
                background: rgba(255, 255, 255, 0.18) !important;
            }
            /* Turn counter beside bastion name */
            .tab[data-tab="bastion"] section.name .bastion-turn-counter {
                color: var(--dnd5e-color-gold, #c9a227) !important;
            }
        `;
        document.head.appendChild(style);
    }

    const combinedId = actor.getFlag(MODULE_ID, "combinedGroupId");
    const unify = game.settings.get(MODULE_ID, "unifyCombinedTurns");
    let turnCount = actor.getFlag(MODULE_ID, "turnCount") || 0;
    
    if (unify && combinedId) {
        const group = game.actors.get(combinedId);
        if (group) turnCount = group.getFlag(MODULE_ID, "turnCount") || 0;
    }

    // Robust Capacity and Defender Tallying (Consolidated for all sub-sections)
    const groupFacilities = actor.getFlag(MODULE_ID, "groupFacilities") || [];
    const facPack = game.packs.get(`${MODULE_ID}.bastion-facilities`);
    const basicRoot = facPack?.folders.find(f => f.name.toLowerCase().includes("basic"));
    const basicFolderIds = basicRoot ? BastionManager._getAllSubfolderIds(facPack, basicRoot.id) : [];

    const isBasicFac = (facDoc) => {
        const folderId = facDoc.folder?.id || facDoc.folder;
        return basicFolderIds.includes(folderId) || facDoc.system?.type?.value === "basic" || facDoc.name?.toLowerCase().includes("basic");
    };

    const totalBastionDefs = actor.items.filter(i => i.type === "facility").reduce((sum, i) => {
        return sum + (i.getFlag(MODULE_ID, "defenders")?.count || 0);
    }, 0) + groupFacilities.reduce((sum, f) => {
        return sum + (f.flags?.[MODULE_ID]?.defenders?.count || 0);
    }, 0);

    const currentSpecialsCount = actor.items.filter(i => i.type === "facility" && !isBasicFac(i)).length + 
                                groupFacilities.filter(f => !isBasicFac(f)).length;

    // 3. Inject turn counter beside the native bastion name field (small, right-aligned)
    const nameSection = bastionTab.querySelector('section.name');
    if (nameSection) {
        let counter = nameSection.querySelector('.bastion-turn-counter');
        if (!counter) {
            // One-time setup: only mutate DOM when the element doesn't exist yet
            nameSection.style.position = 'relative';
            counter = document.createElement('div');
            counter.className = 'bastion-turn-counter';
            counter.style.cssText = 'position: absolute; right: 6px; top: 50%; transform: translateY(-50%); font-size: 0.625rem; font-family: var(--dnd5e-font-roboto, sans-serif); opacity: 0.75; letter-spacing: 0.04em; white-space: nowrap; pointer-events: none;';
            counter.innerHTML = `<i class="fa-solid fa-rotate" style="font-size:0.85em; margin-right:2px;"></i>Turn <b class="bastion-turn-value">${turnCount}</b>`;
            nameSection.appendChild(counter);
        } else {
            // Update only the text node — avoids triggering the MutationObserver
            const val = counter.querySelector('.bastion-turn-value');
            if (val && val.textContent !== String(turnCount)) val.textContent = turnCount;
        }
    }

    // 3.5. If actor has no facilities yet, show a founding prompt and hide the empty native sections
    const hasNoFacilities = !actor.items.some(i => i.type === "facility") && groupFacilities.length === 0;
    if (hasNoFacilities) {
        bastionTab.querySelectorAll('section.facilities').forEach(s => s.style.setProperty('display', 'none', 'important'));
        if (!bastionTab.querySelector('.bastion-founding-ui')) {
            const foundingDiv = document.createElement('div');
            foundingDiv.className = 'bastion-founding-ui';
            foundingDiv.style.cssText = 'margin: 10px 5px;';
            foundingDiv.innerHTML = `
                <div style="text-align: center; padding: 24px 16px; background: rgba(15, 12, 8, 0.85); border: 2px dashed var(--dnd5e-color-gold, #c9a227); border-radius: 8px;">
                    <i class="fa-solid fa-chess-rook" style="font-size: 2.5em; color: var(--dnd5e-color-gold, #c9a227); display: block; margin-bottom: 8px;"></i>
                    <div style="font-size: 1.05em; font-weight: bold; text-transform: uppercase; color: #e8e4d9; margin-bottom: 6px;">No Bastion Established</div>
                    <div style="font-size: 0.88em; color: rgba(232, 228, 217, 0.75); margin-bottom: 14px; line-height: 1.4;">Select two Special Facilities and two Basic Facilities to found your stronghold.</div>
                    <button type="button" class="bastion-found-btn" style="width: auto; padding: 8px 20px; font-weight: bold; background: var(--dnd5e-color-iron, #6e6e6e); color: white; border: none; border-radius: 4px; cursor: pointer;">
                        <i class="fa-solid fa-sparkles"></i> Found Your Bastion
                    </button>
                </div>
            `;
            const contentsSection = bastionTab.querySelector('section.contents');
            if (contentsSection) contentsSection.appendChild(foundingDiv);
            foundingDiv.querySelector('.bastion-found-btn').addEventListener('click', async (ev) => {
                ev.preventDefault();
                const mgr = new BastionManager(actor);
                await BastionManager.onInitializeBastion.call(mgr, ev, ev.currentTarget);
            });
        }
    } else {
        // Clean up founding UI if bastion was just established
        bastionTab.querySelectorAll('.bastion-founding-ui').forEach(el => el.remove());
        bastionTab.querySelectorAll('section.facilities').forEach(s => s.style.removeProperty('display'));
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
        graveyardBtn.style.cssText = "width: auto; padding: 0 4px; border: none; background: none; cursor: pointer; color: var(--dnd5e-color-iron); vertical-align: middle; font-size: 0.8em; margin-left: auto;";
        
        defenderHeader.appendChild(graveyardBtn);
        graveyardBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            BastionManager.onViewGraveyard.call({ actor }, ev, graveyardBtn);
        });
    }

    // 5b. Show module-tracked defenders — hide native list to avoid duplicate/conflicting display
    const rosterSection = bastionTab.querySelector('section.roster');
    if (rosterSection) {
        // Hide native defender UL (module uses item flags, not the native actor system)
        rosterSection.querySelectorAll('ul.unlist').forEach(ul => ul.style.setProperty('display', 'none', 'important'));
        if (!rosterSection.querySelector('.bastion-module-defenders')) {
            const allDefenderInfo = [];
            actor.items.filter(i => i.type === "facility").forEach(facItem => {
                const d = facItem.flags?.[MODULE_ID]?.defenders || facItem.getFlag(MODULE_ID, "defenders") || {};
                if ((d.count || 0) > 0) allDefenderInfo.push({ facilityName: facItem.name, count: d.count, names: d.names || [] });
            });
            groupFacilities.forEach(f => {
                const d = f.flags?.[MODULE_ID]?.defenders || {};
                if ((d.count || 0) > 0) allDefenderInfo.push({ facilityName: f.name, count: d.count, names: d.names || [] });
            });
            const defSummary = document.createElement('div');
            defSummary.className = 'bastion-module-defenders';
            defSummary.style.cssText = 'font-size: 0.85em; padding: 4px 8px; margin-top: 2px; color: #e8e4d9;';
            if (allDefenderInfo.length > 0) {
                defSummary.innerHTML = allDefenderInfo.map(d => {
                    const names = d.names.length > 0 ? ` — ${d.names.join(', ')}` : '';
                    return `<div style="margin-bottom: 2px; color: #e8e4d9;"><i class="fa-solid fa-shield" style="color:#ef9a9a; width:12px;"></i> <b>${d.facilityName}:</b> ${d.count} defender(s)${names}</div>`;
                }).join('');
            } else {
                defSummary.innerHTML = `<div style="opacity: 0.6; font-style: italic; color: #e8e4d9;"><i class="fa-solid fa-shield" style="width:12px;"></i> Bastion is undefended.</div>`;
            }
            rosterSection.appendChild(defSummary);
        }
    }

    // 6. Replace native "Add Facility" buttons and placeholders, respecting capacity
    const actorLevel = actor.system.details?.level || 0;
    const specCap = BastionManager._getSpecialFacilityCap(actorLevel);
    const atSpecCap = currentSpecialsCount >= specCap;

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

    // 10. Augment Native Facility Items with Module State
    // Native dnd5e bastion tab: <li class="facility" data-item-id="..."> with
    // <div class="facility-header"> > <div class="name-stacked" data-action="useFacility">
    const facilitiesList = bastionTab.querySelectorAll('li.facility[data-item-id]:not(.building-placeholder)');
    facilitiesList.forEach(li => {
        const itemId = li.dataset.itemId;
        const item = actor.items.get(itemId);
        if (!item || item.type !== "facility" || li.classList.contains("bastion-augmented")) return;

        // Mark immediately so re-entrancy from DOM changes doesn't cause an infinite loop
        li.classList.add("bastion-augmented");
        li.querySelectorAll(".bastion-order-block, .bastion-augmented-info").forEach(el => el.remove());

        const fFlags = item.flags?.[MODULE_ID] || item.getFlag(MODULE_ID) || {};

        // --- Block the native "Issue Order" click (data-action="useFacility") ---
        const useFacilityDiv = li.querySelector('[data-action="useFacility"]');
        if (useFacilityDiv) {
            useFacilityDiv.addEventListener("click", (ev) => {
                ev.stopImmediatePropagation();
                ev.preventDefault();
            }, { capture: true });
        }

        const facName = item.name;
        const isUpgrading = (fFlags.upgradeTurns || 0) > 0;
        const isEnlarging = isUpgrading && !!fFlags.size;
        const isDamaged = !!fFlags.isDamaged;
        const progress = Number(fFlags.progress || 0);
        const hasActiveOrder = fFlags.order && fFlags.order !== "Maintain";

        // --- A. Header Badges (appended to the .title span inside .name-stacked) ---
        const titleSpan = li.querySelector('.name-stacked .title');
        if (titleSpan) {
            li.querySelectorAll(".bastion-badge, .bastion-working-badge").forEach(b => b.remove());
            if (hasActiveOrder && !isUpgrading && !isDamaged) {
                const badge = document.createElement("span");
                badge.className = "bastion-working-badge";
                badge.style.cssText = "font-size: 0.65em; background: #2e7d32; color: white; padding: 1px 5px; border-radius: 3px; margin-left: 6px; vertical-align: middle; animation: bastion-pulse 2s infinite; font-weight: bold; white-space: nowrap;";
                badge.innerHTML = '<i class="fa-solid fa-gear fa-spin" style="font-size: 0.8em;"></i> WORKING';
                badge.title = `Current Order: ${fFlags.order}`;
                titleSpan.after(badge);
            }
            if (isDamaged) {
                const badge = document.createElement("span");
                badge.className = "bastion-badge";
                badge.style.cssText = "font-size: 0.65em; background: var(--dnd5e-color-iron); color: white; padding: 1px 5px; border-radius: 3px; margin-left: 6px; vertical-align: middle; font-weight: bold;";
                badge.textContent = "DAMAGED";
                titleSpan.after(badge);
            }
            if (isEnlarging) {
                const badge = document.createElement("span");
                badge.className = "bastion-badge";
                badge.style.cssText = "font-size: 0.65em; background: #e65100; color: white; padding: 1px 5px; border-radius: 3px; margin-left: 6px; vertical-align: middle; font-weight: bold;";
                badge.textContent = "ENLARGING";
                titleSpan.after(badge);
            }
        }

        // --- B. Order Dropdown + Manager Button ---
        // Basic facilities (Bedroom, Dining Room, etc.) only Maintain — no dropdown needed
        const isBasicFacility = item.system?.type?.value === "basic";
        const { availableOrders, safeOrder, fFlags: stateFlags } = BastionManager.buildFacilityOrderState(actor, item);
        const isOrderLocked = (progress > 0 || (isUpgrading && !isEnlarging)) || isDamaged;

        const orderBlock = document.createElement("div");
        orderBlock.className = "bastion-order-block";
        orderBlock.style.cssText = "padding: 3px 6px 3px 6px; border-top: 1px solid rgba(255,255,255,0.15); display: flex; flex-direction: column; gap: 5px; background: rgba(15, 12, 8, 0.82); color: #e8e4d9; position: relative; z-index: 1;";

        const orderRow = document.createElement("div");
        orderRow.style.cssText = "display: flex; align-items: center; gap: 5px; width: 100%;";

        const orderLabel = document.createElement("label");
        orderLabel.style.cssText = "font-size: 0.74em; font-weight: bold; white-space: nowrap; font-family: var(--dnd5e-font-roboto, sans-serif); color: #e8e4d9;";
        orderLabel.textContent = "Order:";  

        const orderSelect = document.createElement("select");
        orderSelect.style.cssText = "flex: 1; font-size: 0.78em; height: 22px; font-family: var(--dnd5e-font-roboto, sans-serif);";
        orderSelect.disabled = isOrderLocked;
        availableOrders.forEach(order => {
            const opt = document.createElement("option");
            opt.value = order;
            opt.textContent = order;
            opt.selected = order === safeOrder;
            orderSelect.appendChild(opt);
        });
        // Stop mousedown/click from bubbling to the li's own native handlers
        orderSelect.addEventListener("mousedown", ev => ev.stopPropagation());
        orderSelect.addEventListener("click", ev => ev.stopPropagation());
        orderSelect.addEventListener("change", async (ev) => {
            ev.stopPropagation();
            await BastionManager.setFacilityOrder(actor, itemId, ev.target.value, false, false, null);
        });

        orderRow.appendChild(orderLabel);
        orderRow.appendChild(orderSelect);
        orderBlock.appendChild(orderRow);

        // --- B2. Dynamic Sub-Selectors (Injected into the order block) ---
        const isContinuing = safeOrder === "Continue Project";
        const currentOrder = fFlags.order || "Maintain";
        const craftChoice = fFlags.craftChoice || "";

        if (!isContinuing && !isBasicFacility) {
            const choiceContainer = document.createElement("div");
            choiceContainer.className = "bastion-choices";
            choiceContainer.style.cssText = "display: flex; flex-direction: column; gap: 4px; width: 100%;";

            // Add Research Topic input for Libraries/Archives
            if (availableOrders.some(o => o.includes("Research")) && safeOrder.startsWith("Research")) {
                const input = document.createElement("input");
                input.type = "text";
                input.className = "library-topic-input";
                input.placeholder = "Research Topic...";
                input.value = fFlags.libraryTopic || "";
                input.style.cssText = "height: 22px; font-size: 0.85em; width: 100%;";
                input.addEventListener("change", async (ev) => {
                    await item.setFlag(MODULE_ID, "libraryTopic", ev.target.value);
                });
                choiceContainer.appendChild(input);
            }

            // Example: Add Magic Item / Focus selector logic for Arcane Study
            if (facName.includes("Arcane Study") && safeOrder.startsWith("Craft")) {
                if (craftChoice === "Magic Item (Arcana)") {
                    // We call the state builder to get the options list
                    (async () => {
                        const calculationMode = game.settings.get(MODULE_ID, "calculationMode");
                        const daysPerTurn = game.settings.get(MODULE_ID, "daysPerTurn") || 7;
                        const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                        if (outPack) {
                            const options = await BastionManager._getNestedCompendiumOptions(outPack, "8yYUu27NcOQJc3qx", fFlags.magicItemChoice, calculationMode, daysPerTurn, "t", true, null, "Focus|Book");
                            const sel = document.createElement("select");
                            sel.style.cssText = "height: 22px; font-size: 0.85em;";
                            options.forEach(opt => {
                                if (opt.groupOptions) {
                                    const group = document.createElement("optgroup");
                                    group.label = opt.label;
                                    opt.groupOptions.forEach(o => {
                                        const oEl = document.createElement("option");
                                        oEl.value = o.value; oEl.textContent = o.label; oEl.selected = o.selected;
                                        group.appendChild(oEl);
                                    });
                                    sel.appendChild(group);
                                } else {
                                    const oEl = document.createElement("option");
                                    oEl.value = opt.value; oEl.textContent = opt.label; oEl.selected = opt.selected;
                                    sel.appendChild(oEl);
                                }
                            });
                            sel.addEventListener("change", async (ev) => { await item.setFlag(MODULE_ID, "magicItemChoice", ev.target.value); });
                            choiceContainer.appendChild(sel);
                        }
                    })();
                }
            }

            // Generic Queue Button for all crafting facilities
            if (safeOrder.startsWith("Craft") && craftChoice) {
                const qRow = document.createElement("div");
                qRow.style.cssText = "display: flex; gap: 4px; align-items: center;";
                const qInput = document.createElement("input");
                qInput.type = "number"; qInput.value = "1"; qInput.min = "1";
                qInput.style.cssText = "width: 35px; height: 22px; text-align: center; font-size: 0.8em;";
                const qBtn = document.createElement("button");
                qBtn.type = "button"; qBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add to Queue';
                qBtn.style.cssText = "height: 22px; font-size: 0.75em; flex: 1;";
                qBtn.addEventListener("click", async (ev) => {
                    // Mock the target object for the static handler
                    const mockTarget = { parentElement: qRow, dataset: { itemId: item.id, isFlag: "false" } };
                    await BastionManager.onAddToQueue.call({ actor }, ev, mockTarget);
                });
                qRow.appendChild(qInput);
                qRow.appendChild(qBtn);
                choiceContainer.appendChild(qRow);
            }

            if (choiceContainer.children.length > 0) orderBlock.appendChild(choiceContainer);
        }

        const mgrBtn = document.createElement("button");
        mgrBtn.type = "button";
        mgrBtn.title = "Open Bastion Manager (full controls)";
        mgrBtn.style.cssText = "width: auto; height: 22px; padding: 0 5px; font-size: 0.75em; flex-shrink: 0; cursor: pointer; margin-left: auto;";
        mgrBtn.innerHTML = '<i class="fa-solid fa-gauge-high"></i>';
        mgrBtn.addEventListener("mousedown", ev => ev.stopPropagation());
        mgrBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            new BastionManager(actor).render({ force: true });
        });

        orderRow.appendChild(mgrBtn);

        // --- C. Status Info Block ---
        const infoBlock = document.createElement("div");
        infoBlock.className = "bastion-augmented-info";
        infoBlock.style.cssText = "font-size: 0.76em; color: #e8e4d9; padding: 3px 6px; font-family: var(--dnd5e-font-roboto, sans-serif); display: flex; flex-direction: column; gap: 2px; background: rgba(15, 12, 8, 0.82); position: relative; z-index: 1;";

        const rows = [];

        // C1. Size (from module flags)
        const facSize = fFlags.size;
        if (facSize && facSize !== "Construction") {
            rows.push(`<div><i class="fa-solid fa-ruler-combined" style="opacity:0.6; width:12px;"></i> <b>Size:</b> ${facSize}</div>`);
        }

        // C2. SubType (specialization — e.g. Workshop tool, Garden plant type)
        const subType = fFlags.subType;
        if (subType) {
            rows.push(`<div><i class="fa-solid fa-tag" style="opacity:0.6; width:12px;"></i> <b>Type:</b> ${subType}</div>`);
        }

        // C3. Defenders — count only (names listed in the Defenders section above)
        const defenders = fFlags.defenders || {};
        if ((defenders.count || 0) > 0) {
            rows.push(`<div><i class="fa-solid fa-shield" style="color:#ef9a9a; width:12px;"></i> <b>Defenders:</b> ${defenders.count}</div>`);
        }

        // C4. Hirelings
        const hirelings = fFlags.hirelings;
        if (Array.isArray(hirelings) && hirelings.length > 0) {
            rows.push(`<div style="font-style:italic; opacity:0.8;"><i class="fa-solid fa-people-group" style="opacity:0.6; width:12px;"></i> ${hirelings.join(", ")}</div>`);
        }

        // C5. Active project progress bar (craft/research in progress)
        const maxCraftTurns = Number(fFlags.maxCraftTurns || 0);
        if (progress > 0 && !isUpgrading && !isDamaged) {
            const pct = maxCraftTurns > 0 ? Math.round((progress / maxCraftTurns) * 100) : 0;
            const craftChoice = fFlags.craftChoice || fFlags.activeProjectChoice || "";
            const choiceStr = craftChoice ? ` — ${craftChoice}` : "";
            rows.push(`<div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1px;">
                    <span><i class="fa-solid fa-hourglass-half" style="opacity:0.6; width:12px;"></i> <b>Project${choiceStr}:</b> ${progress}${maxCraftTurns > 0 ? ` / ${maxCraftTurns}` : ""} turns</span>
                </div>
                ${maxCraftTurns > 0 ? `<div style="height:6px; background:rgba(0,0,0,0.1); border-radius:3px; overflow:hidden;"><div style="width:${pct}%; height:100%; background:#2e7d32;"></div></div>` : ""}
            </div>`);
        }

        // C6. Enlargement / construction progress bar (for native items being enlarged)
        if (isEnlarging) {
            const upProg = Number(fFlags.upgradeProgress || 0);
            const upTotal = Number(fFlags.upgradeTurns || 1);
            const upPct = Math.round((upProg / upTotal) * 100);
            rows.push(`<div>
                <div style="margin-bottom:1px;"><i class="fa-solid fa-expand" style="opacity:0.6; width:12px;"></i> <b>Enlarging:</b> ${upProg} / ${upTotal} turns</div>
                <div style="height:6px; background:rgba(0,0,0,0.1); border-radius:3px; overflow:hidden;"><div style="width:${upPct}%; height:100%; background:var(--dnd5e-color-gold, #c8a000);"></div></div>
            </div>`);
        }

        // C7. Damage repair progress
        if (isDamaged) {
            const repProg = Number(fFlags.repairProgress || 0);
            const repTotal = Number(fFlags.repairTurns || 0);
            if (repTotal > 0) {
                const repPct = Math.round((repProg / repTotal) * 100);
                rows.push(`<div>
                    <div style="margin-bottom:1px;"><i class="fa-solid fa-wrench" style="opacity:0.6; width:12px;"></i> <b>Repairing:</b> ${repProg} / ${repTotal} turns</div>
                    <div style="height:6px; background:rgba(0,0,0,0.1); border-radius:3px; overflow:hidden;"><div style="width:${repPct}%; height:100%; background:#e65100;"></div></div>
                </div>`);
            } else {
                rows.push(`<div><i class="fa-solid fa-wrench" style="opacity:0.6; width:12px;"></i> <b>Awaiting repair</b></div>`);
            }
        }

        // --- D. Facility-Specific Blocks ---

        // D1. Storehouse
        if (facName.includes("Storehouse")) {
            const stored = fFlags.storedGp || 0;
            const limit = actorLevel >= 13 ? 5000 : (actorLevel >= 9 ? 2000 : 500);
            const markup = actorLevel >= 17 ? 100 : (actorLevel >= 13 ? 50 : (actorLevel >= 9 ? 20 : 10));
            const pct = Math.round((stored / limit) * 100);
            rows.push(`<div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1px;">
                    <span><i class="fa-solid fa-boxes-stacked" style="opacity:0.6; width:12px;"></i> <b>Stock:</b> ${stored} / ${limit} GP</span>
                    <span style="opacity:0.7;">+${markup}% markup</span>
                </div>
                <div style="height:6px; background:rgba(0,0,0,0.1); border-radius:3px; overflow:hidden;"><div style="width:${pct}%; height:100%; background:var(--dnd5e-color-gold, #c8a000);"></div></div>
            </div>`);
        }

        // D2. Armory
        if (facName.includes("Armory")) {
            const isStocked = fFlags.isStocked || false;
            const stockedCount = fFlags.stockedCount || 0;
            const effStock = (isStocked && stockedCount === 0) ? totalBastionDefs : stockedCount;
            const d8s = (totalBastionDefs > 0 && isStocked) ? Math.round(6 * Math.clamp(effStock / totalBastionDefs, 0, 1)) : 0;
            const d6s = 6 - d8s;
            const fParts = []; if (d8s > 0) fParts.push(`${d8s}d8`); if (d6s > 0) fParts.push(`${d6s}d6`);
            const attackFormula = fParts.join(" + ") || "6d6";
            let badge;
            if (isStocked && totalBastionDefs > 0 && stockedCount >= totalBastionDefs) {
                badge = `<span style="background:#2e7d32; color:white; padding:1px 6px; border-radius:10px; font-weight:bold; font-size:0.9em;" data-tooltip="All ${stockedCount} defender(s) equipped. Attack event: ${attackFormula} — each 1 rolled kills a defender."><i class="fa-solid fa-shield-check"></i> STOCK-READY (${stockedCount}/${totalBastionDefs})</span>`;
            } else if (isStocked && stockedCount > 0) {
                badge = `<span style="background:#e65100; color:white; padding:1px 6px; border-radius:10px; font-weight:bold; font-size:0.9em;" data-tooltip="${stockedCount} of ${totalBastionDefs} defender(s) equipped. Attack event: ${attackFormula} — each 1 rolled kills a defender. Run a Trade order to fully stock (improves to 6d8)."><i class="fa-solid fa-shield-halved"></i> SEMI-STOCKED (${stockedCount}/${totalBastionDefs})</span>`;
            } else {
                badge = `<span style="background:#555; color:white; padding:1px 6px; border-radius:10px; font-weight:bold; font-size:0.9em;" data-tooltip="No defenders equipped. Attack event: 6d6 — each 1 rolled kills a defender. If none survive, a special facility is damaged. Run a Trade order to stock (upgrades dice to d8s)."><i class="fa-solid fa-shield-slash"></i> UNSTOCKED (0/${totalBastionDefs})</span>`;
            }
            rows.push(`<div>${badge}</div>`);
        }

        // D3. Greenhouse
        if (facName.includes("Greenhouse")) {
            const fruitCount = fFlags.fruitCount ?? 3;
            rows.push(`<div><i class="fa-solid fa-seedling" style="color:#2e7d32; width:12px;"></i> <b>Magical Fruits:</b> ${fruitCount} / 3 &nbsp;<span style="opacity:0.7; font-style:italic;">(Lesser Restoration)</span></div>`);
        }

        // D3b. Menagerie
        if (facName.includes("Menagerie")) {
            const creatures = fFlags.menagerieCreatures || [];
            const usedSlots = creatures.reduce((s, c) => s + (c.slots ?? 0.25), 0);
            const defCount = creatures.filter(c => c.isDefender).length;
            const names = creatures.map(c => c.nickname ? `${c.nickname} (${c.species})` : c.species);
            const tooltip = names.length ? names.join(", ") : "No creatures yet.";
            rows.push(`<div data-tooltip="${tooltip}" style="cursor:default;"><i class="fa-solid fa-paw" style="color:#c8a45e; width:12px;"></i> <b>Menagerie:</b> ${names.length} creature(s) &mdash; ${parseFloat(usedSlots.toFixed(2))}/4 slots${defCount > 0 ? ` &mdash; ${defCount} defending` : ""}</div>`);
        }

        // D4. Theater
        if (facName.includes("Theater")) {
            const phase = fFlags.theaterPhase || "Idle";
            const tProg = Number(fFlags.theaterProgress || 0);
            const tPct = Math.round((Math.min(tProg, 14) / 14) * 100);
            const phaseColor = phase === "Writing" ? "#82cfff" : (phase === "Rehearsing" ? "#ff9800" : (phase === "Performing" ? "#4caf50" : "#777"));
            const contributors = fFlags.theaterContributors || [];
            const author = fFlags.theaterAuthor || "";
            rows.push(`<div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1px;">
                    <span><i class="fa-solid fa-masks-theater" style="opacity:0.6; width:12px;"></i> <b>Phase:</b> <span style="color:${phaseColor}; font-weight:bold;">${phase}</span>${author ? ` — ${author}` : ""}</span>
                    <span style="opacity:0.7;">${tProg} / 14 turns</span>
                </div>
                <div style="height:6px; background:rgba(0,0,0,0.1); border-radius:3px; overflow:hidden;"><div style="width:${tPct}%; height:100%; background:${phaseColor};"></div></div>
                ${contributors.length > 0 ? `<div style="opacity:0.75; margin-top:1px;"><i class="fa-solid fa-people-group" style="width:12px;"></i> ${contributors.map(c => `${c.name} (${c.role})`).join(", ")}</div>` : ""}
            </div>`);
        }

        // D5. Teleportation Circle
        if (facName.includes("Teleportation Circle")) {
            const visiting = fFlags.visitingSpellcaster || false;
            const daysRemaining = fFlags.spellcasterDaysRemaining || 0;
            const spellcasterName = fFlags.spellcasterName || "";
            if (visiting && daysRemaining > 0) {
                rows.push(`<div><i class="fa-solid fa-wand-sparkles" style="color:#7c4dff; width:12px;"></i> <b>Visiting:</b> ${spellcasterName || "Spellcaster"} &mdash; ${daysRemaining} day(s) remaining</div>`);
            } else {
                rows.push(`<div style="opacity:0.6;"><i class="fa-solid fa-wand-sparkles" style="width:12px;"></i> No visiting spellcaster</div>`);
            }
        }

        // D6. Meditation Chamber
        if (facName.includes("Meditation Chamber")) {
            const innerPeace = actor.getFlag(MODULE_ID, "innerPeaceActive") || false;
            const fortifiedSaves = actor.getFlag(MODULE_ID, "fortifiedSaves") || [];
            if (innerPeace) {
                const ipTooltip = "When you next roll on the Bastion Events table, you may roll twice and choose either result. This benefit is consumed on use.";
                rows.push(`<div data-tooltip="${ipTooltip}" style="cursor: help;"><i class="fa-solid fa-brain" style="color:#4a86e8; width:12px;"></i> <b>Inner Peace Active</b></div>`);
            }
            if (fortifiedSaves.length > 0) {
                const fsTooltip = "You add double your Proficiency Bonus to saving throws with these abilities while in your Bastion.";
                rows.push(`<div data-tooltip="${fsTooltip}" style="cursor: help;"><i class="fa-solid fa-shield-halved" style="color:#4a86e8; width:12px;"></i> <b>Fortified Saves:</b> ${fortifiedSaves.join(", ")}</div>`);
            }
        }

        // D7. Stable
        if (facName.includes("Stable")) {
            const animals = fFlags.stableAnimals || [];
            const maxSlots = facSize === "Vast" ? 4 : (facSize === "Roomy" ? 2 : 1);
            if (animals.length > 0) {
                const animalList = animals.map(a => a.nickname ? `${a.nickname} (${a.species})` : a.species).join(", ");
                rows.push(`<div><i class="fa-solid fa-horse" style="opacity:0.6; width:12px;"></i> <b>Animals (${animals.length}/${maxSlots}):</b> ${animalList}</div>`);
            } else {
                rows.push(`<div style="opacity:0.6;"><i class="fa-solid fa-horse" style="width:12px;"></i> No animals (0 / ${maxSlots} slots)</div>`);
            }
        }

        // D8. Craft Queue summary
        const craftQueue = fFlags.craftQueue || [];
        if (craftQueue.length > 0) {
            const queueGold = craftQueue.reduce((s, q) => s + ((q.totalCost || 0) - (q.paidCost || 0)), 0);
            const queueTurns = craftQueue.reduce((s, q) => s + ((q.totalTurns || 0) - (q.completedTurns || 0)), 0);
            rows.push(`<div style="opacity:0.8;"><i class="fa-solid fa-list-ol" style="opacity:0.6; width:12px;"></i> <b>Queue:</b> ${craftQueue.length} item(s) — ${queueGold} GP, ~${queueTurns} turn(s)</div>`);
        }

        // D9. Facility passive abilities — DMG name, rest type indicator, details in tooltip only
        const PASSIVE_INFO = {
            "Arcane Study": { icon: "fa-solid fa-sparkles",     color: "#b39ddb", name: "Arcane Study Charm",  restIcon: "fa-solid fa-moon",          rest: "Long Rest",  tip: "After each Long Rest in your Bastion, you may cast Identify as a Charm (no spell slot required)." },
            "Sanctuary":    { icon: "fa-solid fa-heart-pulse",   color: "#ef9a9a", name: "Healing Word Charm",  restIcon: "fa-solid fa-moon",          rest: "Long Rest",  tip: "After each Long Rest in your Bastion, you may cast Healing Word as a Charm (no spell slot required)." },
            "Sacristy":     { icon: "fa-solid fa-wand-sparkles", color: "#ef9a9a", name: "Sacred Spellcasting", restIcon: "fa-solid fa-hourglass-half", rest: "Short Rest", tip: "After a Short Rest in your Bastion, you regain one expended spell slot of level 5 or lower." },
        };
        for (const [keyword, info] of Object.entries(PASSIVE_INFO)) {
            if (facName.includes(keyword) && !isUpgrading) {
                rows.push(`<div data-tooltip="${info.tip}" style="cursor: help; display: flex; align-items: center; justify-content: space-between; gap: 4px;"><span><i class="${info.icon}" style="color:${info.color}; width:12px;"></i> <b>${info.name}</b></span><span style="opacity: 0.7; font-size: 0.88em; white-space: nowrap;"><i class="${info.restIcon}" style="width:10px;"></i> ${info.rest} · Bastion</span></div>`);
                break;
            }
        }

        // Insert order block and info block after .facility-header
        const headerDiv = li.querySelector('.facility-header');
        if (headerDiv) {
            if (!isBasicFacility) {
                headerDiv.after(orderBlock);
                if (rows.length > 0) {
                    infoBlock.innerHTML = rows.join("");
                    orderBlock.after(infoBlock);
                }
            } else if (rows.length > 0) {
                infoBlock.innerHTML = rows.join("");
                headerDiv.after(infoBlock);
            }
        }

        // Add hireling name tooltips to native occupant slots (if naming is enabled)
        if (game.settings.get(MODULE_ID, "nameHirelings")) {
            const hirelingNames = fFlags.hirelings || [];
            if (hirelingNames.length > 0) {
                li.querySelectorAll(".slot.occupant-slot.hireling").forEach((slot, i) => {
                    if (hirelingNames[i]) {
                        slot.title = hirelingNames[i];
                        slot.setAttribute("data-tooltip", hirelingNames[i]);
                    }
                });
            }
        }

        // Right-click → open full BastionManager
        li.addEventListener("contextmenu", (ev) => {
            ev.preventDefault();
            new BastionManager(actor).render({ force: true });
        });
    });
};

/**
 * DOM OBSERVER
 * This runs in the background and watches for the Bastion tab being shown.
 */
const observer = new MutationObserver(() => {
    // Check all elements matching the bastion tab selector
    const tabs = document.querySelectorAll('section[data-tab="bastion"], div[data-tab="bastion"]');
    tabs.forEach(bastionTab => {
        if ( bastionTab.classList.contains('item') || bastionTab.classList.contains('anchor') ) return;
        const style = window.getComputedStyle(bastionTab);
        if (style.display !== 'none') integrateBastionDashboard(bastionTab);
    });
});
observer.observe(document.body, { childList: true, subtree: true });

/**
 * INITIALIZATION
 */
Hooks.once("init", () => {
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

    // Inject global styles for the "WORKING" pulse animation
    const style = document.createElement("style");
    style.innerHTML = `
        @keyframes bastion-pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
        #bastion-turn { display: none !important; }
    `;
    document.head.appendChild(style);

    // v13: Force control refresh to ensure the Bastion category appears for the GM
    if ( game.user.isGM ) { console.log("Bastion Manager | Forcing sidebar re-render."); ui.controls.render(true); }

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
        // Target ONLY the specific native advance action to avoid conflicts with system calendars or other tools
        const btn = event.target.closest('[data-action="advanceBastionTurn"]');
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
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) {
        for (const app of foundry.applications.instances.values()) {
            if (app.constructor.name === "BastionManager" && app.actor.id === actor.id) app.render();
        }

        // Force integration refresh on character sheets by clearing the augmentation guard
        document.querySelectorAll('section[data-tab="bastion"], div[data-tab="bastion"]').forEach(tab => {
            const app = Array.from(foundry.applications.instances.values()).find(a => a.element?.contains(tab))
                     || Object.values(ui.windows).find(w => (w.element?.[0] || w.element)?.contains(tab));
            if ((app?.document || app?.actor)?.id === actor.id) {
                tab.querySelectorAll(".bastion-augmented").forEach(el => el.classList.remove("bastion-augmented"));
            }
        });
    }
});

// Clear stale bastion augmentation when a facility item's module flags change
// (e.g., Armory isStocked, stockedCount updated after a trade order)
Hooks.on("updateItem", (item, changes) => {
    if (item.type !== "facility") return;
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
    document.querySelectorAll(`li.facility[data-item-id="${item.id}"].bastion-augmented`)
        .forEach(li => li.classList.remove("bastion-augmented"));
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
        const data = formData.object;
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