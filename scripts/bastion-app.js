const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const BASTION_ORDERS = ["Maintain", "Craft", "Harvest", "Recruit", "Research", "Trade", "Empower"];

export class BastionManager extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(actor, options = {}) { super(options); this.actor = actor; }
    static DEFAULT_OPTIONS = {
        id: "bastion-manager", classes: ["bastion-app"], tag: "form",
        window: { title: "Bastion Management", icon: "fa-solid fa-chess-rook", resizable: true },
        position: { width: 450, height: "auto" },
        actions: { 
            buildFromDropdown: BastionManager.onBuildFromDropdown, 
            deleteFacility: BastionManager.onDeleteFacility, 
            upgradeFacility: BastionManager.onUpgradeFacility,
            maintainAll: BastionManager.onMaintainAll,
            advanceGlobalTurn: BastionManager.onAdvanceGlobalTurn
        }
    };
    static PARTS = { main: { template: "modules/dnd-2024-bastion-manager/templates/bastion-main.hbs" } };

    _getUnifiedFacilities() {
        let rawFacilities = [];
        this.actor.items.filter(item => item.type === "facility").forEach(item => { rawFacilities.push({ sourceDoc: item, isInherited: false, isFlag: false, name: item.name, id: item.id }); });
        if (this.actor.type === "group") {
            const flagFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
            flagFacilities.forEach(f => { rawFacilities.push({ sourceDoc: f, isInherited: false, isFlag: true, name: f.name, id: f._id }); });
        }
        if (this.actor.type === "group" && game.settings.get("dnd-2024-bastion-manager", "groupInheritsFacilities")) {
            const members = this.actor.system.members || [];
            for (const member of members) {
                const memberActor = member.actor || member; 
                if (memberActor && memberActor.items) {
                    memberActor.items.filter(item => item.type === "facility").forEach(item => { rawFacilities.push({ sourceDoc: item, isInherited: true, isFlag: false, name: item.name, ownerName: memberActor.name, id: item.id, memberActor: memberActor }); });
                }
            }
        }
        return rawFacilities;
    }

    async _prepareContext(options) {
        const globalTurnCount = game.settings.get("dnd-2024-bastion-manager", "globalTurnCount") || 0;
        const rawFacilities = this._getUnifiedFacilities();
        
        let totalDefenders = 0;
        let allDefenderNames = [];

        const facilities = rawFacilities.map(fac => {
            let currentOrder = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.order || "Maintain") : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "order") || "Maintain");
            let hirelingsArr = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.hirelings) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "hirelings"));
            let hirelingsDisplay = Array.isArray(hirelingsArr) ? hirelingsArr.join(", ") : "";

            let facDefenders = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.defenders || {count: 0, names: []}) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "defenders") || {count: 0, names: []});
            totalDefenders += facDefenders.count;
            if (facDefenders.names.length > 0) allDefenderNames.push(...facDefenders.names);

            let facSize = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.size || "Roomy") : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "size") || "Roomy");
            let facSubType = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.subType) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "subType"));

            let rawProps = fac.sourceDoc.system?.properties;
            let propArray = [];
            if (rawProps instanceof Set) propArray = Array.from(rawProps);
            else if (Array.isArray(rawProps)) propArray = rawProps;
            else if (typeof rawProps === "object" && rawProps !== null) propArray = Object.keys(rawProps).filter(k => rawProps[k]);

            const safeProps = propArray.map(p => String(p).toLowerCase());
            const availableOrders = ["Maintain"];
            const systemOrder = fac.sourceDoc.system?.order;

            if (systemOrder && typeof systemOrder === "string") {
                const formattedOrder = systemOrder.charAt(0).toUpperCase() + systemOrder.slice(1).toLowerCase();
                if (formattedOrder !== "Maintain") availableOrders.push(formattedOrder);
            }

            BASTION_ORDERS.forEach(order => {
                const lowerOrder = order.toLowerCase();
                if (order !== "Maintain" && safeProps.some(p => p.includes(lowerOrder)) && !availableOrders.includes(order)) availableOrders.push(order);
            });

            if (fac.name.includes("Garden") || fac.name.includes("Workshop")) availableOrders.push("Change Type");

            const safeOrder = availableOrders.includes(currentOrder) ? currentOrder : "Maintain";
            const hasOrders = availableOrders.length > 1;

            return {
                id: fac.id, name: fac.isInherited ? `${fac.name} (${fac.ownerName})` : fac.name,
                hirelings: hirelingsDisplay, defenderCount: facDefenders.count > 0 ? facDefenders.count : null,
                size: facSize, subType: facSubType,
                img: fac.sourceDoc.img, isInherited: fac.isInherited, isFlag: fac.isFlag, memberId: fac.memberActor?.id || null,
                itemName: fac.name,
                hasOrders: hasOrders,
                orderOptions: availableOrders.map(order => ({ value: order, label: order, selected: order === safeOrder }))
            };
        });

        let specialFacilities = [];
        let basicFacilities = [];
        const pack = game.packs.get("dnd-2024-bastion-manager.bastion-facilities");
        if (pack) {
            // Fetch full documents to ensure we have access to all system data
            const allDocs = await pack.getDocuments();
            const ignorePrereqs = game.settings.get("dnd-2024-bastion-manager", "ignoreFacilityPrereqs");
            
            let excludedSources = [];
            let excludedFacilities = [];
            try {
                excludedSources = game.settings.get("dnd-2024-bastion-manager", "excludedSourcesData") || [];
                excludedFacilities = game.settings.get("dnd-2024-bastion-manager", "excludedFacilitiesData") || [];
            } catch(e) {}
            
            const actorLevel = (this.actor.type === "character" || this.actor.type === "npc") ? (this.actor.system.details?.level || 1) : 1;

            for (const item of allDocs) {
                // Check exclusions
                if (excludedFacilities.includes(item.id)) continue;
                
                let source = "Unknown Source";
                if (typeof item.system?.source === "string") source = item.system.source;
                else if (item.system?.source?.custom) source = item.system.source.custom;
                else if (item.system?.source?.book) source = item.system.source.book;
                else if (item.system?.source?.label) source = item.system.source.label;
                
                if (excludedSources.includes(source.trim())) continue;

                // Try multiple places a level might be stored depending on the exact 5e system schema version
                let reqLevel = item.system?.prerequisites?.level || item.system?.requirements?.level;
                
                // If not found in a clean integer field, try parsing the description for "Level X"
                if (reqLevel === undefined || reqLevel === null || reqLevel === 0) {
                    const desc = item.system?.description?.value || "";
                    const levelMatch = desc.match(/Level\s+(\d+)/i);
                    if (levelMatch) {
                        reqLevel = parseInt(levelMatch[1]);
                    } else {
                        // Default to 5 if absolutely no level info can be found
                        reqLevel = 5; 
                    }
                }

                // If the actor doesn't meet the level requirement and we aren't ignoring them, skip it entirely
                if (!ignorePrereqs && actorLevel < reqLevel) {
                    continue;
                }

                const facData = {
                    _id: item._id,
                    name: item.name,
                    reqLevel: reqLevel
                };

                // Sort into Basic vs Special facilities. 
                // We'll define Basic as explicitly named "Basic Facility" or having "Basic" in the name/type
                const isBasic = item.name.toLowerCase().includes("basic") || 
                                (item.system?.type?.value && item.system.type.value.toLowerCase().includes("basic"));

                if (isBasic) {
                    basicFacilities.push(facData);
                } else {
                    specialFacilities.push(facData);
                }
            }

            specialFacilities.sort((a, b) => a.name.localeCompare(b.name));
            basicFacilities.sort((a, b) => a.name.localeCompare(b.name));
        }

        const requiredRole = parseInt(game.settings.get("dnd-2024-bastion-manager", "advancePermission")) || 4;
        const canAdvanceTurn = game.user.role >= requiredRole;

        return { 
            actor: this.actor, turnCount: globalTurnCount, 
            totalDefenders, defenderNames: allDefenderNames.join(", "), 
            facilities, specialFacilities, basicFacilities,
            canAdvanceTurn 
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const selects = this.element.querySelectorAll('.facility-order-select');
        for ( const select of selects ) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset; 
                let newOrder = event.target.value;
                let pendingSubType = null;

                if (newOrder === "Change Type") {
                    let promptContent = "";
                    if (ds.itemName && ds.itemName.includes("Garden")) {
                        promptContent = `<p>What type of Garden are you changing to?</p>
                                  <select name="subType" style="width: 100%;">
                                      <option value="Decorative">Decorative</option>
                                      <option value="Food">Food</option>
                                      <option value="Herb">Herb</option>
                                      <option value="Poison">Poison</option>
                                  </select>`;
                    } else if (ds.itemName && ds.itemName.includes("Workshop")) {
                        promptContent = `<p>What type of Workshop are you changing to?</p>
                                  <select name="subType" style="width: 100%;">
                                      <option value="Wood">Wood/Carpentry</option>
                                      <option value="Stone">Stone/Masonry</option>
                                      <option value="Cloth">Cloth/Tailoring</option>
                                      <option value="Leather">Leatherworking</option>
                                      <option value="Metal">Metalworking</option>
                                  </select>`;
                    } else {
                        // Fallback generic prompt if we don't know the specific subtypes
                        promptContent = `<p>Enter new type:</p><input type="text" name="subType" style="width: 100%;">`;
                    }

                    const chosenType = await DialogV2.prompt({
                        window: { title: "Select Target Type" },
                        content: promptContent,
                        ok: { callback: (event, button) => button.form.elements.subType.value }
                    });
                    
                    if (!chosenType) {
                        event.target.value = "Maintain"; 
                        newOrder = "Maintain";
                    } else {
                        pendingSubType = chosenType;
                    }
                }

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); const item = member?.items.get(ds.itemId);
                    if (item) {
                        await item.setFlag("dnd-2024-bastion-manager", "order", newOrder);
                        if (pendingSubType) {
                            await item.setFlag("dnd-2024-bastion-manager", "pendingSubType", pendingSubType);
                            await item.setFlag("dnd-2024-bastion-manager", "progress", 0);
                        }
                    }
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; if (!fac.flags["dnd-2024-bastion-manager"]) fac.flags["dnd-2024-bastion-manager"] = {};
                        fac.flags["dnd-2024-bastion-manager"].order = newOrder;
                        if (pendingSubType) {
                            fac.flags["dnd-2024-bastion-manager"].pendingSubType = pendingSubType;
                            fac.flags["dnd-2024-bastion-manager"].progress = 0;
                        }
                        await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) {
                        await item.setFlag("dnd-2024-bastion-manager", "order", newOrder);
                        if (pendingSubType) {
                            await item.setFlag("dnd-2024-bastion-manager", "pendingSubType", pendingSubType);
                            await item.setFlag("dnd-2024-bastion-manager", "progress", 0);
                        }
                    }
                }
                ui.notifications.info(`Order updated to ${newOrder}.`);
            });
        }
    }

    static async onUpgradeFacility(event, target) {
        ui.notifications.info("Upgrade logic pending!");
    }

    static async onMaintainAll(event, target) {
        const confirm = await DialogV2.confirm({ window: { title: "Maintain All" }, content: `<p>Set all active orders to <b>Maintain</b>?</p>`, rejectClose: false, modal: true });
        if (!confirm) return;

        let groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
        let groupUpdated = false;

        for (const item of this.actor.items.filter(i => i.type === "facility")) {
            if (item.getFlag("dnd-2024-bastion-manager", "order") !== "Maintain") {
                await item.setFlag("dnd-2024-bastion-manager", "order", "Maintain");
            }
        }

        if (this.actor.type === "group") {
            for (let fac of groupFacilities) {
                if (fac.flags?.["dnd-2024-bastion-manager"]?.order !== "Maintain") {
                    foundry.utils.setProperty(fac, "flags.dnd-2024-bastion-manager.order", "Maintain");
                    groupUpdated = true;
                }
            }
            if (groupUpdated) await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacilities);
        }

        ui.notifications.info("All facilities successfully set to Maintain.");
        this.render();
    }

    static async onResetTurns(event, target) {
        // Obsolete, removed from UI 
    }

    static async onDeleteFacility(event, target) {
        const ds = target.dataset; if (!ds.itemId) return;
        const confirm = await DialogV2.confirm({ window: { title: "Demolish Facility" }, content: `<p>Are you sure you want to demolish this facility? Any defenders housed inside will be lost.</p>`, rejectClose: false, modal: true });
        if (confirm) {
            if (ds.isFlag === "true") {
                const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                const newArray = groupFacilities.filter(f => f._id !== ds.itemId);
                await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", newArray);
            } else {
                const item = this.actor.items.get(ds.itemId); if (item) await item.delete();
            }
            this.render();
        }
    }

    static async onBuildFromDropdown(event, target) {
        const selectElement = this.element.querySelector('select[name="compendium-facility"]');
        if (!selectElement?.value) return ui.notifications.warn("Select a facility first!");

        const pack = game.packs.get("dnd-2024-bastion-manager.bastion-facilities");
        const itemDoc = await pack.getDocument(selectElement.value);
        let newFacData = itemDoc.toObject();

        foundry.utils.setProperty(newFacData, "flags.dnd-2024-bastion-manager.size", "Roomy");

        let expectedHirelings = 0;
        const hData = itemDoc.system?.hireling || itemDoc.system?.hirelings || itemDoc.system?.details?.hireling || itemDoc.system?.details?.hirelings;

        if (typeof hData === "number") expectedHirelings = hData;
        else if (typeof hData === "string") expectedHirelings = parseInt(hData) || 0;
        else if (typeof hData === "object" && hData !== null) expectedHirelings = parseInt(hData.max) || parseInt(hData.value) || 0;

        let requiresTypeSelection = itemDoc.name === "Garden" || itemDoc.name === "Workshop";
        let promptContent = "";

        if (requiresTypeSelection) {
            let options = "";
            if (itemDoc.name === "Garden") {
                options = `
                    <option value="Decorative">Decorative</option>
                    <option value="Food">Food</option>
                    <option value="Herb">Herb</option>
                    <option value="Poison">Poison</option>`;
            } else if (itemDoc.name === "Workshop") {
                options = `
                    <option value="Wood">Wood/Carpentry</option>
                    <option value="Stone">Stone/Masonry</option>
                    <option value="Cloth">Cloth/Tailoring</option>
                    <option value="Leather">Leatherworking</option>
                    <option value="Metal">Metalworking</option>`;
            }
            promptContent += `
                <div style="margin-bottom: 10px;">
                    <p>Select a specialization for your ${itemDoc.name}:</p>
                    <select name="subType" style="width: 100%;">
                        ${options}
                    </select>
                </div>
            `;
        }

        if (expectedHirelings > 0 && game.settings.get("dnd-2024-bastion-manager", "nameHirelings")) {
            promptContent += `<p>This facility requires <b>${expectedHirelings}</b> hireling(s). Please name them:</p>`;
            for (let i = 0; i < expectedHirelings; i++) {
                promptContent += `<div style="margin-bottom: 8px; display: flex; align-items: center; gap: 10px;">
                                    <label style="width: 80px;">Hireling ${i+1}:</label>
                                    <input type="text" name="hireling_${i}" value="" style="flex-grow: 1;">
                                </div>`;
            }
        }

        if (promptContent) {
            const formData = await DialogV2.prompt({
                window: { title: `Build Facility: ${itemDoc.name}` },
                content: promptContent,
                ok: { callback: (event, button) => {
                    let data = {};
                    if (requiresTypeSelection) {
                        data.subType = button.form.elements.subType?.value;
                    }
                    if (expectedHirelings > 0) {
                        let names = [];
                        for(let i = 0; i < expectedHirelings; i++) {
                            let val = button.form.elements[`hireling_${i}`].value.trim();
                            if (val) names.push(val);
                        }
                        data.hirelings = names;
                    }
                    return data;
                }}
            });
            
            if (formData) {
                 if (formData.subType) {
                     foundry.utils.setProperty(newFacData, "flags.dnd-2024-bastion-manager.subType", formData.subType);
                 }
                 if (formData.hirelings && formData.hirelings.length > 0) {
                     foundry.utils.setProperty(newFacData, "flags.dnd-2024-bastion-manager.hirelings", formData.hirelings);
                 }
            }
        }

        if (this.actor.type === "group") {
            const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
            newFacData._id = foundry.utils.randomID(); 
            groupFacilities.push(newFacData);
            await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacilities);
        } else {
            await Item.create(newFacData, { parent: this.actor });
        }
        this.render(); 
    }

    // --- UI ACTION ---
    static async onAdvanceGlobalTurn(event, target) {
        const turnsInput = this.element.querySelector('input[name="turns"]');
        const turnsToAdvance = parseInt(turnsInput?.value) || 1;

        const confirm = await DialogV2.confirm({ 
            window: { title: "Advance Bastion Turn" }, 
            content: `<p>Are you sure you want to advance the global Bastion turn by <b>${turnsToAdvance}</b>?</p>`, 
            rejectClose: false, modal: true 
        });

        if (confirm) {
            const currentGlobalTurns = game.settings.get("dnd-2024-bastion-manager", "globalTurnCount") || 0;
            await game.settings.set("dnd-2024-bastion-manager", "globalTurnCount", currentGlobalTurns + turnsToAdvance);

            const playerActors = game.actors.filter(a => a.hasPlayerOwner && a.type === "character");
            let reports = [];
            for (let actor of playerActors) {
                // If they have facilities or had bastion data initialized
                if (actor.getFlag("dnd-2024-bastion-manager", "data") || actor.items.some(i => i.type === "facility")) {
                    const r = await BastionManager.executeBastionTurn(actor, turnsToAdvance);
                    if (r) reports.push(r);
                }
            }
            if (reports.length > 0) {
                await BastionManager._dispatchReports(reports, turnsToAdvance);
            }
            ui.notifications.info(`Advanced global Bastion turns by ${turnsToAdvance}.`);
            // Trigger a re-render for everyone since it's global
            game.socket.emit("module.dnd-2024-bastion-manager", { action: "globalAdvance" });
            this.render();
        }
    }

    // --- THE STANDALONE ENGINE ---
    static async executeBastionTurn(actor, turnsToAdvance) {
        // We no longer update actor-specific turn count, it uses globalTurnCount
        
        let activeFacilities = BastionManager._getActorFacilities(actor);
        if (activeFacilities.length === 0) return null; // Silent return, let global loop continue

        let allMaintaining = activeFacilities.every(fac => 
            (fac.isFlag ? fac.doc.flags?.["dnd-2024-bastion-manager"]?.order : fac.doc.getFlag("dnd-2024-bastion-manager", "order")) === "Maintain"
            || (fac.isFlag ? fac.doc.flags?.["dnd-2024-bastion-manager"]?.order : fac.doc.getFlag("dnd-2024-bastion-manager", "order")) === undefined
        );

        let globalDefenders = activeFacilities.reduce((sum, fac) => sum + (fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.defenders?.count || 0) : (fac.doc.getFlag("dnd-2024-bastion-manager", "defenders.count") || 0)), 0);
        let hasSmithy = activeFacilities.some(fac => fac.doc.name.includes("Smithy"));
        let actorLevel = (actor.type === "character" || actor.type === "npc") ? (actor.system.details?.level || 1) : 1;

        const resolution = await BastionManager._resolveOrders(actor, activeFacilities, turnsToAdvance, globalDefenders, hasSmithy, actorLevel);
        
        if (resolution.totalGold !== 0) {
            const finalGold = Math.max(0, (actor.system.currency?.gp || 0) + resolution.totalGold); 
            await actor.update({ "system.currency.gp": finalGold });
        }
        await BastionManager._processInventory(actor, resolution.items);

        return await BastionManager._buildReport(actor, turnsToAdvance, allMaintaining, resolution);
    }

    // --- HELPER: FACILITY GATHERING ---
    static _getActorFacilities(actor) {
        let facs = [];
        actor.items.filter(item => item.type === "facility").forEach(i => facs.push({ doc: i, name: i.name, isFlag: false }));
        if (actor.type === "group") {
            const flagFacs = actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
            flagFacs.forEach(f => facs.push({ doc: f, name: f.name, isFlag: true }));
        }
        return facs;
    }

    // --- HELPER: ORDER RESOLUTION ---
    static async _resolveOrders(actor, facilities, turns, defenders, hasSmithy, level) {
        let orderSummary = "";
        let totalGold = 0;
        let items = [];

        for (const fac of facilities) {
            let order = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.order || "Maintain") : (fac.doc.getFlag("dnd-2024-bastion-manager", "order") || "Maintain");
            let subType = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.subType) : (fac.doc.getFlag("dnd-2024-bastion-manager", "subType"));
            let progress = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.progress || 0) : (fac.doc.getFlag("dnd-2024-bastion-manager", "progress") || 0);
            
            let resultText = "";
            let localGold = 0;

            for (let i = 0; i < turns; i++) {
                if (order === "Maintain") {
                    resultText = "Maintained standard operations.";
                } else if (order === "Change Type") {
                    let pending = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.pendingSubType) : (fac.doc.getFlag("dnd-2024-bastion-manager", "pendingSubType"));
                    progress += 1;
                    if (progress >= 3) { subType = pending || "Decorative"; progress = 0; order = "Maintain"; resultText = `Completed changing type to <b>[${subType}]</b>.`; } 
                    else { resultText = `Changing type to [${pending}] (Progress: ${progress}/3 turns).`; }
                } else if (order === "Trade") {
                    let tradeRes = await BastionManager._handleTrade(fac.doc.name, defenders, hasSmithy, level);
                    localGold += tradeRes.gold; resultText = tradeRes.text;
                } else if (order === "Harvest") {
                    let harvestRes = await BastionManager._handleHarvest(fac.doc.name, subType, fac);
                    if (harvestRes.item) items.push(harvestRes.item);
                    resultText = harvestRes.text;
                }
            }

            totalGold += localGold;
            
            if (fac.isFlag) {
                const groupFacs = actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                const gf = groupFacs.find(f => f._id === fac.doc._id);
                if (gf) { foundry.utils.setProperty(gf, "flags.dnd-2024-bastion-manager.subType", subType); foundry.utils.setProperty(gf, "flags.dnd-2024-bastion-manager.progress", progress); foundry.utils.setProperty(gf, "flags.dnd-2024-bastion-manager.order", order); await actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacs); }
            } else {
                await fac.doc.setFlag("dnd-2024-bastion-manager", "subType", subType); await fac.doc.setFlag("dnd-2024-bastion-manager", "progress", progress); await fac.doc.setFlag("dnd-2024-bastion-manager", "order", order);
            }

            orderSummary += `<li style="margin-bottom: 6px; padding: 4px; background: rgba(0,0,0,0.03); border-radius: 3px;">
                                <img src="${fac.doc.img}" width="20" height="20" style="vertical-align: middle; border: none; margin-right: 6px; border-radius: 3px;">
                                <b>${fac.name}</b> <br><span style="font-size: 0.9em; padding-left: 26px; display: block; color: #444;">${resultText}</span>
                            </li>`;
        }
        return { orderSummary, totalGold, items };
    }

    // --- HELPER: TRADE ---
    static async _handleTrade(baseName, defenders, hasSmithy, level) {
        if (baseName === "Armory") {
            let cost = 100 + (100 * defenders); if (hasSmithy) cost = Math.floor(cost / 2);
            return { gold: -cost, text: `Stocked the Armory for ${defenders} total defenders.` };
        } else if (baseName === "Storehouse") {
            let limit = level >= 13 ? 5000 : (level >= 9 ? 2000 : 500); let markup = level >= 17 ? 100 : (level >= 13 ? 50 : (level >= 9 ? 20 : 10));
            return { gold: 0, text: `Procure up to <b>${limit} GP</b> in goods, OR sell at a <b>+${markup}%</b> profit.` };
        } else {
            const roll = await new Roll("1d6 * 10").evaluate();
            return { gold: roll.total, text: `Generated ${roll.total} GP.` };
        }
    }

    // --- HELPER: HARVEST ---
    static async _handleHarvest(baseName, subType, fac) {
        const outPack = game.packs.get("dnd-2024-bastion-manager.bastion-output-items");
        if (!outPack) return { item: null, text: "Output compendium missing." };
        const allDocs = await outPack.getDocuments(); const folder = outPack.folders.find(f => f.name === baseName);
        if (!folder) {
            const roll = await new Roll("1d4 + 1").evaluate();
            return { item: { name: `Harvested Materials (${baseName})`, type: "loot", system: { quantity: roll.total } }, text: `Harvested ${roll.total} generic materials.` };
        }
        
        let possible = allDocs.filter(i => i.folder?.id === folder.id);
        if (baseName === "Garden" && subType) {
            const kwMap = { "Decorative": ["bouquet", "perfume", "candle"], "Food": ["ration", "food"], "Herb": ["healer", "healing", "herb"], "Poison": ["antitoxin", "poison"] };
            if (kwMap[subType]) possible = possible.filter(i => kwMap[subType].some(kw => i.name.toLowerCase().includes(kw)));
        } else if (baseName === "Workshop" && subType) {
            const kwMap = { "Wood": ["wood", "staff", "bow", "club"], "Stone": ["stone", "statue", "block"], "Cloth": ["cloth", "robe", "garment"], "Leather": ["leather", "hide", "armor"], "Metal": ["iron", "steel", "sword", "shield"] };
            if (kwMap[subType]) possible = possible.filter(i => kwMap[subType].some(kw => i.name.toLowerCase().includes(kw)));
        }

        if (possible.length === 0) return { item: null, text: `No valid items found for ${subType}.` };
        
        let chosen = possible[0];
        let itemObj = chosen.toObject();
        return { item: itemObj, text: `Harvested ${itemObj.system?.quantity || 1}x ${itemObj.name}.` };
    }

    // --- HELPER: INVENTORY ---
    static async _processInventory(actor, items) {
        if (items.length === 0) return;
        let toCreate = []; let toUpdate = [];
        for (let item of items) {
            let existing = actor.items.find(i => i.name === item.name && i.type === item.type);
            let qty = item.system?.quantity || 1;
            if (existing) {
                let queued = toUpdate.find(u => u._id === existing.id);
                if (queued) queued["system.quantity"] += qty;
                else toUpdate.push({ _id: existing.id, "system.quantity": (existing.system?.quantity || 1) + qty });
            } else {
                let queued = toCreate.find(c => c.name === item.name && c.type === item.type);
                if (queued) queued.system.quantity = (queued.system?.quantity || 1) + qty;
                else toCreate.push(item);
            }
        }
        if (toCreate.length > 0) await actor.createEmbeddedDocuments("Item", toCreate);
        if (toUpdate.length > 0) await actor.updateEmbeddedDocuments("Item", toUpdate);
    }

    static _getHirelingProfession(facName, subType) {
        const name = facName.toLowerCase();
        if (name.includes("garden")) {
            if (subType === "Herb") return "the Herbalist";
            if (subType === "Food") return "the Farmer";
            if (subType === "Poison") return "the Botanical Toxicologist";
            if (subType === "Decorative") return "the Florist";
            return "the Gardener";
        }
        if (name.includes("arcane study")) return "the Arcanist";
        if (name.includes("library")) return "the Librarian";
        if (name.includes("barrack")) return "the Recruiter";
        if (name.includes("sanctuary")) return "the Sanctuary Caretaker";
        if (name.includes("smithy")) return "the Smith";
        if (name.includes("storehouse")) return "the Quartermaster";
        if (name.includes("workshop")) return "the Artisan";
        if (name.includes("armory")) return "the Armorer";
        if (name.includes("teleportation circle")) return "the Gatekeeper";
        if (name.includes("observatory")) return "the Astronomer";
        if (name.includes("theater")) return "the Stage Manager";
        if (name.includes("scriptorium")) return "the Scribe";
        if (name.includes("pub")) return "the Barkeep";
        if (name.includes("reliquary")) return "the Relic Keeper";
        if (name.includes("gaming room")) return "the Croupier";
        if (name.includes("menagerie")) return "the Beastmaster";
        if (name.includes("greenhouse")) return "the Horticulturist";
        if (name.includes("laboratory")) return "the Alchemist";
        
        // Fallback for custom or basic facilities
        return "(Hireling)";
    }

    // --- HELPER: CHAT ---
    static async _processEventRoll(roll, actor, isReroll = false) {
        const promptAll = game.settings.get("dnd-2024-bastion-manager", "promptAllEvents");
        let cat = "", desc = "", auto = "";
        
        let allHirelings = [];
        let specialFacilities = [];
        if (actor) {
            const facs = BastionManager._getActorFacilities(actor);
            for (const fac of facs) {
                const isBasic = fac.name.toLowerCase().includes("basic") || (fac.doc.system?.type?.value && fac.doc.system.type.value.toLowerCase().includes("basic"));
                if (!isBasic) specialFacilities.push(fac.name);
                
                const hirelings = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.hirelings) : (fac.doc.getFlag("dnd-2024-bastion-manager", "hirelings"));
                if (Array.isArray(hirelings)) {
                    let subType = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.subType) : (fac.doc.getFlag("dnd-2024-bastion-manager", "subType"));
                    let prof = BastionManager._getHirelingProfession(fac.name, subType);
                    for (const h of hirelings) {
                        allHirelings.push({ name: h, facility: fac.name, prof: prof });
                    }
                }
            }
        }
        const getRandomHireling = () => allHirelings.length ? allHirelings[Math.floor(Math.random() * allHirelings.length)] : null;
        const getRandomSpecialFac = () => specialFacilities.length ? specialFacilities[Math.floor(Math.random() * specialFacilities.length)] : "random special facility";

        // Wrap output in an identifiable container holding the actor ID so resolution buttons know who to apply currency to
        const mkRes = (inner) => `<div class="event-resolution" data-actor-id="${actor?.id || ''}"><div style="margin-top: 5px; display: flex; gap: 5px; flex-wrap: wrap; align-items: center;">${inner}</div></div>`;
        const mkBtn = (evt, choice, label) => `<button type="button" data-action="resolveEvent" data-event="${evt}" data-choice="${choice}" style="width: auto; padding: 4px 10px; font-size: 0.95em; background: rgba(0,0,0,0.2); color: var(--color-text-light-primary); border: 1px solid var(--color-border-light-1); border-radius: 4px; cursor: pointer;">${label}</button>`;
        const mkAutoBtn = (evt) => mkBtn(evt, 'auto', 'Automate Roll') + mkBtn(evt, 'manual', 'Resolve Manually');

        if (roll <= 50) { 
            cat = "All Is Well"; desc = "Nothing significant happens.";
            if (promptAll) auto = mkRes(mkAutoBtn('allIsWell'));
            else {
                const h1 = getRandomHireling();
                const flavor = [
                    "Accident reports are way down.",
                    "The leak in the roof has been fixed.",
                    "No vermin infestations to report.",
                    h1 ? `${h1.name} lost their spectacles again.` : "You-Know-Who lost their spectacles again.",
                    h1 ? `${h1.name} ${h1.prof} adopted a stray dog.` : "One of your hirelings adopted a stray dog.",
                    "You received a lovely letter from a friend.",
                    h1 ? `Some practical joker has been putting rotten eggs in ${h1.name}'s boots.` : "Some practical joker has been putting rotten eggs in people's boots.",
                    h1 ? `${h1.name} thought they saw a ghost.` : "Someone thought they saw a ghost."
                ];
                const fRoll = (await new Roll("1d8").evaluate()).total;
                auto = `<b>Result:</b> ${flavor[fRoll - 1]}`;
            }
        } else if (roll <= 55) { 
            cat = "Attack"; desc = "A hostile force attacks your Bastion but is defeated.";
            if (promptAll) auto = mkRes(mkAutoBtn('attack'));
            else {
                const atkRoll = await new Roll("6d6").evaluate();
                const ones = atkRoll.dice[0].results.filter(d => d.result === 1).length;
                auto = `Rolled 6d6: <b>${ones}</b> Bastion Defender(s) died. If you have 0 Defenders, a random special facility shuts down (unusable next turn).`; 
            }
        } else if (roll <= 58) { 
            const h2 = getRandomHireling();
            cat = "Criminal Hireling"; desc = h2 ? `${h2.name} ${h2.prof} has a criminal past that comes to light.` : "One of your Bastion's hirelings has a criminal past that comes to light.";
            auto = mkRes(`<span style="margin-right: 5px;">Pay 1d6x100 GP to keep ${h2 ? h2.name : "them"}, OR let them be arrested?</span>` + mkBtn('criminal', 'pay', 'Pay Bribe') + mkBtn('criminal', 'arrest', 'Let Arrested'));
        } else if (roll <= 63) { 
            cat = "Extraordinary Opportunity"; desc = "Your Bastion is given the opportunity to host an important festival, fund research, or appease a noble.";
            if (isReroll) auto = `Paid <b>500 GP</b> to seize this opportunity.`;
            else auto = mkRes(`<span style="margin-right: 5px;">Pay 500 GP to seize the opportunity?</span>` + mkBtn('opportunity', 'pay', 'Pay 500 GP') + mkBtn('opportunity', 'decline', 'Decline'));
        } else if (roll <= 72) { 
            cat = "Friendly Visitors"; desc = "Friendly visitors come seeking to use one of your special facilities.";
            auto = mkRes(`<span style="margin-right: 5px;">Allow use for 1d6x100 GP?</span>` + mkBtn('visitors', 'accept', 'Accept') + mkBtn('visitors', 'decline', 'Decline'));
        } else if (roll <= 76) { 
            cat = "Guest"; desc = "A Friendly guest comes to stay at your Bastion.";
            if (promptAll) auto = mkRes(mkAutoBtn('guest'));
            else {
                const gRoll = (await new Roll("1d4").evaluate()).total;
                if (gRoll === 1) auto = "The guest is of great renown. Stays 7 days, then gives you a <b>Letter of Recommendation</b>.";
                else if (gRoll === 2) { const offer = (await new Roll("1d6 * 100").evaluate()).total; if(actor) await actor.update({"system.currency.gp": (actor.system.currency?.gp || 0) + offer}); auto = `The guest requests sanctuary for 7 days, offering a gift of <b>${offer} GP</b>.`; }
                else if (gRoll === 3) auto = "The guest is a mercenary. You gain <b>1 additional Bastion Defender</b> until sent away or killed.";
                else auto = "The guest is a Friendly monster (e.g., brass dragon). It defends against the next attack so you lose 0 Defenders, then leaves.";
            }
        } else if (roll <= 79) { 
            const f1 = getRandomSpecialFac();
            cat = "Lost Hirelings"; desc = `The <b>${f1}</b> loses its hirelings.`; 
            auto = `This facility can't be used on your next Bastion turn (hirelings replaced at no cost after).`; 
        } else if (roll <= 83) { 
            const h3 = getRandomHireling();
            cat = "Magical Discovery"; desc = h3 ? `${h3.name} ${h3.prof} discovers or accidentally creates an Uncommon magic item at no cost.` : "Your hirelings discover or accidentally create an Uncommon magic item of your choice at no cost."; 
            auto = `Gain one <b>Uncommon Potion</b> or <b>Uncommon Scroll</b> of your choice.`; 
        } else if (roll <= 91) { 
            cat = "Refugees"; desc = `A group of refugees seeks refuge in your Bastion.`; 
            auto = mkRes(`<span style="margin-right: 5px;">Allow 2d4 refugees to stay for a 1d6x100 GP reward?</span>` + mkBtn('refugees', 'accept', 'Offer Protection') + mkBtn('refugees', 'decline', 'Turn Away'));
        } else if (roll <= 98) { 
            cat = "Request for Aid"; desc = "Your Bastion is called on to help a local leader."; 
            auto = mkRes(`<span style="margin-right: 5px;">Send Defenders?</span><input type="number" class="aid-count" value="1" min="1" style="width: 40px; margin-right: 5px; height: 26px; text-align: center;">` + mkBtn('aid', 'send', 'Send Defenders') + mkBtn('aid', 'decline', 'Decline'));
        } else { 
            cat = "Treasure"; desc = "Your Bastion acquires an art object or magic item."; 
            if (promptAll) auto = mkRes(mkAutoBtn('treasure'));
            else {
                const tRoll = (await new Roll("1d100").evaluate()).total;
                if (tRoll <= 40) auto = "Gain a <b>25 GP</b> Art Object.";
                else if (tRoll <= 63) auto = "Gain a <b>250 GP</b> Art Object.";
                else if (tRoll <= 73) auto = "Gain a <b>750 GP</b> Art Object.";
                else if (tRoll <= 75) auto = "Gain a <b>2,500 GP</b> Art Object.";
                else if (tRoll <= 90) auto = "Gain a <b>Common Magic Item</b> of your choice (Arcana, Armaments, Implements, or Relics).";
                else if (tRoll <= 98) auto = "Gain an <b>Uncommon Magic Item</b> of your choice (Arcana, Armaments, Implements, or Relics).";
                else auto = "Gain a <b>Rare Magic Item</b> of your choice (Arcana, Armaments, Implements, or Relics).";
            }
        }
        return { cat, desc, auto };
    }

    static async _buildReport(actor, turns, allMaintaining, res) {
        let dmHtml = "";
        let pubHtml = "";
        let publicSummaryEvents = [];

        if (allMaintaining) {
            dmHtml += `<div style="margin-bottom: 15px;">
                <h3 style="margin-bottom: 5px; color: #a32a22; border-bottom: 1px solid #ccc;">${actor.name}</h3>`;
                
            for (let t = 0; t < turns; t++) {
                const eventRoll = await new Roll("1d100").evaluate();
                const rollTotal = eventRoll.total;
                
                const ev = await BastionManager._processEventRoll(rollTotal, actor);
                let eCat = ev.cat; let eDesc = ev.desc; let autoResults = ev.auto;

                let eColor = rollTotal <= 50 ? "#a8d5a2" : (rollTotal <= 58 || (rollTotal >= 77 && rollTotal <= 79) ? "#f28b82" : "#99c1f1");
                let turnLabel = turns > 1 ? `<b>Turn ${t + 1}:</b> ` : "";

                dmHtml += `
                    <div style="margin-bottom: 10px; padding: 8px; background: rgba(0,0,0,0.15); border: 1px solid var(--color-border-light-1); border-radius: 4px;">
                        <p style="margin: 0; font-size: 1.1em; color: ${eColor};">${turnLabel}🎲 <b>${rollTotal}</b> — <em>${eCat}</em></p>
                        <p style="font-size: 0.95em; color: var(--color-text-light-primary); margin: 6px 0 8px 0;">${eDesc}</p>
                        ${autoResults ? `<div style="background: rgba(0,0,0,0.3); padding: 8px 10px; border-radius: 3px; font-size: 0.9em; border-left: 3px solid #6c757d; color: var(--color-text-light-primary);">${autoResults}</div>` : ""}
                    </div>`;

                if (eCat !== "All Is Well") {
                    let existingEvent = publicSummaryEvents.find(e => e.cat === eCat);
                    if (existingEvent) existingEvent.count++;
                    else publicSummaryEvents.push({ cat: eCat, count: 1 });
                }
            }
            dmHtml += `</div>`;

            let notableEventsStr = publicSummaryEvents.length > 0 
                ? publicSummaryEvents.map(e => e.count > 1 ? `${e.cat} (x${e.count})` : e.cat).join(", ") 
                : "None (All Is Well)";
            
            pubHtml += `
                <div style="margin-bottom: 10px;">
                    <h4 style="margin: 0 0 5px 0; border-bottom: 1px solid #ccc;">${actor.name}</h4>
                    <div style="padding: 6px; background: rgba(0,0,0,0.05); border-radius: 4px; text-align: center; margin-bottom: 5px;">
                        <b style="color: #444;"><i class="fa-solid fa-broom"></i> Bastion Maintained</b><br>
                        <span style="font-size: 0.85em; color: #666;">No specific orders issued.</span>
                    </div>
                    <p style="font-size: 0.9em; margin: 0;"><b>Notable Events:</b> ${notableEventsStr}</p>
                </div>`;
        } else {
            pubHtml += `
                <div style="margin-bottom: 10px;">
                    <h4 style="margin: 0 0 5px 0; border-bottom: 1px solid #ccc;">${actor.name}</h4>
                    <ul style="list-style: none; padding: 0; margin: 0; font-size: 0.9em;">${res.orderSummary || "<li>No facilities built.</li>"}</ul>
                </div>`;
        }
        
        return { hasDmContent: allMaintaining, dmHtml, pubHtml };
    }

    static async _dispatchReports(reports, turns) {
        if (reports.length === 0) return;

        let combinedPubHtml = `
            <div class="bastion-chat-card">
                <h3 style="border-bottom: 2px solid #a32a22; padding-bottom: 3px; margin-bottom: 10px;">Global Bastion Turn Advanced</h3>
                <p style="margin-bottom: 10px;">Bastions were advanced by <b>${turns}</b> turn(s).</p>`;
        
        let combinedDmHtml = `
            <div style="font-family: var(--font-primary);">
                <h2 style="border-bottom: 2px solid #a32a22; padding-bottom: 3px; margin-bottom: 10px;">Global DM Bastion Report</h2>
                <p>Bastion events for <b>${turns}</b> turn(s).</p>
                <hr>
        `;

        let hasDmEvents = false;

        for (const report of reports) {
            combinedPubHtml += report.pubHtml;
            if (report.hasDmContent) {
                combinedDmHtml += report.dmHtml;
                hasDmEvents = true;
            }
        }
        
        combinedPubHtml += `</div>`;
        combinedDmHtml += `</div>`;

        // Send a single public chat card summarizing all characters
        ChatMessage.create({ content: combinedPubHtml });

        // Show a single DM whisper/dialog combining all events
        if (hasDmEvents) {
            // Keep the whispered message for permanent log, but format it cleanly
            ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients("GM"), content: combinedDmHtml });
            if (game.user.isGM) {
                // Show the interactive prompt
                const { DialogV2 } = foundry.applications.api;
                
                class EventResolverApp extends foundry.applications.api.ApplicationV2 {
                    static DEFAULT_OPTIONS = {
                        id: "bastion-event-resolver",
                        window: { title: "Global Bastion Report", resizable: true },
                        position: { width: 550, height: "auto" }
                    };
                    
                    async _renderHTML(context, options) {
                        return `<div style="font-family: var(--font-primary); padding: 8px;">${combinedDmHtml}</div>`;
                    }
                    
                    _replaceHTML(result, content, options) {
                        content.innerHTML = result;
                    }
                    
                    _onRender(context, options) {
                        super._onRender(context, options);
                        const btns = this.element.querySelectorAll('button[data-action="resolveEvent"]');
                        for (const btn of btns) {
                            btn.addEventListener('click', async (event) => {
                                const ds = event.target.dataset;
                                const eventType = ds.event;
                                const choice = ds.choice;
                                
                                const container = event.target.closest('.event-resolution');
                                const actorId = container.dataset.actorId;
                                const a = game.actors.get(actorId);

                                let resultText = "";
                                
                                if (eventType === "allIsWell") {
                                    if (choice === "auto") {
                                        let hName = null, hProf = null;
                                        if (a) {
                                            let hList = [];
                                            BastionManager._getActorFacilities(a).forEach(fac => {
                                                const h = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.hirelings) : (fac.doc.getFlag("dnd-2024-bastion-manager", "hirelings"));
                                                if (Array.isArray(h)) {
                                                    let sub = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.subType) : (fac.doc.getFlag("dnd-2024-bastion-manager", "subType"));
                                                    let prof = BastionManager._getHirelingProfession(fac.name, sub);
                                                    h.forEach(n => hList.push({name: n, prof: prof}));
                                                }
                                            });
                                            if (hList.length > 0) {
                                                const r = hList[Math.floor(Math.random() * hList.length)];
                                                hName = r.name; hProf = r.prof;
                                            }
                                        }
                                        const flavor = [
                                            "Accident reports are way down.",
                                            "The leak in the roof has been fixed.",
                                            "No vermin infestations to report.",
                                            hName ? `${hName} lost their spectacles again.` : "You-Know-Who lost their spectacles again.",
                                            hName ? `${hName} ${hProf} adopted a stray dog.` : "One of your hirelings adopted a stray dog.",
                                            "You received a lovely letter from a friend.",
                                            hName ? `Some practical joker has been putting rotten eggs in ${hName}'s boots.` : "Some practical joker has been putting rotten eggs in people's boots.",
                                            hName ? `${hName} thought they saw a ghost.` : "Someone thought they saw a ghost."
                                        ];
                                        const fRoll = (await new Roll("1d8").evaluate()).total;
                                        resultText = `<b>Result:</b> ${flavor[fRoll - 1]}`;
                                    } else resultText = `<b>Resolved Manually.</b>`;
                                } else if (eventType === "attack") {
                                    if (choice === "auto") {
                                        const atkRoll = await new Roll("6d6").evaluate();
                                        const ones = atkRoll.dice[0].results.filter(d => d.result === 1).length;
                                        resultText = `Rolled 6d6: <b>${ones}</b> Bastion Defender(s) died. If you have 0 Defenders, a random special facility shuts down (unusable next turn).`; 
                                    } else resultText = `<b>Resolved Manually.</b>`;
                                } else if (eventType === "criminal") {
                                    if (choice === "pay") {
                                        const bribe = (await new Roll("1d6 * 100").evaluate()).total;
                                        resultText = `You paid the <b>${bribe} GP</b> bribe.`;
                                    } else resultText = `You let them be arrested. (If this leaves a facility with 0 hirelings, it is unusable next turn).`; 
                                } else if (eventType === "opportunity") {
                                    if (choice === "pay") {
                                        let bonusRoll = (await new Roll("1d100").evaluate()).total;
                                        while (bonusRoll >= 59 && bonusRoll <= 63) bonusRoll = (await new Roll("1d100").evaluate()).total;
                                        const extra = await BastionManager._processEventRoll(bonusRoll, a, true);
                                        resultText = `Paid <b>500 GP</b> to seize this opportunity.<br><div style="margin-top:8px; padding: 8px; background: rgba(0,0,0,0.2); border-left: 3px solid #ccc;"><em>Bonus Event (Roll ${bonusRoll}):</em> <b style="color: var(--color-text-light-heading);">${extra.cat}</b><br><div style="margin-top: 4px;">${extra.auto}</div></div>`;
                                    } else resultText = `You declined the opportunity. Nothing happens.`;
                                } else if (eventType === "visitors") {
                                    if (choice === "accept") {
                                        const offer = (await new Roll("1d6 * 100").evaluate()).total;
                                        if(a) await a.update({"system.currency.gp": (a.system.currency?.gp || 0) + offer});
                                        resultText = `You accepted. They paid <b>${offer} GP</b> for brief use of the facility.`; 
                                    } else resultText = `You declined the visitors.`;
                                } else if (eventType === "guest") {
                                    if (choice === "auto") {
                                        const gRoll = (await new Roll("1d4").evaluate()).total;
                                        if (gRoll === 1) resultText = "The guest is of great renown. Stays 7 days, then gives you a <b>Letter of Recommendation</b>.";
                                        else if (gRoll === 2) { const offer = (await new Roll("1d6 * 100").evaluate()).total; if(a) await a.update({"system.currency.gp": (a.system.currency?.gp || 0) + offer}); resultText = `The guest requests sanctuary for 7 days, offering a gift of <b>${offer} GP</b>.`; }
                                        else if (gRoll === 3) resultText = "The guest is a mercenary. You gain <b>1 additional Bastion Defender</b> until sent away or killed.";
                                        else resultText = "The guest is a Friendly monster. It defends against the next attack so you lose 0 Defenders, then leaves.";
                                    } else resultText = `<b>Resolved Manually.</b>`;
                                } else if (eventType === "refugees") {
                                    if (choice === "accept") {
                                        const ref = (await new Roll("2d4").evaluate()).total;
                                        const offer = (await new Roll("1d6 * 100").evaluate()).total;
                                        if(a) await a.update({"system.currency.gp": (a.system.currency?.gp || 0) + offer});
                                        resultText = `You took in <b>${ref}</b> refugees. They paid <b>${offer} GP</b>. They stay until relocated or the Bastion is attacked.`; 
                                    } else resultText = `You turned the refugees away.`;
                                } else if (eventType === "aid") {
                                    if (choice === "send") {
                                        const input = container.querySelector('input.aid-count');
                                        let count = parseInt(input?.value) || 1;
                                        if (count < 1) count = 1;
                                        const dRoll = (await new Roll(`${count}d6`).evaluate()).total;
                                        if (dRoll >= 10) {
                                            const reward = (await new Roll("1d6 * 100").evaluate()).total;
                                            if(a) await a.update({"system.currency.gp": (a.system.currency?.gp || 0) + reward});
                                            resultText = `Sent ${count} Defender(s). Rolled ${dRoll}. Problem solved, earned <b>${reward} GP</b>.`;
                                        } else {
                                            const reward = Math.floor((await new Roll("1d6 * 100").evaluate()).total / 2);
                                            if(a) await a.update({"system.currency.gp": (a.system.currency?.gp || 0) + reward});
                                            resultText = `Sent ${count} Defender(s). Rolled ${dRoll} (Failure). Problem solved, earned <b>${reward} GP</b> (half), and <b>1 Defender died</b>.`;
                                        }
                                    } else resultText = `You declined to send aid.`;
                                } else if (eventType === "treasure") {
                                    if (choice === "auto") {
                                        const tRoll = (await new Roll("1d100").evaluate()).total;
                                        if (tRoll <= 40) resultText = "Gain a <b>25 GP</b> Art Object.";
                                        else if (tRoll <= 63) resultText = "Gain a <b>250 GP</b> Art Object.";
                                        else if (tRoll <= 73) resultText = "Gain a <b>750 GP</b> Art Object.";
                                        else if (tRoll <= 75) resultText = "Gain a <b>2,500 GP</b> Art Object.";
                                        else if (tRoll <= 90) resultText = "Gain a <b>Common Magic Item</b> of your choice (Arcana, Armaments, Implements, or Relics).";
                                        else if (tRoll <= 98) resultText = "Gain an <b>Uncommon Magic Item</b> of your choice (Arcana, Armaments, Implements, or Relics).";
                                        else resultText = "Gain a <b>Rare Magic Item</b> of your choice (Arcana, Armaments, Implements, or Relics).";
                                    } else resultText = `<b>Resolved Manually.</b>`;
                                }

                                container.innerHTML = resultText;
                            });
                        }
                    }
                }
                new EventResolverApp().render({ force: true });
            }
        }
    }
}