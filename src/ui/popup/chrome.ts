import { type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Bound the window rather than relying on overlay clipping (which loses the footer). */
export function popupHeight(rows: number): number {
  return Math.max(1, Math.min(36, Math.floor(rows * 0.9)));
}

export function popupWidth(columns = process.stdout.columns ?? 100): number {
  return Math.max(1, Math.min(110, columns - (columns >= 60 ? 12 : 2)));
}

/** Registry descriptions must not inject terminal controls or extra rows. */
export function singleLine(text: string): string {
  return Array.from(text, (char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159) ? " " : char;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function box(lines: string[], width: number, theme: Theme, title = "Extensions"): string[] {
  if (width < 2) return lines.map((line) => truncateToWidth(line, Math.max(0, width), ""));
  const inner = width - 2;
  const label = truncateToWidth(` ${title} `, inner, "");
  const left = Math.floor(Math.max(0, inner - visibleWidth(label)) / 2);
  const right = Math.max(0, inner - visibleWidth(label) - left);
  return [
    theme.fg("border", `╭${"─".repeat(left)}`) +
      theme.fg("accent", label) +
      theme.fg("border", `${"─".repeat(right)}╮`),
    ...lines.map(
      (line) =>
        theme.fg("border", "│") + truncateToWidth(line, inner, "…", true) + theme.fg("border", "│")
    ),
    theme.fg("border", `╰${"─".repeat(inner)}╯`),
  ];
}

export function hints(width: number, choices: string[]): string {
  return (
    choices.find((choice) => visibleWidth(choice) <= width) ??
    truncateToWidth(choices.at(-1) ?? "", width, "")
  );
}
