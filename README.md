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
- JSON export
- Preconfigured Lanekar sample encounter

## Installation

Copy the `influence-encounters` directory into Foundry's `Data/modules` directory, restart Foundry, and enable **Influence Encounters for PF2e** in a PF2e world.

The module targets **Foundry VTT 14 build 365** and requires **PF2e 8.0.0 or newer**.

Version 0.1.1 uses Foundry v14's explicitly namespaced ApplicationV1 compatibility API. Foundry supports these classes through v15; a later major release can migrate the windows to ApplicationV2 without changing stored encounter data.

## Use

1. As GM, open the Influence Encounter control in the scene controls.
2. Choose **Manage Encounters**.
3. Create a blank encounter or load the Lanekar sample.
4. Edit and save the encounter, then activate it.
5. Players select a character token and request Discovery or Influence checks.
6. The active GM adjudicates all situational modifiers before the PF2e roll occurs.

For console access, use:

```js
game["influence-encounters"].open();
game["influence-encounters"].manage();
```

## Current MVP limitations

- Single active NPC encounter at a time
- One active GM handles roll requests
- External boons are recorded but must be applied manually in later encounters
- Import UI and cross-encounter automatic boon matching are reserved for the next iteration
