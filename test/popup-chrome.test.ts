import assert from "node:assert/strict";
import test from "node:test";
import { type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { box, hints, popupHeight, popupWidth, singleLine } from "../src/ui/popup/chrome.js";

const theme = {
  fg: (_color: string, text: string) => text,
  style: (text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

void test("popupHeight stays inside the terminal and never collapses", () => {
  assert.equal(popupHeight(40), 36);
  assert.equal(popupHeight(20), 18);
  assert.equal(popupHeight(100), 36);
  assert.equal(popupHeight(2), 1);
  assert.equal(popupHeight(8), 7);
});

void test("popupWidth keeps a margin on wide terminals and clamps the rest", () => {
  assert.equal(popupWidth(200), 110);
  assert.equal(popupWidth(120), 108);
  assert.equal(popupWidth(100), 88);
  assert.equal(popupWidth(59), 57);
  assert.equal(popupWidth(60), 48);
  assert.equal(popupWidth(10), 8);
  assert.equal(popupWidth(1), 1);
});

void test("singleLine strips terminal controls and collapses whitespace", () => {
  assert.equal(singleLine("  Hello\n\tWorld\u0007  "), "Hello World");
  assert.equal(singleLine("a\u001b[31mb"), "a [31mb");
  assert.equal(singleLine(""), "");
  assert.ok(!singleLine("safe\u009btext").includes("\u009b"));
});

void test("box frames every line and never exceeds the requested width", () => {
  const lines = box(["alpha", "beta"], 20, theme, "Extensions");
  assert.equal(lines.length, 4);
  assert.ok(lines[0]?.includes("Extensions"));
  for (const line of lines) assert.ok(visibleWidth(line) <= 20, line);
  assert.ok(lines[1]?.includes("alpha"));
});

void test("box truncates oversized content and degrades on unusable widths", () => {
  const lines = box(["x".repeat(80)], 12, theme, "Title");
  for (const line of lines) assert.ok(visibleWidth(line) <= 12, line);
  assert.deepEqual(
    box(["plain"], 1, theme).map((line) => line.split("\u001b")[0]),
    ["p"]
  );
});

void test("hints prefer the first choice that fits and otherwise truncate", () => {
  const choices = ["long hint text", "short", "tiny"];
  assert.equal(hints(20, choices), "long hint text");
  assert.equal(hints(10, choices), "short");
  assert.equal(hints(4, choices), "tiny");
  assert.equal(hints(2, ["abcdef"]).split("\u001b")[0], "ab");
  assert.equal(hints(10, []), "");
});
