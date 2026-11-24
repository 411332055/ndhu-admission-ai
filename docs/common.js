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
  function bindVoice(btn, input, onSubmit) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      btn.title = '此瀏覽器不支援語音輸入（建議使用 Chrome / Edge）';
      btn.onclick = () => alert('此瀏覽器目前不支援語音辨識，建議使用 Chrome 或 Edge 瀏覽器體驗語音提問！');
      return;
    }
    let rec = null, listening = false;
    const origPlaceholder = input.placeholder;
    const stopUI = () => {
      listening = false;
      btn.classList.remove('listening');
      btn.textContent = '🎙️';
      input.placeholder = origPlaceholder;
    };
    btn.onclick = () => {
      if (listening && rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = 'zh-TW';
      rec.interimResults = true;
      rec.continuous = false;
      let finalText = '';
      rec.onstart = () => {
        listening = true;
        btn.classList.add('listening');
        btn.textContent = '⏹️';
        input.placeholder = '🎙️ 請開始說話，說完會自動送出…';
      };
      rec.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t;
          else interim += t;
        }
        input.value = (finalText + interim).trim();
        input.style.height = 'auto';
        input.style.height = input.scrollHeight + 'px';
      };
      rec.onerror = e => {
        stopUI();
        if (e.error === 'not-allowed') alert('請允許瀏覽器使用麥克風權限，才能使用語音提問喔！');
      };
      rec.onend = () => {
        const text = (finalText || input.value).trim();
        stopUI();
        if (text && onSubmit) onSubmit(text);
      };
      try { rec.start(); } catch { stopUI(); }
    };
  }
  function suggestFollowups(question, sources = [], isStaff = false) {
    const ctx = `${question || ''} ${(sources || []).join(' ')}`;
    let pool;
    if (isStaff) {
      if (/平面圖|地圖|大樓|樓層/.test(ctx)) {
        pool = ['東華校園導覽平面圖', '行政大樓總務處平面圖', '人社一館平面圖'];
      } else if (/報到|補件|逾期|畢業證書/.test(ctx)) {
        pool = ['延誤繳費的處理流程？', '新生最常打電話問什麼？', '學生忘記單一簽入密碼怎麼處理？'];
      } else {
        pool = ['學生錯過報到資料上傳期限怎麼處理？', '新生最常打電話問什麼？', '延誤繳費的處理流程？'];
      }
    } else if (/平面圖|地圖|配置圖|管院|管理學院|理工|人社|圖書館|資訊中心|行政大樓/.test(ctx)) {
      pool = ['東華校園導覽平面圖', '管理學院平面圖', '人社一館平面圖', '理工二館三樓平面圖', '圖書館三樓平面圖'];
    } else if (/學雜費|繳費|學貸|貸款|減免|獎學金|補助/.test(ctx)) {
      pool = ['就學貸款怎麼申請？', '學雜費減免與獎學金資格？', '學雜費可以怎麼繳？', '新生宿舍怎麼申請與進住？'];
    } else if (/宿舍|住宿|體檢|健檢|兵役|交通|志學/.test(ctx)) {
      pool = ['新生體檢要注意什麼？', '怎麼從志學火車站到東華？', '東華校園導覽平面圖', '學雜費可以怎麼繳？'];
    } else {
      pool = ['新生報到要準備什麼？', '忘記上傳畢業證書怎麼辦？', '學雜費可以怎麼繳？', '東華校園導覽平面圖'];
    }
    const norm = s => String(s || '').replace(/[\s？?。！!]/g, '');
    const qNorm = norm(question);
    return pool.filter(x => norm(x) !== qNorm).slice(0, 3);
  }
  return { esc, linkify, md, cleanPreview, readImage, startSearchAnim, renderImages, bindImageCards, bindVoice, suggestFollowups };
})();
