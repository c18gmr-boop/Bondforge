import "./styles.css";
import { ChemicalEditorApp } from "./app";

const appRoot = document.querySelector<HTMLElement>("#app");

if (!appRoot) {
  throw new Error("App root not found.");
}

new ChemicalEditorApp(appRoot);
