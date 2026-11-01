// ---------- RÉORDONNER UNE LISTE : morceaux, artistes d'un show, liens d'un artiste ----------
// Par glisser, avec la poignée ⋮⋮, à la souris comme au doigt (évènements pointer : le glisser-déposer HTML ne marche
// pas sur téléphone) ; ou avec les boutons ↑ et ↓, au clavier et au lecteur d'écran. ✕ retire la ligne. L'ordre est
// celui des champs dans la page : le formulaire l'envoie tel quel. Chaque changement est annoncé par « sortable:change ».

/** La ligne de la liste qui contient cet élément. */
function rowOf(list: HTMLElement, element: Element): HTMLElement | null {
  let row: Element | null = element;
  while (row && row.parentElement !== list) row = row.parentElement;
  return row as HTMLElement | null;
}

export function sortable(list: HTMLElement): void {
  const changed = () => list.dispatchEvent(new CustomEvent("sortable:change", { bubbles: true }));

  list.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-move], [data-remove]");
    const row = button && rowOf(list, button);
    if (!button || !row) return;
    if (button.hasAttribute("data-remove")) {
      // Le focus passe à la ligne d'après (ou d'avant), pour ne pas se perdre en haut de la page.
      const neighbour = (row.nextElementSibling ?? row.previousElementSibling) as HTMLElement | null;
      row.remove();
      (neighbour?.querySelector<HTMLElement>("[data-remove]") ?? list.closest("fieldset, .picks")?.querySelector<HTMLElement>("button, input"))?.focus();
    } else if (button.dataset.move === "up" && row.previousElementSibling) row.previousElementSibling.before(row);
    else if (button.dataset.move === "down" && row.nextElementSibling) row.nextElementSibling.after(row);
    else return;
    if (row.isConnected) button.focus();
    changed();
  });

  list.addEventListener("pointerdown", (event) => {
    const handle = (event.target as Element).closest<HTMLElement>(".drag-handle");
    const row = handle && rowOf(list, handle);
    if (!handle || !row || event.button !== 0) return;
    event.preventDefault();
    row.classList.add("is-dragging");
    let moved = false;
    // Le geste se suit sur tout le document : la ligne déplacée quitte la page un instant à chaque pas, et perd la
    // capture du pointeur.
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      // Près du bord de l'écran, la page défile : une longue tracklist se réordonne aussi au téléphone.
      if (e.clientY > innerHeight - 70) scrollBy(0, 14);
      else if (e.clientY < 120) scrollBy(0, -14);
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const target = under && list.contains(under) ? rowOf(list, under) : null;
      if (!target || target === row) return;
      const box = target.getBoundingClientRect();
      if (e.clientY < box.top + box.height / 2) target.before(row);
      else target.after(row);
      moved = true;
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      row.classList.remove("is-dragging");
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      if (moved) changed();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  });
}
