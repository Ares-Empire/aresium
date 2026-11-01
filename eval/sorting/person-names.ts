import vocabulary from "./person-names.json" with { type: "json" };
import { hash } from "./model.js";

const key = (word: string) => word.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/ß/g, "ss").replace(/ł/g, "l").replace(/đ/g, "d").replace(/ı/g, "i");
const keys = (words: string[]) => new Set(words.flatMap((word) => [key(word),
  key(word.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue"))]));
const firstNames = keys(vocabulary.firstNames), surnames = keys(vocabulary.surnames);
const ambiguousFirst = keys(vocabulary.ambiguousFirstNames), ambiguousLast = keys(vocabulary.ambiguousSurnames);
const words = (value: string) => new Set(value.split(" ").map(key));
const titles = words("dr doktor prof professor professorin herr frau mr mrs ms mme madame monsieur fräulein");
const qualifications = words("med dent rer nat phil habil hc h c sc hum dipl ing");
const owners = words("inh inhaber inhaberin eigentümer eigentuemer owner");
const softOwners = words("bei da chez");
const firstOwners = words("zum zur");
const ownerPhrases = words("nous vous toi moi casa ici la le les il lo gli dort hier nang quattro uno due tre tutti amici famiglia mamma papa");
const businessWords = words("bäckerei baeckerei bäcker backhaus backstube metzgerei fleischerei friseur friseursalon frisör salon haarstudio haarmoden barber barbershop beauty kosmetik nagelstudio studio apotheke praxis zahnarzt zahnarztpraxis arzt arztpraxis ärztegemeinschaft gemeinschaftspraxis privatpraxis physiotherapie optik optiker restaurant food streetfood noodles noodle ramen tapas taqueria deli cuisine ristorante pizzeria pizza trattoria taverna taverne osteria café cafe caffè cafeteria bar pub gasthaus gasthof grill imbiss döner doener sushi pho bistro hotel hostel pension suiten suites kantine campus institut universität schule bäckerei backerei konditorei buchhandlung blumen blumenladen atelier werkstatt autowerkstatt autoservice schneiderei reinigung schuhmacherei mode supermarkt kiosk praxisgemeinschaft steuerberater rechtsanwalt rechtsanwälte autohaus buchhaus bücherhaus schuhhaus schuhladen schuhe blumenhaus modehaus möbelhaus möbel reformhaus lebensmittel obst gemüse getränke juwelier uhrmacher fahrrad fahrradladen hofladen maler schlosserei fahrschule tanzschule weinhandlung elektro bestattungen reisebüro hörakustik sanitätshaus galeria galerie");
const legal = words("gmbh ag kg ohg co ek e k se gbr ug ev und and et partner partners sohn söhne tochter töchter nachfolger junior senior");
const locationWords = words("am an im in auf unter über ueber der den dem des von vom zum zur zu beim");
const particles = words("von van de del della di da el al bin ibn ben");
const institutions = words("kantine campus institut universität schule gymnasium hochschule");
const personalServices = words("friseur friseursalon frisör salon haarstudio haarmoden barber beauty kosmetik praxis arzt arztpraxis ärzte zahnarzt zahnarztpraxis physiotherapie optik optiker metzgerei bäckerei");
const placeWords = words("napoli naples napoleone roma rome milano venedig venezia firenze paris sofia athina olympia berlin hamburg münchen muenchen köln koeln leipzig garching wernigerode wacken");
const imagery = words("bella luna rosa rose flora stella alma jade lotus sonne stern sternchen himmel gold goldener goldene silber schwarzer schwarze weißer weisser weiße weisse grüner gruener grüne gruene roter rote alter alte neuer neue klein kleine kleiner groß grosse große grosser großer royal vietnam thai asia china india indisch vietnamese sakura");

type NameKind = "first" | "surname";
type Token = { value: string; stem: string; key: string; suffix: string; start: number; end: number; kind?: NameKind; protected: boolean };
function tokensOf(name: string): Token[] {
  return [...name.matchAll(/[\p{L}\p{M}]+(?:['’ʼ][sS])?/gu)].map((match) => {
    const value = match[0];
    let stem = value, suffix = "";
    const possessive = value.match(/['’ʼ][sS]$/u);
    if (possessive) { suffix = possessive[0]; stem = value.slice(0, -suffix.length); }
    else if (/[sS]$/u.test(value) && (firstNames.has(key(value.slice(0, -1))) || surnames.has(key(value.slice(0, -1))))
      && !firstNames.has(key(value)) && !surnames.has(key(value))) { stem = value.slice(0, -1); suffix = value.slice(-1); }
    return { value, stem, key: key(stem), suffix, start: match.index!, end: match.index! + value.length, protected: false };
  });
}
function protectLocations(tokens: Token[], name: string) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!/(?:strasse|straße|str|weg|platz|allee|gasse|ufer|ring|chaussee)$/u.test(token.key)) continue;
    // A compound street name is one word; a hyphenated/spaced street can contain personal-name words.
    token.protected = true;
    if (/^(?:strasse|straße|str|weg|platz|allee|gasse|ufer|ring|chaussee)$/u.test(token.key)
      || (i > 0 && /^[\s-]+$/u.test(name.slice(tokens[i - 1].end, token.start)) && name.slice(tokens[i - 1].end, token.start).includes("-"))) {
      for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
        if (businessWords.has(tokens[j].key) || locationWords.has(tokens[j].key)) break;
        if (!/^[\s.-]+$/u.test(name.slice(tokens[j].end, tokens[j + 1].start))) break;
        tokens[j].protected = true;
      }
    }
  }
  // A public institutional/place name is not its owner's identity.
  for (let i = 1; i < tokens.length; i++) {
    if (!institutions.has(tokens[i].key)) continue;
    if (i >= 2 && name.slice(tokens[i - 2].end, tokens[i - 1].start) === "-") {
      tokens[i - 2].protected = true;
      tokens[i - 1].protected = true;
    }
  }
  // Ordinary literary business imagery is not a private pair of owners.
  if (/^max\s+(?:und|&)\s+moritz$/iu.test(name.trim())) for (const token of tokens) token.protected = true;
}
const known = (token: Token) => firstNames.has(token.key) || surnames.has(token.key);
const boundary = (token: Token) => token.protected || businessWords.has(token.key) || legal.has(token.key) || locationWords.has(token.key);
function assign(tokens: Token[], index: number, kind: NameKind) {
  const token = tokens[index];
  if (token && !token.protected && !businessWords.has(token.key) && !legal.has(token.key)) token.kind = kind;
}
export function anonymisePersonNames(name: string, salt: string, brandNames: ReadonlySet<string>): { name: string; changed: boolean } {
  if (brandNames.has(name.normalize("NFC").toLowerCase().trim())) return { name, changed: false };
  const tokens = tokensOf(name);
  protectLocations(tokens, name);

  // Strong titles/owner markers also identify out-of-vocabulary names. Qualifications are not personal names.
  for (let i = 0; i < tokens.length; i++) {
    if (!titles.has(tokens[i].key) && !owners.has(tokens[i].key)) continue;
    let start = i + 1;
    while (start < tokens.length && (titles.has(tokens[start].key) || qualifications.has(tokens[start].key))) start++;
    if (start >= tokens.length || boundary(tokens[start])) continue;
    const next = tokens[start + 1];
    const pair = next && !boundary(next) && !titles.has(next.key) && !qualifications.has(next.key)
      && /^[\s.-]+$/u.test(name.slice(tokens[start].end, next.start));
    assign(tokens, start, firstNames.has(tokens[start].key) || pair ? "first" : "surname");
    if (pair) assign(tokens, start + 1, "surname");
  }

  // Conversational owner markers permit rare names too, while known place/restaurant phrases remain literal.
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!softOwners.has(tokens[i].key)) continue;
    const candidate = tokens[i + 1];
    if (boundary(candidate) || placeWords.has(candidate.key) || imagery.has(candidate.key) || ownerPhrases.has(candidate.key)) continue;
    if (!known(candidate) && candidate.stem === candidate.stem.toLowerCase()) continue;
    assign(tokens, i + 1, surnames.has(candidate.key) && !firstNames.has(candidate.key) ? "surname" : "first");
    const last = tokens[i + 2];
    if (last && !boundary(last) && !placeWords.has(last.key) && !imagery.has(last.key) && !ownerPhrases.has(last.key)
      && /^[\s.-]+$/u.test(name.slice(candidate.end, last.start))) assign(tokens, i + 2, "surname");
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], previous = tokens[i - 1], next = tokens[i + 1];
    if (token.protected || token.kind || businessWords.has(token.key) || titles.has(token.key)
      || owners.has(token.key) || legal.has(token.key) || locationWords.has(token.key) && !(firstNames.has(token.key) && next && surnames.has(next.key))
      || qualifications.has(token.key) && previous && titles.has(previous.key)) continue;
    const personalMarker = previous && (softOwners.has(previous.key) || firstOwners.has(previous.key) && firstNames.has(token.key));
    const pairedFirst = previous?.kind === "first" || previous && firstNames.has(previous.key) && !previous.protected && !imagery.has(previous.key);
    const pairedSurname = next && surnames.has(next.key) && !next.protected && !imagery.has(token.key);
    const tradeOwner = previous && businessWords.has(previous.key);
    const standalone = tokens.length === 1;
    const ownerCompany = i === 0 && next && legal.has(next.key);
    const possessive = token.suffix !== "" && known(token);
    const context = personalMarker || pairedFirst || pairedSurname || tradeOwner || standalone || ownerCompany || possessive;

    if (placeWords.has(token.key) && !personalMarker && !pairedFirst && !possessive) continue;
    if (imagery.has(token.key) && !personalMarker && !pairedFirst && !possessive && !pairedSurname) continue;
    if (firstNames.has(token.key) && (!ambiguousFirst.has(token.key) || context)) {
      assign(tokens, i, pairedFirst && surnames.has(token.key) ? "surname" : "first");
    } else if (surnames.has(token.key) && (!ambiguousLast.has(token.key) || context)) assign(tokens, i, "surname");
  }

  // Personal-service/owner context can identify a rare surname after a first name. Unknown restaurant wording stays literal.
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== "first") continue;
    let next = i + 1;
    while (next < tokens.length && particles.has(tokens[next].key)) next++;
    const token = tokens[next];
    const personalContext = tokens.slice(0, i).some((previous) => personalServices.has(previous.key) || owners.has(previous.key) || softOwners.has(previous.key) || titles.has(previous.key));
    if (personalContext && token && !token.kind && !boundary(token) && !placeWords.has(token.key) && !imagery.has(token.key)
      && /^[\s.-]+$/u.test(name.slice(tokens[next - 1].end, token.start))) assign(tokens, next, "surname");
  }
  for (let i = 1; i < tokens.length; i++) {
    if (!tokens[i].kind && tokens[i - 1].kind === "surname" && name.slice(tokens[i - 1].end, tokens[i].start) === "-" && !boundary(tokens[i])) assign(tokens, i, "surname");
  }

  const originals = new Set(tokens.map((token) => token.key)), replacements = new Map<string, string>();
  const pick = (token: Token) => {
    const identity = token.kind + ":" + token.key;
    if (!replacements.has(identity)) {
      const initial = token.kind === "first" && [...token.stem].length === 1;
      const pool = (token.kind === "first" ? vocabulary.replacementFirstNames : vocabulary.replacementSurnames)
        .filter((value) => !originals.has(key(value)) && (!initial || !originals.has(key(value[0]))));
      if (!pool.length) throw new Error("Replacement pool exhausted");
      const offset = parseInt(hash(salt + ":" + identity).slice(0, 8), 16) % pool.length;
      replacements.set(identity, pool[offset]);
    }
    const picked = replacements.get(identity)!;
    const replacement = token.kind === "first" && [...token.stem].length === 1 ? picked[0] : picked;
    const formatted = token.stem === token.stem.toUpperCase() ? replacement.toUpperCase()
      : token.stem === token.stem.toLowerCase() ? replacement.toLowerCase() : replacement;
    return formatted + token.suffix;
  };
  let result = "", offset = 0;
  for (const token of tokens) {
    result += name.slice(offset, token.start) + (token.kind ? pick(token) : token.value);
    offset = token.end;
  }
  result += name.slice(offset);
  return { name: result, changed: result !== name };
}
