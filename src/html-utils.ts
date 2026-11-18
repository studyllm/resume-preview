/**
 * HTML Utilities
 * Single Responsibility: HTML escaping shared across the renderer layers.
 *
 * The escaping used to be implemented twice — once in page-renderer.ts and
 * once in live-server.ts. It now lives here so the resume renderer can reuse
 * it instead of adding a third copy.
 */

/**
 * Escapes HTML special characters to prevent XSS attacks
 */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
