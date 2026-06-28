import { describe, it, expect } from "vitest";
import {
  emptyShipTo,
  normalizeShipTo,
  isShipToComplete,
  isShipToEmpty,
  parseUsAddress,
} from "../address";

describe("normalizeShipTo", () => {
  it("trims, uppercases state, defaults country to US", () => {
    expect(normalizeShipTo({ street: " 1 A St ", city: " Reno ", state: "nv", zip: " 89501 " })).toEqual({
      street: "1 A St", city: "Reno", state: "NV", zip: "89501", country: "US",
    });
  });
  it("never throws on junk input", () => {
    expect(normalizeShipTo(null)).toEqual(emptyShipTo());
    expect(normalizeShipTo(undefined)).toEqual(emptyShipTo());
    expect(normalizeShipTo("nope")).toEqual(emptyShipTo());
  });
  it("honors an explicit country", () => {
    expect(normalizeShipTo({ country: "ca" }).country).toBe("CA");
  });
});

describe("isShipToComplete / isShipToEmpty", () => {
  it("complete requires state AND zip", () => {
    expect(isShipToComplete({ state: "NV", zip: "89501" })).toBe(true);
    expect(isShipToComplete({ state: "NV" })).toBe(false);
    expect(isShipToComplete({ zip: "89501" })).toBe(false);
    expect(isShipToComplete(null)).toBe(false);
  });
  it("empty ignores the always-present country default", () => {
    expect(isShipToEmpty(null)).toBe(true);
    expect(isShipToEmpty({ country: "US" })).toBe(true);
    expect(isShipToEmpty({ city: "Reno" })).toBe(false);
  });
});

describe("parseUsAddress", () => {
  it("parses 'street, city, ST zip'", () => {
    expect(parseUsAddress("100 Liberty St, Reno, NV 89501")).toEqual({
      street: "100 Liberty St", city: "Reno", state: "NV", zip: "89501", country: "US",
    });
  });
  it("parses without the city comma (street city ST zip)", () => {
    expect(parseUsAddress("100 Liberty St Reno NV 89501")).toEqual({
      street: "100 Liberty St Reno", city: "", state: "NV", zip: "89501", country: "US",
    });
  });
  it("handles ZIP+4", () => {
    expect(parseUsAddress("1 A St, Austin, TX 78701-1234").zip).toBe("78701-1234");
  });
  it("returns null when there's no confident state+zip (never guesses)", () => {
    expect(parseUsAddress("1485 Skyline Blvd")).toBeNull();
    expect(parseUsAddress("")).toBeNull();
    expect(parseUsAddress(null)).toBeNull();
  });
});
