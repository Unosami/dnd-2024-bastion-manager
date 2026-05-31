const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const BASTION_ORDERS = ["Maintain", "Craft", "Harvest", "Recruit", "Research", "Trade", "Empower"];

const BASTION_EVENTS_LIST = [
    { label: "All Is Well (01-50)", roll: 1 },
    { label: "Attack (51-55)", roll: 51 },
    { label: "Criminal Hireling (56-58)", roll: 56 },
    { label: "Extraordinary Opportunity (59-63)", roll: 59 },
    { label: "Friendly Visitors (64-72)", roll: 64 },
    { label: "Guest (73-76)", roll: 73 },
    { label: "Lost Hirelings (77-79)", roll: 77 },
    { label: "Magical Discovery (80-83)", roll: 80 },
    { label: "Refugees (84-91)", roll: 84 },
    { label: "Request for Aid (92-98)", roll: 92 },
    { label: "Treasure (99-00)", roll: 99 }
];

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

class SpellSelectionApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "bastion-spell-selection",
        classes: ["bastion-app", "bastion-spell-picker"],
        window: { title: "Teleportation Circle: Wizard Magic", icon: "fa-solid fa-wand-sparkles", resizable: true },
        position: { width: 850, height: 750 },
    };

    constructor(actor, spells, maxLevel, resolve, options = {}) {
        super(options);
        this.actor = actor;
        this.allSpells = spells;
        this.maxLevel = maxLevel;
        this.resolve = resolve;
        this.uiState = {
            search: "",
            level: "all",
            school: "",
            sort: { column: "level", direction: 1 },
            selectedUuid: null
        };
    }

    static async pickSpell(actor, spells, maxLevel) {
        return new Promise(resolve => {
            const app = new SpellSelectionApp(actor, spells, maxLevel, resolve);
            app.render({force: true});
        });
    }

    _getSpellData(s) {
        const schools = CONFIG.DND5E.spellSchools;
        const activationTypes = CONFIG.DND5E.abilityActivationTypes;
        const distUnits = CONFIG.DND5E.distanceUnits;
        const school = schools[s.system.school]?.label || s.system.school;
        const time = `${s.system.activation.cost || ""} ${activationTypes[s.system.activation.type] || s.system.activation.type}`.trim();
        const props = Array.from(s.system.properties || []);
        const componentMap = { vocal: "V", somatic: "S", material: "M" };
        const components = props.filter(p => componentMap[p]).map(p => {
            if (p === "material") {
                const mat = s.system.materials?.value;
                return mat ? `M (${mat})` : "M";
            }
            return componentMap[p];
        }).join(", ");
        const cost = s.system.materials?.cost || 0;
        const range = s.system.range.units === "touch" || s.system.range.units === "self" 
            ? distUnits[s.system.range.units] 
            : `${s.system.range.value || ""} ${distUnits[s.system.range.units] || s.system.range.units}`.trim();
        let source = "Unknown";
        const src = s.system.source;
        if (typeof src === "string") source = src;
        else if (src?.custom) source = src.custom;
        else if (src?.book) source = src.book;
        else if (src?.label) source = src.label;
        return { ...s, schoolLabel: school, timeLabel: time, rangeLabel: range, sourceLabel: source, costLabel: cost > 0 ? `${cost} GP` : "", components };
    }

    async _prepareContext() {
        const schools = CONFIG.DND5E.spellSchools;
        let spells = this.allSpells.map(s => this._getSpellData(s));
        let filtered = spells.filter(s => {
            if (this.uiState.level !== "all" && s.system.level !== parseInt(this.uiState.level)) return false;
            if (this.uiState.school && s.system.school !== this.uiState.school) return false;
            if (this.uiState.search && !s.name.toLowerCase().includes(this.uiState.search.toLowerCase())) return false;
            return true;
        });
        filtered.sort((a, b) => {
            let valA, valB;
            switch(this.uiState.sort.column) {
                case "level": valA = a.system.level; valB = b.system.level; break;
                case "name": valA = a.name; valB = b.name; break;
                case "time": valA = a.timeLabel; valB = b.timeLabel; break;
                case "school": valA = a.schoolLabel; valB = b.schoolLabel; break;
                case "range": valA = a.rangeLabel; valB = b.rangeLabel; break;
                case "source": valA = a.sourceLabel; valB = b.sourceLabel; break;
                case "cost": valA = a.system.materials?.cost || 0; valB = b.system.materials?.cost || 0; break;
            }
            if (valA < valB) return -1 * this.uiState.sort.direction;
            if (valA > valB) return 1 * this.uiState.sort.direction;
            if (a.name < b.name) return -1;
            if (a.name > b.name) return 1;
            return 0;
        });
        const selected = filtered.find(s => s.uuid === this.uiState.selectedUuid) || null;
        if ( selected ) {
            selected.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(selected.system.description.value, {
                async: true,
                secrets: this.actor.isOwner,
                relativeTo: this.actor
            });
        }
        return { spells: filtered, uiState: this.uiState, selected, schools, maxLevel: this.maxLevel };
    }

    async _renderHTML(context) {
        const { spells, uiState: state, selected, schools, maxLevel } = context;
        const rows = spells.map(s => {
            const isSelected = s.uuid === state.selectedUuid;
            return `<tr class="spell-row ${isSelected ? 'selected' : ''}" data-uuid="${s.uuid}" style="cursor: pointer; ${isSelected ? 'background: rgba(0, 100, 200, 0.2);' : ''}">
                <td style="text-align: center; padding: 5px;">${s.system.level === 0 ? 'C' : s.system.level}</td>
                <td style="padding: 5px;"><b>${s.name}</b></td>
                <td style="padding: 5px;">${s.timeLabel}</td>
                <td style="padding: 5px;">${s.schoolLabel}</td>
                <td style="padding: 5px;">${s.rangeLabel}</td>
                <td style="padding: 5px; color: #a32a22; font-weight: bold;">${s.costLabel}</td>
                <td style="font-size: 0.85em; opacity: 0.8; padding: 5px;">${s.sourceLabel}</td>
            </tr>`;
        }).join("");
        const schoolOptions = Object.entries(schools).map(([k, v]) => `<option value="${k}" ${state.school === k ? 'selected' : ''}>${v.label}</option>`).join("");
        let levelOptions = `<option value="all" ${state.level === "all" ? 'selected' : ''}>All Levels</option>`;
        for(let l=0; l<=maxLevel; l++) levelOptions += `<option value="${l}" ${state.level === String(l) ? 'selected' : ''}>Level ${l === 0 ? 'Cantrip' : l}</option>`;
        const sortIcon = (col) => {
            if (state.sort.column !== col) return '<i class="fa-solid fa-sort" style="opacity: 0.3;"></i>';
            return state.sort.direction === 1 ? '<i class="fa-solid fa-sort-up"></i>' : '<i class="fa-solid fa-sort-down"></i>';
        };
        return `
        <div style="display: flex; flex-direction: column; height: 100%; gap: 10px; font-family: var(--font-primary);">
            <div class="filters" style="display: flex; gap: 10px; align-items: center; background: rgba(0,0,0,0.05); padding: 8px; border-radius: 4px;">
                <div style="flex: 1; position: relative;"><i class="fa-solid fa-search" style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); opacity: 0.5;"></i><input type="text" class="search-input" value="${state.search}" placeholder="Search spells..." style="padding-left: 28px; width: 100%;"></div>
                <select class="level-filter" style="width: 120px;">${levelOptions}</select>
                <select class="school-filter" style="width: 150px;"><option value="">All Schools</option>${schoolOptions}</select>
            </div>
            <div class="table-container" style="flex: 1; overflow-y: auto; border: 1px solid #ccc; border-radius: 4px;">
                <table style="width: 100%; border-collapse: collapse; margin: 0;"><thead style="position: sticky; top: 0; background: #333; color: #fff; z-index: 10; box-shadow: 0 1px 2px rgba(0,0,0,0.1);"><tr style="text-align: left;">
                    <th data-sort="level" style="width: 50px; cursor: pointer; padding: 5px;">Lvl ${sortIcon('level')}</th>
                    <th data-sort="name" style="cursor: pointer; padding: 5px;">Name ${sortIcon('name')}</th>
                    <th data-sort="time" style="cursor: pointer; padding: 5px;">Cast Time ${sortIcon('time')}</th>
                    <th data-sort="school" style="cursor: pointer; padding: 5px;">School ${sortIcon('school')}</th>
                    <th data-sort="range" style="cursor: pointer; padding: 5px;">Range ${sortIcon('range')}</th>
                    <th data-sort="cost" style="cursor: pointer; padding: 5px;">Cost ${sortIcon('cost')}</th>
                    <th data-sort="source" style="cursor: pointer; padding: 5px;">Source ${sortIcon('source')}</th>
                </tr></thead><tbody>${rows}</tbody></table>
            </div>
            <div class="preview-area" style="height: 220px; border: 1px solid #ccc; border-radius: 4px; background: rgba(0,0,0,0.02); padding: 10px; overflow-y: auto;">
                ${selected ? `
                    <div style="display: flex; gap: 10px; align-items: flex-start; margin-bottom: 8px; border-bottom: 1px solid #ccc; padding-bottom: 8px;">
                        <img src="${selected.img}" width="48" height="48" style="border: none; border-radius: 4px;">
                        <div style="flex: 1;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                                <h2 style="margin: 0; border: none;">${selected.name}</h2>
                                <p style="margin: 0; font-weight: bold; opacity: 0.6; font-size: 0.85em; text-align: right; margin-left: 10px; padding-top: 4px;">${selected.components}</p>
                            </div>
                            <p style="margin: 0; font-style: italic; opacity: 0.8;">Level ${selected.system.level === 0 ? 'Cantrip' : selected.system.level} ${selected.schoolLabel}</p>
                        </div>
                    </div>
                    <div style="font-size: 0.9em; line-height: 1.4;">${selected.enrichedDescription}</div>
                ` : `<p style="text-align: center; margin-top: 80px; opacity: 0.5; font-style: italic;">Select a spell from the table to see details.</p>`}
            </div>
            <div class="actions" style="display: flex; justify-content: flex-end; gap: 10px; padding-top: 5px;">
                <button type="button" class="cancel-btn" style="width: auto; padding: 0 20px;">Cancel</button>
                <button type="button" class="confirm-btn" style="width: auto; padding: 0 20px; font-weight: bold;" ${!selected ? 'disabled' : ''}><i class="fa-solid fa-wand-magic-sparkles"></i> Cast & Dismiss</button>
            </div>
        </div>`;
    }

    _onRender(context, options) {
        const el = this.element;
        el.querySelectorAll('.spell-row').forEach(row => row.addEventListener('click', () => { this.uiState.selectedUuid = row.dataset.uuid; this.render(); }));
        el.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; if (this.uiState.sort.column === col) this.uiState.sort.direction *= -1; else { this.uiState.sort.column = col; this.uiState.sort.direction = 1; } this.render(); }));
        el.querySelector('.search-input').addEventListener('input', (ev) => { this.uiState.search = ev.target.value; this.render(); });
        el.querySelector('.level-filter').addEventListener('change', (ev) => { this.uiState.level = ev.target.value; this.render(); });
        el.querySelector('.school-filter').addEventListener('change', (ev) => { this.uiState.school = ev.target.value; this.render(); });
        el.querySelector('.confirm-btn').addEventListener('click', () => { this.resolve(this.uiState.selectedUuid); this.close(); });
        el.querySelector('.cancel-btn').addEventListener('click', () => { this.resolve(null); this.close(); });
    }

    _replaceHTML(result, content) { content.innerHTML = result; }
}

