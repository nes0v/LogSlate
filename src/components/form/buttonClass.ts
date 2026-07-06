// Shared button class strings. Keep height/radius/font-size in one place so
// a single change flows across the app. Compose with cn() when a call site
// needs an extra variant (e.g. destructive hover, font-weight).

export const BTN_BASE =
  'inline-flex items-center gap-1 h-8 px-3 text-sm rounded-(--radius)'

/** Primary accent action — the most common shape. */
export const BTN_ACCENT =
  `${BTN_BASE} bg-(--color-accent) text-(--color-accent-fg) hover:opacity-90 disabled:opacity-50`

/** Outlined neutral action (Cancel, Clear filters, secondary). */
export const BTN_OUTLINED =
  `${BTN_BASE} border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text) disabled:opacity-50 transition-colors`

/** Ghost — no border, hover lifts the bg. Used for Cancel in modals etc. */
export const BTN_GHOST =
  `${BTN_BASE} text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2) transition-colors`

/** Bordered neutral action in an editor toolbar (Models/Symbols sidebars).
 *  Compose with a hover-color variant via cn(); BTN_DELETE is the destructive one. */
export const BTN_ACTION =
  `${BTN_BASE} border border-(--color-border) text-(--color-text-dim) transition-colors`
export const BTN_DELETE = `${BTN_ACTION} hover:text-(--color-loss)`
