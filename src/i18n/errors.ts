import { t } from "./locale.ts";
import type { MessageKey } from "./messages.ts";

const EXACT: Record<string, MessageKey> = {
  "This action runs in the desktop app. Start it with npm run tauri dev.": "error.desktopOnly",
  "Something went wrong": "error.generic",
  "Save the document before inserting an image.": "error.saveBeforeImage",
  "Image files are saved beside the document in the desktop app.": "error.imageDesktop",
  "The document has no folder.": "error.noFolder",
  "Could not name the image.": "error.imageName",
  "Could not name the copied image.": "error.copiedImageName",
  "Could not open the print view.": "error.printView",
};

function rawMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong";
}

export function localizeError(err: unknown): string {
  const raw = rawMessage(err);
  const key = EXACT[raw];
  if (key) return t(key);
  const image = /^unsupported image type \.(.+)$/u.exec(raw);
  if (image?.[1]) return t("error.unsupportedImage", { ext: image[1] });
  const prefix = "Could not copy ";
  if (raw.startsWith(prefix)) {
    const rest = raw.slice(prefix.length);
    const split = rest.indexOf(": ");
    if (split >= 0) {
      return t("error.copyFile", {
        path: rest.slice(0, split),
        detail: rest.slice(split + 2),
      });
    }
  }
  return raw;
}
