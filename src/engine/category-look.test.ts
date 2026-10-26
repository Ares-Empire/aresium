import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILT_IN_CATEGORIES, CATEGORY_LOOK, DEFAULT_CATEGORIES, categoryLook, CUSTOM_CATEGORY_LOOK } from "./categories.js";

test("every default and built-in category has a look with a hex colour", () => {
  for (const category of [...DEFAULT_CATEGORIES, ...BUILT_IN_CATEGORIES]) {
    const look = CATEGORY_LOOK[category.id];
    assert.ok(look, `no look for ${category.id}`);
    assert.match(look.color, /^#[0-9A-F]{6}$/);
    assert.ok(look.icon.length > 0);
  }
  assert.equal(Object.keys(CATEGORY_LOOK).length, DEFAULT_CATEGORIES.length + BUILT_IN_CATEGORIES.length);
});

test("an unknown (custom) category gets the neutral look", () => {
  assert.deepEqual(categoryLook("custom:abc"), CUSTOM_CATEGORY_LOOK);
});
