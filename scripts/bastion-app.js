const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const BASTION_ORDERS = ["Maintain", "Craft", "Harvest", "Recruit", "Research", "Trade", "Empower"];

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
    constructor(actor, options = {}) { super(options); this.actor = actor; }
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
            previewItem: BastionManager.onPreviewItem
        }
    };
    static PARTS = { main: { template: "modules/dnd-2024-bastion-manager/templates/bastion-main.hbs" } };

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

        const neglectCounter = this.actor.getFlag(MODULE_ID, "neglectCounter") || 0;
        const actorLevel = (this.actor.type === "character" || this.actor.type === "npc") ? (this.actor.system.details?.level || 1) : 1;
        const disableNeglect = game.settings.get(MODULE_ID, "disableNeglect");
        const disableSpecialCap = game.settings.get(MODULE_ID, "disableSpecialCap");
        const disableDuplicateLimit = game.settings.get(MODULE_ID, "disableDuplicateLimit");

        // Special Facility Cap (DMG 2024 Rules)
        let specCap = 0;
        if (actorLevel >= 17) specCap = 6;
        else if (actorLevel >= 13) specCap = 5;
        else if (actorLevel >= 9) specCap = 4;
        else if (actorLevel >= 5) specCap = 2;

        const currentSpecials = rawFacilities.filter(f => !f.isInherited && f.sourceDoc.system?.type?.value !== "basic").length;
        const atSpecCap = !disableSpecialCap && currentSpecials >= specCap;

        const calculationMode = game.settings.get(MODULE_ID, "calculationMode");
        const daysPerTurn = game.settings.get(MODULE_ID, "daysPerTurn") || 7;

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
            let harvestChoice2 = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.harvestChoice2) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "harvestChoice2"));

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

            const isLibraryResearching = fac.name.includes("Library") && safeOrder === "Research";
            const libraryTopic = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.libraryTopic || "") : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "libraryTopic") || "");

            const isArcaneStudyCrafting = fac.name.includes("Arcane Study") && safeOrder === "Craft";
            const craftChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.craftChoice || "") : (fac.sourceDoc.getFlag(MODULE_ID, "craftChoice") || "");
            const arcanaTier = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.arcanaTier || "Common") : (fac.sourceDoc.getFlag(MODULE_ID, "arcanaTier") || "Common");
            const focusChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.focusChoice || "") : (fac.sourceDoc.getFlag(MODULE_ID, "focusChoice") || "");
            const magicItemChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.magicItemChoice || "") : (fac.sourceDoc.getFlag(MODULE_ID, "magicItemChoice") || "");

            const isSanctuaryCrafting = fac.name.includes("Sanctuary") && safeOrder === "Craft";
            const sacredFocusChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.sacredFocusChoice || "") : (fac.sourceDoc.getFlag(MODULE_ID, "sacredFocusChoice") || "");
            let sanctuaryCraftOptions = [
                { v: "Druidic Focus", l: "Druidic Focus (1 Turn, 0 GP)", s: craftChoice === "Druidic Focus" },
                { v: "Holy Symbol", l: "Holy Symbol (1 Turn, 0 GP)", s: craftChoice === "Holy Symbol" }
            ].map(o => ({ value: o.v, label: o.l, selected: o.s }));

            let craftOptions = [];
            if (isArcaneStudyCrafting) {
                craftOptions = [
                    { value: "Arcane Focus", label: "Arcane Focus (1 Turn, 0 GP)" },
                    { value: "Book", label: "Blank Book (1 Turn, 10 GP)" }
                ];
                if (actorLevel >= 9) {
                    craftOptions.push({ value: "Magic Item (Arcana)", label: "Magic Item (Arcana) (Level 9+)" });
                }
            }

            const isSmithyCrafting = fac.name.includes("Smithy") && safeOrder === "Craft";
            if (isSmithyCrafting) {
                craftOptions = [
                    { value: "Smith's Tools", label: "Smith's Tools (PHB Rules)" }
                ];
                if (actorLevel >= 9) {
                    craftOptions.push({ value: "Magic Item (Armament)", label: "Magic Item (Armament) (Level 9+)" });
                }
            }

            const isWorkshopCrafting = fac.name.includes("Workshop") && safeOrder === "Craft";
            if (isWorkshopCrafting) {
                craftOptions = [
                    { value: "Adventuring Gear", label: "Adventuring Gear (PHB Rules)" }
                ];
                if (actorLevel >= 9) {
                    craftOptions.push({ value: "Magic Item (Implement)", label: "Magic Item (Implement) (Level 9+)" });
                }
            }

            let focusOptions = [];
            if (isArcaneStudyCrafting && craftChoice === "Arcane Focus") {
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                if (outPack) {
                    const folder = outPack.folders.find(f => f.name === "Arcane Focus");
                    if (folder) {
                        const index = await outPack.getIndex({fields: ["folder"]});
                        focusOptions = index.filter(i => i.folder === folder.id).map(i => ({
                            value: i.name,
                            label: i.name,
                            selected: i.name === focusChoice
                        }));
                    }
                }
            }

            let magicItemOptions = [];
            let magicItemUuid = null;
            if (isArcaneStudyCrafting && craftChoice === "Magic Item (Arcana)") {
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                if (outPack && outPack.folders) {
                    // V13 Robust Folder Lookup: Try hardcoded IDs first, then resilient path-based search
                    const fallbackId = arcanaTier === "Common" ? "gi6dlxWTn3zkmTAl" : "EWfRwKy27wZWAEix";
                    let tierFolder = outPack.folders.get(fallbackId);

                    if (!tierFolder) {
                        tierFolder = outPack.folders.find(f => {
                            if (f.name.trim().toLowerCase() !== arcanaTier.toLowerCase()) return false;
                            const parent = outPack.folders.get(f.folder);
                            if (!parent || !parent.name.toLowerCase().includes("craft magic items")) return false;
                            let current = parent;
                            let isArcane = false;
                            while (current) {
                                if (current.name.toLowerCase().includes("arcane study")) { isArcane = true; break; }
                                current = outPack.folders.get(current.folder);
                            }
                            return isArcane;
                        });
                    }

                    if (tierFolder) {
                        const index = await outPack.getIndex({fields: ["folder"]});
                        const itemsInFolder = index.filter(i => i.folder === tierFolder.id);
                        magicItemOptions = itemsInFolder.map(i => ({
                            value: i.name,
                            label: i.name,
                            selected: i.name === magicItemChoice
                        }));

                        const selectedEntry = itemsInFolder.find(i => i.name === magicItemChoice);
                        if (selectedEntry) {
                            magicItemUuid = `Compendium.${MODULE_ID}.bastion-output-items.Item.${selectedEntry._id}`;
                        }
                    }
                }
            }

            let sacredFocusOptions = [];
            let sacredFocusUuid = null;
            if (isSanctuaryCrafting && (craftChoice === "Druidic Focus" || craftChoice === "Holy Symbol")) {
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                if (outPack && outPack.folders) {
                    // V13 Resilient ID-based lookup for Sanctuary categories
                    const folderId = craftChoice === "Druidic Focus" ? "RTYj3BJ6ZRvuKxPq" : "BiV5sM1bdzI3ZWS6";
                    const folder = outPack.folders.get(folderId);

                    if (folder) {
                        const index = await outPack.getIndex({fields: ["folder"]});
                        const itemsInFolder = index.filter(i => i.folder === folder.id);
                        
                        sacredFocusOptions = itemsInFolder.map(i => ({
                            value: i.name, label: i.name, selected: i.name === sacredFocusChoice
                        })).sort((a, b) => a.label.localeCompare(b.label));

                        const selectedEntry = itemsInFolder.find(i => i.name === sacredFocusChoice);
                        if (selectedEntry) {
                            sacredFocusUuid = `Compendium.${MODULE_ID}.bastion-output-items.Item.${selectedEntry._id}`;
                        }
                    }
                }
            }

            const daysNeeded = arcanaTier === "Uncommon" ? 10 : 5;
            const maxCraftProgress = calculationMode === "days" ? daysNeeded : Math.ceil(daysNeeded / daysPerTurn);
            const progressLabel = calculationMode === "days" ? "Days" : "Turns";

            const arcanaTierOptions = [
                { v: "Common", l: `Common (50 GP, ${calculationMode === "days" ? "5 Days" : Math.ceil(5/daysPerTurn) + " Turns"})`, s: arcanaTier === "Common" },
                { v: "Uncommon", l: `Uncommon (200 GP, ${calculationMode === "days" ? "10 Days" : Math.ceil(10/daysPerTurn) + " Turns"})`, s: arcanaTier === "Uncommon" }
            ].map(o => ({ value: o.v, label: o.l, selected: o.s }));

            const isGardenHarvesting = fac.name.includes("Garden") && safeOrder === "Harvest";
            let harvestOptions = [];
            const isVastGarden = fac.name.includes("Garden") && facSize === "Vast";
            let harvestOptions2 = [];

            if (isGardenHarvesting && outPack) {
                const index = await outPack.getIndex({fields: ["folder", "system.quantity"]});
                
                // Plot 1 Options
                if (facSubType) {
                    const typeFolder = dynamicGardenTypes.find(f => f.name.toLowerCase().trim() === facSubType.toLowerCase().trim());
                    if (typeFolder) {
                        harvestOptions = index.filter(i => i.folder === typeFolder.id).map(i => ({
                            value: i.name, 
                            label: `${i.name} (Qty: ${i.system?.quantity || 1})`
                        }));
                    }
                }

                // Plot 2 Options (Vast)
                if (isVastGarden && facSubType2) {
                    const typeFolder2 = dynamicGardenTypes.find(f => f.name.toLowerCase().trim() === facSubType2.toLowerCase().trim());
                    if (typeFolder2) {
                        harvestOptions2 = index.filter(i => i.folder === typeFolder2.id).map(i => ({
                            value: i.name, 
                            label: `${i.name} (Qty: ${i.system?.quantity || 1})`
                        }));
                    }
                }
            }
            const harvestChoice = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.harvestChoice) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "harvestChoice"));

            const isGardenChangingType = fac.name.includes("Garden") && safeOrder === "Change Type";
            const pendingSubType = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.pendingSubType || "") : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "pendingSubType") || "");
            const progress = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.progress || 0) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "progress") || 0);

            // Determine Enlargeability for UI
            const isBasic = fac.sourceDoc.system?.type?.value?.toLowerCase() === "basic";
            const enlargeableSpecials = ["Archive", "Barrack", "Garden", "Pub", "Stable", "Workshop"];
            const isEnlargeableSpecial = enlargeableSpecials.some(sn => fac.name.includes(sn));
            const isEnlargeable = !fac.isInherited && ((isBasic && facSize !== "Vast") || (isEnlargeableSpecial && facSize === "Roomy"));
            
            const upgradeProgress = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.upgradeProgress || 0) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "upgradeProgress") || 0);
            const upgradeTurns = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.upgradeTurns || 0) : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "upgradeTurns") || 0);
            const isUnderConstruction = upgradeTurns > 0;
            const isBuilding = isUnderConstruction && !facSize;
            const isOrderLocked = progress > 0 || isBuilding;

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
                img: fac.sourceDoc.img, isInherited: fac.isInherited, isFlag: fac.isFlag, memberId: fac.memberActor?.id || null,
                itemName: fac.name,
                hasOrders: hasOrders,
                showOrderDropdown: hasOrders && !isBuilding,
                orderOptions: availableOrders.map(order => ({ value: order, label: order, selected: order === safeOrder })),
                isLibraryResearching: isLibraryResearching,
                libraryTopic: libraryTopic,
                isArcaneStudyCrafting: isArcaneStudyCrafting,
                craftChoice: craftChoice,
                craftOptions: craftOptions.map(o => ({ value: o.v, label: o.l, selected: o.v === craftChoice })),
                showArcanaTierSelect: isArcaneStudyCrafting && craftChoice === "Magic Item (Arcana)",
                arcanaTier: arcanaTier,
                arcanaTierOptions: arcanaTierOptions,
                showArcaneFocusSelect: isArcaneStudyCrafting && craftChoice === "Arcane Focus",
                focusChoice: focusChoice,
                focusOptions: focusOptions,
                showArcanaItemSelect: isArcaneStudyCrafting && craftChoice === "Magic Item (Arcana)",
                magicItemChoice: magicItemChoice,
                magicItemOptions: magicItemOptions,
                magicItemUuid: magicItemUuid,
                maxCraftTurns: maxCraftProgress,
                isSanctuaryCrafting: isSanctuaryCrafting,
                sanctuaryCraftOptions: sanctuaryCraftOptions,
                showSacredFocusSelect: isSanctuaryCrafting && (craftChoice === "Druidic Focus" || craftChoice === "Holy Symbol"),
                sacredFocusChoice: sacredFocusChoice,
                sacredFocusOptions: sacredFocusOptions,
                sacredFocusUuid: sacredFocusUuid,
                progressLabel: progressLabel,
                isGardenHarvesting: isGardenHarvesting,
                isVastGarden: isVastGarden,
                subType2: facSubType2,
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
                isGardenChangingType: isGardenChangingType,
                changeTypeOptions: changeTypeOptions,
                isOrderLocked: isOrderLocked,
                progress: progress,
                progressPct: Math.round((Math.min(progress, 3) / 3) * 100),
                isUnderConstruction: isUnderConstruction,
                constructionLabel: constructionLabel,
                upgradeProgress: upgradeProgress,
                upgradeTurns: upgradeTurns,
                upgradeProgressPct: Math.round((Math.min(upgradeProgress, upgradeTurns) / (upgradeTurns || 1)) * 100),
                isBasic: isBasic,
                isEnlargeable: isEnlargeable,
                maxSquares,
                placedSquares,
                isBuilding,
                isLayoutActive,
                facColor,
                promptNames
            };
        }));

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

                // Check Special Facility Cap
                const isBasic = item.system?.type?.value === "basic";
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
                if (!ignorePrereqs && actorLevel < reqLevel) {
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

        // Persist section states
        if (this._sectionStates === undefined) this._sectionStates = { special: true, basic: true };
        
        return { 
            actor: this.actor, turnCount: globalTurnCount, 
            totalDefenders, defenderNames: allDefenderNames.join(", "), 
            facilities, specialFacilitiesBuilt, basicFacilitiesBuilt, specialFacilities, basicFacilities,
            canAdvanceTurn, grid, gridSize, isNewBastion,
            wallCount, wallDays, hasMap,
            selectedId, combinedGroup, wallCost, wallTime,
            totalWallSquaresAllowed, placedWallSquares, structIds: STRUCT_IDS,
            gridBackground, selectedOpening: this._selectedOpeningType || "Door", neglectWarning, neglectColor, neglectCounter, actorLevel,
            sectionStates: this._sectionStates
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);

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
                let newOrder = event.target.value;
                let pendingSubType = null;

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
                this.render(); // Re-render to show/hide the library input box
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

        const craftChoiceSelects = this.element.querySelectorAll('.arcane-study-craft-select');
        for (const select of craftChoiceSelects) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newChoice = event.target.value;
                const MODULE_ID = "dnd-2024-bastion-manager";

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); 
                    const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "craftChoice", newChoice);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; 
                        if (!fac.flags[MODULE_ID]) fac.flags[MODULE_ID] = {};
                        fac.flags[MODULE_ID].craftChoice = newChoice;
                        await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "craftChoice", newChoice);
                }
                this.render();
            });
        }

        const sanctuaryCraftSelects = this.element.querySelectorAll('.sanctuary-craft-select');
        for (const select of sanctuaryCraftSelects) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newChoice = event.target.value;
                const MODULE_ID = "dnd-2024-bastion-manager";

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); 
                    const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "craftChoice", newChoice);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; 
                        if (!fac.flags[MODULE_ID]) fac.flags[MODULE_ID] = {};
                        fac.flags[MODULE_ID].craftChoice = newChoice;
                        await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "craftChoice", newChoice);
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

        const arcanaTierSelects = this.element.querySelectorAll('.arcane-study-tier-select');
        for (const select of arcanaTierSelects) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newTier = event.target.value;
                const MODULE_ID = "dnd-2024-bastion-manager";

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); 
                    const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "arcanaTier", newTier);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        if (!fac.flags) fac.flags = {}; 
                        if (!fac.flags[MODULE_ID]) fac.flags[MODULE_ID] = {};
                        fac.flags[MODULE_ID].arcanaTier = newTier;
                        await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "arcanaTier", newTier);
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
        
        const getHCount = (doc) => {
            const hData = doc.system?.hireling || doc.system?.hirelings || doc.system?.details?.hireling || doc.system?.details?.hirelings;
            let count = typeof hData === "number" ? hData : (parseInt(hData?.max || hData?.value || hData) || 0);
            if (!count) {
                const desc = doc.system?.description?.value || "";
                const hMatch = desc.replace(/<[^>]*>/g, '').match(/Hirelings:\s*(\d+)/i);
                if (hMatch) count = parseInt(hMatch[1]);
            }
            return count || 0;
        };

        const specList = allDocs.filter(d => {
            const isBasic = d.system?.type?.value === "basic";
            let lvl = d.system?.prerequisites?.level || d.system?.requirements?.level || 0;
            if ( !lvl ) {
                const desc = d.system?.description?.value || "";
                const levelMatch = desc.replace(/<[^>]*>/g, '').match(/Level\s+(\d+)/i);
                if (levelMatch) {
                    lvl = parseInt(levelMatch[1]);
                } else {
                    lvl = 5; 
                }
            }
            return !isBasic && lvl <= 5;
        }).map(d => ({ id: d.id, name: d.name, hirelings: getHCount(d) }));

        const basicList = ctx.basicFacilities;
        const namingEnabled = game.settings.get(MODULE_ID, "nameHirelings");

        const spec1Options = specList.map((f, i) => `<option value="${f.id}" data-h="${f.hirelings}" ${i === 0 ? "selected" : ""}>${f.name}</option>`).join("");
        const spec2Options = specList.map((f, i) => `<option value="${f.id}" data-h="${f.hirelings}" ${i === 1 ? "selected" : ""}>${f.name}</option>`).join("");

        const initContent = `
            <p style="margin-bottom: 10px;">Establish your Bastion <b>instantly and for free</b>. Select two Special Facilities and two Basic Facilities.</p>
            <div class="form-group"><label>Special Facility 1</label><select name="spec1" class="spec-init" data-slot="1" style="flex: 2;">${spec1Options}</select></div>
            <div id="names-slot-1" style="margin-bottom: 10px; padding-left: 20px;"></div>
            
            <div class="form-group"><label>Special Facility 2</label><select name="spec2" class="spec-init" data-slot="2" style="flex: 2;">${spec2Options}</select></div>
            <div id="names-slot-2" style="margin-bottom: 10px; padding-left: 20px;"></div>
            
            <hr>
            <div class="form-group"><label>Basic Facility 1</label>
                <select name="basic1" style="flex: 2;">${basicList.map(f => `<option value="${f._id}">${f.name}</option>`).join("")}</select>
                <select name="size1" style="flex: 1;"><option value="Cramped">Cramped</option><option value="Roomy" selected>Roomy</option></select>
            </div>
            <div class="form-group"><label>Basic Facility 2</label> 
                <select name="basic2" style="flex: 2;">${basicList.map(f => `<option value="${f._id}">${f.name}</option>`).join("")}</select>
                <select name="size2" style="flex: 1;"><option value="Cramped" selected>Cramped</option><option value="Roomy">Roomy</option></select>
            </div>
        `;

        const selections = await DialogV2.prompt({
            window: { title: "Founding Your Bastion", icon: "fa-solid fa-sparkles", classes: ["bastion-app"] },
            content: initContent,
            ok: { label: "Establish Bastion", callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
            render: function(event) {
                const html = event.target.element;
                const updateNames = (select) => {
                    if (!namingEnabled) return;
                    const slot = select.dataset.slot;
                    const facility = specList.find(s => s.id === select.value);
                    const count = facility ? facility.hirelings : 0;
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
            const doc = await pack.getDocument(id);
            const data = doc.toObject();
            const MODULE_ID = "dnd-2024-bastion-manager";
            foundry.utils.setProperty(data, `flags.${MODULE_ID}.size`, size);

            const hCount = getHCount(doc);
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
        let turns = 0;
        const isBasic = itemDoc.system?.type?.value === "basic";

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
            Cramped: { 
                cost: getVal("buildCrampedCost", 500, false), 
                turns: getVal("buildCrampedTime", 3, true) 
            },
            Roomy: { 
                cost: getVal("buildRoomyCost", 1000, false), 
                turns: getVal("buildRoomyTime", 7, true) 
            },
            Vast: { 
                cost: getVal("buildVastCost", 3000, false), 
                turns: getVal("buildVastTime", 18, true) 
            }
        };

        // Default size for Specials is Roomy; Basic size is determined by user input
        if (!isBasic) foundry.utils.setProperty(newFacData, "flags.dnd-2024-bastion-manager.size", "Roomy");

        // Handle Special Facility Build Times
        if (!isBasic && game.settings.get(MODULE_ID, "specialFacilitiesBuildTime")) {
            const roomy = sizeCosts.Roomy;
            const currentGP = this.actor.system.currency?.gp || 0;
            if (currentGP < roomy.cost) return ui.notifications.warn(`Insufficient gold. Need ${roomy.cost} GP.`);
            
            const confirm = await DialogV2.confirm({
                window: { title: `Build ${itemDoc.name}` },
                content: `<p>Build a Roomy <b>${itemDoc.name}</b>? This requires <b>${roomy.cost} GP</b> and <b>${roomy.turns} Turns</b>.</p>`
            });
            
            if (confirm) {
                if (roomy.cost > 0) await this.actor.update({ "system.currency.gp": currentGP - roomy.cost });
                foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.upgradeTurns`, roomy.turns);
                foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.upgradeProgress`, 0);
                foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.targetSize`, "Roomy");
                foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.size`, null); // Clear size so engine knows it's a new build
                
                newFacData._id = foundry.utils.randomID();
                const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                gf.push(newFacData);
                await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                return this.render();
            } else return;
        }

        let expectedHirelings = 0;
        const hData = itemDoc.system?.hireling || itemDoc.system?.hirelings || itemDoc.system?.details?.hireling || itemDoc.system?.details?.hirelings;

        if (typeof hData === "number") expectedHirelings = hData;
        else if (typeof hData === "string") expectedHirelings = parseInt(hData) || 0;
        else if (typeof hData === "object" && hData !== null) expectedHirelings = parseInt(hData.max) || parseInt(hData.value) || 0;
        
        const config = FACILITY_CONFIG[itemDoc.name];
        let promptContent = "";

        if (isBasic) {
            promptContent += `
                <div style="margin-bottom: 15px; border-bottom: 1px solid #ccc; padding-bottom: 10px;">
                    <p>Select the size for your new <b>${itemDoc.name}</b>:</p>
                    <select name="size" style="width: 100%;">
                        <option value="Cramped">Cramped (${sizeCosts.Cramped.cost} GP, ${sizeCosts.Cramped.turns} Turns)</option>
                        <option value="Roomy" selected>Roomy (${sizeCosts.Roomy.cost} GP, ${sizeCosts.Roomy.turns} Turns)</option>
                        <option value="Vast">Vast (${sizeCosts.Vast.cost} GP, ${sizeCosts.Vast.turns} Turns)</option>
                    </select>
                </div>
            `;
        }

        if (itemDoc.name.includes("Garden")) {
            const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
            let specializationOptions = "";
            if (outPack?.folders) {
                const root = outPack.folders.get("HYjssa08njsoKbTO") || outPack.folders.find(f => f.name.toLowerCase().trim() === "garden");
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
        } else if (config?.type === "tools") {
            const checkboxes = config.options.map(t => `
                <label style="display: block; margin-bottom: 4px;">
                    <input type="checkbox" name="workshopTools" value="${t}"> ${t}
                </label>
            `).join("");
            promptContent += `
                <div style="margin-bottom: 10px;">
                    <p>Select <b>6</b> Artisan's Tools for your Workshop:</p>
                    <div class="tool-selection-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 0.9em;">
                        ${checkboxes}
                    </div>
                </div>
            `;
        }

        if (expectedHirelings > 0 && game.settings.get("dnd-2024-bastion-manager", "nameHirelings")) {
            promptContent += `<p>This facility requires <b>${expectedHirelings}</b> hireling(s). Please name them:</p>`;
            for (let i = 0; i < expectedHirelings; i++) {
                promptContent += `<div style="margin-bottom: 8px; display: flex; align-items: center; gap: 10px;">
                                    <label style="width: 80px;">Hireling ${i+1}:</label>
                                    <input type="text" name="hireling_${i}" value="" style="flex-grow: 1;" placeholder="Auto-generate if blank">
                                </div>`;
            }
        }

        if (promptContent) {
            const formData = await DialogV2.wait({
                window: { title: `Build Facility: ${itemDoc.name}` },
                content: promptContent,
                buttons: [{ action: "cancel", label: "Cancel", icon: "fas fa-times" }, { action: "ok", label: "Build", icon: "fas fa-hammer", default: true, callback: (event, button) => { 
                    const data = {};
                    const form = button.form;

                    if (isBasic) {
                        data.size = form.elements.size?.value;
                    }
                    
                    if (config?.type === "specialization") {
                        data.subType = form.elements.subType?.value;
                    } else if (config?.type === "tools") {
                        const selected = Array.from(form.elements.workshopTools).filter(i => i.checked).map(i => i.value);
                        if (selected.length !== 6) {
                            ui.notifications.error("You must select exactly 6 tools for a Workshop.");
                            return null; // Prevents dialog from closing
                        }
                        data.tools = selected;
                    }

                    if (expectedHirelings > 0) {
                        let names = [];
                        const autoGen = game.settings.get(MODULE_ID, "autoNameHirelings");
                        for(let i = 0; i < expectedHirelings; i++) {
                            let val = button.form.elements[`hireling_${i}`]?.value?.trim();
                            if (!val && autoGen) val = BastionManager._generateRandomName();
                            if (val) names.push(val);
                        }
                        data.hirelings = names;
                    }
                    return data;
                }}]
            });
            
            if (formData && formData !== "cancel") {
                 // Handle Basic Facility Construction Costs and Flags
                 if (isBasic && formData.size) {
                    let cost = sizeCosts[formData.size].cost;
                    turns = sizeCosts[formData.size].turns;
                    const currentGP = this.actor.system.currency?.gp || 0;
                    
                    if (currentGP < cost) {
                        ui.notifications.warn(`Insufficient gold. Need ${cost} GP.`);
                        return;
                    }
                    if (cost > 0) await this.actor.update({ "system.currency.gp": currentGP - cost });

                    if (turns > 0) {
                        foundry.utils.setProperty(newFacData, "flags.dnd-2024-bastion-manager.upgradeTurns", turns);
                        foundry.utils.setProperty(newFacData, "flags.dnd-2024-bastion-manager.upgradeProgress", 0);
                        foundry.utils.setProperty(newFacData, "flags.dnd-2024-bastion-manager.targetSize", formData.size);
                        // Basic facilities under construction are stored as flags
                        newFacData._id = foundry.utils.randomID(); 
                        const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                        groupFacilities.push(newFacData);
                        await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacilities);
                        this.render();
                        return;
                    } else { // Instant build
                        foundry.utils.setProperty(newFacData, "flags.dnd-2024-bastion-manager.size", formData.size); 
                    }
                 }

                 if (formData.subType) {
                     foundry.utils.setProperty(newFacData, "flags.dnd-2024-bastion-manager.subType", formData.subType);
                 }
                 if (formData.tools) {
                     foundry.utils.setProperty(newFacData, "flags.dnd-2024-bastion-manager.workshopTools", formData.tools);
                 }
                 if (formData.hirelings && formData.hirelings.length > 0) {
                     foundry.utils.setProperty(newFacData, "flags.dnd-2024-bastion-manager.hirelings", formData.hirelings);
                     let prof = BastionManager._getHirelingProfession(itemDoc.name, formData.subType);
                     formData.hirelings.forEach(h => {
                         BastionManager._createHirelingActor(h, prof, this.actor.name, itemDoc.name, false);
                     });
                 }
            } else {
                return; // Early return if prompt was cancelled
            }
        }

        // If it's a basic facility with 0 turns, or any special facility
        if (!isBasic || (isBasic && turns === 0)) {
            if (this.actor.type === "group") {
                const groupFacilities = this.actor.getFlag("dnd-2024-bastion-manager", "groupFacilities") || [];
                newFacData._id = foundry.utils.randomID(); 
                groupFacilities.push(newFacData);
                await this.actor.setFlag("dnd-2024-bastion-manager", "groupFacilities", groupFacilities);
            } else {
                await Item.create(newFacData, { parent: this.actor });
            }
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

        // Batch all updates for the Actor
        const actorUpdate = {
            "system.currency.gp": Math.max(0, (actor.system.currency?.gp || 0) + resolution.totalGold),
            [`flags.${MODULE_ID}.neglectCounter`]: neglectCounter
        };

        // Apply batch item updates
        if (resolution.itemUpdates.length > 0) await actor.updateEmbeddedDocuments("Item", resolution.itemUpdates);
        
        // Handle promotion of flags to Items
        if (resolution.itemsToPromote.length > 0) await actor.createEmbeddedDocuments("Item", resolution.itemsToPromote);

        // Update the facility flags (pending builds)
        actorUpdate[`flags.${MODULE_ID}.groupFacilities`] = resolution.groupFacilities;

        await actor.update(actorUpdate);
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
                if (!choice) missing.push(`${actor.name}: Arcane Study needs a Craft selection.`);
                else if (choice === "Arcane Focus") {
                    const focusChoice = fac.isFlag ? fac.doc.flags?.[MODULE_ID]?.focusChoice : fac.doc.getFlag(MODULE_ID, "focusChoice");
                    if (!focusChoice) missing.push(`${actor.name}: Arcane Study (Arcane Focus) needs a Focus Type selection.`);
                }
            }

            if (fac.name.includes("Sanctuary") && order === "Craft") {
                const choice = fac.isFlag ? fac.doc.flags?.[MODULE_ID]?.craftChoice : fac.doc.getFlag(MODULE_ID, "craftChoice");
                if (!choice) missing.push(`${actor.name}: Sanctuary needs a Craft selection.`);
                else if (choice === "Druidic Focus" || choice === "Holy Symbol") {
                    const sacredFocusChoice = fac.isFlag ? fac.doc.flags?.[MODULE_ID]?.sacredFocusChoice : fac.doc.getFlag(MODULE_ID, "sacredFocusChoice");
                    if (!sacredFocusChoice) missing.push(`${actor.name}: Sanctuary (${choice}) needs a Focus Type selection.`);
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
            const facFlags = facEntry.isFlag ? (facDoc.flags?.[MODULE_ID] || {}) : (facDoc.getFlag(MODULE_ID) || {});
            const isBasic = facDoc.system?.type?.value === "basic";
            
            let order = isBasic ? "Maintain" : (facEntry.isFlag ? facFlags.order : facDoc.getFlag(MODULE_ID, "order")) || "Maintain";
            let subType = facFlags?.subType;
            let progress = facFlags?.progress || 0;
            let facSize = facFlags?.size || "Roomy";
            let craftChoice = facEntry.isFlag ? facFlags.craftChoice : facDoc.getFlag(MODULE_ID, "craftChoice");
            let focusChoice = facEntry.isFlag ? facFlags.focusChoice : facDoc.getFlag(MODULE_ID, "focusChoice");
            let magicItemChoice = facEntry.isFlag ? facFlags.magicItemChoice : facDoc.getFlag(MODULE_ID, "magicItemChoice");
            let sacredFocusChoice = facEntry.isFlag ? facFlags.sacredFocusChoice : facDoc.getFlag(MODULE_ID, "sacredFocusChoice");
            let libraryTopic = facEntry.isFlag ? facFlags.libraryTopic : facDoc.getFlag(MODULE_ID, "libraryTopic");

            let upgradeProgress = facFlags?.upgradeProgress || 0;
            let targetSize = facFlags?.targetSize;
            let targetSubType2 = facFlags?.targetSubType2;
            let facSubType2 = facFlags?.subType2;
            let upgradeTurns = facFlags?.upgradeTurns || 0;

            const wasNewBuild = facEntry.isFlag && !facFlags.size;
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

            if (insufficientReason) order = "Maintain";
            
            if (!isBasic && order !== "Maintain") {
                effectivelyAllMaintaining = false;
            }

            let resultText = "";
            let localGold = 0;

            for (let i = 0; i < turns; i++) {
                if (order === "Maintain") {
                    if (!resultText) resultText = insufficientReason ? `Maintained operations (${insufficientReason}).` : "Maintained standard operations.";
                } else if (order === "Change Type") {
                    let pending = facFlags.pendingSubType;
                    progress += 1;
                    const totalTurns = facDoc.name.includes("Garden") ? 3 : (upgradeTurns || 0);

                    if (progress >= totalTurns) { 
                        subType = pending || "Decorative"; progress = 0; order = "Maintain"; 
                        resultText = `Completed changing type to <b>[${subType}]</b>.`; 
                        break; 
                    } else { 
                        resultText = `Changing type to [${pending}] (Progress: ${progress}/${totalTurns} turns).`; 
                    }
                } else if (order === "Trade") {
                    let tradeRes = await BastionManager._handleTrade(facDoc.name, defenders, hasSmithy, level);
                    localGold += tradeRes.gold; resultText = tradeRes.text;
                } else if (order === "Harvest") {
                    let harvestRes = await BastionManager._handleHarvest(facDoc.name, subType, facEntry);
                    if (harvestRes.item) items.push(harvestRes.item);
                    resultText = harvestRes.text;
                    if (facDoc.name.includes("Garden") && facSize === "Vast" && facSubType2) {
                        let harvestRes2 = await BastionManager._handleHarvest(facDoc.name, facSubType2, facEntry, true);
                        if (harvestRes2.item) items.push(harvestRes2.item);
                        resultText += ` and ${harvestRes2.text}`;
                    }
                } else if (order === "Research") {
                    let resRes = await BastionManager._handleResearch(facDoc.name, facEntry, subType);
                    resultText = resRes.text;
                    if (resRes.resetOrder) order = "Maintain";
                } else if (order === "Craft") {
                    if (facDoc.name.includes("Arcane Study") && craftChoice === "Magic Item (Arcana)") {
                        const tier = facFlags?.arcanaTier || "Common";
                        const calculationMode = game.settings.get(MODULE_ID, "calculationMode");
                        const daysPerTurn = game.settings.get(MODULE_ID, "daysPerTurn") || 7;

                        const daysNeeded = tier === "Uncommon" ? 10 : 5;
                        const materialCost = tier === "Uncommon" ? 200 : 50;
                        const turnsNeeded = Math.ceil(daysNeeded / daysPerTurn);

                        // Deduct cost on first turn
                        if (progress === 0 && localGold === 0) {
                            const currentGP = actor.system.currency?.gp || 0;
                            if (currentGP < materialCost) {
                                resultText = "Crafting paused: Insufficient gold for materials.";
                                break;
                            }
                            localGold -= materialCost;
                        }

                        progress += 1;
                        if (progress >= turnsNeeded) {
                            let craftRes = await BastionManager._handleCraft(facDoc.name, facEntry, craftChoice, tier, magicItemChoice);
                            if (craftRes.item) items.push(craftRes.item);
                            resultText = craftRes.text;
                            progress = 0;
                            order = "Maintain";
                            break; 
                        } else {
                            resultText = `Crafting ${tier} Magic Item... (${progress}/${turnsNeeded} turns)`;
                        }
                    } else {
                        // Simple 1-turn crafts
                        let craftRes = await BastionManager._handleCraft(facDoc.name, facEntry, craftChoice);
                        if (craftRes.gold) localGold += craftRes.gold;
                        if (craftRes.item) items.push(craftRes.item);
                        resultText = craftRes.text;
                        
                        // Crafts like Arcane Focus or Book take exactly 1 turn.
                        order = "Maintain";
                        break; 
                    }
                } else if (order === "Recruit") {
                    let recRes = await BastionManager._handleRecruit(facDoc.name, facEntry, actor);
                    resultText = recRes.text;
                    facFlags.defenders = { count: recRes.newCount, names: recRes.newNames };
                } else if (order === "Empower") {
                    let empRes = await BastionManager._handleEmpower(facDoc.name, facEntry, actor);
                    resultText = empRes.text;
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
                    resultText += ` (${facDoc.name} to <b>${facSize}</b> completed!)`;
                    targetSize = null; upgradeProgress = 0; upgradeTurns = 0; targetSubType2 = null;
                } else {
                    resultText += ` (Enlarging to ${targetSize}: ${upgradeProgress}/${upgradeTurns} turns)`;
                }
            }

            totalGold += localGold;
            
            if (facEntry.isFlag) {
                const gf = groupFacilities.find(f => f._id === facDoc._id);
                if (gf) {
                    if (!gf.flags) gf.flags = {}; if (!gf.flags[MODULE_ID]) gf.flags[MODULE_ID] = {};
                    Object.assign(gf.flags[MODULE_ID], {
                        subType, progress, order, size: facSize, subType2: facSubType2,
                        craftChoice: facFlags?.craftChoice, arcanaTier: facFlags?.arcanaTier,
                        focusChoice: facFlags?.focusChoice,
                        sacredFocusChoice: facFlags?.sacredFocusChoice,
                        magicItemChoice: facFlags?.magicItemChoice,
                        upgradeProgress, targetSize, targetSubType2, upgradeTurns
                    });
                    if (facFlags.defenders) gf.flags[MODULE_ID].defenders = facFlags.defenders;

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
                    [`flags.${MODULE_ID}.size`]: facSize,
                    [`flags.${MODULE_ID}.craftChoice`]: facFlags?.craftChoice,
                    [`flags.${MODULE_ID}.focusChoice`]: facFlags?.focusChoice,
                    [`flags.${MODULE_ID}.sacredFocusChoice`]: facFlags?.sacredFocusChoice,
                    [`flags.${MODULE_ID}.magicItemChoice`]: facFlags?.magicItemChoice,
                    [`flags.${MODULE_ID}.arcanaTier`]: facFlags?.arcanaTier,
                    [`flags.${MODULE_ID}.subType2`]: facSubType2,
                    [`flags.${MODULE_ID}.upgradeProgress`]: upgradeProgress,
                    [`flags.${MODULE_ID}.targetSize`]: targetSize,
                    [`flags.${MODULE_ID}.targetSubType2`]: targetSubType2,
                    [`flags.${MODULE_ID}.upgradeTurns`]: upgradeTurns
                };
                if (facFlags.defenders) updates[`flags.${MODULE_ID}.defenders`] = facFlags.defenders;
                itemUpdates.push({ _id: facDoc.id, ...updates });
            }

            if (!isBasic || upgradeTurns > 0) {
                orderSummary += `<li style="margin-bottom: 6px; padding: 4px; background: rgba(0,0,0,0.03); border-radius: 3px;">
                                    <img src="${facDoc.img}" width="20" height="20" style="vertical-align: middle; border: none; margin-right: 6px; border-radius: 3px;">
                                    <b>${facDoc.name}</b> <br><span style="font-size: 0.9em; padding-left: 26px; display: block; color: #444;">${resultText}</span>
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
    static async _handleCraft(baseName, fac, craftChoice, tier = "Common", magicItemChoice = null) {
        let hirelings = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.hirelings) : (fac.doc.getFlag("dnd-2024-bastion-manager", "hirelings"));
        let hName = (Array.isArray(hirelings) && hirelings.length > 0) ? hirelings[0] : "The hireling";
        let hProf = BastionManager._getHirelingProfession(baseName, null);
        const MODULE_ID = "dnd-2024-bastion-manager";
        if (hName !== "The hireling") hName = `${hName} ${hProf}`;

        if (baseName.includes("Arcane Study")) {
            if (craftChoice === "Arcane Focus") {
                const focusChoice = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.focusChoice) : (fac.doc.getFlag("dnd-2024-bastion-manager", "focusChoice"));
                const outPack = game.packs.get("dnd-2024-bastion-manager.bastion-output-items");
                if (!outPack) return { text: "Error: Output compendium missing." };

                const docs = await outPack.getDocuments();
                const folder = outPack.folders.find(f => f.name === "Arcane Focus");
                
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
                return { text: `Completed crafting a <b>Blank Book</b> (10 GP spent).`, gold: -10, item };
            }
            if (craftChoice === "Magic Item (Arcana)") {
                const pack = game.packs.get("dnd-2024-bastion-manager.bastion-output-items");
                if (!pack) return { text: "Error: Bastion Output compendium not found." };

                // V13 Robust Folder Lookup: Try hardcoded IDs first, then resilient path-based search
                const fallbackId = tier === "Common" ? "gi6dlxWTn3zkmTAl" : "EWfRwKy27wZWAEix";
                let tierFolder = pack.folders.get(fallbackId);

                if (!tierFolder) {
                    tierFolder = pack.folders.find(f => {
                        if (f.name.trim().toLowerCase() !== tier.toLowerCase()) return false;
                        const parent = pack.folders.get(f.folder);
                        if (!parent || !parent.name.toLowerCase().includes("craft magic items")) return false;
                        let current = parent;
                        let isArcane = false;
                        while (current) {
                            if (current.name.toLowerCase().includes("arcane study")) { isArcane = true; break; }
                            current = pack.folders.get(current.folder);
                        }
                        return isArcane;
                    });
                }

                if (!tierFolder) return { text: `Error: Folder path 'Arcane Study > Craft Magic Items > ${tier}' not found in compendium.` };

                const index = await pack.getIndex({fields: ["folder"]});
                const itemEntry = index.find(e => e.folder === tierFolder.id && e.name === magicItemChoice);

                if (!itemEntry) return { text: `Error: Selected item '${magicItemChoice}' not found in the ${tier} folder.` };

                const doc = await pack.getDocument(itemEntry._id);
                const itemData = doc.toObject();

                return { text: `Completed crafting a <b>${tier} Magic Item</b>: ${itemData.name}.`, item: itemData };
            }
            return { text: "No craft option selected." };
        } else if (baseName === "Sanctuary") {
            if (craftChoice === "Druidic Focus" || craftChoice === "Holy Symbol") {
                const sacredFocusChoice = fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.sacredFocusChoice) : (fac.doc.getFlag(MODULE_ID, "sacredFocusChoice"));
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                if (!outPack) return { text: "Error: Output compendium missing." };

                const folderId = craftChoice === "Druidic Focus" ? "RTYj3BJ6ZRvuKxPq" : "BiV5sM1bdzI3ZWS6";
                const folder = outPack.folders.get(folderId);

                if (folder) {
                    const index = await outPack.getIndex({fields: ["folder"]});
                    const itemEntry = index.find(e => e.folder === folder.id && e.name === sacredFocusChoice);

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
            if (subType === "Smith's Tools") return { text: `The hirelings craft an item using Smith's Tools following the PHB rules.` };
            return { text: `The hirelings assist you in crafting a Common or Uncommon magic item (Armament) using the chapter 7 rules.` };
        } else if (baseName === "Workshop") {
            if (subType === "Adventuring Gear") return { text: `The hirelings craft Adventuring Gear using their Artisan's Tools following the PHB rules.` };
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
    static async _handleHarvest(baseName, subType, fac, isSecondPlot = false) {
        const outPack = game.packs.get("dnd-2024-bastion-manager.bastion-output-items");
        if (!outPack) return { item: null, text: "Output compendium missing." };
        const allDocs = await outPack.getDocuments(); 
        
        const isGarden = baseName.toLowerCase().includes("garden");
        const rootFolder = isGarden ? outPack.folders.get("HYjssa08njsoKbTO")
                                     : outPack.folders.find(f => f.name.toLowerCase().trim() === baseName.toLowerCase().trim());
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