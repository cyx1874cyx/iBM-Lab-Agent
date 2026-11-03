import { useCallback, useLayoutEffect, useState } from "react";

// Keep independent fields so a child saving its folder cannot overwrite its
// parent's active tab. The cache also works when browser storage is disabled.
const cache = new Map();
const viewKey = (projectId, field) => `ib-project-view:${encodeURIComponent(projectId)}:${field}`;

function readValue(key, fallback) {
 try {
  const raw = localStorage.getItem(key);
  if (raw !== null) {
   const value = JSON.parse(raw);
   if (typeof value === typeof fallback && (typeof value !== "number" || (Number.isFinite(value) && value >= 0))) {
    cache.set(key, value);
    return value;
   }
  }
 } catch { /* Private browsing or invalid saved JSON must not block the view. */ }
 return cache.has(key) ? cache.get(key) : fallback;
}

function writeValue(key, value) {
 cache.set(key, value);
 try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Use the session cache. */ }
}

export function useProjectViewValue(projectId, field, fallback) {
 const key = viewKey(projectId, field);
 const [state, setState] = useState(() => ({ key, value: readValue(key, fallback) }));
 const value = state.key === key ? state.value : readValue(key, fallback);
 // A reused Project instance must not carry another project's selection over.
 if (state.key !== key) setState({ key, value });
 const update = useCallback(next => {
  const value = typeof next === "function" ? next(readValue(key, fallback)) : next;
  writeValue(key, value);
  setState({ key, value });
 }, [key, fallback]);
 return [value, update];
}

function scrollHost(node) {
 for (let parent = node?.parentElement; parent; parent = parent.parentElement) {
  if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
 }
 return document.scrollingElement;
}

export function useProjectViewScroll(root, projectId, folderId, ready) {
 const key = viewKey(projectId, `literature-scroll:${encodeURIComponent(folderId)}`);
 useLayoutEffect(() => {
  if (!ready || !root.current) return undefined;
  const host = scrollHost(root.current);
  if (!host) return undefined;
  const scrollEvents = host === document.scrollingElement ? window : host;
  let position = readValue(key, 0);
  let frame;
  const save = () => {
   position = host.scrollTop;
   if (frame === undefined) frame = requestAnimationFrame(() => { frame = undefined; writeValue(key, position); });
  };
  // Folder buttons load asynchronously. Restore once their layout exists,
  // synchronously before paint, so a later frame cannot undo a user's scroll.
  host.scrollTop = position;
  scrollEvents.addEventListener("scroll", save, { passive: true });
  const flush = () => writeValue(key, position);
  window.addEventListener("pagehide", flush);
  return () => {
   if (frame !== undefined) cancelAnimationFrame(frame);
   scrollEvents.removeEventListener("scroll", save);
   window.removeEventListener("pagehide", flush);
   // Use the last observed position: removing a long list can already have
   // clamped the shared container's scrollTop by the time React cleans up.
   flush();
  };
 }, [root, key, ready]);
}
