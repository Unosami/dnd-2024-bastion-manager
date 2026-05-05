const fs = require('fs');

let mainJs = fs.readFileSync('scripts/main.js', 'utf8');

const hookStr = `
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

// Also inject a button directly into the V2 sheet or V1 sheet tabs
Hooks.on("renderActorSheet", (app, html, data) => {
    const actor = app.document;
    const allowedTypes = ["character", "npc", "group"];
    if (!actor || !allowedTypes.includes(actor.type)) return;

    // We can inject a tab and button depending on sheet type
    const isV2 = app.options.v2;
    
    // Simplest approach: Add to sheet header for generic compatibility
    let header = html.find('.window-header .window-title');
    if (header.length > 0 && html.find('.bastion-header-btn').length === 0) {
        let btn = \`<a class="bastion-header-btn" title="Open Bastion Manager"><i class="fa-solid fa-chess-rook"></i> Bastion</a>\`;
        header.after(btn);
        html.find('.bastion-header-btn').click(ev => {
            ev.preventDefault();
            new BastionManager(actor).render({ force: true });
        });
    }
});
`;

if (!mainJs.includes("Hooks.on(\"getHeaderControlsApplicationV2\"")) {
    mainJs += hookStr;
    fs.writeFileSync('scripts/main.js', mainJs);
}

