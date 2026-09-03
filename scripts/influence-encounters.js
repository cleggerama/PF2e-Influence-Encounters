const MODULE_ID = "influence-encounters";
const SOCKET = `module.${MODULE_ID}`;
const SETTINGS = { encounters: "encounters", active: "activeEncounter", folders: "encounterFolders", selections: "userSelections" };
const { Application, Dialog } = foundry.appv1.api;
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const deepClone = (value) => foundry.utils.deepClone(value);
const randomID = () => foundry.utils.randomID();
const esc = (value = "") => foundry.utils.escapeHTML(String(value));
const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;

const PF2E_SKILLS = [
  "Acrobatics", "Arcana", "Athletics", "Crafting", "Deception", "Diplomacy", "Intimidation",
  "Medicine", "Nature", "Occultism", "Performance", "Perception", "Religion", "Society",
  "Stealth", "Survival", "Thievery"
];

function skillSlug(label = "") {
  const standard = PF2E_SKILLS.find((skill) => skill.toLowerCase() === String(label).trim().toLowerCase());
  if (standard) return standard.toLowerCase();
  return String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parsedSkill(label, dc, type) {
  const cleanLabel = String(label).replace(/\([^)]*\)/g, "").replace(/^\s*[,;:]\s*/, "").trim();
  return { id: randomID(), label: cleanLabel, slug: skillSlug(cleanLabel), dc: Number(dc), lore: /\blore$/i.test(cleanLabel), secret: false };
}

function parseDcSkills(text, type) {
  const results = [];
  const matches = [...String(text).matchAll(/\bDC\s*(\d+)\s*[,;:]?\s*/gi)];
  matches.forEach((match, index) => {
    const value = text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length)
      .replace(/[.;]+\s*$/, "").trim();
    value.replace(/\([^)]*\)/g, "").split(/\s+or\s+|\s*[,;]\s*/i).map((label) => label.trim()).filter(Boolean)
      .forEach((label) => results.push(parsedSkill(label, match[1], type)));
  });
  return results;
}

function sectionText(text, startPattern, endPattern) {
  const start = startPattern.exec(text);
  if (!start) return null;
  const remainder = text.slice(start.index + start[0].length);
  const end = endPattern.exec(remainder);
  return remainder.slice(0, end?.index ?? remainder.length).replace(/\s+/g, " ").trim();
}

function narrativeReward(description, npcId, index) {
  return { id: randomID(), kind: "narrative", label: index ? `Reward ${index + 1}` : "Reward", description, value: 0,
    type: "circumstance", mode: "narrative", scope: "both", skills: [], uses: 0, remaining: 0,
    activation: "automatic", active: true, applied: false, targetNpcId: npcId, playerVisible: true };
}

function parseInfluenceSource(source, npc) {
  const text = String(source).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const found = [];
  const sectionEnd = /\b(?:Background|Appearance|Personality|Discovery(?:\s+Skills?)?|Influence\s+Skills?|Influence\s+DC|Influence\s+\d+|Resistances?|Strengths?|Weaknesses?)\b/i;
  for (const [key, label] of [["background", "Background"], ["appearance", "Appearance"], ["personality", "Personality"]]) {
    const value = sectionText(text, new RegExp(`\\b${label}\\s*`, "i"), sectionEnd);
    if (value === null) continue;
    npc[key] = value;
    found.push(label);
  }
  const discoveryText = sectionText(text, /\bDiscovery(?:\s+Skills?)?\s*/i, sectionEnd);
  const influenceText = sectionText(text, /\bInfluence(?:\s+Skills?)?\s*/i, /\b(?:Background|Appearance|Personality|Influence\s+\d+|Discovery(?:\s+Skills?)?|Resistances?|Strengths?|Weaknesses?)\b/i);
  if (discoveryText !== null) { npc.discovery = parseDcSkills(discoveryText, "discovery"); found.push(`${npc.discovery.length} Discovery skill(s)`); }
  if (influenceText !== null) { npc.influence = parseDcSkills(influenceText, "influence"); found.push(`${npc.influence.length} Influence skill(s)`); }

  const thresholds = [...text.matchAll(/\bInfluence\s+(\d+)\s*/gi)].filter((match) => !/\b(?:DC|Skills?)\s*$/i.test(text.slice(Math.max(0, match.index - 12), match.index)));
  if (thresholds.length) {
    npc.thresholds = thresholds.map((match, index) => {
      const raw = text.slice(match.index + match[0].length, thresholds[index + 1]?.index ?? text.length)
        .split(/\b(?:Background|Appearance|Personality|Resistances?|Strengths?|Weaknesses?)\b/i)[0].trim();
      const sentences = raw.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
      const narrative = sentences.shift() ?? "";
      return { id: randomID(), points: Number(match[1]), label: `Influence ${match[1]}`, text: narrative,
        boons: sentences.map((sentence, rewardIndex) => narrativeReward(sentence, npc.id, rewardIndex)) };
    });
    found.push(`${npc.thresholds.length} threshold(s)`);
  }

  for (const [key, label, pattern] of [["strength", "Resistance", /\b(?:Resistances?|Strengths?)\s*/i], ["weakness", "Weakness", /\bWeaknesses?\s*/i]]) {
    const description = sectionText(text, pattern, /\b(?:Background|Appearance|Personality|Discovery(?:\s+Skills?)?|Influence(?:\s+Skills?|\s+DC|\s+\d+)|Resistances?|Strengths?|Weaknesses?)\b/i);
    if (description === null) continue;
    const magnitude = Number(description.match(/\bby\s+([+-]?\d+)\b/i)?.[1] ?? 0);
    const lowers = /\b(?:decrease|decreases|decreased|lower|lowers|lowered|reduce|reduces|reduced)\b/i.test(description);
    npc[key] = { label, description, value: magnitude ? (lowers ? -magnitude : magnitude) : 0,
      type: "circumstance", mode: magnitude ? "dc" : "narrative" };
    found.push(label);
  }
  return found;
}

function indexedArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, entry]) => entry);
}

function isGeneratedPlaceholderNpc(encounter, npc) {
  const matchesLegacyDiscovery = npc.discovery.length === encounter.discovery.length
    && npc.discovery.every((skill, index) => skill.id === encounter.discovery[index]?.id);
  return !npc.actorId
    && npc.name === encounter.name
    && npc.image === encounter.image
    && Number(npc.points) === 0
    && !npc.background && !npc.appearance && !npc.personality
    && !npc.influence.length && !npc.thresholds.length
    && !npc.weakness?.description && !npc.strength?.description
    && matchesLegacyDiscovery;
}

function normalizeEncounterCollections(encounter) {
  encounter.discovery = indexedArray(encounter.discovery);
  encounter.influence = indexedArray(encounter.influence);
  encounter.thresholds = indexedArray(encounter.thresholds);
  encounter.thresholds.forEach((threshold) => threshold.boons = indexedArray(threshold.boons));
  encounter.activeEffects = indexedArray(encounter.activeEffects);
  encounter.checkLog = indexedArray(encounter.checkLog);
  encounter.npcs = indexedArray(encounter.npcs);
  if (!encounter.npcs.length) encounter.npcs = [{ id: randomID(), name: encounter.name, image: encounter.image, actorId: "" }];
  encounter.npcs.forEach((npc) => {
    npc.id ||= randomID();
    npc.name ||= "Influence Target";
    npc.image ||= "icons/svg/mystery-man.svg";
    npc.actorId ||= "";
    npc.background ??= "";
    npc.appearance ??= "";
    npc.personality ??= "";
    npc.points = Number(npc.points ?? encounter.points) || 0;
    npc.discovery = indexedArray(npc.discovery ?? deepClone(encounter.discovery));
    npc.influence = indexedArray(npc.influence ?? deepClone(encounter.influence));
    npc.weakness = foundry.utils.mergeObject(deepClone(encounter.weakness ?? DEFAULT_ENCOUNTER.weakness), npc.weakness ?? {}, { inplace: false, overwrite: true });
    npc.strength = foundry.utils.mergeObject(deepClone(encounter.strength ?? DEFAULT_ENCOUNTER.strength), npc.strength ?? {}, { inplace: false, overwrite: true });
    npc.weakness.mode ??= "roll";
    npc.strength.mode ??= "roll";
    npc.thresholds = indexedArray(npc.thresholds ?? deepClone(encounter.thresholds));
    npc.thresholds.forEach((threshold) => {
      threshold.id ||= randomID();
      threshold.points = Number(threshold.points) || 0;
      threshold.boons = indexedArray(threshold.boons);
      threshold.boons.forEach((boon) => {
        boon.id ||= randomID();
        boon.kind = ["modifier", "ip", "narrative"].includes(boon.kind) ? boon.kind : (boon.mode === "narrative" ? "narrative" : "modifier");
        boon.activation = boon.activation === "manual" ? "manual" : "automatic";
        boon.active = boon.active ?? boon.activation === "automatic";
        boon.applied ??= false;
        boon.playerVisible ??= true;
        boon.targetNpcId ??= npc.id;
        boon.scope ??= "both";
        boon.mode ??= boon.kind === "narrative" ? "narrative" : "roll";
        boon.skills = Array.isArray(boon.skills) ? boon.skills : String(boon.skills ?? "").split(",").map((skill) => skill.trim()).filter(Boolean);
        boon.uses = Math.max(0, Number(boon.uses ?? 999));
        boon.remaining = Math.max(0, Number(boon.remaining ?? boon.uses));
      });
    });
  });
  if (encounter.npcs.length > 1 && encounter.npcs.some((npc) => npc.actorId)) {
    encounter.npcs = encounter.npcs.filter((npc) => !isGeneratedPlaceholderNpc(encounter, npc));
  }
  encounter.activeNpcId = encounter.npcs.some((npc) => npc.id === encounter.activeNpcId)
    ? encounter.activeNpcId
    : encounter.npcs[0]?.id ?? "";
  encounter.backgroundImage ??= "";
  encounter.backgroundBlur ??= 6;
  encounter.presentationVisible ??= true;
  encounter.journalId ??= "";
  encounter.endedAt ??= null;
  encounter.folderId ??= "";
  encounter.encounterType = encounter.encounterType === "multiple" ? "multiple" : "single";
  encounter.discoveries ??= {};
  for (const record of Object.values(encounter.discoveries)) {
    record.npcs ??= {};
    if (record.facts?.length && !Object.keys(record.npcs).length && encounter.activeNpcId) {
      record.npcs[encounter.activeNpcId] = { facts: record.facts, secretSkill: record.secretSkill ?? false };
    }
  }
  return encounter;
}

const DEFAULT_ENCOUNTER = {
  id: "",
  name: "New Influence Encounter",
  encounterType: "single",
  image: "icons/svg/mystery-man.svg",
  npcs: [],
  activeNpcId: "",
  activeActorId: "",
  backgroundImage: "",
  backgroundBlur: 6,
  presentationVisible: true,
  journalId: "",
  endedAt: null,
  level: 0,
  phases: 4,
  currentPhase: 1,
  points: 0,
  publicPoints: true,
  status: "draft",
  discovery: [
    { id: "perception", label: "Perception", slug: "perception", dc: 20, secret: false },
    { id: "diplomacy", label: "Diplomacy", slug: "diplomacy", dc: 20, secret: false },
    { id: "secret", label: "Secret Discovery Skill", slug: "", dc: 20, secret: true }
  ],
  influence: [],
  weakness: { label: "Weakness", description: "", value: 2, type: "circumstance", mode: "roll" },
  strength: { label: "Strength", description: "", value: -2, type: "circumstance", mode: "roll" },
  thresholds: [],
  participantIds: null,
  actorsActed: {},
  phaseActions: {},
  discoveries: {},
  activeEffects: [],
  checkLog: [],
  history: []
};

const LANEKAR = {
  ...deepClone(DEFAULT_ENCOUNTER),
  id: "lanekar",
  name: "Lanekar, the Outcast",
  image: `modules/${MODULE_ID}/assets/lanekar-tiri-kitor.png`,
  npcs: [{ id: "lanekar-npc", name: "Lanekar, the Outcast", image: `modules/${MODULE_ID}/assets/lanekar-tiri-kitor.png`, actorId: "" }],
  activeNpcId: "lanekar-npc",
  level: 8,
  discovery: [
    { id: "perception", label: "Perception", slug: "perception", dc: 26, secret: false },
    { id: "diplomacy", label: "Diplomacy", slug: "diplomacy", dc: 24, secret: false },
    { id: "survival", label: "Survival", slug: "survival", dc: 21, secret: true }
  ],
  influence: [
    ["survival", "Survival", 21, false], ["nature", "Nature", 22, false],
    ["stealth", "Stealth", 23, false], ["diplomacy", "Diplomacy", 24, false],
    ["society", "Society", 25, false], ["medicine", "Medicine", 25, false],
    ["deception", "Deception", 27, false], ["intimidation", "Intimidation", 30, false],
    ["scouting-lore", "Scouting Lore", 19, true], ["warfare-lore", "Warfare Lore", 20, true],
    ["hobgoblin-lore", "Hobgoblin Lore", 20, true], ["blackfens-lore", "Blackfens Lore", 20, true],
    ["tiri-kitor-lore", "Tiri Kitor Lore", 21, true], ["dragon-lore", "Dragon Lore", 22, true],
    ["haunt-lore", "Haunt Lore", 23, true]
  ].map(([slug, label, dc, lore]) => ({ id: randomID(), slug, label, dc, lore })),
  weakness: {
    label: "Prepare Them to Survive",
    description: "Concrete preparations for the tribe's survival rather than general promises.",
    value: 2,
    type: "circumstance"
  },
  strength: {
    label: "The Outcast's Sacred Office",
    description: "Pitying Lanekar, restoring him, asking him to advise the leaders, or disparaging the hunters.",
    value: -2,
    type: "circumstance"
  },
  thresholds: [
    { id: randomID(), points: 4, label: "Not a Threat", text: "Lanekar accepts that the party poses no danger to the Tiri Kitor.", boons: [{ id: randomID(), label: "Recognized by the Hunters", value: 1, type: "circumstance", mode: "roll", scope: "influence", skills: [], uses: 1, remaining: 1, optional: true, external: true }] },
    { id: randomID(), points: 9, label: "Proven Allies", text: "Lanekar accepts that the party genuinely intends to protect his people.", boons: [] },
    { id: randomID(), points: 15, label: "The Mad Mage's Secret", text: "Lanekar reveals the haunted complex and the safest route to it.", boons: [{ id: randomID(), label: "Lanekar's Route", value: 1, type: "circumstance", mode: "roll", scope: "external", skills: [], uses: 2, remaining: 2, optional: true, external: true }] },
    { id: randomID(), points: 24, label: "The Outcast's Counsel", text: "Lanekar reveals how best to approach the leaders of Starsong Hill.", boons: [{ id: randomID(), label: "Outcast's Insight", value: 2, type: "circumstance", mode: "roll", scope: "external", skills: [], uses: 3, remaining: 3, optional: true, external: true }] }
  ]
};

