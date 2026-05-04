import { BastionManager } from "./bastion-app.js";

const MODULE_ID = "dnd-2025-bastion-manager";

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | Initializing DnD 5.5 Bastion Manager`);
    
    // Register the Inheritance Setting in the Game Settings menu
    game.settings.register(MODULE_ID, "groupInheritsFacilities", {
        name: "Group Inherits Member Facilities",
        hint: "If enabled, Group actors will automatically display and roll the Bastion orders of all their individual members.",
        scope: "world", // "world" means only the GM can toggle it for the whole game
        config: true,   // Show it in the UI menu
        type: Boolean,
        default: true
    });

    // Global Wipe Setting
    game.settings.register(MODULE_ID, "resetAllTurns", {
        name: "Reset All Bastion Turns",
        hint: "Check this box and save changes to instantly reset the Bastion Turn count to 0 for every character, NPC, and Group in the world.",
        scope: "world", // GM only
        config: true,
        type: Boolean,
        default: false,
        onChange: async (isChecked) => {
            if (isChecked) {
                // Loop through every actor in the world
                for (const actor of game.actors) {
                    const data = actor.getFlag("dnd-2025-bastion-manager", "data");
                    // If they have turns, reset it to 0
                    if (data && data.turnCount > 0) {
                        await actor.setFlag("dnd-2025-bastion-manager", "data.turnCount", 0);
                    }
                }
                
                ui.notifications.info("Bastion Manager | All Bastion turns have been globally reset to 0.");
                
                // Instantly uncheck the box behind the scenes so you can use it again later
                game.settings.set(MODULE_ID, "resetAllTurns", false);
            }
        }
    });

    // Recruitment Mode Setting
    game.settings.register(MODULE_ID, "recruitMode", {
        name: "Recruit Order Mode",
        hint: "How should the number of recruited Bastion Defenders be determined?",
        scope: "world",
        config: true,
        type: String,
        default: "roll",
        choices: {
            "roll": "Roll Dice (e.g., 1d4)",
            "max": "Maximum Allowed (e.g., 4)",
            "manual": "Manual Prompt"
        }
    });

    // Naming Prompts Setting
    game.settings.register(MODULE_ID, "nameHirelings", {
        name: "Prompt for Hireling/Defender Names",
        hint: "If enabled, the module will prompt you to name new hirelings when building facilities and new defenders when recruiting.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });
});

Hooks.once("ready", () => {
    console.log(`${MODULE_ID} | Bastion Manager is ready!`);
});

// Hook into the modern V13 ApplicationV2 Header Controls (The 3-dot menu)
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const actor = app.document;

    // Allow Characters, NPCs, and Groups to have Bastions
    const allowedTypes = ["character", "npc", "group"];
    if (!actor || !allowedTypes.includes(actor.type)) return;

    controls.unshift({
        label: "Bastion",
        icon: "fa-solid fa-chess-rook",   
        action: "openBastionManager"
    });

    if (!app.options.actions.openBastionManager) {
        app.options.actions.openBastionManager = (event, target) => {
            new BastionManager(actor).render({ force: true });
        };
    }
});