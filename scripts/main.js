import { BastionManager } from "./bastion-app.js";
import { MODULE_ID, ORDER_SVG_MAP, ORDER_ICON_MAP, GARDEN_ROOT_ID, STABLE_ROOT_ID, STAFF_FOLDER_ID, FACILITY_HIRELING_TEMPLATES } from "./bastion-data.js";
import { getActiveCalendarName, getCalendarWeekLength, effectiveDaysPerTurn } from "./bastion-calculations.js";
import { folderParentId, bastionLog, getAllPassiveInfo } from "./bastion-facility-registry.js";
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

function _isBastionEligible(actor) {
    if (!actor) return false;
    if (actor.type === "group") return true;
    const allowed = game.settings.get(MODULE_ID, "allowedActorTypes") || ["character"];
    return allowed.includes(actor.type);
}

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
                if (!actor) return ui.notifications.warn("No owned actor with a Bastion found.");
                if (game.settings.get(MODULE_ID, "calendarDrivenTurns")) {
                    BastionManager.onIssueOrders.call({ actor, element: this.element }, event, target);
                } else {
                    BastionManager.onAdvanceGlobalTurn.call({ actor, element: this.element }, event, target);
                }
            }
        }
    };

    static PARTS = {
        main: { template: "modules/dnd-2024-bastion-manager/templates/bastion-advance-turn.hbs" }
    };

    async _prepareContext(options) {
        const activeNonGMs = game.users.filter(u => u.active && !u.isGM);
        const bastionActors = game.actors.filter(a => {
            const isAllowedType = _isBastionEligible(a) && a.type !== "group";
            const hasFacilities = a.items.some(i => i.type === "facility") || a.getFlag(MODULE_ID, "groupFacilities")?.length > 0;
            const ownedByActivePlayer = activeNonGMs.some(u => a.testUserPermission(u, "OWNER"));
            return isAllowedType && hasFacilities && ownedByActivePlayer;
        });
        const calendarDrivenTurns = game.settings.get(MODULE_ID, "calendarDrivenTurns");
        const issuedAt = game.settings.get(MODULE_ID, "ordersIssuedAt") || 0;
        return {
            readyCount: bastionActors.filter(a => a.getFlag(MODULE_ID, "isReady")).length,
            totalBastions: bastionActors.length,
            calendarDrivenTurns,
            ordersIssued: issuedAt > 0,
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
            bastionLog("Pushing Bastion category to sidebar array.");
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
 * Inject bastion tab CSS overrides into document.head once (idempotent).
 * Extracted so the style block lives outside the per-tab augmentation function.
 */
function injectBastionStyles() {
    if (document.getElementById('bastion-manager-tab-styles')) return;
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
            .tab[data-tab="bastion"] li.facility .bastion-augmented-info,
            [data-tab-contents-for="bastion"] li.facility .bastion-order-block,
            [data-tab-contents-for="bastion"] li.facility .bastion-augmented-info {
                background: rgba(15, 12, 8, 0.82) !important;
                color: #e8e4d9 !important;
                position: relative !important;
                z-index: 1 !important;
            }
            .tab[data-tab="bastion"] li.facility .bastion-order-block label,
            .tab[data-tab="bastion"] li.facility .bastion-order-block div,
            .tab[data-tab="bastion"] li.facility .bastion-augmented-info div,
            .tab[data-tab="bastion"] li.facility .bastion-augmented-info b,
            [data-tab-contents-for="bastion"] li.facility .bastion-order-block label,
            [data-tab-contents-for="bastion"] li.facility .bastion-order-block div,
            [data-tab-contents-for="bastion"] li.facility .bastion-augmented-info div,
            [data-tab-contents-for="bastion"] li.facility .bastion-augmented-info b {
                color: #e8e4d9 !important;
            }
            .tab[data-tab="bastion"] li.facility .bastion-augmented-info div[style*="height:6px"],
            [data-tab-contents-for="bastion"] li.facility .bastion-augmented-info div[style*="height:6px"] {
                background: none !important;
            }
            .tab[data-tab="bastion"] section.name .bastion-turn-counter,
            [data-tab-contents-for="bastion"] section.name .bastion-turn-counter {
                font-size: 0.8em;
                opacity: 0.8;
                margin-top: 4px;
            }
            /* Native sheet: reflow — Special top, Basic middle, Roster bottom */
            .dnd5e2.sheet.actor.character .tab[data-tab="bastion"] .contents {
                grid-template: "c c" auto "b b" auto "a a" auto / minmax(0, 1fr) minmax(0, 1fr) !important;
            }
            .dnd5e2.sheet.actor.character .tab[data-tab="bastion"] .contents .facilities.special {
                grid-area: c !important;
            }
            .dnd5e2.sheet.actor.character .tab[data-tab="bastion"] .contents .facilities.basic {
                grid-area: b !important;
            }
            .dnd5e2.sheet.actor.character .tab[data-tab="bastion"] .contents .roster {
                grid-area: a !important;
            }
            /* Native sheet: 2-column layout for facility lists */
            .dnd5e2.sheet.actor.character .tab[data-tab="bastion"] .facilities.special ul.unlist,
            .dnd5e2.sheet.actor.character .tab[data-tab="bastion"] .facilities.basic ul.unlist {
                display: flex !important;
                flex-direction: row !important;
                flex-wrap: wrap !important;
                align-items: stretch !important;
                gap: 8px !important;
            }
            .dnd5e2.sheet.actor.character .tab[data-tab="bastion"] .facilities.special li.facility:not(.empty) {
                flex: 0 0 calc(50% - 4px) !important;
                max-width: calc(50% - 4px) !important;
                min-width: 200px !important;
                box-sizing: border-box !important;
            }
            .dnd5e2.sheet.actor.character .tab[data-tab="bastion"] .facilities.special li.facility.empty {
                flex: 0 0 100% !important;
                width: 100% !important;
            }
            .dnd5e2.sheet.actor.character .tab[data-tab="bastion"] .facilities.basic li.facility:not(.empty) {
                flex: 0 0 calc(50% - 4px) !important;
                max-width: calc(50% - 4px) !important;
                min-width: 160px !important;
            }
            .dnd5e2.sheet.actor.character .tab[data-tab="bastion"] .facilities.basic li.facility.empty {
                flex: 0 0 100% !important;
                width: 100% !important;
            }
            /* Bastion order-block select: full width, dark theme */
            .tab[data-tab="bastion"] li.facility .bastion-order-block select,
            [data-tab-contents-for="bastion"] li.facility .bastion-order-block select {
                width: 100% !important;
                background: rgba(30,25,18,0.9) !important;
                color: #e8e4d9 !important;
                border: 1px solid rgba(200,190,170,0.3) !important;
                flex: 1 1 auto !important;
            }
            /* Tidy 5e Sheets: facility title readability */
            [data-tab-contents-for="bastion"] li.facility:not(.empty) .title-and-subtitle .title {
                color: white !important;
                text-shadow: 0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6) !important;
            }
            [data-tab-contents-for="bastion"] li.facility:not(.empty) .title-and-subtitle .subtitle {
                display: none !important;
            }
            /* Tidy 5e: disable the native useFacility click on the facility header link —
               module handles orders via the injected dropdown, not the native dialog */
            [data-tab-contents-for="bastion"] li.facility:not(.empty) a.facility-header-details {
                pointer-events: none !important;
                cursor: default !important;
            }
            /* Native sheet: remove pointer cursor from [data-action="useFacility"] —
               click is already blocked by JS, but the system CSS still shows a pointer */
            .dnd5e2 .tab[data-tab="bastion"] li.facility [data-action="useFacility"] {
                cursor: default !important;
            }
            /* Tidy 5e Sheets: special and basic are already side-by-side columns via
               Tidy's own grid-template-columns:1fr 1fr on .facility-panels, so items
               stack vertically by default. Just ensure empty slots are full-width. */
            [data-tab-contents-for="bastion"] .facilities.special .facility.empty,
            [data-tab-contents-for="bastion"] .facilities.basic .facility.empty {
                width: 100% !important;
            }
        `;
    document.head.appendChild(style);
}

/**
 * Open BastionManager for an actor.
 * If sourceEl is inside a Foundry v14 detached window, the manager is also detached.
 */
function _openBastionManager(actor, sourceEl) {
    const mgr = new BastionManager(actor);
    const isDetached = sourceEl?.ownerDocument && (document !== sourceEl.ownerDocument);
    if (isDetached) mgr.detachWindow({ force: true });
    else mgr.render({ force: true });
}

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
    if (!_isBastionEligible(actor)) return;
    // Group overview sections are rendered by renderGroupBastionContent — skip native augmentation
    if (bastionTab.dataset.bastionGroupOverview === "true") return;

    injectBastionStyles();


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
            (contentsSection || bastionTab).appendChild(foundingDiv);
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

    // Count special facilities currently under construction so we can hide the build button while one is in progress
    const buildingSpecialsCount = groupFacilities.filter(f => !isBasicFac(f) && (f.flags?.[MODULE_ID]?.upgradeTurns || 0) > 0).length
        + actor.items.filter(i => i.type === "facility" && !isBasicFac(i) && (i.getFlag(MODULE_ID, "upgradeTurns") || 0) > 0).length;

    const nativeBuildButtons = bastionTab.querySelectorAll('[data-action="createChild"][data-type="facility"], [data-action="findItem"][data-item-type="facility"]');
    nativeBuildButtons.forEach(btn => {
        if (btn.classList.contains("bastion-replaced")) return;

        // Check if this is a "Special" slot specifically for capacity checks
        const isSpecialSlot = btn.dataset.facilityType === "special";

        // Hide special slot if at cap or construction already in progress
        if (isSpecialSlot && (atSpecCap || buildingSpecialsCount > 0)) {
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

        const facType = isSpecialSlot ? "special" : "basic";
        newBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            new BastionManager(actor)._promptBuildFacility(facType);
        });
    });

    // 6b. Tidy 5e Sheets: intercept empty facility slot clicks to redirect to module build flow
    bastionTab.querySelectorAll('.facility.empty a').forEach(a => {
        if (a.dataset.bastionReplaced) return;
        a.dataset.bastionReplaced = "true";
        const facType = a.closest('.facilities.special') ? "special" : a.closest('.facilities.basic') ? "basic" : null;
        // Hide special slot if at cap or construction already in progress
        if (facType === "special" && (atSpecCap || buildingSpecialsCount > 0)) {
            a.closest('.facility.empty')?.style.setProperty('display', 'none', 'important');
            return;
        }
        a.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            new BastionManager(actor)._promptBuildFacility(facType);
        }, { capture: true });
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

        // --- A. Tab UI uses icon changes to show order/status — no text badges here ---
        li.querySelectorAll(".bastion-badge").forEach(b => b.remove());

        // --- B. Order Dropdown + Manager Button ---
        // Basic facilities (Bedroom, Dining Room, etc.) only Maintain — no dropdown needed
        const isBasicFacility = item.system?.type?.value === "basic";
        const { availableOrders, safeOrder, fFlags: stateFlags } = BastionManager.buildFacilityOrderState(actor, item);

        // --- A2. Update the native order-slot to reflect the current order ---
        const _setOrderSlot = (orderSlot, svgSrc, tooltipLabel) => {
            if (!orderSlot) return;
            orderSlot.classList.remove('empty');
            orderSlot.setAttribute('data-tooltip', tooltipLabel);
            // Reuse existing dnd5e-icon if present, otherwise create one.
            // IMPORTANT: set src BEFORE appending — the web component fetches on connectedCallback.
            let icon = orderSlot.querySelector('dnd5e-icon');
            if (!icon) {
                icon = document.createElement('dnd5e-icon');
                icon.setAttribute('src', svgSrc);
                icon.dataset.bastionOrderIcon = 'true';
                orderSlot.innerHTML = '';
                orderSlot.appendChild(icon);
            } else {
                icon.setAttribute('src', svgSrc);
                icon.dataset.bastionOrderIcon = 'true';
            }
        };
        const orderSlot = li.querySelector('.slot.order-slot');
        if (orderSlot) {
            let svgSrc, tooltipLabel;
            if (isDamaged) {
                svgSrc = "systems/dnd5e/icons/svg/facilities/repair.svg";
                tooltipLabel = "Damaged — Repairing";
            } else if (isUpgrading && !isEnlarging) {
                svgSrc = "systems/dnd5e/icons/svg/facilities/build.svg";
                tooltipLabel = "Under Construction";
            } else if (isEnlarging) {
                svgSrc = "systems/dnd5e/icons/svg/facilities/enlarge.svg";
                tooltipLabel = "Enlarging";
            } else {
                const orderKey = safeOrder.split(":")[0].trim().toLowerCase();
                svgSrc = ORDER_SVG_MAP[orderKey] || "systems/dnd5e/icons/svg/facilities/maintain.svg";
                tooltipLabel = safeOrder;
            }
            _setOrderSlot(orderSlot, svgSrc, tooltipLabel);
        }
        const isOrderLocked = (progress > 0 || (isUpgrading && !isEnlarging)) || isDamaged;

        // Collect post-inject functions for interactive elements (need infoBlock in DOM first)
        const postInjectFns = [];

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
            const newOrder = ev.target.value;
            // Update icon immediately — the MutationObserver won't re-trigger on class removal alone
            const orderKey = newOrder.split(":")[0].trim().toLowerCase();
            const svgSrc = ORDER_SVG_MAP[orderKey] || "systems/dnd5e/icons/svg/facilities/maintain.svg";
            _setOrderSlot(li.querySelector('.slot.order-slot'), svgSrc, newOrder);
            await BastionManager.setFacilityOrder(actor, itemId, newOrder, false, false, null);
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

            // Add Research Topic input for Libraries/Archives/Pub
            if (availableOrders.some(o => o.includes("Research")) && safeOrder.startsWith("Research")) {
                const isPub             = facName === "Pub";
                const isTrophy          = facName.includes("Trophy Room");
                const isArchive         = facName.includes("Archive");
                const isTrinketTrophy   = isTrophy && safeOrder === "Research: Trinket Trophy";

                if (isTrinketTrophy) {
                    const descEl = document.createElement("div");
                    descEl.style.cssText = "font-size: 0.8em; opacity: 0.75; font-style: italic; line-height: 1.4;";
                    descEl.innerHTML = `<i class="fa-solid fa-dice" style="margin-right: 3px;"></i>After 7 days, roll any die — <b>even</b>: hireling finds a Common magic implement; <b>odd</b>: nothing found.`;
                    choiceContainer.appendChild(descEl);
                } else {
                    const labelEl = document.createElement("label");
                    labelEl.style.cssText = "font-size: 0.8em; opacity: 0.7; display: block; margin-bottom: 1px;";
                    if (isPub)           labelEl.textContent = "Creature to locate (leave blank for general rumours within 10 miles):";
                    else if (isTrophy)   labelEl.textContent = "Subject of legendary significance to research:";
                    else if (isArchive)  labelEl.textContent = "Subject of legendary significance to research:";
                    else                 labelEl.textContent = "Topic to research (up to 3 accurate facts):";
                    choiceContainer.appendChild(labelEl);

                    const input = document.createElement("input");
                    input.type = "text";
                    input.className = "library-topic-input";
                    if (isPub)          input.placeholder = "e.g. Zevlor the Tiefling — last seen near Baldur's Gate";
                    else if (isTrophy)  input.placeholder = "e.g. The Eye of Vecna — yields a Legend Lore–style summary if legendary";
                    else if (isArchive) input.placeholder = "e.g. Strahd von Zarovich — yields a Legend Lore–style summary if legendary";
                    else                input.placeholder = "e.g. The Cult of the Dragon — history, goals, key members";
                    input.value = fFlags.libraryTopic || "";
                    input.style.cssText = "height: 22px; font-size: 0.85em; width: 100%;";
                    input.addEventListener("change", async (ev) => {
                        await item.setFlag(MODULE_ID, "libraryTopic", ev.target.value);
                    });
                    choiceContainer.appendChild(input);
                }
            }

            // Shared helpers for compendium-backed craft sub-selectors
            const _buildSelect = (options, currentValue, flagKey, placeholder) => {
                const sel = document.createElement("select");
                sel.style.cssText = "height: 22px; font-size: 0.85em; width: 100%;";
                const blank = document.createElement("option");
                blank.value = ""; blank.textContent = placeholder; blank.selected = !currentValue;
                sel.appendChild(blank);
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
                sel.addEventListener("mousedown", ev => ev.stopPropagation());
                sel.addEventListener("change", async (ev) => { await item.setFlag(MODULE_ID, flagKey, ev.target.value); });
                return sel;
            };
            const _insertBeforeQueue = (el) => {
                const queueRow = choiceContainer.querySelector(".bastion-queue-row");
                if (queueRow) choiceContainer.insertBefore(el, queueRow);
                else choiceContainer.appendChild(el);
            };
            const _getOutPack = () => game.packs.get(`${MODULE_ID}.bastion-output-items`);
            const _craftSettings = () => ({
                calculationMode: game.settings.get(MODULE_ID, "calculationMode"),
                daysPerTurn: effectiveDaysPerTurn(),
            });

            // Arcane Study craft sub-selectors
            if (facName.includes("Arcane Study") && safeOrder.startsWith("Craft")) {
                if (craftChoice === "Magic Item (Arcana)") {
                    (async () => {
                        const outPack = _getOutPack(); if (!outPack) return;
                        const { calculationMode, daysPerTurn } = _craftSettings();
                        const options = await BastionManager._getNestedCompendiumOptions(outPack, "8yYUu27NcOQJc3qx", fFlags.magicItemChoice, calculationMode, daysPerTurn, "t", true, null, "Focus|Book|Charm");
                        _insertBeforeQueue(_buildSelect(options, fFlags.magicItemChoice, "magicItemChoice", "— Select Magic Item —"));
                    })();
                } else if (craftChoice === "Arcane Focus") {
                    (async () => {
                        const outPack = _getOutPack(); if (!outPack) return;
                        const { calculationMode, daysPerTurn } = _craftSettings();
                        const options = await BastionManager._getNestedCompendiumOptions(outPack, "ByVgJZyPE5H3M5tV", fFlags.focusChoice, calculationMode, daysPerTurn, "t", false, null, "Magic Item");
                        _insertBeforeQueue(_buildSelect(options, fFlags.focusChoice, "focusChoice", "— Select Focus Type —"));
                    })();
                }
                // Craft: Book always crafts Blank Book — no sub-selection needed
            }

            // Smithy craft sub-selectors
            if (facName.includes("Smithy") && safeOrder.startsWith("Craft")) {
                (async () => {
                    const outPack = _getOutPack(); if (!outPack) return;
                    const { calculationMode, daysPerTurn } = _craftSettings();
                    const smithyRootId = "wti6MOvq9leZqgp9";
                    if (craftChoice === "Smith's Tools") {
                        const options = await BastionManager._getNestedCompendiumOptions(outPack, smithyRootId, fFlags.smithyItemChoice, calculationMode, daysPerTurn, "t", false, null, "Armament");
                        _insertBeforeQueue(_buildSelect(options, fFlags.smithyItemChoice, "smithyItemChoice", "— Select Item to Craft —"));
                    } else if (craftChoice === "Magic Item (Armament)") {
                        const allSubIds = BastionManager._getAllSubfolderIds(outPack, smithyRootId);
                        const armFolder = outPack.folders.find(f => allSubIds.includes(f.id) && f.name.toLowerCase().includes("armament"));
                        if (armFolder) {
                            const options = await BastionManager._getNestedCompendiumOptions(outPack, armFolder.id, fFlags.armamentItemChoice, calculationMode, daysPerTurn, "t", true);
                            _insertBeforeQueue(_buildSelect(options, fFlags.armamentItemChoice, "armamentItemChoice", "— Select Magic Item —"));
                        }
                    }
                })();
            }

            // Workshop craft sub-selectors
            if (facName.includes("Workshop") && safeOrder.startsWith("Craft")) {
                (async () => {
                    const outPack = _getOutPack(); if (!outPack) return;
                    const { calculationMode, daysPerTurn } = _craftSettings();
                    const workshopRootId = "XkNDvStirzNpw8G2";
                    if (craftChoice === "Adventuring Gear") {
                        const workshopTools = item.getFlag(MODULE_ID, "workshopTools") || [];
                        const options = await BastionManager._getNestedCompendiumOptions(outPack, workshopRootId, fFlags.workshopItemChoice, calculationMode, daysPerTurn, "t", false, workshopTools.length > 0 ? workshopTools : null, "Magic Item");
                        _insertBeforeQueue(_buildSelect(options, fFlags.workshopItemChoice, "workshopItemChoice", "— Select Item to Craft —"));
                    } else if (craftChoice === "Magic Item (Implement)") {
                        const allSubIds = BastionManager._getAllSubfolderIds(outPack, workshopRootId);
                        const magicFolder = outPack.folders.find(f => allSubIds.includes(f.id) && f.name.toLowerCase().includes("magic item"));
                        const rootId = magicFolder ? magicFolder.id : workshopRootId;
                        const options = await BastionManager._getNestedCompendiumOptions(outPack, rootId, fFlags.workshopItemChoice, calculationMode, daysPerTurn, "t", true);
                        _insertBeforeQueue(_buildSelect(options, fFlags.workshopItemChoice, "workshopItemChoice", "— Select Magic Item —"));
                    }
                })();
            }

            // Sanctuary craft sub-selectors (Druidic Focus / Holy Symbol)
            if (facName.includes("Sanctuary") && safeOrder.startsWith("Craft")) {
                (async () => {
                    const outPack = _getOutPack(); if (!outPack) return;
                    const { calculationMode, daysPerTurn } = _craftSettings();
                    const folderId = craftChoice === "Druidic Focus" ? "RTYj3BJ6ZRvuKxPq" : "BiV5sM1bdzI3ZWS6";
                    const placeholder = craftChoice === "Druidic Focus" ? "— Select Druidic Focus —" : "— Select Holy Symbol —";
                    const options = await BastionManager._getNestedCompendiumOptions(outPack, folderId, fFlags.sacredFocusChoice, calculationMode, daysPerTurn, "t", false);
                    _insertBeforeQueue(_buildSelect(options, fFlags.sacredFocusChoice, "sacredFocusChoice", placeholder));
                })();
            }

            // Sacristy craft sub-selectors (Holy Water has no choice; Relic needs compendium)
            if (facName.includes("Sacristy") && craftChoice === "Magic Item (Relic)") {
                (async () => {
                    const outPack = _getOutPack(); if (!outPack) return;
                    const { calculationMode, daysPerTurn } = _craftSettings();
                    const relicFolder = outPack.folders.get("hU4DDWFnK13sSUSP") || outPack.folders.find(f => f.name.toLowerCase().includes("relic"));
                    if (relicFolder) {
                        const options = await BastionManager._getNestedCompendiumOptions(outPack, relicFolder.id, fFlags.relicItemChoice, calculationMode, daysPerTurn, "t", true);
                        _insertBeforeQueue(_buildSelect(options, fFlags.relicItemChoice, "relicItemChoice", "— Select Magic Item —"));
                    }
                })();
            }

            // Scriptorium craft sub-selectors
            if (facName.includes("Scriptorium") && safeOrder.startsWith("Craft")) {
                if (craftChoice === "Spell Scroll") {
                    (async () => {
                        const outPack = _getOutPack(); if (!outPack) return;
                        const { calculationMode, daysPerTurn } = _craftSettings();
                        const scrollFolder = outPack.folders.get("RbGD7EB1jyD26fq6") || outPack.folders.find(f => f.name.toLowerCase().includes("scroll"));
                        if (scrollFolder) {
                            const options = await BastionManager._getNestedCompendiumOptions(outPack, scrollFolder.id, fFlags.scrollChoice, calculationMode, daysPerTurn, "t", true);
                            _insertBeforeQueue(_buildSelect(options, fFlags.scrollChoice, "scrollChoice", "— Select Scroll Level —"));
                        }
                    })();
                } else if (craftChoice === "Book Replica") {
                    const wrapper = document.createElement("div");
                    wrapper.style.cssText = "display: flex; flex-direction: column; gap: 2px;";
                    const lbl = document.createElement("label");
                    lbl.style.cssText = "font-size: 0.8em; opacity: 0.7;";
                    lbl.textContent = "Title of book to replicate:";
                    const inp = document.createElement("input");
                    inp.type = "text"; inp.placeholder = "e.g. Tome of the Stilled Tongue";
                    inp.value = fFlags.bookTitle || "";
                    inp.style.cssText = "height: 22px; font-size: 0.85em; width: 100%;";
                    inp.addEventListener("mousedown", ev => ev.stopPropagation());
                    inp.addEventListener("change", async (ev) => { await item.setFlag(MODULE_ID, "bookTitle", ev.target.value); });
                    wrapper.appendChild(lbl); wrapper.appendChild(inp);
                    _insertBeforeQueue(wrapper);
                } else if (craftChoice === "Paperwork") {
                    const wrapper = document.createElement("div");
                    wrapper.style.cssText = "display: flex; flex-direction: column; gap: 2px;";
                    const lbl = document.createElement("label");
                    lbl.style.cssText = "font-size: 0.8em; opacity: 0.7;";
                    lbl.textContent = "Paperwork description:";
                    const inp = document.createElement("input");
                    inp.type = "text"; inp.placeholder = "e.g. Deed of land ownership";
                    inp.value = fFlags.paperworkTitle || "";
                    inp.style.cssText = "height: 22px; font-size: 0.85em; width: 100%;";
                    inp.addEventListener("mousedown", ev => ev.stopPropagation());
                    inp.addEventListener("change", async (ev) => { await item.setFlag(MODULE_ID, "paperworkTitle", ev.target.value); });
                    const qtyRow = document.createElement("div");
                    qtyRow.style.cssText = "display: flex; align-items: center; gap: 4px; margin-top: 1px;";
                    const qtyLbl = document.createElement("label");
                    qtyLbl.style.cssText = "font-size: 0.8em; opacity: 0.7; white-space: nowrap;";
                    qtyLbl.textContent = "GP value:";
                    const qtyInp = document.createElement("input");
                    qtyInp.type = "number"; qtyInp.value = fFlags.paperworkQty || 50; qtyInp.min = "1";
                    qtyInp.style.cssText = "width: 55px; height: 22px; font-size: 0.85em; text-align: center;";
                    qtyInp.addEventListener("mousedown", ev => ev.stopPropagation());
                    qtyInp.addEventListener("change", async (ev) => {
                        await item.setFlag(MODULE_ID, "paperworkQty", Math.max(1, parseInt(ev.target.value) || 50));
                    });
                    qtyRow.appendChild(qtyLbl); qtyRow.appendChild(qtyInp);
                    wrapper.appendChild(lbl); wrapper.appendChild(inp); wrapper.appendChild(qtyRow);
                    _insertBeforeQueue(wrapper);
                }
                // Craft: Book Replica (no sub-selector needed beyond title)
            }

            // Laboratory craft sub-selectors
            if (facName.includes("Laboratory") && safeOrder.startsWith("Craft")) {
                (async () => {
                    const outPack = _getOutPack(); if (!outPack) return;
                    const { calculationMode, daysPerTurn } = _craftSettings();
                    if (craftChoice === "Alchemist's Supplies") {
                        const options = await BastionManager._getNestedCompendiumOptions(outPack, "mqk8IahDyEIKpvcj", fFlags.laboratoryAlchemistChoice, calculationMode, daysPerTurn, "t", false);
                        _insertBeforeQueue(_buildSelect(options, fFlags.laboratoryAlchemistChoice, "laboratoryAlchemistChoice", "— Select Alchemical Item —"));
                    } else if (craftChoice === "Poison") {
                        const options = await BastionManager._getNestedCompendiumOptions(outPack, "fwyUIxfHsEGOLHYc", fFlags.laboratoryPoisonChoice, calculationMode, daysPerTurn, "t", false);
                        _insertBeforeQueue(_buildSelect(options, fFlags.laboratoryPoisonChoice, "laboratoryPoisonChoice", "— Select Poison —"));
                    }
                })();
            }

            // Menagerie creature selector
            if (facName.includes("Menagerie") && safeOrder === "Recruit") {
                (async () => {
                    const actorPack = game.packs.get(`${MODULE_ID}.bastion-facility-actors`);
                    if (!actorPack) return;
                    const MENAGERIE_ROOT_ID = "2NJBOp0l0PxvBN6B";
                    const idx = await actorPack.getIndex({ fields: ["folder", "system.traits.size", "system.details.cr"] });
                    const allFolderIds = BastionManager._getAllSubfolderIds(actorPack, MENAGERIE_ROOT_ID);
                    allFolderIds.push(MENAGERIE_ROOT_ID);
                    const entries = idx.filter(e => {
                        const fid = e.folder?.id || e.folder;
                        if (!fid) return false;
                        const fidStr = String(fid);
                        return allFolderIds.some(id => fidStr === id || fidStr.endsWith(`.${id}`));
                    });
                    if (entries.length === 0) return;
                    const crScaleMode = game.settings.get(MODULE_ID, "menagerieDiceMode") !== "raw";
                    const currentChoice = fFlags.menagerieItemChoice || "";
                    const sel = document.createElement("select");
                    sel.style.cssText = "height: 22px; font-size: 0.85em; width: 100%;";
                    const blankOpt = document.createElement("option");
                    blankOpt.value = ""; blankOpt.textContent = "-- Select Creature to Recruit --";
                    blankOpt.selected = !currentChoice;
                    sel.appendChild(blankOpt);
                    // Sort alphabetically then build enriched labels
                    entries.sort((a, b) => a.name.localeCompare(b.name)).forEach(e => {
                        const size = e.system?.traits?.size || "med";
                        const slotCost = BastionManager._getMenagerieSlotCost(size);
                        const slotLabel = slotCost === 1 ? "1 slot" : "\u00bc slot";
                        const cost = BastionManager._getMenagerieCost(e.name, e.system?.details?.cr);
                        // Parse CR for display
                        const rawCr = e.system?.details?.cr;
                        let crNum = 0;
                        if (typeof rawCr === "string") {
                            if (rawCr === "1/8") crNum = 0.125;
                            else if (rawCr === "1/4") crNum = 0.25;
                            else if (rawCr === "1/2") crNum = 0.5;
                            else crNum = parseFloat(rawCr) || 0;
                        } else crNum = Number(rawCr) || 0;
                        const crLabel = rawCr != null ? ` CR ${rawCr}` : "";
                        const dieLabel = crScaleMode ? ` \u00b7 ${BastionManager._getMenagerieDie(crNum)}` : "";
                        const opt = document.createElement("option");
                        opt.value = e.name;
                        opt.textContent = `${e.name} (${cost} GP \u00b7 ${slotLabel}${crLabel}${dieLabel})`;
                        opt.selected = e.name === currentChoice;
                        sel.appendChild(opt);
                    });
                    sel.addEventListener("mousedown", ev => ev.stopPropagation());
                    sel.addEventListener("change", async (ev) => {
                        await item.setFlag(MODULE_ID, "menagerieItemChoice", ev.target.value);
                    });
                    choiceContainer.appendChild(sel);
                    if (!choiceContainer.parentElement) orderBlock.appendChild(choiceContainer);
                })();
            }

            // Garden harvest sub-selectors
            if (facName.includes("Garden") && !facName.includes("Greenhouse") && safeOrder.startsWith("Harvest")) {
                const facSubType  = fFlags.subType  || "";
                const facSubType2 = fFlags.subType2 || "";
                const isVastGarden = (fFlags.size || "Roomy") === "Vast";
                (async () => {
                    const outPack = _getOutPack();
                    if (!outPack) return;
                    const gardenRoot = outPack.folders.get(GARDEN_ROOT_ID)
                        || outPack.folders.find(f => f.name.toLowerCase().trim() === "garden");
                    if (!gardenRoot) return;
                    const typeFolders = outPack.folders.filter(f =>
                        String(folderParentId(f)) === String(gardenRoot.id));
                    const index = await outPack.getIndex({ fields: ["folder", "system.quantity", "uuid"] });

                    const _makeHarvestRow = (subType, flagKey, label) => {
                        const tf = typeFolders.find(f => f.name.toLowerCase().trim() === subType.toLowerCase().trim());
                        if (!tf) return null;
                        const opts = index.filter(i => i.folder === tf.id).map(i => ({
                            value: i.name, label: `${i.name} (Qty: ${i.system?.quantity || 1})`,
                            selected: i.name === (fFlags[flagKey] || "")
                        }));
                        const sel = _buildSelect(opts, fFlags[flagKey] || "", flagKey, "— Choose Harvest —");
                        if (!label) return sel;
                        const row = document.createElement("div");
                        row.style.cssText = "display:flex; align-items:center; gap:4px;";
                        const lbl = document.createElement("span");
                        lbl.style.cssText = "font-size:0.8em; color:#888; white-space:nowrap;";
                        lbl.textContent = label;
                        row.appendChild(lbl); row.appendChild(sel);
                        return row;
                    };

                    if (facSubType) {
                        const el = _makeHarvestRow(facSubType, "harvestChoice", isVastGarden ? "Plot 1:" : null);
                        if (el) choiceContainer.appendChild(el);
                    }
                    if (isVastGarden && facSubType2) {
                        const el2 = _makeHarvestRow(facSubType2, "harvestChoice2", "Plot 2:");
                        if (el2) choiceContainer.appendChild(el2);
                    }
                    if (choiceContainer.children.length > 0 && !choiceContainer.parentElement) orderBlock.appendChild(choiceContainer);
                })();
            }

            // Garden change-type sub-selector
            if (facName.includes("Garden") && !facName.includes("Greenhouse") && safeOrder === "Change Type") {
                (async () => {
                    const outPack = _getOutPack();
                    if (!outPack) return;
                    const gardenRoot = outPack.folders.get(GARDEN_ROOT_ID)
                        || outPack.folders.find(f => f.name.toLowerCase().trim() === "garden");
                    if (!gardenRoot) return;
                    const typeFolders = outPack.folders.filter(f =>
                        String(folderParentId(f)) === String(gardenRoot.id));
                    const currentPending = fFlags.pendingSubType || "";
                    const opts = typeFolders.map(f => ({
                        value: f.name, label: f.name, selected: f.name === currentPending
                    }));
                    const lbl = document.createElement("label");
                    lbl.style.cssText = "font-size: 0.8em; opacity: 0.7; display: block; margin-bottom: 1px;";
                    lbl.textContent = "Change garden to (takes 3 turns):";
                    const sel = _buildSelect(opts, currentPending, "pendingSubType", "— Choose New Type —");
                    choiceContainer.appendChild(lbl);
                    choiceContainer.appendChild(sel);
                    if (!choiceContainer.parentElement) orderBlock.appendChild(choiceContainer);
                })();
            }

            // Storehouse trade sub-selectors
            if (facName.includes("Storehouse") && safeOrder === "Trade") {
                const tradeChoice = fFlags.tradeChoice || "procure";
                const tradeAmount = fFlags.tradeAmount ?? 0;
                const autoNextAction = fFlags.autoNextAction || "procure";
                const isAuto = tradeChoice === "auto";

                const tradeRow = document.createElement("div");
                tradeRow.style.cssText = "display:flex; gap:4px; align-items:center;";

                const tradeSel = document.createElement("select");
                tradeSel.style.cssText = "height:22px; font-size:0.85em; flex:1;";
                [["procure", "Procure Goods"], ["sell", "Sell Goods"], ["auto", "Auto"]].forEach(([v, label]) => {
                    const opt = document.createElement("option");
                    opt.value = v; opt.textContent = label; opt.selected = v === tradeChoice;
                    tradeSel.appendChild(opt);
                });
                tradeSel.addEventListener("mousedown", ev => ev.stopPropagation());
                tradeSel.addEventListener("change", async (ev) => {
                    await item.setFlag(MODULE_ID, "tradeChoice", ev.target.value);
                });

                const amtInput = document.createElement("input");
                amtInput.type = "number"; amtInput.value = tradeAmount; amtInput.min = "0";
                amtInput.style.cssText = "width:50px; height:22px; font-size:0.85em;";
                amtInput.title = "GP amount to trade";
                amtInput.addEventListener("mousedown", ev => ev.stopPropagation());
                amtInput.addEventListener("change", async (ev) => {
                    await item.setFlag(MODULE_ID, "tradeAmount", Math.max(0, parseInt(ev.target.value) || 0));
                });

                const gpLabel = document.createElement("span");
                gpLabel.style.cssText = "font-size:0.8em;";
                gpLabel.textContent = "GP";

                tradeRow.appendChild(tradeSel);
                tradeRow.appendChild(amtInput);
                tradeRow.appendChild(gpLabel);

                if (isAuto) {
                    const nextLabel = document.createElement("span");
                    nextLabel.style.cssText = "font-size:0.75em; color:#00897b; font-weight:bold; white-space:nowrap; flex-shrink:0;";
                    nextLabel.textContent = `[Next: ${autoNextAction.charAt(0).toUpperCase() + autoNextAction.slice(1)}]`;
                    tradeRow.appendChild(nextLabel);
                }

                choiceContainer.appendChild(tradeRow);
                if (!choiceContainer.parentElement) orderBlock.appendChild(choiceContainer);
            }

            // Stable trade sub-selectors
            if (facName.includes("Stable") && safeOrder === "Trade") {
                (async () => {
                    const outPack = _getOutPack();
                    if (!outPack) return;
                    const stableFolder = outPack.folders.get(STABLE_ROOT_ID)
                        || outPack.folders.find(f => f.name.toLowerCase().includes("stable") || f.name.toLowerCase().includes("mount"));
                    if (!stableFolder) return;
                    const { calculationMode, daysPerTurn } = _craftSettings();
                    const tradeChoice = fFlags.stableTradeChoice || "buy";
                    const stableItemChoice = fFlags.stableItemChoice || "";
                    const stableAnimals = (fFlags.stableAnimals || []).map(a => typeof a === "string" ? { species: a, nickname: "" } : a);
                    const stableBuyOrders = fFlags.stableBuyOrders || {};
                    const stableSellOrders = fFlags.stableSellOrders || {};
                    const stableAutoNextAction = fFlags.stableAutoNextAction || "buy";
                    const actorLvl = actor.system?.details?.level || 1;
                    const profitMult = actorLvl >= 17 ? 2.0 : (actorLvl >= 13 ? 1.5 : 1.2);

                    const allOptions = await BastionManager._getNestedCompendiumOptions(
                        outPack, stableFolder.id, stableItemChoice, calculationMode, daysPerTurn, "t", false);
                    const flatOptions = allOptions.flatMap(o => o.groupOptions ? o.groupOptions : [o]);
                    const mountPriceMap = {};
                    for (const o of flatOptions) mountPriceMap[o.value] = Number(o.price) || 0;
                    const priceLookup = (species) => mountPriceMap[species] ?? mountPriceMap[Object.keys(mountPriceMap).find(k => k.toLowerCase() === species.toLowerCase())] ?? 0;

                    // Mode selector row (Buy / Sell / Auto)
                    const tradeRow = document.createElement("div");
                    tradeRow.style.cssText = "display:flex; gap:4px; align-items:center;";

                    const tradeSel = document.createElement("select");
                    tradeSel.style.cssText = "height:22px; font-size:0.85em; flex:0 0 55px;";
                    ["buy", "sell", "auto"].forEach(v => {
                        const opt = document.createElement("option");
                        opt.value = v; opt.textContent = v.charAt(0).toUpperCase() + v.slice(1);
                        opt.selected = v === tradeChoice;
                        tradeSel.appendChild(opt);
                    });
                    tradeSel.addEventListener("mousedown", ev => ev.stopPropagation());
                    tradeSel.addEventListener("change", async (ev) => {
                        await item.setFlag(MODULE_ID, "stableTradeChoice", ev.target.value);
                    });
                    tradeRow.appendChild(tradeSel);

                    if (tradeChoice === "auto") {
                        const nextLabel = document.createElement("span");
                        nextLabel.style.cssText = "font-size:0.75em; color:#00897b; font-weight:bold; white-space:nowrap; flex-shrink:0;";
                        nextLabel.textContent = `[Next: ${stableAutoNextAction.charAt(0).toUpperCase() + stableAutoNextAction.slice(1)}]`;
                        tradeRow.appendChild(nextLabel);
                    }

                    choiceContainer.appendChild(tradeRow);

                    if (tradeChoice === "buy") {
                        const grid = document.createElement("div");
                        grid.style.cssText = "display:flex; flex-direction:column; gap:2px; max-height:100px; overflow-y:auto; background:rgba(0,0,0,0.15); border-radius:4px; padding:3px;";
                        let buyTotal = 0;
                        for (const o of flatOptions) {
                            const qty = Number(stableBuyOrders[o.value] || 0);
                            buyTotal += qty * (Number(o.price) || 0);
                            const row = document.createElement("div");
                            row.style.cssText = `display:flex; align-items:center; gap:4px; font-size:0.78em; ${o.style || ""}`;
                            const labelSpan = document.createElement("span");
                            labelSpan.style.cssText = "flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
                            labelSpan.textContent = o.label; labelSpan.title = o.label;
                            const qtyInput = document.createElement("input");
                            qtyInput.type = "number"; qtyInput.min = "0"; qtyInput.value = qty;
                            qtyInput.style.cssText = "width:38px; height:18px; font-size:0.85em;"; qtyInput.title = "Quantity to buy";
                            qtyInput.addEventListener("mousedown", ev => ev.stopPropagation());
                            qtyInput.addEventListener("change", async (ev) => {
                                const newQty = Math.max(0, parseInt(ev.target.value) || 0);
                                const orders = { ...(item.getFlag(MODULE_ID, "stableBuyOrders") || {}) };
                                if (newQty === 0) delete orders[o.value]; else orders[o.value] = newQty;
                                await item.setFlag(MODULE_ID, "stableBuyOrders", orders);
                            });
                            row.appendChild(labelSpan); row.appendChild(qtyInput);
                            grid.appendChild(row);
                        }
                        choiceContainer.appendChild(grid);
                        if (buyTotal > 0) {
                            const totalDiv = document.createElement("div");
                            totalDiv.style.cssText = "font-size:0.78em; color:#a32a22; font-weight:bold; padding:1px 3px;";
                            totalDiv.innerHTML = `<i class="fa-solid fa-coins"></i> Total Cost: ${buyTotal} GP`;
                            choiceContainer.appendChild(totalDiv);
                        }
                    }

                    if (tradeChoice === "sell") {
                        const speciesCounts = {};
                        for (const a of stableAnimals) speciesCounts[a.species] = (speciesCounts[a.species] || 0) + 1;
                        const grid = document.createElement("div");
                        grid.style.cssText = "display:flex; flex-direction:column; gap:2px; max-height:100px; overflow-y:auto; background:rgba(0,0,0,0.15); border-radius:4px; padding:3px;";
                        let sellGross = 0;
                        let sellBaseCost = 0;
                        for (const [species, count] of Object.entries(speciesCounts)) {
                            const qty = Math.min(Number(stableSellOrders[species] || 0), count);
                            const basePrice = priceLookup(species);
                            const profitPer = Math.floor(basePrice * profitMult);
                            sellGross += profitPer * qty;
                            sellBaseCost += basePrice * qty;
                            const row = document.createElement("div");
                            row.style.cssText = "display:flex; align-items:center; gap:4px; font-size:0.78em;";
                            const labelSpan = document.createElement("span");
                            labelSpan.style.cssText = "flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
                            labelSpan.textContent = profitPer > 0 ? `${species} (${count} owned · ${profitPer} GP ea.)` : `${species} (${count} owned)`;
                            const qtyInput = document.createElement("input");
                            qtyInput.type = "number"; qtyInput.min = "0"; qtyInput.max = count; qtyInput.value = qty;
                            qtyInput.style.cssText = "width:38px; height:18px; font-size:0.85em;"; qtyInput.title = "Quantity to sell";
                            qtyInput.addEventListener("mousedown", ev => ev.stopPropagation());
                            qtyInput.addEventListener("change", async (ev) => {
                                const newQty = Math.max(0, Math.min(count, parseInt(ev.target.value) || 0));
                                const orders = { ...(item.getFlag(MODULE_ID, "stableSellOrders") || {}) };
                                if (newQty === 0) delete orders[species]; else orders[species] = newQty;
                                await item.setFlag(MODULE_ID, "stableSellOrders", orders);
                            });
                            row.appendChild(labelSpan); row.appendChild(qtyInput);
                            grid.appendChild(row);
                        }
                        if (Object.keys(speciesCounts).length === 0) {
                            const emptyMsg = document.createElement("span");
                            emptyMsg.style.cssText = "font-style:italic; font-size:0.78em; opacity:0.7;";
                            emptyMsg.textContent = "No mounts in stock to sell.";
                            grid.appendChild(emptyMsg);
                        }
                        choiceContainer.appendChild(grid);
                        if (sellGross > 0) {
                            const grossDiv = document.createElement("div");
                            grossDiv.style.cssText = "font-size:0.78em; color:#2e7d32; font-weight:bold; padding:1px 3px;";
                            grossDiv.innerHTML = `<i class="fa-solid fa-coins"></i> Gross Earnings: ${sellGross} GP (${sellGross - sellBaseCost} GP profit)`;
                            choiceContainer.appendChild(grossDiv);
                        }
                    }

                    if (!choiceContainer.parentElement) orderBlock.appendChild(choiceContainer);
                })();
            }

            // Generic Queue Button for all crafting facilities
            if (safeOrder.startsWith("Craft") && craftChoice) {
                const qRow = document.createElement("div");
                qRow.className = "bastion-queue-row";
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

            if (choiceContainer.children.length > 0 && !choiceContainer.parentElement) orderBlock.appendChild(choiceContainer);
        }

        const mgrBtn = document.createElement("button");
        mgrBtn.type = "button";
        mgrBtn.title = "Open Bastion Manager (full controls)";
        mgrBtn.style.cssText = "width: auto; height: 22px; padding: 0 5px; font-size: 0.75em; flex-shrink: 0; cursor: pointer; margin-left: auto;";
        mgrBtn.innerHTML = '<i class="fa-solid fa-gauge-high"></i>';
        mgrBtn.addEventListener("mousedown", ev => ev.stopPropagation());
        mgrBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            _openBastionManager(actor, ev.currentTarget);
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

        // C3. Defenders
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
            // Exclude Menagerie creature-defenders from the armory count when bonus is off
            const menArmBonus = game.settings.get(MODULE_ID, "menagerieArmoryBonus");
            const armoryRelDefs = menArmBonus ? totalBastionDefs :
                actor.items.filter(i => i.type === "facility" && !i.name.toLowerCase().includes("menagerie"))
                    .reduce((s, i) => s + (i.getFlag(MODULE_ID, "defenders")?.count || 0), 0)
                + groupFacilities.filter(f => !f.name?.toLowerCase().includes("menagerie"))
                    .reduce((s, f) => s + (f.flags?.[MODULE_ID]?.defenders?.count || 0), 0);
            const effStock = (isStocked && stockedCount === 0) ? armoryRelDefs : stockedCount;
            const d8s = (armoryRelDefs > 0 && isStocked) ? Math.round(6 * Math.clamp(effStock / armoryRelDefs, 0, 1)) : 0;
            const d6s = 6 - d8s;
            const fParts = []; if (d8s > 0) fParts.push(`${d8s}d8`); if (d6s > 0) fParts.push(`${d6s}d6`);
            const attackFormula = fParts.join(" + ") || "6d6";
            let badge;
            if (isStocked && armoryRelDefs > 0 && stockedCount >= armoryRelDefs) {
                badge = `<span style="background:#2e7d32; color:white; padding:1px 6px; border-radius:10px; font-weight:bold; font-size:0.9em;" data-tooltip="All ${stockedCount} defender(s) equipped. Attack event: ${attackFormula} — each 1 rolled kills a defender."><i class="fa-solid fa-shield-check"></i> STOCK-READY (${stockedCount}/${armoryRelDefs})</span>`;
            } else if (isStocked && stockedCount > 0) {
                badge = `<span style="background:#e65100; color:white; padding:1px 6px; border-radius:10px; font-weight:bold; font-size:0.9em;" data-tooltip="${stockedCount} of ${armoryRelDefs} defender(s) equipped. Attack event: ${attackFormula} — each 1 rolled kills a defender. Run a Trade order to fully stock (improves to 6d8)."><i class="fa-solid fa-shield-halved"></i> SEMI-STOCKED (${stockedCount}/${armoryRelDefs})</span>`;
            } else {
                badge = `<span style="background:#555; color:white; padding:1px 6px; border-radius:10px; font-weight:bold; font-size:0.9em;" data-tooltip="No defenders equipped. Attack event: 6d6 — each 1 rolled kills a defender. If none survive, a special facility is damaged. Run a Trade order to stock (upgrades dice to d8s)."><i class="fa-solid fa-shield-slash"></i> UNSTOCKED (0/${armoryRelDefs})</span>`;
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

        // D4. Theater — full Production Status box mirroring the BastionManager window
        if (facName.includes("Theater")) {
            const phase = fFlags.theaterPhase || "Idle";
            const tProg = Number(fFlags.theaterProgress || 0);
            const theaterPhaseDays = BastionManager._getEffectiveDays(14);
            const tPct = Math.round((Math.min(tProg, theaterPhaseDays) / theaterPhaseDays) * 100);
            const phaseColor = phase === "Writing" ? "#82cfff" : (phase === "Rehearsing" ? "#ff9800" : (phase === "Performing" ? "#4caf50" : "#777"));
            const contributors = fFlags.theaterContributors || [];
            const author = fFlags.theaterAuthor || "";
            const scriptTitle = fFlags.theaterScriptTitle || "";
            const writer = contributors.find(c => c.role === "Composer/Writer");
            const director = contributors.find(c => c.role === "Conductor/Director");
            const performers = contributors.filter(c => c.role === "Performer");
            const isIdle = phase === "Idle";
            const isWriting = phase === "Writing";
            const isActing = phase === "Rehearsing" || phase === "Performing";
            const isPerforming = phase === "Performing";
            const isJoined = contributors.some(c => c.actorId === (game.user.character?.id || null));
            const actorLvl = actor.system?.details?.level || 1;
            const dieSize = actorLvl >= 17 ? "d10" : (actorLvl >= 13 ? "d8" : "d6");

            postInjectFns.push(() => {
                const makeBtn = (label, subAction, title, extraStyle = "") => {
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.textContent = label;
                    btn.title = title;
                    btn.style.cssText = `height:24px; font-size:0.78em; padding:2px 8px; white-space:nowrap; border:1px solid rgba(255,255,255,0.25); border-radius:3px; ${extraStyle}`;
                    btn.dataset.subAction = subAction;
                    btn.dataset.itemId = itemId;
                    btn.dataset.isFlag = "false";
                    btn.addEventListener("mousedown", ev => ev.stopPropagation());
                    btn.addEventListener("click", ev => {
                        ev.stopPropagation();
                        BastionManager.onTheaterAction.call({ actor, render: () => {} }, ev, btn);
                    });
                    return btn;
                };

                const box = document.createElement("div");
                box.style.cssText = `border: 2px solid ${phaseColor}; border-radius: 5px; padding: 6px; background: rgba(0,0,0,0.15); margin-top: 3px;`;

                // Header line
                const header = document.createElement("div");
                header.style.cssText = "display:flex; flex-direction:column; gap:4px; margin-bottom:6px;";
                const statusLine = document.createElement("span");
                statusLine.innerHTML = `<i class="fa-solid fa-masks-theater"></i> <b>Production Status:</b> <span style="color:${phaseColor};">${phase}</span>`;
                header.appendChild(statusLine);

                // Button row
                const btnRow = document.createElement("div");
                btnRow.style.cssText = "display:flex; gap:4px; flex-wrap:nowrap;";
                if (!isIdle) {
                    if (isJoined) btnRow.appendChild(makeBtn("Leave Role", "leave", "Leave your current role", "color:#f44336; border-color:rgba(244,67,54,0.4);"));
                    else          btnRow.appendChild(makeBtn("Join Roles", "join", "Join this production in a role"));
                }
                if (isIdle) {
                    btnRow.appendChild(makeBtn("Start Writing", "start-writing", "Begin the writing phase"));
                    btnRow.appendChild(makeBtn("Invite Writer", "invite-writer", "Post a call for a Composer/Writer to chat"));
                } else {
                    btnRow.appendChild(makeBtn("Send Invite", "invite", "Post a production invitation to chat"));
                    btnRow.appendChild(makeBtn("↺", "reset", "Cancel and reset the production"));
                }
                header.appendChild(btnRow);

                // Composition dropdown (Idle only)
                if (isIdle) {
                    const compositions = [];
                    for (const it of game.items) {
                        if (it.getFlag(MODULE_ID, "isProductionComposition")) {
                            compositions.push(it);
                        }
                    }
                    if (compositions.length > 0) {
                        const divider = document.createElement("div");
                        divider.style.cssText = "text-align:center; font-size:0.78em; opacity:0.6; margin:4px 0 2px;";
                        divider.textContent = "— or use an existing composition —";
                        header.appendChild(divider);

                        const compRow = document.createElement("div");
                        compRow.style.cssText = "display:flex; gap:4px; align-items:center;";

                        const select = document.createElement("select");
                        select.style.cssText = "flex:1; font-size:0.78em; height:24px; background:rgba(0,0,0,0.3); color:#e8e4d9; border:1px solid rgba(255,255,255,0.25); border-radius:3px;";
                        select.addEventListener("mousedown", ev => ev.stopPropagation());

                        const defaultOpt = document.createElement("option");
                        defaultOpt.value = "";
                        defaultOpt.textContent = "— Select a composition —";
                        select.appendChild(defaultOpt);

                        for (const it of compositions) {
                            const opt = document.createElement("option");
                            opt.value = it.id;
                            const writerName = it.getFlag(MODULE_ID, "writerName") || "Unknown";
                            opt.textContent = `${it.name} (by ${writerName})`;
                            select.appendChild(opt);
                        }

                        const useBtn = document.createElement("button");
                        useBtn.type = "button";
                        useBtn.textContent = "Use";
                        useBtn.style.cssText = `height:24px; font-size:0.78em; padding:2px 8px; white-space:nowrap; border:1px solid rgba(255,255,255,0.25); border-radius:3px; opacity:0.4;`;
                        useBtn.disabled = true;
                        useBtn.addEventListener("mousedown", ev => ev.stopPropagation());

                        select.addEventListener("change", () => {
                            const hasVal = !!select.value;
                            useBtn.disabled = !hasVal;
                            useBtn.style.opacity = hasVal ? "1" : "0.4";
                        });

                        useBtn.addEventListener("click", ev => {
                            ev.stopPropagation();
                            if (!select.value) return;
                            const proxyBtn = document.createElement("button");
                            proxyBtn.dataset.subAction = "use-composition";
                            proxyBtn.dataset.itemId = itemId;
                            proxyBtn.dataset.isFlag = "false";
                            proxyBtn.dataset.compositionItemId = select.value;
                            BastionManager.onTheaterAction.call({ actor, render: () => {} }, ev, proxyBtn);
                        });

                        compRow.appendChild(select);
                        compRow.appendChild(useBtn);
                        header.appendChild(compRow);
                    }
                }

                box.appendChild(header);

                // Progress bar (Writing or Rehearsing)
                if (isWriting || phase === "Rehearsing") {
                    const bar = document.createElement("div");
                    bar.title = `${tProg} / ${theaterPhaseDays} turns`;
                    bar.style.cssText = "height:8px; background:rgba(0,0,0,0.2); border:1px solid #555; border-radius:4px; overflow:hidden; margin-bottom:5px;";
                    const fill = document.createElement("div");
                    fill.style.cssText = `width:${tPct}%; height:100%; background:${phaseColor};`;
                    bar.appendChild(fill);
                    box.appendChild(bar);
                }

                // Roster
                const roster = document.createElement("div");
                roster.style.cssText = "display:flex; flex-direction:column; gap:2px; margin-top:4px;";

                const rosterRow = (label, value, color = "#82cfff", italic = false) => {
                    const row = document.createElement("div");
                    row.style.cssText = "display:flex; justify-content:space-between;";
                    row.innerHTML = `<span><b>${label}:</b></span><span style="color:${value ? color : "#777"}; font-style:${italic || !value ? "italic" : "normal"};">${value || "None"}</span>`;
                    return row;
                };

                if (isIdle || isWriting) {
                    roster.appendChild(rosterRow("Writer", writer?.name));
                    if (isWriting) {
                        const titleRow = document.createElement("div");
                        titleRow.style.cssText = "display:flex; justify-content:space-between; align-items:center;";
                        titleRow.innerHTML = `<span><b>Script:</b></span>`;
                        const titleInput = document.createElement("input");
                        titleInput.type = "text";
                        titleInput.value = scriptTitle;
                        titleInput.placeholder = "Untitled Script";
                        titleInput.style.cssText = "width:60%; font-size:0.9em; height:18px; padding:0 4px; border:1px solid #555; background:rgba(0,0,0,0.3); color:#e8e4d9; border-radius:3px;";
                        titleInput.addEventListener("mousedown", ev => ev.stopPropagation());
                        titleInput.addEventListener("change", async ev => {
                            await item.setFlag(MODULE_ID, "theaterScriptTitle", ev.target.value);
                        });
                        titleRow.appendChild(titleInput);
                        roster.appendChild(titleRow);
                    }
                }

                if (isActing) {
                    if (author) {
                        const authorRow = document.createElement("div");
                        authorRow.style.cssText = "display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:2px; margin-bottom:2px;";
                        authorRow.innerHTML = `<span><b>Author:</b></span><span style="color:#82cfff; font-style:italic;">${author}</span>`;
                        roster.appendChild(authorRow);
                    }
                    roster.appendChild(rosterRow("Director", director ? `${director.name}${director.isHireling ? " (Hireling)" : ""}` : null, director?.isHireling ? "#777" : "#82cfff"));
                    const perfNames = performers.length > 0 ? performers.map(p => p.name).join(", ") : null;
                    roster.appendChild(rosterRow("Performers", perfNames));
                }

                if (isPerforming) {
                    const live = document.createElement("div");
                    live.style.cssText = "color:#4caf50; font-weight:bold; margin-top:4px;";
                    live.innerHTML = `<i class="fa-solid fa-circle-play"></i> Show is Live! (Award: ${dieSize} die)`;
                    roster.appendChild(live);
                }

                box.appendChild(roster);
                infoBlock.appendChild(box);
            });
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
                rows.push(`<div data-tooltip="${ipTooltip}" style="cursor: help;"><i class="fa-solid fa-brain" style="color:#4a86e8; width:12px;"></i> <b>Fortify Self</b></div>`);
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

        // D9. Facility passive abilities — built-in (Sanctuary/Sacristy) plus any
        // registered by other modules via registerFacilityType({ passive }).
        for (const [keyword, info] of Object.entries(getAllPassiveInfo())) {
            if (facName.includes(keyword) && !isUpgrading) {
                rows.push(`<div data-tooltip="${info.tip}" style="cursor: help; display: flex; align-items: center; justify-content: space-between; gap: 4px;"><span><i class="${info.icon}" style="color:${info.color}; width:12px;"></i> <b>${info.name}</b></span><span style="opacity: 0.7; font-size: 0.88em; white-space: nowrap;"><i class="${info.restIcon}" style="width:10px;"></i> ${info.rest} · Bastion</span></div>`);
                break;
            }
        }

        // D9b. Arcane Study Charm — active status row + grant button
        if (facName.includes("Arcane Study") && !isUpgrading) {
            const charmNames = actor.getFlag(MODULE_ID, "activeArcaneStudyCharmNames") || [];
            if (charmNames.length > 0) {
                rows.push(`<div><i class="fa-solid fa-sparkles" style="color:#b39ddb; width:12px;"></i> <b>Charm:</b> ${charmNames.join(", ")}</div>`);
            } else {
                rows.push(`<div style="opacity:0.55;" data-tooltip="After each Long Rest in your Bastion, you may cast Identify as a Charm (no spell slot required)." style="cursor:help;"><i class="fa-solid fa-sparkles" style="width:12px;"></i> No active Arcane Study Charm</div>`);
            }
            postInjectFns.push(() => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.innerHTML = `<i class="fa-solid fa-sparkles"></i> ${charmNames.length > 0 ? "Refresh" : "Grant"} Charm`;
                btn.style.cssText = "width:100%; height:20px; font-size:0.75em; margin-top:2px;";
                btn.addEventListener("mousedown", ev => ev.stopPropagation());
                btn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    BastionManager.onGrantArcaneStudyCharm.call({ actor }, ev, btn);
                });
                infoBlock.appendChild(btn);
            });
        }

        // D10. Pub Special — tap status + interactive selectors
        if (facName.includes("Pub") && !isUpgrading) {
            const pubFacSize = fFlags.size || "Roomy";
            const slotCount = pubFacSize === "Vast" ? 2 : 1;
            const pubSpecials = fFlags.pubSpecials || [];
            const pubServed = fFlags.pubSpecialsGrantedTo || [];
            for (let s = 0; s < slotCount; s++) {
                const name = pubSpecials[s];
                const served = pubServed[s];
                if (served) {
                    rows.push(`<div><i class="fa-solid fa-beer-mug-empty" style="color:#8b6f3e; width:12px;"></i> <b>Tap ${s+1}:</b> <em style="opacity:0.75;">${name} → ${served.actorName}</em></div>`);
                } else if (name) {
                    rows.push(`<div><i class="fa-solid fa-beer-mug-empty" style="color:#c9a227; width:12px;"></i> <b>Tap ${s+1}:</b> ${name}</div>`);
                } else {
                    rows.push(`<div style="opacity:0.5;"><i class="fa-solid fa-beer-mug-empty" style="width:12px;"></i> <b>Tap ${s+1}:</b> <em>None selected</em></div>`);
                }
            }
            rows.push(`<div style="opacity:0.6; font-size:0.88em;"><i class="fa-solid fa-user-secret" style="width:12px;"></i> Spy Network (Research order)</div>`);

            // Post-inject: add tap selects + grant buttons (requires async compendium load)
            postInjectFns.push(async () => {
                const PUB_ROOT_ID = "soSkXpUmtteM4mgD";
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                let pubOptions = [];
                if (outPack) {
                    const pubSubfolder = outPack.folders.find(f => {
                        const pid = folderParentId(f);
                        return pid === PUB_ROOT_ID && f.name.toLowerCase().includes("special");
                    });
                    if (pubSubfolder) {
                        const idx = await outPack.getIndex({ fields: ["folder"] });
                        pubOptions = idx
                            .filter(i => (i.folder?.id || i.folder) === pubSubfolder.id)
                            .map(i => ({ value: i.name, label: i.name }))
                            .sort((a, b) => a.label.localeCompare(b.label));
                    }
                }
                if (pubOptions.length === 0) {
                    pubOptions = [
                        { value: "Bigby's Burden", label: "Bigby's Burden" },
                        { value: "Kiss of the Spider Queen", label: "Kiss of the Spider Queen" },
                        { value: "Moonlight Serenade", label: "Moonlight Serenade" },
                        { value: "Positive Reinforcement", label: "Positive Reinforcement" },
                        { value: "Sterner Stuff", label: "Sterner Stuff" },
                    ];
                }

                const curSpecials = item.getFlag(MODULE_ID, "pubSpecials") || [];
                const curServed   = item.getFlag(MODULE_ID, "pubSpecialsGrantedTo") || [];
                const pubFacSize2 = fFlags.size || "Roomy";
                const slots = pubFacSize2 === "Vast" ? 2 : 1;

                const pubManageDiv = document.createElement("div");
                pubManageDiv.style.cssText = "border-top:1px solid rgba(255,255,255,0.1); padding-top:3px; margin-top:2px; display:flex; flex-direction:column; gap:2px;";

                for (let s = 0; s < slots; s++) {
                    const row = document.createElement("div");
                    row.style.cssText = "display:flex; align-items:center; gap:3px;";

                    const lbl = document.createElement("label");
                    lbl.style.cssText = "font-size:0.78em; opacity:0.75; white-space:nowrap; min-width:36px;";
                    lbl.textContent = `Tap ${s+1}:`;
                    row.appendChild(lbl);

                    if (curServed[s]) {
                        // Tap is locked but still pourable (infinite pours same special)
                        const sp = document.createElement("span");
                        sp.style.cssText = "font-size:0.78em; font-style:italic; color:#c9a227; flex:1;";
                        sp.textContent = `On tap: ${curSpecials[s] || "?"} (locked)`;
                        row.appendChild(sp);

                        const grantBtn = document.createElement("button");
                        grantBtn.type = "button";
                        grantBtn.title = `Pour another ${curSpecials[s] || "pint"}`;
                        grantBtn.innerHTML = `<i class="fa-solid fa-beer-mug-empty"></i>`;
                        grantBtn.style.cssText = "width:auto; height:18px; padding:0 3px; font-size:0.75em; flex-shrink:0;";
                        grantBtn.addEventListener("mousedown", ev => ev.stopPropagation());
                        grantBtn.addEventListener("click", async (ev) => {
                            ev.stopPropagation();
                            await BastionManager.onPourPubDrink.call({ actor, render: () => {} }, actor, item.id, false, s);
                        });
                        row.appendChild(grantBtn);
                    } else {
                        const sel = document.createElement("select");
                        sel.style.cssText = "flex:1; font-size:0.76em; height:18px;";
                        const blank = document.createElement("option");
                        blank.value = ""; blank.textContent = "— Choose —";
                        if (!curSpecials[s]) blank.selected = true;
                        sel.appendChild(blank);
                        pubOptions.forEach(opt => {
                            const o = document.createElement("option");
                            o.value = opt.value; o.textContent = opt.label;
                            o.selected = opt.value === curSpecials[s];
                            sel.appendChild(o);
                        });
                        sel.addEventListener("mousedown", ev => ev.stopPropagation());
                        sel.addEventListener("change", async (ev) => {
                            const specials = [...(item.getFlag(MODULE_ID, "pubSpecials") || [])];
                            specials[s] = ev.target.value;
                            await item.setFlag(MODULE_ID, "pubSpecials", specials);
                        });
                        row.appendChild(sel);

                        const grantBtn = document.createElement("button");
                        grantBtn.type = "button";
                        grantBtn.title = `Pour Tap ${s+1} for a character`;
                        grantBtn.innerHTML = `<i class="fa-solid fa-beer-mug-empty"></i>`;
                        grantBtn.style.cssText = "width:auto; height:18px; padding:0 3px; font-size:0.75em; flex-shrink:0;";
                        grantBtn.addEventListener("mousedown", ev => ev.stopPropagation());
                        grantBtn.addEventListener("click", async (ev) => {
                            ev.stopPropagation();
                            await BastionManager.onPourPubDrink.call({ actor, render: () => {} }, actor, item.id, false, s);
                        });
                        row.appendChild(grantBtn);
                    }
                    pubManageDiv.appendChild(row);
                }
                infoBlock.appendChild(pubManageDiv);
            });
        }

        // D11. Observatory Charm — active charm status + grant button
        if (facName.includes("Observatory") && !isUpgrading) {
            const charmNames = actor.getFlag(MODULE_ID, "activeObservatoryCharmNames") || [];
            if (charmNames.length > 0) {
                rows.push(`<div><i class="fa-solid fa-star" style="color:#c9a227; width:12px;"></i> <b>Charm:</b> ${charmNames.join(", ")}</div>`);
            } else {
                rows.push(`<div style="opacity:0.55;"><i class="fa-solid fa-star" style="width:12px;"></i> No active Observatory Charm</div>`);
            }
            postInjectFns.push(() => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.innerHTML = `<i class="fa-solid fa-star"></i> ${charmNames.length > 0 ? "Refresh" : "Grant"} Charm`;
                btn.style.cssText = "width:100%; height:20px; font-size:0.75em; margin-top:2px;";
                btn.addEventListener("mousedown", ev => ev.stopPropagation());
                btn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    BastionManager.onGrantObservatoryCharm.call({ actor }, ev, btn);
                });
                infoBlock.appendChild(btn);
            });
        }

        // D13. Reliquary — charm status + grant button; talisman status
        if (facName.includes("Reliquary") && !isUpgrading) {
            const charmNames = actor.getFlag(MODULE_ID, "activeReliquaryCharmNames") || [];
            const talismanId = actor.getFlag(MODULE_ID, "activeReliquaryTalismanId");
            const talismanItem = talismanId ? actor.items.get(talismanId) : null;

            if (charmNames.length > 0) {
                rows.push(`<div><i class="fa-solid fa-khanda" style="color:#c9784e; width:12px;"></i> <b>Charm:</b> ${charmNames.join(", ")}</div>`);
            } else {
                rows.push(`<div style="opacity:0.55;"><i class="fa-solid fa-khanda" style="width:12px;"></i> No active Reliquary Charm</div>`);
            }
            if (talismanItem) {
                rows.push(`<div><i class="fa-solid fa-diamond" style="color:#c9a227; width:12px;"></i> <b>Talisman:</b> ${talismanItem.name}</div>`);
            } else {
                rows.push(`<div style="opacity:0.55;"><i class="fa-solid fa-diamond" style="width:12px;"></i> No Talisman crafted yet</div>`);
            }

            postInjectFns.push(() => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.innerHTML = `<i class="fa-solid fa-khanda"></i> ${charmNames.length > 0 ? "Refresh" : "Grant"} Charm`;
                btn.style.cssText = "width:100%; height:20px; font-size:0.75em; margin-top:2px;";
                btn.addEventListener("mousedown", ev => ev.stopPropagation());
                btn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    BastionManager.onGrantReliquaryCharm.call({ actor, render: () => {} }, ev, btn);
                });
                infoBlock.appendChild(btn);
            });
        }

        // D12. Meditation Chamber — Inner Peace toggle button
        if (facName.includes("Meditation Chamber") && !isUpgrading) {
            postInjectFns.push(() => {
                const active = actor.getFlag(MODULE_ID, "innerPeaceActive") || false;
                const btn = document.createElement("button");
                btn.type = "button";
                btn.innerHTML = active
                    ? `<i class="fa-solid fa-brain" style="color:#4a86e8;"></i> Fortify Self`
                    : `<i class="fa-solid fa-brain"></i> Fortify Self`;
                btn.style.cssText = "width:100%; height:20px; font-size:0.75em; margin-top:2px;";
                btn.addEventListener("mousedown", ev => ev.stopPropagation());
                btn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    BastionManager.onToggleMeditation.call({ actor, render: () => {} }, ev, btn);
                });
                infoBlock.appendChild(btn);
            });
        }

        // D14. Demiplane — Arcane Resilience status + THP button; Fabrication toggle
        if (facName.includes("Demiplane") && !isUpgrading) {
            const runesActive = actor.getFlag(MODULE_ID, "demiplaneRunesActive") || false;
            const fabricationUsed = actor.getFlag(MODULE_ID, "demiplanesFabricationUsed") || false;
            const level = actor.system?.details?.level || 1;
            const thp = level * 5;

            if (runesActive) {
                rows.push(`<div data-tooltip="Until the runes fade (end of Bastion Turn), you gain ${thp} THP after each Long Rest in the Demiplane." style="cursor:help;"><i class="fa-solid fa-circle-nodes" style="color:#b39ddb; width:12px;"></i> <b>Arcane Resilience: <span style="color:#b39ddb;">ACTIVE</span></b> <span style="opacity:0.7;">(+${thp} THP)</span></div>`);
            } else {
                rows.push(`<div style="opacity:0.55;" data-tooltip="Use an Empower order to inscribe Arcane Resilience runes. Until they fade (7 days), you gain ${thp} THP after each Long Rest in the Demiplane." style="cursor:help;"><i class="fa-solid fa-circle-nodes" style="width:12px;"></i> Arcane Resilience inactive</div>`);
            }

            if (fabricationUsed) {
                rows.push(`<div style="opacity:0.55;" data-tooltip="Fabrication has been used. Resets on your next Long Rest." style="cursor:help;"><i class="fa-solid fa-wand-sparkles" style="width:12px;"></i> <b>Fabrication:</b> <em>Used</em></div>`);
            } else {
                rows.push(`<div data-tooltip="While in the Demiplane, take a Magic action to create a nonmagical object (max 5 ft, max 5 GP, wood/stone/clay/porcelain/glass/paper/nonprecious crystal or metal). Once per Long Rest." style="cursor:help;"><i class="fa-solid fa-wand-sparkles" style="color:#b39ddb; width:12px;"></i> <b>Fabrication:</b> Available</div>`);
            }

            postInjectFns.push(() => {
                const thpBtn = document.createElement("button");
                thpBtn.type = "button";
                thpBtn.innerHTML = `<i class="fa-solid fa-circle-nodes"></i> Gain ${thp} THP (Long Rest)`;
                thpBtn.style.cssText = `width:100%; height:20px; font-size:0.75em; margin-top:2px;${!runesActive ? " opacity:0.45; cursor:not-allowed;" : ""}`;
                thpBtn.disabled = !runesActive;
                thpBtn.addEventListener("mousedown", ev => ev.stopPropagation());
                thpBtn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    BastionManager.onGrantDemiplaneThp.call({ actor, render: () => {} }, ev, thpBtn);
                });
                infoBlock.appendChild(thpBtn);

                const fabBtn = document.createElement("button");
                fabBtn.type = "button";
                fabBtn.innerHTML = fabricationUsed
                    ? `<i class="fa-solid fa-wand-sparkles"></i> Fabrication Used`
                    : `<i class="fa-solid fa-wand-sparkles"></i> Use Fabrication`;
                fabBtn.style.cssText = `width:100%; height:20px; font-size:0.75em; margin-top:2px;${fabricationUsed ? " opacity:0.55; font-style:italic;" : ""}`;
                fabBtn.addEventListener("mousedown", ev => ev.stopPropagation());
                fabBtn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    BastionManager.onToggleFabrication.call({ actor, render: () => {} }, ev, fabBtn);
                });
                infoBlock.appendChild(fabBtn);
            });
        }

        // D15. Sanctum — Charm status + grant button; Fortifying Rites status; Word of Recall + Heal button
        if (facName.includes("Sanctum") && !isUpgrading) {
            const charmIds = actor.getFlag(MODULE_ID, "activeSanctumCharmIds") || [];
            const charmNames = actor.getFlag(MODULE_ID, "activeSanctumCharmNames") || [];
            const charmActive = charmIds.length > 0 || charmNames.length > 0;
            const ritesActive = actor.getFlag(MODULE_ID, "sanctumFortifyingRitesActive") || false;
            const benefId = actor.getFlag(MODULE_ID, "sanctumBeneficiaryId") || actor.id;
            const benefName = actor.getFlag(MODULE_ID, "sanctumBeneficiaryName") || "";
            const ownerLevel = actor.system?.details?.level || 1;

            const sanctumActors = game.actors.filter(a =>
                _isBastionEligible(a) && a.type !== "group" && (a.hasPlayerOwner || a.id === actor.id)
            );
            const benefOpts = sanctumActors.map(a =>
                `<option value="${a.id}"${a.id === benefId ? " selected" : ""}>${a.name}</option>`
            ).join("");

            // Beneficiary select goes into orderBlock (mirrors order sub-selector pattern)
            const benefRow = document.createElement("div");
            benefRow.style.cssText = "display:flex; align-items:center; gap:4px; width:100%;";
            benefRow.innerHTML = `<span style="font-size:0.82em; opacity:0.75; white-space:nowrap;">Rites beneficiary:</span><select class="sanctum-beneficiary-select-cs" style="flex:1; font-size:0.78em; height:20px; padding:0 2px;">${benefOpts}</select>`;
            orderBlock.appendChild(benefRow);

            if (charmActive) {
                rows.push(`<div data-tooltip="Sanctum Charm active. Cast Heal once without a spell slot (expires at next Bastion Turn or when used)." style="cursor:help;"><i class="fa-solid fa-heart-pulse" style="color:#c9a227; width:12px;"></i> <b>Sanctum Charm: <span style="color:#c9a227;">ACTIVE</span></b></div>`);
            } else {
                rows.push(`<div style="opacity:0.55;" data-tooltip="After a Long Rest in your Bastion, grant yourself the Sanctum Charm to cast Heal once without a spell slot." style="cursor:help;"><i class="fa-solid fa-heart-pulse" style="width:12px;"></i> No active Sanctum Charm</div>`);
            }

            if (ritesActive) {
                rows.push(`<div data-tooltip="Fortifying Rites active. ${benefName || "Beneficiary"} gains ${ownerLevel} THP after each Long Rest for 7 days." style="cursor:help;"><i class="fa-solid fa-cross" style="color:#c9a227; width:12px;"></i> <b>Fortifying Rites: <span style="color:#c9a227;">ACTIVE</span></b>${benefName ? ` <span style="opacity:0.7;">(${benefName})</span>` : ""}</div>`);
            } else {
                rows.push(`<div style="opacity:0.55;" data-tooltip="Use an Empower order to designate a beneficiary for Fortifying Rites. They gain ${ownerLevel} THP after each Long Rest for 7 days." style="cursor:help;"><i class="fa-solid fa-cross" style="width:12px;"></i> Fortifying Rites inactive</div>`);
            }

            rows.push(`<div data-tooltip="While the Sanctum exists, Word of Recall is always prepared. When cast, you can designate the Sanctum as the destination." style="cursor:help;"><i class="fa-solid fa-person-walking-arrow-right" style="color:#c9a227; width:12px;"></i> <b>Sanctum Recall:</b> <span style="opacity:0.7; font-style:italic;">Always prepared</span></div>`);

            postInjectFns.push(() => {
                const charmBtn = document.createElement("button");
                charmBtn.type = "button";
                charmBtn.innerHTML = charmActive
                    ? `<i class="fa-solid fa-heart-pulse"></i> Charm Active`
                    : `<i class="fa-solid fa-heart-pulse"></i> Grant Charm`;
                charmBtn.style.cssText = `width:100%; height:20px; font-size:0.75em; margin-top:2px;${charmActive ? " opacity:0.45; cursor:not-allowed;" : ""}`;
                charmBtn.disabled = charmActive;
                charmBtn.addEventListener("mousedown", ev => ev.stopPropagation());
                charmBtn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    BastionManager.onGrantSanctumCharm.call({ actor, render: () => {} }, ev, charmBtn);
                });
                infoBlock.appendChild(charmBtn);

                const ritesThpBtn = document.createElement("button");
                ritesThpBtn.type = "button";
                ritesThpBtn.innerHTML = `<i class="fa-solid fa-cross"></i> Grant Rites THP`;
                ritesThpBtn.style.cssText = `width:100%; height:20px; font-size:0.75em; margin-top:2px;${!ritesActive ? " opacity:0.45; cursor:not-allowed;" : ""}`;
                ritesThpBtn.disabled = !ritesActive;
                ritesThpBtn.addEventListener("mousedown", ev => ev.stopPropagation());
                ritesThpBtn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    BastionManager.onGrantSanctumRitesThp.call({ actor, render: () => {} }, ev, ritesThpBtn);
                });
                infoBlock.appendChild(ritesThpBtn);

                const recallBtn = document.createElement("button");
                recallBtn.type = "button";
                recallBtn.innerHTML = `<i class="fa-solid fa-heart-pulse"></i> Apply Recall Heal`;
                recallBtn.style.cssText = "width:100%; height:20px; font-size:0.75em; margin-top:2px;";
                recallBtn.addEventListener("mousedown", ev => ev.stopPropagation());
                recallBtn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    BastionManager.onApplySanctumRecallHeal.call({ actor, render: () => {} }, ev, recallBtn);
                });
                infoBlock.appendChild(recallBtn);

                orderBlock.querySelectorAll(".sanctum-beneficiary-select-cs").forEach(sel => {
                    sel.addEventListener("mousedown", ev => ev.stopPropagation());
                    sel.addEventListener("change", async (ev) => {
                        ev.stopPropagation();
                        const newBenef = game.actors.get(ev.target.value);
                        if (!newBenef) return;
                        await actor.setFlag(MODULE_ID, "sanctumBeneficiaryId", newBenef.id);
                        await actor.setFlag(MODULE_ID, "sanctumBeneficiaryName", newBenef.name);
                    });
                });
            });
        }

        // D16. Guildhall — guild type, assignment button, Adventurers' outcome sub-selector (all in orderBlock)
        if (facName.includes("Guildhall") && !isUpgrading) {
            const guildType = fFlags.subType || "";
            const lastAssignment = fFlags.guildhallLastAssignment || "";
            const isAdventurers = guildType.toLowerCase().includes("adventurer");
            const adventurersOutcome = fFlags.guildhallAdventurersOutcome || "slay";
            const facId = item.id;
            const isFlagStr = "false";

            const guildDiv = document.createElement("div");
            guildDiv.style.cssText = "display:flex; flex-direction:column; gap:3px; width:100%;";

            const guildHeader = document.createElement("div");
            guildHeader.style.cssText = "display:flex; justify-content:space-between; align-items:center;";
            guildHeader.innerHTML = `<span style="font-size:0.85em;"><i class="fa-solid fa-users" style="color:#81c784; width:12px;"></i> <b>Guild:</b> <span style="color:#81c784;">${guildType || "Unknown"}</span></span>
                <button class="guildhall-assignment-btn" data-item-id="${facId}" data-is-flag="${isFlagStr}"
                    style="height:20px; padding:0 5px; font-size:0.76em; background:#1a3a1a; color:#81c784; border:1px solid #4caf50; border-radius:3px; cursor:pointer;"
                    data-tooltip="View this guild's assignment description">
                    <i class="fa-solid fa-scroll"></i> Assignment
                </button>`;
            guildDiv.appendChild(guildHeader);

            if (isAdventurers) {
                const outcomeRow = document.createElement("div");
                outcomeRow.style.cssText = "display:flex; align-items:center; gap:5px;";
                outcomeRow.innerHTML = `<label style="font-size:0.82em; opacity:0.75; white-space:nowrap;">Mission outcome:</label>
                    <select class="guildhall-outcome-select-cs" data-item-id="${facId}" data-is-flag="${isFlagStr}"
                        style="flex:1; font-size:0.82em; height:22px;">
                        <option value="slay" ${adventurersOutcome === "slay" ? "selected" : ""}>Slay the beast</option>
                        <option value="capture" ${adventurersOutcome === "capture" ? "selected" : ""}>Capture the beast</option>
                    </select>`;
                guildDiv.appendChild(outcomeRow);
            }

            const lastDiv = document.createElement("div");
            lastDiv.style.cssText = "font-size:0.82em;";
            if (lastAssignment) {
                lastDiv.innerHTML = `<i class="fa-solid fa-scroll" style="opacity:0.7; width:12px;"></i> <em style="opacity:0.8;">Last: ${lastAssignment}</em>`;
            } else {
                lastDiv.innerHTML = `<i class="fa-solid fa-scroll" style="opacity:0.55; width:12px;"></i> <em style="opacity:0.55;">No assignment issued yet.</em>`;
            }
            guildDiv.appendChild(lastDiv);

            orderBlock.appendChild(guildDiv);

            postInjectFns.push(() => {
                orderBlock.querySelectorAll('.guildhall-assignment-btn').forEach(btn => {
                    btn.addEventListener('mousedown', ev => ev.stopPropagation());
                    btn.addEventListener('click', ev => {
                        ev.stopPropagation();
                        BastionManager.onShowGuildhallAssignment.call({ actor }, ev, btn);
                    });
                });
                orderBlock.querySelectorAll('.guildhall-outcome-select-cs').forEach(sel => {
                    sel.addEventListener('mousedown', ev => ev.stopPropagation());
                    sel.addEventListener('change', async (ev) => {
                        ev.stopPropagation();
                        const ds = ev.target.dataset;
                        if (ds.isFlag === "true") {
                            const gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
                            const f = gf.find(f => f._id === ds.itemId);
                            if (f) foundry.utils.setProperty(f, `flags.${MODULE_ID}.guildhallAdventurersOutcome`, ev.target.value);
                            await actor.setFlag(MODULE_ID, "groupFacilities", gf);
                        } else {
                            await actor.items.get(ds.itemId)?.setFlag(MODULE_ID, "guildhallAdventurersOutcome", ev.target.value);
                        }
                    });
                });
            });
        }

        // D17. War Room — recruit sub-selector (orderBlock) + lieutenant/army status (infoBlock)
        if (facName.includes("War Room") && !isUpgrading) {
            const recruitOption = fFlags.warRoomRecruitOption || "lieutenant";
            const lieutenants = actor.getFlag(MODULE_ID, "warRoomLieutenants") || [];
            const ltCount = lieutenants.length;
            const armyActive = actor.getFlag(MODULE_ID, "warRoomArmyActive") || false;
            const armyGuards = actor.getFlag(MODULE_ID, "warRoomArmyGuards") || 0;
            const armyMounted = actor.getFlag(MODULE_ID, "warRoomArmyMounted") || false;
            const armyLeader = actor.getFlag(MODULE_ID, "warRoomArmyLeaderName") || "";
            const facId = item.id;
            const isFlagStr = "false";
            const attackPool = Math.max(0, 6 - ltCount);

            // Sub-selector goes into orderBlock
            const recruitRow = document.createElement("div");
            recruitRow.style.cssText = "display:flex; align-items:center; gap:4px; width:100%;";
            recruitRow.innerHTML = `<span style="font-size:0.82em; opacity:0.75; white-space:nowrap;">Recruit:</span>
                <select class="war-room-recruit-select-cs" data-item-id="${facId}" data-is-flag="${isFlagStr}"
                    style="flex:1; font-size:0.78em; height:20px; padding:0 2px;">
                    <option value="lieutenant"${recruitOption === "lieutenant" ? " selected" : ""}>Lieutenant (${ltCount}/10)</option>
                    <option value="soldiers"${recruitOption === "soldiers" ? " selected" : ""}>Soldiers (muster army)</option>
                </select>`;
            orderBlock.appendChild(recruitRow);

            // Lieutenant status row
            rows.push(`<div data-tooltip="Each lieutenant housed in your Bastion reduces the Bastion Attack dice pool by 1 (currently ${ltCount} → ${attackPool} dice)." style="cursor:help;"><i class="fa-solid fa-chess-rook" style="color:#ef5350; width:12px;"></i> <b>Lieutenants:</b> <span style="color:#ef9a9a;">${ltCount}/10</span>${ltCount > 0 ? ` <span style="opacity:0.65;">(−${ltCount} attack dice)</span>` : ""}</div>`);

            // Army status row
            if (armyActive) {
                const mountedText = armyMounted ? " mounted" : "";
                rows.push(`<div data-tooltip="An army is currently assembled and must be led by you or a lieutenant." style="cursor:help;"><i class="fa-solid fa-shield-halved" style="color:#ef5350; width:12px;"></i> <b>Army: <span style="color:#ef5350;">ACTIVE</span></b> — ${armyGuards} Guards${mountedText}, led by <span style="color:#ef9a9a;">${armyLeader}</span></div>`);
            }

            postInjectFns.push(() => {
                orderBlock.querySelectorAll('.war-room-recruit-select-cs').forEach(sel => {
                    sel.addEventListener('mousedown', ev => ev.stopPropagation());
                    sel.addEventListener('change', async (ev) => {
                        ev.stopPropagation();
                        const ds = ev.target.dataset;
                        if (ds.isFlag === "true") {
                            const gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
                            const f = gf.find(f => f._id === ds.itemId);
                            if (f) foundry.utils.setProperty(f, `flags.${MODULE_ID}.warRoomRecruitOption`, ev.target.value);
                            await actor.setFlag(MODULE_ID, "groupFacilities", gf);
                        } else {
                            await actor.items.get(ds.itemId)?.setFlag(MODULE_ID, "warRoomRecruitOption", ev.target.value);
                        }
                    });
                });

                // "Lieutenant Roster" button
                const rosterBtn = document.createElement("button");
                rosterBtn.type = "button";
                rosterBtn.innerHTML = `<i class="fa-solid fa-chess-rook"></i> Lieutenant Roster`;
                rosterBtn.style.cssText = "width:100%; height:20px; font-size:0.75em; margin-top:2px;";
                rosterBtn.addEventListener("mousedown", ev => ev.stopPropagation());
                rosterBtn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    BastionManager.onShowWarRoomRoster.call({ actor, render: () => {} }, ev, rosterBtn);
                });
                infoBlock.appendChild(rosterBtn);

                // "Disband Army" button (only if army active)
                if (armyActive) {
                    const disbandBtn = document.createElement("button");
                    disbandBtn.type = "button";
                    disbandBtn.innerHTML = `<i class="fa-solid fa-flag-checkered"></i> Disband Army`;
                    disbandBtn.style.cssText = "width:100%; height:20px; font-size:0.75em; margin-top:2px; background:rgba(100,0,0,0.4); color:#ef9a9a; border-color:#b71c1c;";
                    disbandBtn.addEventListener("mousedown", ev => ev.stopPropagation());
                    disbandBtn.addEventListener("click", (ev) => {
                        ev.stopPropagation();
                        BastionManager.onDisbandWarRoomArmy.call({ actor, render: () => {} }, ev, disbandBtn);
                    });
                    infoBlock.appendChild(disbandBtn);
                }
            });
        }

        // Insert order block and info block after .facility-header
        const headerDiv = li.querySelector('.facility-header');
        if (headerDiv) {
            if (!isBasicFacility) {
                headerDiv.after(orderBlock);
                if (rows.length > 0 || postInjectFns.length > 0) {
                    infoBlock.innerHTML = rows.join("");
                    orderBlock.after(infoBlock);
                }
            } else if (rows.length > 0 || postInjectFns.length > 0) {
                infoBlock.innerHTML = rows.join("");
                headerDiv.after(infoBlock);
            }
        }
        // Run post-inject functions (interactive DOM elements that need event listeners)
        for (const fn of postInjectFns) fn();

        // Add hireling name tooltips to native occupant slots (if naming is enabled)
        // Uses .slot.hireling to cover both native dnd5e (.occupant-slot) and Tidy 5e (.member-slot).
        // MutationObserver re-applies names when Tidy 5e's Svelte reactivity resets data-tooltip on hover.
        if (game.settings.get(MODULE_ID, "nameHirelings")) {
            const hirelingNames = fFlags.hirelings || [];
            if (hirelingNames.length > 0) {
                [...li.querySelectorAll(".slot.hireling:not(.empty)")].forEach((slot, i) => {
                    if (!hirelingNames[i]) return;
                    slot.setAttribute("data-tooltip", hirelingNames[i]);
                    const obs = new MutationObserver(() => {
                        if (slot.getAttribute("data-tooltip") !== hirelingNames[i])
                            slot.setAttribute("data-tooltip", hirelingNames[i]);
                    });
                    obs.observe(slot, { attributes: true, attributeFilter: ["data-tooltip"] });
                });
            }
        }

        // Right-click → context menu for facility management actions
        li.addEventListener("contextmenu", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const _ctxSourceEl = ev.currentTarget;

            // Remove any existing context menu first
            document.querySelectorAll('.bastion-facility-context-menu').forEach(m => m.remove());

            const facSize2 = fFlags.size || "Cramped";
            const isUpgrading2 = (fFlags.upgradeTurns || 0) > 0;
            const isDamaged2 = !!fFlags.isDamaged;
            const enlargeableSpecials = ["Archive", "Barrack", "Garden", "Pub", "Stable", "Workshop"];
            const canEnlarge = !isUpgrading2 && !isDamaged2 && facSize2 !== "Vast" && (
                isBasicFacility || enlargeableSpecials.some(n => facName.includes(n))
            );

            const menu = document.createElement('div');
            menu.className = 'bastion-facility-context-menu';
            menu.style.cssText = `position: fixed; z-index: 9999; left: ${ev.clientX}px; top: ${ev.clientY}px; background: #1a1510; border: 1px solid var(--dnd5e-color-gold, #c9a227); border-radius: 4px; padding: 4px 0; min-width: 170px; box-shadow: 0 4px 14px rgba(0,0,0,0.7); font-family: var(--dnd5e-font-roboto, sans-serif); font-size: 0.85em;`;

            const addItem = (icon, label, disabled, onClick) => {
                const row = document.createElement('div');
                row.style.cssText = `padding: 6px 12px; cursor: ${disabled ? 'not-allowed' : 'pointer'}; display: flex; align-items: center; gap: 8px; color: ${disabled ? '#555' : '#e8e4d9'};`;
                row.innerHTML = `<i class="${icon}" style="width:14px; text-align:center; opacity:${disabled ? 0.4 : 0.8};"></i> ${label}`;
                if (!disabled) {
                    row.addEventListener('mouseenter', () => row.style.background = 'rgba(201,162,39,0.18)');
                    row.addEventListener('mouseleave', () => row.style.background = '');
                    row.addEventListener('click', (e) => { e.stopPropagation(); menu.remove(); document.removeEventListener('click', closeMenu, true); onClick(e); });
                }
                menu.appendChild(row);
            };

            const addSep = () => {
                const sep = document.createElement('div');
                sep.style.cssText = 'height: 1px; background: rgba(255,255,255,0.1); margin: 3px 0;';
                menu.appendChild(sep);
            };

            const mockTarget = { dataset: { itemId, isFlag: "false" } };

            // Enlarge option
            addItem('fa-solid fa-expand', canEnlarge ? 'Enlarge Facility' : isUpgrading2 ? 'Enlarging…' : facSize2 === 'Vast' ? 'Already Vast' : 'Cannot Enlarge', !canEnlarge, () => {
                BastionManager.onUpgradeFacility.call({ actor }, new MouseEvent('click'), mockTarget);
            });

            // Damage toggle
            if (isDamaged2) {
                addItem('fa-solid fa-wrench', 'Clear Damage', false, async () => {
                    await item.setFlag(MODULE_ID, 'isDamaged', false);
                    await item.setFlag(MODULE_ID, 'repairProgress', 0);
                    await item.setFlag(MODULE_ID, 'repairTurns', 0);
                });
            } else {
                addItem('fa-solid fa-burst', 'Mark as Damaged', isUpgrading2, async () => {
                    const repairTurns = facSize2 === 'Vast' ? 4 : facSize2 === 'Roomy' ? 2 : 1;
                    await item.setFlag(MODULE_ID, 'isDamaged', true);
                    await item.setFlag(MODULE_ID, 'repairProgress', 0);
                    await item.setFlag(MODULE_ID, 'repairTurns', repairTurns);
                });
            }

            addSep();

            addItem('fa-solid fa-circle-xmark', 'Demolish', false, () => {
                BastionManager.onDeleteFacility.call({ actor }, new MouseEvent('click'), mockTarget);
            });

            addSep();

            addItem('fa-solid fa-gauge-high', 'Open Full Manager', false, () => {
                _openBastionManager(actor, _ctxSourceEl);
            });

            document.body.appendChild(menu);

            // Reposition if it would overflow the viewport
            requestAnimationFrame(() => {
                const rect = menu.getBoundingClientRect();
                if (rect.right > window.innerWidth) menu.style.left = `${ev.clientX - rect.width}px`;
                if (rect.bottom > window.innerHeight) menu.style.top = `${ev.clientY - rect.height}px`;
            });

            // Close when clicking outside
            const closeMenu = (e) => {
                if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu, true); }
            };
            document.addEventListener('click', closeMenu, true);
        });
    });
};

