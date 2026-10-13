import { test } from "node:test";
import assert from "node:assert/strict";
import { domainOf } from "./github.ts";

test("domainOf collapses subdomains and handles emails", () => {
  assert.equal(domainOf("https://developer.oracle.com/x"), "oracle.com");
  assert.equal(domainOf("https://www.acme.io"), "acme.io");
  assert.equal(domainOf("j@mail.example.co.uk"), "example.co.uk");
  assert.equal(domainOf("nope"), null);
  assert.equal(domainOf(null), null);
});
