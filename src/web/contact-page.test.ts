import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { CONTACT_CSP, CONTACT_ENDPOINT, CONTACT_PAGES, TOPICS, contactPage, topicFrom } from "./contact-page.js";

const SCRIPT = readFileSync(new URL("../../web/public/forms/contact-form.js", import.meta.url), "utf8");
const pages = { en: contactPage("en"), de: contactPage("de") };
const count = (text: string, part: string) => text.split(part).length - 1;
const visibleText = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

test("the paths name the language: /contact English, /kontakt German", () => {
  assert.equal(CONTACT_PAGES.get("/contact"), "en");
  assert.equal(CONTACT_PAGES.get("/kontakt"), "de");
  assert.equal(CONTACT_PAGES.get("/constructor"), undefined);
  assert.match(pages.en, /<html lang="en" data-theme="dark">/);
  assert.match(pages.de, /<html lang="de" data-theme="dark">/);
  assert.match(pages.en, /href="\/kontakt\?topic=question"[^>]*>Deutsch</);
  assert.match(pages.de, /href="\/contact\?topic=question"[^>]*>English</);
});

test("?topic= picks the topic; anything else is a question", () => {
  assert.equal(topicFrom("access"), "access");
  assert.equal(topicFrom("problem"), "problem");
  for (const value of [null, "", "bogus", "ACCESS", "access "]) assert.equal(topicFrom(value), "question", String(value));
  const app = contactPage("en", "access");
  assert.match(app, /<option value="access" selected [^>]*data-optional>Get the app<\/option>/);
  assert.match(app, /<textarea id="contact-message"[^>]*placeholder="Anything to add\? \(optional\)"\s+aria-describedby/);
  assert.match(app, /data-optional-mark>\(optional\)</);
  assert.match(app, /The install link comes by email, to this address\./);
  const question = contactPage("de", "question");
  assert.match(question, /<option value="question" selected [^>]*>Frage<\/option>/);
  assert.match(question, /placeholder="Was ist die Frage\?" required/);
  assert.match(question, /data-optional-mark hidden>/);
});

