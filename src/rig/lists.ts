/** Every item passes, an empty place as `undefined`: an array's own `every` steps over the places nothing was put in. */
export function everyItem(list: readonly unknown[], within: (item: unknown, index: number) => boolean): boolean {
  for (let index = 0; index < list.length; index += 1) {
    if (!within(list[index], index)) return false
  }
  return true
}
