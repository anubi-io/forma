import { mkdir, writeFile } from "node:fs/promises";
const products = [];
for (let page = 1; page <= 10; page++) {
  const response = await fetch(
    `https://www.makera.com/products.json?limit=250&page=${page}`,
  );
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
  const data = await response.json();
  products.push(...data.products);
  if (data.products.length < 250) break;
}
const tools = [];
const omitted = [];
for (const p of products) {
  if (
    !/Spiral|Ball Nose|Engraving Bit|Chamfering Bit|Thread Milling Bit|Coating Drill Bit|Coating Corn Bit|Solder Mask Removal/.test(
      p.title,
    )
  )
    continue;
  const productShank = /6\s*mm/.test(p.title)
    ? 6
    : /4\s*mm/.test(p.title)
      ? 4
      : 3.175;
  const unique = new Set();
  for (const v of p.variants) {
    const spec = v.title
      .split(" / ")[0]
      .replace(/\s*\(\d+pcs\)/, "")
      .trim();
    const uniqueSpec = /Chamfer/.test(p.title)
      ? v.title.replace(/ \/ \d+ pcs?$/, "")
      : spec;
    if (unique.has(uniqueSpec)) continue;
    unique.add(uniqueSpec);
    let shank = productShank,
      kind = "unsupported",
      diameter = shank,
      length,
      angle,
      tip,
      pitch,
      neck,
      note;
    const size = spec.match(/^(\d+(?:\.\d+)?)mm\s*\*\s*(\d+(?:\.\d+)?)mm/);
    const engraving = spec.match(
      /^(\d+(?:\.\d+)?)[º°]\s*\*\s*(\d+(?:\.\d+)?)mm/,
    );
    if (size) {
      diameter = +size[1];
      length = +size[2];
      kind = /Ball Nose/.test(p.title) ? "ball" : "flat";
    }
    if (engraving) {
      kind = "v";
      angle = +engraving[1];
      tip = +engraving[2];
    }
    if (/Chamfer/.test(p.title)) {
      kind = "v";
      angle = Number(spec.match(/^(\d+(?:\.\d+)?)[º°]/)?.[1]);
      shank = Number(v.title.match(/\/\s*(\d+(?:\.\d+)?)mm/)?.[1]);
      // Makera's reference table specifies 0.1mm × 90° Chamfering.
      // Fail on source changes instead of silently inventing dimensions.
      const reference = p.body_html.match(
        /(\d+(?:\.\d+)?)mm\s*\*\s*(\d+)[º°]\s*Chamfering/,
      );
      if (!reference || +reference[2] !== angle || !Number.isFinite(shank))
        throw new Error(`Unrecognized chamfer geometry: ${v.title}`);
      tip = +reference[1];
      diameter = shank;
      note =
        "Tip diameter from Makera's reference table. Maximum cone diameter equals the shank diameter; cutting length is not specified.";
      if (tools.some((t) => t.id === `${p.handle}-${diameter}`)) continue;
    }
    const thread = spec.match(
      /d(\d+(?:\.\d+)?)(?:mm)?\)\s*\*\s*(\d+(?:\.\d+)?)mm/,
    );
    if (thread) {
      diameter = +thread[1];
      length = +thread[2];
      const nominal = spec.match(/^M(\d+(?:\.\d+)?)/)?.[1];
      // Published reference pitches; the neck is explicitly an idealization.
      pitch = {
        1: 0.25,
        2: 0.4,
        2.5: 0.45,
        3: 0.5,
        4: 0.7,
        5: 0.8,
        6: 1,
        8: 1.25,
      }[nominal];
      if (!pitch || !/Included Angle:\s*(?:<[^>]*>\s*)*60/.test(p.body_html))
        throw new Error(`Unverified thread geometry: ${p.title} ${spec}`);
      kind = "thread";
      angle = 60;
      neck = Math.max(diameter * 0.2, diameter - 1.226869 * pitch);
      note =
        "WebGPU thread removal. Published diameter, 60° angle and reference pitch; idealized single-form tooth and estimated neck. The helix follows G-code.";
    }
    if (/Solder Mask/.test(p.title)) {
      const tipSpec = p.body_html
        .replace(/<[^>]*>/g, " ")
        .match(/Tip Diameter:\s*(\d+(?:\.\d+)?)mm/);
      if (!tipSpec) throw new Error(`Missing tip diameter: ${p.title}`);
      diameter = tip = +tipSpec[1];
    }
    if (/Coating Drill|Ball Nose Engraving|Solder Mask/.test(p.title)) {
      kind = "unsupported";
      note =
        "Special profile or incomplete geometry: listed in the catalog, but material removal is not supported by the current engine.";
    }
    if (
      !size &&
      !engraving &&
      !/Chamfer|Thread Milling|Solder Mask/.test(p.title)
    ) {
      omitted.push({
        product: p.title,
        spec,
        reason: "Assortment, not an individual tool",
      });
      continue;
    }
    tools.push({
      id: /Chamfer/.test(p.title)
        ? `${p.handle}-${diameter}`
        : `${p.handle}-${spec.replace(/[^\w.]+/g, "-")}`,
      name: `${p.title} · ${/Chamfer/.test(p.title) ? `${diameter} mm · ${angle}°` : spec}`,
      kind,
      diameter,
      length,
      angle,
      tip,
      pitch,
      neck,
      shank,
      source: `https://www.makera.com/products/${p.handle}`,
      note,
    });
  }
}
await mkdir("src/data", { recursive: true });
await writeFile(
  "src/data/makera.json",
  JSON.stringify(
    {
      fetchedAt: new Date().toISOString().slice(0, 10),
      source: "https://www.makera.com/collections/cnc-bits",
      tools,
      omitted,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `${tools.length} tools imported; ${tools.filter((t) => t.kind !== "unsupported").length} supported by the simulator; ${omitted.length} assortments excluded.`,
);
