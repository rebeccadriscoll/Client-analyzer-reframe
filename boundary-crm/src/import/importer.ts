import type { ParsedTable } from "./csv";
import { parseCsv } from "./csv";

/**
 * An Importer turns some raw source into a table of headers + rows. Phase 0
 * ships only the spreadsheet adapter, but platform connectors (QBO, TaxDome,
 * etc.) implement the same interface later so the rest of the import pipeline
 * (mapping, tiering, writing clients) does not change.
 */
export interface Importer {
  /** Stable id, e.g. "spreadsheet", "qbo". */
  readonly id: string;
  /** Human label for the UI. */
  readonly label: string;
  /** Produce a table from this importer's raw input. */
  parse(input: string): ParsedTable;
}

export class SpreadsheetImporter implements Importer {
  readonly id = "spreadsheet";
  readonly label = "Spreadsheet / CSV";

  parse(input: string): ParsedTable {
    return parseCsv(input);
  }
}

/** Registry of available importers. Add connectors here in later phases. */
export const IMPORTERS: Record<string, Importer> = {
  spreadsheet: new SpreadsheetImporter(),
};

export function getImporter(id: string): Importer | null {
  return IMPORTERS[id] ?? null;
}
