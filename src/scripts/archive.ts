// ---------- LA LIGNE ARCHIVE : réécouter une émission sans quitter le site ----------
// La ligne jaune du croquis du 4 novembre, sous la ligne ON AIR (TopBar.astro, styles dans archive.css). Elle apparaît
// quand une émission est en main : celle de la page qu'on regarde (sa page la confie par data-archive), prête à jouer,
// ou celle qu'on écoute, qui continue d'une page à l'autre, puisque l'en-tête n'est jamais remplacé (router.ts). Une
// émission confiée qu'on n'a pas lancée part avec sa page ; × ferme la ligne.
//
// Le son vient du lecteur de SoundCloud (le « widget », piloté par son API JavaScript), chargé au premier ▶ seulement :
// rien ne part chez SoundCloud tant qu'on n'écoute pas. Il vit, minuscule et invisible, dans #archiveCadre, qu'on ne
// déplace jamais (un cadre déplacé se recharge) ; une autre émission s'y charge à la place de la précédente. Un
// navigateur qui exige qu'on touche le lecteur lui-même (iPhone) le voit apparaître en page de télétexte, le temps de
// ce premier toucher. Le lecteur entièrement maison prévu (le flux de l'API de SoundCloud dans notre propre <audio>)
// attend l'application SoundCloud de la radio : il remplacera lecteur() sans changer la ligne.
//
// Les conditions de SoundCloud : la piste créditée (son titre, ses résidents), SoundCloud cité comme source, et un lien
// visible vers sa page (la touche SoundCloud ↗ de la ligne, et le lien de la page de l'émission).
//
// Le direct et l'archive ne jouent jamais ensemble : l'archive emprunte le son (audio.ts, preterLeSon) et le rend quand
// on ferme la ligne ou quand l'émission finit ; ▶ ON AIR, RADIO / VIDÉO ou le casque le reprennent, et l'archive se met
// en pause. Le film de la page À propos et l'archive se mettent en pause l'un l'autre.
import { formatTimecode } from "@parabole/cms/tracklist";
import { radioControl } from "./audio";

/** Ce que la page d'une émission confie à la ligne (src/pages/emissions/[slug].astro, data-archive). */
type Archive = { slug: string; titre: string; qui: string; piste: string; url: string | null; duree: number | null; pochette: string | null };
type Etat = "pret" | "chargement" | "lecture" | "pause" | "erreur";

// L'API du lecteur de SoundCloud (https://developers.soundcloud.com/docs/api/html5-widget), ce qui sert ici.
type Son = { duration?: number; permalink_url?: string; waveform_url?: string; user?: { username?: string } };
type Lecteur = {
  bind(evenement: string, rappel: (e?: { currentPosition?: number }) => void): void;
  load(url: string, options: Record<string, unknown>): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  setVolume(volume: number): void;
  getDuration(rappel: (ms: number) => void): void;
  getPosition(rappel: (ms: number) => void): void;
  getCurrentSound(rappel: (son: Son | null) => void): void;
};
type Widget = ((cadre: HTMLIFrameElement) => Lecteur) & { Events: Record<"READY" | "PLAY" | "PAUSE" | "FINISH" | "PLAY_PROGRESS" | "ERROR", string> };

const API = "https://w.soundcloud.com/player/api.js";
/** Le lecteur sans rien d'autre que le son ; jaune s'il doit se montrer (iPhone). */
const REGLAGES = {
  auto_play: false,
  visual: false,
  buying: false,
  sharing: false,
  download: false,
  show_artwork: false,
  show_comments: false,
  show_playcount: false,
  show_teaser: false,
  hide_related: true,
  color: "#fff039",
};
const pisteDe = (id: string) => `https://api.soundcloud.com/tracks/${id}`;
const adresseDuLecteur = (id: string) =>
  `https://w.soundcloud.com/player/?${new URLSearchParams({ url: pisteDe(id), ...Object.fromEntries(Object.entries(REGLAGES).map(([cle, valeur]) => [cle, String(valeur)])) })}`;

