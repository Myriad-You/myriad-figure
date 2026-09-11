import type { Anime25DPlaybackLayer } from './types'
import type { CroppedLayerPixels } from './webglRuntime'

const accessories = new Set(['neckwear', 'headwear', 'earwear', 'eyewear'])
/** Only identical authored layers, including alpha, bounds and playback state.
 * Embedded remnants need background reconstruction: never erase them by colour alone. */
export function duplicateAccessoryLayers(
  layers: readonly Anime25DPlaybackLayer[],
  read: (layer: Anime25DPlaybackLayer) => CroppedLayerPixels | null,
): Set<Anime25DPlaybackLayer> {
  const duplicates = new Set<Anime25DPlaybackLayer>()
  for (let i=0;i<layers.length;i++) {
    const a=layers[i]
    if (!accessories.has(a.role)) continue
    for(let j=0;j<i;j++) {
      const b=layers[j]
      // Removing the front copy across another drawing can change occlusion.
      if (layers.slice(j+1,i).some(l => l.x<a.x+a.w && l.x+l.w>a.x && l.y<a.y+a.h && l.y+l.h>a.y)) continue
      if(duplicates.has(b) || a.role!==b.role || a.side!==b.side || a.group!==b.group ||
        a.depth!==b.depth || a.fade!==b.fade || a.x!==b.x || a.y!==b.y || a.w!==b.w || a.h!==b.h) continue
      const pa=read(a), pb=read(b)
      if(!pa || !pb || pa.width!==pb.width || pa.height!==pb.height || pa.pixels.length!==pb.pixels.length) continue
      if(pa.pixels.every((v,k)=>v===pb.pixels[k])) { duplicates.add(a); break }
    }
  }
  return duplicates
}
