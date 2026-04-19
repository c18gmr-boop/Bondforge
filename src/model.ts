import {
  BOND_LENGTH,
  DEFAULT_VIEWPORT,
  ELEMENT_COLOUR_MAP,
  NEUTRAL_BOND_COLOUR,
  RING_TEMPLATES,
  THEME_PRESETS,
} from "./constants";
import {
  angleBetween,
  averageBondLength,
  boundsFromDocument,
  distance,
  midpoint,
  normalizeAngle,
  pointAtDistance,
  regularPolygonFromBond,
  regularPolygonFromCenter,
  regularPolygonFromEdge,
  snapAngle,
} from "./geometry";
import defaultDocumentRaw from "./default-document.json";
import type {
  Atom,
  AtomStateMode,
  Bond,
  BondPreset,
  BracketAnnotation,
  BracketShape,
  ChemicalDocument,
  ElementSymbol,
  BondOrder,
  BondStereo,
  Point,
  Rect,
  RingTemplate,
  RingTemplateId,
  SelectionState,
  ThemeState,
} from "./types";

export interface AtomLabelSegment {
  text: string;
  element: ElementSymbol;
}

export interface ValenceViolation {
  atomId: string;
  element: ElementSymbol;
  occupied: number;
  cap: number;
}

interface ValenceCaps {
  neutral: number;
  positive: number;
  negative: number;
  radical: number;
}

const ORGANIC_VALENCE_CAPS: Record<string, ValenceCaps> = {
  H: { neutral: 1, positive: 0, negative: 2, radical: 0 },
  C: { neutral: 4, positive: 3, negative: 3, radical: 3 },
  N: { neutral: 3, positive: 4, negative: 2, radical: 2 },
  O: { neutral: 2, positive: 3, negative: 1, radical: 1 },
  S: { neutral: 2, positive: 3, negative: 1, radical: 1 },
  P: { neutral: 3, positive: 4, negative: 2, radical: 2 },
  F: { neutral: 1, positive: 2, negative: 0, radical: 0 },
  Cl: { neutral: 1, positive: 2, negative: 0, radical: 0 },
  Br: { neutral: 1, positive: 2, negative: 0, radical: 0 },
  I: { neutral: 1, positive: 2, negative: 0, radical: 0 },
};

function nowIso(): string {
  return new Date().toISOString();
}

function createId(): string {
  return globalThis.crypto.randomUUID();
}

export function createSelectionState(): SelectionState {
  return {
    atomIds: new Set<string>(),
    bondIds: new Set<string>(),
  };
}

export function clearSelection(selection: SelectionState): void {
  selection.atomIds.clear();
  selection.bondIds.clear();
}

export function cloneDocument(document: ChemicalDocument): ChemicalDocument {
  return structuredClone(document);
}

export function createEmptyDocument(name = "Untitled"): ChemicalDocument {
  const createdAt = nowIso();
  return {
    atoms: [],
    bonds: [],
    brackets: [],
    viewport: { ...DEFAULT_VIEWPORT },
    metadata: {
      name,
      createdAt,
      updatedAt: createdAt,
      version: 1,
    },
    themeState: {
      mode: "conventional",
    },
  };
}

export function createDemoDocument(): ChemicalDocument {
  return normalizeLoadedDocument(defaultDocumentRaw);
}

export function getAtomById(document: ChemicalDocument, atomId: string): Atom | undefined {
  return document.atoms.find((atom) => atom.id === atomId);
}

export function getBondById(document: ChemicalDocument, bondId: string): Bond | undefined {
  return document.bonds.find((bond) => bond.id === bondId);
}

export function getBracketById(
  document: ChemicalDocument,
  bracketId: string,
): BracketAnnotation | undefined {
  return document.brackets.find((bracket) => bracket.id === bracketId);
}

export function getBondBetween(
  document: ChemicalDocument,
  a1: string,
  a2: string,
): Bond | undefined {
  return document.bonds.find(
    (bond) =>
      (bond.a1 === a1 && bond.a2 === a2) || (bond.a1 === a2 && bond.a2 === a1),
  );
}

export function getAtomDegree(document: ChemicalDocument, atomId: string): number {
  return document.bonds.filter((bond) => bond.a1 === atomId || bond.a2 === atomId).length;
}

