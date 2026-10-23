import type { IncomingMessage } from "node:http";

export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds the ${maxBytes} byte limit.`);
  }
}

/** Buffer at most `max` bytes, then reject and drain without closing the response socket. */
export function readBody(req: IncomingMessage, max = 1e6): Promise<string> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    let bytes = 0;
    let oversized = false;
    req.on("data", (chunk: Buffer | string) => {
      if (oversized) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > max) {
        oversized = true;
        chunks = [];
        reject(new BodyTooLargeError(max));
      } else {
        chunks.push(buffer);
      }
    });
    req.on("end", () => { if (!oversized) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
    req.on("aborted", () => reject(new Error("Request body aborted.")));
  });
}
