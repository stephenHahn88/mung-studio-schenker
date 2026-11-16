import { hslToRgb } from "../utils/hslToRgb";
import { classNameToHue } from "./classNameToHue";

export type ClassColorOverrides = Readonly<Record<string, string>>;

export function classNameToDefaultColor(className: string): string {
  const hue = ((classNameToHue(className) % 360) + 360) % 360;
  return rgbToHex(...hslToRgb(hue / 360, 1, 0.5));
}

export function classNameToColor(
  className: string,
  overrides: ClassColorOverrides = {},
): string {
  return overrides[className] ?? classNameToDefaultColor(className);
}

export function hexColorToRgb(color: string): [number, number, number] {
  const match = /^#([0-9A-Fa-f]{6})$/.exec(color);
  if (match === null) throw new Error(`Invalid #RRGGBB color: ${color}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}
