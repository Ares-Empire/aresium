import { text, type Language } from "../lib/texts.js";

type ImportErrorKey = "camtDocument" | "camtType" | "paypalColumns" | "bankColumns" | "invalidFile";

// Keep the reason separate from its wording until the API knows the request language.
export class ImportFileError extends Error {
  constructor(readonly key: ImportErrorKey) {
    super(text(key, "en"));
  }
}

export function importErrorText(error: unknown, language: Language): string {
  return text(error instanceof ImportFileError ? error.key : "importFailed", language);
}
