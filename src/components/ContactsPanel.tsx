import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { X, Trash2, UserPlus, Smartphone, StickyNote, Users } from "lucide-react";
import {
  getContacts, addContact, deleteContact, onContactsChange,
  canImportFromDevice, importFromDevice, Contact,
} from "../services/contactsService";
import { getNotes, deleteNote } from "../services/tools";
import { DeviceControl, isNativeApp } from "../native/deviceControl";
import { setDeviceContacts, getDeviceContactCount } from "../services/contactsService";

export default function ContactsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"contacts" | "notes">("contacts");
  const [contacts, setContacts] = useState<Contact[]>(getContacts);
  const [notes, setNotes] = useState(getNotes);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const off = onContactsChange(() => setContacts(getContacts()));
    return () => { off(); };
  }, []);

  const add = () => {
    if (!name.trim() || phone.replace(/\D/g, "").length < 7) {
      setStatus("Enter a name and a valid phone number.");
      return;
    }
    addContact(name, phone);
    setName("");
    setPhone("");
    setStatus("");
  };

  const importPhone = async () => {
    if (isNativeApp()) {
      try {
        const r = await DeviceControl.getContacts();
        setDeviceContacts(r.contacts);
        setStatus(`Synced ${r.contacts.length} phone contacts.`);
      } catch {
        setStatus("Contacts permission is needed. Allow it in Setup.");
      }
      return;
    }
    try {
      const n = await importFromDevice();
      setStatus(n ? `Imported ${n} contact${n > 1 ? "s" : ""}.` : "No contacts selected.");
    } catch {
      setStatus("Import was cancelled or blocked.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-md" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[85dvh] flex flex-col bg-[#0d0d12] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex gap-1 bg-white/5 rounded-xl p-1">
            <button onClick={() => setTab("contacts")} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${tab === "contacts" ? "bg-white/15" : "text-white/60"}`}>
              <Users size={15} /> Contacts
            </button>
            <button onClick={() => { setNotes(getNotes()); setTab("notes"); }} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${tab === "notes" ? "bg-white/15" : "text-white/60"}`}>
              <StickyNote size={15} /> Notes
            </button>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10" aria-label="Close"><X size={18} /></button>
        </div>

        {tab === "contacts" ? (
          <>
            <div className="px-5 pb-3 space-y-2">
              <p className="text-xs text-white/50 leading-relaxed">
                Saved names can be used by voice, like “Mummy ko call karo” or “Rahul ko WhatsApp pe bolo main late hoon”.
              </p>
              {isNativeApp() && getDeviceContactCount() > 0 && (
                <p className="text-xs text-emerald-300/90">{getDeviceContactCount()} phone contacts are available by voice.</p>
              )}
              {(canImportFromDevice() || isNativeApp()) && (
                <button onClick={importPhone} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-500/20 border border-violet-400/30 text-violet-200 text-sm hover:bg-violet-500/30">
                  <Smartphone size={16} /> {isNativeApp() ? "Sync phone contacts" : "Import from phone contacts"}
                </button>
              )}
              <div className="flex gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Mummy)" className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400" />
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" inputMode="tel" className="w-32 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400" />
                <button onClick={add} className="p-2.5 rounded-xl bg-white text-black hover:bg-white/90" aria-label="Add contact"><UserPlus size={16} /></button>
              </div>
              {status && <p className="text-xs text-amber-300/90">{status}</p>}
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-1">
              {contacts.length === 0 && <p className="text-sm text-white/40 py-6 text-center">No contacts yet. Add one above, or just ask by voice to save a number.</p>}
              {contacts.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b border-white/5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="text-xs text-white/50">{c.phone}</p>
                  </div>
                  <button onClick={() => deleteContact(c.id)} className="p-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10" aria-label={`Delete ${c.name}`}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-1">
            {notes.length === 0 && <p className="text-sm text-white/40 py-6 text-center">No notes yet. Say “yeh yaad rakhna…” to save one.</p>}
            {notes.map((n) => (
              <div key={n.id} className="flex items-start justify-between gap-2 py-2 border-b border-white/5">
                <div>
                  <p className="text-sm">{n.text}</p>
                  <p className="text-xs text-white/40">{new Date(n.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                </div>
                <button onClick={() => { deleteNote(n.id); setNotes(getNotes()); }} className="p-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10" aria-label="Delete note"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
