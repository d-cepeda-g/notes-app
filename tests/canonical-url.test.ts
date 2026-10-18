import assert from "node:assert/strict";
import test from "node:test";
import { canonicalPageRedirect } from "../lib/canonical-url";

const canonical = "https://dcepedag.com";
const aliases = "www.dcepedag.com,personal-portfolio--davidcepeda6.replit.app";
test("verified page aliases preserve note paths and searches on the canonical domain", () => {
  for (const host of aliases.split(",")) {
    const result = canonicalPageRedirect(`https://${host}/notes/a%20note?view=trash&next=https://attacker.invalid`, "GET", host, canonical, aliases);
    assert.equal(result?.href, "https://dcepedag.com/notes/a%20note?view=trash&next=https://attacker.invalid");
  }
});
test("HEAD also redirects and canonical pages never loop", () => {
  assert.equal(canonicalPageRedirect("https://www.dcepedag.com/shared/token", "HEAD", "www.dcepedag.com", canonical, aliases)?.href, "https://dcepedag.com/shared/token");
  assert.equal(canonicalPageRedirect(canonical, "GET", "dcepedag.com", canonical, aliases), null);
});
test("mutations are never redirected between hosts", () => {
  for (const method of ["POST", "PATCH", "DELETE", "OPTIONS"]) {
    assert.equal(canonicalPageRedirect("https://www.dcepedag.com/api/notes", method, "www.dcepedag.com", canonical, aliases), null);
  }
});
test("unconfigured hosts cannot redirect and malformed hosts are rejected", () => {
  for (const host of ["attacker.invalid", "dcepedag.com.attacker.invalid", "www.dcepedag.com@attacker.invalid", "www.dcepedag.com/path", "www.dcepedag.com%2f", "www.dcepedag.com\\evil", "www.dcepedag.com,attacker.invalid"]) {
    assert.equal(canonicalPageRedirect("https://attacker.invalid/notes", "GET", host, canonical, aliases), null);
  }
  assert.equal(canonicalPageRedirect("https://www.dcepedag.com/notes", "GET", "www.dcepedag.com", canonical), null);
});
test("invalid or credential-bearing origins cannot become redirect destinations", () => {
  for (const origin of [undefined, "invalid", "javascript:alert(1)", "https://user:password@dcepedag.com"]) {
    assert.equal(canonicalPageRedirect("https://www.dcepedag.com/notes", "GET", "www.dcepedag.com", origin, aliases), null);
  }
});
