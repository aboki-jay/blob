# Third-party material

Blob's own code is MIT licensed (see [LICENSE](LICENSE)). The built extension also includes the following.

| What | Where | Licence |
| --- | --- | --- |
| Inter (font) | bundled from `@fontsource-variable/inter` | SIL Open Font License 1.1 |
| Geist (font) | bundled from `@fontsource-variable/geist` | SIL Open Font License 1.1 |
| React, React DOM | bundled | MIT |
| Interface icons (`x`, `history`, `message-square-text`, `message-square-lock`) in `assets/icons/` | exported from the project's Figma file; they are [Lucide](https://lucide.dev) icons | ISC |
| Blob mascot (`assets/icons/mascot.svg`, `public/icon/*.png`) | exported from the project's Figma file | Project artwork. Its licence has not been stated separately; see docs/STATUS.md. |

The full licence texts ship inside each package under `node_modules/` after `npm install`.

Only add assets and dependencies that can be redistributed. Access to the Figma file does not by itself grant the right to redistribute everything in it.
