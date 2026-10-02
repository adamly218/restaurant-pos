import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowsRotate, faCopy, faPrint, faUpRightFromSquare } from "@fortawesome/free-solid-svg-icons";
import { Button } from "@/components/common/input/button.tsx";
import { Input } from "@/components/common/input/input.tsx";
import { Switch } from "@/components/common/input/switch.tsx";
import { Checkbox } from "@/components/common/input/checkbox.tsx";
import { ReactSelect } from "@/components/common/input/custom.react.select.tsx";
import { DeleteConfirm } from "@/components/common/table/delete.confirm.tsx";
import { getAppTimezone } from "@/lib/datetime.ts";
import { getGatewayBaseUrl } from "@/lib/session.ts";
import {
  SelfOrderConfig,
  SelfOrderSettings,
  SelfOrderTable,
  selfOrderAdmin,
  selfOrderLink,
} from "@/lib/self-order.service.ts";

type Option = { label: string; value: string };

const ONLINE_GATEWAYS = ["stripe", "paypal"];

const isLocalHost = (url: string) => /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);

const tableTitle = (table: SelfOrderTable) => `Table ${table.number || table.name}`;

/** Where phones should open the menu: this page's origin, or — when opened as
 *  localhost — the LAN host the gateway is configured on, with this port. */
function defaultBaseUrl(): string {
  const origin = window.location.origin;
  if (!isLocalHost(origin)) return origin;
  try {
    const gateway = new URL(getGatewayBaseUrl());
    if (!isLocalHost(gateway.origin)) {
      return `${window.location.protocol}//${gateway.hostname}${window.location.port ? `:${window.location.port}` : ""}`;
    }
  } catch {
    /* fall through */
  }
  return origin;
}

/**
 * Manage → QR Ordering: settings for customer self-ordering plus a printable
 * QR code for every table. Customers scan it, order, pay, and the paid order
 * goes straight to the POS / kitchen.
 */
