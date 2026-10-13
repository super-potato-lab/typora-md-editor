import { createContext, useContext } from "react";

const DocumentDirContext = createContext<string | null>(null);

export const DocumentDirProvider = DocumentDirContext.Provider;

export function useDocumentDir(): string | null {
  return useContext(DocumentDirContext);
}
