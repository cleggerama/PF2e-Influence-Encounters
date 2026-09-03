# Changelog

## 0.2.0 — 2026-09-03

- Added saved pause/resume support. GMs can pause or resume encounters from the tracker, manager, or Influence sidebar context menu; paused encounters hide the cinematic presentation, prevent new checks, preserve all progress, and mark their Journal record and UI entries as `(Paused)`.
- Added editable PF2e skill pickers and a per-NPC text parser for published Background, Appearance, Personality, Discovery/Influence DCs, thresholds, rewards, Resistances/Strengths, and Weaknesses.
- Changed the ApplicationV2 editor to save in place and added a three-choice unsaved-changes warning when a modified encounter is closed.
- Added true per-NPC Influence Points, Discovery and Influence skills, DCs, weaknesses, resistances, thresholds, and rewards.
- Added GM-only Background and Personality notes plus player-visible Appearance text for each influence target.
- Added structured cross-NPC roll modifiers, DC adjustments, limited-use effects, manual IP rewards, and narrative rewards.
- Added the five-target Peace Talks sample encounter.
- Updated the tracker, check log, discoveries, and Journal publication for multi-NPC encounters.
- Migrated the encounter editor to Foundry's ApplicationV2 framework and native theme variables.
- Fixed active-encounter deletion so it ends and publishes the encounter, clears the active state, and releases the cinematic display.
- Added editor drop zones for participating PCs and influence targets dragged from the Actor directory or canvas, preserving Actor links, names, and prototype-token/actor images.
- Removed the generated encounter-name placeholder target once real Actor-linked NPCs are added, preventing a false encounter-wide Skills section.
- Replaced typed image-path fields with Foundry file pickers for encounter images, cinematic backgrounds, and NPC portraits.
- Enlarged both Actor drop zones into full-width rounded panels with prominent dashed outlines and drag-over highlighting.
- Added player-private acting-PC and target selections, restricted acting-PC choices to Owner-level characters, and made current-phase acted status prominent in the encounter window and player sidebar.

## 0.1.6 — 2026-09-02

- Added a Foundry-style Influence Encounter sidebar with folders, search, drag-and-drop organization, and context menus.
- Added encounter and folder creation/configuration dialogs that follow Foundry's interface conventions.
- Added encounter duplication and portable JSON import/export.
- Added selectable party participants and drag-and-drop NPC influence targets.
- Added cinematic PC/NPC portrait presentation, optional background images, and canvas blur.
- Added per-check logging, player-safe Discovery outcomes, discoveries, and threshold-boon details.
- Added GM narrative modifiers, manual Influence Point adjustment, phase reversal, and functional undo.
- Corrected Discovery checks so they never award Influence Points.
- Limited Lore choices to Lore skills present on the acting character's sheet.
- Added participant buttons for requesting checks without selecting a token.
- Added Journal-backed encounter records and player-facing publication at encounter end.
- Added application theming that follows Foundry's Browser Default, Dark, and Light settings.
- Corrected the editor form structure and restored reliable editing and saving.
