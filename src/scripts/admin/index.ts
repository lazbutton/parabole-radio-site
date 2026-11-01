// ---------- L'ADMIN DANS LE NAVIGATEUR ----------
// Les écrans marchent sans JavaScript (formulaires envoyés au serveur). Ce script les rend plus agréables : listes à
// réordonner, artistes et étiquettes à choisir, tracklist collée, aperçu du Markdown, rappel avant de quitter une fiche
// modifiée, et la date de diffusion exigée avant de publier.
import { picks } from "./picks";
import { sortable } from "./sortable";
import { tracklist } from "./tracklist";

document.querySelectorAll<HTMLElement>("[data-picks]").forEach(picks);
document.querySelectorAll<HTMLElement>("[data-tracklist]").forEach(tracklist);

// Les liens d'un artiste : une ligne vide de plus, à réordonner.
document.querySelectorAll<HTMLElement>("[data-rows]").forEach((root) => {
  const list = root.querySelector<HTMLElement>("[data-rows-list]");
  const template = root.querySelector<HTMLTemplateElement>("template");
  if (!list || !template) return;
  root.querySelector("[data-rows-add]")?.addEventListener("click", () => {
    const row = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    list.append(row);
    row.querySelector<HTMLInputElement>("input")?.focus();
    list.dispatchEvent(new CustomEvent("sortable:change", { bubbles: true }));
  });
  sortable(list);
});

// Le Markdown : « Écrire » ou « Aperçu », rendu par le serveur comme il le sera sur le site (sans HTML brut).
document.querySelectorAll<HTMLElement>("[data-markdown]").forEach((root) => {
  const area = root.querySelector<HTMLTextAreaElement>("textarea");
  const preview = root.querySelector<HTMLElement>(".md-preview");
  const [write, show] = root.querySelectorAll<HTMLButtonElement>(".md-tabs button");
  if (!area || !preview || !write || !show) return;
  const select = (showing: boolean) => {
    area.hidden = showing;
    preview.hidden = !showing;
    write.setAttribute("aria-pressed", String(!showing));
    show.setAttribute("aria-pressed", String(showing));
  };
  show.addEventListener("click", async () => {
    preview.textContent = "…";
    select(true);
    try {
      const response = await fetch("/admin/apercu", { method: "POST", body: new URLSearchParams({ texte: area.value }) });
      if (!response.ok) throw new Error(String(response.status));
      preview.innerHTML = await response.text();
    } catch {
      preview.textContent = "Aperçu indisponible : ta session a peut-être expiré.";
    }
  });
  write.addEventListener("click", () => {
    select(false);
    area.focus();
  });
});

// Les fiches : la date de diffusion avant de publier, et un rappel avant de quitter sans enregistrer.
document.querySelectorAll<HTMLFormElement>("form[data-sheet]").forEach((form) => {
  let dirty = false;
  const touch = () => (dirty = true);
  form.addEventListener("input", touch);
  form.addEventListener("sortable:change", touch);
  form.addEventListener("submit", (event) => {
    const intent = (event.submitter as HTMLButtonElement | null)?.value ?? "save";
    const date = form.querySelector<HTMLInputElement>("[data-needed-to-publish]");
    const publishing = intent === "publish" || (intent === "save" && form.dataset.status === "published");
    if (date && publishing && !date.value) {
      event.preventDefault();
      date.setCustomValidity("Il faut une date de diffusion pour publier.");
      date.reportValidity();
      date.addEventListener("input", () => date.setCustomValidity(""), { once: true });
      return;
    }
    dirty = false;
  });
  addEventListener("beforeunload", (event) => {
    if (dirty) event.preventDefault();
  });
});

// Le menu du compte se referme quand on clique ailleurs.
document.addEventListener("click", (event) => {
  document.querySelectorAll<HTMLDetailsElement>("details.admin-account[open]").forEach((menu) => {
    if (!menu.contains(event.target as Node)) menu.open = false;
  });
});
