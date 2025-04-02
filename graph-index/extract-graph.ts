import OpenAI from "@openai/openai";
import _ from "lodash";
import { z } from "zod";
import { DateTime } from "luxon";
import N3 from "n3";
import * as path from "@std/path";
import { parseArgs } from "@std/cli/parse-args";
import promiseLimit from "promise-limit";
import * as extract from "./lib/extract.ts";
import Config from "./lib/config.ts";
import fs from "node:fs";

const singleStageSystemPromptFilePath = "prompt/prompt-singlestage.txt";
const ontologyFilePath = "prompt/prompt-ontology.txt";
const fewshotAssistantFilePath = "prompt/fewshot-assistant.txt";
const fewshotUserFilePath = "prompt/fewshot-user.txt";

const rdfBaseURI = "https://tix.fyi/museum#";
const rdfPrefixes = {
  crm: "http://www.cidoc-crm.org/cidoc-crm/",
  tix: rdfBaseURI,
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
};

if (import.meta.main) {
  const { f, c } = parseArgs(Deno.args, {
    string: ["f", "c"],
  });
  if (!f) {
    console.error("Specify chunks file with -f");
    Deno.exit(-1);
  }
  const configFilePath = c ?? "default.json";
  const configName = path.basename(configFilePath).replace(".json", "");
  const dumpFileFolder = `out/${configName}_${
    DateTime.local()
      .toISO({ includeOffset: true })
      .replace(/:/g, "-")
      .replace(/\..+/, "")
  }`;
  const dumpFilePathLines = path.join(dumpFileFolder, `${configName}.jsonl`);
  const dumpFilePathMerged = path.join(dumpFileFolder, `${configName}.json`);
  const rdfFilePath = path.join(dumpFileFolder, `${configName}.ttl`);
  await Deno.mkdir(dumpFileFolder, { recursive: true });

  const config = await Deno.readTextFile(configFilePath)
    .then(JSON.parse)
    .then(Config.parse);

  const singleStageSystemPrompt = await Deno.readTextFile(
    singleStageSystemPromptFilePath,
  );
  const ontologyDesc = await Deno.readTextFile(
    ontologyFilePath,
  );
  const [fewshotAssistant, fewshotUser] = await Promise.all([
    Deno.readTextFile(fewshotAssistantFilePath),
    Deno.readTextFile(fewshotUserFilePath),
  ]);
  const client = {
    openai: new OpenAI({
      baseURL: config.endpoint,
      apiKey: config.apiKey ?? "",
    }),
    temperature: config.temperature,
    model: config.model,
  };
  const rdfStream = fs.createWriteStream(rdfFilePath);
  const rdfWriter = RDFWriter(rdfStream);

  const textChunks = await Deno.readTextFile(f)
    .then(JSON.parse)
    .then(z.array(z.object({ id: z.string(), content: z.string() })).parse);

  console.log(`Processing ${textChunks.length} chunks`);

  const concurrencyLimiter = promiseLimit(config.concurrency ?? 1);
  let finishedCount = 0;
  await Promise.all(
    textChunks.map((chunk) =>
      concurrencyLimiter(async () => {
        let log: object = {};
        const result = await extract.extractTripletsFromTextWithLLMSingleStage(
          {
            ...client,
            log: (obj) => {
              log = obj;
              return Promise.resolve();
            },
          },
          chunk.content,
          {
            promptAttempts: config.retryMax ?? 1,
            systemPrompt: singleStageSystemPrompt + "\n " + ontologyDesc,
            fewShotExamples: [
              {
                prompt: fewshotUser,
                response: fewshotAssistant,
              },
            ],
          },
        );
        finishedCount += 1;
        const countStr = `(${finishedCount}/${textChunks.length})`;
        if (result.ok) {
          console.log(
            `✅ ${countStr} chunk ${chunk.id} processed successfully`,
          );
          await Deno.writeTextFile(
            dumpFilePathLines,
            JSON.stringify({
              chunkId: chunk.id,
              triplets: result.value,
              ...log,
            }) + "\n",
            { append: true },
          );
          writeTriplets(rdfWriter, result.value);
        } else {
          await Deno.writeTextFile(
            dumpFilePathLines,
            JSON.stringify({
              chunkId: chunk.id,
              triplets: null,
              ...log,
            }) + "\n",
            { append: true },
          );
          console.error(`❌ ${countStr} chunk ${chunk.id} failed to process`);
        }
      })
    ),
  );

  rdfStream.close();
  let merged: object[] = [];
  try {
    merged = await Deno.readTextFile(dumpFilePathLines).then((it) =>
      it
        .split("\n")
        .filter((it) => it != "")
        .map((it) => JSON.parse(it))
        .reduce<object[]>((merged, next) => [...merged, next], [])
    );
  } catch (_err) {
    console.error("No triplets were processed!");
    Deno.exit(-1);
  }
  await Deno.writeTextFile(
    dumpFilePathMerged,
    JSON.stringify(merged, undefined, 2),
  );
}

function RDFWriter(stream: fs.WriteStream) {
  return new N3.Writer(stream, { prefixes: rdfPrefixes });
}

function writeTriplets(
  writer: N3.Writer<N3.Quad>,
  triplets: extract.Triplet[],
) {
  const namedNode = N3.DataFactory.namedNode;
  const quads = triplets.flatMap((
    { domain, property, range },
  ) => {
    const subjectNode = namedNode(
      `${rdfPrefixes.tix}${domain.name.replace(/ /g, "_")}`,
    );
    const objectNode = namedNode(
      `${rdfPrefixes.tix}${range.name.replace(/ /g, "_")}`,
    );
    return [
      N3.DataFactory.quad(
        subjectNode,
        namedNode(
          `${rdfPrefixes.crm}${property}`,
        ),
        objectNode,
      ),
    ];
  });
  writer.addQuads(quads);
}
