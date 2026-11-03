import assert from "node:assert/strict";
import { test } from "node:test";
import { quickSortGroups } from "./quick-sort.js";
const row = (id: string, amount: number, nameKey = "merchant:fictional", categoryName = "Uncategorised") => ({
  id,
  date: "2026-01-01",
  day: 1,
  month: "2026-01",
  amount,
  place: "Fictional Club",
  categoryName,
  city: "",
  tags: [],
  nameKey,
  categoriesIn: amount < 0 ? [categoryName] : [],
  incomeBuckets: amount > 0 ? [categoryName] : []
});
test(
  "quick sort separates directions, ranks count then counted money, excludes sorted and covered rows",
  () => {
    const groups = quickSortGroups(
      [
        row("one", -10),
        row("two", -20),
        row("income", 80),
        row("other", -100, "bank:other"),
        row("sorted", -50, "merchant:fictional", "Food"),
        {
          ...row("covered", -50),
          coveredBy: ["receipt"]
        }
      ],
      {
        one: "Fictional membership",
        two: "Fictional membership"
      });
    assert.equal(groups.length, 3);
    assert.equal(groups[0].count, 2);
    assert.equal(groups[0].total, 30);
    assert.deepEqual(groups[0].examples, ["Fictional membership"]);
    assert.deepEqual(groups.map((g) => g.side), ["spend", "spend", "income"]);
  });