function peaceNpc({ id, name, discovery, influence, weakness, strength, background, appearance, personality, rewards = [] }) {
  return {
    id, name, actorId: "", image: "icons/svg/mystery-man.svg", points: 0,
    background, appearance, personality,
    discovery: discovery.map(([slug, label, dc, secret = false]) => ({ id: randomID(), slug, label, dc, secret })),
    influence: influence.map(([slug, label, dc, lore = false]) => ({ id: randomID(), slug, label, dc, lore })),
    weakness: weakness ?? { label: "Weakness", description: "", value: 0, type: "circumstance", mode: "dc" },
    strength: strength ?? { label: "Resistance", description: "", value: 0, type: "circumstance", mode: "dc" },
    thresholds: [
      { id: randomID(), points: 2, label: "Votes in Favor", text: `${name} agrees to the plan and votes in favor of the PCs.`, boons: [] },
      { id: randomID(), points: 4, label: "Personal Support", text: rewards[0]?.text ?? `${name} offers the PCs additional support.`, boons: rewards }
    ]
  };
}

const PEACE_TALKS = {
  ...deepClone(DEFAULT_ENCOUNTER),
  id: "peace-talks",
  name: "Peace Talks",
  encounterType: "multiple",
  image: "icons/svg/conversation.svg",
  phases: 5,
  publicPoints: true,
  discovery: [], influence: [], thresholds: [],
  weakness: { label: "Weakness", description: "", value: 0, type: "circumstance", mode: "dc" },
  strength: { label: "Resistance", description: "", value: 0, type: "circumstance", mode: "dc" },
  npcs: [
    peaceNpc({
      id: "tsiwak", name: "Tsiwak Eclipse Rider",
      discovery: [["art-lore", "Art Lore", 20, true], ["perception", "Perception", 26], ["scouting-lore", "Scouting Lore", 22, true], ["society", "Society", 24]],
      influence: [["art-lore", "Art Lore", 20, true], ["crafting", "Crafting (discussing pottery)", 20], ["performance", "Performance", 23], ["diplomacy", "Diplomacy", 24]],
      strength: { label: "Spoken Down To", description: "Speaking down to Tsiwak increases all of her Influence DCs by 2 for the rest of the encounter.", value: 2, type: "circumstance", mode: "dc" },
      background: "Head scout of the Lyrune-Quah who has traveled with Otehika for several years.",
      appearance: "Short hair braided close to her scalp and a black band tattooed across her eyes.", personality: "Serious, focused, quiet.",
      rewards: [{ id: randomID(), kind: "modifier", label: "Tsiwak's Support", description: "Tsiwak speaks privately with Grandmother Anpawi.", value: 1, type: "circumstance", mode: "roll", scope: "influence", skills: [], uses: 1, remaining: 1, activation: "automatic", active: true, targetNpcId: "anpawi", playerVisible: true, text: "Tsiwak lends her support when persuading Grandmother Anpawi." }]
    }),
    peaceNpc({
      id: "otehika", name: "Otehika Cinder Eater",
      discovery: [["horse-lore", "Horse Lore", 20, true], ["perception", "Perception", 26], ["society", "Society", 24]],
      influence: [["horse-lore", "Horse Lore", 20, true], ["diplomacy", "Diplomacy", 23], ["society", "Society", 24]],
      strength: { label: "Intimidating the Leaders", description: "Attempts to Intimidate Otehika or another leader cause all IP with Otehika to be lost. Use the manual IP control when triggered.", value: 0, type: "circumstance", mode: "narrative" },
      background: "A talented Sklar-Quah burn rider who traveled with Tsiwak as her guard.",
      appearance: "Their hair is scalp locked, apparently after catching fire.", personality: "Stubborn, brash, disorganized.",
      rewards: [{ id: randomID(), kind: "ip", label: "Encourages Uncle Memscut", description: "Otehika's enthusiasm wins Uncle Memscut's support.", value: 1, mode: "narrative", scope: "influence", skills: [], uses: 1, remaining: 1, activation: "manual", active: false, applied: false, targetNpcId: "memscut", playerVisible: true, text: "Gain 1 Influence Point with Uncle Memscut." }]
    }),
    peaceNpc({
      id: "datiti", name: "Grandmother Datiti",
      discovery: [["medicine", "Medicine", 20], ["perception", "Perception", 22], ["society", "Society", 24]],
      influence: [["medicine", "Medicine", 20], ["diplomacy", "Diplomacy", 24], ["nature", "Nature", 25]],
      strength: { label: "Disrespect", description: "Mocking or underestimating Grandmother Datiti immediately loses 1 IP with her. Use the manual IP control when triggered.", value: 0, type: "circumstance", mode: "narrative" },
      background: "An elderly Lyrune-Quah shaman and former adventuring wizard.",
      appearance: "Very long silver hair in wide braids threaded with large beads.", personality: "Sweet, wise, gentle.",
      rewards: [{ id: randomID(), kind: "narrative", label: "Eye of the Moonwarden", description: "Grandmother Datiti offers a treasured item after the bonfire.", value: 0, mode: "narrative", scope: "external", skills: [], uses: 0, remaining: 0, activation: "automatic", active: true, targetNpcId: "datiti", playerVisible: true, text: "Grandmother Datiti offers the PCs an eye of the moonwarden." }]
    }),
    peaceNpc({
      id: "anpawi", name: "Grandmother Anpawi",
      discovery: [["perception", "Perception", 26], ["religion", "Religion", 22], ["sarenrae-lore", "Sarenrae Lore", 20, true], ["shelyn-lore", "Shelyn Lore", 20, true], ["society", "Society", 24]],
      influence: [["sarenrae-lore", "Sarenrae Lore", 20, true], ["shelyn-lore", "Shelyn Lore", 20, true], ["religion", "Religion", 22], ["diplomacy", "Diplomacy", 23], ["society", "Society", 24]],
      weakness: { label: "Praise Tsiwak", description: "Praising Tsiwak's accomplishments and leadership reduces Grandmother Anpawi's Influence DCs by 2.", value: -2, type: "circumstance", mode: "dc" },
      background: "A Sklar-Quah shaman and the youngest shaman of her generation.",
      appearance: "Long dark hair shot with streaks of pure white, worn loose.", personality: "Stern, suspicious, traditionalist.",
      rewards: [{ id: randomID(), kind: "narrative", label: "Anpawi's Gifts", description: "Grandmother Anpawi offers valuable supplies after the bonfire.", value: 0, mode: "narrative", scope: "external", skills: [], uses: 0, remaining: 0, activation: "automatic", active: true, targetNpcId: "anpawi", playerVisible: true, text: "Grandmother Anpawi offers a cindergrass cloak and a Type II box of unspoiling." }]
    }),
    peaceNpc({
      id: "memscut", name: "Uncle Memscut",
      discovery: [["perception", "Perception", 26], ["seafaring-lore", "Seafaring Lore", 20, true], ["society", "Society", 24], ["survival", "Survival", 22]],
      influence: [["seafaring-lore", "Seafaring Lore", 20, true], ["survival", "Survival", 22], ["diplomacy", "Diplomacy", 25]],
      strength: { label: "Appeal to Belkzen Heritage", description: "Appeals to shared dromaar heritage raise Uncle Memscut's Influence DCs by 2 for one round.", value: 2, type: "circumstance", mode: "dc" },
      background: "A Shadde-Quah shaman from the shores of Varisia and friend of Grandmother Datiti.",
      appearance: "Bald, with an octopus tattoo across his scalp and small glasses.", personality: "Honorable, slow to speak, forthcoming.",
      rewards: [{ id: randomID(), kind: "modifier", label: "Memscut's Counsel", description: "Uncle Memscut asks Tsiwak about scouting farther into Belkzen.", value: 1, type: "circumstance", mode: "roll", scope: "influence", skills: [], uses: 1, remaining: 1, activation: "automatic", active: true, targetNpcId: "tsiwak", playerVisible: true, text: "Gain a +1 circumstance bonus to Influence Tsiwak on the next check." }]
    })
  ],
  activeNpcId: "tsiwak"
};

class Store {
  static all() { return deepClone(game.settings.get(MODULE_ID, SETTINGS.encounters) ?? {}); }
  static activeId() { return game.settings.get(MODULE_ID, SETTINGS.active) ?? ""; }
  static get(id = this.activeId()) {
    const encounter = this.all()[id] ?? null;
    return encounter ? normalizeEncounterCollections(encounter) : null;
  }
  static async save(encounter) {
    normalizeEncounterCollections(encounter);
    const all = this.all();
    all[encounter.id] = deepClone(encounter);
    await game.settings.set(MODULE_ID, SETTINGS.encounters, all);
    if (game.user.isGM) await syncEncounterJournal(encounter);
    Hooks.callAll("influenceEncounterUpdated", encounter.id);
  }
  static async remove(id) {
    if (this.activeId() === id) await game.settings.set(MODULE_ID, SETTINGS.active, "");
    const all = this.all();
    delete all[id];
    await game.settings.set(MODULE_ID, SETTINGS.encounters, all);
  }
  static async setActive(id) { await game.settings.set(MODULE_ID, SETTINGS.active, id); }
}

class FolderStore {
  static all() {
    return indexedArray(deepClone(game.settings.get(MODULE_ID, SETTINGS.folders) ?? [])).map((folder) => ({
      ...folder,
      color: folder.color || "#000000",
      sorting: folder.sorting === "m" ? "m" : "a"
    }));
  }
  static async save(folders) {
    await game.settings.set(MODULE_ID, SETTINGS.folders, indexedArray(folders));
    renderInfluenceSidebar();
  }
}

let influenceSidebarSearch = "";
const collapsedInfluenceFolders = new Set();

function participantPortrait(actor) {
  return actor?.prototypeToken?.texture?.src || actor?.img || "icons/svg/mystery-man.svg";
}

async function actorFromDropEvent(event) {
  let data = {};
  try {
    data = TextEditor.getDragEventData(event);
  } catch (_error) {
    try { data = JSON.parse(event.dataTransfer?.getData("text/plain") || "{}"); } catch (_parseError) { return null; }
  }
  let actor = null;
  if (data.uuid) {
    const document = await fromUuid(data.uuid);
    actor = document?.documentName === "Token" ? document.actor : document?.documentName === "Actor" ? document : null;
  }
  return actor ?? (data.actorId ? game.actors.get(data.actorId) : null);
}

function findBoon(encounter, boonId) {
  return encounter.npcs.flatMap((npc) => npc.thresholds).flatMap((threshold) => threshold.boons).find((boon) => boon.id === boonId);
}

function publicEncounterHtml(encounter) {
  const results = encounter.npcs.map((npc) => {
    const reached = npc.thresholds.filter((threshold) => npc.points >= threshold.points);
    const rewards = reached.map((threshold) => `<article><h4>${esc(threshold.label)}</h4><p>${esc(threshold.text)}</p>${threshold.boons?.filter((boon) => boon.playerVisible).length ? `<ul>${threshold.boons.filter((boon) => boon.playerVisible).map((boon) => `<li><strong>${esc(boon.label)}</strong>${boon.description ? ` — ${esc(boon.description)}` : ""}</li>`).join("")}</ul>` : ""}</article>`).join("");
    return `<section><h3>${esc(npc.name)}${encounter.publicPoints ? ` — ${npc.points} IP` : ""}</h3>${npc.appearance ? `<p><strong>Appearance:</strong> ${esc(npc.appearance)}</p>` : ""}${rewards}</section>`;
  }).join("");
  const rows = encounter.checkLog.map((entry) => {
    const details = (entry.details ?? []).map(concealDiscoveryDC);
    const detailHtml = details.length ? `<ul>${details.map((detail) => `<li>${esc(detail)}</li>`).join("")}</ul>` : "";
    return `<tr><td>${esc(entry.actorName)}</td><td>${esc(entry.npcName ?? "")}</td><td>${entry.type === "discovery" ? "Discovery" : "Influence"}</td><td>${esc(entry.skillLabel)}</td><td>${esc(String(entry.outcome).replace(/ — Invalid Discovery Skill$/, ""))}${detailHtml}</td></tr>`;
  }).join("");
  const status = encounter.endedAt ? "Completed" : encounter.status === "paused" ? "Paused" : "In Progress";
  return `<article class="influence-encounter-archive"><h1>${esc(encounter.name)}</h1><p><strong>${status}</strong> · Phase ${encounter.currentPhase} of ${encounter.phases}</p><section><h2>Targets and Results</h2>${results}</section><section><h2>Check Log</h2>${rows ? `<table><thead><tr><th>PC</th><th>Target</th><th>Check</th><th>Skill</th><th>Outcome</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>No checks have been completed.</p>"}</section></article>`;
}

function encounterJournalName(encounter) {
  return `Influence: ${encounter.name}${encounter.status === "paused" ? " (Paused)" : ""}`;
}

