/**
 * Réordonner une liste par glisser, avec sa poignée, à la souris comme au doigt (évènements pointer : le
 * glisser-déposer HTML ne marche pas sur téléphone). Radix n'en propose pas. Les lignes portent data-sort-index ; la
 * poignée reçoit onPointerDown. Les boutons ↑ ↓ font le même travail au clavier, avec move().
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** La liste avec un élément déplacé de `from` à `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function useSortable<T>(items: T[], onChange: (items: T[]) => void) {
  const container = useRef<HTMLElement | null>(null);
  const latest = useRef({ items, onChange });
  latest.current = { items, onChange };
  const [dragging, setDragging] = useState<number | null>(null);

  const move = (from: number, to: number) => latest.current.onChange(moveItem(latest.current.items, from, to));

  const handle = (index: number) => ({
    onPointerDown(event: ReactPointerEvent) {
      if (event.button !== 0) return;
      event.preventDefault();
      const pointer = event.pointerId;
      let current = index;
      setDragging(index);
      // Le geste se suit sur tout le document : la ligne déplacée change de place dans la page à chaque pas.
      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== pointer) return;
        // Près du bord de l'écran, la page défile : une longue tracklist se réordonne aussi au téléphone.
        if (e.clientY > innerHeight - 80) scrollBy(0, 16);
        else if (e.clientY < 140) scrollBy(0, -16);
        const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-sort-index]");
        if (!over || !container.current?.contains(over)) return;
        const target = Number(over.dataset.sortIndex);
        const box = over.getBoundingClientRect();
        const upperHalf = e.clientY < box.top + box.height / 2;
        // On ne passe la ligne survolée qu'une fois sa moitié franchie : pas de va-et-vient.
        if ((target < current && upperHalf) || (target > current && !upperHalf)) {
          move(current, target);
          current = target;
          setDragging(target);
        }
      };
      const onEnd = (e: PointerEvent) => {
        if (e.pointerId !== pointer) return;
        setDragging(null);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onEnd);
        document.removeEventListener("pointercancel", onEnd);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onEnd);
      document.addEventListener("pointercancel", onEnd);
    },
  });

  return { container, dragging, handle, move };
}
