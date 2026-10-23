import { diffArrays } from "diff";

interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function hunksBetween(base: string[], other: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let index = 0;
  let current: Hunk | null = null;
  for (const part of diffArrays(base, other)) {
    if (!part.added && !part.removed) {
      if (current) hunks.push(current);
      current = null;
      index += part.count ?? part.value.length;
      continue;
    }
    current ??= { start: index, end: index, lines: [] };
    if (part.removed) {
      index += part.count ?? part.value.length;
      current.end = index;
    } else current.lines.push(...part.value);
  }
  if (current) hunks.push(current);
  return hunks;
}

function sameHunk(left: Hunk, right: Hunk): boolean {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.lines.join("") === right.lines.join("")
  );
}

function overlaps(left: Hunk, right: Hunk): boolean {
  const leftInserts = left.start === left.end;
  const rightInserts = right.start === right.end;
  if (leftInserts && rightInserts) return left.start === right.start;
  if (leftInserts) return right.start < left.start && left.start < right.end;
  if (rightInserts) return left.start < right.start && right.start < left.end;
  return left.start < right.end && right.start < left.end;
}

export function mergeText(
  base: string,
  ours: string,
  theirs: string,
): string | null {
  if (ours === base || ours === theirs) return theirs;
  if (theirs === base) return ours;
  const baseLines = splitLines(base);
  const ourHunks = hunksBetween(baseLines, splitLines(ours));
  const theirHunks = hunksBetween(baseLines, splitLines(theirs));
  const applied: Hunk[] = [...ourHunks];
  for (const hunk of theirHunks) {
    const overlapping = ourHunks.filter((ourHunk) => overlaps(ourHunk, hunk));
    if (overlapping.length === 0) applied.push(hunk);
    else if (!overlapping.every((ourHunk) => sameHunk(ourHunk, hunk)))
      return null;
  }
  applied.sort(
    (left, right) =>
      left.start - right.start ||
      Number(left.start !== left.end) - Number(right.start !== right.end),
  );
  let merged = "";
  let index = 0;
  for (const hunk of applied) {
    merged += baseLines.slice(index, hunk.start).join("") + hunk.lines.join("");
    index = hunk.end;
  }
  return merged + baseLines.slice(index).join("");
}
