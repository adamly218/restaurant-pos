import { customAlphabet, nanoid } from 'nanoid';
import { getPosStoreDatabase } from './db.ts';
import {
  POS_SCHEMA_VERSION,
  POS_SYNC_PROTOCOL_VERSION,
  type TerminalIdentity,
} from './types.ts';

function createId(): string {
  // nanoid works in non-secure contexts; crypto.randomUUID does not (HTTP LAN/Docker).
  return nanoid();
}

/** Local FOH label until the gateway assigns `invoice_number`. Not written to Surreal. */
const LOCAL_INVOICE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOCAL_INVOICE_CODE_LENGTH = 6;
const generateLocalInvoiceCode = customAlphabet(
  LOCAL_INVOICE_ALPHABET,
  LOCAL_INVOICE_CODE_LENGTH,
);

export function nextLocalInvoiceCode(): string {
  return generateLocalInvoiceCode();
}

export function createTerminalId(): string {
  return `terminal-${createId()}`;
}

export async function ensureTerminalIdentity(): Promise<TerminalIdentity> {
  const db = getPosStoreDatabase();
  const existing = await db.identity.get('singleton');
  if (existing) {
    return {
      terminalId: existing.terminalId,
      installationId: existing.installationId,
      nextSequence: existing.nextSequence,
      schemaVersion: existing.schemaVersion,
      protocolVersion: existing.protocolVersion,
    };
  }

  const identity: TerminalIdentity & { id: 'singleton' } = {
    id: 'singleton',
    terminalId: createTerminalId(),
    installationId: createTerminalId(),
    nextSequence: 1,
    schemaVersion: POS_SCHEMA_VERSION,
    protocolVersion: POS_SYNC_PROTOCOL_VERSION,
  };
  await db.identity.put(identity);
  return identity;
}

export async function nextOperationIdentity(): Promise<{
  terminalId: string;
  sequence: number;
  operationId: string;
}> {
  const db = getPosStoreDatabase();
  return db.transaction('rw', db.identity, async () => {
    const row = await db.identity.get('singleton');
    if (!row) {
      throw new Error('Terminal identity is not initialized');
    }
    const sequence = row.nextSequence;
    await db.identity.update('singleton', { nextSequence: sequence + 1 });
    return {
      terminalId: row.terminalId,
      sequence,
      operationId: `${row.terminalId}:${sequence}`,
    };
  });
}

export function recordId(table: string, id?: string): string {
  const raw = id ?? `r${createId().replace(/-/g, '')}`;
  return raw.includes(':') ? raw : `${table}:${raw}`;
}
