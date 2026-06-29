# DnD 2024 Bastion Manager

A FoundryVTT module for managing the Bastion system from the 2024 *Dungeons & Dragons Player's Handbook*. Tracks facilities, orders, hirelings, and bastion turns for one or more characters.

---

## Installation

In Foundry, go to **Add-on Modules → Install Module** and paste the following manifest URL into the field at the bottom:

```
https://raw.githubusercontent.com/Unosami/dnd-2024-bastion-manager/main/module.json
```

**Requirements:** Foundry V14+, dnd5e system v5.0+.

---

## How It Works

### Opening the Bastion Manager

The Bastion Manager window can be opened three ways:

- **From the character sheet** — a "Bastion" button appears in the sheet header for any character who has bastion facilities. Click it to open their manager.
- **From the scene controls** — a bastion icon appears in the left sidebar. Click it to select a character and open their manager.
- **From the Bastion tab** — the character sheet's Bastion tab (Enabled in "Game Settings -> Dungeons & Dragons Fifth Edition -> Configure Bastions -> Enable Bastion Functionality") is augmented with per-facility controls and an "Open Full Manager" button.
![Bastion_Manager_Button.png](./Resources/Bastion_Manager_Button.png)

If the character sheet is detached into its own browser window (using Foundry V14's native detach feature), the Bastion Manager will also open in a detached window.

### The Manager Window

The manager window shows all of a character's bastion facilities. For each facility you can:

- **Assign an order** for the upcoming bastion turn (Maintain, Craft, Harvest, Recruit, Research, Trade, or Empower).
- **Track facility-specific details** such as craft queues, armory stock, and hireling counts.
- **Build new facilities** using the "Found Bastion" or "Build Facility" buttons.
- **Demolish facilities** 

### Advancing a Bastion Turn

When the GM is ready to resolve a bastion turn, they use the "Advance Bastion Turn" button in the manager or scene controls. This processes all assigned orders and updates facility states. If a bastion has all facilities set to "Maintain" a bastion event roll is also prompted at this stage.

### Hirelings and Defenders

Facilities that employ hirelings (such as the Barracks, War Room, and Pub) can create actual Foundry actors in your world when staff are recruited. These actors are drawn from the *Bastion Facility Actors* compendium included with the module. You can customize which actor template is used for each facility type in the module settings under **Configure Hireling Templates**.

### Group Overview

If multiple characters in the party have bastions, the scene control opens a group overview showing all bastions at a glance, with quick access to each character's full manager.

---

## Rules Interpretations

Some bastion rules required interpretation. Here are the decisions made that are not explicitly spelled out in the rules, organized by facility.

**General**

- **Orders for facilities under construction.** The rules describe assigning orders at the start of a bastion turn but don't address facilities that are still being built. This module restricts founded (in-progress) facilities to the Maintain order only, on the interpretation that you cannot use a facility that doesn't fully exist yet.
- **Hirelings as Foundry actors.** The rules describe hirelings abstractly. This module creates actual actor entries in your world when hirelings are recruited, so the GM has stat blocks to reference in encounters or skill checks. When a facility is demolished, its associated hireling actors are removed from the world.
- **War Room staff.** The War Room's special staff member is treated as a Lieutenant (using a distinct actor template) rather than a generic Hireling, on the interpretation that the War Room's command role implies a more capable staff member than a standard hireling.

**Armory**

- **Partially-stocked armory.** There are no rules for a partially-stocked Armory (for example, after a Trade order restocks it following a period of use). In this case, a number of the defense dice are d8s proportional to the current stock level relative to the total number of defenders, with the remainder being the normal die type.

---

## Feedback & Issues

This module is developed and maintained by Willy D. Report issues or suggestions at:
[https://github.com/Unosami/dnd-2024-bastion-manager/issues](https://github.com/Unosami/dnd-2024-bastion-manager/issues)