export const AdminSelfOrder = () => {
  const [config, setConfig] = useState<SelfOrderConfig | null>(null);
  const [draft, setDraft] = useState<SelfOrderSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const qrRefs = useRef(new Map<string, HTMLDivElement>());

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await selfOrderAdmin.config();
      setConfig(next);
      setDraft({
        ...next.settings,
        baseUrl: next.settings.baseUrl || defaultBaseUrl(),
        currency: (import.meta.env.VITE_CURRENCY as string) || next.settings.currency,
        timezone: getAppTimezone(),
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const floors = useMemo(() => {
    const groups = new Map<string, SelfOrderTable[]>();
    for (const table of config?.tables ?? []) {
      const key = table.floorName || "Other";
      groups.set(key, [...(groups.get(key) ?? []), table]);
    }
    return [...groups.entries()];
  }, [config?.tables]);

  if (loadError) {
    return (
      <div className="p-5">
        <p className="text-danger">Could not load QR ordering: {loadError}</p>
        <Button className="mt-3" variant="primary" onClick={() => void load()}>Try again</Button>
      </div>
    );
  }
  if (!config || !draft) return <div className="p-5">Loading…</div>;

  const set = <K extends keyof SelfOrderSettings>(key: K, value: SelfOrderSettings[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const onlineTypes = config.paymentTypes.filter((pt) => pt.gateway && ONLINE_GATEWAYS.includes(pt.gateway));
  const toOption = (item: { id: string; name: string }): Option => ({ label: item.name, value: item.id });
  const hiddenIds = draft.hiddenCategoryIds ?? config.defaultHiddenCategoryIds;
  const paymentReady = draft.paymentTypeIds.length > 0 || draft.testMode;

  const save = async () => {
    setSaving(true);
    try {
      const { settings } = await selfOrderAdmin.saveSettings(draft);
      setConfig({ ...config, settings });
      toast.success("QR ordering settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateTable = async (table: SelfOrderTable, body: { regenerate?: boolean; enabled?: boolean }) => {
    try {
      const { table: updated } = await selfOrderAdmin.updateTable(table.id, body);
      setConfig((prev) => prev && { ...prev, tables: prev.tables.map((t) => (t.id === updated.id ? updated : t)) });
      toast.success(body.regenerate ? "New QR code created — print it again" : updated.enabled ? "QR code turned on" : "QR code turned off");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const printCodes = (tables: SelfOrderTable[]) => {
    const cards = tables
      .map((table) => {
        const svg = qrRefs.current.get(table.id)?.querySelector("svg")?.outerHTML ?? "";
        return `<div class="card">
          <div class="name">${escapeHtml(draft.restaurantName || "Scan to order")}</div>
          <div class="qr">${svg}</div>
          <div class="table">${escapeHtml(tableTitle(table))}</div>
          <div class="floor">${escapeHtml(table.floorName)}</div>
          <div class="hint">Scan with your phone camera to see the menu, order and pay.</div>
        </div>`;
      })
      .join("");
    const win = window.open("", "_blank", "width=900,height=1000");
    if (!win) {
      toast.error("Allow pop-ups to print the QR codes");
      return;
    }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Table QR codes</title>
      <style>
        @page { size: A4; margin: 12mm; }
        body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; color: #111; }
        .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10mm; }
        .card { border: 1.5px dashed #999; border-radius: 6mm; padding: 8mm 6mm; text-align: center; break-inside: avoid; }
        .name { font-size: 16pt; font-weight: 700; }
        .qr { margin: 6mm auto; width: 55mm; height: 55mm; }
        .qr svg { width: 100%; height: 100%; }
        .table { font-size: 22pt; font-weight: 800; }
        .floor { font-size: 11pt; color: #555; }
        .hint { margin-top: 4mm; font-size: 10pt; color: #333; }
      </style></head><body><div class="grid">${cards}</div>
      <script>window.onload = function () { window.focus(); window.print(); };<\/script></body></html>`);
    win.document.close();
  };

  const selectedTables = (config.tables ?? []).filter((t) => selected.has(t.id));

  return (
    <div className="flex flex-col gap-6 p-5">
      <section className="flex flex-col gap-4 rounded-2xl border border-border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">QR table ordering</h2>
            <p className="text-sm text-muted">
              Customers scan the code on their table, order from the menu and pay online. Paid orders go straight to the kitchen screen.
            </p>
          </div>
          <Switch checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)}>
            {draft.enabled ? "On" : "Off"}
          </Switch>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <Input label="Restaurant name (shown on the menu)" value={draft.restaurantName} onChange={(e) => set("restaurantName", e.target.value)} />
          </div>
          <div>
            <Input label="Welcome message" value={draft.welcomeText} placeholder="Order and pay right here — we’ll bring it to your table." onChange={(e) => set("welcomeText", e.target.value)} />
          </div>

          <div>
            <label className="mb-1 block">Order type for QR orders</label>
            <ReactSelect
              value={config.orderTypes.map(toOption).find((o) => o.value === draft.orderTypeId) ?? null}
              options={config.orderTypes.map(toOption)}
              onChange={(opt: Option | null) => set("orderTypeId", opt?.value ?? null)}
            />
          </div>
          <div>
            <label className="mb-1 block">Tax added to items without their own tax (optional)</label>
            <ReactSelect
              isClearable
              value={config.taxes.map((t) => ({ label: `${t.name} ${t.rate}%`, value: t.id })).find((o) => o.value === draft.orderTaxId) ?? null}
              options={config.taxes.map((t) => ({ label: `${t.name} ${t.rate}%`, value: t.id }))}
              onChange={(opt: Option | null) => set("orderTaxId", opt?.value ?? null)}
            />
          </div>

          <div>
            <label className="mb-1 block">Online payment methods</label>
            <ReactSelect
              isMulti
              value={onlineTypes.map(toOption).filter((o) => draft.paymentTypeIds.includes(o.value))}
              options={onlineTypes.map((pt) => ({ label: `${pt.name} (${pt.gateway}${pt.mode ? `, ${pt.mode}` : ""})`, value: pt.id }))}
              onChange={(opts: readonly Option[] | null) => set("paymentTypeIds", (opts ?? []).map((o) => o.value))}
              placeholder={onlineTypes.length ? "Choose Stripe / PayPal payment types" : "None set up yet"}
            />
            {onlineTypes.length === 0 && (
              <p className="mt-1 text-sm text-muted">
                To take real payments, add a payment type with the Stripe or PayPal gateway under Manage → Payment types, then pick it here.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block">Categories hidden from customers</label>
            <ReactSelect
              isMulti
              value={config.categories.map(toOption).filter((o) => hiddenIds.includes(o.value))}
              options={config.categories.map(toOption)}
              onChange={(opts: readonly Option[] | null) => set("hiddenCategoryIds", (opts ?? []).map((o) => o.value))}
            />
          </div>

          <div className="lg:col-span-2 rounded-xl border border-warning p-4">
            <Switch checked={draft.testMode} onChange={(e) => set("testMode", e.target.checked)}>
              Test payments — lets you try the whole flow without charging a card. <b>Turn this off before real customers use it.</b>
            </Switch>
            {draft.testMode && (
              <div className="mt-3 max-w-md">
                <label className="mb-1 block text-sm">Record test payments as</label>
                <ReactSelect
                  value={config.paymentTypes.map(toOption).find((o) => o.value === draft.testPaymentTypeId) ?? null}
                  options={config.paymentTypes.map(toOption)}
                  onChange={(opt: Option | null) => set("testPaymentTypeId", opt?.value ?? null)}
                />
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <Input
              label="Address customers’ phones use to reach this POS (goes inside the QR codes)"
              value={draft.baseUrl}
              onChange={(e) => set("baseUrl", e.target.value.trim())}
            />
            {isLocalHost(draft.baseUrl) && (
              <p className="mt-1 text-sm text-danger">
                “localhost” only works on this computer. Use this computer’s network address (e.g. http://192.168.x.x:5173) or your public domain so phones can open it.
              </p>
            )}
          </div>
        </div>

        {!draft.orderTypeId && <p className="text-sm text-danger">Choose an order type (e.g. Dine In) before turning QR ordering on.</p>}
        {!paymentReady && <p className="text-sm text-danger">Pick at least one online payment method (or turn on test payments) — customers must pay before the order is sent.</p>}

        <div>
          <Button variant="primary" onClick={save} isLoading={saving} disabled={saving}>Save settings</Button>
        </div>
      </section>

      {config.paidAwaitingPos.length > 0 && (
        <section className="rounded-2xl border border-danger p-5">
          <h3 className="font-bold text-danger">Paid QR orders that did not reach the POS</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {config.paidAwaitingPos.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span>{new Date(row.createdAt).toLocaleString()} — {row.total}</span>
                {row.error && <span className="text-muted">{row.error}</span>}
                <Button
                  size="sm"
                  variant="primary"
                  onClick={async () => {
                    try {
                      const res = await selfOrderAdmin.retryCheckout(row.id);
                      toast.success(`Sent to POS as order #${res.orderNumber ?? ""}`);
                      void load();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : String(err));
                    }
                  }}
                >
                  Send to POS again
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold">Table QR codes ({config.tables.length})</h3>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setSelected(selected.size === config.tables.length ? new Set() : new Set(config.tables.map((t) => t.id)))}
            >
              {selected.size === config.tables.length ? "Clear selection" : "Select all"}
            </Button>
            <Button
              variant="primary"
              icon={faPrint}
              disabled={selectedTables.length === 0}
              onClick={() => printCodes(selectedTables)}
            >
              Print {selectedTables.length || ""} QR code{selectedTables.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>

        {floors.map(([floor, tables]) => (
          <div key={floor}>
            <h4 className="mb-2 font-semibold text-muted">{floor}</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {tables.map((table) => {
                const link = selfOrderLink(draft.baseUrl, table.token);
                return (
                  <div
                    key={table.id}
                    className={`flex flex-col items-center gap-2 rounded-2xl border p-4 ${selected.has(table.id) ? "border-primary" : "border-border"} ${table.enabled ? "" : "opacity-50"}`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <Checkbox
                        checked={selected.has(table.id)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(table.id)) next.delete(table.id);
                            else next.add(table.id);
                            return next;
                          })
                        }
                      />
                      <span className="font-bold">{tableTitle(table)}</span>
                      <Switch checked={table.enabled} onChange={(e) => void updateTable(table, { enabled: e.target.checked })} />
                    </div>
                    <div
                      className="rounded-xl bg-white p-3"
                      ref={(el) => {
                        if (el) qrRefs.current.set(table.id, el);
                        else qrRefs.current.delete(table.id);
                      }}
                    >
                      <QRCode value={link} size={148} />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" icon={faCopy} onClick={() => void navigator.clipboard?.writeText(link).then(() => toast.success("Link copied"), () => toast.error("Could not copy the link"))}>
                        Copy link
                      </Button>
                      <Button size="sm" variant="secondary" icon={faUpRightFromSquare} onClick={() => window.open(link, "_blank", "noopener,noreferrer")}>
                        Open
                      </Button>
                      <DeleteConfirm
                        title="New QR code"
                        message={`Make a new QR code for ${tableTitle(table)}? The old printed code will stop working.`}
                        onConfirm={() => updateTable(table, { regenerate: true })}
                      >
                        <Button size="sm" variant="secondary" iconButton aria-label="New QR code">
                          <FontAwesomeIcon icon={faArrowsRotate} />
                        </Button>
                      </DeleteConfirm>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
