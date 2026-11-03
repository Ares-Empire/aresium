import assert from "node:assert/strict";
import { test } from "node:test";
import { paybackChoices, planPaybacks, applyPlan, type PaybackPayment } from "./payback-plan.js";
const p = (id: string, amount: number, date: string, counted?: number): PaybackPayment => ({
  id,
  amount,
  date,
  counted,
  day: 1,
  month: date.slice(0, 7),
  place: "Fictional " + id,
  categoryName: "Fictional category",
  tags: [],
  city: "",
  categoriesIn: amount < 0 ? ["Fictional category"] : [],
  incomeBuckets: amount > 0 ? ["Fictional category"] : [],
  paybackEligible: true
});
test(
  "one payer fills three expenses oldest first, last partially",
  () => {
    const d = {
      transactions: [
        p("c", -90, "2026-03-03"),
        p("a", -50, "2026-01-01"),
        p("b", -60, "2026-02-02"),
        p("in", 140, "2026-03-04")
      ]
    };
    const plan = planPaybacks(d, ["c", "b", "a"], ["in"]);
    assert.deepEqual(plan.links.map((l) => [l.to, l.amount]), [["a", 50], ["b", 60], ["c", 30]]);
    assert.equal(plan.stillOpen, 60);
    assert.equal(plan.staysIncome, 0);
  });
test(
  "three payers fill one expense, leaving last income; either selection direction",
  () => {
    const d = {
      transactions: [
        p("e", -100, "2026-01-01"),
        p("a", 40, "2026-01-02"),
        p("b", 50, "2026-01-03"),
        p("c", 60, "2026-01-04")
      ]
    };
    const plan = planPaybacks(d, ["a", "b", "c"], ["e"]);
    assert.deepEqual(plan.links.map((l) => l.amount), [40, 50, 10]);
    assert.equal(plan.staysIncome, 50);
    assert.deepEqual(planPaybacks(d, ["e"], ["c", "a", "b"]), plan);
  });
test(
  "existing pair receives only available cents and is raised, never overwritten",
  () => {
    const e = p("expense", -80, "2026-01-01", -50);
    const payer = {
      ...p("payer", 70, "2026-01-02", 40),
      paysBack: [{
        payment: "expense",
        amount: 30
      }]
    };
    const plan = planPaybacks({
      transactions: [e, payer]
    }, ["expense"], ["payer"]);
    assert.deepEqual(
      plan.links,
      [
        {
          from: "payer",
          to: "expense",
          amount: 40,
          totalAmount: 70
        }
      ]);
    assert.equal(plan.stillOpen, 10);
    const links = {
      payer: [{
        payment: "expense",
        amount: 30
      }]
    };
    assert.equal(applyPlan(links, plan).payer[0].amount, 70);
    assert.equal(links.payer[0].amount, 30);
  });
test(
  "single typed amount validates cents, both limits and both directions",
  () => {
    const d = {
      transactions: [p("e", -90, "2026-01-01"), p("p", 45, "2026-01-02")]
    };
    assert.equal(planPaybacks(d, ["e"], ["p"], 22.5).linked, 22.5);
    for (const amount of [0, -1, 45.01, 0.001, NaN, Infinity])
      assert.throws(() => planPaybacks(d, ["p"], ["e"], amount));
    assert.throws(() => planPaybacks(d, ["e"], ["p", "p"]));
    assert.throws(() => paybackChoices(d, ["p", "e"]));
  });
test(
  "suggestions rank half next day before unrelated amounts and exclude outside window",
  () => {
    const d = {
      transactions: [
        p("e", -90, "2026-01-10"),
        p("half", 45, "2026-01-11"),
        p("other", 42, "2026-01-10"),
        p("late", 90, "2026-09-01"),
        {
          ...p("transfer", 90, "2026-01-10"),
          paybackEligible: false
        }
      ]
    };
    const c = paybackChoices(d, ["e"]);
    assert.equal(c.suggestions[0].id, "half");
    assert.equal(c.suggestions[0].fit, "half");
    assert.ok(!c.suggestions.some((p) => p.id === "late"));
    assert.ok(c.candidates.some((p) => p.id === "late"));
    assert.ok(!c.candidates.some((p) => p.id === "transfer"));
  });
test(
  "group suggestions stretch window and exclusions report skipped count",
  () => {
    const d = {
      transactions: [
        p("a", -60, "2026-01-01"),
        p("b", -40, "2026-02-01"),
        {
          ...p("cash", -5, "2026-01-01"),
          paybackEligible: false
        },
        p("whole", 100, "2026-03-01"),
        p("half", 50, "2026-02-02")
      ]
    };
    const c = paybackChoices(d, ["a", "b", "cash"]);
    assert.equal(c.rest, 100);
    assert.equal(c.skipped, 1);
    assert.equal(c.suggestions.find((s) => s.id === "whole")?.fit, "whole");
    assert.equal(c.suggestions.find((s) => s.id === "half")?.fit, "half");
  });

test(
  "arbitrary payment ids cannot read or write Object prototype properties",
  () => {
    const d = {
      transactions: [p("constructor", -10, "2026-01-01"), p("__proto__", 10, "2026-01-02")]
    };
    const links = applyPlan({}, planPaybacks(d, ["constructor"], ["__proto__"]));
    assert.ok(Object.hasOwn(links, "__proto__"));
    assert.equal(links.__proto__[0].payment, "constructor");
    assert.equal(Object.prototype.hasOwnProperty("payment"), false);
  });
