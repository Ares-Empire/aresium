// Addresses the server's own pages link to (login-page.ts, contact-page.ts).
export const EMPIRE = "https://www.ares-empire.de";

export type PageLanguage = "en" | "de";

// The privacy policy and imprint live on the hub, in both languages (ares-empire webauth/legal.py).
export const LEGAL: Record<PageLanguage, { privacy: string; imprint: string }> = {
  en: { privacy: `${EMPIRE}/privacy`, imprint: `${EMPIRE}/imprint` },
  de: { privacy: `${EMPIRE}/datenschutz`, imprint: `${EMPIRE}/impressum` },
};

// Aresium's own contact form, one page per language (contact-page.ts).
export const CONTACT_PATHS: Record<PageLanguage, string> = { en: "/contact", de: "/kontakt" };

// Where visitors ask for the iPhone app: the contact form with "Get the app" chosen (Patrik, 2026-10-30: each app gets
// its own form instead of the hub's). The same address is in the demo's band (web/public/app/data.js, GET_APP), on
// patrikbreeck.com's apps page (ares content/apps.json, "request") and in the hub's demo (ares-empire
// tools/empire_samples.py, ARESIUM_REQUEST).
export const GET_APP = `${CONTACT_PATHS.en}?topic=access`;
