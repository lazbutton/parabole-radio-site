// ---------- AUDIO : LA RADIO D'ABORD, LES VIDÉOS MUETTES ----------
// Les navigateurs interdisent le son avant une interaction du visiteur : on essaie de lancer la radio au premier clic,
// appui ou touche, et on réessaie jusqu'à ce qu'elle joue vraiment. La touche jaune de la barre du haut bascule entre
// la radio et le son des vidéos ; la touche de lecture du bandeau lance et arrête la radio. Un flux coupé se reconnecte
// tout seul. L'élément <audio> et ce module vivent dans la coque : la navigation ne les touche jamais.

const playerEl = document.getElementById("player");
/** Le flux, donné par l'adaptateur de la station et écrit dans la page au build (Band.astro). */
export const STREAM_URL = playerEl?.dataset.flux ?? "";

export interface RadioControl {
  /** Appelés par le direct : la station est-elle à l'antenne, et que joue-t-elle. */
  setOnAir(on: boolean): void;
  setMeta(d: { title: string; artist?: string } | null): void;
  /** Lu par l'oscilloscope : les 4 096 derniers échantillons des basses, ou null sans analyse. */
  signal(): { data: Float32Array<ArrayBuffer>; rate: number; kick: Float32Array<ArrayBuffer> } | null;
}

