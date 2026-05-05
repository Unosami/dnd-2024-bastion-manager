const fs = require('fs');

let mainJs = fs.readFileSync('scripts/main.js', 'utf8');

// Replace the previous sheet injection with one that targets the header and a tab
const newSheetInjection = `
// Also inject a button directly into the V2 sheet or V1 sheet tabs
Hooks.on("renderActorSheet", (app, html, data) => {
    const actor = app.document;
    const allowedTypes = ["character", "npc", "group"];
    if (!actor || !allowedTypes.includes(actor.type)) return;

    // Add to top header bar if possible
    let header = html.find(".window-header .window-title");
    if (header.length > 0 && html.find(".bastion-header-btn").length === 0) {
        let btn = \`<a class="bastion-header-btn" title="Open Bastion Manager"><i class="fa-solid fa-chess-rook"></i> Bastion</a>\`;
        header.after(btn);
        html.find(".bastion-header-btn").click(ev => {
            ev.preventDefault();
            new BastionManager(actor).render({ force: true });
        });
    }

    // Add as a side tab based on standard 5e character sheets
    let tabs = html.find(".sheet-navigation, nav.tabs");
    let body = html.find(".sheet-body");
    
    if (tabs.length > 0 && html.find(".bastion-tab-btn").length === 0) {
        // Find existing tabs to append to
        let tabBtn = \`<a class="item bastion-tab-btn" data-tab="bastion"><i class="fa-solid fa-chess-rook"></i> Bastion</a>\`;
        tabs.append(tabBtn);
        
        html.find(".bastion-tab-btn").click(ev => {
            ev.preventDefault();
            new BastionManager(actor).render({ force: true });
        });
    }
});
`;

// Replace the old renderActorSheet hook with the new one
mainJs = mainJs.replace(/\/\/ Also inject a button directly into the V2 sheet or V1 sheet tabs[\s\S]*\}\);/, newSheetInjection.trim());

fs.writeFileSync('scripts/main.js', mainJs);

