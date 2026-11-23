import { describe, expect, it } from "vitest";
import { assetsToCsv, MAX_ASSET_IMPORT_ROWS, parseAssetsCsv } from "@/lib/assets-csv";
import type { Asset } from "@/types/api";

const headers = "name,assetType,environment";

describe("asset CSV import and export", () => {
  it("parses quoted commas, escaped quotes, and embedded newlines", () => {
    const result = parseAssetsCsv(
      `${headers}\r\n"edge, router",network_device,production\r\n"app ""blue""\nnode",application,testing`,
    );

    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.payload.name)).toEqual(["edge, router", 'app "blue"\nnode']);
  });

  it("reports row validation and column-count errors without hiding valid rows", () => {
    const result = parseAssetsCsv(
      `${headers}\r\nvalid,virtual_machine,development\r\n,other,testing\r\nextra,other,production,unexpected`,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.errors.map((error) => error.rowNumber)).toEqual([3, 4]);
  });

  it("rejects malformed, unsupported, or oversized CSV input", () => {
    expect(() => parseAssetsCsv("name,name,environment\nx,y,production")).toThrow(/duplicate/);
    expect(() => parseAssetsCsv("name,assetType,environment,unknown\nx,other,production,x")).toThrow(/Unsupported/);

    const rows = Array.from({ length: MAX_ASSET_IMPORT_ROWS + 1 }, (_, index) => `asset-${index},other,production`).join("\n");
    expect(() => parseAssetsCsv(`${headers}\n${rows}`)).toThrow(/more than/);
  });

  it("round-trips asset fields and protects spreadsheet formula values", () => {
    const asset: Asset = {
      id: "asset-id",
      name: '=HYPERLINK("https://example.test")',
      assetType: "application",
      hostname: null,
      ipAddress: null,
      operatingSystem: null,
      environment: "production",
      location: "Primary, rack 4",
      ownerId: null,
      ownerName: null,
      description: "Line one\nLine two",
      status: "unknown",
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const csv = assetsToCsv([asset]);
    expect(csv).toContain("'=HYPERLINK");
    const result = parseAssetsCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.payload).toMatchObject({
      name: asset.name,
      location: asset.location,
      description: asset.description,
      status: asset.status,
    });
  });
});
