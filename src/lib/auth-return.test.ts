import { describe, expect, it } from "vitest";
import { localAuthReturn } from "./auth-return";
describe("validated local login return", () => {
  it("preserves the exact local callback receipt and other local queries", () => {
    const callback = `/comercial/marketplaces?integrador_oauth=${"a".repeat(64)}`;
    expect(localAuthReturn(callback)).toBe(callback); expect(localAuthReturn("/comercial/produtos?produto=123&editar=1#valores")).toBe("/comercial/produtos?produto=123&editar=1#valores");
  });
  it.each([null, {}, "https://attacker.example", "//attacker.example", "/\\attacker.example", "/%5cattacker.example", "/%2f%2fattacker.example", "/path\n", "/path?x=%0a", "/login?again=1", "/signup", "/setup", "/a/../login", "/%", `/${"a".repeat(2049)}`])("rejects unsafe or looping destinations %s", value => { expect(localAuthReturn(value)).toBeNull(); });
});
