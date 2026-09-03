# Influence Encounters for PF2e

A Foundry VTT module for running structured Pathfinder Second Edition influence encounters.

## Manifest installation

Paste this URL into Foundry's module installer or The Forge's Custom Module installer:

```text
https://github.com/cleggerama/PF2e-Influence-Encounters/releases/latest/download/module.json
```

## Features

- World-scoped encounter builder and reusable encounter records
- Independent per-NPC Influence Points, Discovery and Influence skills, DCs, weaknesses, resistances, thresholds, and rewards
- Player check requests with no written-response field
- GM-only adjudication of weakness, strength, unlocked boons, DC adjustments, and custom modifiers
- PF2e statistic rolls and degree-of-success scoring (`critical failure –1`, `failure 0`, `success +1`, `critical success +2`)
- Per-player secret discoveries
- Narrative and structured mechanical rewards, including cross-NPC modifiers, DC adjustments, limited uses, and IP changes
- Participant action tracking, history, and undo
- Cinematic canvas presentation showing the acting PC and active influence target
- Foundry-style Influence directory with Create Encounter/Create Folder actions, name search, collapsible folders, and drag-and-drop organization
- Right-click encounter actions for activation, duplication, deletion, and portable JSON import/export
- Actor and Token drag-and-drop for participating PCs and influence targets, preserving names and portraits
- Player-private PC and NPC selections with Owner-level actor controls
- Player and GM indicators showing who has acted in the current phase
- Foundry file pickers for encounter, background, and NPC images
- Per-NPC text parsing for Paizo-style Background, Appearance, Personality, skills, DCs, thresholds, rewards, Resistances/Strengths, and Weaknesses
- Pause and Resume controls with fully preserved progress and `(Paused)` Journal labeling
- Optional cinematic background image and configurable canvas blur
- Automatically maintained Journal record; **End & Publish** makes the player-safe results and check log available to players
- JSON export
- Preconfigured Lanekar and five-NPC Peace Talks sample encounters

## Installation

Copy the `influence-encounters` directory into Foundry's `Data/modules` directory, restart Foundry, and enable **Influence Encounters for PF2e** in a PF2e world.

The module targets **Foundry VTT 14** (minimum build 365, verified through build 367) and requires **PF2e 8.0.0 or newer**.

Version 0.2.0 uses Foundry v14's ApplicationV2 framework for the encounter editor and follows Foundry's Browser Default, Dark, and Light themes. Stored v0.1.x encounters are normalized when loaded.

## Use

1. As GM, open the dedicated Influence sidebar or the Influence Encounter control in the scene controls.
2. Choose **Manage Encounters**.
3. Create a blank encounter or load the Lanekar sample.
4. Add PCs and NPCs from the Actor sidebar or canvas, configure each target manually or paste its published encounter text, then save and activate the encounter.
5. Each player chooses an owned participating PC and an influence target, then requests a Discovery or Influence check.
6. The active GM adjudicates all situational modifiers before the PF2e roll occurs.
7. At the end, choose **End & Publish** to hide the cinematic presentation and grant players access to the encounter's Journal record.

For console access, use:

```js
game["influence-encounters"].open();
game["influence-encounters"].manage();
```

## Current limitations

- One active GM handles roll requests
- Narrative or ambiguous rewards still require GM adjudication
- Text parsing is intentionally best-effort and generated fields should be reviewed before saving
- Nested folders and manual directory sorting are not yet implemented
