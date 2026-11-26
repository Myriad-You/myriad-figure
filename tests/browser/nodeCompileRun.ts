import type { NodeRigPsdImportOptions } from '../../src/rig/node'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { isAnime25DPlayback } from '@myriad/figure-player'
import { compileRigPsdInNode } from '../../src/rig/node'

// The Node import of one PSD, run as its own process (the test runner cannot
// load the render layer's TypeScript): `tsx nodeCompileRun.ts <request.json>`.
// It writes the atlas, the reference picture and what it made into `out`.

export interface NodeCompileRequest {
  psd: string
  portrait: string
  out: string
  options: Omit<NodeRigPsdImportOptions, 'sourceMaster' | 'armVariants'> & {
    armVariants?: Array<Omit<NonNullable<NodeRigPsdImportOptions['armVariants']>[number], 'picture'> & { picture: string }>
  }
}

export interface NodeCompileResult {
  source: string
  playbackValid: boolean
  ms: number
  peakRssBytes: number
}

async function main() {
  const request = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as NodeCompileRequest
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
    playbackValid: isAnime25DPlayback(prepared.source.anime25dPlayback),
    ms,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
  } satisfies NodeCompileResult))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
