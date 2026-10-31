// Aresium's contact form, aresium.de/contact (English) and /kontakt (German), open to everyone: one form to ask for the
// iPhone app or to write about a question, a problem or an idea (Patrik, 2026-10-30: each app gets its own form in its
// own look instead of the hub's). It mirrors the iPhone apps' Contact & support (empire-ios Shared/Support): Topic,
// Message, Answer to, Send, then a calm "it's arrived".
//
// The browser posts straight to the account server's open `contact` collection (ares-empire docs/ACCOUNTS.md →
// Website contact form), so its per-visitor rate limit sees the visitor, not this server. The page is written here with
// its words in its language; web/public/forms/contact-form.js does the sending and knows no app or language (it reads
// everything from the page's data attributes), and web/public/forms/contact.css is the look. Nothing comes from other
// hosts, and the page's Content-Security-Policy (CONTACT_CSP) allows only this server and the account server.
import { esc } from "./html.js";
import { CONTACT_PATHS, LEGAL, OWNER_EMAIL, type PageLanguage } from "./links.js";

export const CONTACT_ENDPOINT = "https://auth.ares-empire.de/api/collections/contact/records";

// No inline script or style, nothing from other hosts; the form is sent by script to the account server only.
export const CONTACT_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
  `connect-src ${new URL(CONTACT_ENDPOINT).origin}; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`;

// The topics in the order the menu shows them; the values are the collection's `kind`. Asking for the app comes first:
// it is why most visitors come.
export const TOPICS = ["access", "question", "problem", "idea", "other"] as const;
export type Topic = (typeof TOPICS)[number];
const DEFAULT_TOPIC: Topic = "question";

/** The page's path → its language. */
export const CONTACT_PAGES = new Map<string, PageLanguage>([[CONTACT_PATHS.en, "en"], [CONTACT_PATHS.de, "de"]]);

/** `?topic=` → the topic to show first; anything else → Question. */
export function topicFrom(value: string | null): Topic {
  return (TOPICS as readonly string[]).includes(value ?? "") ? value as Topic : DEFAULT_TOPIC;
}

type Words = {
  pageTitle: string; description: string; title: string; lead: string; otherLanguage: string;
  topic: string; message: string; answerTo: string; optional: string;
  topics: Record<Topic, string>; placeholders: Record<Topic, string>; noteApp: string; noteAnswer: string;
  email: string; name: string; privacyLead: string; privacy: string; imprint: string;
  problems: { empty: string; long: string; noemail: string; email: string; many: string; offline: string; failed: string };
  send: string; sending: string; again: string; counter: string; noscript: string;
  sentTitle: string; sentApp: string; sentAnswer: string; back: string;
};

