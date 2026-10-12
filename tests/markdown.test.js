const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../app/markdown');
const { newer } = require('../scripts/maintenance-server');
test('Markdown comparison tables are semantic, scrollable and escaped', () => {
  const html = render('| Model | Score |\n| :--- | ---: |\n| **Astra** | 99 |\n| <script> | 10 |');
  assert.match(html, /<th scope="col">Model<\/th>/);
  assert.match(html, /<td><strong>Astra<\/strong><\/td>/);
  assert.match(html, /tabindex="0"/); assert.ok(!html.includes('<script>'));
});
test('Headings, lists, blockquotes and fenced code render independently', () => {
  const html = render('# Result\n\n- one\n- two\n\n> note\n\n```js\n<a>\n```');
  assert.match(html, /<h1>Result/); assert.match(html, /<ul><li>one/); assert.match(html, /<blockquote>/); assert.match(html, /&lt;a&gt;/);
});
test('Rejects raw HTML and unsafe links; preserves inline code', () => {
  const html = render('[bad](javascript:alert(1)) <img onerror=x> `**literal**`');
  assert.ok(!html.includes('href="javascript:')); assert.ok(!html.includes('<img')); assert.match(html, /<code>\*\*literal\*\*<\/code>/);
});
test('Escaped pipes, incomplete code streams and paragraphs are safe', () => {
  assert.match(render('| A | B |\n| --- | --- |\n| a\\|b | c |'), /<td>a\|b<\/td>/);
  assert.match(render('```js\nx < y'), /x &lt; y/);
});
test('Release ordering handles beta and stable versions without lexical errors', () => {
  assert.ok(newer('v0.2.1-beta.18', '0.2.1-beta.17'));
  assert.ok(newer('0.2.1', '0.2.1-beta.18'));
  assert.ok(!newer('0.2.1-beta.18', '0.2.1'));
  assert.ok(!newer('garbage', '0.2.1'));
});
