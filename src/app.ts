import {
  ATOM_HIT_RADIUS,
  BOND_HIT_WIDTH,
  BOND_LENGTH,
  GUIDE_COLOUR,
  QUICK_ELEMENTS,
  RING_TEMPLATES,
  SELECTION_COLOUR,
  SVG_NAMESPACE,
  THEME_PRESETS,
} from "./constants";
import { exportMolfile, exportSmiles, importMolfile, importSmiles } from "./chemistry";
import {
  clamp,
  fitViewportToBounds,
  lineDistanceToPoint,
  normalizeRect,
  rectContainsPoint,
  snapBondTarget,
} from "./geometry";
import {
  addAtom,
  addBracket,
  addRingFromAtom,
  addRingFromBond,
  addRingFromCenter,
  clearSelection,
  cloneDocument,
  connectAtoms,
  createDemoDocument,
  createEmptyDocument,
  createSelectionState,
  deleteAtom,
  deleteBond,
  deleteBracket,
  deleteSelection,
  getAtomById,
  getAtomBondOrderSum,
  getAtomColour,
  getAtomLabelSegments,
  getAtomStateMode,
  getAromaticRingCycles,
  getBondById,
  getBondColour,
  getConnectedBondIds,
  getMonochromeColour,
  getValenceViolation,
  normalizeLoadedDocument,
  setAtomElement,
  setAtomState,
  shouldShowAtomLabel,
  tidyDocument,
  touchDocument,
} from "./model";
import type {
  Atom,
  AtomStateMode,
  Bond,
  BondPreset,
  BracketAnnotation,
  BracketShape,
  ChemicalDocument,
  ElementSymbol,
  ExportScene,
  Point,
  RingTemplateId,
  SelectionState,
  ThemeState,
  ToolState,
  Viewport,
} from "./types";

