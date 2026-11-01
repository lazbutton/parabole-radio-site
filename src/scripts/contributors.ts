// ---------- LE BOUTON CONTRIBUTEURS (textes et lien par défaut dans settings.ts) ----------
// Ses textes se relaient toutes les 1,5 s. Son lien est celui de settings.ts, ou celui que le staff a mis pour son seul
// navigateur.
import { DEFAULT_SUBTITLE_URL, phrases } from "./settings";
import { showToast } from "./util";

const rotatingLink = document.getElementById("rotatingTextLink") as HTMLAnchorElement | null;
let phraseIdx = 0;

// Ajoute https:// s'il manque, pour que « forms.gle/abc » ne devienne pas un lien relatif cassé.
function normalizeUrl(u: string | null | undefined) {
  u = (u || "").trim();
  if (!u || /REPLACE_WITH/i.test(u)) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}
function savedUrl() {
  try {
    return localStorage.getItem("vibetune_subtitle_url"); // nom hérité, gardé pour ne pas perdre le lien du staff
  } catch (e) {
    return null;
  }
}

let subtitleUrl = normalizeUrl(savedUrl() || DEFAULT_SUBTITLE_URL);
export const getSubtitleUrl = () => subtitleUrl;

function showLink(url: string) {
  if (!rotatingLink) return;
  if (url) {
    rotatingLink.href = url;
    rotatingLink.style.cursor = "pointer";
  } else {
    rotatingLink.removeAttribute("href");
    rotatingLink.style.cursor = "default";
  }
}

if (rotatingLink) {
  showLink(subtitleUrl);
  setInterval(() => {
    phraseIdx = (phraseIdx + 1) % phrases.length;
    rotatingLink.style.opacity = "0";
    setTimeout(() => {
      rotatingLink.innerText = phrases[phraseIdx];
      rotatingLink.style.opacity = "1";
    }, 150);
  }, 1500);
  rotatingLink.style.transition = "opacity 0.15s";
}

export function setSubtitleUrl(url: string) {
  url = normalizeUrl(url);
  subtitleUrl = url;
  showLink(url);
  try {
    localStorage.setItem("vibetune_subtitle_url", url);
  } catch (e) {}
  showToast("SUBTITLE URL", url ? `Now linking to ${url}` : "Link removed", "default");
}