test("both languages have every topic, problem and hook, in the same order", () => {
  for (const [language, html] of Object.entries(pages)) {
    const values = [...html.matchAll(/<option value="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(values, [...TOPICS], language);
    const problems = [...html.matchAll(/data-problem="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(problems, ["empty", "long", "noemail", "email", "many", "offline", "failed"], language);
    // Only asking for the app needs no message.
    assert.equal(count(html, "data-optional>"), 1, language);
  }
  // The same structure, only the words differ.
  const shape = (html: string) => html.replace(/>[^<]*</g, "><").replace(/"[^"]*"/g, '""');
  assert.equal(shape(pages.en), shape(pages.de));
  // No English left on the German page.
  for (const english of ["Get the app", "Topic", "Message", "Answer to", "Email", "Send", "Something else", "Privacy", "Imprint"]) {
    assert.doesNotMatch(visibleText(pages.de), new RegExp(`\\b${english}\\b`), english);
  }
});

test("every hook the script looks for is on the page exactly once, so it cannot pick the wrong element", () => {
  for (const [language, html] of Object.entries(pages)) {
    for (const hook of ["data-contact-form", "data-topic-note", "data-optional-mark", "data-counter", "data-language-link",
      "data-compose", "data-label", 'data-sent-line="app"', 'data-sent-line="answer"', 'id="contact-sent"',
      'name="kind"', 'name="message"', 'name="email"', 'name="name"', 'name="website"']) {
      assert.equal(count(html, ` ${hook}`), 1, `${language}: ${hook}`);
    }
    assert.match(html, /data-sent="contact-sent"/);
    assert.match(html, /data-sending="[^"]+" data-again="[^"]+"/);
    assert.match(html, /data-sent-line="app" data-words="[^"]*%s[^"]*"/);
    assert.match(html, /data-counter data-words="[^"]*%1[^"]*%2[^"]*"/);
  }
  // …and the script asks for exactly these (a renamed hook breaks this test instead of the page).
  for (const hook of ["[data-contact-form]", "[data-topic-note]", "[data-optional-mark]", "[data-counter]",
    "[data-language-link]", "[data-compose]", "[data-label]", "[data-sent-line]", "[data-problem]", "[data-topic-icon]"]) {
    assert.ok(SCRIPT.includes(hook), hook);
  }
  for (const problem of ["empty", "long", "noemail", "email", "many", "offline", "failed"]) {
    assert.ok(SCRIPT.includes(`"${problem}"`), problem);
  }
});

test("the form posts to the account server's contact collection as Aresium, with the honeypot", () => {
  assert.equal(CONTACT_ENDPOINT, "https://auth.ares-empire.de/api/collections/contact/records");
  for (const html of Object.values(pages)) {
    assert.match(html, /data-endpoint="https:\/\/auth\.ares-empire\.de\/api\/collections\/contact\/records" data-app="aresium"/);
    assert.match(html, /<div class="trap" aria-hidden="true">[\s\S]*name="website" type="text" tabindex="-1"/);
    assert.match(html, /<input id="contact-email" name="email" type="email"[^>]*required/);
    assert.match(html, /<input id="contact-name" name="name" type="text"[^>]*maxlength="100"/);
  }
  assert.match(pages.en, /data-language="en"/);
  assert.match(pages.de, /data-language="de"/);
});

test("the page loads nothing from other hosts and its policy allows only this server and the account server", () => {
  for (const html of Object.values(pages)) {
    assert.doesNotMatch(html, /<(?:script|img|link|iframe|source)\b[^>]*\s(?:src|href)="(?:https?:)?\/\//);
    assert.doesNotMatch(html, /\sstyle="|<style|<script>(?!<\/script>)/);   // nothing inline for the policy to allow
  }
  assert.match(CONTACT_CSP, /default-src 'none'/);
  assert.match(CONTACT_CSP, /connect-src https:\/\/auth\.ares-empire\.de;/);
  assert.match(CONTACT_CSP, /form-action 'none'/);
  assert.doesNotMatch(CONTACT_CSP, /unsafe|\*/);
  assert.doesNotMatch(SCRIPT, /https?:\/\//);   // the script takes its address from the page
});

test("the privacy policy, imprint and the email fallback are linked in the page's language", () => {
  assert.match(pages.en, /href="https:\/\/www\.ares-empire\.de\/privacy">Privacy policy</);
  assert.match(pages.en, /href="https:\/\/www\.ares-empire\.de\/imprint">Imprint</);
  assert.match(pages.de, /href="https:\/\/www\.ares-empire\.de\/datenschutz">Datenschutzerklärung</);
  assert.match(pages.de, /href="https:\/\/www\.ares-empire\.de\/impressum">Impressum</);
  for (const html of Object.values(pages)) {
    // The failed send and <noscript> name the address; no other problem does.
    assert.equal(count(html, 'href="mailto:REDACTED-EMAIL"'), 2);
    assert.match(html, /data-problem="failed" hidden>[\s\S]*?mailto:pab@patrikbreeck\.de[\s\S]*?<\/p>/);
    assert.doesNotMatch(html, /data-problem="empty" hidden>[^\n]*mailto/);
  }
});

test("the words address no one: no you or your, no du, dein or du-imperatives (Patrik, 2026-10-31)", () => {
  // Every word on the page, also the placeholders, notes and problems the script swaps in from data attributes.
  for (const topic of TOPICS) {
    assert.doesNotMatch(contactPage("en", topic), /\b(you|your|yours|you're)\b/i);
    assert.doesNotMatch(contactPage("de", topic), /\b(du|dich|dir|dein\w*|frag|schreib|gib|versuch|sende)\b/i);
  }
});

test("the page opens in Aresium's look: dark, unless switched, set before its styles apply", () => {
  for (const html of [pages.en, pages.de]) {
    assert.ok(html.indexOf('<script src="/app/appearance.js"></script>') < html.indexOf('href="/forms/contact.css"'));
    assert.ok(html.indexOf('<script src="/app/appearance.js"></script>') > 0);
    assert.doesNotMatch(html, /color-scheme|prefers-color-scheme/);
  }
  const css = readFileSync(new URL("../../web/public/forms/contact.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /prefers-color-scheme/);
  assert.match(css, /html\[data-theme="light"\] \{/);
});

// web/public/app/appearance.js in a made-up browser: `stored` is what localStorage holds, `blocked` makes it throw.
function appearance(stored: Record<string, string> = {}, blocked = false) {
  const theme: { value?: string } = {};
  const storage = {
    getItem: (key: string) => { if (blocked) throw new Error("blocked"); return key in stored ? stored[key] : null; },
    setItem: (key: string, value: string) => { if (blocked) throw new Error("blocked"); stored[key] = value; },
    removeItem: (key: string) => { if (blocked) throw new Error("blocked"); delete stored[key]; },
  };
  const window: Record<string, unknown> = { localStorage: storage };
  const document = { documentElement: { setAttribute: (name: string, value: string) => { if (name === "data-theme") theme.value = value; } } };
  runInNewContext(readFileSync(new URL("../../web/public/app/appearance.js", import.meta.url), "utf8"), { window, document });
  return { api: window.AresiumAppearance as { load(): string; save(look: string): void }, theme, stored };
}

test("appearance.js: dark until switched, then the last light or dark; red and blocked storage change nothing", () => {
  const fresh = appearance();
  assert.equal(fresh.theme.value, "dark");
  fresh.api.save("light");
  assert.deepEqual(fresh.stored, { "aresium-appearance": "light" });
  assert.equal(appearance(fresh.stored).theme.value, "light");
  fresh.api.save("red");
  assert.equal(fresh.api.load(), "light");
  fresh.api.save("dark");
  assert.deepEqual(fresh.stored, {});
  assert.equal(appearance({ "aresium-appearance": "purple" }).theme.value, "dark");
  const blocked = appearance({}, true);
  assert.equal(blocked.theme.value, "dark");
  assert.doesNotThrow(() => blocked.api.save("light"));
});
