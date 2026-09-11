import assert from 'node:assert/strict'
import test from 'node:test'
import type { Anime25DPlaybackLayer } from './types'
import { duplicateAccessoryLayers } from './accessoryDuplicate'

test('only exact repeated accessory art is removed; shadows, occluders and offsets survive', () => {
  const a={name:'pin',role:'headwear',group:'head',side:null,depth:1,fade:null,x:0,y:0,w:2,h:1} as Anime25DPlaybackLayer
  const b={...a,name:'pin-copy'}
  const image={width:2,height:1,pixels:new Uint8ClampedArray([200,10,20,255,20,40,60,128])}
  assert.deepEqual([...duplicateAccessoryLayers([a,b],()=>image)],[b])
  assert.equal(duplicateAccessoryLayers([a,{...b,x:1}],()=>image).size,0)
  assert.equal(duplicateAccessoryLayers([a,{...a,role:'front-hair'},b],()=>image).size,0)
  assert.equal(duplicateAccessoryLayers([a,b],l=>l===a ? image : {...image,pixels:new Uint8ClampedArray([200,10,20,255,20,40,60,127])}).size,0)
  assert.equal(duplicateAccessoryLayers([a,b],()=>null).size,0)
})