const ligne = document.getElementById("archive");
const titre = document.getElementById("archiveTitre") as HTMLAnchorElement | null;
const nom = document.getElementById("archiveNom");
const qui = document.getElementById("archiveQui");
const lireTouche = document.getElementById("archiveLire");
const temps = document.getElementById("archiveTemps");
const dureeTexte = document.getElementById("archiveDuree");
const curseur = document.getElementById("archiveCurseur") as HTMLInputElement | null;
const message = document.getElementById("archiveMessage");
const onde = ligne?.querySelector<HTMLElement>(".archive-onde");
const trace = ligne?.querySelector<HTMLElement>(".archive-onde-trace");
const soundcloud = document.getElementById("archiveSoundcloud") as HTMLAnchorElement | null;
const fermerTouche = document.getElementById("archiveFermer");
const lecteurPanneau = document.getElementById("archiveLecteur");
const cadreHote = document.getElementById("archiveCadre");
const volume = document.getElementById("archiveVolume") as HTMLInputElement | null;
const volumeCadre = document.getElementById("archiveVolumeCadre");
const muet = document.getElementById("archiveMuet");
const volumeDuDirect = document.getElementById("playerVolume") as HTMLInputElement | null;

if (ligne && titre && nom && qui && lireTouche && temps && dureeTexte && curseur && message && onde && trace && soundcloud && fermerTouche && lecteurPanneau && cadreHote) {
  let enMain: Archive | null = null; // l'émission de la ligne
  let lancee = false; // on a appuyé sur ▶ pour elle : elle reste en main d'une page à l'autre
  let etat: Etat = "pret";
  let position = 0; // en secondes
  let longueur = 0;
  let glisse = false; // le curseur est tenu : la lecture ne le déplace plus
  let rendre: (() => void) | null = null; // rend le son au direct
  let demande = 0; // la dernière demande de lecture : une plus ancienne qui finit d'arriver ne fait rien
  let attente: ReturnType<typeof setTimeout> | undefined;

  // ---------- Le lecteur de SoundCloud ----------
  let api: Promise<Widget> | null = null;
  let lecteur: Lecteur | null = null;
  let pret: Promise<Lecteur> | null = null;
  let charge = ""; // la piste chargée dans le lecteur
  let changeDePiste = false; // une autre piste se charge à la place de la précédente
  let pauseIgnoree = 0; // jusqu'à quand la pause de l'émission qu'on vient de quitter ne compte pas
  let depart: number | null = null; // le minutage où lancer le son, dès qu'il joue

  /** Le script de l'API, une fois. Un échec permet de réessayer plus tard. */
  function chargerApi(): Promise<Widget> {
    api ??= new Promise<Widget>((resolve, reject) => {
      const deja = (window as Window & { SC?: { Widget: Widget } }).SC?.Widget;
      if (deja) return resolve(deja);
      const script = document.createElement("script");
      script.src = API;
      script.async = true;
      script.onload = () => {
        const widget = (window as Window & { SC?: { Widget: Widget } }).SC?.Widget;
        if (widget) resolve(widget);
        else reject(new Error("SoundCloud : l'API du lecteur est vide"));
      };
      script.onerror = () => reject(new Error("SoundCloud : l'API du lecteur ne se charge pas"));
      document.head.append(script);
    }).catch((erreur) => {
      api = null;
      throw erreur;
    });
    return api;
  }

  /** Le lecteur, prêt, avec cette piste chargée. Le premier appel crée le cadre ; les suivants y chargent la piste. */
  async function lecteurPour(piste: string): Promise<Lecteur> {
    const Widget = await chargerApi();
    if (!pret) {
      pret = new Promise<Lecteur>((resolve, reject) => {
        const cadre = document.createElement("iframe");
        cadre.title = "Lecteur SoundCloud de l'archive";
        cadre.allow = "autoplay; encrypted-media";
        cadre.src = adresseDuLecteur(piste);
        cadreHote!.append(cadre);
        const l = Widget(cadre);
        const delai = setTimeout(() => reject(new Error("SoundCloud : le lecteur ne répond pas")), 15000);
        l.bind(Widget.Events.READY, () => {
          clearTimeout(delai);
          charge = piste;
          resolve(l);
        });
        brancher(l, Widget);
      }).catch((erreur) => {
        pret = null;
        cadreHote!.replaceChildren();
        throw erreur;
      });
    }
    const l = await pret;
    lecteur = l;
    if (charge !== piste) {
      changeDePiste = true;
      try {
        await new Promise<void>((resolve, reject) => {
          const delai = setTimeout(() => reject(new Error("SoundCloud : la piste ne se charge pas")), 15000);
          l.load(pisteDe(piste), {
            ...REGLAGES,
            callback: () => {
              clearTimeout(delai);
              resolve();
            },
          });
        });
      } finally {
        changeDePiste = false;
      }
      charge = piste;
    }
    return l;
  }

  /** Ce que dit le lecteur : il joue, s'arrête, avance, finit, ou ne trouve pas la piste. */
  function brancher(l: Lecteur, Widget: Widget) {
    l.bind(Widget.Events.PLAY, () => {
      // la ligne a été fermée pendant que le son arrivait : il s'arrête là
      if (!enMain) return l.pause();
      clearTimeout(attente);
      montrerLeLecteur(false);
      message!.textContent = "";
      // le lecteur de SoundCloud ne saute qu'une fois le son lancé : le minutage demandé (la tracklist, le curseur)
      if (depart !== null) {
        l.seekTo(depart * 1000);
        avancer(depart);
        depart = null;
      }
      prendreLeSon(); // lancé du lecteur lui-même (le toucher de l'iPhone) : le direct s'arrête aussi
      lancee = true;
      changer("lecture");
      lireLaPiste(l);
    });
    l.bind(Widget.Events.PAUSE, () => {
      // la pause de l'émission d'avant, pendant qu'une autre se charge à sa place, ne compte pas
      if (changeDePiste || Date.now() < pauseIgnoree) return;
      if (etat === "lecture" || etat === "chargement") changer("pause");
    });
    l.bind(Widget.Events.PLAY_PROGRESS, (e) => {
      if (typeof e?.currentPosition === "number") avancer(e.currentPosition / 1000);
    });
    l.bind(Widget.Events.FINISH, () => {
      // l'émission est finie : le direct reprend s'il jouait avant, la ligne revient au début
      rendreLeSon();
      avancer(0);
      changer("pret");
    });
    l.bind(Widget.Events.ERROR, () => {
      if (etat === "chargement" || etat === "lecture") echouer("Introuvable sur SoundCloud.");
    });
  }

  /** Ce que SoundCloud sait de la piste : sa durée exacte, l'adresse de sa page, son onde. */
  function lireLaPiste(l: Lecteur) {
    l.getDuration((ms) => {
      if (ms > 0) fixerLaLongueur(ms / 1000);
    });
    l.getCurrentSound((son) => {
      if (!son) return;
      if (son.permalink_url && !enMain?.url) soundcloud!.href = son.permalink_url;
      if (son.user?.username) soundcloud!.title = `${son.user.username} sur SoundCloud`;
      if (son.waveform_url) void dessinerLOnde(son.waveform_url, enMain?.slug);
    });
  }

  // ---------- L'onde : les vrais niveaux de la piste, sinon des segments réguliers ----------
  const ondes = new Map<string, string>();
  async function dessinerLOnde(adresse: string, slug: string | undefined) {
    if (!slug) return;
    let image = ondes.get(slug);
    if (!image) {
      try {
        // SoundCloud donne l'onde en PNG ou en JSON ; le JSON garde les niveaux
        const reponse = await fetch(adresse.replace(/\.png(\?.*)?$/, ".json"));
        if (!reponse.ok) return;
        const { samples, height } = (await reponse.json()) as { samples?: number[]; height?: number };
        if (!Array.isArray(samples) || !samples.length) return;
        const BARRES = 160;
        const haut = height || Math.max(...samples) || 1;
        const barres = Array.from({ length: BARRES }, (_, i) => {
          const morceau = samples.slice(Math.floor((i * samples.length) / BARRES), Math.floor(((i + 1) * samples.length) / BARRES));
          const niveau = morceau.length ? Math.max(...morceau) / haut : 0;
          const h = Math.max(2, Math.round(niveau * 28));
          return `<rect x="${i * 3}" y="${(28 - h) / 2}" width="2" height="${h}"/>`;
        }).join("");
        image = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${BARRES * 3 - 1} 28' preserveAspectRatio='none'>${barres}</svg>`)}")`;
        ondes.set(slug, image);
      } catch {
        return; // pas d'onde : les segments
      }
    }
    if (enMain?.slug !== slug) return;
    trace!.style.setProperty("--onde", image);
    trace!.classList.add("avec-onde");
  }

  // ---------- La ligne ----------
  /** L'émission prend la ligne, au début, sans rien demander à SoundCloud. */
  function montrer(archive: Archive) {
    enMain = archive;
    lancee = false;
    nom!.textContent = archive.titre;
    qui!.textContent = archive.qui ? ` · ${archive.qui}` : "";
    titre!.href = `/emissions/${archive.slug}`;
    titre!.setAttribute("aria-label", `Archive : ${archive.titre}${archive.qui ? `, ${archive.qui}` : ""}. Ouvrir sa page`);
    soundcloud!.href = archive.url || "https://soundcloud.com/parabole-radio";
    soundcloud!.removeAttribute("title");
    const sonOnde = ondes.get(archive.slug);
    if (sonOnde) trace!.style.setProperty("--onde", sonOnde);
    else trace!.style.removeProperty("--onde");
    trace!.classList.toggle("avec-onde", !!sonOnde);
    fixerLaLongueur(archive.duree ?? 0);
    avancer(0);
    message!.textContent = "";
    ligne!.hidden = false;
    document.documentElement.classList.add("archive-ouverte");
    changer("pret");
  }

  function cacher() {
    clearTimeout(attente);
    enMain = null;
    lancee = false;
    ligne!.hidden = true;
    montrerLeLecteur(false);
    document.documentElement.classList.remove("archive-ouverte");
    rafraichirLaPage();
  }

  function changer(nouveau: Etat) {
    etat = nouveau;
    ligne!.dataset.etat = nouveau;
    const joue = nouveau === "lecture" || nouveau === "chargement";
    lireTouche!.setAttribute("aria-label", joue ? "Mettre l'archive en pause" : "Lire l'archive");
    lireTouche!.toggleAttribute("disabled", nouveau === "erreur");
    if (nouveau !== "erreur") message!.textContent = nouveau === "chargement" ? "" : message!.textContent;
    for (const touche of ligne!.querySelectorAll<HTMLButtonElement>("[data-saut]")) touche.disabled = !lancee || nouveau === "erreur";
    curseur!.disabled = nouveau === "erreur";
    rafraichirLaPage();
  }

  function echouer(texte: string) {
    clearTimeout(attente);
    montrerLeLecteur(false);
    rendreLeSon();
    message!.textContent = texte;
    changer("erreur");
  }

  function fixerLaLongueur(secondes: number) {
    longueur = Math.max(0, Math.round(secondes));
    curseur!.max = String(longueur);
    dureeTexte!.textContent = longueur ? formatTimecode(longueur) : "";
    avancer(position);
  }

  /** La lecture avance : le temps, le curseur, l'onde allumée jusque-là, et le morceau de la tracklist. */
  function avancer(secondes: number) {
    position = Math.max(0, secondes);
    if (!glisse) {
      curseur!.value = String(Math.round(position));
      temps!.textContent = formatTimecode(position);
    }
    const part = longueur ? Math.min(100, (position / longueur) * 100) : 0;
    onde!.style.setProperty("--p", `${part.toFixed(2)}%`);
    curseur!.setAttribute("aria-valuetext", `${formatTimecode(position)}${longueur ? ` sur ${formatTimecode(longueur)}` : ""}`);
    suivreLaTracklist();
  }

  /** Le lecteur montré, en page de télétexte, pour un premier toucher (iPhone), ou rendu invisible. */
  function montrerLeLecteur(oui: boolean) {
    lecteurPanneau!.classList.toggle("visible", oui);
    lecteurPanneau!.setAttribute("aria-hidden", String(!oui));
  }

  // ---------- Le son : emprunté au direct, rendu ----------
  function prendreLeSon() {
    rendre ??= radioControl?.preterLeSon() ?? null;
    // le film de la page À propos, s'il joue, se met en pause (il garde son emprunt)
    for (const media of document.querySelectorAll<HTMLMediaElement>("#page video, #page audio")) if (!media.paused && !media.muted) media.pause();
  }
  function rendreLeSon() {
    const r = rendre;
    rendre = null;
    r?.();
  }
  // ▶ ON AIR, RADIO / VIDÉO ou le casque ont repris le son : l'archive se met en pause, sans rien rendre
  document.addEventListener("parabole:son-repris", () => {
    rendre = null;
    clearTimeout(attente);
    montrerLeLecteur(false);
    if (etat === "lecture" || etat === "chargement") {
      lecteur?.pause();
      changer("pause");
    }
  });
  // un son de la page se lance (le film de la page À propos) : l'archive se met en pause
  document.addEventListener(
    "play",
    (e) => {
      const media = e.target as HTMLMediaElement;
      if (media.closest?.("#page") && !media.muted && (etat === "lecture" || etat === "chargement")) {
        lecteur?.pause();
        changer("pause");
      }
    },
    true,
  );

  // ---------- Lire, mettre en pause, sauter, fermer ----------
  async function lire(archive: Archive, depuis?: number) {
    const ici = ++demande;
    if (enMain?.slug !== archive.slug) {
      if (etat === "lecture" || etat === "chargement") {
        pauseIgnoree = Date.now() + 2000;
        lecteur?.pause();
      }
      montrer(archive);
    }
    lancee = true;
    message!.textContent = "";
    if (depuis !== undefined) avancer(depuis);
    changer("chargement");
    prendreLeSon();
    try {
      const l = await lecteurPour(archive.piste);
      if (ici !== demande) return;
      appliquerLeVolume();
      depart = depuis ?? null;
      if (depart !== null) l.seekTo(depart * 1000);
      l.play();
      // pas de son au bout de 5 s : ce navigateur veut qu'on touche le lecteur lui-même
      clearTimeout(attente);
      attente = setTimeout(() => {
        if (ici !== demande || etat !== "chargement") return;
        montrerLeLecteur(true);
        message!.textContent = "Touchez ▶ dans le lecteur de SoundCloud";
        changer("pause");
      }, 5000);
    } catch (erreur) {
      if (ici !== demande) return;
      console.error("archive :", erreur);
      echouer("SoundCloud ne répond pas.");
    }
  }

  function basculer() {
    if (!enMain) return;
    if (etat === "lecture" || etat === "chargement") {
      demande++;
      clearTimeout(attente);
      lecteur?.pause();
      changer("pause");
    } else void lire(enMain, lancee ? undefined : position || undefined);
  }

  function sauter(secondes: number) {
    if (!lecteur || !lancee) return;
    const cible = Math.min(Math.max(0, position + secondes), longueur ? longueur - 1 : Infinity);
    lecteur.seekTo(cible * 1000);
    avancer(cible);
  }

  function fermer() {
    demande++;
    lecteur?.pause();
    rendreLeSon();
    cacher();
  }

  lireTouche.addEventListener("click", basculer);
  fermerTouche.addEventListener("click", fermer);
  document.getElementById("archiveLecteurFermer")?.addEventListener("click", () => montrerLeLecteur(false));
  for (const touche of ligne.querySelectorAll<HTMLButtonElement>("[data-saut]")) touche.addEventListener("click", () => sauter(Number(touche.dataset.saut)));

  // Le curseur de l'avancée : on le fait glisser, la lecture saute là où on le lâche (ou lance l'archive à cet endroit)
  curseur.addEventListener("input", () => {
    glisse = true;
    temps.textContent = formatTimecode(Number(curseur.value));
    onde.style.setProperty("--p", `${longueur ? (Number(curseur.value) / longueur) * 100 : 0}%`);
  });
  curseur.addEventListener("change", () => {
    glisse = false;
    const cible = Number(curseur.value);
    if (!enMain) return;
    if (lecteur && lancee && charge === enMain.piste) {
      lecteur.seekTo(cible * 1000);
      avancer(cible);
      if (etat !== "lecture") void lire(enMain, cible);
    } else void lire(enMain, cible);
  });

  // ---------- Le volume : celui du site (la ligne ON AIR le partage), et une touche muet à part ----------
  let coupe = false;
  const niveau = () => Number(volume?.value ?? 90);
  function appliquerLeVolume() {
    lecteur?.setVolume(coupe ? 0 : niveau());
    volumeCadre?.style.setProperty("--v", `${niveau()}%`);
    volumeCadre?.classList.toggle("muted", coupe);
    muet?.setAttribute("aria-pressed", String(coupe));
  }
  try {
    const garde = localStorage.getItem("parabole_volume");
    if (volume && garde !== null) volume.value = garde;
  } catch {
    /* pas de mémoire : 90 */
  }
  appliquerLeVolume();
  volume?.addEventListener("input", () => {
    coupe = false;
    appliquerLeVolume();
    // la ligne ON AIR suit : un seul volume pour le site (audio.ts le garde)
    if (volumeDuDirect) {
      volumeDuDirect.value = volume.value;
      volumeDuDirect.dispatchEvent(new Event("input"));
    }
  });
  volumeDuDirect?.addEventListener("input", () => {
    if (volume && volume.value !== volumeDuDirect.value) volume.value = volumeDuDirect.value;
    appliquerLeVolume();
  });
  muet?.addEventListener("click", () => {
    coupe = !coupe;
    appliquerLeVolume();
  });
  // l'iPhone ne laisse pas une page régler le volume : la touche muet seule, comme sur la ligne ON AIR
  if (document.getElementById("player")?.hasAttribute("data-novolume")) ligne.dataset.novolume = "";

  // ---------- La page de l'émission : ▶ ÉCOUTER, les minutages de la tracklist, le morceau qui passe ----------
  const archiveDeLaPage = (): Archive | null => {
    const source = document.querySelector<HTMLElement>("#page [data-archive]");
    if (!source?.dataset.archive) return null;
    try {
      return JSON.parse(source.dataset.archive) as Archive;
    } catch {
      return null;
    }
  };

  /** Les touches de la page disent ce que fait la ligne pour son émission. */
  function rafraichirLaPage() {
    const ici = archiveDeLaPage();
    const sienne = !!ici && enMain?.slug === ici.slug;
    const joue = sienne && (etat === "lecture" || etat === "chargement");
    for (const touche of document.querySelectorAll<HTMLElement>("#page [data-archive-lire]")) {
      touche.dataset.etat = sienne ? etat : "pret";
      touche.setAttribute("aria-pressed", String(joue));
      const mot = touche.querySelector("[data-archive-mot]");
      if (mot) mot.textContent = joue ? "Pause" : sienne && etat === "erreur" ? "Indisponible" : sienne && lancee && position > 0 ? "Reprendre" : "Écouter";
    }
    suivreLaTracklist();
  }

  let morceauAllume: Element | null = null;
  /** Dans la tracklist de la page, le morceau qui passe est allumé. */
  function suivreLaTracklist() {
    const ici = archiveDeLaPage();
    let actuel: Element | null = null;
    if (ici && enMain?.slug === ici.slug && lancee) {
      for (const li of document.querySelectorAll<HTMLElement>("#page .tracklist li[data-debut]")) {
        if (Number(li.dataset.debut) <= position + 0.5) actuel = li;
        else break;
      }
    }
    if (actuel === morceauAllume) return;
    morceauAllume?.removeAttribute("aria-current");
    actuel?.setAttribute("aria-current", "true");
    morceauAllume = actuel;
  }

  document.addEventListener("click", (e) => {
    const cible = e.target as Element | null;
    const lireIci = cible?.closest?.("#page [data-archive-lire]");
    const depuis = cible?.closest?.<HTMLElement>("#page [data-archive-depuis]");
    if (!lireIci && !depuis) return;
    const ici = archiveDeLaPage();
    if (!ici) return;
    if (depuis) {
      const secondes = Number(depuis.dataset.archiveDepuis);
      if (enMain?.slug === ici.slug && lecteur && lancee && charge === ici.piste) {
        lecteur.seekTo(secondes * 1000);
        avancer(secondes);
        if (etat !== "lecture") void lire(ici, secondes);
      } else void lire(ici, secondes);
      return;
    }
    if (enMain?.slug === ici.slug && lancee) basculer();
    else void lire(ici);
  });

  // À chaque page : celle d'une émission la confie à la ligne, si rien d'autre n'y est lancé ; ailleurs, une émission
  // confiée mais pas lancée s'en va avec sa page.
  document.addEventListener("astro:page-load", () => {
    morceauAllume = null;
    const ici = archiveDeLaPage();
    if (ici && (!enMain || (!lancee && enMain.slug !== ici.slug))) montrer(ici);
    else if (!ici && enMain && !lancee) cacher();
    // la place de la ligne dans l'en-tête (router.ts la garde déjà d'une page à l'autre)
    document.documentElement.classList.toggle("archive-ouverte", !ligne.hidden);
    rafraichirLaPage();
  });
}
