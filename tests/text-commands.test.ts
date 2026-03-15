import { describe, expect, test } from "bun:test";
import { getDefaultSettings } from "../src/settings";
import { applyTextCommands } from "../src/text-commands";

describe("text commands", () => {
  test("applies punctuation and structure commands", () => {
    const settings = getDefaultSettings();
    const output = applyTextCommands(
      "hello comma world new line new bullet first item period",
      settings,
      new Date("2026-03-14T10:30:00Z")
    );

    expect(output).toBe("hello, world\n\n- first item.");
  });

  test("expands insert timestamp command", () => {
    const settings = getDefaultSettings();
    const output = applyTextCommands(
      "meeting starts insert timestamp",
      settings,
      new Date("2026-03-14T08:05:00Z")
    );

    expect(output).toBe("meeting starts 2026-03-14T08:05:00.000Z");
  });

  test("expands insert timestamp alias", () => {
    const settings = getDefaultSettings();
    const output = applyTextCommands(
      "meeting starts insert time stamp",
      settings,
      new Date("2026-03-14T08:05:00Z")
    );

    expect(output).toBe("meeting starts 2026-03-14T08:05:00.000Z");
  });

  test("expands insert date command", () => {
    const settings = getDefaultSettings();
    const output = applyTextCommands(
      "today is insert date",
      settings,
      new Date("2026-03-14T08:05:00Z")
    );

    expect(output).toBe("today is 2026-03-14");
  });

  test("supports command aliases and punctuation boundaries", () => {
    const settings = getDefaultSettings();
    const output = applyTextCommands(
      "note insert the date. and insert the time stamp!",
      settings,
      new Date("2026-03-14T08:05:00Z")
    );

    expect(output).toBe("note 2026-03-14. and 2026-03-14T08:05:00.000Z!");
  });

  test("respects custom commands and disabled toggle", () => {
    const settings = getDefaultSettings();
    settings.customTextCommands = [{ phrase: "double dash", replacement: " -- " }];

    const enabledOutput = applyTextCommands("alpha double dash beta", settings);
    expect(enabledOutput).toBe("alpha -- beta");

    settings.textCommandsEnabled = false;
    const disabledOutput = applyTextCommands("alpha comma beta", settings);
    expect(disabledOutput).toBe("alpha comma beta");
  });
});
