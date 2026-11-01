import type { Answer } from "./model.js";
export const answer = (best: string, ...alsoRight: string[]): Answer => ({ best, alsoRight });
// Independent taxonomy: keep this table aligned with categories.md, never with engine rules.
const table: Record<string, Answer> = {};
function map(key: string, values: string, best: string, ...others: string[]) {
  for (const value of values.split(" ")) table[`${key}=${value}`] = answer(best, ...others);
}
map("shop", "supermarket convenience greengrocer butcher seafood deli cheese dairy farm food frozen_food", "groceries");
map("shop", "bakery", "groceries", "coffee-snacks");
map("shop", "pastry confectionery chocolate", "coffee-snacks", "groceries");
map("amenity", "cafe ice_cream", "coffee-snacks");
map("amenity", "restaurant food_court", "eating-out");
map("amenity", "fast_food", "eating-out", "coffee-snacks");
map("amenity", "bar pub nightclub", "going-out");
map("amenity", "biergarten", "going-out", "eating-out");
table["shop=kiosk"] = { ...answer("groceries", "coffee-snacks", "shopping"), personal: true };
map("amenity", "pharmacy doctors dentist clinic hospital", "health");
map("healthcare", "doctor dentist physiotherapist", "health");
map("shop", "medical_supply optician hearing_aids", "health");
map("shop", "chemist", "drugstore", "household", "personal-care");
map("shop", "hairdresser beauty massage", "personal-care");
map("shop", "cosmetics", "personal-care", "drugstore");
map("amenity", "fuel charging_station parking", "car-fuel");
map("shop", "car car_repair car_parts tyres", "car-fuel");
map("tourism", "hotel hostel guest_house motel camp_site", "travel");
map("amenity", "cinema theatre arts_centre", "entertainment");
map("tourism", "attraction zoo", "entertainment");
map("tourism", "museum", "entertainment", "hobbies");
map("leisure", "amusement_arcade", "entertainment");
map("leisure", "fitness_centre sports_centre swimming_pool", "sports-fitness", "memberships");
map("shop", "sports outdoor", "sports-fitness");
map("shop", "clothes shoes fashion_accessories bag", "clothes");
map("shop", "jewelry", "clothes", "shopping");
map("shop", "electronics computer mobile_phone hifi", "electronics");
map("shop", "furniture doityourself hardware kitchen houseware interior_decoration garden_centre", "household");
map("shop", "florist", "household", "gifts");
map("shop", "books craft musical_instrument model", "hobbies");
map("shop", "bicycle", "hobbies", "shopping");
map("shop", "pet pet_grooming", "pets");
map("amenity", "veterinary", "pets");
map("shop", "department_store variety_store mall", "shopping");
map("shop", "gift", "shopping", "gifts");
map("shop", "toys", "shopping", "gifts", "hobbies");
for (const key of ["amenity=bank", "amenity=bureau_de_change"]) table[key] = { personal: true };
table["shop=telecommunication"] = { ...answer("internet-phone", "electronics"), personal: true };
map("office", "insurance", "insurance");
map("office", "energy_supplier", "utilities");
map("amenity", "car_rental", "taxi-sharing", "travel");
map("amenity", "bicycle_rental taxi", "taxi-sharing");
map("amenity", "university college language_school music_school driving_school", "education");
export function fromTags(tags: Record<string, string>): Answer {
  // Generic shop tags give way to the explicit use; incompatible primary uses remain unclear.
  const primary = ["healthcare", "leisure", "tourism", "amenity"].map((key) => table[`${key}=${tags[key]}`]).filter(Boolean);
  const matches = primary.length ? primary : [table[`shop=${tags.shop}`], table[`office=${tags.office}`]].filter(Boolean);
  if (!matches.length || new Set(matches.map((a) => a.best ?? "unsorted")).size > 1) return { unclear: true };
  return { ...matches[0], alsoRight: [...(matches[0].alsoRight ?? [])] };
}
