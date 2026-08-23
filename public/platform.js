export const AMID_VERSION = "0.2.0-dev";

export const CLIENT_MODES = Object.freeze({
  mobile: "mobile",
  desktop: "desktop",
});

const desktopMedia = window.matchMedia("(min-width: 1100px) and (pointer: fine)");

export function detectClientMode() {
  return desktopMedia.matches ? CLIENT_MODES.desktop : CLIENT_MODES.mobile;
}

export function applyClientMode() {
  const mode = detectClientMode();
  document.documentElement.dataset.client = mode;
  document.documentElement.dataset.amidVersion = AMID_VERSION;
  document.querySelectorAll("[data-amid-version-label]").forEach((node) => {
    node.textContent = `v${AMID_VERSION}`;
  });
  return mode;
}

export function observeClientMode(listener) {
  const handleChange = () => listener(applyClientMode());
  desktopMedia.addEventListener?.("change", handleChange);
  return () => desktopMedia.removeEventListener?.("change", handleChange);
}
