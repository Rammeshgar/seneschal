(function (root) {
  "use strict";
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function inline(value) {
    const tokens = [];
    const hold = html => `\u0000${tokens.push(html) - 1}\u0000`;
    let text = String(value).replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escape(code)}</code>`));
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => hold(`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`));
    text = text.replace(/https?:\/\/[^\s<>\u0000]+/g, url => hold(`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(url)}</a>`));
    text = escape(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] || '');
  }
  function cells(line) {
    let text = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
    const result = []; let cell = '', code = false;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '`') code = !code;
      if (text[i] === '|' && text[i - 1] !== '\\' && !code) { result.push(cell); cell = ''; }
      else cell += text[i];
    }
    result.push(cell);
    return result.map(value => value.trim().replace(/\\\|/g, '|'));
  }
  function render(value, codeRenderer) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').split('\n');
    const html = [];
    const special = (i) => /^\s*(```|~~~|#{1,6}\s|[-*+]\s|\d+\.\s|>\s|---+$)/.test(lines[i] || '') || (lines[i + 1]?.includes('|') && cells(lines[i + 1]).every(c => /^:?-{3,}:?$/.test(c)));
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const fence = line.match(/^\s*(```|~~~)(.*)$/);
      if (fence) {
        const body = []; i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
        if (i < lines.length) i++;
        html.push(codeRenderer ? codeRenderer(fence[2].trim() || 'code', body.join('\n')) : `<pre><code>${escape(body.join('\n'))}</code></pre>`); continue;
      }
      if (line.includes('|') && lines[i + 1]?.includes('|')) {
        const separators = cells(lines[i + 1]); const headers = cells(line);
        if (separators.length === headers.length && separators.every(c => /^:?-{3,}:?$/.test(c))) {
          i += 2; const rows = [];
          while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
            const row = cells(lines[i++]); rows.push(`<tr>${headers.map((_, n) => `<td>${inline(row[n] || '')}</td>`).join('')}</tr>`);
          }
          html.push(`<div class="markdown-table-scroll" role="region" aria-label="Comparison table" tabindex="0"><table><thead><tr>${headers.map(h => `<th scope="col">${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`); continue;
        }
      }
      const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
      if (heading) { html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i++; continue; }
      if (/^\s*---+\s*$/.test(line)) { html.push('<hr>'); i++; continue; }
      if (/^\s*>/.test(line)) {
        const quote = []; while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
        html.push(`<blockquote>${render(quote.join('\n'), codeRenderer)}</blockquote>`); continue;
      }
      const list = line.match(/^\s*(?:([-*+])|\d+\.)\s+(.+)$/);
      if (list) {
        const tag = list[1] ? 'ul' : 'ol'; const items = [];
        while (i < lines.length) {
          const item = lines[i].match(/^\s*(?:([-*+])|\d+\.)\s+(.+)$/);
          if (!item || (item[1] ? 'ul' : 'ol') !== tag) break;
          items.push(`<li>${inline(item[2])}</li>`); i++;
          if (!lines[i]?.trim() && /^\s*(?:[-*+]|\d+\.)\s/.test(lines[i + 1] || '')) i++;
        }
        html.push(`<${tag}>${items.join('')}</${tag}>`); continue;
      }
      const paragraph = [line]; i++;
      while (i < lines.length && lines[i].trim() && !special(i)) paragraph.push(lines[i++]);
      html.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    }
    return html.join('');
  }
  const api = { render, inline, cells };
  if (typeof module !== 'undefined') module.exports = api;
  else root.SeneschalMarkdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