// English is the source, German its translation. The words address no one: no "you" and no "du" or du-imperatives
// (Patrik, 2026-10-31), so they read the same to anyone.
// %s in sentApp is the address the visitor gave; %1 and %2 in counter are the length and the limit; %e is the
// owner's email address, written as a mailto link.
const WORDS: Record<PageLanguage, Words> = {
  en: {
    pageTitle: "Contact · Aresium",
    description: "Ask for the Aresium iPhone app, or write about a question, a problem or an idea.",
    title: "Contact",
    lead: "Ask for the iPhone app or write about a question, a problem or an idea. Messages go to Patrik Breeck by email.",
    otherLanguage: "Deutsch",
    topic: "Topic", message: "Message", answerTo: "Answer to", optional: "(optional)",
    topics: { access: "Get the app", question: "Question", problem: "Problem", idea: "Idea or wish", other: "Something else" },
    placeholders: {
      access: "Anything to add? (optional)",
      question: "What is the question?",
      problem: "What happened, and what should have happened?",
      idea: "What would make Aresium better?",
      other: "What is it about?",
    },
    noteApp: "Aresium is an iPhone app (iOS 26 or later). The install link comes by email, to this address.",
    noteAnswer: "The answer comes by email, to this address.",
    email: "Email", name: "Name (optional)",
    privacyLead: "How the data is used:", privacy: "Privacy policy", imprint: "Imprint",
    problems: {
      empty: "Please write a message.",
      long: "The message is too long: at most 5,000 characters.",
      noemail: "An email address is needed for the answer.",
      email: "This doesn't look like an email address.",
      many: "Too many messages for now. Please try again later.",
      offline: "No connection. Please send it again later.",
      failed: "It didn't go through. Please try again, or write to %e.",
    },
    send: "Send", sending: "Sending…", again: "Send again", counter: "%1 of %2 characters",
    noscript: "This form needs JavaScript. Messages by email go to %e.",
    sentTitle: "Thanks, it's arrived.",
    sentApp: "The install link comes by email, to %s.",
    sentAnswer: "If it needs an answer, it comes by email.",
    back: "Back to Aresium",
  },
  de: {
    pageTitle: "Kontakt · Aresium",
    description: "Die iPhone-App von Aresium anfragen oder zu einer Frage, einem Problem oder einer Idee schreiben.",
    title: "Kontakt",
    lead: "Die iPhone-App anfragen oder zu einer Frage, einem Problem oder einer Idee schreiben. Nachrichten gehen per " +
      "E-Mail an Patrik Breeck.",
    otherLanguage: "English",
    topic: "Thema", message: "Nachricht", answerTo: "Antwort an", optional: "(optional)",
    topics: { access: "App bekommen", question: "Frage", problem: "Problem", idea: "Idee oder Wunsch", other: "Sonstiges" },
    placeholders: {
      access: "Noch etwas dazu? (optional)",
      question: "Was ist die Frage?",
      problem: "Was ist passiert, und was hätte passieren sollen?",
      idea: "Was würde Aresium besser machen?",
      other: "Worum geht es?",
    },
    noteApp: "Aresium ist eine iPhone-App (ab iOS 26). Der Installationslink kommt per E-Mail an diese Adresse.",
    noteAnswer: "Die Antwort kommt per E-Mail an diese Adresse.",
    email: "E-Mail", name: "Name (optional)",
    privacyLead: "Wie die Daten verarbeitet werden:", privacy: "Datenschutzerklärung", imprint: "Impressum",
    problems: {
      empty: "Bitte eine Nachricht schreiben.",
      long: "Die Nachricht ist zu lang: höchstens 5.000 Zeichen.",
      noemail: "Für die Antwort fehlt eine E-Mail-Adresse.",
      email: "Das sieht nicht nach einer E-Mail-Adresse aus.",
      many: "Zu viele Nachrichten. Bitte später noch mal.",
      offline: "Keine Verbindung. Bitte später noch mal senden.",
      failed: "Das hat nicht geklappt. Bitte noch mal versuchen oder an %e schreiben.",
    },
    send: "Senden", sending: "Wird gesendet…", again: "Erneut senden", counter: "%1 von %2 Zeichen",
    noscript: "Das Formular braucht JavaScript. Nachrichten per E-Mail gehen an %e.",
    sentTitle: "Danke, ist angekommen.",
    sentApp: "Der Installationslink kommt per E-Mail an %s.",
    sentAnswer: "Braucht es eine Antwort, kommt sie per E-Mail.",
    back: "Zurück zu Aresium",
  },
};

// Lucide icons (ISC licence, the same set as web/public/vendor/lucide-0.460.0.js), drawn inline so the page needs no
// icon script. The topics' icons follow the iPhone form's symbols (a bubble with !, ? or …, a light bulb).
const BUBBLE = '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>';
const ICON_PATHS: Record<Topic | "chevrons" | "alert" | "check", string> = {
  access: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  question: BUBBLE + '<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  problem: BUBBLE + '<path d="M12 8v4"/><path d="M12 16h.01"/>',
  idea: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>' +
    '<path d="M9 18h6"/><path d="M10 22h4"/>',
  other: BUBBLE + '<path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>',
  chevrons: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};

function icon(name: keyof typeof ICON_PATHS, attributes = "", className = "icon"): string {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false"${attributes}>${ICON_PATHS[name]}</svg>`;
}

/** A sentence, with the owner's address as a mailto link in place of %e if it has one. */
function withEmail(sentence: string): string {
  if (!sentence.includes("%e")) return esc(sentence);
  const [before, after] = sentence.split("%e");
  return `${esc(before)}<a href="mailto:${OWNER_EMAIL}">${OWNER_EMAIL}</a>${esc(after)}`;
}

