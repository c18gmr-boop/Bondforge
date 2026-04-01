export type ElementSymbol =
  | "H"
  | "C"
  | "N"
  | "O"
  | "S"
  | "P"
  | "F"
  | "Cl"
  | "Br"
  | "I"
  | string;

export type LabelMode = "auto" | "always" | "hidden";
export type BondOrder = "single" | "double" | "triple" | "aromatic";
export type BondStereo = "none" | "wedge" | "hash";
export type BondPreset = BondOrder | "wedge" | "hash";
export type AtomStateMode = "neutral" | "positive" | "negative" | "radical";
export type ThemeMode = "conventional" | "presetMono" | "customMono";
export type ThemePresetId = "red" | "green" | "blue";
export type RingTemplateId = "pentane" | "hexane" | "benzene";
export type BracketShape = "round" | "square";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Atom {
  id: string;
  element: ElementSymbol;
  x: number;
  y: number;
  displayColor?: string;
  charge?: number;
  radical?: boolean;
  isotope?: number;
  explicitHydrogens?: number;
  labelMode: LabelMode;
}

export interface Bond {
  id: string;
  a1: string;
  a2: string;
  displayColor?: string;
  order: BondOrder;
  stereo: BondStereo;
}

export interface ThemeState {
  mode: ThemeMode;
  presetId?: ThemePresetId;
  monoColor?: string;
}

export interface BracketAnnotation {
  id: string;
  shape: BracketShape;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChemicalDocument {
  atoms: Atom[];
  bonds: Bond[];
  brackets: BracketAnnotation[];
  viewport: Viewport;
  metadata: {
    name: string;
    createdAt: string;
    updatedAt: string;
    version: number;
  };
  themeState: ThemeState;
}

export interface ThemePreset {
  id: ThemePresetId;
  label: string;
  color: string;
}

export interface ElementColor {
  symbol: ElementSymbol;
  color: string;
}

export interface RingTemplate {
  id: RingTemplateId;
  label: string;
  size: number;
  aromatic: boolean;
}

export interface SelectionState {
  atomIds: Set<string>;
  bondIds: Set<string>;
}

export type ToolState =
  | { kind: "select" }
  | { kind: "pan" }
  | { kind: "erase" }
  | { kind: "atom"; element: ElementSymbol }
  | { kind: "bond"; preset: BondPreset }
  | { kind: "bracket"; shape: BracketShape }
  | { kind: "ring"; templateId: RingTemplateId };

export interface ExportScene {
  markup: string;
  width: number;
  height: number;
}
