// ---------- AUDIO : LA RADIO D'ABORD, LES VIDÉOS MUETTES ----------
// Les navigateurs interdisent le son avant une interaction du visiteur : on essaie de lancer la radio au premier clic,
// appui ou touche, et on réessaie jusqu'à ce qu'elle joue vraiment. La touche RADIO / VIDÉO de l'en-tête bascule entre
// la radio et le son des vidéos ; les touches ÉCOUTER (celle de l'accueil, celle de l'en-tête sur les autres rubriques)
// lancent et arrêtent la radio. Un flux coupé se reconnecte tout seul. L'élément <audio> et ce module vivent dans la
// coque : la navigation ne les touche jamais. Le film de la page À propos emprunte le son le temps de passer
// (preterLeSon) : la radio s'arrête, puis reprend quand il le rend.

const playerEl = document.getElementById("player");
/** Le flux, donné par l'adaptateur de la station et écrit dans la page au build (TopBar.astro). */
export const STREAM_URL = playerEl?.dataset.flux ?? "";

export interface RadioControl {
  /** Appelés par le direct : la station est-elle à l'antenne, et que joue-t-elle. */
  setOnAir(on: boolean): void;
  setMeta(d: { title: string; artist?: string } | null): void;
  /** Lu par BEAT : les 20 dernières ms de la grosse caisse, ou null sans analyse. */
  signal(): Float32Array<ArrayBuffer> | null;
  /**
   * Un autre son prend l'antenne : le film de la page À propos (a-propos.ts). La radio s'arrête et les vidéos se
   * taisent ; la fonction rendue rend le son, et ce qui jouait reprend. Une touche ÉCOUTER, RADIO / VIDÉO ou le casque
   * reprennent la main entre-temps : l'évènement « parabole:son-repris » le dit au film, qui s'arrête.
   */
  preterLeSon(): () => void;
}

