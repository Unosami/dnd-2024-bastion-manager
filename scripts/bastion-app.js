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
            for (let actor of playerActors) {
                // If they have facilities or had bastion data initialized
                if (actor.getFlag("dnd-2024-bastion-manager", "data") || actor.items.some(i => i.type === "facility")) {
                    await BastionManager.executeBastionTurn(actor, turnsToAdvance);
                }
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
        if (activeFacilities.length === 0) return; // Silent return, let global loop continue

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

        await BastionManager._generateChat(actor, turnsToAdvance, allMaintaining, resolution);
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

    // --- HELPER: CHAT ---
    static async _generateChat(actor, turns, allMaintaining, res) {
        let dmDetailedHtml = `
            <div style="font-family: var(--font-primary);">
                <h2 style="border-bottom: 2px solid #a32a22; padding-bottom: 3px; margin-bottom: 10px;">DM Bastion Report</h2>
                <p><b>${actor.name}</b> maintained their entire Bastion for <b>${turns}</b> turn(s).</p>
                <hr>
        `;
        let publicSummaryEvents = [];
        let pubHtml = `
            <div class="bastion-chat-card">
                <h3 style="border-bottom: 2px solid #a32a22; padding-bottom: 3px; margin-bottom: 10px;">Bastion Turn Advanced</h3>
                <p style="margin-bottom: 10px;">${actor.name} advanced their Bastion by <b>${turns}</b> turn(s).</p>`;

        if (allMaintaining) {
            for (let t = 0; t < turns; t++) {
                const eventRoll = await new Roll("1d100").evaluate();
                const rollTotal = eventRoll.total;
                
                let eCat = ""; let eDesc = ""; let autoResults = "";

                if (rollTotal <= 50) { 
                    eCat = "All Is Well"; eDesc = "No unusual events occur during this turn. Operations continue peacefully."; 
                } else if (rollTotal <= 55) { 
                    eCat = "Attack"; let attackers = await new Roll("1d6").evaluate();
                    eDesc = "A creature or group of creatures attacks the Bastion. The attackers must be repelled, or facilities may be damaged."; 
                    autoResults = `Rolled <b>${attackers.total}</b> on the DMG attacker table.`; publicSummaryEvents.push(eCat);
                } else if (rollTotal <= 58) { 
                    eCat = "Criminal Hireling"; let crime = await new Roll("1d4").evaluate();
                    let crimeType = ["Extortion", "Fraud", "Smuggling", "Theft"][crime.total - 1];
                    eDesc = "One of the hirelings is secretly engaged in criminal enterprises. You must investigate and handle the fallout."; 
                    autoResults = `Crime Committed: <b>${crimeType}</b> (Rolled ${crime.total}).`; publicSummaryEvents.push(eCat);
                } else if (rollTotal <= 63) { 
                    eCat = "Extraordinary Opportunity"; let opp = await new Roll("1d4").evaluate();
                    let oppType = ["Trade Offer", "Magic Item Sale", "Rare Material", "Investment"][opp.total - 1];
                    eDesc = "A sudden, highly lucrative opportunity arises for the Bastion to capitalize on."; 
                    autoResults = `Opportunity Type: <b>${oppType}</b> (Rolled ${opp.total}).`; publicSummaryEvents.push(eCat);
                } else if (rollTotal <= 72) { 
                    eCat = "Friendly Visitors"; let days = await new Roll("1d4").evaluate();
                    eDesc = "Friendly travelers or allies seek lodging at the Bastion."; 
                    autoResults = `They intend to stay for <b>${days.total}</b> days.`; publicSummaryEvents.push(eCat);
                } else if (rollTotal <= 76) { 
                    eCat = "Guest"; let guest = await new Roll("1d6").evaluate();
                    let guestType = ["Artisan", "Bard", "Cleric", "Mage", "Noble", "Veteran"][guest.total - 1];
                    eDesc = "A notable or highly influential guest arrives, expecting proper hospitality."; 
                    autoResults = `Guest Type: <b>${guestType}</b> (Rolled ${guest.total}).`; publicSummaryEvents.push(eCat);
                } else if (rollTotal <= 79) { 
                    eCat = "Lost Hirelings"; 
                    eDesc = "One or more of the hirelings have gone missing. They must be tracked down or replaced."; 
                    autoResults = `Requires DM adjudication to determine who vanished.`; publicSummaryEvents.push(eCat);
                } else if (rollTotal <= 83) { 
                    eCat = "Magical Discovery"; let magic = await new Roll("1d6").evaluate();
                    let magicType = magic.total <= 2 ? "Potion" : (magic.total <= 4 ? "Scroll" : "Minor Wonder");
                    eDesc = "A magical phenomenon or item is discovered on the Bastion grounds."; 
                    autoResults = `Discovery Type: <b>${magicType}</b> (Rolled ${magic.total}).`; publicSummaryEvents.push(eCat);
                } else if (rollTotal <= 91) { 
                    eCat = "Refugees"; let refCount = await new Roll("2d4").evaluate(); let refGold = await new Roll("1d6 * 100").evaluate();
                    eDesc = "Displaced people arrive seeking asylum, food, and shelter. They offer to pay for hospitality and protection."; 
                    autoResults = `<b>${refCount.total}</b> refugees arrived. They are willing to pay up to <b>${refGold.total} GP</b>.`; publicSummaryEvents.push(eCat);
                } else if (rollTotal <= 98) { 
                    eCat = "Request for Aid"; 
                    eDesc = "A local faction, town, or individual directly asks the Bastion for help with a pressing problem."; 
                    autoResults = `Requires DM narrative design.`; publicSummaryEvents.push(eCat);
                } else { 
                    eCat = "Treasure"; let treas = await new Roll("1d4 * 100").evaluate();
                    eDesc = "A hidden cache of treasure is discovered on or near the premises."; 
                    autoResults = `The cache contains <b>${treas.total} GP</b> worth of valuables.`; publicSummaryEvents.push(eCat);
                }

                let eColor = rollTotal <= 50 ? "darkgreen" : (rollTotal <= 58 || (rollTotal >= 77 && rollTotal <= 79) ? "darkred" : "darkblue");
                let turnLabel = turns > 1 ? `<b>Turn ${t + 1}:</b> ` : "";

                dmDetailedHtml += `
                    <div style="margin-bottom: 12px; padding: 6px; background: rgba(0,0,0,0.03); border: 1px solid #ccc; border-radius: 4px;">
                        <p style="margin: 0; font-size: 1.1em; color: ${eColor};">${turnLabel}🎲 <b>${rollTotal}</b> — <em>${eCat}</em></p>
                        <p style="font-size: 0.9em; color: #333; margin: 4px 0 6px 0;">${eDesc}</p>
                        ${autoResults ? `<div style="background: #e8ecef; padding: 4px 8px; border-radius: 3px; font-size: 0.85em; border-left: 3px solid #6c757d;"><b>Automation:</b> ${autoResults}</div>` : ""}
                    </div>`;
            }
            dmDetailedHtml += `</div>`;

            let notableEventsStr = publicSummaryEvents.length > 0 ? publicSummaryEvents.join(", ") : "None (All Is Well)";
            pubHtml += `
                <div style="padding: 6px; background: rgba(0,0,0,0.05); border-radius: 4px; text-align: center; margin-bottom: 10px;">
                    <b style="color: #444;"><i class="fa-solid fa-broom"></i> Bastion Maintained</b><br>
                    <span style="font-size: 0.85em; color: #666;">No specific orders issued.</span>
                </div>
                <h4 style="margin-bottom: 5px; border-bottom: 1px solid #ccc;">Summary:</h4>
                <p style="font-size: 0.95em;"><b>Notable Events:</b> ${notableEventsStr}</p>`;

        } else {
            pubHtml += `
                <h4 style="margin-bottom: 5px; border-bottom: 1px solid #ccc;">Executed Orders:</h4>
                <ul style="list-style: none; padding: 0; margin: 0; font-size: 0.95em;">${res.orderSummary || "<li>No facilities built.</li>"}</ul>`;
        }
        pubHtml += `</div>`;

        ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: pubHtml });

        if (allMaintaining) {
            ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), whisper: ChatMessage.getWhisperRecipients("GM"), content: dmDetailedHtml });
            if (game.user.isGM) {
                const { DialogV2 } = foundry.applications.api;
                DialogV2.prompt({ window: { title: "Bastion Report", width: 450 }, content: dmDetailedHtml, ok: { label: "Close" } });
            }
        }
    }
}