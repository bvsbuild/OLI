/* 102025.11.2.2 DPO Overlay
 * Bottom sheet by default, header hidden, no auto-open on direct URLs.
 * GA4 page view on open & close (UA fallback).
 * Vanilla JS (no jQuery, no external deps).
 *
 * Changelog
 * 102025.11.2.2
 * - Fix zero-scroll regression: make .dpo-article the outer scroll container (height:100%; overflow:auto; -webkit-overflow-scrolling:touch).
 *   Also fix specificity so the pinned .dpo-hero + .dpo-content keeps overflow:auto by enforcing it and preventing base .dpo-content
 *   from overriding. No structural changes.
  * 102025.11.2.1
 * - Scroll initiation handoff: wheel/touch over .dpo-content **before pin** now forwards to the outer article so the whole
 *   card rides over the hero. After pin, inner content scrolls; upward scroll at top returns control to the outer scroller.
 *   Minimal JS; no layout changes.
 * - Added small CSS overscroll-behavior-y: contain on article/content to reduce bounce/scroll chaining.
 * - Version stamp bumped to 102025.11.2.1 for verification.
  * 102025.11.2
 * - Hero center-crop (CSS-only): use object-fit:cover and object-position:center with a tunable height var
 *   (dpo-hero-h). This keeps the hero image centered vertically while sticky, with clean rounded corners.
 * - Version stamp bumped to 102025.11.2 for verification.
 * 102025.11.1
 * - Restore rounded corners for the hero while sticky: add top border-radius + overflow clipping to .dpo-hero,
 *   and inherit rounding for hero media/wrappers so images and staged videos are clipped cleanly.
 * - Version stamp bumped to 102025.11.1 for verification.
 * 102025.11
 * - Step 4: Internal scrolling after pin. Implemented pure-CSS sticky card:
 *   .dpo-content is now position:sticky; top:30px; overflow:auto; so once it reaches 30px from the top of
 *   the hero, it pins and its contents scroll internally. Keeps 20px initial overlap and hero stays sticky.
 * - Added max-height constraint for the sticky card based on the sheet height for reliable inner scrolling.
 * - Version stamp bumped to 102025.11 for verification.
 * 102025.10.2
 * - Fix: .dpo--close-in-hero was overriding the hero’s sticky positioning (setting position:relative).
 *   Removed that override so the hero can remain sticky while the content card rides over it.
 * - Version stamp bumped to 102025.10.2 for verification.
 * 102025.10.1
 * - Step 2 hardening: switch .dpo-article from CSS Grid to block flow so negative margins and z-index stacking
 *   behave predictably across browsers; keeps the hero sticky and allows content card to ride over it.
 * - Bump data-version to 102025.10.1 for cache verification.
 * 102025.10
 * - Step 2 fix: make the hero sticky so the content card clearly rides up and overlays it while scrolling.
 * - Added a data-version stamp on #dpo-overlay for cache/debug checks.
 * 102025.9
 * - Step 2: On scroll, the content card rides up over the hero. Implementation: outer scroller is the
 *   article; the content card has overflow:visible so it moves as a single block and visually covers the hero.
 *   (Pin + internal scrolling come in steps 3 4.)
 * 102025.8
 * - Unwired the old pull-up script (no runtime scroll coupling).
 * - Step 1 of new behavior: on load, content card overlaps hero by 20px.
 * 102025.7
 * - Title-in-content: style .dpo-h1 so the server can prepend the post title above the rebuilt grid.
 * - Layout polish: two-column .dpo-grid on desktop, single column under 1024px; spacing tweaks.
 * 102025.6
 * - CSS: add native DPO layout classes (.dpo-grid, .dpo-col) so we can strip Divi wrappers on the server
 *   and rebuild clean two-column markup in the overlay.
 * - Kept Divi normalizers for backward compatibility.
 * 102025.5
 * - JS: add lightweight client-side renderer for common Divi shortcodes so images/text render
 *   even if REST returns raw builder shortcodes. (Handles et_pb_image, et_pb_text, strips wrappers.)
 * 102025.1
 * - JS: call wirePullUp() on init so sheet scrolling is fully wired.
 * - No API shape changes.


 * Tweaks (you can adjust these quickly):
 * - Hero height: set #dpo-overlay{dpo-hero-h: 60vh } (and media-query override). Use px or vh.
 * - Hero crop focus: .dpo-hero img { object-position:center } (e.g., 'center 40%').
 * - Pin offset: change .dpo-content { top:30px } and update the JS PIN_OFFSET constant.
 * - Card max height when pinned: .dpo-content { max-height: calc(90dvh - 30px - 12px) }.
*/


