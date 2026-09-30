import { loadJSON, saveJSON } from "./storage";

/** Myra ki yaaddasht: user ke baare me facts, har session me yaad rahenge */
export interface Memory {
  id: string;
  text: string;
  at: number;
}

const KEY = "myra_memories";
const MAX = 80;
const listeners = new Set<() => void>();

export function getMemories(): Memory[] {
  return loadJSON<Memory[]>(KEY, []);
}

function save(list: Memory[]) {
  saveJSON(KEY, list.slice(-MAX));
  listeners.forEach((fn) => fn());
}

export function onMemoriesChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function remember(text: string) {
  const clean = text.trim();
  if (!clean) return;
  const list = getMemories().filter((m) => m.text.toLowerCase() !== clean.toLowerCase());
  save([...list, { id: crypto.randomUUID(), text: clean, at: Date.now() }]);
}

/** Keyword se match karke bhoolo. Kitne bhoole, wo return karta hai. */
export function forget(keyword: string): number {
  const k = keyword.toLowerCase().trim();
  const list = getMemories();
  const keep = list.filter((m) => !m.text.toLowerCase().includes(k));
  save(keep);
  return list.length - keep.length;
}

export function deleteMemory(id: string) {
  save(getMemories().filter((m) => m.id !== id));
}
