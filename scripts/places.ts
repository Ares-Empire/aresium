// Resolve merchant types via OpenStreetMap (rate-limited, ~1/sec — can be slow).
// Kept separate from `npm run enrich` (which is instant + offline) because this hits
// the network. Run before `npm run ai` so the LLM sees the resolved placeType.
//   npm run places
import "dotenv/config";
import { prisma } from "../src/lib/db.js";
import { resolvePlaces } from "../src/enrich/places.js";

await resolvePlaces();
await prisma.$disconnect();
