# Influence Encounters for PF2e

A Foundry VTT module for running structured Pathfinder Second Edition influence encounters.

## Manifest installation

Paste this URL into Foundry's module installer or The Forge's Custom Module installer:

```text
https://github.com/cleggerama/PF2e-Influence-Encounters/releases/latest/download/module.json
```

## MVP features

- World-scoped encounter builder and reusable encounter records
- Configurable phases, Discovery skills, Influence skills, weaknesses, strengths, and thresholds
- Player check requests with no written-response field
- GM-only adjudication of weakness, strength, unlocked boons, DC adjustments, and custom modifiers
- PF2e statistic rolls and degree-of-success scoring (`critical failure –1`, `failure 0`, `success +1`, `critical success +2`)
- Per-player secret discoveries
- Threshold rewards and configurable boon presets
- Participant action tracking, history, and undo
- Cinematic canvas presentation showing the acting PC and active influence target
- Foundry-style Influence directory with Create Encounter/Create Folder actions, name search, collapsible folders, and drag-and-drop organization
- Right-click encounter actions for activation, duplication, deletion, and portable JSON import/export
- Drag-and-drop NPC target roster with editable names and portraits
- Optional cinematic background image and configurable canvas blur
- Automatically maintained Journal record; **End & Publish** makes the player-safe results and check log available to players
- JSON export
- Preconfigured Lanekar sample encounter

## Installation

Copy the `influence-encounters` directory into Foundry's `Data/modules` directory, restart Foundry, and enable **Influence Encounters for PF2e** in a PF2e world.

The module targets **Foundry VTT 14** (minimum build 365, verified through build 367) and requires **PF2e 8.0.0 or newer**.

Version 0.1.6 uses Foundry v14's explicitly namespaced ApplicationV1 compatibility API while matching Foundry's selected application color scheme. Foundry supports these classes through v15; a later major release can migrate the windows to ApplicationV2 without changing stored encounter data.

## Use

1. As GM, open the dedicated Influence sidebar or the Influence Encounter control in the scene controls.
2. Choose **Manage Encounters**.
3. Create a blank encounter or load the Lanekar sample.
4. Edit and save the encounter, then activate it.
5. Choose the acting PC and active NPC in the Influence sidebar, then request a Discovery or Influence check.
6. The active GM adjudicates all situational modifiers before the PF2e roll occurs.
7. At the end, choose **End & Publish** to hide the cinematic presentation and grant players access to the encounter's Journal record.

For console access, use:

```js
game["influence-encounters"].open();
game["influence-encounters"].manage();
```

## Current MVP limitations

- Multiple NPCs can be presented and selected, but they currently share one encounter-level set of Discovery and Influence statistics
- One active GM handles roll requests
- External boons are recorded but must be applied manually in later encounters
- Import UI and cross-encounter automatic boon matching are reserved for the next iteration
