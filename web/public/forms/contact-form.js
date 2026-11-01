/* The contact form of an Ares app's website: aresium.de/contact (aresium src/web/contact-page.ts), and on the hub
   www.ares-empire.de/contact and /arestemis/contact (ares-empire webauth/contact.py), each also in German.
   Shared by every such page, byte for byte: the original is ares-empire web/shared/forms/contact-form.js, aresium
   web/public/forms/ has a copy, and both repos test it against web/shared/forms/SHA256SUMS (README.md there).
   It knows no app and no language; everything comes from the page, so another app's form can use this file as it is:

   - form[data-contact-form]: data-endpoint (the account server's open `contact` collection), data-app (its `app`;
     none for a general form), data-language ("en" or "de", its `language`), data-sent (the id of the section shown once
     the message is sent), data-max (the message's limit in characters, counted as the server counts them).
   - Inside the form: select[name=kind] (the topic, its `kind`), textarea[name=message], input[name=email],
     input[name=name], input[name=website] (the honeypot: hidden from people, any text in it is refused).
   - Each topic option: data-placeholder (the message box's), data-note (the line under the address), data-optional
     (no message needed, as when asking for the app).
   - [data-topic-icon=<kind>] shows the chosen topic's icon, [data-optional-mark] says "(optional)", [data-topic-note] is the
     line under the address, [data-language-link] (the other language's page) keeps the topic. Both it and the page's
     address keep every other parameter the page was opened with (a `look` passed by the page that linked here).
   - [data-counter] with data-words ("%1 of %2 characters"): shown near the limit, as on the iPhone.
   - [data-problem=<name>]: empty, long, noemail, email, many, offline, failed; one is shown at a time.
   - The submit button: data-sending and data-again (its words while sending and after a failure), [data-label] inside.
   - The sent section: [data-sent-line=app] (data-words with %s for the address) when no message was needed,
     [data-sent-line=answer] otherwise. The section around the form ([data-compose], or the form itself) is hidden then.

   It posts {name, email, message, language, app, kind, website} as JSON straight from the browser to the account
   server (ares-empire docs/ACCOUNTS.md → Website contact form), so the server's limit of 5 an hour counts this visitor. */
