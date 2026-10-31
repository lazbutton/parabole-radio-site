// ---------- LE MODE STAFF (caché : double-clic sur le logo de la barre du haut, mot de passe dans settings.ts) ----------
// Pour un écran en studio : changer la vidéo de fond (elle ne passe qu'une fois, puis la playlist reprend), poser une
// vidéo en surimpression (opacité, taille, position), changer le lien du bouton contributeurs et le logo de la barre.
// Tout reste dans le navigateur de la personne connectée : le lien et le logo dans localStorage, la vidéo et la
// surimpression jusqu'au rechargement. Aucun autre visiteur ne voit ces changements. Le futur CMS (/admin) remplacera ce
// mode. Les clés localStorage gardent leur ancien nom (vibetune_*) : les renommer effacerait les réglages du staff.
import { getSubtitleUrl, setSubtitleUrl } from "./contributors";
import { STAFF_PASSWORD } from "./settings";
import { showToast } from "./util";

let isAdmin = false;
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- LE LOGO DE LA BARRE (transparent) ----------
const logoSquare = byId("logoSquare");
const logoUpload = byId<HTMLInputElement>("logoUploadInput");
function showLogo(src: string) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  logoSquare.innerHTML = "";
  logoSquare.appendChild(img);
  logoSquare.style.background = "transparent";
}
try {
  const savedLogo = localStorage.getItem("vibetune_logo");
  if (savedLogo) showLogo(savedLogo);
} catch (e) {}
logoSquare.addEventListener("click", (e) => {
  if (!isAdmin) return;
  e.preventDefault(); // connecté, le logo choisit une image au lieu de ramener à l'accueil
  logoUpload.click();
});
logoUpload.onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f && isAdmin && f.type.startsWith("image/")) {
    const r = new FileReader();
    r.onload = (ev) => {
      const src = String(ev.target!.result);
      showLogo(src);
      try {
        localStorage.setItem("vibetune_logo", src);
      } catch (e) {}
      showToast("LOGO", "UPDATED", "default");
    };
    r.readAsDataURL(f);
  } else if (!isAdmin) showToast("ACCESS", "ADMIN ONLY", "destructive");
  else showToast("ERROR", "IMAGE NEEDED", "destructive");
  logoUpload.value = "";
};

// ---------- LA SURIMPRESSION ----------
const overlayContainer = byId("overlayCanvasContainer");
const overlayCanvas = byId<HTMLCanvasElement>("overlayCanvas");
const ctxOverlay = overlayCanvas.getContext("2d")!;
const overlayUpload = byId<HTMLInputElement>("overlayUploadInput");
const overlayControls = byId("overlayQuickControls");
const alphaNote = byId("alphaNote");
let overlayVideo: HTMLVideoElement | null = null,
  ovAnimId: number | null = null,
  ovUrl: string | null = null,
  ovVisible = true;
const opacitySlide = byId<HTMLInputElement>("overlayOpacity");
const sizeSlide = byId<HTMLInputElement>("overlaySize");
const posXSlide = byId<HTMLInputElement>("overlayPosX");
const posYSlide = byId<HTMLInputElement>("overlayPosY");
function drawOverlay() {
  if (!overlayVideo || !ovVisible || overlayContainer.style.display === "none") return;
  if (overlayVideo.readyState >= 2) {
    const op = Number(opacitySlide.value) / 100,
      sz = Number(sizeSlide.value) / 100,
      px = Number(posXSlide.value) / 100,
      py = Number(posYSlide.value) / 100;
    const vw = overlayVideo.videoWidth,
      vh = overlayVideo.videoHeight;
    if (vw && vh) {
      let tw = window.innerWidth * sz;
      let th = tw * (vh / vw);
      if (th > window.innerHeight) {
        th = window.innerHeight * 0.8;
        tw = th * (vw / vh);
      }
      const left = (window.innerWidth - tw) * px;
      const top = (window.innerHeight - th) * py;
      overlayCanvas.width = tw;
      overlayCanvas.height = th;
      overlayCanvas.style.width = tw + "px";
      overlayCanvas.style.height = th + "px";
      overlayCanvas.style.left = left + "px";
      overlayCanvas.style.top = top + "px";
      ctxOverlay.clearRect(0, 0, tw, th);
      ctxOverlay.globalAlpha = op;
      ctxOverlay.drawImage(overlayVideo, 0, 0, tw, th);
    }
  }
  ovAnimId = requestAnimationFrame(drawOverlay);
}
function loadOverlayVideo(file: File) {
  if (!file || !file.type.startsWith("video/")) {
    showToast("INVALID", "SELECT VIDEO", "destructive");
    return;
  }
  if (ovUrl) URL.revokeObjectURL(ovUrl);
  const url = URL.createObjectURL(file);
  ovUrl = url;
  if (overlayVideo) {
    overlayVideo.pause();
    overlayVideo.src = "";
  }
  const video = (overlayVideo = document.createElement("video"));
  video.src = url;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.onloadeddata = () => {
    overlayContainer.style.display = "flex";
    ovVisible = true;
    video.play().catch(() => showToast("AUTOPLAY", "Click to start", "default"));
    if (ovAnimId) cancelAnimationFrame(ovAnimId);
    ovAnimId = requestAnimationFrame(drawOverlay);
    overlayControls.style.display = "flex";
    if (!file.type.includes("webm")) alphaNote.style.display = "block";
    else alphaNote.style.display = "none";
    showToast("OVERLAY", "LOADED", "default");
  };
  video.onerror = () => {
    showToast("ERROR", "Video format error", "destructive");
    removeOverlay();
  };
  video.load();
}
function removeOverlay() {
  if (ovAnimId) cancelAnimationFrame(ovAnimId);
  if (overlayVideo) {
    overlayVideo.pause();
    overlayVideo.src = "";
  }
  if (ovUrl) URL.revokeObjectURL(ovUrl);
  overlayContainer.style.display = "none";
  overlayControls.style.display = "none";
  alphaNote.style.display = "none";
  showToast("OVERLAY", "REMOVED", "default");
}
function toggleOverlay() {
  if (overlayContainer.style.display === "none") {
    if (overlayVideo && overlayVideo.src) {
      overlayContainer.style.display = "flex";
      ovVisible = true;
      overlayVideo.play().catch(() => {});
      if (!ovAnimId) ovAnimId = requestAnimationFrame(drawOverlay);
      showToast("OVERLAY", "SHOWN", "default");
    } else showToast("NO OVERLAY", "Upload first", "destructive");
  } else {
    overlayContainer.style.display = "none";
    ovVisible = false;
    if (ovAnimId) cancelAnimationFrame(ovAnimId);
    ovAnimId = null;
    showToast("OVERLAY", "HIDDEN", "default");
  }
}
document.getElementById("toggleOverlayBtn")?.addEventListener("click", toggleOverlay);
document.getElementById("removeOverlayBtn")?.addEventListener("click", removeOverlay);