export const radioControl: RadioControl | null = (function audioControl() {
  const v = document.getElementById("backgroundVideo") as HTMLVideoElement | null;
  const radio = document.getElementById("radioStream") as HTMLAudioElement | null;
  const btn = document.getElementById("soundToggle");
  const player = playerEl;
  const toggle = document.getElementById("playerToggle") as HTMLButtonElement;
  const volume = document.getElementById("playerVolume") as HTMLInputElement;
  const status = document.getElementById("playerStatus")!;
  if (!v || !radio || !player) return null;
  v.muted = true; // les vidéos muettes par défaut
  v.volume = 0.7;
  let mode: "radio" | "video" = "radio";
  let userChose = false; // vrai dès que le visiteur touche la touche jaune ou le lecteur
  let wanted = false; // le visiteur veut la radio : un flux coupé se reconnecte
  let retry: ReturnType<typeof setTimeout> | undefined,
    retryDelay = 3000;
  let onAir = STREAM_URL ? "ON AIR" : "OFF AIR"; // affiné par le direct (setOnAir)
  player.dataset.air = STREAM_URL ? "on" : "off";

  // L'analyse du son pour l'oscilloscope, sur ordinateur avec Chrome ou Edge (le moteur où elle a été testée) : le flux
  // passe alors par Web Audio, où l'oscilloscope le lit. Pas sur téléphone (le son qui passe par là peut s'arrêter
  // quand l'écran se verrouille), ni dans Safari ou Firefox. Le flux doit se laisser lire par les autres sites (CORS ;
  // Radio Cult le permet) : s'il refuse, la radio joue comme avant et l'oscilloscope reprend sa simulation.
  const uaData = (navigator as Navigator & { userAgentData?: { mobile: boolean } }).userAgentData;
  const analysis = {
    ctx: null as AudioContext | null,
    analyser: null as AnalyserNode | null,
    gain: null as GainNode | null,
    data: null as Float32Array<ArrayBuffer> | null,
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
  // les haut-parleurs à travers le volume, et vers l'oscilloscope à travers un passe-bas.
  function analyse() {
    const a = analysis;
    if (!a.wanted || a.analyser || !a.ctx || a.ctx.state !== "running") return;
    try {
      const lowpass = a.ctx.createBiquadFilter(),
        analyser = a.ctx.createAnalyser(),
        gain = a.ctx.createGain();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 1200; // l'oscilloscope montre le beat, pas le souffle
      analyser.fftSize = 4096;
      const source = a.ctx.createMediaElementSource(radio!); // dès lors, le son passe par le graphe
      source.connect(gain).connect(a.ctx.destination);
      source.connect(lowpass).connect(analyser);
      const kickFilter = a.ctx.createBiquadFilter(),
        kickAnalyser = a.ctx.createAnalyser();
      kickFilter.type = "lowpass";
      kickFilter.frequency.value = 150; // la grosse caisse, pour les beats (BEAT)
      kickAnalyser.fftSize = 1024; // environ 20 ms
      source.connect(kickFilter).connect(kickAnalyser);
      Object.assign(a, {
        analyser,
        gain,
        data: new Float32Array(analyser.fftSize),
        kickAnalyser,
        kick: new Float32Array(kickAnalyser.fftSize),
      });
      applyVolume();
    } catch (e) {
      a.wanted = false;
    }
  }
  // ... sur chaque beat trouvé (BEAT), le panneau ON AIR s'illumine
  player.addEventListener("beat", () => {
    if (player.dataset.state !== "playing") return;
    const sign = player.querySelector(".player-onair");
    if (sign && sign.animate)
      sign.animate([{ boxShadow: "0 0 16px #fff039" }, { boxShadow: "0 0 0 rgba(255,240,57,0)" }], { duration: 300, easing: "ease-out" });
  });

  function setState(state: string) {
    player!.dataset.state = state;
    status.textContent = onAir; // la connexion se voit au témoin et au symbole qui clignotent, pas ici
    toggle.setAttribute(
      "aria-label",
      state === "playing" || state === "loading" || state === "error" ? "Arrêter la radio" : "Écouter la radio",
    );
  }
  const restState = () => setState(STREAM_URL ? "idle" : "off");
  function setLabel() {
    if (!btn) return;
    btn.textContent = mode === "radio" ? "RADIO" : "VIDÉO";
    btn.title = mode === "radio" ? "Son : radio en direct — cliquer pour le son des vidéos" : "Son : vidéos — cliquer pour la radio";
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
      if (ev === "error" && radio.crossOrigin && !analysis.analyser) {
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

  // Le volume, gardé dans ce navigateur, et une touche muet. Avec l'analyse, les deux sont un gain placé après la prise
  // de l'oscilloscope : il lit le son à plein niveau. Un iPhone ne laisse pas une page régler le volume (ce sont les
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
    const target = e.target as Element | null;
    if (target && target.closest && target.closest("#soundToggle, #playerToggle, #playerVolume, #playerMute, [data-ecouter], .window-bar")) return; // déplacer un panneau n'est pas demander du son
    playRadio().then(detach).catch(playFailed);
  }
  function detach() {
    (["click", "keydown", "touchend"] as const).forEach((ev) => window.removeEventListener(ev, tryStart));
  }
  if (STREAM_URL)
    (["click", "keydown", "touchend"] as const).forEach((ev) => window.addEventListener(ev, tryStart, { passive: true }));

  // la touche jaune bascule radio <-> son des vidéos
  if (btn)
    btn.addEventListener("click", () => {
      userChose = true;
      if (mode === "radio") {
        playVideos();
      } else {
        playRadio().catch(playFailed);
      }
    });

  // la touche de lecture du bandeau lance et arrête la radio ; la grande touche ÉCOUTER de l'accueil aussi (elle est
  // dans le contenu de la page, d'où l'écoute sur le document)
  function toggleRadio() {
    userChose = true;
    detach();
    if (wanted) stopRadio();
    else playRadio().catch(playFailed);
  }
  toggle.disabled = !STREAM_URL;
  toggle.addEventListener("click", toggleRadio);
  document.addEventListener("click", (e) => {
    if (STREAM_URL && (e.target as Element).closest?.("[data-ecouter]")) toggleRadio();
  });

  // écran verrouillé et boutons du casque
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", () => {
        userChose = true;
        playRadio().catch(playFailed);
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        userChose = true;
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
      if (!a.analyser || !a.kickAnalyser || !a.data || !a.kick || !a.ctx) return null;
      a.analyser.getFloatTimeDomainData(a.data);
      a.kickAnalyser.getFloatTimeDomainData(a.kick);
      return { data: a.data, rate: a.ctx.sampleRate, kick: a.kick };
    },
  };
})();
