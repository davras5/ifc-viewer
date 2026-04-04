/**
 * Color palette utilities for the "Color by Column" feature.
 */

/**
 * Generate N visually distinct colors using evenly-spaced HSL hues.
 * @param {number} n
 * @returns {string[]} CSS hsl() strings
 */
export function categoricalPalette(n) {
  const colors = [];
  for (let i = 0; i < n; i++) {
    const hue = (i * 360 / n) % 360;
    colors.push(`hsl(${Math.round(hue)}, 70%, 55%)`);
  }
  return colors;
}

/**
 * Generate a sequential gradient from blue (240) to red (0).
 * @param {number} n
 * @returns {string[]} CSS hsl() strings
 */
export function gradientPalette(n) {
  const colors = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const hue = Math.round(240 - t * 240);
    colors.push(`hsl(${hue}, 75%, 50%)`);
  }
  return colors;
}

/**
 * Convert a CSS color string to a hex number for Three.js.
 * @param {string} cssColor — any valid CSS color (hsl, rgb, named, etc.)
 * @returns {number} e.g. 0x44bb55
 */
export function cssColorToHex(cssColor) {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.fillStyle = cssColor;
  const hex = ctx.fillStyle; // always returns "#rrggbb"
  return parseInt(hex.slice(1), 16);
}
