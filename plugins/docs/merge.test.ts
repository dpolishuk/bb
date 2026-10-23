import { describe, expect, it } from "vitest";
import { mergeText } from "./merge.js";

const base =
  "# Plan\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n";

describe("mergeText", () => {
  it("combines edits to different paragraphs", () => {
    expect(
      mergeText(
        base,
        base.replace("First paragraph.", "First paragraph, typed."),
        base.replace("Third paragraph.", "Third paragraph, by the agent."),
      ),
    ).toBe(
      "# Plan\n\nFirst paragraph, typed.\n\nSecond paragraph.\n\nThird paragraph, by the agent.\n",
    );
  });

  it("keeps an appended paragraph next to an edit elsewhere", () => {
    expect(
      mergeText(
        base,
        base.replace("# Plan", "# Plan v2"),
        `${base}\nAppended by the agent.\n`,
      ),
    ).toBe(`${base.replace("# Plan", "# Plan v2")}\nAppended by the agent.\n`);
  });

  it("keeps a paragraph appended right after the paragraph being edited", () => {
    const short = "# Note\n\nBody.\n";
    expect(
      mergeText(short, "# Note\n\nBody, typed.\n", `${short}\nAppended.\n`),
    ).toBe("# Note\n\nBody, typed.\n\nAppended.\n");
  });

  it("refuses edits to the same paragraph", () => {
    expect(
      mergeText(
        base,
        base.replace("Second paragraph.", "Second, mine."),
        base.replace("Second paragraph.", "Second, theirs."),
      ),
    ).toBeNull();
  });

  it("refuses two different additions at the same place", () => {
    expect(mergeText(base, `${base}Mine.\n`, `${base}Theirs.\n`)).toBeNull();
  });

  it("accepts the same edit made on both sides", () => {
    const edited = base.replace("Second paragraph.", "Second, agreed.");
    expect(mergeText(base, edited, edited)).toBe(edited);
  });

  it("returns the other side when only one side changed", () => {
    const edited = base.replace("Third paragraph.", "Third, changed.");
    expect(mergeText(base, base, edited)).toBe(edited);
    expect(mergeText(base, edited, base)).toBe(edited);
  });
});
