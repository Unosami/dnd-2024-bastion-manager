/**
 * NUCLEAR TROUBLESHOOTING SCRIPT
 * This file is stripped to the absolute bare minimum to diagnose hook firing issues.
 */
console.error("!!! BASTION MANAGER | main.js IS RUNNING !!!");

// 1. The "Ghost" Sniffer
// We've removed the "render" filter. This will log EVERY hook. 
// Warning: This will be noisy, but it will prove if hooks are firing at all.
Hooks.on("all", (hookName) => {
    console.warn(`!!! HOOK FIRED: "${hookName}" !!!`);
});

const runInjection = (target) => {
    if (!target || target.querySelector(".bastion-success-banner")) return;
    
    console.error("!!! SUCCESS: TARGET [data-tab='bastion'] DETECTED IN DOM !!!");
    target.style.border = "10px solid red";
    
    const banner = document.createElement("div");
    banner.className = "bastion-success-banner";
    banner.style.cssText = "background: yellow; color: black; padding: 20px; font-weight: bold; border: 5px solid black; text-align: center; font-size: 1.5em; z-index: 1000; position: relative; margin: 10px;";
    banner.innerText = "INTEGRATION TEST: SUCCESSFUL";
    target.prepend(banner);
};

// 2. The Mutation Observer (The reliable way for V13 ApplicationV2)
// This watches for the actual HTML elements being added or changed.
const observer = new MutationObserver((mutations) => {
    // Look for the bastion tab content section
    const bastionTab = document.querySelector('section[data-tab="bastion"], div[data-tab="bastion"]');
    
    // Ensure it's the content pane, not the navigation tab button
    if (bastionTab && !bastionTab.classList.contains('item') && !bastionTab.classList.contains('anchor')) {
        // ApplicationV2 might have the tab in the DOM but hidden. Check if it's visible.
        const style = window.getComputedStyle(bastionTab);
        if (style.display !== 'none') {
            runInjection(bastionTab);
        }
    }
});

// Start watching the entire document body for changes
observer.observe(document.body, { childList: true, subtree: true });