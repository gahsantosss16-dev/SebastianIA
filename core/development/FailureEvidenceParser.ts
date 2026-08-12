import { dirname, join, sep } from 'node:path';

/**
 * Real evidence extracted from a validation's own captured output - never
 * guessed, never asked of the user. `actualLiteral`/`expectedLiteral` come
 * from Node's own assertion failure format (`assert.strictEqual`/`equal`,
 * which every test in this project and any Node-based fixture already
 * produces); `testFilePath` comes from `node --test`'s own "test at
 * <file>:<line>:<col>" report line. Both are `undefined` when the validation
 * output does not contain this specific, recognizable shape - this parser
 * never falls back to guessing.
 */
export interface FailureEvidence {
  readonly actualLiteral?: string;
  readonly expectedLiteral?: string;
  readonly testFilePath?: string;
}

const TEST_FILE_LINE_PATTERN = /^test at (.+?):\d+:\d+/m;
const STRUCTURED_ACTUAL_PATTERN = /^\s*actual:\s*([^\n,]+),?\s*$/m;
const STRUCTURED_EXPECTED_PATTERN = /^\s*expected:\s*([^\n,]+),?\s*$/m;
const SIMPLE_COMPARISON_PATTERN = /^\s*(\S.*?)\s+!==\s+(\S.*?)\s*$/m;

const UNUSABLE_LITERALS: ReadonlySet<string> = new Set(['undefined', 'null', 'NaN', 'true', 'false']);

/**
 * Parses the actual/expected values and the failing test's own file out of
 * a validation's combined stdout+stderr. Deliberately narrow: only single-
 * line, primitive comparison failures (numbers, strings, booleans) are
 * recognized - a multi-line or object/array diff is left unparsed rather
 * than guessed at.
 */
export function parseFailureEvidence(output: string): FailureEvidence {
  const testFileMatch = output.match(TEST_FILE_LINE_PATTERN);
  const testFilePath = testFileMatch?.[1]?.trim();

  const structuredActual = output.match(STRUCTURED_ACTUAL_PATTERN)?.[1];
  const structuredExpected = output.match(STRUCTURED_EXPECTED_PATTERN)?.[1];

  let actualLiteral = structuredActual;
  let expectedLiteral = structuredExpected;

  if (!isUsableLiteral(actualLiteral) || !isUsableLiteral(expectedLiteral)) {
    const simpleMatch = output.match(SIMPLE_COMPARISON_PATTERN);
    actualLiteral = simpleMatch?.[1];
    expectedLiteral = simpleMatch?.[2];
  }

  const result: {
    actualLiteral?: string;
    expectedLiteral?: string;
    testFilePath?: string;
  } = {};
  if (isUsableLiteral(actualLiteral) && isUsableLiteral(expectedLiteral) && actualLiteral !== expectedLiteral) {
    result.actualLiteral = actualLiteral.trim();
    result.expectedLiteral = expectedLiteral.trim();
  }
  if (testFilePath !== undefined && testFilePath !== '') {
    result.testFilePath = testFilePath;
  }
  return result;
}

function isUsableLiteral(value: string | undefined): value is string {
  if (value === undefined) {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return false;
  }
  if (UNUSABLE_LITERALS.has(trimmed)) {
    return false;
  }
  // Skip anything that looks like a multi-line/object/array dump - this
  // parser only ever proposes a fix from a single, primitive literal.
  return !/[{[\n]/.test(trimmed);
}

const RELATIVE_IMPORT_PATTERNS: readonly RegExp[] = [
  /require\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  /from\s+['"](\.[^'"]+)['"]/g,
];

/**
 * Extracts the relative source files a failing test file itself imports,
 * resolved against the test file's own directory - the only file-discovery
 * mechanism this block uses. Never a workspace-wide scan: a test that
 * imports nothing relevant simply yields no candidates.
 */
export function extractImportedRelativePaths(testFileContent: string, testFilePath: string): readonly string[] {
  const baseDir = dirname(testFilePath);
  const found: string[] = [];

  for (const pattern of RELATIVE_IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(testFileContent)) !== null) {
      const rawImport = match[1];
      if (rawImport === undefined) {
        continue;
      }
      const resolved = normalizeToForwardSlashes(join(baseDir, rawImport));
      if (!found.includes(resolved)) {
        found.push(resolved);
      }
    }
  }

  return found;
}

function normalizeToForwardSlashes(path: string): string {
  return path.split(sep).join('/');
}
