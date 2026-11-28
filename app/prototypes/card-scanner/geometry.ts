// Camera-view geometry shared by the scan view and the worker: the guide frame, object-fit: cover mapping
// between element and video pixels, and the crop sent to the worker. Pure.

import { CARD_RATIO, CROP_MARGIN, FRAME_HEIGHT } from "./data";

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

/** Guide frame inside the camera element, in element pixels (matches the CSS overlay). */
export function guideFrame(elementWidth: number, elementHeight: number): Rect {
  let height = elementHeight * FRAME_HEIGHT;
  let width = height * CARD_RATIO;
  if (width > elementWidth * 0.92) {
    width = elementWidth * 0.92;
    height = width / CARD_RATIO;
  }
  return { x: (elementWidth - width) / 2, y: (elementHeight - height) / 2, width, height };
}

function cover(element: Size, source: Size) {
  const scale = Math.max(element.width / source.width, element.height / source.height);
  return { scale, offsetX: (element.width - source.width * scale) / 2, offsetY: (element.height - source.height * scale) / 2 };
}

/** Maps an element-space rectangle to source pixels for an `object-fit: cover` media element. */
export function coverToSource(rect: Rect, element: Size, source: Size): Rect {
  const { scale, offsetX, offsetY } = cover(element, source);
  return { x: (rect.x - offsetX) / scale, y: (rect.y - offsetY) / scale, width: rect.width / scale, height: rect.height / scale };
}

/** Maps a source-pixel point to element pixels (inverse of coverToSource). */
export function sourceToCover(x: number, y: number, element: Size, source: Size): [number, number] {
  const { scale, offsetX, offsetY } = cover(element, source);
  return [x * scale + offsetX, y * scale + offsetY];
}

/** The guide plus CROP_MARGIN on every side, clamped to the source: the region the worker looks at. */
export function cropAround(guide: Rect, source: Size): Rect {
  const mx = guide.width * CROP_MARGIN;
  const my = guide.height * CROP_MARGIN;
  const x = Math.max(0, Math.floor(guide.x - mx));
  const y = Math.max(0, Math.floor(guide.y - my));
  return {
    x,
    y,
    width: Math.min(source.width, Math.ceil(guide.x + guide.width + mx)) - x,
    height: Math.min(source.height, Math.ceil(guide.y + guide.height + my)) - y,
  };
}
