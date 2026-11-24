// 前端共用工具：跳脫 HTML、網址/電話自動連結、輕量 Markdown 渲染、串流預覽清理
window.APP_UI = (() => {
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function linkify(s) {
    return s
      .replace(/(https?:\/\/[^\s<>）)】，。、；！？]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[^\d\/\-a-zA-Z])(0\d-\d{3,4}-?\d{3,4})/g, (_, pre, tel) => `${pre}<a href="tel:${tel.replace(/-/g, '')}">${tel}</a>`);
  }
  function md(text) {
    const lines = linkify(esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')).split('\n');
    let html = '', list = null;
    for (const raw of lines) {
      const line = raw.trim();
      const h = line.match(/^#{1,6}\s+(.*)/);
      if (h) { if (list) { html += `</${list}>`; list = null; } html += `<p><strong>${h[1]}</strong></p>`; continue; }
      const ul = line.match(/^[-*•]\s+(.*)/), ol = line.match(/^\d+[.、)]\s*(.*)/);
      const type = ul ? 'ul' : ol ? 'ol' : null;
      if (type) {
        if (list !== type) { if (list) html += `</${list}>`; html += `<${type}>`; list = type; }
        html += `<li>${(ul || ol)[1]}</li>`;
      } else {
        if (list) { html += `</${list}>`; list = null; }
        if (line) html += `<p>${line}</p>`;
      }
    }
    if (list) html += `</${list}>`;
    return html;
  }
  function cleanPreview(t) {
    return String(t ?? '').replace(/\s*[【\[]\s*(完整|部分|無資料)?\s*[】\]]?\s*$/, '').trim();
  }
  return { esc, linkify, md, cleanPreview };
})();
