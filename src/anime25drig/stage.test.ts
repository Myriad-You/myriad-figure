import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// The stage draws whatever drives it and knows nothing of her performance: nothing it reaches, through any
// relative import or type import, is of the performance side.

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The performance side: its directories and files under src/. */
const PERFORMANCE_DIRECTORIES = ['motion', 'singing', 'speech', 'events', 'interaction', 'performance']
const PERFORMANCE_FILES = ['trace.ts', 'channel.ts', ...[
  'actingField',
  'behaviorMotion',
  'directedPose',
  'driverComposition',
  'faceShift',
  'motionComposer',
  'performanceCueDefinitions',
  'performanceCueSchedule',
  'performanceExpression',
  'performanceExpressionApply',
  'performanceExpressionShared',
  'performanceMotion',
  'player',
  'poseArbitration',
  'poseCompositor',
  'poseResponse',
  'randomAction',
  'scoreMoves',
  'speechExpression',
  'speechFormTransition',
  'speechMotion',
  'speechMotionCurves',
  'touchExpression',
].map(name => `anime25drig/${name}.ts`)]

function isPerformance(file: string): boolean {
  return PERFORMANCE_FILES.includes(file) || PERFORMANCE_DIRECTORIES.some(directory => file.startsWith(`${directory}/`))
}

/** Every module path a file names: imports, re-exports, `import('…')` types and dynamic imports. */
function specifiers(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      found.push(node.moduleSpecifier.text)
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
      found.push(node.argument.literal.text)
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
      found.push(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function resolveSpecifier(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier)
  const file = [`${base}.ts`, `${base}/index.ts`, base].find(candidate => existsSync(candidate))
  assert.ok(file, `${relative(SRC, from)} imports ${specifier}, which is not there`)
  return file
}

/** The files reached from `entry` (relative to src/) through relative imports, each with the file that reached it. */
function closure(entry: string): Map<string, string | null> {
  const reached = new Map<string, string | null>([[resolve(SRC, entry), null]])
  const pending = [resolve(SRC, entry)]
  while (pending.length > 0) {
    const file = pending.pop()!
    if (!file.endsWith('.ts')) continue
    for (const specifier of specifiers(file)) {
      if (!specifier.startsWith('.')) continue
      const next = resolveSpecifier(file, specifier)
      if (reached.has(next)) continue
      reached.set(next, file)
      pending.push(next)
    }
  }
  return new Map([...reached].map(([file, by]) => [relative(SRC, file), by && relative(SRC, by)]))
}

function performanceReached(entry: string): string[] {
  const reached = closure(entry)
  return [...reached.keys()].filter(isPerformance).map((file) => {
    const chain = [file]
    for (let by = reached.get(file); by; by = reached.get(by)) chain.push(by)
    return chain.join(' <- ')
  })
}

test('the stage reaches nothing of the performance side', () => {
  assert.deepEqual(performanceReached('anime25drig/stage.ts'), [])
})

test('the stage reaches the parts it draws with', () => {
  const reached = closure('anime25drig/stage.ts')
  for (const file of ['driving', 'bodyFrames', 'faceFrames', 'playerSwap', 'playerPackage', 'touchVisibility', 'webglRuntime'])
    assert.ok(reached.has(`anime25drig/${file}.ts`), file)
})

test('the player, which drives the stage with her performance, reaches it', () => {
  const reached = performanceReached('anime25drig/player.ts')
  for (const file of ['anime25drig/motionComposer.ts', 'motion/policy.ts', 'trace.ts'])
    assert.ok(reached.some(chain => chain.startsWith(`${file} <- `)), file)
})