async function syncEncounterJournal(encounter) {
  if (!encounter?.id || !game.user.isGM) return;
  let journal = encounter.journalId ? game.journal.get(encounter.journalId) : null;
  if (!journal) {
    journal = await JournalEntry.create({
      name: encounterJournalName(encounter),
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: { [MODULE_ID]: { encounterId: encounter.id, archive: true } }
    });
    if (!journal) return;
    encounter.journalId = journal.id;
    const all = Store.all();
    all[encounter.id] = deepClone(encounter);
    await game.settings.set(MODULE_ID, SETTINGS.encounters, all);
  }
  const journalName = encounterJournalName(encounter);
  if (journal.name !== journalName) await journal.update({ name: journalName });
  const content = publicEncounterHtml(encounter);
  const page = journal.pages.find((entry) => entry.getFlag(MODULE_ID, "encounterArchive"));
  const pageData = { name: "Encounter Record", type: "text", text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 }, flags: { [MODULE_ID]: { encounterArchive: true } } };
  if (page) await page.update(pageData);
  else await journal.createEmbeddedDocuments("JournalEntryPage", [pageData]);
  if (encounter.endedAt && journal.ownership.default !== CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) {
    await journal.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } });
  } else if (!encounter.endedAt && journal.ownership.default !== CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE) {
    await journal.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } });
  }
}

function snapshot(encounter, label) {
  const copy = deepClone(encounter);
  copy.history = [];
  encounter.history ??= [];
  encounter.history.push({ id: randomID(), at: Date.now(), label, state: copy });
  if (encounter.history.length > 50) encounter.history.shift();
}

