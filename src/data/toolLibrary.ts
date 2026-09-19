import type { Tool } from "../types";

export const TOOL_FAMILIES = [
  {
    id: "flat",
    label: "Flat End",
    groups: [
      { id: "flat-metal", label: "Single Flute Metal" },
      { id: "flat-single", label: "Single Flute" },
      { id: "flat-corn", label: "Corn Bits" },
      { id: "flat-other", label: "Other flat end mills" },
    ],
  },
  {
    id: "engraving",
    label: "Engraving",
    groups: [
      { id: "engraving-chamfer", label: "Chamfering Bits" },
      { id: "engraving-metal", label: "Single Flute Metal" },
      { id: "engraving-single", label: "Single Flute" },
      { id: "engraving-two", label: "Two Flute" },
      { id: "engraving-solder", label: "Solder Mask Remover" },
      { id: "engraving-other", label: "Other engraving tools" },
    ],
  },
  {
    id: "ball",
    label: "Ball Nose",
    groups: [
      { id: "ball-metal", label: "Ball Nose Metal" },
      { id: "ball-standard", label: "Ball Nose" },
      { id: "ball-engraving", label: "Ball Nose Engraving" },
    ],
  },
  { id: "drill", label: "Drill", groups: [] },
  {
    id: "special",
    label: "Special profiles",
    groups: [
      { id: "special-thread", label: "Thread Milling" },
      { id: "special-other", label: "Other profiles" },
    ],
  },
] as const;

export type ToolFamilyId = (typeof TOOL_FAMILIES)[number]["id"];
export interface ToolCategory {
  family: ToolFamilyId;
  familyLabel: string;
  group: string;
  groupLabel: string;
  order: number;
}

const categories = new Map<string, ToolCategory>();
TOOL_FAMILIES.forEach((family, familyIndex) => {
  categories.set(family.id, {
    family: family.id,
    familyLabel: family.label,
    group: family.id,
    groupLabel: family.label,
    order: familyIndex * 100,
  });
  family.groups.forEach((group, groupIndex) => {
    categories.set(group.id, {
      family: family.id,
      familyLabel: family.label,
      group: group.id,
      groupLabel: group.label,
      order: familyIndex * 100 + groupIndex,
    });
  });
});

// Family names describe the catalog product, independently of whether its
// geometry is supported by the simulator. No cutting parameters are inferred.
export function toolCategory(tool: Tool): ToolCategory {
  const name = `${tool.name} ${tool.id}`.toLowerCase();
  let group: string;
  if (/drill/.test(name)) group = "drill";
  else if (tool.kind === "thread" || /thread.milling/.test(name))
    group = "special-thread";
  else if (/solder.mask/.test(name)) group = "engraving-solder";
  else if (/ball.nose/.test(name) || tool.kind === "ball") {
    group = /engraving/.test(name)
      ? "ball-engraving"
      : /for[ -]metal/.test(name)
        ? "ball-metal"
        : "ball-standard";
  } else if (/chamfer/.test(name)) group = "engraving-chamfer";
  else if (tool.kind === "v" || /engraving/.test(name)) {
    group = /single.flute/.test(name)
      ? /for[ -]metal/.test(name)
        ? "engraving-metal"
        : "engraving-single"
      : /two.flute/.test(name)
        ? "engraving-two"
        : "engraving-other";
  } else if (tool.kind === "flat") {
    group = /corn/.test(name)
      ? "flat-corn"
      : /single.flute/.test(name)
        ? /for[ -]metal/.test(name)
          ? "flat-metal"
          : "flat-single"
        : "flat-other";
  } else group = "special-other";
  return categories.get(group)!;
}

export type ToolSort =
  "catalog" | "name" | "type" | "diameter" | "length" | "shank";
const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});
const numeric = (a: number | undefined, b: number | undefined) =>
  a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a - b;

export function compareTools(
  a: Tool,
  b: Tool,
  key: ToolSort = "catalog",
): number {
  const category = toolCategory(a).order - toolCategory(b).order;
  const dimensions =
    numeric(a.diameter, b.diameter) ||
    numeric(a.length, b.length) ||
    numeric(a.angle, b.angle) ||
    numeric(a.tip, b.tip) ||
    numeric(a.shank, b.shank);
  const name = collator.compare(a.name, b.name) || collator.compare(a.id, b.id);
  if (key === "catalog" || key === "type")
    return category || dimensions || name;
  if (key === "name") return name;
  return numeric(a[key], b[key]) || category || dimensions || name;
}

function normalizeSearch(text: string) {
  return text
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, "$1.")
    .trim();
}

export function matchesToolSearch(tool: Tool, query: string): boolean {
  const category = toolCategory(tool);
  const searchable = normalizeSearch(
    `${tool.name} ${category.familyLabel} ${category.groupLabel} ${tool.diameter} ${tool.length ?? ""} ${tool.shank ?? ""} ${tool.angle ?? ""} ${tool.tip ?? ""}`,
  );
  return normalizeSearch(query)
    .split(/\s+/)
    .every((word) => searchable.includes(word));
}

export function matchesToolGroup(tool: Tool, group: string): boolean {
  const category = toolCategory(tool);
  return (
    group === "all" || category.family === group || category.group === group
  );
}
