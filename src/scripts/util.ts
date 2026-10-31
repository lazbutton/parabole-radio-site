// Petits outils communs aux panneaux et au mode staff.

/** Le texte venu de la station est toujours échappé avant d'entrer dans la page. */
export const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function fetchJson<T = any>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(url + " → HTTP " + r.status);
  return r.json();
}

export const withQuery = (url: string, query: string) => url + (url.includes("?") ? "&" : "?") + query;

/** Ordinateur : une souris ou un pavé tactile (les fenêtres se déplacent, le son peut être analysé). */
export const finePointer = () => !!window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** Un message en bas à droite, quelques secondes (mode staff). */
export function showToast(title: string, desc: string, variant: "default" | "destructive") {
  const c = document.getElementById("toastContainer");
  if (!c) return;
  const el = document.createElement("div");
  el.className = `toast-message bg-white border-l-4 ${variant === "destructive" ? "border-red-600" : "border-[#fff039]"} shadow-lg rounded-r-md px-4 py-2 max-w-xs w-full text-[#000dff] font-black text-xs uppercase flex flex-col gap-0.5`;
  el.innerHTML = `<div class="font-bold text-sm">${escapeHtml(title)}</div><div class="text-[10px] opacity-80">${escapeHtml(desc)}</div>`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateX(100%)";
    setTimeout(() => el.remove(), 300);
  }, 2800);
}
