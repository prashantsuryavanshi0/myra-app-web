import { DEFAULT_COUNTRY_CODE } from "../config";
import { loadJSON, saveJSON } from "./storage";

export interface Contact {
  id: string;
  name: string;
  phone: string;
}

const KEY = "assistant_contacts";
const listeners = new Set<() => void>();

/** App me manually save kiye contacts */
export function getContacts(): Contact[] {
  return loadJSON<Contact[]>(KEY, []);
}

// Android app: phone ke saare contacts (memory me, har launch pe sync)
let deviceContacts: Contact[] = [];
export function setDeviceContacts(list: { name: string; phone: string }[]) {
  deviceContacts = list.map((c, i) => ({ id: `device-${i}`, name: c.name, phone: c.phone }));
  listeners.forEach((fn) => fn());
}
export function getDeviceContactCount() {
  return deviceContacts.length;
}
function allContacts(): Contact[] {
  const own = getContacts();
  const ownNames = new Set(own.map((c) => c.name.toLowerCase()));
  return [...own, ...deviceContacts.filter((c) => !ownNames.has(c.name.toLowerCase()))];
}

function setContacts(list: Contact[]) {
  saveJSON(KEY, list);
  listeners.forEach((fn) => fn());
}

export function onContactsChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function addContact(name: string, phone: string): Contact {
  const list = getContacts();
  const cleanName = name.trim();
  const existing = list.find((c) => c.name.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    existing.phone = phone.trim();
    setContacts(list);
    return existing;
  }
  const contact = { id: crypto.randomUUID(), name: cleanName, phone: phone.trim() };
  setContacts([...list, contact]);
  return contact;
}

export function addManyContacts(items: { name: string; phone: string }[]) {
  const list = getContacts();
  for (const item of items) {
    if (!item.name || !item.phone) continue;
    const found = list.find((c) => c.name.toLowerCase() === item.name.toLowerCase());
    if (found) found.phone = item.phone;
    else list.push({ id: crypto.randomUUID(), name: item.name.trim(), phone: item.phone.trim() });
  }
  setContacts(list);
}

export function deleteContact(id: string) {
  setContacts(getContacts().filter((c) => c.id !== id));
}

// ─── Phone number helpers ───────────────────────────────────────────────
export function looksLikeNumber(s: string) {
  return /^\+?[\d\s\-()]{7,}$/.test(s.trim());
}

export function cleanDialNumber(s: string) {
  return s.replace(/[^\d+]/g, "");
}

/** WhatsApp ko country code ke saath sirf digits chahiye (bina + ke) */
export function toWhatsAppNumber(s: string) {
  let d = s.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = DEFAULT_COUNTRY_CODE + d;
  return d;
}

// ─── Name matching (Hinglish friendly) ──────────────────────────────────
const FILLER = /\b(ji|sir|madam|mam|ko|se|ka|ki|ke|wala|wali|mera|meri|my)\b/g;

function norm(s: string) {
  const base = s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ");
  const stripped = base.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  return stripped || base.replace(/\s+/g, " ").trim();
}

export type ResolveResult =
  | { kind: "number"; phone: string; name: string }
  | { kind: "found"; contact: Contact }
  | { kind: "ambiguous"; options: Contact[] }
  | { kind: "not_found" };

export function resolveContact(input: string): ResolveResult {
  if (!input?.trim()) return { kind: "not_found" };
  if (looksLikeNumber(input)) return { kind: "number", phone: input.trim(), name: input.trim() };

  const q = norm(input);
  const scored = allContacts()
    .map((c) => {
      const n = norm(c.name);
      let score = 0;
      if (n === q) score = 100;
      else if (n.startsWith(q) || q.startsWith(n)) score = 80;
      else if (n.includes(q) || q.includes(n)) score = 60;
      else {
        const qt = q.split(" ");
        const overlap = n.split(" ").filter((t) => qt.includes(t)).length;
        if (overlap) score = 30 + overlap * 10;
      }
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { kind: "not_found" };
  const top = scored.filter((x) => x.score === scored[0].score);
  if (top.length > 1) return { kind: "ambiguous", options: top.map((x) => x.c) };
  return { kind: "found", contact: top[0].c };
}

// ─── Phone se contacts import (sirf Android Chrome pe chalta hai) ────────
export function canImportFromDevice() {
  return typeof navigator !== "undefined" && "contacts" in navigator && "ContactsManager" in window;
}

export async function importFromDevice(): Promise<number> {
  const picked = await (navigator as any).contacts.select(["name", "tel"], { multiple: true });
  const items: { name: string; phone: string }[] = [];
  for (const p of picked) {
    const name = p.name?.[0];
    const phone = p.tel?.[0];
    if (name && phone) items.push({ name, phone });
  }
  addManyContacts(items);
  return items.length;
}
