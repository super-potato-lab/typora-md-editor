import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "../files";
import { localImageSrc } from "./imagePaths";

export function displayImageSrc(stored: string, directory: string | null): string {
  if (!isTauri()) return stored;
  return localImageSrc(stored, directory, (absolute) => convertFileSrc(absolute));
}
