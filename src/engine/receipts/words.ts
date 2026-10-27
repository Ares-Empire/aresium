// The words a receipt is read by, per language, in one table. To add a word or a language, add it here: the reader
// compares every phrase as words in shopWords form (lower case, ä → ae, accents dropped, see sorting/shop-words.ts),
// so write it as it is printed ("Rückgeld", "espèces"); a phrase of several words matches them in a row, and a
// longer phrase wins over a shorter one inside it ("EC-Cash" is a card, not cash; "Total HT" is VAT, not the total).

export type Language = "de" | "en" | "fr" | "it" | "es" | "nl" | "pt";

/** What a line with this word is. */
export type WordKind =
  | "due" // the amount to pay: the strongest total ("zu zahlen", "amount due")
  | "total" // the total ("Summe", "Total")
  | "amount" // a weak total, as card slips print it ("Betrag", "Montant")
  | "subtotal" | "tax" | "deposit" | "tip"
  | "other" // amounts that are never the total: savings, discounts, points
  | "card" | "cash" | "given" | "change"
  | "register" // header lines that are not the shop's name: till, cashier, receipt number, tax ids
  | "greeting" | "street" | "phone" | "date" | "validity";

export type WordTable = Partial<Record<WordKind, readonly string[]>>;

export const RECEIPT_WORDS: Readonly<Record<Language, WordTable>> = {
  de: {
    due: ["zu zahlen", "zahlbetrag", "zu zahlender betrag"],
    total: ["summe", "gesamt", "gesamtbetrag", "gesamtsumme", "endsumme", "endbetrag", "bonsumme", "rechnungsbetrag", "summe eur"],
    amount: ["betrag"],
    subtotal: ["zwischensumme", "zw summe", "zwsumme"],
    tax: ["mwst", "ust", "steuer", "netto", "brutto", "nettobetrag", "steuerbetrag", "mehrwertsteuer", "umsatzsteuer", "mwst satz", "steuersatz"],
    deposit: ["pfand", "leergut", "pfandrückgabe", "pfandbon", "leergutbon", "pfandgutschrift", "flaschenpfand"],
    tip: ["trinkgeld"],
    other: ["rabatt", "ersparnis", "gespart", "sie sparen", "nachlass", "payback", "punkte", "gutschein"],
    card: ["karte", "kartenzahlung", "girocard", "ec karte", "ec cash", "ec", "kreditkarte", "debitkarte", "kontaktlos", "bankkarte", "electronic cash", "elv"],
    cash: ["bar", "barzahlung", "bargeld", "in bar"],
    given: ["gegeben", "geg", "erhalten"],
    change: ["rückgeld", "zurück", "wechselgeld"],
    register: ["kasse", "kassierer", "kassiererin", "bediener", "bon", "bon nr", "bonnr", "beleg", "beleg nr", "belegnr", "filiale", "tse", "transaktion", "seriennummer", "signatur", "signaturzähler", "terminal", "trace", "kassenbon", "quittung", "rechnung", "kundenbeleg", "händlerbeleg", "ust id", "ust idnr", "st nr", "steuernummer", "steuer nr", "uid", "uid nr", "inh", "inhaber"],
    greeting: ["willkommen", "danke", "vielen dank", "auf wiedersehen", "bis bald", "ihr einkauf"],
    street: ["straße", "str", "weg", "platz", "allee", "gasse", "ring", "damm", "chaussee", "ufer"],
    phone: ["tel", "telefon", "fon", "fax"],
    date: ["datum"],
    validity: ["gültig", "gültig bis", "bis", "mhd", "haltbar", "ablauf", "einlösbar"],
  },
  en: {
    due: ["amount due", "balance due", "total due", "to pay", "total to pay", "amount to pay"],
    total: ["total", "grand total", "total gbp", "total usd"],
    amount: ["amount", "purchase", "sale"],
    subtotal: ["subtotal", "sub total"],
    tax: ["vat", "tax", "sales tax", "net", "excl vat", "incl vat", "vat rate", "gst", "hst"],
    deposit: ["deposit", "bottle deposit", "bottle return"],
    tip: ["tip", "gratuity", "service charge"],
    other: ["savings", "you saved", "saved", "discount", "points", "clubcard", "nectar"],
    card: ["card", "debit", "credit", "chip", "debit card", "credit card", "card payment"],
    cash: ["cash"],
    given: ["tendered", "cash tendered", "tender", "given"],
    change: ["change", "change due"],
    register: ["till", "cashier", "operator", "receipt", "receipt no", "terminal", "transaction", "trans", "auth code", "vat no", "vat reg", "store no"],
    greeting: ["welcome", "thank you", "thanks", "see you"],
    street: ["street", "st", "road", "rd", "avenue", "ave", "lane", "way", "square", "blvd", "boulevard", "drive"],
    phone: ["tel", "phone", "telephone"],
    date: ["date"],
    validity: ["valid", "valid until", "until", "expires", "exp"],
  },
  fr: {
    due: ["net à payer", "à payer", "total à payer", "montant dû"],
    total: ["total", "total ttc", "montant ttc", "total eur"],
    amount: ["montant"],
    subtotal: ["sous total"],
    tax: ["tva", "ht", "total ht", "total tva", "montant ht", "taux", "montant tva"],
    deposit: ["consigne"],
    tip: ["pourboire"],
    other: ["remise", "économie", "économies", "réduction", "points", "fidélité"],
    card: ["carte", "cb", "carte bancaire", "carte bleue", "sans contact", "paiement carte", "carte crédit"],
    cash: ["espèces", "en espèces", "liquide"],
    given: ["reçu", "espèces reçues", "donné", "montant reçu"],
    change: ["rendu", "monnaie rendue", "à rendre", "rendu monnaie", "monnaie"],
    register: ["caisse", "caissier", "caissière", "ticket", "facture", "terminal", "transaction", "siret", "siren", "n tva"],
    greeting: ["bienvenue", "merci", "à bientôt", "au revoir"],
    street: ["rue", "avenue", "av", "boulevard", "bd", "place", "chemin", "allée", "quai", "impasse", "route"],
    phone: ["tél", "tel", "téléphone"],
    date: ["date"],
    validity: ["valable", "jusqu", "expire"],
  },
  it: {
    due: ["da pagare", "totale da pagare", "importo pagato"],
    total: ["totale", "totale complessivo", "totale euro"],
    amount: ["importo"],
    subtotal: ["subtotale", "sub totale"],
    tax: ["iva", "imponibile", "di cui iva", "imposta", "aliquota"],
    deposit: ["vuoto", "cauzione"],
    tip: ["mancia"],
    other: ["sconto", "risparmio", "punti"],
    card: ["carta", "bancomat", "pagobancomat", "carta di credito", "carta di debito", "pagamento elettronico", "elettronico"],
    cash: ["contanti", "contante", "pagamento contante"],
    given: ["ricevuto", "contante ricevuto", "pagato"],
    change: ["resto"],
    register: ["cassa", "cassiere", "scontrino", "documento commerciale", "ricevuta", "doc n", "partita iva", "p iva", "matricola", "terminale"],
    greeting: ["benvenuti", "grazie", "arrivederci"],
    street: ["via", "viale", "piazza", "corso", "largo", "vicolo", "strada"],
    phone: ["tel", "telefono"],
    date: ["data"],
    validity: ["valido", "scadenza", "fino"],
  },
  es: {
    due: ["a pagar", "total a pagar"],
    total: ["total", "importe total", "total eur"],
    amount: ["importe"],
    subtotal: ["subtotal", "sub total"],
    tax: ["iva", "base imponible", "base", "cuota", "impuestos", "igic"],
    deposit: ["envase"],
    tip: ["propina"],
    other: ["descuento", "ahorro", "puntos"],
    card: ["tarjeta", "tarjeta crédito", "tarjeta débito", "pago con tarjeta", "sin contacto", "datáfono"],
    cash: ["efectivo", "metálico", "en efectivo", "contado"],
    given: ["entregado", "recibido", "efectivo entregado", "entrega"],
    change: ["cambio", "vuelto", "su cambio", "a devolver"],
    register: ["caja", "cajero", "cajera", "ticket", "factura", "factura simplificada", "nif", "cif", "terminal", "operación"],
    greeting: ["bienvenido", "gracias", "hasta pronto"],
    street: ["calle", "c", "avenida", "avda", "plaza", "paseo", "carretera", "camino"],
    phone: ["tel", "teléfono", "tfno"],
    date: ["fecha"],
    validity: ["válido", "hasta", "caduca"],
  },
  nl: {
    due: ["te betalen", "totaal te betalen"],
    total: ["totaal", "totaal bedrag", "eindtotaal"],
    amount: ["bedrag"],
    subtotal: ["subtotaal"],
    tax: ["btw", "excl btw", "incl btw", "netto", "grondslag"],
    deposit: ["statiegeld", "emballage", "leeggoed"],
    tip: ["fooi"],
    other: ["korting", "voordeel", "bespaard", "punten"],
    card: ["pin", "pinnen", "gepind", "pinbetaling", "betaalkaart", "bankpas", "contactloos", "creditcard"],
    cash: ["contant", "contanten", "contant betaald"],
    given: ["ontvangen", "betaald"],
    change: ["wisselgeld", "terug", "retour"],
    register: ["kassa", "kassabon", "bon", "bon nr", "caissière", "medewerker", "terminal", "transactie", "kvk", "btw nr"],
    greeting: ["welkom", "bedankt", "dank u", "tot ziens"],
    street: ["straat", "laan", "weg", "plein", "gracht", "kade", "singel", "dijk"],
    phone: ["tel", "telefoon"],
    date: ["datum"],
    validity: ["geldig", "tot"],
  },
  pt: {
    due: ["a pagar", "total a pagar"],
    total: ["total", "valor total", "total eur"],
    amount: ["valor"],
    subtotal: ["subtotal"],
    tax: ["iva", "taxa", "base tributável", "incidência", "valor iva"],
    deposit: ["tara", "vasilhame"],
    tip: ["gorjeta"],
    other: ["desconto", "poupança", "pontos"],
    card: ["cartão", "multibanco", "mb", "cartão crédito", "cartão débito", "débito", "crédito", "mb way", "tpa"],
    cash: ["dinheiro", "numerário", "em dinheiro"],
    given: ["entregue", "recebido", "valor entregue", "valor recebido"],
    change: ["troco"],
    register: ["caixa", "operador", "fatura", "fatura simplificada", "fatura recibo", "nif", "contribuinte", "atcud", "talão", "terminal"],
    greeting: ["bem vindo", "obrigado", "obrigada", "volte sempre"],
    street: ["rua", "avenida", "av", "praça", "largo", "travessa", "estrada", "alameda"],
    phone: ["tel", "telefone"],
    date: ["data"],
    validity: ["válido", "até", "validade"],
  },
};

