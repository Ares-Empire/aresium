# Independent category guide

Draft for Claude's review before either blind judge starts. Written from the default category names and ordinary
uses of money; no starter rules, engine answers or engine shop-list categories informed this guide. IDs come only
from `src/engine/categories.ts`. Negative amounts are money out; positive amounts are money in. Do not infer a
purchase from a processor alone, an opaque company name, an amount or an IBAN. A place's hidden tags are evidence
for the generator, but are deliberately unavailable to judges: judge only what the payment shows.

Use `best` for your preferred category ID and `alsoRight` for every other reasonable category. `personal: true`
means the person's preference/context is needed; `unclear: true` means the line lacks evidence. Either permits
unsorted, but neither automatically permits every category. You may name reasonable categories as well as either
flag. Do not use `other` as a replacement for uncertainty. A category's purpose matters more than recurring billing.

## Categories

| ID — name | Belongs here (examples) | Goes elsewhere |
|---|---|---|
| groceries — Groceries | Supermarkets, food shops, vegetables, bread for home | Restaurant meals: eating-out; household supplies: household |
| drugstore — Drugstore | Drugstore baskets, toiletries, cleaning products, dm-type shops | Medicines/practices: health; haircuts: personal-care |
| eating-out — Eating out | Restaurants, takeaway meals, meal delivery | Small café snacks: coffee-snacks; drinks at a bar: going-out |
| coffee-snacks — Coffee & snacks | Cafés, ice cream, pastries, quick snacks | Food shopping: groceries; full meals: eating-out |
| rent — Rent | Home rent, warm rent, landlord rent payment | Separately billed power/water: utilities; hotel: travel |
| utilities — Utilities | Electricity, gas, water, heating, waste collection | Telecom: internet-phone; rent including utilities: rent |
| internet-phone — Internet & phone | Broadband, mobile plan, prepaid phone top-ups | Buying a phone: electronics; media streaming: subscriptions |
| household — Household | Furniture, homewares, DIY, household equipment | Clothing: clothes; ordinary food: groceries |
| pets — Pets | Pet food, pet supplies, veterinary care | Human medical care: health |
| bus-train — Bus & train | Local and long-distance public transport, Deutschlandticket | Taxi/rental sharing: taxi-sharing; flight/hotel: travel |
| car-fuel — Car & fuel | Petrol, charging, repairs, parking, car costs | Motor insurance: insurance; rental travel may be travel |
| taxi-sharing — Taxi & sharing | Taxi, ride hail, shared car/bike/scooter hire | Own car costs: car-fuel; train: bus-train |
| travel — Travel | Hotels, flights, holiday package, travel accommodation | A restaurant abroad is still eating-out unless budgeting the whole trip here |
| health — Health | Pharmacy, doctor, dentist, therapy, optician | Drugstore toiletries: drugstore; gym: sports-fitness |
| sports-fitness — Sports & fitness | Gym, swimming, sports class, sports equipment | General association dues: memberships; medical treatment: health |
| personal-care — Personal care | Hairdresser, barber, beauty salon, manicure | Medicines: health; supermarket toiletries: drugstore |
| going-out — Going out | Bars, pubs, nightclubs, nightlife | Cinema/media: entertainment; restaurant meal: eating-out |
| entertainment — Entertainment | Cinema, theatre, concerts, games, amusement admission | Supplies for an activity: hobbies; recurring streaming may be subscriptions |
| hobbies — Hobbies | Books for pleasure, craft materials, instruments, hobby supplies | Tuition: education; cinema ticket: entertainment |
| subscriptions — Subscriptions | Streaming plans, recurring media/software access, newspaper subscriptions | A monthly power bill: utilities; phone plan: internet-phone |
| clothes — Clothes | Clothing, footwear, accessories | Furniture: household; general marketplace with no item: shopping or unclear |
| electronics — Electronics | Computers, phones, appliances with electronic purpose | Broadband service: internet-phone; software subscription: subscriptions |
| shopping — Shopping | General retail/department-store purchases where only retail is known | Prefer a specific goods category when evidence identifies the goods |
| gifts — Gifts | Explicit presents, birthday gifts, gift purchases | Do not infer gifts from a shop alone; charity: donations |
| education — Education | University semester fee, tuition, courses, study books | Work expenses: work; leisure reading: hobbies |
| work — Work | Explicit business/professional expenses, office supplies, work tools | Money received for work: salary; private study: education |
| insurance — Insurance | Liability, health, home and car insurance premiums | Statutory taxes: taxes; gym membership: sports-fitness |
| taxes — Taxes | Income/vehicle/property tax, explicit tax payment | Bank charges: fees; church/club donation: donations |
| fees — Fees | Bank account/card fees, public administrative charges, broadcasting contribution | Taxes: taxes; tuition: education; interest charged may be fees |
| memberships — Memberships | Association, trade union, ADAC or general club dues | Donations: donations; gym/sports club can be sports-fitness |
| donations — Donations | Explicit charity donation, voluntary charitable support | A charity's paid shop purchase is shopping; dues may be memberships |
| cash — Cash withdrawals | ATM/counter cash withdrawal | Do not guess what the cash was spent on; deposits need context |
| friends — Friends | Explicit personal reimbursements, shared costs, money to friends | Salary: salary; family support received: parents-family |
| savings-investing — Savings & investing | Securities purchase/sale proceeds, explicit investment/savings contribution | Interest/dividends received: interest-dividends; moving own cash: own-transfers |
| salary — Salary & side jobs | Explicit salary, wages, freelance/side-job pay received | Scholarship: bafoeg-scholarships; private sale: selling-things |
| bafoeg-scholarships — BAföG & scholarships | BAföG, scholarship/study grant received | Wage from a university: salary; tuition paid: education |
| parents-family — Parents & family | Explicit support, allowance or gift received from family | Kindergeld from Familienkasse: kindergeld; unknown sender: personal/unclear |
| kindergeld — Kindergeld | Explicit child benefit received | Family transfers: parents-family; salary: salary |
| selling-things — Selling things | Explicit proceeds from selling personal goods on Vinted, Kleinanzeigen, eBay | Refund: original spend category or other-income; buying: relevant spend category |
| interest-dividends — Interest & dividends | Savings interest, dividends, distributions received | Investment principal: savings-investing; salary: salary |
| other-income — Other income | Explicit incoming money with known income purpose outside the income categories | Do not call every positive transfer income; refunds can offset spend |
| other — Other | Known spending that fits no category | Opaque text or unspecified person: unclear/personal rather than forced other |
| own-transfers — Own transfers (built in) | Evidence of movement between own accounts; bank funding of an imported PayPal purchase | Equal opposite amounts alone do not prove ownership |

