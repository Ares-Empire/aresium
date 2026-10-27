// Payment ids that stay the same when the same file, or an overlapping period, is imported again.
//
// Where the format carries the bank's own reference, that is the id. Otherwise the id is a hash of the booking
// fields (date, amount, counterparty, text; which ones exactly is up to each reader). Changing which columns a
// known layout reads changes its ids, so new imports of old periods would count twice: change them with care.
//
// Identical bookings on the same day (two coffees of 3,20 at the same café) are told apart by their occurrence
// number in the file: the first keeps the plain id, the second hashes the same fields plus "|2", and so on. An export always holds every booking of each day it covers, so the
// numbers repeat on every re-import. Keeping the first occurrence on the plain id is what lets the VR Bank
// readers keep the ids they gave before (they had no occurrence number, so a second identical payment was lost
// as a duplicate).
import { sha1 } from "../../import/sha1.js";

export const hashId = (fields: string) => sha1(fields).slice(0, 24);

export type IdCandidate = { id: string; fields: string };

// The final ids: an id seen before in this file becomes the hash of its fields plus its occurrence number.
export function withOccurrences(candidates: IdCandidate[]): string[] {
  const seen = new Map<string, number>();
  return candidates.map(({ id, fields }) => {
    const occurrence = (seen.get(id) ?? 0) + 1;
    seen.set(id, occurrence);
    return occurrence === 1 ? id : hashId(`${fields}|${occurrence}`);
  });
}

// Hash ids for bookings without a bank reference.
export const bookingIds = (fields: string[]) => withOccurrences(fields.map((f) => ({ id: hashId(f), fields: f })));