export const radioControl: RadioControl | null = (function audioControl() {
  const v = document.getElementById("backgroundVideo") as HTMLVideoElement | null;
  const radio = document.getElementById("radioStream") as HTMLAudioElement | null;
  const btn = document.getElementById("soundToggle");
  const player = playerEl;
  const volume = document.getElementById("playerVolume") as HTMLInputElement;
  const status = document.getElementById("playerStatus")!;
  if (!v || !radio || !player) return null;
  v.muted = true; // les vidéos muettes par défaut
  v.volume = 0.7;
  let mode: "radio" | "video" = "radio";
  let userChose = false; // vrai dès que le visiteur touche RADIO / VIDÉO ou une touche ÉCOUTER
  let wanted = false; // le visiteur veut la radio : un flux coupé se reconnecte
  let retry: ReturnType<typeof setTimeout> | undefined,
    retryDelay = 3000;
  let onAir = STREAM_URL ? "ON AIR" : "OFF AIR"; // affiné par le direct (setOnAir)
  player.dataset.air = STREAM_URL ? "on" : "off";

  // L'analyse du son pour le pouls de la musique (BEAT, qui fait battre le globe), sur ordinateur avec Chrome ou Edge
  // (le moteur où elle a été testée) : le flux passe alors par Web Audio, où BEAT le lit. Pas sur téléphone (le son qui
  // passe par là peut s'arrêter quand l'écran se verrouille), ni dans Safari ou Firefox. Le flux doit se laisser lire
  // par les autres sites (CORS ; Radio Cult le permet) : s'il refuse, la radio joue comme avant, et le globe tourne
  // à sa propre vitesse.
  const uaData = (navigator as Navigator & { userAgentData?: { mobile: boolean } }).userAgentData;
  const analysis = {
    ctx: null as AudioContext | null,
    gain: null as GainNode | null,
    kickAnalyser: null as AnalyserNode | null,
    kick: null as Float32Array<ArrayBuffer> | null,
    wanted: !!(
      window.AudioContext &&
      uaData &&
      !uaData.mobile &&
      window.matchMedia &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ),
  };
  if (analysis.wanted) radio.crossOrigin = "anonymous";
  // Une fois le flux en lecture et le contexte lancé (il faut un clic ou une touche), le son passe par le graphe : vers
  // les haut-parleurs à travers le volume, et vers BEAT à travers un passe-bas.
  function analyse() {
    const a = analysis;
    if (!a.wanted || a.kickAnalyser || !a.ctx || a.ctx.state !== "running") return;
    try {
      const gain = a.ctx.createGain();
      const source = a.ctx.createMediaElementSource(radio!); // dès lors, le son passe par le graphe
      source.connect(gain).connect(a.ctx.destination);
      const kickFilter = a.ctx.createBiquadFilter(),
        kickAnalyser = a.ctx.createAnalyser();
      kickFilter.type = "lowpass";
      kickFilter.frequency.value = 150; // la grosse caisse, pour les beats (BEAT)
      kickAnalyser.fftSize = 1024; // environ 20 ms
      source.connect(kickFilter).connect(kickAnalyser);
      Object.assign(a, { gain, kickAnalyser, kick: new Float32Array(kickAnalyser.fftSize) });
      applyVolume();
    } catch (e) {
      a.wanted = false;
    }
  }
  // ... sur chaque beat trouvé (BEAT), le témoin ON AIR de l'en-tête s'illumine
  player.addEventListener("beat", () => {
    if (player.dataset.state !== "playing") return;
    const sign = player.querySelector(".ecoute-point");
    if (sign && sign.animate)
      sign.animate([{ boxShadow: "0 0 12px 3px #fff039" }, { boxShadow: "0 0 0 0 rgba(255,240,57,0)" }], { duration: 300, easing: "ease-out" });
  });

  function setState(state: string) {
    player!.dataset.state = state;
    status.textContent = onAir; // la connexion se voit au témoin qui clignote et à la touche ÉCOUTER, pas ici
  }
  const restState = () => setState(STREAM_URL ? "idle" : "off");
  // la touche RADIO / VIDÉO montre la source qui joue (allumée) ; un clic passe à l'autre
  function setLabel() {
    if (!btn) return;
    btn.dataset.mode = mode;
    const label = mode === "radio" ? "Son : radio en direct. Passer au son des vidéos" : "Son : vidéos. Revenir à la radio";
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }
  function startRadio() {
    if (!STREAM_URL) return Promise.reject(new Error("pas de flux (adaptateur de la station)"));
    wanted = true;
    clearTimeout(retry);
    setState("loading");
    if (analysis.wanted) {
      // créé sur le clic ou la touche du visiteur, pour qu'il puisse tourner
      try {
        (analysis.ctx = analysis.ctx || new AudioContext()).resume().catch(() => {});
      } catch (e) {
        analysis.wanted = false;
      }
    }
    radio!.src = STREAM_URL; // toujours rouvrir : un direct reprend au plus près de l'antenne
    return radio!.play();
  }
  function stopRadio() {
    wanted = false;
    clearTimeout(retry);
    radio!.pause();
    radio!.removeAttribute("src"); // plus de téléchargement tant que la radio est arrêtée
    radio!.load();
    restState();
  }
  function playRadio() {
    mode = "radio";
    v!.muted = true;
    setLabel();
    return startRadio();
  }
  function playVideos() {
    mode = "video";
    stopRadio();
    v!.muted = false;
    v!.play().catch(() => {});
    setLabel();
  }
  // Le son prêté au film de la page À propos : ce qui jouait avant, pour le reprendre quand il le rend. Une touche
  // du son, pendant ce temps, le reprend : le film l'apprend par un évènement, et s'arrête.
  let prete: { radio: boolean } | null = null;
  function reprendreLeSon() {
    if (!prete) return;
    prete = null;
    document.dispatchEvent(new Event("parabole:son-repris"));
  }
  // Une lecture automatique refusée laisse la radio arrêtée ; tout autre échec passe par la reconnexion ci-dessous.
  function playFailed(err: unknown) {
    if ((err as { name?: string } | null)?.name === "NotAllowedError") {
      wanted = false;
      restState();
    }
  }

  radio.addEventListener("playing", () => {
    retryDelay = 3000;
    analyse();
    setState("playing");
  });
  radio.addEventListener("waiting", () => {
    if (wanted) setState("loading");
  });
  radio.addEventListener("pause", () => {
    // mise en pause de l'extérieur (casque, système) : le montrer
    if (wanted && player.dataset.state === "playing") {
      wanted = false;
      restState();
    }
  });
  (["error", "ended"] as const).forEach((ev) =>
    radio.addEventListener(ev, () => {
      if (!wanted || !radio.getAttribute("src")) return; // pas la remise à zéro de stopRadio
      // un échec avant que l'analyse n'ait jamais démarré peut être le flux qui refuse les autres sites (CORS) :
      // désormais, le jouer comme avant, sans l'analyse
      if (ev === "error" && radio.crossOrigin && !analysis.kickAnalyser) {
        analysis.wanted = false;
        radio.removeAttribute("crossorigin");
      }
      setState("error");
      clearTimeout(retry);
      retry = setTimeout(() => {
        if (wanted) startRadio().catch(playFailed);
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    }),
  );

  // Le volume, gardé dans ce navigateur, et une touche muet. Avec l'analyse, les deux sont un gain placé à côté de la
  // prise de BEAT : il lit le son à plein niveau. Un iPhone ne laisse pas une page régler le volume (ce sont les
  // boutons du téléphone) : là, seule la touche muet reste.
  const volumeWrap = document.getElementById("playerVolumeWrap")!;
  const mute = document.getElementById("playerMute")!;
  let muted = false;
  const probe = document.createElement("audio");
  probe.volume = 0.5;
  if (probe.volume !== 0.5) player.dataset.novolume = "";
  function applyVolume() {
    const level = Number(volume.value) / 100;
    if (analysis.gain) {
      radio!.volume = 1;
      radio!.muted = false;
      analysis.gain.gain.value = muted ? 0 : level;
    } else {
      radio!.volume = level;
      radio!.muted = muted;
    }
    volumeWrap.style.setProperty("--v", volume.value + "%"); // la partie allumée de la rampe
    volumeWrap.classList.toggle("muted", muted);
    mute.setAttribute("aria-pressed", String(muted));
  }
  try {
    const saved = localStorage.getItem("parabole_volume");
    if (saved !== null) volume.value = saved;
  } catch (e) {}
  applyVolume();
  volume.addEventListener("input", () => {
    muted = false; // bouger le volume remet le son
    applyVolume();
    try {
      localStorage.setItem("parabole_volume", volume.value);
    } catch (e) {}
  });
  mute.addEventListener("click", () => {
    muted = !muted;
    applyVolume();
  });

  // Lancer la radio à la première interaction, et réessayer jusqu'à ce qu'elle joue vraiment.
  function tryStart(e: Event) {
    if (userChose) {
      detach();
      return;
    } // respecter le choix du visiteur
    if (prete) return; // le film a le son
    const target = e.target as Element | null;
    // déplacer un panneau n'est pas demander du son ; lancer le film, c'est demander le sien
    if (target && target.closest && target.closest("#soundToggle, #playerVolume, #playerMute, [data-ecouter], .window-bar, [data-film-touche]")) return;
    playRadio().then(detach).catch(playFailed);
  }
  function detach() {
    (["click", "keydown", "touchend"] as const).forEach((ev) => window.removeEventListener(ev, tryStart));
  }
  if (STREAM_URL)
    (["click", "keydown", "touchend"] as const).forEach((ev) => window.addEventListener(ev, tryStart, { passive: true }));

  // la touche RADIO / VIDÉO bascule radio <-> son des vidéos
  if (btn)
    btn.addEventListener("click", () => {
      userChose = true;
      reprendreLeSon();
      if (mode === "radio") {
        playVideos();
      } else {
        playRadio().catch(playFailed);
      }
    });

  // les touches ÉCOUTER lancent et arrêtent la radio : celle de l'en-tête, et la grande de l'accueil (elle est dans le
  // contenu de la page, d'où l'écoute sur le document)
  function toggleRadio() {
    userChose = true;
    detach();
    reprendreLeSon();
    if (wanted) stopRadio();
    else playRadio().catch(playFailed);
  }
  document.addEventListener("click", (e) => {
    if (STREAM_URL && (e.target as Element).closest?.("[data-ecouter]")) toggleRadio();
  });

  // écran verrouillé et boutons du casque
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", () => {
        userChose = true;
        reprendreLeSon();
        playRadio().catch(playFailed);
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        userChose = true;
        reprendreLeSon();
        stopRadio();
      });
    } catch (e) {}
  }

  setLabel();
  restState();
  return {
    setOnAir(on) {
      onAir = on ? "ON AIR" : "OFF AIR";
      player.dataset.air = on ? "on" : "off";
      status.textContent = onAir;
    },
    setMeta(d) {
      if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: d ? d.title : "Parabole Radio",
        artist: d ? d.artist || "" : "Paris 18",
        album: "Parabole Radio",
        artwork: [{ src: "/PARABOLE%20RADIO/OVERLAY/logo.webp", sizes: "240x300", type: "image/webp" }],
      });
    },
    signal() {
      const a = analysis;
      if (!a.kickAnalyser || !a.kick) return null;
      a.kickAnalyser.getFloatTimeDomainData(a.kick);
      return a.kick;
    },
    preterLeSon() {
      // Le visiteur a choisi le son du film : le premier clic ne lancera plus la radio d'office.
      userChose = true;
      detach();
      prete ??= { radio: wanted };
      if (wanted) stopRadio();
      v.muted = true;
      const pret = prete;
      return () => {
        if (prete !== pret) return; // repris entre-temps par une touche du son : rien à rendre
        prete = null;
        if (pret.radio) playRadio().catch(playFailed);
        else if (mode === "video") v.muted = false;
      };
    },
  };
})();
