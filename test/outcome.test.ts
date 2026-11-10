import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, dropMessage, localDate, uuid } from "../src/mileage/outcome.ts";

test("temporary failures stay in the queue", () => {
  for (const status of [null, 408, 429, 500, 502, 503]) assert.equal(classify(status), "retry");
});

test("a refused token keeps the reading and asks for a new token", () => {
  assert.equal(classify(401), "auth");
  assert.equal(classify(403), "auth");
});

test("a reading below one already on the site asks for a new baseline", () => {
  assert.equal(classify(400, "odometer.lowerThanPrevious"), "rebaseline");
});

test("readings the server will never accept are dropped", () => {
  assert.equal(classify(400, "odometer.higherThanNext"), "drop");
  assert.equal(classify(400, "odometer.tooMany"), "drop");
  assert.equal(classify(400, "odometer.futureDate"), "drop");
  assert.equal(classify(404, "http.404"), "drop");
  assert.equal(classify(413), "drop");
});

test("every drop has a message", () => {
  assert.match(dropMessage("odometer.higherThanNext"), /skipped/);
  assert.match(dropMessage("odometer.tooMany"), /limit/);
  assert.match(dropMessage("something.else"), /something\.else/);
  assert.match(dropMessage(null), /refused/);
});

test("the reading date is the phone's calendar date", () => {
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(localDate(new Date(2026, 10, 30, 0, 1)), "2026-11-30");
});

test("request ids are distinct v4 UUIDs", () => {
  const ids = new Set(Array.from({ length: 200 }, uuid));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
