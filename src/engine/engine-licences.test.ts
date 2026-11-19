import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Metafile } from "esbuild";
import { bundleEngineWithMetafile, enginePackages } from "../../scripts/build-engine.js";

// The iPhone app shows the licence of every outside package in the engine bundle (Settings → About → Fonts &
// licences), from the list `npm run engine` writes to dist/engine-licences.json.
test("the engine's licence list names exactly the packages whose code is in the bundle, each with its licence", async () => {
  const { metafile } = await bundleEngineWithMetafile();
  const packages = await enginePackages(metafile);
  assert.deepEqual(packages.map((p) => p.name), ["csv-parse", "fast-xml-parser", "fflate", "strnum"]);
  for (const p of packages) {
    assert.equal(p.licence, "MIT", p.name);
    assert.match(p.version, /^\d+\.\d+\.\d+/, p.name);
    assert.match(p.homepage, /^https:\/\/[^ ]+[^/.]$/, p.name);
    assert.match(p.text, /^Copyright \(c\) \d{4} .+$/m, p.name);
    assert.match(p.text, /Permission is hereby granted, free of charge/, p.name);
  }
});

// A made-up package folder (fictional-package), listed in a made-up esbuild record.
const record = (inputs: Record<string, number>): Metafile => ({ inputs: {}, outputs: { "out.js": { bytes: 1, imports: [],
  exports: [], inputs: Object.fromEntries(Object.entries(inputs).map(([path, bytesInOutput]) => [path, { bytesInOutput }])) } } });

test("a package needs a licence file and a licence name; code left out of the bundle needs neither", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engine-licences-"));
  try {
    const folder = join(dir, "node_modules", "fictional-package");
    await mkdir(folder, { recursive: true });
    const input = { [join(folder, "index.js")]: 1 };
    await writeFile(join(folder, "package.json"), JSON.stringify({ name: "fictional-package", version: "1.0.0", license: "MIT" }));
    await assert.rejects(enginePackages(record(input)), /fictional-package ships no licence file/);
    assert.deepEqual(await enginePackages(record({ [join(folder, "index.js")]: 0, "src/engine/index.ts": 1 })), []);

    await writeFile(join(folder, "LICENSE.md"), "Copyright (c) 2026 Fictional Author\r\n\r\nMade-up licence text.\r\n");
    await writeFile(join(folder, "package.json"), JSON.stringify({ name: "fictional-package", version: "1.0.0" }));
    await assert.rejects(enginePackages(record(input)), /fictional-package names no licence/);

    await writeFile(join(folder, "package.json"), JSON.stringify({ name: "fictional-package", version: "1.0.0",
      license: "MIT", repository: { type: "git", url: "git+https://example.invalid/fictional-package.git" } }));
    assert.deepEqual(await enginePackages(record(input)), [{ name: "fictional-package", version: "1.0.0", licence: "MIT",
      homepage: "https://example.invalid/fictional-package",
      text: "Copyright (c) 2026 Fictional Author\n\nMade-up licence text." }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** A made-up package folder with a licence: its index.js as the bundle's record names it. */
async function fictionalPackage(folder: string, manifest: object, licence: string): Promise<string> {
  await mkdir(join(folder, "lib"), { recursive: true });
  await writeFile(join(folder, "package.json"), JSON.stringify({ license: "MIT", ...manifest }));
  await writeFile(join(folder, "lib", "package.json"), JSON.stringify({ type: "module" })); // a nameless one inside
  await writeFile(join(folder, "LICENSE"), licence);
  return join(folder, "lib", "index.js");
}

test("a package linked from outside node_modules is listed like any other", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engine-licences-"));
  try {
    // esbuild records a linked package by its real path, which has no node_modules in it.
    const file = await fictionalPackage(join(dir, "packages", "fictional-linked"),
      { name: "@fictional/linked", version: "0.1.0" }, "Copyright (c) 2026 Fictional Author");
    assert.deepEqual((await enginePackages(record({ [file]: 1 }))).map((p) => [p.name, p.version]),
      [["@fictional/linked", "0.1.0"]]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two copies of a package are one entry with both versions, or stop the build when their licences differ", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engine-licences-"));
  try {
    const licence = "Copyright (c) 2026 Fictional Author";
    const first = await fictionalPackage(join(dir, "node_modules", "fictional-copy"),
      { name: "fictional-copy", version: "1.10.0" }, licence);
    const nested = join(dir, "node_modules", "fictional-user", "node_modules", "fictional-copy");
    const second = await fictionalPackage(nested, { name: "fictional-copy", version: "1.9.0" }, licence);
    const both = record({ [first]: 1, [second]: 1 });
    assert.deepEqual((await enginePackages(both)).map((p) => [p.name, p.version]), [["fictional-copy", "1.9.0, 1.10.0"]]);
    await writeFile(join(nested, "LICENSE"), "Copyright (c) 2025 Another Fictional Author");
    await assert.rejects(enginePackages(both), /fictional-copy is bundled twice with different licences/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("code from one of esbuild's namespaces, which has no folder, stops the build", async () => {
  await assert.rejects(enginePackages(record({ "(disabled):fs": 12 })), /Bundled code from outside a file/);
  assert.deepEqual(await enginePackages(record({ "(disabled):fs": 0 })), []);
});
