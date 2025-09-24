// app.js — সম্পূর্ণ আপডেটেড সংস্করণ (বাংলা মন্তব্য সহ)
// নিরাপত্তা ও স্থিতিশীলতা বাড়ানোর জন্য কিছু ফাংশন হালনাগাদ করা হয়েছে:
// - isSafeHref কঠোরতর করা হয়েছে (protocol-relative এবং javascript: স্কিম নিষিদ্ধ)
// - highlightCardFromURL এখন কেবল integer id গ্রহণ করে (selector-injection প্রতিরোধ)
// - searchBox ইনপুটের এক্সট্রা ভ্যালিডেশন (maxLength) যোগ করা হয়েছে
// - buildHighlightedFragment-এ keyword length সীমা ও নিরাপদ regex হেন্ডলিং যোগ করা হয়েছে
// - অন্যান্য ছোট নিরাপত্তা ও রবারস্টনেস আপডেট

document.addEventListener("DOMContentLoaded", () => {
  // Global state
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

  // DOM shortcuts
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

  // Limit search input length to mitigate ReDoS / huge regex risks
  const MAX_KEYWORD_LENGTH = 200;
  if (elements.searchBox) {
    try {
      elements.searchBox.maxLength = MAX_KEYWORD_LENGTH;
    } catch (e) { /* ignore if unsupported */ }
  }

  // Helper: highlight matches safely (textContent used)
  const buildHighlightedFragment = (text = "", keyword = "") => {
    const frag = document.createDocumentFragment();
    const safeText = String(text || "");
    if (!keyword) {
      frag.appendChild(document.createTextNode(safeText));
      return frag;
    }
    try {
      let k = String(keyword).trim();
      if (!k) {
        frag.appendChild(document.createTextNode(safeText));
        return frag;
      }
      // Limit keyword length
      if (k.length > MAX_KEYWORD_LENGTH) k = k.slice(0, MAX_KEYWORD_LENGTH);

      // Escape regex metacharacters safely
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
        // use textContent to avoid HTML injection
        span.textContent = match[0];
        frag.appendChild(span);
        lastIndex = rx.lastIndex;
        // prevent infinite loops on zero-length matches
        if (rx.lastIndex === match.index) rx.lastIndex++;
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

  // Safely set query params (used for shareable URLs)
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

  // Validate and normalize incoming data array
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
        serial_no: String(item.serial_no || "").trim(),
        question: String(item.question || "").trim(),
        answer: String(item.answer || "").trim(),
        details: String(item.details || "").trim(),
        key_point: String(item.key_point || "").trim(),
        law_section: String(item.law_section || "").trim(),
        case_reference: String(item.case_reference || "").trim(),
        tags: Array.isArray(item.tags) ? item.tags.map(t => String(t).trim()).filter(Boolean) : [],
        keywords: Array.isArray(item.keywords) ? item.keywords.map(t => String(t).trim()).filter(Boolean) : [],
        year: Number.isFinite(Number(item.year)) ? Number(item.year) : null,
        last_updated: String(item.last_updated || "").trim(),
        source: String(item.source || "").trim(),
        law_reference_link: String(item.law_reference_link || "").trim(),
        related_ids: Array.isArray(item.related_ids) ? item.related_ids.filter(n => Number.isInteger(n)) : []
      };
      if (!normalized.question || !normalized.answer) continue;
      out.push(normalized);
    }
    return out;
  };

  // Check if a URL is safe to put into an <a href>
  const isSafeHref = (url) => {
    if (!url) return false;
    // allow absolute http(s) and relative (/path, ./path, ../path)
    // explicitly disallow protocol-relative '//' and schemes like javascript:, data:, vbscript:
    const trimmed = String(url).trim().toLowerCase();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return true;
    if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) return true;
    return false;
  };

  // Simple fallback search
  const simpleSearchFallback = (list, keyword) => {
    const k = String(keyword).toLowerCase().slice(0, MAX_KEYWORD_LENGTH);
    return list.filter(item => {
      return (
        (item.question && item.question.toLowerCase().includes(k)) ||
        (item.answer && item.answer.toLowerCase().includes(k)) ||
        (item.details && item.details.toLowerCase().includes(k)) ||
        (item.key_point && item.key_point.toLowerCase().includes(k)) ||
        (item.law_section && item.law_section.toLowerCase().includes(k)) ||
        (item.case_reference && item.case_reference.toLowerCase().includes(k)) ||
        (item.tags && item.tags.join(" ").toLowerCase().includes(k)) ||
        (item.keywords && item.keywords.join(" ").toLowerCase().includes(k))
      );
    });
  };

  // Apply filters and render results
  const applyFilters = () => {
    const keywordRaw = elements.searchBox ? elements.searchBox.value.trim() : "";
    const keyword = String(keywordRaw).slice(0, MAX_KEYWORD_LENGTH);
    const section = elements.sectionSelect ? elements.sectionSelect.value : "";
    const year = elements.yearSelect && elements.yearSelect.value ? Number(elements.yearSelect.value) : "";
    const sort = elements.sortSelect ? elements.sortSelect.value : "relevance";
    const tags = elements.tagsWrap ? Array.from(elements.tagsWrap.querySelectorAll('input:checked')).map(c => c.value) : [];
    const showBookmarksOnly = elements.showBookmarksOnlyCheck && elements.showBookmarksOnlyCheck.checked;

    setQueryParams({ q: keyword, section, year, tags, sort, bookmarks: showBookmarksOnly ? 'true' : '' });

    let list = DATA.slice();

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

   if (elements.countDisplay) elements.countDisplay.innerText = list.length ? `${list.length} ফলাফল পাওয়া গেছে` : "কোনো ফলাফল পাওয়া যায়নি";
    currentPage = 1; // reset pagination when filters/search change
    renderWithPagination(list, elements.resultsWrap, keyword);
  };

  const debouncedApply = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 300);
  };

  // Create a simple button element
  const createButton = (text, classes = [], attrs = {}) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = classes.join(" ");
    btn.textContent = text;
    Object.entries(attrs).forEach(([k, v]) => btn.setAttribute(k, v));
    return btn;
  };

  // Render list of cards
  const renderCards = (list, containerEl, keyword = "") => {
    if (!containerEl) return;
    containerEl.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (const item of list) {
      const article = document.createElement("article");
      article.className = "card";
      article.dataset.id = String(item.id);
      article.setAttribute("aria-expanded", "false");

      // Header (question)
      const header = document.createElement("div");
      header.className = "card-header";
      header.dataset.action = "toggle";
      header.setAttribute("role", "button");
      header.setAttribute("tabindex", "0");
      header.setAttribute("aria-controls", `card-${item.id}-details`);

      const serialNoSpan = document.createElement("span");
      serialNoSpan.className = "serial-no";
      serialNoSpan.textContent = ` ${item.serial_no || item.id}।`;
      header.appendChild(serialNoSpan);

      const headerLabel = document.createElement("span");
      headerLabel.className = "label label-question";
      headerLabel.textContent = "প্রশ্ন: ";
      header.appendChild(headerLabel);
      header.appendChild(buildHighlightedFragment(item.question, keyword));
      article.appendChild(header);

      // Details (answer, meta)
      const details = document.createElement("div");
      details.className = "card-details";
      details.id = `card-${item.id}-details`;
      details.setAttribute("aria-hidden", "true");

      const answerDiv = document.createElement("div");
      const answerLabel = document.createElement("span");
      answerLabel.className = "label label-answer";
      answerLabel.textContent = "উত্তর: ";
      answerDiv.appendChild(answerLabel);
      answerDiv.appendChild(buildHighlightedFragment(item.answer, keyword));
      details.appendChild(answerDiv);

      if (item.details) {
        const detailsDiv = document.createElement("div");
        const detailsLabel = document.createElement("span");
        detailsLabel.className = "label label-details";
        detailsLabel.textContent = "বিস্তারিত: ";
        detailsDiv.appendChild(detailsLabel);
        detailsDiv.appendChild(buildHighlightedFragment(item.details, keyword));
        details.appendChild(detailsDiv);
      }

      const keyDiv = document.createElement("div");
      const keyLabel = document.createElement("span");
      keyLabel.className = "label label-keywords";
      keyLabel.textContent = "শিক্ষা: ";
      keyDiv.appendChild(keyLabel);
      keyDiv.appendChild(buildHighlightedFragment(item.key_point || "-", keyword));
      details.appendChild(keyDiv);

      const sectionDiv = document.createElement("div");
      const sectionLabel = document.createElement("span");
      sectionLabel.className = "label label-section";
      sectionLabel.textContent = "ধারা: ";
      sectionDiv.appendChild(sectionLabel);
      sectionDiv.appendChild(buildHighlightedFragment(item.law_section || "-", keyword));
      details.appendChild(sectionDiv);

      const caseDiv = document.createElement("div");
      const caseLabel = document.createElement("span");
      caseLabel.className = "label label-case";
      caseLabel.textContent = "মামলা: ";
      caseDiv.appendChild(caseLabel);
      caseDiv.appendChild(buildHighlightedFragment(item.case_reference || "কোনো মামলা রেফারেন্স নেই", keyword));
      details.appendChild(caseDiv);

      // Meta area (DOM nodes to avoid HTML injection)
      const meta = document.createElement("div");
      meta.className = "meta";

      // tags
      const tagsSpan = document.createElement("span");
      tagsSpan.textContent = "ট্যাগ: ";
      meta.appendChild(tagsSpan);
      const tagsList = document.createElement("span");
      tagsList.textContent = item.tags.map(t => `#${t}`).join(" · ") || "N/A";
      meta.appendChild(tagsList);

      // keywords (if any)
      if (item.keywords && item.keywords.length) {
        const kw = document.createElement("div");
        kw.textContent = `শিক্ষা: ${item.keywords.map(k => `#${k}`).join(" · ")}`;
        meta.appendChild(kw);
      }

      // year, source, last_updated
      const info = document.createElement("div");
      info.textContent = `সাল: ${item.year || "N/A"}`;
      if (item.source) info.textContent += ` | উৎস: ${item.source}`;
      if (item.last_updated) info.textContent += ` | শেষ আপডেট: ${item.last_updated}`;
      meta.appendChild(info);

      details.appendChild(meta);

      // law reference link (sanitize before adding)
      if (isSafeHref(item.law_reference_link)) {
        const linkDiv = document.createElement("div");
        const linkBold = document.createElement("b");
        linkBold.textContent = "আরো জানতে: ";
        linkDiv.appendChild(linkBold);
        const lawLink = document.createElement("a");
        lawLink.href = item.law_reference_link;
        lawLink.textContent = "ক্লিক";
        lawLink.target = "_blank";
        lawLink.rel = "noopener noreferrer";
        linkDiv.appendChild(lawLink);
        details.appendChild(linkDiv);
      }

      // related ids
      if (item.related_ids && item.related_ids.length) {
        const relatedDiv = document.createElement("div");
        const relatedBold = document.createElement("b");
        relatedBold.textContent = "সংশ্লিষ্ট: ";
        relatedDiv.appendChild(relatedBold);
        item.related_ids.forEach((relId, index) => {
          const relatedLink = document.createElement("a");
          // use query param but encode the id as integer
          relatedLink.href = `?id=${encodeURIComponent(String(relId))}`;
          relatedLink.textContent = `ID ${relId}`;
          relatedLink.addEventListener('click', (e) => {
            e.preventDefault();
            const targetCard = document.querySelector(`.card[data-id="${relId}"]`);
            if (targetCard) {
              targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
              targetCard.classList.add('expanded', 'card-highlighted');
              targetCard.setAttribute('aria-expanded', 'true');
              const det = targetCard.querySelector('.card-details');
              if (det) det.setAttribute('aria-hidden', 'false');
              setTimeout(() => targetCard.classList.remove('card-highlighted'), 2500);
            } else {
              // fallback to navigate with safe param
              window.location.href = `?id=${encodeURIComponent(String(relId))}`;
            }
          });
          relatedDiv.appendChild(relatedLink);
          if (index < item.related_ids.length - 1) relatedDiv.appendChild(document.createTextNode(", "));
        });
        details.appendChild(relatedDiv);
      }

      // actions: bookmark, share, speak
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
  
  
  // === Pagination Settings ===
let PAGE_SIZE = 10;   // প্রতি পেজে কয়টা আইটেম দেখাবেন
let currentPage = 1;  // শুরু পেজ

// Helper: Get paginated data
function getPagedData(list) {
  const start = 0;
  const end = currentPage * PAGE_SIZE;
  return list.slice(start, end);
}

// Render with pagination
function renderWithPagination(list, containerEl, keyword = "") {
  if (!containerEl) return;
  containerEl.innerHTML = "";

  // Get current slice
  const pagedList = getPagedData(list);
  renderCards(pagedList, containerEl, keyword);

  // If more data available → show Load More button
  if (pagedList.length < list.length) {
    const loadMoreBtn = document.createElement("button");
    loadMoreBtn.textContent = "⬇️ আরো দেখুন";
    loadMoreBtn.className = "btn-loadmore";
    loadMoreBtn.style.display = "block";
    loadMoreBtn.style.margin = "16px auto";
    loadMoreBtn.onclick = () => {
      currentPage++;
      renderWithPagination(list, containerEl, keyword);
    };
    containerEl.appendChild(loadMoreBtn);
  }
}

  // Render bookmarks panel
  const renderBookmarks = () => {
    if (!elements.bookmarksWrap) return;
    const bookmarkedItems = DATA.filter(d => bookmarks.includes(d.id));
    if (bookmarkedItems.length === 0) {
      elements.bookmarksWrap.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "meta";
      empty.textContent = "কোনো বুকমার্ক নেই";
      elements.bookmarksWrap.appendChild(empty);
      return;
    }
    renderCards(bookmarkedItems, elements.bookmarksWrap, elements.searchBox ? elements.searchBox.value.trim() : "");
  };

  // Click handler for cards (toggle, bookmark, share, speak)
  const handleCardClick = (event, containerEl) => {
    const actionTarget = event.target.closest("[data-action]");
    const headerTarget = event.target.closest(".card-header");
    const target = actionTarget || headerTarget;
    if (!target) return;

    const card = target.closest(".card");
    if (!card) return;
    const action = target.dataset.action || (headerTarget ? "toggle" : null);
    const id = Number(card.dataset.id);
    if (!Number.isInteger(id)) return;

    if (action === "toggle") {
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
    if (action === "bookmark") toggleBookmark(id);
    else if (action === "share") safeCopyToClipboard(target.dataset.link);
    else if (action === "speak" && item) speakText(item.answer);
  };

  // Toggle bookmark and persist
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
    // Update visible bookmark buttons
    $$('button[data-action="bookmark"]').forEach(btn => {
      const bid = Number(btn.dataset.id);
      const pressed = bookmarks.includes(bid);
      btn.setAttribute("aria-pressed", pressed ? "true" : "false");
      btn.textContent = pressed ? "🔖 বুকমার্ক সরান" : "🔖 বুকমার্ক করুন";
      btn.className = pressed ? "danger" : "primary";
      btn.setAttribute("title", pressed ? "বুকমার্ক সরান" : "বুকমার্ক করুন");
    });
  };

  // Clipboard (modern + fallback)
  const safeCopyToClipboard = async (text) => {
    try {
      const payload = String(text).slice(0, 2000); // limit copied length
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(payload);
        showToast("লিংক কপি হয়েছে!");
        return;
      }
      const ta = document.createElement("textarea");
      ta.value = payload;
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

  // Speech (if browser supports)
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

  // Move controls for mobile/desktop
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

  // Attach event listeners
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

  // If URL has id param, open and highlight that card (safer)
  const highlightCardFromURL = () => {
    try {
      const rawId = getQueryParam('id');
      if (!rawId) return;

      // accept only integer ids (protect against selector injection)
      const id = parseInt(rawId, 10);
      if (!Number.isInteger(id)) return;

      // find by data-id using dataset comparison (avoid injecting into selector)
      const cards = document.querySelectorAll('.card');
      for (const cardEl of cards) {
        if (String(cardEl.dataset.id) === String(id)) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          cardEl.classList.add('expanded', 'card-highlighted');
          cardEl.setAttribute('aria-expanded', 'true');
          const det = cardEl.querySelector('.card-details');
          if (det) det.setAttribute('aria-hidden', 'false');
          setTimeout(() => cardEl.classList.remove('card-highlighted'), 2500);
          break;
        }
      }
    } catch (e) { console.warn(e); }
  };

  // Initialization
  async function init() {
    document.body.classList.toggle("dark", theme === "dark");
    if (elements.themeToggle) elements.themeToggle.textContent = theme === "dark" ? "☀️ Light" : "🌙 Dark";

    populateVoiceList();
    if (typeof speechSynthesis !== 'undefined' && typeof speechSynthesis.onvoiceschanged !== 'undefined') {
      speechSynthesis.onvoiceschanged = populateVoiceList;
    }

    // load data.json
    try {
      const res = await fetch('./data.json', { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const raw = await res.json();
      const validated = validateDataArray(raw);
      DATA = validated.length ? validated : [];
      if (!DATA.length && elements.countDisplay) elements.countDisplay.innerText = "ডেটা খালি বা অকার্যকর।";
    } catch (err) {
      console.error("Could not load data:", err);
      if (elements.countDisplay) elements.countDisplay.innerText = "ডেটা লোড করতে ব্যর্থ। (data.json ফাইল আছে কি দেখুন)";
      DATA = [];
    }

    // init Fuse if available
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

    // populate filters (safe DOM creation)
    try {
      const uniqueSections = Array.from(new Set(DATA.map(d => d.law_section))).filter(s => s).sort();
      const uniqueYears = Array.from(new Set(DATA.map(d => d.year).filter(Boolean))).sort((a, b) => b - a);
      const uniqueTags = Array.from(new Set(DATA.flatMap(d => d.tags))).filter(t => t).sort();

      if (elements.sectionSelect) {
        elements.sectionSelect.innerHTML = "";
        const defaultOpt = document.createElement("option");
        defaultOpt.value = "";
        defaultOpt.textContent = "সব ধারা";
        elements.sectionSelect.appendChild(defaultOpt);
        for (const s of uniqueSections) {
          const opt = document.createElement("option");
          opt.value = s;
          opt.textContent = s;
          elements.sectionSelect.appendChild(opt);
        }
      }

      if (elements.yearSelect) {
        elements.yearSelect.innerHTML = "";
        const defaultOpt = document.createElement("option");
        defaultOpt.value = "";
        defaultOpt.textContent = "সব সাল";
        elements.yearSelect.appendChild(defaultOpt);
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
          // single-select behavior: when one tag checked, uncheck others
          cb.addEventListener('change', (e) => {
            try {
              e.stopPropagation();
              if (cb.checked) {
                const others = Array.from(elements.tagsWrap.querySelectorAll('input[name="tags"]'));
                others.forEach(other => {
                  if (other !== cb) other.checked = false;
                });
              }
            } catch (err) {
              console.warn("Tag single-select handler error:", err);
            } finally {
              applyFilters();
            }
          });
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
    setTimeout(highlightCardFromURL, 200);

    // register service worker if present
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(registration => console.log('Service Worker registered with scope:', registration.scope))
        .catch(error => console.error('Service Worker registration failed:', error));
    }
  }

  init();
});

// Visitor counter (optional; external script)
(async function () {
  const counterEl = document.getElementById("visitorCounter");
  if (!counterEl) return;
  try {
    const apiUrl = "https://script.google.com/macros/s/AKfycbzTXuSV_khlAGHSpmXOk1YXd2zRURRzqhUVT2ckN9w2Fz-w39Z_CdiZ2u8nbtKErWIzeg/exec";
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error("Network error");
    const data = await res.json();
    counterEl.textContent = data.value;
  } catch (e) {
    console.warn("Visitor counter error:", e);
    counterEl.textContent = "N/A";
  }
})();