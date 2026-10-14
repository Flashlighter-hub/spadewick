/** English plural helper for strings.js: plural(n, 'card', 'cards'). */
export const plural = (n, one, other = `${one}s`) => (n === 1 ? one : other)
