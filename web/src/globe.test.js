import { describe, it, expect } from "vitest";
import { buildColors } from "./globe.js";

describe("buildColors", () => {
  const points = { n: 2, flags: Uint8Array.from([0, 0]),
    lon: Float32Array.from([-57.5, -55.0]), lat: Float32Array.from([-18.5, -18.5]) };
  const show = { modis: true, viirs: true, ghostOnly: false };
  it("keeps alpha without an area and dims outside one", () => {
    const plain = buildColors(points, show, "modis");
    expect([plain[3], plain[7]]).toEqual([255, 255]);
    const dim = buildColors(points, show, "modis", [-58, -19, -57, -18]);
    expect([dim[3], dim[7]]).toEqual([255, 64]);
  });
});