function folderPartyCharacters() {
  const partyRoot = game.folders.find((folder) => folder.type === "Actor" && folder.name.toLowerCase() === "party");
  if (!partyRoot) return [];
  const folderIds = new Set([partyRoot.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of game.folders.filter((entry) => entry.type === "Actor")) {
      const parentId = folder.folder?.id ?? folder.folder ?? null;
      if (parentId && folderIds.has(parentId) && !folderIds.has(folder.id)) {
        folderIds.add(folder.id);
        changed = true;
      }
    }
  }
  return game.actors
    .filter((actor) => actor.type === "character" && folderIds.has(actor.folder?.id ?? actor.folder))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function defaultPartyCharacters() {
  const members = game.actors
    .filter((actor) => actor.type === "party")
    .flatMap((party) => Array.from(party.members ?? []))
    .filter((actor) => actor?.type === "character");
  const uniqueMembers = [...new Map(members.map((actor) => [actor.id, actor])).values()];
  return (uniqueMembers.length ? uniqueMembers : folderPartyCharacters())
    .sort((a, b) => a.name.localeCompare(b.name));
}

function allCharacters() {
  return game.actors
    .filter((actor) => actor.type === "character")
    .sort((a, b) => a.name.localeCompare(b.name));
}

function encounterParticipants(encounter) {
  const defaults = defaultPartyCharacters();
  if (!Array.isArray(encounter?.participantIds)) return defaults;
  return encounter.participantIds.map((id) => game.actors.get(id)).filter((actor) => actor?.type === "character");
}

function canUserControlActor(actor, user = game.user) {
  return !!actor?.testUserPermission?.(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
}

function encounterViewSelection(encounter) {
  if (!encounter) return { actorId: "", npcId: "" };
  if (game.user.isGM) return { actorId: encounter.activeActorId ?? "", npcId: encounter.activeNpcId ?? encounter.npcs[0]?.id ?? "" };
  const participants = encounterParticipants(encounter);
  const owned = participants.filter((actor) => canUserControlActor(actor));
  const saved = game.settings.get(MODULE_ID, SETTINGS.selections)?.[encounter.id] ?? {};
  const actorId = owned.some((actor) => actor.id === saved.actorId)
    ? saved.actorId
    : owned.find((actor) => actor.id === game.user.character?.id)?.id ?? owned[0]?.id ?? "";
  const npcId = encounter.npcs.some((npc) => npc.id === saved.npcId)
    ? saved.npcId
    : encounter.activeNpcId ?? encounter.npcs[0]?.id ?? "";
  return { actorId, npcId };
}

async function setEncounterViewSelection(encounter, changes) {
  const selections = deepClone(game.settings.get(MODULE_ID, SETTINGS.selections) ?? {});
  selections[encounter.id] = { ...encounterViewSelection(encounter), ...changes };
  await game.settings.set(MODULE_ID, SETTINGS.selections, selections);
}

function skillStatistic(actor, slug, label) {
  let statistic = actor?.getStatistic?.(slug) ?? null;
  if (statistic) return statistic;
  const normalized = slug.toLowerCase().replace(/-lore$/, "").replaceAll("-", " ");
  const lore = actor?.itemTypes?.lore?.find((i) => {
    const name = i.name.toLowerCase().replace(/ lore$/, "");
    return name === normalized || i.slug === slug;
  });
  if (lore) return actor.getStatistic?.(lore.slug) ?? lore.system?.mod ?? null;
  return null;
}

function loreItemForSkill(actor, skill) {
  const slug = String(skill.slug ?? "").toLowerCase();
  const normalizedSlug = slug.replace(/-lore$/, "").replaceAll("-", " ");
  const normalizedLabel = String(skill.label ?? "").toLowerCase().replace(/ lore$/, "");
  return actor?.itemTypes?.lore?.find((item) => {
    const itemName = item.name.toLowerCase().replace(/ lore$/, "");
    return item.slug === slug || itemName === normalizedSlug || itemName === normalizedLabel;
  }) ?? null;
}

function isLoreSkill(skill) {
  return !!skill.lore || /(?:^|-)lore$/.test(String(skill.slug ?? "").toLowerCase()) || / lore$/i.test(String(skill.label ?? ""));
}

function availableSkillsForActor(actor, skills) {
  return skills.filter((skill) => !isLoreSkill(skill) || !!loreItemForSkill(actor, skill));
}

function actorSkillChoices(actor) {
  return Object.values(actor?.skills ?? {})
    .filter((statistic) => statistic?.slug && statistic?.label && statistic?.roll)
    .map((statistic) => ({ slug: statistic.slug, label: game.i18n.localize(statistic.label), lore: !!statistic.lore, rank: Number(statistic.rank) || 0 }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function trainedSkillChoices(actor) {
  return actorSkillChoices(actor).filter((skill) => skill.rank >= 1);
}

function concealDiscoveryDC(fact) {
  const text = String(fact ?? "");
  let match = text.match(/^(.+?) DC \d+\.?$/i);
  if (match) return `Secret Discovery Skill — ${match[1]}`;
  match = text.match(/^(.+?) is the lowest non-Lore option at DC \d+\.?$/i);
  if (match) return `Lowest non-Lore DC — ${match[1]}`;
  match = text.match(/^(.+?) is the highest non-Lore option at DC \d+\.?$/i);
  if (match) return `Highest non-Lore DC — ${match[1]}`;
  return text.replace(/\s*\(DC \d+\)(\.)?$/i, "$1");
}

class InfluenceTracker extends Application {
  constructor(options = {}) { super(options); }
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "influence-encounter-tracker", title: "Influence Encounter", template: `modules/${MODULE_ID}/templates/tracker.hbs`,
      width: 640, height: "auto", resizable: true, classes: [MODULE_ID],
      tabs: [{ navSelector: ".tracker-tabs", contentSelector: ".tracker-content", initial: "encounter" }]
    });
  }
  getData() {
    const encounter = Store.get();
    const participants = encounterParticipants(encounter);
    if (encounter && !participants.some((actor) => actor.id === encounter.activeActorId)) encounter.activeActorId = "";
    const selection = encounterViewSelection(encounter);
    const actors = participants.map((actor) => ({ id: actor.id, name: actor.name, image: participantPortrait(actor), acted: !!encounter?.actorsActed?.[actor.id] }));
    const controlledActors = actors.filter((entry) => game.user.isGM || canUserControlActor(game.actors.get(entry.id)))
      .map((entry) => ({ ...entry, selected: entry.id === selection.actorId }));
    const activeNpc = encounter?.npcs.find((npc) => npc.id === selection.npcId) ?? encounter?.npcs[0] ?? null;
    const thresholds = (activeNpc?.thresholds ?? []).map((threshold) => ({
      ...threshold,
      unlocked: activeNpc.points >= threshold.points,
      boons: threshold.boons.filter((boon) => game.user.isGM || boon.playerVisible)
    }));
    const knownDiscoveries = (encounter?.discoveries?.[game.user.id]?.npcs?.[activeNpc?.id]?.facts ?? []).map(concealDiscoveryDC);
    const checkLog = [...(encounter?.checkLog ?? [])].reverse().map((entry) => ({ ...entry,
      typeLabel: entry.type === "discovery" ? "Discovery" : "Influence",
      details: entry.type === "discovery" ? (entry.details ?? []).map(concealDiscoveryDC) : (entry.details ?? []),
      displayOutcome: !game.user.isGM && entry.type === "discovery"
        ? (entry.outcome.includes("Invalid Discovery Skill") ? "Failure" : entry.outcome.startsWith("Critical Success") ? "Critical Success" : entry.outcome.startsWith("Success") ? "Success" : "Failure")
        : entry.outcome
    }));
    const npcs = (encounter?.npcs ?? []).map((npc) => ({ ...npc, active: npc.id === activeNpc?.id, showPoints: game.user.isGM || encounter.publicPoints }));
    return { encounter, activeNpc, actors, controlledActors, npcs, thresholds, knownDiscoveries, checkLog, isGM: game.user.isGM, showPoints: game.user.isGM || encounter?.publicPoints, noEncounter: !encounter, isPaused: encounter?.status === "paused", canAct: !!encounter && encounter.status === "active" && !!selection.actorId, canPause: game.user.isGM && encounter?.status === "active", canResume: game.user.isGM && encounter?.status === "paused", canPrior: encounter?.status === "active" && (encounter?.currentPhase ?? 1) > 1, canNext: encounter?.status === "active" && (encounter?.currentPhase ?? 1) < (encounter?.phases ?? 1) };
  }
  activateListeners(html) {
    super.activateListeners(html);
    html.find("[data-action]").on("click", (event) => this._action(event));
  }
  async _action(event) {
    const action = event.currentTarget.dataset.action;
    const encounter = Store.get();
    if (action === "manage") return new EncounterManager().render(true);
    if (!encounter) return;
    if (action === "select-participant") {
      const actorId = event.currentTarget.dataset.actorId;
      const actor = game.actors.get(actorId);
      if (!game.user.isGM && !canUserControlActor(actor)) return ui.notifications.warn(`You do not own ${actor?.name ?? "that character"}.`);
      if (game.user.isGM) {
        encounter.activeActorId = actorId;
        await Store.save(encounter);
      } else {
        await setEncounterViewSelection(encounter, { actorId });
        this.render(false);
        renderInfluenceSidebar();
      }
      return;
    }
    if (action === "select-npc") {
      const npcId = event.currentTarget.dataset.npcId;
      if (game.user.isGM) {
        encounter.activeNpcId = npcId;
        await Store.save(encounter);
      } else {
        await setEncounterViewSelection(encounter, { npcId });
        this.render(false);
        renderInfluenceSidebar();
      }
      return this.render(false);
    }
    if (action === "request") {
      const selection = encounterViewSelection(encounter);
      return requestCheck(encounter, event.currentTarget.dataset.type, selection.actorId, selection.npcId);
    }
    if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("INFLUENCE.GMOnly"));
    if (action === "pause") return pauseEncounter(encounter.id);
    if (action === "resume") return resumeEncounter(encounter.id);
    if (action === "undo") {
      let entry = encounter.history.pop();
      while (entry?.label === "undo") entry = encounter.history.pop();
      if (!entry) return ui.notifications.info("Nothing to undo.");
      const history = encounter.history;
      Object.assign(encounter, deepClone(entry.state), { history });
    } else if (action === "advance") {
      snapshot(encounter, action);
      encounter.phaseActions ??= {};
      encounter.phaseActions[encounter.currentPhase] = deepClone(encounter.actorsActed);
      encounter.currentPhase = Math.min(encounter.phases, encounter.currentPhase + 1);
      encounter.actorsActed = deepClone(encounter.phaseActions[encounter.currentPhase] ?? {});
    } else if (action === "prior") {
      snapshot(encounter, action);
      encounter.phaseActions ??= {};
      encounter.phaseActions[encounter.currentPhase] = deepClone(encounter.actorsActed);
      encounter.currentPhase = Math.max(1, encounter.currentPhase - 1);
      encounter.actorsActed = deepClone(encounter.phaseActions[encounter.currentPhase] ?? {});
    } else if (action === "adjust") {
      const npc = encounter.npcs.find((entry) => entry.id === encounter.activeNpcId);
      const value = await promptNumber(`Adjust Influence Points: ${npc.name}`, npc.points);
      if (value === null) return;
      snapshot(encounter, action);
      npc.points = Math.max(0, value);
    } else if (action === "change-ip") {
      const npc = encounter.npcs.find((entry) => entry.id === encounter.activeNpcId);
      const delta = Number(event.currentTarget.dataset.delta);
      if (!Number.isFinite(delta) || delta === 0) return;
      snapshot(encounter, `${npc.name}: ${signed(delta)} IP`);
      npc.points = Math.max(0, Number(npc.points) + delta);
    } else if (action === "apply-reward") {
      const boon = findBoon(encounter, event.currentTarget.dataset.id);
      const targetNpc = encounter.npcs.find((npc) => npc.id === boon?.targetNpcId);
      if (!boon || boon.kind !== "ip" || !targetNpc || boon.applied) return;
      snapshot(encounter, boon.label);
      targetNpc.points = Math.max(0, Number(targetNpc.points) + Number(boon.value));
      boon.applied = true;
    } else if (action === "reset-actions") {
      snapshot(encounter, action);
      encounter.actorsActed = {};
    } else if (action === "end-encounter") {
      if (!await Dialog.confirm({ title: "End Influence Encounter", content: "<p>End this encounter and make its Journal record available to players?</p>" })) return;
      snapshot(encounter, action);
      encounter.status = "complete";
      encounter.endedAt = Date.now();
      encounter.presentationVisible = false;
    } else if (action === "remove-effect") {
      snapshot(encounter, action);
      encounter.activeEffects = encounter.activeEffects.filter((e) => e.id !== event.currentTarget.dataset.id);
    } else return;
    await Store.save(encounter);
    this.render(false);
  }
}

function renderCinematicHud() {
  let hud = document.getElementById("influence-cinematic-hud");
  if (!hud) {
    hud = document.createElement("section");
    hud.id = "influence-cinematic-hud";
    document.body.append(hud);
  }
  const encounter = Store.get();
  if (!encounter || encounter.status !== "active" || !encounter.presentationVisible) {
    hud.className = "";
    hud.innerHTML = "";
    return;
  }
  const actor = game.actors.get(encounter.activeActorId);
  const npc = encounter.npcs.find((entry) => entry.id === encounter.activeNpcId) ?? encounter.npcs[0];
  const actorHtml = actor
    ? `<figure class="influence-speaker influence-speaker-pc"><img src="${esc(participantPortrait(actor))}" alt="${esc(actor.name)}"><figcaption>${esc(actor.name)}</figcaption></figure>`
    : `<figure class="influence-speaker influence-speaker-empty"><div class="influence-silhouette"><i class="fa-solid fa-user"></i></div><figcaption>Choose a participant</figcaption></figure>`;
  const npcHtml = npc
    ? `<figure class="influence-speaker influence-speaker-npc"><img src="${esc(npc.image)}" alt="${esc(npc.name)}"><figcaption>${esc(npc.name)}</figcaption></figure>`
    : "";
  hud.className = "visible";
  hud.style.setProperty("--influence-blur", `${Number(encounter.backgroundBlur) || 0}px`);
  hud.innerHTML = `<div class="influence-cinematic-backdrop"${encounter.backgroundImage ? ` style="background-image:url('${esc(encounter.backgroundImage)}')"` : ""}></div><div class="influence-cinematic-stage">${actorHtml}<div class="influence-conversation-mark"><i class="fa-solid fa-comments"></i></div>${npcHtml}</div>`;
}

function activateInfluenceSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  sidebar.querySelectorAll("#sidebar-tabs [data-tab]").forEach((button) => {
    const active = button.dataset.tab === "influence-encounters";
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  sidebar.querySelectorAll("#sidebar-content > .tab").forEach((section) => {
    const active = section.id === "influence-encounters-sidebar";
    section.classList.toggle("active", active);
    if (active) section.hidden = false;
  });
  document.getElementById("sidebar-content")?.className && (document.getElementById("sidebar-content").className = "flexcol active-influence-encounters expanded");
}

function renderInfluenceSidebar() {
  const sidebar = document.getElementById("sidebar");
  const tabsMenu = sidebar?.querySelector("#sidebar-tabs > menu");
  const content = sidebar?.querySelector("#sidebar-content");
  if (!tabsMenu || !content) return;
  if (!tabsMenu.dataset.influenceTabBound) {
    tabsMenu.dataset.influenceTabBound = "true";
    tabsMenu.addEventListener("click", (event) => {
      const selectedTab = event.target.closest("button[data-tab]")?.dataset.tab;
      if (!selectedTab || selectedTab === "influence-encounters") return;
      const influencePanel = document.getElementById("influence-encounters-sidebar");
      if (influencePanel) {
        influencePanel.classList.remove("active");
        influencePanel.hidden = true;
      }
      const influenceButton = tabsMenu.querySelector('[data-tab="influence-encounters"]');
      influenceButton?.classList.remove("active");
      influenceButton?.setAttribute("aria-pressed", "false");
    }, true);
  }
  let tabButton = tabsMenu.querySelector('[data-tab="influence-encounters"]');
  if (!tabButton) {
    const item = document.createElement("li");
    item.innerHTML = '<button type="button" class="ui-control plain icon fa-solid fa-comments" data-tab="influence-encounters" role="tab" aria-pressed="false" aria-label="Influence Encounter" data-tooltip="Influence Encounter"></button><div class="notification-pip"></div>';
    tabButton = item.querySelector("button");
    tabButton.addEventListener("click", activateInfluenceSidebar);
    tabsMenu.insertBefore(item, tabsMenu.lastElementChild);
  }
  let panel = document.getElementById("influence-encounters-sidebar");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "influence-encounters-sidebar";
    panel.className = "tab sidebar-tab flexcol influence-sidebar";
    panel.hidden = true;
    content.append(panel);
  }
  const encounter = Store.get();
  if (game.user.isGM) {
    panel.classList.add("directory");
    panel.innerHTML = renderEncounterDirectory();
  } else if (!encounter) {
    panel.classList.remove("directory");
    panel.innerHTML = '<div class="influence-sidebar-body"><p>No active encounter.</p></div>';
  } else {
    panel.classList.remove("directory");
    const actors = encounterParticipants(encounter);
    const selection = encounterViewSelection(encounter);
    const actorRows = actors.map((actor) => `<div class="influence-sidebar-person ${encounter.actorsActed?.[actor.id] ? "acted" : ""}"><img src="${esc(participantPortrait(actor))}" alt=""><span>${esc(actor.name)}</span><i class="fa-solid ${encounter.actorsActed?.[actor.id] ? "fa-check" : "fa-hourglass"}" title="${encounter.actorsActed?.[actor.id] ? "Acted this phase" : "Has not acted"}"></i></div>`).join("");
    const npcRows = encounter.npcs.map((npc) => `<div class="influence-sidebar-npc ${npc.id === selection.npcId ? "active" : ""}" draggable="${game.user.isGM}"><button data-influence-action="select-npc" data-id="${npc.id}" title="Review and target ${esc(npc.name)}"><img src="${esc(npc.image)}" alt=""><span>${esc(npc.name)}</span></button>${game.user.isGM ? `<button class="icon-only" data-influence-action="edit-npc" data-id="${npc.id}" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="icon-only" data-influence-action="remove-npc" data-id="${npc.id}" title="Remove"><i class="fa-solid fa-trash"></i></button>` : ""}</div>`).join("");
    const activeNpc = encounter.npcs.find((npc) => npc.id === selection.npcId) ?? encounter.npcs[0];
    panel.innerHTML = `<header class="influence-sidebar-header"><div><h2>${esc(encounter.name)}</h2><p>Phase ${encounter.currentPhase} of ${encounter.phases}</p></div><strong>${game.user.isGM || encounter.publicPoints ? `${activeNpc?.points ?? 0} IP` : "— IP"}</strong></header><div class="influence-sidebar-body"><h3>PCs in the Encounter</h3><div class="influence-sidebar-people">${actorRows || "<p>No participants.</p>"}</div><h3>Influence Targets</h3><div class="influence-sidebar-npcs">${npcRows}</div><div class="influence-sidebar-actions"><button data-influence-action="open"><i class="fa-solid fa-up-right-from-square"></i> Open Encounter</button>${encounter.status === "active" ? '<button data-influence-action="discovery"><i class="fa-solid fa-magnifying-glass"></i> Discovery</button><button data-influence-action="influence"><i class="fa-solid fa-comments"></i> Influence</button>' : ""}</div></div>`;
  }
  panel.querySelectorAll("[data-influence-action]").forEach((button) => button.addEventListener("click", handleSidebarAction));
  if (game.user.isGM) activateEncounterDirectoryListeners(panel);
}

function encounterDirectoryEntry(entry) {
  const active = entry.id === Store.activeId() && entry.status === "active";
  const paused = entry.status === "paused";
  return `<li class="directory-item document influence-sidebar-encounter ${active ? "active" : ""} ${paused ? "paused" : ""}" data-entry-id="${entry.id}" data-folder-id="${esc(entry.folderId)}" draggable="true" tabindex="0"><img class="thumbnail" src="${esc(entry.image)}" alt=""><a class="document-name ellipsis">${esc(entry.name)}${paused ? " (Paused)" : ""}</a>${active ? '<i class="fa-solid fa-play influence-active-marker" data-tooltip="Active Encounter"></i>' : paused ? '<i class="fa-solid fa-pause influence-active-marker" data-tooltip="Paused Encounter"></i>' : ""}</li>`;
}

function renderEncounterDirectory() {
  const query = influenceSidebarSearch.trim().toLowerCase();
  const encounters = Object.values(Store.all()).map(normalizeEncounterCollections)
    .filter((entry) => !query || entry.name.toLowerCase().includes(query));
  const folders = FolderStore.all().sort((a, b) => a.name.localeCompare(b.name));
  const folderIds = new Set(folders.map((folder) => folder.id));
  const rootEntries = encounters.filter((entry) => !entry.folderId || !folderIds.has(entry.folderId));
  const folderHtml = folders.map((folder) => {
    const children = encounters.filter((entry) => entry.folderId === folder.id).sort(folder.sorting === "m"
      ? (a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0)
      : (a, b) => a.name.localeCompare(b.name));
    if (query && !children.length && !folder.name.toLowerCase().includes(query)) return "";
    const expanded = query || !collapsedInfluenceFolders.has(folder.id);
    const colorStyle = folder.color ? ` style="background-color:${esc(folder.color)}"` : "";
    const borderStyle = folder.color ? ` style="border-left-color:${esc(folder.color)}"` : "";
    return `<li class="directory-item folder flexcol influence-folder ${expanded ? "expanded" : ""}" data-folder-id="${folder.id}"><header class="folder-header"${colorStyle}><i class="fa-solid fa-folder-open fa-fw" inert></i><span class="folder-name ellipsis">${esc(folder.name)}</span><button type="button" class="create-button create-entry icon icon-plus fa-solid fa-comments" data-influence-action="new-encounter" data-folder-id="${folder.id}" data-tooltip aria-label="Create Encounter"></button></header><ol class="subdirectory plain"${borderStyle}>${children.map(encounterDirectoryEntry).join("")}</ol></li>`;
  }).join("");
  return `<header class="directory-header"><div class="header-actions action-buttons flexrow"><button type="button" data-influence-action="new-encounter"><i class="fa-solid fa-file-circle-plus"></i> Create Encounter</button><button type="button" data-influence-action="new-folder"><i class="fa-solid fa-folder-plus"></i> Create Folder</button></div><search class="directory-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" name="search" value="${esc(influenceSidebarSearch)}" autocomplete="off" placeholder="Search Encounters"><button type="button" class="inline-control icon fa-solid fa-xmark" data-influence-action="clear-search" aria-label="Clear Search"></button></search></header><ol class="directory-list plain">${rootEntries.sort((a, b) => a.name.localeCompare(b.name)).map(encounterDirectoryEntry).join("")}${folderHtml}${!encounters.length && !folders.length ? '<li class="directory-item"><p class="hint">No influence encounters found.</p></li>' : ""}</ol>`;
}

function activateEncounterDirectoryListeners(panel) {
  const search = panel.querySelector('.directory-search input[name="search"]');
  search?.addEventListener("input", () => {
    influenceSidebarSearch = search.value;
    const query = influenceSidebarSearch.trim().toLowerCase();
    panel.querySelectorAll(".influence-sidebar-encounter").forEach((entry) => {
      entry.hidden = !!query && !entry.querySelector(".document-name")?.textContent.toLowerCase().includes(query);
    });
    panel.querySelectorAll(".influence-folder").forEach((folder) => {
      const folderMatches = folder.querySelector(".folder-name")?.textContent.toLowerCase().includes(query);
      const childMatches = [...folder.querySelectorAll(".influence-sidebar-encounter")].some((entry) => !entry.hidden);
      folder.hidden = !!query && !folderMatches && !childMatches;
    });
  });
  panel.querySelectorAll(".influence-sidebar-encounter").forEach((entry) => {
    const open = () => openSidebarEncounter(entry.dataset.entryId);
    entry.addEventListener("click", open);
    entry.addEventListener("keydown", (event) => { if (event.key === "Enter") open(); });
    entry.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showEncounterContextMenu(event, entry.dataset.entryId);
    });
    entry.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("application/x-influence-encounter", entry.dataset.entryId);
      event.dataTransfer.effectAllowed = "move";
    });
  });
  panel.querySelectorAll(".influence-folder").forEach((folder) => {
    const header = folder.querySelector(".folder-header");
    header?.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const id = folder.dataset.folderId;
      if (collapsedInfluenceFolders.has(id)) collapsedInfluenceFolders.delete(id);
      else collapsedInfluenceFolders.add(id);
      folder.classList.toggle("expanded");
    });
    header?.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showFolderContextMenu(event, folder.dataset.folderId);
    });
    folder.addEventListener("dragover", (event) => {
      if (!event.dataTransfer.types.includes("application/x-influence-encounter")) return;
      event.preventDefault();
      folder.classList.add("droptarget");
    });
    folder.addEventListener("dragleave", () => folder.classList.remove("droptarget"));
    folder.addEventListener("drop", async (event) => {
      const id = event.dataTransfer.getData("application/x-influence-encounter");
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      folder.classList.remove("droptarget");
      await moveEncounterToFolder(id, folder.dataset.folderId);
    });
  });
  const root = panel.querySelector(":scope > .directory-list");
  root?.addEventListener("dragover", (event) => {
    if (event.target.closest(".influence-folder") || !event.dataTransfer.types.includes("application/x-influence-encounter")) return;
    event.preventDefault();
  });
  root?.addEventListener("drop", async (event) => {
    if (event.target.closest(".influence-folder")) return;
    const id = event.dataTransfer.getData("application/x-influence-encounter");
    if (id) await moveEncounterToFolder(id, "");
  });
}

function openSidebarEncounter(id) {
  if (!game.user.isGM) return;
  return id === Store.activeId() && Store.get(id)?.status === "active"
    ? tracker.render(true)
    : new EncounterEditor(Store.get(id)).render({ force: true });
}

