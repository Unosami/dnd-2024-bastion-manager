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

        return { 
            actor: this.actor, turnCount: bastionData.turnCount || 0, 
            totalDefenders, defenderNames: allDefenderNames.join(", "), 
            facilities, compendiumFacilities 
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

    static async onAdvanceTurn(event, target) {
        const turnsInput = this.element.querySelector('input[name="turns"]');
        const turnsToAdvance = parseInt(turnsInput?.value) || 1;
        const bastionData = this.actor.getFlag("dnd-2024-bastion-manager", "data") || { turnCount: 0 };
        const newTurnCount = (bastionData.turnCount || 0) + turnsToAdvance;

        let activeFacilities = [];
        this.actor.items.filter(item => item.type === "facility").forEach(i => activeFacilities.push({ doc: i, name: i.name, isFlag: false }));
        
        if (this.actor.type === "group") {
            const flagFacs = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
            flagFacs.forEach(f => activeFacilities.push({ doc: f, name: f.name, isFlag: true }));
            if (game.settings.get("dnd-2024-bastion-manager", "groupInheritsFacilities")) {
                const members = this.actor.system.members || [];
                for (const member of members) {
                    const memberActor = member.actor || member;
                    if (memberActor && memberActor.items) {
                        memberActor.items.filter(item => item.type === "facility").forEach(i => activeFacilities.push({ doc: i, name: `${i.name} (${memberActor.name})`, isFlag: false }));
                    }
                }
            }
        }

        let allMaintaining = activeFacilities.length > 0;
        for (const fac of activeFacilities) {
            let currentOrder = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.order || "Maintain") : (fac.doc.getFlag("dnd-2024-bastion-manager", "order") || "Maintain");
            if (currentOrder !== "Maintain") {
                allMaintaining = false;
                break;
            }
        }

        let globalDefenders = 0;
        for (const fac of activeFacilities) {
            let count = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.defenders?.count || 0) : (fac.doc.getFlag("dnd-2024-bastion-manager", "defenders.count") || 0);
            globalDefenders += count;
        }

        const hasSmithy = activeFacilities.some(fac => fac.doc.name.includes("Smithy"));
        let actorLevel = (this.actor.type === "character" || this.actor.type === "npc") ? (this.actor.system.details?.level || 1) : 1;

        let orderSummary = "";
        let totalGoldGenerated = 0;
        let itemsToGenerate = [];

        for (const fac of activeFacilities) {
            let currentOrder = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.order || "Maintain") : (fac.doc.getFlag("dnd-2024-bastion-manager", "order") || "Maintain");
            let baseName = fac.doc.name; 
            
            let facDefendersCount = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.defenders?.count || 0) : (fac.doc.getFlag("dnd-2024-bastion-manager", "defenders.count") || 0);
            let facDefenderNames = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.defenders?.names || []) : (fac.doc.getFlag("dnd-2024-bastion-manager", "defenders.names") || []);
            let facSubType = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.subType) : (fac.doc.getFlag("dnd-2024-bastion-manager", "subType"));
            let facProgress = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.progress || 0) : (fac.doc.getFlag("dnd-2024-bastion-manager", "progress") || 0);
            let facHarvestChoice = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.lastHarvestChoice) : (fac.doc.getFlag("dnd-2024-bastion-manager", "lastHarvestChoice"));

            let resultText = "";
            let localGold = 0;

            for (let i = 0; i < turnsToAdvance; i++) {
                switch (currentOrder) {
                    case "Maintain": 
                        resultText = "Maintained standard operations."; 
                        break;
                    
                    case "Change Type":
                        let pendingSubType = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.pendingSubType) : (fac.doc.getFlag("dnd-2024-bastion-manager", "pendingSubType"));
                        if (!pendingSubType) pendingSubType = "Decorative"; 

                        facProgress += 1;
                        if (facProgress >= 3) {
                            facSubType = pendingSubType;
                            facProgress = 0;
                            currentOrder = "Maintain"; 
                            resultText = `Completed changing type to <b>[${facSubType}]</b>.`;
                        } else {
                            resultText = `Changing type to [${pendingSubType}] (Progress: ${facProgress}/3 turns).`;
                        }
                        break;

                    case "Trade":
                        if (baseName === "Armory") {
                            let armoryCost = 100 + (100 * globalDefenders);
                            if (hasSmithy) armoryCost = Math.floor(armoryCost / 2);
                            localGold -= armoryCost;
                            resultText = `Stocked the Armory for ${globalDefenders} total defenders.`;
                        } else if (baseName === "Storehouse") {
                            let buyLimit = actorLevel >= 13 ? 5000 : (actorLevel >= 9 ? 2000 : 500);
                            let sellMarkup = actorLevel >= 17 ? 100 : (actorLevel >= 13 ? 50 : (actorLevel >= 9 ? 20 : 10));
                            resultText = `Requires Decision: Procure up to <b>${buyLimit} GP</b> in goods, OR sell stored goods at a <b>+${sellMarkup}%</b> profit.`;
                        } else {
                            const tradeRoll = await new Roll("1d6 * 10").evaluate();
                            localGold += tradeRoll.total;
                            resultText = `Generated ${tradeRoll.total} GP.`;
                        }
                        break;

                    case "Harvest":
                        const outPack = game.packs.get("dnd-2024-bastion-manager.bastion-output-items");
                        let folderFound = false;

                        if (outPack) {
                            const allDocs = await outPack.getDocuments();
                            const matchingFolder = outPack.folders.find(f => f.name === baseName);
                            
                            if (matchingFolder) {
                                folderFound = true;
                                let possibleItems = allDocs.filter(item => item.folder?.id === matchingFolder.id);
                                
                                if (baseName === "Garden" && facSubType) {
                                    let allowedKeywords = [];
                                    if (facSubType === "Decorative") allowedKeywords = ["bouquet", "perfume", "candle"];
                                    else if (facSubType === "Food") allowedKeywords = ["ration", "food"];
                                    else if (facSubType === "Herb") allowedKeywords = ["healer", "healing", "herb"];
                                    else if (facSubType === "Poison") allowedKeywords = ["antitoxin", "poison"];
                                    
                                    if (allowedKeywords.length > 0) {
                                        possibleItems = possibleItems.filter(item => allowedKeywords.some(kw => item.name.toLowerCase().includes(kw)));
                                    }
                                }
                                
                                if (possibleItems.length > 0) {
                                    let chosenItem = possibleItems[0];
                                    
                                    if (possibleItems.length > 1) {
                                        let optionsHtml = possibleItems.map(item => {
                                            let isSelected = (item.id === facHarvestChoice) ? "selected" : "";
                                            return `<option value="${item.id}" ${isSelected}>${item.name}</option>`;
                                        }).join("");
                                        
                                        const chosenId = await DialogV2.prompt({
                                            window: { title: `${baseName} Production` },
                                            content: `<p>What is the <b>${fac.name}</b> producing this turn?</p><select name="outputChoice" style="width: 100%;">${optionsHtml}</select>`,
                                            ok: { callback: (event, button) => button.form.elements.outputChoice.value }
                                        });
                                        
                                        if (chosenId) {
                                            chosenItem = possibleItems.find(item => item.id === chosenId) || chosenItem;
                                            facHarvestChoice = chosenId; 
                                        }
                                    }
                                    
                                    let itemObj = chosenItem.toObject();
                                    itemsToGenerate.push(itemObj);
                                    let yieldQty = itemObj.system?.quantity || 1;

                                    let existingItem = this.actor.items.find(i => i.name === itemObj.name && i.type === itemObj.type);
                                    let containerText = "";
                                    if (existingItem && existingItem.system?.container) {
                                        let containerDoc = this.actor.items.get(existingItem.system.container);
                                        if (containerDoc) containerText = ` <em style="color:#666; font-size: 0.9em;">(stacked in ${containerDoc.name})</em>`;
                                    }
                                    
                                    resultText = `Harvested ${yieldQty}x ${itemObj.name}${containerText}.`;
                                } else {
                                    resultText = `${baseName} harvest failed (no valid items found for ${facSubType}).`;
                                }
                            }
                        }

                        if (!folderFound) {
                            const harvestRoll = await new Roll("1d4 + 1").evaluate();
                            itemsToGenerate.push({ name: `Harvested Materials (${fac.name})`, type: "loot", img: "icons/commodities/materials/wood-log-brown.webp", system: { quantity: harvestRoll.total, description: { value: "Raw materials harvested." } } });
                            
                            let existMat = this.actor.items.find(i => i.name === `Harvested Materials (${fac.name})` && i.type === "loot");
                            let matContainer = "";
                            if (existMat && existMat.system?.container) {
                                let cDoc = this.actor.items.get(existMat.system.container);
                                if (cDoc) matContainer = ` <em style="color:#666; font-size: 0.9em;">(stacked in ${cDoc.name})</em>`;
                            }
                            resultText = `Harvested ${harvestRoll.total} materials${matContainer}.`;
                        }
                        break;

                    case "Recruit":
                        const recruitMode = game.settings.get("dnd-2024-bastion-manager", "recruitMode");
                        let newlyRecruited = 0;

                        if (recruitMode === "max") newlyRecruited = 4;
                        else if (recruitMode === "manual") {
                            newlyRecruited = await DialogV2.prompt({
                                window: { title: "Manual Recruitment" },
                                content: `<p>How many defenders did you recruit for the ${fac.name}?</p><input type="number" name="count" value="0" min="0" autofocus>`,
                                ok: { callback: (event, button) => parseInt(button.form.elements.count.value) || 0 }
                            });
                        } else {
                            const recruitRoll = await new Roll("1d4").evaluate();
                            newlyRecruited = recruitRoll.total;
                        }

                        if (newlyRecruited > 0) {
                            facDefendersCount += newlyRecruited;
                            let newNames = [];
                            
                            if (game.settings.get("dnd-2024-bastion-manager", "nameHirelings")) {
                                for (let d = 0; d < newlyRecruited; d++) {
                                    const defName = await DialogV2.prompt({
                                        window: { title: `Name Defender (${fac.name})` },
                                        content: `<p>Name of recruited Defender #${d + 1}:</p><input type="text" name="defName" value="Defender ${facDefendersCount - newlyRecruited + d + 1}" autofocus>`,
                                        ok: { callback: (event, button) => button.form.elements.defName.value }
                                    });
                                    if (defName) newNames.push(defName);
                                }
                            }
                            
                            if (newNames.length > 0) facDefenderNames.push(...newNames);

                            if (fac.isFlag) {
                                const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                                const groupFac = groupFacilities.find(f => f._id === fac.doc._id);
                                if (groupFac) {
                                    if(!groupFac.flags) groupFac.flags = {};
                                    if(!groupFac.flags["dnd-2024-bastion-manager"]) groupFac.flags["dnd-2024-bastion-manager"] = {};
                                    groupFac.flags["dnd-2024-bastion-manager"].defenders = { count: facDefendersCount, names: facDefenderNames };
                                    await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacilities);
                                }
                            } else {
                                await fac.doc.setFlag("dnd-2024-bastion-manager", "defenders", { count: facDefendersCount, names: facDefenderNames });
                            }

                            resultText = `Recruited <b>${newlyRecruited}</b> Bastion Defender(s).`;
                            if (newNames.length > 0) resultText += ` <em style="color:#555;">(${newNames.join(", ")})</em>`;
                        } else {
                            resultText = "Recruited 0 defenders.";
                        }
                        break;

                    default: 
                        resultText = `Executed ${currentOrder} order.`;
                }
            }

            if (currentOrder === "Trade" && baseName === "Armory") {
                resultText = `Spent <b>${Math.abs(localGold)} GP</b> to stock the armory for all ${globalDefenders} defenders.`;
                totalGoldGenerated += localGold;
            } else if (currentOrder === "Trade" && baseName !== "Storehouse") {
                resultText = `Generated a total of <b>${localGold} GP</b>.`;
                totalGoldGenerated += localGold;
            }

            if (fac.isFlag) {
                const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                const groupFac = groupFacilities.find(f => f._id === fac.doc._id);
                if (groupFac) {
                    if(!groupFac.flags) groupFac.flags = {};
                    if(!groupFac.flags["dnd-2024-bastion-manager"]) groupFac.flags["dnd-2024-bastion-manager"] = {};
                    groupFac.flags["dnd-2024-bastion-manager"].defenders = { count: facDefendersCount, names: facDefenderNames };
                    groupFac.flags["dnd-2024-bastion-manager"].subType = facSubType;
                    groupFac.flags["dnd-2024-bastion-manager"].progress = facProgress;
                    groupFac.flags["dnd-2024-bastion-manager"].order = currentOrder;
                    groupFac.flags["dnd-2024-bastion-manager"].lastHarvestChoice = facHarvestChoice;
                    await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacilities);
                }
            } else {
                await fac.doc.setFlag("dnd-2024-bastion-manager", "defenders", { count: facDefendersCount, names: facDefenderNames });
                await fac.doc.setFlag("dnd-2024-bastion-manager", "subType", facSubType);
                await fac.doc.setFlag("dnd-2024-bastion-manager", "progress", facProgress);
                await fac.doc.setFlag("dnd-2024-bastion-manager", "order", currentOrder);
                await fac.doc.setFlag("dnd-2024-bastion-manager", "lastHarvestChoice", facHarvestChoice);
            }

            if (!allMaintaining) {
                orderSummary += `
                    <li style="margin-bottom: 6px; padding: 4px; background: rgba(0,0,0,0.03); border-radius: 3px;">
                        <img src="${fac.doc.img}" width="20" height="20" style="vertical-align: middle; border: none; margin-right: 6px; border-radius: 3px;">
                        <b>${fac.name}</b> ${currentOrder !== "Maintain" || fac.hasOrders ? `<em>(${currentOrder})</em>` : ""} <br>
                        <span style="font-size: 0.9em; padding-left: 26px; display: block; color: #444;">${resultText}</span>
                    </li>`;
            }
        }

        await this.actor.setFlag("dnd-2024-bastion-manager", "data.turnCount", newTurnCount);

        if (totalGoldGenerated !== 0) {
            const currentGold = this.actor.system.currency?.gp || 0;
            const finalGold = Math.max(0, currentGold + totalGoldGenerated); 
            await this.actor.update({ "system.currency.gp": finalGold });
            
            let profitText = totalGoldGenerated > 0 
                ? `<p style="color: darkgreen; text-align: center; font-weight: bold;"><i class="fa-solid fa-arrow-trend-up"></i> Total Trade Profit: +${totalGoldGenerated} GP</p>`
                : `<p style="color: darkred; text-align: center; font-weight: bold;"><i class="fa-solid fa-arrow-trend-down"></i> Total Bastion Costs: ${Math.abs(totalGoldGenerated)} GP</p>`;
            orderSummary += `<hr>${profitText}`;
        }

        if (itemsToGenerate.length > 0) {
            let itemsToCreate = [];
            let itemsToUpdate = [];

            for (let newItem of itemsToGenerate) {
                let existingItem = this.actor.items.find(i => i.name === newItem.name && i.type === newItem.type);
                let newQty = newItem.system?.quantity || 1;

                if (existingItem) {
                    let currentQty = existingItem.system?.quantity || 1;
                    let queuedUpdate = itemsToUpdate.find(u => u._id === existingItem.id);
                    if (queuedUpdate) {
                        queuedUpdate["system.quantity"] += newQty;
                    } else {
                        itemsToUpdate.push({ _id: existingItem.id, "system.quantity": currentQty + newQty });
                    }
                } else {
                    let queuedCreate = itemsToCreate.find(c => c.name === newItem.name && c.type === newItem.type);
                    if (queuedCreate) {
                        queuedCreate.system.quantity = (queuedCreate.system?.quantity || 1) + newQty;
                    } else {
                        itemsToCreate.push(newItem);
                    }
                }
            }

            if (itemsToCreate.length > 0) await this.actor.createEmbeddedDocuments("Item", itemsToCreate);
            if (itemsToUpdate.length > 0) await this.actor.updateEmbeddedDocuments("Item", itemsToUpdate);
            
            orderSummary += `<p style="color: darkblue; text-align: center; font-weight: bold; margin: 5px 0;"><i class="fa-solid fa-box-open"></i> Generated items added to inventory!</p>`;
        }

        let publicSummaryEvents = [];
        let dmDetailedHtml = `
            <div style="font-family: var(--font-primary);">
                <h2 style="border-bottom: 2px solid #a32a22; padding-bottom: 3px; margin-bottom: 10px;">DM Bastion Report</h2>
                <p><b>${this.actor.name}</b> maintained their entire Bastion for <b>${turnsToAdvance}</b> turn(s).</p>
                <hr>
        `;

        if (allMaintaining) {
            for (let t = 0; t < turnsToAdvance; t++) {
                const eventRoll = await new Roll("1d100").evaluate();
                const rollTotal = eventRoll.total;
                
                let eCat = ""; let eDesc = ""; let autoResults = "";

                if (rollTotal <= 50) { 
                    eCat = "All Is Well"; 
                    eDesc = "No unusual events occur during this turn. Operations continue peacefully."; 
                }
                else if (rollTotal <= 55) { 
                    eCat = "Attack"; 
                    let attackers = await new Roll("1d6").evaluate();
                    eDesc = "A creature or group of creatures attacks the Bastion. The attackers must be repelled, or facilities may be damaged."; 
                    autoResults = `Rolled <b>${attackers.total}</b> on the DMG attacker table.`;
                    publicSummaryEvents.push(eCat);
                }
                else if (rollTotal <= 58) { 
                    eCat = "Criminal Hireling"; 
                    let crime = await new Roll("1d4").evaluate();
                    let crimeType = ["Extortion", "Fraud", "Smuggling", "Theft"][crime.total - 1];
                    eDesc = "One of the hirelings is secretly engaged in criminal enterprises. You must investigate and handle the fallout."; 
                    autoResults = `Crime Committed: <b>${crimeType}</b> (Rolled ${crime.total}).`;
                    publicSummaryEvents.push(eCat);
                }
                else if (rollTotal <= 63) { 
                    eCat = "Extraordinary Opportunity"; 
                    let opp = await new Roll("1d4").evaluate();
                    let oppType = ["Trade Offer", "Magic Item Sale", "Rare Material", "Investment"][opp.total - 1];
                    eDesc = "A sudden, highly lucrative opportunity arises for the Bastion to capitalize on."; 
                    autoResults = `Opportunity Type: <b>${oppType}</b> (Rolled ${opp.total}).`;
                    publicSummaryEvents.push(eCat);
                }
                else if (rollTotal <= 72) { 
                    eCat = "Friendly Visitors"; 
                    let days = await new Roll("1d4").evaluate();
                    eDesc = "Friendly travelers or allies seek lodging at the Bastion."; 
                    autoResults = `They intend to stay for <b>${days.total}</b> days.`;
                    publicSummaryEvents.push(eCat);
                }
                else if (rollTotal <= 76) { 
                    eCat = "Guest"; 
                    let guest = await new Roll("1d6").evaluate();
                    let guestType = ["Artisan", "Bard", "Cleric", "Mage", "Noble", "Veteran"][guest.total - 1];
                    eDesc = "A notable or highly influential guest arrives, expecting proper hospitality."; 
                    autoResults = `Guest Type: <b>${guestType}</b> (Rolled ${guest.total}).`;
                    publicSummaryEvents.push(eCat);
                }
                else if (rollTotal <= 79) { 
                    eCat = "Lost Hirelings"; 
                    eDesc = "One or more of the hirelings have gone missing. They must be tracked down or replaced."; 
                    autoResults = `Requires DM adjudication to determine who vanished.`;
                    publicSummaryEvents.push(eCat);
                }
                else if (rollTotal <= 83) { 
                    eCat = "Magical Discovery"; 
                    let magic = await new Roll("1d6").evaluate();
                    let magicType = magic.total <= 2 ? "Potion" : (magic.total <= 4 ? "Scroll" : "Minor Wonder");
                    eDesc = "A magical phenomenon or item is discovered on the Bastion grounds."; 
                    autoResults = `Discovery Type: <b>${magicType}</b> (Rolled ${magic.total}).`;
                    publicSummaryEvents.push(eCat);
                }
                else if (rollTotal <= 91) { 
                    eCat = "Refugees"; 
                    let refCount = await new Roll("2d4").evaluate();
                    let refGold = await new Roll("1d6 * 100").evaluate();
                    eDesc = "Displaced people arrive seeking asylum, food, and shelter. They offer to pay for hospitality and protection."; 
                    autoResults = `<b>${refCount.total}</b> refugees arrived. They are willing to pay up to <b>${refGold.total} GP</b>.`;
                    publicSummaryEvents.push(eCat);
                }
                else if (rollTotal <= 98) { 
                    eCat = "Request for Aid"; 
                    eDesc = "A local faction, town, or individual directly asks the Bastion for help with a pressing problem."; 
                    autoResults = `Requires DM narrative design.`;
                    publicSummaryEvents.push(eCat);
                }
                else { 
                    eCat = "Treasure"; 
                    let treas = await new Roll("1d4 * 100").evaluate();
                    eDesc = "A hidden cache of treasure is discovered on or near the premises."; 
                    autoResults = `The cache contains <b>${treas.total} GP</b> worth of valuables.`;
                    publicSummaryEvents.push(eCat);
                }

                let eColor = rollTotal <= 50 ? "darkgreen" : (rollTotal <= 58 || (rollTotal >= 77 && rollTotal <= 79) ? "darkred" : "darkblue");
                let turnLabel = turnsToAdvance > 1 ? `<b>Turn ${t + 1}:</b> ` : "";

                dmDetailedHtml += `
                    <div style="margin-bottom: 12px; padding: 6px; background: rgba(0,0,0,0.03); border: 1px solid #ccc; border-radius: 4px;">
                        <p style="margin: 0; font-size: 1.1em; color: ${eColor};">${turnLabel}🎲 <b>${rollTotal}</b> — <em>${eCat}</em></p>
                        <p style="font-size: 0.9em; color: #333; margin: 4px 0 6px 0;">${eDesc}</p>
                        ${autoResults ? `<div style="background: #e8ecef; padding: 4px 8px; border-radius: 3px; font-size: 0.85em; border-left: 3px solid #6c757d;"><b>Automation:</b> ${autoResults}</div>` : ""}
                    </div>`;
            }
            dmDetailedHtml += `</div>`;
        }

        let publicChatContent = `
            <div class="bastion-chat-card">
                <h3 style="border-bottom: 2px solid #a32a22; padding-bottom: 3px; margin-bottom: 10px;">Bastion Turn Advanced</h3>
                <p style="margin-bottom: 10px;">${this.actor.name} advanced their Bastion by <b>${turnsToAdvance}</b> turn(s).</p>`;

        if (allMaintaining) {
            let notableEventsStr = publicSummaryEvents.length > 0 ? publicSummaryEvents.join(", ") : "None (All Is Well)";
            publicChatContent += `
                <div style="padding: 6px; background: rgba(0,0,0,0.05); border-radius: 4px; text-align: center; margin-bottom: 10px;">
                    <b style="color: #444;"><i class="fa-solid fa-broom"></i> Bastion Maintained</b><br>
                    <span style="font-size: 0.85em; color: #666;">No specific orders issued.</span>
                </div>
                <h4 style="margin-bottom: 5px; border-bottom: 1px solid #ccc;">Summary:</h4>
                <p style="font-size: 0.95em;"><b>Notable Events:</b> ${notableEventsStr}</p>`;
        } else {
            publicChatContent += `
                <h4 style="margin-bottom: 5px; border-bottom: 1px solid #ccc;">Executed Orders:</h4>
                <ul style="list-style: none; padding: 0; margin: 0; font-size: 0.95em;">${orderSummary || "<li>No facilities built.</li>"}</ul>`;
        }
        publicChatContent += `</div>`;

        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: publicChatContent
        });

        if (allMaintaining) {
            ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                whisper: ChatMessage.getWhisperRecipients("GM"),
                content: dmDetailedHtml
            });

            if (game.user.isGM) {
                DialogV2.prompt({
                    window: { title: "Bastion Report", width: 450 },
                    content: dmDetailedHtml,
                    ok: { label: "Close" }
                });
            } else {
                game.socket.emit("module.dnd-2024-bastion-manager", {
                    action: "gmBastionReport",
                    html: dmDetailedHtml
                });
            }
        }

        this.render(); 
    }
}