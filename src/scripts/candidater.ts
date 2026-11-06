// ---------- CANDIDATER : LES TROIS ÉCRANS DU FORMULAIRE, PUIS « C'EST REÇU » ----------
// La page /candidater (src/pages/candidater.astro) écrit tout ; ce script en fait un formulaire en trois écrans. Il
// montre un écran à la fois et le vérifie avant de passer au suivant : le message sous le champ, le curseur dessus, et
// le message s'efface dès que c'est corrigé. Le dernier écran suit le type choisi (l'idée, le lien d'écoute, les
// styles). Le brouillon reste dans le navigateur (localStorage) : on peut quitter la page, ou l'appli d'Insta, et
// reprendre. Changer d'écran, c'est zapper : l'écran clignote comme à l'allumage (tele.css), sauf avec « réduire les
// animations ». Branché sur astro:page-load : à chaque arrivée sur la page.
//
// Prototype : /api/candidature n'existe pas encore. En développement, « C'est reçu » s'affiche quand même (rien n'est
// envoyé) ; ailleurs, l'envoi échoue et le dit, sans perdre les réponses.

type ParType = { idee: string; lien: string; lienRequis: boolean };
type Config = { delai: string; stylesMax: number; types: Record<string, ParType> };
type Faute = { champ: string; message: string; cibles: (HTMLInputElement | HTMLTextAreaElement)[] };

/** Le brouillon, dans le navigateur. */
const CLE = "parabole:candidature";
const ETAPES = 3;
const IDEE_MIN = 20;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INSTA = /^[A-Za-z0-9._]{1,30}$/;
/** Les champs gardés dans le brouillon et envoyés. */
const CHAMPS = ["type", "prete", "frequence", "nom", "ville", "instagram", "email", "idee", "lien"] as const;

