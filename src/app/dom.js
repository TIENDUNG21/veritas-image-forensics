/**
 * Minimal element builder. Text always goes through textContent, never innerHTML, because
 * most of what the panels show (EXIF strings, XMP, comments) comes from the analysed file.
 *
 * @typedef {{
 *   class?: string, text?: string | number, title?: string,
 *   attrs?: Record<string, string | number | boolean>,
 *   on?: Record<string, (event: any) => void>
 * }} Props
 * @typedef {Node | string | number | null | undefined | false} Child
 * @typedef {Child | Child[] | Child[][]} Children
 *   Nested arrays (up to two levels) are flattened, so panels can map rows to element pairs.
 */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Props} [props]
 * @param {...Children} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = String(props.text);
  if (props.title) el.title = props.title;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === false) continue;
    el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [event, handler] of Object.entries(props.on ?? {}))
    el.addEventListener(event, handler);
  for (const child of children.flat(2)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'object' ? child : String(child));
  }
  return el;
}

/** @param {Element} el */
export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
}

/**
 * @template {Element} T
 * @param {string} selector
 * @param {new () => T} type
 * @returns {T}
 */
export function byId(selector, type) {
  const el = document.getElementById(selector);
  if (!(el instanceof type)) throw new Error(`#${selector} is missing from index.html`);
  return el;
}

/**
 * Two-column definition table from [label, value] rows; empty values are skipped.
 * @param {[string, Child][]} rows
 */
export function factTable(rows) {
  return h(
    'dl',
    { class: 'facts' },
    rows
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => [h('dt', { text: k }), h('dd', {}, v)]),
  );
}
