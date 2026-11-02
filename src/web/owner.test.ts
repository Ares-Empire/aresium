import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadOwner } from "./owner.js";

const directory = mkdtempSync(join(process.cwd(), ".test-owner-loader-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const path = join(directory, "owner.json");
const owner = { name: "Example Owner", street: "Example Street 1", city: "Example City", email: "owner@example.org" };
process.env.ARES_OWNER_FILE = path;

test("the owner file comes from ARES_OWNER_FILE and preserves its strings", () => {
  const expected = { ...owner, name: " Example Owner " };
  writeFileSync(path, JSON.stringify(expected));
  assert.deepEqual(loadOwner(), expected);
});

test("the default owner file is under the service user's home directory", () => {
  const config = join(directory, ".config", "ares-empire");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "owner.json"), JSON.stringify(owner));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: directory };
  delete env.ARES_OWNER_FILE;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval",
    `import { loadOwner } from ${JSON.stringify(new URL("./owner.ts", import.meta.url).href)}; console.log(JSON.stringify(loadOwner()));`,
  ], { env, encoding: "utf8", timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), owner);
});

test("the owner file requires an object with exactly the four known keys", () => {
  for (const invalid of [null, [], "private-test-value", 1, true,
    { ...owner, email: undefined }, { ...owner, "private-test-key": "private-test-value" },
    { name: owner.name, street: owner.street, city: owner.city, "private-test-key": owner.email },
  ]) {
    writeFileSync(path, JSON.stringify(invalid));
    assert.throws(loadOwner, (error: Error) => {
      assert.ok(error.message.includes(path));
      assert.match(error.message, /expected a JSON object|expected exactly the keys name, street, city and email/);
      assert.doesNotMatch(error.message, /private-test|Example|owner@example/);
      return true;
    });
  }
});

test("every owner field must be a non-empty string, without logging invalid values", () => {
  for (const key of ["name", "street", "city", "email"] as const) {
    for (const value of ["", " \t\n", null, false, 42, [], { secret: "private-test-value" }]) {
      writeFileSync(path, JSON.stringify({ ...owner, [key]: value }));
      assert.throws(loadOwner, { message: `Owner file ${path}: ${key} must be a non-empty string` });
    }
  }
});

test("missing and unreadable owner files and malformed JSON report only the path and problem", () => {
  rmSync(path);
  assert.throws(loadOwner, { message: `Owner file ${path}: cannot read file (ENOENT)` });
  mkdirSync(path);
  assert.throws(loadOwner, { message: `Owner file ${path}: cannot read file (EISDIR)` });
  rmSync(path, { recursive: true });
  writeFileSync(path, '{"email":"private-test-value",');
  assert.throws(loadOwner, { message: `Owner file ${path}: invalid JSON` });
});

test("the web server fails before listening when the owner file is missing or invalid", () => {
  const cases = [
    { content: undefined, problem: "cannot read file (ENOENT)" },
    { content: '{"email":"private-test-value",', problem: "invalid JSON" },
    { content: JSON.stringify({ ...owner, secret: "private-test-value" }), problem: "expected exactly the keys name, street, city and email" },
    { content: JSON.stringify({ ...owner, street: " " }), problem: "street must be a non-empty string" },
  ];
  for (const { content, problem } of cases) {
    rmSync(path, { force: true });
    if (content !== undefined) writeFileSync(path, content);
    const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./server.ts", import.meta.url))], {
      env: { ...process.env, ARES_OWNER_FILE: path }, encoding: "utf8", timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.includes(`Owner file ${path}: ${problem}`));
    assert.doesNotMatch(result.stdout + result.stderr, /private-test-value|Example Owner|Example Street|Example City|owner@example\.org|Aresium dashboard/);
  }
});