const calme = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Un compte Instagram, d'où qu'on l'ait copié : « @nom », « nom », ou l'adresse de son profil. Vide s'il ne va pas. */
export function compteInsta(saisie: string): string {
  let nom = saisie.trim();
  const adresse = nom.match(/instagram\.com\/([^/?#\s]+)/i);
  if (adresse) nom = adresse[1]!;
  nom = nom.replace(/^@+/, "").replace(/\/+$/, "");
  return INSTA.test(nom) ? nom : "";
}

/** Une adresse web complète (https:// ajouté s'il manque), ou null si ce n'en est pas une. */
export function adresseWeb(saisie: string): string | null {
  const brut = saisie.trim();
  if (!brut || /\s/.test(brut)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(brut) ? brut : `https://${brut}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

let quitter: (() => void) | null = null;

document.addEventListener("astro:page-load", () => {
  quitter?.();
  quitter = null;
  const page = document.querySelector<HTMLElement>("[data-candidater]");
  if (page) quitter = brancher(page);
});
document.addEventListener("astro:before-swap", () => {
  quitter?.();
  quitter = null;
});

function brancher(page: HTMLElement): () => void {
  const config = JSON.parse(page.dataset.config ?? "{}") as Config;
  const form = page.querySelector<HTMLFormElement>("[data-form]")!;
  const panneau = page.querySelector<HTMLElement>(".cand-panneau")!;
  const etapes = [...page.querySelectorAll<HTMLElement>("[data-etape]")];
  const pas = [...page.querySelectorAll<HTMLElement>("[data-pas]")];
  const annonce = page.querySelector<HTMLElement>("[data-annonce]")!;
  const retour = page.querySelector<HTMLButtonElement>("[data-retour]")!;
  const suivant = page.querySelector<HTMLButtonElement>("[data-suivant]")!;
  const envoyer = page.querySelector<HTMLButtonElement>("[data-envoyer]")!;
  const erreurEnvoi = page.querySelector<HTMLElement>('[data-erreur="envoi"]')!;
  const noteBrouillon = page.querySelector<HTMLElement>("[data-brouillon]")!;
  const recu = page.querySelector<HTMLElement>("[data-recu]")!;
  const idee = form.querySelector<HTMLTextAreaElement>('[name="idee"]')!;
  const compteur = page.querySelector<HTMLElement>("[data-compteur]");
  const comptePuces = page.querySelector<HTMLElement>("[data-styles-compte]");
  const champ = (nom: string) => form.querySelector<HTMLInputElement>(`[name="${nom}"]`)!;

  const controle = new AbortController();
  const { signal } = controle;
  let ici = 1;
  let atteinte = 1;
  let minuterie = 0;
  /** Les écrans où l'on a déjà essayé de passer : leurs messages se tiennent à jour pendant qu'on corrige. */
  const tentes = new Set<number>();

  // ---------- les valeurs ----------
  const valeur = (nom: string): string => {
    const element = form.elements.namedItem(nom) as HTMLInputElement | RadioNodeList | null;
    return (element?.value ?? "").trim();
  };
  const type = () => valeur("type");
  const puces = (): HTMLInputElement[] => [...page.querySelectorAll<HTMLInputElement>(`[data-styles="${type() || "dj_set"}"] input`)];
  const styles = () => puces().filter((puce) => puce.checked).map((puce) => puce.value);

  // ---------- les écrans ----------
  function aller(n: number, { focus = true, zap = true } = {}) {
    ici = Math.min(Math.max(n, 1), ETAPES);
    atteinte = Math.max(atteinte, ici);
    for (const etape of etapes) etape.toggleAttribute("data-ici", Number(etape.dataset.etape) === ici);
    for (const li of pas) {
      const k = Number(li.dataset.pas);
      li.dataset.etat = k < ici ? "fait" : k === ici ? "ici" : "apres";
      const bouton = li.querySelector("button")!;
      bouton.disabled = k > atteinte || k === ici;
      if (k === ici) bouton.setAttribute("aria-current", "step");
      else bouton.removeAttribute("aria-current");
    }
    retour.hidden = ici === 1;
    suivant.hidden = ici === ETAPES;
    envoyer.hidden = ici !== ETAPES;
    const courant = etapes[ici - 1]!;
    if (zap && !calme()) {
      courant.classList.remove("cand-zap");
      void courant.offsetWidth; // relance l'animation
      courant.classList.add("cand-zap");
    }
    annonce.textContent = `Étape ${ici} sur ${ETAPES} : ${courant.querySelector("h2")?.textContent?.replace(/^\d\/\d\s*/, "") ?? ""}`;
    if (focus) {
      courant.querySelector<HTMLElement>(".cand-etape-titre")?.focus({ preventScroll: true });
      if (panneau.getBoundingClientRect().top < 0) panneau.scrollIntoView({ block: "start", behavior: calme() ? "auto" : "smooth" });
    }
    sauver();
  }

  // ---------- les vérifications ----------
  function verifier(etape: number): Faute[] {
    const fautes: Faute[] = [];
    if (etape === 1) {
      if (!type()) fautes.push({ champ: "type", message: "Choisis ce que tu proposes.", cibles: [champ("type")] });
      if (!valeur("prete")) fautes.push({ champ: "prete", message: "Dis-nous si ton émission est déjà enregistrée.", cibles: [champ("prete")] });
    }
    if (etape === 2) {
      const nom = valeur("nom");
      if (nom.length < 2)
        fautes.push({ champ: "nom", message: nom ? "Ton nom d'artiste est un peu court." : "Indique ton nom d'artiste, ou celui de ton projet.", cibles: [champ("nom")] });
      const insta = valeur("instagram");
      const email = valeur("email");
      if (insta && !compteInsta(insta))
        fautes.push({ champ: "instagram", message: "Ce compte n'a pas l'air juste : des lettres, des chiffres, des points et des _ seulement.", cibles: [champ("instagram")] });
      if (email && !EMAIL.test(email)) fautes.push({ champ: "email", message: "Cette adresse e-mail n'a pas l'air complète.", cibles: [champ("email")] });
      if (!insta && !email)
        fautes.push({ champ: "contact", message: "Laisse ton Instagram ou ton e-mail, pour qu'on puisse te répondre.", cibles: [champ("instagram"), champ("email")] });
    }
    if (etape === 3) {
      const texte = valeur("idee");
      if (texte.length < IDEE_MIN)
        fautes.push({
          champ: "idee",
          message: texte ? `Dis-nous-en un peu plus (${IDEE_MIN} caractères au moins).` : "Raconte-nous ton idée en quelques lignes.",
          cibles: [idee],
        });
      const lien = valeur("lien");
      const requis = config.types[type()]?.lienRequis ?? true;
      if (lien && !adresseWeb(lien)) fautes.push({ champ: "lien", message: "Ce lien n'a pas l'air d'une adresse web.", cibles: [champ("lien")] });
      else if (!lien && requis)
        fautes.push({
          champ: "lien",
          message: type() === "playlist" ? "Ajoute le lien de ta playlist, pour qu'on l'écoute." : "Ajoute un lien vers un de tes mixes, pour qu'on t'écoute.",
          cibles: [champ("lien")],
        });
    }
    return fautes;
  }

  /** Affiche les fautes d'un écran (et efface celles qui sont corrigées) ; avec `viser`, le curseur va sur la première. */
  function montrer(etape: number, fautes: Faute[], viser: boolean) {
    const zone = etapes[etape - 1]!;
    zone.querySelectorAll<HTMLElement>("[data-erreur]").forEach((p) => {
      p.hidden = true;
      p.textContent = "";
    });
    zone.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    zone.querySelectorAll("[data-faux]").forEach((el) => el.removeAttribute("data-faux"));
    for (const faute of fautes) {
      const message = zone.querySelector<HTMLElement>(`[data-erreur="${faute.champ}"]`);
      if (message) {
        message.textContent = faute.message;
        message.hidden = false;
      }
      zone.querySelector(`[data-champ="${faute.champ}"]`)?.setAttribute("data-faux", "");
      for (const cible of faute.cibles) if (cible.type !== "radio") cible.setAttribute("aria-invalid", "true");
    }
    if (viser && fautes[0]) {
      fautes[0].cibles[0]?.focus();
      annonce.textContent = fautes.length > 1 ? `${fautes.length} choses à revoir. ${fautes[0].message}` : fautes[0].message;
    }
  }

  function passer() {
    tentes.add(ici);
    const fautes = verifier(ici);
    montrer(ici, fautes, true);
    if (!fautes.length) aller(ici + 1);
  }

  // ---------- le dernier écran suit le type ----------
  function suivreType() {
    const choisi = type() || "dj_set";
    const regles = config.types[choisi];
    if (regles) {
      idee.placeholder = regles.idee;
      page.querySelector<HTMLElement>("[data-aide-lien]")!.textContent = regles.lien;
      page.querySelector<HTMLElement>("[data-lien-facultatif]")!.hidden = regles.lienRequis;
    }
    page.querySelectorAll<HTMLElement>("[data-styles]").forEach((groupe) => {
      groupe.hidden = groupe.dataset.styles !== choisi;
      // les styles d'un autre type ne partent pas
      if (groupe.hidden) groupe.querySelectorAll<HTMLInputElement>("input").forEach((puce) => (puce.checked = false));
    });
    limiterStyles();
  }

  function limiterStyles() {
    const choisis = styles().length;
    for (const puce of puces()) puce.disabled = !puce.checked && choisis >= config.stylesMax;
    if (comptePuces) comptePuces.textContent = choisis ? `${choisis} sur ${config.stylesMax}` : "";
  }

  function compter() {
    if (!compteur) return;
    const n = idee.value.length;
    compteur.textContent = `${n} / ${idee.maxLength}`;
    compteur.toggleAttribute("data-plein", n > idee.maxLength * 0.9);
  }

  // ---------- le brouillon ----------
  function sauver() {
    window.clearTimeout(minuterie);
    minuterie = window.setTimeout(() => {
      const champs = Object.fromEntries(CHAMPS.map((nom) => [nom, valeur(nom)]));
      const rempli = Object.values(champs).some(Boolean);
      try {
        if (rempli) localStorage.setItem(CLE, JSON.stringify({ ici, atteinte, champs, styles: styles() }));
        else localStorage.removeItem(CLE);
      } catch {
        return; // navigation privée : pas de brouillon
      }
      noteBrouillon.hidden = !rempli;
    }, 250);
  }

  function restaurer() {
    let brouillon: { ici?: number; atteinte?: number; champs?: Record<string, string>; styles?: string[] } | null = null;
    try {
      brouillon = JSON.parse(localStorage.getItem(CLE) ?? "null");
    } catch {
      brouillon = null;
    }
    if (!brouillon?.champs) return;
    for (const nom of CHAMPS) {
      const garde = brouillon.champs[nom] ?? "";
      const element = form.elements.namedItem(nom);
      if (element instanceof RadioNodeList) {
        for (const option of element) if (option instanceof HTMLInputElement) option.checked = option.value === garde;
      } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.value = garde;
    }
    suivreType();
    for (const puce of puces()) puce.checked = brouillon.styles?.includes(puce.value) ?? false;
    atteinte = Math.min(Math.max(brouillon.atteinte ?? 1, 1), ETAPES);
    ici = Math.min(Math.max(brouillon.ici ?? 1, 1), atteinte);
    noteBrouillon.hidden = false;
  }

  // ---------- l'envoi ----------
  async function envoyerTout() {
    // tout l'écran d'avant doit être juste : on y retourne sinon
    for (let k = 1; k <= ETAPES; k++) {
      const fautes = verifier(k);
      if (fautes.length) {
        tentes.add(k);
        if (k !== ici) aller(k, { focus: false });
        montrer(k, fautes, true);
        return;
      }
    }
    const corps: Record<string, string | string[]> = {
      ...Object.fromEntries(CHAMPS.map((nom) => [nom, valeur(nom)])),
      instagram: compteInsta(valeur("instagram")),
      lien: adresseWeb(valeur("lien")) ?? "",
      styles: styles(),
    };
    envoyer.disabled = true;
    envoyer.setAttribute("aria-busy", "true");
    erreurEnvoi.hidden = true;
    try {
      const reponse = await fetch(form.action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps), signal });
      if (!reponse.ok && !(import.meta.env.DEV && reponse.status === 404)) throw new Error(`réponse ${reponse.status}`);
      if (!reponse.ok) console.info("candidater : prototype, rien n'est envoyé (/api/candidature n'existe pas encore)", corps);
      fini(valeur("nom"));
    } catch (erreur) {
      if (signal.aborted) return;
      console.error("candidater : l'envoi n'est pas passé", erreur);
      erreurEnvoi.textContent = "L'envoi n'a pas marché. Tes réponses sont gardées : réessaie dans un moment.";
      erreurEnvoi.hidden = false;
      annonce.textContent = erreurEnvoi.textContent;
    } finally {
      envoyer.disabled = false;
      envoyer.removeAttribute("aria-busy");
    }
  }

  function fini(nom: string) {
    window.clearTimeout(minuterie);
    try {
      localStorage.removeItem(CLE);
    } catch {
      /* rien à effacer */
    }
    form.hidden = true;
    recu.hidden = false;
    page.querySelector<HTMLElement>("[data-recu-nom]")!.textContent = nom ? `, ${nom}` : "";
    if (!calme()) recu.classList.add("cand-zap");
    recu.focus({ preventScroll: true });
    if (panneau.getBoundingClientRect().top < 0) panneau.scrollIntoView({ block: "start", behavior: calme() ? "auto" : "smooth" });
  }

  // ---------- les gestes ----------
  form.addEventListener(
    "submit",
    (evenement) => {
      evenement.preventDefault();
      if (ici < ETAPES) passer();
      else void envoyerTout();
    },
    { signal },
  );
  retour.addEventListener("click", () => aller(ici - 1), { signal });
  for (const li of pas) li.querySelector("button")!.addEventListener("click", () => aller(Number(li.dataset.pas)), { signal });
  form.addEventListener(
    "input",
    (evenement) => {
      const cible = evenement.target as HTMLInputElement | HTMLTextAreaElement;
      if (cible.name === "type") suivreType();
      if (cible.name === "styles") limiterStyles();
      if (cible === idee) compter();
      if (tentes.has(ici)) montrer(ici, verifier(ici), false);
      sauver();
    },
    { signal },
  );
  // une adresse de profil collée devient le nom du compte, en quittant le champ : on voit ce qu'on a compris
  champ("instagram").addEventListener(
    "change",
    () => {
      const compte = compteInsta(champ("instagram").value);
      if (compte) champ("instagram").value = compte;
      sauver();
    },
    { signal },
  );

  restaurer();
  suivreType();
  compter();
  page.classList.add("pret");
  aller(ici, { focus: false, zap: false });

  return () => {
    window.clearTimeout(minuterie);
    controle.abort();
  };
}