export class BastionManager extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(actor, options = {}) { 
        super(options); 
        this.actor = actor; 
        this._activeTab = "map";
        this._queueStates = {};
        this._changingOrders = new Set();
        this._advanceMode = "global";
    }

    static _professionsMap = null;

    /**
     * Loads the professions reference file and parses it into a searchable map.
     */
    static async loadProfessions() {
        try {
            const response = await fetch("modules/dnd-2024-bastion-manager/Resources/Professions Reference");
            if (!response.ok) return;
            const text = await response.text();
            this._professionsMap = {};
            const lines = text.split('\n');
            for (let line of lines) {
                const parts = line.split('-').map(p => p.trim());
                if (parts.length === 2) {
                    this._professionsMap[parts[0]] = parts[1];
                }
            }
        } catch (err) {
            console.error("Bastion Manager | Failed to load professions reference.", err);
        }
    }

    static DEFAULT_OPTIONS = {
        id: "bastion-manager", classes: ["bastion-app"], tag: "form",
        window: { title: "Bastion Management", icon: "fa-solid fa-chess-rook", resizable: true },
        position: { width: 880, height: 600 },
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
            deleteQueueItem: BastionManager.onDeleteQueueItem,
            moveQueueItem: BastionManager.onMoveQueueItem,
            promoteToActive: BastionManager.onPromoteToActive,
            toggleAutoTrade: BastionManager.onToggleAutoTrade,
            donateToStorehouse: BastionManager.onDonateToStorehouse,
            clearQueue: BastionManager.onClearQueue,
            switchTab: BastionManager.onSwitchTab,
            instantTransferAnimal: BastionManager.onInstantTransferAnimal,
            changeOrder: BastionManager.onChangeOrder,
            toggleReady: BastionManager.onToggleReady,
            advanceIndividualTurn: BastionManager.onAdvanceIndividualTurn,
            toggleAdvanceMode: BastionManager.onToggleAdvanceMode,
            theaterAction: BastionManager.onTheaterAction,
            castSpellcasterSpell: BastionManager.onCastSpellcasterSpell,
            consumeGreenhouseFruit: BastionManager.onConsumeGreenhouseFruit,
            refreshGreenhouseFruits: BastionManager.onRefreshGreenhouseFruits,
            renameStableAnimal: BastionManager.onRenameStableAnimal,
            toggleMeditation: BastionManager.onToggleMeditation,
            viewGraveyard: BastionManager.onViewGraveyard,
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
     * Extracts a size key from a document (Actor or Item).
     * Looks for system.size, then checks system.properties for size tags.
     * @param {object} doc The document or index entry.
     * @returns {string} The size key (tiny, sm, med, lg, huge, grg).
     */
    static async _extractSize(doc) {
        if (!doc) return "lg";
        // 1. Direct size field (standard for Actors, some Item schemas)
        let size = doc.system?.size || doc.system?.details?.size || doc.system?.traits?.size;
        if (size && typeof size === "string") return size.toLowerCase();

        // 2. Look in properties (Set, Array, or Object)
        let props = doc.system?.properties;
        let propList = (props instanceof Set) ? Array.from(props) : (Array.isArray(props) ? props : (typeof props === "object" && props !== null ? Object.keys(props).filter(k => props[k]) : []));
        const sizeKeys = ["tiny", "sm", "med", "lg", "huge", "grg"];
        const found = propList.find(p => sizeKeys.includes(String(p).toLowerCase()));
        if (found) return found.toLowerCase();

        // 3. Parse Description for Link (Actor UUID)
        const desc = doc.system?.description?.value;
        if (desc) {
            const match = desc.match(/@(?:UUID|Actor)\[([^\]]+)\]/);
            if (match) {
                try {
                    const linkedDoc = await fromUuid(match[1]);
                    if (linkedDoc && linkedDoc.documentName === "Actor") {
                        // Traits.size is the standard dnd5e path for Actor size
                        let linkedSize = linkedDoc.system?.traits?.size || linkedDoc.system?.size;
                        if (linkedSize) return linkedSize.toLowerCase();
                    }
                } catch (e) {
                    console.error("Bastion Manager | Error resolving linked actor for size:", e);
                }
            }
        }

        return "lg";
    }

    static _getScrollRequirements(name) {
        const n = name.toLowerCase();
        let level = 1;
        const lvlMatch = n.match(/\b(\d)(?:st|nd|rd|th)\b/);
        if (lvlMatch) level = parseInt(lvlMatch[1]);
        else if (n.includes("cantrip")) level = 0;
        else {
            const lvlMatch2 = n.match(/level\s+(\d)/);
            if (lvlMatch2) level = parseInt(lvlMatch2[1]);
        }
        const table = {
            0: { days: 1, gp: 15 }, 1: { days: 1, gp: 25 },
            2: { days: 3, gp: 100 }, 3: { days: 5, gp: 150 },
            4: { days: 10, gp: 1000 }, 5: { days: 25, gp: 1500 },
            6: { days: 40, gp: 10000 }, 7: { days: 50, gp: 12500 },
            8: { days: 60, gp: 15000 }, 9: { days: 120, gp: 50000 }
        };
        return table[level] || table[1];
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
     * Returns the slot cost based on actor size key.
     * Future-proofed for homebrew sizes.
     */
    static _getMountSlotCost(sizeKey) {
        const s = String(sizeKey || "lg").toLowerCase();
        // Tiny, Small, Medium all count as 0.5
        if ( ["tiny", "sm", "med", "small", "medium"].includes(s) ) return 0.5;
        // Large counts as 1.0
        if ( s === "lg" || s === "large" ) return 1.0;
        // Huge counts as 4.0
        if ( s === "huge" || s === "hg" ) return 3.0;
        // Anything larger (Gargantuan+) or unknown defaults to a "cannot house" value
        return 999;
    }

    /**
     * Returns the effective number of days for a project, scaling multiples of 7
     * if the 'scaleWeekToTurnLength' setting is enabled.
     * @param {number} baseDays The original day count from the rulebook.
     * @returns {number}
     */
    static _getEffectiveDays(baseDays) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const scale = game.settings.get(MODULE_ID, "scaleWeekToTurnLength");
        if (!scale || baseDays % 7 !== 0) return baseDays;
        const daysPerTurn = game.settings.get(MODULE_ID, "daysPerTurn") || 7;
        return (baseDays / 7) * daysPerTurn;
    }

    /**
     * Recursively builds a nested option structure for select menus matching folder hierarchy.
     */
    static async _getNestedCompendiumOptions(pack, rootFolderId, selectedValue, calculationMode, daysPerTurn, progressLabel, isMagicItem = true, folderNamesFilter = null, folderNamesExclude = null, showDetails = true) {
        const index = await pack.getIndex({ fields: ["folder", "system.rarity", "system.price", "system.quantity", "system.requirements.level", "system.size", "system.properties", "system.description.value"] });
        const allRelevantFolderIds = BastionManager._getAllSubfolderIds(pack, rootFolderId);
        
        let rootItems = [];
        let subGroups = [];

        const rarityOrder = { "common": 1, "uncommon": 2, "rare": 3, "veryrare": 4, "very rare": 4, "legendary": 5, "artifact": 6 };
        const sizeMap = { "tiny": "Tiny", "sm": "Small", "med": "Medium", "lg": "Large", "huge": "Huge", "grg": "Gargantuan" };

        for (const fId of allRelevantFolderIds) {
            const folder = pack.folders.get(fId);
            if (!folder) continue;

            // Filter folders by tools if a filter is provided (used for Workshop mundane gear)
            if (folderNamesFilter && String(fId) !== String(rootFolderId) && !folderNamesFilter.includes(folder.name)) continue;
            
            // Exclude folders (used to keep Magic Items out of mundane lists). Checks full hierarchy.
            if (folderNamesExclude) {
                const exclusions = folderNamesExclude.toLowerCase().split("|");
                let check = folder;
                let excluded = false;
                while (check && !excluded) { 
                    const folderName = check.name.toLowerCase();
                    if (exclusions.some(ex => folderName.includes(ex))) excluded = true;
                    check = check.parentId ? pack.folders.get(check.parentId) : null; 
                }
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

            const processedItems = await Promise.all(items.map(async i => {
                const rarity = i.system.rarity || "common";
                let price = i.system.price?.value ?? i.system.price ?? 0;
                if (typeof price === "string") price = parseFloat(price.replace(/[^0-9.]/g, "")) || 0;
                const size = await BastionManager._extractSize(i);
                const slots = BastionManager._getMountSlotCost(size);
                const qty = i.system.quantity || 1;

                let days, gp;
                const isScroll = i.name.toLowerCase().includes("spell scroll");
                if (isScroll) { // Scrolls handled first
                    const reqs = BastionManager._getScrollRequirements(i.name);
                    days = reqs.days;
                    gp = reqs.gp;
                } else if (isMagicItem) {
                    const reqs = BastionManager._getMagicItemRequirements(rarity);
                    days = reqs.days;
                    gp = reqs.gp;
                } else {
                    // Override for Stables: All mounts take 7 days / 1 turn
                    const isMount = folder?.name.toLowerCase().includes("mount") || folder?.name.toLowerCase().includes("stable");
                    const isPoison = folder?.name.toLowerCase().includes("poison");

                    if (isMount) {
                        days = BastionManager._getEffectiveDays(7);
                        gp = Number(price);
                        let label = i.name;
                        if (showDetails) label = `${i.name} (${gp} GP, ${sizeMap[size] || "Unknown"} - ${slots} slots)`;
                        return { 
                            value: i.name, 
                            label: label, 
                            selected: i.name === selectedValue, 
                            slots,
                            rarity, time: 1, price: gp, 
                            uuid: i.uuid || `Compendium.dnd-2024-bastion-manager.bastion-output-items.Item.${i._id || i.id}` 
                        };                    }

                    if (isPoison) {
                        days = BastionManager._getEffectiveDays(7);
                    } else {
                        days = Math.max(1, Math.ceil(Number(price) / 10));
                    }
                    gp = Math.floor(Number(price) / 2);
                }

                const tCount = calculationMode === "days" ? days : Math.ceil(days / daysPerTurn);
                let label = i.name;
                if (showDetails) {
                    label = `${i.name} (${rarity.charAt(0).toUpperCase() + rarity.slice(1)}: ${gp} GP, ${tCount} ${progressLabel})${qty > 1 ? ` [x${qty}]` : ''}`;
                }
                return {
                    value: i.name,
                    label: label,
                    selected: i.name === selectedValue,
                    rarity,
                    time: tCount,
                    price: gp,
                    uuid: i.uuid || `Compendium.dnd-2024-bastion-manager.bastion-output-items.Item.${i._id || i.id}`
                };
            }));

            const sortedItems = processedItems.sort((a,b) => {
                if (isMagicItem) {
                    const aOrder = rarityOrder[a.rarity] || 0;
                    const bOrder = rarityOrder[b.rarity] || 0;
                    if (aOrder !== bOrder) return aOrder - bOrder;
                }
                return a.label.localeCompare(b.label);
            });

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
        const MODULE_ID = "dnd-2024-bastion-manager";
        const actorTurnCount = this.actor.getFlag(MODULE_ID, "turnCount") || 0;
        const rawFacilities = this._getUnifiedFacilities();

        const wallCount = this.actor.getFlag(MODULE_ID, "completedWalls") || 0;
        const wallDays = this.actor.getFlag(MODULE_ID, "pendingWallDays") || 0;
        const mapSceneId = this.actor.getFlag(MODULE_ID, "mapSceneId");
        const hasMap = !!game.scenes.get(mapSceneId);
        
        const combinedGroupId = this.actor.getFlag(MODULE_ID, "combinedGroupId");
        const combinedGroup = combinedGroupId ? game.actors.get(combinedGroupId) : null;
        const layoutActor = combinedGroup || this.actor;
        const isGroupMode = this.actor.type === "group" || !!combinedGroup;

        // Denominator logic: Only count actors owned by active (logged-in) non-GM users.
        const activeNonGMs = game.users.filter(u => u.active && !u.isGM);
        const bastionActors = game.actors.filter(a => {
            const isAllowedType = a.type === "character" || a.type === "npc";
            const hasFacilities = a.items.some(i => i.type === "facility") || a.getFlag(MODULE_ID, "groupFacilities")?.length > 0;
            const ownedByActivePlayer = activeNonGMs.some(u => a.testUserPermission(u, "OWNER"));
            return isAllowedType && hasFacilities && ownedByActivePlayer;
        });
        const readyCount = bastionActors.filter(a => a.getFlag(MODULE_ID, "isReady")).length;
        const totalBastions = bastionActors.length;
        const isReady = this.actor.getFlag(MODULE_ID, "isReady") || false;

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
        const outIndex = outPack ? await outPack.getIndex({fields: ["name", "uuid", "folder", "system.rarity", "system.price", "system.quantity", "system.requirements.level", "system.size", "system.properties", "system.description.value"]}) : [];
        let gardenRoot = null;
        let greenhouseRoot = null;
        let laboratoryRoot = null;
        let greenhouseFolderIds = [];
        let poisonsFolderId = null;
        let poisonsLabFolderId = null;
        let healingFolderId = null;
        let fruitFolderId = null;

        if (outPack?.folders) {
            gardenRoot = outPack.folders.get("HYjssa08njsoKbTO") || outPack.folders.find(f => f.name.toLowerCase().trim() === "garden");
            if (gardenRoot) {
                dynamicGardenTypes = outPack.folders.filter(f => String(f.folder?.id || f.folder || f.parentId) === String(gardenRoot.id))
                    .map(f => ({ id: f.id, name: f.name }));
            }
            greenhouseRoot = outPack.folders.find(f => f.name.toLowerCase().trim() === "greenhouse");
            if (greenhouseRoot) {
                greenhouseFolderIds = BastionManager._getAllSubfolderIds(outPack, greenhouseRoot.id);
                // Identify specific subfolders for Greenhouse filtering
                const subfolders = outPack.folders.filter(f => (f.parentId || f.folder?.id || f.folder) === greenhouseRoot.id);
                poisonsFolderId = subfolders.find(f => f.name.toLowerCase().includes("poison"))?.id;
                healingFolderId = subfolders.find(f => f.name.toLowerCase().includes("herb"))?.id;
                fruitFolderId = subfolders.find(f => f.name.toLowerCase().includes("fruit"))?.id;
            }
            laboratoryRoot = outPack.folders.find(f => f.name.toLowerCase().trim() === "laboratory");
            if (laboratoryRoot) {
                const subfolders = outPack.folders.filter(f => (f.parentId || f.folder?.id || f.folder) === laboratoryRoot.id);
                poisonsLabFolderId = subfolders.find(f => f.name.toLowerCase().includes("poison"))?.id;
            }
        }

        const fruitEntry = outIndex.find(i => (fruitFolderId ? (i.folder?.id || i.folder) === fruitFolderId : true) && (i.name === "Fruit of Restoration" || i.name === "Magical Fruit"));
        const fruitUuid = fruitEntry?.uuid;

        const hasActiveOrder = rawFacilities.some(fac => {
            if (fac.isInherited) return false;
            const flags = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]) : (fac.sourceDoc.getFlag(MODULE_ID) || {});
            return flags?.order && flags.order !== "Maintain";
        });
        const neglectWarning = !disableNeglect && (neglectCounter > 0 && !hasActiveOrder);

        const ratio = Math.min(neglectCounter / actorLevel, 1);

        // Meditation Chamber Global State
        const innerPeaceActive = this.actor.getFlag(MODULE_ID, "innerPeaceActive") || false;
        const fortifiedSaves = this.actor.getFlag(MODULE_ID, "fortifiedSaves") || [];

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

        const totalBastionDefenders = rawFacilities.reduce((sum, f) => {
            const dData = f.isFlag ? (f.sourceDoc.flags?.[MODULE_ID]?.defenders) : (f.sourceDoc.getFlag(MODULE_ID, "defenders"));
            return sum + (dData?.count || 0);
        }, 0);

        const facilities = await Promise.all(rawFacilities.map(async fac => {
            const getFacFlag = (key) => fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.[key]) : (fac.sourceDoc.getFlag(MODULE_ID, key));
            
            const rawQueue = getFacFlag("craftQueue") || [];
            const isBasic = isBasicFac(fac.sourceDoc);
            let facSize = getFacFlag("size");
            if (facSize === undefined) facSize = isBasic ? "Roomy" : null;
            let progress = Number(getFacFlag("progress") || 0);
            let facSubType = getFacFlag("subType");
            let facSubType2 = getFacFlag("subType2");

            let currentOrder = getFacFlag("order") || "Maintain";
            let hirelingsArr = getFacFlag("hirelings");
            let hirelingsDisplay = Array.isArray(hirelingsArr) ? hirelingsArr.join(", ") : "";

            let facDefenders = getFacFlag("defenders") || {count: 0, names: []};
            totalDefenders += facDefenders.count;
            if (facDefenders.names.length > 0) allDefenderNames.push(...facDefenders.names);

            const isDamaged = getFacFlag("isDamaged") || false;
            const repairProgress = Number(getFacFlag("repairProgress") || 0);
            const repairTurns = Number(getFacFlag("repairTurns") || 0);

            const upgradeProgress = getFacFlag("upgradeProgress") || 0;
            const upgradeTurns = getFacFlag("upgradeTurns") || 0;
            const isUnderConstruction = upgradeTurns > 0;
            const isBuilding = isUnderConstruction && !facSize;
            const isOrderChanging = this._changingOrders.has(fac.id);
            const isOrderLocked = (progress > 0 || isBuilding || isDamaged);
            const isSelectionDisabled = fac.isInherited || isBuilding || isDamaged || (progress > 0 && !isOrderChanging);
            
            const isBarrack = fac.name.includes("Barrack");
            const promptNames = isBarrack ? (getFacFlag("promptNames") ?? true) : false;

            const isTeleportationCircle = fac.name.includes("Teleportation Circle");
            const visitingSpellcaster = getFacFlag("visitingSpellcaster") || false;
            const isTheater = fac.name.includes("Theater");
            const isMeditationChamber = fac.name.includes("Meditation Chamber");

            const theaterPhase = isTheater ? (getFacFlag("theaterPhase") || "Idle") : "Idle";
            const theaterProgress = isTheater ? Number(getFacFlag("theaterProgress") || 0) : 0;
            const theaterProgressPct = isTheater ? Math.round((Math.min(theaterProgress, 14) / 14) * 100) : 0;
            const theaterContributors = isTheater ? (getFacFlag("theaterContributors") || []) : [];
            const theaterAuthor = isTheater ? (getFacFlag("theaterAuthor") || "") : "";
            const theaterRoster = isTheater ? {
                writer: theaterContributors.find(c => c.role === "Composer/Writer"),
                director: theaterContributors.find(c => c.role === "Conductor/Director"),
                performers: theaterContributors.filter(c => c.role === "Performer")
            } : null;
            const isJoinedTheater = isTheater ? theaterContributors.some(c => c.actorId === (game.user.character?.id || null)) : false;
            const theaterPhaseColor = isTheater ? (theaterPhase === "Writing" ? "#82cfff" : (theaterPhase === "Rehearsing" ? "#ff9800" : (theaterPhase === "Performing" ? "#4caf50" : "#777"))) : "#777";
            const isWritingPhase = theaterPhase === "Writing";
            const isActingPhase = theaterPhase === "Rehearsing" || theaterPhase === "Performing";

            if (isActingPhase && theaterRoster && !theaterRoster.director) {
                const hList = getFacFlag("hirelings") || [];
                if (hList.length > 0) {
                    // Use a stable index based on facility ID so the "Director" doesn't change every render
                    const seed = fac.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                    theaterRoster.director = { name: hList[seed % hList.length], isHireling: true };
                }
            }

            const theaterDieSize = actorLevel >= 17 ? "d10" : (actorLevel >= 13 ? "d8" : "d6");

            const spellcasterDaysRemaining = getFacFlag("spellcasterDaysRemaining") || 0;
            const spellcasterDisplayTime = calculationMode === "days" ? spellcasterDaysRemaining : Math.ceil(spellcasterDaysRemaining / daysPerTurn);
            const spellcasterTimeUnit = (calculationMode === "days") 
                ? (spellcasterDisplayTime === 1 ? "day" : "days") 
                : (spellcasterDisplayTime === 1 ? "turn" : "turns");
            const spellcasterName = getFacFlag("spellcasterName") || "";
            const maxSpellLevel = actorLevel >= 17 ? 8 : 4;

            const storedCraftChoice = getFacFlag("craftChoice") || "";
            const storedFocusChoice = getFacFlag("focusChoice") || "";
            const storedMagicItemChoice = getFacFlag("magicItemChoice") || "";
            const storedSacredFocusChoice = getFacFlag("sacredFocusChoice") || "";
            const storedSmithyItemChoice = getFacFlag("smithyItemChoice") || "";
            const storedArmamentItemChoice = getFacFlag("armamentItemChoice") || "";
            const storedWorkshopItemChoice = getFacFlag("workshopItemChoice") || "";
            const storedRelicItemChoice = getFacFlag("relicItemChoice") || "";
            const storedScrollChoice = getFacFlag("scrollChoice") || "";
            const activeProjectChoice = getFacFlag("activeProjectChoice") || "";
            const bookTitle = getFacFlag("bookTitle") || "";
            const paperworkTitle = getFacFlag("paperworkTitle") || "";
            const paperworkQty = getFacFlag("paperworkQty") || 50;
            
            // Declare effective choices at a higher scope to ensure accessibility
            let effectiveFocusChoice = "";
            let effectiveMagicItemChoice = "";
            let effectiveSacredCraftChoice = "";
            let effectiveSacredItemChoice = "";
            let effectiveSmithyCraftChoice = "";
            let effectiveSmithyItemChoice = "";
            let effectiveArmamentItemChoice = "";
            let effectiveWorkshopCraftChoice = "";
            let effectiveWorkshopItemChoice = "";
            let effectiveRelicChoice = "";
            let effectiveScrollChoice = "";
            let effectiveTrainerChoice = "";
            let effectiveLabAlchemistChoice = "";
            let effectiveLabPoisonChoice = "";
            let effectiveStableItemChoice = "";

            const focusChoice = storedFocusChoice;
            const magicItemChoice = storedMagicItemChoice;
            const sacredFocusChoice = storedSacredFocusChoice;
            const smithyItemChoice = storedSmithyItemChoice;
            const armamentItemChoice = storedArmamentItemChoice;
            const workshopItemChoice = storedWorkshopItemChoice;
            const relicItemChoice = storedRelicItemChoice;
            const scrollChoice = storedScrollChoice;

            let rawProps = fac.sourceDoc.system?.properties;
            let propArray = [];
            if (rawProps instanceof Set) propArray = Array.from(rawProps);
            else if (Array.isArray(rawProps)) propArray = rawProps;
            else if (typeof rawProps === "object" && rawProps !== null) propArray = Object.keys(rawProps).filter(k => rawProps[k]);

            const safeProps = propArray.map(p => String(p).toLowerCase());
            const availableOrders = ["Maintain"];
            if (progress > 0) availableOrders.unshift("Continue Project");
            if (rawQueue.length > 0) availableOrders.push("Progress Queue");
            const systemOrder = fac.sourceDoc.system?.order;

            if (systemOrder && typeof systemOrder === "string") {
                const formattedOrder = systemOrder.charAt(0).toUpperCase() + systemOrder.slice(1).toLowerCase();
                let label = formattedOrder;
                if (formattedOrder === "Empower" && fac.name.includes("Theater")) label = "Empower: Theatrical Event";
                if (formattedOrder === "Trade" && fac.name.includes("Armory")) label = "Trade: Stock Armory";
                
                if (formattedOrder !== "Maintain" && !availableOrders.includes(label)) {
                    availableOrders.push(label);
                }
            }

            BASTION_ORDERS.forEach(order => {
                let label = order;
                if (order === "Empower" && fac.name.includes("Theater")) label = "Empower: Theatrical Event";
                if (order === "Trade" && fac.name.includes("Armory")) label = "Trade: Stock Armory";

                if (order === "Maintain" || availableOrders.includes(label)) return;
                const lowerOrder = order.toLowerCase();
                if (safeProps.some(p => p.includes(lowerOrder))) {
                    availableOrders.push(label);
                }
            });

            if (availableOrders.includes("Craft") && fac.name.includes("Laboratory")) {
                const idx = availableOrders.indexOf("Craft");
                availableOrders.splice(idx, 1, "Craft: Alchemist's Supplies", "Craft: Poison");
            }

            if (availableOrders.includes("Research") && fac.name.includes("Trophy Room")) {
                const idx = availableOrders.indexOf("Research");
                availableOrders.splice(idx, 1, "Research: Lore", "Research: Trinket Trophy");
            }

            if (availableOrders.includes("Research") && fac.name.includes("Archive")) {
                const idx = availableOrders.indexOf("Research");
                availableOrders.splice(idx, 1, "Research: Helpful Lore");
            }

            if (fac.name.includes("Garden")) availableOrders.push("Change Type");

            // Greenhouse Harvest Expansion
            if (availableOrders.includes("Harvest") && fac.name.includes("Greenhouse")) {
                const idx = availableOrders.indexOf("Harvest");
                availableOrders.splice(idx, 1, "Harvest: Healing Herbs", "Harvest: Poison");
            }

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
                } else if (fname.includes("Sacristy")) {
                    specialOrders.push("Craft: Holy Water");
                    if (actorLevel >= 9) specialOrders.push("Craft: Magic Item (Relic)");
                }
                else if (fname.includes("Scriptorium")) {
                    specialOrders.push("Craft: Book Replica", "Craft: Spell Scroll", "Craft: Paperwork");
                }

                if (specialOrders.length > 0) {
                    const idx = availableOrders.indexOf("Craft");
                    availableOrders.splice(idx, 1, ...specialOrders);
                }
            }

            // Map underlying flag to UI label
            let craftChoice = fac.isFlag ? (fac.sourceDoc.flags?.[MODULE_ID]?.craftChoice || "") : (fac.sourceDoc.getFlag(MODULE_ID, "craftChoice") || "");
            let currentUIOrder = (currentOrder === "Craft" && craftChoice) ? `Craft: ${craftChoice}` : currentOrder;
            if (currentOrder === "Empower" && fac.name.includes("Theater")) currentUIOrder = "Empower: Theatrical Event";
            if (currentOrder === "Trade" && fac.name.includes("Armory")) currentUIOrder = "Trade: Stock Armory";
            if (currentOrder === "Harvest" && fac.name.includes("Greenhouse")) {
                currentUIOrder = `Harvest: ${craftChoice || "Healing Herbs"}`;
            }
            if (currentOrder === "Research" && fac.name.includes("Trophy Room")) {
                currentUIOrder = `Research: ${craftChoice || "Lore"}`;
            }
            if (currentOrder === "Research" && fac.name.includes("Archive")) {
                currentUIOrder = "Research: Helpful Lore";
            }
            if (currentOrder === "Craft" && fac.name.includes("Laboratory")) {
                currentUIOrder = `Craft: ${craftChoice || "Alchemist's Supplies"}`;
            }
            
            let safeOrder = availableOrders.includes(currentUIOrder) ? currentUIOrder : "Maintain";
            if (progress > 0 && !fac.name.includes("Garden")) safeOrder = "Continue Project";
            
            // Default to Progress Queue if it exists and no other order is active
            if (safeOrder === "Maintain" && rawQueue.length > 0) safeOrder = "Progress Queue";

            craftChoice = safeOrder.includes(": ") ? safeOrder.split(": ")[1] : craftChoice;

            const firstQueueItem = rawQueue.length > 0 ? rawQueue[0] : null;

            const isCrafting = safeOrder.startsWith("Craft") || safeOrder === "Continue Project" || safeOrder === "Progress Queue";
            // A project is paused if the current order is NOT craft, but the first item in the queue IS a paused project.
            const isPausedProjectInQueue = firstQueueItem?.isPausedProject && !isCrafting;
            const isCraftingOrPaused = isCrafting || isPausedProjectInQueue || progress > 0;

            const isArcaneStudyCrafting = fac.name.includes("Arcane Study") && isCraftingOrPaused;
            const isSanctuaryCrafting = fac.name.includes("Sanctuary") && isCraftingOrPaused;
            const isWorkshopCrafting = fac.name.includes("Workshop") && isCraftingOrPaused;
            const isSacristyCrafting = fac.name.includes("Sacristy") && isCraftingOrPaused;
            const isScriptoriumCrafting = fac.name.includes("Scriptorium") && isCraftingOrPaused;
            const isLaboratoryCrafting = fac.name.includes("Laboratory") && isCraftingOrPaused;
            const isGardenHarvesting = fac.name.includes("Garden") && safeOrder === "Harvest";
            const isGreenhouseHarvesting = fac.name.includes("Greenhouse") && (safeOrder.startsWith("Harvest") || isPausedProjectInQueue || progress > 0);
            const isSmithyCrafting = fac.name.includes("Smithy") && isCraftingOrPaused;

            const greenhousePoisonChoice = getFacFlag("greenhousePoisonChoice") || "Assassin's Blood";


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

            const isLibraryResearching = (fac.name.includes("Library") && safeOrder === "Research") || (fac.name.includes("Trophy Room") && safeOrder.includes("Lore")) || (fac.name.includes("Archive") && safeOrder === "Research: Helpful Lore");
            const libraryTopic = fac.isFlag ? (fac.sourceDoc.flags?.["dnd-2024-bastion-manager"]?.libraryTopic || "") : (fac.sourceDoc.getFlag("dnd-2024-bastion-manager", "libraryTopic") || "");

            const craftQueue = rawQueue.map((q, idx) => {
                const timeCost = Number(q.timeCost ?? 0);
                const currentProgress = Number(q.currentProgress ?? 0);
                const progressPct = timeCost > 0 ? Math.floor((currentProgress / timeCost) * 100) : 0;
                return {
                    ...q,
                    actualIndex: idx,
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
            let relicItemOptions = [];
            let relicItemUuid = null;
            let scrollItemOptions = [];
            let scrollItemUuid = null;
            let labAlchemistOptions = [];
            let labAlchemistUuid = null;
            let labPoisonOptions = [];
            let labPoisonUuid = null;
            let trainerTypeOptions = [];
            let trainerTypeUuid = null;
            let stableItemOptions = [];
            let stableItemUuid = null;
            let stableTransferOptions = [];
            let workshopTools = [];

            // --- Stable Metadata Initialization ---
            const isStable = fac.name.includes("Stable");
            let stableAnimals = getFacFlag("stableAnimals") || [];
            // Migrate old string-only array to object array if necessary
            stableAnimals = stableAnimals.map(a => typeof a === "string" ? { species: a, nickname: "" } : a);
            
            const stableTradeChoice = getFacFlag("stableTradeChoice") || "buy";
            const stableMaxSlots = facSize === "Vast" ? 6 : 3;
            const isStableTrade = isStable && currentOrder === "Trade";
            let stableUsedSlots = 0;
            
            if (isStable && outPack) {
                const index = await outPack.getIndex({fields: ["system.size", "system.properties", "system.description.value"]});
                for (const animal of stableAnimals) {
                    const entry = index.find(e => e.name.toLowerCase() === animal.species.toLowerCase());
                    stableUsedSlots += BastionManager._getMountSlotCost(await BastionManager._extractSize(entry));
                }
            }

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
                    
                    effectiveFocusChoice = (progress > 0 && activeProjectChoice && craftChoice === "Arcane Focus") ? activeProjectChoice : (isCrafting && craftChoice === "Arcane Focus") ? storedFocusChoice : (isPausedProjectInQueue && firstQueueItem.craftType === "Arcane Focus" ? firstQueueItem.choice : "");
                    effectiveMagicItemChoice = (progress > 0 && activeProjectChoice && craftChoice === "Magic Item (Arcana)") ? activeProjectChoice : (isCrafting && craftChoice === "Magic Item (Arcana)") ? storedMagicItemChoice : (isPausedProjectInQueue && firstQueueItem.craftType === "Magic Item (Arcana)" ? firstQueueItem.choice : "");

                    focusOptions = await BastionManager._getNestedCompendiumOptions(outPack, "ByVgJZyPE5H3M5tV", effectiveFocusChoice, calculationMode, daysPerTurn, progressLabel, false, null, "Magic Item");
                    arcaneFocusUuid = findUuid(focusOptions, effectiveFocusChoice);
                    magicItemOptions = await BastionManager._getNestedCompendiumOptions(outPack, arcaneBranch, effectiveMagicItemChoice, calculationMode, daysPerTurn, progressLabel, true, null, "Focus|Book");
                    magicItemUuid = findUuid(magicItemOptions, effectiveMagicItemChoice);
                }

                // --- Sanctuary ---
                if (fac.name.includes("Sanctuary")) {
                    const druidFolder = "RTYj3BJ6ZRvuKxPq";
                    const holyFolder = "BiV5sM1bdzI3ZWS6";
                    
                    effectiveSacredCraftChoice = (isCrafting && craftChoice) ? craftChoice : (isPausedProjectInQueue ? firstQueueItem.craftType : "");
                    effectiveSacredItemChoice = (progress > 0 && activeProjectChoice && (craftChoice === "Druidic Focus" || craftChoice === "Holy Symbol")) ? activeProjectChoice : (isCrafting && (craftChoice === "Druidic Focus" || craftChoice === "Holy Symbol")) ? storedSacredFocusChoice : (isPausedProjectInQueue && (firstQueueItem.craftType === "Druidic Focus" || firstQueueItem.craftType === "Holy Symbol") ? firstQueueItem.choice : "");

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
                    
                    effectiveSmithyCraftChoice = (isCrafting && craftChoice) ? craftChoice : (isPausedProjectInQueue ? firstQueueItem.craftType : "");
                    effectiveSmithyItemChoice = (progress > 0 && activeProjectChoice && craftChoice === "Smith's Tools") ? activeProjectChoice : (isCrafting && craftChoice === "Smith's Tools") ? storedSmithyItemChoice : (isPausedProjectInQueue && firstQueueItem.craftType === "Smith's Tools" ? firstQueueItem.choice : "");
                    effectiveArmamentItemChoice = (progress > 0 && activeProjectChoice && craftChoice === "Magic Item (Armament)") ? activeProjectChoice : (isCrafting && craftChoice === "Magic Item (Armament)") ? storedArmamentItemChoice : (isPausedProjectInQueue && firstQueueItem.craftType === "Magic Item (Armament)" ? firstQueueItem.choice : "");

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
                    
                    effectiveWorkshopCraftChoice = (isCrafting && craftChoice) ? craftChoice : (isPausedProjectInQueue ? firstQueueItem.craftType : "");
                    effectiveWorkshopItemChoice = (progress > 0 && activeProjectChoice && (craftChoice === "Adventuring Gear" || craftChoice === "Magic Item (Implement)")) ? activeProjectChoice : (isCrafting && (craftChoice === "Adventuring Gear" || craftChoice === "Magic Item (Implement)")) ? storedWorkshopItemChoice : (isPausedProjectInQueue && (firstQueueItem.craftType === "Adventuring Gear" || firstQueueItem.craftType === "Magic Item (Implement)") ? firstQueueItem.choice : "");

                    const isMagic = effectiveWorkshopCraftChoice === "Magic Item (Implement)";
                    const magicFolder = outPack.folders.find(f => workshopSubfolders.includes(f.id) && f.name.toLowerCase().includes("magic item"));
                    
                    if (isMagic && magicFolder) {
                        workshopItemOptions = await BastionManager._getNestedCompendiumOptions(outPack, magicFolder.id, effectiveWorkshopItemChoice, calculationMode, daysPerTurn, progressLabel, true);
                    } else {
                        workshopItemOptions = await BastionManager._getNestedCompendiumOptions(outPack, workshopBranch, effectiveWorkshopItemChoice, calculationMode, daysPerTurn, progressLabel, false, workshopTools, "Magic Item");
                    }
                    workshopItemUuid = findUuid(workshopItemOptions, effectiveWorkshopItemChoice);
                }

                // --- Sacristy ---
                if (fac.name.includes("Sacristy")) {
                    const relicFolder = outPack.folders.find(f => f.name.toLowerCase().includes("relic"));
                    effectiveRelicChoice = (progress > 0 && activeProjectChoice && craftChoice === "Magic Item (Relic)") ? activeProjectChoice : (isCrafting && craftChoice === "Magic Item (Relic)") ? relicItemChoice : (isPausedProjectInQueue && firstQueueItem.craftType === "Magic Item (Relic)" ? firstQueueItem.choice : "");
                    if (relicFolder) {
                        relicItemOptions = await BastionManager._getNestedCompendiumOptions(outPack, relicFolder.id, effectiveRelicChoice, calculationMode, daysPerTurn, progressLabel, true);
                        relicItemUuid = findUuid(relicItemOptions, effectiveRelicChoice);
                    }
                }

                // --- Scriptorium ---
                if (fac.name.includes("Scriptorium")) {
                    const scrollFolder = outPack.folders.find(f => f.name.toLowerCase().includes("scroll"));
                    effectiveScrollChoice = (progress > 0 && activeProjectChoice && craftChoice === "Spell Scroll") ? activeProjectChoice : (isCrafting && craftChoice === "Spell Scroll") ? storedScrollChoice : (isPausedProjectInQueue && firstQueueItem.craftType === "Spell Scroll" ? firstQueueItem.choice : "");
                    if (scrollFolder) {
                        scrollItemOptions = await BastionManager._getNestedCompendiumOptions(outPack, scrollFolder.id, effectiveScrollChoice, calculationMode, daysPerTurn, progressLabel, true);
                        scrollItemUuid = findUuid(scrollItemOptions, effectiveScrollChoice);
                    }
                }

                // --- Laboratory ---
                if (fac.name.includes("Laboratory")) {
                    const alchFolderId = "mqk8IahDyEIKpvcj";
                    const poisFolderId = "fwyUIxfHsEGOLHYc";
                    
                    effectiveLabAlchemistChoice = (progress > 0 && activeProjectChoice && craftChoice === "Alchemist's Supplies") ? activeProjectChoice : (isCrafting && craftChoice === "Alchemist's Supplies") ? (getFacFlag("laboratoryAlchemistChoice") || "") : (isPausedProjectInQueue && firstQueueItem.craftType === "Alchemist's Supplies" ? firstQueueItem.choice : "");
                    effectiveLabPoisonChoice = (progress > 0 && activeProjectChoice && craftChoice === "Poison") ? activeProjectChoice : (isCrafting && craftChoice === "Poison") ? (getFacFlag("laboratoryPoisonChoice") || "") : (isPausedProjectInQueue && firstQueueItem.craftType === "Poison" ? firstQueueItem.choice : "");

                    labAlchemistOptions = await BastionManager._getNestedCompendiumOptions(outPack, alchFolderId, effectiveLabAlchemistChoice, calculationMode, daysPerTurn, progressLabel, false);
                    labAlchemistUuid = findUuid(labAlchemistOptions, effectiveLabAlchemistChoice);

                    labPoisonOptions = await BastionManager._getNestedCompendiumOptions(outPack, poisFolderId, effectiveLabPoisonChoice, calculationMode, daysPerTurn, progressLabel, false);
                    labPoisonUuid = findUuid(labPoisonOptions, effectiveLabPoisonChoice);
                }

                // --- Training Area ---
                if (fac.name.includes("Training Area")) {
                    const trainingFolder = outPack.folders.find(f => f.name.toLowerCase().trim() === "training area");
                    if (trainingFolder) {
                        effectiveTrainerChoice = getFacFlag("trainerType") || "";
                        trainerTypeOptions = await BastionManager._getNestedCompendiumOptions(outPack, trainingFolder.id, effectiveTrainerChoice, calculationMode, daysPerTurn, progressLabel, false, null, null, false);
                        trainerTypeUuid = findUuid(trainerTypeOptions, effectiveTrainerChoice);
                    }
                }

                // --- Stable ---
                if (fac.name.includes("Stable")) {
                    const stableFolder = outPack.folders.find(f => f.name.toLowerCase().includes("stable") || f.name.toLowerCase().includes("mount"));
                    effectiveStableItemChoice = (getFacFlag("stableItemChoice") || "");
                    if (stableFolder) {
                        const allStableOptions = await BastionManager._getNestedCompendiumOptions(outPack, stableFolder.id, effectiveStableItemChoice, calculationMode, daysPerTurn, progressLabel, false);
                        stableItemUuid = findUuid(allStableOptions, effectiveStableItemChoice);

                        // Map potential mount names for inventory filtering in the Transfer Store dropdown
                        fac.potentialMountNames = allStableOptions.flatMap(o => o.groupOptions ? o.groupOptions.map(so => so.value) : [o.value]);

                        // Filter Sell dropdown to only what is in the stable
                        const tradeChoice = getFacFlag("stableTradeChoice") || "buy";
                        if (tradeChoice === "sell") {
                            let filteredOptions = []; // Filter sell dropdown to only what is in the stable
                            for (const option of allStableOptions) {
                                if (option.groupOptions) {
                                    const filteredGroupOptions = option.groupOptions.filter(subOption => stableAnimals.some(a => a.species === subOption.value));
                                    if (filteredGroupOptions.length > 0) {
                                        filteredOptions.push({ ...option, groupOptions: filteredGroupOptions });
                                    }
                                } else if (stableAnimals.some(a => a.species === option.value)) {
                                    filteredOptions.push(option);
                                }
                            }
                            stableItemOptions = filteredOptions;
                        } else {
                            stableItemOptions = allStableOptions;

                            // Highlight items that won't fit in Buy mode
                            const remaining = stableMaxSlots - stableUsedSlots;
                            const highlightLargeItems = (opts) => {
                                for (const o of opts) {
                                    if (o.groupOptions) highlightLargeItems(o.groupOptions);
                                    else if (o.slots > remaining) {
                                        o.style = "background-color: #fff3cd; color: #856404;"; // Yellow highlight
                                        o.label += " (Too Large)";
                                    }
                                }
                            };
                            highlightLargeItems(stableItemOptions);
                        }
                    }
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

            let armoryStockCost = 0;
            if (fac.name.includes("Armory")) {
                armoryStockCost = 100 + (100 * totalBastionDefenders);
                if (rawFacilities.some(f => f.name.includes("Smithy"))) armoryStockCost = Math.floor(armoryStockCost / 2);
            }

             let currentMaxCraftTurns = 0;
            let currentGoldCost = 0;
            const isArcaneStudy = fac.name.includes("Arcane Study");
            const isSmithy = fac.name.includes("Smithy");
            const isWorkshop = fac.name.includes("Workshop");
            const isSanctuary = fac.name.includes("Sanctuary");
            const isScriptorium = fac.name.includes("Scriptorium");
            const isSacristy = fac.name.includes("Sacristy");
            const isGreenhouse = fac.name.includes("Greenhouse");

            if (isArcaneStudy) {
                const effCraft = (progress > 0) ? getFacFlag("craftChoice") : storedCraftChoice;
                if (effCraft === "Magic Item (Arcana)") {
                    const opt = findOptionData(magicItemOptions, effectiveMagicItemChoice);
                    if (opt) {
                        currentMaxCraftTurns = opt.time;
                        currentGoldCost = opt.price;
                    }
                } else if (effCraft === "Arcane Focus") currentMaxCraftTurns = calculationMode === "days" ? 7 : 1;
                else if (effCraft === "Book") {
                    currentMaxCraftTurns = calculationMode === "days" ? 7 : 1;
                    currentGoldCost = 10;
                }
            } else if (isSmithy) {
                const effCraft = (progress > 0) ? getFacFlag("craftChoice") : storedCraftChoice;
                if (effCraft === "Magic Item (Armament)") {
                    const opt = findOptionData(armamentItemOptions, effectiveArmamentItemChoice);
                    if (opt) {
                        currentMaxCraftTurns = opt.time;
                        currentGoldCost = opt.price;
                    }
                } else if (effCraft === "Smith's Tools") {
                    const opt = findOptionData(smithyItemOptions, effectiveSmithyItemChoice);
                    if (opt) {
                        currentMaxCraftTurns = opt.time;
                        currentGoldCost = opt.price;
                    }
                }
            } else if (isWorkshop) {
                const opt = findOptionData(workshopItemOptions, effectiveWorkshopItemChoice);
                if (opt) {
                    currentMaxCraftTurns = opt.time;
                    currentGoldCost = opt.price;
                }
             } else if (isSanctuary) {
                currentMaxCraftTurns = calculationMode === "days" ? 7 : 1;
            } else if (isSacristy) {
                const effCraft = (progress > 0) ? getFacFlag("craftChoice") : storedCraftChoice;
                if (effCraft === "Magic Item (Relic)") {
                    const opt = findOptionData(relicItemOptions, effectiveRelicChoice);
                    if (opt) {
                        currentMaxCraftTurns = opt.time;
                        currentGoldCost = opt.price;
                    }
                } else if (effCraft === "Holy Water") {
                    currentMaxCraftTurns = calculationMode === "days" ? 7 : 1;
                    currentGoldCost = 0;
                }
             } else if (isScriptorium) {
                const effCraft = (progress > 0) ? getFacFlag("craftChoice") : storedCraftChoice;
                if (effCraft === "Spell Scroll") {
                    const opt = findOptionData(scrollItemOptions, effectiveScrollChoice);
                    if (opt) {
                        currentMaxCraftTurns = opt.time;
                        currentGoldCost = opt.price;
                    }
                }
            } else if (fac.name.includes("Laboratory")) {
                const effCraft = (progress > 0) ? getFacFlag("craftChoice") : storedCraftChoice;
                if (effCraft === "Alchemist's Supplies") {
                    const opt = findOptionData(labAlchemistOptions, effectiveLabAlchemistChoice);
                    if (opt) { currentMaxCraftTurns = opt.time; currentGoldCost = opt.price; }
                } else if (effCraft === "Poison") {
                    const opt = findOptionData(labPoisonOptions, effectiveLabPoisonChoice);
                    if (opt) { 
                        currentMaxCraftTurns = calculationMode === "days" ? BastionManager._getEffectiveDays(7) : 1;
                        currentGoldCost = opt.price; 
                    }
                }    
            } else if (isGreenhouse) {
                currentMaxCraftTurns = calculationMode === "days" ? BastionManager._getEffectiveDays(7) : 1;
            }

            // Build displayQueue for Logistics Panel
            let displayQueue = [];
            if (isCrafting && !isPausedProjectInQueue) {
                let activeLabel = craftChoice;
                if (isArcaneStudy) activeLabel = (craftChoice === "Magic Item (Arcana)") ? magicItemChoice : (craftChoice === "Arcane Focus" ? focusChoice : "Blank Book");
                if (progress > 0 && activeProjectChoice) activeLabel = activeProjectChoice;
                else if (isArcaneStudy) activeLabel = (craftChoice === "Magic Item (Arcana)") ? magicItemChoice : (craftChoice === "Arcane Focus" ? focusChoice : "Blank Book");
                else if (isWorkshop) activeLabel = workshopItemChoice;
                else if (isSanctuary) activeLabel = sacredFocusChoice;
                else if (isSacristy) activeLabel = (craftChoice === "Magic Item (Relic)") ? relicItemChoice : (craftChoice === "Holy Water" ? "Holy Water" : "");
                else if (fac.name.includes("Scriptorium")) activeLabel = (craftChoice === "Spell Scroll") ? scrollChoice : (craftChoice === "Book Replica" ? "Book Replica" : "Paperwork");
                else if (isGreenhouse) activeLabel = (craftChoice === "Poison") ? greenhousePoisonChoice : "Potion of Healing (Greater)";
                else if (fac.name.includes("Laboratory")) activeLabel = (craftChoice === "Poison") ? effectiveLabPoisonChoice : effectiveLabAlchemistChoice;

                displayQueue.push({
                    label: activeLabel || craftChoice,
                    actualIndex: -1,
                    currentProgress: progress,
                    progressPct: currentMaxCraftTurns > 0 ? Math.floor((progress / currentMaxCraftTurns) * 100) : 0
                });
            }
            displayQueue.push(...craftQueue);

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
            
            const stableTransferType = getFacFlag("stableTransferType") || "claim";
            const stableTransferChoice = getFacFlag("stableTransferChoice") || "";

            if (isStable) {
                if (stableTransferType === "claim") {
                    stableTransferOptions = stableAnimals.map((a, idx) => ({ value: idx, label: a.nickname ? `${a.nickname} (${a.species})` : a.species, selected: String(idx) === String(stableTransferChoice) }));
                } else {
                    stableTransferOptions = this.actor.items
                        .filter(i => {
                            if ((fac.potentialMountNames || []).includes(i.name)) return true;
                            if (i.system?.type?.value === "beast") return true;
                            const match = i.name.match(/^(.*) \((.*)\)$/);
                            return match && (fac.potentialMountNames || []).includes(match[2]);
                        })
                        .map(i => ({ value: i.id, label: i.name, selected: i.id === stableTransferChoice }));
                }
            }

            // Determine Enlargeability for UI
            const enlargeableSpecials = ["Archive", "Barrack", "Garden", "Pub", "Stable", "Workshop"];
            const isEnlargeableSpecial = enlargeableSpecials.some(sn => fac.name.includes(sn));
            const isEnlargeable = !fac.isInherited && ((isBasic && facSize !== "Vast") || (isEnlargeableSpecial && facSize === "Roomy"));
            
            // Layout Logic
            const maxSquares = facSize === "Vast" ? 36 : (facSize === "Cramped" ? 4 : 16);
            const placedSquares = Object.values(layoutData).filter(id => id === fac.id).length;
            const isLayoutActive = selectedId === fac.id;

            // --- Archive Specific State ---
            const isArchive = fac.name.includes("Archive");
            const archiveBooks = getFacFlag("archiveBooks") || [];
            const archiveBooksFolderId = "1gNhp4TlPZmeUuND";

            const archiveBooksList = archiveBooks.map(b => {
                const entry = outIndex.find(i => i.name === b && (i.folder?.id || i.folder) === archiveBooksFolderId);
                return { name: b, desc: entry?.system?.description?.value || "<i>Benefit unknown.</i>" };
            });

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
                isArchive: isArchive,
                archiveBooks: archiveBooks,
                archiveBooksList: archiveBooksList,
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
                isGreenhouse,
                isGreenhouseHarvesting,
                fruitUuid,
                greenhousePoisonChoice,
                greenhouseFruitCount: getFacFlag("fruitCount") ?? 3,
                showPoisonSelect: isGreenhouseHarvesting && (craftChoice === "Poison" || (isPausedProjectInQueue && firstQueueItem?.craftType === "Poison") || (progress > 0 && craftChoice === "Poison")),
                isLaboratory: fac.name.includes("Laboratory"),
                isLaboratoryCrafting,
                laboratoryPoisonChoice: effectiveLabPoisonChoice,
                laboratoryAlchemistChoice: effectiveLabAlchemistChoice,
                showLabPoisonSelect: isLaboratoryCrafting && (craftChoice === "Poison" || (isPausedProjectInQueue && firstQueueItem?.craftType === "Poison") || (progress > 0 && craftChoice === "Poison")),
                showLabAlchemistSelect: isLaboratoryCrafting && (craftChoice === "Alchemist's Supplies" || (isPausedProjectInQueue && firstQueueItem?.craftType === "Alchemist's Supplies") || (progress > 0 && craftChoice === "Alchemist's Supplies")),
                labPoisonOptions: labPoisonOptions,
                labAlchemistOptions: labAlchemistOptions,
                labPoisonUuid: labPoisonUuid,
                labAlchemistUuid: labAlchemistUuid,
                poisonOptions: (function() {
                    let opts = ["Assassin's Blood", "Malice", "Pale Tincture", "Truth Serum"].map(p => ({ value: p, selected: p === greenhousePoisonChoice }));
                    if (poisonsFolderId) {
                        const poisons = outIndex.filter(i => (i.folder?.id || i.folder) === poisonsFolderId);
                        if (poisons.length > 0) opts = poisons.map(p => ({ value: p.name, selected: p.name === greenhousePoisonChoice, uuid: p.uuid }));
                    }
                    return opts;
                })(),
                greenhousePoisonUuid: poisonsFolderId ? outIndex.find(i => i.name.toLowerCase() === greenhousePoisonChoice.toLowerCase() && (i.folder?.id || i.folder) === poisonsFolderId)?.uuid : null,
                greenhouseHealingHerbsUuid: healingFolderId ? outIndex.find(i => (i.name === "Potion of Healing (Greater)" || i.name === "Potion of Greater Healing") && (i.folder?.id || i.folder) === healingFolderId)?.uuid : null,
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
                displayQueue: displayQueue,
                armamentItemOptions: armamentItemOptions,
                armamentItemUuid: armamentItemUuid,
                maxCraftTurns: currentMaxCraftTurns,
                currentGoldCost: currentGoldCost,
                isGardenChangingType: isGardenChangingType,
                changeTypeOptions: changeTypeOptions,
                isOrderLocked: isOrderLocked,
                progress: progress,
                isWorkshopCrafting: isWorkshopCrafting,
                workshopTools: workshopTools,
                showWorkshopItemSelect: isWorkshopCrafting && (craftChoice === "Adventuring Gear" || craftChoice === "Magic Item (Implement)" || (isPausedProjectInQueue && (firstQueueItem.craftType === "Adventuring Gear" || firstQueueItem.craftType === "Magic Item (Implement)"))),
                workshopItemChoice: workshopItemChoice,
                workshopItemOptions: workshopItemOptions,
                isSacristyCrafting: isSacristyCrafting,
                showRelicItemSelect: isSacristyCrafting && (craftChoice === "Magic Item (Relic)" || (isPausedProjectInQueue && firstQueueItem.craftType === "Magic Item (Relic)")),
                relicItemChoice: relicItemChoice,
                relicItemOptions: relicItemOptions,
                isTrainingArea: fac.name.includes("Training Area"),
                trainerType: effectiveTrainerChoice,
                trainerTypeOptions: trainerTypeOptions,
                trainerTypeUuid: trainerTypeUuid,
                relicItemUuid: relicItemUuid,
                workshopItemUuid: workshopItemUuid,
                isStable: isStable,
                isArmory: fac.name.includes("Armory"),
                armoryStockCost: armoryStockCost,
                stockedCount: getFacFlag("stockedCount") || 0,
                isStocked: getFacFlag("isStocked") || false,
                isFullyStocked: (getFacFlag("isStocked") || false) && (getFacFlag("stockedCount") || 0) >= totalBastionDefenders,
                isStableTrade: isStableTrade,
                isTeleportationCircle,
                isTheater,
                isMeditationChamber,
                theaterPhase,
                theaterProgress,
                theaterProgressPct,
                theaterContributors,
                theaterAuthor,
                theaterRoster,
                isJoinedTheater,
                theaterPhaseColor,
                isWritingPhase,
                isActingPhase,
                theaterDieSize,
                visitingSpellcaster,
                spellcasterDaysRemaining,
                spellcasterDisplayTime,
                spellcasterTimeUnit,
                spellcasterName,
                maxSpellLevel,
                isSpellcasterPresent: visitingSpellcaster && spellcasterDaysRemaining > 0,
                stableTradeChoice: stableTradeChoice,
                stableItemChoice: effectiveStableItemChoice,
                stableItemOptions: stableItemOptions,
                stableAnimals: stableAnimals,
                stableAnimalsList: stableAnimals.map(a => a.nickname ? `${a.nickname} (${a.species})` : a.species).join(", "),
                stableTransferType,
                stableTransferOptions, // Options for the claim/store dropdowns
                stableUsedSlots, stableMaxSlots,
                isScriptoriumCrafting: isScriptoriumCrafting,
                showScrollItemSelect: isScriptoriumCrafting && (craftChoice === "Spell Scroll" || (isPausedProjectInQueue && firstQueueItem.craftType === "Spell Scroll")),
                scrollItemChoice: scrollChoice,
                scrollItemOptions: scrollItemOptions,
                scrollItemUuid: scrollItemUuid,
                bookTitle,
                paperworkTitle,
                paperworkQty,
                isDamaged,
                repairProgress,
                repairTurns,
                repairProgressPct: Math.round((Math.min(repairProgress, repairTurns) / (repairTurns || 1)) * 100),
                progressPct: Math.round((Math.min(progress, 3) / 3) * 100),
                isUnderConstruction: isUnderConstruction,
                constructionLabel: constructionLabel,
                upgradeProgress: upgradeProgress,
                upgradeTurns: upgradeTurns,
                upgradeProgressPct: Math.round((Math.min(upgradeProgress, upgradeTurns) / (upgradeTurns || 1)) * 100),
                isBasic: isBasic,
                isEnlargeable: isEnlargeable,
                isQueueCollapsed: this._queueStates[fac.id] || false,
                isOrderDisabled: fac.isInherited || isBuilding || isDamaged,
                isSelectionDisabled: fac.isInherited || isBuilding || isDamaged,
                showLogisticsHint: isCrafting && progress > 0,
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
                storedRelicItemChoice: storedRelicItemChoice,
                activeProjectChoice: activeProjectChoice,
                isContinuingProject: safeOrder === "Continue Project"
            };
        }));

        // Collect all unique Utilities from facilities
        const allUtilities = [];
        const utilitySources = new Map(); // utilName -> Set of facNames

        facilities.forEach(fac => {
            // Only populate utilities from finished facilities
            if (!fac || fac.isBuilding) return;

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

        const specialFacilitiesBuilt = facilities.filter(f => f && !f.isBasic);
        const basicFacilitiesBuilt = facilities.filter(f => f && f.isBasic);
        const isNewBastion = (this.actor.type === "character" || this.actor.type === "npc") && facilities.filter(f => f && !f.isInherited).length === 0;
        
        const allActiveQueues = facilities.filter(f => f.craftQueue?.length > 0);

        // Calculate Expected Outputs for Next Turn
        const expectedOutputs = [];
        for (const fac of facilities) {
            if (!fac || fac.isBuilding) continue;

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
            if ((isCraftOrder || fac.isPausedProjectInQueue || currentOrder === "Continue Project") && !fac.isUnderConstruction) {
                let outputLabel = "";
                let progressInfo = "";
                let color = "#2e7d32"; // Default color for active/queued
                let progressPct = null;
                
                if (fac.isPausedProjectInQueue) {
                    const pausedProject = fac.craftQueue[0];
                    outputLabel = pausedProject.label;
                    progressPct = pausedProject.progressPct || 0;
                    progressInfo = ` (${progressPct}% Complete)`;
                    color = "#666"; // Paused color (grey)
                } else if (currentOrder === "Continue Project" && fac.activeProjectChoice) {
                    outputLabel = fac.activeProjectChoice;
                    if (fac.maxCraftTurns >= 1) {
                        progressPct = Math.floor((fac.progress / fac.maxCraftTurns) * 100);
                        const remaining = Math.max(1, fac.maxCraftTurns - fac.progress);
                        progressInfo = ` (${remaining}${fac.progressLabel} until completion)`;
                    }
                } else if (fac.craftChoice) { // Active crafting project
                    const effectiveCraftChoice = fac.craftChoice; // Use current active craft choice
                    if (fac.name.includes("Arcane Study")) {
                        if (effectiveCraftChoice === "Magic Item (Arcana)") {
                            outputLabel = fac.magicItemChoice;
                        } else {
                            outputLabel = effectiveCraftChoice === "Arcane Focus" ? fac.focusChoice : "Blank Book";
                        }
                    } else if (fac.name.includes("Scriptorium")) {
                        outputLabel = (effectiveCraftChoice === "Spell Scroll") ? fac.scrollChoice : (effectiveCraftChoice === "Book Replica" ? "Book Replica" : "Paperwork");
                    } else if (fac.name.includes("Sacristy")) {
                        outputLabel = (effectiveCraftChoice === "Magic Item (Relic)") ? fac.relicItemChoice : "Holy Water";
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

                        if (fac.maxCraftTurns >= 1 && fac.progressPct !== null) {
                        progressPct = Math.floor((fac.progress / fac.maxCraftTurns) * 100);
                        const remaining = Math.max(1, fac.maxCraftTurns - fac.progress);
                        progressInfo = ` (${remaining}${fac.progressLabel} until completion)`;
                    }
                } else if (fac.craftQueue.length > 0) {
                    const next = fac.craftQueue[0];
                    outputLabel = next.choice || next.craftType;
                    
                    // If first item in queue hasn't started, it's just "Queued"
                    progressInfo = " (Next in Queue)";
                    progressPct = 0;
                }

                if (outputLabel) {
                    expectedOutputs.push({ facName: fac.name, label: outputLabel, progressInfo, color, progressPct });
                }
            }
            
            // Recruitment logic
            if (fac.itemName === "Barrack" && fac.showOrderDropdown && fac.orderOptions.find(o => o.selected)?.value === "Recruit") {
                expectedOutputs.push({ facName: fac.name, label: "New Defenders (1d4)" });
            }

            // Stable Trade Horizon logic
            if (fac.isStableTrade) {
                const tType = fac.stableTradeChoice === "buy" ? "Buying" : "Selling";
                const mName = fac.stableItemChoice;
                if (mName) {
                    expectedOutputs.push({ 
                        facName: fac.name, 
                        label: `${tType}: ${mName}`, 
                        progressInfo: " (Will complete next turn)",
                        color: fac.stableTradeChoice === "buy" ? "#a32a22" : "#2e7d32",
                        progressPct: null
                    });
                }
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

            if (fac.itemName === "Training Area" && currentOrder === "Empower") {
                expectedOutputs.push({ facName: fac.name, label: `Training: ${fac.trainerType || "Expert Trainer"}`, color: "#4a86e8" });
            }
        }

        // Persist section states
        if (this._sectionStates === undefined) this._sectionStates = { special: true, basic: true };
        
        const unify = game.settings.get(MODULE_ID, "unifyCombinedTurns");
        const displayTurnCount = (unify && combinedGroup) ? (combinedGroup.getFlag(MODULE_ID, "turnCount") || 0) : actorTurnCount;

        this.context = { 
            actor: this.actor, turnCount: displayTurnCount, 
            advanceMode: this._advanceMode || "global",
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
            totalWallSquaresAllowed, placedWallSquares, structIds: STRUCT_IDS, readyCount, totalBastions, isReady,
            gridBackground, selectedOpening: this._selectedOpeningType || "Door", neglectWarning, neglectColor, neglectCounter, actorLevel,
            sectionStates: this._sectionStates,
            innerPeaceActive, fortifiedSaves
        };
        return this.context;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const MODULE_ID = "dnd-2024-bastion-manager";

        // Restore scroll position
        const sidebar = this.element.querySelector('.bastion-sidebar');
        if (sidebar && this._scrollTop !== undefined) sidebar.scrollTop = this._scrollTop;

        // Queue Drag & Drop Listeners
        const queueItems = this.element.querySelectorAll('.draggable-queue-item');
        queueItems.forEach(li => {
            li.addEventListener('dragstart', (ev) => {
                ev.dataTransfer.setData('text/plain', JSON.stringify({
                    index: parseInt(li.dataset.index),
                    itemId: li.dataset.itemId,
                    isFlag: li.dataset.isFlag,
                    memberId: li.dataset.memberId,
                    isInherited: li.dataset.isInherited
                }));
                li.style.opacity = "0.4";
            });
            li.addEventListener('dragend', () => li.style.opacity = "1");
            li.addEventListener('dragover', (ev) => ev.preventDefault());
            li.addEventListener('drop', async (ev) => {
                ev.preventDefault();
                const data = JSON.parse(ev.dataTransfer.getData('text/plain'));
                const targetIndex = parseInt(li.dataset.index);
                
                // Only move if it's the same facility and different index
                if (data.itemId === li.dataset.itemId && data.index !== targetIndex) {
                    const direction = targetIndex - data.index;
                    // Re-use existing move logic
                    const targetMock = { dataset: { ...data, direction: direction } };
                    await BastionManager.onMoveQueueItem.call(this, ev, targetMock);
                }
            });
            li.addEventListener('contextmenu', async (ev) => {
                ev.preventDefault();
                const targetMock = { dataset: li.dataset };
                await BastionManager.onPromoteToActive.call(this, ev, targetMock);
            });
        });

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

        // Training Area Listeners
        this.element.querySelectorAll('.training-trainer-select').forEach(select => {
            select.addEventListener('change', async (ev) => {
                const ds = ev.target.dataset;
                if (ds.isFlag === "true") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = gf.find(f => f._id === ds.itemId);
                    if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.trainerType`, ev.target.value);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    await this.actor.items.get(ds.itemId)?.setFlag(MODULE_ID, "trainerType", ev.target.value);
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

                if (val === "Continue Project") return; // No action needed if "Continue Project" is selected, it's a display state

                const facContext = this.context?.facilities?.find(f => f.id === ds.itemId);
                let pauseUpdates = {};
                
                // Auto-Pause Logic: If changing order while progress exists
                if (facContext && facContext.progress > 0 && facContext.safeOrder !== val) {
                    const pausedProject = {
                        craftType: facContext.craftChoice,
                        choice: facContext.activeProjectChoice || facContext.magicItemChoice || facContext.focusChoice || facContext.sacredFocusChoice || facContext.smithyItemChoice || facContext.armamentItemChoice || facContext.workshopItemChoice || facContext.relicItemChoice || facContext.scrollChoice || facContext.greenhousePoisonChoice || "Blank Book",
                        label: facContext.activeProjectChoice || facContext.magicItemChoice || facContext.focusChoice || facContext.sacredFocusChoice || facContext.smithyItemChoice || facContext.armamentItemChoice || facContext.workshopItemChoice || facContext.relicItemChoice || facContext.scrollChoice || facContext.greenhousePoisonChoice || "Blank Book",
                        goldCost: facContext.currentGoldCost || 0,
                        timeCost: facContext.maxCraftTurns || 1,
                        currentProgress: facContext.progress || 0,
                        isPausedProject: true
                    };
                    const currentQueue = Array.from(facContext.craftQueue || []);
                    currentQueue.unshift(pausedProject);
                    pauseUpdates = {
                        [`flags.${MODULE_ID}.progress`]: 0,
                        [`flags.${MODULE_ID}.activeProjectChoice`]: "",
                        [`flags.${MODULE_ID}.craftChoice`]: "",
                        [`flags.${MODULE_ID}.craftQueue`]: currentQueue
                    };
                    ui.notifications.info(`Paused <b>${pausedProject.label}</b>.`);
                }

                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); const item = member?.items.get(ds.itemId);
                    if (item) {
                        const updates = { ...pauseUpdates, [`flags.${MODULE_ID}.order`]: newOrder, [`flags.${MODULE_ID}.craftChoice`]: craftChoice };
                        await item.update(updates);
                    }
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        foundry.utils.setProperty(fac, `flags.${MODULE_ID}.order`, newOrder);
                        if (craftChoice) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.craftChoice`, craftChoice);
                        else foundry.utils.setProperty(fac, `flags.${MODULE_ID}.craftChoice`, ""); // Clear if not a specific craft
                        for (let [k, v] of Object.entries(pauseUpdates)) foundry.utils.setProperty(fac, k, v);
                        await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) {
                        const updates = { ...pauseUpdates, [`flags.${MODULE_ID}.order`]: newOrder, [`flags.${MODULE_ID}.craftChoice`]: craftChoice };
                        await item.update(updates);
                    }
                }
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

        // Scriptorium Input Listeners
        this.element.querySelectorAll('.scriptorium-book-title').forEach(input => {
            input.addEventListener('change', async (ev) => {
                const ds = ev.target.dataset;
                if (ds.isFlag === "true") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = gf.find(f => f._id === ds.itemId);
                    if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.bookTitle`, ev.target.value);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    await this.actor.items.get(ds.itemId)?.setFlag(MODULE_ID, "bookTitle", ev.target.value);
                }
            });
        });

        this.element.querySelectorAll('.scriptorium-paperwork-title').forEach(input => {
            input.addEventListener('change', async (ev) => {
                const ds = ev.target.dataset;
                if (ds.isFlag === "true") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = gf.find(f => f._id === ds.itemId);
                    if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.paperworkTitle`, ev.target.value);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    await this.actor.items.get(ds.itemId)?.setFlag(MODULE_ID, "paperworkTitle", ev.target.value);
                }
            });
        });

        this.element.querySelectorAll('.scriptorium-paperwork-qty').forEach(input => {
            input.addEventListener('change', async (ev) => {
                const ds = ev.target.dataset;
                const val = Math.clamp(parseInt(ev.target.value) || 1, 1, 50);
                if (ds.isFlag === "true") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = gf.find(f => f._id === ds.itemId);
                    if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.paperworkQty`, val);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    await this.actor.items.get(ds.itemId)?.setFlag(MODULE_ID, "paperworkQty", val);
                }
            });
        });

        // Stable Listeners
        this.element.querySelectorAll('.stable-trade-choice').forEach(select => {
            select.addEventListener('change', async (ev) => {
                const ds = ev.target.dataset;
                if (ds.isFlag === "true") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = gf.find(f => f._id === ds.itemId);
                    if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.stableTradeChoice`, ev.target.value);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    await this.actor.items.get(ds.itemId)?.setFlag(MODULE_ID, "stableTradeChoice", ev.target.value);
                }
                this.render();
            });
        });

        this.element.querySelectorAll('.stable-item-select').forEach(select => {
            select.addEventListener('change', async (ev) => {
                const ds = ev.target.dataset;
                if (ds.isFlag === "true") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = gf.find(f => f._id === ds.itemId);
                    if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.stableItemChoice`, ev.target.value);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    await this.actor.items.get(ds.itemId)?.setFlag(MODULE_ID, "stableItemChoice", ev.target.value);
                }
            });
        });

        this.element.querySelectorAll('.stable-transfer-type').forEach(select => {
            select.addEventListener('change', async (ev) => {
                const ds = ev.target.dataset;
                if (ds.isFlag === "true") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = gf.find(f => f._id === ds.itemId);
                    if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.stableTransferType`, ev.target.value);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    await this.actor.items.get(ds.itemId)?.setFlag(MODULE_ID, "stableTransferType", ev.target.value);
                }
                this.render();
            });
        });

        this.element.querySelectorAll('.stable-transfer-choice-select').forEach(select => {
            select.addEventListener('change', async (ev) => {
                const ds = ev.target.dataset;
                if (ds.isFlag === "true") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = gf.find(f => f._id === ds.itemId);
                    if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.stableTransferChoice`, ev.target.value);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    await this.actor.items.get(ds.itemId)?.setFlag(MODULE_ID, "stableTransferChoice", ev.target.value);
                }
            });
        });

        this.element.querySelectorAll('.laboratory-poison-select').forEach(select => {
            select.addEventListener('change', async (ev) => {
                const ds = ev.target.dataset;
                const val = ev.target.value;
                if (ds.isFlag === "true") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = gf.find(f => f._id === ds.itemId);
                    if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.laboratoryPoisonChoice`, val);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "laboratoryPoisonChoice", val);
                }
                this.render();
            });
        });

        this.element.querySelectorAll('.laboratory-alchemist-select').forEach(select => {
            select.addEventListener('change', async (ev) => {
                const ds = ev.target.dataset;
                const val = ev.target.value;
                if (ds.isFlag === "true") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = gf.find(f => f._id === ds.itemId);
                    if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.laboratoryAlchemistChoice`, val);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "laboratoryAlchemistChoice", val);
                }
                this.render();
            });
        });

        this.element.querySelectorAll('.greenhouse-poison-select').forEach(select => {
            select.addEventListener('change', async (ev) => {
                const ds = ev.target.dataset;
                const val = ev.target.value;
                if (ds.isFlag === "true") {
                    const gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = gf.find(f => f._id === ds.itemId);
                    if (fac) foundry.utils.setProperty(fac, `flags.${MODULE_ID}.greenhousePoisonChoice`, val);
                    await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "greenhousePoisonChoice", val);
                }
                this.render();
            });
        });

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

        const relicItemSelects = this.element.querySelectorAll('.sacristy-relic-select');
        for (const select of relicItemSelects) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newChoice = event.target.value;
                const MODULE_ID = "dnd-2024-bastion-manager";
                
                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); 
                    const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "relicItemChoice", newChoice);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        foundry.utils.setProperty(fac, `flags.${MODULE_ID}.relicItemChoice`, newChoice);
                        // Only update if the flag array is actually modified
                        const currentChoice = foundry.utils.getProperty(fac, `flags.${MODULE_ID}.relicItemChoice`);
                        if (currentChoice !== newChoice) await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "relicItemChoice", newChoice);
                }
                this.render();
            });
        }

        const scrollSelects = this.element.querySelectorAll('.scriptorium-scroll-select');
        for (const select of scrollSelects) {
            select.addEventListener('change', async (event) => {
                const ds = event.target.dataset;
                const newChoice = event.target.value;
                const MODULE_ID = "dnd-2024-bastion-manager";
                
                if (ds.isInherited === "true") {
                    const member = game.actors.get(ds.memberId); 
                    const item = member?.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "scrollChoice", newChoice);
                } else if (ds.isFlag === "true") {
                    const groupFacilities = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
                    const fac = groupFacilities.find(f => f._id === ds.itemId);
                    if (fac) {
                        foundry.utils.setProperty(fac, `flags.${MODULE_ID}.scrollChoice`, newChoice);
                        // Only update if the flag array is actually modified
                        const currentChoice = foundry.utils.getProperty(fac, `flags.${MODULE_ID}.scrollChoice`);
                        if (currentChoice !== newChoice) await this.actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                    }
                } else {
                    const item = this.actor.items.get(ds.itemId);
                    if (item) await item.setFlag(MODULE_ID, "scrollChoice", newChoice);
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

    static async onToggleMeditation(event, target) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const actor = this.actor;
        
        const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
        if (!outPack) return ui.notifications.error("Meditation Chamber error: Output compendium missing.");

        const folderId = "MHEBG1MAdvgjzJk1";
        const index = await outPack.getIndex({ fields: ["folder"] });
        const folderItems = index.filter(i => (i.folder?.id || i.folder) === folderId);

        if (folderItems.length < 2) {
            return ui.notifications.error("The Meditation Chamber benefits folder is missing or incomplete in the compendium.");
        }

        // Clean up any existing meditation rewards first
        const existingIds = actor.getFlag(MODULE_ID, "activeMeditationItems") || [];
        if (existingIds.length > 0) {
            const toDelete = actor.items.filter(i => existingIds.includes(i.id)).map(i => i.id);
            if (toDelete.length > 0) await actor.deleteEmbeddedDocuments("Item", toDelete);
        }

        // Randomly pick 2 unique benefits
        const shuffled = [...folderItems].sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, 2);

        const toCreate = [];
        for (const s of selected) {
            const doc = await outPack.getDocument(s._id);
            const itemData = doc.toObject();
            toCreate.push(itemData);
        }

        const createdItems = await actor.createEmbeddedDocuments("Item", toCreate);
        const newIds = createdItems.map(i => i.id);
        const saveNames = createdItems.map(i => i.name.replace("Meditation: ", "").replace(" Save", ""));

        await actor.setFlag(MODULE_ID, "activeMeditationItems", newIds);
        await actor.setFlag(MODULE_ID, "fortifiedSaves", saveNames);

        ui.notifications.info(`${actor.name} has finished a week of meditation and gained inner focus: ${saveNames.join(" and ")}.`);
        this.render();
    }

    static async onPromoteToActive(event, target) {
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

        const facContext = this.context?.facilities?.find(f => f.id === itemId);
        let queue = Array.from((isFlag ? foundry.utils.getProperty(fac, `flags.${MODULE_ID}.craftQueue`) : fac.getFlag(MODULE_ID, "craftQueue")) || []);
        if (index < 0 || index >= queue.length) return;

        const promotedItem = queue[index];
        let pausedProject = null;

        // Capture current active project to swap it into the queue
        if (facContext && facContext.craftChoice) {
            pausedProject = {
                craftType: facContext.craftChoice,
                choice: facContext.activeProjectChoice || facContext.magicItemChoice || facContext.focusChoice || facContext.sacredFocusChoice || facContext.smithyItemChoice || facContext.armamentItemChoice || facContext.workshopItemChoice || facContext.relicItemChoice || facContext.scrollChoice || facContext.greenhousePoisonChoice || "Blank Book",
                label: facContext.activeProjectChoice || facContext.magicItemChoice || facContext.focusChoice || facContext.sacredFocusChoice || facContext.smithyItemChoice || facContext.armamentItemChoice || facContext.workshopItemChoice || facContext.relicItemChoice || facContext.scrollChoice || facContext.greenhousePoisonChoice || "Blank Book",
                goldCost: facContext.currentGoldCost || 0,
                timeCost: facContext.maxCraftTurns || 1,
                currentProgress: facContext.progress || 0,
                isPausedProject: facContext.progress > 0
            };
        }

        if (pausedProject) queue[index] = pausedProject;
        else queue.splice(index, 1);

        const updates = {
            [`flags.${MODULE_ID}.order`]: "Craft",
            [`flags.${MODULE_ID}.craftChoice`]: promotedItem.craftType,
            [`flags.${MODULE_ID}.progress`]: promotedItem.currentProgress || 0,
            [`flags.${MODULE_ID}.activeProjectChoice`]: promotedItem.choice || promotedItem.label,
            [`flags.${MODULE_ID}.craftQueue`]: queue,
            // Clear all possible sub-choices first
            [`flags.${MODULE_ID}.focusChoice`]: "", [`flags.${MODULE_ID}.magicItemChoice`]: "", [`flags.${MODULE_ID}.sacredFocusChoice`]: "", [`flags.${MODULE_ID}.relicItemChoice`]: "", [`flags.${MODULE_ID}.scrollChoice`]: "",
            [`flags.${MODULE_ID}.smithyItemChoice`]: "", [`flags.${MODULE_ID}.armamentItemChoice`]: "", [`flags.${MODULE_ID}.workshopItemChoice`]: "", [`flags.${MODULE_ID}.greenhousePoisonChoice`]: "",
            [`flags.${MODULE_ID}.laboratoryAlchemistChoice`]: "", [`flags.${MODULE_ID}.laboratoryPoisonChoice`]: ""
        };
            // Added scrollChoice
            
        // Map the item's choice back to the facility's specific selection flag
        const choiceMap = { "Arcane Focus": "focusChoice", "Magic Item (Arcana)": "magicItemChoice", "Druidic Focus": "sacredFocusChoice", "Holy Symbol": "sacredFocusChoice", "Smith's Tools": "smithyItemChoice", "Magic Item (Armament)": "armamentItemChoice", "Adventuring Gear": "workshopItemChoice", "Magic Item (Implement)": "workshopItemChoice", "Magic Item (Relic)": "relicItemChoice", "Spell Scroll": "scrollChoice", "Poison": facContext.name.includes("Laboratory") ? "laboratoryPoisonChoice" : "greenhousePoisonChoice", "Alchemist's Supplies": "laboratoryAlchemistChoice" };
        if (choiceMap[promotedItem.craftType]) updates[`flags.${MODULE_ID}.${choiceMap[promotedItem.craftType]}`] = promotedItem.choice;

        if (isFlag) {
            const gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
            const gfFac = gf.find(f => f._id === itemId);
            if (gfFac) {
                for (let [k, v] of Object.entries(updates)) foundry.utils.setProperty(gfFac, k, v);
                await actor.setFlag(MODULE_ID, "groupFacilities", gf);
            }
        } else {
            const item = actor.items.get(itemId);
            if (item) await item.update(updates);
        }
        ui.notifications.info(`Swapped active project with <b>${promotedItem.label}</b>.`);
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
                choice: fac.activeProjectChoice || fac.magicItemChoice || fac.focusChoice || fac.sacredFocusChoice || fac.smithyItemChoice || fac.armamentItemChoice || fac.workshopItemChoice || fac.relicItemChoice || fac.scrollChoice || fac.greenhousePoisonChoice || "Blank Book",
                label: fac.activeProjectChoice || fac.magicItemChoice || fac.focusChoice || fac.sacredFocusChoice || fac.smithyItemChoice || fac.armamentItemChoice || fac.workshopItemChoice || fac.relicItemChoice || fac.scrollChoice || fac.greenhousePoisonChoice || "Blank Book",
                goldCost: fac.currentGoldCost || 0,
                timeCost: fac.maxCraftTurns || 1,
                currentProgress: fac.progress,
                isPausedProject: true
            };

            const currentQueue = Array.from(fac.craftQueue || []);
            currentQueue.unshift(pausedProject);

            const resetFlags = {
                [`flags.${MODULE_ID}.progress`]: 0,
                [`flags.${MODULE_ID}.activeProjectChoice`]: "",
                [`flags.${MODULE_ID}.craftChoice`]: "",
                [`flags.${MODULE_ID}.focusChoice`]: "",
                [`flags.${MODULE_ID}.magicItemChoice`]: "",
                [`flags.${MODULE_ID}.sacredFocusChoice`]: "",
                [`flags.${MODULE_ID}.smithyItemChoice`]: "",
                [`flags.${MODULE_ID}.armamentItemChoice`]: "",
                [`flags.${MODULE_ID}.workshopItemChoice`]: "",
                [`flags.${MODULE_ID}.relicItemChoice`]: "",
                [`flags.${MODULE_ID}.scrollChoice`]: "",
                [`flags.${MODULE_ID}.greenhousePoisonChoice`]: "",
                [`flags.${MODULE_ID}.laboratoryAlchemistChoice`]: "",
                [`flags.${MODULE_ID}.laboratoryPoisonChoice`]: "",
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

    static async onViewGraveyard(event, target) {
        const graveyard = this.actor.getFlag("dnd-2024-bastion-manager", "graveyard") || [];
        if (graveyard.length === 0) return ui.notifications.info("The Memorial Wall is empty. No defenders have perished... yet.");

        let list = graveyard.map(d => `<li style="margin-bottom: 4px; border-bottom: 1px solid rgba(0,0,0,0.1); padding-bottom: 2px;"><b>${d.name}</b> <span style="font-size: 0.85em; color: #666; font-style: italic;">(Turn ${d.turn}, ${d.date})</span></li>`).reverse().join("");
        
        await DialogV2.prompt({
            window: { title: "Memorial Wall", icon: "fa-solid fa-tombstone" },
            content: `
                <div style="max-height: 400px; overflow-y: auto; padding: 5px;">
                    <p style="margin-bottom: 10px; border-bottom: 1px solid #444; padding-bottom: 5px;">In honor of those who gave their lives in service of <b>${this.actor.name}'s</b> Bastion:</p>
                    <ul style="list-style: none; padding-left: 0;">${list}</ul>
                </div>`,
            ok: { label: "Honor their memory" }
        });
    }

    static async onRenameStableAnimal(event, target) {
        const ds = target.dataset;
        const idx = parseInt(ds.index);
        const MODULE_ID = "dnd-2024-bastion-manager";

        let gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
        let fac = ds.isFlag === "true" ? gf.find(f => f._id === ds.itemId) : this.actor.items.get(ds.itemId);
        if (!fac) return;

        let animals = Array.from((ds.isFlag === "true" ? fac.flags?.[MODULE_ID]?.stableAnimals : fac.getFlag(MODULE_ID, "stableAnimals")) || []);
        if (!animals[idx]) return;

        const current = typeof animals[idx] === "string" ? { species: animals[idx], nickname: "" } : animals[idx];
        
        const newName = await DialogV2.prompt({
            window: { title: `Name your ${current.species}` },
            content: `<div class="form-group"><label>Nickname:</label><input type="text" name="name" value="${current.nickname}" placeholder="Enter name..." autofocus></div>`,
            ok: { label: "Save Name", callback: (event, button) => button.form.elements.name.value.trim() },
            rejectClose: false
        });

        // Strictly check for a string result. Cancel resolution returns null.
        if (typeof newName === "string") {
            animals[idx] = { species: current.species, nickname: newName };
            if (ds.isFlag === "true") {
                foundry.utils.setProperty(fac, `flags.${MODULE_ID}.stableAnimals`, animals);
                await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
            } else {
                await fac.setFlag(MODULE_ID, "stableAnimals", animals);
            }
            this.render();
        }
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
        const qtyInput = target.parentElement?.querySelector('.queue-qty');
        const quantity = Math.max(1, parseInt(qtyInput?.value) || 1);
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

        const getFlag = (key) => isFlag ? (fac.flags?.[MODULE_ID]?.[key]) : fac.getFlag(MODULE_ID, key);
        
        // Robust Choice Detection: Check flags first, then check the UI dropdown value as fallback
        let craftChoice = getFlag("craftChoice");
        if (!craftChoice) {
            const select = this.element.querySelector(`.facility-order-select[data-item-id="${itemId}"]`);
            if (select?.value.includes(": ")) craftChoice = select.value.split(": ")[1];
        }

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
             } else if (name.includes("Scriptorium")) {
                if (craftChoice === "Spell Scroll") choice = getFlag("scrollChoice");
                else if (craftChoice === "Book Replica") choice = getFlag("bookTitle");
                else if (craftChoice === "Paperwork") choice = getFlag("paperworkTitle");
            } else if (name.includes("Stable")) {
            choice = getFlag("stableItemChoice");
        } else if (name.includes("Greenhouse")) {
            if (craftChoice === "Poison") choice = getFlag("greenhousePoisonChoice");
            else choice = "Potion of Healing (Greater)";
        } else if (name.includes("Sanctuary")) {
            choice = getFlag("sacredFocusChoice");
        } else if (name.includes("Laboratory")) {
            if (craftChoice === "Poison") choice = getFlag("laboratoryPoisonChoice"); else choice = getFlag("laboratoryAlchemistChoice");
        }

        if (!choice && !["Smith's Tools", "Book"].includes(craftChoice)) {
            return ui.notifications.warn(`Select a specific ${craftChoice} type before adding to queue.`);
        }

        // Calculate costs for queue items
        let goldCost = 0;
        let timeCost = 0;
        let qty = 1;
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
                
                const isMagicItem = ["Magic Item (Arcana)", "Magic Item (Armament)", "Magic Item (Implement)", "Magic Item (Relic)"].includes(craftChoice);
                
                let days;
                if (fac.name.includes("Laboratory")) {
                    if (craftChoice === "Poison") {
                        days = BastionManager._getEffectiveDays(7);
                    } else {
                        days = Math.max(1, Math.ceil(price / 10));
                    }
                    goldCost = Math.floor(price / 2);
                } else if (choice.toLowerCase().includes("spell scroll")) {
                    const reqs = BastionManager._getScrollRequirements(choice);
                    days = reqs.days;
                    goldCost = reqs.gp;
                } else if (isMagicItem) {
                    const reqs = BastionManager._getMagicItemRequirements(rarity);
                    days = reqs.days;
                    goldCost = reqs.gp;
                } else {
                    days = Math.max(1, Math.ceil(price / 10));
                    goldCost = Math.floor(price / 2);
                }
                timeCost = calculationMode === "days" ? days : Math.ceil(days / daysPerTurn);
            } else if (craftChoice === "Book") {
                goldCost = 10;
                timeCost = calculationMode === "days" ? 7 : 1;
            } else if (craftChoice === "Adventuring Gear") {
                goldCost = 0; // Fallback if entry missing
                timeCost = calculationMode === "days" ? 7 : 1;
            } else if (["Arcane Focus", "Druidic Focus", "Holy Symbol"].includes(craftChoice)) {
                goldCost = 0;
                timeCost = calculationMode === "days" ? 7 : 1;
            } else if (craftChoice === "Book Replica") {
                goldCost = 0; // "costs no money"
                timeCost = calculationMode === "days" ? 7 : 1;
            } else if (craftChoice === "Paperwork") {
                qty = getFlag("paperworkQty") || 50;
                goldCost = qty; // 1 GP per copy
                timeCost = calculationMode === "days" ? 7 : 1;
            }
        }

        const label = choice || craftChoice;
        
        let queue = Array.from(getFlag("craftQueue") || []);
        for (let i = 0; i < quantity; i++) {
            queue.push({ craftType: craftChoice, choice: choice, label: label, goldCost, timeCost, qty });
        }

        if (isFlag) {
            foundry.utils.setProperty(fac, `flags.${MODULE_ID}.craftQueue`, queue);
            foundry.utils.setProperty(fac, `flags.${MODULE_ID}.order`, "Progress Queue");
            await actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
        } else {
            await fac.update({
                [`flags.${MODULE_ID}.craftQueue`]: queue,
                [`flags.${MODULE_ID}.order`]: "Progress Queue"
            });
        }

        if (qtyInput) qtyInput.value = 1;

                this._changingOrders.delete(ds.itemId);
        ui.notifications.info(`Added ${label} to queue.`);
        this.render();
    }

    static async onDeleteQueueItem(event, target) {
        const ds = target.dataset;
        const index = parseInt(ds.index);
        const itemId = ds.itemId;
        const isFlag = ds.isFlag === "true";
        const isInherited = ds.isInherited === "true";
        const memberId = ds.memberId;
        const MODULE_ID = "dnd-2024-bastion-manager";

        let actor = this.actor;
        if (isInherited && memberId) actor = game.actors.get(memberId) || this.actor;

        if (index === -1) {
            const updates = {
                [`flags.${MODULE_ID}.progress`]: 0,
                [`flags.${MODULE_ID}.craftChoice`]: "",
                [`flags.${MODULE_ID}.order`]: "Maintain",
                [`flags.${MODULE_ID}.focusChoice`]: "", [`flags.${MODULE_ID}.magicItemChoice`]: "",
                [`flags.${MODULE_ID}.sacredFocusChoice`]: "", [`flags.${MODULE_ID}.smithyItemChoice`]: "",
                [`flags.${MODULE_ID}.armamentItemChoice`]: "", [`flags.${MODULE_ID}.workshopItemChoice`]: "",
                [`flags.${MODULE_ID}.relicItemChoice`]: "", [`flags.${MODULE_ID}.scrollChoice`]: "", [`flags.${MODULE_ID}.greenhousePoisonChoice`]: "",
                [`flags.${MODULE_ID}.bookTitle`]: "", [`flags.${MODULE_ID}.paperworkTitle`]: "", [`flags.${MODULE_ID}.paperworkQty`]: 50,
                [`flags.${MODULE_ID}.laboratoryAlchemistChoice`]: "", [`flags.${MODULE_ID}.laboratoryPoisonChoice`]: ""
            }; // Added scrollChoice

            if (isFlag) {
                const groupFacilities = actor.getFlag(MODULE_ID, "groupFacilities") || [];
                const fac = groupFacilities.find(f => f._id === itemId);
                if (fac) {
                    for (let [k,v] of Object.entries(updates)) foundry.utils.setProperty(fac, k, v);
                    await actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
                }
            } else {
                const item = actor.items.get(itemId);
                if (item) await item.update(updates);
            }
            ui.notifications.info("Cancelled active project.");
            this.render();
            return;
        }

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

    static async onMoveQueueItem(event, target) {
        const ds = target.dataset;
        const index = parseInt(ds.index);
        const direction = parseInt(ds.direction);
        const itemId = ds.itemId;
        const isFlag = ds.isFlag === "true";
        const isInherited = ds.isInherited === "true";
        const qtyInput = target.parentElement?.querySelector('.queue-qty');
        const quantity = Math.max(1, parseInt(qtyInput?.value) || 1);
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
        
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= queue.length) return;

        const item = queue.splice(index, 1)[0];
        queue.splice(newIndex, 0, item);

        if (isFlag) {
            foundry.utils.setProperty(fac, `flags.${MODULE_ID}.craftQueue`, queue);
            await actor.setFlag(MODULE_ID, "groupFacilities", groupFacilities);
        } else {
            await fac.setFlag(MODULE_ID, "craftQueue", queue);
        }
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

    static async onInstantTransferAnimal(event, target) {
        const ds = target.dataset;
        const MODULE_ID = "dnd-2024-bastion-manager";
        const type = (ds.isFlag === "true") ? (this.actor.getFlag(MODULE_ID, "groupFacilities")?.find(f => f._id === ds.itemId)?.flags?.[MODULE_ID]?.stableTransferType || "claim") : (this.actor.items.get(ds.itemId)?.getFlag(MODULE_ID, "stableTransferType") || "claim");
        const choice = (ds.isFlag === "true") ? (this.actor.getFlag(MODULE_ID, "groupFacilities")?.find(f => f._id === ds.itemId)?.flags?.[MODULE_ID]?.stableTransferChoice || "") : (this.actor.items.get(ds.itemId)?.getFlag(MODULE_ID, "stableTransferChoice") || "");

        if (choice === "" || choice === null) return ui.notifications.warn("Select an animal first.");

        let gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
        let fac = ds.isFlag === "true" ? gf.find(f => f._id === ds.itemId) : this.actor.items.get(ds.itemId);
        let animals = Array.from((ds.isFlag === "true" ? fac.flags?.[MODULE_ID]?.stableAnimals : fac.getFlag(MODULE_ID, "stableAnimals")) || []);
        // Migration
        animals = animals.map(a => typeof a === "string" ? { species: a, nickname: "" } : a);

        if (type === "claim") {
            const idx = parseInt(choice);
            if (isNaN(idx) || !animals[idx]) return;
            
            const animalData = animals[idx];
            const speciesName = animalData.species;
            
            const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
            const entry = (await outPack.getIndex()).find(e => e.name === speciesName);
            if (entry) {
                const doc = await outPack.getDocument(entry._id);
                const itemData = doc.toObject();
                
                // If the animal has a nickname, set the item name to "Nickname (Species)"
                if (animalData.nickname) itemData.name = `${animalData.nickname} (${speciesName})`;
                
                await this.actor.createEmbeddedDocuments("Item", [itemData]);
                animals.splice(idx, 1);
                ui.notifications.info(`Claimed <b>${animalData.nickname || speciesName}</b> from the Stable.`);
            }
        } else {
            const invItem = this.actor.items.get(choice);
            if (!invItem) return;
            let species = invItem.name;
            let nickname = "";

            // Try to extract nickname and species if the item follows the "Name (Species)" format
            const nameMatch = invItem.name.match(/^(.*) \((.*)\)$/);
            if (nameMatch) {
                nickname = nameMatch[1];
                species = nameMatch[2];
            }
            
            // Check Slots
            const facSize = (ds.isFlag === "true" ? fac.flags?.[MODULE_ID]?.size : fac.getFlag(MODULE_ID, "size")) || "Roomy";
            const max = facSize === "Vast" ? 6 : 3;
            const currentUsed = this.context.facilities.find(f => f.id === ds.itemId).stableUsedSlots;
            const cost = BastionManager._getMountSlotCost(await BastionManager._extractSize(invItem));
            
            if (currentUsed + cost > max) return ui.notifications.error(`Stable is too full to store ${invItem.name}.`);

            if ((invItem.system.quantity || 1) > 1) await invItem.update({"system.quantity": invItem.system.quantity - 1});
            else await invItem.delete();
            animals.push({ species: species, nickname: nickname });
            ui.notifications.info(`Stored <b>${nickname ? nickname + " (" + species + ")" : species}</b> in the Stable.`);
        }

        if (ds.isFlag === "true") {
            foundry.utils.setProperty(fac, `flags.${MODULE_ID}.stableAnimals`, animals);
            await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
        } else {
            await fac.setFlag(MODULE_ID, "stableAnimals", animals);
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

        if (name.includes("Archive") && (upgradeData.to === "Vast" || showSizeSelect)) {
            const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
            const booksFolderId = "1gNhp4TlPZmeUuND";
            const index = await outPack.getIndex({fields: ["folder"]});
            const allBooks = index.filter(i => (i.folder?.id || i.folder) === booksFolderId);
            
            const existingBooks = facFlags.archiveBooks || [];
            const availableBooks = allBooks.filter(b => !existingBooks.includes(b.name));
            const bookOptions = availableBooks.map(b => `<option value="${b.name}">${b.name}</option>`).join("");
            
            promptContent += `<div id="archive-upgrade-container" style="margin-top: 10px; border-top: 1px solid #ccc; padding-top: 10px; ${upgradeData.to !== "Vast" ? 'display: none;' : ''}">
                                <p>A Vast Archive gains two additional reference books. Select them from the available collection:</p>
                                <div class="form-group"><label>Book 2:</label><select name="archiveBook2" style="width: 100%;">${bookOptions}</select></div>
                                <div class="form-group"><label>Book 3:</label><select name="archiveBook3" style="width: 100%;">${bookOptions}</select></div>
                              </div>`;
            html.querySelector('.enlarge-size-select')?.addEventListener('change', (ev) => {
                html.querySelector('#archive-upgrade-container').style.display = ev.target.value === "Vast" ? "block" : "none";
            });
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
                        if (confirmData.archiveBook2) gf.flags["dnd-2024-bastion-manager"].archiveBooks = [...(gf.flags["dnd-2024-bastion-manager"].archiveBooks || []), confirmData.archiveBook2, confirmData.archiveBook3];
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
                "targetSubType2": confirmData.subType2
            };

            if (confirmData.archiveBook2 && confirmData.archiveBook3) {
                const books = Array.from(facFlags.archiveBooks || []);
                books.push(confirmData.archiveBook2, confirmData.archiveBook3);
                updateObj.archiveBooks = books;
            }

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
        const MODULE_ID = "dnd-2024-bastion-manager";

        for (const item of this.actor.items.filter(i => i.type === "facility")) {
            const currentOrder = item.getFlag(MODULE_ID, "order");
            const progress = item.getFlag(MODULE_ID, "progress") || 0;

            if (currentOrder !== "Maintain") {
                const updates = { [`flags.${MODULE_ID}.order`]: "Maintain" };
                
                if (progress > 0) {
                    const facContext = this.context?.facilities?.find(f => f.id === item.id);
                    const pausedProject = {
                        craftType: item.getFlag(MODULE_ID, "craftChoice"),
                        choice: item.getFlag(MODULE_ID, "activeProjectChoice") || item.getFlag(MODULE_ID, "magicItemChoice") || item.getFlag(MODULE_ID, "focusChoice") || item.getFlag(MODULE_ID, "sacredFocusChoice") || item.getFlag(MODULE_ID, "smithyItemChoice") || item.getFlag(MODULE_ID, "armamentItemChoice") || item.getFlag(MODULE_ID, "workshopItemChoice") || item.getFlag(MODULE_ID, "relicItemChoice") || item.getFlag(MODULE_ID, "scrollChoice") || "Blank Book",
                        label: item.getFlag(MODULE_ID, "activeProjectChoice") || "Paused Project",
                        goldCost: facContext?.currentGoldCost || 0,
                        timeCost: facContext?.maxCraftTurns || 1,
                        currentProgress: progress,
                        isPausedProject: true
                    };
                    let currentQueue = Array.from(item.getFlag(MODULE_ID, "craftQueue") || []);
                    currentQueue.unshift(pausedProject);
                    Object.assign(updates, { [`flags.${MODULE_ID}.progress`]: 0, [`flags.${MODULE_ID}.activeProjectChoice`]: "", [`flags.${MODULE_ID}.craftChoice`]: "", [`flags.${MODULE_ID}.craftQueue`]: currentQueue });
                }
                await item.update(updates);
            }
        }

        if (this.actor.type === "group") {
            for (let fac of groupFacilities) {
                const fFlags = fac.flags?.[MODULE_ID] || {};
                if (fFlags.order !== "Maintain") {
                    foundry.utils.setProperty(fac, `flags.${MODULE_ID}.order`, "Maintain");
                    if ((fFlags.progress || 0) > 0) {
                        const pausedProject = {
                            craftType: fFlags.craftChoice,
                            choice: fFlags.activeProjectChoice || fFlags.magicItemChoice || fFlags.focusChoice || "Blank Book",
                            label: fFlags.activeProjectChoice || "Paused Project",
                            goldCost: 0, timeCost: 1, currentProgress: fFlags.progress, isPausedProject: true
                        };
                        let currentQueue = Array.from(fFlags.craftQueue || []);
                        currentQueue.unshift(pausedProject);
                        foundry.utils.setProperty(fac, `flags.${MODULE_ID}.progress`, 0);
                        foundry.utils.setProperty(fac, `flags.${MODULE_ID}.activeProjectChoice`, "");
                        foundry.utils.setProperty(fac, `flags.${MODULE_ID}.craftChoice`, "");
                        foundry.utils.setProperty(fac, `flags.${MODULE_ID}.craftQueue`, currentQueue);
                    }
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

     /**
     * A specialized builder trigger for when the user clicks a generic "Build" button
     * without having a dropdown pre-selected (like in the native tab).
     */
    async _promptBuildFacility() {
        const ctx = await this._prepareContext();
        
        // Generate the same grouped options used in our sidebar
        let specOptions = ctx.specialFacilities.map(g => `
            <optgroup label="Level ${g.level}">
                ${g.facilities.map(f => `<option value="${f._id}">${f.name}</option>`).join("")}
            </optgroup>`).join("");

        let basicOptions = `<optgroup label="Basic Facilities">
            ${ctx.basicFacilities.map(f => `<option value="${f._id}">${f.name}</option>`).join("")}
        </optgroup>`;

        const content = `
            <div class="bastion-app">
                <p>Select a facility to establish in your Bastion:</p>
                <div class="form-group">
                    <select name="selectedFacility" style="width: 100%;">
                        <option value="">-- Choose Facility --</option>
                        ${specOptions}
                        ${basicOptions}
                    </select>
                </div>
            </div>`;

        const result = await DialogV2.prompt({
            window: { title: "Establish New Facility", icon: "fa-solid fa-hammer" },
            content: content,
            ok: { label: "Continue", callback: (event, button) => button.form.elements.selectedFacility.value },
            rejectClose: false
        });

        if (result) BastionManager.onBuildFromDropdown.call(this, null, { dataset: {}, value: result });
    }

    static async onBuildFromDropdown(event, target) {
        if (this.actor.type === "group") return ui.notifications.warn("Facilities cannot be built directly on a Group Bastion. They must be established by individual members.");
        
        // Support both our sidebar dropdown and the direct value passed from _promptBuildFacility
        const facilityId = target?.value || this.element?.querySelector('select[name="compendium-facility"]')?.value;
        if (!facilityId) return ui.notifications.warn("Select a facility first!");

        const pack = game.packs.get("dnd-2024-bastion-manager.bastion-facilities");
        const itemDoc = await pack.getDocument(facilityId);
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

        if (itemDoc.name.includes("Archive")) {
            const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
            const booksFolderId = "1gNhp4TlPZmeUuND";
            const index = await outPack.getIndex({fields: ["folder"]});
            const books = index.filter(i => (i.folder?.id || i.folder) === booksFolderId);
            const bookOptions = books.map(b => `<option value="${b.name}">${b.name}</option>`).join("");
            promptContent += `
                <div style="margin-bottom: 10px;">
                    <p>Select your Archive's starting Reference Book:</p>
                    <select name="archiveBook1" style="width: 100%;">${bookOptions}</select>
                </div>
            `;
        }

        const isStable = itemDoc.name.includes("Stable");
        if (isStable) {
            promptContent += `
                <div style="margin-bottom: 10px;">
                    <p>Select your starting Large mount:</p>
                    <select name="startingLargeMount" style="width: 100%;">
                        <option value="Riding Horse">Riding Horse</option>
                        <option value="Camel">Camel</option>
                    </select>
                </div>`;
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

            if (isStable) {
                const animals = [formData.startingLargeMount || "Riding Horse", "Pony", "Mule"];
                foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.stableAnimals`, animals);
            }

            if (itemDoc.name.includes("Archive") && formData.archiveBook1) {
                const books = [formData.archiveBook1];
                foundry.utils.setProperty(newFacData, `flags.${MODULE_ID}.archiveBooks`, books);
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
        // Fallback to 1 turn if the input field isn't found (e.g., when called from the native tab)
        const turnsInput = typeof this.element?.querySelector === "function" ? this.element.querySelector('input[name="turns"]') : null;
        const turnsToAdvance = parseInt(turnsInput?.value) || 1;

        const MODULE_ID = "dnd-2024-bastion-manager";
        const activeNonGMs = game.users.filter(u => u.active && !u.isGM);
        const bastionActors = game.actors.filter(a => {
            const isAllowed = a.type === "character" || a.type === "npc";
            const hasFac = a.items.some(i => i.type === "facility") || a.getFlag(MODULE_ID, "groupFacilities")?.length > 0;
            const activeOwner = activeNonGMs.some(u => a.testUserPermission(u, "OWNER"));
            return isAllowed && hasFac && activeOwner;
        });

        // Ensure the actor in the current window is also advanced, regardless of active ownership
        if ( !bastionActors.some(a => a.id === this.actor.id) ) {
            const hasFac = this.actor.items.some(i => i.type === "facility") || this.actor.getFlag(MODULE_ID, "groupFacilities")?.length > 0;
            if ( hasFac ) bastionActors.push(this.actor);
        }

        let allMissing = [];
        for (let actor of bastionActors) {
            allMissing.push(...await BastionManager._validateFacilities(actor));
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
        }

        const confirm = (allMissing.length > 0) || await DialogV2.confirm({ 
            window: { title: "Advance Bastion Turn" }, 
            content: `<p>Are you sure you want to advance the global Bastion turn by <b>${turnsToAdvance}</b>?</p>`, 
            rejectClose: false, modal: true 
        });

        if (confirm) {
            const currentGlobalTurns = game.settings.get(MODULE_ID, "globalTurnCount") || 0;
            await game.settings.set(MODULE_ID, "globalTurnCount", currentGlobalTurns + turnsToAdvance);
 
            let reports = [];
            const processedGroups = new Set();
            const rolledEvents = new Map(); // Shared map for group deduplication
            const unify = game.settings.get(MODULE_ID, "unifyCombinedTurns");
 
            for (let actor of bastionActors) {
                const combinedId = actor.getFlag(MODULE_ID, "combinedGroupId");
                if (unify && combinedId && !processedGroups.has(combinedId)) {
                    const group = game.actors.get(combinedId);
                    if (group) {
                        const groupTurns = group.getFlag(MODULE_ID, "turnCount") || 0;
                        await group.setFlag(MODULE_ID, "turnCount", groupTurns + turnsToAdvance);
                    }
                    processedGroups.add(combinedId);
                }
 
                const currentActorTurns = actor.getFlag(MODULE_ID, "turnCount") || 0;
                await actor.setFlag(MODULE_ID, "isReady", false);
                await actor.setFlag(MODULE_ID, "turnCount", currentActorTurns + turnsToAdvance);
                const r = await BastionManager.executeBastionTurn(actor, turnsToAdvance, rolledEvents);
                if (r) reports.push(r);
            }
 
            if (reports.length > 0) {
                await BastionManager._dispatchReports(reports, turnsToAdvance);
            }
            ui.notifications.info(`Advanced global Bastion turns by ${turnsToAdvance}.`);
            game.socket.emit("module.dnd-2024-bastion-manager", { action: "globalAdvance" });
            if (typeof this.render === "function") this.render();
        }
    }

    static onToggleAdvanceMode(event, target) {
        this._advanceMode = this._advanceMode === "global" ? "individual" : "global";
        this.render();
    }

    static async onAdvanceIndividualTurn(event, target) {
        const turnsInput = this.element.querySelector('input[name="turns"]');
        const turnsToAdvance = parseInt(turnsInput?.value) || 1;
        const MODULE_ID = "dnd-2024-bastion-manager";

        const missing = await BastionManager._validateFacilities(this.actor);
        if (missing.length > 0) {
            let list = missing.map(m => `<li>${m}</li>`).join("");
            const proceed = await DialogV2.confirm({
                window: { title: "Incomplete Selections" },
                content: `<p><b>${this.actor.name}'s</b> Bastion has missing selections:</p><ul>${list}</ul><p>Proceed anyway? (Facilities with missing selections will Maintain)</p>`,
                rejectClose: false, modal: true
            });
            if (!proceed) return;
        }

        const confirm = (missing.length > 0) || await DialogV2.confirm({ 
            window: { title: "Advance Turn: " + this.actor.name }, 
            content: `<p>Are you sure you want to advance <b>${this.actor.name}'s</b> Bastion by <b>${turnsToAdvance}</b> turn(s)?</p><p style="font-size: 0.85em; color: #666;">This processes this character independently of other bastions.</p>`, 
            rejectClose: false, modal: true 
        });

        if (confirm) {
            let reports = [];
            const unify = game.settings.get(MODULE_ID, "unifyCombinedTurns");
            const combinedId = this.actor.getFlag(MODULE_ID, "combinedGroupId");

            if (unify && combinedId) {
                const group = game.actors.get(combinedId);
                if (group) {
                    const groupTurns = group.getFlag(MODULE_ID, "turnCount") || 0;
                    await group.setFlag(MODULE_ID, "turnCount", groupTurns + turnsToAdvance);
                }
            }

            const currentActorTurns = this.actor.getFlag(MODULE_ID, "turnCount") || 0;
            await this.actor.setFlag(MODULE_ID, "isReady", false);
            await this.actor.setFlag(MODULE_ID, "turnCount", currentActorTurns + turnsToAdvance);
            const r = await BastionManager.executeBastionTurn(this.actor, turnsToAdvance, new Map());
            if (r) reports.push(r);

            if (reports.length > 0) {
                await BastionManager._dispatchReports(reports, turnsToAdvance);
            }
            ui.notifications.info(`Advanced ${this.actor.name}'s Bastion by ${turnsToAdvance} turn(s).`);
            if (typeof this.render === "function") this.render();
        }
    }

    static async onCastSpellcasterSpell(event, target) {
        const ds = target.dataset;
        const MODULE_ID = "dnd-2024-bastion-manager";
        const actor = this.actor;
        
        let fac;
        if (ds.isFlag === "true") {
            const gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
            fac = gf.find(f => f._id === ds.itemId);
        } else {
            fac = actor.items.get(ds.itemId);
        }
        if (!fac) return;

        // 1. Determine Capacity based on Actor Level
        const actorLevel = (actor.type === "character" || actor.type === "npc") ? (actor.system.details?.level || 1) : 1;
        const maxLevel = actorLevel >= 17 ? 8 : 4;

        // 2. Fetch Spells from Compendium
        const pack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
        const folder = pack?.folders.find(f => f.name.toLowerCase().trim() === "teleportation circle");
        
        if ( !pack || !folder ) {
            console.error("Bastion Manager | Teleportation Circle folder missing in output compendium.");
            return ui.notifications.error("Teleportation Circle spell list not found. Ensure the compendium is correctly initialized.");
        }

        const index = await pack.getIndex({ fields: ["system.level", "system.school", "system.activation", "system.range", "system.source", "system.materials.cost", "system.materials.value", "system.properties", "folder", "img", "system.description.value"] });
        const availableSpells = index.filter(i => {
            const itemFolderId = i.folder?.id || i.folder;
            return itemFolderId === folder.id && i.system.level <= maxLevel;
        });

        if (availableSpells.length === 0) return ui.notifications.warn("No Wizard spells of appropriate level found in the Teleportation Circle compendium.");

        // 3. Open Advanced Spell Picker
        const selectedUuid = await SpellSelectionApp.pickSpell(actor, availableSpells, maxLevel);

        if (!selectedUuid) return;

        const spellDoc = await fromUuid(selectedUuid);
        if (!spellDoc) return;

        // 4. Handle Material Costs
        const cost = Number(spellDoc.system.materials?.cost || 0);
        const currentGold = Number(actor.system.currency?.gp || 0);
        if ( cost > currentGold ) {
            return ui.notifications.error(`You cannot afford the ${cost} GP material component for ${spellDoc.name}.`);
        }
        if ( cost > 0 ) await actor.update({"system.currency.gp": currentGold - cost});

        // Parse components for chat card - include specific material text
        const props = Array.from(spellDoc.system.properties || []); 
        const componentMap = { vocal: "V", somatic: "S", material: "M" }; 
        const components = props.filter(p => componentMap[p]).map(p => { 
            if (p === "material") {
                const mat = spellDoc.system.materials?.value; 
                return mat ? `M (${mat})` : "M";
            }
            return componentMap[p];
        }).join(", ");

        // 5. Record Cast and Process Dismissal
        const getFlag = (key) => ds.isFlag === "true" ? fac.flags?.[MODULE_ID]?.[key] : fac.getFlag(MODULE_ID, key);
        let spellcasterName = getFlag("spellcasterName") || "The visiting wizard";
        if (spellcasterName === "Friendly Wizard") spellcasterName = "The visiting wizard";

        const updates = { [`flags.${MODULE_ID}.visitingSpellcaster`]: false, [`flags.${MODULE_ID}.spellcasterDaysRemaining`]: 0, [`flags.${MODULE_ID}.spellcasterName`]: "" }; 
        
        if (ds.isFlag === "true") {
            const gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
            const targetFac = gf.find(f => f._id === ds.itemId);
            for (let [k,v] of Object.entries(updates)) foundry.utils.setProperty(targetFac, k, v);
            await actor.setFlag(MODULE_ID, "groupFacilities", gf);
        } else {
            await fac.update(updates);
        }

        this.render();

        let quotes = [
            "Farewell! My magic is spent, but your hospitality was most welcome.",
            "The winds of magic call me elsewhere. Until next time!",
            "The spell is cast. My journey continues. Safe travels!",
            "I must return to my studies. Thank you for the refuge.",
            "My task here is complete. I shall depart through the circle now.",
            "A pleasure assisting you. May your Bastion stand strong!",
            "Magic is a fickle mistress, but this casting was true. Goodbye!"
        ];

        try {
            const response = await fetch("modules/dnd-2024-bastion-manager/Resources/Teleportation Circle Departure Messages");
            if (response.ok) {
                const text = await response.text();
                const externalQuotes = text.split(/\r?\n\s*\r?\n/).map(q => q.trim().replace(/^["'](.*)["']$/, '$1')).filter(q => q.length > 0);
                if (externalQuotes.length > 0) quotes = externalQuotes;
            }
        } catch (err) {
            console.warn("Bastion Manager | Failed to load external departure messages file. Using defaults.");
        }

        const quote = quotes[Math.floor(Math.random() * quotes.length)];

        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({actor: actor}),
            content: `<div class="bastion-chat-card">
                <h3 style="border-bottom: 2px solid #005a9e; padding-bottom: 3px; color: #004578;"><i class="fa-solid fa-wand-magic-sparkles"></i> ${spellcasterName} casts ${spellDoc.name}</h3>
                <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                    <img src="${spellDoc.img}" width="32" height="32" style="border: none; border-radius: 4px;">
                    <div style="flex: 1; display: flex; justify-content: space-between; align-items: center;">
                        <b>Level ${spellDoc.system.level === 0 ? 'Cantrip' : spellDoc.system.level} Wizard Spell</b>
                        <span style="font-size: 0.85em; opacity: 0.7; font-weight: bold; text-align: right;">
                            ${cost > 0 ? `<span style="color: #a32a22; margin-right: 8px;">[Cost: ${cost} GP]</span>` : ""}
                            ${components}
                        </span>
                    </div>
                </div>
                <div style="font-size: 0.9em; max-height: 200px; overflow-y: auto; background: rgba(0,0,0,0.05); padding: 5px; border-radius: 4px; border: 1px solid #ccc; margin-bottom: 10px;">
                    ${spellDoc.system.description.value}
                </div>
                <hr>
                <p><b>${spellcasterName}</b> has cast their final spell and departed the Teleportation Circle.</p>
                <blockquote style="font-style: italic; border-left: 3px solid #ccc; padding-left: 10px; margin: 10px 0;">"${quote}"</blockquote>
            </div>`
        });

        ui.notifications.info(`<b>${spellcasterName}</b> has cast their spell and departed.`);
    }

    static async onConsumeGreenhouseFruit(event, target) {
        const ds = target.dataset;
        const MODULE_ID = "dnd-2024-bastion-manager";
        const actor = this.actor;

        let fac;
        if (ds.isFlag === "true") {
            const gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
            fac = gf.find(f => f._id === ds.itemId);
        } else {
            fac = actor.items.get(ds.itemId);
        }
        if (!fac) return;

        const getFlag = (key) => ds.isFlag === "true" ? fac.flags?.[MODULE_ID]?.[key] : fac.getFlag(MODULE_ID, key);
        const currentCount = getFlag("fruitCount") ?? 3;

        if (currentCount <= 0) return ui.notifications.warn("There are no fruits left to harvest today.");

        // Fetch Item from compendium
        const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
        const entry = (await outPack?.getIndex())?.find(i => i.name === "Fruit of Restoration" || i.name === "Magical Fruit");
        const itemName = entry?.name || "Fruit of Restoration";

        let existing = actor.items.find(i => i.name === itemName && i.type === "consumable");
        if (existing) {
            await existing.update({ "system.quantity": (existing.system.quantity || 1) + 1 });
        } else if (entry) {
            const doc = await outPack.getDocument(entry._id);
            const itemData = doc.toObject();
            itemData.system.quantity = 1;
            await actor.createEmbeddedDocuments("Item", [itemData]);
        } else {
            // Fallback if compendium item missing
            await actor.createEmbeddedDocuments("Item", [{
                name: "Fruit of Restoration", type: "consumable", img: "icons/consumables/fruit/berry-leaf-clover-green.webp",
                system: { description: { value: "A creature that eats this fruit gains the benefit of a Lesser Restoration spell. Magic expires in 24 hours." }, quantity: 1 }
            }]);
        }

        const newCount = currentCount - 1;
        if (ds.isFlag === "true") {
            const gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
            const targetFac = gf.find(f => f._id === ds.itemId);
            foundry.utils.setProperty(targetFac, `flags.${MODULE_ID}.fruitCount`, newCount);
            await actor.setFlag(MODULE_ID, "groupFacilities", gf);
        } else {
            await fac.setFlag(MODULE_ID, "fruitCount", newCount);
        }

        ui.notifications.info("Harvested 1 Magical Fruit.");
        this.render();
    }

    static async onRefreshGreenhouseFruits(event, target) {
        const ds = target.dataset;
        const MODULE_ID = "dnd-2024-bastion-manager";
        const actor = this.actor;

        if (ds.isFlag === "true") {
            const gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
            const fac = gf.find(f => f._id === ds.itemId);
            if (fac) {
                foundry.utils.setProperty(fac, `flags.${MODULE_ID}.fruitCount`, 3);
                await actor.setFlag(MODULE_ID, "groupFacilities", gf);
            }
        } else {
            const item = actor.items.get(ds.itemId);
            if (item) await item.setFlag(MODULE_ID, "fruitCount", 3);
        }

        ui.notifications.info("Dawn arrives: The magical plant has regrown its fruits.");
        this.render();
    }

    static async onToggleReady(event, target) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const current = this.actor.getFlag(MODULE_ID, "isReady") || false;
        await this.actor.setFlag(MODULE_ID, "isReady", !current);
        
        if (!current) {
            const missing = await BastionManager._validateFacilities(this.actor);
            if (missing.length > 0) ui.notifications.warn(`${this.actor.name}: You have incomplete facility orders.`);
        }
        
        this.render();
    }

    // --- THE STANDALONE ENGINE ---
    static async executeBastionTurn(actor, turnsToAdvance, rolledEvents = null) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        let allFacilities = BastionManager._getActorFacilities(actor, true); // respect combined for data gathering
        if (allFacilities.length === 0) return null; 

        // Filter to only facilities OWNED by this actor to avoid double-processing in combined bastions
        let myFacilities = allFacilities.filter(f => f.owner.id === actor.id);

        let globalDefenders = allFacilities.reduce((sum, fac) => sum + (fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.defenders?.count || 0) : (fac.doc.getFlag(MODULE_ID, "defenders.count") || 0)), 0);
        let hasSmithy = allFacilities.some(fac => fac.doc.name.includes("Smithy"));
        let actorLevel = (actor.type === "character" || actor.type === "npc") ? (actor.system.details?.level || 1) : 1;

        const resolution = await BastionManager._resolveOrders(actor, myFacilities, turnsToAdvance, globalDefenders, hasSmithy, actorLevel);
        if (rolledEvents) resolution.rolledEvents = rolledEvents;

        // --- NEGLECT LOGIC ---
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
    static async _validateFacilities(actor) {
        const facilities = BastionManager._getActorFacilities(actor);
        const missing = [];
        const MODULE_ID = "dnd-2024-bastion-manager";

        for (const fac of facilities) {
            const getFacFlag = (key) => fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.[key]) : (fac.doc.getFlag(MODULE_ID, key));
            const order = getFacFlag("order") || "Maintain";
            
            if (order === "Maintain") continue;

            if (fac.name.includes("Library") && order === "Research") {
                const topic = getFacFlag("libraryTopic");
                if (!topic || topic.trim() === "") missing.push(`${actor.name}: Library needs a Research Topic.`);
            }
            
            if (fac.name.includes("Arcane Study") && order === "Craft") {
                const choice = getFacFlag("craftChoice");
                const queue = getFacFlag("craftQueue") || [];
                if (!choice && queue.length === 0) missing.push(`${actor.name}: Arcane Study needs a Craft selection or Queue.`);
                else if (choice === "Arcane Focus") {
                    const focusChoice = getFacFlag("focusChoice");
                    if (!focusChoice) missing.push(`${actor.name}: Arcane Study (Arcane Focus) needs a Focus Type selection.`);
                }
            }

            if (fac.name.includes("Sanctuary") && order === "Craft") {
                const choice = getFacFlag("craftChoice");
                const queue = getFacFlag("craftQueue") || [];
                if (!choice && queue.length === 0) missing.push(`${actor.name}: Sanctuary needs a Craft selection or Queue.`);
                else if (choice === "Druidic Focus" || choice === "Holy Symbol") {
                    const sacredFocusChoice = getFacFlag("sacredFocusChoice");
                    if (!sacredFocusChoice) missing.push(`${actor.name}: Sanctuary (${choice}) needs a Focus Type selection.`);
                }
            } else if (fac.name.includes("Smithy") && order === "Craft") {
                const choice = getFacFlag("craftChoice");
                const queue = getFacFlag("craftQueue") || [];
                if (!choice && queue.length === 0) missing.push(`${actor.name}: Smithy needs a Craft selection or Queue.`);
                else if (choice === "Smith's Tools") {
                    const itemChoice = getFacFlag("smithyItemChoice");
                    if (!itemChoice) missing.push(`${actor.name}: Smithy (Smith's Tools) needs an item selection.`);
                } else if (choice === "Magic Item (Armament)") {
                    const itemChoice = getFacFlag("armamentItemChoice");
                    if (!itemChoice) missing.push(`${actor.name}: Smithy (Armament) needs a Magic Item selection.`);
                }
            }

            if (fac.name.includes("Training Area") && order === "Empower") {
                const trainer = getFacFlag("trainerType");
                if (!trainer) missing.push(`${actor.name}: Training Area needs a Trainer Type selection.`);
            }

            if (fac.name.includes("Garden")) {
                if (order === "Harvest") {
                    const choice = getFacFlag("harvestChoice");
                    if (!choice) missing.push(`${actor.name}: Garden needs a Harvest selection.`);
                }
                if (order === "Change Type") {
                    const pending = getFacFlag("pendingSubType");
                    if (!pending) missing.push(`${actor.name}: Garden needs a target Specialization for Change Type.`);
                }
            } else if (fac.name.includes("Scriptorium") && order === "Craft") {
                const choice = getFacFlag("craftChoice");
                if (choice === "Book Replica") {
                    const hasBook = actor.items.some(i => i.name.toLowerCase().includes("blank book") || (i.name.toLowerCase() === "book" && i.type !== "facility"));
                    if (!hasBook) missing.push(`${actor.name}: Scriptorium requires a Blank Book in inventory to begin a Book Replica.`);
                    const title = getFacFlag("bookTitle");
                    if (!title) missing.push(`${actor.name}: Scriptorium requires a Book Title to replicate.`);
                } else if (choice === "Paperwork") {
                    const title = getFacFlag("paperworkTitle");
                    if (!title) missing.push(`${actor.name}: Scriptorium requires a description/title for Paperwork.`);
                }
            } else if (fac.name.includes("Stable") && order === "Trade") {
                const choice = getFacFlag("stableItemChoice");
                const tradeType = getFacFlag("stableTradeChoice") || "buy";
                if (!choice) {
                    missing.push(`${actor.name}: Stable requires a mount selection for Trade.`);
                } else if (tradeType === "buy") {
                    const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                    const index = await outPack.getIndex({fields: ["system.price", "system.size", "system.properties", "system.description.value"]});
                    const entry = index.find(e => e.name === choice);
                    if (entry) {
                        let p = entry.system.price?.value ?? entry.system.price ?? 0;
                        if (typeof p === "string") p = parseFloat(p.replace(/[^0-9.]/g, ""));
                        let price = Number(p || 0);
                        const currentGP = Number(actor.system.currency?.gp || 0);
                        if (currentGP < price) {
                            missing.push(`${actor.name}: Cannot afford <b>${choice}</b> (${price} GP required, ${currentGP} GP available).`);
                        }

                        const costInSlots = BastionManager._getMountSlotCost(await BastionManager._extractSize(entry));
                        const facSize = getFacFlag("size") || "Roomy";
                        const maxSlots = facSize === "Vast" ? 6 : 3;
                        
                        let usedSlots = 0;
                        const stableAnimals = getFacFlag("stableAnimals") || [];
                        for (const animal of stableAnimals) {
                            const speciesName = typeof animal === "string" ? animal : animal.species;
                            const e = index.find(i => i.name.toLowerCase() === speciesName.toLowerCase());
                            usedSlots += BastionManager._getMountSlotCost(await BastionManager._extractSize(e));
                        }

                        if (usedSlots + costInSlots > maxSlots) {
                            missing.push(`${actor.name}: Stable is too full for <b>${choice}</b> (${usedSlots}/${maxSlots} slots occupied).`);
                        } else if (costInSlots > 3) {
                            missing.push(`${actor.name}: <b>${choice}</b> is too large for the Stable.`);
                        }
                    }
                }
            }
        }
        return missing;
    }

    // --- HELPER: FACILITY GATHERING ---
    static _getActorFacilities(actor, unified = false) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const getActorFacs = (a) => {
            let list = [];
            a.items.filter(i => i.type === "facility").forEach(i => list.push({ doc: i, name: i.name, isFlag: false, owner: a }));
            const flagFacs = a.getFlag(MODULE_ID, "groupFacilities") || [];
            flagFacs.forEach(f => list.push({ doc: f, name: f.name, isFlag: true, owner: a }));
            return list;
        };
 
        if (!unified) return getActorFacs(actor);
 
        const combinedId = actor.getFlag(MODULE_ID, "combinedGroupId");
        if (!combinedId) return getActorFacs(actor);
 
        const group = game.actors.get(combinedId);
        if (!group) return getActorFacs(actor);
 
        const memberIds = new Set((group.system.members || []).map(m => m.actorId).filter(id => !!id));
        let allFacs = [];
        for (const id of memberIds) {
            const mActor = game.actors.get(id);
            if (mActor) allFacs.push(...getActorFacs(mActor));
        }
        return allFacs;
    }

    // --- HELPER: ORDER RESOLUTION ---
    static async _resolveOrders(actor, facilities, turns, defenders, hasSmithy, level) {
        let orderSummary = "";
        let totalGold = 0;
        let items = [];
        let itemUpdates = [];
        const MODULE_ID = "dnd-2024-bastion-manager";
        const calculationMode = game.settings.get(MODULE_ID, "calculationMode");
        const daysPerTurn = game.settings.get(MODULE_ID, "daysPerTurn") || 7;
        const progIncrement = calculationMode === "days" ? daysPerTurn : 1;
        
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

        // --- Meditation Item Cleanup ---
        const meditationItemIds = actor.getFlag(MODULE_ID, "activeMeditationItems") || [];
        if (meditationItemIds.length > 0) {
            const itemsToRemove = actor.items.filter(i => meditationItemIds.includes(i.id)).map(i => i.id);
            if (itemsToRemove.length > 0) {
                await actor.deleteEmbeddedDocuments("Item", itemsToRemove);
                orderSummary += `<li style="margin-bottom: 6px; padding: 4px; background: rgba(130,207,255,0.1); border-radius: 3px;"><i class="fa-solid fa-brain"></i> <b>Meditation:</b> Your inner focus has faded. Saving throw benefits have been removed.</li>`;
            }
            await actor.unsetFlag(MODULE_ID, "activeMeditationItems");
            await actor.unsetFlag(MODULE_ID, "fortifiedSaves");
        }

        // Handle Defensive Wall Progress

        let wallDays = actor.getFlag(MODULE_ID, "pendingWallDays") || 0;
        if (wallDays > 0) {
            let wallCount = actor.getFlag(MODULE_ID, "completedWalls") || 0;
            let wallRemainder = actor.getFlag(MODULE_ID, "wallDayRemainder") || 0;
            
            const elapsedDays = (turns * daysPerTurn) + wallRemainder;
            const finishedSquares = Math.floor(elapsedDays / 10);
            const remainingPending = Math.max(0, wallDays - (turns * daysPerTurn));
            
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

            // Initialize wrapper with current state so event resolution sees the most recent values
            facEntry.isStocked = getFacFlag("isStocked") || false;
            facEntry.stockedCount = Number(getFacFlag("stockedCount") || 0);

            let isDamaged = getFacFlag("isDamaged") || false;
            let repairProgress = Number(getFacFlag("repairProgress") || 0);
            let repairTurns = Number(getFacFlag("repairTurns") || 0);

            const isBasic = facDoc.system?.type?.value === "basic";
            let order = isBasic ? "Maintain" : (getFacFlag("order") || "Maintain");
            let subType = getFacFlag("subType");
            let progress = Number(getFacFlag("progress") || 0);
            let craftChoice = getFacFlag("craftChoice");
            let craftQueue = getFacFlag("craftQueue") || [];
            
            // Synchronize 'Progress Queue' behavior with UI display fallback:
            // If order is Maintain but there is a queue and no active progress, treat as Progress Queue.
            if (order === "Maintain" && craftQueue.length > 0 && progress === 0) order = "Progress Queue";

            // Use || instead of ?? to ensure null values from construction don't fallback to truthy defaults 
            // unless the construction flag itself is missing.
            let facSize = getFacFlag("size");
            if (facSize === undefined) facSize = isBasic ? "Roomy" : null;

            const isArcane = facName.includes("Arcane Study");
            const isSmithy = facName.includes("Smithy");
            const isSanctuary = facName.includes("Sanctuary");
            const isWorkshop = facName.includes("Workshop");
            const isSacristy = facName.includes("Sacristy");
            const isScriptorium = facName.includes("Scriptorium");
            const isGreenhouse = facName.includes("Greenhouse");
            const isLaboratory = facName.includes("Laboratory");
            const isReliquary = facName.includes("Reliquary");

            // Narrative Hireling Context
            const hNames = getFacFlag("hirelings") || [];
            const hProfRaw = BastionManager._getHirelingProfession(facName, subType);
            const hJob = hProfRaw.replace("the ", "").toLowerCase();
            
            const getH = (isCap = true) => {
                const name = hNames.length ? hNames[0] : "";
                if (name) return `<b>${name} the ${hJob}</b>`;
                return isCap ? `<b>The ${hJob}</b>` : `<b>the ${hJob}</b>`;
            };

            const getPs = (isCap = true) => {
                return isCap ? `<b>The ${hJob}s</b>` : `<b>the ${hJob}s</b>`;
            };

            let focusChoice = getFacFlag("focusChoice");
            let magicItemChoice = getFacFlag("magicItemChoice");
            let sacredFocusChoice = getFacFlag("sacredFocusChoice");
            let libraryTopic = getFacFlag("libraryTopic");
            let workshopItemChoice = getFacFlag("workshopItemChoice");
            let smithyItemChoice = getFacFlag("smithyItemChoice");
            let armamentItemChoice = getFacFlag("armamentItemChoice");
            let relicItemChoice = getFacFlag("relicItemChoice");
            let scrollChoice = getFacFlag("scrollChoice");
            let bookTitle = getFacFlag("bookTitle");
            let paperworkTitle = getFacFlag("paperworkTitle");
            let paperworkQty = getFacFlag("paperworkQty");
            let stableItemChoice = getFacFlag("stableItemChoice");
            let archiveBooks = getFacFlag("archiveBooks") || [];
            let greenhouseFruitCount = getFacFlag("fruitCount") ?? 3;
            let greenhousePoisonChoice = getFacFlag("greenhousePoisonChoice") || "Assassin's Blood";
            let laboratoryPoisonChoice = getFacFlag("laboratoryPoisonChoice") || "Burnt Othur Fumes";
            let laboratoryAlchemistChoice = getFacFlag("laboratoryAlchemistChoice") || "";
            let theaterPhase = getFacFlag("theaterPhase") || "Idle";
            let theaterProgress = Number(getFacFlag("theaterProgress") || 0);
            let stableTradeChoice = getFacFlag("stableTradeChoice");
            let stableTransferType = getFacFlag("stableTransferType");
            let stableTransferChoice = getFacFlag("stableTransferChoice");
            let stableAnimals = getFacFlag("stableAnimals") || [];
            // Migration: Ensure resolution engine treats animals as objects
            stableAnimals = stableAnimals.map(a => typeof a === "string" ? { species: a, nickname: "" } : a);
            let isStocked = getFacFlag("isStocked") || false;
            const currentStockedCount = getFacFlag("stockedCount") || 0;

            // Armory: Auto-maintain if already fully stocked at turn start
            let armoryAutoMaintained = false;
            if (facName.includes("Armory") && order === "Trade" && isStocked && currentStockedCount >= defenders) {
                order = "Maintain";
                armoryAutoMaintained = true;
            }
            let trainerType = getFacFlag("trainerType");

            let activeProjectChoice = getFacFlag("activeProjectChoice");
            let storedGp = Number(getFacFlag("storedGp") || 0);
            let autoNextAction = getFacFlag("autoNextAction") || "procure";

            let upgradeProgress = getFacFlag("upgradeProgress") || 0;
            let targetSize = getFacFlag("targetSize");
            let targetSubType2 = getFacFlag("targetSubType2");
            let facSubType2 = getFacFlag("subType2");
            let upgradeTurns = getFacFlag("upgradeTurns") || 0;

            let visitingSpellcaster = getFacFlag("visitingSpellcaster") || false;
            let spellcasterDaysRemaining = Number(getFacFlag("spellcasterDaysRemaining") || 0);
            let spellcasterName = getFacFlag("spellcasterName") || "";

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

            for (let i = 0; i < turns; i++) {
                // Re-sync basic state flags at start of each internal turn
                // If order is Progress Queue but queue is empty and no progress, treat as Maintain
                if (order === "Progress Queue" && craftQueue.length === 0 && progress === 0) {
                    order = "Maintain";
                }

                if (isDamaged) {
                    repairProgress += progIncrement;
                    if (repairProgress >= repairTurns) {
                        isDamaged = false;
                        repairTurns = 0;
                        currentResultText = `Repairs are complete; the facility is operational once more.`;
                    } else {
                        currentResultText = `The facility is currently shut down for repairs.`;
                        break; 
                    }
                    continue;
                }
                if (insufficientReason) {
                    currentResultText = `Skipped: ${insufficientReason}.`;
                    break;
                }

                if (order === "Maintain") {
                    if (armoryAutoMaintained) {
                        currentResultText = `${getH()} notes the Armory is already fully stocked for your ${defenders} defenders.`;
                    } else if (!currentResultText) currentResultText = insufficientReason ? `Maintained operations (${insufficientReason}).` : "Maintained standard operations.";
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
                                currentResultText = `${getH()} reports that procurement failed due to insufficient funds or storage capacity.`;
                            } else {
                                localGold -= actualAmount;
                                storedGp += actualAmount;
                                currentResultText = `${getH()} successfully procured <b>${actualAmount} GP</b> worth of goods for the storehouse. (Stock: ${storedGp}/${limit} GP)`;
                            }
                        } else { // Sell
                            const actualAmount = Math.floor(Math.min(amount, storedGp));
                            if (actualAmount <= 0) {
                                currentResultText = `${getH()} reports there are no goods in stock to sell.`;
                            } else {
                                const profit = Math.floor(actualAmount * markup);
                                storedGp -= actualAmount;
                                localGold += profit;
                                currentResultText = `${getH()} sold <b>${actualAmount} GP</b> worth of goods at a profit of <b>${profit} GP</b>. (Stock: ${storedGp}/${limit} GP)`;
                            }
                        }

                        if (getFacFlag("tradeChoice") === "auto") {
                            autoNextAction = (choice === "procure") ? "sell" : "procure";
                        }

                        // Persist the stored GP back to the local variable for the batch update
                        facEntry.storedGp = storedGp; 
                    } else if (facDoc.name.includes("Armory")) {
                        if (!isStocked || currentStockedCount < defenders) {
                            // Cost is 100 base (if empty) + 100 per new defender needed
                            const gap = Math.max(0, defenders - currentStockedCount);
                            let cost = (!isStocked ? 100 : 0) + (gap * 100);
                            if (hasSmithy) cost = Math.floor(cost / 2);
                            const currentActorGP = Number(actor.system.currency?.gp || 0) || 0;
                            if (currentActorGP + totalGold + localGold < cost) {
                                currentResultText = `${getH()} was unable to restock the armory due to insufficient gold (${cost} GP required).`;
                            } else {
                                localGold -= cost;
                                isStocked = true;
                                facEntry.isStocked = true;
                                facEntry.stockedCount = defenders;
                                currentResultText = `${getH()} has finished stocking superior equipment for your ${defenders} defenders. Defense rolls will now use <b>d8s</b>.`;
                                order = "Maintain";
                            }
                        }
                    } else if (facDoc.name.includes("Stable")) {
                        const tradeType = getFacFlag("stableTradeChoice") || "buy";
                        const mountName = getFacFlag("stableItemChoice");
                        
                        const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                        const index = await outPack.getIndex({fields: ["system.price", "system.size", "system.properties", "system.description.value"]});
                        const entry = index.find(e => e.name === mountName);

                        if (tradeType === "buy") {
                            if (!entry) {
                                currentResultText = `${getH()} is waiting for you to select a mount to purchase.`;
                            } else {
                                let p = entry.system.price?.value ?? entry.system.price ?? 0;
                                if (typeof p === "string") p = parseFloat(p.replace(/[^0-9.]/g, ""));
                                let price = Number(p || 0);
                                const currentActorGP = Number(actor.system.currency?.gp || 0) || 0;

                                // Updated Slot calculation
                                const costInSlots = BastionManager._getMountSlotCost(await BastionManager._extractSize(entry));
                                const maxSlots = facSize === "Vast" ? 6 : 3;
                                
                                let usedSlots = 0; // Calculate current used slots
                                for (const animal of stableAnimals) {
                                    const e = index.find(i => i.name.toLowerCase() === animal.species.toLowerCase());
                                    usedSlots += BastionManager._getMountSlotCost(await BastionManager._extractSize(e));
                                }

                                if (currentActorGP + totalGold + localGold < price) {
                                    currentResultText = `${getH()} was unable to purchase the <b>${mountName}</b> (${price} GP required).`;
                                } else if (usedSlots + costInSlots > maxSlots) {
                                    currentResultText = `${getH()} reports the stable is too full to house a <b>${mountName}</b>.`;
                                } else if (costInSlots > 3) {
                                    currentResultText = `${getH()} notes that <b>${mountName}</b> is too large to fit in this stable.`;
                                } else {
                                    localGold -= price;
                                    stableAnimals.push({ species: mountName, nickname: "" });
                                    currentResultText = `${getH()} successfully purchased a <b>${mountName}</b>.`;
                                }
                            }
                        } else { // Sell
                            const idx = stableAnimals.findIndex(a => a.species === mountName);
                            if (idx === -1) {
                                currentResultText = `${getH()} couldn't find a <b>${mountName}</b> to sell.`;
                            } else if (!entry) {
                                currentResultText = `${getH()} can't find pricing data for that animal.`;
                            } else {
                                let p = entry.system.price?.value ?? entry.system.price ?? 0;
                                if (typeof p === "string") p = parseFloat(p.replace(/[^0-9.]/g, ""));
                                let price = Number(p || 0);
                                const profitMult = level >= 17 ? 2.0 : (level >= 13 ? 1.5 : 1.2);
                                const salePrice = Math.floor(price * profitMult);
                                
                                stableAnimals.splice(idx, 1);
                                localGold += salePrice;
                                currentResultText = `${getH()} found a buyer for the <b>${mountName}</b>, earning <b>${salePrice} GP</b>.`;
                            }
                        }
                        // Persist to local vars for final update
                        facEntry.stableAnimals = stableAnimals;
                    } else {
                        let tradeRes = await BastionManager._handleTrade(facDoc.name, defenders, hasSmithy, level);
                        localGold += tradeRes.gold; currentResultText = tradeRes.text.replace("The hirelings", getPs());
                    }
                } else if (order === "Harvest") {
                    if (isGreenhouse) {
                        // Treat Greenhouse Harvest like Crafting with progress
                        order = "Craft"; i--; // Re-inject into craft logic loop
                        continue;
                    } else {
                        let harvestRes = await BastionManager._handleHarvest(facDoc.name, subType, facEntry, false, getH());
                        if (harvestRes.item) items.push(harvestRes.item);
                        currentResultText = harvestRes.text;
                        if (facDoc.name.includes("Garden") && facSize === "Vast" && facSubType2) {
                            let harvestRes2 = await BastionManager._handleHarvest(facDoc.name, facSubType2, facEntry, true, getH());
                            if (harvestRes2.item) items.push(harvestRes2.item);
                            currentResultText += ` and ${harvestRes2.text}`;
                        }
                    }
                } else if (order === "Research") {
                    let resRes = await BastionManager._handleResearch(facDoc.name, facEntry, subType, getH());
                    currentResultText = resRes.text;
                    if (resRes.item) items.push(resRes.item);
                } else if (order === "Craft" || order === "Progress Queue" || order === "Continue Project") {
                    // Robust Queue Advancement: If idle or explicitly processing queue, pull next project
                    if ((!craftChoice || order === "Progress Queue") && progress === 0 && craftQueue.length > 0) {
                        const next = craftQueue.shift();
                        craftChoice = next.craftType;
                        activeProjectChoice = next.choice || next.label;
                        progress = next.isPausedProject ? (next.currentProgress || 0) : 0;

                        if (facName.includes("Arcane Study")) {
                            if (craftChoice === "Arcane Focus") focusChoice = next.choice;
                            else if (craftChoice === "Magic Item (Arcana)") magicItemChoice = next.choice;
                        } else if (facName.includes("Workshop")) {
                            workshopItemChoice = next.choice;
                        } else if (facName.includes("Greenhouse")) {
                            if (craftChoice === "Poison" || craftChoice === "Harvest: Poison") greenhousePoisonChoice = next.choice;
                        } else if (facName.includes("Laboratory")) {
                            if (craftChoice === "Poison") laboratoryPoisonChoice = next.choice; else if (craftChoice === "Alchemist's Supplies") laboratoryAlchemistChoice = next.choice;
                        } else if (facName.includes("Smithy")) {
                            if (craftChoice === "Smith's Tools") smithyItemChoice = next.choice;
                            else if (craftChoice === "Magic Item (Armament)") armamentItemChoice = next.choice;
                        } else if (isSanctuary) {
                            sacredFocusChoice = next.choice;
                        } else if (facName.includes("Sacristy")) {
                            relicItemChoice = next.choice;
                        } else if (facName.includes("Scriptorium")) {
                            if (craftChoice === "Spell Scroll") scrollChoice = next.choice;
                            else if (craftChoice === "Book Replica") bookTitle = next.choice;
                            else if (craftChoice === "Paperwork") paperworkTitle = next.choice;
                        }
                        currentResultText = currentResultText ? `${currentResultText} | ${getH()} is resuming work on <b>${next.label}</b>.` : `${getH()} is resuming work on <b>${next.label}</b>.`;
                    }

                    if (!craftChoice) {
                        currentResultText = currentResultText || "Idle (No active project or queue)";
                        break;
                    }

                    const isMundaneLongCraft = (isSmithy && craftChoice === "Smith's Tools") || (isWorkshop && craftChoice === "Adventuring Gear");

                    // 1. Determine Costs and Time Requirements
                    let turnsNeeded = 1;
                    let projectLabel = (progress > 0 && activeProjectChoice) ? activeProjectChoice :
                                       (isArcane && craftChoice === "Arcane Focus") ? focusChoice :
                                       (isArcane && craftChoice === "Magic Item (Arcana)") ? magicItemChoice :
                                       (isSmithy && craftChoice === "Smith's Tools") ? smithyItemChoice :
                                       (isSmithy && craftChoice === "Magic Item (Armament)") ? armamentItemChoice :
                                       (isWorkshop) ? workshopItemChoice :
                                       (isSanctuary) ? sacredFocusChoice : // Sanctuary
                                       (isScriptorium && craftChoice === "Spell Scroll") ? scrollChoice : // Scriptorium
                                       (isScriptorium && craftChoice === "Book Replica") ? bookTitle :
                                       (isScriptorium && craftChoice === "Paperwork") ? paperworkTitle :
                                       (isGreenhouse && craftChoice === "Poison") ? greenhousePoisonChoice :
                                       (isLaboratory && craftChoice === "Poison") ? laboratoryPoisonChoice :
                                       (isGreenhouse && craftChoice === "Healing Herbs") ? "Potion of Healing (Greater)" :
                                       (isSacristy && craftChoice === "Magic Item (Relic)") ? relicItemChoice :
                                       (isScriptorium && craftChoice === "Spell Scroll") ? scrollChoice : (activeProjectChoice || craftChoice);
                    
                    if (progress === 0) activeProjectChoice = projectLabel;

                    if (!projectLabel || projectLabel === "Blank Book") projectLabel = craftChoice;

                    let projectTier = "";
                    const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);

                    if (outPack) {
                        const index = await outPack.getIndex({fields:["system.rarity", "system.price", "system.quantity"]});
                        const entry = index.find(e => e.name.toLowerCase() === projectLabel?.toLowerCase());
                        
                        if (entry) {
                            const isMagicItem = ["Magic Item (Arcana)", "Magic Item (Armament)", "Magic Item (Implement)", "Magic Item (Relic)", "Spell Scroll"].includes(craftChoice);
                            const isScroll = entry.name.toLowerCase().includes("spell scroll");
                            
                            let days;
                            if (isScroll) {
                                const reqs = BastionManager._getScrollRequirements(entry.name);
                                days = reqs.days;
                                materialCost = reqs.gp;
                            } else if (isMagicItem) {
                                projectTier = entry.system?.rarity || "common";
                                const reqs = BastionManager._getMagicItemRequirements(projectTier);
                                days = reqs.days;
                                materialCost = reqs.gp;
                            } else {
                                let p = entry.system?.price?.value ?? entry.system?.price ?? 0;
                                if (typeof p === "string") p = parseFloat(p.replace(/[^0-9.]/g, "")) || 0;
                                materialCost = Math.floor(p / 2);
                                if (isLaboratory && craftChoice === "Poison") days = BastionManager._getEffectiveDays(7);
                                else days = Math.max(1, Math.ceil(p / 10));
                            }
                            turnsNeeded = calculationMode === "days" ? days : Math.max(1, Math.ceil(days / daysPerTurn));
                        } else if (craftChoice === "Book" || craftChoice === "Arcane Focus" || craftChoice === "Druidic Focus" || craftChoice === "Holy Symbol" || craftChoice === "Holy Water") {
                            materialCost = craftChoice === "Book" ? 10 : 0;
                            turnsNeeded = calculationMode === "days" ? BastionManager._getEffectiveDays(7) : 1;
                        }
                    }

                    // Handle Scriptorium non-item specifics
                    if (craftChoice === "Book Replica") {
                        materialCost = 0; turnsNeeded = calculationMode === "days" ? BastionManager._getEffectiveDays(7) : 1;
                    } else if (craftChoice === "Book") {
                        materialCost = 10;
                        turnsNeeded = calculationMode === "days" ? BastionManager._getEffectiveDays(7) : 1;
                    } else if (craftChoice === "Paperwork") {
                        materialCost = paperworkQty || 50; // 1 GP per copy
                        turnsNeeded = calculationMode === "days" ? BastionManager._getEffectiveDays(7) : 1;
                    } else if (isLaboratory) {
                        const choice = craftChoice === "Poison" ? laboratoryPoisonChoice : laboratoryAlchemistChoice;
                        const isLabPoison = craftChoice === "Poison";

                        if (isLabPoison) {
                            turnsNeeded = calculationMode === "days" ? BastionManager._getEffectiveDays(7) : 1;
                        }

                        if (outPack) {
                            const index = await outPack.getIndex({fields: ["system.price"]});
                            const entry = index.find(e => e.name.toLowerCase() === choice.toLowerCase());
                            let p = entry?.system?.price?.value ?? entry?.system?.price ?? 0;
                            if (typeof p === "string") p = parseFloat(p.replace(/[^0-9.]/g, ""));
                            const price = Number(p || 0);
                            materialCost = Math.floor(price / 2);
                            if (!isLabPoison) {
                                const days = Math.max(1, Math.ceil(price / 10));
                                turnsNeeded = calculationMode === "days" ? days : Math.max(1, Math.ceil(days / daysPerTurn));
                            }
                        }
                    } else if (isReliquary && order === "Harvest") {
                        materialCost = 0;
                        turnsNeeded = calculationMode === "days" ? BastionManager._getEffectiveDays(7) : 1;
                    }

                    // 2. Initial Turn: Check and Deduct Gold
                    if (progress === 0) {
                        if (craftChoice === "Book Replica") {
                            const book = actor.items.find(i => i.name.toLowerCase().includes("blank book") || (i.name.toLowerCase() === "book" && i.type !== "facility"));
                            if (!book) {
                                currentResultText = `${getH()} had to pause work; a <b>Blank Book</b> is missing from inventory.`;
                                break;
                            }
                            if ((book.system.quantity || 1) > 1) await book.update({"system.quantity": book.system.quantity - 1});
                            else await book.delete();
                            currentResultText = `${getH()} consumes a blank book and begins the replication. `;
                        }

                        const currentGP = actor.system.currency?.gp || 0;
                        if ((currentGP + totalGold + localGold) < materialCost) {
                            currentResultText = `${getH()} had to pause work on <b>${projectLabel}</b> due to lack of funds for materials.`;
                            break;
                        }
                        localGold -= materialCost;
                    }

                    // 3. Advance Progress
                    progress += progIncrement;

                    // 4. Completion Handler
                    if (progress >= turnsNeeded) {
                        let craftRes = await BastionManager._handleCraft(facName, facEntry, craftChoice, projectLabel, actor.system.currency?.gp || 0, getH());
                        if (craftRes.item) items.push(craftRes.item);
                        currentResultText = currentResultText ? `${currentResultText} | ${craftRes.text}` : craftRes.text;

                        progress = 0;
                        craftChoice = ""; // Clear the local craftChoice variable to allow queue advancement or default to Maintain
                        activeProjectChoice = "";

                        if (!craftQueue.length) {
                            if (isGreenhouse || (isReliquary && order === "Harvest")) {
                                order = "Harvest";
                                currentResultText += `<br><span style="color: #2e7d32; font-weight: bold;"><i class="fa-solid fa-seedling"></i> Harvest complete. ${getH()} continues to tend the plants for the next cycle.</span>`;
                            } else {
                                order = "Maintain";
                                craftChoice = "";
                                currentResultText += `<br><span style="color: #a32a22; font-weight: bold;"><i class="fa-solid fa-circle-exclamation"></i> Work is complete; ${getH(false)} awaits new orders.</span>`;
                            }
                        }
                        
                        // Re-sync local order and choices for the next potential internal turn
                    } else {
                        const progressLabel = calculationMode === "days" ? "Days" : "Turns";
                        const tierInfo = projectTier ? ` (${projectTier})` : "";
                        currentResultText = `${getH()} is busy crafting <b>${projectLabel}</b>${tierInfo}... (${progress}/${turnsNeeded} ${progressLabel})`;
                    }
                } else if (order === "Change Type") {
                    let pending = getFacFlag("pendingSubType");
                    progress += progIncrement;
                    
                    const totalNeeded = facName.includes("Garden") 
                        ? (calculationMode === "days" ? BastionManager._getEffectiveDays(21) : 3)
                        : (upgradeTurns || 0);

                    if (progress >= totalNeeded) {
                        subType = pending || "Decorative"; progress = 0; 
                        currentResultText = `${getH()} has finished converting the facility to a <b>[${subType}]</b> specialization.`; 
                    } else {
                        const label = calculationMode === "days" ? "days" : "turns";
                        currentResultText = `${getH()} is currently working to change the specialization to [${pending}] (Progress: ${progress}/${totalNeeded} ${label}).`; 
                    }
                } else if (order === "Recruit") {
                    if (facDoc.name.includes("Teleportation Circle")) {
                        if (visitingSpellcaster) {
                            currentResultText = "Recruitment skipped: A spellcaster is already visiting.";
                        } else {
                            const roll = (await new Roll("1d2").evaluate()).total;
                            if (roll === 2) {
                                visitingSpellcaster = true;
                                    spellcasterDaysRemaining = BastionManager._getEffectiveDays(14);
                                spellcasterName = BastionManager._generateSpellcasterName();
                                currentResultText = `Invitation accepted! <b>${spellcasterName}</b> has arrived via the Teleportation Circle.`;
                            } else currentResultText = `${getH()} sent out invitations, but no spellcasters were available to visit this week.`;
                        }
                    } else {
                        let recRes = await BastionManager._handleRecruit(facDoc.name, facEntry, actor, getH());
                        currentResultText = recRes.text; facDoc.newDefenders = { count: recRes.newCount, names: recRes.newNames };
                    }
                } else if (order === "Empower") {
                    let empRes = await BastionManager._handleEmpower(facDoc.name, facEntry, actor, theaterPhase, theaterProgress, getH(), getPs());
                    if (empRes) {
                        currentResultText = empRes.text;
                        if (empRes.theaterPhase) {
                            theaterPhase = empRes.theaterPhase;
                            theaterProgress = empRes.theaterProgress;
                        }
                    }
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
                        relicItemChoice, scrollChoice, activeProjectChoice, craftQueue, storedGp, autoNextAction,
                        bookTitle, paperworkTitle, paperworkQty,
                        archiveBooks,
                        greenhousePoisonChoice,
                        theaterPhase, theaterProgress,
                        stableItemChoice, stableTradeChoice, stableTransferType, stableTransferChoice,
                        stableAnimals: facEntry.stableAnimals || stableAnimals,
                        isDamaged, repairProgress, repairTurns,
                        // Automatic Fruit Refresh: A turn is 7 days, 
                        // so fruits always reset to full during turn advancement.
                        fruitCount: facName.includes("Greenhouse") ? 3 : greenhouseFruitCount,
                        innerPeaceActive: actor.getFlag(MODULE_ID, "innerPeaceActive") || false,
                        stockedCount: facEntry.stockedCount ?? (getFacFlag("stockedCount") || 0),
                        isStocked: facEntry.isStocked ?? isStocked,
                        trainerType,
                        visitingSpellcaster, spellcasterDaysRemaining, spellcasterName
                    });
                    if (isLaboratory) gf.flags[MODULE_ID].laboratoryPoisonChoice = laboratoryPoisonChoice;
                    if (isLaboratory) gf.flags[MODULE_ID].laboratoryAlchemistChoice = laboratoryAlchemistChoice;
                    
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
                    [`flags.${MODULE_ID}.relicItemChoice`]: relicItemChoice,
                    [`flags.${MODULE_ID}.scrollChoice`]: scrollChoice, // Added scrollChoice
                    [`flags.${MODULE_ID}.greenhousePoisonChoice`]: greenhousePoisonChoice,
                    [`flags.${MODULE_ID}.bookTitle`]: bookTitle,
                    [`flags.${MODULE_ID}.paperworkTitle`]: paperworkTitle,
                    [`flags.${MODULE_ID}.paperworkQty`]: paperworkQty,
                    [`flags.${MODULE_ID}.archiveBooks`]: archiveBooks,
                    [`flags.${MODULE_ID}.theaterPhase`]: theaterPhase,
                    [`flags.${MODULE_ID}.theaterProgress`]: theaterProgress,
                    
                    [`flags.${MODULE_ID}.stableItemChoice`]: stableItemChoice,
                    [`flags.${MODULE_ID}.stableTradeChoice`]: stableTradeChoice,
                    [`flags.${MODULE_ID}.stableTransferType`]: stableTransferType,
                    [`flags.${MODULE_ID}.stableTransferChoice`]: stableTransferChoice,
                    [`flags.${MODULE_ID}.stableAnimals`]: facEntry.stableAnimals || stableAnimals,
                    [`flags.${MODULE_ID}.stockedCount`]: facEntry.stockedCount ?? (getFacFlag("stockedCount") || 0),
                    [`flags.${MODULE_ID}.fruitCount`]: facName.includes("Greenhouse") ? 3 : greenhouseFruitCount,
                    [`flags.${MODULE_ID}.isStocked`]: facEntry.isStocked ?? isStocked,
                    [`flags.${MODULE_ID}.isDamaged`]: isDamaged,
                    [`flags.${MODULE_ID}.repairProgress`]: repairProgress,
                    [`flags.${MODULE_ID}.laboratoryPoisonChoice`]: laboratoryPoisonChoice,
                    [`flags.${MODULE_ID}.laboratoryAlchemistChoice`]: laboratoryAlchemistChoice,
                    [`flags.${MODULE_ID}.repairTurns`]: repairTurns,
                    [`flags.${MODULE_ID}.trainerType`]: trainerType,

                    [`flags.${MODULE_ID}.activeProjectChoice`]: activeProjectChoice,
                    [`flags.${MODULE_ID}.visitingSpellcaster`]: visitingSpellcaster,
                    [`flags.${MODULE_ID}.spellcasterDaysRemaining`]: spellcasterDaysRemaining,
                    [`flags.${MODULE_ID}.spellcasterName`]: spellcasterName,
                    [`flags.${MODULE_ID}.size`]: facSize,
                    [`flags.${MODULE_ID}.upgradeTurns`]: upgradeTurns,
                    [`flags.${MODULE_ID}.storedGp`]: storedGp,
                    [`flags.${MODULE_ID}.autoNextAction`]: autoNextAction
                };
                
                if (facDoc.newDefenders) updates[`flags.${MODULE_ID}.defenders`] = facDoc.newDefenders;

                itemUpdates.push({ _id: facDoc.id, ...updates });
            }

            let goldLabel = "";
            if (localGold > 0) goldLabel = ` <span style="color: #2e7d32; font-weight: bold;">[Earned: ${localGold} GP]</span>`;
            else if (localGold < 0) goldLabel = ` <span style="color: #a32a22; font-weight: bold;">[Spent: ${Math.abs(localGold)} GP]</span>`;

            if (!isBasic || upgradeTurns > 0) {
                const finalResult = currentResultText + goldLabel;
                orderSummary += `<li style="margin-bottom: 6px; padding: 4px; background: rgba(0,0,0,0.03); border-radius: 3px;">
                                    <img src="${facDoc.img}" width="20" height="20" style="vertical-align: middle; border: none; margin-right: 6px; border-radius: 3px;">
                                    <b>${facDoc.name}</b> <br><span style="font-size: 0.9em; padding-left: 26px; display: block; color: #444; line-height: 1.4;">${finalResult}</span>
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
            effectivelyAllMaintaining,
            updatedFacilities: facilities // Return the updated facilities array
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
    static async _handleCraft(baseName, fac, craftChoice, itemChoiceOverride = null, currentActorGP = 0, hString = "The hireling") { 
        const MODULE_ID = "dnd-2024-bastion-manager";

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
                return { text: `${hString} has completed the work on an <b>${item?.name || "Arcane Focus"}</b>.`, item };
            }
            if (craftChoice === "Book") {
                const outPack = game.packs.get("dnd-2024-bastion-manager.bastion-output-items");
                const docs = await outPack.getDocuments();
                const itemDoc = docs.find(i => i.name === "Blank Book") || docs.find(i => i.name === "Book");
                const item = itemDoc?.toObject();
                return { text: `${hString} finishes binding a new <b>Blank Book</b>.`, item };
            }
            if (craftChoice === "Magic Item (Arcana)") {
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                if (!outPack) return { text: "Error: Output compendium missing." };
                const magicItemChoice = itemChoiceOverride;
                const index = await outPack.getIndex({fields: ["system.rarity"]});
                const entry = index.find(i => i.name.toLowerCase() === magicItemChoice?.toLowerCase());
                if (entry) {
                    const doc = await outPack.getDocument(entry._id);
                    const item = doc.toObject();
                    const itemRarity = item.system?.rarity || "Common";
                    return { text: `${hString} has successfully enchanted a <b>${itemRarity} Magic Item</b>: ${item.name}.`, item: item };
                }
            }
        } else if (baseName.includes("Sanctuary")) {
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
                        return { text: `${hString} has finished crafting a <b>${itemData.name}</b>.`, item: itemData };
                    }
                }
                return { text: `${hString} finishes work on a Sacred Focus.` };
            }
            return { text: "No craft option selected." };
        } else if (baseName.includes("Smithy")) {
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
                        return { text: `${hString} has finished forging <b>${item.name}</b>.`, item };
                    }
                }
                return { text: `${hString} completes an item using Smith's Tools.` };
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
                    return { text: `${hString} has completed work on a <b>${itemRarity} Magic Item</b>: ${item.name}.`, item: item };
                }
            }
            return { text: `Executed Craft order.` };
        } else if (baseName.includes("Workshop")) {
            const workshopItemChoice = itemChoiceOverride || (fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.workshopItemChoice) : (fac.doc.getFlag(MODULE_ID, "workshopItemChoice")));
            const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
            if (!outPack) return { text: "Error: Output compendium missing." };

            const index = await outPack.getIndex({fields: ["system.rarity", "system.price"]});
            const entry = index.find(i => i.name.toLowerCase() === workshopItemChoice?.toLowerCase());
            if (entry) {
                const doc = await outPack.getDocument(entry._id);
                const item = doc.toObject();
                const itemRarity = item.system?.rarity || "Common";
                return { text: `${hString} has finished creating <b>${item.name}</b>.`, item };
            }
            if (craftChoice === "Magic Item (Implement)") {
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                if (!outPack) return { text: "Error: Output compendium missing." };

                const index = await outPack.getIndex({fields: ["system.rarity"]});
                const entry = index.find(i => i.name.toLowerCase() === itemChoiceOverride?.toLowerCase());
                if (entry) {
                    const doc = await outPack.getDocument(entry._id);
                    const item = doc.toObject();
                    const itemRarity = item.system?.rarity || "Common";
                    return { text: `${hString} has finished crafting a <b>${itemRarity} Magic Item</b>: ${item.name}.`, item: item };
                }
            }
            return { text: `Executed Craft order.` };
         } else if (baseName.includes("Laboratory")) {
            const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
            if (!outPack) return { text: "Error: Output compendium missing." };
            const index = await outPack.getIndex({fields: ["folder", "name", "uuid"]});

            if (craftChoice === "Poison" || craftChoice === "Alchemist's Supplies") {
                const choiceName = itemChoiceOverride;
                const folderId = craftChoice === "Poison" ? "fwyUIxfHsEGOLHYc" : "mqk8IahDyEIKpvcj";
                const entry = index.find(i => i.name.toLowerCase() === choiceName?.toLowerCase() && (i.folder?.id || i.folder) === folderId);
                
                if (entry) {
                    const doc = await outPack.getDocument(entry._id);
                    const item = doc.toObject();
                    item.system.quantity = 1;
                    return { text: `${hString} has finished crafting one application of <b>${entry.name}</b>.`, item };
                }
            }
            return { text: `${hString} completes the alchemical project.` };
        } else if (baseName.includes("Sacristy")) {
            if (craftChoice === "Holy Water") {
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                const index = await outPack.getIndex();
                const entry = index.find(i => i.name === "Holy Water");
                if (entry) {
                    const doc = await outPack.getDocument(entry._id);
                    const item = doc.toObject();
                    return { text: `${hString} has completed the consecration of a flask of <b>Holy Water</b>.`, item };
                }
            }
            if (craftChoice === "Magic Item (Relic)") {
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                if (!outPack) return { text: "Error: Output compendium missing." };
                const relicItemChoice = itemChoiceOverride;
                const index = await outPack.getIndex({fields: ["system.rarity"]});
                const entry = index.find(i => i.name.toLowerCase() === relicItemChoice?.toLowerCase());
                if (entry) {
                    const doc = await outPack.getDocument(entry._id);
                    const item = doc.toObject();
                    const itemRarity = item.system?.rarity || "Common";
                    return { text: `${hString} has finished preparing a <b>${itemRarity} Magic Item</b>: ${item.name}.`, item: item };
                }
            }
            return { text: `Executed Craft order.` };
        } else if (baseName.includes("Scriptorium")) { // Scriptorium logic
            if (craftChoice === "Spell Scroll") {
                const scrollChoice = itemChoiceOverride || (fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.scrollChoice) : (fac.doc.getFlag(MODULE_ID, "scrollChoice")));
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                const index = await outPack.getIndex();
                const entry = index.find(i => i.name.toLowerCase() === scrollChoice?.toLowerCase());
                if (entry) {
                    const doc = await outPack.getDocument(entry._id); // Fetch the full document
                    const item = doc.toObject();
                    return { text: `${hString} has finished scribing <b>${item.name}</b>.`, item: item };
                }
                return { text: `${hString} finishes work on a Spell Scroll.` };
            }
            if (craftChoice === "Book Replica") {
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                const title = itemChoiceOverride;
                if (!outPack) return { text: "Error: Output compendium missing." };
                const index = await outPack.getIndex();
                const entry = index.find(i => i.name === "Book Replica");
                if (entry) {
                    const doc = await outPack.getDocument(entry._id);
                    const item = doc.toObject();
                    item.name = `${title || "Book"} Replica`;
                    return { text: `${hString} has finished making a copy of <b>${title}</b>.`, item: item };
                }
                return { text: `${hString} finishes the replica of the requested book.` };
            }
            if (craftChoice === "Paperwork") {
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                const title = itemChoiceOverride;
                const qty = fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.paperworkQty || 50) : (fac.doc.getFlag(MODULE_ID, "paperworkQty") || 50);
                if (!outPack) return { text: "Error: Output compendium missing." };
                const index = await outPack.getIndex();
                const entry = index.find(i => i.name === "Paperwork");
                if (entry) {
                    const doc = await outPack.getDocument(entry._id);
                    const item = doc.toObject();
                    item.name = `${title || "Paperwork"} (x${qty})`;
                    item.system.quantity = qty;
                    return { text: `${hString} has finished printing <b>${qty} copies of ${title}</b>.`, item: item };
                }
                return { text: `${hString} finishes producing the requested paperwork.` };
            }
            return { text: `Executed Craft order.` };
        } else if (baseName.includes("Greenhouse")) {
            const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
            if (!outPack) return { text: "Error: Output compendium missing." };
            const index = await outPack.getIndex({fields: ["folder", "name", "uuid"]});
            const greenhouseFolder = outPack.folders.find(f => f.name.toLowerCase().trim() === "greenhouse");
            const greenhouseFolderIds = greenhouseFolder ? BastionManager._getAllSubfolderIds(outPack, greenhouseFolder.id) : [];

            if (craftChoice === "Harvest: Healing Herbs" || craftChoice === "Healing Herbs") {
                const entry = index.find(i => (i.name === "Potion of Healing (Greater)" || i.name === "Potion of Greater Healing") && (greenhouseFolder ? greenhouseFolderIds.includes(i.folder?.id || i.folder) : true));
                if (entry) {
                    const doc = await outPack.getDocument(entry._id);
                    const item = doc.toObject();
                    item.system.quantity = 1;
                    return { text: `${hString} has completed the harvest of a <b>${entry.name}</b>.`, item: item };
                }
            } else if (craftChoice === "Harvest: Poison" || craftChoice === "Poison") {
                const poisonName = itemChoiceOverride;
                const entry = index.find(i => i.name.toLowerCase() === poisonName?.toLowerCase() && (greenhouseFolder ? greenhouseFolderIds.includes(i.folder?.id || i.folder) : true));
                if (entry) {
                    const doc = await outPack.getDocument(entry._id);
                    const item = doc.toObject();
                    item.system.quantity = 1;
                    return { text: `${hString} has successfully extracted one application of <b>${entry.name}</b>.`, item };
                }
            }
        }

        return { text: `Executed Craft order.` };
    }

    // --- HELPER: EMPOWER ---
    static async _handleEmpower(baseName, fac, actor, theaterPhase = "Idle", theaterProgress = 0, hString = "The hireling", psString = "The hirelings") {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const getFacFlag = (key) => fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.[key]) : (fac.doc.getFlag(MODULE_ID, key));
        const daysPerTurn = game.settings.get(MODULE_ID, "daysPerTurn") || 7;

        if (baseName.includes("Theater")) {
            let phase = theaterPhase;
            let progress = theaterProgress;
            let resultText = "";

            if (phase === "Idle") {
                const contributors = getFacFlag("theaterContributors") || [];
                const hasWriter = contributors.some(c => c.role === "Composer/Writer");
                phase = hasWriter ? "Writing" : "Rehearsing";
                progress = 0;
                resultText = `${psString} have begun preparations for a new production (${phase} phase). `;
                await BastionManager._postTheaterInvite(actor, fac, "general");
            }

            progress += daysPerTurn;

            if (phase === "Writing" && progress >= BastionManager._getEffectiveDays(14)) {
                const contributors = getFacFlag("theaterContributors") || [];
                const writers = contributors.filter(c => c.role === "Composer/Writer").map(c => c.name);
                const authorName = writers.length > 0 ? writers.join(", ") : "Theater Hirelings";
                
                phase = "Rehearsing";
                progress = 0;

                // Persist the Author and clear the contributors roster for the acting phase
                const updates = { 
                    [`flags.${MODULE_ID}.theaterAuthor`]: authorName,
                    [`flags.${MODULE_ID}.theaterContributors`]: []
                };
                if (fac.isFlag) Object.assign(fac.doc.flags[MODULE_ID], updates);
                else await fac.doc.update(updates);

                resultText += "Writing is complete; rehearsals have now begun.";
            } else if (phase === "Rehearsing" && progress >= BastionManager._getEffectiveDays(14)) {
                phase = "Performing";
                progress = 0;
                resultText += "Rehearsals are finished. The performance is now live!";
                
                await BastionManager._postTheaterInvite(actor, fac);
                
                // Create a notification to resolve checks
                await ChatMessage.create({
                    content: `
                        <div class="bastion-chat-card">
                            <h3><i class="fa-solid fa-masks-theater"></i> Theater: Rehearsals Complete</h3>
                            <p>The rehearsals for the production in <b>${actor.name}'s</b> Bastion are finished. The performance phase has begun!</p>
                            <p>Each contributor must now make a <b>DC 15 Charisma (Performance)</b> check to see if the show is a success and earn their Theater Die.</p>
                        </div>`
                });
            } else if (phase === "Performing") {
                resultText += `${psString} continue their performances indefinitely.`;
            } else {
                const totalNeeded = BastionManager._getEffectiveDays(14);
                const remaining = Math.max(0, totalNeeded - progress);
                resultText += `The ${phase} phase continues. ${remaining} days remain until the next stage.`;
            }

            return { text: resultText, theaterPhase: phase, theaterProgress: progress };
        } else if (baseName.includes("Training Area")) {
            const trainerType = getFacFlag("trainerType");

            let benefitText = "";
            if (trainerType) {
                const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                const entry = (await outPack?.getIndex({fields: ["system.description.value"]}))?.find(e => e.name === trainerType);
                if (entry?.system?.description?.value) {
                    benefitText = `<div style="margin-top: 5px; font-size: 0.9em; border-top: 1px solid rgba(0,0,0,0.1); padding-top: 5px;"><b>Trainer Benefit:</b> ${entry.system.description.value}</div>`;
                }
            }

            const trainerLabel = trainerType ? `<b>${trainerType}</b>` : "an expert trainer";
            const days = BastionManager._getEffectiveDays(7);
            return { text: `${psString} conduct training exercises led by ${trainerLabel} for ${days} days. Any character that trained here for 8 hours a day gains the associated benefit for ${days} days.${benefitText}` };
        } else if (baseName === "Meditation Chamber") {
            await actor.setFlag("dnd-2024-bastion-manager", "innerPeaceActive", true);
            return { text: `The hireling uses the Meditation Chamber to gain inner peace. The next time you roll for a Bastion event, you can roll twice and choose either result.` };
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
            return { text: `Magical runes appear on the walls of the demiplane. For the next 7 days, you gain Temporary Hit Points equal to five times your level after spending an entire Long Rest here.` };
        } else if (baseName === "Sanctum") {
            return { text: `${psString} perform daily rites. The designated beneficiary gains Temporary Hit Points equal to your level after each Long Rest for 7 days.` };
        }
        return { text: `Executed Empower order.` };
    }

    static async onTheaterAction(event, target) {
        const ds = target.dataset;
        const action = ds.subAction;
        const MODULE_ID = "dnd-2024-bastion-manager";

        let gf = this.actor.getFlag(MODULE_ID, "groupFacilities") || [];
        let fac = ds.isFlag === "true" ? gf.find(f => f._id === ds.itemId) : this.actor.items.get(ds.itemId);
        if (!fac) return;

        if (action === "join") {
            const actor = this.actor || game.actors.get(ds.actorId);
            if (!actor) return;
            const phase = ds.isFlag === "true" ? fac.flags?.[MODULE_ID]?.theaterPhase : fac.getFlag(MODULE_ID, "theaterPhase");

            // If a specific role is provided (e.g. from the Writer invite), skip the dialog
            if (ds.role) {
                const characterData = {
                    actorId: game.user.character?.id || null,
                    name: game.user.character?.name || game.user.name,
                    role: ds.role
                };
                if (!actor.testUserPermission(game.user, "OWNER")) {
                    game.socket.emit("module.dnd-2024-bastion-manager", {
                        action: "theaterJoinRequest", actorId: actor.id, itemId: ds.itemId, isFlag: ds.isFlag === "true", characterData
                    });
                    ui.notifications.info(`Request to join as ${ds.role} sent to owner.`);
                } else {
                    await BastionManager.updateTheaterContributors(actor, ds.itemId, ds.isFlag === "true", characterData);
                }
                return;
            }
            return BastionManager._promptTheaterJoin(actor, ds.itemId, ds.isFlag === "true", phase);
        } else if (action === "leave") {
            const actor = this.actor || game.actors.get(ds.actorId);
            if (!actor) return;
            const characterId = game.user.character?.id || null;
            
            if (!actor.testUserPermission(game.user, "OWNER")) {
                game.socket.emit("module.dnd-2024-bastion-manager", {
                    action: "theaterLeaveRequest", actorId: actor.id, itemId: ds.itemId, isFlag: ds.isFlag === "true", characterId
                });
                ui.notifications.info(`Request to leave production sent to owner.`);
            } else {
                await BastionManager.removeTheaterContributor(actor, ds.itemId, ds.isFlag === "true", characterId);
            }
            return;
        } else if (action === "start-writing") {
            const contributors = (ds.isFlag === "true" ? fac.flags?.[MODULE_ID]?.theaterContributors : fac.getFlag(MODULE_ID, "theaterContributors")) || [];
            if (!contributors.some(c => c.role === "Composer/Writer")) {
                return ui.notifications.warn("A Composer/Writer must join the production before writing can begin.");
            }
            const updates = { [`flags.${MODULE_ID}.theaterPhase`]: "Writing", [`flags.${MODULE_ID}.theaterProgress`]: 0 };
            if (ds.isFlag === "true") {
                for (let [k, v] of Object.entries(updates)) foundry.utils.setProperty(fac, k, v);
                await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
            } else {
                await fac.update(updates);
            }
            ui.notifications.info("Writing phase has officially begun.");
        } else if (action === "invite-writer") {
            await BastionManager._postTheaterInvite(this.actor, { doc: fac, id: ds.itemId, isFlag: ds.isFlag === "true" }, "writer");
            ui.notifications.info("Call for Composer/Writer posted to chat.");
        } else if (action === "invite") {
            await BastionManager._postTheaterInvite(this.actor, { doc: fac, id: ds.itemId, isFlag: ds.isFlag === "true" }, "general");
            ui.notifications.info("Theater invitation posted to chat.");
        } else if (action === "reset") {
            const phase = ds.isFlag === "true" ? fac.flags?.[MODULE_ID]?.theaterPhase : fac.getFlag(MODULE_ID, "theaterPhase");
            const progress = Number((ds.isFlag === "true" ? fac.flags?.[MODULE_ID]?.theaterProgress : fac.getFlag(MODULE_ID, "theaterProgress")) || 0);

            if (phase !== "Idle" && !(phase === "Performing" && progress > 0)) {
                const confirm = await DialogV2.confirm({
                    window: { title: "Reset Production" },
                    content: `<p>This production has not completed a full performance cycle yet. Resetting now will clear all progress and staffing.</p><p>Are you sure you want to end the production?</p>`,
                    rejectClose: false,
                    modal: true
                });
                if (!confirm) return;
            }

            const updates = { [`flags.${MODULE_ID}.theaterPhase`]: "Idle", [`flags.${MODULE_ID}.theaterProgress`]: 0, [`flags.${MODULE_ID}.theaterAuthor`]: "", [`flags.${MODULE_ID}.theaterContributors`]: [] };
            if (ds.isFlag === "true") {
                for (let [k, v] of Object.entries(updates)) foundry.utils.setProperty(fac, k, v);
                await this.actor.setFlag(MODULE_ID, "groupFacilities", gf);
            } else {
                await fac.update(updates);
            }
        }
        this.render();
    }

    static async _postTheaterInvite(actor, fac, type = "general") {
        const itemId = fac.id || fac.doc?.id || fac.doc?._id;
        const isFlag = !!fac.isFlag;

        let title = "Theater Production";
        let body = `A production is underway in <b>${actor.name}'s</b> Bastion!`;
        let hint = "Characters are invited to join as Directors, or Performers to contribute to the show's success.";
        
        if (type === "writer") {
            title = "Call for Composer/Writer";
            body = `<b>${actor.name}</b> is looking for a Composer or Writer to begin a new production!`;
            hint = "Accepting this role will begin the 14-day writing phase of the production.";
        }

        const roleAttr = type === "writer" ? 'data-role="Composer/Writer"' : "";
        const content = `
            <div class="bastion-chat-card theater-invite" style="border-left: 4px solid #82cfff;">
                <h3 style="border-bottom: 2px solid #82cfff; color: #004578;"><i class="fa-solid fa-masks-theater"></i> ${title}</h3>
                <p>${body}</p>
                <p style="font-size: 0.85em; font-style: italic; margin-bottom: 8px;">${hint}</p>
                <button type="button" data-action="theaterAction" data-sub-action="join" data-actor-id="${actor.id}" data-item-id="${itemId}" data-is-flag="${isFlag}" ${roleAttr} style="background: rgba(130, 207, 255, 0.2); border: 1px solid #82cfff; width: 100%;">
                    <i class="fa-solid fa-user-plus"></i> ${type === "writer" ? "Join as Writer" : "Join Role"}
                </button>
            </div>`;
        return ChatMessage.create({ content });
    }

    static async _promptTheaterJoin(actor, itemId, isFlag, phase = "Idle") {
        let roles = ["Composer/Writer", "Conductor/Director", "Performer"];
        if (phase === "Writing") roles = ["Composer/Writer"];
        else if (phase !== "Idle") roles = ["Conductor/Director", "Performer"];

        const roleOptions = roles.map(r => `<option value="${r}">${r}</option>`).join("");
        
        const role = await DialogV2.prompt({
            window: { title: "Join Production" },
            content: `<div class="form-group"><label>Select Role:</label><select name="role">${roleOptions}</select></div>`,
            ok: { callback: (event, button) => button.form.elements.role.value },
            rejectClose: false
        });

        if (!role) return;

        const characterData = {
            actorId: game.user.character?.id || null,
            name: game.user.character?.name || game.user.name,
            role: role
        };

        // If current user is not the owner, we must request update via socket
        if (!actor.testUserPermission(game.user, "OWNER")) {
            game.socket.emit("module.dnd-2024-bastion-manager", {
                action: "theaterJoinRequest", actorId: actor.id, itemId, isFlag, characterData
            });
            ui.notifications.info(`Request to join as ${role} sent to owner.`);
        } else {
            await BastionManager.updateTheaterContributors(actor, itemId, isFlag, characterData);
        }
    }

    static async updateTheaterContributors(actor, itemId, isFlag, characterData) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        let gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
        let fac = isFlag ? gf.find(f => f._id === itemId) : actor.items.get(itemId);
        if (!fac) return;

        let contributors = Array.from((isFlag ? fac.flags?.[MODULE_ID]?.theaterContributors : fac.getFlag(MODULE_ID, "theaterContributors")) || []);
        
        // Update existing or add new
        const existingIdx = contributors.findIndex(c => c.actorId === characterData.actorId && characterData.actorId !== null);
        if (existingIdx !== -1) contributors[existingIdx] = characterData;
        else contributors.push(characterData);

        if (isFlag) {
            foundry.utils.setProperty(fac, `flags.${MODULE_ID}.theaterContributors`, contributors);
            // Auto-transition to Writing if a writer joins an Idle theater
            if (characterData.role === "Composer/Writer" && (fac.flags?.[MODULE_ID]?.theaterPhase || "Idle") === "Idle") {
                foundry.utils.setProperty(fac, `flags.${MODULE_ID}.theaterPhase`, "Writing");
                foundry.utils.setProperty(fac, `flags.${MODULE_ID}.theaterProgress`, 0);
            }
            await actor.setFlag(MODULE_ID, "groupFacilities", gf);
        } else {
            await fac.setFlag(MODULE_ID, "theaterContributors", contributors);
            // Auto-transition to Writing if a writer joins an Idle theater
            if (characterData.role === "Composer/Writer" && (fac.getFlag(MODULE_ID, "theaterPhase") || "Idle") === "Idle") {
                await fac.update({
                    [`flags.${MODULE_ID}.theaterPhase`]: "Writing",
                    [`flags.${MODULE_ID}.theaterProgress`]: 0
                });
            }
        }
        
        if (game.user.id === Array.from(game.users).find(u => u.isGM && u.active)?.id) {
            ui.notifications.info(`${characterData.name} joined the production in ${actor.name}'s Bastion.`);
        }
    }

    static async removeTheaterContributor(actor, itemId, isFlag, actorId) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        let gf = actor.getFlag(MODULE_ID, "groupFacilities") || [];
        let fac = isFlag ? gf.find(f => f._id === itemId) : actor.items.get(itemId);
        if (!fac) return;

        let contributors = Array.from((isFlag ? fac.flags?.[MODULE_ID]?.theaterContributors : fac.getFlag(MODULE_ID, "theaterContributors")) || []);
        const originalCount = contributors.length;
        contributors = contributors.filter(c => c.actorId !== actorId);
        
        if (contributors.length === originalCount) return;

        const updates = { [`flags.${MODULE_ID}.theaterContributors`]: contributors };
        const currentPhase = isFlag ? (fac.flags?.[MODULE_ID]?.theaterPhase || "Idle") : (fac.getFlag(MODULE_ID, "theaterPhase") || "Idle");
        const hasWriter = contributors.some(c => c.role === "Composer/Writer");

        // If the last writer leaves during the writing phase, reset to Idle
        if (currentPhase === "Writing" && !hasWriter) {
            updates[`flags.${MODULE_ID}.theaterPhase`] = "Idle";
            updates[`flags.${MODULE_ID}.theaterProgress`] = 0;
        }

        if (isFlag) {
            for (let [k, v] of Object.entries(updates)) foundry.utils.setProperty(fac, k, v);
            await actor.setFlag(MODULE_ID, "groupFacilities", gf);
        } else {
            await fac.update(updates);
        }
        
        // Re-render local instance if it matches
        for (const app of foundry.applications.instances.values()) if (app.constructor.name === "BastionManager" && app.actor.id === actor.id) app.render();
    }

    static async _handleResearch(baseName, fac, subType, hString = "The hireling") {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const getFacFlag = (key) => fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.[key]) : (fac.doc.getFlag(MODULE_ID, key));

        if (baseName === "Library") {
            const topic = getFacFlag("libraryTopic");
            const topicText = topic ? `<b>${topic}</b>` : `a topic`;
            return { text: `${hString} has finished researching ${topicText}, obtaining up to 3 accurate pieces of information.` };

        } else if (baseName === "Archive") {
            const topic = getFacFlag("libraryTopic");
            const topicText = topic ? ` regarding <b>${topic}</b>` : "";

            const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
            const loreFolderId = "EDXX8ZLlRg2wbXb9";
            const index = await outPack?.getIndex({fields: ["folder"]});
            const loreItem = index?.find(i => (i.folder?.id || i.folder) === loreFolderId);
            const loreLink = loreItem ? `@UUID[${loreItem.uuid}]{Legend Lore}` : "<i>Legend Lore</i>";

            let loreText = `${hString} searches the archive for helpful lore${topicText}, gaining knowledge as if they cast ${loreLink}.`;
            loreText += `<div style="margin-top: 5px; font-size: 0.85em; border-top: 1px solid rgba(0,0,0,0.1); padding-top: 5px; opacity: 0.8;"><i>Legend Lore:</i> If the topic is of legendary importance, you learn a brief summary of its significant lore. If not, the search yields no information.</div>`;
            return { text: loreText };
        } else if (baseName === "Trophy Room") {
            const researchChoice = getFacFlag("craftChoice") || "Lore";
            if (researchChoice === "Trinket Trophy") {
                const roll = (await new Roll("1d2").evaluate()).total;
                if (roll === 2) { // Even success
                    const outPack = game.packs.get(`${MODULE_ID}.bastion-output-items`);
                    const index = await outPack?.getIndex({fields: ["folder", "system.rarity"]});
                    const folder = outPack?.folders.find(f => f.name.toLowerCase().includes("implement"));
                    
                    if (index && folder) {
                        const possible = index.filter(i => (i.folder?.id || i.folder) === folder.id && i.system.rarity?.toLowerCase() === "common");
                        if (possible.length > 0) {
                            const chosen = possible[Math.floor(Math.random() * possible.length)];
                            const doc = await outPack.getDocument(chosen._id);
                            const item = doc.toObject();
                            return { text: `${hString} searched through the trophies and discovered a useful trinket: <b>${item.name}</b>!`, item };
                        }
                    }
                    return { text: `${hString} found a valuable implement among the trophies, but no specific item data was found in the compendium.` };
                }
                return { text: `${hString} spent the week searching the trophies but found nothing of immediate use (Roll: ${roll}).` };
            }
            const topic = getFacFlag("libraryTopic");
            return { text: `${hString} studied the trophies to research <b>${topic || "a significant topic"}</b>, discovering up to 3 accurate pieces of information.` };
        } else if (baseName === "Pub") {
            return { text: `${hString} taps into their local spy network to gather rumors and information.` };
        }
        return { text: `Executed Research order.` };
    }

    // --- HELPER: RECRUIT ---
    static async _handleRecruit(baseName, fac, actor, hString = "The hireling") {
        let facDefendersCount = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.defenders?.count || 0) : (fac.doc.getFlag("dnd-2024-bastion-manager", "defenders.count") || 0);
        let facDefenderNames = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.defenders?.names || []) : (fac.doc.getFlag("dnd-2024-bastion-manager", "defenders.names") || []);
        
        let maxDefenders = 12; // Assuming roomy by default
        const facSize = fac.isFlag ? (fac.doc.flags?.["dnd-2024-bastion-manager"]?.size || "Roomy") : (fac.doc.getFlag("dnd-2024-bastion-manager", "size") || "Roomy");
        if (facSize === "Vast") maxDefenders = 25;

        if (facDefendersCount >= maxDefenders) {
            return { text: `${hString} reports that recruitment failed because the facility is fully occupied.`, newCount: facDefendersCount, newNames: facDefenderNames };
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
            
            let resultText = `${hString} has successfully recruited <b>${newlyRecruited}</b> Bastion Defender(s).`;
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
            return { gold: goldRoll.total, text: `The hirelings turn the hall into a gambling den, and after 7 days, your share of the house winnings is <b title="Roll Calculation: ${formula}">${goldRoll.total} GP</b> (Roll: ${roll100}).` };
        } else {
            const roll = await new Roll("1d6 * 10").evaluate();
            return { gold: roll.total, text: `Generated ${roll.total} GP.` };
        }
    }

    // --- HELPER: HARVEST ---
    static async _handleHarvest(baseName, subType, fac, isSecondPlot = false, hString = "The hireling") {
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
        return { item: itemObj, text: `${hString} has harvested ${itemObj.system?.quantity || 1}x ${itemObj.name}.` };
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

    static _generateSpellcasterName() {
        const titles = ["the Magnificent", "the Conjurer", "the Wise", "the Eternal", "the Architect", "the Weaver", "the Gazer", "the Archmage", "the Adept", "the Radiant", "the Shadow", "the Timeless", "the Resplendent", "the Unfettered"];
        const title = titles[Math.floor(Math.random() * titles.length)];
        return `${this._generateRandomName()} ${title}`;
    }

    static _generateRandomName() {
        const names = ["Adrik", "Alberich", "Baern", "Barendd", "Brottor", "Bruenor", "Dain", "Darrak", "Delg", "Eberk", "Einkil", "Fargrim", "Flint", "Gardain", "Harbek", "Kildrak", "Oskar", "Rangrim", "Rurik", "Thoradin", "Thorin", "Tordek", "Traubon", "Travok", "Ulfgar", "Veit", "Vondal", "Amber", "Artin", "Audhild", "Bardryn", "Dagnal", "Diesa", "Eldeth", "Falkrunn", "Finellen", "Gunnloda", "Gurdis", "Helja", "Hlin", "Kathra", "Kristryd", "Ilde", "Liftrasa", "Mardred", "Riswynn", "Sannl", "Torbera", "Torgga", "Vistra", "Aseir", "Bardeid", "Haseid", "Khemed", "Mehmen", "Sudeiman", "Zasheir", "Atala", "Ceidil", "Hama", "Jasmal", "Meilil", "Seipora", "Yasheira", "Zasheida", "Bor", "Fodel", "Glar", "Grigor", "Igan", "Ivor", "Kosef", "Mival", "Orel", "Pavel", "Sergor", "Alethra", "Kara", "Katernin", "Mara", "Natali", "Olma", "Tana", "Zora", "Ander", "Blath", "Bran", "Frath", "Geth", "Lander", "Luth", "Lucan", "Murn", "Muth", "Stedd", "Amafrey", "Betha", "Catelyn", "Ethani", "Ilda", "Lisvet", "Lura", "Madel", "Miri", "Nala", "Quara", "Selise", "Viana", "Anton", "Diero", "Falcone", "Federico", "Geno", "Luigi", "Marcello", "Nico", "Piero", "Tommaso", "Arveene", "Esvele", "Jhessail", "Kerri", "Lureene", "Miri", "Rowan", "Shandri", "Tessele", "Aoth", "Barakas", "Damakos", "Iados", "Kairon", "Leucis", "Melech", "Mordai", "Morthos", "Pelaios", "Skamos", "Therai", "Akta", "Anakis", "Bryseis", "Criella", "Damaia", "Ea", "Kallista", "Lerissa", "Makaria", "Nemeia", "Orianna", "Phelia", "Rieta"];
        return names[Math.floor(Math.random() * names.length)];
    }

    static _getHirelingProfession(facName, subType) {
        if (!this._professionsMap) return "(Hireling)";
        const name = facName.trim();
        const sub = subType?.trim();

        // 1. Check for specialization match first: "Garden (Herb)"
        if (sub) {
            const specKey = `${name} (${sub})`;
            if (this._professionsMap[specKey]) return `the ${this._professionsMap[specKey]}`;
        }

        // 2. Check for exact name match: "Library"
        if (this._professionsMap[name]) return `the ${this._professionsMap[name]}`;

        // 3. Robust partial match fallback
        const lowerName = name.toLowerCase();
        const entry = Object.entries(this._professionsMap).find(([k]) => {
            const lowerK = k.toLowerCase();
            return lowerName.includes(lowerK) || lowerK.includes(lowerName);
        });

        if (entry) return `the ${entry[1]}`;

        return "(Hireling)";
    }

    // --- HELPER: CHAT ---
    static async _processEventRoll(roll, actor, isReroll = false, currentFacilitiesState = null) {
        const promptAll = game.settings.get("dnd-2024-bastion-manager", "promptAllEvents");
        const MODULE_ID = "dnd-2024-bastion-manager";
        let cat = "", desc = "", auto = "";

        // Use unified facilities if combined
        const facs = currentFacilitiesState || BastionManager._getActorFacilities(actor, true);
        
        let allHirelings = [];
        let specialFacilities = [];
        for (const fac of facs) {
            const isBasic = fac.doc.system?.type?.value === "basic";
            if (!isBasic) specialFacilities.push(fac.name);
            
            const hirelings = fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.hirelings) : (fac.doc.getFlag(MODULE_ID, "hirelings"));
            if (Array.isArray(hirelings)) {
                let subType = fac.isFlag ? (fac.doc.flags?.[MODULE_ID]?.subType) : (fac.doc.getFlag(MODULE_ID, "subType"));
                let prof = BastionManager._getHirelingProfession(fac.name, subType);
                for (const h of hirelings) {
                    allHirelings.push({ name: h, facility: fac.name, prof: prof });
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
            cat = "All Is Well"; desc = "Nothing significant happens. Roll on the following table, fleshing out the details as you see fit.";
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
                auto = flavor[fRoll - 1];
            }
        } else if (roll <= 55) { 
            cat = "Attack"; desc = "A hostile force attacks your Bastion but is defeated. Roll 6d6; for each die that rolls a 1, one Bastion Defender dies. Remove these Bastion Defenders from your Bastion's roster. If the Bastion has zero Bastion Defenders, one of the Bastion's special facilities (determined randomly) is damaged and forced to shut down. A special facility that shuts down can't be used on your next Bastion turn, after which it is repaired and made operational again at no cost to you.";
            const departing = [];

            facs.forEach(f => {
                const isPresent = f.isFlag ? f.doc.flags?.[MODULE_ID]?.visitingSpellcaster : f.doc.getFlag(MODULE_ID, "visitingSpellcaster");
                if (isPresent) departing.push(f.name);
            });
            if (departing.length > 0) {
                auto += `<p style="color: darkred; font-size: 0.85em; margin-top: 5px;"><i class="fa-solid fa-person-running"></i> Visiting spellcaster(s) from <b>${departing.join(", ")}</b> departed immediately due to the chaos.</p>`;
            }
            if (promptAll) auto = mkRes(mkAutoBtn('attack'));
            else { // This branch is for the initial auto-resolution in the chat message
                const attackRes = await BastionManager._resolveAttackAutomation(actor, facs);
                auto = attackRes.html;
            }
        } else if (roll <= 58) { 
            const h2 = getRandomHireling();
            cat = "Criminal Hireling"; 
            const identity = h2 ? `<b>${h2.name} the ${h2.prof}</b>` : "One of your Bastion's hirelings";
            desc = `${identity} has a criminal past that comes to light when officials or bounty hunters visit your Bastion with a warrant for the hireling's arrest. You can retain the hireling by paying a bribe of 1d6 × 100 GP. Otherwise, the hireling is arrested and taken away. If this loss leaves one of your facilities without any hirelings, that facility can't be used on your next Bastion turn. The hireling is then replaced at no cost to you.`;
            auto = mkRes(`<span style="margin-right: 5px;">Pay 1d6x100 GP to keep ${h2 ? h2.name : "them"}, OR let them be arrested?</span>` + mkBtn('criminal', 'pay', 'Pay Bribe') + mkBtn('criminal', 'arrest', 'Let Arrested'));
        } else if (roll <= 63) { 
            cat = "Extraordinary Opportunity"; desc = "Your Bastion is given the opportunity to host an important festival or celebration, fund the research of a powerful spellcaster, or appease a domineering noble. Work with the DM to determine the details. If you seize the opportunity, you must pay 500 GP to cover costs. In return, your Bastion gains a sudden influx of recognition or attention, prompting the DM to roll again on the Bastion Events table (rerolling this result if it comes up again). If you decline the opportunity, you don't pay the money and nothing else happens.";
            if (isReroll) auto = `Paid <b>500 GP</b> to seize this opportunity.`;
            else auto = mkRes(`<span style="margin-right: 5px;">Pay 500 GP to seize the opportunity?</span>` + mkBtn('opportunity', 'pay', 'Pay 500 GP') + mkBtn('opportunity', 'decline', 'Decline'));
        } else if (roll <= 72) { 
            cat = "Friendly Visitors"; desc = "Friendly visitors come to your Bastion, seeking to use one of your special facilities. They offer 1d6 × 100 GP for the brief use of that facility. For example, a knight might want your Smithy to replace a horseshoe or repair a damaged weapon or suit of armor, or sages might need your Arcane Study to help them settle a dispute. Their use of the facility doesn't interrupt any orders you've issued to it.";
            auto = mkRes(`<span style="margin-right: 5px;">Allow use for 1d6x100 GP?</span>` + mkBtn('visitors', 'accept', 'Accept') + mkBtn('visitors', 'decline', 'Decline'));
        } else if (roll <= 76) { 
            cat = "Guest"; desc = "A Friendly guest comes to stay at your Bastion. Determine the guest by rolling on the following table, and work with your DM to flesh out the details.";
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
            cat = "Lost Hirelings"; desc = `One of your Bastion's special facilities, the <b>${f1}</b>, loses its hirelings. The cause of their departure is up to you. The facility can't be used on your next Bastion turn, but the hirelings are replaced at no cost to you at that point.`; 
            auto = `The <b>${f1}</b> is unusable next turn.`; 
        } else if (roll <= 83) { 
            const h3 = getRandomHireling();
            cat = "Magical Discovery"; 
            const actorStr = h3 ? `<b>${h3.name} the ${h3.prof}</b> discovers` : "Your hirelings discover";
            desc = `${actorStr} or accidentally create an Uncommon magic item of your choice at no cost to you. The magic item must be a Potion or Scroll.`; 
            auto = `Gain one <b>Uncommon Potion</b> or <b>Uncommon Scroll</b> of your choice.`; 
        } else if (roll <= 91) { 
            cat = "Refugees"; desc = "A group of 2d4 refugees fleeing from a monster attack, a natural disaster, or some other calamity seeks refuge in your Bastion. If your Bastion lacks a basic facility large enough to house them, the refugees camp right outside the Bastion. The refugees offer you 1d6 × 100 GP as payment for your hospitality and protection. They stay until you find them a new home or a hostile force attacks your Bastion."; 
            auto = mkRes(`<span style="margin-right: 5px;">Allow 2d4 refugees to stay for a 1d6x100 GP reward?</span>` + mkBtn('refugees', 'accept', 'Offer Protection') + mkBtn('refugees', 'decline', 'Turn Away'));
        } else if (roll <= 98) { 
            cat = "Request for Aid"; desc = "Your Bastion is called on to help a local leader. Perhaps there's a search on for a missing person, or brigands are plaguing the area. If you help, you must dispatch one or more Bastion Defenders. Roll 1d6 for each Bastion Defender you send. If the total is 10 or higher, the problem is solved and you earn a reward of 1d6 × 100 GP. If the total is less than 10, the problem is still solved, but the reward is halved and one of your Bastion Defenders is killed. Remove that Bastion Defender from your Bastion's roster."; 
            
            let totalAvailableDefenders = 0;
            for (const f of facs) {
                const dData = f.isFlag ? f.doc.flags?.[MODULE_ID]?.defenders : f.doc.getFlag(MODULE_ID, "defenders");
                totalAvailableDefenders += (dData?.count || 0);
            }

            if (totalAvailableDefenders === 0) {
                auto = mkRes(`<span style="color: #a32a22; font-style: italic; margin-right: 10px;"><i class="fa-solid fa-circle-exclamation"></i> No defenders available.</span>` + mkBtn('aid', 'decline', 'Acknowledge'));
            } else {
                auto = mkRes(`<span style="margin-right: 5px;">Send Defenders?</span><input type="number" class="aid-count" value="1" min="1" max="${totalAvailableDefenders}" style="width: 40px; margin-right: 5px; height: 26px; text-align: center;">` + `<button type="button" class="aid-max-btn" style="width: auto; padding: 2px 6px; font-size: 0.75em; margin-right: 5px; background: rgba(0,0,0,0.1); border: 1px solid var(--color-border-light-2); border-radius: 3px; cursor: pointer;">Max</button>` + mkBtn('aid', 'send', 'Send Defenders') + mkBtn('aid', 'decline', 'Decline'));
            }
        } else { 
            cat = "Treasure"; desc = "Your Bastion acquires an art object or a magic item. How the Bastion acquires this treasure is up to you. It might represent an inheritance, a gift from a guest or an admirer, a theft, or a fortunate discovery. If you're in the Bastion, you can claim the treasure immediately; otherwise, it is placed in storage until you can claim it."; 
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
        const MODULE_ID = "dnd-2024-bastion-manager";

        if (allMaintaining) {
            dmHtml += `<div style="margin-bottom: 15px;">
                <h3 style="margin-bottom: 5px; color: #a32a22; border-bottom: 1px solid #ccc;">${actor.name}</h3>`;
                
            const combinedId = actor.getFlag(MODULE_ID, "combinedGroupId");
            const hasInnerPeace = actor.getFlag(MODULE_ID, "innerPeaceActive") || false;
            let innerPeaceUsedThisTurn = false;

            if (!res.rolledEvents) res.rolledEvents = new Map();

            for (let t = 0; t < turns; t++) {
                const turnKey = `${combinedId}_${t}`;
                let rollTotal;
                let roll2 = null;
                let isDuplicate = false;

                if (combinedId && res.rolledEvents.has(turnKey)) {
                    const stored = res.rolledEvents.get(turnKey);
                    if (typeof stored === "object") {
                        rollTotal = stored.r1;
                        roll2 = stored.r2;
                    } else rollTotal = stored;
                    isDuplicate = true;
                } else {
                    const isManual = game.settings.get(MODULE_ID, "manualEventSelection");
                    
                    if (hasInnerPeace && !innerPeaceUsedThisTurn) {
                        const r1 = (await new Roll("1d100").evaluate()).total;
                        const r2 = (await new Roll("1d100").evaluate()).total;
                        rollTotal = r1;
                        roll2 = r2;
                        innerPeaceUsedThisTurn = true;
                        if (combinedId) res.rolledEvents.set(turnKey, { r1, r2 });
                    } else {
                        rollTotal = (await new Roll("1d100").evaluate()).total;
                        if (combinedId) res.rolledEvents.set(turnKey, rollTotal);
                    }

                    if (isManual && game.user.isGM) {
                        rollTotal = await BastionManager._promptEventSelection(actor, t + 1);
                    } else {
                        const eventRoll = await new Roll("1d100").evaluate();
                        rollTotal = eventRoll.total;
                    }
                    if (combinedId) res.rolledEvents.set(turnKey, rollTotal);
                }

                // Only report the full event details for the "primary" actor in a group
                if (isDuplicate) continue;

                let turnLabel = turns > 1 ? `<b>Turn ${t + 1}:</b> ` : "";
                
                const ev = await BastionManager._processEventRoll(rollTotal, actor, false, null);
                let eColor = rollTotal <= 50 ? "#a8d5a2" : (rollTotal <= 58 || (rollTotal >= 77 && rollTotal <= 79) ? "#f28b82" : "#99c1f1");

                dmHtml += `
                    <div style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(0,0,0,0.15);">
                        ${roll2 ? `<div style="background: rgba(130,207,255,0.1); border: 1px solid #82cfff; padding: 5px; border-radius: 4px; margin-bottom: 10px; font-size: 0.9em;"><i class="fa-solid fa-brain"></i> <b>Inner Peace:</b> Choose one of the two following events.</div>` : ""}
                        <p style="margin: 0; font-size: 1.15em; color: ${eColor}; font-weight: bold;">${turnLabel}🎲 ${rollTotal} — ${ev.cat}</p>
                        <p style="font-size: 0.95em; margin: 8px 0; line-height: 1.4;">${ev.desc}</p>
                        ${ev.auto ? `<div style="margin-top: 8px; border-top: 1px dashed rgba(0,0,0,0.1); padding-top: 5px;">${ev.auto}</div>` : ""}`;

                if (roll2) {
                    const ev2 = await BastionManager._processEventRoll(roll2, actor, false, null);
                    let eColor2 = roll2 <= 50 ? "#a8d5a2" : (roll2 <= 58 || (roll2 >= 77 && roll2 <= 79) ? "#f28b82" : "#99c1f1");
                    dmHtml += `
                        <div style="margin-top: 15px; padding-top: 10px; border-top: 2px solid #82cfff;">
                            <p style="margin: 0; font-size: 1.15em; color: ${eColor2}; font-weight: bold;">🎲 ${roll2} — ${ev2.cat}</p>
                            <p style="font-size: 0.95em; margin: 8px 0; line-height: 1.4;">${ev2.desc}</p>
                            ${ev2.auto ? `<div style="margin-top: 8px; border-top: 1px dashed rgba(0,0,0,0.1); padding-top: 5px;">${ev2.auto}</div>` : ""}
                        </div>`;
                }

                dmHtml += `</div>`;

                if (ev.cat !== "All Is Well") {
                    let existingEvent = publicSummaryEvents.find(e => e.cat === ev.cat);
                    if (existingEvent) existingEvent.count++;
                    else publicSummaryEvents.push({ cat: ev.cat, count: 1 });
                }
                if (roll2) {
                    publicSummaryEvents.push({ cat: "Choice of Two Events", count: 1 });
                }
            }

            dmHtml += `</div>`;
            
            if (innerPeaceUsedThisTurn) await actor.setFlag(MODULE_ID, "innerPeaceActive", false);


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

        // Post the public turn recap to the chat log
        await ChatMessage.create({ content: combinedPubHtml });

        // Show a single DM whisper/dialog combining all events
        if (hasDmEvents) {
            if (game.user.isGM) {
                new EventResolverApp({ dmHtml: combinedDmHtml }).render({ force: true });
            }
        }
    }

    /**
     * Prompt the GM to manually select a Bastion event.
     */
    static async _promptEventSelection(actor, turnNum = 1) {
        const options = BASTION_EVENTS_LIST.map(e => `<option value="${e.roll}">${e.label}</option>`).join("");
        const content = `
            <p>Select a Bastion Event for <b>${actor.name}</b> (Turn ${turnNum}):</p>
            <div class="form-group">
                <label>Event:</label>
                <select name="eventRoll">${options}</select>
            </div>
        `;

        return await DialogV2.prompt({
            window: { title: "Choose Bastion Event" },
            content: content,
            ok: { callback: (event, button) => parseInt(button.form.elements.eventRoll.value) },
            rejectClose: false
        });
    }

    /**
     * Centralized logic for automating the Attack Bastion event.
     * Calculates dice, handles deaths, updates graveyard, and returns templated HTML.
     */
    static async _resolveAttackAutomation(actor, facs) {
        const MODULE_ID = "dnd-2024-bastion-manager";
        const armoryFac = facs.find(f => f.name.toLowerCase().includes("armory"));
        
        let stockedCount = 0;
        let isStockedBool = false;
        
        if (armoryFac) {
            // Read from wrapper property (live update) or fallback to document flags (stored state)
            const getFlag = (key) => armoryFac.isFlag 
                ? (armoryFac.doc.flags?.[MODULE_ID]?.[key]) 
                : (armoryFac.doc.getFlag(MODULE_ID, key));

            stockedCount = Number(armoryFac.stockedCount ?? getFlag("stockedCount") ?? 0) || 0;
            isStockedBool = !!(armoryFac.isStocked ?? getFlag("isStocked"));
        }

        const defenderPool = [];
        facs.forEach(f => {
            const dData = f.isFlag ? f.doc.flags?.[MODULE_ID]?.defenders : f.doc.getFlag(MODULE_ID, "defenders");
            const count = dData?.count || 0; 
            const names = dData?.names || [];
            for (let i = 0; i < count; i++) {
                defenderPool.push({ name: names[i] || `Unnamed Defender`, facId: f.isFlag ? f.doc._id : f.doc.id, isFlag: f.isFlag });
            }
        });

        const totalDefenders = defenderPool.length;
        // Executive Decision: Scale dice based on ratio of stock to total defenders.
        // Fallback: If isStocked is true but count is 0/missing, assume full coverage for existing defenders.
        const effectiveStock = (isStockedBool && stockedCount === 0) ? totalDefenders : stockedCount;
        const numD8s = (totalDefenders > 0 && isStockedBool) ? Math.round(6 * Math.clamp(effectiveStock / totalDefenders, 0, 1)) : 0;
        const numD6s = 6 - numD8s;

        let formula = "";
        let atkRoll = null;
        let ones = 0;

        if (totalDefenders > 0) {
            const diceParts = [];
            if (numD8s > 0) diceParts.push(`${numD8s}d8`);
            if (numD6s > 0) diceParts.push(`${numD6s}d6`);
            formula = diceParts.join(" + ") || "6d6";
            atkRoll = await new Roll(formula).evaluate();
            ones = atkRoll.dice.flatMap(d => d.results).filter(r => r.result === 1).length;
        }

        const deaths = Math.min(totalDefenders, ones);
        const deceasedNames = [];

        if (deaths > 0) {
            const shuffled = defenderPool.sort(() => 0.5 - Math.random());
            const killed = shuffled.slice(0, deaths);
            const updatesByOwner = {};
            for (const d of killed) {
                deceasedNames.push(d.name);
                const oId = d.owner.id;
                if (!updatesByOwner[oId]) updatesByOwner[oId] = {};
                if (!updatesByOwner[oId][d.facId]) updatesByOwner[oId][d.facId] = { isFlag: d.isFlag, deaths: 0, deceased: [] };
                updatesByOwner[oId][d.facId].deaths++;
                updatesByOwner[oId][d.facId].deceased.push(d.name);
            }

            for (const [ownerId, facUpdates] of Object.entries(updatesByOwner)) {
                const targetActor = game.actors.get(ownerId);
                if (!targetActor) continue;

                const allGf = Array.from(targetActor.getFlag(MODULE_ID, "groupFacilities") || []);
                let gfChanged = false;
                let itemUpdates = [];

                for (const [id, data] of Object.entries(facUpdates)) {
                    if (data.isFlag) {
                        const fac = allGf.find(f => f._id === id);
                        if (fac) {
                            if (!fac.flags) fac.flags = {}; if (!fac.flags[MODULE_ID]) fac.flags[MODULE_ID] = {};
                            const current = fac.flags[MODULE_ID].defenders || { count: 0, names: [] };
                            let updatedNames = [...current.names];
                            data.deceased.forEach(deadName => {
                                const idx = updatedNames.indexOf(deadName);
                                if (idx !== -1) updatedNames.splice(idx, 1);
                            });
                            fac.flags[MODULE_ID].defenders = { count: Math.max(0, current.count - data.deaths), names: updatedNames };
                            gfChanged = true;
                        }
                    }
                    else {
                    const item = targetActor.items.get(id);
                    if (item) {
                        const current = item.getFlag(MODULE_ID, "defenders") || { count: 0, names: [] };
                        let updatedNames = [...current.names];
                        data.deceased.forEach(deadName => {
                                const idx = updatedNames.indexOf(deadName);
                                if (idx !== -1) updatedNames.splice(idx, 1);
                            });
                            itemUpdates.push({ _id: id, [`flags.${MODULE_ID}.defenders`]: { count: Math.max(0, current.count - data.deaths), names: updatedNames } });
                        }
                    }
                }
            if (gfChanged) await targetActor.setFlag(MODULE_ID, "groupFacilities", allGf);
                if (itemUpdates.length > 0) await targetActor.updateEmbeddedDocuments("Item", itemUpdates);

                const graveyard = Array.from(targetActor.getFlag(MODULE_ID, "graveyard") || []);
                const turn = targetActor.getFlag(MODULE_ID, "turnCount") || 0;
                const date = new Date().toLocaleDateString();
                facUpdates.deceasedNames?.forEach(n => graveyard.push({ name: n, date, turn })); // This was a mismatch, logic revised below
                // Re-calculating owner-specific deceased for graveyard
                const ownerDeceased = Object.values(facUpdates).flatMap(u => u.deceased || []);
                ownerDeceased.forEach(n => graveyard.push({ name: n, date, turn }));
                await targetActor.setFlag(MODULE_ID, "graveyard", graveyard);
            }
        }

        if (isStockedBool && armoryFac) {
            const updates = { [`flags.${MODULE_ID}.isStocked`]: false, [`flags.${MODULE_ID}.stockedCount`]: 0 };
            if (armoryFac.isFlag) {
                const gf = Array.from(actor.getFlag(MODULE_ID, "groupFacilities") || []);
                const target = gf.find(f => f._id === armoryFac.doc._id);
                if (target) {
                    foundry.utils.setProperty(target, `flags.${MODULE_ID}.isStocked`, false);
                    foundry.utils.setProperty(target, `flags.${MODULE_ID}.stockedCount`, 0);
                    await actor.setFlag(MODULE_ID, "groupFacilities", gf);
                }
            } else await armoryFac.doc.update(updates);
        }

        // Departing spellcasters logic
        const departing = [];
        facs.forEach(f => {
            const flags = f.isFlag ? f.doc.flags?.[MODULE_ID] : f.doc.getFlag(MODULE_ID);
            if (flags?.visitingSpellcaster) departing.push(f.name);
        });

        if (departing.length > 0 && actor) {
            const gf = Array.from(actor.getFlag(MODULE_ID, "groupFacilities") || []);
            let gfChanged = false;
            for (const fac of gf) {
                if (fac.flags?.[MODULE_ID]?.visitingSpellcaster) {
                    foundry.utils.setProperty(fac, `flags.${MODULE_ID}.visitingSpellcaster`, false);
                    foundry.utils.setProperty(fac, `flags.${MODULE_ID}.spellcasterDaysRemaining`, 0);
                    gfChanged = true;
                }
            }
            if (gfChanged) await actor.setFlag(MODULE_ID, "groupFacilities", gf);
            for (const i of actor.items.filter(i => i.type === "facility" && i.getFlag(MODULE_ID, "visitingSpellcaster"))) {
                await i.update({ [`flags.${MODULE_ID}.visitingSpellcaster`]: false, [`flags.${MODULE_ID}.spellcasterDaysRemaining`]: 0 });
            }
        }

        let armoryMsg = numD8s > 0 ? `<p style="color: #2e7d32; font-size: 0.95em; margin-bottom: 4px;"><i class="fa-solid fa-shield-halved"></i> <b>${numD8s === 6 ? "Superior" : "Partial"} Equipment:</b> Defenders utilized armory stock, upgrading <b>${numD8s}</b> dice to d8s.</p>` : "";
        let spellcasterMsg = departing.length > 0 ? `<p style="color: darkred; font-size: 0.95em; margin-top: 8px; border-top: 1px dashed rgba(255,0,0,0.3); padding-top: 5px;"><i class="fa-solid fa-person-running"></i> Visiting spellcaster(s) from <b>${departing.join(", ")}</b> departed immediately due to the chaos.</p>` : "";

        let definitiveMsg = "";
        const remaining = totalDefenders - deaths;
        const nameList = deceasedNames.length > 1 ? deceasedNames.slice(0, -1).join(", ") + " and " + deceasedNames.slice(-1) : (deceasedNames[0] || "an unnamed defender");
        
        let diceHtml = "";
        if (atkRoll) {
            diceHtml = atkRoll.dice.flatMap(d => d.results.map(r => {
                const isOne = r.result === 1;
                const faces = d.faces;
                return `<div style="position: relative; display: inline-block;">
                    <span style="display: inline-block; width: 28px; height: 28px; line-height: 28px; text-align: center; background-image: url('icons/svg/d${faces}-grey.svg'); background-size: contain; background-repeat: no-repeat; color: ${isOne ? '#ff4d4d' : 'white'}; font-weight: bold; font-size: 0.95em; margin: 0 2px; filter: drop-shadow(0 0 1px black);" title="d${faces} result">${r.result}</span>
                </div>`;
            })).join("");
        }

        if (totalDefenders === 0) {
            const specialFacs = facs.filter(f => {
                const doc = f.doc;
                const type = f.isFlag ? doc.system?.type?.value : doc.system?.type?.value;
                const name = f.name.toLowerCase();
                const basicNames = ["bedroom", "dining room", "parlor", "courtyard", "kitchen", "storage"];
                return type !== "basic" && !name.includes("basic") && !basicNames.some(bn => name.includes(bn));
            });

            if (specialFacs.length > 0) {
                const target = specialFacs[Math.floor(Math.random() * specialFacs.length)];
                const progIncrement = (game.settings.get(MODULE_ID, "calculationMode") === "days") ? (game.settings.get(MODULE_ID, "daysPerTurn") || 7) : 1;
                const updates = { [`flags.${MODULE_ID}.isDamaged`]: true, [`flags.${MODULE_ID}.repairProgress`]: 0, [`flags.${MODULE_ID}.repairTurns`]: progIncrement };
                
                if (target.isFlag) {
                    const allGf = Array.from(actor.getFlag(MODULE_ID, "groupFacilities") || []);
                    const gf = allGf.find(f => f._id === target.doc._id);
                    if (gf) {
                        if (!gf.flags) gf.flags = {}; if (!gf.flags[MODULE_ID]) gf.flags[MODULE_ID] = {};
                        Object.assign(gf.flags[MODULE_ID], { isDamaged: true, repairProgress: 0, repairTurns: progIncrement });
                        await actor.setFlag(MODULE_ID, "groupFacilities", allGf);
                    }
                } else await target.doc.update(updates);
                definitiveMsg = `No defenders were present to hold the walls. The <b>${target.name}</b> has been damaged and forced to shut down.`;
            } else {
                definitiveMsg = `No defenders were present to hold the walls. A special facility has been damaged and forced to shut down.`;
            }
        } else if (deaths === 0) {
            definitiveMsg = `No defenders died in the assault. <b>${remaining}</b> remain to guard the Bastion.`;
        } else {
            const dieText = deaths === 1 ? "defender died" : "defenders died";
            const rememberText = deceasedNames.length ? `<b>${nameList}</b> will be remembered for their service. ` : "";
            definitiveMsg = `<b>${deaths}</b> ${dieText} in the assault. ${rememberText}<b>${remaining}</b> remain to guard the Bastion.`;
            if (remaining === 0) definitiveMsg += ` A special facility has been damaged and forced to shut down.`;
        }

        const html = `
            <h3 style="border-bottom: 2px solid #a32a22; padding-bottom: 3px; margin-bottom: 8px; margin-top: 10px;"><i class="fa-solid fa-swords"></i> Bastion Attack!</h3>
            ${armoryMsg}
            <div style="margin-bottom: 8px;">${definitiveMsg}</div>
            ${atkRoll ? `
                <details style="margin: 10px 0; border: none; background: none;">
                    <summary style="cursor: pointer; font-size: 0.9em; color: #666; font-weight: bold; outline: none; list-style: none;">
                        <i class="fa-solid fa-dice" style="margin-right: 4px; opacity: 0.7;"></i> Defense Rolls (Formula: ${formula})
                    </summary>
                    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 8px; padding-left: 5px;">
                        ${diceHtml}
                    </div>
                </details>
            ` : ""}
            ${spellcasterMsg}`;
        return { html, deaths, deceasedNames };
    }
}

class EventResolverApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "bastion-event-resolver",
        window: { title: "Global Bastion Report", resizable: true },
        position: { width: 550, height: "auto" }
    };

    constructor(options = {}) {
        super(options);
        this.dmHtml = options.dmHtml;
    }

    async _renderHTML(context, options) {
        return `<div style="font-family: var(--font-primary); padding: 8px;">${this.dmHtml}</div>`;
    }

    _replaceHTML(result, content, options) {
        content.innerHTML = result;
    }

    _onRender(context, options) {
        super._onRender(context, options);

        // Aid Count Input Validation: Revert to max if exceeded
        this.element.querySelectorAll('input.aid-count').forEach(input => {
            input.addEventListener('change', (ev) => {
                const max = parseInt(ev.target.max) || 1;
                let val = parseInt(ev.target.value);
                if ( isNaN(val) || val < 1 ) ev.target.value = 1;
                else if ( val > max ) ev.target.value = max;
            });
        });

        // Aid Max Button Listener
        this.element.querySelectorAll('.aid-max-btn').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                const container = ev.target.closest('.event-resolution');
                const input = container.querySelector('input.aid-count');
                if ( input ) {
                    input.value = input.max;
                    input.dispatchEvent(new Event('change'));
                }
            });
        });

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
                            "Accident reports are way down.", "The leak in the roof has been fixed.", "No vermin infestations to report.",
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
                        if (a) {
                             const facs = BastionManager._getActorFacilities(a);
                             const attackRes = await BastionManager._resolveAttackAutomation(a, facs);
                             resultText = attackRes.html;
                        }
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
                        const maxDefenders = parseInt(input?.max) || count;
                        // Clamp the count between 1 and the available defenders
                        count = Math.max(1, Math.min(count, maxDefenders));
                        
                        const aidRoll = await new Roll(`${count}d6`).evaluate();
                        const dTotal = aidRoll.total;
                        const diceHtml = aidRoll.dice.flatMap(d => d.results.map(r => {
                            return `<span style="display: inline-block; width: 28px; height: 28px; line-height: 28px; text-align: center; background-image: url('icons/svg/d${d.faces}-grey.svg'); background-size: contain; background-repeat: no-repeat; color: white; font-weight: bold; font-size: 0.9em; margin: 0 2px; filter: drop-shadow(0 0 1px black);">${r.result}</span>`;
                        })).join("");

                        const MODULE_ID = "dnd-2024-bastion-manager";
                        let defenderUpdates = {};
                        if (dTotal >= 10) {
                            const reward = (await new Roll("1d6 * 100").evaluate()).total;
                            if(a) await a.update({"system.currency.gp": Math.floor((a.system.currency?.gp || 0) + reward)});
                            resultText = `
                                <h3 style="border-bottom: 2px solid #99c1f1; padding-bottom: 3px; margin-bottom: 8px;"><i class="fa-solid fa-handshake-angle"></i> Request for Aid</h3>
                                <p>Sent ${count} Defender(s). Total: <b>${dTotal}</b>. Problem solved, earned <b>${reward} GP</b>.</p>
                                <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin-top: 5px;">${diceHtml}</div>
                            `;
                        } else {
                            const reward = Math.floor((await new Roll("1d6 * 100").evaluate()).total / 2);
                            if(a) await a.update({"system.currency.gp": Math.floor((a.system.currency?.gp || 0) + reward)});
                            // Deduct 1 defender from a random facility
                            const facs = BastionManager._getActorFacilities(a, true);
                            const defenderFacs = facs.filter(f => {
                                const dData = f.isFlag ? f.doc.flags?.[MODULE_ID]?.defenders : f.doc.getFlag(MODULE_ID, "defenders");
                                return (dData?.count || 0) > 0;
                            });

                            if (defenderFacs.length > 0) {
                                const targetFac = defenderFacs[Math.floor(Math.random() * defenderFacs.length)];
                                const dData = targetFac.isFlag ? targetFac.doc.flags?.[MODULE_ID]?.defenders : targetFac.doc.getFlag(MODULE_ID, "defenders");
                                const currentCount = dData.count;
                                const currentNames = dData.names;
                                
                                const deceasedName = currentNames.length > 0 ? currentNames[Math.floor(Math.random() * currentNames.length)] : "an unnamed defender";
                                const updatedNames = currentNames.filter(n => n !== deceasedName); // Remove one instance

                                if (targetFac.isFlag) {
                                    const gf = Array.from(targetFac.owner.getFlag(MODULE_ID, "groupFacilities") || []);
                                    const fac = gf.find(f => f._id === (targetFac.doc._id || targetFac.doc.id));
                                    if (fac) {
                                        foundry.utils.setProperty(fac, `flags.${MODULE_ID}.defenders`, {
                                            count: Math.max(0, currentCount - 1),
                                            names: updatedNames
                                        });
                                        await targetFac.owner.setFlag(MODULE_ID, "groupFacilities", gf);
                                    }
                                } else {
                                    await targetFac.owner.items.get(targetFac.doc.id).setFlag(MODULE_ID, "defenders", {
                                        count: Math.max(0, currentCount - 1),
                                        names: updatedNames
                                    });
                                }
                                // Add to graveyard
                                const graveyard = Array.from(targetFac.owner.getFlag(MODULE_ID, "graveyard") || []);
                                const turn = targetFac.owner.getFlag(MODULE_ID, "turnCount") || 0;
                                const date = new Date().toLocaleDateString();
                                graveyard.push({ name: deceasedName, date, turn });
                                await targetFac.owner.setFlag(MODULE_ID, "graveyard", graveyard);

                                resultText = `
                                    <h3 style="border-bottom: 2px solid #f28b82; padding-bottom: 3px; margin-bottom: 8px;"><i class="fa-solid fa-handshake-angle"></i> Request for Aid</h3>
                                    <p>Sent ${count} Defender(s). Total: <b>${dTotal}</b> (Failure). Problem solved, earned <b>${reward} GP</b> (half), and <b>1 Defender died</b> (${deceasedName}).</p>
                                    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin-top: 5px;">${diceHtml}</div>
                                `;
                            } else {
                                resultText = `
                                    <h3 style="border-bottom: 2px solid #f28b82; padding-bottom: 3px; margin-bottom: 8px;"><i class="fa-solid fa-handshake-angle"></i> Request for Aid</h3>
                                    <p>Sent ${count} Defender(s). Total: <b>${dTotal}</b> (Failure). Problem solved, earned <b>${reward} GP</b> (half), but no defenders were present to die.</p>
                                    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin-top: 5px;">${diceHtml}</div>
                                `;
                            }
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