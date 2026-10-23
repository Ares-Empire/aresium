import assert from "node:assert/strict";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { test } from "node:test";
import { BodyTooLargeError, readBody } from "./read-body.js";

const request = () => {
  const req = new IncomingMessage(new Socket()); // no socket is connected
  req.complete = true; // the HTTP parser normally marks a fully received request complete
  return req;
};

test("body limit counts UTF-8 bytes and preserves characters split across chunks", async () => {
  const bytes = Buffer.from("é€😀"); // 9 bytes, 4 UTF-16 code units
  const req = request();
  const result = readBody(req, bytes.length);
  for (const byte of bytes) req.push(Buffer.from([byte]));
  req.push(null);
  assert.equal(await result, "é€😀");

  const oversized = request();
  const rejected = assert.rejects(readBody(oversized, bytes.length - 1), BodyTooLargeError);
  oversized.push(bytes);
  oversized.push(null);
  await rejected;
  assert.equal(oversized.socket.destroyed, false);
});

test("overflow rejects before end, drains remaining bytes and keeps the connection open", async () => {
  const req = request();
  const rejected = assert.rejects(readBody(req, 3), BodyTooLargeError);
  req.push(Buffer.from("four"));
  await rejected;
  assert.equal(req.socket.destroyed, false);
  const ended = new Promise<void>((resolve) => req.once("end", resolve));
  req.push(Buffer.from("discard this too"));
  req.push(null);
  await ended;
  assert.equal(req.socket.destroyed, false);
});

test("the default limit stays at 1,000,000 bytes", async () => {
  const req = request();
  const result = readBody(req);
  req.push(Buffer.alloc(1_000_000, "a"));
  req.push(null);
  assert.equal((await result).length, 1_000_000);

  const oversized = request();
  const rejected = assert.rejects(readBody(oversized), BodyTooLargeError);
  oversized.push(Buffer.alloc(1_000_001, "a"));
  oversized.push(null);
  await rejected;
});
