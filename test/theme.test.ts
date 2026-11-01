import { describe, expect, it } from "vitest";
import { nextTheme } from "../frontend/src/lib/theme";

describe("nextTheme 三态循环", () => {
  it("浅色 → 深色", () => {
    expect(nextTheme("light")).toBe("dark");
  });

  it("深色 → 跟随系统", () => {
    expect(nextTheme("dark")).toBe("system");
  });

  it("跟随系统 → 浅色", () => {
    expect(nextTheme("system")).toBe("light");
  });
});
