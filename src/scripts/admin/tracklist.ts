// ---------- LA TRACKLIST D'UN SHOW ----------
// Un morceau par ligne : minutage, artiste, titre, lien Hopper. « Ajouter un morceau » ajoute une ligne vide ;
// « Coller une tracklist » lit le texte collé (« 12:30 Artiste – Titre » par ligne) avec la même fonction que le
// serveur, et ajoute les lignes à la fin. On réordonne par glisser ou avec ↑ ↓. Sans JavaScript, le texte collé est
// lu par le serveur à l'enregistrement.
import { parseTracklist, type TrackLine } from "@parabole/cms/tracklist";
import { sortable } from "./sortable";

export function tracklist(root: HTMLElement): void {
  const list = root.querySelector<HTMLElement>(".tracks");
  const template = root.querySelector<HTMLTemplateElement>("template");
  const pasted = root.querySelector<HTMLTextAreaElement>("textarea[name=pasted]");
  const status = root.querySelector<HTMLElement>("[data-tracks-status]");
  if (!list || !template) return;

  const renumber = () => list.querySelectorAll(".track-number").forEach((number, index) => (number.textContent = String(index + 1)));
  const isEmpty = (row: Element) => [...row.querySelectorAll("input")].every((input) => !input.value.trim());

  function addRow(line?: TrackLine): HTMLElement {
    const row = template!.content.firstElementChild!.cloneNode(true) as HTMLElement;
    if (line) {
      row.querySelector<HTMLInputElement>("[name=trackStart]")!.value = line.start;
      row.querySelector<HTMLInputElement>("[name=trackArtist]")!.value = line.artist;
      row.querySelector<HTMLInputElement>("[name=trackTitle]")!.value = line.title;
      row.querySelector<HTMLInputElement>("[name=trackHopper]")!.value = line.hopperUrl;
    }
    list!.append(row);
    return row;
  }

  root.querySelector("[data-add-track]")?.addEventListener("click", () => {
    const row = addRow();
    renumber();
    row.querySelector<HTMLInputElement>("[name=trackStart]")?.focus();
    list.dispatchEvent(new CustomEvent("sortable:change", { bubbles: true }));
  });

  root.querySelector("[data-paste]")?.addEventListener("click", () => {
    if (!pasted) return;
    const lines = parseTracklist(pasted.value);
    if (!lines.length) {
      if (status) status.textContent = "Aucun morceau reconnu : une ligne par morceau, « 12:30 Artiste – Titre ».";
      pasted.focus();
      return;
    }
    // Les lignes vides laissées en fin de tableau cèdent la place aux morceaux collés.
    for (const row of [...list.children].reverse()) {
      if (!isEmpty(row)) break;
      row.remove();
    }
    lines.forEach((line) => addRow(line));
    pasted.value = "";
    renumber();
    const incomplete = lines.filter((line) => !line.artist || !line.title).length;
    if (status)
      status.textContent =
        `${lines.length} ${lines.length > 1 ? "morceaux ajoutés" : "morceau ajouté"} à la fin de la tracklist.` +
        (incomplete ? ` ${incomplete} à compléter (artiste ou titre manquant).` : "");
    root.querySelector<HTMLDetailsElement>("details.paste")?.removeAttribute("open");
    list.dispatchEvent(new CustomEvent("sortable:change", { bubbles: true }));
  });

  list.addEventListener("sortable:change", renumber);
  sortable(list);
}
