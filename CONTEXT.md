# Project Context: Bastion Manager
- **Logic/Controller:** All app logic goes in `scripts/bastion-app.js`.
- **Initialization:** Foundry hooks go in `scripts/main.js`.
- **UI/Markup:** All HTML/Handlebars goes in `templates/bastion-main.hbs`.

Always separate HTML markup from JS logic. When I ask for a UI change, provide the `.hbs` code and the `.js` code separately.
Always assume I am using Foundry VTT v13 and the D&D 2024 ruleset.