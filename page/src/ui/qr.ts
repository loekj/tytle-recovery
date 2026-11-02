// SPDX-License-Identifier: GPL-3.0-only
//
// A QR code as an inline SVG, drawn from the QR matrix (uqr). No image file and
// no image host.

import { encode } from 'uqr';

const SVG = 'http://www.w3.org/2000/svg';

export function qrSvg(doc: Document, text: string, label: string): SVGSVGElement {
  const { size, data } = encode(text, { ecc: 'M', border: 2 });
  let d = '';
  data.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) d += `M${x} ${y}h1v1h-1z`;
  }));
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('class', 'qr');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = doc.createElementNS(SVG, 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#ffffff');
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000000');
  svg.append(bg, path);
  return svg;
}
