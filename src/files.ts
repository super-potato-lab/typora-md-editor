import { invoke } from "@tauri-apps/api/core";

export interface OpenedFile {
  path: string;
  content: string;
}

export interface SavedImage {
  relativePath: string;
  absolutePath: string;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function assertDesktop(): void {
  if (!isTauri()) {
    throw new Error("This action runs in the desktop app. Start it with npm run tauri dev.");
  }
}

export interface DialogLabels {
  title: string;
  filter: string;
}

export async function openMarkdownFile(labels: DialogLabels): Promise<OpenedFile | null> {
  assertDesktop();
  return invoke<OpenedFile | null>("open_markdown", {
    title: labels.title,
    filterName: labels.filter,
  });
}

export async function readMarkdownFile(path: string): Promise<OpenedFile> {
  assertDesktop();
  return invoke<OpenedFile>("read_markdown", { path });
}

export async function saveMarkdownFile(path: string, content: string): Promise<void> {
  assertDesktop();
  await invoke("save_markdown", { path, content });
}

export interface SavedMarkdown {
  path: string;
  content: string;
}

export async function saveMarkdownFileAs(
  content: string,
  suggestedName: string,
  sourcePath: string | null,
  labels: DialogLabels,
): Promise<SavedMarkdown | null> {
  assertDesktop();
  return invoke<SavedMarkdown | null>("save_markdown_as", {
    content,
    suggestedName,
    sourcePath,
    title: labels.title,
    filterName: labels.filter,
  });
}

export async function exportHtmlFile(
  html: string,
  suggestedName: string,
  directory: string | null,
  labels: DialogLabels,
): Promise<string | null> {
  assertDesktop();
  return invoke<string | null>("export_html", {
    html,
    suggestedName,
    directory,
    title: labels.title,
    filterName: labels.filter,
  });
}

export async function savePastedImage(
  documentPath: string,
  filename: string,
  bytes: Uint8Array,
): Promise<SavedImage> {
  assertDesktop();
  return invoke<SavedImage>("save_pasted_image", {
    documentPath,
    filename,
    bytesBase64: encodeBase64(bytes),
  });
}

export async function pickAndSaveImage(
  documentPath: string,
  labels: DialogLabels,
): Promise<SavedImage | null> {
  assertDesktop();
  return invoke<SavedImage | null>("pick_and_save_image", {
    documentPath,
    title: labels.title,
    filterName: labels.filter,
  });
}

export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

export function basename(path: string): string {
  const parts = path.split(/[/\\]/u);
  return parts[parts.length - 1] || path;
}

export function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(0, index) : "";
}

export function replaceExtension(
  path: string | null,
  extension: string,
  untitledName = "Untitled.md",
): string {
  const name = path ? basename(path) : untitledName;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.${extension}`;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
