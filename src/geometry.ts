import { BOND_LENGTH, DEFAULT_VIEWPORT } from "./constants";
import type { ChemicalDocument, Point, Rect, Viewport } from "./types";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function angleBetween(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function pointAtDistance(origin: Point, angle: number, length: number): Point {
  return {
    x: origin.x + Math.cos(angle) * length,
    y: origin.y + Math.sin(angle) * length,
  };
}

export function normalizeAngle(angle: number): number {
  const tau = Math.PI * 2;
  let normalized = angle % tau;
  if (normalized < 0) {
    normalized += tau;
  }
  return normalized;
}

export function snapAngle(angle: number, increment = Math.PI / 6): number {
  return Math.round(angle / increment) * increment;
}

export function snapBondTarget(origin: Point, target: Point, length = BOND_LENGTH): Point {
  const angle = snapAngle(angleBetween(origin, target));
  return pointAtDistance(origin, angle, length);
}

export function lineDistanceToPoint(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return distance(a, p);
  }
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared, 0, 1);
  const projection = { x: a.x + t * dx, y: a.y + t * dy };
  return distance(projection, p);
}

export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function rectContainsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function boundsFromDocument(document: ChemicalDocument): Rect | null {
  if (document.atoms.length === 0) {
    return null;
  }
  const xs = document.atoms.map((atom) => atom.x);
  const ys = document.atoms.map((atom) => atom.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, BOND_LENGTH),
    height: Math.max(maxY - minY, BOND_LENGTH),
  };
}

export function fitViewportToBounds(
  bounds: Rect | null,
  widthPx: number,
  heightPx: number,
  padding = 120,
): Viewport {
  if (!bounds || widthPx <= 0 || heightPx <= 0) {
    return { ...DEFAULT_VIEWPORT };
  }
  const paddedWidth = bounds.width + padding * 2;
  const paddedHeight = bounds.height + padding * 2;
  const zoom = clamp(
    Math.min(widthPx / paddedWidth, heightPx / paddedHeight),
    0.35,
    2.75,
  );
  const viewWidth = widthPx / zoom;
  const viewHeight = heightPx / zoom;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    x: centerX - viewWidth / 2,
    y: centerY - viewHeight / 2,
    zoom,
  };
}

export function regularPolygonFromCenter(
  center: Point,
  sides: number,
  sideLength = BOND_LENGTH,
  rotation = -Math.PI / 2,
): Point[] {
  const radius = sideLength / (2 * Math.sin(Math.PI / sides));
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index * Math.PI * 2) / sides;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
}

export function regularPolygonFromEdge(
  start: Point,
  edgeAngle: number,
  sides: number,
  sideLength = BOND_LENGTH,
  turnDirection: 1 | -1 = 1,
): Point[] {
  const points: Point[] = [start];
  let currentAngle = edgeAngle;
  for (let index = 1; index < sides; index += 1) {
    const previous = points[index - 1];
    points.push({
      x: previous.x + Math.cos(currentAngle) * sideLength,
      y: previous.y + Math.sin(currentAngle) * sideLength,
    });
    currentAngle += turnDirection * ((Math.PI * 2) / sides);
  }
  return points;
}

export function regularPolygonFromBond(
  start: Point,
  end: Point,
  sides: number,
  turnDirection: 1 | -1 = 1,
): Point[] {
  const points: Point[] = [start, end];
  let currentAngle = angleBetween(start, end) + turnDirection * ((Math.PI * 2) / sides);
  while (points.length < sides) {
    const previous = points[points.length - 1];
    points.push({
      x: previous.x + Math.cos(currentAngle) * BOND_LENGTH,
      y: previous.y + Math.sin(currentAngle) * BOND_LENGTH,
    });
    currentAngle += turnDirection * ((Math.PI * 2) / sides);
  }
  return points;
}

export function averageBondLength(document: ChemicalDocument): number {
  if (document.bonds.length === 0) {
    return BOND_LENGTH;
  }
  const atomMap = new Map(document.atoms.map((atom) => [atom.id, atom]));
  const lengths = document.bonds
    .map((bond) => {
      const a1 = atomMap.get(bond.a1);
      const a2 = atomMap.get(bond.a2);
      if (!a1 || !a2) {
        return 0;
      }
      return distance(a1, a2);
    })
    .filter((value) => value > 0);
  if (lengths.length === 0) {
    return BOND_LENGTH;
  }
  return lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
}
