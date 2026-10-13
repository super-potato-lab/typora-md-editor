import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "../files";
import { useDocumentDir } from "../documentDir";

export const PreviewImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});

function ImageNodeView({ node }: NodeViewProps) {
  const directory = useDocumentDir();
  const stored = typeof node.attrs.src === "string" ? node.attrs.src : "";
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  return (
    <NodeViewWrapper className="image-block">
      <img src={displaySrc(stored, directory)} alt={alt} />
    </NodeViewWrapper>
  );
}

function displaySrc(stored: string, directory: string | null): string {
  if (!stored) return stored;
  if (/^(?:https?:|data:|blob:|asset:|tauri:)/u.test(stored)) return stored;
  if (!directory || !isTauri()) return stored;
  const separator = directory.includes("\\") ? "\\" : "/";
  const relative = separator === "\\" ? stored.replaceAll("/", "\\") : stored;
  const absolute = directory.endsWith(separator)
    ? `${directory}${relative}`
    : `${directory}${separator}${relative}`;
  try {
    return convertFileSrc(absolute);
  } catch {
    return stored;
  }
}
