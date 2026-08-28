export interface Anime25DAtlasRect {
  x: number
  y: number
  w: number
  h: number
}

export function localToAtlasUv(
  rect: Anime25DAtlasRect,
  localU: number,
  localV: number,
): readonly [number, number] {
  return [rect.x + localU * rect.w, rect.y + localV * rect.h]
}

export function atlasToLocalUv(
  rect: Anime25DAtlasRect,
  atlasU: number,
  atlasV: number,
): readonly [number, number] {
  if (rect.w <= 0 || rect.h <= 0) {
    throw new RangeError('Anime2.5D atlas rectangle must have positive area')
  }
  return [(atlasU - rect.x) / rect.w, (atlasV - rect.y) / rect.h]
}