export function getConnectedBondIds(document: ChemicalDocument, atomId: string): string[] {
  return document.bonds
    .filter((bond) => bond.a1 === atomId || bond.a2 === atomId)
    .map((bond) => bond.id);
}

export function getAromaticRingCycles(document: ChemicalDocument): string[][] {
  const adjacency = new Map<string, Set<string>>();

  for (const bond of document.bonds) {
    if (bond.order !== "aromatic") {
      continue;
    }
    const a1 = adjacency.get(bond.a1) ?? new Set<string>();
    const a2 = adjacency.get(bond.a2) ?? new Set<string>();
    a1.add(bond.a2);
    a2.add(bond.a1);
    adjacency.set(bond.a1, a1);
    adjacency.set(bond.a2, a2);
  }

  const cycles = new Map<string, string[]>();

  const visit = (start: string, current: string, path: string[], visited: Set<string>): void => {
    if (path.length === 6) {
      if (adjacency.get(current)?.has(start)) {
        const key = [...path].sort().join("|");
        if (!cycles.has(key)) {
          cycles.set(key, [...path]);
        }
      }
      return;
    }

    for (const next of adjacency.get(current) ?? []) {
      if (next === start || visited.has(next)) {
        continue;
      }
      visited.add(next);
      path.push(next);
      visit(start, next, path, visited);
      path.pop();
      visited.delete(next);
    }
  };

  for (const atomId of adjacency.keys()) {
    visit(atomId, atomId, [atomId], new Set([atomId]));
  }

  return Array.from(cycles.values());
}

export function touchDocument(document: ChemicalDocument): void {
  document.metadata.updatedAt = nowIso();
  document.metadata.version += 1;
}

export function getMonochromeColour(themeState: ThemeState): string | null {
  if (themeState.mode === "presetMono" && themeState.presetId) {
    return THEME_PRESETS.find((preset) => preset.id === themeState.presetId)?.color ?? null;
  }
  if (themeState.mode === "customMono") {
    return themeState.monoColor ?? "#D7263D";
  }
  return null;
}

export function getAtomColour(atom: Atom, themeState: ThemeState): string {
  if (atom.displayColor) {
    return atom.displayColor;
  }
  const mono = getMonochromeColour(themeState);
  if (mono) {
    return mono;
  }
  return ELEMENT_COLOUR_MAP.get(atom.element) ?? ELEMENT_COLOUR_MAP.get("*") ?? "#555555";
}

export function getBondColour(themeState: ThemeState, bond?: Bond): string {
  if (bond?.displayColor) {
    return bond.displayColor;
  }
  return getMonochromeColour(themeState) ?? NEUTRAL_BOND_COLOUR;
}

export function getAtomStateMode(atom: Atom): AtomStateMode {
  if (atom.radical) {
    return "radical";
  }
  if ((atom.charge ?? 0) > 0) {
    return "positive";
  }
  if ((atom.charge ?? 0) < 0) {
    return "negative";
  }
  return "neutral";
}

export function getAtomValenceCap(atom: Atom): number {
  const caps = ORGANIC_VALENCE_CAPS[atom.element];
  if (!caps) {
    return Number.POSITIVE_INFINITY;
  }
  return caps[getAtomStateMode(atom)];
}

function bondOrderValue(order: Bond["order"]): number {
  switch (order) {
    case "double":
      return 2;
    case "triple":
      return 3;
    case "aromatic":
      return 1.5;
    default:
      return 1;
  }
}

export function getAtomBondOrderSum(document: ChemicalDocument, atomId: string): number {
  return document.bonds.reduce((sum, bond) => {
    if (bond.a1 !== atomId && bond.a2 !== atomId) {
      return sum;
    }
    return sum + bondOrderValue(bond.order);
  }, 0);
}

export function getValenceViolation(
  document: ChemicalDocument,
  atomIds?: Iterable<string>,
): ValenceViolation | null {
  const ids = atomIds ? new Set(atomIds) : new Set(document.atoms.map((atom) => atom.id));
  for (const atom of document.atoms) {
    if (!ids.has(atom.id)) {
      continue;
    }
    const cap = getAtomValenceCap(atom);
    if (!Number.isFinite(cap)) {
      continue;
    }
    const occupied = getAtomBondOrderSum(document, atom.id);
    if (occupied > cap + 0.001) {
      return {
        atomId: atom.id,
        element: atom.element,
        occupied,
        cap,
      };
    }
  }
  return null;
}

