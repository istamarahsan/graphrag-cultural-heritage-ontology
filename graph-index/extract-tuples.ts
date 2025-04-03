import OpenAI from "@openai/openai";
import _ from "lodash";
import { z } from "zod";
import { DateTime } from "luxon";
import * as path from "@std/path";
import { parseArgs } from "@std/cli/parse-args";
import promiseLimit from "promise-limit";
import * as extract from "./lib/extract.ts";
import * as ext from "./lib/ext.ts";
import * as preprocess from "./lib/preprocess.ts";
import Config from "./lib/config.ts";

const promptPathsSimple = {
  system: "prompt/simple/system.txt",
  fewshotAssistant: "prompt/simple/fewshot-assistant.txt",
  fewshotUser: "prompt/simple/fewshot-user.txt",
};
const promptPathsOntology = {
  system: "prompt/ontology/system.txt",
  ontology: "prompt/ontology/ontology.txt",
  fewshotAssistant: "prompt/ontology/fewshot-assistant.txt",
  fewshotUser: "prompt/ontology/fewshot-user.txt",
};

if (import.meta.main) {
  const promptsSimple = await ext.mapValuesPromise(
    promptPathsSimple,
    Deno.readTextFile,
  );
  const promptsOntology = await ext.mapValuesPromise(
    promptPathsOntology,
    Deno.readTextFile,
  );

  const {
    f,
    c,
    "skip-ontology": skipOntology,
    "skip-simple": skipSimple,
  } = parseArgs(Deno.args, {
    string: ["f", "c"],
    boolean: ["skip-ontology", "skip-simple"],
  });
  if (!f) {
    console.error("Specify chunks file with -f");
    Deno.exit(-1);
  }
  const configFilePath = c ?? "default.json";
  const configName = path.basename(configFilePath).replace(".json", "");
  const outFolder = path.join(
    "out",
    "run",
    `${configName}_${
      DateTime.local()
        .toISO({ includeOffset: true })
        .replace(/:/g, "-")
        .replace(/\..+/, "")
    }`,
  );
  const outFolderSimple = path.join(outFolder, "simple");
  const outFolderOntology = path.join(outFolder, "ontology");

  await Promise.all(
    [outFolder, outFolderSimple, outFolderOntology]
      .map((path) => Deno.mkdir(path, { recursive: true })),
  );

  const config = await Deno.readTextFile(configFilePath)
    .then(JSON.parse)
    .then(Config.parse);

  const client = {
    openai: new OpenAI({
      baseURL: config.endpoint,
      apiKey: config.apiKey ?? "",
    }),
    temperature: config.temperature,
    model: config.model,
  };

  const textChunks = await Deno.readTextFile(f)
    .then(JSON.parse)
    .then(z.array(z.object({ id: z.string(), content: z.string() })).parse);

  console.log(`Processing ${textChunks.length} chunks`);

  const concurrencyLimiter = promiseLimit<void>(config.concurrency ?? 1);
  const maxAttempts = config.retryMax ?? 1;
  if (skipSimple) {
    console.log("Skipping simple tuple extraction");
  } else {
    console.log("Starting simple tuple extraction");
    const linesPath = path.join(outFolderSimple, `${configName}.jsonl`);
    const mergedPath = path.join(outFolderSimple, `${configName}.json`);
    await processChunks(textChunks, {
      maxAttempts,
      concurrencyLimiter,
      outPath: linesPath,
      extractor: (chunk) =>
        extract.extractSimpleTriplets(client, chunk.content, {
          systemPrompt: promptsSimple.system,
          fewShotExamples: [
            {
              prompt: promptsSimple.fewshotUser,
              response: promptsSimple.fewshotAssistant,
            },
          ],
        }),
    });
    await mergeJsonLines(linesPath, mergedPath);
  }

  if (skipOntology) {
    console.log("Skipping ontology tuple extraction");
  } else {
    console.log("Starting ontology tuple extraction");
    const linesPath = path.join(outFolderOntology, `${configName}.jsonl`);
    const mergedPath = path.join(outFolderOntology, `${configName}.json`);
    await processChunks(textChunks, {
      maxAttempts,
      concurrencyLimiter,
      outPath: linesPath,
      extractor: (chunk) =>
        extract.extractOntologyTriplets(client, chunk.content, {
          systemPrompt: promptsOntology.system,
          ontologyDescription: promptsOntology.ontology,
          fewShotExamples: [
            {
              prompt: promptsOntology.fewshotUser,
              response: promptsOntology.fewshotAssistant,
            },
          ],
        }),
    });
    await mergeJsonLines(linesPath, mergedPath);
  }
}

async function mergeJsonLines(linesPath: string, mergedPath: string) {
  await Deno.readTextFile(linesPath).then((it) =>
    it
      .split("\n")
      .filter((it) => it != "")
      .map((it) => JSON.parse(it))
      .reduce<object[]>((merged, next) => [...merged, next], [])
  ).then((merged) =>
    Deno.writeTextFile(
      mergedPath,
      JSON.stringify(merged, undefined, 2),
    )
  );
}

type ProcessChunkParams = {
  maxAttempts: number;
  concurrencyLimiter: (fn: () => Promise<void>) => Promise<void>;
  extractor: (
    chunk: preprocess.TextChunk,
  ) => Promise<extract.TripletExtractionResult>;
  outPath: string;
};

async function processChunks(
  textChunks: preprocess.TextChunk[],
  { maxAttempts, concurrencyLimiter, extractor, outPath }: ProcessChunkParams,
) {
  await Deno.writeTextFile(outPath, "");
  await Promise.all(
    textChunks.map((chunk) =>
      concurrencyLimiter(async () => {
        let triplets: object[] | null = null;
        const attempts = [];
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const attemptResult = await extractor(chunk);
          const attemptCountStr = `(Attempt ${attempt + 1}/${maxAttempts})`;
          if (!attemptResult.ok) {
            console.error(
              `❌ [${chunk.id}] chunk failed to process ${attemptCountStr}`,
            );
            attempts.push(attemptResult);
            continue;
          }
          console.log(
            `✅ [${chunk.id}] chunk  processed successfully ${attemptCountStr}`,
          );
          triplets = attemptResult.value.triplets;
          attempts.push(_.omit(attemptResult, ["value.triplets"]));
          break;
        }
        await Deno.writeTextFile(
          outPath,
          JSON.stringify({
            chunkId: chunk.id,
            triplets: triplets,
            attempts,
          }) + "\n",
          { append: true },
        );
      })
    ),
  );
}