async function moveEncounterToFolder(id, folderId) {
  const encounter = Store.get(id);
  if (!encounter || encounter.folderId === folderId) return;
  encounter.folderId = folderId;
  await Store.save(encounter);
}

class InfluenceFolderConfig extends foundry.applications.sheets.FolderConfig {
  _onRender(context, options) {
    super._onRender(context, options);
    const picker = this.element.querySelector('color-picker[name="color"]');
    if (!picker) return;
    const captureColor = () => { this.pendingFolderColor = picker.value; };
    picker.addEventListener("input", captureColor, { signal: this._folderColorAbort?.signal });
    picker.addEventListener("change", captureColor, { signal: this._folderColorAbort?.signal });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (this.influenceFolderId) {
      context.name = this.document.name;
      context.namePlaceholder = this.document.name;
      context.buttons = [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "Update Folder" }];
    }
    return context;
  }

  async _processSubmitData(_event, form, submitData) {
    const folders = FolderStore.all();
    const id = this.influenceFolderId || randomID();
    // Foundry's form-associated color-picker can retain its new value without
    // including it in FormDataExtended until another ordinary field changes.
    // Read the live custom element value at submission time.
    const colorPicker = form.elements.namedItem("color") ?? form.querySelector('color-picker[name="color"]');
    const liveColor = colorPicker?.value;
    const submittedColor = this.pendingFolderColor || liveColor || submitData.color?.css || submitData.color;
    const folder = {
      id,
      name: submitData.name?.trim() || "Folder",
      color: submittedColor ? String(submittedColor) : "#000000",
      sorting: submitData.sorting === "m" ? "m" : "a"
    };
    const index = folders.findIndex((entry) => entry.id === id);
    if (index >= 0) folders[index] = folder;
    else folders.push(folder);
    await FolderStore.save(folders);
    return {};
  }
}

function openEncounterFolderConfig(event, existingFolder = null) {
  const FolderClass = foundry.documents.Folder.implementation;
  const folder = new FolderClass({
    name: existingFolder?.name || "Folder",
    type: "JournalEntry",
    color: existingFolder?.color || "#000000",
    sorting: existingFolder?.sorting === "m" ? "m" : "a"
  });
  const application = new InfluenceFolderConfig({
    document: folder,
    position: {
      top: event?.currentTarget?.offsetTop ?? event?.target?.offsetTop ?? 0,
      left: window.innerWidth - 790
    }
  });
  // ApplicationV2 discards undeclared option keys. Keep the custom folder ID
  // on the application instance so configuring a folder updates it in place.
  application.influenceFolderId = existingFolder?.id || "";
  application.pendingFolderColor = existingFolder?.color || "#000000";
  return application.render({ force: true });
}

function createEncounterFolder(event) {
  return openEncounterFolderConfig(event);
}

async function openCreateEncounterDialog(event, folderId = "") {
  if (!game.user.isGM) return;
  const folders = FolderStore.all().sort((a, b) => a.name.localeCompare(b.name));
  const content = document.createElement("div");
  content.innerHTML = await foundry.applications.handlebars.renderTemplate("templates/sidebar/document-create.html", {
    name: "",
    defaultName: "New Influence Encounter",
    folder: folderId,
    folders,
    hasFolders: folders.length > 0,
    hasTypes: true,
    type: "single",
    types: [
      { value: "single", label: "Single NPC" },
      { value: "multiple", label: "Multiple NPCs" }
    ],
    typeHint: ""
  });

  return foundry.applications.api.DialogV2.prompt({
    content,
    window: { title: "Create Encounter" },
    position: {
      width: 320,
      left: window.innerWidth - 630,
      top: event?.currentTarget?.offsetTop ?? 0
    },
    ok: {
      label: "Create Encounter",
      callback: async (_event, button) => {
        const data = new foundry.applications.ux.FormDataExtended(button.form).object;
        const encounter = deepClone(DEFAULT_ENCOUNTER);
        encounter.id = randomID();
        encounter.name = data.name?.trim() || "New Influence Encounter";
        encounter.encounterType = data.type === "multiple" ? "multiple" : "single";
        encounter.folderId = data.folder || "";
        normalizeEncounterCollections(encounter);
        encounter.npcs[0].name = encounter.name;
        await Store.save(encounter);
        new EncounterEditor(Store.get(encounter.id)).render({ force: true });
        return encounter;
      }
    }
  });
}

function showFolderContextMenu(event, folderId) {
  const folder = FolderStore.all().find((entry) => entry.id === folderId);
  if (!folder) return;
  closeEncounterContextMenu();
  const menu = document.createElement("nav");
  menu.id = "influence-encounter-context-menu";
  menu.className = "influence-context-menu";
  menu.innerHTML = '<button type="button" data-folder-action="edit"><i class="fa-solid fa-pen"></i> Edit Folder</button><button type="button" data-folder-action="remove"><i class="fa-solid fa-folder-minus"></i> Remove Folder</button><hr><button type="button" data-folder-action="delete"><i class="fa-solid fa-trash"></i> Delete All</button>';
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - bounds.width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - bounds.height - 8)}px`;
  menu.querySelector('[data-folder-action="edit"]').addEventListener("click", () => {
    closeEncounterContextMenu();
    openEncounterFolderConfig(event, folder);
  });
  menu.querySelector('[data-folder-action="remove"]').addEventListener("click", async () => {
    closeEncounterContextMenu();
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remove Folder" },
      content: "<p><strong>Are you sure?</strong> Folder will be deleted and all contents moved to the parent folder.</p>"
    });
    if (!confirmed) return;
    const encounters = Store.all();
    for (const encounter of Object.values(encounters)) {
      if (encounter.folderId === folder.id) encounter.folderId = "";
    }
    await game.settings.set(MODULE_ID, SETTINGS.encounters, encounters);
    collapsedInfluenceFolders.delete(folder.id);
    await FolderStore.save(FolderStore.all().filter((entry) => entry.id !== folder.id));
    if (game.user.isGM) game.socket.emit(SOCKET, { action: "refresh" });
  });
  menu.querySelector('[data-folder-action="delete"]').addEventListener("click", async () => {
    closeEncounterContextMenu();
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete All" },
      content: "<p><strong>Are you sure?</strong> This folder and all its contents will be permanently deleted and cannot be recovered.</p>"
    });
    if (!confirmed) return;
    const encounters = Store.all();
    const deleted = Object.values(encounters).filter((encounter) => encounter.folderId === folder.id);
    const journalIds = deleted.map((encounter) => encounter.journalId).filter((id) => game.journal.has(id));
    if (journalIds.length) await JournalEntry.deleteDocuments(journalIds);
    for (const encounter of deleted) delete encounters[encounter.id];
    await game.settings.set(MODULE_ID, SETTINGS.encounters, encounters);
    if (deleted.some((encounter) => encounter.id === Store.activeId())) {
      await game.settings.set(MODULE_ID, SETTINGS.active, "");
      tracker?.render(false);
      renderCinematicHud();
    }
    collapsedInfluenceFolders.delete(folder.id);
    await FolderStore.save(FolderStore.all().filter((entry) => entry.id !== folder.id));
    if (game.user.isGM) game.socket.emit(SOCKET, { action: "refresh" });
  });
}

function closeEncounterContextMenu() {
  document.getElementById("influence-encounter-context-menu")?.remove();
}

function showEncounterContextMenu(event, encounterId) {
  const encounter = Store.get(encounterId);
  if (!game.user.isGM || !encounter) return;
  closeEncounterContextMenu();
  const menu = document.createElement("nav");
  menu.id = "influence-encounter-context-menu";
  menu.className = "influence-context-menu";
  const isActive = encounterId === Store.activeId() && encounter.status === "active";
  const lifecycle = encounter.status === "paused"
    ? '<button type="button" data-context-action="resume"><i class="fa-solid fa-play"></i> Resume</button>'
    : isActive
      ? '<button type="button" data-context-action="pause"><i class="fa-solid fa-pause"></i> Pause</button>'
      : '<button type="button" data-context-action="activate"><i class="fa-solid fa-play"></i> Activate</button>';
  menu.innerHTML = `<button type="button" data-context-action="edit"><i class="fa-solid fa-pen"></i> Edit</button>${lifecycle}<button type="button" data-context-action="duplicate"><i class="fa-solid fa-copy"></i> Duplicate</button><hr><button type="button" data-context-action="export"><i class="fa-solid fa-file-export"></i> Export Data</button><button type="button" data-context-action="import"><i class="fa-solid fa-file-import"></i> Import Data</button><hr><button type="button" data-context-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>`;
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - bounds.width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - bounds.height - 8)}px`;
  menu.querySelectorAll("[data-context-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.contextAction;
    closeEncounterContextMenu();
    if (action === "edit") new EncounterEditor(Store.get(encounterId)).render({ force: true });
    if (action === "activate") await activateEncounter(encounterId);
    if (action === "pause") await pauseEncounter(encounterId);
    if (action === "resume") await resumeEncounter(encounterId);
    if (action === "duplicate") await duplicateEncounter(encounterId);
    if (action === "export") exportEncounterData(encounterId);
    if (action === "import") importEncounterData();
    if (action === "delete") await deleteEncounter(encounterId);
  }));
  setTimeout(() => {
    document.addEventListener("pointerdown", (pointerEvent) => {
      if (!menu.contains(pointerEvent.target)) closeEncounterContextMenu();
    }, { once: true });
    document.addEventListener("keydown", closeEncounterContextMenu, { once: true });
  }, 0);
}

async function activateEncounter(id) {
  const encounter = Store.get(id);
  if (!encounter) return;
  encounter.status = "active";
  encounter.endedAt = null;
  encounter.presentationVisible = true;
  await Store.setActive(id);
  await Store.save(encounter);
  tracker?.render(true);
  renderInfluenceSidebar();
  renderCinematicHud();
}

async function pauseEncounter(id) {
  const encounter = Store.get(id);
  if (!encounter || encounter.status !== "active") return;
  snapshot(encounter, "pause");
  encounter.status = "paused";
  encounter.presentationVisible = false;
  await Store.setActive(id);
  await Store.save(encounter);
  tracker?.render(false);
  renderInfluenceSidebar();
  renderCinematicHud();
  game.socket.emit(SOCKET, { action: "refresh" });
}

async function resumeEncounter(id) {
  const encounter = Store.get(id);
  if (!encounter || encounter.status !== "paused") return;
  snapshot(encounter, "resume");
  encounter.status = "active";
  encounter.endedAt = null;
  encounter.presentationVisible = true;
  await Store.setActive(id);
  await Store.save(encounter);
  tracker?.render(true);
  renderInfluenceSidebar();
  renderCinematicHud();
  game.socket.emit(SOCKET, { action: "refresh" });
}

async function duplicateEncounter(id) {
  const source = Store.get(id);
  if (!source) return;
  const names = new Set(Object.values(Store.all()).map((entry) => String(entry.name).toLowerCase()));
  let name = `${source.name} (Copy)`;
  let copyNumber = 2;
  while (names.has(name.toLowerCase())) name = `${source.name} (Copy ${copyNumber++})`;
  const duplicate = deepClone(source);
  Object.assign(duplicate, {
    id: randomID(), name, status: "draft", currentPhase: 1, points: 0,
    activeActorId: "", actorsActed: {}, phaseActions: {}, discoveries: {},
    activeEffects: [], checkLog: [], history: [], journalId: "", endedAt: null,
    presentationVisible: true
  });
  duplicate.npcs.forEach((npc) => {
    npc.points = 0;
    npc.thresholds.forEach((threshold) => threshold.boons.forEach((boon) => {
      boon.remaining = boon.uses;
      boon.applied = false;
      boon.active = boon.activation === "automatic";
    }));
  });
  await Store.save(duplicate);
  renderInfluenceSidebar();
  ui.notifications.info(`Created ${duplicate.name}.`);
}

function uniqueEncounterName(preferredName, suffix = "Imported") {
  const names = new Set(Object.values(Store.all()).map((entry) => String(entry.name).toLowerCase()));
  if (!names.has(preferredName.toLowerCase())) return preferredName;
  let name = `${preferredName} (${suffix})`;
  let number = 2;
  while (names.has(name.toLowerCase())) name = `${preferredName} (${suffix} ${number++})`;
  return name;
}

function exportEncounterData(id) {
  const encounter = Store.get(id);
  if (!encounter) return ui.notifications.error("That influence encounter no longer exists.");
  const exported = deepClone(encounter);
  exported.journalId = "";
  saveDataToFile(JSON.stringify({
    type: "influence-encounter",
    version: 1,
    encounter: exported
  }, null, 2), "application/json", `${encounter.name.slugify() || "influence-encounter"}.json`);
}

function importEncounterData() {
  if (!game.user.isGM) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const source = parsed?.type === "influence-encounter" ? parsed.encounter : parsed;
      if (!source || typeof source !== "object" || Array.isArray(source) || typeof source.name !== "string") {
        throw new Error("The selected file is not an Influence Encounter export.");
      }
      const imported = foundry.utils.mergeObject(deepClone(DEFAULT_ENCOUNTER), deepClone(source), {
        inplace: false, overwrite: true, insertKeys: true, insertValues: true
      });
      normalizeEncounterCollections(imported);
      Object.assign(imported, {
        id: randomID(), name: uniqueEncounterName(imported.name), status: "draft",
        currentPhase: 1, points: 0, participantIds: null, activeActorId: "", actorsActed: {}, phaseActions: {},
        discoveries: {}, activeEffects: [], checkLog: [], history: [], journalId: "",
        endedAt: null, presentationVisible: true
      });
      imported.npcs.forEach((npc) => {
        npc.actorId = "";
        npc.points = 0;
        npc.thresholds.forEach((threshold) => threshold.boons.forEach((boon) => {
          boon.remaining = boon.uses;
          boon.applied = false;
          boon.active = boon.activation === "automatic";
        }));
      });
      await Store.save(imported);
      renderInfluenceSidebar();
      ui.notifications.info(`Imported ${imported.name}.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to import encounter`, error);
      ui.notifications.error(error.message || "Could not import that Influence Encounter file.");
    }
  }, { once: true });
  input.click();
}

