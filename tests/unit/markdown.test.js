import { describe, it, expect } from 'vitest'
import { renderMarkdown, plainText, splitTitle, slugOf, linkKind } from '../../src/shared/markdown.js'

const html = src => renderMarkdown(src).html

describe('blocks', () => {
  it('reads headings of every level, with ids, and lists them', () => {
    const r = renderMarkdown('# One\n\n## Two *words*\n\n###### Six\n\n####### not a heading')
    expect(r.html).toContain('<h1 id="one">One</h1>')
    expect(r.html).toContain('<h2 id="two-words">Two <em>words</em></h2>')
    expect(r.html).toContain('<h6 id="six">Six</h6>')
    expect(r.html).toContain('<p>####### not a heading</p>')
    expect(r.headings).toEqual([{ level: 1, text: 'One', id: 'one' }, { level: 2, text: 'Two words', id: 'two-words' }, { level: 6, text: 'Six', id: 'six' }])
  })

  it('gives two headings of the same name different ids', () => {
    const r = renderMarkdown('## Setup\n\ntext\n\n## Setup\n\n## Setup')
    expect(r.headings.map(h => h.id)).toEqual(['setup', 'setup-1', 'setup-2'])
  })

  it('makes paragraphs of lines up to a blank line, with a break at two spaces or a backslash', () => {
    expect(html('one\ntwo\n\nthree')).toBe('<p>one\ntwo</p>\n<p>three</p>')
    expect(html('one  \ntwo')).toBe('<p>one<br />\ntwo</p>')
    expect(html('one\\\ntwo')).toBe('<p>one<br />\ntwo</p>')
  })

  it('reads a rule, a quote (with blocks inside) and fenced code that is not read', () => {
    expect(html('---')).toBe('<hr />')
    expect(html('* * *')).toBe('<hr />')
    expect(html('> a **b**\n> - c')).toBe('<blockquote><p>a <strong>b</strong></p>\n<ul><li>c</li></ul></blockquote>')
    expect(html('```js\nlet a = "<b>"; // *no*\n```')).toBe('<pre><code class="lang-js">let a = &quot;&lt;b&gt;&quot;; // *no*</code></pre>')
    expect(html('~~~\nunfinished')).toBe('<pre><code>unfinished</code></pre>')
  })

  it('reads lists: bullets, numbers (from where they start), tasks, and nesting by indenting', () => {
    expect(html('- a\n- b\n- c')).toBe('<ul><li>a</li><li>b</li><li>c</li></ul>')
    expect(html('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>')
    expect(html('3. a\n4. b')).toBe('<ol start="3"><li>a</li><li>b</li></ol>')
    expect(html('- a\n  - b\n  - c\n- d')).toBe('<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>')
    expect(html('1. a\n    - b\n2. c')).toBe('<ol><li>a<ul><li>b</li></ul></li><li>c</li></ol>')
    const tasks = html('- [ ] open\n- [x] done')
    expect(tasks).toContain('<li class="task"><input type="checkbox" disabled aria-label="not done" /> open</li>')
    expect(tasks).toContain('<input type="checkbox" disabled checked aria-label="done" /> done')
  })

  it('an item may go on over several lines, and have paragraphs of its own', () => {
    expect(html('- one\n  carries on\n- two')).toBe('<ul><li>one\ncarries on</li><li>two</li></ul>')
    expect(html('- first\n\n  second paragraph\n- next')).toBe('<ul><li><p>first</p><p>second paragraph</p></li><li>next</li></ul>')
  })

  it('a bullet list and a numbered list one after the other are two lists', () => {
    expect(html('- a\n1. b')).toBe('<ul><li>a</li></ul>\n<ol><li>b</li></ol>')
  })

  it('reads tables with alignment, short rows and an escaped bar', () => {
    const t = html('| Name | Cost | Note |\n|:-----|-----:|:----:|\n| Fire | 3 | a \\| b |\n| Ice | 2 |')
    expect(t).toContain('<th class="al-left">Name</th><th class="al-right">Cost</th><th class="al-center">Note</th>')
    expect(t).toContain('<td class="al-left">Fire</td><td class="al-right">3</td><td class="al-center">a | b</td>')
    expect(t).toContain('<td class="al-left">Ice</td><td class="al-right">2</td><td class="al-center"></td>')
    expect(html('a | b\nc | d')).toBe('<p>a | b\nc | d</p>')                   // no separator line: not a table
    expect(html('Name | Cost\n--- | ---\nFire | 3')).toContain('<table>')
  })
})

describe('inline', () => {
  it('reads strong, emphasis, strike-through and code, and leaves code alone', () => {
    expect(html('**a** *b* __c__ _d_ ~~e~~ `f *g*`')).toBe('<p><strong>a</strong> <em>b</em> <strong>c</strong> <em>d</em> <del>e</del> <code>f *g*</code></p>')
    expect(html('snake_case_name and 2*3*4')).toBe('<p>snake_case_name and 2<em>3</em>4</p>')
    expect(html('a\\*b\\*')).toBe('<p>a*b*</p>')
  })

  it('shows what is not Markdown as it is: HTML is text, never markup', () => {
    expect(html('<script>alert(1)</script> & "quotes"')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;</p>')
    expect(html('<img src=x onerror=alert(1)>')).not.toMatch(/<img/)
    expect(html('[x](javascript:alert(1))')).toBe('<p><span class="dead-link">x</span></p>')
    expect(html('[x](data:text/html;base64,AAAA)')).toBe('<p><span class="dead-link">x</span></p>')
    expect(html('![x](https://evil.example/a.png)')).toBe('<p><span class="img-alt">x</span></p>')
  })

  it('writes links as data the page acts on: the web, a page of the rules, a heading', () => {
    expect(html('[site](https://example.com/a?b=1&c=2)')).toBe('<p><a class="ext" data-rules-link="https://example.com/a?b=1&amp;c=2" role="link" tabindex="0">site</a></p>')
    expect(html('[turns](page:Turn order)')).toBe('<p><a class="int" data-rules-page="Turn order" role="link" tabindex="0">turns</a></p>')
    expect(html('[up](#setup)')).toBe('<p><a class="int" data-rules-anchor="setup" role="link" tabindex="0">up</a></p>')
    expect(html('see https://example.com/x.')).toBe('<p>see <a class="ext" data-rules-link="https://example.com/x" role="link" tabindex="0">https://example.com/x</a>.</p>')
    expect(html('[mail](mailto:a@b.c)')).toContain('data-rules-link="mailto:a@b.c"')
    expect(html('[**bold** link](https://example.com)')).toContain('<strong>bold</strong> link</a>')
  })

  it('writes a picture of the project and a card as data the page fills in', () => {
    expect(html('![The board](asset:board.png)')).toBe('<p><img class="rules-img" data-rules-asset="board.png" alt="The board" /></p>')
    expect(html('Play [[Fire Bolt]] now')).toBe('<p>Play <a class="card-ref" data-rules-card="Fire Bolt" role="button" tabindex="0">Fire Bolt</a> now</p>')
    expect(html('![[Fire Bolt]]')).toBe('<p><figure class="card-embed" data-rules-card-embed="Fire Bolt"><figcaption>Fire Bolt</figcaption></figure></p>')
    expect(html('[[a" onclick="x]]')).not.toContain('onclick="x')
    // quotes cannot end an attribute early: the tag keeps the shape it was written in
    expect(html('![alt" onerror="x](asset:a" onerror="y.png)')).toMatch(/^<p><img class="rules-img" data-rules-asset="[^"]*" alt="[^"]*" \/><\/p>$/)
    expect(html('[[a" onclick="x]]')).toMatch(/^<p><a class="card-ref" data-rules-card="[^"]*" role="button" tabindex="0">[^<]*<\/a><\/p>$/)
    expect(renderMarkdown('[[Fish & Chips]]').refs.cards).toEqual(['Fish & Chips'])
    expect(html('[[Fish & Chips]]')).toContain('data-rules-card="Fish &amp; Chips"')
    expect(html('[a](https://x.y/a_(b))')).toContain('data-rules-link="https://x.y/a_(b)"')
  })

  it('says what the text points to', () => {
    const r = renderMarkdown('[[Fire]] and ![[Ice]]\n\n![b](asset:b.png) [t](page:Turns) [t2](page:Turns)')
    expect(r.refs).toEqual({ cards: ['Fire', 'Ice'], assets: ['b.png'], pages: ['Turns'] })
  })

  it('links inside a heading, a list and a table are links', () => {
    expect(html('## See [[Fire]]')).toContain('<a class="card-ref"')
    expect(html('- [x](https://a.b/c)')).toContain('data-rules-link')
    expect(html('| a |\n|---|\n| [[Fire]] |')).toContain('<td><a class="card-ref"')
  })
})

describe('robustness', () => {
  it('reads anything without throwing, and nothing is left unread', () => {
    const odd = ['', '\n\n', '#', '- ', '> ', '|', '| a', '|---|', '```', '[[', ']]', '![[', '[', '![](', '`', '**', '_', '1.', ' - a\n   - b\n  - c', '- a\n\n\n- b', '\u0000', '- \u0000 -']
    for (const s of odd) expect(() => renderMarkdown(s)).not.toThrow()
    expect(renderMarkdown('').html).toBe('')
    expect(renderMarkdown(null).html).toBe('')
    expect(html('a\u0000b')).not.toContain('\u0000')
  })

  it('does not nest without end', () => {
    const deep = Array.from({ length: 40 }, (_, i) => `${'  '.repeat(i)}- level ${i}`).join('\n')
    expect(() => renderMarkdown(deep)).not.toThrow()
    expect(html('> '.repeat(60) + 'x')).toContain('x')
  })

  it('reads a long page quickly', () => {
    const page = Array.from({ length: 4000 }, (_, i) => `## Heading ${i}\n\nSome **words** with [[Card ${i}]] and a [link](https://example.com/${i}).\n\n- a\n- b\n`).join('\n')
    const t = Date.now()
    const r = renderMarkdown(page)
    expect(r.headings).toHaveLength(4000)
    expect(Date.now() - t).toBeLessThan(4000)
  })
})

describe('around the page', () => {
  it('makes plain text of a page for finding in it', () => {
    expect(plainText('# Title\n\nSome **bold** [link](https://a.b) and [[Fire]].\n\n- one\n- [x] two\n\n```\ncode\n```')).toBe('Title Some bold link and Fire. one two')
  })

  it('takes a first level-one heading as the title of a file', () => {
    expect(splitTitle('# Turn order\n\nFirst, draw.\n')).toEqual({ title: 'Turn order', body: 'First, draw.\n' })
    expect(splitTitle('\n\n# Turn order #\nText')).toEqual({ title: 'Turn order', body: 'Text' })
    expect(splitTitle('## Not it\ntext')).toEqual({ title: null, body: '## Not it\ntext' })
    expect(splitTitle('Intro\n# Later')).toEqual({ title: null, body: 'Intro\n# Later' })
    expect(splitTitle('')).toEqual({ title: null, body: '' })
  })

  it('makes ids of headings, and tells which links are safe', () => {
    expect(slugOf('Turn Order & Phases!')).toBe('turn-order-phases')
    expect(slugOf('***')).toBe('section')
    expect(linkKind('https://a.b')).toEqual({ kind: 'web', url: 'https://a.b' })
    expect(linkKind('page:Setup')).toEqual({ kind: 'page', url: 'Setup' })
    expect(linkKind('#x')).toEqual({ kind: 'anchor', url: 'x' })
    for (const bad of ['javascript:alert(1)', 'file:///c:/x', 'ftp://a', 'page:', '//evil', '', '#']) expect(linkKind(bad)).toBeNull()
  })
})
