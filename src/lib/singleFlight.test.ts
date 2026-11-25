import { describe, expect, it } from "vitest";
import { createSingleFlight } from "./singleFlight";

describe("createSingleFlight", () => {
  it("drops a call made while one is in flight", async () => {
    const flight = createSingleFlight();
    let release!: () => void;
    let runs = 0;
    const first = flight.run(async () => {
      runs++;
      await new Promise<void>((r) => (release = r));
    });
    expect(flight.running).toBe(true);
    expect(await flight.run(async () => { runs++; })).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(runs).toBe(1);
    expect(flight.running).toBe(false);
  });

  it("allows a new run after the previous one finished or threw", async () => {
    const flight = createSingleFlight();
    await expect(flight.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(flight.running).toBe(false);
    expect(await flight.run(async () => {})).toBe(true);
  });
});
