(() => {
  let frame;
  // A linked heading near the end can be visible before it reaches the top.
  let requestedHash = location.hash;

  function syncSection() {
    frame = undefined;
    const body = document.querySelector("[data-docs-body]");
    const main = body?.querySelector("main");
    if (!main) return;

    const sections = Array.from(main.querySelectorAll("article > section[id]"));
    if (!sections.length) return;

    const scrollport = getComputedStyle(main).overflowY === "auto" ? main : body;
    const bounds = scrollport.getBoundingClientRect();
    const top = bounds.top + 28;
    const atEnd = scrollport.scrollTop > 0 &&
      scrollport.scrollHeight - scrollport.clientHeight - scrollport.scrollTop <= 2;
    let current = sections[0];

    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      if (rect.top <= top || (atEnd && rect.top < bounds.bottom)) current = section;
      if (requestedHash === `#${section.id}` && rect.top >= bounds.top - 2 &&
          rect.top < bounds.bottom && (rect.top <= top || atEnd)) {
        current = section;
        break;
      }
    }

    for (const link of body.querySelectorAll("[data-docs-toc] a")) {
      const isCurrent = link.hash === `#${current.id}`;
      if (isCurrent) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  }

  function scheduleSync() {
    frame ??= requestAnimationFrame(syncSection);
  }

  function followHash() {
    requestedHash = location.hash;
    scheduleSync();
  }

  function resumeTracking() {
    requestedHash = "";
  }

  document.addEventListener("scroll", scheduleSync, { capture: true, passive: true });
  document.addEventListener("wheel", resumeTracking, { passive: true });
  document.addEventListener("touchmove", resumeTracking, { passive: true });
  document.addEventListener("pointerdown", resumeTracking);
  document.addEventListener("keydown", (event) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
      resumeTracking();
    }
  });
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-docs-toc] a");
    if (link) {
      requestedHash = link.hash;
      scheduleSync();
    }
  });
  window.addEventListener("hashchange", followHash);
  window.addEventListener("pageshow", followHash);
  window.addEventListener("resize", scheduleSync);
  new MutationObserver(scheduleSync).observe(document.documentElement, { childList: true, subtree: true });
  scheduleSync();
})();
