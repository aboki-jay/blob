# Third-party material

Blob's own code is MIT licensed (see [LICENSE](LICENSE)). The built extension also includes the following.

| What | Where | Licence |
| --- | --- | --- |
| Inter (font) | bundled from `@fontsource-variable/inter` | SIL Open Font License 1.1 |
| Geist (font) | bundled from `@fontsource-variable/geist` | SIL Open Font License 1.1 |
| Appearance icons (moon, sun-dim and monitor-cog) | [Lucide](https://github.com/lucide-icons/lucide/tree/main/icons) | [Lucide and Feather licence notices](public/LUCIDE-LICENSE.txt) |
| React, React DOM | bundled | MIT |
| Interface icons (close, history, comment, lock, resolved, disclosure, send, settings, file, warning, laugh, filter, log-in, external-link and check controls, the navigation inbox and the placeholder avatar shapes) in `assets/icons/` | exported from the project's Figma file | See interface icon attribution from [Lucide](https://lucide.dev), ISC |
| Blob mascot (`assets/icons/mascot.svg`, `public/icon/*.png`) | exported from the project's Figma file | Project artwork. Its licence has not been stated separately; see docs/STATUS.md. |

The full licence texts ship inside each package under `node_modules/` after `npm install`.

Only add assets and dependencies that can be redistributed. Access to the Figma file does not by itself grant the right to redistribute everything in it.
