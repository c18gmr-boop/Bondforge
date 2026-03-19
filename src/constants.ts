import type { ElementColor, RingTemplate, ThemePreset, Viewport } from "./types";

export const BOND_LENGTH = 72;
export const ATOM_HIT_RADIUS = 18;
export const BOND_HIT_WIDTH = 18;
export const LABEL_FONT_SIZE = 26;
export const DEFAULT_VIEWPORT: Viewport = { x: -520, y: -320, zoom: 1.15 };
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export const ELEMENT_COLOURS: ElementColor[] = [
  { symbol: "H", color: "#BFBFBF" },
  { symbol: "C", color: "#1A1A1A" },
  { symbol: "N", color: "#3050F8" },
  { symbol: "O", color: "#FF0D0D" },
  { symbol: "S", color: "#FFD123" },
  { symbol: "P", color: "#FF8000" },
  { symbol: "F", color: "#90E050" },
  { symbol: "Cl", color: "#1FF01F" },
  { symbol: "Br", color: "#A62929" },
  { symbol: "I", color: "#940094" },
  { symbol: "*", color: "#555555" },
];

export const ELEMENT_COLOUR_MAP = new Map(
  ELEMENT_COLOURS.map((entry) => [entry.symbol, entry.color]),
);

export const QUICK_ELEMENTS = ["C", "N", "O", "S", "P", "F", "Cl", "Br", "I", "H"] as const;

export const THEME_PRESETS: ThemePreset[] = [
  { id: "red", label: "All Red", color: "#D7263D" },
  { id: "green", label: "All Green", color: "#1B9C5A" },
  { id: "blue", label: "All Blue", color: "#2F6BFF" },
];

export const RING_TEMPLATES: RingTemplate[] = [
  { id: "pentane", label: "5 Ring", size: 5, aromatic: false },
  { id: "hexane", label: "6 Ring", size: 6, aromatic: false },
  { id: "benzene", label: "Benzene", size: 6, aromatic: true },
];

export const NEUTRAL_BOND_COLOUR = "#20232F";
export const SELECTION_COLOUR = "#FF8A00";
export const GUIDE_COLOUR = "#0EA5E9";
