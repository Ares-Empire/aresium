// A lexical readability measure, independent of the engine, categories, OSM tags and NSI brand membership.
// Match complete business/cuisine words and conventional trade compounds. Brand recognition is not counted.
export const HINT_ROOTS = [
  "backerei", "baeckerei", "backhaus", "backstube", "bakery", "backshop", "brot", "boulangerie", "konditorei",
  "pizzeria", "pizza", "pizzahaus", "trattoria", "taverna", "taverne", "ristorante", "restaurant", "gasthaus",
  "gasthof", "gastronomie", "osteria", "bistro", "brasserie", "bratwurst", "steakhouse", "burger", "imbiss",
  "doner", "doener", "kebab", "kebap", "falafel", "sushi", "noodle", "ramen", "tapas", "taqueria",
  "cafe", "caffe", "caffee", "kaffee", "coffee", "teestube", "eiscafe", "eiscaffe", "eisdiele", "eiscreme",
  "biergarten", "bierhaus", "brauhaus", "kneipe", "cocktailbar", "weinbar", "winebar", "shishabar", "sportsbar",
  "friseur", "frisoer", "frisur", "barber", "haarstudio", "haarwerk", "haarsalon", "haaratelier", "haarmoden",
  "beauty", "kosmetik", "nagelstudio", "nails", "nailstudio", "massagestudio", "wellness",
  "hotel", "hostel", "pension", "motel", "gasthof", "kino", "cinema", "filmtheater", "theater", "museum",
  "fitness", "sportstudio", "sportcenter", "sportzentrum", "schwimmbad", "hallenbad", "tennis", "yoga",
  "apotheke", "pharmacy", "arztpraxis", "zahnarzt", "zahnmedizin", "zahnarzte", "zahnaerzte", "dental",
  "arzt", "arzte", "aerzte", "physio", "therapiepraxis", "optik", "optiker", "horakustik", "hoerakustik",
  "supermarkt", "supermarket", "lebensmittel", "biomarkt", "naturkost", "feinkost", "metzgerei", "fleischerei",
  "gemuse", "gemuese", "obstladen", "getranke", "getraenke", "kiosk", "spati", "spaeti", "tankstelle",
  "autowerkstatt", "autoservice", "autoreparatur", "reifen", "fahrrad", "radladen", "bikeshop",
  "buchhandlung", "buchladen", "bucher", "buecher", "bookshop", "books", "blumen", "florist", "floristik",
  "mobel", "moebel", "wohnstudio", "gartencenter", "gartnerei", "gaertnerei", "tierbedarf", "zoohandlung",
  "schuhhaus", "schuhgeschaft", "schuhladen", "modehaus", "boutique", "elektro", "computer", "handyladen",
];
const exactHints = new Set(["pho", "bar", "pub", "grill", "eis", "salon", "hair", "gym", "club", "arzt", "deli", "food", "souk"]);
export function hasHintWord(name: string): boolean {
  const tokens = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ß/g, "ss").match(/[\p{L}]+/gu) ?? [];
  return tokens.some((token) => exactHints.has(token) || HINT_ROOTS.some((root) => token.startsWith(root)));
}
export function hintWordShare(names: string[]) {
  const withHint = names.filter(hasHintWord).length;
  return { total: names.length, withHint, share: names.length ? withHint / names.length : 0 };
}
