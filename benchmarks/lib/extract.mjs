// @ts-check

/** Matches a fenced code block, capturing an optional info string and body. */
const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\n`~]*)\n([\s\S]*?)\n?\1\2[ \t]*$/gm;

/**
 * Extract every fenced code block from a Markdown-ish model reply.
 * Returns the raw bodies in document order. Robust to ``` and ~~~ fences and
 * to leading indentation. No language filtering — callers pick.
 * @param {string} text
 * @returns {string[]}
 */
export function codeBlocks(text) {
  /** @type {string[]} */
  const blocks = [];
  for (const match of text.matchAll(FENCE_RE)) {
    blocks.push(match[4]);
  }
  return blocks;
}

/**
 * The single most likely "answer" code block: the longest fenced block.
 * Models often wrap one solution in one block; when they emit several
 * (e.g. a usage example), the implementation is almost always the longest.
 * Returns "" when there is no fenced block.
 * @param {string} text
 * @returns {string}
 */
export function primaryCodeBlock(text) {
  const blocks = codeBlocks(text);
  if (blocks.length === 0) return "";
  return blocks.reduce((best, b) => (b.length > best.length ? b : best), blocks[0]);
}

/**
 * Count non-blank lines inside fenced code blocks. This is the `code_lines`
 * metric: a real, local count of how much code the model actually emitted.
 * Blank lines are excluded so whitespace padding cannot inflate the count.
 * @param {string} text
 * @returns {number}
 */
export function codeLines(text) {
  let count = 0;
  for (const block of codeBlocks(text)) {
    for (const line of block.split("\n")) {
      if (line.trim() !== "") count++;
    }
  }
  return count;
}
