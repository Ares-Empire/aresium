import assert from "node:assert/strict";
import { test } from "node:test";
import { selectionSummary } from "./selection.js";
const p = (id: string, categorySource = "rule", amount = -20) => ({
  id,
  date: "2026-01-01",
  day: 1,
  month: "2026-01",
  amount,
  categoryName: "Food",
  tags: [],
  place: "Fictional Shop",
  city: "",
  categoriesIn: ["Food"],
  incomeBuckets: [],
  merchant: "fictional",
  categorySource
});
test(
  "selection summary counts own-share cents and one eligible peer; manual and transfer peers stay",
  () => {
    const rows = [
      {
        ...p("a"),
        counted: -10
      },
      p("b"),
      p("manual", "manual"),
      {
        ...p("transfer"),
        categoriesIn: []
      }
    ];
    assert.deepEqual(
      selectionSummary(rows, ["a"]),
      {
        ids: ["a"],
        count: 1,
        side: "spend",
        total: 10,
        shops: 1,
        otherCount: 1,
        otherIDs: ["b"]
      });
    assert.throws(() => selectionSummary([...rows, p("in", "rule", 20)], ["a", "in"]));
    assert.throws(() => selectionSummary(rows, ["missing"]));
  });
