import { assetCreateSchema } from "@/validators/schemas";
import type { Asset } from "@/types/api";
import type { z } from "zod";

export const ASSET_CSV_HEADERS = [
  "name",
  "assetType",
  "hostname",
  "ipAddress",
  "operatingSystem",
  "environment",
  "location",
  "ownerId",
  "description",
  "status",
] as const;

export const MAX_ASSET_IMPORT_ROWS = 500;

export type AssetCreateInput = z.infer<typeof assetCreateSchema>;

export interface AssetCsvRow {
  rowNumber: number;
  payload: AssetCreateInput;
}

export interface AssetCsvError {
  rowNumber: number;
  message: string;
}

export interface AssetCsvImport {
  rows: AssetCsvRow[];
  errors: AssetCsvError[];
}

const formulaStart = /^'*[\u0000-\u0020]*[=+\-@]/;
const escapedFormulaStart = /^'+[\u0000-\u0020]*[=+\-@]/;

function encodeCell(value: string | null): string {
  const text = value ?? "";
  const safeText = formulaStart.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function decodeCell(value: string): string {
  return escapedFormulaStart.test(value) ? value.slice(1) : value;
}

export function assetsToCsv(assets: Asset[]): string {
  const records = assets.map((asset) => ({
    name: asset.name,
    assetType: asset.assetType,
    hostname: asset.hostname,
    ipAddress: asset.ipAddress,
    operatingSystem: asset.operatingSystem,
    environment: asset.environment,
    location: asset.location,
    ownerId: asset.ownerId,
    description: asset.description,
    status: asset.status,
  }));
  const header = ASSET_CSV_HEADERS.map(encodeCell).join(",");
  const rows = records.map((record) =>
    ASSET_CSV_HEADERS.map((key) => encodeCell(record[key])).join(","),
  );
  return [header, ...rows].join("\r\n");
}

function parseCsvRecords(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  if (!input.trim()) throw new Error("The CSV file is empty.");

  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;
  let line = 1;

  const finishRecord = () => {
    record.push(cell);
    records.push(record);
    record = [];
    cell = "";
    closedQuote = false;
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else if (char === "\r" || char === "\n") {
        cell += "\n";
        if (char === "\r" && input[i + 1] === "\n") i += 1;
        line += 1;
      } else {
        cell += char;
      }
      continue;
    }

    if (closedQuote) {
      if (char === ",") {
        record.push(cell);
        cell = "";
        closedQuote = false;
      } else if (char === "\r" || char === "\n") {
        finishRecord();
        if (char === "\r" && input[i + 1] === "\n") i += 1;
        line += 1;
      } else if (/\s/.test(char)) {
        continue;
      } else {
        throw new Error(`Unexpected character after a quoted field on CSV line ${line}.`);
      }
    } else if (char === '"') {
      if (cell.length > 0) throw new Error(`Unexpected quote in an unquoted field on CSV line ${line}.`);
      quoted = true;
    } else if (char === ",") {
      record.push(cell);
      cell = "";
    } else if (char === "\r" || char === "\n") {
      finishRecord();
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      line += 1;
    } else {
      cell += char;
    }
  }

  if (quoted) throw new Error(`Unclosed quoted field on CSV line ${line}.`);
  if (cell.length > 0 || record.length > 0 || closedQuote) finishRecord();
  return records;
}

export function parseAssetsCsv(text: string): AssetCsvImport {
  const records = parseCsvRecords(text);
  const headers = records[0]!.map((header) => header.trim().toLowerCase());
  if (headers.some((header) => !header)) throw new Error("The CSV header contains an empty column name.");
  if (new Set(headers).size !== headers.length) throw new Error("The CSV contains duplicate column names.");

  const knownHeaders = new Set<string>(ASSET_CSV_HEADERS.map((header) => header.toLowerCase()));
  const unknownHeaders = headers.filter((header) => !knownHeaders.has(header));
  if (unknownHeaders.length > 0) throw new Error(`Unsupported CSV column: ${unknownHeaders.join(", ")}.`);

  const requiredHeaders = ["name", "assettype", "environment"];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) throw new Error(`Missing required CSV columns: ${missingHeaders.join(", ")}.`);

  const headerIndexes = new Map(headers.map((header, index) => [header, index]));
  const dataRecords = records
    .slice(1)
    .map((values, index) => ({ values, rowNumber: index + 2 }))
    .filter(({ values }) => values.some((value) => value.trim() !== ""));
  if (dataRecords.length > MAX_ASSET_IMPORT_ROWS) {
    throw new Error(`The CSV has more than ${MAX_ASSET_IMPORT_ROWS} asset rows. Split it into smaller files.`);
  }
  if (dataRecords.length === 0) throw new Error("The CSV contains no asset rows.");

  const rows: AssetCsvRow[] = [];
  const errors: AssetCsvError[] = [];

  for (const { values, rowNumber } of dataRecords) {
    if (values.length !== headers.length) {
      errors.push({ rowNumber, message: `Expected ${headers.length} columns but found ${values.length}.` });
      continue;
    }
    const get = (header: string) => {
      const index = headerIndexes.get(header);
      return index === undefined ? "" : decodeCell(values[index]!).trim();
    };
    const result = assetCreateSchema.safeParse({
      name: get("name"),
      assetType: get("assettype"),
      hostname: get("hostname") || null,
      ipAddress: get("ipaddress") || null,
      operatingSystem: get("operatingsystem") || null,
      environment: get("environment"),
      location: get("location") || null,
      ownerId: get("ownerid") || null,
      description: get("description") || null,
      status: get("status") || "unknown",
    });
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path.map(String).join(".");
      errors.push({
        rowNumber,
        message: issue ? `${path ? `${path}: ` : ""}${issue.message}` : "Invalid asset data.",
      });
      continue;
    }
    rows.push({ rowNumber, payload: result.data });
  }

  return { rows, errors };
}
