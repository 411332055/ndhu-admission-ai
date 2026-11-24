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
    return String(t ?? '').replace(/\s*[【\[]\s*(完整|部分|無資料)?(?:\s*[|｜:：]\s*[\d,\s、]*)?\s*[】\]]?\s*$/, '').trim();
  }
  function readImage(file, maxDim = 1600) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const s = maxDim / Math.max(w, h);
          w = Math.round(w * s); h = Math.round(h * s);
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        const mimeType = file.type === 'image/png' && file.size < 1.5 * 1024 * 1024 ? 'image/png' : 'image/jpeg';
        const dataUrl = c.toDataURL(mimeType, 0.85);
        resolve({ mimeType, data: dataUrl.split(',')[1], previewUrl: dataUrl });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('圖片讀取失敗')); };
      img.src = url;
    });
  }
  return { esc, linkify, md, cleanPreview, readImage };
})();