/**
 * DOM OBSERVER
 * This runs in the background and watches for the Bastion tab being shown.
 */
const observer = new MutationObserver(() => {
    // Check all elements matching the bastion tab selector (native dnd5e + Tidy 5e Sheets)
    const tabs = document.querySelectorAll('section[data-tab="bastion"], div[data-tab="bastion"], [data-tab-contents-for="bastion"]');
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
    Handlebars.registerHelper({ ge: (a, b) => a >= b, div: (a, b) => a / b, mult: (a, b) => a * b, subtract: (a, b) => a - b });

    // v13: Define and register dummy layer inside init to ensure namespaces are ready
    CONFIG.Canvas.layers.bastion = { 
        layerClass: BastionLayer, 
        group: "interface" 
    };

    // --- Settings Registration ---
    // All user-facing settings are managed via the Configure Bastion Manager menu button.
    // config: false keeps them hidden from the flat settings list.

    // ── Rules & Restrictions (hidden) ────────────────────────────────
    game.settings.register(MODULE_ID, "debugLogging",            { scope: "client", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "ignoreConstructionCosts", { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "ignoreFacilityPrereqs",   { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "specialFacilitiesBuildTime", { scope: "world", config: false, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "specialFacilitiesGoldCost",  { scope: "world", config: false, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "disableNeglect",          { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "disableSpecialCap",       { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "disableDuplicateLimit",   { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "globalCostMultiplier",    { scope: "world", config: false, type: Number,  default: 100 });
    game.settings.register(MODULE_ID, "globalTimeMultiplier",    { scope: "world", config: false, type: Number,  default: 100 });
    const defaultValues = { buildCrampedCost: 500, buildCrampedTime: 3, buildRoomyCost: 1000, buildRoomyTime: 7, buildVastCost: 3000, buildVastTime: 18, enlargeRoomyCost: 500, enlargeRoomyTime: 4, enlargeVastCost: 2000, enlargeVastTime: 12 };
    for (const [key, val] of Object.entries(defaultValues)) game.settings.register(MODULE_ID, key, { scope: "world", config: false, type: Number, default: val });
    game.settings.register(MODULE_ID, "excludedSourcesData",     { scope: "world", config: false, type: Array,   default: [] });
    game.settings.register(MODULE_ID, "excludedFacilitiesData",  { scope: "world", config: false, type: Array,   default: [] });

    // ── Turn Management (hidden) ──────────────────────────────────────
    game.settings.register(MODULE_ID, "advancePermission",       { scope: "world", config: false, type: Number,  default: 4 });
    game.settings.register(MODULE_ID, "groupInheritsFacilities", { scope: "world", config: false, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "unifyCombinedTurns",      { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "globalTurnCount",         { scope: "world", config: false, type: Number,  default: 0 });

    // ── Time & Calendar (hidden) ──────────────────────────────────────
    game.settings.register(MODULE_ID, "calculationMode",         { scope: "world", config: false, type: String,  default: "turns" });
    game.settings.register(MODULE_ID, "daysPerTurn",             { scope: "world", config: false, type: Number,  default: 7 });
    game.settings.register(MODULE_ID, "syncDaysPerTurn",         { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "scaleWeekToTurnLength",   { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "advanceWorldTime",        { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "calendarDrivenTurns",     { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "ordersIssuedAt",          { scope: "world", config: false, type: Number,  default: 0 });

    // ── Orders (hidden) ───────────────────────────────────────────────
    game.settings.register(MODULE_ID, "recruitMode",             { scope: "world", config: false, type: String,  default: "roll" });
    game.settings.register(MODULE_ID, "promptAllEvents",         { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "manualEventSelection",    { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "aidUsesDefenderRules",    { scope: "world", config: false, type: Boolean, default: false });

    // ── Hirelings & Staff (hidden) ────────────────────────────────────
    game.settings.register(MODULE_ID, "nameHirelings",           { scope: "world",  config: false, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "promptHirelingNames",     { scope: "client", config: false, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "promptDefenderNames",     { scope: "client", config: false, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "autoNameHirelings",       { scope: "client", config: false, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "nameDefenders",           { scope: "world",  config: false, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "autoNameDefenders",       { scope: "client", config: false, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "createActorsForHirelings",  { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "createActorsForDefenders",  { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "hirelingActorTemplates",    { scope: "world", config: false, type: String,  default: JSON.stringify(FACILITY_HIRELING_TEMPLATES) });

    // ── Facility-Specific (hidden) ────────────────────────────────────
    game.settings.register(MODULE_ID, "menagerieArmoryBonus",    { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "menagerieDiceMode",       { scope: "world", config: false, type: String,  default: "raw" });
    game.settings.register(MODULE_ID, "menagerieCrDiceTable",    { scope: "world", config: false, type: String,  default: '{"0":"d6","1":"d8","4":"d10","9":"d12"}' });
    game.settings.register(MODULE_ID, "reliquaryOneTalismanLimit",{ scope: "world", config: false, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "freeMode",                { scope: "world", config: false, type: Boolean, default: false });
    game.settings.register(MODULE_ID, "allowedActorTypes",       { scope: "world", config: false, type: Array,   default: ["character"] });

    // ── Root Menu Buttons ─────────────────────────────────────────────
    game.settings.registerMenu(MODULE_ID, "bastionConfigBtn",         { name: "Bastion Manager Configuration",   label: "Configure Bastion Manager",      icon: "fas fa-chess-rook",       type: BastionSettingsApp,     restricted: true });
    game.settings.registerMenu(MODULE_ID, "bastionPlayerConfigBtn",   { name: "Bastion Manager — My Preferences", label: "My Bastion Preferences",         icon: "fas fa-user-gear",        type: BastionPlayerSettingsApp, restricted: false });
    game.settings.registerMenu(MODULE_ID, "resetAllTurnsBtn",         { name: "Reset All Bastion Turns",         label: "Reset Global Turns",             icon: "fas fa-rotate-left",      type: ResetBastionsApp,       restricted: true });
    game.settings.registerMenu(MODULE_ID, "hirelingTemplatesBtn",     { name: "Hireling Actor Templates",        label: "Configure Hireling Templates",   icon: "fas fa-masks-theater",    type: HirelingTemplatesApp,   restricted: true });
    game.settings.registerMenu(MODULE_ID, "constructionConfigBtn",    { name: "Facility Construction Costs",     label: "Configure Construction Costs",   icon: "fas fa-hammer",           type: ConstructionConfigApp,  restricted: true });
    game.settings.registerMenu(MODULE_ID, "facilityExclusionBtn",     { name: "Facility Availability",           label: "Manage Facility Availability",   icon: "fas fa-filter",           type: FacilityExclusionApp,   restricted: true });

    // dnd5e 5.3.3 / Foundry v14 compatibility: SourcedItemsMap.set() crashes when
    // parseUuid() returns null for malformed compendiumSource UUIDs, leaving item.labels
    // undefined and crashing CharacterActorSheet._prepareItem. Ensure labels is always
    // initialized after _safePrepareData, even when system.prepareBaseData() throws.
    const Item5e = CONFIG.Item.documentClass;
    if (Item5e?.prototype) {
        const _origItemSafe = Item5e.prototype._safePrepareData;
        Item5e.prototype._safePrepareData = function() {
            _origItemSafe.call(this);
            this.labels ??= {};
        };
    }
});

Hooks.once("ready", async () => {
    bastionLog("Foundry is ready.");
    game.modules.get("dnd-2024-bastion-manager").api = {
        BastionManager,
        registerFacilityType: (config) => BastionManager.registerFacilityType(config),
    };
    await BastionManager.loadProfessions();

    // Invalidate the cached output-compendium folder layout if its folders change.
    for (const ev of ["createFolder", "updateFolder", "deleteFolder"]) {
        Hooks.on(ev, (folder) => {
            if (folder?.pack === `${MODULE_ID}.bastion-output-items`) BastionManager.clearFolderConfigCache();
        });
    }

    // Migrate items with malformed compendiumSource UUIDs that crash dnd5e 5.3.3's
    // SourcedItemsMap.set() when parseUuid() returns null.
    if (game.user.isGM) {
        const brokenItems = [];
        for (const actor of game.actors) {
            for (const item of actor.items) {
                const csrc = item._stats?.compendiumSource;
                const sid  = item.flags?.dnd5e?.sourceId;
                const hasBadCsrc = csrc && foundry.utils.parseUuid(csrc) === null;
                const hasBadSid  = sid  && foundry.utils.parseUuid(sid)  === null;
                if (hasBadCsrc || hasBadSid) brokenItems.push({ item, hasBadCsrc, hasBadSid });
            }
        }
        for (const { item, hasBadCsrc, hasBadSid } of brokenItems) {
            const updates = {};
            if (hasBadCsrc) updates["_stats.compendiumSource"] = null;
            if (hasBadSid)  updates["flags.dnd5e.-=sourceId"] = null;
            console.warn(`Bastion Manager | Clearing malformed source UUID on "${item.parent?.name} / ${item.name}"`, item._stats?.compendiumSource ?? item.flags?.dnd5e?.sourceId);
            await item.update(updates);
        }
    }

    // Migrate workshopTools flag: correct historical wrong tool names
    if (game.user.isGM) {
        const TOOL_NAME_CORRECTIONS = { "Painter's Tools": "Painter's Supplies" };
        const needsFix = (tools) => Array.isArray(tools) && tools.some(t => TOOL_NAME_CORRECTIONS[t]);
        const applyFix = (tools) => tools.map(t => TOOL_NAME_CORRECTIONS[t] ?? t);
        for (const actor of game.actors) {
            // Fix actor items (Workshop facility items)
            for (const item of actor.items) {
                if (!item.name.includes("Workshop")) continue;
                const tools = item.getFlag("dnd-2024-bastion-manager", "workshopTools");
                if (needsFix(tools)) await item.setFlag("dnd-2024-bastion-manager", "workshopTools", applyFix(tools));
            }
            // Fix groupFacilities flag (group/party bastions)
            const groupFacs = actor.getFlag("dnd-2024-bastion-manager", "groupFacilities");
            if (Array.isArray(groupFacs)) {
                let changed = false;
                for (const fac of groupFacs) {
                    const tools = fac.flags?.["dnd-2024-bastion-manager"]?.workshopTools;
                    if (needsFix(tools)) { fac.flags["dnd-2024-bastion-manager"].workshopTools = applyFix(tools); changed = true; }
                }
                if (changed) await actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacs);
            }
        }
    }

    // Inject global styles for the "WORKING" pulse animation
    const style = document.createElement("style");
    style.innerHTML = `
        @keyframes bastion-pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
        #bastion-turn { display: none !important; }
    `;
    document.head.appendChild(style);

    // v13: Force control refresh to ensure the Bastion category appears for the GM
    if ( game.user.isGM ) { bastionLog("Forcing sidebar re-render."); ui.controls.render(true); }

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
            bastionLog(`Hijacking native advancement for ${actor.name}.`);
            if (game.settings.get(MODULE_ID, "calendarDrivenTurns")) {
                BastionManager.onIssueOrders.call({ actor, element: btn.parentElement }, event, btn);
            } else {
                BastionManager.onAdvanceGlobalTurn.call({ actor, element: btn.parentElement }, event, btn);
            }
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
        document.querySelectorAll('section[data-tab="bastion"], div[data-tab="bastion"], [data-tab-contents-for="bastion"]').forEach(tab => {
            const app = Array.from(foundry.applications.instances.values()).find(a => a.element?.contains(tab))
                     || Object.values(ui.windows).find(w => (w.element?.[0] || w.element)?.contains(tab));
            if ((app?.document || app?.actor)?.id === actor.id) {
                tab.querySelectorAll(".bastion-augmented").forEach(el => el.classList.remove("bastion-augmented"));
            }
        });
    }
});

// Rest cleanup, Sanctum Fortifying Rites THP, and Bastion facility rest-effect prompts
Hooks.on("dnd5e.restCompleted", async (actor, result) => {
    if (!result || typeof result.longRest !== "boolean") return;

    // Only run on the client that owns the resting actor (avoids duplicate dialogs/updates)
    if (!actor.isOwner) return;

    // Long Rest: reset per-rest flags
    if (result.longRest) {
        if (actor.getFlag(MODULE_ID, "demiplanesFabricationUsed"))
            await actor.setFlag(MODULE_ID, "demiplanesFabricationUsed", false);
        if (actor.getFlag(MODULE_ID, "workshopInspirationUsed"))
            await actor.setFlag(MODULE_ID, "workshopInspirationUsed", false);
    }

    // Long Rest: Sanctum Fortifying Rites — apply THP if this actor is a designated beneficiary.
    // Reads another actor's flags; requires Observer (or higher) permission on that actor, which is
    // typical in Foundry. The "Grant Rites THP" button on the Sanctum owner's sheet is always available
    // as a fallback if cross-actor flag reads fail.
    if (result.longRest) {
        for (const sanctumOwner of game.actors) {
            if (!sanctumOwner.getFlag(MODULE_ID, "sanctumFortifyingRitesActive")) continue;
            const benefId = sanctumOwner.getFlag(MODULE_ID, "sanctumBeneficiaryId");
            if (benefId !== actor.id) continue;
            const ownerLevel = sanctumOwner.system?.details?.level || 1;
            const currentTemp = actor.system?.attributes?.hp?.temp || 0;
            await actor.update({ "system.attributes.hp.temp": Math.max(currentTemp, ownerLevel) });
            ui.notifications.info(`${actor.name} gains ${ownerLevel} Temporary Hit Point${ownerLevel !== 1 ? "s" : ""} from ${sanctumOwner.name}'s Sanctum Fortifying Rites.`);
        }
    }

    // Prompt for Bastion facility rest effects (charm grants, spell-slot recovery, etc.)
    if (result.longRest)  await BastionManager.handleLongRestFacilityEffects(actor);
    if (!result.longRest) await BastionManager.handleShortRestFacilityEffects(actor);
});

// Clear stale bastion augmentation when a facility item's module flags change
// (e.g., Armory isStocked, stockedCount updated after a trade order)
Hooks.on("updateItem", (item, changes) => {
    if (item.type !== "facility") return;
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
    document.querySelectorAll(`li.facility[data-item-id="${item.id}"].bastion-augmented`)
        .forEach(li => li.classList.remove("bastion-augmented"));
});

// When a new facility item is created (e.g. instant build or promotion from groupFacilities),
// createItem does NOT fire updateActor, so augmented guards are never cleared.
// Svelte may recycle an existing <li> node (updating data-item-id) while keeping the old
// bastion-augmented class, causing the new facility to show stale data from the previous item.
// Clearing all augmented classes forces a fresh re-augmentation for every facility in the tab.
Hooks.on("createItem", (item) => {
    if (item.type !== "facility") return;
    document.querySelectorAll('section[data-tab="bastion"], div[data-tab="bastion"], [data-tab-contents-for="bastion"]').forEach(tab => {
        tab.querySelectorAll(".bastion-augmented").forEach(el => el.classList.remove("bastion-augmented"));
    });
});

/**
 * CONFIGURATION CLASSES
 */
class BastionSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "bastion-settings-app", tag: "form",
        window: { title: "Bastion Manager Configuration", resizable: true },
        position: { width: 560, height: 620 }, classes: ["bastion-app"],
        form: { handler: BastionSettingsApp.processForm, closeOnSubmit: true }
    };
    static PARTS = { main: { template: "modules/dnd-2024-bastion-manager/templates/bastion-settings.hbs" } };

    async _prepareContext() {
        const g = (k) => game.settings.get(MODULE_ID, k);
        const allowedActorTypes = g("allowedActorTypes") || ["character"];
        return {
            ignoreConstructionCosts: g("ignoreConstructionCosts"),
            ignoreFacilityPrereqs:   g("ignoreFacilityPrereqs"),
            specialFacilitiesBuildTime: g("specialFacilitiesBuildTime"),
            specialFacilitiesGoldCost:  g("specialFacilitiesGoldCost"),
            disableNeglect:          g("disableNeglect"),
            disableSpecialCap:       g("disableSpecialCap"),
            disableDuplicateLimit:   g("disableDuplicateLimit"),
            advancePermission:       g("advancePermission"),
            groupInheritsFacilities: g("groupInheritsFacilities"),
            unifyCombinedTurns:      g("unifyCombinedTurns"),
            globalTurnCount:         g("globalTurnCount"),
            calculationMode:         g("calculationMode"),
            daysPerTurn:             g("daysPerTurn"),
            syncDaysPerTurn:         g("syncDaysPerTurn"),
            scaleWeekToTurnLength:   g("scaleWeekToTurnLength"),
            advanceWorldTime:        g("advanceWorldTime"),
            calendarDrivenTurns:     g("calendarDrivenTurns"),
            recruitMode:             g("recruitMode"),
            promptAllEvents:         g("promptAllEvents"),
            manualEventSelection:    g("manualEventSelection"),
            aidUsesDefenderRules:    g("aidUsesDefenderRules"),
            nameHirelings:           g("nameHirelings"),
            nameDefenders:           g("nameDefenders"),
            createActorsForHirelings: g("createActorsForHirelings"),
            createActorsForDefenders: g("createActorsForDefenders"),
            menagerieArmoryBonus:    g("menagerieArmoryBonus"),
            menagerieDiceMode:       g("menagerieDiceMode"),
            menagerieCrDiceTable:    g("menagerieCrDiceTable"),
            reliquaryOneTalismanLimit: g("reliquaryOneTalismanLimit"),
            allowNpc:       allowedActorTypes.includes("npc"),
            allowVehicle:   allowedActorTypes.includes("vehicle"),
            allowContainer: allowedActorTypes.includes("container"),
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const el = this.element;

        // Tab switching
        const panels = el.querySelectorAll(".settings-panel");
        el.querySelectorAll(".settings-tab-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                el.querySelectorAll(".settings-tab-btn").forEach(b => {
                    b.classList.remove("active");
                    b.style.background = "rgba(0,0,0,0.1)";
                    b.style.color = "#aaa";
                    b.style.borderColor = "#555";
                });
                btn.classList.add("active");
                btn.style.background = "rgba(255,255,255,0.1)";
                btn.style.color = "#e8e4d9";
                btn.style.borderColor = "#666";
                panels.forEach(p => { p.style.display = p.dataset.tab === btn.dataset.tab ? "" : "none"; });
            });
        });

        // Sub-app launchers
        el.querySelector("[data-action='openConstructionConfig']")?.addEventListener("click", () => new ConstructionConfigApp().render(true));
        el.querySelector("[data-action='openFacilityExclusion']")?.addEventListener("click", () => new FacilityExclusionApp().render(true));
        el.querySelector("[data-action='openHirelingTemplates']")?.addEventListener("click", () => new HirelingTemplatesApp().render(true));

        // Reset to defaults
        el.querySelector("[data-action='reset-defaults']")?.addEventListener("click", async () => {
            const confirmed = await DialogV2.confirm({ window: { title: "Reset Settings" }, content: "<p>Reset all Bastion Manager settings to their defaults?</p>" });
            if (!confirmed) return;
            const keys = ["ignoreConstructionCosts","ignoreFacilityPrereqs","specialFacilitiesBuildTime","specialFacilitiesGoldCost","disableNeglect","disableSpecialCap","disableDuplicateLimit","advancePermission","groupInheritsFacilities","unifyCombinedTurns","globalTurnCount","calculationMode","daysPerTurn","syncDaysPerTurn","scaleWeekToTurnLength","advanceWorldTime","calendarDrivenTurns","recruitMode","promptAllEvents","manualEventSelection","aidUsesDefenderRules","nameHirelings","nameDefenders","createActorsForHirelings","createActorsForDefenders","hirelingActorTemplates","menagerieArmoryBonus","menagerieDiceMode","menagerieCrDiceTable","reliquaryOneTalismanLimit","allowedActorTypes"];
            await Promise.all(keys.map(k => game.settings.set(MODULE_ID, k, game.settings.settings.get(`${MODULE_ID}.${k}`)?.default)));
            this.render();
        });

        // Cancel button
        el.querySelector("[data-action='close-settings']")?.addEventListener("click", () => this.close());
    }

    static async processForm(event, form, formData) {
        const d = formData.object;
        const s = (k, v) => game.settings.set(MODULE_ID, k, v);
        const prevBuildTime = game.settings.get(MODULE_ID, "specialFacilitiesBuildTime");
        const allowedActorTypes = ["character"];
        if (d.allowNpc)       allowedActorTypes.push("npc");
        if (d.allowVehicle)   allowedActorTypes.push("vehicle");
        if (d.allowContainer) allowedActorTypes.push("container");
        await Promise.all([
            s("ignoreConstructionCosts",  d.ignoreConstructionCosts  ?? false),
            s("ignoreFacilityPrereqs",    d.ignoreFacilityPrereqs    ?? false),
            s("specialFacilitiesBuildTime", d.specialFacilitiesBuildTime ?? false),
            s("disableNeglect",           d.disableNeglect           ?? false),
            s("disableSpecialCap",        d.disableSpecialCap        ?? false),
            s("disableDuplicateLimit",    d.disableDuplicateLimit    ?? false),
            s("advancePermission",        Number(d.advancePermission)),
            s("groupInheritsFacilities",  d.groupInheritsFacilities  ?? false),
            s("unifyCombinedTurns",       d.unifyCombinedTurns       ?? false),
            s("globalTurnCount",          Number(d.globalTurnCount)  || 0),
            s("calculationMode",          d.calculationMode),
            s("daysPerTurn",              Number(d.daysPerTurn)      || 7),
            s("syncDaysPerTurn",          d.syncDaysPerTurn          ?? false),
            s("scaleWeekToTurnLength",    d.scaleWeekToTurnLength    ?? false),
            s("advanceWorldTime",         d.advanceWorldTime         ?? false),
            s("calendarDrivenTurns",      d.calendarDrivenTurns      ?? false),
            s("recruitMode",              d.recruitMode),
            s("promptAllEvents",          d.promptAllEvents          ?? false),
            s("manualEventSelection",     d.manualEventSelection     ?? false),
            s("aidUsesDefenderRules",     d.aidUsesDefenderRules     ?? false),
            s("nameHirelings",            d.nameHirelings            ?? true),
            s("nameDefenders",            d.nameDefenders            ?? true),
            s("createActorsForHirelings", d.createActorsForHirelings ?? false),
            s("createActorsForDefenders", d.createActorsForDefenders ?? false),
            s("menagerieArmoryBonus",     d.menagerieArmoryBonus     ?? false),
            s("menagerieDiceMode",        d.menagerieDiceMode),
            s("menagerieCrDiceTable",     d.menagerieCrDiceTable),
            s("reliquaryOneTalismanLimit", d.reliquaryOneTalismanLimit ?? false),
            s("specialFacilitiesGoldCost",  d.specialFacilitiesGoldCost  ?? true),
            s("allowedActorTypes",          allowedActorTypes),
        ]);
        if (prevBuildTime && !(d.specialFacilitiesBuildTime ?? false)) {
            await BastionManager._completeAllSpecialConstruction();
        }
        ui.notifications.info("Bastion Manager | Settings saved.");
    }
}

class BastionPlayerSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "bastion-player-settings-app", tag: "form",
        window: { title: "Bastion Manager — My Preferences", resizable: false },
        position: { width: 420, height: "auto" }, classes: ["bastion-app"],
        form: { handler: BastionPlayerSettingsApp.processForm, closeOnSubmit: true }
    };
    static PARTS = { main: { template: "modules/dnd-2024-bastion-manager/templates/bastion-player-settings.hbs" } };

    async _prepareContext() {
        const g = (k) => game.settings.get(MODULE_ID, k);
        const hirelingNamesRequired = g("nameHirelings");
        const defenderNamesRequired = g("nameDefenders");
        return {
            promptHirelingNames:    g("promptHirelingNames"),
            promptDefenderNames:    g("promptDefenderNames"),
            autoNameHirelings:      hirelingNamesRequired ? true : g("autoNameHirelings"),
            autoNameDefenders:      defenderNamesRequired ? true : g("autoNameDefenders"),
            hirelingNamesRequired,
            defenderNamesRequired,
        };
    }

    static async processForm(event, form, formData) {
        const d = formData.object;
        const s = (k, v) => game.settings.set(MODULE_ID, k, v);
        const hirelingNamesRequired = game.settings.get(MODULE_ID, "nameHirelings");
        const defenderNamesRequired = game.settings.get(MODULE_ID, "nameDefenders");
        await Promise.all([
            s("promptHirelingNames", d.promptHirelingNames ?? true),
            s("promptDefenderNames", d.promptDefenderNames ?? true),
            s("autoNameHirelings", hirelingNamesRequired ? true : (d.autoNameHirelings ?? true)),
            s("autoNameDefenders", defenderNamesRequired ? true : (d.autoNameDefenders ?? true)),
        ]);
        ui.notifications.info("Bastion Manager | Preferences saved.");
    }
}

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
            if (typeof source === "string") source = source.replace(/,?\s*(?:pp?g?|page)\.?\s*\d+.*/i, "").trim() || "Unknown";
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

class HirelingTemplatesApp extends HandlebarsApplicationMixin(ApplicationV2) {
    #rows = null;

    static DEFAULT_OPTIONS = {
        id: "hireling-templates-app", tag: "form",
        window: { title: "Hireling Actor Templates", resizable: false },
        position: { width: 560, height: "auto" }, classes: ["bastion-app"],
        form: { handler: HirelingTemplatesApp.processForm, closeOnSubmit: true }
    };

    static PARTS = {
        main: { template: "modules/dnd-2024-bastion-manager/templates/hireling-templates.hbs" }
    };

    _getAvailableNames(index) {
        return [...index]
            .filter(e => e.folder === STAFF_FOLDER_ID && e.name !== "Defender")
            .map(e => e.name)
            .sort();
    }

    async _prepareContext() {
        const actorsPack = game.packs.get(`${MODULE_ID}.bastion-facility-actors`);
        await actorsPack?.getIndex();
        const availableNames = actorsPack ? this._getAvailableNames(actorsPack.index) : ["Hireling"];

        const facilitiesPack = game.packs.get(`${MODULE_ID}.bastion-facilities`);
        await facilitiesPack?.getIndex();
        const facilityNames = facilitiesPack
            ? [...facilitiesPack.index].map(e => e.name).sort()
            : [];

        if (this.#rows === null) {
            const stored = JSON.parse(game.settings.get(MODULE_ID, "hirelingActorTemplates") || "{}");
            this.#rows = Object.entries(stored).map(([facility, template]) => ({ facility, template }));
        }

        return {
            noTemplates: availableNames.length === 0,
            noFacilities: facilityNames.length === 0,
            availableNames,
            facilityNames,
            rows: this.#rows.map(row => ({
                facilityOptions: facilityNames.map(name => ({ name, selected: name === row.facility })),
                options: availableNames.map(name => ({ name, selected: name === row.template }))
            }))
        };
    }

    _syncFormToRows() {
        this.#rows = this.#rows.map((_, i) => ({
            facility: this.element.querySelector(`[name="facility_${i}"]`)?.value ?? "",
            template: this.element.querySelector(`[name="template_${i}"]`)?.value ?? "Hireling"
        }));
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const el = this.element;

        el.querySelectorAll(".remove-row").forEach((btn, i) => {
            btn.addEventListener("click", () => {
                this._syncFormToRows();
                this.#rows.splice(i, 1);
                this.render();
            });
        });

        el.querySelector("#add-template-row")?.addEventListener("click", () => {
            this._syncFormToRows();
            this.#rows.push({ facility: context.facilityNames?.[0] ?? "", template: context.availableNames[0] ?? "Hireling" });
            this.render();
        });

        el.querySelector("[data-action='close-dialog']")?.addEventListener("click", () => this.close());
    }

    static async processForm(event, form, formData) {
        const d = formData.object;
        const result = {};
        let i = 0;
        while (`facility_${i}` in d) {
            const facility = (d[`facility_${i}`] || "").trim();
            const template = d[`template_${i}`] || "Hireling";
            if (facility) result[facility] = template;
            i++;
        }
        await game.settings.set(MODULE_ID, "hirelingActorTemplates", JSON.stringify(result));
        ui.notifications.info("Bastion Manager | Hireling templates saved.");
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
 * GROUP ACTOR BASTION OVERVIEW TAB
 * Injects a chess-rook tab into group sheets showing all member bastions in a scannable summary.
 */
const renderGroupBastionContent = (section, groupActor) => {
    section.innerHTML = '';

    const turnCount = groupActor.getFlag(MODULE_ID, "turnCount") ||
                      game.settings.get(MODULE_ID, "globalTurnCount") || 0;
    const bastionName = groupActor.system?.bastion?.name || groupActor.name;

    // Header: combined name, turn count, advance button
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; background: rgba(15,12,8,0.85); border: 1px solid var(--dnd5e-color-gold, #c9a227); border-radius: 6px; margin-bottom: 8px; flex-shrink: 0; gap: 8px;';
    header.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden;">
            <i class="fa-solid fa-chess-rook" style="color: var(--dnd5e-color-gold, #c9a227); font-size: 1.05em; flex-shrink: 0;"></i>
            <span style="font-size: 0.93em; font-weight: bold; color: #e8e4d9; font-family: var(--dnd5e-font-modesto, serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${bastionName}</span>
            <span style="font-size: 0.73em; color: var(--dnd5e-color-gold, #c9a227); white-space: nowrap; flex-shrink: 0;">
                <i class="fa-solid fa-rotate" style="margin-right:2px;"></i>Turn ${turnCount}
            </span>
        </div>
        <button type="button" class="bastion-group-advance-btn" style="height: 23px; padding: 0 8px; font-size: 0.76em; cursor: pointer; background: rgba(201,162,39,0.2); border: 1px solid var(--dnd5e-color-gold, #c9a227); border-radius: 4px; color: #e8e4d9; white-space: nowrap; flex-shrink: 0;">
            <i class="fa-solid fa-play"></i> Advance Turn
        </button>
    `;
    section.appendChild(header);

    header.querySelector('.bastion-group-advance-btn').addEventListener('click', (ev) => {
        ev.preventDefault();
        BastionManager.onAdvanceGlobalTurn.call({ actor: groupActor, element: section }, ev, ev.currentTarget);
    });

    // Gather members that have facility items
    // Note: use documentName check instead of instanceof Actor — instanceof fails across ES module scopes
    const members = Array.from(groupActor.system?.members ?? [])
        .map(m => m.actor)
        .filter(a => !!a && a.documentName === "Actor" && a.items?.find(i => i.type === "facility"));

    if (members.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align: center; padding: 24px 16px; color: rgba(232,228,217,0.45); font-style: italic; font-size: 0.88em;';
        empty.innerHTML = '<i class="fa-solid fa-chess-rook" style="display:block; font-size:2em; margin-bottom:8px; opacity:0.25;"></i>No party members have established bastions.';
        section.appendChild(empty);
        return;
    }

    for (const member of members) section.appendChild(_buildGroupMemberBastionCard(member));
};

const _buildGroupMemberBastionCard = (memberActor) => {
    const facilities = memberActor.items.filter(i => i.type === "facility");
    const bastionName = memberActor.system?.bastion?.name || `${memberActor.name}'s Bastion`;
    const memberTurnCount = memberActor.getFlag(MODULE_ID, "turnCount") || 0;
    const isReady = memberActor.getFlag(MODULE_ID, "isReady") || false;

    const card = document.createElement('div');
    card.className = 'bastion-group-member-card';
    card.style.cssText = 'margin-bottom: 8px; border: 1px solid rgba(201,162,39,0.28); border-radius: 5px; overflow: hidden;';

    const memberHeader = document.createElement('div');
    memberHeader.style.cssText = 'display: flex; align-items: center; gap: 7px; padding: 6px 9px; background: rgba(15,12,8,0.7); cursor: pointer; user-select: none;';
    const safeLabel = (memberActor.name || '').replace(/"/g, '&quot;');
    memberHeader.innerHTML = `
        <img src="${memberActor.img}" width="21" height="21" style="border-radius: 50%; border: 1px solid rgba(201,162,39,0.45); object-fit: cover; flex-shrink: 0;">
        <span style="font-weight: bold; font-size: 0.87em; color: #e8e4d9; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${memberActor.name}</span>
        <span style="font-size: 0.7em; color: rgba(232,228,217,0.45); white-space: nowrap; flex-shrink: 0; max-width: 110px; overflow: hidden; text-overflow: ellipsis;">${bastionName}</span>
        <span style="font-size: 0.68em; color: var(--dnd5e-color-gold, #c9a227); white-space: nowrap; flex-shrink: 0; margin-left: 4px;">
            <i class="fa-solid fa-rotate" style="margin-right:1px;"></i>${memberTurnCount}
        </span>
        ${isReady ? '<i class="fa-solid fa-circle-check" style="color:#4caf50; font-size:0.72em; flex-shrink:0;" title="Ready to advance"></i>' : ''}
        <button type="button" class="bastion-open-member-btn" title="Open ${safeLabel}'s Bastion Manager" style="width: auto; height: 18px; padding: 0 5px; font-size: 0.67em; cursor: pointer; border: 1px solid rgba(201,162,39,0.32); background: rgba(201,162,39,0.1); border-radius: 3px; color: #e8e4d9; flex-shrink: 0;">
            <i class="fa-solid fa-gauge-high"></i>
        </button>
        <i class="bastion-collapse-icon fa-solid fa-chevron-down" style="font-size: 0.58em; opacity: 0.42; margin-left: 2px; transition: transform 0.15s; flex-shrink: 0;"></i>
    `;

    const facilityBody = document.createElement('div');
    facilityBody.style.cssText = 'background: rgba(0,0,0,0.1);';

    // Special facilities first, then basics, both sorted alphabetically
    const sorted = [...facilities].sort((a, b) => {
        const aBasic = a.system?.type?.value === "basic" ? 1 : 0;
        const bBasic = b.system?.type?.value === "basic" ? 1 : 0;
        return aBasic - bBasic || a.name.localeCompare(b.name);
    });

    for (const facility of sorted) {
        const fFlags = facility.flags?.[MODULE_ID] || {};
        const isUpgrading = (fFlags.upgradeTurns || 0) > 0;
        const isDamaged = !!fFlags.isDamaged;
        const facSize = fFlags.size || '';
        const order = fFlags.order || 'Maintain';
        const isBasic = facility.system?.type?.value === "basic";
        const progress = fFlags.progress || 0;

        let statusHtml;
        if (isDamaged) {
            const repProg = fFlags.repairProgress || 0, repTotal = fFlags.repairTurns || 0;
            statusHtml = `<span style="color:#ef9a9a; font-size:0.78em; white-space:nowrap;"><i class="fa-solid fa-burst"></i> Damaged${repTotal > 0 ? ` (${repProg}/${repTotal})` : ''}</span>`;
        } else if (isUpgrading) {
            const upProg = fFlags.upgradeProgress || 0, upTotal = fFlags.upgradeTurns || 1;
            const label = fFlags.size ? 'Enlarging' : 'Building';
            statusHtml = `<span style="color:var(--dnd5e-color-gold, #c9a227); font-size:0.78em; white-space:nowrap;"><i class="fa-solid fa-hard-hat"></i> ${label} ${upProg}/${upTotal}</span>`;
        } else if (progress > 0) {
            const maxT = fFlags.maxCraftTurns || 0;
            statusHtml = `<span style="color:#82cfff; font-size:0.78em; white-space:nowrap;"><i class="fa-solid fa-hourglass-half"></i> ${order.split(':')[0].trim()} ${progress}${maxT > 0 ? `/${maxT}` : ''}</span>`;
        } else {
            statusHtml = `<span style="color:rgba(232,228,217,0.5); font-size:0.78em; white-space:nowrap;">${order.split(':')[0].trim()}</span>`;
        }

        const row = document.createElement('div');
        row.style.cssText = `display: flex; align-items: center; gap: 6px; padding: 4px 9px; border-top: 1px solid rgba(255,255,255,0.04); font-size: 0.81em; background: ${isDamaged ? 'rgba(230,81,0,0.07)' : 'transparent'};`;
        row.innerHTML = `
            <img src="${facility.img}" width="17" height="17" style="border-radius: 2px; border: none; flex-shrink: 0; opacity: ${isDamaged ? 0.45 : 1};">
            <span style="flex: 1; color: ${isDamaged ? '#ef9a9a' : '#e8e4d9'}; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${facility.name}${facSize ? ` <span style="opacity:0.4; font-size:0.85em;">(${facSize})</span>` : ''}${isBasic ? ' <span style="opacity:0.3; font-size:0.78em;">·b</span>' : ''}
            </span>
            ${statusHtml}
        `;
        facilityBody.appendChild(row);
    }

    card.appendChild(memberHeader);
    card.appendChild(facilityBody);

    // Collapsible toggle
    let collapsed = false;
    memberHeader.addEventListener('click', (ev) => {
        if (ev.target.closest('.bastion-open-member-btn')) return;
        collapsed = !collapsed;
        facilityBody.style.display = collapsed ? 'none' : '';
        const icon = memberHeader.querySelector('.bastion-collapse-icon');
        if (icon) icon.style.transform = collapsed ? 'rotate(-90deg)' : '';
    });

    memberHeader.querySelector('.bastion-open-member-btn').addEventListener('click', (ev) => {
        ev.stopPropagation();
        _openBastionManager(memberActor, ev.currentTarget);
    });

    return card;
};

const _injectGroupBastionTab = (app) => {
    const element = app.element;
    if (!element) return;
    const groupActor = app.document;
    if (!groupActor || groupActor.type !== "group") return;

    // Inject nav tab (sidebar tabs use icon-only <a> elements)
    const navTabs = element.querySelector('nav.tabs[data-group="primary"]');
    if (navTabs && !navTabs.querySelector('[data-tab="bastion"]')) {
        const tabItem = document.createElement('a');
        tabItem.className = 'item control';
        tabItem.dataset.action = 'tab';
        tabItem.dataset.group = 'primary';
        tabItem.dataset.tab = 'bastion';
        tabItem.setAttribute('aria-label', 'Bastion');
        tabItem.setAttribute('data-tooltip', '');  // empty, matching native sidebar-tabs pattern
        tabItem.innerHTML = '<i class="fa-solid fa-chess-rook" inert></i>';
        navTabs.appendChild(tabItem);
    }

    // Inject (or re-render) the content section inside the same container as other tabs
    const membersSection = element.querySelector('[data-group="primary"][data-tab="members"]');
    const contentContainer = membersSection?.parentElement;
    if (!contentContainer) return;

    let bastionSection = element.querySelector('[data-group="primary"][data-tab="bastion"]');
    if (!bastionSection) {
        bastionSection = document.createElement('section');
        bastionSection.dataset.group = 'primary';
        bastionSection.dataset.tab = 'bastion';
        bastionSection.dataset.bastionGroupOverview = 'true';
        bastionSection.className = 'tab bastion-group-tab';
        bastionSection.style.cssText = 'display: flex; flex-direction: column; padding: 8px; overflow-y: auto;';
        contentContainer.appendChild(bastionSection);
    }

    renderGroupBastionContent(bastionSection, groupActor);
};

Hooks.on("renderGroupActorSheet", (app) => _injectGroupBastionTab(app));

// Wire up Pay Army buttons embedded in bastion turn summary chat messages
Hooks.on("renderChatMessageHTML", (message, html) => {
    html.querySelectorAll('[data-action="theaterAction"]').forEach(btn => {
        btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            const actor = game.actors.get(btn.dataset.actorId);
            if (!actor) return ui.notifications.warn("Could not find the associated actor.");
            BastionManager.onTheaterAction.call({ actor, render: () => {} }, ev, btn);
        });
    });

    html.querySelectorAll(".theater-performance-check-btn").forEach(btn => {
        btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            const character = game.user.character;
            if (!character) return ui.notifications.warn("You have no assigned character to roll for.");
            await character.rollSkill("prf");
        });
    });

    html.querySelectorAll(".bastion-pay-army-btn").forEach(btn => {
        btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            const actorId = btn.dataset.actorId;
            const cost = parseInt(btn.dataset.cost || "0");
            const period = btn.dataset.period || "daily";
            const actor = game.actors.get(actorId);
            if (!actor) return ui.notifications.warn("Could not find the associated actor.");
            if (!actor.isOwner) return ui.notifications.warn("You do not own this actor.");
            if (!cost || cost <= 0) return;
            const currentGP = Number(actor.system.currency?.gp || 0);
            if (currentGP < cost) return ui.notifications.warn(`Insufficient gold. Need ${cost} GP but only have ${currentGP} GP.`);
            const label = period === "weekly" ? "weekly (7 days)" : "daily";
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: "War Room: Pay Army Upkeep", icon: "fa-solid fa-coins" },
                content: `<p>Pay <b>${cost} GP</b> ${label} army upkeep? You currently have <b>${currentGP} GP</b>.</p>`,
                yes: { label: `Pay ${cost} GP` },
                no: { label: "Cancel" },
                rejectClose: false
            });
            if (!confirmed) return;
            await actor.update({ "system.currency.gp": currentGP - cost });
            ui.notifications.info(`Paid ${cost} GP ${label} army upkeep. Remaining GP: ${currentGP - cost}.`);
        });
    });
});

// Re-render the group bastion overview when a member actor's facility flags change
Hooks.on("updateActor", (actor, changes) => {
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
    if (_isBastionEligible(actor) && actor.type !== "group") {
        for (const app of foundry.applications.instances.values()) {
            if (app.constructor.name !== "GroupActorSheet") continue;
            if (!app.document?.system?.members?.some(m => (m.actor?.id || m.id) === actor.id)) continue;
            const section = app.element?.querySelector('[data-bastion-group-overview="true"]');
            if (section) renderGroupBastionContent(section, app.document);
        }
    }
});

// Re-render when a member's facility item flags change
Hooks.on("updateItem", (item, changes) => {
    if (item.type !== "facility") return;
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
    const memberActor = item.parent;
    if (!memberActor) return;
    for (const app of foundry.applications.instances.values()) {
        if (app.constructor.name !== "GroupActorSheet") continue;
        if (!app.document?.system?.members?.some(m => (m.actor?.id || m.id) === memberActor.id)) continue;
        const section = app.element?.querySelector('[data-bastion-group-overview="true"]');
        if (section) renderGroupBastionContent(section, app.document);
    }
});

Hooks.on("deleteItem", async (item) => {
    if (item.type !== "facility" || !item.isEmbedded) return;
    const toDelete = game.actors
        .filter(a => a.getFlag(MODULE_ID, "facilityItemId") === item.id)
        .map(a => a.id);
    if (toDelete.length) await Actor.deleteDocuments(toDelete);
});

// deleteItem does not fire for embedded items when the parent actor is cascade-deleted,
// so we clean up linked hireling/defender world actors here instead.
Hooks.on("deleteActor", async (actor) => {
    const facilityIds = new Set(actor.items.filter(i => i.type === "facility").map(i => i.id));
    if (!facilityIds.size) return;
    const toDelete = game.actors
        .filter(a => facilityIds.has(a.getFlag(MODULE_ID, "facilityItemId")))
        .map(a => a.id);
    if (toDelete.length) await Actor.deleteDocuments(toDelete);
});

/**
 * HEADER CONTROLS
 * Add a 3-dot menu option to open the manager directly for any actor sheet.
 */
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const actor = app.document;
    if (!(actor instanceof Actor) || !_isBastionEligible(actor)) return;
    controls.unshift({ label: "Bastion Manager", icon: "fa-solid fa-chess-rook", action: "openBastionManager" });
    if (!app.options.actions) app.options.actions = {};
    app.options.actions.openBastionManager = () => _openBastionManager(actor, app.element);
});

// Header hook for legacy Actor Sheets (V1/V2 backward compatibility)
Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
    buttons.unshift({
        label: "Bastion", class: "bastion-header-btn", icon: "fa-solid fa-chess-rook",
        onclick: () => _openBastionManager(app.actor, app.element?.[0] || app.element)
    });
});

/**
 * When calendar-driven mode is active, watch world time and auto-resolve
 * the pending bastion turn once enough time has elapsed since orders were issued.
 */
Hooks.on("updateWorldTime", async (worldTime) => {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "calendarDrivenTurns")) return;
    const issuedAt = game.settings.get(MODULE_ID, "ordersIssuedAt") || 0;
    if (!issuedAt) return;
    if (worldTime < issuedAt + effectiveDaysPerTurn() * 86400) return;
    await BastionManager.resolveCalendarDrivenTurn();
});

