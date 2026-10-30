# Splash intro fonts

These are the 13 typefaces used by the splash intro (`src/features/splash`). Each file:

- contains only the glyphs `MacroCunte` and space
- is about 2–8 KB as woff2, about 52 KB for all 13
- is served from the app's own origin, because the CSP has `font-src 'self'` (FR-015)

How the files were made:

- **Source:** https://github.com/google/fonts at commit `6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec`, the `ofl/<family>/` folders.
- **Variable fonts** are pinned to one instance with `fontTools.varLib.instancer`:
  - Inter at `wght=800, opsz=32`
  - Playfair Display Italic at `wght=700`
  - Cinzel at `wght=700`
- **Renaming:** every subset is renamed to `MC Intro <id>`. A subset counts as a modified version under the OFL, so it must not use a Reserved Font Name. The CSS refers to these names only.
- **Licence:** [OFL.txt](OFL.txt) has each family's copyright line and the licence text.

## Regenerate

You need Python 3.12+ with `fonttools` and `brotli`. They are dev-machine tools, not app dependencies.

```bash
python -m venv .ftvenv
.ftvenv/Scripts/python -m pip install fonttools brotli
.ftvenv/Scripts/python -I scripts/build-intro-fonts.py <download-dir> frontend/public/fonts/intro
```

The script downloads the pinned sources into `<download-dir>`, which is a scratch folder outside the repo. It then writes one `<id>.woff2` per typeface. The ids match `TYPEFACES` in `src/features/splash/timeline.ts`.
