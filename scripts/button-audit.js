/**
 * Button audit harness (dev-only).
 *
 * Paste-able into any page: enumerates every visible <button>, clicks it, and
 * records whether the DOM responded. A button that produces no mutation is a
 * no-op — the definition of "unclickable" from the user's point of view.
 *
 * Exposed as window.__auditButtons() so the harness can drive a page without
 * re-injecting the script each time.
 */
(function () {
  const DESCRIBE = (b) => {
    const label = (b.getAttribute("aria-label") || b.innerText || "").trim().replace(/\s+/g, " ");
    return `${b.tagName.toLowerCase()}${b.type ? `[type=${b.type}]` : ""}: ${label.slice(0, 48)}`;
  };

  function snapshot() {
    const main = document.querySelector("main") || document.body;
    return {
      html: main.innerHTML.length,
      dialogs: document.querySelectorAll("[role=dialog],[role=alertdialog],dialog").length,
      url: location.href,
      text: main.innerText.length,
      // Anything that would indicate a visible response.
      alerts: document.querySelectorAll("[role=alert],[role=status],.text-rose-700").length,
    };
  }

  window.__auditButtons = async function auditButtons(opts) {
    const options = opts || {};
    const wait = options.wait || 900;
    const selector =
      options.selector ||
      "button:not([disabled]), a[href], [role=button]:not([aria-disabled=true])";

    const results = [];
    let index = 0;

    for (const el of Array.from(document.querySelectorAll(selector))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue; // hidden
      if (!el.offsetParent && getComputedStyle(el).position !== "fixed") continue;

      const before = snapshot();
      const label = DESCRIBE(el);

      let threw = null;
      try {
        el.click();
      } catch (e) {
        threw = String(e && e.message);
      }

      await new Promise((r) => setTimeout(r, wait));
      const after = snapshot();

      const responded =
        after.dialogs > before.dialogs ||
        after.alerts > before.alerts ||
        Math.abs(after.text - before.text) > 2 ||
        after.html !== before.html ||
        after.url !== before.url;

      results.push({
        i: index++,
        label,
        responded,
        threw,
        delta: {
          dialogs: after.dialogs - before.dialogs,
          alerts: after.alerts - before.alerts,
          text: after.text - before.text,
          html: after.html - before.html,
          urlChanged: after.url !== before.url,
        },
      });

      // Reset any dialog the click opened so later buttons stay reachable.
      const open = document.querySelector("[role=dialog],[role=alertdialog]");
      if (open) {
        const close = open.querySelector(
          "button[aria-label*='lose'], button[aria-label*='ancel']"
        );
        if (close) {
          close.click();
          await new Promise((r) => setTimeout(r, 500));
        } else {
          document.body.click();
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }

    return results;
  };

  return "audit ready";
})();