import type { NodeRigPsdImportOptions } from '../../src/rig/node'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { isAnime25DPlayback } from '@myriad/figure-player'
import { compileRigPsdInNode } from '../../src/rig/node'
import { nodeRigRaster } from '../../src/rig/node/raster'
import { findingsOf } from './fixture/findings'

// The Node import of one PSD, run as its own process (the test runner cannot
// load the render layer's TypeScript): `tsx nodeCompileRun.ts <request.json>`.
// It writes the atlas, the reference picture and what it made into `out`. A
// request with `place` instead stretches one picture onto frames, as the
// import fits a portrait onto a PSD, and writes each frame's RGBA.

export interface NodeCompileRequest {
  psd: string
  portrait: string
  out: string
  options: Omit<NodeRigPsdImportOptions, 'sourceMaster' | 'armVariants'> & {
    armVariants?: Array<Omit<NonNullable<NodeRigPsdImportOptions['armVariants']>[number], 'picture'> & { picture: string }>
  }
}

/** A picture (the PNG unless `jpeg`) stretched onto `to` of a `width` × `height` frame. */
export interface PlaceCase {
  name: string
  jpeg?: boolean
  width: number
  height: number
  to: { x: number; y: number; width: number; height: number }
}

export interface NodePlaceRequest {
  place: PlaceCase[]
  png: string
  jpeg: string
  out: string
}

export interface NodeCompileResult {
  source: string
  findings: string
  playbackValid: boolean
  ms: number
  peakRssBytes: number
}

async function place({ place: cases, png, jpeg, out }: NodePlaceRequest) {
  const pictures = {
    png: await nodeRigRaster.decode(new Blob([readFileSync(png)])),
    jpeg: await nodeRigRaster.decode(new Blob([readFileSync(jpeg)])),
  }
  for (const { name, jpeg: fromJpeg, width, height, to } of cases) {
    writeFileSync(join(out, `${name}.rgba`), nodeRigRaster.place(fromJpeg ? pictures.jpeg : pictures.png, width, height, to)!.data)
  }
}

async function main() {
  const request = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as NodeCompileRequest | NodePlaceRequest
  if ('place' in request) return place(request)
  const started = performance.now()
  const { prepared } = await compileRigPsdInNode(readFileSync(request.psd), {
    ...request.options,
    sourceMaster: readFileSync(request.portrait),
    armVariants: (request.options.armVariants ?? []).map(({ picture, ...variant }) => ({ ...variant, picture: readFileSync(picture) })),
  })
  const ms = performance.now() - started
  writeFileSync(join(request.out, 'atlas.png'), await prepared.atlas.bytes())
  writeFileSync(join(request.out, 'analysisReference.png'), await prepared.analysisReference.bytes())
  writeFileSync(join(request.out, 'result.json'), JSON.stringify({
    source: JSON.stringify(prepared.source),
    findings: JSON.stringify(findingsOf(prepared)),
    playbackValid: isAnime25DPlayback(prepared.source.anime25dPlayback),
    ms,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
  } satisfies NodeCompileResult))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
