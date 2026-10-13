import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import { useDocumentDir } from "../documentDir";
import { displayImageSrc } from "./imageSrc";

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
      <img src={displayImageSrc(stored, directory)} alt={alt} />
    </NodeViewWrapper>
  );
}