(function(){
  'use strict';

  /* ===== Config ===== */
  const SEL_PORTFOLIO = '.et_pb_portfolio, .et_pb_filterable_portfolio, .et_pb_fullwidth_portfolio';
  const CPT_SLUG = 'project';                       // WP CPT slug
  const TAXONOMY_META = ['project_category'];        // which taxonomies to show in meta (if header shown)
  const USE_SHEET = true;                            // default sheet layout
  const HIDE_HEADER = true;                          // header hidden by default
  const AUTO_OPEN_ON_DIRECT = false;                 // per your choice
  const PIN_OFFSET = 30;                             // must match CSS .dpo-hero + .dpo-content { top:30px }

  /* ===== State ===== */
  const baseUrl = window.location.href;              // where to return on close
  let overlay, refs, lastFocus = null;               // DOM refs
  const STAGE_MAP = new WeakMap();                   // remembers original position when staging players

  /* ===== Utility: GA page_view helper ===== */
  function sendPageView(url, title){
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'page_view', {
          page_location: url,
          page_title: title || document.title
        });
        return;
      }
    } catch(e) {}
    try {
      if (typeof window.ga === 'function') {
        window.ga('set', 'page', url);
        window.ga('send', 'pageview', { title: title || document.title });
        return;
      }
    } catch(e) {}
  }

  /* ===== DOM: Build overlay + stylesheet once ===== */
  function buildOverlay(){
    if (document.getElementById('dpo-overlay')) return;

    const style = document.createElement('style');
    style.id = 'dpo-styles';
    style.textContent = `
      /* Tunable hero height variable (scoped to overlay) */
      #dpo-overlay{ --dpo-hero-h: 60vh; }
      @media (max-width: 768px){ #dpo-overlay{ --dpo-hero-h: 46vh; } }

      .dpo{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;backdrop-filter:blur(2px)}
      .dpo-hidden{display:none}
      .dpo-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);opacity:0;transition:opacity .18s ease}
      .dpo-card{position:relative;z-index:2;width:min(980px,96vw);max-width:100vw;max-height:92vh;overflow:hidden;background:#fff;color:#0e1214;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);transform:translateY(16px) scale(.985);opacity:0;transition:transform .22s ease,opacity .22s ease;display:grid;grid-template-rows:auto 1fr;box-sizing:border-box;overflow-x:hidden}
      .dpo[data-open="true"] .dpo-backdrop{opacity:1}
      .dpo[data-open="true"] .dpo-card{transform:translateY(0) scale(1);opacity:1}
      .dpo-close{position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:999px;border:1px solid rgba(0,0,0,.08);background:rgba(255,255,255,.92);backdrop-filter:blur(4px);box-shadow:0 4px 14px rgba(0,0,0,.22);font-size:24px;line-height:1;cursor:pointer;z-index:20;pointer-events:auto}
      .dpo-close:hover{background:rgba(255,255,255,.98)}
      $1
      .dpo-article{overscroll-behavior-y:contain; height:100%; overflow:auto; -webkit-overflow-scrolling:touch}
      .dpo-content{overscroll-behavior-y:contain}
      .dpo-header{position:relative;z-index:6;padding:20px 24px 8px;border-bottom:1px solid rgba(0,0,0,.06)}
      .dpo-title{margin:0;font-size:clamp(22px,3.2vw,30px);line-height:1.25}
      .dpo-meta{margin-top:6px;font-size:13px;opacity:.75}
      .dpo-hero{position:sticky; top:0; margin:0; height:var(--dpo-hero-h); max-height:var(--dpo-hero-h); overflow:hidden; z-index:1; min-height:0; border-top-left-radius:16px; border-top-right-radius:16px; background:#fff}
      .dpo-hero-stage{position:relative;width:100%;z-index:5}
      .dpo-hero-stage .dpo-fluid{position:relative;width:100%;padding-bottom:56.25%;height:0}
      .dpo-hero-stage .dpo-fluid iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
      .dpo-hero video{display:block;width:100%;height:auto}
      .dpo-hero img{display:block;width:100%;height:100%;object-fit:cover;object-position:center}
      .dpo-hero video{border-radius:inherit}
      .dpo-hero-stage{border-radius:inherit; overflow:hidden}
      .dpo-hero-stage .dpo-fluid{border-radius:inherit; overflow:hidden}
      .dpo-cap{font-size:12px;padding:8px 24px 0;color:#555}

      /* Step 1: content overlaps hero by 20px on load */
      .dpo-hero + .dpo-content{
        padding:20px;
        position:sticky; /* Step 3+4: pin, then scroll internally */
        top:30px;        /* pin offset below the hero */
        z-index:10;      /* sit above the sticky hero */
        margin:0;        /* keep our own block flow */
        /* overlap on load is handled by the sibling rule above */
        overflow:auto !important;   /* internal scroll when pinned (enforced to beat base .dpo-content) */
        -webkit-overflow-scrolling:touch;
        background:#ffffff9e !important;
        width:100%;
        border-radius:16px;
        box-shadow:0 0px 20px rgba(0,0,0,.2);
        backdrop-filter:blur(10px);
        box-sizing:border-box;
        overflow-x:hidden;
        /* constrain height so inner scroll is possible when pinned */
        max-height:calc(90dvh - 30px - 12px);
      }
      .dpo-hero[hidden] + .dpo-content{margin-top:0}

      /* Content card */
      /* Content card */
      .dpo-content{
        padding:20px; /* Step 2: ride with article scroll */
        position:relative; /* ensure z-index stacks above hero */
        overflow:visible;
        -webkit-overflow-scrolling:auto;
        background:#ffffff9e !important;
        z-index:10;
        width:100%;
        margin:0;
        border-radius:16px;
        box-shadow:0 0px 20px rgba(0,0,0,.2);
        backdrop-filter:blur(10px);
        box-sizing:border-box;
        overflow-x:hidden;
      }
      .dpo-content img,.dpo-content video,.dpo-content iframe{max-width:100%;height:auto}
      html.dpo-lock,body.dpo-lock{overflow:hidden !important}
      .dpo-content .dpo-fluid{position:relative;width:100%;padding-bottom:56.25%;height:0;overflow:hidden}
      .dpo-content .dpo-fluid iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
      .dpo[data-video-stage="true"] .dpo-content{padding:0}
      /* When a video is staged, let hero expand and hide img/caption */
      .dpo[data-video-stage="true"] .dpo-hero{max-height:none}
      .dpo[data-video-stage="true"] .dpo-hero img,
      .dpo[data-video-stage="true"] .dpo-hero .dpo-cap{display:none !important}

      /* Divi grid normalization inside overlay (legacy) */
      #dpo-overlay .et_pb_section{background:none !important;background-color:transparent !important}
      #dpo-overlay .et_pb_row{display:grid !important;grid-template-columns:1fr 1fr;gap:clamp(16px,2.5vw,28px);align-items:start;max-width:100%;min-width:0;overflow-x:hidden}
      #dpo-overlay .et_pb_column{min-width:0;max-width:100%}
      #dpo-overlay .et_pb_image img{width:100% !important;height:auto !important}
      #dpo-overlay .dpo-content *{max-width:100%}

      /* Title inside content */
      .dpo-h1{margin:0 0 14px;font-size:clamp(24px,3.4vw,34px);line-height:1.2;font-weight:700}

      /* Clean DPO grid (server-stripped Divi -> rebuilt here) */
      #dpo-overlay .dpo-grid{display:grid;grid-template-columns:1fr 1fr;gap:clamp(16px,2.5vw,28px);align-items:start;max-width:100%;min-width:0;overflow-x:hidden}
      #dpo-overlay .dpo-col{min-width:0;max-width:100%}
      #dpo-overlay .dpo-section{display:block}
      #dpo-overlay .dpo-section .dpo-grid{margin-top:10px}
      @media (max-width:1024px){ #dpo-overlay .dpo-grid{grid-template-columns:1fr} }

      /* Bottom sheet modifier */
      .dpo.dpo--sheet{place-items:end center !important;padding-bottom:env(safe-area-inset-bottom,0)}
      .dpo.dpo--sheet .dpo-card{width:min(980px,96vw);height:90dvh;max-height:90dvh;border-radius:16px 16px 0 0}
      /* Close in hero modifier */
      .dpo.dpo--close-in-hero .dpo-hero{ /* removed position override so sticky works */ }
      .dpo.dpo--close-in-hero .dpo-close{top:12px;right:12px}
      /* Hide header modifier */
      .dpo.dpo--no-header .dpo-header{display:none !important}
      .dpo.dpo--no-header .dpo-article{grid-template-rows:auto 1fr}
      /* Responsive */
      @media (min-width:1200px){ .dpo-card{width:min(980px,92vw)} }
      @media (max-width:1024px){ .dpo-card{width:96vw;max-height:92vh} .dpo-content{padding:16px 18px 20px} #dpo-overlay .et_pb_row{grid-template-columns:1fr} }
      @media (max-width:768px){ .dpo.dpo--sheet .dpo-card{width:100vw;height:92dvh;max-height:92dvh;border-radius:16px 16px 0 0} .dpo-close{top:calc(8px + env(safe-area-inset-top));right:calc(8px + env(safe-area-inset-right))} .dpo-content{padding:12px 16px 24px} #dpo-overlay .et_pb_row{grid-template-columns:1fr;gap:16px} }
    `;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = 'dpo-overlay';
    overlay.setAttribute('data-version','102025.11.2.2');
    try{ console.debug('[DPO] version 102025.11.2.2 loaded'); }catch(e){}
    overlay.className = 'dpo dpo-hidden' + (USE_SHEET ? ' dpo--sheet' : '') + (HIDE_HEADER ? ' dpo--no-header' : '') + ' dpo--close-in-hero';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="dpo-backdrop" data-dpo-close></div>
      <div class="dpo-card" role="dialog" aria-modal="true" aria-labelledby="dpo-title" aria-describedby="dpo-content">
        <button class="dpo-close" type="button" aria-label="Close" title="Close (Esc)" data-dpo-close>×</button>
        <article class="dpo-article">
          <header class="dpo-header">
            <h2 id="dpo-title" class="dpo-title"></h2>
            <div class="dpo-meta" hidden></div>
          </header>
          <figure class="dpo-hero" hidden>
            <img id="dpo-hero-img" alt="" />
            <figcaption id="dpo-hero-cap" class="dpo-cap" hidden></figcaption>
            <div class="dpo-hero-stage" hidden></div>
          </figure>
          <div id="dpo-content" class="dpo-content"></div>
        </article>
      </div>`;
    document.body.appendChild(overlay);

    refs = {
      btnClose: overlay.querySelector('[data-dpo-close]'),
      titleEl: overlay.querySelector('#dpo-title'),
      metaEl: overlay.querySelector('.dpo-meta'),
      hero: overlay.querySelector('.dpo-hero'),
      heroImg: overlay.querySelector('#dpo-hero-img'),
      heroCap: overlay.querySelector('#dpo-hero-cap'),
      heroStage: overlay.querySelector('.dpo-hero-stage'),
      contentEl: overlay.querySelector('#dpo-content')
    };
  }

  /* ===== Helpers: portfolio link, id, meta/hero ===== */
  function isPortfolioLink(a){ return !!(a && a.matches('a') && a.closest(SEL_PORTFOLIO) && a.closest('.et_pb_portfolio_item')); }
  function getIdFromItem(a){ const item = a.closest('.et_pb_portfolio_item'); return (item && /^post-(\d+)$/.test(item.id)) ? Number(item.id.replace('post-','')) : null; }
  function setMetaFromWP(meta){
    const tax = (meta._embedded && (meta._embedded['wp:term']||[]).flat()) || [];
    const names = tax.filter(t => TAXONOMY_META.includes(t.taxonomy)).map(t => t.name);
    if (!refs.metaEl) return;
    if (names.length){ refs.metaEl.hidden = false; refs.metaEl.textContent = names.join(' • '); }
    else { refs.metaEl.hidden = true; refs.metaEl.textContent = ''; }
  }
  function setHeroFromWP(meta){
    const media = meta._embedded && meta._embedded['wp:featuredmedia'];
    if (media && media[0] && media[0].source_url){
      refs.heroImg.src = media[0].source_url;
      const cap = media[0].caption?.rendered ? media[0].caption.rendered.replace(/<[^>]*>/g,'') : '';
      refs.heroCap.textContent = cap; refs.heroCap.hidden = !cap;
      refs.hero.hidden = false;
    } else {
      refs.heroImg.removeAttribute('src'); refs.hero.hidden = true; refs.heroCap.hidden = true; refs.heroCap.textContent = '';
    }
  }

  /* ===== Media detection & enhancement ===== */
  function isYouTube(u){ try{const x=new URL(u); return /(^|\.)youtube\.com$/.test(x.hostname)||x.hostname==='youtu.be';}catch{return false;} }
  function isVimeo(u){ try{const x=new URL(u); return /(^|\.)vimeo\.com$/.test(x.hostname);}catch{return false;} }
  function isVideoFile(u){ return /(\.|\/)(mp4|webm|ogg|ogv|mov)(\?|#|$)/i.test(u||''); }
  function ytEmbed(u){ try{ const x=new URL(u, window.location.origin); let id=''; if(x.hostname==='youtu.be') id=x.pathname.slice(1); else if(x.searchParams.has('v')) id=x.searchParams.get('v'); else { const parts=x.pathname.split('/').filter(Boolean); id=(parts[0]==='embed'||parts[0]==='shorts')?parts[1]:''; } return id?`https://www.youtube.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`:null; } catch { return null; } }
  function vimeoEmbed(u){ const m=(u||'').match(/vimeo\.com\/(?:video\/)?(\d+)/); return m?`https://player.vimeo.com/video/${m[1]}?autoplay=1&pip=1`:null; }

  function replaceAnchorWithPlayer(a){
    const href=a.getAttribute('href')||'';
    if (isYouTube(href) || isVimeo(href)){
      const src = isYouTube(href) ? ytEmbed(href) : vimeoEmbed(href);
      if (!src) return;
      const wrap=document.createElement('div'); wrap.className='dpo-fluid dpo-stage-wrap';
      const iframe=document.createElement('iframe'); iframe.src=src; iframe.setAttribute('allow','autoplay; encrypted-media; picture-in-picture'); iframe.setAttribute('allowfullscreen','true');
      wrap.appendChild(iframe); a.replaceWith(wrap); enterVideoFocus(iframe);
      return;
    }
    if (isVideoFile(href)){
      const wrap=document.createElement('div'); wrap.className='dpo-stage-wrap';
      const video=document.createElement('video'); video.src=href; video.controls=true; video.playsInline=true; video.autoplay=true; wrap.appendChild(video);
      a.replaceWith(wrap); enterVideoFocus(video);
    }
  }

  function enhanceEmbeds(root){
    root.querySelectorAll('iframe').forEach(iframe=>{
      const src=iframe.getAttribute('src')||'';
      if (isYouTube(src) || isVimeo(src)){
        iframe.setAttribute('allow','autoplay; encrypted-media; picture-in-picture');
        iframe.setAttribute('allowfullscreen','true');
        if (!iframe.parentElement.classList.contains('dpo-fluid')){
          const wrap=document.createElement('div'); wrap.className='dpo-fluid'; iframe.replaceWith(wrap); wrap.appendChild(iframe);
        }
      }
    });
    wireHtml5VideosForStaging(root);
  }

  /* ===== Staging: promote player to hero and restore ===== */
  function ensureStageWrapper(node){
    // Always move a wrapper we control
    if (node.classList && node.classList.contains('dpo-stage-wrap')) return node;
    const wrap = document.createElement('div'); wrap.className = 'dpo-stage-wrap';
    node.replaceWith(wrap); wrap.appendChild(node); return wrap;
  }
  function getFirstPlayer(root){ return root.querySelector('.dpo-fluid iframe, iframe, video'); }

  function promotePlayerToHero(){
    const player = getFirstPlayer(refs.contentEl);
    if (!player) return;

    const wrap = ensureStageWrapper(player);
    if (!STAGE_MAP.has(wrap)) STAGE_MAP.set(wrap, { parent: wrap.parentElement, next: wrap.nextSibling });

    refs.heroImg && (refs.heroImg.hidden = true);
    refs.heroCap && (refs.heroCap.hidden = true);
    refs.hero.hidden = false;

    refs.heroStage.hidden = false;
    refs.heroStage.replaceChildren(wrap);
    overlay.dataset.videoStage = 'true';
  }

  function restorePlayerFromHero(){
    const staged = refs.heroStage.querySelector('.dpo-stage-wrap, iframe, video');
    if (staged){
      const wrap = staged.classList?.contains('dpo-stage-wrap') ? staged : staged.closest('.dpo-stage-wrap') || staged;
      const rec = STAGE_MAP.get(wrap);
      if (rec && rec.parent){
        if (rec.next && rec.next.parentNode === rec.parent) rec.parent.insertBefore(wrap, rec.next);
        else rec.parent.appendChild(wrap);
      }
    }
    refs.heroStage.replaceChildren();
    refs.heroStage.hidden = true;
    refs.heroImg && (refs.heroImg.hidden = false);
    refs.heroCap && (refs.heroCap.hidden = !refs.heroCap.textContent.trim());
    overlay.dataset.videoStage = 'false';
  }

  function enterVideoFocus(_node){ promotePlayerToHero(); refs.hero.scrollIntoView({ block:'start', behavior:'smooth' }); }
  function exitVideoFocus(){ restorePlayerFromHero(); }

  function wireHtml5VideosForStaging(root){
    root.querySelectorAll('video').forEach(v => {
      v.addEventListener('play', () => { try { v.setAttribute('playsinline',''); } catch {} enterVideoFocus(); }, { once:true, passive:true });
    });
  }

  /* ===== Pull-up sheet behavior (content rides up, then becomes its own scroller) ===== */
  function wirePullUp(){
    const card    = overlay.querySelector('.dpo-card');
    const article = overlay.querySelector('.dpo-article');
    const content = refs.contentEl;
    if (!card || !article || !content) return;

    // Ensure the outer scroller actually scrolls
    article.style.overflow = 'auto';
    article.style.webkitOverflowScrolling = 'touch';

    let capPx = 0; // max translate in px (stop point)
    let scroller = null;

    function getScroller(){
      const cands = [article, card, overlay, document.scrollingElement];
      for (const el of cands){
        if (!el) continue;
        const cs = getComputedStyle(el);
        const canScroll = (el.scrollHeight - el.clientHeight) > 1 && /(auto|scroll)/.test(cs.overflowY || cs.overflow);
        if (canScroll) return el;
      }
      return article;
    }

    function measure(){
      capPx = Math.max(0, Math.floor(card.clientHeight * 0.90));
      apply((scroller && scroller.scrollTop) || 0);
    }

    function apply(st){
      const overlap = Math.min(st, capPx);
      content.style.setProperty('--dpo-pull', overlap + 'px');
      if (overlap < capPx){
        content.style.overflow = 'visible';
        content.style.webkitOverflowScrolling = 'auto';
      } else {
        content.style.overflow = 'auto';
        content.style.webkitOverflowScrolling = 'touch';
      }
    }

    function onScroll(){ apply(scroller.scrollTop || 0); }

    function onOpen(){
      // Ensure article is the primary scroller
      article.style.overflow = 'auto';
      article.style.webkitOverflowScrolling = 'touch';
      scroller = getScroller() || article;
      measure();

      // Re-measure when images load inside the content
      content.querySelectorAll('img').forEach(img=>{
        if (!img.complete) img.addEventListener('load', () => measure(), { once:true, passive:true });
      });

      scroller.removeEventListener('scroll', onScroll);
      scroller.addEventListener('scroll', onScroll, { passive:true });
    }

    const mo = new MutationObserver((muts)=>{
      for (const m of muts){
        if (m.type==='attributes' && m.attributeName==='data-open' && overlay.getAttribute('data-open')==='true'){
          onOpen();
        }
      }
    });
    mo.observe(overlay, { attributes:true, childList:true, subtree:true });

    window.addEventListener('resize', measure, { passive:true });
    if (window.visualViewport) visualViewport.addEventListener('resize', measure, { passive:true });
  }

  /* ===== Divi video modules ===== */
  function initDiviVideoModules(root){
    root.querySelectorAll('.et_pb_video').forEach(mod => {
      const overlayBtn = mod.querySelector('.et_pb_video_overlay a.et_pb_video_play');
      const box = mod.querySelector('.et_pb_video_box');
      if (!overlayBtn || !box) return;

      overlayBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const overWrap = mod.querySelector('.et_pb_video_overlay'); if (overWrap) overWrap.style.display = 'none';

        const vid = box.querySelector('video');
        if (vid) {
          box.querySelectorAll('source[data-src]').forEach(srcEl => { srcEl.setAttribute('src', srcEl.getAttribute('data-src')); srcEl.removeAttribute('data-src'); });
          if (!vid.getAttribute('src') && vid.dataset && vid.dataset.src) { vid.src = vid.dataset.src; delete vid.dataset.src; }
          vid.setAttribute('playsinline',''); if (!vid.hasAttribute('muted')) vid.muted = true;
          const p = vid.play(); if (p && typeof p.catch === 'function') p.catch(()=>{});
          enterVideoFocus(); return;
        }

        let iframe = box.querySelector('iframe') || box.querySelector('iframe[data-src]');
        if (iframe && iframe.hasAttribute('data-src')) { iframe.setAttribute('src', iframe.getAttribute('data-src')); iframe.removeAttribute('data-src'); }
        if (iframe) {
          try { const u = new URL(iframe.src || '', window.location.origin); if (!u.searchParams.has('autoplay')) { u.searchParams.set('autoplay','1'); iframe.src = u.toString(); } } catch {}
          enterVideoFocus();
        }
      }, { once:false });
    });
  }

  /* ===== Fetchers ===== */
  async function fetchRendered(id){
    const url = `${window.location.origin}/wp-json/dpo/v1/render/${id}?dpo=1`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Rendered content fetch failed');
    return res.json();
  }
  async function fetchMeta(id){
    const url = `${window.location.origin}/wp-json/wp/v2/${CPT_SLUG}/${id}?_embed=1`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Meta fetch failed');
    return res.json();
  }

  /* ===== Scroll handoff (minimal):
   - Before pin: wheel/touch on .dpo-content scrolls the outer article so the card rides over the hero.
   - After pin: inner content scrolls; when at top and scrolling up, give control back to article. */
  function wireScrollHandoff(){
    if (!overlay || !refs || !refs.contentEl) return;
    const card    = overlay.querySelector('.dpo-card');
    const article = overlay.querySelector('.dpo-article');
    const content = refs.contentEl;
    if (!card || !article || !content) return;

    const epsilon = 0.5; // geometry slop
    function pinTopPx(){ return card.getBoundingClientRect().top + PIN_OFFSET; }
    function isPinned(){ return content.getBoundingClientRect().top <= pinTopPx() + epsilon; }
    function redirect(dy){ article.scrollTop += dy; }

    // Wheel: desktop
    content.addEventListener('wheel', (e)=>{
      if (!isPinned()) { redirect(e.deltaY); e.preventDefault(); return; }
      const atTop = content.scrollTop <= 0;
      if (atTop && e.deltaY < 0) { redirect(e.deltaY); e.preventDefault(); }
    }, { passive:false });

    // Touch: mobile
    let startY = 0;
    content.addEventListener('touchstart', (e)=>{ const t=e.changedTouches&&e.changedTouches[0]; if (t) startY = t.clientY; }, { passive:true });
    content.addEventListener('touchmove', (e)=>{
      const t = e.changedTouches && e.changedTouches[0]; if (!t) return;
      const dy = startY - t.clientY; // >0 means dragging up (scrolling down)
      if (!isPinned()) { redirect(dy); e.preventDefault(); return; }
      const atTop = content.scrollTop <= 0;
      if (atTop && dy < 0) { redirect(dy); e.preventDefault(); }
    }, { passive:false });
  }

  /* ===== Overlay controller ===== */
  function openOverlay({ title, content, meta, urlForGA }){
    refs.titleEl.innerHTML = title || '';
    if (!HIDE_HEADER) setMetaFromWP(meta);
    setHeroFromWP(meta);

    refs.contentEl.innerHTML = content || '';
    enhanceEmbeds(refs.contentEl);
    initDiviVideoModules(refs.contentEl);
    // reset inner scroll and wire one-time handoff per open
    refs.contentEl.scrollTop = 0;
    if (!overlay.dataset.handoffWired) { wireScrollHandoff(); overlay.dataset.handoffWired = '1'; }

    document.documentElement.classList.add('dpo-lock');
    document.body.classList.add('dpo-lock');
    overlay.classList.remove('dpo-hidden');
    requestAnimationFrame(() => overlay.setAttribute('data-open','true'));

    overlay.setAttribute('aria-hidden','false');
    lastFocus = document.activeElement;
    refs.btnClose.focus();

    if (urlForGA){
      try { history.pushState({ dpo:true }, title || '', urlForGA); } catch {}
      sendPageView(urlForGA, title);
    }
  }

  function closeOverlay({ pop=false }={}){
    overlay.removeAttribute('data-open');
    exitVideoFocus();
    overlay.setAttribute('aria-hidden','true');
    setTimeout(() => {
      overlay.classList.add('dpo-hidden');
      document.documentElement.classList.remove('dpo-lock');
      document.body.classList.remove('dpo-lock');
    }, 180);

    if (!pop){
      try { history.pushState({ dpo:false }, '', baseUrl); } catch {}
      sendPageView(baseUrl, document.title);
    }
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function initOverlayEvents(){
    // keyboard
    document.addEventListener('keydown', (e) => {
      if (!overlay || overlay.classList.contains('dpo-hidden')) return;
      if (e.key === 'Escape') { closeOverlay(); return; }
      if (e.key === 'Tab') {
        const focusables = overlay.querySelectorAll('a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])');
        const list = Array.from(focusables).filter(el => !el.disabled && el.offsetParent !== null);
        if (!list.length) return;
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    // click outside/close button
    overlay.addEventListener('click', (e) => { if (e.target.hasAttribute('data-dpo-close')) closeOverlay(); });

    // inline media links
    refs.contentEl.addEventListener('click', (e)=>{
      const a = e.target.closest('a[href]'); if (!a) return;
      const href = a.getAttribute('href') || '';
      if (isYouTube(href) || isVimeo(href) || isVideoFile(href)){
        e.preventDefault(); replaceAnchorWithPlayer(a); enterVideoFocus();
      }
    });

    // portfolio open
    document.addEventListener('click', async (e) => {
      const a = e.target.closest('a');
      if (!isPortfolioLink(a)) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const id = getIdFromItem(a); if (!id) return; e.preventDefault();

      try {
        const [rendered, meta] = await Promise.all([ fetchRendered(id), fetchMeta(id) ]);
        const title = rendered.title || meta?.title?.rendered || '';
        const url = (rendered.link || meta?.link);
        openOverlay({ title, content: rendered.content, meta, urlForGA: url });
      } catch (err) {
        console.warn('DPO open failed, falling back:', err); window.location.href = a.href;
      }
    });

    // back/forward closes if open
    window.addEventListener('popstate', () => {
      if (!overlay.classList.contains('dpo-hidden')) closeOverlay({ pop:true });
    });
  }

  /* ===== Start ===== */
  function pageHasPortfolio(){ return !!document.querySelector(SEL_PORTFOLIO); }
  function start(){ if (!pageHasPortfolio()) return; buildOverlay(); initOverlayEvents(); /* pull-up unwired in 102025.8 */ }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true }); else start();

  /* ===== Public API (optional) ===== */
  window.DPO = {
    close: closeOverlay
  };
})();
