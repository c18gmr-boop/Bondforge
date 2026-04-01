import { BOND_LENGTH, DEFAULT_VIEWPORT } from "./constants";
import { averageBondLength, boundsFromDocument } from "./geometry";
import { cloneDocument, createEmptyDocument } from "./model";
import type { BondPreset, ChemicalDocument } from "./types";

type OclModule = typeof import("openchemlib/minimal");

let oclPromise: Promise<OclModule> | null = null;

async function getOcl(): Promise<OclModule> {
  oclPromise ??= import("openchemlib/minimal");
  return oclPromise;
}

function mapPresetToBondType(preset: BondPreset, Molecule: OclModule["Molecule"]): number {
  switch (preset) {
    case "double":
      return Molecule.cBondTypeDouble;
    case "triple":
      return Molecule.cBondTypeTriple;
    case "aromatic":
      return Molecule.cBondTypeDelocalized;
    case "wedge":
      return Molecule.cBondTypeUp;
    case "hash":
      return Molecule.cBondTypeDown;
    default:
      return Molecule.cBondTypeSingle;
  }
}

function mapBondToPreset(
  type: number,
  order: number,
  Molecule: OclModule["Molecule"],
): BondPreset {
  if (type === Molecule.cBondTypeUp) {
    return "wedge";
  }
  if (type === Molecule.cBondTypeDown) {
    return "hash";
  }
  if (type === Molecule.cBondTypeDelocalized) {
    return "aromatic";
  }
  if (order === 2 || type === Molecule.cBondTypeDouble) {
    return "double";
  }
  if (order === 3 || type === Molecule.cBondTypeTriple) {
    return "triple";
  }
  return "single";
}

async function documentToMolecule(
  document: ChemicalDocument,
): Promise<InstanceType<OclModule["Molecule"]>> {
  const { Molecule } = await getOcl();
  const molecule = new Molecule(0, 0);
  const atomIndexById = new Map<string, number>();

  for (const atom of document.atoms) {
    const atomicNo = Molecule.getAtomicNoFromLabel(atom.element) || 6;
    const atomIndex = molecule.addAtom(atomicNo);
    molecule.setAtomX(atomIndex, atom.x);
    molecule.setAtomY(atomIndex, -atom.y);
    if (atom.charge) {
      molecule.setAtomCharge(atomIndex, atom.charge);
    }
    if (atom.isotope) {
      molecule.setAtomMass(atomIndex, atom.isotope);
    }
    if (atom.radical) {
      molecule.setAtomRadical(atomIndex, Molecule.cAtomRadicalStateD);
    }
    atomIndexById.set(atom.id, atomIndex);
  }

  for (const bond of document.bonds) {
    const a1 = atomIndexById.get(bond.a1);
    const a2 = atomIndexById.get(bond.a2);
    if (typeof a1 !== "number" || typeof a2 !== "number") {
      continue;
    }
    const bondIndex = molecule.addBond(a1, a2);
    const preset: BondPreset =
      bond.stereo === "wedge" ? "wedge" : bond.stereo === "hash" ? "hash" : bond.order;
    molecule.setBondType(bondIndex, mapPresetToBondType(preset, Molecule));
  }

  molecule.ensureHelperArrays(Molecule.cHelperParities);
  return molecule;
}

function moleculeToDocument(
  molecule: InstanceType<OclModule["Molecule"]>,
  Molecule: OclModule["Molecule"],
  name = "Imported Molecule",
): ChemicalDocument {
  const document = createEmptyDocument(name);
  const atomIds: string[] = [];

  for (let index = 0; index < molecule.getAllAtoms(); index += 1) {
    const atomId = globalThis.crypto.randomUUID();
    atomIds.push(atomId);
    const element = molecule.getAtomLabel(index) || "C";
    document.atoms.push({
      id: atomId,
      element,
      x: molecule.getAtomX(index),
      y: -molecule.getAtomY(index),
      charge: molecule.getAtomCharge(index) || undefined,
      radical: molecule.getAtomRadical(index) ? true : undefined,
      isotope: molecule.getAtomMass(index) || undefined,
      labelMode: element === "C" ? "auto" : "always",
    });
  }

  for (let index = 0; index < molecule.getAllBonds(); index += 1) {
    const start = molecule.getBondAtom(0, index);
    const end = molecule.getBondAtom(1, index);
    const preset = mapBondToPreset(
      molecule.getBondType(index),
      molecule.getBondOrder(index),
      Molecule,
    );
    document.bonds.push({
      id: globalThis.crypto.randomUUID(),
      a1: atomIds[start],
      a2: atomIds[end],
      order:
        preset === "wedge" || preset === "hash"
          ? "single"
          : preset === "double" || preset === "triple" || preset === "aromatic"
            ? preset
            : "single",
      stereo: preset === "wedge" || preset === "hash" ? preset : "none",
    });
  }

  const average = averageBondLength(document);
  if (average > 0 && average !== BOND_LENGTH) {
    const bounds = boundsFromDocument(document);
    if (bounds) {
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      const scale = BOND_LENGTH / average;
      for (const atom of document.atoms) {
        atom.x = centerX + (atom.x - centerX) * scale;
        atom.y = centerY + (atom.y - centerY) * scale;
      }
    }
  }

  const normalizedBounds = boundsFromDocument(document);
  if (normalizedBounds) {
    const centerX = normalizedBounds.x + normalizedBounds.width / 2;
    const centerY = normalizedBounds.y + normalizedBounds.height / 2;
    for (const atom of document.atoms) {
      atom.x -= centerX;
      atom.y -= centerY;
    }
  }

  document.metadata.name = name;
  document.metadata.updatedAt = new Date().toISOString();
  document.viewport = { ...DEFAULT_VIEWPORT };
  return document;
}

export async function importSmiles(smiles: string): Promise<ChemicalDocument> {
  const { Molecule } = await getOcl();
  const molecule = Molecule.fromSmiles(smiles);
  return moleculeToDocument(molecule, Molecule, "Imported SMILES");
}

export async function importMolfile(molfile: string): Promise<ChemicalDocument> {
  const { Molecule } = await getOcl();
  const molecule = Molecule.fromMolfile(molfile);
  return moleculeToDocument(molecule, Molecule, "Imported Molfile");
}

export async function exportMolfile(document: ChemicalDocument): Promise<string> {
  return (await documentToMolecule(cloneDocument(document))).toMolfile();
}

export async function exportSmiles(document: ChemicalDocument): Promise<string> {
  const sanitized = cloneDocument(document);
  for (const atom of sanitized.atoms) {
    atom.radical = undefined;
  }
  return (await documentToMolecule(sanitized)).toSmiles();
}
