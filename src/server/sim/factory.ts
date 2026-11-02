import type { Doc, DocumentKind, Institution, Invoice, InvoiceKind, LineItem, Mail } from "@/domain/types";
import type { Store } from "../store";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function addDoc(store: Store, d: Omit<Doc, "id" | "createdAt">): Doc {
  const doc: Doc = { ...d, id: store.nextId("doc"), createdAt: store.world.now };
  store.mutate((w) => {
    w.docs[doc.id] = doc;
  });
  return doc;
}

export function hoursFrom(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}

/** Create an invoice and the document the agent will read for it. */
export function issueInvoice(
  store: Store,
  opts: {
    caseId: string;
    institutionId: string;
    kind: InvoiceKind;
    title: string;
    lineItems: Omit<LineItem, "id">[];
    amountDue?: number;
    dueInHours?: number;
    patientRef?: string;
    patientName: string;
    extraText?: string;
    showBankDetails?: boolean;
  },
): Invoice {
  const inst = store.world.institutions[opts.institutionId];
  const id = store.nextId("inv");
  const lineItems: LineItem[] = opts.lineItems.map((li, i) => ({ ...li, id: `${id}_li${i + 1}` }));
  const total = Math.round(lineItems.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const amountDue = opts.amountDue ?? total;
  const number = `${inst.kind === "hospital" ? "SRH" : "KGU"}-${opts.kind.toUpperCase().slice(0, 3)}-${String(store.world.counters.inv).padStart(4, "0")}`;
  const dueAt = opts.dueInHours !== undefined ? hoursFrom(store.world.now, opts.dueInHours) : undefined;
  const text = renderInvoiceText(inst, {
    number,
    title: opts.title,
    patientName: opts.patientName,
    patientRef: opts.patientRef,
    lineItems,
    total,
    amountDue,
    currency: inst.bank.currency,
    issued: store.world.now,
    dueAt,
    extraText: opts.extraText,
    showBankDetails: opts.showBankDetails ?? true,
  });
  const doc = addDoc(store, {
    caseId: opts.caseId,
    kind: "invoice",
    title: `${opts.title} ${number}`,
    text,
    fields: {
      number,
      total,
      amountDue,
      currency: inst.bank.currency,
      ...(opts.patientRef ? { patientRef: opts.patientRef } : {}),
      ...(dueAt ? { dueAt } : {}),
    },
    origin: "institution",
  });
  const invoice: Invoice = {
    id,
    caseId: opts.caseId,
    institutionId: inst.id,
    kind: opts.kind,
    number,
    currency: inst.bank.currency,
    lineItems,
    total,
    amountDue,
    dueAt,
    issuedAt: store.world.now,
    documentId: doc.id,
    patientRef: opts.patientRef,
    status: "open",
  };
  store.mutate((w) => {
    w.invoices[invoice.id] = invoice;
  });
  return invoice;
}

function renderInvoiceText(
  inst: Institution,
  o: {
    number: string;
    title: string;
    patientName: string;
    patientRef?: string;
    lineItems: LineItem[];
    total: number;
    amountDue: number;
    currency: string;
    issued: string;
    dueAt?: string;
    extraText?: string;
    showBankDetails: boolean;
  },
): string {
  const lines = [
    `${inst.name.toUpperCase()}`,
    `${inst.city}, ${inst.country} · ${inst.email}`,
    ``,
    `${o.title.toUpperCase()}  No. ${o.number}`,
    `Issued: ${o.issued.slice(0, 10)}${o.dueAt ? `   Due: ${o.dueAt.slice(0, 16).replace("T", " ")} UTC` : ""}`,
    `${inst.kind === "hospital" ? "Patient" : "Student"}: ${o.patientName}${o.patientRef ? `   ${inst.kind === "hospital" ? "HN" : "Student ID"}: ${o.patientRef}` : ""}`,
    ``,
    ...o.lineItems.map((l) => `${(l.date ?? "").padEnd(11)} ${l.description.padEnd(48)} ${o.currency} ${fmt(l.amount)}`),
    ``,
    `TOTAL ${o.currency} ${fmt(o.total)}`,
    o.amountDue !== o.total ? `AMOUNT REQUESTED NOW ${o.currency} ${fmt(o.amountDue)}` : "",
  ];
  if (o.showBankDetails) {
    lines.push(
      ``,
      `Payment by bank transfer:`,
      `  Bank: ${inst.bank.bankName}`,
      `  Account name: ${inst.bank.accountName}`,
      `  Account number: ${inst.bank.accountNumber}`,
      `  SWIFT: ${inst.bank.swift}`,
    );
    if (inst.acceptsCards) lines.push(`Card payments accepted at the cashier or via our secure payment link.`);
  }
  if (o.extraText) lines.push(``, o.extraText);
  return lines.filter((l) => l !== undefined).join("\n");
}

export function sendMail(store: Store, m: Omit<Mail, "id" | "at" | "read"> & { read?: boolean }): Mail {
  const mail: Mail = { ...m, id: store.nextId("mail"), at: store.world.now, read: m.read ?? false };
  store.mutate((w) => {
    w.mail[mail.id] = mail;
  });
  return mail;
}

export function docKindLabel(kind: DocumentKind): string {
  return {
    invoice: "Invoice",
    bank_letter: "Bank confirmation letter",
    remittance_application: "Remittance application",
    self_declaration: "Self-declaration",
    fx_purchase_application: "FX purchase application",
    admission_letter: "Admission letter",
    receipt: "Receipt",
    other: "Document",
  }[kind];
}
