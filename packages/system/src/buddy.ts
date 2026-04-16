import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type BuddyTemplate = {
  name: string;
  species: string;
  personality: string;
};

export type StarterBuddyCompanion = BuddyTemplate & {
  muted: boolean;
};

type BuddyStateSnapshot = {
  nextIndex: number;
  companion: BuddyTemplate | null;
  muted: boolean;
};

const BUDDY_TEMPLATES: BuddyTemplate[] = [
  { name: "Waddles", species: "duck", personality: "Quirky and easily amused. Leaves rubber duck debugging tips everywhere." },
  { name: "Goosberry", species: "goose", personality: "Assertive and honks at bad code. Takes no prisoners in code reviews." },
  { name: "Gooey", species: "blob", personality: "Adaptable and goes with the flow. Sometimes splits into two when confused." },
  { name: "Whiskers", species: "cat", personality: "Independent and judgmental. Watches you type with mild disdain." },
  { name: "Ember", species: "dragon", personality: "Fiery and passionate about architecture. Hoards good variable names." },
  { name: "Inky", species: "octopus", personality: "Multitasker extraordinaire. Wraps tentacles around every problem at once." },
  { name: "Hoots", species: "owl", personality: "Wise but verbose. Always says \"let me think about that\" for exactly 3 seconds." },
  { name: "Waddleford", species: "penguin", personality: "Cool under pressure. Slides gracefully through merge conflicts." },
  { name: "Shelly", species: "turtle", personality: "Patient and thorough. Believes slow and steady wins the deploy." },
  { name: "Trailblazer", species: "snail", personality: "Methodical and leaves a trail of useful comments. Never rushes." },
  { name: "Casper", species: "ghost", personality: "Ethereal and appears at the worst possible moments with spooky insights." },
  { name: "Axie", species: "axolotl", personality: "Regenerative and cheerful. Recovers from any bug with a smile." },
  { name: "Chill", species: "capybara", personality: "Zen master. Remains calm while everything around is on fire." },
  { name: "Spike", species: "cactus", personality: "Prickly on the outside but full of good intentions. Thrives on neglect." },
  { name: "Byte", species: "robot", personality: "Efficient and literal. Processes feedback in binary." },
  { name: "Flops", species: "rabbit", personality: "Energetic and hops between tasks. Finishes before you start." },
  { name: "Spore", species: "mushroom", personality: "Quietly insightful. Grows on you over time." },
  { name: "Chonk", species: "chonk", personality: "Big, warm, and takes up the whole couch. Prioritizes comfort over elegance." },
];

function titleCaseSpecies(species: string): string {
  return species.charAt(0).toUpperCase() + species.slice(1);
}

function resolveBuddyStatePath(explicitPath?: string): string {
  if (explicitPath && explicitPath.trim() !== "") {
    return explicitPath;
  }
  const envPath = process.env.EMBER_BUDDY_STATE_PATH?.trim();
  if (envPath) {
    return envPath;
  }
  const configHome = process.env.EMBER_CONFIG_HOME?.trim();
  if (configHome) {
    return join(configHome, "buddy-state.json");
  }
  return join(homedir(), ".emberforge", "buddy-state.json");
}

export class StarterBuddyState {
  private readonly statePath: string;
  private nextIndex = 0;
  private companion: BuddyTemplate | null = null;
  private muted = false;

  constructor(statePath?: string) {
    this.statePath = resolveBuddyStatePath(statePath);
    this.load();
  }

