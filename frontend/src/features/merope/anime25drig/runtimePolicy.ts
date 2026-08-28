export interface Anime25DAnimationState {
  atlasReady: boolean
  pageVisible: boolean
  inViewport: boolean
  cancelled: boolean
}

export function anime25DRuntimeKey(
  sourceMasterAssetId: string | null | undefined,
  contractVersion: number | null | undefined,
  atlasUrl: string,
): string {
  return `${sourceMasterAssetId ?? ''}:${contractVersion ?? ''}:${atlasUrl}`
}

export function shouldUseAnime25DRuntime(input: {
  hasManifest: boolean
  hasPlayback: boolean
  atlasUrl: string
  runtimeKey: string
  failedRuntimeKey: string | null
}): boolean {
  return Boolean(
    input.hasManifest &&
    input.hasPlayback &&
    input.atlasUrl &&
    input.failedRuntimeKey !== input.runtimeKey,
  )
}

export function shouldAnimateAnime25D(state: Anime25DAnimationState): boolean {
  return (
    state.atlasReady &&
    state.pageVisible &&
    state.inViewport &&
    !state.cancelled
  )
}
