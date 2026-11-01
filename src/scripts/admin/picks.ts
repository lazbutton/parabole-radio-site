// ---------- CHOISIR DES ARTISTES OU DES ÉTIQUETTES ----------
// On tape un nom (la liste propose ceux qui existent), puis « Ajouter » ou Entrée. Un nom connu devient son
// identifiant ; un nom nouveau part en « nouveau:… » et naît à l'enregistrement (un artiste, en brouillon). Sans
// JavaScript, le nom tapé est envoyé tel quel avec la fiche, et le serveur fait le même travail.
import { sortable } from "./sortable";

const NEW_PICK = "nouveau:";
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function picks(root: HTMLElement): void {
  const list = root.querySelector<HTMLElement>(".pick-list");
  const input = root.querySelector<HTMLInputElement>("[data-pick-input]");
  const button = root.querySelector<HTMLButtonElement>("[data-pick-add]");
  const template = root.querySelector<HTMLTemplateElement>("template");
  const status = root.querySelector<HTMLElement>("[data-pick-status]");
  if (!list || !input || !button || !template) return;
  const kind = root.dataset.kind;
  const options = [...(root.querySelector("datalist")?.options ?? [])];

  function add() {
    const typed = input!.value.replace(/\s+/g, " ").trim();
    if (!typed) return;
    const known = options.find((option) => normalize(option.value) === normalize(typed));
    const value = known?.dataset.id ?? `${NEW_PICK}${kind ? `${kind}:` : ""}${typed}`;
    const label = known?.value ?? typed;
    input!.value = "";
    const present = [...list!.querySelectorAll<HTMLInputElement>("input[type=hidden]")].some((field) => field.value === value || normalize(field.value) === normalize(value));
    if (present) {
      if (status) status.textContent = `${label} est déjà dans la liste.`;
      return;
    }
    const row = template!.content.firstElementChild!.cloneNode(true) as HTMLElement;
    row.querySelector(".pick-name")!.textContent = label;
    row.querySelector<HTMLInputElement>("input[type=hidden]")!.value = value;
    row.querySelectorAll<HTMLElement>("[aria-label]").forEach((element) => element.setAttribute("aria-label", element.getAttribute("aria-label")!.replace("…", label)));
    const badge = row.querySelector<HTMLElement>(".badge");
    if (badge) {
      if (!known) badge.textContent = root.dataset.newLabel ?? "nouveau";
      else if (known.dataset.status === "draft") badge.textContent = "brouillon";
      else badge.remove();
    }
    list!.append(row);
    if (status) status.textContent = known ? `${label} ajouté.` : `${label} ajouté : il sera créé à l'enregistrement.`;
    list!.dispatchEvent(new CustomEvent("sortable:change", { bubbles: true }));
  }

  button.addEventListener("click", add);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  });
  // Un nom choisi dans la liste proposée s'ajoute tout de suite.
  input.addEventListener("input", (event) => {
    if ((event as InputEvent).inputType === "insertReplacementText" || (!(event as InputEvent).inputType && options.some((option) => option.value === input.value))) add();
  });
  sortable(list);
}
