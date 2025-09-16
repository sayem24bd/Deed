// app.js — Improved & accessible version
document.addEventListener("DOMContentLoaded", () => {
  /*************************
   * Global State & Config
   *************************/
  let DATA = [];
  let FUSE = null;
  let bookmarks = (() => {
    try {
      const raw = localStorage.getItem("bookmarks");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(n => Number.isInteger(n)) : [];
    } catch {
      return [];
    }
  })();
  let theme = localStorage.getItem("theme") || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  let debounceTimer;
  let voices = [];

  /*************************
   * DOM Shortcuts
   *************************/
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const elements = {
    themeToggle: $("#themeToggle"),
    installBtn: $("#installBtn"),
    searchBox: $("#searchBox"),
    sortSelect: $("#sort"),
    clearFiltersBtn: $("#clearFilters"),
    controlsContainer: $("#controlsContainer"),
    mobileControlsContainer: $("#mobileControlsContainer"),
    searchWrap: $("#searchWrap"),
    sortWrap: $("#sortWrap"),
    filterToggleBtn: $("#filterToggleBtn"),
    sidebar: $(".sidebar"),
    sectionSelect: $("#section"),
    yearSelect: $("#year"),
    tagsWrap: $("#tagsWrap"),
    showBookmarksOnlyCheck: $("#showBookmarksOnly"),
    countDisplay: $("#count"),
    resultsWrap: $("#results"),
    bookmarksWrap: $("#bookmarks"),
  };

  /*************************
   * Utilities (safe)
   *************************/
  const escapeHTML = (str) => {
    if (str === undefined || str === null) return "";
    return String(str).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  };

  const buildHighlightedFragment = (text = "", keyword = "") => {
    const frag = document.createDocumentFragment();
    const safeText = String(text || "");
    if (!keyword) {
      frag.appendChild(document.createTextNode(safeText));
      return frag;
    }
    try {
      const k = String(keyword).trim();
      if (!k) {
        frag.appendChild(document.createTextNode(safeText));
        return frag;
      }
      const safeK = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safeK, "ig");
      let lastIndex = 0;
      let match;
      while ((match = rx.exec(safeText)) !== null) {
        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(safeText.slice(lastIndex, match.index)));
        }
        const span = document.createElement("span");
        span.className = "highlight";
        span.textContent = match[0];
        frag.appendChild(span);
        lastIndex = rx.lastIndex;
      }
      if (lastIndex < safeText.length) {
        frag.appendChild(document.createTextNode(safeText.slice(lastIndex)));
      }
      if (!frag.childNodes.length) frag.appendChild(document.createTextNode(safeText));
      return frag;
    } catch {
      frag.appendChild(document.createTextNode(safeText));
      return frag;
    }
  };

  const setQueryParams = (params) => {
    try {
      const url = new URL(location.href);
      Object.entries(params).forEach(([k, v]) => {
        if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) url.searchParams.delete(k);
        else if (Array.isArray(v)) url.searchParams.set(k, v.join(","));
        else url.searchParams.set(k, v);
      });
      history.replaceState(null, "", url.toString());
    } catch (err) {
      console.warn("Could not set query params:", err);
    }
  };

  const getQueryParam = (key) => {
    try {
      return new URL(location.href).searchParams.get(key);
    } catch {
      return null;
    }
  };

  const showToast = (message) => {
    try {
      const toast = document.createElement('div');
      toast.className = 'toast show';
      toast.textContent = String(message);
      document.body.appendChild(toast);
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    } catch (e) {
      console.log("Toast:", message);
    }
  };

  /*************************
   * Data Validation Helpers
   *************************/
    const validateDataArray = (arr) => {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const id = Number(item.id);
      if (!Number.isInteger(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const normalized = {
        id,
        question: String(item.question || "").trim(),
        answer: String(item.answer || "").trim(),
        details: String(item.details || "").trim(), // নতুন
        key_point: String(item.key_point || "").trim(),
        law_section: String(item.law_section || "").trim(),
        case_reference: String(item.case_reference || "").trim(),
        tags: Array.isArray(item.tags) ? item.tags.map(t => String(t).trim()).filter(Boolean) : [],
        keywords: Array.isArray(item.keywords) ? item.keywords.map(t => String(t).trim()).filter(Boolean) : [], // নতুন
        year: Number.isFinite(Number(item.year)) ? Number(item.year) : null,
        last_updated: String(item.last_updated || "").trim(), // নতুন
        source: String(item.source || "").trim(), // নতুন
        law_reference_link: String(item.law_reference_link || "").trim(), // নতুন
        related_ids: Array.isArray(item.related_ids) ? item.related_ids.filter(n => Number.isInteger(n)) : [] // নতুন
      };
      if (!normalized.question || !normalized.answer) continue;
      out.push(normalized);
    }
    return out;
  };

  /*************************
   * Core Logic: filter & render
   *************************/
  const applyFilters = () => {
    const keyword = elements.searchBox ? elements.searchBox.value.trim() : "";
    const section = elements.sectionSelect ? elements.sectionSelect.value : "";
    const year = elements.yearSelect && elements.yearSelect.value ? Number(elements.yearSelect.value) : "";
    const sort = elements.sortSelect ? elements.sortSelect.value : "relevance";
    const tags = elements.tagsWrap ? Array.from(elements.tagsWrap.querySelectorAll('input:checked')).map(c => c.value) : [];
    const showBookmarksOnly = elements.showBookmarksOnlyCheck && elements.showBookmarksOnlyCheck.checked;

    setQueryParams({ q: keyword, section, year, tags, sort, bookmarks: showBookmarksOnly ? 'true' : '' });

    let list = DATA.slice();

    // Use Fuse if available, otherwise use a simple fallback search
    if (keyword) {
      if (FUSE) {
        try {
          const results = FUSE.search(keyword);
          list = results.map(r => r.item);
        } catch (e) {
          console.warn("Fuse search failed:", e);
          list = simpleSearchFallback(list, keyword);
        }
      } else {
        list = simpleSearchFallback(list, keyword);
      }
    }

    list = list.filter(d => {
      const okSection = !section || d.law_section === section;
      const okYear = !year || Number(d.year) === Number(year);
      const okTags = tags.length === 0 || tags.every(t => d.tags.includes(t));
      const okBookmark = !showBookmarksOnly || bookmarks.includes(d.id);
      return okSection && okYear && okTags && okBookmark;
    });

    if (sort === "newest") list = [...list].sort((a, b) => (b.year || 0) - (a.year || 0));
    else if (sort === "az") list = [...list].sort((a, b) => a.question.localeCompare(b.question, "bn") || a.id - b.id);
    else if (sort === "section") list = [...list].sort((a, b) => a.law_section.localeCompare(b.law_section || "", "bn") || a.id - b.id);

    if (elements.countDisplay) elements.countDisplay.innerText = list.length ? `${list.length} ফলাফল পাওয়া গেছে` : "কোনো ফলাফল পাওয়া যায়নি";
    renderCards(list, elements.resultsWrap, keyword);
  };

    const simpleSearchFallback = (list, keyword) => {
    const k = String(keyword).toLowerCase();
    return list.filter(item => {
      return (
        (item.question && item.question.toLowerCase().includes(k)) ||
        (item.answer && item.answer.toLowerCase().includes(k)) ||
        (item.details && item.details.toLowerCase().includes(k)) || // নতুন
        (item.key_point && item.key_point.toLowerCase().includes(k)) ||
        (item.law_section && item.law_section.toLowerCase().includes(k)) ||
        (item.case_reference && item.case_reference.toLowerCase().includes(k)) || // case_reference যোগ করা হয়েছে, যদি এটি অনুপস্থিত থাকে
        (item.tags && item.tags.join(" ").toLowerCase().includes(k)) ||
        (item.keywords && item.keywords.join(" ").toLowerCase().includes(k)) // নতুন
      );
    });
  };

  const debouncedApply = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 300);
  };

  /*************************
   * Rendering (DOM API only)
   *************************/
  const createButton = (text, classes = [], attrs = {}) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = classes.join(" ");
    btn.textContent = text;
    Object.entries(attrs).forEach(([k, v]) => btn.setAttribute(k, v));
    return btn;
  };

  const renderCards = (list, containerEl, keyword = "") => {
    containerEl.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (const item of list) {
      const article = document.createElement("article");
      article.className = "card";
      article.dataset.id = String(item.id);
      article.setAttribute("aria-expanded", "false");

      const header = document.createElement("div");
      header.className = "card-header";
      header.dataset.action = "toggle";
      header.setAttribute("role", "button");
      header.setAttribute("tabindex", "0");
      header.setAttribute("aria-controls", `card-${item.id}-details`);

      const headerBold = document.createElement("b");
      headerBold.textContent = "প্রশ্ন: ";
      header.appendChild(headerBold);
      header.appendChild(buildHighlightedFragment(item.question, keyword));
      article.appendChild(header);

      const details = document.createElement("div");
      details.className = "card-details";
      details.id = `card-${item.id}-details`;
      details.setAttribute("aria-hidden", "true");


            // ... (existing code for answerDiv)
      const answerDiv = document.createElement("div");
      const answerBold = document.createElement("b");
      answerBold.textContent = "উত্তর: ";
      answerDiv.appendChild(answerBold);
      answerDiv.appendChild(buildHighlightedFragment(item.answer, keyword));
      details.appendChild(answerDiv);

      // Add details (can be an optional longer explanation)
      if (item.details) {
        const detailsDiv = document.createElement("div");
        const detailsBold = document.createElement("b");
        detailsBold.textContent = "বিস্তারিত: ";
        detailsDiv.appendChild(detailsBold);
        detailsDiv.appendChild(buildHighlightedFragment(item.details, keyword));
        details.appendChild(detailsDiv);
      }

      const keyDiv = document.createElement("div");
      const keyBold = document.createElement("b");
      keyBold.textContent = "কিওয়ার্ড: ";
      keyDiv.appendChild(keyBold);
      keyDiv.appendChild(buildHighlightedFragment(item.key_point || "-", keyword));
      details.appendChild(keyDiv);

      const sectionDiv = document.createElement("div");
      const secBold = document.createElement("b");
      secBold.textContent = "ধারা: ";
      sectionDiv.appendChild(secBold);
      sectionDiv.appendChild(buildHighlightedFragment(item.law_section || "-", keyword));
      details.appendChild(sectionDiv);

      const caseDiv = document.createElement("div");
      const caseBold = document.createElement("b");
      caseBold.textContent = "মামলা: ";
      caseDiv.appendChild(caseBold);
      caseDiv.appendChild(buildHighlightedFragment(item.case_reference || "কোনো মামলা রেফারেন্স নেই", keyword));
      details.appendChild(caseDiv);

      // Updated meta information
      const meta = document.createElement("div");
      meta.className = "meta";
      let metaContent = `ট্যাগ: ${item.tags.map(t => `#${t}`).join(" · ")}`;
      if (item.keywords && item.keywords.length) {
        metaContent += ` | কিওয়ার্ড: ${item.keywords.map(k => `#${k}`).join(" · ")}`;
      }
      metaContent += ` | সাল: ${item.year || "N/A"}`;
      if (item.source) {
        metaContent += ` | উৎস: ${escapeHTML(item.source)}`;
      }
      if (item.last_updated) {
        metaContent += ` | শেষ আপডেট: ${escapeHTML(item.last_updated)}`;
      }
      meta.textContent = metaContent;
      details.appendChild(meta);

      // Law Reference Link
      if (item.law_reference_link) {
        const linkDiv = document.createElement("div");
        const linkBold = document.createElement("b");
        linkBold.textContent = "লিংক: ";
        linkDiv.appendChild(linkBold);
        const lawLink = document.createElement("a");
        lawLink.href = item.law_reference_link;
        lawLink.textContent = "ক্লিক";
        lawLink.target = "_blank";
        lawLink.rel = "noopener noreferrer";
        linkDiv.appendChild(lawLink);
        details.appendChild(linkDiv);
      }

      // Related IDs (as links or just text)
      if (item.related_ids && item.related_ids.length) {
        const relatedDiv = document.createElement("div");
        const relatedBold = document.createElement("b");
        relatedBold.textContent = "সংশ্লিষ্ট: ";
        relatedDiv.appendChild(relatedBold);
        item.related_ids.forEach((relId, index) => {
          const relatedLink = document.createElement("a");
          relatedLink.href = `?id=${relId}`; // Link to the specific card
          relatedLink.textContent = `ID ${relId}`;
          relatedLink.onclick = (e) => {
            e.preventDefault();
            // Scroll to and highlight the related card (if it's on the same page)
            const targetCard = document.querySelector(`.card[data-id="${relId}"]`);
            if (targetCard) {
              targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
              targetCard.classList.add('expanded', 'card-highlighted');
              targetCard.setAttribute('aria-expanded', 'true');
              const det = targetCard.querySelector('.card-details');
              if (det) det.setAttribute('aria-hidden', 'false');
              setTimeout(() => targetCard.classList.remove('card-highlighted'), 2500);
            } else {
              // If not on the current page, navigate
              window.location.href = `?id=${relId}`;
            }
          };
          relatedDiv.appendChild(relatedLink);
          if (index < item.related_ids.length - 1) {
            relatedDiv.appendChild(document.createTextNode(", "));
          }
        });
        details.appendChild(relatedDiv);
      }
	  

      const actions = document.createElement("div");
      actions.className = "actions";

      const isBookmarked = bookmarks.includes(item.id);
      const bookmarkBtn = createButton(isBookmarked ? "🔖 বুকমার্ক সরান" : "🔖 বুকমার্ক করুন", [isBookmarked ? "danger" : "primary"]);
      bookmarkBtn.dataset.action = "bookmark";
      bookmarkBtn.dataset.id = String(item.id);
      bookmarkBtn.setAttribute("aria-pressed", isBookmarked ? "true" : "false");
      bookmarkBtn.setAttribute("title", isBookmarked ? "বুকমার্ক সরান" : "বুকমার্ক করুন");
      actions.appendChild(bookmarkBtn);

      const linkToCopy = `${location.origin}${location.pathname}?id=${encodeURIComponent(item.id)}`;
      const shareBtn = createButton("🔗 লিংক কপি");
      shareBtn.dataset.action = "share";
      shareBtn.dataset.link = linkToCopy;
      actions.appendChild(shareBtn);

      const speakBtn = createButton("🔊");
      speakBtn.title = "উত্তরটি শুনুন";
      speakBtn.dataset.action = "speak";
      speakBtn.dataset.id = String(item.id);
      actions.appendChild(speakBtn);

      details.appendChild(actions);
      article.appendChild(details);
      fragment.appendChild(article);
    }
    containerEl.appendChild(fragment);
  };

  const renderBookmarks = () => {
    const bookmarkedItems = DATA.filter(d => bookmarks.includes(d.id));
    if (bookmarkedItems.length === 0) {
      elements.bookmarksWrap.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "meta";
      empty.textContent = "কোনো বুকমার্ক নেই";
      elements.bookmarksWrap.appendChild(empty);
      return;
    }
    renderCards(bookmarkedItems, elements.bookmarksWrap, elements.searchBox.value.trim());
  };

  /*************************
   * Actions & Event Handlers
   *************************/
  const handleCardClick = (event, containerEl) => {
    const actionTarget = event.target.closest("[data-action]");
    // Support clicking on .card-header (it has data-action="toggle")
    const headerTarget = event.target.closest(".card-header");
    const target = actionTarget || headerTarget;
    if (!target) return;

    const card = target.closest(".card");
    if (!card) return;
    const action = target.dataset.action || target.dataset.action === undefined ? target.dataset.action || "toggle" : null;
    const id = Number(card.dataset.id);
    if (!Number.isInteger(id)) return;

    if (action === "toggle" || target.classList.contains("card-header") || target.matches(".card-header")) {
      const isExpanded = card.classList.contains("expanded");
      $$(".card").forEach(c => {
        c.classList.remove("expanded");
        c.setAttribute("aria-expanded", "false");
        const det = c.querySelector(".card-details");
        if (det) det.setAttribute("aria-hidden", "true");
      });
      if (!isExpanded) {
        card.classList.add("expanded");
        card.setAttribute("aria-expanded", "true");
        const det = card.querySelector(".card-details");
        if (det) det.setAttribute("aria-hidden", "false");
      }
      return;
    }

    const item = DATA.find(d => d.id === id);

    if (action === "bookmark") {
      toggleBookmark(id);
    } else if (action === "share") {
      const linkToCopy = target.dataset.link;
      safeCopyToClipboard(linkToCopy);
    } else if (action === "speak") {
      if (item) speakText(item.answer);
    }
  };

  // Bookmarks contain only IDs (array of ints)
  const toggleBookmark = (id) => {
    if (!Number.isInteger(id)) return;
    const idx = bookmarks.indexOf(id);
    if (idx >= 0) {
      bookmarks.splice(idx, 1);
      showToast("বুকমার্ক সরানো হয়েছে");
    } else {
      if (!DATA.some(d => d.id === id)) {
        showToast("বৈধ আইটেম নয়");
        return;
      }
      bookmarks.push(id);
      showToast("বুকমার্ক করা হয়েছে");
    }
    try {
      localStorage.setItem("bookmarks", JSON.stringify(bookmarks));
    } catch (e) {
      console.warn("Could not persist bookmarks:", e);
    }
    applyFilters();
    renderBookmarks();
    // update visible buttons' aria-pressed/text
    $$('button[data-action="bookmark"]').forEach(btn => {
      const bid = Number(btn.dataset.id);
      const pressed = bookmarks.includes(bid);
      btn.setAttribute("aria-pressed", pressed ? "true" : "false");
      btn.textContent = pressed ? "🔖 বুকমার্ক সরান" : "🔖 বুকমার্ক করুন";
      btn.className = pressed ? "danger" : "primary";
      btn.setAttribute("title", pressed ? "বুকমার্ক সরান" : "বুকমার্ক করুন");
    });
  };

  /*************************
   * Clipboard (modern + fallback safe)
   *************************/
  const safeCopyToClipboard = async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(String(text));
        showToast("লিংক কপি হয়েছে!");
        return;
      }
      const ta = document.createElement("textarea");
      ta.value = String(text);
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(ok ? "লিংক কপি হয়েছে!" : "কপি করা সম্ভব হয়নি");
    } catch (e) {
      console.warn("Copy failed: ", e);
      showToast("কপি করা সম্ভব হয়নি");
    }
  };

  /*************************
   * Speech (safe handling)
   *************************/
  const populateVoiceList = () => {
    if (typeof speechSynthesis === 'undefined') return;
    voices = speechSynthesis.getVoices() || [];
  };

  const speakText = (text) => {
    if (typeof speechSynthesis === 'undefined') {
      showToast("দুঃখিত, আপনার ব্রাউজার এটি সমর্থন করে না।");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text));
    utterance.lang = 'bn-BD';
    const bengaliVoice = voices.find(v => v.lang && (v.lang.startsWith('bn') || v.lang.startsWith('bn-')));
    if (bengaliVoice) utterance.voice = bengaliVoice;
    if (!voices.length && typeof speechSynthesis.getVoices === "function") {
      populateVoiceList();
      if (voices.length) {
        const v = voices.find(v => v.lang && (v.lang.startsWith('bn') || v.lang.startsWith('bn-')));
        if (v) utterance.voice = v;
      }
    }
    try {
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("Speak failed:", e);
      showToast("শব্দে শুনানো সম্ভব হয়নি");
    }
  };

  /*************************
   * Responsive Element Placement
   *************************/
  const manageControlPlacement = () => {
    const isMobile = window.innerWidth < 960;
    try {
      if (isMobile) {
        elements.mobileControlsContainer.appendChild(elements.searchWrap);
        elements.mobileControlsContainer.appendChild(elements.sortWrap);
      } else {
        elements.controlsContainer.prepend(elements.sortWrap);
        elements.controlsContainer.prepend(elements.searchWrap);
      }
    } catch (e) {
      console.warn("manageControlPlacement err:", e);
    }
  };

  /*************************
   * Setup event listeners
   *************************/
  const setupEventListeners = () => {
    if (elements.themeToggle) {
      elements.themeToggle.addEventListener("click", () => {
        theme = (theme === "dark") ? "light" : "dark";
        document.body.classList.toggle("dark", theme === "dark");
        localStorage.setItem("theme", theme);
        elements.themeToggle.textContent = theme === "dark" ? "☀️ Light" : "🌙 Dark";
      });
    }

    let deferredPrompt;
    window.addEventListener("beforeinstallprompt", (e) => {
      try {
        e.preventDefault();
        deferredPrompt = e;
        if (elements.installBtn) elements.installBtn.hidden = false;
      } catch { /* ignore */ }
    });

    if (elements.installBtn) {
      elements.installBtn.addEventListener("click", async () => {
        try {
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          elements.installBtn.hidden = true;
          deferredPrompt = null;
        } catch (e) { console.warn("Install prompt failed:", e); }
      });
    }

    if (elements.filterToggleBtn) {
      elements.filterToggleBtn.addEventListener("click", () => {
        document.body.classList.toggle("filter-open");
      });
    }

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(manageControlPlacement, 150);
    });

    document.addEventListener("click", (e) => {
      if (!document.body.classList.contains("filter-open")) return;
      const clickedInsideSidebar = elements.sidebar && elements.sidebar.contains(e.target);
      const clickedOnToggleButton = elements.filterToggleBtn && elements.filterToggleBtn.contains(e.target);
      if (clickedInsideSidebar || clickedOnToggleButton) return;
      document.body.classList.remove("filter-open");
    });

    if (elements.searchBox) elements.searchBox.addEventListener("input", debouncedApply);

    ['change', 'click'].forEach(evt => {
      if (elements.sectionSelect) elements.sectionSelect.addEventListener(evt, applyFilters);
      if (elements.yearSelect) elements.yearSelect.addEventListener(evt, applyFilters);
      if (elements.sortSelect) elements.sortSelect.addEventListener(evt, applyFilters);
      if (elements.showBookmarksOnlyCheck) elements.showBookmarksOnlyCheck.addEventListener(evt, applyFilters);
    });

    if (elements.tagsWrap) elements.tagsWrap.addEventListener("change", (e) => { if (e.target && e.target.name === "tags") applyFilters(); });

    if (elements.clearFiltersBtn) {
      elements.clearFiltersBtn.addEventListener("click", () => {
        if (elements.searchBox) elements.searchBox.value = "";
        if (elements.sectionSelect) elements.sectionSelect.value = "";
        if (elements.yearSelect) elements.yearSelect.value = "";
        if (elements.sortSelect) elements.sortSelect.value = "relevance";
        if (elements.showBookmarksOnlyCheck) elements.showBookmarksOnlyCheck.checked = false;
        $$('input[name="tags"]').forEach(cb => cb.checked = false);
        applyFilters();
      });
    }

    if (elements.resultsWrap) {
      elements.resultsWrap.addEventListener("click", (e) => handleCardClick(e, elements.resultsWrap));
      // keyboard support for toggling header (Enter / Space)
      elements.resultsWrap.addEventListener("keydown", (e) => {
        const hdr = e.target.closest(".card-header");
        if (!hdr) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          hdr.click();
        }
      });
    }
    if (elements.bookmarksWrap) elements.bookmarksWrap.addEventListener("click", (e) => handleCardClick(e, elements.bookmarksWrap));
  };

  /*************************
   * Highlight card from URL (if id param present)
   *************************/
  const highlightCardFromURL = () => {
    try {
      const cardId = getQueryParam('id');
      if (!cardId) return;
      const cardElement = document.querySelector(`.card[data-id="${cardId}"]`);
      if (!cardElement) return;
      cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cardElement.classList.add('expanded', 'card-highlighted');
      cardElement.setAttribute('aria-expanded', 'true');
      const det = cardElement.querySelector('.card-details');
      if (det) det.setAttribute('aria-hidden', 'false');
      setTimeout(() => cardElement.classList.remove('card-highlighted'), 2500);
    } catch (e) { console.warn(e); }
  };

  /*************************
   * Initialization
   *************************/
  async function init() { 
	const url = new URL(window.location.href);
	// ✅ প্রথমবার নিজের ব্রাউজারে খোলা হলে (sessionStorage এ flag নেই)
	/*if (!sessionStorage.getItem("visited_before")) {
    sessionStorage.setItem("visited_before", "true");
	*/
  if (url.searchParams.has("id")) { 
   
   // যদি শেয়ার লিংক থেকে না খোলা হয় তবে id মুছে দিন
 /* url.searchParams.delete("id");
      history.replaceState(null, "", url.toString());
    } */
  
    }
    document.body.classList.toggle("dark", theme === "dark");
    if (elements.themeToggle) elements.themeToggle.textContent = theme === "dark" ? "☀️ Light" : "🌙 Dark";

    populateVoiceList();
    if (typeof speechSynthesis !== 'undefined' && typeof speechSynthesis.onvoiceschanged !== 'undefined') {
      speechSynthesis.onvoiceschanged = populateVoiceList;
    }

    // load data.json (if missing, handle gracefully)
    try {
      const res = await fetch('./data.json', { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const raw = await res.json();
      const validated = validateDataArray(raw);
      if (!validated.length) {
        if (elements.countDisplay) elements.countDisplay.innerText = "ডেটা খালি বা অকার্যকর।";
        DATA = [];
      } else {
        DATA = validated;
      }
    } catch (err) {
      console.error("Could not load data:", err);
      if (elements.countDisplay) elements.countDisplay.innerText = "ডেটা লোড করতে ব্যর্থ। (data.json ফাইল আছে কি দেখুন)";
      DATA = [];
    }

    // Setup Fuse only if available and DATA non-empty
    if (typeof Fuse !== 'undefined' && Array.isArray(DATA) && DATA.length > 0) {
      try {
               FUSE = new Fuse(DATA, {
          keys: ['question', 'answer', 'details', 'key_point', 'law_section', 'case_reference', 'tags', 'keywords'],
          includeScore: true,
          threshold: 0.4
        });
      } catch (e) {
        console.warn("Could not initialize Fuse:", e);
        FUSE = null;
      }
    } else {
      FUSE = null;
    }

    // populate UI filters
    try {
      const uniqueSections = Array.from(new Set(DATA.map(d => d.law_section))).filter(s => s).sort();
      const uniqueYears = Array.from(new Set(DATA.map(d => d.year).filter(Boolean))).sort((a, b) => b - a);
      const uniqueTags = Array.from(new Set(DATA.flatMap(d => d.tags))).filter(t => t).sort();

      if (elements.sectionSelect) {
        elements.sectionSelect.innerHTML = `<option value="">সব ধারা</option>`;
        for (const s of uniqueSections) {
          const opt = document.createElement("option");
          opt.value = s;
          opt.textContent = s;
          elements.sectionSelect.appendChild(opt);
        }
      }

      if (elements.yearSelect) {
        elements.yearSelect.innerHTML = `<option value="">সব সাল</option>`;
        for (const y of uniqueYears) {
          const opt = document.createElement("option");
          opt.value = y;
          opt.textContent = y;
          elements.yearSelect.appendChild(opt);
        }
      }

      if (elements.tagsWrap) {
        elements.tagsWrap.innerHTML = "";
        for (const tag of uniqueTags) {
          const label = document.createElement("label");
          label.className = "tag";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.name = "tags";
          cb.value = tag;
          const span = document.createElement("span");
          span.textContent = tag;
          label.appendChild(cb);
          label.appendChild(document.createTextNode(" "));
          label.appendChild(span);
          elements.tagsWrap.appendChild(label);
        }
      }
    } catch (e) {
      console.warn("Could not render filter panel:", e);
    }

    setupEventListeners();
    manageControlPlacement();
    applyFilters();
    renderBookmarks();
    // Give DOM a moment then highlight if id present
    setTimeout(highlightCardFromURL, 200);

   if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
    }
  }

  init();
});
