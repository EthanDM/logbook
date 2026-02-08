import { describe, expect, test } from "vitest";
import { parseNonNegativeInt, parsePositiveInt } from "../src/filters";

describe("filter parsers", () => {
  test("parsePositiveInt keeps valid positive values", () => {
    expect(parsePositiveInt("25", 10)).toBe(25);
  });

  test("parsePositiveInt falls back for invalid values", () => {
    expect(parsePositiveInt("0", 10)).toBe(10);
    expect(parsePositiveInt("-2", 10)).toBe(10);
    expect(parsePositiveInt("abc", 10)).toBe(10);
  });

  test("parseNonNegativeInt accepts zero and positives", () => {
    expect(parseNonNegativeInt("0", 7)).toBe(0);
    expect(parseNonNegativeInt("42", 7)).toBe(42);
  });

  test("parseNonNegativeInt falls back for invalid values", () => {
    expect(parseNonNegativeInt("-1", 7)).toBe(7);
    expect(parseNonNegativeInt("nope", 7)).toBe(7);
    expect(parseNonNegativeInt(null, 7)).toBe(7);
  });
});
