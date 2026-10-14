/**
 * Minimal sandboxed formula evaluator — PRD §5.4
 * Used by both the fields IPC handler and the render pipeline.
 */

export function evaluateFormula(expr, fields) {
  if (!expr?.trim()) return ''
  try {
    const tokens = tokenize(expr)
    return String(evalExpr(tokens, fields) ?? '')
  } catch (err) {
    return `#ERR: ${err.message}`
  }
}

/** Detect circular references in a field definition list */
export function detectCircularFormulas(fieldDefs) {
  const formulaFields = new Map(
    fieldDefs.filter(f => f.type === 'formula').map(f => [f.slug, f.formula ?? ''])
  )
  for (const [slug, formula] of formulaFields) {
    if (hasCircle(slug, formula, formulaFields, new Set())) return true
  }
  return false
}

function hasCircle(start, formula, allFormulas, visited) {
  if (visited.has(start)) return true
  visited.add(start)
  const refs = extractSlugs(formula)
  for (const ref of refs) {
    if (allFormulas.has(ref) && hasCircle(ref, allFormulas.get(ref), allFormulas, new Set(visited))) {
      return true
    }
  }
  return false
}

export function extractSlugs(formula) {
  // A built-in name only means the function when it is called; otherwise it is a field that happens to share the name
  return [...formula.matchAll(/\b[a-z_][a-z_0-9]*\b/gi)]
    .filter(m => !(BUILTINS.has(m[0].toLowerCase()) && /^\s*\(/.test(formula.slice(m.index + m[0].length))))
    .map(m => m[0])
}

/**
 * Every function of the formula language, by group. This is the one list: the evaluator below answers to it, and so does the guide in the
 * Help tab (src/shared/help.js), where a test fails when a function has no entry.
 */
export const FORMULA_FUNCTIONS = {
  text: ['concat', 'upper', 'lower', 'trim', 'length', 'substr', 'contains', 'has'],
  math: ['add', 'sub', 'mul', 'div', 'round', 'floor', 'ceil'],
  logic: ['if', 'eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'and', 'or', 'not'],
  convert: ['to_number', 'to_string'],
  card: ['card_id', 'card_number', 'card_count']
}

/** The comparison operators, written between two values (`cost >= 3`). */
export const FORMULA_OPERATORS = ['==', '=', '!=', '<', '<=', '>', '>=']

const BUILTINS = new Set(Object.values(FORMULA_FUNCTIONS).flat())

/** The fields and card position the examples of the guide are worked out with (and checked against, by a test). */
export const HELP_SAMPLE = {
  name: 'Fire Drake', keywords: 'Flying, Fire', cost: '4', power: '5', toughness: '3', rarity: 'rare', first: 'Ada', last: 'Lovelace', note: '  hello  ',
  '@card.id': 'FIRE-0007', '@card.number': '7', '@card.count': '60'
}

// ---------------------------------------------------------------------------
// Tokenizer: handles quoted strings, numbers, identifiers, parens, commas
// ---------------------------------------------------------------------------
function tokenize(expr) {
  const tokens = []
  let i = 0
  while (i < expr.length) {
    // Skip whitespace
    if (/\s/.test(expr[i])) { i++; continue }

    // Quoted string
    if (expr[i] === '"' || expr[i] === "'") {
      const q = expr[i++]
      let s = ''
      while (i < expr.length && expr[i] !== q) {
        if (expr[i] === '\\') { i++; s += expr[i++] } else s += expr[i++]
      }
      i++ // closing quote
      tokens.push({ type: 'string', value: s })
      continue
    }

    // Number
    if (/[\d.]/.test(expr[i]) && !(expr[i] === '.' && !/\d/.test(expr[i + 1] ?? ''))) {
      let n = ''
      while (i < expr.length && /[\d.]/.test(expr[i])) n += expr[i++]
      tokens.push({ type: 'number', value: Number(n) })
      continue
    }

    // Identifier
    if (/[a-z_]/i.test(expr[i])) {
      let id = ''
      while (i < expr.length && /[a-z_0-9]/i.test(expr[i])) id += expr[i++]
      tokens.push({ type: 'ident', value: id })
      continue
    }

    // Punctuation
    if ('(),'.includes(expr[i])) {
      tokens.push({ type: 'punct', value: expr[i++] })
      continue
    }

    // Comparison operators
    if (/[=!<>]/.test(expr[i])) {
      let op = expr[i++]
      if (i < expr.length && expr[i] === '=') { op += expr[i++] }
      tokens.push({ type: 'op', value: op })
      continue
    }

    i++ // skip unknown character
  }
  return tokens
}

// ---------------------------------------------------------------------------
// Recursive descent evaluator
// ---------------------------------------------------------------------------
/** expression := primary (comparison-operator primary)*   — infix comparisons per PRD §7.3 */
function evalExpr(tokens, fields) {
  let left = evalPrimary(tokens, fields)
  while (tokens[0]?.type === 'op') {
    const op = tokens.shift().value
    const right = evalPrimary(tokens, fields)
    left = compareValues(op, left, right)
  }
  return left
}

function compareValues(op, a, b) {
  switch (op) {
    case '==': case '=': return String(a) === String(b)
    case '!=':           return String(a) !== String(b)
    case '<':            return Number(a) < Number(b)
    case '<=':           return Number(a) <= Number(b)
    case '>':            return Number(a) > Number(b)
    case '>=':           return Number(a) >= Number(b)
    default:             return false
  }
}

function evalPrimary(tokens, fields) {
  const tok = tokens.shift()
  if (!tok) return ''

  // Parenthesised expression: ( expr )
  if (tok.type === 'punct' && tok.value === '(') {
    const val = evalExpr(tokens, fields)
    if (isPunct(tokens[0], ')')) tokens.shift()
    return val
  }

  // Literal value
  if (tok.type === 'string') return tok.value
  if (tok.type === 'number') return tok.value

  if (tok.type === 'ident') {
    const name = tok.value

    // Function call
    if (isPunct(tokens[0], '(')) {
      tokens.shift() // consume '('
      const args = []
      while (tokens.length && !isPunct(tokens[0], ')')) {
        if (isPunct(tokens[0], ',')) { tokens.shift(); continue }
        args.push(evalExpr(tokens, fields))
      }
      if (isPunct(tokens[0], ')')) tokens.shift()
      return applyFn(name.toLowerCase(), args, fields)
    }

    // Variable reference
    // Own properties only: a field called "constructor" must not resolve to Object.prototype members
    return Object.hasOwn(fields, name) ? (fields[name] ?? '') : ''
  }

  return ''
}

/** Punctuation check by token type, so a string literal such as ")" is never mistaken for syntax. */
function isPunct(tok, ch) {
  return tok?.type === 'punct' && tok.value === ch
}

/** Whether a result counts as true: not blank, not "false", not 0 (the same test an export filter applies). */
export function isTruthy(value) {
  if (value === false || value == null) return false
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value)
  return !['', 'false', '0'].includes(String(value).trim().toLowerCase())
}

/** The items of a tag list as stored: separated by commas, spaces around them ignored. */
const listItems = text => String(text ?? '').split(',').map(t => t.trim()).filter(Boolean)

function applyFn(fn, args, fields = {}) {
  const n = (i) => Number(args[i] ?? 0)
  const s = (i) => String(args[i] ?? '')

  switch (fn) {
    case 'concat':     return args.map(String).join('')
    case 'add':        return n(0) + n(1)
    case 'sub':        return n(0) - n(1)
    case 'mul':        return n(0) * n(1)
    case 'div':        return n(1) !== 0 ? n(0) / n(1) : 0
    case 'round':      return Math.round(n(0))
    case 'floor':      return Math.floor(n(0))
    case 'ceil':       return Math.ceil(n(0))
    case 'if':         return args[0] ? args[1] : args[2]
    case 'eq':         return String(args[0]) === String(args[1])
    case 'neq':        return String(args[0]) !== String(args[1])
    case 'gt':         return n(0) > n(1)
    case 'lt':         return n(0) < n(1)
    case 'gte':        return n(0) >= n(1)
    case 'lte':        return n(0) <= n(1)
    case 'upper':      return s(0).toUpperCase()
    case 'lower':      return s(0).toLowerCase()
    case 'trim':       return s(0).trim()
    case 'length':     return s(0).length
    case 'substr':     return s(0).slice(n(1), args[2] !== undefined ? n(2) : undefined)
    case 'contains':   return s(0).toLowerCase().includes(s(1).toLowerCase())
    case 'has':        return listItems(args[0]).some(t => t.toLowerCase() === s(1).trim().toLowerCase())
    case 'and':        return args.length > 0 && args.every(isTruthy)
    case 'or':         return args.some(isTruthy)
    case 'not':        return !isTruthy(args[0])
    case 'to_number':  return Number(args[0])
    case 'to_string':  return String(args[0] ?? '')
    // The card's own ID and position (PRD §5.8); supplied under reserved keys that cannot be field slugs
    case 'card_id':     return fields['@card.id'] ?? ''
    case 'card_number': return fields['@card.number'] ?? ''
    case 'card_count':  return fields['@card.count'] ?? ''
    default:           return ''
  }
}