(function () {
  "use strict";
  const form = document.querySelector("form[data-contact-form]");
  if (!form || !window.fetch) return;   // the page's <noscript> names the email address instead

  const field = (name) => form.elements.namedItem(name);
  const topic = field("kind");
  const message = field("message");
  const email = field("email");
  const name = field("name");
  const website = field("website");
  const button = form.querySelector("button[type=submit]");
  const label = button.querySelector("[data-label]") || button;
  const words = { send: label.textContent, sending: button.getAttribute("data-sending"), again: button.getAttribute("data-again") };
  const counter = form.querySelector("[data-counter]");
  const note = form.querySelector("[data-topic-note]");
  const mark = form.querySelector("[data-optional-mark]");
  const problems = form.querySelectorAll("[data-problem]");
  const languageLink = document.querySelector("[data-language-link]");
  const compose = form.closest("[data-compose]") || form;
  const sent = document.getElementById(form.getAttribute("data-sent"));
  const endpoint = form.getAttribute("data-endpoint");
  const app = form.getAttribute("data-app");
  const language = form.getAttribute("data-language") === "de" ? "de" : "en";
  const max = Number(form.getAttribute("data-max")) || 5000;
  const number = new Intl.NumberFormat(language === "de" ? "de-DE" : "en-GB");
  let phase = "writing";   // writing, sending, failed, sent

  const chosen = () => topic.options[topic.selectedIndex];
  const optional = () => chosen().hasAttribute("data-optional");
  // The server counts characters as Unicode code points (an emoji may count as two).
  const length = (text) => Array.from(text.trim()).length;
  const looksLikeEmail = (text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);

  // The chosen topic's placeholder, note, icon and "(optional)"; with `remember`, the page's address keeps it too.
  function showTopic(remember) {
    const option = chosen();
    message.placeholder = option.getAttribute("data-placeholder") || "";
    message.required = !optional();
    if (note) note.textContent = option.getAttribute("data-note") || "";
    if (mark) mark.hidden = !optional();
    document.querySelectorAll("[data-topic-icon]").forEach((icon) => {
      icon.toggleAttribute("hidden", icon.getAttribute("data-topic-icon") !== topic.value);   // SVG has no .hidden
    });
    const here = new URLSearchParams(location.search);
    here.set("topic", topic.value);
    if (languageLink) {
      const url = new URL(languageLink.href, location.href);
      here.forEach((value, key) => url.searchParams.set(key, value));
      languageLink.href = url.pathname + url.search;
    }
    if (remember) history.replaceState(null, "", location.pathname + "?" + here.toString());
  }

  // Near the limit: "4,812 / 5,000", in the problem colour once over it.
  function count() {
    if (!counter) return;
    const n = length(message.value);
    counter.hidden = n <= max - 500;
    counter.classList.toggle("over", n > max);
    const shown = document.createElement("span");
    shown.setAttribute("aria-hidden", "true");
    shown.textContent = number.format(n) + " / " + number.format(max);
    const spoken = document.createElement("span");
    spoken.className = "visually-hidden";
    spoken.textContent = (counter.getAttribute("data-words") || "%1 / %2")
      .replace("%1", () => number.format(n)).replace("%2", () => number.format(max));
    counter.replaceChildren(shown, spoken);
  }

  // Shows the problem with this name (or none) and marks the field it is about.
  function show(problem, about) {
    problems.forEach((p) => { p.hidden = p.getAttribute("data-problem") !== problem; });
    [message, email].forEach((f) => f.removeAttribute("aria-invalid"));
    if (about) {
      about.setAttribute("aria-invalid", "true");
      about.focus();
    }
  }

  function busy(on) {
    form.setAttribute("aria-busy", on ? "true" : "false");
    button.disabled = on;
    button.classList.toggle("busy", on);
    label.textContent = on ? words.sending : phase === "failed" ? words.again : words.send;
    [message, email, name].forEach((f) => { f.readOnly = on; });
    topic.disabled = on;
  }

  function fail(problem, about) {
    phase = "failed";
    busy(false);
    show(problem, about);
  }

  function done(address, asksForApp) {
    phase = "sent";
    sent.querySelectorAll("[data-sent-line]").forEach((line) => {
      const forApp = line.getAttribute("data-sent-line") === "app";
      line.hidden = forApp !== asksForApp;
      if (forApp && asksForApp) line.textContent = line.getAttribute("data-words").replace("%s", () => address);
    });
    compose.hidden = true;
    sent.hidden = false;
    sent.focus();
  }

  topic.addEventListener("change", () => {
    if (optional() && problems.length) show(null);   // "please write a message" no longer applies
    showTopic(true);
  });
  message.addEventListener("input", () => {
    count();
    if (message.hasAttribute("aria-invalid")) show(null);
  });
  email.addEventListener("input", () => { if (email.hasAttribute("aria-invalid")) show(null); });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (phase === "sending" || phase === "sent") return;
    const text = message.value.trim();
    const address = email.value.trim();
    if (!text && !optional()) return show("empty", message);
    if (length(text) > max) return show("long", message);
    if (!address) return show("noemail", email);
    if (!looksLikeEmail(address)) return show("email", email);
    show(null);
    const kind = topic.value;
    const asksForApp = optional();
    const body = { name: name.value.trim(), email: address, message: text, language: language, kind: kind,
      website: website ? website.value : "" };
    if (app) body.app = app;
    phase = "sending";
    busy(true);
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((response) => {
        if (response.ok) return done(address, asksForApp);
        return response.json().catch(() => ({})).then((answer) => {
          const refused = (answer && answer.data) || {};
          if (response.status === 429) fail("many");
          else if (response.status === 400 && refused.email) fail("email", email);
          else if (response.status === 400 && refused.message) fail(text ? "long" : "empty", message);
          else fail("failed");
        });
      })
      .catch(() => fail(navigator.onLine === false ? "offline" : "failed"));
  });

  // Leaving with written text that was not sent asks first, as the iPhone form does.
  window.addEventListener("beforeunload", (event) => {
    if (phase === "sent" || !message.value.trim()) return;
    event.preventDefault();
    event.returnValue = "";   // older Safari asks only when this is set
  });

  showTopic(false);   // the browser may have brought back an earlier choice
  count();
})();
