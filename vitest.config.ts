import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    include: [
      "src/editor/richMarkdown.test.ts",
      "src/editor/tables.test.ts",
      "src/editor/findReplace.test.ts",
      "src/editor/loadDocument.test.ts",
      "src/editor/codeHighlight.test.ts",
      "src/editor/outline.test.ts",
      "src/saveSession.test.ts",
      "src/editor/headingAnchor.test.ts",
    ],
  },
});