async function deleteEncounter(id) {
  const encounter = Store.get(id);
  if (!encounter) return;
  const isActive = Store.activeId() === id;
  const confirmed = await Dialog.confirm({
    title: "Delete Influence Encounter",
    content: `<p>Delete <strong>${esc(encounter.name)}</strong>?</p><p>${isActive ? "The active encounter will be ended and published to its Journal before its definition is removed." : "This removes the encounter definition."} Its Journal record will remain available unless you delete that separately.</p>`
  });
  if (!confirmed) return;
  if (isActive) {
    encounter.status = "complete";
    encounter.endedAt = Date.now();
    encounter.presentationVisible = false;
    await Store.save(encounter);
  }
  await Store.remove(id);
  closeEncounterContextMenu();
  tracker?.render(false);
  renderInfluenceSidebar();
  renderCinematicHud();
  if (game.user.isGM) game.socket.emit(SOCKET, { action: "refresh" });
}

async function handleSidebarAction(event) {
  const action = event.currentTarget.dataset.influenceAction;
  if (action === "new-encounter" && game.user.isGM) {
    event.stopPropagation();
    return openCreateEncounterDialog(event, event.currentTarget.dataset.folderId || "");
  }
  if (action === "new-folder" && game.user.isGM) return createEncounterFolder(event);
  if (action === "clear-search") {
    influenceSidebarSearch = "";
    renderInfluenceSidebar();
    return;
  }
  if (action === "open-encounter" && game.user.isGM) {
    const id = event.currentTarget.dataset.id;
    return id === Store.activeId() && Store.get(id)?.status === "active"
      ? tracker.render(true)
      : new EncounterEditor(Store.get(id)).render({ force: true });
  }
  if (action === "open") return tracker.render(true);
  if (action === "manage") return new EncounterManager().render(true);
  const encounter = Store.get();
  if (!encounter) return;
  const selection = encounterViewSelection(encounter);
  if (["discovery", "influence"].includes(action)) return requestCheck(encounter, action, selection.actorId, selection.npcId);
  if (action === "select-npc" && !game.user.isGM) {
    await setEncounterViewSelection(encounter, { npcId: event.currentTarget.dataset.id });
    renderInfluenceSidebar();
    tracker?.render(false);
    return;
  }
  if (!game.user.isGM) return;
  if (action === "select-actor") encounter.activeActorId = event.currentTarget.dataset.id;
  else if (action === "select-npc") encounter.activeNpcId = event.currentTarget.dataset.id;
  else if (action === "toggle-presentation") encounter.presentationVisible = !encounter.presentationVisible;
  else if (action === "edit-npc") return editNpc(encounter, encounter.npcs.find((npc) => npc.id === event.currentTarget.dataset.id));
  else if (action === "remove-npc") {
    if (encounter.npcs.length <= 1) return ui.notifications.warn("An influence encounter must have at least one target.");
    encounter.npcs = encounter.npcs.filter((npc) => npc.id !== event.currentTarget.dataset.id);
    normalizeEncounterCollections(encounter);
  } else return;
  await Store.save(encounter);
}

async function editNpc(encounter, npc) {
  if (!npc) return;
  new Dialog({
    title: "Configure Influence Target",
    content: `<form><div class="form-group"><label>Name</label><input name="name" value="${esc(npc.name)}"></div><div class="form-group"><label>Portrait</label><file-picker name="image" type="imagevideo" value="${esc(npc.image)}"></file-picker></div><label>Background<textarea name="background">${esc(npc.background)}</textarea></label><label>Appearance<textarea name="appearance">${esc(npc.appearance)}</textarea></label><label>Personality<textarea name="personality">${esc(npc.personality)}</textarea></label><p class="hint">Use Edit Encounter for this target's skills, traits, thresholds, and rewards.</p></form>`,
    buttons: { save: { icon: '<i class="fa-solid fa-save"></i>', label: "Save", callback: async (html) => { npc.name = html.find('[name="name"]').val()?.trim() || npc.name; npc.image = html.find('[name="image"]').val()?.trim() || npc.image; npc.background = html.find('[name="background"]').val()?.trim() || ""; npc.appearance = html.find('[name="appearance"]').val()?.trim() || ""; npc.personality = html.find('[name="personality"]').val()?.trim() || ""; await Store.save(encounter); } }, cancel: { label: "Cancel" } }, default: "save"
  }).render(true);
}

async function handleNpcDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove("dragover");
  const actor = await actorFromDropEvent(event);
  if (!actor) return ui.notifications.warn("Drop an Actor or Token to add an influence target.");
  const encounter = Store.get();
  if (!encounter || encounter.npcs.some((npc) => npc.actorId === actor.id)) return;
  const npc = { id: randomID(), actorId: actor.id, name: actor.name, image: participantPortrait(actor) };
  encounter.npcs.push(npc);
  encounter.activeNpcId = npc.id;
  await Store.save(encounter);
  editNpc(encounter, npc);
}

class EncounterManager extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "influence-encounter-manager", title: "Influence Encounter Manager", template: `modules/${MODULE_ID}/templates/manager.hbs`,
      width: 760, height: 680, resizable: true, classes: [MODULE_ID]
    });
  }
  getData() { return { encounters: Object.values(Store.all()).map(normalizeEncounterCollections), activeId: Store.activeId() }; }
  activateListeners(html) {
    super.activateListeners(html);
    html.find("[data-action]").on("click", (event) => this._action(event));
  }
  async _action(event) {
    const { action, id } = event.currentTarget.dataset;
    if (action === "new") return openCreateEncounterDialog(event);
    if (action === "sample") return new EncounterEditor(deepClone(LANEKAR)).render({ force: true });
    if (action === "peace-sample") return new EncounterEditor(deepClone(PEACE_TALKS)).render({ force: true });
    if (action === "edit") return new EncounterEditor(Store.get(id)).render({ force: true });
    if (action === "activate") {
      await activateEncounter(id);
      this.render(false);
    }
    if (action === "pause") { await pauseEncounter(id); this.render(false); }
    if (action === "resume") { await resumeEncounter(id); this.render(false); }
    if (action === "delete") { await deleteEncounter(id); this.render(false); }
    if (action === "export") exportEncounterData(id);
    if (action === "import") importEncounterData();
  }
}

class EncounterEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(encounter, options = {}) {
    super(options);
    this.encounter = normalizeEncounterCollections(encounter);
    this._dirty = false;
    this._forceClose = false;
  }
  get title() { return `Encounter: ${this.encounter?.name || "New Influence Encounter"}`; }
  static DEFAULT_OPTIONS = {
    id: "influence-encounter-editor",
    tag: "form",
    classes: [MODULE_ID],
    position: { width: 860, height: 780 },
    window: { icon: "fa-solid fa-comments", resizable: true, contentClasses: ["standard-form", "influence-editor"] },
    form: { closeOnSubmit: false, handler: EncounterEditor.#onSubmit },
    actions: { add: EncounterEditor.#onAdd, remove: EncounterEditor.#onRemove, parse: EncounterEditor.#onParse }
  };
  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/editor.hbs`, root: true, scrollable: [".content"] }
  };
  static TABS = {
    primary: {
      tabs: [
        { id: "basics", label: "Basics", icon: "fa-solid fa-image" },
        { id: "skills", label: "Skills", icon: "fa-solid fa-list-check" },
        { id: "traits", label: "Weakness & Strength", icon: "fa-solid fa-scale-balanced" },
        { id: "results", label: "Results & Boons", icon: "fa-solid fa-trophy" }
      ],
      initial: "basics"
    }
  };
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const selected = new Set(Array.isArray(this.encounter.participantIds)
      ? this.encounter.participantIds
      : defaultPartyCharacters().map((actor) => actor.id));
    const characterActors = allCharacters().map((actor) => ({ id: actor.id, name: actor.name, image: participantPortrait(actor), selected: selected.has(actor.id) }));
    return {
      ...context,
      encounter: this.encounter,
      characterActors,
      skillChoices: PF2E_SKILLS,
      tabs: this._prepareTabs("primary"),
      modifierTypes: { circumstance: "Circumstance", status: "Status", item: "Item", untyped: "Untyped" },
      traitModes: { roll: "Roll modifier", dc: "DC adjustment", narrative: "Narrative only" },
      boonModes: { roll: "Roll bonus", dc: "DC adjustment", narrative: "Narrative" },
      boonScopes: { both: "Both", discovery: "Discovery", influence: "Influence", external: "Outside this encounter" },
      rewardKinds: { modifier: "Mechanical modifier", ip: "IP adjustment", narrative: "Narrative reward" },
      rewardActivations: { automatic: "Automatic", manual: "GM applies" },
      npcTargets: Object.fromEntries(this.encounter.npcs.map((npc) => [npc.id, npc.name]))
    };
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.addEventListener("input", () => { this._dirty = true; });
    this.element.addEventListener("change", () => { this._dirty = true; });
    this.element.querySelector('[name="name"]')?.addEventListener("input", (event) => {
      const name = event.currentTarget.value.trim() || "New Influence Encounter";
      this.element.querySelector(".window-title").textContent = `Encounter: ${name}`;
    });
    for (const zone of this.element.querySelectorAll("[data-actor-drop]")) {
      zone.addEventListener("dragenter", (event) => { event.preventDefault(); zone.classList.add("dragover"); });
      zone.addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; zone.classList.add("dragover"); });
      zone.addEventListener("dragleave", (event) => { if (!zone.contains(event.relatedTarget)) zone.classList.remove("dragover"); });
      zone.addEventListener("drop", (event) => this._onActorDrop(event, zone.dataset.actorDrop));
    }
    this.element.querySelectorAll("input[data-skill-label]").forEach((input) => input.addEventListener("input", () => {
      const slugInput = input.closest(".skill-row")?.querySelector("input[data-skill-slug]");
      if (slugInput) slugInput.value = skillSlug(input.value);
    }));
  }
  async _onActorDrop(event, destination) {
    event.preventDefault();
    event.currentTarget.classList.remove("dragover");
    const actor = await actorFromDropEvent(event);
    if (!actor) return ui.notifications.warn("Drop an Actor from the sidebar or a Token from the canvas.");
    this._capture();
    if (destination === "participant") {
      if (actor.type !== "character") return ui.notifications.warn(`${actor.name} is not a player character and cannot be added as a participant.`);
      this.encounter.participantIds ??= [];
      if (this.encounter.participantIds.includes(actor.id)) return ui.notifications.info(`${actor.name} is already participating.`);
      this._dirty = true;
      this.encounter.participantIds.push(actor.id);
      ui.notifications.info(`Added ${actor.name} as a participant.`);
    } else if (destination === "npc") {
      if (this.encounter.npcs.some((npc) => npc.actorId === actor.id)) return ui.notifications.info(`${actor.name} is already an influence target.`);
      this._dirty = true;
      const created = { id: randomID(), actorId: actor.id, name: actor.name, image: participantPortrait(actor), points: 0,
        background: "", appearance: "", personality: "", discovery: deepClone(DEFAULT_ENCOUNTER.discovery.slice(0, 2)), influence: [], thresholds: [],
        weakness: { label: "Weakness", description: "", value: 0, type: "circumstance", mode: "roll" },
        strength: { label: "Resistance", description: "", value: 0, type: "circumstance", mode: "roll" } };
      const placeholder = this.encounter.npcs.length === 1 && isGeneratedPlaceholderNpc(this.encounter, this.encounter.npcs[0]);
      if (placeholder) this.encounter.npcs[0] = created;
      else this.encounter.npcs.push(created);
      this.encounter.activeNpcId = created.id;
      this.encounter.encounterType = this.encounter.npcs.length > 1 ? "multiple" : "single";
      ui.notifications.info(`Added ${actor.name} as an influence target.`);
    } else return;
    await this.render({ force: true });
  }
  _capture(formData = new foundry.applications.ux.FormDataExtended(this.element).object) {
    const expanded = foundry.utils.expandObject(formData);
    foundry.utils.mergeObject(this.encounter, expanded, { inplace: true, overwrite: true });
    normalizeEncounterCollections(this.encounter);
    this.encounter.publicPoints = this.element.querySelector('[name="publicPoints"]')?.checked ?? false;
    this.encounter.participantIds = [...this.element.querySelectorAll('[name="partyParticipant"]:checked')].map((input) => input.value);
    this.encounter.npcs.forEach((npc, npcIndex) => {
      npc.discovery.forEach((skill, skillIndex) => skill.secret = this.element.querySelector(`[name="npcs.${npcIndex}.discovery.${skillIndex}.secret"]`)?.checked ?? false);
      npc.influence.forEach((skill, skillIndex) => skill.lore = this.element.querySelector(`[name="npcs.${npcIndex}.influence.${skillIndex}.lore"]`)?.checked ?? false);
      npc.thresholds.forEach((threshold, thresholdIndex) => threshold.boons.forEach((boon, boonIndex) => {
        boon.playerVisible = this.element.querySelector(`[name="npcs.${npcIndex}.thresholds.${thresholdIndex}.boons.${boonIndex}.playerVisible"]`)?.checked ?? false;
      }));
    });
  }
  static async #onAdd(_event, target) {
    this._dirty = true;
    this._capture();
    this._add(target.dataset.type);
    await this.render({ force: true });
  }
  static async #onRemove(_event, target) {
    this._capture();
    if (this._remove(target.dataset.type, Number(target.dataset.index)) === false) return;
    this._dirty = true;
    await this.render({ force: true });
  }
  static async #onParse(_event, target) {
    this._capture();
    const npcIndex = Number(target.dataset.npcIndex);
    const npc = this.encounter.npcs[npcIndex];
    const source = this.element.querySelector(`[data-parser-source="${npcIndex}"]`)?.value?.trim();
    if (!npc || !source) return ui.notifications.warn("Paste the NPC's influence text before parsing.");
    const found = parseInfluenceSource(source, npc);
    if (!found.length) return ui.notifications.warn("No recognizable narrative, Discovery, Influence, threshold, Resistance, or Weakness sections were found.");
    this._dirty = true;
    ui.notifications.info(`Parsed ${npc.name}: ${found.join(", ")}. Review the generated fields before saving.`);
    await this.render({ force: true });
  }
  _add(type) {
    const [kind, npcIndex, thresholdIndex] = type.split(":");
    const npc = this.encounter.npcs[Number(npcIndex)];
    if (kind === "npc") {
      const created = { id: randomID(), name: "New Influence Target", image: "icons/svg/mystery-man.svg", actorId: "", points: 0,
        background: "", appearance: "", personality: "", discovery: deepClone(DEFAULT_ENCOUNTER.discovery.slice(0, 2)), influence: [], thresholds: [],
        weakness: { label: "Weakness", description: "", value: 0, type: "circumstance", mode: "dc" },
        strength: { label: "Resistance", description: "", value: 0, type: "circumstance", mode: "dc" } };
      this.encounter.npcs.push(created);
      this.encounter.activeNpcId = created.id;
    }
    if (kind === "discovery" && npc) npc.discovery.push({ id: randomID(), slug: "", label: "", dc: 20, lore: false, secret: false });
    if (kind === "influence" && npc) npc.influence.push({ id: randomID(), slug: "", label: "", dc: 20, lore: false });
    if (kind === "threshold" && npc) npc.thresholds.push({ id: randomID(), points: 0, label: "", text: "", boons: [] });
    if (kind === "boon" && npc) npc.thresholds[Number(thresholdIndex)]?.boons.push({ id: randomID(), kind: "narrative", label: "New Reward", description: "", value: 0, type: "circumstance", mode: "narrative", scope: "both", skills: [], uses: 0, remaining: 0, activation: "automatic", active: true, applied: false, targetNpcId: npc.id, playerVisible: true });
  }
  _remove(type, index) {
    const [kind, npcIndex, thresholdIndex] = type.split(":");
    const npc = this.encounter.npcs[Number(npcIndex)];
    if (kind === "npc") {
      if (this.encounter.npcs.length <= 1) {
        ui.notifications.warn("An influence encounter must have at least one target.");
        return false;
      }
      this.encounter.npcs.splice(index, 1);
      normalizeEncounterCollections(this.encounter);
    }
    if (kind === "discovery" && npc) npc.discovery.splice(index, 1);
    if (kind === "influence" && npc) npc.influence.splice(index, 1);
    if (kind === "threshold" && npc) npc.thresholds.splice(index, 1);
    if (kind === "boon" && npc) npc.thresholds[Number(thresholdIndex)]?.boons.splice(index, 1);
    return true;
  }
  static async #onSubmit(_event, _form, formData) {
    await this._save(formData.object);
  }
  async _save(formData) {
    try {
      foundry.utils.mergeObject(this.encounter, foundry.utils.expandObject(formData), { inplace: true, overwrite: true });
      normalizeEncounterCollections(this.encounter);
      this.encounter.publicPoints = this.element.querySelector('[name="publicPoints"]')?.checked ?? false;
      this.encounter.participantIds = [...this.element.querySelectorAll('[name="partyParticipant"]:checked')].map((input) => input.value);
      this.encounter.id ||= randomID();
      this.encounter.phases = Number(this.encounter.phases) || 4;
      this.encounter.npcs.forEach((npc, npcIndex) => {
        npc.points = Math.max(0, Number(npc.points) || 0);
        npc.discovery.forEach((skill, skillIndex) => { skill.dc = Number(skill.dc); skill.secret = this.element.querySelector(`[name="npcs.${npcIndex}.discovery.${skillIndex}.secret"]`)?.checked ?? false; });
        npc.influence.forEach((skill, skillIndex) => { skill.dc = Number(skill.dc); skill.lore = this.element.querySelector(`[name="npcs.${npcIndex}.influence.${skillIndex}.lore"]`)?.checked ?? false; });
        npc.weakness.value = Number(npc.weakness.value) || 0;
        npc.strength.value = Number(npc.strength.value) || 0;
        npc.thresholds.forEach((threshold, thresholdIndex) => {
          threshold.points = Number(threshold.points) || 0;
          threshold.boons.forEach((boon, boonIndex) => {
            boon.value = Number(boon.value) || 0;
            boon.uses = Math.max(0, Number(boon.uses) || 0);
            boon.remaining = Math.min(boon.uses, Number(boon.remaining ?? boon.uses));
            boon.skills = typeof boon.skills === "string" ? boon.skills.split(",").map((skill) => skill.trim()).filter(Boolean) : boon.skills;
            boon.playerVisible = this.element.querySelector(`[name="npcs.${npcIndex}.thresholds.${thresholdIndex}.boons.${boonIndex}.playerVisible"]`)?.checked ?? false;
          });
        });
      });
      this.encounter.backgroundBlur = Math.max(0, Math.min(20, Number(this.encounter.backgroundBlur) || 0));
      await Store.save(this.encounter);
      this._dirty = false;
      ui.notifications.info(`${this.encounter.name} saved.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to save encounter`, error);
      ui.notifications.error(`Could not save ${this.encounter.name}. See the console for details.`);
      throw error;
    }
  }
  async close(options = {}) {
    if (this._forceClose || !this._dirty) return super.close(options);
    const choice = await new Promise((resolve) => {
      let resolved = false;
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
      };
      new Dialog({
        title: "Unsaved Encounter Changes",
        content: `<p>You have unsaved changes to <strong>${esc(this.encounter.name)}</strong>. Closing without saving will discard them.</p>`,
        buttons: {
          save: { icon: '<i class="fa-solid fa-floppy-disk"></i>', label: "Save and Close", callback: () => finish("save") },
          cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel", callback: () => finish("cancel") },
          discard: { icon: '<i class="fa-solid fa-trash"></i>', label: "Close Without Saving", callback: () => finish("discard") }
        },
        default: "cancel",
        close: () => finish("cancel")
      }).render(true);
    });
    if (choice === "cancel") return this;
    if (choice === "save") {
      const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
      await this._save(formData);
    }
    this._forceClose = true;
    return super.close(options);
  }
}

async function requestCheck(encounter, type, selectedActorId = null, selectedNpcId = null) {
  const npc = encounter.npcs.find((entry) => entry.id === selectedNpcId) ?? encounter.npcs.find((entry) => entry.id === encounter.activeNpcId) ?? encounter.npcs[0];
  if (!npc) return ui.notifications.warn("Choose an influence target first.");
  const actor = (selectedActorId ? game.actors.get(selectedActorId) : null)
    ?? canvas.tokens.controlled[0]?.actor
    ?? game.user.character;
  if (!actor) return ui.notifications.warn("Select a participant, select a character token, or assign a user character first.");
  if (!encounterParticipants(encounter).some((participant) => participant.id === actor.id)) return ui.notifications.warn(`${actor.name} is not participating in this encounter.`);
  if (!game.user.isGM && !canUserControlActor(actor)) return ui.notifications.warn(`You must be an Owner of ${actor.name} to act for that character.`);
  if (encounter.actorsActed?.[actor.id]) return ui.notifications.warn(`${actor.name} has already acted this phase.`);
  let options = "";
  if (type === "discovery") {
    const perception = npc.discovery.find((skill) => skill.slug === "perception");
    const diplomacy = npc.discovery.find((skill) => skill.slug === "diplomacy");
    const primary = [perception, diplomacy].filter(Boolean)
      .map((skill) => `<option value="configured:${skill.id}">${esc(skill.label)}</option>`).join("");
    const otherSkills = actorSkillChoices(actor).filter((skill) => !["perception", "diplomacy"].includes(skill.slug));
    const remaining = otherSkills.map((skill) => `<option value="actor:${esc(skill.slug)}">${esc(skill.label)}</option>`).join("");
    options = `${primary}<option disabled>──────────</option>${remaining}`;
  } else {
    const skills = availableSkillsForActor(actor, npc.influence);
    if (!skills.length) return ui.notifications.warn(`${actor.name} has none of the configured Influence skills.`);
    options = skills.map((skill) => `<option value="configured:${skill.id}">${esc(skill.label)}</option>`).join("");
  }
  new Dialog({
    title: `${type.titleCase()} Check: ${npc.name}`,
    content: `<form><p>Target: <strong>${esc(npc.name)}</strong></p><div class="form-group"><label>Skill</label><select name="skill">${options}</select></div></form>`,
    buttons: { request: { icon: '<i class="fas fa-paper-plane"></i>', label: "Request Check", callback: (html) => {
      const selection = String(html.find('[name="skill"]').val());
      const [source, value] = selection.split(":");
      const actorChoice = source === "actor" ? actorSkillChoices(actor).find((skill) => skill.slug === value) : null;
      const payload = { action: "check-request", encounterId: encounter.id, npcId: npc.id, requesterId: game.user.id, actorId: actor.id, type,
        skillId: source === "configured" ? value : null, skillSlug: actorChoice?.slug ?? null, skillLabel: actorChoice?.label ?? null };
      if (game.user.isGM) adjudicate(payload); else game.socket.emit(SOCKET, payload);
    } } }
  }).render(true);
}

function applicableBoons(encounter, request, skill) {
  const unlocked = encounter.npcs.flatMap((npc) => npc.thresholds.flatMap((threshold) => threshold.points <= npc.points ? threshold.boons : []));
  return [...unlocked, ...(encounter.activeEffects ?? [])].filter((b) => {
    if ((b.kind ?? "modifier") !== "modifier") return false;
    if (b.targetNpcId && b.targetNpcId !== request.npcId) return false;
    if ((b.remaining ?? b.uses) <= 0) return false;
    if (b.external || b.scope === "external") return false;
    if (b.mode === "narrative") return false;
    if (!["both", request.type, "external"].includes(b.scope)) return false;
    return !b.skills?.length || b.skills.includes(skill.slug);
  });
}

async function adjudicate(request) {
  if (!game.user.isGM) return;
  const encounter = Store.get(request.encounterId);
  const actor = game.actors.get(request.actorId);
  if (!encounter || !actor) return ui.notifications.error("The requested influence check is no longer available.");
  const npc = encounter.npcs.find((entry) => entry.id === request.npcId) ?? encounter.npcs[0];
  if (!npc) return ui.notifications.error("The requested influence target is no longer available.");
  request.npcId = npc.id;
  const list = request.type === "discovery" ? npc.discovery : npc.influence;
  let skill = request.skillId ? list.find((s) => s.id === request.skillId) : list.find((s) => s.slug === request.skillSlug);
  if (!skill && request.type === "discovery") {
    const secret = list.find((entry) => entry.secret);
    skill = { id: `attempt:${request.skillSlug}`, slug: request.skillSlug, label: request.skillLabel ?? request.skillSlug,
      dc: Number(secret?.dc ?? list[0]?.dc ?? 20), invalidDiscovery: true };
  }
  if (!skill) return ui.notifications.error("The requested influence skill is no longer available.");
  const mods = [
    { id: "weakness", label: npc.weakness.label, value: npc.weakness.value, type: npc.weakness.type, mode: npc.weakness.mode ?? "roll", description: npc.weakness.description },
    { id: "strength", label: npc.strength.label, value: npc.strength.value, type: npc.strength.type, mode: npc.strength.mode ?? "roll", description: npc.strength.description },
    ...applicableBoons(encounter, request, skill).map((b) => ({ ...b, id: `boon:${b.id}`, description: b.mode === "dc" ? "DC adjustment" : "Unlocked boon" }))
  ].filter((modifier) => modifier.id.startsWith("boon:") || modifier.description || Number(modifier.value));
  const customMods = [];
  const rows = mods.map((m) => `<label class="influence-mod"><input type="checkbox" name="mod" value="${m.id}" ${m.id.startsWith("boon:") && m.activation === "automatic" ? "checked" : ""}> <strong>${esc(m.label)}</strong> ${signed(Number(m.value))} <small>${esc(m.description ?? "")}</small></label>`).join("");
  const invalidNotice = skill.invalidDiscovery ? `<p class="hint"><strong>GM:</strong> This is not a valid Discovery skill for this encounter. The blind roll consumes the character's action but cannot grant a Discovery.</p>` : "";
  const content = `<form class="influence-adjudicate"><p><strong>${esc(actor.name)}</strong> influences <strong>${esc(npc.name)}</strong>: ${esc(skill.label)} vs. DC ${skill.dc}</p>${invalidNotice}${rows}<hr><h4>Custom modifiers</h4><div class="form-group"><input name="customLabel" placeholder="Narrative circumstance"><input type="number" name="customValue" value="0"></div><div class="form-group"><label>Type</label><select name="customType"><option>circumstance</option><option>status</option><option>item</option><option>untyped</option></select><label><input type="checkbox" name="saveCustom"> Keep for this target</label><button type="button" data-action="add-custom"><i class="fas fa-plus"></i> Add Modifier</button></div><div class="custom-modifiers"></div><div class="form-group"><label>DC adjustment</label><input type="number" name="dcAdjust" value="0"><p class="hint">Positive raises the DC; negative lowers it.</p></div></form>`;
  new Dialog({
    title: "Adjudicate Influence Check", content,
    render: (html) => {
      const renderCustomMods = () => html.find(".custom-modifiers").html(customMods.map((mod) => `<div class="custom-modifier"><span><strong>${esc(mod.label)}</strong> ${signed(mod.value)} (${esc(mod.type)})${mod.persist ? " — kept" : ""}</span><button type="button" data-remove-custom="${mod.id}" title="Remove modifier"><i class="fas fa-times"></i></button></div>`).join(""));
      html.find('[data-action="add-custom"]').on("click", () => {
        const value = Number(html.find('[name="customValue"]').val());
        if (!Number.isFinite(value) || value === 0) return ui.notifications.warn("Enter a non-zero modifier before adding it.");
        customMods.push({ id: randomID(), label: html.find('[name="customLabel"]').val()?.trim() || "Situational Modifier",
          value, type: html.find('[name="customType"]').val(), persist: html.find('[name="saveCustom"]').is(":checked") });
        html.find('[name="customLabel"]').val("");
        html.find('[name="customValue"]').val(0);
        html.find('[name="saveCustom"]').prop("checked", false);
        renderCustomMods();
      });
      html.find(".custom-modifiers").on("click", "[data-remove-custom]", (event) => {
        const index = customMods.findIndex((mod) => mod.id === event.currentTarget.dataset.removeCustom);
        if (index >= 0) customMods.splice(index, 1);
        renderCustomMods();
      });
    },
    buttons: {
      roll: { icon: '<i class="fas fa-dice-d20"></i>', label: "Confirm and Roll", callback: async (html) => {
        const selectedIds = html.find('[name="mod"]:checked').map((_, e) => e.value).get();
        const selected = mods.map((m) => ({ ...m, selected: selectedIds.includes(m.id) }));
        selected.push(...customMods.map((mod) => ({ ...mod, selected: true })));
        const boonDcAdjust = selected.filter((m) => m.selected && m.mode === "dc").reduce((sum, m) => sum + Number(m.value), 0);
        const dcAdjust = (Number(html.find('[name="dcAdjust"]').val()) || 0) + boonDcAdjust;
        encounter.activeEffects.push(...customMods.filter((mod) => mod.persist).map((mod) => ({ id: randomID(), kind: "modifier", targetNpcId: npc.id, label: mod.label, value: mod.value, type: mod.type, mode: "roll", scope: "both", skills: [], uses: 999, remaining: 999 })));
        await executeCheck(encounter, request, actor, skill, selected.filter((m) => m.selected), dcAdjust);
      } },
      cancel: { label: "Cancel Request" }
    }, default: "roll"
  }, { width: 520 }).render(true);
}

async function executeCheck(encounter, request, actor, skill, selected, dcAdjust) {
  const npc = encounter.npcs.find((entry) => entry.id === request.npcId) ?? encounter.npcs[0];
  if (!npc) return ui.notifications.error("The influence target is no longer available.");
  const statistic = skillStatistic(actor, skill.slug, skill.label);
  if (!statistic?.roll) return ui.notifications.error(`${actor.name} has no rollable ${skill.label} statistic.`);
  const effectiveDC = Number(skill.dc) + dcAdjust;
  const rollModifiers = selected.filter((mod) => mod.mode !== "dc").map((mod) => new game.pf2e.Modifier({
    slug: `influence-${String(mod.id).slugify()}`,
    label: mod.label,
    modifier: Number(mod.value),
    type: mod.type || "untyped"
  }));
  const breakdown = selected.map((m) => `${esc(m.label)} ${signed(Number(m.value))}`).join(", ");
  const roll = await statistic.roll({
    dc: { value: effectiveDC, visible: true, label: `${encounter.name} — ${npc.name}: ${skill.label}` },
    modifiers: rollModifiers,
    extraRollOptions: [`influence:type:${request.type}`, `influence:encounter:${encounter.id}`],
    label: `${request.type.titleCase()}: ${npc.name}`,
    messageMode: request.type === "discovery" ? "blind" : "public",
    createMessage: true
  });
  if (!roll) return;
  const degree = Number(roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess);
  const outcome = ["Critical Failure", "Failure", "Success", "Critical Success"][degree] ?? "Unknown";
  const points = request.type === "influence" ? ([ -1, 0, 1, 2 ][degree] ?? 0) : 0;
  const previousPoints = Number(npc.points);
  snapshot(encounter, `${actor.name} → ${npc.name}: ${skill.label}`);
  encounter.checkLog ??= [];
  const logEntry = { id: randomID(), actorId: actor.id, actorName: actor.name, npcId: npc.id, npcName: npc.name, type: request.type,
    skillLabel: skill.label, outcome: skill.invalidDiscovery ? `${outcome} — Invalid Discovery Skill` : outcome,
    phase: encounter.currentPhase, timestamp: Date.now(), detailLabel: "", details: [] };
  encounter.checkLog.push(logEntry);
  if (request.type === "influence") npc.points = Math.max(0, npc.points + points);
  if (request.type === "influence") {
    logEntry.detailLabel = "Boons Gained";
    logEntry.details = npc.thresholds
      .filter((threshold) => threshold.points > previousPoints && threshold.points <= npc.points)
      .flatMap((threshold) => [threshold.label, ...threshold.boons.map((boon) => boon.label)]);
  }
  encounter.actorsActed[actor.id] = true;
  for (const mod of selected.filter((m) => m.id.startsWith("boon:"))) {
    const boonId = mod.id.slice(5);
    const boon = findBoon(encounter, boonId);
    if (boon) boon.remaining = Math.max(0, (boon.remaining ?? boon.uses) - 1);
  }
  await Store.save(encounter);
  const resultText = request.type === "discovery"
    ? "Discovery checks do not award Influence Points."
    : `${signed(points)} Influence Point${Math.abs(points) === 1 ? "" : "s"}`;
  await ChatMessage.create({ content: `<div class="influence-chat"><strong>${esc(encounter.name)} — ${esc(npc.name)}</strong><p>${esc(actor.name)} used ${esc(skill.label)}.${breakdown ? ` Modifiers: ${breakdown}.` : ""}</p><p><strong>${resultText}</strong></p></div>`, whisper: request.type === "discovery" ? ChatMessage.getWhisperRecipients("GM").map((u) => u.id) : [] });
  if (request.type === "discovery" && !skill.invalidDiscovery && degree >= 2) await offerDiscovery(encounter, request.requesterId, degree === 3 ? 2 : 1, logEntry.id, actor.id);
  tracker.render(false);
}

async function offerDiscovery(encounter, userId, choices, logEntryId, actorId) {
  if (userId === game.user.id) {
    const selections = await collectDiscoveryChoices(choices, actorId);
    return resolveDiscovery(encounter.id, userId, selections, logEntryId);
  }
  game.socket.emit(SOCKET, { action: "discovery-offer", encounterId: encounter.id, userId, choices, logEntryId, actorId });
}

async function collectDiscoveryChoices(choices, actorId) {
  const selections = [];
  const actor = game.actors.get(actorId);
  for (let i = 0; i < choices; i++) {
    const options = [
      ["secret", "Secret Discovery skill"], ["low", "Lowest non-Lore Influence DC"],
      ["high", "Highest non-Lore Influence DC"], ["skill", "Whether a specific skill is usable"],
      ["weakness", "NPC weakness"], ["strength", "NPC strength"]
    ];
    const choice = await promptSelect(`Discovery ${i + 1} of ${choices}`, options);
    if (!choice) break;
    const skillOptions = trainedSkillChoices(actor).map((skill) => [skill.slug, skill.label]);
    const named = choice === "skill" ? await promptSelect("Which trained skill do you ask about?", skillOptions, "Choose Skill") : "";
    if (choice !== "skill" || named) selections.push({ choice, named });
  }
  return selections;
}

async function resolveDiscovery(encounterId, userId, selections, logEntryId) {
  if (!game.user.isGM) return;
  const encounter = Store.get(encounterId);
  if (!encounter) return;
  const logEntry = encounter.checkLog?.find((entry) => entry.id === logEntryId);
  const npc = encounter.npcs.find((entry) => entry.id === logEntry?.npcId) ?? encounter.npcs[0];
  if (!npc) return;
  const secret = npc.discovery.find((s) => s.secret);
  const nonLore = npc.influence.filter((s) => !s.lore);
  const low = nonLore.toSorted((a, b) => a.dc - b.dc)[0];
  const high = nonLore.toSorted((a, b) => b.dc - a.dc)[0];
  encounter.discoveries[userId] ??= { npcs: {} };
  encounter.discoveries[userId].npcs ??= {};
  encounter.discoveries[userId].npcs[npc.id] ??= { facts: [], secretSkill: false };
  const discoveryRecord = encounter.discoveries[userId].npcs[npc.id];
  const learned = [];
  for (const selection of selections) {
    const { choice, named } = selection;
    let fact = "";
    if (choice === "secret") { fact = secret ? `Secret Discovery Skill — ${secret.label}` : "No secret Discovery skill is configured."; discoveryRecord.secretSkill = !!secret; }
    if (choice === "low") fact = low ? `Lowest non-Lore DC — ${low.label}` : "No non-Lore Influence skill is configured.";
    if (choice === "high") fact = high ? `Highest non-Lore DC — ${high.label}` : "No non-Lore Influence skill is configured.";
    if (choice === "weakness") fact = `${npc.weakness.label}: ${npc.weakness.description}`;
    if (choice === "strength") fact = `${npc.strength.label}: ${npc.strength.description}`;
    if (choice === "skill") {
      const askedSkill = game.actors.get(encounter.checkLog?.find((entry) => entry.id === logEntryId)?.actorId)?.skills?.[named];
      const askedLabel = askedSkill ? game.i18n.localize(askedSkill.label) : named;
      const found = npc.influence.find((s) => s.slug === named);
      fact = found ? `${found.label} can influence ${npc.name}.` : `${askedLabel} is not among ${npc.name}'s listed Influence skills.`;
    }
    discoveryRecord.facts.push(fact);
    learned.push(fact);
    await ChatMessage.create({ content: `<div class="influence-chat"><strong>Discovery: ${esc(npc.name)}</strong><p>${esc(fact)}</p></div>`, whisper: [userId, ...ChatMessage.getWhisperRecipients("GM").map((u) => u.id)] });
  }
  if (logEntry && learned.length) Object.assign(logEntry, { detailLabel: "Learned", details: learned });
  await Store.save(encounter);
  game.socket.emit(SOCKET, { action: "refresh", userId });
}

function promptNumber(title, value) { return new Promise((resolve) => new Dialog({ title, content: `<input type="number" name="value" value="${value}">`, buttons: { ok: { label: "Apply", callback: (h) => resolve(Number(h.find('[name="value"]').val())) }, cancel: { label: "Cancel", callback: () => resolve(null) } }, close: () => resolve(null) }).render(true)); }
function promptSelect(title, options, confirmLabel = "Reveal") { return new Promise((resolve) => new Dialog({ title, content: `<select name="value">${options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>`, buttons: { ok: { label: confirmLabel, callback: (h) => resolve(h.find('[name="value"]').val()) }, cancel: { label: "Cancel", callback: () => resolve(null) } }, close: () => resolve(null) }).render(true)); }

let tracker;
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTINGS.encounters, { scope: "world", config: false, type: Object, default: {} });
  game.settings.register(MODULE_ID, SETTINGS.active, { scope: "world", config: false, type: String, default: "" });
  game.settings.register(MODULE_ID, SETTINGS.folders, { scope: "world", config: false, type: Array, default: [] });
  game.settings.register(MODULE_ID, SETTINGS.selections, { scope: "client", config: false, type: Object, default: {} });
  loadTemplates([`modules/${MODULE_ID}/templates/trait-fields.hbs`]);
});

