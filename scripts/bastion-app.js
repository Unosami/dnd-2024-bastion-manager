const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const BASTION_ORDERS = ["Maintain", "Craft", "Harvest", "Recruit", "Research", "Trade", "Empower"];

// Hardcoded Utility & Tool Utilize Effects for Logistics Panel
const UTILITY_DESCRIPTIONS = {
    "Alchemist's Supplies": "Identify a substance (DC 15), or start a fire (DC 15)",
    "Brewer's Supplies": "Detect poisoned drink (DC 15), or identify alcohol (DC 10)",
    "Calligrapher's Supplies": "Write text with impressive flourishes that guard against forgery (DC 15)",
    "Carpenter's Tools": "Seal or pry open a door or container (DC 20)",
    "Cartographer's Tools": "Draft a map of a small area (DC 15)",
    "Cobbler's Tools": "Modify footwear to give Advantage on the wearer's next Dexterity (Acrobatics) check (DC 10)",
    "Cook's Utensils": "Improve food's flavor (DC 10), or detect spoiled or poisoned food (DC 15)",
    "Glassblower's Tools": "Discern what a glass object held in the past 24 hours (DC 15)",
    "Jeweler's Tools": "Discern a gem's value (DC 15)",
    "Leatherworker's Tools": "Add a design to a leather item (DC 10)",
    "Mason's Tools": "Chisel a symbol or hole in stone (DC 10)",
    "Painter's Tools": "Paint a recognizable image of something you've seen (DC 10)",
    "Potter's Tools": "Discern what a ceramic object held in the past 24 hours (DC 15)",
    "Smith's Tools": "Pry open a door or container (DC 20)",
    "Tinker's Tools": "Assemble a Tiny item composed of scrap, which falls apart in 1 minute (DC 20)",
    "Weaver's Tools": "Mend a tear in clothing (DC 10), or sew a Tiny design (DC 10)",
    "Woodcarver's Tools": "Carve a pattern in wood (DC 10)",
    "Thieves' Tools": "Pick a lock (DC 15), or disarm a trap (DC 15)",
    "Arcane Spellcasting": "Cast 'Identify' (Charm) after Long Rest. Level 9+ hireling assists with magic item crafting.",
    "Sacred Spellcasting": "Cast 'Healing Word' (Charm) or 'Greater Restoration' (Reliquary). Access to spell slot refreshment.",
    "Expert Recruiter": "Recruit friendly NPC spellcasters who can cast Wizard spells (up to level 8)."
};
const FACILITY_CONFIG = {
    "Garden": {
        type: "specialization"
    },
    "Workshop": {
        type: "tools",
        options: [
            "Carpenter's Tools", "Cobbler's Tools", "Glassblower's Tools", "Jeweler's Tools", "Leatherworker's Tools", 
            "Mason's Tools", "Painter's Tools", "Potter's Tools", "Tinker's Tools", "Weaver's Tools", "Woodcarver's Tools"
        ]
    }
};