  private load(): void {
    if (!existsSync(this.statePath)) {
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, "utf-8")) as BuddyStateSnapshot;
      this.nextIndex = parsed.nextIndex ?? 0;
      this.companion = parsed.companion ?? null;
      this.muted = parsed.muted ?? false;
    } catch {
      this.nextIndex = 0;
      this.companion = null;
      this.muted = false;
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    const snapshot: BuddyStateSnapshot = {
      nextIndex: this.nextIndex,
      companion: this.companion,
      muted: this.muted,
    };
    writeFileSync(this.statePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
  }

  current(): StarterBuddyCompanion | null {
    if (!this.companion) {
      return null;
    }
    return { ...this.companion, muted: this.muted };
  }

  hatch(): { created: boolean; companion: StarterBuddyCompanion } {
    if (this.companion) {
      return { created: false, companion: this.current()! };
    }
    this.companion = BUDDY_TEMPLATES[this.nextIndex % BUDDY_TEMPLATES.length]!;
    this.nextIndex += 1;
    this.muted = false;
    this.persist();
    return { created: true, companion: this.current()! };
  }

  rehatch(): StarterBuddyCompanion {
    this.companion = BUDDY_TEMPLATES[this.nextIndex % BUDDY_TEMPLATES.length]!;
    this.nextIndex += 1;
    this.muted = false;
    this.persist();
    return this.current()!;
  }

  mute(): StarterBuddyCompanion | null {
    if (!this.companion) {
      return null;
    }
    this.muted = true;
    this.persist();
    return this.current();
  }

  unmute(): StarterBuddyCompanion | null {
    if (!this.companion) {
      return null;
    }
    this.muted = false;
    this.persist();
    return this.current();
  }
}

function renderCompanion(prefix: string, companion: StarterBuddyCompanion, note?: string): string {
  const lines = [
    prefix,
    `name: ${companion.name}`,
    `species: ${titleCaseSpecies(companion.species)}`,
    `personality: ${companion.personality}`,
    `status: ${companion.muted ? "muted" : "active"}`,
  ];
  if (note) {
    lines.push(note);
  }
  return lines.join("\n");
}

function renderCommand(prefix: string, ...lines: string[]): string {
  return [prefix, ...lines].join("\n");
}

export function executeBuddyCommand(state: StarterBuddyState, payload: string): string {
  const trimmed = payload.trim();
  const action = trimmed === "" ? "" : trimmed.split(/\s+/, 1)[0]!;

  switch (action) {
    case "": {
      const companion = state.current();
      if (!companion) {
        return [
          "[command] buddy",
          "status: no companion",
          "tip: use /buddy hatch to get one",
        ].join("\n");
      }
      return renderCompanion(
        "[command] buddy",
        companion,
        "commands: /buddy pet /buddy mute /buddy unmute /buddy hatch /buddy rehatch",
      );
    }
    case "hatch": {
      if (state.current()) {
        return renderCommand(
          "[command] buddy hatch",
          "status: companion already active",
          "tip: use /buddy to inspect it or /buddy rehatch to replace it",
        );
      }
      const result = state.hatch();
      return renderCompanion(
        "[command] buddy hatch",
        result.companion,
        "note: starter buddy translation from claude-code-src",
      );
    }
    case "rehatch":
      return renderCompanion(
        "[command] buddy rehatch",
        state.rehatch(),
        "note: previous companion replaced",
      );
    case "pet": {
      const companion = state.current();
      if (!companion) {
        return [
          "[command] buddy pet",
          "status: no companion",
          "tip: use /buddy hatch to get one",
        ].join("\n");
      }
      return [
        "[command] buddy pet",
        `reaction: ${companion.name} purrs happily!`,
        `status: ${companion.muted ? "muted" : "active"}`,
      ].join("\n");
    }
    case "mute": {
      const companion = state.current();
      if (!companion) {
        return [
          "[command] buddy mute",
          "status: no companion",
          "tip: use /buddy hatch to get one",
        ].join("\n");
      }
      if (companion.muted) {
        return renderCommand(
          "[command] buddy mute",
          "status: already muted",
          "tip: use /buddy unmute to bring it back",
        );
      }
      state.mute();
      return renderCommand(
        "[command] buddy mute",
        "status: muted",
        "note: companion will hide quietly until /buddy unmute",
      );
    }
    case "unmute": {
      const companion = state.current();
      if (!companion) {
        return [
          "[command] buddy unmute",
          "status: no companion",
          "tip: use /buddy hatch to get one",
        ].join("\n");
      }
      if (!companion.muted) {
        return renderCommand("[command] buddy unmute", "status: already active");
      }
      state.unmute();
      return renderCommand(
        "[command] buddy unmute",
        "status: active",
        "note: welcome back",
      );
    }
    default:
      return [
        "[command] buddy",
        `unsupported action: ${action}`,
        "commands: /buddy pet /buddy mute /buddy unmute /buddy hatch /buddy rehatch",
      ].join("\n");
  }
}
