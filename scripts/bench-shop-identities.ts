// Fictional distinct keys, including long completions, legal forms, reordered names and known chains.
import { performance } from "node:perf_hooks";
import { shopIdentities } from "../src/engine/index.js";

const keys = Array.from({ length: 1000 }, (_, i) => [
  `Fiktivbetrieb ${i} Haupt`, `Fiktivbetrieb ${i} Hauptniederlassung`, `Fiktivbetrieb ${i} LLC`,
  `Fiktivname${i} Beispiel`, `REWE Filiale ${i}`,
]).flat();
for (let i = 0; i < 5; i++) shopIdentities(keys);
const times = Array.from({ length: 15 }, () => {
  const start = performance.now();
  const results = shopIdentities(keys);
  const elapsed = performance.now() - start;
  if (results.length !== keys.length) throw new Error("Wrong identity count");
  return elapsed;
}).sort((a, b) => a - b);
console.log(`${new Set(keys).size} distinct fictional keys; ${times.length} runs after 5 warmups; Node ${process.version}`);
console.log(`median ${times[7].toFixed(2)} ms; min ${times[0].toFixed(2)} ms; max ${times.at(-1)!.toFixed(2)} ms`);
