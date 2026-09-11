import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every colour the app prints on every ground it prints it on.
 *
 * This exists because the palette was rewritten blind and shipped nine
 * unreadable pairs — the worst of them the faint grey that carries the entire
 * meta line under every task, at 2.58:1 on the page it sits on. Nobody sees a
 * contrast ratio while writing CSS; a test does.
 *
 * The rule is not decoration. `--text-faint` is the app's quietest colour by
 * design, and the temptation whenever a screen looks busy is to make it
 * quieter still. Below 3:1 it stops being quiet and starts being invisible,
 * and the fix for a busy screen was never the grey.
 */
// Vitest runs from the repo root, and the stylesheet is read as text rather
// than imported: this test is about the values a browser will resolve, not
// about anything the bundler does to them.
const TOKENS = readFileSync(join(process.cwd(), "src/styles/tokens.css"), "utf8");

function theme(selector: string): Record<string, string> {
  const start = TOKENS.indexOf(selector);
  if (start < 0) throw new Error(`No ${selector} block in tokens.css`);
  const body = TOKENS.slice(
    TOKENS.indexOf("{", start) + 1,
    TOKENS.indexOf("}", start),
  );
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(
    /(--[a-z0-9-]+):\s*([^;]+);/g,
  )) {
    out[name!] = value!.trim();
  }
  return out;
}

const LIGHT = theme(":root {");
const DARK = { ...LIGHT, ...theme('[data-theme="dark"] {') };

/** Resolves `var(--x)` chains down to the `#rrggbb` behind them. */
function rgb(token: string, palette: Record<string, string>): [number, number, number] {
  let value = palette[token];
  if (!value) throw new Error(`Unknown token ${token}`);
  while (value.startsWith("var(")) {
    const inner = value.slice(4, -1).trim();
    value = palette[inner] ?? "";
    if (!value) throw new Error(`Unknown token ${inner}`);
  }
  const hex = value.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(
  fg: [number, number, number],
  bg: [number, number, number],
): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * 4.5 is the readable-text bar; 3.0 covers the quiet meta line, which is 11px
 * but never carries anything you have to read to use the app, and coloured
 * marks that only have to be *seen*.
 */
const PAIRS: [fg: string, bg: string, min: number][] = [
  ["--text", "--bg", 4.5],
  ["--text", "--surface", 4.5],
  ["--text", "--surface-2", 4.5],
  ["--text-muted", "--bg", 4.5],
  ["--text-muted", "--surface", 4.5],
  ["--text-muted", "--surface-2", 4.5],
  ["--text-muted", "--surface-3", 4.5],
  ["--text-faint", "--bg", 3.0],
  ["--text-faint", "--surface", 3.0],
  ["--text-faint", "--surface-2", 3.0],
  ["--accent", "--surface", 3.0],
  ["--accent", "--bg", 3.0],
  ["--accent", "--accent-soft", 4.5],
  ["--accent-text", "--accent", 4.5],
  ["--danger", "--surface", 3.0],
  ["--danger", "--danger-soft", 4.5],
  ["--warning", "--surface", 3.0],
  ["--warning", "--warning-soft", 4.5],
  ["--success", "--surface", 3.0],
  ["--success", "--success-soft", 4.5],
];

/**
 * The tone ladder that replaced 102 hairline borders.
 *
 * Every one of these pairs is two surfaces that touch with nothing drawn
 * between them, so each has to be told apart by tone alone. 1.04 is about
 * where a flat field stops reading as one field — below it the app looks like
 * the borders were simply deleted, which is exactly what a careless edit to
 * these four values would do.
 */
const LADDER: [a: string, b: string, why: string][] = [
  ["--bg", "--surface", "the sidebar against the content sheet"],
  ["--surface", "--surface-2", "a card, an input or a hovered row on the sheet"],
  ["--surface-2", "--surface-3", "a tray or a track inside a card"],
  ["--surface", "--surface-3", "a deep inset straight on the sheet"],
];

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
])("the %s palette", (_name, palette) => {
  it.each(PAIRS)("prints %s on %s at %s:1 or better", (fg, bg, min) => {
    expect(contrast(rgb(fg, palette), rgb(bg, palette))).toBeGreaterThanOrEqual(
      min,
    );
  });

  it.each(LADDER)("separates %s from %s — %s", (a, b) => {
    expect(contrast(rgb(a, palette), rgb(b, palette))).toBeGreaterThanOrEqual(
      1.04,
    );
  });
});