Hooks.once("ready", async () => {
  const orphanedActiveId = Store.activeId();
  if (game.user.isGM && orphanedActiveId && !Store.get(orphanedActiveId)) await Store.setActive("");
  tracker = new InfluenceTracker();
  game.socket.on(SOCKET, (payload) => {
    if (payload.action === "check-request" && game.user.isGM && game.users.activeGM?.id === game.user.id) adjudicate(payload);
    if (payload.action === "discovery-offer" && payload.userId === game.user.id) collectDiscoveryChoices(payload.choices, payload.actorId).then((selections) => game.socket.emit(SOCKET, { action: "discovery-selection", encounterId: payload.encounterId, userId: game.user.id, selections, logEntryId: payload.logEntryId }));
    if (payload.action === "discovery-selection" && game.user.isGM && game.users.activeGM?.id === game.user.id) resolveDiscovery(payload.encounterId, payload.userId, payload.selections, payload.logEntryId);
    if (payload.action === "refresh" && (!payload.userId || payload.userId === game.user.id)) {
      tracker?.render(false);
      renderCinematicHud();
      renderInfluenceSidebar();
    }
  });
  game[MODULE_ID] = { open: () => tracker.render(true), manage: () => new EncounterManager().render(true), Store };
  setTimeout(() => { renderInfluenceSidebar(); renderCinematicHud(); }, 250);
});

Hooks.on("renderSidebar", () => renderInfluenceSidebar());
Hooks.on("canvasReady", () => { renderInfluenceSidebar(); renderCinematicHud(); });

Hooks.on("renderSceneControls", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  const tools = root?.querySelector("#scene-controls-tools");
  if (!tools || tools.querySelector(".influence-control")) return;
  const item = document.createElement("li");
  item.innerHTML = '<button type="button" class="control ui-control tool icon fa-solid fa-comments influence-control" aria-label="Influence Encounter" data-tooltip="Influence Encounter"></button>';
  item.querySelector("button").addEventListener("click", () => tracker?.render(true));
  tools.append(item);
});

Hooks.on("renderJournalDirectory", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".influence-journal-button")) return;
  const button = document.createElement("button");
  button.type = "button"; button.className = "influence-journal-button";
  button.innerHTML = '<i class="fa-solid fa-comments"></i><span>Influence Encounter</span>';
  button.addEventListener("click", () => tracker.render(true));
  const actions = root.querySelector(".directory-header .header-actions");
  const footer = root.querySelector(".directory-footer");
  (actions ?? footer ?? root).append(button);
});

Hooks.on("influenceEncounterUpdated", (id) => {
  // The directory must refresh for draft encounters too, not only the active one.
  renderInfluenceSidebar();
  if (id === Store.activeId()) {
    tracker?.render(false);
    renderCinematicHud();
    if (game.user.isGM) game.socket.emit(SOCKET, { action: "refresh" });
  }
});
