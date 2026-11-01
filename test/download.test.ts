import { describe, expect, it } from "vitest";
import { extFor, fileNameFor } from "../frontend/src/lib/download";

describe("download 扩展名映射", () => {
  it("每种语言映射到正确扩展名", () => {
    expect(extFor("javascript")).toBe("js");
    expect(extFor("python")).toBe("py");
    expect(extFor("vue")).toBe("vue");
    expect(extFor("css")).toBe("css");
    expect(extFor("html")).toBe("html");
    expect(extFor("json")).toBe("json");
    expect(extFor("ini")).toBe("ini");
    expect(extFor("yaml")).toBe("yml");
    expect(extFor("toml")).toBe("toml");
    expect(extFor("markdown")).toBe("md");
    expect(extFor("plaintext")).toBe("txt");
  });

  it("未知语言回退 txt", () => {
    expect(extFor("rust")).toBe("txt");
  });

  it("文件名为 id.ext", () => {
    expect(fileNameFor("my-config", "markdown")).toBe("my-config.md");
    expect(fileNameFor("Ab3xY9kQ", "javascript")).toBe("Ab3xY9kQ.js");
  });
});
