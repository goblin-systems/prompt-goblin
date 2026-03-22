import { describe, expect, test } from "bun:test";
import { escapeWhitespaceForLog } from "../src/string-utils";

describe("escapeWhitespaceForLog", () => {
  test("makes newline and tabs visible", () => {
    const input = "line1\nline2\r\n\tend";
    const output = escapeWhitespaceForLog(input);
    expect(output).toBe("line1\\nline2\\r\\n\\tend");
  });
});
