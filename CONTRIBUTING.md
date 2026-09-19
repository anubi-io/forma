# Contributing to Forma

Reports from real workflows are especially helpful. Keep issues, pull requests, documentation, and code comments in English so everyone can participate.

## Report a problem

Open a GitHub issue with:

- What you expected and what happened, plus steps to reproduce it.
- Your browser, operating system, and the backend shown in the status bar (WebGPU or CPU).
- Stock dimensions, origins, tool geometry, quality setting, and whether you used TOP/BOTTOM or Threads.
- The reported G-code line or diagnostic, and a small example file or screenshot if possible.

Remove private geometry, customer information, and other sensitive details before attaching a program, MKS archive, or project backup. A minimal synthetic example is often enough. For tool catalog corrections, include the official product source and dimensions.

## Work on the code

Use Node.js 22.12 or later and npm:

```sh
npm ci
npm run dev
```

Before submitting a change, run:

```sh
npm test
npm run build
```

For rendering, simulation, or browser workflow changes, also run the browser suite:

```sh
npx playwright install chromium
npm run test:gpu
```

The browser tests start their own Vite server and use Chromium with a WebGPU test flag. They require a working WebGPU adapter. Some platforms need additional browser system dependencies. That flag is confined to the test configuration; normal app use selects its backend automatically.

Keep changes focused and format the files you touch with Prettier. Add a regression test when fixing parser, geometry, import, or persistence behavior. Include a screenshot for visible UI changes and describe which checks you ran. GitHub CI runs the unit tests and production build; the GPU suite is run separately on a compatible machine.

## Find your way around

| Path              | Purpose                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `src/engine/`     | G-code parsing, import, analysis, simulation, GPU kernels, and workers |
| `src/scene/`      | Viewport, surface rendering, materials, and part selection             |
| `src/data/`       | Tool catalog, material presets, and built-in demo                      |
| `src/components/` | Tool library, timeline, and optimization panel                         |
| `src/App.tsx`     | Workspace UI and import/export                                         |
| `tests/`          | Unit tests and regression fixtures                                     |
| `tests/browser/`  | Playwright browser and CPU/GPU comparison tests                        |

To refresh the catalog from Makera's public product feed:

```sh
npm run catalog:update
```

Review the resulting data diff and sources before submitting it. Do not infer tool numbers, feeds, or speeds from product names. Preserve [third-party notices](THIRD_PARTY_NOTICES.md) and [codec fixture provenance](tests/fixtures/quicklz-reference.md).

## Brand assets

`public/logo.svg` preserves the supplied vector artwork. After installing Playwright Chromium, run `npm run brand:export` to regenerate the favicons, Apple icon, and logo-only social images. The exports use the original colors and proportions on a light background. `public/og-image.png` is 1200 × 630; `public/og-image-square.png` is 1200 × 1200. The wide image can also be uploaded in GitHub's repository social preview settings.

Social metadata in `index.html` points to `https://forma.okokok.design/`. Update those absolute URLs if the production domain changes.

## Contribution license

Submit only work you have the right to share. Unless explicitly agreed otherwise, contributions are provided under this repository's [MIT License](LICENSE). Dependencies and borrowed material must retain their applicable licenses and notices.