// ---------- LES COMMANDES DU STAFF, dans la barre du haut ----------
const adminDiv = byId("adminControlsContainer");
const videoUp = byId<HTMLInputElement>("videoUploadInput"),
  bgVideo = byId<HTMLVideoElement>("backgroundVideo");

function promptAdminLogin() {
  const entry = prompt("STAFF PASSWORD:");
  if (entry === null) return; // annulé
  if (entry === STAFF_PASSWORD) {
    adminLogin();
  } else {
    showToast("ACCESS DENIED", "Wrong password", "destructive");
  }
}
function adminLogin() {
  isAdmin = true;
  renderAdmin();
  showToast("ADMIN", "Controls available", "default");
}
function adminLogout() {
  isAdmin = false;
  renderAdmin();
  showToast("SIGNED OUT", "Public view", "default");
}
function renderAdmin() {
  adminDiv.innerHTML = "";
  if (!isAdmin) return; // aucun bouton ADMIN visible : le staff se connecte d'un double-clic sur le logo
  const button = (html: string, onclick: () => void) => {
    const b = document.createElement("button");
    b.className = "h-8 px-2 bg-white text-[#000dff] font-black text-[9px] uppercase rounded-none flex items-center gap-1";
    b.innerHTML = html;
    b.onclick = onclick;
    return b;
  };
  const vidBtn = button('<svg class="icon" aria-hidden="true"><use href="#icon-video"/></svg> VIDEO', () => videoUp.click());
  const ovBtn = button('<svg class="icon" aria-hidden="true"><use href="#icon-layer-group"/></svg> OVERLAY', () => overlayUpload.click());
  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "Subtitle URL";
  urlInput.value = getSubtitleUrl();
  urlInput.className = "admin-url-input";
  const setUrlBtn = document.createElement("button");
  setUrlBtn.innerText = "SET";
  setUrlBtn.className = "admin-url-button";
  setUrlBtn.onclick = () => setSubtitleUrl(urlInput.value);
  const urlWrapper = document.createElement("div");
  urlWrapper.className = "flex items-center gap-1";
  urlWrapper.appendChild(urlInput);
  urlWrapper.appendChild(setUrlBtn);
  const logoutBtn = button("EXIT", adminLogout);
  adminDiv.append(vidBtn, ovBtn, urlWrapper, logoutBtn);
}
// Connexion cachée : double-clic sur le logo de la barre du haut.
logoSquare.addEventListener("dblclick", () => {
  if (!isAdmin) promptAdminLogin();
});
videoUp.onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f && isAdmin) {
    const url = URL.createObjectURL(f);
    bgVideo.src = url;
    bgVideo.load();
    bgVideo.play().catch(() => {});
    showToast("VIDEO", "BACKGROUND UPDATED", "default");
  } else showToast("ACCESS", "ADMIN ONLY", "destructive");
  videoUp.value = "";
};
overlayUpload.onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f && isAdmin) loadOverlayVideo(f);
  else if (!isAdmin) showToast("ACCESS", "ADMIN ONLY", "destructive");
  overlayUpload.value = "";
};

renderAdmin();
