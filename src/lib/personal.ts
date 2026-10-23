// Personal settings: home towns and name-based category rules. They live in
// config/personal.json, which is git-ignored, so the code can be public without them.
// Without that file the fake values from config/personal.example.json are used.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Personal = {
  homeCities: string[]; // human-readable, used in the AI categoriser's instructions
  homeTokens: string[]; // lowercase, accent-free substrings that mark a city as "home"
  extraRules: Record<string, string[]>; // category name → extra keyword patterns
};

const real = fileURLToPath(new URL("../../config/personal.json", import.meta.url));
const example = fileURLToPath(new URL("../../config/personal.example.json", import.meta.url));

function load(): Personal {
  const path = existsSync(real) ? real : example;
  if (path === example) console.warn("⚠️  config/personal.json not found — using the example values.");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    homeCities: raw.homeCities ?? [],
    homeTokens: (raw.homeTokens ?? []).map((t: string) => t.toLowerCase()),
    extraRules: raw.extraRules ?? {},
  };
}

export const personal: Personal = load();
