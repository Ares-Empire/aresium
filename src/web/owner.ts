import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Owner = { name: string; street: string; city: string; email: string };
const KEYS = ["name", "street", "city", "email"] as const;

/** Server-only configuration. Errors describe the problem without including any file contents. */
export function loadOwner(): Owner {
  const path = process.env.ARES_OWNER_FILE ?? join(homedir(), ".config", "ares-empire", "owner.json");
  const fail = (problem: string): never => { throw new Error(`Owner file ${path}: ${problem}`); };
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    return fail(`cannot read file (${(error as NodeJS.ErrnoException).code ?? "unknown error"})`);
  }
  let owner: unknown;
  try {
    owner = JSON.parse(content);
  } catch {
    return fail("invalid JSON");
  }
  if (owner === null || typeof owner !== "object" || Array.isArray(owner)) {
    return fail("expected a JSON object");
  }
  if (Object.keys(owner).length !== KEYS.length || !KEYS.every((key) => Object.hasOwn(owner, key))) {
    return fail("expected exactly the keys name, street, city and email");
  }
  const fields = owner as Record<string, unknown>;
  for (const key of KEYS) {
    if (typeof fields[key] !== "string" || !fields[key].trim()) return fail(`${key} must be a non-empty string`);
  }
  return fields as Owner;
}