export function shouldShowAtomLabel(document: ChemicalDocument, atom: Atom): boolean {
  if (atom.labelMode === "always") {
    return true;
  }
  if (atom.labelMode === "hidden") {
    return false;
  }
  if (atom.element !== "C") {
    return true;
  }
  return (
    getAtomDegree(document, atom.id) === 0 ||
    Boolean(atom.charge) ||
    Boolean(atom.radical) ||
    Boolean(atom.isotope) ||
    Boolean(atom.explicitHydrogens)
  );
}

function formatCharge(charge?: number): string {
  if (!charge) {
    return "";
  }
  const symbol = charge > 0 ? "+" : "-";
  const magnitude = Math.abs(charge);
  return magnitude === 1 ? symbol : `${magnitude}${symbol}`;
}

export function getImplicitHydrogenCount(document: ChemicalDocument, atom: Atom): number {
  if (atom.element === "H") {
    return 0;
  }
  if (typeof atom.explicitHydrogens === "number") {
    return atom.explicitHydrogens;
  }
  if (atom.charge || atom.radical || atom.isotope) {
    return 0;
  }

  const degree = getAtomDegree(document, atom.id);
  const bondOrderSum = getAtomBondOrderSum(document, atom.id);

  if (degree !== 1) {
    return 0;
  }

  switch (atom.element) {
    case "O":
    case "S":
      return bondOrderSum <= 1 ? 1 : 0;
    case "N":
    case "P":
      return Math.max(0, Math.min(2, Math.round(3 - bondOrderSum)));
    default:
      return 0;
  }
}

function shouldPrefixHydrogen(document: ChemicalDocument, atom: Atom): boolean {
  const neighbours = document.bonds
    .filter((bond) => bond.a1 === atom.id || bond.a2 === atom.id)
    .map((bond) => getAtomById(document, bond.a1 === atom.id ? bond.a2 : bond.a1))
    .filter((value): value is Atom => Boolean(value));

  if (neighbours.length !== 1) {
    return false;
  }

  return neighbours[0].x > atom.x;
}

export function getAtomLabelSegments(
  document: ChemicalDocument,
  atom: Atom,
): AtomLabelSegment[] {
  const segments: AtomLabelSegment[] = [];
  if (atom.isotope) {
    segments.push({ text: `${atom.isotope}`, element: atom.element });
  }

  const implicitHydrogens = getImplicitHydrogenCount(document, atom);
  const hydrogenText =
    implicitHydrogens > 0 && atom.element !== "H"
      ? implicitHydrogens === 1
        ? "H"
        : `H${implicitHydrogens}`
      : "";

  if (hydrogenText && shouldPrefixHydrogen(document, atom)) {
    segments.push({ text: hydrogenText, element: "H" });
    segments.push({ text: atom.element, element: atom.element });
  } else {
    segments.push({ text: atom.element, element: atom.element });
    if (hydrogenText) {
      segments.push({ text: hydrogenText, element: "H" });
    }
  }

  const chargeText = formatCharge(atom.charge);
  if (chargeText) {
    segments.push({ text: chargeText, element: atom.element });
  }

  return segments;
}

export function getAtomLabel(document: ChemicalDocument, atom: Atom): string {
  return getAtomLabelSegments(document, atom)
    .map((segment) => segment.text)
    .join("");
}

export function addAtom(
  document: ChemicalDocument,
  element: ElementSymbol,
  point: Point,
): string {
  const atomId = createId();
  document.atoms.push({
    id: atomId,
    element,
    x: point.x,
    y: point.y,
    labelMode: element === "C" ? "auto" : "always",
  });
  touchDocument(document);
  return atomId;
}

export function setAtomElement(
  document: ChemicalDocument,
  atomId: string,
  element: ElementSymbol,
): void {
  const atom = getAtomById(document, atomId);
  if (!atom) {
    return;
  }
  atom.element = element;
  atom.labelMode = element === "C" ? "auto" : "always";
  touchDocument(document);
}

