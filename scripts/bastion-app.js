const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const BASTION_ORDERS = ["Maintain", "Craft", "Harvest", "Recruit", "Research", "Trade", "Empower"];

export class BastionManager extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(actor, options = {}) { super(options); this.actor = actor; }
    static DEFAULT_OPTIONS = {
        id: "bastion-manager", classes: ["bastion-app"], tag: "form",
        window: { title: "Bastion Management", icon: "fa-solid fa-chess-rook", resizable: true },
        position: { width: 450, height: "auto" },
        actions: { 
            advanceTurn: BastionManager.onAdvanceTurn, 
            buildFromDropdown: BastionManager.onBuildFromDropdown, 
            deleteFacility: BastionManager.onDeleteFacility, 
            resetTurns: BastionManager.onResetTurns,
            upgradeFacility: BastionManager.onUpgradeFacility,
            maintainAll: BastionManager.onMaintainAll
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
        const bastionData = this.actor.getFlag("dnd-2024-bastion-manager", "data") || { turnCount: 0 };
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

            if (fac.name.includes("Garden")) availableOrders.push("Change Type");

            const safeOrder = availableOrders.includes(currentOrder) ? currentOrder : "Maintain";
            const hasOrders = availableOrders.length > 1;

            return {
                id: fac.id, name: fac.isInherited ? `${fac.name} (${fac.ownerName})` : fac.name,
                hirelings: hirelingsDisplay, defenderCount: facDefenders.count > 0 ? facDefenders.count : null,
                size: facSize, subType: facSubType,
                img: fac.sourceDoc.img, isInherited: fac.isInherited, isFlag: fac.isFlag, memberId: fac.memberActor?.id || null,
                hasOrders: hasOrders,
                orderOptions: availableOrders.map(order => ({ value: order, label: order, selected: order === safeOrder }))
            };
        });

        let compendiumFacilities = [];
        const pack = game.packs.get("dnd-2024-bastion-manager.bastion-facilities");
        if (pack) {
            const index = await pack.getIndex();
            compendiumFacilities = index.contents.sort((a, b) => a.name.localeCompare(b.name));
        }

        // Force the setting to resolve as an integer so the math works
        const requiredRole = parseInt(game.settings.get("dnd-2024-bastion-manager", "advancePermission")) || 4;
        const canAdvanceTurn = game.user.role >= requiredRole;

        return { 
            actor: this.actor, turnCount: bastionData.turnCount || 0, 
            totalDefenders, defenderNames: allDefenderNames.join(", "), 
            facilities, compendiumFacilities,
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
                    const chosenType = await DialogV2.prompt({
                        window: { title: "Select Target Garden Type" },
                        content: `<p>What type of Garden are you changing to?</p>
                                  <select name="gardenType" style="width: 100%;">
                                      <option value="Decorative">Decorative</option>
                                      <option value="Food">Food</option>
                                      <option value="Herb">Herb</option>
                                      <option value="Poison">Poison</option>
                                  </select>`,
                        ok: { callback: (event, button) => button.form.elements.gardenType.value }
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
        const confirm = await DialogV2.confirm({ window: { title: "Reset Bastion Turns" }, content: `<p>Reset turns to 0 for <b>${this.actor.name}</b>?</p>`, rejectClose: false, modal: true });
        if (confirm) { await this.actor.setFlag("dnd-2024-bastion-manager", "data.turnCount", 0); this.render(); }
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

        if (itemDoc.name === "Garden") {
            const chosenType = await DialogV2.prompt({
                window: { title: "Select Garden Type" },
                content: `<p>What type of Garden are you planting?</p>
                          <select name="gardenType" style="width: 100%;">
                              <option value="Decorative">Decorative</option>
                              <option value="Food">Food</option>
                              <option value="Herb">Herb</option>
                              <option value="Poison">Poison</option>
                          </select>`,
                ok: { callback: (event, button) => button.form.elements.gardenType.value }
            });
            if (chosenType) foundry.utils.setProperty(newFacData, "flags.dnd-2024-bastion-manager.subType", chosenType);
        }

        let expectedHirelings = 0;
        const hData = itemDoc.system?.hireling || itemDoc.system?.hirelings || itemDoc.system?.details?.hireling || itemDoc.system?.details?.hirelings;

        if (typeof hData === "number") expectedHirelings = hData;
        else if (typeof hData === "string") expectedHirelings = parseInt(hData) || 0;
        else if (typeof hData === "object" && hData !== null) expectedHirelings = parseInt(hData.max) || parseInt(hData.value) || 0;

        if (expectedHirelings > 0 && game.settings.get("dnd-2024-bastion-manager", "nameHirelings")) {
            let inputFields = "";
            for (let i = 0; i < expectedHirelings; i++) {
                inputFields += `<div style="margin-bottom: 8px; display: flex; align-items: center; gap: 10px;">
                                    <label style="width: 80px;">Hireling ${i+1}:</label>
                                    <input type="text" name="hireling_${i}" value="" style="flex-grow: 1;">
                                </div>`;
            }

            const chosenNames = await DialogV2.prompt({
                window: { title: `Name Hirelings (${itemDoc.name})` },
                content: `<p>This facility requires <b>${expectedHirelings}</b> hireling(s). Please name them:</p>${inputFields}`,
                ok: { callback: (event, button) => {
                    let names = [];
                    for(let i = 0; i < expectedHirelings; i++) {
                        let val = button.form.elements[`hireling_${i}`].value.trim();
                        if (val) names.push(val);
                    }
                    return names;
                }}
            });
            
            if (chosenNames && chosenNames.length > 0) {
                foundry.utils.setProperty(newFacData, "flags.dnd-2024-bastion-manager.hirelings", chosenNames);
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
    static async onAdvanceTurn(event, target) {
        const turnsInput = this.element.querySelector('input[name="turns"]');
        const turnsToAdvance = parseInt(turnsInput?.value) || 1;
        
        // Hand off to the standalone logic engine
        await BastionManager.executeBastionTurn(this.actor, turnsToAdvance);
        this.render(); 
    }

    // --- THE STANDALONE ENGINE ---
    static async executeBastionTurn(actor, turnsToAdvance) {
        const bastionData = actor.getFlag("dnd-2024-bastion-manager", "data") || { turnCount: 0 };
        const newTurnCount = (bastionData.turnCount || 0) + turnsToAdvance;

        // 1. Gather Facilities
        let activeFacilities = BastionManager._getActorFacilities(actor);
        if (activeFacilities.length === 0) return ui.notifications.warn("No facilities found.");

        let allMaintaining = activeFacilities.every(fac => 
            (fac.isFlag ? fac.doc.flags?.["dnd-2024-bastion-manager"]?.order : fac.doc.getFlag("dnd-2024-bastion-manager", "order")) === "Maintain"
            || (fac.isFlag ? fac.doc.flags?.["dnd-2024-bastion-manager"]?.order : fac.doc.getFlag("dnd-2024-bastion-manager", "order")) === undefined
        );

        let globalDefenders = activeFacilities.reduce((sum, fac) => sum + (fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.defenders?.count || 0) : (fac.doc.getFlag("dnd-2024-bastion-manager", "defenders.count") || 0)), 0);
        let hasSmithy = activeFacilities.some(fac => fac.doc.name.includes("Smithy"));
        let actorLevel = (actor.type === "character" || actor.type === "npc") ? (actor.system.details?.level || 1) : 1;

        // 2. Resolve Orders
        const resolution = await BastionManager._resolveOrders(actor, activeFacilities, turnsToAdvance, globalDefenders, hasSmithy, actorLevel);
        
        // 3. Process Inventory & Currency
        await actor.setFlag("dnd-2024-bastion-manager", "data.turnCount", newTurnCount);
        if (resolution.totalGold !== 0) {
            const finalGold = Math.max(0, (actor.system.currency?.gp || 0) + resolution.totalGold); 
            await actor.update({ "system.currency.gp": finalGold });
        }
        await BastionManager._processInventory(actor, resolution.items);

        // 4. Generate Output
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
            
            // Save state back to DB
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
        }

        if (possible.length === 0) return { item: null, text: `No valid items found for ${subType}.` };
        
        let chosen = possible[0];
        if (possible.length > 1) {
            // Because we decoupled UI, we have to randomly select or pick the first if automated. 
            // For full UI prompts during logic runs, you'd need a robust async dialog queue. 
            // For now, we default to the first valid item to prevent infinite async hangs in a global loop.
            chosen = possible[0]; 
        }
        
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
        let dmHtml = `<div style="font-family: var(--font-primary);"><h2 style="border-bottom: 2px solid #a32a22;">DM Bastion Report</h2><p><b>${actor.name}</b> maintained their Bastion for <b>${turns}</b> turn(s).</p><hr>`;
        let pubHtml = `<div class="bastion-chat-card"><h3 style="border-bottom: 2px solid #a32a22;">Bastion Turn Advanced</h3><p>${actor.name} advanced their Bastion by <b>${turns}</b> turn(s).</p>`;

        if (allMaintaining) {
            let events = [];
            for (let t = 0; t < turns; t++) {
                const roll = (await new Roll("1d100").evaluate()).total;
                let cat = roll <= 50 ? "All Is Well" : (roll <= 55 ? "Attack" : (roll <= 58 ? "Criminal Hireling" : (roll <= 63 ? "Extraordinary Opportunity" : (roll <= 72 ? "Friendly Visitors" : (roll <= 76 ? "Guest" : (roll <= 79 ? "Lost Hirelings" : (roll <= 83 ? "Magical Discovery" : (roll <= 91 ? "Refugees" : (roll <= 98 ? "Request for Aid" : "Treasure")))))))));
                if (cat !== "All Is Well") events.push(cat);
                dmHtml += `<p>🎲 <b>${roll}</b> — <em>${cat}</em></p>`;
            }
            pubHtml += `<b>Notable Events:</b> ${events.length > 0 ? events.join(", ") : "None"}`;
        } else {
            pubHtml += `<h4>Executed Orders:</h4><ul style="list-style: none; padding: 0;">${res.orderSummary}</ul>`;
        }

        ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: pubHtml + `</div>` });
        if (allMaintaining) {
            ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), whisper: ChatMessage.getWhisperRecipients("GM"), content: dmHtml + `</div>` });
            if (game.user.isGM) DialogV2.prompt({ window: { title: "Bastion Report", width: 450 }, content: dmHtml, ok: { label: "Close" } });
        }
    }
}