/**
 * Inject live calendar info into the syncDaysPerTurn setting hint whenever
 * the settings dialog opens.
 */
Hooks.on("renderSettingsConfig", (app, html) => {
    const root = html instanceof HTMLElement ? html : html[0];
    if (!root) return;

    // --- Live calendar name in syncDaysPerTurn hint ---
    const syncInput = root.querySelector(`[name="${MODULE_ID}.syncDaysPerTurn"]`);
    if (syncInput) {
        const hint = syncInput.closest(".form-group")?.querySelector(".hint, .notes");
        if (hint) {
            const calName = getActiveCalendarName();
            const weekLen = getCalendarWeekLength();
            hint.textContent = `Use the active calendar's week length as the Bastion Turn duration everywhere — crafting times, construction display, and world time advancement. Active calendar: ${calName} (${weekLen}-day week).`;
        }
    }

    // --- Dependent setting dimming ---
    const setGroupDisabled = (inputEl, disabled) => {
        if (!inputEl) return;
        const group = inputEl.closest(".form-group");
        if (!group) return;
        inputEl.disabled = disabled;
        group.style.opacity = disabled ? "0.45" : "";
        group.style.pointerEvents = disabled ? "none" : "";
    };

    // daysPerTurn is dimmed when syncDaysPerTurn is on
    const daysInput = root.querySelector(`[name="${MODULE_ID}.daysPerTurn"]`);
    const syncCheckbox = root.querySelector(`[name="${MODULE_ID}.syncDaysPerTurn"]`);
    if (daysInput && syncCheckbox) {
        setGroupDisabled(daysInput, syncCheckbox.checked);
        syncCheckbox.addEventListener("change", () => setGroupDisabled(daysInput, syncCheckbox.checked));
    }

    // advanceWorldTime is dimmed when calendarDrivenTurns is on
    const advanceInput = root.querySelector(`[name="${MODULE_ID}.advanceWorldTime"]`);
    const calDrivenCheckbox = root.querySelector(`[name="${MODULE_ID}.calendarDrivenTurns"]`);
    if (advanceInput && calDrivenCheckbox) {
        setGroupDisabled(advanceInput, calDrivenCheckbox.checked);
        calDrivenCheckbox.addEventListener("change", () => setGroupDisabled(advanceInput, calDrivenCheckbox.checked));
    }
});

