/* Aresium — mock financial data (German student profile).
   All amounts in EUR. Negative = spend, positive = credit.
   Swap these arrays for real data later; the UI reads only from window.AresiumData. */
(function () {
  "use strict";

  // ---- deterministic RNG so the dataset is stable across reloads ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = mulberry32(20260611);
  const rand = () => rng();
  const rr = (a, b) => a + (b - a) * rand();
  const ri = (a, b) => Math.floor(rr(a, b + 1));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const chance = (p) => rand() < p;
  const money = (n) => Math.round(n * 100) / 100;
  const pad = (n) => String(n).padStart(2, "0");

  // ---- categories ----
  const categories = [
    { name: "Groceries",      icon: "ShoppingCart",  color: "#26E07A", kind: "spend" },
    { name: "Rent",           icon: "House",         color: "#6366FF", kind: "spend" },
    { name: "Travel",         icon: "TrainFront",    color: "#13C8E8", kind: "spend" },
    { name: "Education",      icon: "GraduationCap", color: "#FFB020", kind: "spend" },
    { name: "Clothes",        icon: "Shirt",         color: "#FF5CC8", kind: "spend" },
    { name: "Drogerie",       icon: "SprayCan",      color: "#10DBAE", kind: "spend" },
    { name: "Restaurants",    icon: "Utensils",      color: "#FF7A33", kind: "spend" },
    { name: "Tech",           icon: "Laptop",        color: "#8FA0C4", kind: "spend" },
    { name: "Health",         icon: "Pill",          color: "#FF4D6D", kind: "spend" },
    { name: "Subscriptions",  icon: "Tv",            color: "#A36BFF", kind: "spend" },
    { name: "Fitness",        icon: "Dumbbell",      color: "#34E27A", kind: "spend" },
    { name: "Non-essentials", icon: "ShoppingBag",   color: "#C77BFF", kind: "spend" },
    { name: "Personal care",  icon: "Scissors",      color: "#FF7AD9", kind: "spend" },
    { name: "Drinking",       icon: "Beer",          color: "#FFC02E", kind: "spend" },
    { name: "Memberships",    icon: "Handshake",     color: "#3DA0FF", kind: "spend" },
    { name: "Development",    icon: "Code",          color: "#5B8CFF", kind: "spend" },
    { name: "Trash",          icon: "Trash2",        color: "#8A93A3", kind: "spend" },
    { name: "Tax",            icon: "Receipt",       color: "#E0894A", kind: "spend" },
    { name: "Income",         icon: "Wallet",        color: "#25E07A", kind: "income" },
    { name: "Basis",          icon: "Users",         color: "#2BB0FF", kind: "income" },
    { name: "Transfer",       icon: "Repeat",        color: "#9AA6B8", kind: "transfer" },
  ];
  const catByName = {};
  categories.forEach((c) => (catByName[c.name] = c));

  // ---- month range: last 10 months ending June 2026 (June partial) ----
  const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const TODAY = { y: 2026, m: 5, d: 11 }; // June 11, 2026

  const months = [];
  {
    let y = 2025, m = 8; // September 2025
    for (let i = 0; i < 10; i++) {
      const full = daysInMonth(y, m);
      const isCurrent = y === TODAY.y && m === TODAY.m;
      months.push({
        key: `${y}-${pad(m + 1)}`,
        label: `${MONTH_ABBR[m]} ${y}`,
        short: MONTH_ABBR[m],
        year: y, month: m,
        days: isCurrent ? TODAY.d : full,
        partial: isCurrent,
      });
      m++; if (m > 11) { m = 0; y++; }
    }
  }

  // ---- merchant pools ----
  const POOLS = {
    Groceries:     { city: "Berlin", places: ["Aldi", "Lidl", "Rewe", "Edeka", "Penny", "Netto", "Kaufland"] },
    Drogerie:      { city: "Berlin", places: ["dm", "Rossmann", "Müller"] },
    Restaurants:   { city: "Berlin", places: ["Mensa Nord", "Imren Döner", "Vöner", "Curry 36", "Maroush", "Yam Yam"] },
    Drinking:      { city: "Berlin", places: ["Klunkerkranich", "Hops & Barley", "Späti am Kotti", "Watergate", "Zur Kneipe"] },
    Clothes:       { city: "Berlin", places: ["Zalando", "H&M", "Uniqlo", "COS", "Vinted"] },
    Tech:          { city: "Berlin", places: ["MediaMarkt", "Apple Store", "Amazon", "notebooksbilliger"] },
    Health:        { city: "Berlin", places: ["Apotheke am Markt", "DocMorris", "Vital Apotheke"] },
    Education:     { city: "Berlin", places: ["TU Berlin", "Thalia", "Dussmann", "Springer"] },
    "Personal care": { city: "Berlin", places: ["Barber Friseur", "Salon Schnitt", "Figaro"] },
    "Non-essentials": { city: "Berlin", places: ["IKEA", "Flying Tiger", "TK Maxx", "Etsy"] },
    Development:   { city: "Berlin", places: ["Udemy", "JetBrains", "GitHub", "Frontend Masters"] },
    Trash:         { city: "Berlin", places: ["BSR Gebühr", "Pfand Automat", "Kiosk"] },
    Subscriptions: { city: "Berlin", places: ["Netflix", "Spotify", "iCloud", "Disney+"] },
    Travel:        { places: ["BVG Deutschlandticket", "DB Bahn", "FlixBus", "Ryanair"], cities: ["Berlin", "München", "Hamburg", "Leipzig", "Dresden", "Köln"] },
  };

  // ---- transaction generation ----
  const transactions = [];
  const add = (y, m, d, amount, categoryName, place, city) => {
    transactions.push({ date: `${y}-${pad(m + 1)}-${pad(d)}`, amount: money(amount), categoryName, place, city });
  };
  const dCap = (mo, d) => Math.min(d, mo.days); // clamp to data window

  months.forEach((mo, idx) => {
    const { year: y, month: m } = mo;
    // --- fixed monthly items ---
    add(y, m, dCap(mo, 1), -500, "Rent", "Hausverwaltung Lindenhof", "Berlin");
    add(y, m, dCap(mo, 2), 450, "Basis", "Familie / BAföG", "Berlin");
    add(y, m, dCap(mo, 27), rr(820, 910), "Income", "Northwind Werkstudent", "Berlin");
    add(y, m, dCap(mo, 1), -49, "Travel", "BVG Deutschlandticket", "Berlin");
    add(y, m, dCap(mo, 2), -24.9, "Fitness", "FitX Studio", "Berlin");
    add(y, m, dCap(mo, 5), -12.99, "Subscriptions", "Netflix", "Berlin");
    add(y, m, dCap(mo, 8), -9.99, "Subscriptions", "Spotify", "Berlin");
    if (chance(0.5)) add(y, m, dCap(mo, 12), -2.99, "Subscriptions", "iCloud", "Berlin");

    // --- groceries: many small spends ---
    const gCount = ri(8, 13);
    for (let i = 0; i < gCount; i++) {
      const d = dCap(mo, ri(1, mo.days));
      add(y, m, d, -rr(6, 44), "Groceries", pick(POOLS.Groceries.places), "Berlin");
    }
    // --- drogerie ---
    for (let i = 0; i < ri(2, 4); i++) {
      add(y, m, dCap(mo, ri(1, mo.days)), -rr(4, 22), "Drogerie", pick(POOLS.Drogerie.places), "Berlin");
    }
    // --- restaurants ---
    for (let i = 0; i < ri(4, 8); i++) {
      add(y, m, dCap(mo, ri(1, mo.days)), -rr(5, 26), "Restaurants", pick(POOLS.Restaurants.places), "Berlin");
    }
    // --- drinking ---
    for (let i = 0; i < ri(1, 5); i++) {
      add(y, m, dCap(mo, ri(1, mo.days)), -rr(9, 36), "Drinking", pick(POOLS.Drinking.places), "Berlin");
    }
    // --- occasional spends ---
    if (chance(0.55)) add(y, m, dCap(mo, ri(1, mo.days)), -rr(19, 95), "Clothes", pick(POOLS.Clothes.places), "Berlin");
    if (chance(0.3)) add(y, m, dCap(mo, ri(1, mo.days)), -rr(45, 280), "Tech", pick(POOLS.Tech.places), "Berlin");
    if (chance(0.4)) add(y, m, dCap(mo, ri(1, mo.days)), -rr(6, 29), "Health", pick(POOLS.Health.places), "Berlin");
    if (chance(0.45)) add(y, m, dCap(mo, ri(1, mo.days)), -rr(10, 55), "Non-essentials", pick(POOLS["Non-essentials"].places), "Berlin");
    if (chance(0.4)) add(y, m, dCap(mo, ri(1, mo.days)), -rr(12, 39), "Development", pick(POOLS.Development.places), "Berlin");
    if (idx % 3 === 0) add(y, m, dCap(mo, ri(1, mo.days)), -rr(16, 22), "Personal care", pick(POOLS["Personal care"].places), "Berlin");
    if (chance(0.3)) add(y, m, dCap(mo, ri(1, mo.days)), -rr(2, 9), "Trash", pick(POOLS.Trash.places), "Berlin");
    if (chance(0.18)) add(y, m, dCap(mo, ri(1, mo.days)), -rr(15, 4), "Memberships", "Hochschulgruppe", "Berlin");
    // semester fee & books (Education) — a couple of months
    if (idx === 1 || idx === 7) add(y, m, dCap(mo, ri(1, 6)), -312, "Education", "TU Berlin Semesterbeitrag", "Berlin");
    if (chance(0.3)) add(y, m, dCap(mo, ri(1, mo.days)), -rr(14, 58), "Education", pick(POOLS.Education.places), "Berlin");
    if (idx === 5) add(y, m, dCap(mo, ri(8, 18)), -47, "Tax", "Finanzamt", "Berlin");

    // --- travel spikes (trips home / weekend trips) ---
    if (chance(0.4)) {
      const city = pick(POOLS.Travel.cities.filter((c) => c !== "Berlin"));
      add(y, m, dCap(mo, ri(5, mo.days)), -rr(39, 119), "Travel", pick(["DB Bahn", "FlixBus"]), city);
    }
  });

  // sort by date (stable)
  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // ---- balances ----
  const openingBalance = 1480;
  const balanceByDay = {}; // dateStr -> running balance after that day
  {
    // build ordered list of every in-window day
    const allDays = [];
    months.forEach((mo) => {
      for (let d = 1; d <= mo.days; d++) allDays.push(`${mo.key}-${pad(d)}`);
    });
    const dayNet = {};
    transactions.forEach((t) => { dayNet[t.date] = (dayNet[t.date] || 0) + t.amount; });
    let bal = openingBalance;
    allDays.forEach((ds) => { bal += (dayNet[ds] || 0); balanceByDay[ds] = money(bal); });
  }

  // Raw source only — the shared builder in data.js turns this into window.AresiumData.
  // (This is the offline fallback used when the dashboard is opened without the server.)
  window.AresiumMockSource = { categories, months, transactions, balanceByDay, openingBalance };
})();