export function setAtomState(
  document: ChemicalDocument,
  atomId: string,
  state: AtomStateMode,
): void {
  const atom = getAtomById(document, atomId);
  if (!atom) {
    return;
  }
  atom.charge = state === "positive" ? 1 : state === "negative" ? -1 : undefined;
  atom.radical = state === "radical" ? true : undefined;
  touchDocument(document);
}

function normalizeBracketRect(rect: Rect): Rect {
  const x = rect.width >= 0 ? rect.x : rect.x + rect.width;
  const y = rect.height >= 0 ? rect.y : rect.y + rect.height;
  return {
    x,
    y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

export function addBracket(
  document: ChemicalDocument,
  shape: BracketShape,
  rect: Rect,
): string {
  const normalized = normalizeBracketRect(rect);
  const bracketId = createId();
  document.brackets.push({
    id: bracketId,
    shape,
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height,
  });
  touchDocument(document);
  return bracketId;
}

export function deleteBracket(document: ChemicalDocument, bracketId: string): void {
  document.brackets = document.brackets.filter((bracket) => bracket.id !== bracketId);
  touchDocument(document);
}

function applyPresetToBond(
  bond: Bond,
  a1: string,
  a2: string,
  preset: BondPreset,
): void {
  bond.a1 = a1;
  bond.a2 = a2;
  if (preset === "wedge") {
    bond.order = "single";
    bond.stereo = "wedge";
    return;
  }
  if (preset === "hash") {
    bond.order = "single";
    bond.stereo = "hash";
    return;
  }
  bond.order = preset;
  bond.stereo = "none";
}

export function connectAtoms(
  document: ChemicalDocument,
  a1: string,
  a2: string,
  preset: BondPreset,
): string | null {
  if (a1 === a2) {
    return null;
  }
  const existing = getBondBetween(document, a1, a2);
  if (existing) {
    applyPresetToBond(existing, a1, a2, preset);
    touchDocument(document);
    return existing.id;
  }
  const bond: Bond = {
    id: createId(),
    a1,
    a2,
    order: "single",
    stereo: "none",
  };
  applyPresetToBond(bond, a1, a2, preset);
  document.bonds.push(bond);
  touchDocument(document);
  return bond.id;
}

export function deleteBond(document: ChemicalDocument, bondId: string): void {
  document.bonds = document.bonds.filter((bond) => bond.id !== bondId);
  touchDocument(document);
}

export function deleteAtom(document: ChemicalDocument, atomId: string): void {
  document.atoms = document.atoms.filter((atom) => atom.id !== atomId);
  document.bonds = document.bonds.filter((bond) => bond.a1 !== atomId && bond.a2 !== atomId);
  touchDocument(document);
}

export function deleteSelection(document: ChemicalDocument, selection: SelectionState): void {
  if (selection.atomIds.size === 0 && selection.bondIds.size === 0) {
    return;
  }
  document.atoms = document.atoms.filter((atom) => !selection.atomIds.has(atom.id));
  document.bonds = document.bonds.filter(
    (bond) =>
      !selection.bondIds.has(bond.id) &&
      !selection.atomIds.has(bond.a1) &&
      !selection.atomIds.has(bond.a2),
  );
  touchDocument(document);
}

export function moveAtoms(
  document: ChemicalDocument,
  atomIds: Iterable<string>,
  dx: number,
  dy: number,
): void {
  const ids = new Set(atomIds);
  for (const atom of document.atoms) {
    if (ids.has(atom.id)) {
      atom.x += dx;
      atom.y += dy;
    }
  }
}

function getNeighbourAngles(document: ChemicalDocument, atomId: string): number[] {
  const atom = getAtomById(document, atomId);
  if (!atom) {
    return [];
  }
  return document.bonds
    .filter((bond) => bond.a1 === atomId || bond.a2 === atomId)
    .map((bond) => {
      const neighbour = getAtomById(document, bond.a1 === atomId ? bond.a2 : bond.a1);
      return neighbour ? normalizeAngle(angleBetween(atom, neighbour)) : 0;
    });
}

export function getPreferredAttachmentAngle(
  document: ChemicalDocument,
  atomId: string,
): number {
  const angles = getNeighbourAngles(document, atomId).sort((a, b) => a - b);
  if (angles.length === 0) {
    return 0;
  }
  if (angles.length === 1) {
    return snapAngle(angles[0] - (Math.PI * 2) / 3);
  }
  let bestGap = -1;
  let bestAngle = angles[0];
  for (let index = 0; index < angles.length; index += 1) {
    const current = angles[index];
    const next = index === angles.length - 1 ? angles[0] + Math.PI * 2 : angles[index + 1];
    const gap = next - current;
    if (gap > bestGap) {
      bestGap = gap;
      bestAngle = current + gap / 2;
    }
  }
  return snapAngle(bestAngle);
}

function getRingTemplate(templateId: RingTemplateId): RingTemplate {
  return (
    RING_TEMPLATES.find((template) => template.id === templateId) ?? RING_TEMPLATES[1]
  );
}

function ringOrder(template: RingTemplate): BondPreset {
  return template.aromatic ? "aromatic" : "single";
}

function ringOverlapPenalty(
  document: ChemicalDocument,
  points: Point[],
  ignoredAtomIds: Set<string>,
): number {
  let penalty = 0;
  for (const point of points) {
    for (const atom of document.atoms) {
      if (ignoredAtomIds.has(atom.id)) {
        continue;
      }
      const gap = distance(point, atom);
      if (gap < BOND_LENGTH * 0.68) {
        const severity = BOND_LENGTH * 0.68 - gap;
        penalty += severity * severity;
      }
    }
  }
  return penalty;
}

function chooseRingPoints(
  document: ChemicalDocument,
  optionA: Point[],
  optionB: Point[],
  ignoredAtomIds: Set<string>,
): Point[] {
  const penaltyA = ringOverlapPenalty(document, optionA, ignoredAtomIds);
  const penaltyB = ringOverlapPenalty(document, optionB, ignoredAtomIds);
  return penaltyA <= penaltyB ? optionA : optionB;
}

export function addRingFromCenter(
  document: ChemicalDocument,
  templateId: RingTemplateId,
  center: Point,
): void {
  const template = getRingTemplate(templateId);
  const points = regularPolygonFromCenter(center, template.size);
  const atomIds = points.map((point) => addAtom(document, "C", point));
  for (let index = 0; index < atomIds.length; index += 1) {
    const next = atomIds[(index + 1) % atomIds.length];
    connectAtoms(document, atomIds[index], next, ringOrder(template));
  }
}

export function addRingFromAtom(
  document: ChemicalDocument,
  templateId: RingTemplateId,
  atomId: string,
): void {
  const template = getRingTemplate(templateId);
  const anchor = getAtomById(document, atomId);
  if (!anchor) {
    return;
  }
  const preferredAngle = getPreferredAttachmentAngle(document, atomId);
  const clockwise = regularPolygonFromEdge(anchor, preferredAngle, template.size, BOND_LENGTH, 1);
  const anticlockwise = regularPolygonFromEdge(
    anchor,
    preferredAngle,
    template.size,
    BOND_LENGTH,
    -1,
  );
  const points = chooseRingPoints(document, clockwise, anticlockwise, new Set([atomId]));
  const atomIds = [atomId];
  for (let index = 1; index < points.length; index += 1) {
    atomIds.push(addAtom(document, "C", points[index]));
  }
  for (let index = 0; index < atomIds.length - 1; index += 1) {
    connectAtoms(document, atomIds[index], atomIds[index + 1], ringOrder(template));
  }
  connectAtoms(document, atomIds[atomIds.length - 1], atomIds[0], ringOrder(template));
}

export function addRingFromBond(
  document: ChemicalDocument,
  templateId: RingTemplateId,
  bondId: string,
  guidePoint?: Point,
): void {
  const template = getRingTemplate(templateId);
  const bond = getBondById(document, bondId);
  if (!bond) {
    return;
  }
  const start = getAtomById(document, bond.a1);
  const end = getAtomById(document, bond.a2);
  if (!start || !end) {
    return;
  }
  const cross =
    guidePoint &&
    (end.x - start.x) * (guidePoint.y - start.y) - (end.y - start.y) * (guidePoint.x - start.x);
  const optionA = regularPolygonFromBond(start, end, template.size, 1);
  const optionB = regularPolygonFromBond(start, end, template.size, -1);
  const points =
    typeof cross === "number" && cross !== 0
      ? cross >= 0
        ? optionA
        : optionB
      : chooseRingPoints(document, optionA, optionB, new Set([bond.a1, bond.a2]));

  const atomIds = [bond.a1, bond.a2];
  for (let index = 2; index < points.length; index += 1) {
    atomIds.push(addAtom(document, "C", points[index]));
  }

  applyPresetToBond(bond, bond.a1, bond.a2, ringOrder(template));
  for (let index = 1; index < atomIds.length - 1; index += 1) {
    connectAtoms(document, atomIds[index], atomIds[index + 1], ringOrder(template));
  }
  connectAtoms(document, atomIds[atomIds.length - 1], atomIds[0], ringOrder(template));
  touchDocument(document);
}

export function tidyDocument(document: ChemicalDocument): void {
  if (document.bonds.length === 0) {
    return;
  }

  const bounds = boundsFromDocument(document);
  const average = averageBondLength(document);
  if (bounds && average > 0) {
    const scale = BOND_LENGTH / average;
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    for (const atom of document.atoms) {
      atom.x = center.x + (atom.x - center.x) * scale;
      atom.y = center.y + (atom.y - center.y) * scale;
    }
  }

  const atomMap = new Map(document.atoms.map((atom) => [atom.id, atom]));
  const degrees = new Map(document.atoms.map((atom) => [atom.id, getAtomDegree(document, atom.id)]));

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const targets = new Map<string, { x: number; y: number; count: number }>();
    for (const bond of document.bonds) {
      const a1 = atomMap.get(bond.a1);
      const a2 = atomMap.get(bond.a2);
      if (!a1 || !a2) {
        continue;
      }
      const angle = snapAngle(angleBetween(a1, a2));
      const unit = pointAtDistance({ x: 0, y: 0 }, angle, BOND_LENGTH);
      const degree1 = degrees.get(a1.id) ?? 0;
      const degree2 = degrees.get(a2.id) ?? 0;

      let target1: Point;
      let target2: Point;
      if (degree1 > degree2 && degree2 <= 1) {
        target1 = { x: a1.x, y: a1.y };
        target2 = { x: a1.x + unit.x, y: a1.y + unit.y };
      } else if (degree2 > degree1 && degree1 <= 1) {
        target2 = { x: a2.x, y: a2.y };
        target1 = { x: a2.x - unit.x, y: a2.y - unit.y };
      } else {
        const center = midpoint(a1, a2);
        target1 = { x: center.x - unit.x / 2, y: center.y - unit.y / 2 };
        target2 = { x: center.x + unit.x / 2, y: center.y + unit.y / 2 };
      }

      const current1 = targets.get(a1.id) ?? { x: 0, y: 0, count: 0 };
      const current2 = targets.get(a2.id) ?? { x: 0, y: 0, count: 0 };
      current1.x += target1.x;
      current1.y += target1.y;
      current1.count += 1;
      current2.x += target2.x;
      current2.y += target2.y;
      current2.count += 1;
      targets.set(a1.id, current1);
      targets.set(a2.id, current2);
    }

    for (const atom of document.atoms) {
      const target = targets.get(atom.id);
      if (!target || target.count === 0) {
        continue;
      }
      const averaged = { x: target.x / target.count, y: target.y / target.count };
      atom.x = atom.x * 0.28 + averaged.x * 0.72;
      atom.y = atom.y * 0.28 + averaged.y * 0.72;
    }
  }
  touchDocument(document);
}

function toStringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function toNumberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeThemeState(raw: unknown): ThemeState {
  if (!raw || typeof raw !== "object") {
    return { mode: "conventional" };
  }
  const source = raw as Record<string, unknown>;
  const mode =
    source.mode === "presetMono" || source.mode === "customMono" || source.mode === "conventional"
      ? source.mode
      : "conventional";
  return {
    mode,
    presetId:
      source.presetId === "red" || source.presetId === "green" || source.presetId === "blue"
        ? source.presetId
        : undefined,
    monoColor: typeof source.monoColor === "string" ? source.monoColor : undefined,
  };
}

export function normalizeLoadedDocument(raw: unknown): ChemicalDocument {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid project file.");
  }
  const source = raw as Record<string, unknown>;
  const document = createEmptyDocument(toStringValue(source.name, "Imported Project"));
  document.metadata.name = toStringValue(
    (source.metadata as Record<string, unknown> | undefined)?.name ?? source.name,
    "Imported Project",
  );
  document.metadata.createdAt = toStringValue(
    (source.metadata as Record<string, unknown> | undefined)?.createdAt,
    nowIso(),
  );
  document.metadata.updatedAt = nowIso();
  document.metadata.version = toNumberValue(
    (source.metadata as Record<string, unknown> | undefined)?.version,
    1,
  );

  const atomsSource = Array.isArray(source.atoms) ? source.atoms : [];
  document.atoms = atomsSource
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      id: toStringValue(entry.id, createId()),
      element: toStringValue(entry.element, "C"),
      x: toNumberValue(entry.x, 0),
      y: toNumberValue(entry.y, 0),
      displayColor: typeof entry.displayColor === "string" ? entry.displayColor : undefined,
      charge:
        typeof entry.charge === "number" && Number.isFinite(entry.charge) ? entry.charge : undefined,
      radical: entry.radical === true ? true : undefined,
      isotope:
        typeof entry.isotope === "number" && Number.isFinite(entry.isotope)
          ? entry.isotope
          : undefined,
      explicitHydrogens:
        typeof entry.explicitHydrogens === "number" && Number.isFinite(entry.explicitHydrogens)
          ? entry.explicitHydrogens
          : undefined,
      labelMode:
        entry.labelMode === "always" || entry.labelMode === "hidden" || entry.labelMode === "auto"
          ? entry.labelMode
          : toStringValue(entry.element, "C") === "C"
            ? "auto"
            : "always",
    }));

  const atomIds = new Set(document.atoms.map((atom) => atom.id));
  const bondsSource = Array.isArray(source.bonds) ? source.bonds : [];
  document.bonds = bondsSource
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry): Bond => {
      const order: BondOrder =
        entry.order === "double" ||
        entry.order === "triple" ||
        entry.order === "aromatic" ||
        entry.order === "single"
          ? entry.order
          : "single";
      const stereo: BondStereo =
        entry.stereo === "wedge" || entry.stereo === "hash" ? entry.stereo : "none";
      return {
        id: toStringValue(entry.id, createId()),
        a1: toStringValue(entry.a1, ""),
        a2: toStringValue(entry.a2, ""),
        displayColor: typeof entry.displayColor === "string" ? entry.displayColor : undefined,
        order,
        stereo,
      };
    })
    .filter((bond) => atomIds.has(bond.a1) && atomIds.has(bond.a2) && bond.a1 !== bond.a2);

  const bracketsSource = Array.isArray(source.brackets) ? source.brackets : [];
  document.brackets = bracketsSource
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => {
      const rawRect = {
        x: toNumberValue(entry.x, 0),
        y: toNumberValue(entry.y, 0),
        width: toNumberValue(entry.width, 0),
        height: toNumberValue(entry.height, 0),
      };
      const normalizedRect = normalizeBracketRect(rawRect);
      return {
        id: toStringValue(entry.id, createId()),
        shape: entry.shape === "round" || entry.shape === "square" ? entry.shape : "square",
        x: normalizedRect.x,
        y: normalizedRect.y,
        width: normalizedRect.width,
        height: normalizedRect.height,
      } satisfies BracketAnnotation;
    })
    .filter((bracket) => bracket.width > 0 && bracket.height > 0);

  const viewportSource =
    source.viewport && typeof source.viewport === "object"
      ? (source.viewport as Record<string, unknown>)
      : undefined;
  document.viewport = {
    x: toNumberValue(viewportSource?.x, DEFAULT_VIEWPORT.x),
    y: toNumberValue(viewportSource?.y, DEFAULT_VIEWPORT.y),
    zoom: toNumberValue(viewportSource?.zoom, DEFAULT_VIEWPORT.zoom),
  };
  document.themeState = normalizeThemeState(source.themeState);
  return document;
}