type InteractionState =
  | {
      kind: "move";
      pointerId: number;
      startWorld: Point;
      originalDoc: ChemicalDocument;
      movingAtomIds: string[];
    }
  | {
      kind: "box";
      pointerId: number;
      startWorld: Point;
      currentWorld: Point;
      additive: boolean;
      baseSelection: SelectionState;
    }
  | {
      kind: "pan";
      pointerId: number;
      startClient: Point;
      originalViewport: Viewport;
    }
  | {
      kind: "bracket";
      pointerId: number;
      startWorld: Point;
      currentWorld: Point;
      shape: BracketShape;
    }
  | {
      kind: "gesture";
      pointerIds: number[];
      startDistance: number;
      startMidpoint: Point;
      originalViewport: Viewport;
    }
  | null;

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class ChemicalEditorApp {
  private readonly root: HTMLElement;

  private document: ChemicalDocument = createDemoDocument();

  private selection: SelectionState = createSelectionState();

  private history: ChemicalDocument[] = [];

  private future: ChemicalDocument[] = [];

  private tool: ToolState = { kind: "select" };

  private pendingBondStartId: string | null = null;

  private interaction: InteractionState = null;

  private statusMessage = "ChemDraw-style core editing is ready. Use the left rail to draw or recolour.";

  private hoverWorld: Point | null = null;

  private hoverAtomId: string | null = null;

  private hoverBondId: string | null = null;

  private hoverBracketId: string | null = null;

  private topbarEl!: HTMLElement;

  private toolrailEl!: HTMLElement;

  private sidebarEl!: HTMLElement;

  private statusEl!: HTMLElement;

  private svgEl!: SVGSVGElement;

  private canvasControlsEl!: HTMLElement;

  private emptyEl!: HTMLElement;

  private projectInputEl!: HTMLInputElement;

  private molInputEl!: HTMLInputElement;

  private atomMenuEl!: HTMLElement;

  private resizeObserver!: ResizeObserver;

  private textMeasureContext: CanvasRenderingContext2D | null = null;

  private activeTouchPoints = new Map<number, Point>();

  private atomMenuState: { atomId: string; x: number; y: number } | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.buildShell();
    this.bindEvents();
    this.renderChrome();
    this.renderCanvas();
    requestAnimationFrame(() => {
      this.fitToDocument();
      this.renderCanvas();
    });
  }

  private buildShell(): void {
    this.root.innerHTML = `
      <div class="app-shell">
        <header class="topbar" id="topbar"></header>
        <div class="workspace">
          <aside class="toolrail" id="toolrail"></aside>
          <section class="stage">
            <div class="canvas-frame">
              <div class="canvas-controls" id="canvas-controls">
                <button type="button" class="canvas-control-btn" data-canvas-action="zoom-in">+</button>
                <button type="button" class="canvas-control-btn" data-canvas-action="zoom-out">-</button>
                <button type="button" class="canvas-control-btn canvas-control-fit" data-canvas-action="fit">Fit</button>
              </div>
              <svg id="editor-canvas" class="editor-canvas" xmlns="${SVG_NAMESPACE}"></svg>
              <div class="canvas-empty" id="canvas-empty"></div>
            </div>
            <footer class="statusbar" id="statusbar"></footer>
          </section>
          <aside class="sidebar" id="sidebar"></aside>
        </div>
        <input id="project-input" type="file" accept=".chemjson,application/json" hidden />
        <input id="mol-input" type="file" accept=".mol,.sdf,.txt,text/plain" hidden />
        <div class="atom-menu" id="atom-menu" hidden></div>
      </div>
    `;

    this.topbarEl = this.root.querySelector<HTMLElement>("#topbar")!;
    this.toolrailEl = this.root.querySelector<HTMLElement>("#toolrail")!;
    this.sidebarEl = this.root.querySelector<HTMLElement>("#sidebar")!;
    this.statusEl = this.root.querySelector<HTMLElement>("#statusbar")!;
    this.svgEl = this.root.querySelector<SVGSVGElement>("#editor-canvas")!;
    this.canvasControlsEl = this.root.querySelector<HTMLElement>("#canvas-controls")!;
    this.emptyEl = this.root.querySelector<HTMLElement>("#canvas-empty")!;
    this.projectInputEl = this.root.querySelector<HTMLInputElement>("#project-input")!;
    this.molInputEl = this.root.querySelector<HTMLInputElement>("#mol-input")!;
    this.atomMenuEl = this.root.querySelector<HTMLElement>("#atom-menu")!;
  }

  private bindEvents(): void {
    this.topbarEl.addEventListener("click", (event) => {
      const button = this.getClosestButton(event.target);
      if (!button || button.disabled) {
        return;
      }
      const action = button.dataset.action;
      if (!action) {
        return;
      }
      void this.handleTopbarAction(action);
    });

    this.toolrailEl.addEventListener("click", (event) => {
      const button = this.getClosestButton(event.target);
      if (!button || button.disabled) {
        return;
      }
      this.handleToolSelection(button);
    });

    this.sidebarEl.addEventListener("click", (event) => {
      const button = this.getClosestButton(event.target);
      if (!button || button.disabled) {
        return;
      }
      if (button.dataset.themeMode === "conventional") {
        this.applyColourChoice({ mode: "conventional" }, "Conventional element colours restored.");
        return;
      }
      const presetId = button.dataset.themePreset;
      if (presetId === "red" || presetId === "green" || presetId === "blue") {
        this.applyColourChoice({ mode: "presetMono", presetId }, `Applied ${button.textContent?.trim()}.`);
        return;
      }
      const element = button.dataset.chartElement;
      if (element) {
        this.tool = { kind: "atom", element };
        this.pendingBondStartId = null;
        this.statusMessage = `Atom tool armed for ${element}.`;
        this.renderChrome();
        this.renderCanvas();
      }
    });

    this.sidebarEl.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.dataset.themeCustom !== "true") {
        return;
      }
      this.applyColourChoice(
        { mode: "customMono", monoColor: target.value },
        `Applied custom monochrome theme ${target.value.toUpperCase()}.`,
      );
    });

    this.canvasControlsEl.addEventListener("click", (event) => {
      const button = this.getClosestButton(event.target);
      if (!button || button.disabled) {
        return;
      }
      const action = button.dataset.canvasAction;
      if (!action) {
        return;
      }
      this.handleCanvasControlAction(action);
    });

    this.projectInputEl.addEventListener("change", () => {
      void this.openProjectFile();
    });

    this.molInputEl.addEventListener("change", () => {
      void this.importMolFileFromDisk();
    });

    this.atomMenuEl.addEventListener("click", (event) => {
      const button = this.getClosestButton(event.target);
      if (!button || !this.atomMenuState) {
        return;
      }
      const nextState = button.dataset.atomState as AtomStateMode | undefined;
      if (!nextState) {
        return;
      }
      const atomId = this.atomMenuState.atomId;
      this.closeAtomMenu();
      const applied = this.mutateDocumentWithHistory(
        (document) => {
          setAtomState(document, atomId, nextState);
        },
        this.getAtomStateStatus(nextState),
      );
      if (!applied) {
        this.renderCanvas();
      }
    });

    this.atomMenuEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });

    this.svgEl.addEventListener("pointerdown", (event) => {
      this.handlePointerDown(event);
    });

    this.svgEl.addEventListener("pointermove", (event) => {
      this.updateHoverFromPointer(event);
    });

    this.svgEl.addEventListener("contextmenu", (event) => {
      this.handleCanvasContextMenu(event);
    });

    window.addEventListener("pointermove", (event) => {
      this.handlePointerMove(event);
    });

    window.addEventListener("pointerup", (event) => {
      this.handlePointerUp(event);
    });

    window.addEventListener("pointercancel", (event) => {
      this.handlePointerUp(event);
    });

    this.svgEl.addEventListener("pointerleave", () => {
      this.hoverWorld = null;
      this.hoverAtomId = null;
      this.hoverBondId = null;
      this.hoverBracketId = null;
      this.renderCanvas();
    });

    window.addEventListener(
      "pointerdown",
      (event) => {
        if (!this.atomMenuState) {
          return;
        }
        const target = event.target;
        if (target instanceof Node && this.atomMenuEl.contains(target)) {
          return;
        }
        this.closeAtomMenu();
      },
      true,
    );

    this.svgEl.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.zoomAt(factor, event.clientX, event.clientY);
      },
      { passive: false },
    );

    window.addEventListener("keydown", (event) => {
      void this.handleKeydown(event);
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.renderCanvas();
    });
    this.resizeObserver.observe(this.root);
  }

  private renderChrome(): void {
    this.renderTopbar();
    this.renderToolrail();
    this.renderSidebar();
    this.renderStatus();
  }

  private renderTopbar(): void {
    const hasAtoms = this.document.atoms.length > 0;
    const docName = this.escapeHtml(this.document.metadata.name);
    const themeLabel = this.getThemeLabel();

    this.topbarEl.innerHTML = `
      <div class="brand-block">
        <div class="brand-kicker">Standalone HTML Editor</div>
        <div class="brand-title">Bondforge</div>
        <div class="brand-meta">${docName} · ${themeLabel}</div>
      </div>
      <div class="toolbar-clusters">
        <div class="toolbar-cluster">
          ${this.renderActionButton("new", "New")}
          ${this.renderActionButton("demo", "Demo")}
          ${this.renderActionButton("open", "Open")}
          ${this.renderActionButton("save", "Save")}
        </div>
        <div class="toolbar-cluster">
          ${this.renderActionButton("import-smiles", "Import SMILES")}
          ${this.renderActionButton("import-mol", "Import MOL")}
          ${this.renderActionButton("export-smiles", "Export SMILES", !hasAtoms)}
          ${this.renderActionButton("export-mol", "Export MOL", !hasAtoms)}
          ${this.renderActionButton("export-svg", "SVG", !hasAtoms)}
          ${this.renderActionButton("export-png", "PNG", !hasAtoms)}
        </div>
        <div class="toolbar-cluster">
          ${this.renderActionButton("undo", "Undo", this.history.length === 0)}
          ${this.renderActionButton("redo", "Redo", this.future.length === 0)}
          ${this.renderActionButton("tidy", "Tidy", !hasAtoms)}
          ${this.renderActionButton("fit", "Fit", !hasAtoms)}
        </div>
      </div>
    `;
  }

  private renderToolrail(): void {
    const isTool = (kind: ToolState["kind"], token?: string): boolean => {
      if (kind === "bond") {
        return this.tool.kind === "bond" && this.tool.preset === token;
      }
      if (kind === "atom") {
        return this.tool.kind === "atom" && this.tool.element === token;
      }
      if (kind === "bracket") {
        return this.tool.kind === "bracket" && this.tool.shape === token;
      }
      if (kind === "ring") {
        return this.tool.kind === "ring" && this.tool.templateId === token;
      }
      return this.tool.kind === kind;
    };

    this.toolrailEl.innerHTML = `
      <div class="tool-group">
        <div class="tool-label">Navigate</div>
        ${this.renderToolButton("select", "Select", isTool("select"))}
        ${this.renderToolButton("pan", "Pan", isTool("pan"))}
        ${this.renderToolButton("erase", "Erase", isTool("erase"))}
      </div>
      <div class="tool-group">
        <div class="tool-label">Bonds</div>
        ${this.renderToolButton("bond", "Single", isTool("bond", "single"), { preset: "single" })}
        ${this.renderToolButton("bond", "Double", isTool("bond", "double"), { preset: "double" })}
        ${this.renderToolButton("bond", "Triple", isTool("bond", "triple"), { preset: "triple" })}
        ${this.renderToolButton("bond", "Wedge", isTool("bond", "wedge"), { preset: "wedge" })}
        ${this.renderToolButton("bond", "Hash", isTool("bond", "hash"), { preset: "hash" })}
      </div>
      <div class="tool-group">
        <div class="tool-label">Brackets</div>
        ${this.renderToolButton("bracket", "Round", isTool("bracket", "round"), { shape: "round" })}
        ${this.renderToolButton("bracket", "Square", isTool("bracket", "square"), { shape: "square" })}
      </div>
      <div class="tool-group">
        <div class="tool-label">Atoms</div>
        ${QUICK_ELEMENTS.map((element) =>
          this.renderToolButton("atom", element, isTool("atom", element), { element }),
        ).join("")}
      </div>
      <div class="tool-group">
        <div class="tool-label">Rings</div>
        ${RING_TEMPLATES.map((template) =>
          this.renderToolButton("ring", template.label, isTool("ring", template.id), {
            templateId: template.id,
          }),
        ).join("")}
      </div>
    `;
  }

  private renderSidebar(): void {
    const themePreview = this.renderThemePreview();
    const currentColor = getMonochromeColour(this.document.themeState) ?? "#D7263D";
    const selectionSummary =
      this.selection.atomIds.size || this.selection.bondIds.size
        ? `${this.selection.atomIds.size} atom(s) · ${this.selection.bondIds.size} bond(s) selected`
        : "No active selection";

    this.sidebarEl.innerHTML = `
      <section class="side-section">
        <div class="side-title">Session</div>
        <div class="session-card">
          <div class="session-name">${this.escapeHtml(this.document.metadata.name)}</div>
          <div class="session-row"><span>Tool</span><strong>${this.escapeHtml(this.getToolLabel())}</strong></div>
          <div class="session-row"><span>Theme</span><strong>${this.escapeHtml(this.getThemeLabel())}</strong></div>
          <div class="session-row"><span>Selection</span><strong>${this.escapeHtml(selectionSummary)}</strong></div>
        </div>
      </section>
      <section class="side-section">
        <div class="side-title">Theme Controls</div>
        <div class="theme-panel">
          <div class="theme-help">Colours apply to the current selection. With nothing selected, they apply to the full drawing.</div>
          ${this.renderSidebarButton("Conventional", {
            themeMode: "conventional",
            active: this.document.themeState.mode === "conventional",
          })}
          <div class="swatch-grid">
            ${THEME_PRESETS.map((preset) =>
              this.renderThemeSwatch(
                preset.label,
                preset.color,
                this.document.themeState.mode === "presetMono" &&
                  this.document.themeState.presetId === preset.id,
                preset.id,
              ),
            ).join("")}
          </div>
          <label class="colour-input">
            <span>Custom Monochrome</span>
            <input data-theme-custom="true" type="color" value="${currentColor}" />
          </label>
          <div class="theme-preview">${themePreview}</div>
        </div>
      </section>
      <section class="side-section">
        <div class="side-title">Conventional Colours</div>
        <div class="colour-chart">
          ${QUICK_ELEMENTS.map((element) => {
            const atom = { id: "", element, x: 0, y: 0, labelMode: element === "C" ? "auto" : "always" } as Atom;
            const color = getAtomColour(atom, { mode: "conventional" });
            return `
              <button type="button" class="chart-row ${this.tool.kind === "atom" && this.tool.element === element ? "is-active" : ""}" data-chart-element="${element}">
                <span class="chart-chip" style="--chip:${color}"></span>
                <span class="chart-symbol">${element}</span>
                <span class="chart-hex">${color.toUpperCase()}</span>
              </button>
            `;
          }).join("")}
          <div class="chart-row chart-row-static">
            <span class="chart-chip" style="--chip:#555555"></span>
            <span class="chart-symbol">Other</span>
            <span class="chart-hex">#555555</span>
          </div>
        </div>
      </section>
      <section class="side-section">
        <div class="side-title">Shortcuts</div>
        <div class="shortcut-list">
          <div><kbd>V</kbd> Select</div>
          <div><kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> Bond orders</div>
          <div><kbd>W</kbd>/<kbd>Q</kbd> Wedge / hash</div>
          <div><kbd>B</kbd> Benzene ring</div>
          <div><kbd>C</kbd>/<kbd>N</kbd>/<kbd>O</kbd> Atom tools</div>
          <div><kbd>Right-click</kbd> Atom charge / radical</div>
          <div><kbd>T</kbd> Tidy</div>
          <div><kbd>Ctrl/Cmd</kbd> + <kbd>Z</kbd> Undo</div>
          <div><kbd>Delete</kbd> Remove selection</div>
        </div>
      </section>
    `;
  }

  private renderStatus(): void {
    this.statusEl.innerHTML = `
      <div class="status-primary">${this.escapeHtml(this.statusMessage)}</div>
      <div class="status-secondary">${this.escapeHtml(
        this.pendingBondStartId
          ? "Bond chain mode active. Click an atom or empty space to continue."
          : this.tool.kind === "bracket"
            ? "Drag on the canvas to place a paired bracket. Right-click atoms to set charge or radical."
          : "Wheel or pinch to zoom. Two-finger drag pans. Shift-click toggles selection.",
      )}</div>
    `;
  }

  private renderCanvas(): void {
    const { width, height } = this.getCanvasSize();
    const viewBox = this.getViewBox(width, height);

    this.svgEl.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    this.svgEl.innerHTML = this.buildSceneMarkup(viewBox, false);
    this.emptyEl.classList.toggle("is-visible", this.document.atoms.length === 0);
    this.emptyEl.innerHTML =
      this.document.atoms.length === 0
        ? `
          <div class="empty-card">
            <div class="empty-title">Blank canvas</div>
            <div class="empty-copy">Choose a bond, atom, or ring tool and start drawing. The theme panel on the right can switch the whole drawing to red, green, blue, or any custom colour.</div>
          </div>
        `
        : "";
    this.renderAtomMenu();
  }

  private buildSceneMarkup(viewBox: ViewBox, exportMode: boolean): string {
    const background = exportMode
      ? `<rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="#FFFFFF" />`
      : `
          <defs>
            <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(31,40,61,0.08)" stroke-width="1" />
            </pattern>
          </defs>
          <rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="url(#grid)" />
        `;

    const bondMarkup = this.document.bonds.map((bond) => this.renderBond(bond, exportMode)).join("");
    const aromaticMarkup = this.renderAromaticRingLayer();
    const bracketMarkup = this.document.brackets
      .map((bracket) => this.renderBracket(bracket, exportMode))
      .join("");
    const atomMarkup = this.document.atoms.map((atom) => this.renderAtom(atom, exportMode)).join("");
    const selectionMarkup = exportMode ? "" : this.renderSelectionLayer();
    const ghostMarkup = exportMode ? "" : this.renderGhostLayer();
    const hitMarkup = exportMode ? "" : this.renderHitLayer();
    const boxMarkup =
      !exportMode && this.interaction?.kind === "box"
        ? this.renderSelectionBox(this.interaction.startWorld, this.interaction.currentWorld)
        : "";

    return `
      ${background}
      <g class="bond-layer">${bondMarkup}</g>
      <g class="aromatic-layer">${aromaticMarkup}</g>
      <g class="bracket-layer">${bracketMarkup}</g>
      <g class="atom-layer">${atomMarkup}</g>
      <g class="selection-layer">${selectionMarkup}</g>
      <g class="ghost-layer">${ghostMarkup}</g>
      <g class="selection-box-layer">${boxMarkup}</g>
      <g class="hit-layer">${hitMarkup}</g>
    `;
  }

  private renderBond(bond: Bond, exportMode: boolean): string {
    const a1 = getAtomById(this.document, bond.a1);
    const a2 = getAtomById(this.document, bond.a2);
    if (!a1 || !a2) {
      return "";
    }
    const trimmed = this.getTrimmedBondLine(a1, a2);
    const bondColor = getBondColour(this.document.themeState, bond);
    const selectionLine =
      !exportMode && this.selection.bondIds.has(bond.id)
        ? `<line x1="${trimmed.start.x}" y1="${trimmed.start.y}" x2="${trimmed.end.x}" y2="${trimmed.end.y}" stroke="${SELECTION_COLOUR}" stroke-width="14" stroke-linecap="round" opacity="0.22" />`
        : "";
    const hoverLine =
      !exportMode && this.hoverBondId === bond.id && !this.selection.bondIds.has(bond.id)
        ? `<line x1="${trimmed.start.x}" y1="${trimmed.start.y}" x2="${trimmed.end.x}" y2="${trimmed.end.y}" stroke="${GUIDE_COLOUR}" stroke-width="10" stroke-linecap="round" opacity="0.14" />`
        : "";

    let geometry = "";
    if (bond.stereo === "wedge") {
      const narrow = 2.5;
      const wide = 9;
      geometry = `<polygon points="${[
        `${trimmed.start.x + trimmed.normal.x * narrow},${trimmed.start.y + trimmed.normal.y * narrow}`,
        `${trimmed.start.x - trimmed.normal.x * narrow},${trimmed.start.y - trimmed.normal.y * narrow}`,
        `${trimmed.end.x - trimmed.normal.x * wide},${trimmed.end.y - trimmed.normal.y * wide}`,
        `${trimmed.end.x + trimmed.normal.x * wide},${trimmed.end.y + trimmed.normal.y * wide}`,
      ].join(" ")}" fill="${bondColor}" />`;
    } else if (bond.stereo === "hash") {
      const lines: string[] = [];
      const segments = 6;
      for (let index = 0; index < segments; index += 1) {
        const t = (index + 1) / (segments + 1);
        const center = {
          x: trimmed.start.x + (trimmed.end.x - trimmed.start.x) * t,
          y: trimmed.start.y + (trimmed.end.y - trimmed.start.y) * t,
        };
        const width = 2 + t * 7;
        lines.push(
          `<line x1="${center.x - trimmed.normal.x * width}" y1="${center.y - trimmed.normal.y * width}" x2="${center.x + trimmed.normal.x * width}" y2="${center.y + trimmed.normal.y * width}" stroke="${bondColor}" stroke-width="1.8" stroke-linecap="round" />`,
        );
      }
      geometry = lines.join("");
    } else {
      geometry = this.renderBondOrderLines(trimmed.start, trimmed.end, trimmed.normal, bond.order, bondColor);
    }

    return `${selectionLine}${hoverLine}${geometry}`;
  }

  private renderBondOrderLines(
    start: Point,
    end: Point,
    normal: Point,
    order: Bond["order"],
    color: string,
  ): string {
    const line = (offset: number, dashArray?: string) => `
      <line
        x1="${start.x + normal.x * offset}"
        y1="${start.y + normal.y * offset}"
        x2="${end.x + normal.x * offset}"
        y2="${end.y + normal.y * offset}"
        stroke="${color}"
        stroke-width="3.6"
        stroke-linecap="round"
        ${dashArray ? `stroke-dasharray="${dashArray}"` : ""}
      />
    `;

    switch (order) {
      case "double":
        return `${line(-4.4)}${line(4.4)}`;
      case "triple":
        return `${line(-6.2)}${line(0)}${line(6.2)}`;
      case "aromatic":
        return `${line(0)}`;
      default:
        return `${line(0)}`;
    }
  }

  private renderAromaticRingLayer(): string {
    return getAromaticRingCycles(this.document)
      .map((atomIds) => {
        const points = atomIds
          .map((atomId) => getAtomById(this.document, atomId))
          .filter((value): value is Atom => Boolean(value));
        const ringBonds = atomIds
          .map((atomId, index) =>
            this.findBondBetweenAtoms(atomId, atomIds[(index + 1) % atomIds.length]),
          )
          .filter((value): value is Bond => Boolean(value));

        if (points.length !== atomIds.length || points.length < 5) {
          return "";
        }

        const bondColor = getBondColour(this.document.themeState, ringBonds[0]);
        const center = {
          x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
          y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
        };
        const edgeInset = points.map((point, index) =>
          lineDistanceToPoint(point, points[(index + 1) % points.length], center),
        );
        const radius = Math.max(14, Math.min(...edgeInset) - 10);

        return `
          <circle
            cx="${center.x}"
            cy="${center.y}"
            r="${radius}"
            fill="none"
            stroke="${bondColor}"
            stroke-width="3.2"
            opacity="0.9"
          />
        `;
      })
      .join("");
  }

  private renderBracket(bracket: BracketAnnotation, exportMode: boolean): string {
    const bondColor = getBondColour(this.document.themeState);
    const hoverMarkup =
      !exportMode && this.hoverBracketId === bracket.id
        ? this.renderBracketGeometry(bracket, GUIDE_COLOUR, 10, 0.14, false)
        : "";
    const bracketMarkup = this.renderBracketGeometry(bracket, bondColor, 3.8, 1, true);
    return `${hoverMarkup}${bracketMarkup}`;
  }

  private renderBracketGeometry(
    bracket: BracketAnnotation,
    color: string,
    strokeWidth: number,
    opacity: number,
    includeRepeatLabel: boolean,
  ): string {
    const paths = this.getBracketPaths(bracket);
    const pathMarkup = paths
      .map(
        (path) => `
          <path
            d="${path}"
            fill="none"
            stroke="${color}"
            stroke-width="${strokeWidth}"
            stroke-linecap="round"
            stroke-linejoin="round"
            opacity="${opacity}"
          />
        `,
      )
      .join("");

    const repeatLabel =
      includeRepeatLabel && bracket.shape === "square"
        ? `
            <text
              x="${bracket.x + bracket.width + 14}"
              y="${bracket.y + bracket.height + 17}"
              class="bracket-repeat"
              fill="${color}"
              stroke="rgba(255,255,255,0.94)"
              stroke-width="6"
              paint-order="stroke"
            >n</text>
          `
        : "";

    return `${pathMarkup}${repeatLabel}`;
  }

  private getBracketPaths(bracket: BracketAnnotation): string[] {
    const inset = Math.max(10, Math.min(18, bracket.width * 0.14));
    if (bracket.shape === "round") {
      return [
        `M ${bracket.x + inset} ${bracket.y} Q ${bracket.x} ${bracket.y + bracket.height / 2} ${bracket.x + inset} ${bracket.y + bracket.height}`,
        `M ${bracket.x + bracket.width - inset} ${bracket.y} Q ${bracket.x + bracket.width} ${bracket.y + bracket.height / 2} ${bracket.x + bracket.width - inset} ${bracket.y + bracket.height}`,
      ];
    }

    return [
      `M ${bracket.x + inset} ${bracket.y} H ${bracket.x} V ${bracket.y + bracket.height} H ${bracket.x + inset}`,
      `M ${bracket.x + bracket.width - inset} ${bracket.y} H ${bracket.x + bracket.width} V ${bracket.y + bracket.height} H ${bracket.x + bracket.width - inset}`,
    ];
  }

  private renderAtom(atom: Atom, exportMode: boolean): string {
    const visible = shouldShowAtomLabel(this.document, atom);
    const haloColor = "rgba(255,255,255,0.96)";
    const selection =
      !exportMode && this.selection.atomIds.has(atom.id)
        ? `<circle cx="${atom.x}" cy="${atom.y}" r="18" fill="none" stroke="${SELECTION_COLOUR}" stroke-width="3" />`
        : "";
    const pending =
      !exportMode && this.pendingBondStartId === atom.id
        ? `<circle cx="${atom.x}" cy="${atom.y}" r="22" fill="none" stroke="${GUIDE_COLOUR}" stroke-width="2.6" stroke-dasharray="7 6" />`
        : "";
    const pendingCore =
      !exportMode && this.pendingBondStartId === atom.id && !visible
        ? `<circle cx="${atom.x}" cy="${atom.y}" r="5.5" fill="${GUIDE_COLOUR}" opacity="0.9" />`
        : "";

    if (!visible) {
      return `${selection}${pending}${pendingCore}`;
    }

    const segments = this.layoutAtomLabelSegments(atom);
    const radicalMarkup = atom.radical
      ? this.renderRadicalDecoration(atom, segments, haloColor)
      : "";
    return `
      ${selection}
      ${pending}
      <g class="atom-label-group">
        ${segments
          .map(
            (segment) => `
              <text
                x="${segment.x}"
                y="${atom.y + 8}"
                text-anchor="start"
                class="atom-text"
                font-size="26px"
                font-weight="650"
                font-family="Avenir Next, Segoe UI, Helvetica Neue, sans-serif"
                letter-spacing="-0.02em"
                fill="${segment.color}"
                stroke="${haloColor}"
                stroke-width="9"
                paint-order="stroke"
              >${this.escapeHtml(segment.text)}</text>
            `,
          )
          .join("")}
        ${radicalMarkup}
      </g>
    `;
  }

  private renderRadicalDecoration(
    atom: Atom,
    segments: Array<{ x: number; width: number; text: string; color: string }>,
    haloColor: string,
  ): string {
    if (segments.length === 0) {
      return "";
    }
    const last = segments[segments.length - 1];
    const radicalX = last.x + last.width + 9;
    const radicalY = atom.y - 15;
    const color = getAtomColour(atom, this.document.themeState);
    return `
      <circle
        cx="${radicalX}"
        cy="${radicalY}"
        r="4.8"
        fill="${color}"
        stroke="${haloColor}"
        stroke-width="5"
        paint-order="stroke"
      />
    `;
  }

  private renderSelectionLayer(): string {
    const bondHighlights = Array.from(this.selection.atomIds)
      .flatMap((atomId) => getConnectedBondIds(this.document, atomId))
      .filter((bondId, index, list) => list.indexOf(bondId) === index)
      .map((bondId) => {
        if (this.selection.bondIds.has(bondId)) {
          return "";
        }
        const bond = getBondById(this.document, bondId);
        if (!bond) {
          return "";
        }
        const a1 = getAtomById(this.document, bond.a1);
        const a2 = getAtomById(this.document, bond.a2);
        if (!a1 || !a2) {
          return "";
        }
        const trimmed = this.getTrimmedBondLine(a1, a2);
        return `<line x1="${trimmed.start.x}" y1="${trimmed.start.y}" x2="${trimmed.end.x}" y2="${trimmed.end.y}" stroke="${SELECTION_COLOUR}" stroke-width="10" stroke-linecap="round" opacity="0.12" />`;
      })
      .join("");

    return bondHighlights;
  }

  private renderGhostLayer(): string {
    if (this.interaction?.kind === "bracket") {
      const rect = normalizeRect(this.interaction.startWorld, this.interaction.currentWorld);
      if (rect.width < 2 && rect.height < 2) {
        return "";
      }
      return `
        <rect
          x="${rect.x}"
          y="${rect.y}"
          width="${rect.width}"
          height="${rect.height}"
          fill="rgba(14,165,233,0.08)"
          stroke="rgba(14,165,233,0.18)"
          stroke-width="1"
        />
        ${this.renderBracketGeometry(
          {
            id: "preview",
            shape: this.interaction.shape,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          GUIDE_COLOUR,
          3,
          0.88,
          true,
        )}
      `;
    }

    if (this.tool.kind !== "bond" || !this.pendingBondStartId || !this.hoverWorld) {
      return "";
    }
    const start = getAtomById(this.document, this.pendingBondStartId);
    if (!start) {
      return "";
    }
    const end =
      this.hoverAtomId && this.hoverAtomId !== start.id
        ? getAtomById(this.document, this.hoverAtomId)
        : null;
    const target = end ? { x: end.x, y: end.y } : snapBondTarget(start, this.hoverWorld);
    return `
      <line
        x1="${start.x}"
        y1="${start.y}"
        x2="${target.x}"
        y2="${target.y}"
        stroke="${GUIDE_COLOUR}"
        stroke-width="3"
        stroke-linecap="round"
        stroke-dasharray="9 7"
      />
      <circle cx="${target.x}" cy="${target.y}" r="5" fill="${GUIDE_COLOUR}" />
    `;
  }

  private renderSelectionBox(start: Point, current: Point): string {
    const rect = normalizeRect(start, current);
    return `
      <rect
        x="${rect.x}"
        y="${rect.y}"
        width="${rect.width}"
        height="${rect.height}"
        fill="rgba(14,165,233,0.10)"
        stroke="${GUIDE_COLOUR}"
        stroke-width="2"
        stroke-dasharray="10 8"
      />
    `;
  }

  private renderHitLayer(): string {
    const bondHits = this.document.bonds
      .map((bond) => {
        const a1 = getAtomById(this.document, bond.a1);
        const a2 = getAtomById(this.document, bond.a2);
        if (!a1 || !a2) {
          return "";
        }
        const trimmed = this.getTrimmedBondLine(a1, a2);
        return `
          <line
            x1="${trimmed.start.x}"
            y1="${trimmed.start.y}"
            x2="${trimmed.end.x}"
            y2="${trimmed.end.y}"
            stroke="transparent"
            stroke-width="${BOND_HIT_WIDTH}"
            data-bond-id="${bond.id}"
            stroke-linecap="round"
          />
        `;
      })
      .join("");

    const bracketHits = this.document.brackets
      .map((bracket) =>
        this.getBracketPaths(bracket)
          .map(
            (path) => `
              <path
                d="${path}"
                fill="none"
                stroke="transparent"
                stroke-width="18"
                stroke-linecap="round"
                stroke-linejoin="round"
                data-bracket-id="${bracket.id}"
              />
            `,
          )
          .join(""),
      )
      .join("");

    const atomHits = this.document.atoms
      .map(
        (atom) => `
          <circle
            cx="${atom.x}"
            cy="${atom.y}"
            r="${ATOM_HIT_RADIUS}"
            fill="transparent"
            data-atom-id="${atom.id}"
          />
        `,
      )
      .join("");

    return bondHits + bracketHits + atomHits;
  }

  private getTrimmedBondLine(a1: Atom, a2: Atom): {
    start: Point;
    end: Point;
    normal: Point;
  } {
    const dx = a2.x - a1.x;
    const dy = a2.y - a1.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const trim1 = this.getAtomLabelRadius(a1);
    const trim2 = this.getAtomLabelRadius(a2);
    return {
      start: { x: a1.x + ux * trim1, y: a1.y + uy * trim1 },
      end: { x: a2.x - ux * trim2, y: a2.y - uy * trim2 },
      normal: { x: -uy, y: ux },
    };
  }

  private getAtomLabelRadius(atom: Atom): number {
    if (!shouldShowAtomLabel(this.document, atom)) {
      return 0;
    }
    const segments = this.layoutAtomLabelSegments(atom);
    if (segments.length === 0) {
      return 0;
    }
    const first = segments[0];
    const last = segments[segments.length - 1];
    const radicalOffset = atom.radical ? 8 : 0;
    return Math.max(8, Math.min(28, (last.x + last.width - first.x) / 2 + 5 + radicalOffset));
  }

  private layoutAtomLabelSegments(
    atom: Atom,
  ): Array<{ x: number; width: number; text: string; color: string }> {
    const segments = getAtomLabelSegments(this.document, atom);
    if (segments.length === 0) {
      return [];
    }
    const widths = segments.map((segment) => this.measureTextWidth(segment.text));
    const gap = segments.length > 1 ? 2 : 0;
    const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gap * (segments.length - 1);
    let cursor = atom.x - totalWidth / 2;

    return segments.map((segment, index) => {
      const width = widths[index];
      const x = cursor;
      cursor += width + gap;
      return {
        x,
        width,
        text: segment.text,
        color: getAtomColour(
          { ...atom, element: segment.element, explicitHydrogens: undefined },
          this.document.themeState,
        ),
      };
    });
  }

  private measureTextWidth(text: string): number {
    if (!this.textMeasureContext) {
      const canvas = document.createElement("canvas");
      this.textMeasureContext = canvas.getContext("2d");
    }
    const context = this.textMeasureContext;
    if (!context) {
      return text.length * 16;
    }
    context.font = '650 26px "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif';
    return Math.ceil(context.measureText(text).width);
  }

  private renderThemePreview(): string {
    const theme = this.document.themeState;
    const mono = getMonochromeColour(theme);
    const bondColor = getBondColour(theme);
    const oxygenColor = mono ?? getAtomColour({ id: "", element: "O", x: 0, y: 0, labelMode: "always" }, theme);
    const nitrogenColor = mono ?? getAtomColour({ id: "", element: "N", x: 0, y: 0, labelMode: "always" }, theme);
    const chlorineColor = mono ?? getAtomColour({ id: "", element: "Cl", x: 0, y: 0, labelMode: "always" }, theme);

    return `
      <svg viewBox="0 0 240 94" role="img" aria-label="Theme preview">
        <rect x="4" y="4" width="232" height="86" rx="16" fill="#F7F9FC" />
        <line x1="54" y1="48" x2="104" y2="48" stroke="${bondColor}" stroke-width="4.4" stroke-linecap="round" />
        <line x1="104" y1="48" x2="154" y2="48" stroke="${bondColor}" stroke-width="4.4" stroke-linecap="round" stroke-dasharray="${theme.mode === "conventional" ? "none" : "10 6"}" />
        <text x="42" y="56" font-size="24" text-anchor="middle" fill="${oxygenColor}">O</text>
        <text x="116" y="56" font-size="24" text-anchor="middle" fill="${nitrogenColor}">N</text>
        <text x="170" y="56" font-size="24" text-anchor="middle" fill="${chlorineColor}">Cl</text>
      </svg>
    `;
  }

  private renderActionButton(action: string, label: string, disabled = false): string {
    return `<button type="button" class="toolbar-btn" data-action="${action}" ${disabled ? "disabled" : ""}>${label}</button>`;
  }

  private renderToolButton(
    tool: string,
    label: string,
    active: boolean,
    data: Record<string, string> = {},
  ): string {
    const attributes = Object.entries(data)
      .map(([key, value]) => {
        const attribute = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
        return `data-${attribute}="${value}"`;
      })
      .join(" ");
    return `
      <button type="button" class="tool-btn ${active ? "is-active" : ""}" data-tool="${tool}" ${attributes}>
        ${label}
      </button>
    `;
  }

  private renderSidebarButton(
    label: string,
    options: { themeMode: string; active: boolean },
  ): string {
    return `
      <button type="button" class="theme-btn ${options.active ? "is-active" : ""}" data-theme-mode="${options.themeMode}">
        ${label}
      </button>
    `;
  }

  private renderThemeSwatch(
    label: string,
    color: string,
    active: boolean,
    presetId: string,
  ): string {
    return `
      <button type="button" class="theme-swatch ${active ? "is-active" : ""}" data-theme-preset="${presetId}">
        <span class="theme-swatch-chip" style="--swatch:${color}"></span>
        <span>${label}</span>
      </button>
    `;
  }

  private getToolLabel(): string {
    switch (this.tool.kind) {
      case "bond":
        return `Bond: ${this.tool.preset}`;
      case "atom":
        return `Atom: ${this.tool.element}`;
      case "bracket":
        return `Bracket: ${this.tool.shape}`;
      case "ring":
        return `Ring: ${this.tool.templateId}`;
      case "pan":
        return "Pan";
      case "erase":
        return "Erase";
      default:
        return "Select";
    }
  }

  private getThemeLabel(): string {
    if (this.document.themeState.mode === "presetMono") {
      return THEME_PRESETS.find((preset) => preset.id === this.document.themeState.presetId)?.label ?? "Preset";
    }
    if (this.document.themeState.mode === "customMono") {
      return `Custom ${this.document.themeState.monoColor?.toUpperCase() ?? ""}`.trim();
    }
    return "Conventional";
  }

  private getViewBox(widthPx: number, heightPx: number): ViewBox {
    const width = widthPx / this.document.viewport.zoom;
    const height = heightPx / this.document.viewport.zoom;
    return {
      x: this.document.viewport.x,
      y: this.document.viewport.y,
      width,
      height,
    };
  }

  private updateHoverFromPointer(event: PointerEvent): void {
    this.hoverWorld = this.clientToWorld(event.clientX, event.clientY);
    const { atomId, bondId, bracketId } = this.getTargetIds(event.target);
    this.hoverAtomId = atomId ?? null;
    this.hoverBondId = bondId ?? null;
    this.hoverBracketId = bracketId ?? null;
    if (!this.interaction) {
      this.renderCanvas();
    }
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.pointerType !== "touch" && event.button !== 0) {
      return;
    }
    if (event.pointerType === "touch") {
      event.preventDefault();
    }
    const world = this.clientToWorld(event.clientX, event.clientY);
    if (event.pointerType === "touch") {
      this.activeTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.activeTouchPoints.size === 2) {
        const gesture = this.createTouchGesture();
        if (gesture) {
          this.interaction = gesture;
          this.statusMessage = "Pinch to zoom and drag with two fingers to pan.";
          this.renderStatus();
          return;
        }
      }
    }

    const { atomId, bondId, bracketId } = this.getTargetIds(event.target);
    this.hoverWorld = world;
    this.hoverAtomId = atomId ?? null;
    this.hoverBondId = bondId ?? null;
    this.hoverBracketId = bracketId ?? null;

    switch (this.tool.kind) {
      case "select":
        this.handleSelectPointerDown(event, world, atomId, bondId);
        break;
      case "pan":
        this.interaction = {
          kind: "pan",
          pointerId: event.pointerId,
          startClient: { x: event.clientX, y: event.clientY },
          originalViewport: { ...this.document.viewport },
        };
        break;
      case "erase":
        this.handleErase(atomId, bondId, bracketId);
        break;
      case "atom":
        this.handleAtomPlacement(atomId, world);
        break;
      case "bond":
        this.handleBondPlacement(atomId, bondId, world);
        break;
      case "bracket":
        this.interaction = {
          kind: "bracket",
          pointerId: event.pointerId,
          startWorld: world,
          currentWorld: world,
          shape: this.tool.shape,
        };
        this.renderCanvas();
        break;
      case "ring":
        this.handleRingPlacement(atomId, bondId, world);
        break;
      default:
        break;
    }
  }

  private handleSelectPointerDown(
    event: PointerEvent,
    world: Point,
    atomId?: string,
    bondId?: string,
  ): void {
    const additive = event.shiftKey;
    if (additive && atomId) {
      this.toggleAtomSelection(atomId);
      this.renderChrome();
      this.renderCanvas();
      return;
    }
    if (additive && bondId) {
      this.toggleBondSelection(bondId);
      this.renderChrome();
      this.renderCanvas();
      return;
    }

    if (atomId) {
      if (!this.selection.atomIds.has(atomId)) {
        this.selectOnly({ atomIds: [atomId], bondIds: [] });
      }
      const moving = this.selection.atomIds.size
        ? Array.from(this.selection.atomIds)
        : [atomId];
      this.interaction = {
        kind: "move",
        pointerId: event.pointerId,
        startWorld: world,
        originalDoc: cloneDocument(this.document),
        movingAtomIds: moving,
      };
      this.renderChrome();
      this.renderCanvas();
      return;
    }

    if (bondId) {
      if (!this.selection.bondIds.has(bondId)) {
        this.selectOnly({ atomIds: [], bondIds: [bondId] });
      }
      const bond = getBondById(this.document, bondId);
      const moving = bond ? [bond.a1, bond.a2] : [];
      this.interaction = {
        kind: "move",
        pointerId: event.pointerId,
        startWorld: world,
        originalDoc: cloneDocument(this.document),
        movingAtomIds: moving,
      };
      this.renderChrome();
      this.renderCanvas();
      return;
    }

    this.interaction = {
      kind: "box",
      pointerId: event.pointerId,
      startWorld: world,
      currentWorld: world,
      additive,
      baseSelection: this.cloneSelection(this.selection),
    };
    if (!additive) {
      clearSelection(this.selection);
      this.renderChrome();
      this.renderCanvas();
    }
  }

  private handlePointerMove(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      event.preventDefault();
      this.activeTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (this.interaction?.kind === "gesture") {
      if (!this.activeTouchPoints.has(event.pointerId)) {
        return;
      }
      this.updateTouchGesture();
      return;
    }

    if (!this.interaction || this.interaction.pointerId !== event.pointerId) {
      return;
    }

    if (this.interaction.kind === "pan") {
      const dx = event.clientX - this.interaction.startClient.x;
      const dy = event.clientY - this.interaction.startClient.y;
      this.document.viewport = {
        ...this.interaction.originalViewport,
        x: this.interaction.originalViewport.x - dx / this.interaction.originalViewport.zoom,
        y: this.interaction.originalViewport.y - dy / this.interaction.originalViewport.zoom,
      };
      this.renderCanvas();
      return;
    }

    const world = this.clientToWorld(event.clientX, event.clientY);
    this.hoverWorld = world;
    const { atomId, bondId, bracketId } = this.getTargetIds(event.target);
    this.hoverAtomId = atomId ?? null;
    this.hoverBondId = bondId ?? null;
    this.hoverBracketId = bracketId ?? null;

    if (this.interaction.kind === "box") {
      this.interaction.currentWorld = world;
      this.renderCanvas();
      return;
    }

    if (this.interaction.kind === "bracket") {
      this.interaction.currentWorld = world;
      this.renderCanvas();
      return;
    }

    if (this.interaction.kind === "move") {
      const dx = world.x - this.interaction.startWorld.x;
      const dy = world.y - this.interaction.startWorld.y;
      this.document = cloneDocument(this.interaction.originalDoc);
      for (const atomIdToMove of this.interaction.movingAtomIds) {
        const atom = getAtomById(this.document, atomIdToMove);
        if (!atom) {
          continue;
        }
        atom.x += dx;
        atom.y += dy;
      }
      this.renderCanvas();
    }
  }

  private handlePointerUp(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      event.preventDefault();
      this.activeTouchPoints.delete(event.pointerId);
    }

    if (this.interaction?.kind === "gesture") {
      if (this.activeTouchPoints.size < 2) {
        this.interaction = null;
        this.renderCanvas();
      }
      return;
    }

    if (!this.interaction || this.interaction.pointerId !== event.pointerId) {
      return;
    }

    if (this.interaction.kind === "move") {
      this.commitGesture(this.interaction.originalDoc, "Moved selection.");
      this.interaction = null;
      this.renderChrome();
      this.renderCanvas();
      return;
    }

    if (this.interaction.kind === "box") {
      const rect = normalizeRect(this.interaction.startWorld, this.interaction.currentWorld);
      if (rect.width > 6 || rect.height > 6) {
        const selection = this.interaction.additive
          ? this.cloneSelection(this.interaction.baseSelection)
          : createSelectionState();
        for (const atom of this.document.atoms) {
          if (rectContainsPoint(rect, atom)) {
            selection.atomIds.add(atom.id);
          }
        }
        for (const bond of this.document.bonds) {
          if (selection.atomIds.has(bond.a1) && selection.atomIds.has(bond.a2)) {
            selection.bondIds.add(bond.id);
          }
        }
        this.selection = selection;
        this.statusMessage = `Box selected ${selection.atomIds.size} atom(s).`;
      }
      this.interaction = null;
      this.renderChrome();
      this.renderCanvas();
      return;
    }

    if (this.interaction.kind === "bracket") {
      const rect = normalizeRect(this.interaction.startWorld, this.interaction.currentWorld);
      this.interaction = null;
      if (rect.width >= 18 && rect.height >= 24) {
        this.mutateDocumentWithHistory((document) => {
          addBracket(document, this.tool.kind === "bracket" ? this.tool.shape : "square", rect);
        }, "Placed bracket annotation.");
      } else {
        this.statusMessage = "Bracket placement cancelled.";
        this.renderStatus();
        this.renderCanvas();
      }
      return;
    }

    this.interaction = null;
    this.renderCanvas();
  }

  private handleCanvasContextMenu(event: MouseEvent): void {
    event.preventDefault();
    const atomId = this.getContextMenuAtomId(event.target);
    if (!atomId) {
      this.closeAtomMenu();
      return;
    }
    this.openAtomMenu(atomId, event.clientX, event.clientY);
  }

  private getContextMenuAtomId(target: EventTarget | null): string | null {
    const { atomId, bondId, bracketId } = this.getTargetIds(target);
    if (atomId) {
      return atomId;
    }
    if (bondId || bracketId) {
      return null;
    }
    if (this.selection.atomIds.size === 1) {
      return Array.from(this.selection.atomIds)[0] ?? null;
    }
    return null;
  }

  private openAtomMenu(atomId: string, clientX: number, clientY: number): void {
    const menuWidth = 180;
    const menuHeight = 214;
    this.atomMenuState = {
      atomId,
      x: clamp(clientX, 12, window.innerWidth - menuWidth),
      y: clamp(clientY, 12, window.innerHeight - menuHeight),
    };
    this.renderAtomMenu();
  }

  private closeAtomMenu(): void {
    this.atomMenuState = null;
    this.renderAtomMenu();
  }

  private renderAtomMenu(): void {
    if (!this.atomMenuState) {
      this.atomMenuEl.hidden = true;
      this.atomMenuEl.innerHTML = "";
      return;
    }

    const atom = getAtomById(this.document, this.atomMenuState.atomId);
    if (!atom) {
      this.atomMenuState = null;
      this.atomMenuEl.hidden = true;
      this.atomMenuEl.innerHTML = "";
      return;
    }

    const currentState = getAtomStateMode(atom);
    this.atomMenuEl.hidden = false;
    this.atomMenuEl.style.left = `${this.atomMenuState.x}px`;
    this.atomMenuEl.style.top = `${this.atomMenuState.y}px`;
    this.atomMenuEl.innerHTML = `
      <div class="atom-menu-card">
        <div class="atom-menu-title">${this.escapeHtml(atom.element)} atom</div>
        ${this.renderAtomMenuButton("neutral", "Neutral", currentState === "neutral")}
        ${this.renderAtomMenuButton("positive", "+", currentState === "positive")}
        ${this.renderAtomMenuButton("negative", "-", currentState === "negative")}
        ${this.renderAtomMenuButton("radical", "Radical", currentState === "radical")}
      </div>
    `;
  }

  private renderAtomMenuButton(
    state: AtomStateMode,
    label: string,
    active: boolean,
  ): string {
    return `
      <button
        type="button"
        class="atom-menu-option ${active ? "is-active" : ""}"
        data-atom-state="${state}"
      >
        ${label}
      </button>
    `;
  }

  private getAtomStateStatus(state: AtomStateMode): string {
    switch (state) {
      case "positive":
        return "Applied positive charge.";
      case "negative":
        return "Applied negative charge.";
      case "radical":
        return "Applied radical state.";
      default:
        return "Cleared atom state.";
    }
  }

  private getSmilesExportOmissionNote(): string {
    const parts: string[] = [];
    if (this.document.atoms.some((atom) => atom.radical)) {
      parts.push("radicals");
    }
    if (this.document.brackets.length > 0) {
      parts.push("bracket annotations");
    }
    if (parts.length === 0) {
      return "";
    }
    if (parts.length === 1) {
      return ` without ${parts[0]}`;
    }
    return ` without ${parts[0]} or ${parts[1]}`;
  }

  private async handleTopbarAction(action: string): Promise<void> {
    this.closeAtomMenu();
    switch (action) {
      case "new":
        this.loadDocument(createEmptyDocument("Untitled Canvas"), {
          pushHistory: true,
          fit: true,
          status: "Started a new blank project.",
        });
        break;
      case "demo":
        this.loadDocument(createDemoDocument(), {
          pushHistory: true,
          fit: true,
          status: "Loaded the demo structure.",
        });
        break;
      case "open":
        this.projectInputEl.click();
        break;
      case "save":
        await this.saveProject();
        break;
      case "import-smiles":
        await this.promptImportSmiles();
        break;
      case "import-mol":
        this.molInputEl.click();
        break;
      case "export-smiles":
        await this.downloadSmiles();
        break;
      case "export-mol":
        await this.downloadMolfile();
        break;
      case "export-svg":
        await this.downloadSvg();
        break;
      case "export-png":
        await this.downloadPng();
        break;
      case "undo":
        this.undo();
        break;
      case "redo":
        this.redo();
        break;
      case "tidy":
        this.mutateDocumentWithHistory((document) => {
          tidyDocument(document);
        }, "Applied tidy geometry.");
        break;
      case "fit":
        this.fitToDocument();
        this.statusMessage = "Viewport fit to structure.";
        this.renderStatus();
        this.renderCanvas();
        break;
      default:
        break;
    }
  }

  private handleToolSelection(button: HTMLButtonElement): void {
    this.closeAtomMenu();
    const tool = button.dataset.tool;
    if (!tool) {
      return;
    }

    if (tool === "bond") {
      const preset = button.dataset.preset as BondPreset | undefined;
      if (!preset) {
        return;
      }
      this.tool = { kind: "bond", preset };
      this.statusMessage = `${preset} bond tool armed.`;
    } else if (tool === "atom") {
      const element = button.dataset.element as ElementSymbol | undefined;
      if (!element) {
        return;
      }
      this.tool = { kind: "atom", element };
      this.statusMessage = `${element} atom tool armed.`;
    } else if (tool === "bracket") {
      const shape = button.dataset.shape as BracketShape | undefined;
      if (!shape) {
        return;
      }
      this.tool = { kind: "bracket", shape };
      this.statusMessage = `${shape} bracket tool armed.`;
    } else if (tool === "ring") {
      const templateId = button.dataset.templateId as RingTemplateId | undefined;
      if (!templateId) {
        return;
      }
      this.tool = { kind: "ring", templateId };
      this.statusMessage = `${button.textContent?.trim() ?? "Ring"} tool armed.`;
    } else if (tool === "select" || tool === "pan" || tool === "erase") {
      this.tool = { kind: tool };
      this.statusMessage = `${button.textContent?.trim() ?? tool} tool active.`;
    }

    if (this.tool.kind !== "bond") {
      this.pendingBondStartId = null;
    }

    this.renderChrome();
    this.renderCanvas();
  }

  private handleErase(atomId?: string, bondId?: string, bracketId?: string): void {
    if (atomId) {
      this.mutateDocumentWithHistory((document) => {
        deleteAtom(document, atomId);
      }, "Deleted atom.");
      this.selection.atomIds.delete(atomId);
      return;
    }
    if (bondId) {
      this.mutateDocumentWithHistory((document) => {
        deleteBond(document, bondId);
      }, "Deleted bond.");
      this.selection.bondIds.delete(bondId);
      return;
    }
    if (bracketId) {
      this.mutateDocumentWithHistory((document) => {
        deleteBracket(document, bracketId);
      }, "Deleted bracket.");
    }
  }

  private handleAtomPlacement(atomId: string | undefined, world: Point): void {
    this.pendingBondStartId = null;
    if (atomId) {
      const element = this.tool.kind === "atom" ? this.tool.element : "C";
      this.mutateDocumentWithHistory((document) => {
        setAtomElement(document, atomId, element);
      }, `Changed atom to ${element}.`);
      return;
    }

    const element = this.tool.kind === "atom" ? this.tool.element : "C";
    this.mutateDocumentWithHistory((document) => {
      addAtom(document, element, world);
    }, `Placed ${element}.`);
  }

  private handleBondPlacement(
    atomId: string | undefined,
    bondId: string | undefined,
    world: Point,
  ): void {
    const preset = this.tool.kind === "bond" ? this.tool.preset : "single";
    if (!this.pendingBondStartId && bondId && !atomId) {
      this.mutateDocumentWithHistory((document) => {
        const bond = getBondById(document, bondId);
        if (!bond) {
          return;
        }
        connectAtoms(document, bond.a1, bond.a2, preset);
      }, `Updated bond to ${preset}.`);
      return;
    }

    if (!this.pendingBondStartId) {
      if (atomId) {
        this.pendingBondStartId = atomId;
        this.statusMessage = "Bond start selected.";
        this.renderStatus();
        this.renderCanvas();
        return;
      }
      let createdAtomId = "";
      this.mutateDocumentWithHistory((document) => {
        createdAtomId = addAtom(document, "C", world);
      }, "Placed start atom for bond chain.");
      this.pendingBondStartId = createdAtomId;
      this.renderStatus();
      this.renderCanvas();
      return;
    }

    if (atomId === this.pendingBondStartId) {
      this.pendingBondStartId = null;
      this.statusMessage = "Bond chain cancelled.";
      this.renderStatus();
      this.renderCanvas();
      return;
    }

    let nextAtomId: string | null = atomId ?? null;
    const applied = this.mutateDocumentWithHistory((document) => {
      const start = getAtomById(document, this.pendingBondStartId!);
      if (!start) {
        return;
      }
      if (!nextAtomId) {
        const snapped = snapBondTarget(start, world);
        nextAtomId = addAtom(document, "C", snapped);
      }
      connectAtoms(document, start.id, nextAtomId, preset);
    }, `Added ${preset} bond.`);

    if (!applied || !nextAtomId) {
      this.renderCanvas();
      return;
    }

    this.pendingBondStartId = nextAtomId;
    this.renderStatus();
    this.renderCanvas();
  }

  private handleRingPlacement(
    atomId: string | undefined,
    bondId: string | undefined,
    world: Point,
  ): void {
    const templateId = this.tool.kind === "ring" ? this.tool.templateId : "hexane";
    this.pendingBondStartId = null;
    if (atomId) {
      this.mutateDocumentWithHistory((document) => {
        addRingFromAtom(document, templateId, atomId);
      }, "Attached ring to atom.");
      return;
    }
    if (bondId) {
      this.mutateDocumentWithHistory((document) => {
        addRingFromBond(document, templateId, bondId, world);
      }, "Attached ring to bond.");
      return;
    }
    this.mutateDocumentWithHistory((document) => {
      addRingFromCenter(document, templateId, world);
    }, "Inserted ring.");
  }

  private mutateDocumentWithHistory(
    mutator: (document: ChemicalDocument) => void,
    status: string,
  ): boolean {
    const before = cloneDocument(this.document);
    const working = cloneDocument(this.document);
    mutator(working);
    const touchedAtomIds = this.getValenceRelevantAtomIds(before, working);
    const violation = touchedAtomIds.length
      ? getValenceViolation(working, touchedAtomIds)
      : null;
    if (violation) {
      this.statusMessage = this.formatValenceViolation(violation);
      this.renderStatus();
      return false;
    }
    if (this.documentsEqual(before, working)) {
      return false;
    }
    this.history.push(before);
    this.future = [];
    this.document = working;
    this.closeAtomMenu();
    this.renderChrome();
    this.renderCanvas();
    this.statusMessage = status;
    this.renderStatus();
    return true;
  }

  private commitGesture(originalDoc: ChemicalDocument, status: string): void {
    if (this.documentsEqual(originalDoc, this.document)) {
      return;
    }
    touchDocument(this.document);
    this.history.push(originalDoc);
    this.future = [];
    this.statusMessage = status;
  }

  private loadDocument(
    nextDocument: ChemicalDocument,
    options: { pushHistory: boolean; fit: boolean; status: string },
  ): void {
    const normalized = cloneDocument(nextDocument);
    if (options.pushHistory) {
      this.history.push(cloneDocument(this.document));
      this.future = [];
    }
    this.document = normalized;
    this.selection = createSelectionState();
    this.pendingBondStartId = null;
    this.interaction = null;
    this.closeAtomMenu();
    if (options.fit) {
      this.fitToDocument();
    }
    this.statusMessage = options.status;
    this.renderChrome();
    this.renderCanvas();
  }

  private applyColourChoice(themeState: ThemeState, status: string): void {
    const targets = this.getSelectionColourTargets();
    if (targets.atomIds.size || targets.bondIds.size) {
      const displayColor = getMonochromeColour(themeState) ?? undefined;
      this.mutateDocumentWithHistory((document) => {
        for (const atom of document.atoms) {
          if (targets.atomIds.has(atom.id)) {
            atom.displayColor = displayColor;
          }
        }
        for (const bond of document.bonds) {
          if (targets.bondIds.has(bond.id)) {
            bond.displayColor = displayColor;
          }
        }
        touchDocument(document);
      }, this.getSelectionColourStatus(themeState, status));
      return;
    }

    this.mutateDocumentWithHistory((document) => {
      document.themeState = themeState;
      touchDocument(document);
    }, status);
  }

  private fitToDocument(): void {
    const { width, height } = this.getCanvasSize();
    this.document.viewport = fitViewportToBounds(
      this.getDocumentBounds(),
      width,
      height,
    );
    this.relaxViewport(1 / 1.12);
  }

  private relaxViewport(factor: number): void {
    const { width, height } = this.getCanvasSize();
    const centerX = this.document.viewport.x + width / this.document.viewport.zoom / 2;
    const centerY = this.document.viewport.y + height / this.document.viewport.zoom / 2;
    const nextZoom = clamp(this.document.viewport.zoom * factor, 0.35, 3.2);
    this.document.viewport = {
      zoom: nextZoom,
      x: centerX - width / nextZoom / 2,
      y: centerY - height / nextZoom / 2,
    };
  }

  private getValenceRelevantAtomIds(
    before: ChemicalDocument,
    after: ChemicalDocument,
  ): string[] {
    const ids = new Set<string>();
    const beforeAtomMap = new Map(before.atoms.map((atom) => [atom.id, atom]));
    const afterAtomMap = new Map(after.atoms.map((atom) => [atom.id, atom]));

    for (const atom of after.atoms) {
      const previous = beforeAtomMap.get(atom.id);
      if (!previous) {
        ids.add(atom.id);
        continue;
      }
      if (
        previous.element !== atom.element ||
        previous.charge !== atom.charge ||
        previous.radical !== atom.radical
      ) {
        ids.add(atom.id);
        continue;
      }
      if (Math.abs(getAtomBondOrderSum(before, atom.id) - getAtomBondOrderSum(after, atom.id)) > 0.001) {
        ids.add(atom.id);
      }
    }

    for (const atom of before.atoms) {
      if (!afterAtomMap.has(atom.id)) {
        continue;
      }
      if (Math.abs(getAtomBondOrderSum(before, atom.id) - getAtomBondOrderSum(after, atom.id)) > 0.001) {
        ids.add(atom.id);
      }
    }

    return Array.from(ids);
  }

  private formatValenceValue(value: number): string {
    return Number.isInteger(value) ? `${value}` : value.toFixed(1).replace(/\.0$/, "");
  }

  private formatValenceViolation(
    violation: { element: ElementSymbol; occupied: number; cap: number },
  ): string {
    return `${violation.element} would exceed its bond limit (${this.formatValenceValue(
      violation.occupied,
    )}/${this.formatValenceValue(violation.cap)}).`;
  }

  private getDocumentBounds(): { x: number; y: number; width: number; height: number } | null {
    if (this.document.atoms.length === 0 && this.document.brackets.length === 0) {
      return null;
    }
    const xs = this.document.atoms.map((atom) => atom.x);
    const ys = this.document.atoms.map((atom) => atom.y);
    for (const bracket of this.document.brackets) {
      xs.push(bracket.x - 18, bracket.x + bracket.width + 34);
      ys.push(bracket.y - 12, bracket.y + bracket.height + 20);
    }
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

  private zoomAt(factor: number, clientX: number, clientY: number): void {
    const rect = this.svgEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    const worldBefore = this.clientToWorld(clientX, clientY);
    const nextZoom = clamp(this.document.viewport.zoom * factor, 0.35, 3.2);
    const nextWidth = rect.width / nextZoom;
    const nextHeight = rect.height / nextZoom;
    const relativeX = (clientX - rect.left) / rect.width;
    const relativeY = (clientY - rect.top) / rect.height;
    this.document.viewport = {
      zoom: nextZoom,
      x: worldBefore.x - nextWidth * relativeX,
      y: worldBefore.y - nextHeight * relativeY,
    };
    this.renderCanvas();
  }

  private handleCanvasControlAction(action: string): void {
    const rect = this.svgEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    if (action === "fit") {
      this.fitToDocument();
      this.statusMessage = "Viewport fit to structure.";
      this.renderStatus();
      this.renderCanvas();
      return;
    }

    if (action === "zoom-in") {
      this.zoomAt(1.14, centerX, centerY);
      return;
    }

    if (action === "zoom-out") {
      this.zoomAt(1 / 1.14, centerX, centerY);
    }
  }

  private undo(): void {
    const previous = this.history.pop();
    if (!previous) {
      return;
    }
    this.future.push(cloneDocument(this.document));
    this.document = previous;
    this.selection = createSelectionState();
    this.pendingBondStartId = null;
    this.closeAtomMenu();
    this.statusMessage = "Undo complete.";
    this.renderChrome();
    this.renderCanvas();
  }

  private redo(): void {
    const next = this.future.pop();
    if (!next) {
      return;
    }
    this.history.push(cloneDocument(this.document));
    this.document = next;
    this.selection = createSelectionState();
    this.pendingBondStartId = null;
    this.closeAtomMenu();
    this.statusMessage = "Redo complete.";
    this.renderChrome();
    this.renderCanvas();
  }

  private async saveProject(): Promise<void> {
    const payload = JSON.stringify(this.document, null, 2);
    this.downloadText(`${this.getSafeDocumentName()}.chemjson`, payload, "application/json");
    this.statusMessage = "Project saved as .chemjson.";
    this.renderStatus();
  }

  private async promptImportSmiles(): Promise<void> {
    const input = window.prompt("Paste a SMILES string to import.");
    if (!input) {
      return;
    }
    try {
      const imported = await importSmiles(input.trim());
      this.loadDocument(imported, {
        pushHistory: true,
        fit: true,
        status: "Imported SMILES and computed 2D coordinates.",
      });
    } catch (error) {
      this.statusMessage = `SMILES import failed: ${this.getErrorMessage(error)}`;
      this.renderStatus();
    }
  }

  private async openProjectFile(): Promise<void> {
    const file = this.projectInputEl.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = normalizeLoadedDocument(JSON.parse(text));
      this.loadDocument(parsed, {
        pushHistory: true,
        fit: false,
        status: `Opened ${file.name}.`,
      });
    } catch (error) {
      this.statusMessage = `Could not open project: ${this.getErrorMessage(error)}`;
      this.renderStatus();
    } finally {
      this.projectInputEl.value = "";
    }
  }

  private async importMolFileFromDisk(): Promise<void> {
    const file = this.molInputEl.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const imported = await importMolfile(text);
      this.loadDocument(imported, {
        pushHistory: true,
        fit: true,
        status: `Imported ${file.name}.`,
      });
    } catch (error) {
      this.statusMessage = `MOL import failed: ${this.getErrorMessage(error)}`;
      this.renderStatus();
    } finally {
      this.molInputEl.value = "";
    }
  }

  private async downloadMolfile(): Promise<void> {
    try {
      const molfile = await exportMolfile(this.document);
      this.downloadText(`${this.getSafeDocumentName()}.mol`, molfile, "chemical/x-mdl-molfile");
      this.statusMessage = "Exported Molfile.";
      this.renderStatus();
    } catch (error) {
      this.statusMessage = `Molfile export failed: ${this.getErrorMessage(error)}`;
      this.renderStatus();
    }
  }

  private async downloadSmiles(): Promise<void> {
    try {
      const smiles = await exportSmiles(this.document);
      this.downloadText(`${this.getSafeDocumentName()}.smi`, `${smiles}\n`, "text/plain");
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(smiles);
      }
      const omissionNote = this.getSmilesExportOmissionNote();
      this.statusMessage = `Exported SMILES${omissionNote}${smiles ? `: ${smiles}` : ""}`;
      this.renderStatus();
    } catch (error) {
      this.statusMessage = `SMILES export failed: ${this.getErrorMessage(error)}`;
      this.renderStatus();
    }
  }

  private async downloadSvg(): Promise<void> {
    const scene = this.createExportScene();
    this.downloadText(`${this.getSafeDocumentName()}.svg`, scene.markup, "image/svg+xml");
    this.statusMessage = "Exported SVG with the active theme.";
    this.renderStatus();
  }

  private async downloadPng(): Promise<void> {
    const scene = this.createExportScene(this.getPngExportScale());
    const blob = new Blob([scene.markup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = scene.width;
          canvas.height = scene.height;
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("Canvas context unavailable."));
            return;
          }
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.fillStyle = "#FFFFFF";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0);
          canvas.toBlob((blobResult) => {
            if (!blobResult) {
              reject(new Error("PNG encoding failed."));
              return;
            }
          resolve(blobResult);
          }, "image/png");
        };
        image.onerror = () => reject(new Error("PNG rendering failed."));
        image.src = url;
      });
      this.downloadBlob(`${this.getSafeDocumentName()}.png`, pngBlob);
      this.statusMessage = `Exported high-resolution PNG with the active theme (${scene.width}×${scene.height}).`;
      this.renderStatus();
    } catch (error) {
      this.statusMessage = `PNG export failed: ${this.getErrorMessage(error)}`;
      this.renderStatus();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private createExportScene(scale = 1): ExportScene {
    const { width: viewportWidth, height: viewportHeight } = this.getCanvasSize();
    const width = Math.max(1, Math.round(viewportWidth * scale));
    const height = Math.max(1, Math.round(viewportHeight * scale));
    const viewBox = this.getViewBox(viewportWidth, viewportHeight);

    if (viewportWidth <= 0 || viewportHeight <= 0) {
      const emptyMarkup = `<svg xmlns="${SVG_NAMESPACE}" width="1200" height="800" viewBox="-600 -400 1200 800"><rect width="1200" height="800" x="-600" y="-400" fill="#FFFFFF" /></svg>`;
      return { markup: emptyMarkup, width: 1200, height: 800 };
    }
    const markup = `
      <svg
        xmlns="${SVG_NAMESPACE}"
        width="${width}"
        height="${height}"
        viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"
      >
        ${this.buildSceneMarkup(viewBox, true)}
      </svg>
    `.trim();
    return {
      markup,
      width,
      height,
    };
  }

  private getPngExportScale(): number {
    const { width, height } = this.getCanvasSize();
    const deviceScale =
      typeof window === "undefined" ? 3 : Math.max(3, Math.ceil((window.devicePixelRatio || 1) * 2));
    const maxPixels = 24_000_000;
    const maxScaleByPixels = Math.sqrt(maxPixels / Math.max(1, width * height));
    return clamp(Math.min(deviceScale, maxScaleByPixels), 2, 4);
  }

  private async handleKeydown(event: KeyboardEvent): Promise<void> {
    const key = event.key.toLowerCase();
    const meta = event.ctrlKey || event.metaKey;
    if (meta && key === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      return;
    }
    if (meta && key === "s") {
      event.preventDefault();
      await this.saveProject();
      return;
    }
    if (key === "delete" || key === "backspace") {
      if (this.selection.atomIds.size || this.selection.bondIds.size) {
        event.preventDefault();
        this.mutateDocumentWithHistory((document) => {
          deleteSelection(document, this.selection);
        }, "Deleted selection.");
        clearSelection(this.selection);
        this.renderChrome();
        this.renderCanvas();
      }
      return;
    }
    if (key === "escape") {
      if (this.atomMenuState) {
        this.closeAtomMenu();
        this.statusMessage = "Closed atom menu.";
        this.renderStatus();
        return;
      }
      this.pendingBondStartId = null;
      this.interaction = null;
      this.statusMessage = "Cleared pending interaction.";
      this.renderChrome();
      this.renderCanvas();
      return;
    }
    if (meta) {
      return;
    }

    switch (key) {
      case "v":
        this.tool = { kind: "select" };
        break;
      case "h":
        this.tool = { kind: "pan" };
        break;
      case "e":
        this.tool = { kind: "erase" };
        break;
      case "1":
        this.tool = { kind: "bond", preset: "single" };
        break;
      case "2":
        this.tool = { kind: "bond", preset: "double" };
        break;
      case "3":
        this.tool = { kind: "bond", preset: "triple" };
        break;
      case "w":
        this.tool = { kind: "bond", preset: "wedge" };
        break;
      case "q":
        this.tool = { kind: "bond", preset: "hash" };
        break;
      case "c":
        this.tool = { kind: "atom", element: "C" };
        break;
      case "n":
        this.tool = { kind: "atom", element: "N" };
        break;
      case "o":
        this.tool = { kind: "atom", element: "O" };
        break;
      case "b":
        this.tool = { kind: "ring", templateId: "benzene" };
        break;
      case "t":
        this.mutateDocumentWithHistory((document) => {
          tidyDocument(document);
        }, "Applied tidy geometry.");
        return;
      case "0":
        this.fitToDocument();
        this.renderCanvas();
        return;
      case "+":
      case "=": {
        const rect = this.svgEl.getBoundingClientRect();
        this.zoomAt(1.12, rect.left + rect.width / 2, rect.top + rect.height / 2);
        return;
      }
      case "-": {
        const rect = this.svgEl.getBoundingClientRect();
        this.zoomAt(1 / 1.12, rect.left + rect.width / 2, rect.top + rect.height / 2);
        return;
      }
      default:
        return;
    }

    if (this.tool.kind !== "bond") {
      this.pendingBondStartId = null;
    }
    this.statusMessage = `${this.getToolLabel()} tool active.`;
    this.renderChrome();
    this.renderCanvas();
  }

  private clientToWorld(clientX: number, clientY: number): Point {
    const rect = this.svgEl.getBoundingClientRect();
    const { width, height } = this.getCanvasSize();
    const worldWidth = width / this.document.viewport.zoom;
    const worldHeight = height / this.document.viewport.zoom;
    return {
      x: this.document.viewport.x + ((clientX - rect.left) / width) * worldWidth,
      y: this.document.viewport.y + ((clientY - rect.top) / height) * worldHeight,
    };
  }

  private createTouchGesture(): Extract<InteractionState, { kind: "gesture" }> | null {
    if (this.activeTouchPoints.size < 2) {
      return null;
    }
    const [first, second] = Array.from(this.activeTouchPoints.entries()).slice(0, 2);
    const firstPoint = first[1];
    const secondPoint = second[1];
    return {
      kind: "gesture",
      pointerIds: [first[0], second[0]],
      startDistance: Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y) || 1,
      startMidpoint: {
        x: (firstPoint.x + secondPoint.x) / 2,
        y: (firstPoint.y + secondPoint.y) / 2,
      },
      originalViewport: { ...this.document.viewport },
    };
  }

  private updateTouchGesture(): void {
    if (this.interaction?.kind !== "gesture") {
      return;
    }
    const points = this.interaction.pointerIds
      .map((pointerId) => this.activeTouchPoints.get(pointerId))
      .filter((value): value is Point => Boolean(value));
    if (points.length !== 2) {
      return;
    }

    const currentDistance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) || 1;
    const currentMidpoint = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
    const rect = this.svgEl.getBoundingClientRect();
    const scaleFactor = currentDistance / this.interaction.startDistance;
    const nextZoom = clamp(this.interaction.originalViewport.zoom * scaleFactor, 0.35, 3.2);
    const worldAnchor = this.clientToWorldWithViewport(
      this.interaction.startMidpoint.x,
      this.interaction.startMidpoint.y,
      this.interaction.originalViewport,
    );
    const worldWidth = rect.width / nextZoom;
    const worldHeight = rect.height / nextZoom;
    const relativeX = (currentMidpoint.x - rect.left) / rect.width;
    const relativeY = (currentMidpoint.y - rect.top) / rect.height;

    this.document.viewport = {
      zoom: nextZoom,
      x: worldAnchor.x - worldWidth * relativeX,
      y: worldAnchor.y - worldHeight * relativeY,
    };
    this.renderCanvas();
  }

  private getTargetIds(
    target: EventTarget | null,
  ): { atomId?: string; bondId?: string; bracketId?: string } {
    if (!(target instanceof Element)) {
      return {};
    }
    const atomEl = target.closest<SVGElement>("[data-atom-id]");
    if (atomEl?.dataset.atomId) {
      return { atomId: atomEl.dataset.atomId };
    }
    const bondEl = target.closest<SVGElement>("[data-bond-id]");
    if (bondEl?.dataset.bondId) {
      return { bondId: bondEl.dataset.bondId };
    }
    const bracketEl = target.closest<SVGElement>("[data-bracket-id]");
    if (bracketEl?.dataset.bracketId) {
      return { bracketId: bracketEl.dataset.bracketId };
    }

    return {};
  }

  private cloneSelection(selection: SelectionState): SelectionState {
    return {
      atomIds: new Set(selection.atomIds),
      bondIds: new Set(selection.bondIds),
    };
  }

  private selectOnly(next: { atomIds: string[]; bondIds: string[] }): void {
    this.selection = createSelectionState();
    for (const atomId of next.atomIds) {
      this.selection.atomIds.add(atomId);
    }
    for (const bondId of next.bondIds) {
      this.selection.bondIds.add(bondId);
    }
  }

  private toggleAtomSelection(atomId: string): void {
    if (this.selection.atomIds.has(atomId)) {
      this.selection.atomIds.delete(atomId);
    } else {
      this.selection.atomIds.add(atomId);
    }
  }

  private toggleBondSelection(bondId: string): void {
    if (this.selection.bondIds.has(bondId)) {
      this.selection.bondIds.delete(bondId);
    } else {
      this.selection.bondIds.add(bondId);
    }
  }

  private documentsEqual(a: ChemicalDocument, b: ChemicalDocument): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private getSafeDocumentName(): string {
    return this.document.metadata.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "chemical-drawing";
  }

  private downloadText(filename: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    this.downloadBlob(filename, blob);
  }

  private downloadBlob(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private getClosestButton(target: EventTarget | null): HTMLButtonElement | null {
    if (!(target instanceof Element)) {
      return null;
    }
    const button = target.closest("button");
    return button instanceof HTMLButtonElement ? button : null;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private getSelectionColourTargets(): { atomIds: Set<string>; bondIds: Set<string> } {
    const atomIds = new Set(this.selection.atomIds);
    const bondIds = new Set(this.selection.bondIds);

    for (const bondId of this.selection.bondIds) {
      const bond = getBondById(this.document, bondId);
      if (!bond) {
        continue;
      }
      atomIds.add(bond.a1);
      atomIds.add(bond.a2);
    }

    for (const bond of this.document.bonds) {
      if (atomIds.has(bond.a1) && atomIds.has(bond.a2)) {
        bondIds.add(bond.id);
      }
    }

    return { atomIds, bondIds };
  }

  private getSelectionColourStatus(themeState: ThemeState, fallback: string): string {
    if (themeState.mode === "conventional") {
      return "Restored conventional colours for the selection.";
    }
    return fallback.replace("theme", "selection").replace("Applied ", "Applied to selection: ");
  }

  private findBondBetweenAtoms(a1: string, a2: string): Bond | undefined {
    return this.document.bonds.find(
      (entry) => (entry.a1 === a1 && entry.a2 === a2) || (entry.a1 === a2 && entry.a2 === a1),
    );
  }

  private clientToWorldWithViewport(clientX: number, clientY: number, viewport: Viewport): Point {
    const rect = this.svgEl.getBoundingClientRect();
    const { width, height } = this.getCanvasSize();
    const worldWidth = width / viewport.zoom;
    const worldHeight = height / viewport.zoom;
    return {
      x: viewport.x + ((clientX - rect.left) / width) * worldWidth,
      y: viewport.y + ((clientY - rect.top) / height) * worldHeight,
    };
  }

  private getCanvasSize(): { width: number; height: number } {
    const rect = this.svgEl.getBoundingClientRect();
    return {
      width: rect.width > 0 ? rect.width : 960,
      height: rect.height > 0 ? rect.height : 640,
    };
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
