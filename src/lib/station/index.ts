/**
 * La station que lit notre API : Radio Cult aujourd'hui. Le jour où BUTTON (Radiocompas) la remplacera, il suffira
 * d'écrire son adaptateur, avec les mêmes exports (stream, timezone, nowPlaying, schedule, history, et, s'il les a,
 * subscribe pour le direct en temps réel et upcomingSlots pour les passages d'un artiste ; sinon des versions qui
 * renvoient null et []) et le même format
 * (types.ts), puis de le brancher sur la ligne ci-dessous. Ni les routes ni la page ne changent.
 */
export * from "./radiocult";
export type * from "./types";