/** The contact page in `language`, with `topic` chosen (from `?topic=`; the menu can change it). */
export function contactPage(language: PageLanguage, topic: Topic = DEFAULT_TOPIC): string {
  const w = WORDS[language];
  const other: PageLanguage = language === "en" ? "de" : "en";
  const optional = topic === "access";
  const options = TOPICS.map((t) => `<option value="${t}"${t === topic ? " selected" : ""} ` +
    `data-placeholder="${esc(w.placeholders[t])}" data-note="${esc(t === "access" ? w.noteApp : w.noteAnswer)}"` +
    `${t === "access" ? " data-optional" : ""}>${esc(w.topics[t])}</option>`).join("\n              ");
  const icons = TOPICS.map((t) => icon(t, ` data-topic-icon="${t}"${t === topic ? "" : " hidden"}`)).join("");
  const problems = (Object.keys(w.problems) as (keyof Words["problems"])[]).map((name) =>
    `<p class="problem" data-problem="${name}" hidden>${icon("alert")}<span>${withEmail(w.problems[name])}</span></p>`)
    .join("\n          ");
  // The band's letters: spread across the width by the stylesheet, as the iPhone app's WordmarkBand.
  const band = [..."ARESIUM"].map((letter) => `<span>${letter}</span>`).join("");

  return `<!doctype html>
<html lang="${language}" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<script src="/app/appearance.js"></script>
<title>${esc(w.pageTitle)}</title>
<meta name="description" content="${esc(w.description)}" />
<link rel="icon" type="image/png" href="/brand/hermes.png" />
<link rel="apple-touch-icon" href="/brand/hermes.png" />
<link rel="alternate" hreflang="${other}" href="${CONTACT_PATHS[other]}" />
<link rel="stylesheet" href="/fonts/fonts.css" />
<link rel="stylesheet" href="/forms/contact.css" />
<script src="/forms/contact-form.js" defer></script>
</head>
<body>
  <div class="page">
    <header class="top">
      <a class="home" href="/"><img src="/brand/hermes.png" alt="" width="34" height="34" /><span>Aresium</span></a>
      <a class="lang" href="${CONTACT_PATHS[other]}?topic=${topic}" hreflang="${other}" lang="${other}" data-language-link>${esc(w.otherLanguage)}</a>
    </header>

    <main>
      <section class="compose" id="contact-compose" data-compose>
        <h1>${esc(w.title)}</h1>
        <p class="lead">${esc(w.lead)}</p>

        <form class="contact" novalidate data-contact-form data-endpoint="${CONTACT_ENDPOINT}" data-app="aresium"
          data-language="${language}" data-sent="contact-sent" data-max="5000">
          <label class="heading" for="contact-topic">${esc(w.topic)}</label>
          <div class="glass topic">
            <span class="topic-icon">${icons}</span>
            <select id="contact-topic" name="kind">
              ${options}
            </select>
            ${icon("chevrons", "", "chevrons")}
          </div>

          <label class="heading" for="contact-message">${esc(w.message)} <span class="optional" data-optional-mark${optional ? "" : " hidden"}>${esc(w.optional)}</span></label>
          <div class="glass box">
            <textarea id="contact-message" name="message" rows="8" placeholder="${esc(w.placeholders[topic])}"${optional ? "" : " required"}
              aria-describedby="contact-counter contact-problems"></textarea>
          </div>
          <p class="counter" id="contact-counter" data-counter data-words="${esc(w.counter)}" hidden></p>

          <fieldset class="reply">
            <legend class="heading">${esc(w.answerTo)}</legend>
            <div class="glass">
              <input id="contact-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off"
                spellcheck="false" required placeholder="${esc(w.email)}" aria-label="${esc(w.email)}"
                aria-describedby="contact-note contact-problems" />
              <hr />
              <input id="contact-name" name="name" type="text" autocomplete="name" maxlength="100"
                placeholder="${esc(w.name)}" aria-label="${esc(w.name)}" />
            </div>
          </fieldset>
          <p class="note" id="contact-note" data-topic-note>${esc(optional ? w.noteApp : w.noteAnswer)}</p>
          <p class="note">${esc(w.privacyLead)} <a href="${LEGAL[language].privacy}">${esc(w.privacy)}</a></p>

          <div class="trap" aria-hidden="true">
            <label for="contact-website">Website</label>
            <input id="contact-website" name="website" type="text" tabindex="-1" autocomplete="off" />
          </div>

          <div class="problems" id="contact-problems" aria-live="assertive">
          ${problems}
          </div>
          <button type="submit" data-sending="${esc(w.sending)}" data-again="${esc(w.again)}">
            <span class="spinner" aria-hidden="true"></span><span data-label>${esc(w.send)}</span>
          </button>
          <noscript><p class="note">${withEmail(w.noscript)}</p></noscript>
        </form>
      </section>

      <section class="sent" id="contact-sent" tabindex="-1" aria-labelledby="contact-sent-title" hidden>
        <div class="sent-mark">${icon("check")}</div>
        <h2 id="contact-sent-title">${esc(w.sentTitle)}</h2>
        <p data-sent-line="app" data-words="${esc(w.sentApp)}" hidden></p>
        <p data-sent-line="answer" hidden>${esc(w.sentAnswer)}</p>
        <a class="back" href="/">${esc(w.back)}</a>
      </section>
    </main>

    <footer class="legal">
      <a href="${LEGAL[language].privacy}">${esc(w.privacy)}</a> · <a href="${LEGAL[language].imprint}">${esc(w.imprint)}</a>
    </footer>
  </div>
  <div class="band" aria-hidden="true">${band}</div>
</body>
</html>
`;
}
