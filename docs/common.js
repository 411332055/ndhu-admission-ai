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
  function startSearchAnim(bubble, opts = {}) {
    const steps = opts.isStaff
      ? (opts.hasImage
          ? ['🖼️ 正在判讀圖片並比對內部知識…', '🗂️ 正在查詢相關作業流程與規定…', '✨ 正在為你整理處理步驟與依據…']
          : ['🔍 正在搜尋內部作業知識與公開規定…', '🗂️ 正在比對處理流程與相關案例…', '✨ 正在為你整理結論與依據…'])
      : (opts.hasImage
          ? ['🖼️ 正在讀取圖片並比對入學規定…', '📑 正在核對最新簡章與公告條文…', '✨ 正在為你整理貼心重點回覆…']
          : ['🔍 正在搜尋東華入學知識庫…', '📑 正在比對最新簡章與公告條文…', '✨ 正在為你整理重點回覆…']);
    let idx = 0;
    bubble.classList.add('searching');
    bubble.innerHTML = `
      <div class="search-loader" role="status" aria-live="polite">
        <div class="search-head">
          <span class="search-orbit" aria-hidden="true"><span></span></span>
          <span class="search-label">${esc(steps[0])}</span>
        </div>
        <div class="search-bars" aria-hidden="true">
          <span class="sbar w1"></span>
          <span class="sbar w2"></span>
          <span class="sbar w3"></span>
        </div>
      </div>`;
    const timer = setInterval(() => {
      idx = Math.min(idx + 1, steps.length - 1);
      const label = bubble.querySelector('.search-label');
      if (!label) { clearInterval(timer); return; }
      label.classList.add('fade');
      setTimeout(() => {
        if (!bubble.contains(label)) return;
        label.textContent = steps[idx];
        label.classList.remove('fade');
      }, 180);
      if (idx >= steps.length - 1) clearInterval(timer);
    }, 1500);
    return () => {
      clearInterval(timer);
      bubble.classList.remove('searching');
    };
  }
  function openLightbox(url, caption) {
    let lb = document.getElementById('ndhu-lightbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'ndhu-lightbox';
      lb.className = 'lightbox';
      lb.innerHTML = `
        <div class="lightbox-box">
          <div class="lightbox-bar">
            <span class="lightbox-title"></span>
            <a class="lightbox-open" target="_blank" rel="noopener noreferrer">在新分頁開啟原圖 ↗</a>
            <button type="button" class="lightbox-close" aria-label="關閉">✕</button>
          </div>
          <div class="lightbox-body"><img alt=""></div>
        </div>`;
      lb.addEventListener('click', e => { if (e.target === lb) lb.hidden = true; });
      lb.querySelector('.lightbox-close').onclick = () => { lb.hidden = true; };
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !lb.hidden) lb.hidden = true; });
      document.body.appendChild(lb);
    }
    lb.querySelector('.lightbox-title').textContent = caption || '圖片檢視';
    lb.querySelector('.lightbox-open').href = url;
    const img = lb.querySelector('.lightbox-body img');
    img.src = url;
    img.alt = caption || '圖片';
    lb.hidden = false;
  }
  function renderImages(images) {
    if (!Array.isArray(images) || !images.length) return '';
    return `<div class="ans-images">${images.map(it =>
      `<figure class="ans-img-card" data-url="${esc(it.url)}" data-cap="${esc(it.source || '平面圖')}">
        <img src="${esc(it.url)}" alt="${esc(it.source || '平面圖')}" loading="lazy">
        <figcaption><span>🗺️ ${esc(it.source || '平面圖')}</span><span class="zoom-hint">🔍 點擊放大</span></figcaption>
      </figure>`).join('')}</div>`;
  }
  function bindImageCards(root) {
    root.querySelectorAll('.ans-img-card').forEach(card => {
      card.onclick = () => openLightbox(card.dataset.url, card.dataset.cap);
    });
  }
  return { esc, linkify, md, cleanPreview, readImage, startSearchAnim, renderImages, bindImageCards };
})();