/**
 * TIDY 5E SHEETS INTEGRATION
 * The existing MutationObserver already catches Tidy's bastion tab via the
 * [data-tab-contents-for="bastion"] selector. No separate tab registration needed.
 */

// ─── ACTOR DIRECTORY CONTEXT MENUS ────────────────────────────────────────────

const SIZE_LABELS = { tiny: "Tiny", sm: "Small", med: "Medium", lg: "Large", huge: "Huge", grg: "Gargantuan" };

function _actorIdFromEntry(li) {
    return li?.closest?.("[data-entry-id]")?.dataset?.entryId ?? li?.dataset?.entryId ?? null;
}

function _bastionFacilitiesNamed(namePart) {
    const results = [];
    for (const actor of game.actors) {
        if (!_isBastionEligible(actor)) continue;
        for (const item of actor.items) {
            if (item.type !== "facility" || !item.name.includes(namePart)) continue;
            results.push({ actor, facility: item, isFlag: false });
        }
        for (const f of (actor.getFlag(MODULE_ID, "groupFacilities") || [])) {
            if (!f.name?.includes(namePart)) continue;
            const ffl = f.flags?.[MODULE_ID] || {};
            if ((ffl.upgradeTurns || 0) > 0 && !ffl.size) continue; // still under new construction
            results.push({ actor, facility: f, isFlag: true });
        }
    }
    return results;
}

