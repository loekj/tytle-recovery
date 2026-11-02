// SPDX-License-Identifier: GPL-3.0-only
//
// A tiny way to make DOM elements. Text goes in as text (textContent), never
// as HTML, so nothing a node or a user sends can become page code.

export type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  /** data-role: how the tests find an element. */
  role?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
}

export function h<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.role) el.dataset.role = props.role;
  for (const [k, v] of Object.entries(props.attrs ?? {})) el.setAttribute(k, v);
  for (const [k, fn] of Object.entries(props.on ?? {})) if (fn) el.addEventListener(k, fn);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** A link that opens in a new tab and tells the other site nothing about this page. */
export function link(doc: Document, href: string, label: string): HTMLAnchorElement {
  return h(doc, 'a', { attrs: { href, target: '_blank', rel: 'noopener noreferrer' } }, label);
}
