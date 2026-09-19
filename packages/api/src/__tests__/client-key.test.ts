import { describe, it, expect } from "vitest";
import { clientKey } from "../client-key.js";

describe("clientKey", () => {
  it("passes IPv4 through unchanged", () => {
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("127.0.0.1")).toBe("127.0.0.1");
  });

  it("unwraps IPv4-mapped IPv6", () => {
    expect(clientKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("::FFFF:203.0.113.7")).toBe("203.0.113.7");
  });

  // Both spellings of the same address must key the same, or one client has
  // two identities and the hex form lands in ::/64 with unrelated traffic.
  it("unwraps the hexadecimal spelling of a mapped address", () => {
    expect(clientKey("::ffff:cb00:7107")).toBe("203.0.113.7");
    expect(clientKey("::ffff:cb00:7107")).toBe(clientKey("::ffff:203.0.113.7"));
  });

  it("does not mistake a native address for a mapped one", () => {
    expect(clientKey("::ffff:cb00:7107")).not.toBe(clientKey("::1"));
    // ffff in the wrong group is native, not mapped.
    expect(clientKey("ffff::cb00:7107")).toBe("ffff:0:0:0::/64");
  });

  // The whole point: rotating inside one allocation must not mint identities.
  it("collapses every address in a /64 to one key", () => {
    const first = clientKey("2001:db8:abcd:1234:0000:0000:0000:0001");
    const second = clientKey("2001:db8:abcd:1234:ffff:ffff:ffff:ffff");
    const third = clientKey("2001:db8:abcd:1234::99");

    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it("keeps distinct /64s distinct", () => {
    expect(clientKey("2001:db8:abcd:1234::1")).not.toBe(clientKey("2001:db8:abcd:1235::1"));
    expect(clientKey("2001:db8:abcd:1234::1")).not.toBe(clientKey("2001:db9:abcd:1234::1"));
  });

  it("normalises leading zeros and case so one prefix has one key", () => {
    expect(clientKey("2001:0db8:0000:0001::1")).toBe(clientKey("2001:DB8:0:1::2"));
  });

  it("handles compressed and edge-form addresses without throwing", () => {
    expect(clientKey("::1")).toBe("0:0:0:0::/64");
    expect(clientKey("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(clientKey("fe80::1%eth0")).toBe(clientKey("fe80::2"));
  });
});