async function _addCreatureToMenagerie(creature) {
    const menageries = _bastionFacilitiesNamed("Menagerie");
    if (!menageries.length) return ui.notifications.warn("No established Menagerie found in any bastion.");

    const creatureType  = creature.system?.details?.type?.value || "";
    const size          = creature.system?.traits?.size || "med";
    const cr            = creature.system?.details?.cr;
    const slotCost      = BastionManager._getMenagerieSlotCost(size);
    const typeLabel     = creatureType ? creatureType.charAt(0).toUpperCase() + creatureType.slice(1) : "Unknown";
    const sizeLabel     = SIZE_LABELS[size] || size;
    const crLabel       = cr != null ? ` · CR ${cr}` : "";
    const slotLabel     = slotCost === 1 ? "1 slot" : `${slotCost} slots`;
    const isSuited      = ["beast", "monstrosity"].includes(creatureType);

    const enrichedFacs = menageries.map((m, i) => {
        const creatures = m.isFlag
            ? (m.facility.flags?.[MODULE_ID]?.menagerieCreatures || [])
            : (m.facility.getFlag(MODULE_ID, "menagerieCreatures") || []);
        const usedSlots = creatures.reduce((s, c) => s + (c.slots ?? 0.25), 0);
        const free = +(4 - usedSlots).toFixed(2);
        const full = free < slotCost;
        return { ...m, usedSlots, free, full, index: i };
    });

    const selectOpts = enrichedFacs.map(m =>
        `<option value="${m.index}"${m.full ? " disabled" : ""}>${m.actor.name} — ${m.facility.name} (${m.free} slots free)${m.full ? " — FULL" : ""}</option>`
    ).join("");

    const typeNote = isSuited
        ? `<div style="margin:4px 0 8px; padding:4px 8px; font-size:0.87em; color:#4a7a3a; background:rgba(74,122,58,0.1); border:1px solid rgba(74,122,58,0.35); border-radius:3px;"><i class="fa-solid fa-circle-check" style="margin-right:5px;"></i>The Menagerie is well-suited to Beasts and Monstrosities.</div>`
        : `<div style="margin:4px 0 8px; padding:4px 8px; font-size:0.87em; color:#7a5a10; background:rgba(200,160,50,0.12); border:1px solid rgba(200,160,50,0.45); border-radius:3px; line-height:1.5;"><i class="fa-solid fa-triangle-exclamation" style="margin-right:5px; color:#c8a028;"></i>The Menagerie is typically suited to Beasts and Monstrosities. A <b>${typeLabel}</b> is an unusual resident — the rules place no hard restriction on creature type.</div>`;

    const content = `
        ${typeNote}
        <div class="form-group">
            <label>Creature:</label>
            <div style="font-size:0.9em;">${creature.name} (${typeLabel}, ${sizeLabel}${crLabel}) — costs ${slotLabel}</div>
        </div>
        <div class="form-group">
            <label>Target Menagerie:</label>
            <select name="facilityIdx" style="width:100%;">${selectOpts}</select>
        </div>
        <div class="form-group">
            <label>Nickname (optional):</label>
            <input type="text" name="nickname" placeholder="${creature.name}" style="width:100%;">
        </div>
        <div class="form-group" style="flex-direction:row; align-items:center; gap:6px;">
            <input type="checkbox" name="isDefender" id="bmCMIsDefender" checked>
            <label for="bmCMIsDefender" style="margin:0;">Count as Defender</label>
        </div>`;

    const result = await DialogV2.prompt({
        window: { title: `Add ${creature.name} to Menagerie`, icon: "fa-solid fa-paw" },
        content,
        ok: {
            label: "Add to Menagerie",
            callback: (ev, button) => ({
                facilityIdx: parseInt(button.form.elements.facilityIdx.value),
                nickname:    button.form.elements.nickname.value.trim(),
                isDefender:  button.form.elements.isDefender.checked
            })
        },
        rejectClose: false
    });
    if (!result) return;

    const chosen = enrichedFacs[result.facilityIdx];
    if (!chosen) return;
    if (chosen.full) return ui.notifications.warn(`${chosen.actor.name}'s Menagerie doesn't have enough space for ${creature.name}.`);

    const { actor, facility, isFlag } = chosen;
    const gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
    const creatures = Array.from(isFlag
        ? (facility.flags?.[MODULE_ID]?.menagerieCreatures || [])
        : (facility.getFlag(MODULE_ID, "menagerieCreatures") || []));

    // Re-verify capacity in case something changed since the dialog opened
    const used = creatures.reduce((s, c) => s + (c.slots ?? 0.25), 0);
    if (used + slotCost > 4) return ui.notifications.warn(`${actor.name}'s Menagerie is full (${+(4 - used).toFixed(2)} slots free, need ${slotCost}).`);

    creatures.push({ species: creature.name, nickname: result.nickname, slots: slotCost, isDefender: result.isDefender });
    const defNames = creatures.filter(c => c.isDefender).map(c => c.nickname || c.species);

    if (isFlag) {
        const fac = gf.find(f => f._id === facility._id);
        if (!fac) return;
        foundry.utils.setProperty(fac, `flags.${MODULE_ID}.menagerieCreatures`, creatures);
        foundry.utils.setProperty(fac, `flags.${MODULE_ID}.defenders`, { count: defNames.length, names: defNames });
        await actor.setFlag(MODULE_ID, "groupFacilities", gf);
    } else {
        await facility.setFlag(MODULE_ID, "menagerieCreatures", creatures);
        await facility.setFlag(MODULE_ID, "defenders", { count: defNames.length, names: defNames });
    }

    ui.notifications.info(`${creature.name} added to ${actor.name}'s Menagerie.`);
    const openMgr = Array.from(foundry.applications.instances.values()).find(a => a instanceof BastionManager && a.actor?.id === actor.id);
    if (openMgr) openMgr.render();
}

