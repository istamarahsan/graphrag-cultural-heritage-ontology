import { parseArgs } from "@std/cli";
import { ontologyTripletSchema } from "./lib/extract.ts";
import z from "zod";
import path from "node:path";

const propertyCheatsheetSchema = z.record(
  z.object({
    domain: z.array(z.string()),
    range: z.array(z.string()),
  })
);

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["f", "c"],
  });
  if (!args.f) {
    console.error("Specify the tuples file with -f");
    return -1;
  }
  if (!args.c) {
    console.error("Specify valid property cheatsheet file with -c");
    return -1;
  }

  const stuff = await Deno.readTextFile(args.f).then((txt) => {
    return txt
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => JSON.parse(line));
  });
  const clean_stuff = stuff.map(ch => {
    return {
      ...ch,
      triplets: ch.triplets ? ch.triplets.filter(tr => !!tr) : []
    }
  });
  
  const chunkTriplets = z
    .array(
      z.object({
        chunkId: z.string(),
        triplets: z.array(ontologyTripletSchema),
      })
    )
    .parse(
      clean_stuff
    );
  const propertyCheatsheet = await Deno.readTextFile(args.c).then((txt) =>
    propertyCheatsheetSchema.parse(JSON.parse(txt))
  );
  const byChunkValidationResults = chunkTriplets.map(
    ({ chunkId, triplets }) => ({
      chunkId,
      triplets: triplets.map((triplet) => ({
        ...triplet,
        validation: {
          verdict:
            triplet.property in propertyCheatsheet &&
            propertyCheatsheet[triplet.property].domain.includes(
              triplet.domain
            ) &&
            propertyCheatsheet[triplet.property].range.includes(triplet.range),
          validProperty: triplet.property in propertyCheatsheet,
          validDomain:
            propertyCheatsheet[triplet.property]?.domain?.includes(
              triplet.domain
            ) ?? false,
          validRange:
            propertyCheatsheet[triplet.property]?.range?.includes(
              triplet.range
            ) ?? false,
        },
      })),
    })
  );
  const validationResults = {
    summary: {
      valid: byChunkValidationResults
        .flatMap((chunk) => chunk.triplets)
        .filter((it) => it.validation.verdict).length,
      total: byChunkValidationResults.flatMap((chunk) => chunk.triplets).length,
    },
    byChunk: byChunkValidationResults.map((chunk) => ({
      summary: {
        valid: chunk.triplets.filter((it) => it.validation.verdict).length,
        total: chunk.triplets.length,
      },
      ...chunk,
    })),
  };
  const outPath = path.join(
    path.dirname(args.f),
    path.basename(args.f, path.extname(args.f)) + "_validate.json"
  );
  await Deno.writeTextFile(
    outPath,
    JSON.stringify(validationResults, undefined, 2)
  );
}

if (import.meta.main) {
  await main();
}