`not-sorted` is a UI state, not an answer ID. Represent it with `unclear` or `personal`.

## Borderlines and direction

- Bakery: groceries, coffee-snacks; eating-out if a sit-down meal is evident. With just bakery text, both groceries
  and coffee-snacks are reasonable. Kiosk: groceries, coffee-snacks, shopping; personal when the basket is unknown.
- Pharmacy: health; drugstore if toiletries are explicit. Drugstore: drugstore, household or personal-care depending
  on the basket; do not assume prescription medicine from a drugstore name.
- Amazon/general marketplace: shopping is reasonable; personal/unclear without item information. Explicit clothes,
  books, electronics, furniture or gift text permits clothes, hobbies/education, electronics, household or gifts.
  `AMZN Mktp` does not establish what an unrelated hidden seller sells.
- Deutschlandticket: bus-train or travel. Gym: sports-fitness or memberships. Streaming: subscriptions or entertainment.
  Newspapers: subscriptions, hobbies or entertainment. Sports club: sports-fitness or memberships.
- Takeaway and meal delivery (Lieferando, Wolt, Uber Eats): eating-out; coffee-snacks also when only a snack is
  evident. A delivery service's name alone is enough for eating-out. Hotel abroad: travel; work if explicitly a business trip. Foreign currency alone does not imply travel.
- PayPal to a person: personal/unclear; friends if a shared cost is evident, gifts if explicit. A processor alone
  supplies no category. Money from a person: personal/unclear; friends, parents-family, salary or selling-things only
  with corresponding evidence. No category is accepted simply because a hidden author knows the purpose.