async function _addCreatureToStable(creature) {
    const stables = _bastionFacilitiesNamed("Stable");
    if (!stables.length) return ui.notifications.warn("No established Stable found in any bastion.");

    const size     = creature.system?.traits?.size || "lg";
    const slotCost = BastionManager._getMountSlotCost(size);
    const sizeLabel = SIZE_LABELS[size] || size;

    if (slotCost >= 999) {
        return ui.notifications.warn(`${creature.name} (${sizeLabel}) is too large to be housed in any Stable.`);
    }

    // Resolve used slots for each stable. stableAnimals stores { species, nickname } with no
    // cached slot cost, so look each animal up in game.actors; fall back to "lg" (1 slot) if
    // not found — conservative but safe for the typical all-Large-mount case.
    const _animalSlots = (animals) => {
        let used = 0;
        for (const a of animals) {
            const ac = game.actors.find(x => x.name === a.species);
            used += BastionManager._getMountSlotCost(ac?.system?.traits?.size || "lg");
        }
        return used;
    };

    const enrichedFacs = stables.map((m, i) => {
        const facFlagSize = m.isFlag
            ? (m.facility.flags?.[MODULE_ID]?.size || "Roomy")
            : (m.facility.getFlag(MODULE_ID, "size") || "Roomy");
        const maxSlots = facFlagSize === "Vast" ? 6 : 3;

        const animals = m.isFlag
            ? (m.facility.flags?.[MODULE_ID]?.stableAnimals || [])
            : (m.facility.getFlag(MODULE_ID, "stableAnimals") || []);

        const usedSlots = _animalSlots(animals);
        const free = +(maxSlots - usedSlots).toFixed(2);
        const full = free < slotCost;
        return { ...m, animals, usedSlots, maxSlots, free, full, index: i };
    });

    const slotLabel = slotCost === 1 ? "1 slot" : `${slotCost} slots`;
    const selectOpts = enrichedFacs.map(m =>
        `<option value="${m.index}"${m.full ? " disabled" : ""}>${m.actor.name} — ${m.facility.name} (${m.free}/${m.maxSlots} slots free)${m.full ? " — FULL" : ""}</option>`
    ).join("");

    const content = `
        <div class="form-group">
            <label>Beast:</label>
            <div style="font-size:0.9em;">${creature.name} (${sizeLabel}) — costs ${slotLabel}</div>
        </div>
        <div class="form-group">
            <label>Target Stable:</label>
            <select name="facilityIdx" style="width:100%;">${selectOpts}</select>
        </div>
        <div class="form-group">
            <label>Nickname (optional):</label>
            <input type="text" name="nickname" placeholder="${creature.name}" style="width:100%;">
        </div>`;

    const result = await DialogV2.prompt({
        window: { title: `Add ${creature.name} to Stable`, icon: "fa-solid fa-horse" },
        content,
        ok: {
            label: "Add to Stable",
            callback: (ev, button) => ({
                facilityIdx: parseInt(button.form.elements.facilityIdx.value),
                nickname:    button.form.elements.nickname.value.trim()
            })
        },
        rejectClose: false
    });
    if (!result) return;

    const chosen = enrichedFacs[result.facilityIdx];
    if (!chosen) return;
    if (chosen.full) return ui.notifications.warn(`${chosen.actor.name}'s Stable doesn't have enough space for ${creature.name} (need ${slotCost} slot(s), ${chosen.free} free).`);

    const { actor, facility, isFlag } = chosen;
    const gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
    const animals = Array.from(isFlag
        ? (facility.flags?.[MODULE_ID]?.stableAnimals || [])
        : (facility.getFlag(MODULE_ID, "stableAnimals") || []));

    // Re-verify capacity in case something changed since the dialog opened
    const usedNow = _animalSlots(animals);
    if (usedNow + slotCost > chosen.maxSlots) {
        return ui.notifications.warn(`${actor.name}'s Stable is full (${+(chosen.maxSlots - usedNow).toFixed(2)} slots free, need ${slotCost}).`);
    }

    animals.push({ species: creature.name, nickname: result.nickname });

    if (isFlag) {
        const fac = gf.find(f => f._id === facility._id);
        if (!fac) return;
        foundry.utils.setProperty(fac, `flags.${MODULE_ID}.stableAnimals`, animals);
        await actor.setFlag(MODULE_ID, "groupFacilities", gf);
    } else {
        await facility.setFlag(MODULE_ID, "stableAnimals", animals);
    }

    ui.notifications.info(`${creature.name} added to ${actor.name}'s Stable.`);
    const openMgr = Array.from(foundry.applications.instances.values()).find(a => a instanceof BastionManager && a.actor?.id === actor.id);
    if (openMgr) openMgr.render();
}

Hooks.on("getActorContextOptions", (app, entryOptions) => {
    if (!game.user?.isGM) return;

    entryOptions.push({
        label: "Add to Menagerie...",
        icon: "fa-solid fa-paw",
        visible: (li) => {
            const actor = game.actors.get(_actorIdFromEntry(li));
            if (!actor || actor.type !== "npc") return false;
            return _bastionFacilitiesNamed("Menagerie").length > 0;
        },
        onClick: (event, li) => {
            const actor = game.actors.get(_actorIdFromEntry(li));
            if (actor) _addCreatureToMenagerie(actor);
        }
    });

    entryOptions.push({
        label: "Add to Stable...",
        icon: "fa-solid fa-horse",
        visible: (li) => {
            const actor = game.actors.get(_actorIdFromEntry(li));
            if (!actor || actor.type !== "npc") return false;
            if (actor.system?.details?.type?.value !== "beast") return false;
            return _bastionFacilitiesNamed("Stable").length > 0;
        },
        onClick: (event, li) => {
            const actor = game.actors.get(_actorIdFromEntry(li));
            if (actor) _addCreatureToStable(actor);
        }
    });
});