/** Words of no single language: card schemes and wallets. They never decide the language. */
export const SHARED_WORDS: WordTable = {
  card: ["visa", "mastercard", "master card", "maestro", "v pay", "vpay", "amex", "american express", "apple pay", "google pay",
    "jcb", "unionpay", "diners", "visa debit", "debit mastercard", "contactless"],
  other: ["coupon"],
};

/**
 * German and Dutch streets are often one word ending in the street word ("Kaufstr. 12", "Kalverstraat 1"): a word
 * ending in one of these, on a line with a number, is an address.
 */
export const STREET_ENDINGS = ["strasse", "str", "weg", "platz", "allee", "gasse", "ring", "damm", "straat", "laan", "plein", "gracht", "kade", "dijk", "singel"];

/** Total words long enough to be recognised with one letter misread or missing ("SUMM", "T0TAL"). */
export const FUZZY_KINDS: readonly WordKind[] = ["due", "total"];
export const FUZZY_MIN_LENGTH = 5;

// Currencies. ISO codes are recognised as whole words anywhere; signs only next to an amount, because "Fr." is also
// Friday and "kr" a word. "kr" is Danish, Swedish or Norwegian: decided by an ISO code or the country's phone
// prefix on the receipt, otherwise left open.
// Codes that are also words printed in capitals ("TRY OUR APP") are left out; their signs still count.
export const ISO_CURRENCIES = ["EUR", "GBP", "USD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "JPY", "CAD",
  "AUD", "BRL", "ISK"];
export const CURRENCY_SIGNS: readonly (readonly [string, string])[] = [
  ["US$", "USD"], ["CA$", "CAD"], ["C$", "CAD"], ["AU$", "AUD"], ["A$", "AUD"], ["R$", "BRL"],
  ["€", "EUR"], ["£", "GBP"], ["$", "USD"], ["SFr.", "CHF"], ["Fr.", "CHF"], ["Fr", "CHF"], ["zł", "PLN"], ["Kč", "CZK"],
  ["Ft", "HUF"], ["lei", "RON"], ["лв", "BGN"], ["₺", "TRY"], ["TL", "TRY"], ["¥", "JPY"], ["₹", "INR"], ["kr", "kr"],
];
/** Which "kr" a phone prefix names. */
export const KRONE_BY_PHONE: Readonly<Record<string, string>> = { "+45": "DKK", "+46": "SEK", "+47": "NOK", "+354": "ISK" };