- Positive refund from a shop or service: the original spending category (a clothes shop's refund: clothes), since
  Aresium books money in under its own category as it happened (Patrik, 2026-11-01); other-income is also right. Not
  personal: the shop says where it belongs. Positive Vinted/eBay proceeds explicitly labelled sale: selling-things; a platform name alone
  is unclear/personal. Positive salary is salary, never work. Negative repayment of a grant needs context.
- ATM withdrawal: cash. Cash deposit: personal/unclear unless ownership or income purpose is explicit.
- Rundfunkbeitrag: fees, utilities or subscriptions (it is charged per home, so many budget it with the
  home's running costs; Claude, 2026-11-01, after the first round). University semester contribution: education or fees. ADAC: memberships,
  car-fuel or insurance when that service is explicit. Tax refund: taxes or other-income, personal.
- Rent paid: rent. Rent received: other-income (or personal if merely money from a person without rent wording).
  Savings account transfers: own-transfers with ownership evidence; savings-investing is reasonable for an explicit
  investment contribution without an own-account pair. Insurance reimbursements: health or other-income, personal.

## Independent OSM / NSI mapping (generator only)

This is the single mapping used for both OSM tags and NSI entry tags. A semicolon separates accepted categories;
first is preferred. Judges do not see the tags. A misleading/opaque visible name may therefore disagree with the
source tag: that is a useful dispute for review, never a reason to reveal the tag to a judge.

| Tag | Category IDs |
|---|---|
| shop=supermarket, convenience, greengrocer, butcher, seafood, deli, cheese, dairy, farm, food, frozen_food | groceries |
| shop=bakery | groceries; coffee-snacks |
| shop=pastry, confectionery, chocolate; amenity=cafe, ice_cream | coffee-snacks; groceries (shops only) |
| amenity=restaurant, fast_food, food_court | eating-out; coffee-snacks (fast_food only) |
| amenity=bar, pub, nightclub, biergarten | going-out; eating-out (biergarten only) |
| shop=kiosk | groceries; coffee-snacks; shopping; personal |
| amenity=pharmacy, doctors, dentist, clinic, hospital; healthcare=doctor, dentist, physiotherapist; shop=medical_supply, optician, hearing_aids | health |
| shop=chemist | drugstore; household; personal-care |
| shop=hairdresser, beauty, cosmetics, massage | personal-care; drugstore (cosmetics only) |
| amenity=fuel, charging_station, parking; shop=car, car_repair, car_parts, tyres | car-fuel |
| tourism=hotel, hostel, guest_house, motel, camp_site | travel |
| amenity=cinema, theatre, arts_centre; tourism=museum, attraction, zoo; leisure=amusement_arcade | entertainment; hobbies (museum only) |
| leisure=fitness_centre, sports_centre, swimming_pool; shop=sports, outdoor | sports-fitness; memberships (leisure only) |
| shop=clothes, shoes, fashion_accessories, jewelry, bag | clothes; shopping (jewelry only) |
| shop=electronics, computer, mobile_phone, hifi | electronics |
| shop=furniture, doityourself, hardware, kitchen, houseware, interior_decoration, garden_centre, florist | household; gifts (florist only) |
| shop=books, craft, musical_instrument, model, bicycle | hobbies; shopping (bicycle only) |
| shop=pet, pet_grooming; amenity=veterinary | pets |
| shop=department_store, variety_store, mall, gift, toys | shopping; gifts (gift/toys only); hobbies (toys only) |
| amenity=bank, bureau_de_change | personal (a bank name does not prove a fee or withdrawal) |
| shop=telecommunication | internet-phone; electronics; personal |
| office=insurance | insurance |
| office=energy_supplier | utilities |
| amenity=car_rental, bicycle_rental, taxi | taxi-sharing; travel (car_rental only) |
| amenity=university, college, language_school, music_school, driving_school | education |
| Unmapped / contradictory tags | unclear (never invent a category) |

More specific health, leisure and tourism tags take precedence over a generic shop tag. Conflicting primary tags
are unclear. The mapping and initial labels are versioned; change them only with an explanation and re-judging.