export class BastionManager extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(actor, options = {}) { 
        super(options); 
        this.actor = actor; 
        this._activeTab = "map";
        this._queueStates = {};
        this._changingOrders = new Set();
    }
    static DEFAULT_OPTIONS = {
        id: "bastion-manager", classes: ["bastion-app"], tag: "form",
        window: { title: "Bastion Management", icon: "fa-solid fa-chess-rook", resizable: true },
        position: { width: 850, height: 600 },
        actions: { 
            buildFromDropdown: BastionManager.onBuildFromDropdown, 
            deleteFacility: BastionManager.onDeleteFacility, 
            upgradeFacility: BastionManager.onUpgradeFacility,
            maintainAll: BastionManager.onMaintainAll,
            advanceGlobalTurn: BastionManager.onAdvanceGlobalTurn,
            viewBastionMap: BastionManager.onViewBastionMap,
            buildDefensiveWall: BastionManager.onBuildDefensiveWall,
            selectFacilityLayout: BastionManager.onSelectFacilityLayout,
            clearLayout: BastionManager.onClearLayout,
            saveLayout: BastionManager.onSaveLayout,
            toggleCombine: BastionManager.onToggleCombine,
            changeBackground: function(event, target) { this.onChangeBackground(event, target); },
            initializeBastion: BastionManager.onInitializeBastion,
            toggleBarrackNaming: BastionManager.onToggleBarrackNaming,
            abandonBastion: BastionManager.onAbandonBastion,
            previewItem: BastionManager.onPreviewItem,
            addToQueue: BastionManager.onAddToQueue,
            removeFromQueue: BastionManager.onRemoveFromQueue,
            toggleAutoTrade: BastionManager.onToggleAutoTrade,
            donateToStorehouse: BastionManager.onDonateToStorehouse,
            clearQueue: BastionManager.onClearQueue,
            switchTab: BastionManager.onSwitchTab,
            changeOrder: BastionManager.onChangeOrder,
        }
    };
    static PARTS = { main: { template: "modules/dnd-2024-bastion-manager/templates/bastion-main.hbs" } };

    /**
     * Recursively collects all folder IDs under a given parent folder.
     * @param {CompendiumCollection} pack The compendium collection.
     * @param {string} parentFolderId The ID of the parent folder.
     * @returns {string[]} An array of all folder IDs, including the parent.
     */
    static _getAllSubfolderIds(pack, parentFolderId) {
        const subfolders = pack.folders.filter(f => {
            const pid = f.parentId || f.folder?.id || f.folder;
            return pid === parentFolderId;
        });
        return [parentFolderId, ...subfolders.flatMap(f => BastionManager._getAllSubfolderIds(pack, f.id))];
    }

    /**
     * Returns standard crafting time and gold costs based on item rarity.
     */
    static _getMagicItemRequirements(rarity) {
        const r = String(rarity || "common").toLowerCase();
        const table = {
            "common": { days: 5, gp: 50 },
            "uncommon": { days: 10, gp: 200 },
            "rare": { days: 50, gp: 2000 },
            "veryrare": { days: 125, gp: 20000 },
            "very rare": { days: 125, gp: 20000 },
            "legendary": { days: 250, gp: 100000 },
            "artifact": { days: 500, gp: 500000 }
        };
        return table[r] || table.common;
    }

    /**
     * Recursively builds a nested option structure for select menus matching folder hierarchy.
     */
    static async _getNestedCompendiumOptions(pack, rootFolderId, selectedValue, calculationMode, daysPerTurn, progressLabel, isMagicItem = true, folderNamesFilter = null, folderNamesExclude = null) {
        const index = await pack.getIndex({ fields: ["folder", "system.rarity", "system.price", "system.quantity", "system.requirements.level"] });
        const allRelevantFolderIds = BastionManager._getAllSubfolderIds(pack, rootFolderId);
        
        let rootItems = [];
        let subGroups = [];

        for (const fId of allRelevantFolderIds) {
            const folder = pack.folders.get(fId);
            if (!folder) continue;

            // Filter folders by tools if a filter is provided (used for Workshop mundane gear)
            if (folderNamesFilter && String(fId) !== String(rootFolderId) && !folderNamesFilter.includes(folder.name)) continue;
            
            // Exclude folders (used to keep Magic Items out of mundane lists). Checks full hierarchy.
            if (folderNamesExclude) {
                let check = folder;
                let excluded = false;
                while (check && !excluded) { if (check.name.toLowerCase().includes(folderNamesExclude.toLowerCase())) excluded = true; check = check.parentId ? pack.folders.get(check.parentId) : null; }
                if (excluded) continue;
            }

            // Support both string IDs and folder objects found in different index schemas
            const items = index.filter(i => {
                let itemFolderId = i.folder?.id || i.folder;
                if ( !itemFolderId ) return false;
                if ( typeof itemFolderId !== "string" ) itemFolderId = String(itemFolderId);
                return itemFolderId === String(fId) || itemFolderId.endsWith(`.${fId}`);
            });
            if (items.length === 0) continue;

            const processedItems = items.map(i => {
                const rarity = i.system.rarity || "common";
                let price = i.system.price?.value ?? i.system.price ?? 0;
                if (typeof price === "string") price = parseFloat(price.replace(/[^0-9.]/g, "")) || 0;
                const qty = i.system.quantity || 1;

                let days, gp;
                if (isMagicItem) {
                    const reqs = BastionManager._getMagicItemRequirements(rarity);
                    days = reqs.days;
                    gp = reqs.gp;
                } else {
                    days = Math.max(1, Math.ceil(Number(price) / 10));
                    gp = Math.floor(Number(price) / 2);
                }

                const tCount = calculationMode === "days" ? days : Math.ceil(days / daysPerTurn);
                return {
                    value: i.name,
                    label: `${i.name} (${rarity.charAt(0).toUpperCase() + rarity.slice(1)}: ${gp} GP, ${tCount} ${progressLabel})${qty > 1 ? ` [x${qty}]` : ''}`,
                    selected: i.name === selectedValue,
                    rarity,
                    time: tCount,
                    price: gp,
                    uuid: i.uuid || `Compendium.dnd-2024-bastion-manager.bastion-output-items.Item.${i._id || i.id}`
                };
            });

            const sortedItems = processedItems.sort((a,b) => a.label.localeCompare(b.label));

            if (String(fId) === String(rootFolderId)) {
                rootItems = sortedItems;
            } else {
                subGroups.push({ label: folder.name, groupOptions: sortedItems });
            }
        }
        
        subGroups.sort((a,b) => a.label.localeCompare(b.label));
        return [...rootItems, ...subGroups];
    }

    _getUnifiedFacilities() {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const combinedGroupId = this.actor.getFlag(MODULE_ID, "combinedGroupId");
        const combinedGroup = combinedGroupId ? game.actors.get(combinedGroupId) : null;
        
        // If we are a character combined with a group, we need the Group's unified view 
        // to render the shared layout grid, but we must preserve our own ownership.
        const effectiveActor = (this.actor.type !== "group" && combinedGroup) ? combinedGroup : this.actor;

        if (!effectiveActor) return [];

        let rawFacilities = [];
        const actorsToCheck = [effectiveActor];
        if (effectiveActor.type === "group" && game.settings.get(MODULE_ID, "groupInheritsFacilities")) {
            for (const m of (effectiveActor.system.members || [])) {
                const mActor = m.actor || m;
                if (mActor && mActor.id !== effectiveActor.id) actorsToCheck.push(mActor);
            }
        }

        for (const act of actorsToCheck) {
            const isMine = act.id === this.actor.id || (this.actor.type === "group" && act.id === this.actor.id);
            const inherited = !isMine;

            // Get Items
            act.items.filter(i => i.type === "facility").forEach(item => {
                rawFacilities.push({ sourceDoc: item, isInherited: inherited, isFlag: false, name: item.name, id: item.id, ownerName: act.name, memberActor: act });
            });

            // Get Flags (Facilities under construction)
            const flags = act.getFlag(MODULE_ID, "groupFacilities") || [];
            flags.forEach(f => {
                rawFacilities.push({ sourceDoc: f, isInherited: inherited, isFlag: true, name: f.name, id: f._id, ownerName: act.name, memberActor: act });
            });
        }

        return rawFacilities;
    }

    async _prepareContext(options) {
        const globalTurnCount = game.settings.get("dnd-2024-bastion-manager", "globalTurnCount") || 0;
        const rawFacilities = this._getUnifiedFacilities();
        const MODULE_ID = "dnd-2024-bastion-manager";

        const wallCount = this.actor.getFlag(MODULE_ID, "completedWalls") || 0;
        const wallDays = this.actor.getFlag(MODULE_ID, "pendingWallDays") || 0;
        const mapSceneId = this.actor.getFlag(MODULE_ID, "mapSceneId");
        const hasMap = !!game.scenes.get(mapSceneId);
        
        const combinedGroupId = this.actor.getFlag(MODULE_ID, "combinedGroupId");
        const combinedGroup = combinedGroupId ? game.actors.get(combinedGroupId) : null;
        const layoutActor = combinedGroup || this.actor;
        const isGroupMode = this.actor.type === "group" || !!combinedGroup;

        const pack = game.packs.get("dnd-2024-bastion-manager.bastion-facilities");
        const SPECIAL_ROOT_ID = "jvwwGTr0bMORqJD4";
        const BASIC_ROOT_ID = "oocJkCsQvkXOWJbL";
        
        // Robust root folder detection: Try ID first, then fallback to name search
        const basicRoot = pack?.folders.get(BASIC_ROOT_ID) || pack?.folders.find(f => f.name.toLowerCase().includes("basic"));
        const basicFolderIds = basicRoot ? BastionManager._getAllSubfolderIds(pack, basicRoot.id) : [];

        const isBasicFac = (facDoc) => {
            const folderId = facDoc.folder?.id || facDoc.folder;
            const typeValue = facDoc.system?.type?.value;
            return basicFolderIds.includes(folderId) || typeValue === "basic" || facDoc.name?.toLowerCase().includes("basic");
        };

        const neglectCounter = this.actor.getFlag(MODULE_ID, "neglectCounter") || 0;
        const actorLevel = (this.actor.type === "character" || this.actor.type === "npc") ? (this.actor.system.details?.level || 1) : 1;
        const disableNeglect = game.settings.get(MODULE_ID, "disableNeglect");
        const disableSpecialCap = game.settings.get(MODULE_ID, "disableSpecialCap");
        const disableDuplicateLimit = game.settings.get(MODULE_ID, "disableDuplicateLimit");
        const ignoreFacilityPrereqs = game.settings.get(MODULE_ID, "ignoreFacilityPrereqs");

        // Special Facility Cap (DMG 2024 Rules)
        let specCap = 0;
        if (actorLevel >= 17) specCap = 6;
        else if (actorLevel >= 13) specCap = 5;
        else if (actorLevel >= 9) specCap = 4;
        else if (actorLevel >= 5) specCap = 2;
        else if (ignoreFacilityPrereqs) specCap = 2; // Ensure baseline capacity if prereqs ignored

        const currentSpecials = rawFacilities.filter(f => !f.isInherited && !isBasicFac(f.sourceDoc)).length;
        const atSpecCap = !disableSpecialCap && currentSpecials >= specCap;

        const calculationMode = game.settings.get(MODULE_ID, "calculationMode");
        const daysPerTurn = game.settings.get(MODULE_ID, "daysPerTurn") || 7;
        const progressLabel = calculationMode === "days" ? "d" : "t";

        // Dynamic Garden Configuration from Compendium
        let dynamicGardenTypes = [];
        const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
        let gardenRoot = null;

        if (outPack?.folders) {
            gardenRoot = outPack.folders.get("HYjssa08njsoKbTO") || outPack.folders.find(f => f.name.toLowerCase().trim() === "garden");
            if (gardenRoot) {
                dynamicGardenTypes = outPack.folders.filter(f => String(f.folder?.id || f.folder || f.parentId) === String(gardenRoot.id))
                    .map(f => ({ id: f.id, name: f.name }));
            }
        }

        const hasActiveOrder = rawFacilities.some(fac => {
            if (fac.isInherited) return false;
            const flags = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]) : (fac.sourceDoc.getFlag(MODULE_ID) || {});
            return flags?.order && flags.order !== "Maintain";
        });
        const neglectWarning = !disableNeglect && (neglectCounter > 0 && !hasActiveOrder);

        const ratio = Math.min(neglectCounter / actorLevel, 1);
        const r = Math.floor(255 - (116 * ratio));
        const g = Math.floor(165 * (1 - ratio));
        const neglectColor = `rgb(${r}, ${g}, 0)`;

        if (this._localLayout === undefined) {
            this._localLayout = foundry.utils.deepClone(layoutActor.getFlag(MODULE_ID, "layout") || {});
        }

        const layoutData = this._localLayout;
        const selectedId = this._selectedFacilityId;
        
        // Determine Wall placement stats
        const globalCostMult = game.settings.get(MODULE_ID, "globalCostMultiplier") ?? 100;
        const globalTimeMult = game.settings.get(MODULE_ID, "globalTimeMultiplier") ?? 100;
        const wallCost = Math.floor(250 * (globalCostMult / 100));
        const wallTime = Math.floor(10 * (globalTimeMult / 100));

        const STRUCT_IDS = {
            wall: "defensive-wall-id",
            closet: "structural-closet",
            path: "structural-path",
            pathPending: "structural-path-pending",
            opening: this._selectedOpeningType || "Door"
        };

        const totalWallSquaresAllowed = wallCount + Math.floor(wallDays / (wallTime || 1));
        const placedWallSquares = Object.values(layoutData).filter(id => id === STRUCT_IDS.wall).length;

        const gridBackground = this.actor.getFlag(MODULE_ID, "gridBackground") || "none";

        let totalDefenders = 0;
        let allDefenderNames = [];

        const facilities = await Promise.all(rawFacilities.map(async fac => {
            let currentOrder = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.order || "Maintain") : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "order") || "Maintain");
            let hirelingsArr = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.hirelings) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "hirelings"));
            let hirelingsDisplay = Array.isArray(hirelingsArr) ? hirelingsArr.join(", ") : "";

            let facDefenders = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.defenders || {count: 0, names: []}) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "defenders") || {count: 0, names: []});
            totalDefenders += facDefenders.count;
            if (facDefenders.names.length > 0) allDefenderNames.push(...facDefenders.names);

            let facSize = fac.isFlag ? fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.size : fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "size");
            let facSubType = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.subType) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "subType"));
            let facSubType2 = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.subType2) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "subType2"));
            const progress = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.progress || 0) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "progress") || 0);
            const upgradeProgress = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.upgradeProgress || 0) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "upgradeProgress") || 0);
            const upgradeTurns = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.upgradeTurns || 0) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "upgradeTurns") || 0);
            const isUnderConstruction = upgradeTurns > 0;
            const isBuilding = isUnderConstruction && !facSize;
            const isOrderChanging = this._changingOrders.has(fac.id);
            const isOrderLocked = (progress > 0 || isBuilding);
            const isSelectionDisabled = fac.isInherited || isBuilding || (progress > 0 && !isOrderChanging);

            // Get the stored craft choice and item choices directly from flags/item, not from safeOrder
            const storedCraftChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.craftChoice || "") : (fac.sourceDoc.getFlag(MODULE_ID, "craftChoice") || "");
            const storedFocusChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.focusChoice || "") : (fac.sourceDoc.getFlag(MODULE_ID, "focusChoice") || "");
            const storedMagicItemChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.magicItemChoice || "") : (fac.sourceDoc.getFlag(MODULE_ID, "magicItemChoice") || "");
            const storedSacredFocusChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.sacredFocusChoice || "") : (fac.sourceDoc.getFlag(MODULE_ID, "sacredFocusChoice") || "");
            const storedSmithyItemChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.smithyItemChoice || "") : (fac.sourceDoc.getFlag(MODULE_ID, "smithyItemChoice") || "");
            const storedArmamentItemChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.armamentItemChoice || "") : (fac.sourceDoc.getFlag(MODULE_ID, "armamentItemChoice") || "");
            const storedWorkshopItemChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.workshopItemChoice || "") : (fac.sourceDoc.getFlag(MODULE_ID, "workshopItemChoice") || "");

            const focusChoice = storedFocusChoice;
            const magicItemChoice = storedMagicItemChoice;
            const sacredFocusChoice = storedSacredFocusChoice;
            const smithyItemChoice = storedSmithyItemChoice;
            const armamentItemChoice = storedArmamentItemChoice;
            const workshopItemChoice = storedWorkshopItemChoice;

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
                if (order === "Maintain" || availableOrders.includes(order)) return;
                const lowerOrder = order.toLowerCase();
                if (safeProps.some(p => p.includes(lowerOrder))) {
                    availableOrders.push(order);
                }
            });

            if (fac.name.includes("Garden")) availableOrders.push("Change Type");

            // Specialized Crafting Expansion
            if (availableOrders.includes("Craft")) {
                const fname = fac.name || "";
                const specialOrders = [];
                if (fname.includes("Arcane Study")) {
                    specialOrders.push("Craft: Arcane Focus", "Craft: Book");
                    if (actorLevel >= 9) specialOrders.push("Craft: Magic Item (Arcana)");
                } else if (fname.includes("Smithy")) {
                    specialOrders.push("Craft: Smith's Tools");
                    if (actorLevel >= 9) specialOrders.push("Craft: Magic Item (Armament)");
                } else if (fname.includes("Workshop")) {
                    specialOrders.push("Craft: Adventuring Gear");
                    if (actorLevel >= 9) specialOrders.push("Craft: Magic Item (Implement)");
                } else if (fname.includes("Sanctuary")) {
                    specialOrders.push("Craft: Druidic Focus", "Craft: Holy Symbol");
                }

                if (specialOrders.length > 0) {
                    const idx = availableOrders.indexOf("Craft");
                    availableOrders.splice(idx, 1, ...specialOrders);
                }
            }

            let craftChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.craftChoice || "") : (fac.sourceDoc.getFlag(MODULE_ID, "craftChoice") || "");
            let currentUIOrder = (currentOrder === "Craft" && craftChoice) ? `Craft: ${craftChoice}` : currentOrder;
            let safeOrder = availableOrders.includes(currentUIOrder) ? currentUIOrder : "Maintain";

            // Stickiness fix: If we are on 'Craft' but no specific sub-choice is valid (e.g. queue empty), 
            // keep the order on the first available craft specialization instead of resetting to Maintain.
            if (safeOrder === "Maintain" && currentOrder === "Craft") {
                const firstCraft = availableOrders.find(o => o.startsWith("Craft"));
                if (firstCraft) safeOrder = firstCraft;
            }

            craftChoice = safeOrder.includes(": ") ? safeOrder.split(": ")[1] : craftChoice;

            const rawQueue = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.craftQueue || []) : (fac.sourceDoc.getFlag(MODULE_ID, "craftQueue") || []);
            const firstQueueItem = rawQueue.length > 0 ? rawQueue[0] : null;

            const isCrafting = safeOrder.startsWith("Craft");
            // A project is paused if the current order is NOT craft, but the first item in the queue IS a paused project.
            const isPausedProjectInQueue = firstQueueItem?.isPausedProject && !isCrafting;
            const isCraftingOrPaused = isCrafting || isPausedProjectInQueue;

            const isArcaneStudyCrafting = fac.name.includes("Arcane Study") && isCraftingOrPaused;
            const isSanctuaryCrafting = fac.name.includes("Sanctuary") && isCraftingOrPaused;
            const isWorkshopCrafting = fac.name.includes("Workshop") && isCraftingOrPaused;
            const isGardenHarvesting = fac.name.includes("Garden") && safeOrder === "Harvest";
            const isSmithyCrafting = fac.name.includes("Smithy") && isCraftingOrPaused;

            // --- Storehouse Specific Logic (Moved below safeOrder) ---
            const isStorehouse = fac.name.includes("Storehouse");
            const storedGp = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.storedGp || 0) : (fac.sourceDoc.getFlag(MODULE_ID, "storedGp") || 0);
            const tradeChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.tradeChoice || "procure") : (fac.sourceDoc.getFlag(MODULE_ID, "tradeChoice") || "procure");
            const autoNextAction = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.autoNextAction || "procure") : (fac.sourceDoc.getFlag(MODULE_ID, "autoNextAction") || "procure");
            const isAutoTrade = tradeChoice === "auto";
            
            let storehouseLimit = actorLevel >= 13 ? 5000 : (actorLevel >= 9 ? 2000 : 500);
            let storehouseMarkup = actorLevel >= 17 ? 100 : (actorLevel >= 13 ? 50 : (actorLevel >= 9 ? 20 : 10));
            const tradeAmount = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.tradeAmount ?? Math.max(0, storehouseLimit - storedGp)) : (fac.sourceDoc.getFlag(MODULE_ID, "tradeAmount") ?? Math.max(0, storehouseLimit - storedGp));
            const isTradeOrder = currentOrder === "Trade";

            const hasOrders = availableOrders.length > 1;

            const isLibraryResearching = fac.name.includes("Library") && safeOrder === "Research";
            const libraryTopic = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.libraryTopic || "") : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "libraryTopic") || "");

            const craftQueue = rawQueue.map(q => {
                const timeCost = Number(q.timeCost ?? 0);
                const currentProgress = Number(q.currentProgress ?? 0);
                const progressPct = timeCost > 0 ? Math.floor((currentProgress / timeCost) * 100) : 0;
                return {
                    ...q,
                    currentProgress,
                    progressPct,
                    goldCost: Number(q.goldCost ?? 0),
                    timeCost,
                    // Calculate time in turns for display, even if mode is days
                    timeCostInTurns: q.isPausedProject 
                        ? timeCost // For paused projects, timeCost is already in turns/days as originally calculated
                        : calculationMode === "days" 
                        ? Math.ceil(timeCost / daysPerTurn) 
                        : timeCost
                };
            });
            const queueTotalGold = craftQueue.reduce((acc, item) => acc + item.goldCost, 0);
            const queueTotalTime = craftQueue.reduce((acc, item) => acc + item.timeCost, 0);
            
            // Calculate total turns for the queue header even if in days mode
            const queueTotalTurns = calculationMode === "turns" ? queueTotalTime : craftQueue.reduce((acc, item) => {
                const days = item.timeCost || 0;
                return acc + Math.ceil(days / daysPerTurn);
            }, 0);

            let focusOptions = [];
            let arcaneFocusUuid = null;
            let magicItemOptions = [];
            let magicItemUuid = null;
            let sacredFocusOptions = [];
            let sacredFocusUuid = null;
            let smithyItemOptions = [];
            let smithyItemUuid = null;
            let armamentItemOptions = [];
            let armamentItemUuid = null;
            let workshopItemOptions = [];
            let workshopItemUuid = null;
            let workshopTools = [];

            
            const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
            if (outPack?.folders) {
                const findUuid = (opts, target) => {
                    for (const o of opts) {
                        if (o.value === target) return o.uuid;
                        if (o.groupOptions) { const r = findUuid(o.groupOptions, target); if (r) return r; }
                    }
                    return null;
                };

                // --- Arcane Study ---
                if (fac.name.includes("Arcane Study")) {
                    const arcaneBranch = "8yYUu27NcOQJc3qx";
                    const arcaneSubfolders = BastionManager._getAllSubfolderIds(outPack, arcaneBranch);
                    
                    const effectiveFocusChoice = (isCrafting && craftChoice === "Arcane Focus") ? storedFocusChoice : (isPausedProjectInQueue && firstQueueItem.craftType === "Arcane Focus" ? firstQueueItem.choice : "");
                    const effectiveMagicItemChoice = (isCrafting && craftChoice === "Magic Item (Arcana)") ? storedMagicItemChoice : (isPausedProjectInQueue && firstQueueItem.craftType === "Magic Item (Arcana)" ? firstQueueItem.choice : "");

                    focusOptions = await BastionManager._getNestedCompendiumOptions(outPack, "ByVgJZyPE5H3M5tV", effectiveFocusChoice, calculationMode, daysPerTurn, progressLabel, false, null, "Magic Item");
                    arcaneFocusUuid = findUuid(focusOptions, effectiveFocusChoice);
                    magicItemOptions = await BastionManager._getNestedCompendiumOptions(outPack, arcaneBranch, effectiveMagicItemChoice, calculationMode, daysPerTurn, progressLabel, true, null, "Focus");
                    magicItemUuid = findUuid(magicItemOptions, effectiveMagicItemChoice);
                }

                // --- Sanctuary ---
                if (fac.name.includes("Sanctuary")) {
                    const druidFolder = "RTYj3BJ6ZRvuKxPq";
                    const holyFolder = "BiV5sM1bdzI3ZWS6";
                    
                    const effectiveSacredCraftChoice = (isCrafting && craftChoice) ? craftChoice : (isPausedProjectInQueue ? firstQueueItem.craftType : "");
                    const effectiveSacredItemChoice = (isCrafting && (craftChoice === "Druidic Focus" || craftChoice === "Holy Symbol")) ? storedSacredFocusChoice : (isPausedProjectInQueue && (firstQueueItem.craftType === "Druidic Focus" || firstQueueItem.craftType === "Holy Symbol") ? firstQueueItem.choice : "");

                    const targetFolder = effectiveSacredCraftChoice === "Druidic Focus" ? druidFolder : holyFolder;
                    sacredFocusOptions = await BastionManager._getNestedCompendiumOptions(outPack, targetFolder, effectiveSacredItemChoice, calculationMode, daysPerTurn, progressLabel, false);
                    sacredFocusUuid = findUuid(sacredFocusOptions, effectiveSacredItemChoice);
                }

                // --- Smithy ---
                if (fac.name.includes("Smithy")) {
                    const smithBranch = "wti6MOvq9leZqgp9";
                    const smithSubfolders = BastionManager._getAllSubfolderIds(outPack, smithBranch);
                    
                    // Find specific tools folder to keep mundane list distinct from magic items
                    const toolsFolder = outPack.folders.find(f => smithSubfolders.includes(f.id) && (f.name.toLowerCase().includes("tools") || f.name.toLowerCase().includes("smithing")));
                    const mundaneRoot = toolsFolder ? toolsFolder.id : smithBranch;
                    
                    const effectiveSmithyCraftChoice = (isCrafting && craftChoice) ? craftChoice : (isPausedProjectInQueue ? firstQueueItem.craftType : "");
                    const effectiveSmithyItemChoice = (isCrafting && craftChoice === "Smith's Tools") ? storedSmithyItemChoice : (isPausedProjectInQueue && firstQueueItem.craftType === "Smith's Tools" ? firstQueueItem.choice : "");
                    const effectiveArmamentItemChoice = (isCrafting && craftChoice === "Magic Item (Armament)") ? storedArmamentItemChoice : (isPausedProjectInQueue && firstQueueItem.craftType === "Magic Item (Armament)" ? firstQueueItem.choice : "");

                    smithyItemOptions = await BastionManager._getNestedCompendiumOptions(outPack, mundaneRoot, effectiveSmithyItemChoice, calculationMode, daysPerTurn, progressLabel, false, null, toolsFolder ? null : "Armament");
                    smithyItemUuid = findUuid(smithyItemOptions, effectiveSmithyItemChoice);
                    
                    const armFolder = outPack.folders.find(f => smithSubfolders.includes(f.id) && f.name.toLowerCase().includes("armament"));
                    if (armFolder) {
                        armamentItemOptions = await BastionManager._getNestedCompendiumOptions(outPack, armFolder.id, effectiveArmamentItemChoice, calculationMode, daysPerTurn, progressLabel, true);
                        armamentItemUuid = findUuid(armamentItemOptions, effectiveArmamentItemChoice);
                    }
                }

                // --- Workshop ---
                if (fac.name.includes("Workshop")) {
                    const workshopBranch = "XkNDvStirzNpw8G2";
                    const workshopSubfolders = BastionManager._getAllSubfolderIds(outPack, workshopBranch);
                    workshopTools = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.workshopTools || []) : (fac.sourceDoc.getFlag(MODULE_ID, "workshopTools") || []);
                    
                    const effectiveWorkshopCraftChoice = (isCrafting && craftChoice) ? craftChoice : (isPausedProjectInQueue ? firstQueueItem.craftType : "");
                    const effectiveWorkshopItemChoice = (isCrafting && (craftChoice === "Adventuring Gear" || craftChoice === "Magic Item (Implement)")) ? storedWorkshopItemChoice : (isPausedProjectInQueue && (firstQueueItem.craftType === "Adventuring Gear" || firstQueueItem.craftType === "Magic Item (Implement)") ? firstQueueItem.choice : "");

                    const isMagic = effectiveWorkshopCraftChoice === "Magic Item (Implement)";
                    const magicFolder = outPack.folders.find(f => workshopSubfolders.includes(f.id) && f.name.toLowerCase().includes("magic item"));
                    
                    if (isMagic && magicFolder) {
                        workshopItemOptions = await BastionManager._getNestedCompendiumOptions(outPack, magicFolder.id, effectiveWorkshopItemChoice, calculationMode, daysPerTurn, progressLabel, true);
                    } else {
                        workshopItemOptions = await BastionManager._getNestedCompendiumOptions(outPack, workshopBranch, effectiveWorkshopItemChoice, calculationMode, daysPerTurn, progressLabel, false, workshopTools, "Magic Item");
                    }
                    workshopItemUuid = findUuid(workshopItemOptions, effectiveWorkshopItemChoice);
                }
            }
            
            // Calculate Max Craft Turns based on selected item data
            const findOptionData = (opts, target) => {
                for (const o of opts) {
                    if (o.value === target) return o;
                    if (o.groupOptions) { const r = findOptionData(o.groupOptions, target); if (r) return r; }
                }
                return null;
            };

             let currentMaxCraftTurns = 0;
            let currentGoldCost = 0;
            const isArcaneStudy = fac.name.includes("Arcane Study");
            const isSmithy = fac.name.includes("Smithy");
            const isWorkshop = fac.name.includes("Workshop");
            const isSanctuary = fac.name.includes("Sanctuary");

            if (isArcaneStudy) {
                if (storedCraftChoice === "Magic Item (Arcana)") { // Use stored choices for calculation
                    const opt = findOptionData(magicItemOptions, storedMagicItemChoice); // magicItemOptions are built with storedMagicItemChoice
                    if (opt) {
                        currentMaxCraftTurns = opt.time;
                        currentGoldCost = opt.price;
                    }
                } else if (storedCraftChoice === "Arcane Focus") currentMaxCraftTurns = calculationMode === "days" ? 7 : 1;
                else if (storedCraftChoice === "Book") {
                    currentMaxCraftTurns = calculationMode === "days" ? 7 : 1;
                    currentGoldCost = 10;
                }
            } else if (isSmithy) {
                if (storedCraftChoice === "Magic Item (Armament)") { // Use stored choices for calculation
                    const opt = findOptionData(armamentItemOptions, storedArmamentItemChoice); // armamentItemOptions are built with storedArmamentItemChoice
                    if (opt) {
                        currentMaxCraftTurns = opt.time;
                        currentGoldCost = opt.price;
                    }
                } else if (storedCraftChoice === "Smith's Tools") {
                    const opt = findOptionData(smithyItemOptions, storedSmithyItemChoice); // smithyItemOptions are built with storedSmithyItemChoice
                    if (opt) {
                        currentMaxCraftTurns = opt.time;
                        currentGoldCost = opt.price;
                    }
                }
            } else if (isWorkshop) {
                const opt = findOptionData(workshopItemOptions, storedWorkshopItemChoice); // workshopItemOptions are built with storedWorkshopItemChoice
                if (opt) {
                    currentMaxCraftTurns = opt.time;
                    currentGoldCost = opt.price;
                }
             } else if (isSanctuary) {
                currentMaxCraftTurns = calculationMode === "days" ? 7 : 1;
            }
            let harvestOptions = [];
            const isVastGarden = fac.name.includes("Garden") && facSize === "Vast";
            let harvestOptions2 = [];

            if (isGardenHarvesting && outPack) {
                const index = await outPack.getIndex({fields: ["folder", "system.quantity", "uuid"]});
                
                // Plot 1 Options
                if (facSubType) {
                    const typeFolder = dynamicGardenTypes.find(f => f.name.toLowerCase().trim() === facSubType.toLowerCase().trim());
                    if (typeFolder) {
                        harvestOptions = index.filter(i => i.folder === typeFolder.id).map(i => ({
                            value: i.name, 
                            label: `${i.name} (Qty: ${i.system?.quantity || 1})`,
                            uuid: i.uuid
                        }));
                    }
                }

                // Plot 2 Options (Vast)
                if (isVastGarden && facSubType2) {
                    const typeFolder2 = dynamicGardenTypes.find(f => f.name.toLowerCase().trim() === facSubType2.toLowerCase().trim());
                    if (typeFolder2) {
                        harvestOptions2 = index.filter(i => i.folder === typeFolder2.id).map(i => ({
                            value: i.name, 
                            label: `${i.name} (Qty: ${i.system?.quantity || 1})`,
                            uuid: i.uuid
                        }));
                    }
                }
            }
            const harvestChoice = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.harvestChoice) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "harvestChoice"));
            const harvestChoice2 = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.harvestChoice2) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "harvestChoice2"));

            const harvestUuid = harvestOptions.find(o => o.value === harvestChoice)?.uuid;
            const harvestUuid2 = harvestOptions2.find(o => o.value === harvestChoice2)?.uuid;

            const isGardenChangingType = fac.name.includes("Garden") && safeOrder === "Change Type";
            const pendingSubType = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.pendingSubType || "") : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "pendingSubType") || "");

            // Determine Enlargeability for UI
            const isBasic = fac.sourceDoc.system?.type?.value?.toLowerCase() === "basic";
            const enlargeableSpecials = ["Archive", "Barrack", "Garden", "Pub", "Stable", "Workshop"];
            const isEnlargeableSpecial = enlargeableSpecials.some(sn => fac.name.includes(sn));
            const isEnlargeable = !fac.isInherited && ((isBasic && facSize !== "Vast") || (isEnlargeableSpecial && facSize === "Roomy"));
            

            // Barrack Naming Toggle
            const isBarrack = fac.name.includes("Barrack");
            const promptNames = isBarrack ? (fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.promptNames ?? true) 
                                                       : (fac.sourceDoc.getFlag(MODULE_ID, "promptNames") ?? true)) : false;



            // Layout Logic
            const maxSquares = facSize === "Vast" ? 36 : (facSize === "Cramped" ? 4 : 16);
            const placedSquares = Object.values(layoutData).filter(id => id === fac.id).length;
            const isLayoutActive = selectedId === fac.id;

            // Facility Color (random but consistent for layout)
            const colorSeed = fac.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
            const hue = colorSeed % 360;
            const facColor = `hsl(${hue}, 60%, 40%)`;

            const constructionLabel = facSize ? "Enlarging" : "Building";

            const changeTypeOptions = (isGardenChangingType && !isBuilding) ? dynamicGardenTypes.map(f => ({
                value: f.name, 
                label: f.name, 
                selected: f.name === pendingSubType 
            })) : [];

            return {
                id: fac.id, name: fac.isInherited ? `${fac.name} (${fac.ownerName})` : fac.name,
                hirelings: hirelingsDisplay, defenderCount: facDefenders.count > 0 ? facDefenders.count : null,
                size: facSize || (isUnderConstruction ? "Construction" : "Roomy"), subType: facSubType,
                img: fac.sourceDoc.img, sourceDoc: fac.sourceDoc, isInherited: fac.isInherited, isFlag: fac.isFlag, memberId: fac.memberActor?.id || null,
                itemName: fac.name,
                hasOrders: hasOrders,
                showOrderDropdown: hasOrders && !isBuilding,
                safeOrder: safeOrder,
                orderOptions: availableOrders.map(order => ({ value: order, label: order, selected: order === safeOrder })),
                isOrderChanging: isOrderChanging,
                isSelectionDisabled: isSelectionDisabled,
                isLibraryResearching: isLibraryResearching,
                libraryTopic: libraryTopic,
                isArcaneStudyCrafting: isArcaneStudyCrafting,
                craftChoice: craftChoice, // This is the currently selected craft choice in the UI
                isStorehouse,
                isTradeOrder,
                isAutoTrade,
                autoNextAction: autoNextAction.charAt(0).toUpperCase() + autoNextAction.slice(1),
                tradeChoice,
                tradeAmount,
                storehouseLimit,
                storehouseMarkup,
                showArcanaItemSelect: isArcaneStudyCrafting && (craftChoice === "Magic Item (Arcana)" || isPausedProjectInQueue && storedCraftChoice === "Magic Item (Arcana)"),
                magicItemChoice: magicItemChoice, // This is the currently selected magic item in the UI
                magicItemOptions: magicItemOptions,
                focusOptions: focusOptions,
                magicItemUuid: magicItemUuid,
                arcaneFocusUuid: arcaneFocusUuid,
                isSanctuaryCrafting: isSanctuaryCrafting,
                showSacredFocusSelect: isSanctuaryCrafting && (craftChoice === "Druidic Focus" || craftChoice === "Holy Symbol" || isPausedProjectInQueue && (storedCraftChoice === "Druidic Focus" || storedCraftChoice === "Holy Symbol")),
                sacredFocusChoice: sacredFocusChoice, // This is the currently selected sacred focus in the UI
                sacredFocusOptions: sacredFocusOptions,
                sacredFocusUuid: sacredFocusUuid,
                progressLabel: progressLabel,
                isGardenHarvesting: isGardenHarvesting,
                isVastGarden: isVastGarden,
                subType2: facSubType2,
                harvestUuid: harvestUuid,
                harvestUuid2: harvestUuid2,
                harvestOptions: harvestOptions.map(o => ({
                    value: o.value,
                    label: o.label,
                    selected: o.value === harvestChoice
                })),
                harvestOptions2: harvestOptions2.map(o => ({ 
                    value: o.value, 
                    label: o.label, 
                    selected: o.value === harvestChoice2
                })),
                isSmithyCrafting: isSmithyCrafting,
                smithyItemChoice: smithyItemChoice,
                showSmithyItemSelect: isSmithyCrafting && (craftChoice === "Smith's Tools" || (isPausedProjectInQueue && firstQueueItem.craftType === "Smith's Tools")),
                smithyItemOptions: smithyItemOptions,
                showArcaneFocusSelect: isArcaneStudyCrafting && (craftChoice === "Arcane Focus" || (isPausedProjectInQueue && firstQueueItem.craftType === "Arcane Focus")),
                smithyItemUuid: smithyItemUuid,
                showArmamentItemSelect: isSmithyCrafting && (craftChoice === "Magic Item (Armament)" || (isPausedProjectInQueue && firstQueueItem.craftType === "Magic Item (Armament)")),
                armamentItemChoice: armamentItemChoice,
                queueTotalGold: queueTotalGold,
                queueTotalTime: queueTotalTime,
                queueTotalTurns: queueTotalTurns,
                craftQueue: craftQueue,
                armamentItemOptions: armamentItemOptions,
                armamentItemUuid: armamentItemUuid,
                maxCraftTurns: currentMaxCraftTurns,
                isGardenChangingType: isGardenChangingType,
                changeTypeOptions: changeTypeOptions,
                isOrderLocked: isOrderLocked,
                progress: progress,
                isWorkshopCrafting: isWorkshopCrafting,
                workshopTools: workshopTools,
                showWorkshopItemSelect: isWorkshopCrafting && (craftChoice === "Adventuring Gear" || craftChoice === "Magic Item (Implement)" || (isPausedProjectInQueue && (firstQueueItem.craftType === "Adventuring Gear" || firstQueueItem.craftType === "Magic Item (Implement)"))),
                workshopItemChoice: workshopItemChoice,
                workshopItemOptions: workshopItemOptions,
                workshopItemUuid: workshopItemUuid,
                progressPct: Math.round((Math.min(progress, 3) / 3) * 100),
                isUnderConstruction: isUnderConstruction,
                constructionLabel: constructionLabel,
                upgradeProgress: upgradeProgress,
                upgradeTurns: upgradeTurns,
                upgradeProgressPct: Math.round((Math.min(upgradeProgress, upgradeTurns) / (upgradeTurns || 1)) * 100),
                isBasic: isBasic,
                isEnlargeable: isEnlargeable,
                isQueueCollapsed: this._queueStates[fac.id] || false,
                maxSquares,
                placedSquares,
                isBuilding,
                isCrafting,
                isPausedProjectInQueue,
                isLayoutActive: isLayoutActive && !isSelectionDisabled, // Layout is active only if not disabled
                facColor,
                promptNames,
                // Add stored craft choices for accurate paused project display
                storedCraftChoice: storedCraftChoice,
                storedFocusChoice: storedFocusChoice,
                storedMagicItemChoice: storedMagicItemChoice,
                storedSacredFocusChoice: storedSacredFocusChoice,
                storedSmithyItemChoice: storedSmithyItemChoice,
                storedArmamentItemChoice: storedArmamentItemChoice,
                storedWorkshopItemChoice: storedWorkshopItemChoice,
            };
        }));

        // Collect all unique Utilities from facilities
        const allUtilities = [];
        const utilitySources = new Map(); // utilName -> Set of facNames

        facilities.forEach(fac => {
            // Only populate utilities from finished facilities
            if (fac.isBuilding) return;

            const name = fac.itemName || "";
            const subType = fac.subType || "";
            const facDisplayName = fac.name;

            const addUtil = (u) => {
                if (!utilitySources.has(u)) utilitySources.set(u, new Set());
                utilitySources.get(u).add(facDisplayName);
            };
            
            // Explicitly defined utilities (Workshop tools or generic 'utilities' flag)
            if (fac.workshopTools?.length > 0) fac.workshopTools.forEach(t => addUtil(t));
            
            const extraUtils = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.utilities) : (fac.sourceDoc.getFlag(MODULE_ID, "utilities"));
            if (Array.isArray(extraUtils)) extraUtils.forEach(u => addUtil(u));

            // Automated discovery based on facility type
            if (name.includes("Smithy")) addUtil("Smith's Tools");
            if (name.includes("Laboratory")) addUtil("Alchemist's Supplies");
            if (name.includes("Scriptorium")) addUtil("Calligrapher's Supplies");
            if (name.includes("Guildhall") && subType.toLowerCase().includes("thieves")) addUtil("Thieves' Tools");
            
            if (name.includes("Arcane Study")) addUtil("Arcane Spellcasting");
            if (name.includes("Sanctuary") || name.includes("Sacristy") || name.includes("Sanctum") || name.includes("Reliquary")) addUtil("Sacred Spellcasting");
            if (name.includes("Teleportation Circle")) addUtil("Expert Recruiter");
        });

        utilitySources.forEach((facs, util) => {
            if (UTILITY_DESCRIPTIONS[util]) {
                allUtilities.push({
                    name: util,
                    description: UTILITY_DESCRIPTIONS[util],
                    sources: Array.from(facs).join(", ")
                });
            }
        });

        let specialFacilities = [];
        let basicFacilities = [];
        if (pack) {
            // Fetch full documents to ensure we have access to all system data
            const allDocs = await pack.getDocuments();
            
            const specRoot = pack.folders.get(SPECIAL_ROOT_ID) || pack.folders.find(f => f.name.toLowerCase().includes("special"));
            const specialFolderIds = specRoot ? BastionManager._getAllSubfolderIds(pack, specRoot.id) : [];
            // basicFolderIds is already calculated at the top of _prepareContext

            let excludedSources = [];
            let excludedFacilities = [];
            try {
                excludedSources = game.settings.get("dnd-2024-bastion-manager", "excludedSourcesData") || [];
                excludedFacilities = game.settings.get("dnd-2024-bastion-manager", "excludedFacilitiesData") || [];
            } catch(e) {}
            
            const actorLevel = (this.actor.type === "character" || this.actor.type === "npc") ? (this.actor.system.details?.level || 1) : 1;
            let skipCount = 0;

            for (const item of allDocs) {
                // Check exclusions
                if (excludedFacilities.includes(item.id)) continue;

                // Check Special Facility Cap
                const isBasic = isBasicFac(item);

                const isFree = !!item.system?.freeFacility;
                if (atSpecCap && !isBasic && !isFree) continue;
                
                let source = "Unknown Source";
                if (typeof item.system?.source === "string") source = item.system.source;
                else if (item.system?.source?.custom) source = item.system.source.custom;
                else if (item.system?.source?.book) source = item.system.source.book;
                else if (item.system?.source?.label) source = item.system.source.label;
                
                if (excludedSources.includes(source.trim())) continue;

                const desc = item.system?.description?.value || "";
                if (!isBasic) {
                    const alreadyBuilt = rawFacilities.some(f => !f.isInherited && f.name === item.name);
                    if (alreadyBuilt && !disableDuplicateLimit && !desc.replace(/<[^>]*>/g, '').includes(`A Bastion can have more than one ${item.name}`)) continue;
                }

                // Try multiple places a level might be stored depending on the exact 5e system schema version
                let reqLevel = item.system?.prerequisites?.level || item.system?.requirements?.level || 0;
                
                // If not found in a clean integer field, try parsing the description for "Level X"
                if (!reqLevel) {
                    // Look for "Level X" in the description, ignoring HTML tags
                    const levelMatch = desc.replace(/<[^>]*>/g, '').match(/Level\s+(\d+)/i);
                    if (levelMatch) {
                        reqLevel = parseInt(levelMatch[1]);
                    } else {
                        // Default to 5 if absolutely no level info can be found
                        reqLevel = 5; 
                    }
                }

                // If the actor doesn't meet the level requirement and we aren't ignoring them, skip it entirely
                if (!ignoreFacilityPrereqs && actorLevel < reqLevel) {
                    skipCount++;
                    continue;
                }

                // Parse for "Prerequisite(s): [Text]". Convert to plain text first for a clean capture.
                const prereqMatch = desc.replace(/<[^>]*>/g, '\n').match(/prerequisites?:\s*(.*)/i);
                let prereq = prereqMatch ? prereqMatch[1].split('\n')[0].trim() : "";

                // Clean up Foundry specific enrichment tags (e.g. @item[Name|ID] or @UUID[ID]{Name})
                prereq = prereq.replace(/@[\w]+\[[^\]]+\]\{([^}]+)\}/g, "$1").replace(/@[\w]+\[([^|\]]+)(?:\|[^\]]+)?\]/g, "$1");

                // If no prerequisite is found or it is "None", keep it empty so it doesn't display in the UI
                if ( !prereq || prereq.toLowerCase() === "none" ) prereq = "";

                const facData = {
                    _id: item._id,
                    name: item.name,
                    reqLevel: reqLevel,
                    prerequisite: prereq
                };

                if (isBasic) {
                    basicFacilities.push(facData);
                } else {
                    specialFacilities.push(facData);
                }
            }

            specialFacilities.sort((a, b) => {
                if (a.reqLevel !== b.reqLevel) return a.reqLevel - b.reqLevel;
                return a.name.localeCompare(b.name);
            });

            const grouped = [];
            for ( const f of specialFacilities ) {
                let g = grouped.find(x => x.level === f.reqLevel);
                if ( !g ) {
                    g = { level: f.reqLevel, facilities: [] };
                    grouped.push(g);
                }
                g.facilities.push(f);
            }
            specialFacilities = grouped;

            basicFacilities.sort((a, b) => a.name.localeCompare(b.name));
        }

        const requiredRole = parseInt(game.settings.get("dnd-2024-bastion-manager", "advancePermission")) || 4;
        const canAdvanceTurn = game.user.role >= requiredRole;

        // Calculate Centroids for labels
        const centers = {};
        const footprints = {};
        for (const [coord, id] of Object.entries(layoutData)) {
            if (id.startsWith("structural-") || id.includes("wall") || id.startsWith("opening-")) continue;
            if (!footprints[id]) footprints[id] = [];
            footprints[id].push(coord.split(',').map(Number));
        }

        for (const [id, points] of Object.entries(footprints)) {
            const fac = facilities.find(f => f.id === id);
            if (!fac) continue;
            const avgX = points.reduce((s, p) => s + p[0], 0) / points.length;
            const avgY = points.reduce((s, p) => s + p[1], 0) / points.length;
            let bestCoord = ""; let minDist = Infinity;
            for (const [px, py] of points) {
                const dist = Math.hypot(px - avgX, py - avgY);
                if (dist < minDist) { minDist = dist; bestCoord = `${px},${py}`; }
            }
            centers[bestCoord] = fac.name;
        }

        // Add simple labels for structural items
        for (const [coord, id] of Object.entries(layoutData)) {
            if (id === STRUCT_IDS.closet) centers[coord] = "Cl";
            else if (id === STRUCT_IDS.path || id === STRUCT_IDS.pathPending) centers[coord] = ""; // Paths will have a texture, no label
            else if (id.startsWith("opening-")) { // Openings don't need a label, they have a visual representation
                centers[coord] = "";
            }
        }

        const gridSize = isGroupMode ? 40 : 20;
        const grid = [];
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                const coord = `${x},${y}`;
                const facId = layoutData[coord];
                const isWall = facId === STRUCT_IDS.wall;
                const isOpening = !!facId?.startsWith("opening-");
                const isPath = facId === STRUCT_IDS.path || facId === STRUCT_IDS.pathPending;
                const isStruct = facId?.startsWith("structural-") || isOpening || isPath;
                
                const fac = isWall ? { name: "Defensive Wall", facColor: "#666", isBuilding: false } 
                          : (isPath ? { name: "Path", facColor: "#8B4513", isBuilding: facId.includes("pending") }
                          : (isOpening ? { name: "Opening", facColor: "#333", isBuilding: false }
                          : (facId?.startsWith("structural-") ? { name: "Structure", facColor: "#777", isBuilding: facId.includes("pending") }
                          : facilities.find(f => f.id === facId))));
                
                // Wall specific scaffolding check
                const isScaffolding = fac?.isBuilding || (isWall && (Object.values(layoutData).slice(0, Object.keys(layoutData).indexOf(coord)).filter(id => id === STRUCT_IDS.wall).length >= wallCount));

                grid.push({
                    x, y, coord,
                    color: fac ? fac.facColor : "transparent", isScaffolding, isStruct, isOpening, isPath,
                    name: fac ? fac.name : "",
                    label: centers[coord] || ""
                });
            }
        }

        const specialFacilitiesBuilt = facilities.filter(f => !f.isBasic);
        const basicFacilitiesBuilt = facilities.filter(f => f.isBasic);
        const isNewBastion = (this.actor.type === "character" || this.actor.type === "npc") && facilities.filter(f => !f.isInherited).length === 0;
        
        const allActiveQueues = facilities.filter(f => f.craftQueue?.length > 0);

        // Calculate Expected Outputs for Next Turn
        const expectedOutputs = [];
        for (const fac of facilities) {
            if (fac.isBuilding) continue;

            const currentOrder = fac.orderOptions?.find(o => o.selected)?.value;
            const isCraftOrder = currentOrder?.startsWith("Craft");
            
            // Harvest logic
            if (fac.isGardenHarvesting) {
                if (fac.harvestOptions.some(o => o.selected)) {
                    expectedOutputs.push({ facName: fac.name, label: fac.harvestOptions.find(o => o.selected).label });
                }
                if (fac.isVastGarden && fac.harvestOptions2.some(o => o.selected)) {
                    expectedOutputs.push({ facName: fac.name, label: fac.harvestOptions2.find(o => o.selected).label });
                }
            }

            // Crafting logic
            if ((isCraftOrder || fac.isPausedProjectInQueue) && !fac.isUnderConstruction) {
                let outputLabel = "";
                let progressInfo = "";
                let color = "#2e7d32"; // Default color for active/queued
                
                if (fac.isPausedProjectInQueue) {
                    const pausedProject = fac.craftQueue[0];
                    outputLabel = pausedProject.label;
                    const pct = pausedProject.progressPct || 0;
                    progressInfo = ` (${pct}% Complete)`;
                    color = "#666"; // Paused color
                } else if (fac.craftChoice) { // Active crafting project
                    const effectiveCraftChoice = fac.craftChoice; // Use current active craft choice
                    if (fac.name.includes("Arcane Study")) {
                        if (effectiveCraftChoice === "Magic Item (Arcana)") {
                            outputLabel = fac.magicItemChoice;
                        } else {
                            outputLabel = effectiveCraftChoice === "Arcane Focus" ? fac.focusChoice : "Blank Book";
                        }
                    } else if (fac.name.includes("Smithy")) {
                        if (effectiveCraftChoice === "Magic Item (Armament)") {
                            outputLabel = fac.armamentItemChoice;
                        } else {
                            outputLabel = fac.smithyItemChoice;
                        }
                    } else if (fac.name.includes("Sanctuary")) {
                        outputLabel = fac.sacredFocusChoice;
                    } else if (fac.name.includes("Workshop")) {
                        outputLabel = fac.workshopItemChoice;
                    }

                    // Unified countdown display for Horizon panel
                    if (fac.maxCraftTurns >= 1) {
                        const remaining = Math.max(1, fac.maxCraftTurns - fac.progress);
                        progressInfo = ` (${remaining}t until completion)`;
                    }
                } else if (fac.craftQueue.length > 0) {
                    const next = fac.craftQueue[0];
                    outputLabel = next.choice || next.craftType;
                    
                    // If first item in queue hasn't started, it's just "Queued"
                    progressInfo = " (Next in Queue)";
                }

                if (outputLabel) {
                    expectedOutputs.push({ facName: fac.name, label: `${outputLabel}${progressInfo}`, color });
                }
            }
            
            // Recruitment logic
            if (fac.itemName === "Barrack" && fac.showOrderDropdown && fac.orderOptions.find(o => o.selected)?.value === "Recruit") {
                expectedOutputs.push({ facName: fac.name, label: "New Defenders (1d4)" });
            }

            // Trade logic (Storehouse & Armory)
            if (currentOrder === "Trade") {
                if (fac.isStorehouse) {
                    let choice = fac.tradeChoice;
                    let amount = fac.tradeAmount;
                    if (choice === "auto") {
                        choice = fac.autoNextAction?.toLowerCase() || "procure";
                        amount = 99999; // Assume maximum possible trade in auto-mode
                    }
                    const limit = fac.storehouseLimit;
                    const markupPct = fac.storehouseMarkup;
                    const stored = fac.storedGp;

                    if (choice === "procure") {
                        const actualAmount = Math.min(amount, limit - stored);
                        if (actualAmount > 0) {
                            expectedOutputs.push({ facName: fac.name, label: `Procure Goods: -${actualAmount} GP`, color: "#a32a22" });
                        }
                    } else if (choice === "sell") {
                        const actualAmount = Math.min(amount, stored);
                        if (actualAmount > 0) {
                            const totalReturn = Math.floor(actualAmount * ((100 + markupPct) / 100));
                            expectedOutputs.push({ facName: fac.name, label: `Sell Goods: +${totalReturn} GP`, color: "#2e7d32" });
                        }
                    }
                } else if (fac.itemName.includes("Gaming Hall")) {
                    expectedOutputs.push({ facName: fac.name, label: "Gambling Den (1d100 Winnings)", color: "#2e7d32" });
                } else if (fac.itemName.includes("Armory")) {
                    let cost = 100 + (100 * totalDefenders); 
                    if (facilities.some(f => f.itemName.includes("Smithy"))) cost = Math.floor(cost / 2);
                    expectedOutputs.push({ facName: fac.name, label: `Stock Armory: -${cost} GP`, color: "#a32a22" });
                }
            }
        }

        // Persist section states
        if (this._sectionStates === undefined) this._sectionStates = { special: true, basic: true };
        
        this.context = { 
            actor: this.actor, turnCount: globalTurnCount, 
            totalDefenders, defenderNames: allDefenderNames.join(", "), 
            allActiveQueues,
            allUtilities,
            expectedOutputs,
            calculationMode,
            activeTab: this._activeTab || "map",
            facilities, specialFacilitiesBuilt, basicFacilitiesBuilt, specialFacilities, basicFacilities,
            canAdvanceTurn, grid, gridSize, isNewBastion,
            wallCount, wallDays, hasMap,
            selectedId, combinedGroup, wallCost, wallTime,
            totalWallSquaresAllowed, placedWallSquares, structIds: STRUCT_IDS,
            gridBackground, selectedOpening: this._selectedOpeningType || "Door", neglectWarning, neglectColor, neglectCounter, actorLevel,
            sectionStates: this._sectionStates
        };
        return this.context;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const MODULE_ID = "dnd-2024-bastion-manager";

        // Restore scroll position
        const sidebar = this.element.querySelector('.bastion-sidebar');
        if (sidebar && this._scrollTop !== undefined) sidebar.scrollTop = this._scrollTop;

        // Add scroll listener to track position for future re-renders
        sidebar?.addEventListener('scroll', () => this._scrollTop = sidebar.scrollTop);

        // Section State Listeners
        this.element.querySelectorAll('details[data-section]').forEach(details => {
            details.addEventListener('toggle', (ev) => {
                const section = ev.currentTarget.dataset.section;
                this._sectionStates[section] = ev.currentTarget.open;
            });
        });

        // Storehouse Listeners
        this.element.querySelectorAll('.storehouse-trade-choice').forEach(select => {
            select.addEventListener('change', async (ev) => {
                const ds = ev.target.dataset;
                if (ds.isFlag === "true") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = gf.find(f => f._id === ds.itemId);
                    if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.tradeChoice`, ev.target.value);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "tradeChoice", ev.target.value);
                }
                this.render();
            });
        });

        this.element.querySelectorAll('.storehouse-trade-amount').forEach(input => {
            input.addEventListener('change', async (ev) => {
                const ds = ev.target.dataset;
                const val = Math.max(0, parseInt(ev.target.value) || 0);
                if (ds.isFlag === "true") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = gf.find(f => f._id === ds.itemId);
                    if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.tradeAmount`, val);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "tradeAmount", val);
                }
            });
        });

        this.element.querySelectorAll('details[data-queue-id]').forEach(details => {
            details.addEventListener('toggle', (ev) => {
                const id = ev.currentTarget.dataset.queueId;
                this._queueStates[id] = !ev.currentTarget.open;
            });
        });

        this.element.querySelector('select[name="opening-type"]')?.addEventListener('change', (ev) => {
            this._selectedOpeningType = ev.target.value;
            this.render();
        });
        
        const bgSelect = this.element.querySelector('select[data-action="changeBackground"]');
        if (bgSelect) {
            bgSelect.addEventListener('change', (ev) => this.onChangeBackground(ev, ev.currentTarget));
        }

        const selects = this.element.querySelectorAll('.facility-order-select');
        for ( const select of selects ) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset; 
                const val = event.target.value;
                let newOrder = val;
                let craftChoice = "";

                if (val.includes(": ")) {
                    const parts = val.split(": ");
                    newOrder = parts[0];
                    craftChoice = parts[1];
                }

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); const item = member?.items.get(ds.itemId);
                    if (item) {
                        await item.setFlag(MODULE_ID, "order", newOrder);
                        if (craftChoice) await item.setFlag(MODULE_ID, "craftChoice", craftChoice);
                        else await item.setFlag(MODULE_ID, "craftChoice", ""); // Clear if not a specific craft
                    }
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        foundry.utils.setProperty(fac, `flags.${MODULE_ID}.order`, newOrder);
                        if (craftChoice) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.craftChoice`, craftChoice);
                        else foundry.utils.setProperty(fac, `flags.${MODULE_ID}.craftChoice`, ""); // Clear if not a specific craft
                        await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) {
                        await item.setFlag(MODULE_ID, "order", newOrder);
                        if (craftChoice) await item.setFlag(MODULE_ID, "craftChoice", craftChoice);
                        else await item.setFlag(MODULE_ID, "craftChoice", ""); // Clear if not a specific craft
                    }
                }
                ui.notifications.info(`Order updated to ${val}.`);
                this.render();
            });
        }

        const harvestSelects2 = this.element.querySelectorAll('.garden-harvest-select-2');
        for (const select of harvestSelects2) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newChoice = event.target.value;

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag("dnd-2024-bastion-manager", "harvestChoice2", newChoice);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; if (!fac.flags["dnd-2024-bastion-manager"]) fac.flags["dnd-2024-bastion-manager"] = {};
                        fac.flags["dnd-2024-bastion-manager"].harvestChoice2 = newChoice;
                        await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag("dnd-2024-bastion-manager", "harvestChoice2", newChoice);
                }
                this.render();
            });
        }

        const sacredFocusSelects = this.element.querySelectorAll('.sanctuary-focus-select');
        for (const select of sacredFocusSelects) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newChoice = event.target.value;
                const MODULE_ID = "dnd-2024-bastion-manager";

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); 
                    const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "sacredFocusChoice", newChoice);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; 
                        if (!fac.flags[MODULE_ID]) fac.flags[MODULE_ID] = {};
                        fac.flags[MODULE_ID].sacredFocusChoice = newChoice;
                        await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "sacredFocusChoice", newChoice);
                }
                this.render();
            });
        }

        const smithyItemSelects = this.element.querySelectorAll('.smithy-item-select');
        for (const select of smithyItemSelects) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newChoice = event.target.value;
                const MODULE_ID = "dnd-2024-bastion-manager";

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); 
                    const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "smithyItemChoice", newChoice);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; 
                        if (!fac.flags[MODULE_ID]) fac.flags[MODULE_ID] = {};
                        fac.flags[MODULE_ID].smithyItemChoice = newChoice;
                        await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "smithyItemChoice", newChoice);
                }
                this.render();
            });
        }

        const armamentItemSelects = this.element.querySelectorAll('.armament-item-select');
        for (const select of armamentItemSelects) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newChoice = event.target.value;
                const MODULE_ID = "dnd-2024-bastion-manager";

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); 
                    const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "armamentItemChoice", newChoice);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; 
                        if (!fac.flags[MODULE_ID]) fac.flags[MODULE_ID] = {};
                        fac.flags[MODULE_ID].armamentItemChoice = newChoice;
                        await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "armamentItemChoice", newChoice);
                }
                this.render();
            });
        }

        const workshopItemSelects = this.element.querySelectorAll('.workshop-item-select');
        for (const select of workshopItemSelects) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newChoice = event.target.value;
                const MODULE_ID = "dnd-2024-bastion-manager";

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); 
                    const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "workshopItemChoice", newChoice);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; 
                        if (!fac.flags[MODULE_ID]) fac.flags[MODULE_ID] = {};
                        fac.flags[MODULE_ID].workshopItemChoice = newChoice;
                        await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "workshopItemChoice", newChoice);
                }
                this.render();
            });
        }

        const focusSelects = this.element.querySelectorAll('.arcane-study-focus-select');
        for (const select of focusSelects) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newChoice = event.target.value;
                const MODULE_ID = "dnd-2024-bastion-manager";

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); 
                    const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "focusChoice", newChoice);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; 
                        if (!fac.flags[MODULE_ID]) fac.flags[MODULE_ID] = {};
                        fac.flags[MODULE_ID].focusChoice = newChoice;
                        await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "focusChoice", newChoice);
                }
            });
        }

        const magicItemSelects = this.element.querySelectorAll('.arcane-study-item-select');
        for (const select of magicItemSelects) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newChoice = event.target.value;
                const MODULE_ID = "dnd-2024-bastion-manager";


                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); 
                    const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "magicItemChoice", newChoice);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; 
                        if (!fac.flags[MODULE_ID]) fac.flags[MODULE_ID] = {};
                        fac.flags[MODULE_ID].magicItemChoice = newChoice;
                        await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "magicItemChoice", newChoice);
                }
                this.render();
            });
        }
        
        const inputs = this.element.querySelectorAll('.library-topic-input');
        for (const input of inputs) {
            input.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newTopic = event.target.value;
                
                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag("dnd-2024-bastion-manager", "libraryTopic", newTopic);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; if (!fac.flags["dnd-2024-bastion-manager"]) fac.flags["dnd-2024-bastion-manager"] = {};
                        fac.flags["dnd-2024-bastion-manager"].libraryTopic = newTopic;
                        await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag("dnd-2024-bastion-manager", "libraryTopic", newTopic);
                }
            });
        }

        const harvestSelects = this.element.querySelectorAll('.garden-harvest-select');
        for (const select of harvestSelects) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newChoice = event.target.value;

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag("dnd-2024-bastion-manager", "harvestChoice", newChoice);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; if (!fac.flags["dnd-2024-bastion-manager"]) fac.flags["dnd-2024-bastion-manager"] = {};
                        fac.flags["dnd-2024-bastion-manager"].harvestChoice = newChoice;
                        await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag("dnd-2024-bastion-manager", "harvestChoice", newChoice);
                }
                this.render();
            });
        }

        const typeSelects = this.element.querySelectorAll('.garden-change-type-select');
        for (const select of typeSelects) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newSubType = event.target.value;

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); const item = member?.items.get(ds.itemId);
                    if (item) {
                        await item.setFlag("dnd-2024-bastion-manager", "pendingSubType", newSubType);
                        await item.setFlag("dnd-2024-bastion-manager", "progress", 0);
                    }
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; if (!fac.flags["dnd-2024-bastion-manager"]) fac.flags["dnd-2024-bastion-manager"] = {};
                        fac.flags["dnd-2024-bastion-manager"].pendingSubType = newSubType;
                        fac.flags["dnd-2024-bastion-manager"].progress = 0;
                        await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) {
                        await item.setFlag("dnd-2024-bastion-manager", "pendingSubType", newSubType);
                        await item.setFlag("dnd-2024-bastion-manager", "progress", 0);
                    }
                }
                ui.notifications.info(`Target specialization set to ${newSubType}.`);
                this.render();
            });
        }

        // Grid Square Listeners
        const squares = this.element.querySelectorAll('.bastion-grid-square');

        const performLayoutAction = (coord, action) => {
            const now = Date.now();
            const warningDelay = 200;

            if (!this._selectedFacilityId) {
                if (!this._lastWarningTime || (now - this._lastWarningTime > warningDelay)) {
                    ui.notifications.warn("Select a facility from the list first to place squares.");
                }
                this._lastWarningTime = now;
                return false; // No change
            }

            const sId = this._selectedFacilityId;
            const existing = this._localLayout[coord];

            if (sId === context.structIds.wall || sId.startsWith("structural-") || sId.startsWith("opening-")) {
                if (action === 'place') {
                    if (existing) return false;
                    
                    if (sId === context.structIds.wall) {
                        if (existing) return false;
                        const allowed = context.totalWallSquaresAllowed;
                        const current = Object.values(this._localLayout).filter(id => id === context.structIds.wall).length;
                        if (current >= allowed) {
                            if (!this._lastWarningTime || (now - this._lastWarningTime > warningDelay)) {
                                ui.notifications.warn("You cannot place more wall squares than you have purchased/pending.");
                            }
                            this._lastWarningTime = now;
                            return false;
                        }
                        this._localLayout[coord] = context.structIds.wall;
                    } else if (sId === context.structIds.path) {
                        this._localLayout[coord] = context.structIds.pathPending;
                    } else {
                        const targetId = existing;
                        if (!targetId || targetId.startsWith("structural-") || targetId === context.structIds.wall || targetId.startsWith("opening-")) {
                            if (!this._lastWarningTime || (now - this._lastWarningTime > warningDelay)) {
                                ui.notifications.warn("Closets and Openings must be placed on an existing facility square.");
                            }
                            this._lastWarningTime = now;
                            return false;
                        }
                        const underlyingFac = context.facilities.find(f => f.id === targetId);
                        if (underlyingFac?.isInherited) {
                            if (!this._lastWarningTime || (now - this._lastWarningTime > warningDelay)) {
                                ui.notifications.warn("You cannot place structures on a facility owned by another player.");
                            }
                            this._lastWarningTime = now;
                            return false;
                        }
                        this._localLayout[coord] = sId.startsWith("structural-") ? sId : `opening-${sId}`;
                    }
                    return true;
                } else {
                    const target = this._localLayout[coord];
                    if (target === sId || (sId === context.structIds.path && target === context.structIds.pathPending)) {
                        delete this._localLayout[coord];
                        return true;
                    }
                    return false;
                }
            }

            const fac = context.facilities.find(f => f.id === this._selectedFacilityId);
            if (!fac || fac.isInherited) {
                if (fac?.isInherited && action !== null) {
                    if (!this._lastWarningTime || (now - this._lastWarningTime > warningDelay)) {
                        ui.notifications.warn("You cannot modify the layout of a facility owned by another player.");
                    }
                    this._lastWarningTime = now;
                }
                return false;
            }

            if (action === 'remove') {
                if (this._localLayout[coord] === this._selectedFacilityId) {
                    delete this._localLayout[coord];
                    return true;
                }
            } else if (action === 'place') {
                if (this._localLayout[coord]) return false;
                const currentlyPlaced = Object.values(this._localLayout).filter(id => id === this._selectedFacilityId).length;
                if (currentlyPlaced >= fac.maxSquares) {
                    if (!this._lastWarningTime || (now - this._lastWarningTime > warningDelay)) ui.notifications.warn(`${fac.name} has already reached its maximum area of ${fac.maxSquares} squares.`);
                    this._lastWarningTime = now;
                    return false;
                }
                this._localLayout[coord] = this._selectedFacilityId;
                return true;
            }
            return false;
        };
        
        squares.forEach(sq => {
            sq.addEventListener('mousedown', (ev) => {
                const coord = ev.currentTarget.dataset.coord;
                if (ev.button === 0) { // Left
                    this._isDragging = true;
                    this._dragAction = this._localLayout[coord] === this._selectedFacilityId ? 'remove' : 'place';
                    if (performLayoutAction(coord, this._dragAction)) sq.style.opacity = "0.5"; 
                } else if (ev.button === 2) { // Right
                    ev.preventDefault();
                    this._isDragging = true;
                    this._dragAction = 'remove';
                    if (performLayoutAction(coord, this._dragAction)) sq.style.opacity = "0.5";
                }
            });

            sq.addEventListener('mouseenter', (ev) => {
                if (this._isDragging) {
                    const coord = ev.currentTarget.dataset.coord;
                    if (performLayoutAction(coord, this._dragAction)) sq.style.opacity = "0.5";
                }
            });
        });
        const stopDragging = () => {
            if (this._isDragging) {
                this._isDragging = false;
                this._dragAction = null;
                this.render(); 
            }
        };
        document.addEventListener('mouseup', stopDragging);
        this.element.addEventListener('remove', () => document.removeEventListener('mouseup', stopDragging));
    }

    static onSelectFacilityLayout(event, target) {
        const id = target.dataset.itemId;
        this._selectedFacilityId = this._selectedFacilityId === id ? null : id;
        this.render();
    }

    static onChangeOrder(event, target) {
        const id = target.dataset.itemId;
        const MODULE_ID = "dnd-2024-bastion-manager";

        if (this._changingOrders.has(id)) {
            this._changingOrders.delete(id);
            return this.render();
        }

        // Pausing Logic: Check if the facility is currently crafting with progress
        const fac = this.context?.facilities?.find(f => f.id === id);
        if (fac && fac.safeOrder.startsWith("Craft") && fac.progress > 0) {
            const actor = this.actor;
            
            const pausedProject = {
                craftType: fac.craftChoice,
                choice: fac.magicItemChoice || fac.focusChoice || fac.sacredFocusChoice || fac.smithyItemChoice || fac.armamentItemChoice || fac.workshopItemChoice || "Blank Book",
                label: fac.magicItemChoice || fac.focusChoice || fac.sacredFocusChoice || fac.smithyItemChoice || fac.armamentItemChoice || fac.workshopItemChoice || "Blank Book",
                goldCost: fac.currentGoldCost || 0,
                timeCost: fac.maxCraftTurns || 1,
                currentProgress: fac.progress,
                isPausedProject: true
            };

            const currentQueue = Array.from(fac.craftQueue || []);
            currentQueue.unshift(pausedProject);

            const resetFlags = {
                [`flags.${MODULE_ID}.progress`]: 0,
                [`flags.${MODULE_ID}.craftChoice`]: "",
                [`flags.${MODULE_ID}.focusChoice`]: "",
                [`flags.${MODULE_ID}.magicItemChoice`]: "",
                [`flags.${MODULE_ID}.sacredFocusChoice`]: "",
                [`flags.${MODULE_ID}.smithyItemChoice`]: "",
                [`flags.${MODULE_ID}.armamentItemChoice`]: "",
                [`flags.${MODULE_ID}.workshopItemChoice`]: "",
                [`flags.${MODULE_ID}.craftQueue`]: currentQueue
            };

            // Use an async IIFE to handle the DB update without blocking the UI toggle
            (async () => {
                if (fac.isFlag) {
                    const gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const gfFac = gf.find(f => f._id === id);
                    if (gfFac) {
                        if (!gfFac.flags) gfFac.flags = {};
                        if (!gfFac.flags[MODULE_ID]) gfFac.flags[MODULE_ID] = {};
                        for (let [k, v] of Object.entries(resetFlags)) {
                            const path = k.replace(`flags.${MODULE_ID}.`, "");
                            foundry.utils.setProperty(gfFac, `flags.${MODULE_ID}.${path}`, v);
                        }
                        await actor.setFlag(MODULE_ID, "groupFacilities", gf);
                    }
                } else {
                    const item = actor.items.get(id);
                    if (item) await item.update(resetFlags);
                }
                ui.notifications.info(`Paused <b>${pausedProject.label}</b> and moved it to the top of the queue.`);
                this.render();
            })();
        }

        this._changingOrders.add(id);
        this.render();
    }

    static async onToggleBarrackNaming(event, target) {
        const ds = target.dataset;
        const MODULE_ID = "dnd-2024-bastion-manager";
        
        let current;
        if (ds.isFlag === "true") {
            const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
            const fac = groupFacilities.find(f => f._id === ds.itemId);
            if (!fac) return;
            current = fac.flags?.[MODULE_ID]?.promptNames ?? true;
            foundry.utils.setProperty(fac, `flags.${MODULE_ID}.promptNames`, !current);
            await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
        } else {
            const item = this.actor.items.get(ds.itemId);
            if (!item) return;
            current = item.getFlag(MODULE_ID, "promptNames") ?? true;
            await item.setFlag(MODULE_ID, "promptNames", !current);
        }
        this.render();
    }

    static async onAbandonBastion(event, target) {
        const result = await DialogV2.prompt({
            window: { title: "Abandon/Divest Bastion", icon: "fa-solid fa-burst" },
            content: `<p>Are you sure you want to <b>Divest</b> your Bastion?</p>
                      <p style="color: darkred; font-size: 0.9em;">This will release all hirelings and permanently delete all facilities and layouts. This cannot be undone.</p>
                      <div class="form-group">
                        <label>Type <b>${this.actor.name}</b> to confirm:</label>
                        <input type="text" name="confirmName" placeholder="Character Name" autofocus>
                      </div>`,
            ok: { label: "Abandon Permanently", callback: (event, button) => button.form.elements.confirmName.value },
            rejectClose: false
        });

        if (result === this.actor.name) {
            await BastionManager._triggerBastionFall(this.actor, "Divestiture");
            this.render();
        } else if (result !== undefined) {
            ui.notifications.warn("Abandonment cancelled: Character name did not match.");
        }
    }

    static async onPreviewItem(event, target) {
        const uuid = target.dataset.uuid;
        if (!uuid) return;
        const doc = await fromUuid(uuid);
        if (doc) doc.sheet.render(true);
    }

    static onSwitchTab(event, target) {
        this._activeTab = target.dataset.tab;
        this.render();
    }

    static async onDonateToStorehouse(event, target) {
        const ds = target.dataset;
        const MODULE_ID = "dnd-2024-bastion-manager";
        const actor = this.actor;

        // Filter inventory for non-magical items with a price
        const validTypes = ["weapon", "equipment", "consumable", "loot", "container"];
        const items = actor.items.filter(i => {
            const sys = i.system;
            const isCorrectType = validTypes.includes(i.type);
            const isNotMagic = !sys.rarity || sys.rarity === "common";
            
            // Check for explicit "magical" property tag in standard 5e schemas
            let propArray = [];
            if (sys.properties instanceof Set) propArray = Array.from(sys.properties);
            else if (Array.isArray(sys.properties)) propArray = sys.properties;
            else if (typeof sys.properties === "object" && sys.properties !== null) propArray = Object.keys(sys.properties).filter(k => sys.properties[k]);
            const isActuallyMagical = propArray.includes("mgc");

            const hasPrice = !!sys.price?.value;
            return isCorrectType && isNotMagic && !isActuallyMagical && hasPrice;
        });

        if (!items.length) return ui.notifications.warn("You have no nonmagical trade goods in your inventory to donate.");

        const itemOptions = items.map(i => `<option value="${i.id}">${i.name} (Value: ${i.system.price.value} GP)</option>`).join("");
        
        const result = await DialogV2.prompt({
            window: { title: "Donate to Storehouse", icon: "fa-solid fa-box-open" },
            content: `
                <p>Select an item to transfer to the Storehouse's trade goods supply. Its full purchase value will be added to the coffers.</p>
                <div class="form-group">
                    <label>Item:</label>
                    <select name="itemId">${itemOptions}</select>
                </div>
                <div class="form-group">
                    <label>Quantity:</label>
                    <input type="number" name="quantity" value="1" min="1">
                </div>
            `,
            ok: { label: "Donate", callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
            rejectClose: false
        });

        if (!result) return;
        
        const item = actor.items.get(result.itemId);
        const qty = Math.min(result.quantity, item.system.quantity || 1);
        const totalValue = item.system.price.value * qty;

        // Check capacity
        let fac;
        if (ds.isFlag === "true") {
            const gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
            fac = gf.find(f => f._id === ds.itemId);
        } else {
            fac = actor.items.get(ds.itemId);
        }

        const currentStored = (fac.isFlag ? fac.flags?.[MODULE_ID]?.storedGp : fac.getFlag(MODULE_ID, "storedGp")) || 0;
        const actorLevel = actor.system.details?.level || 1;
        const limit = actorLevel >= 13 ? 5000 : (actorLevel >= 9 ? 2000 : 500);

        if (currentStored + totalValue > limit) {
            return ui.notifications.error(`Donation rejected: Adding ${totalValue} GP of goods would exceed the Storehouse's ${limit} GP capacity.`);
        }

        // Process removal and flag update
        if (qty >= (item.system.quantity || 1)) await item.delete();
        else await item.update({ "system.quantity": item.system.quantity - qty });

        const newStored = currentStored + totalValue;
        const newTradeAmount = Math.max(0, limit - newStored);

        if (ds.isFlag === "true") {
            const gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
            const targetFac = gf.find(f => f._id === ds.itemId);
            foundry.utils.setProperty(targetFac, `flags.${MODULE_ID}.storedGp`, newStored);
            foundry.utils.setProperty(targetFac, `flags.${MODULE_ID}.tradeAmount`, newTradeAmount);
            await actor.setFlag(MODULE_ID, "groupFacilities", gf);
        } else {
            await fac.update({
                [`flags.${MODULE_ID}.storedGp`]: newStored,
                [`flags.${MODULE_ID}.tradeAmount`]: newTradeAmount
            });
        }

        ui.notifications.info(`Donated ${qty}x ${item.name} to the Storehouse. Stored value increased by ${totalValue} GP.`);
        this.render();
    }

    static async onToggleAutoTrade(event, target) {
        const ds = target.dataset;
        const MODULE_ID = "dnd-2024-bastion-manager";
        
        let current;
        if (ds.isFlag === "true") {
            const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
            const fac = groupFacilities.find(f => f._id === ds.itemId);
            if (!fac) return;
            current = fac.flags?.[MODULE_ID]?.tradeChoice === "auto";
            const newVal = current ? "procure" : "auto";
            foundry.utils.setProperty(fac, `flags.${MODULE_ID}.tradeChoice`, newVal);
            await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
        } else {
            const item = this.actor.items.get(ds.itemId);
            if (!item) return;
            current = item.getFlag(MODULE_ID, "tradeChoice") === "auto";
            const newVal = current ? "procure" : "auto";
            await item.setFlag(MODULE_ID, "tradeChoice", newVal);
        }
        this.render();
    }

    static async onClearQueue(event, target) {
        const ds = target.dataset;
        const itemId = ds.itemId;
        const isFlag = ds.isFlag === "true";
        const isInherited = ds.isInherited === "true";
        const memberId = ds.memberId;
        const MODULE_ID = "dnd-2024-bastion-manager";

        let actor = this.actor;
        if (isInherited && memberId) actor = game.actors.get(memberId) || this.actor;

        const confirm = await DialogV2.confirm({
            window: { title: "Clear Crafting Queue" },
            content: "<p>Are you sure you want to empty the entire crafting queue for this facility?</p>",
            rejectClose: false,
            modal: true
        });
        if (!confirm) return;

        if (isFlag) {
            const groupFacilities = actor.getFlag(MODULE_ID, "groupFacilities") || [];
            const fac = groupFacilities.find(f => f._id === itemId);
            if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.craftQueue`, []);
            await actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
        } else {
            const item = actor.items.get(itemId);
            if (item) await item.setFlag(MODULE_ID, "craftQueue", []);
        }
        this.render();
    }

    static async onAddToQueue(event, target) {
        const ds = target.dataset;
        const itemId = ds.itemId;
        const isFlag = ds.isFlag === "true";
        const isInherited = ds.isInherited === "true";
        const memberId = ds.memberId;
        const MODULE_ID = "dnd-2024-bastion-manager";

        let actor = this.actor;
        if (isInherited && memberId) actor = game.actors.get(memberId) || this.actor;

        let fac;
        let groupFacilities = actor.getFlag(MODULE_ID, "groupFacilities") || [];
        if (isFlag) fac = groupFacilities.find(f => f._id === itemId);
        else fac = actor.items.get(itemId);

        if (!fac) return;

        const getFlag = (key) => isFlag ? foundry.utils.getProperty(fac, `flags.${MODULE_ID}.${key}`) : fac.getFlag(MODULE_ID, key);
        const craftChoice = getFlag("craftChoice");
        if (!craftChoice) return ui.notifications.warn("Select a craft option first.");

        let choice = "";
        const name = fac.name;

        if (name.includes("Arcane Study")) {
            if (craftChoice === "Arcane Focus") choice = getFlag("focusChoice");
            else if (craftChoice === "Magic Item (Arcana)") choice = getFlag("magicItemChoice");
            else if (craftChoice === "Book") choice = "Blank Book";
        } else if (name.includes("Smithy")) {
                if (craftChoice === "Smith's Tools") choice = getFlag("smithyItemChoice");
                else if (craftChoice === "Magic Item (Armament)") choice = getFlag("armamentItemChoice");
            } else if (name.includes("Workshop")) {
                if (craftChoice === "Adventuring Gear") choice = getFlag("workshopItemChoice");
                else if (craftChoice === "Magic Item (Implement)") choice = getFlag("workshopItemChoice");
            } else if (name.includes("Sanctuary")) {
            choice = getFlag("sacredFocusChoice");
        }

        if (!choice && !["Smith's Tools", "Book"].includes(craftChoice)) {
            return ui.notifications.warn(`Select a specific ${craftChoice} type before adding to queue.`);
        }

        // Calculate costs for queue items
        let goldCost = 0;
        let timeCost = 0;
        const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
        if (outPack) {
            const index = await outPack.getIndex({fields: ["system.price", "system.rarity"]});
            const entry = index.find(i => i.name === choice);
            const calculationMode = game.settings.get(MODULE_ID, "calculationMode");
            const daysPerTurn = game.settings.get(MODULE_ID, "daysPerTurn") || 7;

            if (entry) {
                const rarity = entry.system.rarity || "Common";
                // Ensure price is a clean number
                let price = entry.system.price?.value ?? entry.system.price ?? 0;
                if (typeof price === "string") price = parseFloat(price.replace(/[^0-9.]/g, ""));
                price = Number(price || 0);
                
                const isMagicItem = ["Magic Item (Arcana)", "Magic Item (Armament)"].includes(craftChoice);
                
                const isUncommon = rarity.toLowerCase() === "uncommon";
                const days = isMagicItem ? (isUncommon ? 10 : 5) : Math.max(1, Math.ceil(price / 10));
                goldCost = Number(isMagicItem ? (isUncommon ? 200 : 50) : Math.floor(price / 2)) || 0;
                timeCost = calculationMode === "days" ? days : Math.ceil(days / daysPerTurn);
            } else if (craftChoice === "Book") {
                goldCost = 10;
                timeCost = calculationMode === "days" ? 7 : 1;
            } else if (isWorkshopAdventuringGear) {
                goldCost = 0; // Fallback if entry missing
                timeCost = calculationMode === "days" ? 7 : 1;
            } else if (isWorkshopMagicItem) {
                const rarity = entry?.system?.rarity || "common";
                const reqs = BastionManager._getMagicItemRequirements(rarity);
                goldCost = reqs.gp;
                timeCost = calculationMode === "days" ? reqs.days : Math.ceil(reqs.days / daysPerTurn);
            } else if (["Arcane Focus", "Druidic Focus", "Holy Symbol"].includes(craftChoice)) {
                goldCost = 0;
                timeCost = calculationMode === "days" ? 7 : 1;
            }
        }

        const label = choice || craftChoice;
        let queue = Array.from(getFlag("craftQueue") || []);
        queue.push({ craftType: craftChoice, choice: choice, label: label, goldCost, timeCost });

        if (isFlag) {
            foundry.utils.setProperty(fac, `flags.${MODULE_ID}.craftQueue`, queue);
            await actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
        } else {
            await fac.setFlag(MODULE_ID, "craftQueue", queue);
        }

                this._changingOrders.delete(ds.itemId);
        ui.notifications.info(`Added ${label} to queue.`);
        this.render();
    }

    static async onRemoveFromQueue(event, target) {
        const ds = target.dataset;
        const index = parseInt(ds.index);
        const itemId = ds.itemId;
        const isFlag = ds.isFlag === "true";
        const isInherited = ds.isInherited === "true";
        const memberId = ds.memberId;
        const MODULE_ID = "dnd-2024-bastion-manager";

        let actor = this.actor;
        if (isInherited && memberId) actor = game.actors.get(memberId) || this.actor;

        let fac;
        let groupFacilities = actor.getFlag(MODULE_ID, "groupFacilities") || [];
        if (isFlag) fac = groupFacilities.find(f => f._id === itemId);
        else fac = actor.items.get(itemId);

        if (!fac) return;

        let queue = Array.from((isFlag ? foundry.utils.getProperty(fac, `flags.${MODULE_ID}.craftQueue`) : fac.getFlag(MODULE_ID, "craftQueue")) || []);
        const removed = queue.splice(index, 1)[0];
        
        if (isFlag) {
            foundry.utils.setProperty(fac, `flags.${MODULE_ID}.craftQueue`, queue);
            await actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
        } else {
            await fac.setFlag(MODULE_ID, "craftQueue", queue);
        }
        ui.notifications.info(`Removed ${removed?.label || "item"} from queue.`);
        this.render();
    }

    static async _triggerBastionFall(actor, reason) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const facilities = actor.items.filter(i => i.type === "facility");
        
        if (facilities.length > 0) await Item.deleteDocuments(facilities.map(i => i.id), { parent: actor });
        
        await actor.unsetFlag(MODULE_ID, "groupFacilities");
        await actor.unsetFlag(MODULE_ID, "layout");
        await actor.unsetFlag(MODULE_ID, "completedWalls");
        await actor.unsetFlag(MODULE_ID, "pendingWallDays");
        await actor.setFlag(MODULE_ID, "neglectCounter", 0);

        ui.notifications.warn(`Bastion lost due to ${reason}. The site has been abandoned and looted.`);
    }

    async onChangeBackground(event, target) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const bg = target.value;
        await this.actor.setFlag(MODULE_ID, "gridBackground", bg);
        this.render();
    }

    static onClearLayout(event, target) {
        const unified = this._getUnifiedFacilities();
        const myIds = new Set(unified.filter(f => !f.isInherited).map(f => f.id));
        
        for (const [coord, id] of Object.entries(this._localLayout)) {
            if (myIds.has(id)) delete this._localLayout[coord];
        }
        
        this.render();
    }

    static async onToggleCombine(event, target) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        if (this.actor.getFlag(MODULE_ID, "combinedGroupId")) {
            await this.actor.unsetFlag(MODULE_ID, "combinedGroupId");
            this._localLayout = undefined; // Force layout refresh
            return this.render();
        }

        const groups = game.actors.filter(a => a.type === "group" && a.testUserPermission(game.user, "OWNER"));
        if (!groups.length) return ui.notifications.warn("You must have ownership of at least one Group actor to combine Bastions.");

        const options = groups.map(g => `<option value="${g.id}">${g.name}</option>`).join("");
        // Filter groups to only those where the current actor is a member
        const validGroups = groups.filter(g => (g.system.members || []).some(m => m.actorId === this.actor.id));
        if (!validGroups.length) return ui.notifications.warn(`You must be a member of a Group to combine your Bastion. Add ${this.actor.name} to a Group Actor first.`);
        const validOptions = validGroups.map(g => `<option value="${g.id}">${g.name}</option>`).join("");

        const groupId = await DialogV2.prompt({
            window: { title: "Combine Bastion" },
            content: `<p>Select a Group to combine <b>${this.actor.name}'s</b> Bastion with:</p><select name="group">${validOptions}</select>`,
            ok: { callback: (event, button) => button.form.elements.group.value }
        });

        if (groupId) {
            await this.actor.setFlag(MODULE_ID, "combinedGroupId", groupId);
            this._localLayout = undefined; // Force layout refresh
        }
        this.render();
    }

    static async onInitializeBastion(event, target) {
        if (this.actor.type === "group") return ui.notifications.warn("Group Bastions cannot be initialized directly. They inherit facilities from their members.");
        const ctx = await this._prepareContext();
        
        const MODULE_ID = "dnd-2024-bastion-manager";
        const pack = game.packs.get("dnd-2024-bastion-manager.bastion-facilities");
        const allDocs = await pack.getDocuments();

        const SPECIAL_ROOT_ID = "jvwwGTr0bMORqJD4";
        const BASIC_ROOT_ID = "oocJkCsQvkXOWJbL";
        
        const basicRoot = pack?.folders.get(BASIC_ROOT_ID) || pack?.folders.find(f => f.name.toLowerCase().includes("basic"));
        const basicFolderIds = basicRoot ? BastionManager._getAllSubfolderIds(pack, basicRoot.id) : [];

        const ignorePrereqs = game.settings.get(MODULE_ID, "ignoreFacilityPrereqs");
        
        // Helper to get grouped/sorted lists
        const getFacilityOptions = (isBasicTarget) => {
            let list = [];
            allDocs.forEach(d => {
                const itemFolderId = d.folder?.id || d.folder;
                const isBasic = basicFolderIds.includes(itemFolderId) || d.system?.type?.value === "basic" || d.name.toLowerCase().includes("basic");
                if (isBasic !== isBasicTarget) return;

                let lvl = d.system?.prerequisites?.level || d.system?.requirements?.level || 0;
                if (!lvl) {
                    const desc = d.system?.description?.value || "";
                    const levelMatch = desc.replace(/<[^>]*>/g, '').match(/Level\s+(\d+)/i);
                    lvl = levelMatch ? parseInt(levelMatch[1]) : 5;
                }
                if (!ignorePrereqs && lvl > 5) return;

                list.push({ id: d.id, name: d.name, level: lvl });
            });
            
            list.sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name));
            
            // Group by level
            const groups = [];
            list.forEach(f => {
                let g = groups.find(x => x.level === f.level);
                if (!g) { g = { level: f.level, facilities: [] }; groups.push(g); }
                g.facilities.push(f);
            });
            return groups;
        };

        const specGroups = getFacilityOptions(false);
        const basicGroups = getFacilityOptions(true);
        
        const generateGroupedOptions = (groups) => {
            return groups.map(g => `<optgroup label="Level ${g.level}">
                ${g.facilities.map(f => `<option value="${f.id}">${f.name}</option>`).join("")}
            </optgroup>`).join("");
        };

        const getHCountFromId = (id) => {
            const d = allDocs.find(doc => doc.id === id);
            if (!d) return 0;
            const hData = d.system?.hireling || d.system?.hirelings || d.system?.details?.hireling || d.system?.details?.hirelings;
            let count = typeof hData === "number" ? hData : (parseInt(hData?.max || hData?.value || hData) || 0);
            let lvl = d.system?.prerequisites?.level || d.system?.requirements?.level || 0;
            if (!count) {
                const desc = d.system?.description?.value || "";
                const hMatch = desc.replace(/<[^>]*>/g, '').match(/Hirelings:\s*(\d+)/i);
                if (hMatch) count = parseInt(hMatch[1]);
            }
            return count || 0;
        };

        const spec1Options = generateGroupedOptions(specGroups);
        const workshopTools = FACILITY_CONFIG.Workshop.options.map(t => `
            <label style="display: flex; align-items: center; gap: 4px; font-size: 0.85em;">
                <input type="checkbox" name="workshopTools" value="${t}"> ${t}
            </label>`).join("");

        const namingEnabled = game.settings.get(MODULE_ID, "nameHirelings");

        const initContent = `
            <p style="margin-bottom: 10px;">Establish your Bastion <b>instantly and for free</b>. Select two Special Facilities and two Basic Facilities.</p>
            <div class="form-group"><label>Special Facility 1</label><select name="spec1" class="spec-init" data-slot="1" style="flex: 2;">${spec1Options}</select></div>
            <div id="names-slot-1" style="margin-bottom: 10px; padding-left: 20px;"></div>
            
            <div class="form-group"><label>Special Facility 2</label><select name="spec2" class="spec-init" data-slot="2" style="flex: 2;">${spec1Options}</select></div>
            <div id="names-slot-2" style="margin-bottom: 10px; padding-left: 20px;"></div>

            <div id="workshop-tools-container" style="display: none; background: rgba(0,0,0,0.05); padding: 8px; border-radius: 4px; border: 1px solid #ccc; margin-bottom: 10px;">
                <p style="margin: 0 0 5px 0; font-weight: bold; color: #a32a22;">Workshop Detected: Select exactly 6 tools:</p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2px;">${workshopTools}</div>
            </div>
            <hr>
            <div class="form-group"><label>Basic Facility 1</label>
                <select name="basic1" style="flex: 2;">${generateGroupedOptions(basicGroups)}</select>
                <select name="size1" style="flex: 1;"><option value="Cramped">Cramped</option><option value="Roomy" selected>Roomy</option></select>
            </div>
            <div class="form-group"><label>Basic Facility 2</label> 
                <select name="basic2" style="flex: 2;">${generateGroupedOptions(basicGroups)}</select>
                <select name="size2" style="flex: 1;"><option value="Cramped" selected>Cramped</option><option value="Roomy">Roomy</option></select>
            </div>
        `;

        const selections = await DialogV2.prompt({
            window: { title: "Founding Your Bastion", icon: "fa-solid fa-sparkles", classes: ["bastion-app"] },
            content: initContent,
            ok: { label: "Establish Bastion", callback: (event, button) => {
                const data = new foundry.applications.ux.FormDataExtended(button.form).object;
                const isWorkshop = [data.spec1, data.spec2].some(id => allDocs.find(d => d.id === id)?.name.includes("Workshop"));
                if (isWorkshop) {
                    const tools = Array.from(button.form.elements.workshopTools).filter(i => i.checked).map(i => i.value);
                    if (tools.length !== 6) { ui.notifications.error("You must select exactly 6 tools for a Workshop."); return false; }
                    data.workshopTools = tools;
                }
                return data;
            }},
            render: function(event) {
                const html = event.target.element;
                const updateNames = (select) => {
                    const isWorkshop = allDocs.find(d => d.id === select.value)?.name.includes("Workshop");
                    html.querySelector('#workshop-tools-container').style.display = Array.from(html.querySelectorAll('.spec-init')).some(s => allDocs.find(d => d.id === s.value)?.name.includes("Workshop")) ? "block" : "none";

                    if (!namingEnabled) return;
                    const slot = select.dataset.slot;
                    const count = getHCountFromId(select.value);
                    const container = html.querySelector('#names-slot-' + slot);
                    if (!container) return;
                    let inputs = '';
                    for(let i=0; i<count; i++) {
                        inputs += `<div class="form-group" style="margin: 2px 0;"><label style="font-size: 0.85em; color: #666;">Hireling ${i+1}:</label><input type="text" name="name_spec${slot}_${i}" placeholder="Auto-generate if blank" style="height: 22px;"></div>`;
                    }
                    container.innerHTML = inputs;
                };
                html.querySelectorAll('.spec-init').forEach(s => {
                    s.addEventListener('change', e => updateNames(e.target));
                    updateNames(s);
                });
            },
            rejectClose: false
        });

        if (!selections) return;

        const createInitFac = async (id, size, slotNum = null) => {
            if (!id) return;
            const doc = await pack.getDocument(id);
            if (!doc) return console.error(`Bastion Manager | Facility ID ${id} not found in compendium.`);
            const data = doc.toObject();
            const MODULE_ID = "dnd-2024-bastion-manager";
            foundry.utils.setProperty(data, `flags.${MODULE_ID}.size`, size);

            const hCount = getHCountFromId(id);
            if (slotNum && hCount > 0 && game.settings.get(MODULE_ID, "nameHirelings")) {
                const autoGen = game.settings.get(MODULE_ID, "autoNameHirelings");
                let names = [];
                for (let i = 0; i < hCount; i++) {
                    const key = `name_spec${slotNum}_${i}`;
                    let val = selections[key]?.trim();
                    if (!val && autoGen) val = BastionManager._generateRandomName();
                    if (val) names.push(val);
                }

                if (names.length > 0) {
                    foundry.utils.setProperty(data, `flags.${MODULE_ID}.hirelings`, names);
                    let prof = BastionManager._getHirelingProfession(doc.name, null);
                    names.forEach(n => BastionManager._createHirelingActor(n, prof, this.actor.name, doc.name, false));
                }
            }
            
            if (doc.name.includes("Workshop") && selections.workshopTools) foundry.utils.setProperty(data, `flags.${MODULE_ID}.workshopTools`, selections.workshopTools);
            
            if (this.actor.type === "group") {
                const gf = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                data._id = foundry.utils.randomID();
                gf.push(data);
                await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", gf);
            } else {
                await Item.create(data, { parent: this.actor });
            }
        };

        ui.notifications.info(`Founding ${this.actor.name}'s Bastion...`);
        await createInitFac(selections.spec1, "Roomy", 1);
        await createInitFac(selections.spec2, "Roomy", 2);
        await createInitFac(selections.basic1, selections.size1);
        await createInitFac(selections.basic2, selections.size2);
        this.render();
    }

    static async onSaveLayout(event, target) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const unifiedFacilities = this._getUnifiedFacilities();
        
        const combinedGroupId = this.actor.getFlag(MODULE_ID, "combinedGroupId");
        const combinedGroup = combinedGroupId ? game.actors.get(combinedGroupId) : null;
        const layoutActor = combinedGroup || this.actor;

        // Validation: Contiguity Check
        const facIds = new Set(Object.values(this._localLayout));
        for (const id of facIds) {
            const coordsList = Object.entries(this._localLayout).filter(([c, val]) => val === id && !c.startsWith("-=")).map(([c]) => c);
            if (coordsList.length <= 1) continue;

            const coordsSet = new Set(coordsList);
            const visited = new Set();
            const queue = [coordsList[0]];
            visited.add(coordsList[0]);

            while (queue.length > 0) {
                const [x, y] = queue.shift().split(',').map(Number);
                const neighbors = [
                    `${x+1},${y}`, `${x-1},${y}`, `${x},${y+1}`, `${x},${y-1}`, // Cardinal
                    `${x+1},${y+1}`, `${x-1},${y-1}`, `${x+1},${y-1}`, `${x-1},${y+1}` // Diagonal
                ];
                for (const n of neighbors) {
                    if (coordsSet.has(n) && !visited.has(n)) {
                        visited.add(n);
                        queue.push(n);
                    }
                }
            }

            if (visited.size !== coordsList.length) {
                return ui.notifications.error("Layout Error: One or more facilities have disconnected parts. All squares for a single facility must be contiguous (touching).");
            }

            // Validation: Completeness Check
            const facSource = unifiedFacilities.find(f => f.id === id);
            if (facSource) {
                const facSize = facSource.isFlag ? (facSource.sourceDoc.flags?.[MODULE_ID]?.size || "Roomy") : (facSource.sourceDoc.getFlag(MODULE_ID, "size") || "Roomy");
                const maxSquares = facSize === "Vast" ? 36 : (facSize === "Cramped" ? 4 : 16);
                if (coordsList.length !== maxSquares) {
                    return ui.notifications.error(`Layout Error: ${facSource.name} is ${facSize} and requires exactly ${maxSquares} squares. You have placed ${coordsList.length}.`);
                }
            }
        }

        const confirm = await DialogV2.confirm({
            window: { title: "Save Layout" },
            content: "<p>Save the current grid layout to the Bastion?</p>"
        });
        if (confirm) {
            const currentLayout = layoutActor.getFlag(MODULE_ID, "layout") || {};
            const updateData = foundry.utils.deepClone(this._localLayout);

            // Foundry's setFlag merges by default. 
            // To remove keys that exist in the DB but NOT in our local state, 
            // we must explicitly set them to null with the -= prefix.
            for (const coord of Object.keys(currentLayout)) {
                if (!(coord in updateData)) {
                    updateData[`-=${coord}`] = null;
                }
            }

            await layoutActor.setFlag(MODULE_ID, "layout", updateData);
            ui.notifications.info("Bastion layout saved.");
            this.render();
        }
    }

    static async onUpgradeFacility(event, target) {
        const ds = target.dataset;
        if (!ds.itemId) return;

        let fac;
        if (ds.isFlag === "true") {
            const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
            fac = groupFacilities.find(f => f._id === ds.itemId);
        } else {
            fac = this.actor.items.get(ds.itemId);
        }
        if (!fac) return;

        const name = fac.name;
        const MODULE_ID = "dnd-2024-bastion-manager";
        const facFlags = ds.isFlag === "true" ? fac.flags?.[MODULE_ID] : fac.getFlag(MODULE_ID);
        const currentSize = ds.isFlag === "true" ? facFlags?.size : fac.getFlag(MODULE_ID, "size") || "Roomy";

        // Define scaling logic first
        const ignoreReqs = game.settings.get("dnd-2024-bastion-manager", "ignoreConstructionCosts");
        const globalCostMult = game.settings.get("dnd-2024-bastion-manager", "globalCostMultiplier") ?? 100;
        const globalTimeMult = game.settings.get("dnd-2024-bastion-manager", "globalTimeMultiplier") ?? 100;

        const getVal = (key, base, isTime = false) => {
            if (ignoreReqs) return 0;
            const granularValue = game.settings.get("dnd-2024-bastion-manager", key) ?? base;
            if (granularValue !== base) return granularValue; // Precedence: Manually changed values ignore global mults

            const globalMult = isTime ? globalTimeMult : globalCostMult;
            let val = Math.floor(base * (globalMult / 100));
            if (isTime && globalMult > 0 && base > 0) val = Math.max(1, val);
            return val;
        }

        if (facFlags?.upgradeTurns > 0) return ui.notifications.warn("This facility is already being enlarged.");

        // Determine if basic or special and next size costs
        const isBasic = fac.system?.type?.value === "basic";
        const enlargeableSpecials = ["Archive", "Barrack", "Garden", "Pub", "Stable", "Workshop"];
        const isEnlargeableSpecial = enlargeableSpecials.some(sn => name.includes(sn));

        let upgradeData = null;
        let showSizeSelect = false;
        if (isBasic) {
            if (currentSize === "Cramped") {
                showSizeSelect = true;
                upgradeData = {
                    roomy: { 
                        to: "Roomy", 
                        cost: getVal("enlargeRoomyCost", 500, false), 
                        turns: getVal("enlargeRoomyTime", 4, true) 
                    },
                    vast: { 
                        to: "Vast", 
                        cost: getVal("enlargeRoomyCost", 500, false) + getVal("enlargeVastCost", 2000, false), 
                        turns: getVal("enlargeRoomyTime", 4, true) + getVal("enlargeVastTime", 12, true) 
                    }
                };
            } else if (currentSize === "Roomy") {
                upgradeData = { 
                    to: "Vast", 
                    cost: getVal("enlargeVastCost", 2000, false), 
                    turns: getVal("enlargeVastTime", 12, true) 
                };
            }
        } else if (isEnlargeableSpecial) {
            if (currentSize === "Cramped") {
                // Non-standard for specials, but supported for consistency
                upgradeData = { 
                    to: "Roomy", 
                    cost: getVal("enlargeRoomyCost", 500, false), 
                    turns: getVal("enlargeRoomyTime", 4, true) 
                };
            } else if (currentSize === "Roomy") {
                upgradeData = { 
                    to: "Vast", 
                    cost: getVal("enlargeVastCost", 2000, false), 
                    turns: getVal("enlargeVastTime", 12, true) 
                };
            }
        }
        if (!upgradeData) return ui.notifications.warn("This facility cannot be enlarged further according to the DMG rules.");

        const currentGP = this.actor.system.currency?.gp || 0;

        let promptContent = `<div class="bastion-app"><p>Enlarging the <b>${name}</b> from ${currentSize}:</p>`;
        if (showSizeSelect) {
            promptContent += `
                <div class="form-group">
                    <label>Enlarge To:</label>
                    <select name="targetSize" class="enlarge-size-select" style="width: 100%;">
                        <option value="Roomy">Roomy (+${upgradeData.roomy.cost} GP, ${upgradeData.roomy.turns} Turns)</option>
                        <option value="Vast">Vast (+${upgradeData.vast.cost} GP, ${upgradeData.vast.turns} Turns)</option>
                    </select>
                </div>`;
        } else {
            if (currentGP < upgradeData.cost) return ui.notifications.warn(`Insufficient gold. Need ${upgradeData.cost} GP.`);
            promptContent += `<ul><li><b>To:</b> ${upgradeData.to}</li><li><b>Cost:</b> ${upgradeData.cost} GP</li><li><b>Time:</b> ${upgradeData.turns} Turns</li></ul>`;
        }

        let subType2SelectionNeeded = false;
        if (name.includes("Garden") && (upgradeData.to === "Vast" || showSizeSelect)) {
            const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
            let gardenOptions = "";
            if (outPack?.folders) {
                const root = outPack.folders.get("HYjssa08njsoKbTO") || outPack.folders.find(f => f.name.toLowerCase().trim() === "garden");
                if (root) {
                    gardenOptions = outPack.folders.filter(f => String(f.folder?.id || f.folder || f.parentId) === String(root.id))
                        .map(o => `<option value="${o.name}">${o.name}</option>`).join("");
                }
            }
            promptContent += `<div id="subType2-container" style="margin-top: 10px; border-top: 1px solid #ccc; padding-top: 10px; ${upgradeData.to !== "Vast" ? 'display: none;' : ''}">
                                <p>A Vast Garden functions as two Roomy Gardens. Select the type for your <b>second</b> garden plot:</p>
                                <select name="subType2" style="width: 100%;">${gardenOptions}</select>
                              </div>`;
            subType2SelectionNeeded = true;
        }
        promptContent += `</div>`;

        const confirmData = await DialogV2.prompt({
            window: { title: "Enlarge Facility" },
            content: promptContent + `<p>Proceed with the construction?</p>`,
            ok: { label: "Confirm Construction", callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
            render: (event) => {
                const html = event.target.element;
                html.querySelector('.enlarge-size-select')?.addEventListener('change', (ev) => {
                    const container = html.querySelector('#subType2-container');
                    if (container) container.style.display = ev.target.value === "Vast" ? "block" : "none";
                });
            },
            rejectClose: false
        });

        if (confirmData) {
            if (showSizeSelect) {
                upgradeData = confirmData.targetSize === "Vast" ? upgradeData.vast : upgradeData.roomy;
            }

            if (currentGP < upgradeData.cost) return ui.notifications.warn(`Insufficient gold. Need ${upgradeData.cost} GP.`);
            if (upgradeData.cost > 0) await this.actor.update({ "system.currency.gp": currentGP - upgradeData.cost });
            
            // If time is ignored or multiplier results in 0, upgrade instantly
            if (upgradeData.turns === 0) {
                if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                    const gf = groupFacilities.find(f => f._id === ds.itemId);
                    if (gf) {
                        if (!gf.flags) gf.flags = {}; if (!gf.flags["dnd-2024-bastion-manager"]) gf.flags["dnd-2024-bastion-manager"] = {};
                        gf.flags["dnd-2024-bastion-manager"].size = upgradeData.to;
                        if (confirmData.subType2) gf.flags["dnd-2024-bastion-manager"].subType2 = confirmData.subType2; // confirmData.subType2 will be null or a value
                        await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacilities);
                    }
                } else {
                    await fac.setFlag("dnd-2024-bastion-manager", "size", upgradeData.to);
                    if (confirmData.subType2) await fac.setFlag("dnd-2024-bastion-manager", "subType2", confirmData.subType2); // confirmData.subType2 will be null or a value
                }
                ui.notifications.info(`${name} instantly enlarged to ${upgradeData.to}.`);
                return this.render();
            }

            const updateObj = {
                "targetSize": upgradeData.to,
                "upgradeProgress": 0,
                "upgradeTurns": upgradeData.turns,
                "targetSubType2": confirmData.subType2 // confirmData.subType2 will be null or a value
            };

            if (ds.isFlag === "true") {
                const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                const gf = groupFacilities.find(f => f._id === ds.itemId);
                if (gf) {
                    if (!gf.flags) gf.flags = {}; if (!gf.flags["dnd-2024-bastion-manager"]) gf.flags["dnd-2024-bastion-manager"] = {};
                    Object.assign(gf.flags["dnd-2024-bastion-manager"], updateObj);
                    await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacilities);
                }
            } else {
                for (let [k, v] of Object.entries(updateObj)) await fac.setFlag("dnd-2024-bastion-manager", k, v);
            }
            ui.notifications.info(`Enlargement of ${name} has begun.`);
            this.render();
        }
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

            // Clear squares occupied by this facility from the local layout cache
            if (this._localLayout) {
                for (const [coord, id] of Object.entries(this._localLayout)) {
                    if (id === ds.itemId) delete this._localLayout[coord];
                }
            }

            this.render();
        }
    }

    static async onBuildFromDropdown(event, target) {
        if (this.actor.type === "group") return ui.notifications.warn("Facilities cannot be built directly on a Group Bastion. They must be established by individual members.");
        const selectElement = this.element.querySelector('select[name="compendium-facility"]');
        if (!selectElement?.value) return ui.notifications.warn("Select a facility first!");

        const pack = game.packs.get("dnd-2024-bastion-manager.bastion-facilities");
        const itemDoc = await pack.getDocument(selectElement.value);
        let newFacData = itemDoc.toObject();
        const MODULE_ID = "dnd-2024-bastion-manager";

        // Identify Basic vs Special
        const isBasic = itemDoc.system?.type?.value === "basic";
        const buildTimeEnabled = !isBasic && game.settings.get(MODULE_ID, "specialFacilitiesBuildTime");


        // Cost Calculation Helper
        const getVal = (key, base, isTime = false) => {
            if (game.settings.get(MODULE_ID, "ignoreConstructionCosts")) return 0;
            const granularValue = game.settings.get(MODULE_ID, key) ?? base;
            if (granularValue !== base) return granularValue;
            const globalMult = isTime ? game.settings.get(MODULE_ID, "globalTimeMultiplier") : game.settings.get(MODULE_ID, "globalCostMultiplier");
            let val = Math.floor(base * ((globalMult ?? 100) / 100));
            if (isTime && (globalMult ?? 100) > 0 && base > 0) val = Math.max(1, val);
            return val;
        };

        const sizeCosts = {
            Cramped: { cost: getVal("buildCrampedCost", 500, false), turns: getVal("buildCrampedTime", 3, true) },
            Roomy: { cost: getVal("buildRoomyCost", 1000, false), turns: getVal("buildRoomyTime", 7, true) },
            Vast: { cost: getVal("buildVastCost", 3000, false), turns: getVal("buildVastTime", 18, true) }
        };

        // Prepare Prompt Content
        let promptContent = "";

        if (buildTimeEnabled) {
            const roomy = sizeCosts.Roomy;
            promptContent += `<div style="background: rgba(0,0,0,0.05); padding: 8px; border-radius: 4px; border: 1px solid #ccc; margin-bottom: 10px;">
                <p style="margin:0;"><b>Construction Plan:</b> Roomy ${itemDoc.name}</p>
                <p style="margin:0; font-size: 0.9em; color: #555;">Requires <b>${roomy.cost} GP</b> and <b>${roomy.turns} Turns</b>.</p>
            </div>`;
        }

        if (isBasic) {
            promptContent += `
                <div style="margin-bottom: 15px; border-bottom: 1px solid #ccc; padding-bottom: 10px;">
                    <p>Select the size for your <b>${itemDoc.name}</b>:</p>
                    <select name="size" style="width: 100%;">
                        <option value="Cramped">Cramped (${sizeCosts.Cramped.cost} GP, ${sizeCosts.Cramped.turns} Turns)</option>
                        <option value="Roomy" selected>Roomy (${sizeCosts.Roomy.cost} GP, ${sizeCosts.Roomy.turns} Turns)</option>
                        <option value="Vast">Vast (${sizeCosts.Vast.cost} GP, ${sizeCosts.Vast.turns} Turns)</option>
                    </select>
                </div>
            `;
        }

        const isGarden = itemDoc.name.includes("Garden");
        const isGuild = itemDoc.name.includes("Guildhall");
        if (isGarden || isGuild) {
            const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
            let specializationOptions = "";
            if (outPack?.folders) {
                const root = isGarden ? (outPack.folders.get("HYjssa08njsoKbTO") || outPack.folders.find(f => f.name.toLowerCase().trim() === "garden"))
                        : (outPack.folders.get("ni06boefwcrUwFQa") || outPack.folders.find(f => f.name.toLowerCase().trim() === "guildhall"));
                if (root) {
                    specializationOptions = outPack.folders.filter(f => String(f.folder?.id || f.folder || f.parentId) === String(root.id))
                        .map(o => `<option value="${o.name}">${o.name}</option>`).join("");
                }
            }
            promptContent += `
                <div style="margin-bottom: 10px;">
                    <p>Select a specialization for your ${itemDoc.name}:</p>
                    <select name="subType" style="width: 100%;">${specializationOptions}</select>
                </div>
            `;
         } else if (itemDoc.name.includes("Workshop")) {
            const tools = ["Carpenter's Tools", "Cobbler's Tools", "Glassblower's Tools", "Jeweler's Tools", "Leatherworker's Tools", 
                    "Mason's Tools", "Painter's Tools", "Potter's Tools", "Tinker's Tools", "Weaver's Tools", "Woodcarver's Tools"];
            const checkboxes = tools.map(t => `
                <label style="display: block; margin-bottom: 4px;">
                    <input type="checkbox" name="workshopTools" value="${t}"> ${t}
                </label>
            `).join("");
            promptContent += `
                <div style="margin-bottom: 10px;">
                    <p>Select <b>6</b> Artisan's Tools:</p>
                    <div class="tool-selection-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 0.9em;">
                        ${checkboxes}
                    </div>
                </div>
            `;
        }

        let expectedHirelings = 0;
        const hData = itemDoc.system?.hireling || itemDoc.system?.hirelings || itemDoc.system?.details?.hireling || itemDoc.system?.details?.hirelings;
        if (typeof hData === "number") expectedHirelings = hData;
        else if (typeof hData === "string") expectedHirelings = parseInt(hData) || 0;
        else if (typeof hData === "object" && hData !== null) expectedHirelings = parseInt(hData.max) || parseInt(hData.value) || 0;

        if (expectedHirelings > 0 && game.settings.get("dnd-2024-bastion-manager", "nameHirelings")) {
            promptContent += `<p>Name your <b>${expectedHirelings}</b> hireling(s):</p>`;
            for (let i = 0; i < expectedHirelings; i++) {
                promptContent += `<div style="margin-bottom: 8px; display: flex; align-items: center; gap: 10px;">
                                    <label style="width: 80px;">Hireling ${i+1}:</label>
                                    <input type="text" name="hireling_${i}" style="flex-grow: 1;" placeholder="Auto-generate if blank">
                                </div>`;
            }
        }

        if (!promptContent && buildTimeEnabled) {
            const roomy = sizeCosts.Roomy;
            promptContent = `<p>Establish a Roomy <b>${itemDoc.name}</b>? This requires <b>${roomy.cost} GP</b> and <b>${roomy.turns} Turns</b>.</p>`;
        }

        if (promptContent) {
            const formData = await DialogV2.wait({
                window: { title: `Build Facility: ${itemDoc.name}` },
                content: `<div class="bastion-app">${promptContent}</div>`,
                buttons: [
                    { action: "cancel", label: "Cancel", icon: "fas fa-times" },
                    { action: "ok", label: "Build", icon: "fas fa-hammer", default: true, callback: (event, button) => {
                        const form = button.form;
                        const data = new foundry.applications.ux.FormDataExtended(form).object;
                        
                        if (itemDoc.name.includes("Workshop")) {
                        const selected = Array.from(form.elements.workshopTools).filter(i => i.checked).map(i => i.value);
                        if (selected.length !== 6) {
                            ui.notifications.error("You must select exactly 6 tools for a Workshop.");
                            return false; // Prevents dialog from closing so user can fix selection
                        }
                        data.workshopTools = selected;
                    }

                    if (expectedHirelings > 0) {
                        let names = [];
                        const autoGen = game.settings.get(MODULE_ID, "autoNameHirelings");
                        for(let i = 0; i < expectedHirelings; i++) {
                            let val = form.elements[`hireling_${i}`]?.value?.trim();
                            if (!val && autoGen) val = BastionManager._generateRandomName();
                            if (val) names.push(val);
                        }
                        data.hirelings = names;
                    }
                    return data;
                }}
                ],
                render: (event) => {
                    const html = event.target.element;
                    const checkboxes = html.querySelectorAll('input[name="workshopTools"]');
                    if (checkboxes.length === 0) return;

                    const updateCheckboxes = () => {
                        const checkedCount = Array.from(checkboxes).filter(i => i.checked).length;
                        checkboxes.forEach(i => {
                            if (!i.checked) i.disabled = checkedCount >= 6;
                        });
                    };

                    checkboxes.forEach(cb => cb.addEventListener('change', updateCheckboxes));
                }
            });
            
            if (!formData || formData === "cancel") return;

            const size = isBasic ? formData.size : "Roomy";
            const cost = sizeCosts[size].cost;
            const turns = isBasic ? sizeCosts[size].turns : (buildTimeEnabled ? sizeCosts.Roomy.turns : 0);
            const currentGP = this.actor.system.currency?.gp || 0;

            if (currentGP < cost) return ui.notifications.warn(`Insufficient gold. Need ${cost} GP.`);
            if (cost > 0) await this.actor.update({ "system.currency.gp": currentGP - cost });

            // Apply selections
            if (formData.subType) foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.subType`, formData.subType);
            if (formData.workshopTools) foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.workshopTools`, formData.workshopTools);
            if (formData.hirelings) {
                foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.hirelings`, formData.hirelings);
                let prof = BastionManager._getHirelingProfession(itemDoc.name, formData.subType);
                formData.hirelings.forEach(h => BastionManager._createHirelingActor(h, prof, this.actor.name, itemDoc.name, false));
            }

            if (turns > 0) {
                foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.upgradeTurns`, turns);
                foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.upgradeProgress`, 0);
                foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.targetSize`, size);
                foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.size`, null);
                
                newFacData._id = foundry.utils.randomID();
                const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                gf.push(newFacData);
                await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
            } else {
                foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.size`, size);
                if (this.actor.type === "group") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    newFacData._id = foundry.utils.randomID();
                    gf.push(newFacData);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    await Item.create(newFacData, { parent: this.actor });
                }
            }
            } else {
            // No prompt needed, instant build (happens if all options disabled and build times off)
            await Item.create(newFacData, { parent: this.actor });
        }
        this.render(); 
    }

    static async onViewBastionMap(event, target) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        let sceneId = this.actor.getFlag(MODULE_ID, "mapSceneId");
        let scene = game.scenes.get(sceneId);

        if (!scene) {
            if (!game.user.can("SCENE_CREATE")) {
                return ui.notifications.error("You do not have permission to create Scenes. Please ask your GM to initialize the Bastion Map.");
            }

            const confirm = await DialogV2.confirm({
                window: { title: "Create Bastion Map" },
                content: `<p>No map exists for <b>${this.actor.name}</b>. Create a new Scene for the Bastion layout? (Grid: 5ft, Size: 3000x3000px)</p>`,
                rejectClose: false,
                modal: true
            });
            if (!confirm) return;

            scene = await Scene.create({
                name: `${this.actor.name}'s Bastion Map`,
                grid: { type: 1, size: 100, distance: 5, units: "ft" },
                width: 3000,
                height: 3000,
                backgroundColor: "#222222",
                ownership: { [game.user.id]: 3 }
            });
            await this.actor.setFlag(MODULE_ID, "mapSceneId", scene.id);
            ui.notifications.info("Bastion Scene created. You have ownership to edit the layout.");
        }
        await scene.view();
    }

    static async onBuildDefensiveWall(event, target) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const globalCostMult = game.settings.get(MODULE_ID, "globalCostMultiplier") ?? 100;
        const wallCost = Math.floor(250 * (globalCostMult / 100));

        const squares = await DialogV2.prompt({
            window: { title: "Build Defensive Walls" },
            content: `
                <div class="form-group">
                    <p>Each 5-foot square of wall costs <b>${wallCost} GP</b>.</p>
                    <label>Number of 5ft Squares:</label>
                    <input type="number" name="squares" value="1" min="1" step="1">
                </div>
            `,
            ok: { 
                label: "Start Construction",
                callback: (event, button) => parseInt(button.form.elements.squares.value) || 0 
            }
        });

        if (!squares) return;

        const globalTimeMult = game.settings.get(MODULE_ID, "globalTimeMultiplier") ?? 100;
        const wallTime = Math.floor(10 * (globalTimeMult / 100));
        const cost = squares * wallCost;
        const currentGP = this.actor.system.currency?.gp || 0;

        if (currentGP < cost) return ui.notifications.warn(`Insufficient gold. Need ${cost} GP.`);
        
        const confirm = await DialogV2.confirm({
            window: { title: "Confirm Wall Construction" },
            content: `<p>Spend <b>${cost} GP</b> to begin building <b>${squares}</b> squares of wall? (Total time: ${squares * wallTime} days)</p>`
        });

        if (confirm) {
            await this.actor.update({ "system.currency.gp": currentGP - cost });
            const currentPending = this.actor.getFlag(MODULE_ID, "pendingWallDays") || 0;
            await this.actor.setFlag(MODULE_ID, "pendingWallDays", currentPending + (squares * wallTime));
            this.render();
        }
    }

    // --- UI ACTION ---
    static async onAdvanceGlobalTurn(event, target) {
        const turnsInput = this.element.querySelector('input[name="turns"]');
        const turnsToAdvance = parseInt(turnsInput?.value) || 1;

        const playerActors = game.actors.filter(a => a.hasPlayerOwner && a.type === "character");
        let allMissing = [];
        let warningShown = false;
        for (let actor of playerActors) {
            allMissing.push(...BastionManager._validateFacilities(actor));
        }

        if (allMissing.length > 0) {
            let list = allMissing.map(m => `<li>${m}</li>`).join("");
            const proceed = await DialogV2.confirm({
                window: { title: "Incomplete Selections" },
                content: `<p>The following facilities have active orders but are missing required selections:</p><ul>${list}</ul><p>Facilities with missing selections will be issued the Maintain order. Proceed anyway?</p>`,
                rejectClose: false,
                modal: true
            });
            if (!proceed) return;
            warningShown = true;
        }

        const confirm = warningShown || await DialogV2.confirm({ 
            window: { title: "Advance Bastion Turn" }, 
            content: `<p>Are you sure you want to advance the global Bastion turn by <b>${turnsToAdvance}</b>?</p>`, 
            rejectClose: false, modal: true 
        });

        if (confirm) {
            const currentGlobalTurns = game.settings.get("dnd-2024-bastion-manager", "globalTurnCount") || 0;
            await game.settings.set("dnd-2024-bastion-manager", "globalTurnCount", currentGlobalTurns + turnsToAdvance);

            const playerActors = game.actors.filter(a => {
                const isAllowed = a.type === "character" || a.type === "npc";
                return isAllowed && (a.items.some(i => i.type === "facility") || a.getFlag("dnd-2024-bastion-manager", "groupFacilities")?.length > 0);
            });
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

        let globalDefenders = activeFacilities.reduce((sum, fac) => sum + (fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.defenders?.count || 0) : (fac.doc.getFlag("dnd-2024-bastion-manager", "defenders.count") || 0)), 0);
        let hasSmithy = activeFacilities.some(fac => fac.doc.name.includes("Smithy"));
        let actorLevel = (actor.type === "character" || actor.type === "npc") ? (actor.system.details?.level || 1) : 1;

        const resolution = await BastionManager._resolveOrders(actor, activeFacilities, turnsToAdvance, globalDefenders, hasSmithy, actorLevel);

        // --- NEGLECT LOGIC ---
        const MODULE_ID = "dnd-2024-bastion-manager";
        const disableNeglect = game.settings.get(MODULE_ID, "disableNeglect");
        let neglectCounter = actor.getFlag(MODULE_ID, "neglectCounter") || 0;
        
        if (resolution.effectivelyAllMaintaining && !disableNeglect) {
            neglectCounter += turnsToAdvance;
            
            if (neglectCounter >= actorLevel) {
                await BastionManager._triggerBastionFall(actor, "Neglect");
                return null; // Stop turn processing, the bastion is gone
            }
        } else {
            // Reset counter if any actual orders were issued or neglect is disabled
            if (neglectCounter > 0 || disableNeglect) neglectCounter = 0;
        }

        // Ensure we are working with clean integers to avoid DataModel validation errors
        const currentGP = Number(actor.system.currency?.gp || 0) || 0;
        const totalGoldAdjustment = Math.floor(Number(resolution.totalGold) || 0);
        const finalGP = Math.max(0, currentGP + totalGoldAdjustment);

        // Batch all updates for the Actor
        const actorUpdate = {
            "system.currency.gp": finalGP,
            [`flags.${MODULE_ID}.neglectCounter`]: neglectCounter
        };

        // Update the facility flags (pending builds)
        actorUpdate[`flags.${MODULE_ID}.groupFacilities`] = resolution.groupFacilities;

        // 1. Prioritize Facility Item Updates (Progress, Orders, etc.)
        if (resolution.itemUpdates.length > 0) {
            await actor.updateEmbeddedDocuments("Item", resolution.itemUpdates);
        }

        // 2. Handle structural build completions (Promotion)
        if (resolution.itemsToPromote.length > 0) {
            await actor.createEmbeddedDocuments("Item", resolution.itemsToPromote);
        }

        // 3. Finalize Actor state (GP, Neglect, Group Facilities)
        await actor.update(actorUpdate, { diff: true, recursive: true });
        await BastionManager._processInventory(actor, resolution.items);

        return await BastionManager._buildReport(actor, turnsToAdvance, resolution.effectivelyAllMaintaining, resolution);
    }

    // --- HELPER: VALIDATION ---
    static _validateFacilities(actor) {
        const facilities = BastionManager._getActorFacilities(actor);
        const missing = [];
        const MODULE_ID = "dnd-2024-bastion-manager";

        for (const fac of facilities) {
            const order = fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.order || "Maintain") : (fac.doc.getFlag(MODULE_ID, "order") || "Maintain");
            
            if (order === "Maintain") continue;

            if (fac.name.includes("Library") && order === "Research") {
                const topic = fac.isFlag ? fac.doc.flags?.[MODULE_ID]?.libraryTopic : fac.doc.getFlag(MODULE_ID, "libraryTopic");
                if (!topic || topic.trim() === "") missing.push(`${actor.name}: Library needs a Research Topic.`);
            }
            
            if (fac.name.includes("Arcane Study") && order === "Craft") {
                const choice = fac.isFlag ? fac.doc.flags?.[MODULE_ID]?.craftChoice : fac.doc.getFlag(MODULE_ID, "craftChoice");
                const queue = fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.craftQueue || []) : (fac.doc.getFlag(MODULE_ID, "craftQueue") || []);
                if (!choice && queue.length === 0) missing.push(`${actor.name}: Arcane Study needs a Craft selection or Queue.`);
                else if (choice === "Arcane Focus") {
                    const focusChoice = fac.isFlag ? fac.doc.flags?.[MODULE_ID]?.focusChoice : fac.doc.getFlag(MODULE_ID, "focusChoice");
                    if (!focusChoice) missing.push(`${actor.name}: Arcane Study (Arcane Focus) needs a Focus Type selection.`);
                }
            }

            if (fac.name.includes("Sanctuary") && order === "Craft") {
                const choice = fac.isFlag ? fac.doc.flags?.[MODULE_ID]?.craftChoice : fac.doc.getFlag(MODULE_ID, "craftChoice");
                const queue = fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.craftQueue || []) : (fac.doc.getFlag(MODULE_ID, "craftQueue") || []);
                if (!choice && queue.length === 0) missing.push(`${actor.name}: Sanctuary needs a Craft selection or Queue.`);
                else if (choice === "Druidic Focus" || choice === "Holy Symbol") {
                    const sacredFocusChoice = fac.isFlag ? fac.doc.flags?.[MODULE_ID]?.sacredFocusChoice : fac.doc.getFlag(MODULE_ID, "sacredFocusChoice");
                    if (!sacredFocusChoice) missing.push(`${actor.name}: Sanctuary (${choice}) needs a Focus Type selection.`);
                }
            } else if (fac.name.includes("Smithy") && order === "Craft") {
                const choice = fac.isFlag ? fac.doc.flags?.[MODULE_ID]?.craftChoice : fac.doc.getFlag(MODULE_ID, "craftChoice");
                const queue = fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.craftQueue || []) : (fac.doc.getFlag(MODULE_ID, "craftQueue") || []);
                if (!choice && queue.length === 0) missing.push(`${actor.name}: Smithy needs a Craft selection or Queue.`);
                else if (choice === "Smith's Tools") {
                    const itemChoice = fac.isFlag ? fac.doc.flags?.[MODULE_ID]?.smithyItemChoice : fac.doc.getFlag(MODULE_ID, "smithyItemChoice");
                    if (!itemChoice) missing.push(`${actor.name}: Smithy (Smith's Tools) needs an item selection.`);
                } else if (choice === "Magic Item (Armament)") {
                    const itemChoice = fac.isFlag ? fac.doc.flags?.[MODULE_ID]?.armamentItemChoice : fac.doc.getFlag(MODULE_ID, "armamentItemChoice");
                    if (!itemChoice) missing.push(`${actor.name}: Smithy (Armament) needs a Magic Item selection.`);
                }
            }

            if (fac.name.includes("Garden")) {
                if (order === "Harvest") {
                    const choice = fac.isFlag ? fac.doc.flags?.["dnd-2024-bastion-manager"]?.harvestChoice : fac.doc.getFlag("dnd-2024-bastion-manager", "harvestChoice");
                    if (!choice) missing.push(`${actor.name}: Garden needs a Harvest selection.`);
                }
                if (order === "Change Type") {
                    const pending = fac.isFlag ? fac.doc.flags?.["dnd-2024-bastion-manager"]?.pendingSubType : fac.doc.getFlag("dnd-2024-bastion-manager", "pendingSubType");
                    if (!pending) missing.push(`${actor.name}: Garden needs a target Specialization for Change Type.`);
                }
            }
        }
        return missing;
    }

    // --- HELPER: FACILITY GATHERING ---
    static _getActorFacilities(actor) {
        let facs = [];
        const MODULE_ID = "dnd-2024-bastion-manager";
        actor.items.filter(item => item.type === "facility").forEach(i => facs.push({ doc: i, name: i.name, isFlag: false }));
        const flagFacs = actor.getFlag(MODULE_ID, "groupFacilities") || [];
        flagFacs.forEach(f => facs.push({ doc: f, name: f.name, isFlag: true }));
        return facs;
    }

    // --- HELPER: ORDER RESOLUTION ---
    static async _resolveOrders(actor, facilities, turns, defenders, hasSmithy, level) {
        let orderSummary = "";
        let totalGold = 0;
        let items = [];
        let itemUpdates = [];
        const MODULE_ID = "dnd-2024-bastion-manager";
        
        let groupFacilities = actor.getFlag(MODULE_ID, "groupFacilities") || [];
        let itemsToPromote = [];
        let flagsToRemove = [];

        let effectivelyAllMaintaining = true; 
        // Handle structural path completion
        const combinedGroupId = actor.getFlag(MODULE_ID, "combinedGroupId");
        const combinedGroup = combinedGroupId ? game.actors.get(combinedGroupId) : null;
        const layoutActor = (actor.type !== "group" && combinedGroup) ? combinedGroup : actor;
        const layout = layoutActor.getFlag(MODULE_ID, "layout") || {};
        let layoutChanged = false;

        for (const [coord, val] of Object.entries(layout)) {
            if (val === "structural-path-pending") {
                layout[coord] = "structural-path";
                layoutChanged = true;
            }
        }
        if (layoutChanged) await layoutActor.setFlag(MODULE_ID, "layout", layout);

        // Handle Defensive Wall Progress
        let wallDays = actor.getFlag(MODULE_ID, "pendingWallDays") || 0;
        if (wallDays > 0) {
            let wallCount = actor.getFlag(MODULE_ID, "completedWalls") || 0;
            let wallRemainder = actor.getFlag(MODULE_ID, "wallDayRemainder") || 0;
            
            const elapsedDays = (turns * 7) + wallRemainder;
            const finishedSquares = Math.floor(elapsedDays / 10);
            const remainingPending = Math.max(0, wallDays - (turns * 7));
            
            // We only finish squares up to the amount that was actually pending
            const actualFinished = Math.min(finishedSquares, Math.ceil(wallDays / 10));
            
            wallCount += actualFinished;
            wallRemainder = elapsedDays % 10;
            
            await actor.setFlag(MODULE_ID, "completedWalls", wallCount);
            await actor.setFlag(MODULE_ID, "pendingWallDays", remainingPending);
            await actor.setFlag(MODULE_ID, "wallDayRemainder", remainingPending > 0 ? wallRemainder : 0);

            if (actualFinished > 0) {
                orderSummary += `<li style="margin-bottom: 6px; padding: 4px; background: rgba(163,42,34,0.1); border-radius: 3px;">
                    <i class="fa-solid fa-border-all"></i> <b>Defensive Walls:</b> Built ${actualFinished} square(s). Total: ${wallCount}
                </li>`;
            }
        }

        for (const facEntry of facilities) {
            const facDoc = facEntry.doc;
            const facName = facEntry.name || facDoc.name || "";

            // Unified flag reader to ensure reactive data access
            const getFacFlag = (key) => facEntry.isFlag ? (facDoc.flags?.[MODULE_ID]?.[key]) : (facDoc.getFlag(MODULE_ID, key));

            const isBasic = facDoc.system?.type?.value === "basic";
            let order = isBasic ? "Maintain" : (getFacFlag("order") || "Maintain");
            let subType = getFacFlag("subType");
            let progress = Number(getFacFlag("progress") || 0);
            
            // Use || instead of ?? to ensure null values from construction don't fallback to truthy defaults 
            // unless the construction flag itself is missing.
            let facSize = getFacFlag("size");
            if (facSize === undefined) facSize = isBasic ? "Roomy" : null;

            let craftChoice = getFacFlag("craftChoice");
            let craftQueue = getFacFlag("craftQueue") || [];
            let focusChoice = getFacFlag("focusChoice");
            let magicItemChoice = getFacFlag("magicItemChoice");
            let sacredFocusChoice = getFacFlag("sacredFocusChoice");
            let libraryTopic = getFacFlag("libraryTopic");
            let workshopItemChoice = getFacFlag("workshopItemChoice");
            let smithyItemChoice = getFacFlag("smithyItemChoice");
            let armamentItemChoice = getFacFlag("armamentItemChoice");
            let storedGp = Number(getFacFlag("storedGp") || 0);
            let autoNextAction = getFacFlag("autoNextAction") || "procure";

            // Auto-shift from queue if order is Craft but no active item is specified
            if (order === "Craft" && !craftChoice && craftQueue.length > 0) {
                const next = craftQueue.shift();
                craftChoice = next.craftType;
                const name = facDoc.name;
                if (name.includes("Arcane Study")) {
                    if (craftChoice === "Arcane Focus") focusChoice = next.choice;
                    else if (craftChoice === "Magic Item (Arcana)") magicItemChoice = next.choice;
                } else if (name.includes("Smithy")) {
                    if (craftChoice === "Smith's Tools") smithyItemChoice = next.choice;
                    else if (craftChoice === "Magic Item (Armament)") armamentItemChoice = next.choice;
                } else if (name.includes("Sanctuary")) {
                    sacredFocusChoice = next.choice;
                }
                progress = 0;
            }

            let upgradeProgress = getFacFlag("upgradeProgress") || 0;
            let targetSize = getFacFlag("targetSize");
            let targetSubType2 = getFacFlag("targetSubType2");
            let facSubType2 = getFacFlag("subType2");
            let upgradeTurns = getFacFlag("upgradeTurns") || 0;

            const wasNewBuild = facEntry.isFlag && !facSize;
            if (targetSize && upgradeTurns <= 0) upgradeTurns = 1;

            // Check for insufficient input - default to Maintain if missing required data
            let insufficientReason = null;
            if (facDoc.name.includes("Library") && order === "Research") {
                if (!libraryTopic || libraryTopic.trim() === "") insufficientReason = "No research topic chosen";
            } else if (facDoc.name.includes("Garden")) {
                if (order === "Harvest") {
                    const choice = facEntry.isFlag ? facFlags.harvestChoice : facDoc.getFlag(MODULE_ID, "harvestChoice");
                    if (!choice) insufficientReason = "No harvest selection made";
                } else if (order === "Change Type") {
                    const pending = facEntry.isFlag ? facFlags.pendingSubType : facDoc.getFlag(MODULE_ID, "pendingSubType");
                    if (!pending) insufficientReason = "No specialization chosen";
                }
            } else if (facDoc.name.includes("Arcane Study") && order === "Craft") {
                if (!craftChoice) {
                    insufficientReason = "No craft selection made";
                } else if (craftChoice === "Arcane Focus") {
                    if (!focusChoice) insufficientReason = "No Arcane Focus type selected";
                } else if (craftChoice === "Magic Item (Arcana)") {
                    if (!magicItemChoice) insufficientReason = "No Magic Item selected to craft";
                }
            } else if (facDoc.name.includes("Sanctuary") && order === "Craft") {
                if (!craftChoice) insufficientReason = "No craft selection made";
                else if ((craftChoice === "Druidic Focus" || craftChoice === "Holy Symbol") && !sacredFocusChoice) {
                    insufficientReason = `No ${craftChoice} type selected`;
                }
            }

            if (!isBasic && order !== "Maintain") {
                effectivelyAllMaintaining = false;
            }

            let currentResultText = "";
            let localGold = 0;
            let materialCost = 0;

            // Check if the first item in the queue is a paused project and resume it
            if (order === "Craft" && !craftChoice && craftQueue.length > 0) {
                const firstQueueItem = craftQueue[0];
                if (firstQueueItem.isPausedProject) {
                    const resumedProject = craftQueue.shift();
                    craftChoice = resumedProject.craftType;
                    progress = resumedProject.currentProgress; // Restore progress
                    // Restore specific item choices
                    if (facDoc.name.includes("Arcane Study")) { if (craftChoice === "Arcane Focus") focusChoice = resumedProject.choice; else magicItemChoice = resumedProject.choice; }
                    else if (facDoc.name.includes("Smithy")) { if (craftChoice === "Smith's Tools") smithyItemChoice = resumedProject.choice; else armamentItemChoice = resumedProject.choice; }
                    else if (facDoc.name.includes("Sanctuary")) { sacredFocusChoice = resumedProject.choice; }
                    else if (facDoc.name.includes("Workshop")) { workshopItemChoice = resumedProject.choice; }
                    currentResultText = currentResultText ? `${currentResultText} | Resumed: <b>${resumedProject.label}</b>` : `Resumed: <b>${resumedProject.label}</b>`;
                }
            }

            for (let i = 0; i < turns; i++) {
                if (insufficientReason) {
                    currentResultText = `Skipped: ${insufficientReason}.`;
                    break;
                }

                if (order === "Maintain") {
                    if (!currentResultText) currentResultText = insufficientReason ? `Maintained operations (${insufficientReason}).` : "Maintained standard operations.";
                } else if (order === "Trade") {
                    if (facDoc.name.includes("Storehouse")) {
                        let choice = (facEntry.isFlag ? facFlags.tradeChoice : facDoc.getFlag(MODULE_ID, "tradeChoice")) || "procure";
                        let amount = Number(facEntry.isFlag ? facFlags.tradeAmount : facDoc.getFlag(MODULE_ID, "tradeAmount")) || 0;

                        if (choice === "auto") {
                            choice = autoNextAction;
                            amount = 999999; // In auto mode, we always try for the maximum
                        }

                        const limit = level >= 13 ? 5000 : (level >= 9 ? 2000 : 500);
                        const markup = level >= 17 ? 2.0 : (level >= 13 ? 1.5 : (level >= 9 ? 1.2 : 1.1));

                        if (choice === "procure") {
                            const currentActorGP = Number(actor.system.currency?.gp || 0) || 0;
                            // Clamp actualAmount to available funds (including turn-to-date changes) and storage limit
                            const actualAmount = Math.floor(Math.max(0, Math.min(amount, currentActorGP + totalGold + localGold, limit - storedGp)));
                            if (actualAmount <= 0) {
                                currentResultText = "Procurement failed: Insufficient funds or storage capacity.";
                            } else {
                                localGold -= actualAmount;
                                storedGp += actualAmount;
                                currentResultText = `Procured <b>${actualAmount} GP</b> worth of goods. (Stock: ${storedGp}/${limit} GP)`;
                            }
                        } else { // Sell
                            const actualAmount = Math.floor(Math.min(amount, storedGp));
                            if (actualAmount <= 0) {
                                currentResultText = "Sale failed: No goods in stock to sell.";
                            } else {
                                const profit = Math.floor(actualAmount * markup);
                                storedGp -= actualAmount;
                                localGold += profit;
                                currentResultText = `Sold <b>${actualAmount} GP</b> worth of goods for <b>${profit} GP</b> profit. (Stock: ${storedGp}/${limit} GP)`;
                            }
                        }

                        if (getFacFlag("tradeChoice") === "auto") {
                            autoNextAction = (choice === "procure") ? "sell" : "procure";
                        }

                        // Persist the stored GP back to the local variable for the batch update
                        facEntry.storedGp = storedGp; 
                    } else {
                        let tradeRes = await BastionManager._handleTrade(facDoc.name, defenders, hasSmithy, level);
                        localGold += tradeRes.gold; currentResultText = tradeRes.text;
                    }
                } else if (order === "Harvest") {
                    let harvestRes = await BastionManager._handleHarvest(facDoc.name, subType, facEntry);
                    if (harvestRes.item) items.push(harvestRes.item);
                    currentResultText = harvestRes.text;
                    if (facDoc.name.includes("Garden") && facSize === "Vast" && facSubType2) {
                        let harvestRes2 = await BastionManager._handleHarvest(facDoc.name, facSubType2, facEntry, true);
                        if (harvestRes2.item) items.push(harvestRes2.item);
                        currentResultText += ` and ${harvestRes2.text}`;
                    }
                } else if (order === "Research") {
                    let resRes = await BastionManager._handleResearch(facDoc.name, facEntry, subType);
                    currentResultText = resRes.text;
                } else if (order === "Craft") {
                    // If craftChoice is still empty after checking for paused project, try to pull from queue
                    if (!craftChoice && craftQueue.length > 0) {
                        const next = craftQueue.shift();
                        craftChoice = next.craftType;
                        setLocalFlag("craftChoice", craftChoice);
                        progress = next.isPausedProject ? next.currentProgress : 0; // Restore progress if it was a paused project
                        if (facName.includes("Arcane Study")) {
                            if (craftChoice === "Arcane Focus") focusChoice = next.choice;
                            else magicItemChoice = next.choice;
                          } else if (facDoc.name.includes("Workshop")) {
                            workshopItemChoice = next.choice;
                            setLocalFlag("workshopItemChoice", workshopItemChoice);
                        } else if (facName.includes("Smithy")) {
                            if (craftChoice === "Smith's Tools") smithyItemChoice = next.choice;
                            else armamentItemChoice = next.choice;
                         } else if (facName.includes("Sanctuary")) {
                            sacredFocusChoice = next.choice;
                        }
                        currentResultText = currentResultText ? `${currentResultText} | Resuming: <b>${next.label}</b>` : `Resuming: <b>${next.label}</b>`;
                    }

                    if (!craftChoice) {
                        currentResultText = currentResultText || "Idle (No active project or queue)";
                        break;
                    }

                    // Recalculate Project Context (Must happen AFTER potential queue shift)
                    const isArcane = facName.includes("Arcane Study");
                    const isSmithy = facName.includes("Smithy");
                    const isSanctuary = facName.includes("Sanctuary");
                    const isWorkshop = facName.includes("Workshop");
                    
                    const isMagicCraft = ["Magic Item (Arcana)", "Magic Item (Armament)", "Magic Item (Implement)"].includes(craftChoice);
                    const isMundaneLongCraft = (isSmithy && craftChoice === "Smith's Tools") || (isWorkshop && craftChoice === "Adventuring Gear");

                    // 1. Determine Costs and Time Requirements
                    let turnsNeeded = 1;
                    let projectLabel = (isArcane && craftChoice === "Arcane Focus") ? focusChoice :
                                       (isArcane && craftChoice === "Magic Item (Arcana)") ? magicItemChoice :
                                       (isSmithy && craftChoice === "Smith's Tools") ? smithyItemChoice :
                                       (isSmithy && craftChoice === "Magic Item (Armament)") ? armamentItemChoice :
                                       (isWorkshop) ? workshopItemChoice :
                                       (isSanctuary) ? sacredFocusChoice : craftChoice;

                    if (!projectLabel || projectLabel === "Blank Book") projectLabel = craftChoice;

                    let projectTier = "";
                    const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                    const calculationMode = game.settings.get(MODULE_ID, "calculationMode");
                    const daysPerTurn = game.settings.get(MODULE_ID, "daysPerTurn") || 7;

                    if (outPack && (isMagicCraft || isMundaneLongCraft)) {
                        const index = await outPack.getIndex({fields:["system.rarity", "system.price"]});
                        const entry = index.find(e => e.name.toLowerCase() === projectLabel?.toLowerCase());
                        
                        if (isMagicCraft) {
                            if (entry && !entry.system?.rarity) console.warn(`Bastion Manager | Magic item "${projectLabel}" is missing 'system.rarity' in compendium. Defaulting to "common".`);
                            projectTier = entry?.system?.rarity || "common";
                            const isUncommon = String(projectTier).toLowerCase() === "uncommon";
                            const days = isUncommon ? 10 : 5;
                            materialCost = isUncommon ? 200 : 50;
                            turnsNeeded = Math.max(1, Math.ceil(days / daysPerTurn));
                        } else {
                            let p = entry?.system?.price?.value ?? entry?.system?.price ?? 0;
                            if (typeof p === "string") p = parseFloat(p.replace(/[^0-9.]/g, ""));
                            const price = Number(p || 0);
                            materialCost = Math.floor(price / 2);
                            const days = Math.max(1, Math.ceil(price / 10));
                            turnsNeeded = Math.max(1, Math.ceil(days / daysPerTurn));
                        }
                    } else if (craftChoice === "Book") {
                        materialCost = 10;
                        turnsNeeded = 1;
                    }

                    // 2. Initial Turn: Check and Deduct Gold
                    if (progress === 0 && materialCost > 0) {
                        const currentGP = actor.system.currency?.gp || 0;
                        if ((currentGP + totalGold + localGold) < materialCost) {
                            currentResultText = `Crafting paused: Insufficient gold for <b>${projectLabel}</b> materials (${materialCost} GP needed).`;
                            break;
                        }
                        localGold -= materialCost;
                    }

                    // 3. Advance Progress
                    progress += 1;

                    // 4. Completion Handler
                    if (progress >= turnsNeeded) {
                        const specificChoice = isWorkshop ? workshopItemChoice : (isSmithy ? (craftChoice === "Smith's Tools" ? smithyItemChoice : armamentItemChoice) : (isArcane ? (craftChoice === "Arcane Focus" ? focusChoice : magicItemChoice) : (isSanctuary ? sacredFocusChoice : null)));
                        let craftRes = await BastionManager._handleCraft(facDoc.name, facEntry, craftChoice, specificChoice);
                        if (craftRes.item) items.push(craftRes.item);
                        
                        currentResultText = currentResultText ? `${currentResultText} | ${craftRes.text}` : craftRes.text;
                        progress = 0;

                        if (craftQueue.length > 0) {
                            const next = craftQueue.shift();
                            craftChoice = next.craftType;
                            if (isArcane) { if (craftChoice === "Arcane Focus") focusChoice = next.choice; else magicItemChoice = next.choice; }
                            else if (isSmithy) { if (craftChoice === "Smith's Tools") smithyItemChoice = next.choice; else armamentItemChoice = next.choice; }
                            else if (isWorkshop) workshopItemChoice = next.choice;
                            else if (isSanctuary) sacredFocusChoice = next.choice;
                            
                            progress = next.isPausedProject ? next.currentProgress : 0; // Restore progress if it was a paused project
                            currentResultText += `<br><span style="color: #2e7d32; font-weight: bold;"><i class="fa-solid fa-circle-check"></i> Next project started: ${next.label}.</span>`;
                        } else {
                            order = "Maintain";
                            craftChoice = "";
                            currentResultText += `<br><span style="color: #a32a22; font-weight: bold;"><i class="fa-solid fa-circle-exclamation"></i> Order completed! Please issue a new order next turn.</span>`;
                        }
                    } else {
                        const progressLabel = calculationMode === "days" ? "Days" : "Turns";
                        const tierInfo = projectTier ? ` (${projectTier})` : "";
                        currentResultText = `Crafting <b>${projectLabel}</b>${tierInfo}... (${progress}/${turnsNeeded} ${progressLabel})`;
                    }
                } else if (order === "Change Type") {
                    let pending = facFlags.pendingSubType;
                    progress += 1;
                    const totalTurns = facName.includes("Garden") ? 3 : (upgradeTurns || 0); // Assuming 3 turns for Garden Change Type

                    if (progress >= totalTurns) {
                        subType = pending || "Decorative"; progress = 0; 
                        currentResultText = `Completed changing type to <b>[${subType}]</b>.`; 
                    } else { 
                        currentResultText = `Changing type to [${pending}] (Progress: ${progress}/${totalTurns} turns).`; 
                    }
                } else if (order === "Recruit") {
                    let recRes = await BastionManager._handleRecruit(facDoc.name, facEntry, actor);
                    currentResultText = recRes.text; facDoc.newDefenders = { count: recRes.newCount, names: recRes.newNames };
                } else if (order === "Empower") {
                    let empRes = await BastionManager._handleEmpower(facDoc.name, facEntry, actor);
                    currentResultText = empRes.text;
                }
            }
            
            // Handle Background Upgrade Progress
            if (targetSize) {
                const needed = upgradeTurns - upgradeProgress;
                const progressThisTurn = Math.min(turns, needed);
                upgradeProgress += progressThisTurn;

                if (upgradeProgress >= upgradeTurns) {
                    facSize = targetSize;
                    if (targetSubType2) facSubType2 = targetSubType2;
                    currentResultText += ` (${facDoc.name} to <b>${facSize}</b> completed!)`;
                    targetSize = null; upgradeProgress = 0; upgradeTurns = 0; targetSubType2 = null;
                } else {
                    currentResultText += ` (Enlarging to ${targetSize}: ${upgradeProgress}/${upgradeTurns} turns)`;
                }
            }

            totalGold += localGold;
            
            if (facEntry.isFlag) {
                const gf = groupFacilities.find(f => f._id === facDoc._id);
                if (gf) {
                    if (!gf.flags) gf.flags = {}; if (!gf.flags[MODULE_ID]) gf.flags[MODULE_ID] = {};
                    Object.assign(gf.flags[MODULE_ID], {
                        subType, progress, order, size: facSize, subType2: facSubType2, focusChoice,
                        sacredFocusChoice, magicItemChoice, upgradeProgress, targetSize, 
                        targetSubType2, upgradeTurns, smithyItemChoice, armamentItemChoice,
                        craftQueue, storedGp: storedGp, autoNextAction: autoNextAction
                    });
                    
                    // Handle updated defenders if any were recruited
                    if (facDoc.newDefenders) gf.flags[MODULE_ID].defenders = facDoc.newDefenders;

                    // If this was a construction that just finished, mark it for removal from the flag array
                    if (wasNewBuild && actor.type !== "group" && !targetSize) {
                        flagsToRemove.push(facDoc._id);
                        itemsToPromote.push(gf);
                    }
                }
            } else {
                const updates = {
                    [`flags.${MODULE_ID}.subType`]: subType,
                    [`flags.${MODULE_ID}.progress`]: progress,
                    [`flags.${MODULE_ID}.order`]: order,
                    [`flags.${MODULE_ID}.craftChoice`]: craftChoice,
                    [`flags.${MODULE_ID}.focusChoice`]: focusChoice,
                    [`flags.${MODULE_ID}.sacredFocusChoice`]: sacredFocusChoice,
                    [`flags.${MODULE_ID}.magicItemChoice`]: magicItemChoice,
                    [`flags.${MODULE_ID}.subType2`]: facSubType2,
                    [`flags.${MODULE_ID}.upgradeProgress`]: upgradeProgress,
                    [`flags.${MODULE_ID}.workshopItemChoice`]: workshopItemChoice,
                    [`flags.${MODULE_ID}.targetSize`]: targetSize,
                    [`flags.${MODULE_ID}.targetSubType2`]: targetSubType2,
                    [`flags.${MODULE_ID}.smithyItemChoice`]: smithyItemChoice,
                    [`flags.${MODULE_ID}.armamentItemChoice`]: armamentItemChoice,
                    [`flags.${MODULE_ID}.craftQueue`]: craftQueue,
                    [`flags.${MODULE_ID}.size`]: facSize,
                    [`flags.${MODULE_ID}.upgradeTurns`]: upgradeTurns,
                    [`flags.${MODULE_ID}.storedGp`]: storedGp,
                    [`flags.${MODULE_ID}.autoNextAction`]: autoNextAction
                };
                
                if (facDoc.newDefenders) updates[`flags.${MODULE_ID}.defenders`] = facDoc.newDefenders;

                itemUpdates.push({ _id: facDoc.id, ...updates });
            }

            if (!isBasic || upgradeTurns > 0) {
                orderSummary += `<li style="margin-bottom: 6px; padding: 4px; background: rgba(0,0,0,0.03); border-radius: 3px;">
                                    <img src="${facDoc.img}" width="20" height="20" style="vertical-align: middle; border: none; margin-right: 6px; border-radius: 3px;">
                                    <b>${facDoc.name}</b> <br><span style="font-size: 0.9em; padding-left: 26px; display: block; color: #444;">${currentResultText}</span>
                                </li>`;
            }
        }

        // Prepare promotion data
        const promotedData = itemsToPromote.map(f => {
            let data = foundry.utils.deepClone(f);
            delete data._id; // Let Foundry generate a proper Item ID
            foundry.utils.setProperty(data, `flags.${MODULE_ID}.upgradeTurns`, 0);
            foundry.utils.setProperty(data, `flags.${MODULE_ID}.targetSize`, null);
            return data;
        });

        // Finalize the flag array
        const finalGroupFacilities = groupFacilities.filter(f => !flagsToRemove.includes(f._id));

        return { 
            orderSummary, totalGold, items, itemUpdates, 
            itemsToPromote: promotedData, groupFacilities: finalGroupFacilities,
            effectivelyAllMaintaining
        };
    }

    static async _createHirelingActor(name, role, ownerName, facilityName, isDefender = false) {
        if (!game.settings.get("dnd-2024-bastion-manager", "createActorsForHirelings")) return;
        
        let folderName = isDefender ? "Bastion Defenders" : "Bastion Hirelings";
        let folder = game.folders.find(f => f.name === folderName && f.type === "Actor");
        
        // Wait for the folder to be created and indexed before proceeding
        if (!folder) {
            folder = await Folder.create({ name: folderName, type: "Actor" });
            // Small delay to ensure the database indices catch up before the loop fires again
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        const actorData = {
            name: name,
            type: "npc",
            folder: folder.id,
            system: {
                details: {
                    biography: { value: `<p>A ${isDefender ? 'Bastion Defender' : 'Bastion Hireling'} (${role}) working at the <b>${facilityName}</b> for ${ownerName}.</p>` }
                }
            }
        };

        // Try to assign a generic token if possible based on role
        if (isDefender) {
            actorData.img = "icons/weapons/swords/sword-guard-flanged-steel.webp";
        } else {
            actorData.img = "icons/skills/trades/smithing-anvil-silver-red.webp";
        }

        await Actor.create(actorData);
    }

    // --- HELPER: CRAFT ---
    static async _handleCraft(baseName, fac, craftChoice, itemChoiceOverride = null) { 
        let hirelings = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.hirelings) : (fac.doc.getFlag("dnd-2024-bastion-manager", "hirelings"));
        let hName = (Array.isArray(hirelings) && hirelings.length > 0) ? hirelings[0] : "The hireling";
        let hProf = BastionManager._getHirelingProfession(baseName, null);
        const MODULE_ID = "dnd-2024-bastion-manager";
        if (hName !== "The hireling") hName = `${hName} ${hProf}`;

        if (baseName.includes("Arcane Study")) {
            if (craftChoice === "Arcane Focus") {
                const focusChoice = itemChoiceOverride || (fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.focusChoice) : (fac.doc.getFlag("dnd-2024-bastion-manager", "focusChoice")));
                const outPack = game.packs.get("dnd-2024-bastion-manager.bastion-output-items");
                if (!outPack) return { text: "Error: Output compendium missing." };

                const docs = await outPack.getDocuments();
                const folder = outPack.folders.find(f => f.name === "Arcane Focus") || 
                               outPack.folders.find(f => f.name.toLowerCase().includes("focus"));
                
                let itemDoc = null;
                if (focusChoice && folder) {
                    itemDoc = docs.find(i => i.name === focusChoice && i.folder?.id === folder.id);
                }

                if (!itemDoc && folder) {
                    itemDoc = docs.find(i => i.folder?.id === folder.id);
                }

                const item = itemDoc?.toObject();
                return { text: `Completed crafting an <b>${item?.name || "Arcane Focus"}</b>.`, item };
            }
            if (craftChoice === "Book") {
                const outPack = game.packs.get("dnd-2024-bastion-manager.bastion-output-items");
                const docs = await outPack.getDocuments();
                const itemDoc = docs.find(i => i.name === "Blank Book") || docs.find(i => i.name === "Book");
                const item = itemDoc?.toObject();
                return { text: `Completed crafting a <b>Blank Book</b>.`, item };
            }
        } else if (baseName === "Sanctuary") {
            if (craftChoice === "Druidic Focus" || craftChoice === "Holy Symbol") {
                const sacredFocusChoice = itemChoiceOverride || (fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.sacredFocusChoice) : (fac.doc.getFlag(MODULE_ID, "sacredFocusChoice")));
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                if (!outPack) return { text: "Error: Output compendium missing." };

                const folderId = craftChoice === "Druidic Focus" ? "RTYj3BJ6ZRvuKxPq" : "BiV5sM1bdzI3ZWS6";
                const folder = outPack.folders.get(folderId);

                if (folder) {
                    const index = await outPack.getIndex({fields: ["folder"]});
                    const itemEntry = index.find(e => e.folder === folder.id && e.name.toLowerCase() === sacredFocusChoice?.toLowerCase());

                    if (itemEntry) {
                        const doc = await outPack.getDocument(itemEntry._id);
                        const itemData = doc.toObject();
                        return { text: `Completed crafting a <b>${itemData.name}</b>.`, item: itemData };
                    }
                }
                return { text: `Completed crafting a Sacred Focus.` };
            }
            return { text: "No craft option selected." };
        } else if (baseName === "Smithy") {
            if (craftChoice === "Smith's Tools") {
                const itemChoice = itemChoiceOverride || (fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.smithyItemChoice) : (fac.doc.getFlag(MODULE_ID, "smithyItemChoice")));
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                if (!outPack) return { text: "Error: Output compendium missing." };
                const smithyFolder = outPack.folders.get("wti6MOvq9leZqgp9") || outPack.folders.find(f => f.name.includes("Smithy"));
                const toolsFolder = outPack.folders.find(f => f.parentId === smithyFolder?.id && f.name.includes("Smith's Tools"));
                
                if (toolsFolder && itemChoice) {
                    const index = await outPack.getIndex({fields: ["folder", "system.price"]});
                    const entry = index.find(i => i.folder === toolsFolder.id && i.name.toLowerCase() === itemChoice?.toLowerCase());
                    if (entry) {
                        const doc = await outPack.getDocument(entry._id);
                        const item = doc.toObject();
                        return { text: `Completed crafting <b>${item.name}</b>.`, item };
                    }
                }
                return { text: `Completed crafting an item using Smith's Tools.` };
            }
            if (craftChoice === "Magic Item (Armament)") {
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                if (!outPack) return { text: "Error: Output compendium missing." };

                const armamentItemChoice = itemChoiceOverride || (fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.armamentItemChoice) : (fac.doc.getFlag(MODULE_ID, "armamentItemChoice")));

                const index = await outPack.getIndex({fields: ["system.rarity"]});
                const entry = index.find(i => i.name.toLowerCase() === armamentItemChoice?.toLowerCase());
                if (entry) {
                    const doc = await outPack.getDocument(entry._id);
                    const item = doc.toObject();
                    const itemRarity = item.system?.rarity || "Common";
                    return { text: `Completed crafting <b>${itemRarity} Magic Item</b>: ${item.name}.`, item: item };
                }
            }
            return { text: `Executed Craft order.` };
        } else if (baseName === "Workshop") {
            const workshopItemChoice = itemChoiceOverride || (fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.workshopItemChoice) : (fac.doc.getFlag(MODULE_ID, "workshopItemChoice")));
            const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
            if (!outPack) return { text: "Error: Output compendium missing." };

            const index = await outPack.getIndex({fields: ["system.rarity", "system.price"]});
            const entry = index.find(i => i.name.toLowerCase() === workshopItemChoice?.toLowerCase());
            if (entry) {
                const doc = await outPack.getDocument(entry._id);
                const item = doc.toObject();
                const itemRarity = item.system?.rarity || "Common";
                return { text: `Completed crafting <b>${item.name}</b>.`, item: item };
            }
            if (craftChoice === "Magic Item (Implement)") {
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                if (!outPack) return { text: "Error: Output compendium missing." };

                const index = await outPack.getIndex({fields: ["system.rarity"]});
                const entry = index.find(i => i.name.toLowerCase() === workshopItemChoice?.toLowerCase());
                if (entry) {
                    const doc = await outPack.getDocument(entry._id);
                    const item = doc.toObject();
                    const itemRarity = item.system?.rarity || "Common";
                    return { text: `Completed crafting <b>${itemRarity} Magic Item (Implement)</b>: ${item.name}.`, item: item };
                }
            }
            return { text: `The hirelings assist you in crafting a Common or Uncommon magic item (Implement) using the chapter 7 rules.` };
        } else if (baseName === "Laboratory") {
            if (subType === "Poison") return { text: `${hName} spends 7 days crafting an application of Burnt Othur Fumes, Essence of Ether, or Torpor at half cost.` };
            return { text: `${hName} crafts an item using Alchemist's Supplies following the PHB rules.` };
        } else if (baseName === "Sacristy") {
            return { text: `${hName} spends 7 days crafting a flask of Holy Water.` };
        } else if (baseName === "Scriptorium") {
            if (subType === "Book Replica") return { text: `${hName} spends 7 days making a copy of a nonmagical book (requires a blank book).` };
            if (subType === "Spell Scroll") return { text: `${hName} scribes a Spell Scroll (Cleric or Wizard, level 3 or lower) using the PHB rules and costs.` };
            return { text: `${hName} spends 7 days creating up to 50 copies of paperwork.`, gold: -50 }; // Assuming max for simplicity or prompt later
        }

        return { text: `Executed Craft order.` };
    }

    // --- HELPER: EMPOWER ---
    static async _handleEmpower(baseName, fac, actor) {
        let hirelings = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.hirelings) : (fac.doc.getFlag("dnd-2024-bastion-manager", "hirelings"));
        let hName = (Array.isArray(hirelings) && hirelings.length > 0) ? hirelings[0] : "The hireling";
        let hProf = BastionManager._getHirelingProfession(baseName, null);
        if (hName !== "The hireling") hName = `${hName} ${hProf}`;

        if (baseName === "Theater") {
            return { text: `The hirelings begin work on a theatrical production or concert.` };
        } else if (baseName === "Training Area") {
            return { text: `The hirelings conduct training exercises for the next 7 days.` };
        } else if (baseName === "Meditation Chamber") {
            return { text: `The hirelings use the Meditation Chamber to gain inner peace. The next time you roll for a Bastion event, you can roll twice and choose either result.` };
        } else if (baseName === "Observatory") {
            const DialogV2 = foundry.applications.api.DialogV2;
            let accept = await DialogV2.confirm({ window: { title: `Empower: Observatory` }, content: `<p>Roll 1d2 to explore the eldritch mysteries of the stars?</p>`, rejectClose: false });
            if (accept) {
                const roll = (await new Roll("1d2").evaluate()).total;
                if (roll === 1) return { text: `Explored the stars. An unknown power bestows a <b>Charm of Darkvision</b>, <b>Charm of Heroism</b>, or <b>Charm of Vitality</b> on you or a creature of your choice.` };
                else return { text: `Explored the stars. Nothing is gained.` };
            }
            return { text: `You declined to explore the stars.` };
        } else if (baseName === "Demiplane") {
            return { text: `Magical runes appear on the Demiplane's walls. For the next 7 days, you gain Temporary Hit Points equal to five times your level after spending an entire Long Rest in the Demiplane.` };
        } else if (baseName === "Sanctum") {
            return { text: `The hirelings perform daily rites. The designated beneficiary gains Temporary Hit Points equal to your level after each Long Rest for 7 days.` };
        }
        return { text: `Executed Empower order.` };
    }
    static async _handleResearch(baseName, fac, subType) {
        let hirelings = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.hirelings) : (fac.doc.getFlag("dnd-2024-bastion-manager", "hirelings"));
        let hName = (Array.isArray(hirelings) && hirelings.length > 0) ? hirelings[0] : "The hireling";
        let hProf = BastionManager._getHirelingProfession(baseName, subType);
        if (hName !== "The hireling") hName = `${hName} ${hProf}`;

        if (baseName === "Library") {
            const topic = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.libraryTopic) : (fac.doc.getFlag("dnd-2024-bastion-manager", "libraryTopic"));
            const topicText = topic ? `<b>${topic}</b>` : `a topic`;
            return {
                text: `Research order issued for ${topicText}. ${hName} obtains up to 3 accurate pieces of information about ${topicText}.`
            };
        } else if (baseName === "Archive") {
            return {
                text: `${hName} searches the Archive for helpful lore, gaining knowledge as if they cast <i>Legend Lore</i>.`
            };
        } else if (baseName === "Trophy Room") {
            return { text: `${hName} conducts research in the Trophy Room.` };
        } else if (baseName === "Pub") {
            return { text: `${hName} gathers rumors and research in the Pub.` };
        }
        return { text: `Executed Research order.` };
    }

    // --- HELPER: RECRUIT ---
    static async _handleRecruit(baseName, fac, actor) {
        let facDefendersCount = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.defenders?.count || 0) : (fac.doc.getFlag("dnd-2024-bastion-manager", "defenders.count") || 0);
        let facDefenderNames = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.defenders?.names || []) : (fac.doc.getFlag("dnd-2024-bastion-manager", "defenders.names") || []);
        
        let maxDefenders = 12; // Assuming roomy by default
        const facSize = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.size || "Roomy") : (fac.doc.getFlag("dnd-2024-bastion-manager", "size") || "Roomy");
        if (facSize === "Vast") maxDefenders = 25;

        if (facDefendersCount >= maxDefenders) {
            return { text: `Recruitment failed: This facility is fully occupied (${maxDefenders}/${maxDefenders} Defenders).`, newCount: facDefendersCount, newNames: facDefenderNames };
        }

        const recruitMode = game.settings.get("dnd-2024-bastion-manager", "recruitMode");
        let newlyRecruited = 0;
        const MODULE_ID = "dnd-2024-bastion-manager";

        if (recruitMode === "max") {
            newlyRecruited = Math.min(4, maxDefenders - facDefendersCount);
        } else if (recruitMode === "manual") {
            const DialogV2 = foundry.applications.api.DialogV2;
            newlyRecruited = await DialogV2.prompt({
                window: { title: "Manual Recruitment" },
                content: `<p>How many defenders did you recruit for the ${fac.name}?</p><input type="number" name="count" value="0" min="0" max="${Math.min(4, maxDefenders - facDefendersCount)}" autofocus>`,
                ok: { callback: (event, button) => parseInt(button.form.elements.count.value) || 0 }
            });
        } else {
            const recruitRoll = await new Roll("1d4").evaluate();
            newlyRecruited = Math.min(recruitRoll.total, maxDefenders - facDefendersCount);
        }

        if (newlyRecruited > 0) {
            const promptNames = fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.promptNames ?? true) 
                                           : (fac.doc.getFlag(MODULE_ID, "promptNames") ?? true);

            let newNames = [];
            const firstNames = ["Tordek", "Mialee", "Jozan", "Lidda", "Aramil", "Eberk", "Vadania", "Gimble", "Hennet", "Krusk", "Nebin", "Soveliss", "Alhandra", "Devis", "Regdar"];
            const lastNames = ["Ironfist", "Moonwhisper", "Brightwood", "Nimblefingers", "Starbreeze", "Frostbeard", "Greenleaf", "Timbers", "Tanglehair", "Bonecrusher", "Gemsnatcher", "Sunrunner", "Swiftstep", "Fairweather", "Broadblade"];

            const generateFullName = () => {
                const first = firstNames[Math.floor(Math.random() * firstNames.length)];
                const last = lastNames[Math.floor(Math.random() * lastNames.length)];
                return `${first} ${last}`;
            };

            if (game.settings.get(MODULE_ID, "nameHirelings") && promptNames) {
                let namingContent = `<p>You have recruited <b>${newlyRecruited}</b> defenders. Please name them:</p>`;
                for (let d = 0; d < newlyRecruited; d++) {
                    namingContent += `<div class="form-group"><label>Defender ${d+1}:</label><input type="text" name="name_${d}" placeholder="Auto-generate if blank" value=""></div>`;
                }

                const nameData = await DialogV2.prompt({
                    window: { title: `Founding Defenders: ${fac.name}` },
                    content: namingContent,
                    ok: { label: "Establish Names", callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object }
                });

                for (let d = 0; d < newlyRecruited; d++) {
                    let dName = nameData?.[`name_${d}`]?.trim();
                    if (!dName) dName = generateFullName();
                    newNames.push(dName);
                }
            } else {
                // Background auto-generation if prompting is off but names are enabled globally
                const autoName = game.settings.get(MODULE_ID, "autoNameDefenders");
                for (let d = 0; d < newlyRecruited; d++) {
                    newNames.push(autoName ? generateFullName() : `Defender ${facDefendersCount + d + 1}`);
                }
            }

            facDefendersCount += newlyRecruited;
            if (newNames.length > 0) {
                for (const dName of newNames) {
                    if (dName) {
                        BastionManager._createHirelingActor(dName, "Defender", actor.name, fac.name, true);
                    }
                }
            }
            if (newNames.length > 0) facDefenderNames.push(...newNames);
            
            let resultText = `Recruited <b>${newlyRecruited}</b> Bastion Defender(s) [${facDefendersCount}/${maxDefenders} occupied].`;
            if (newNames.length > 0) resultText += ` <em style="color:#555;">(${newNames.join(", ")})</em>`;
            return { text: resultText, newCount: facDefendersCount, newNames: facDefenderNames };
        } else {
            return { text: `Recruited 0 defenders.`, newCount: facDefendersCount, newNames: facDefenderNames };
        }
    }
    static async _handleTrade(baseName, defenders, hasSmithy, level) {
        if (baseName === "Armory") {
            const dCount = Number(defenders) || 0;
            let cost = 100 + (100 * dCount); if (hasSmithy) cost = Math.floor(cost / 2);
            return { gold: -cost, text: `Stocked the Armory for ${defenders} total defenders.` };
        } else if (baseName === "Storehouse") {
            let limit = level >= 13 ? 5000 : (level >= 9 ? 2000 : 500); let markup = level >= 17 ? 100 : (level >= 13 ? 50 : (level >= 9 ? 20 : 10));
            return { gold: 0, text: `Procure up to <b>${limit} GP</b> in goods, OR sell at a <b>+${markup}%</b> profit.` };
        } else if (baseName.includes("Gaming Hall")) {
            const roll100 = (await new Roll("1d100").evaluate()).total;
            let formula = "1d6 * 10";
            if (roll100 > 95) formula = "10d6 * 10";
            else if (roll100 > 85) formula = "4d6 * 10";
            else if (roll100 > 50) formula = "2d6 * 10";

            const goldRoll = await new Roll(formula).evaluate();
            return { gold: goldRoll.total, text: `Gambling winnings (Roll ${roll100}): <b title="${formula} GP">${goldRoll.total} GP</b>.` };
        } else {
            const roll = await new Roll("1d6 * 10").evaluate();
            return { gold: roll.total, text: `Generated ${roll.total} GP.` };
        }
    }

    // --- HELPER: HARVEST ---
    static async _handleHarvest(baseName, subType, fac, isSecondPlot = false) {
        const outPack = game.packs.get("dnd-2024-bastion-manager.bastion-output-items");
        if (!outPack) return { item: null, text: "Output compendium missing." };
        const allDocs = await outPack.getDocuments(); 

        const rootIds = { "Garden": "HYjssa08njsoKbTO", "Workshop": "XkNDvStirzNpw8G2", "Smithy": "wti6MOvq9leZqgp9" };
        const isGarden = baseName.includes("Garden");
        
        const rootId = rootIds[baseName];
        const rootFolder = rootId ? (outPack.folders.get(rootId) || outPack.folders.find(f => f.id === rootId)) : null;

        if (!rootFolder) {
            const roll = await new Roll("1d4 + 1").evaluate();
            return { item: { name: `Harvested Materials (${baseName})`, type: "loot", system: { quantity: roll.total } }, text: `Harvested ${roll.total} generic materials.` };
        }
        
        let possible = [];
        if (isGarden && subType) {
            const specFolder = outPack.folders.find(f => f.name.toLowerCase().trim() === subType.toLowerCase().trim() && String(f.folder?.id || f.folder || f.parentId) === String(rootFolder.id));
            if (specFolder) possible = allDocs.filter(i => String(i.folder?.id || i.folder) === String(specFolder.id));
            
            const flagKey = isSecondPlot ? "harvestChoice2" : "harvestChoice";
            const choice = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.[flagKey]) : (fac.doc.getFlag("dnd-2024-bastion-manager", flagKey));
            if (choice) {
                possible = possible.filter(i => i.name.toLowerCase().includes(choice.toLowerCase()));
            }
        } else if (baseName === "Workshop" && subType) {
            possible = allDocs.filter(i => i.folder?.id === rootFolder.id);
            const kwMap = { "Wood": ["wood", "staff", "bow", "club"], "Stone": ["stone", "statue", "block"], "Cloth": ["cloth", "robe", "garment"], "Leather": ["leather", "hide", "armor"], "Metal": ["iron", "steel", "sword", "shield"] };
            if (kwMap[subType]) possible = possible.filter(i => kwMap[subType].some(kw => i.name.toLowerCase().includes(kw)));
        } else {
            possible = allDocs.filter(i => i.folder?.id === rootFolder.id);
        }

        if (possible.length === 0) return { item: null, text: `No valid items found for ${subType}.` };
        
        let chosen = possible[0];
        let itemObj = chosen.toObject();
        return { item: itemObj, text: `Harvested ${itemObj.system?.quantity || 1}x ${itemObj.name}.` };
    }

    // --- HELPER: INVENTORY ---
    static async _processInventory(actor, items) {
        if (items.length === 0) return;
        
        // Find or create Bastion Storage container
        let storage = actor.items.find(i => i.name === "Bastion Storage" && i.type === "container");
        if (!storage) {
            const results = await actor.createEmbeddedDocuments("Item", [{
                name: "Bastion Storage",
                type: "container",
                img: "icons/environment/settlement/castle-tan.webp",
                system: { capacity: { type: "weight", value: 1000, units: "lb" } }
            }]);
            storage = results[0];
        }

        let toCreate = []; let toUpdate = [];
        for (let itemData of items) {
            let existing = actor.items.find(i => i.name === itemData.name && i.type === itemData.type);
            let qty = itemData.system?.quantity || 1;
            if (existing) {
                let queued = toUpdate.find(u => u._id === existing.id);
                if (queued) queued["system.quantity"] += qty;
                else toUpdate.push({ _id: existing.id, "system.quantity": (existing.system?.quantity || 1) + qty });
            } else {
                // Set container ID for the new item
                itemData.system = itemData.system || {};
                itemData.system.container = storage.id;

                let queued = toCreate.find(c => c.name === itemData.name && c.type === itemData.type);
                if (queued) queued.system.quantity = (queued.system?.quantity || 1) + qty;
                else toCreate.push(itemData);
            }
        }
        if (toCreate.length > 0) await actor.createEmbeddedDocuments("Item", toCreate);
        if (toUpdate.length > 0) await actor.updateEmbeddedDocuments("Item", toUpdate);
    }

    static _generateRandomName() {
        const names = ["Adrik", "Alberich", "Baern", "Barendd", "Brottor", "Bruenor", "Dain", "Darrak", "Delg", "Eberk", "Einkil", "Fargrim", "Flint", "Gardain", "Harbek", "Kildrak", "Oskar", "Rangrim", "Rurik", "Thoradin", "Thorin", "Tordek", "Traubon", "Travok", "Ulfgar", "Veit", "Vondal", "Amber", "Artin", "Audhild", "Bardryn", "Dagnal", "Diesa", "Eldeth", "Falkrunn", "Finellen", "Gunnloda", "Gurdis", "Helja", "Hlin", "Kathra", "Kristryd", "Ilde", "Liftrasa", "Mardred", "Riswynn", "Sannl", "Torbera", "Torgga", "Vistra", "Aseir", "Bardeid", "Haseid", "Khemed", "Mehmen", "Sudeiman", "Zasheir", "Atala", "Ceidil", "Hama", "Jasmal", "Meilil", "Seipora", "Yasheira", "Zasheida", "Bor", "Fodel", "Glar", "Grigor", "Igan", "Ivor", "Kosef", "Mival", "Orel", "Pavel", "Sergor", "Alethra", "Kara", "Katernin", "Mara", "Natali", "Olma", "Tana", "Zora", "Ander", "Blath", "Bran", "Frath", "Geth", "Lander", "Luth", "Lucan", "Murn", "Muth", "Stedd", "Amafrey", "Betha", "Catelyn", "Ethani", "Ilda", "Lisvet", "Lura", "Madel", "Miri", "Nala", "Quara", "Selise", "Viana", "Anton", "Diero", "Falcone", "Federico", "Geno", "Luigi", "Marcello", "Nico", "Piero", "Tommaso", "Arveene", "Esvele", "Jhessail", "Kerri", "Lureene", "Miri", "Rowan", "Shandri", "Tessele", "Aoth", "Barakas", "Damakos", "Iados", "Kairon", "Leucis", "Melech", "Mordai", "Morthos", "Pelaios", "Skamos", "Therai", "Akta", "Anakis", "Bryseis", "Criella", "Damaia", "Ea", "Kallista", "Lerissa", "Makaria", "Nemeia", "Orianna", "Phelia", "Rieta"];
        return names[Math.floor(Math.random() * names.length)];
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
                const isBasic = fac.doc.system?.type?.value === "basic";
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
                                        if(a) await a.update({"system.currency.gp": Math.floor((a.system.currency?.gp || 0) + offer)});
                                        resultText = `You accepted. They paid <b>${offer} GP</b> for brief use of the facility.`; 
                                    } else resultText = `You declined the visitors.`;
                                } else if (eventType === "guest") {
                                    if (choice === "auto") {
                                        const gRoll = (await new Roll("1d4").evaluate()).total;
                                        if (gRoll === 1) resultText = "The guest is of great renown. Stays 7 days, then gives you a <b>Letter of Recommendation</b>.";
                                        else if (gRoll === 2) { const offer = (await new Roll("1d6 * 100").evaluate()).total; if(a) await a.update({"system.currency.gp": Math.floor((a.system.currency?.gp || 0) + offer)}); resultText = `The guest requests sanctuary for 7 days, offering a gift of <b>${offer} GP</b>.`; }
                                        else if (gRoll === 3) resultText = "The guest is a mercenary. You gain <b>1 additional Bastion Defender</b> until sent away or killed.";
                                        else resultText = "The guest is a Friendly monster. It defends against the next attack so you lose 0 Defenders, then leaves.";
                                    } else resultText = `<b>Resolved Manually.</b>`;
                                } else if (eventType === "refugees") {
                                    if (choice === "accept") {
                                        const ref = (await new Roll("2d4").evaluate()).total;
                                        const offer = (await new Roll("1d6 * 100").evaluate()).total;
                                        if(a) await a.update({"system.currency.gp": Math.floor((a.system.currency?.gp || 0) + offer)});
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
                                            if(a) await a.update({"system.currency.gp": Math.floor((a.system.currency?.gp || 0) + reward)});
                                            resultText = `Sent ${count} Defender(s). Rolled ${dRoll}. Problem solved, earned <b>${reward} GP</b>.`;
                                        } else {
                                            const reward = Math.floor((await new Roll("1d6 * 100").evaluate()).total / 2);
                                            if(a) await a.update({"system.currency.gp": Math.floor((a.system.currency?.gp || 0) + reward)});
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