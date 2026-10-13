import { invoke } from "@tauri-apps/api/core";

export interface OpenedFile {
  path: string;
  content: string;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function assertDesktop(): void {
  if (!isTauri()) {
    throw new Error(
      "Open and save run in the desktop app. Start it with npm run tauri dev.",
    );
  }
}

export async function openMarkdownFile(): Promise<OpenedFile | null> {
  assertDesktop();
  return invoke<OpenedFile | null>("open_markdown");
}

export async function saveMarkdownFile(path: string, content: string): Promise<void> {
  assertDesktop();
  await invoke("save_markdown", { path, content });
}

export async function saveMarkdownFileAs(
  content: string,
  suggestedName: string,
): Promise<string | null> {
  assertDesktop();
  return invoke<string | null>("save_markdown_as", { content, suggestedName });
}

export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

export function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}
