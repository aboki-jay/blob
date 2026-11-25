import geist from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline';
import inter from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline';

/**
 * Inter and Geist (both SIL Open Font License) are bundled inside the script
 * and handed to the browser as raw bytes. That way Blob needs no font files
 * exposed to websites, makes no network request, and is not affected by a
 * website's own font rules. The family names are prefixed so they cannot
 * clash with fonts the website uses.
 */
const FAMILIES: [name: string, dataUrl: string][] = [
  ['Blob Inter', inter],
  ['Blob Geist', geist],
];

function decode(dataUrl: string): ArrayBuffer {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Adds Blob's fonts to the page. Returns a function that removes them again. */
export function loadFonts(): () => void {
  const added: FontFace[] = [];
  try {
    for (const [name, dataUrl] of FAMILIES) {
      const face = new FontFace(name, decode(dataUrl), { weight: '100 900', style: 'normal' });
      document.fonts.add(face);
      added.push(face);
      void face.load().catch(() => undefined);
    }
  } catch {
    // Fonts are a nicety. Without them the system font is used.
  }
  return () => added.forEach((face) => document.fonts.delete(face));
}
