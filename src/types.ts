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
export type ThemeMode = "conventional" | "presetMono" | "customMono";
export type ThemePresetId = "red" | "green" | "blue";
export type RingTemplateId = "pentane" | "hexane" | "benzene";

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
  charge?: number;
  isotope?: number;
  explicitHydrogens?: number;
  labelMode: LabelMode;
}

export interface Bond {
  id: string;
  a1: string;
  a2: string;
  order: BondOrder;
  stereo: BondStereo;
}

export interface ThemeState {
  mode: ThemeMode;
  presetId?: ThemePresetId;
  monoColor?: string;
}

export interface ChemicalDocument {
  atoms: Atom[];
  bonds: Bond[];
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
  | { kind: "ring"; templateId: RingTemplateId };

export interface ExportScene {
  markup: string;
  width: number;
  height: number;
}
