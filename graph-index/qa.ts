import { parseArgs } from "@std/cli/parse-args";
import { exists } from "@std/fs/exists";
import OpenAI from "@openai/openai";
import z from "zod";
import N3 from "n3";
import { RDF_BASE_URI } from "./lib/rdf.ts";
import * as vec from "./lib/vec.ts";
import { getLocalNameFromUri, getNHopSubgraph } from "./lib/graph.ts";
import path from "node:path";
import _ from "lodash";

const configSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string(),
});

type Config = z.infer<typeof configSchema>;

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["f", "e", "c", "q", "r", "k"],
    alias: { f: "file", c: "config" },
    default: { r: "1", k: "3" },
  });

  if (!args.f) {
    console.error(
      "Error: RDF Turtle file path must be specified with -f or --file"
    );
    Deno.exit(1);
  }
  if (!args.c) {
    console.error(
      "Error: Config file path must be specified with -c or --config"
    );
    Deno.exit(1);
  }

  if (!args.q) {
    console.error("Error: Specify your query with -q");
    Deno.exit(1);
  }

  const rdfFilePath = args.f;
  const embeddingsJsonFilePath =
    args.e ??
    path.join(
      path.dirname(rdfFilePath),
      path.basename(rdfFilePath, path.extname(rdfFilePath)) + "_embeddings.json"
    );
  const configFilePath = args.c;
  const query = args.q;
  const r = parseInt(args.r);
  const k = parseInt(args.k);

  if (!(await exists(rdfFilePath))) {
    console.error(`Error: RDF file not found at "${rdfFilePath}"`);
    Deno.exit(1);
  }
  if (!(await exists(embeddingsJsonFilePath))) {
    console.error(`Error: JSON file not found at "${embeddingsJsonFilePath}"`);
    Deno.exit(1);
  }
  if (!(await exists(configFilePath))) {
    console.error(`Error: Config file not found at "${configFilePath}"`);
    Deno.exit(1);
  }

  console.log(`Loading config from "${configFilePath}"...`);
  const config = await Deno.readTextFile(configFilePath)
    .then(JSON.parse)
    .then(configSchema.parse);
  const openai = new OpenAI({
    apiKey: config.apiKey ?? "",
    baseURL: config.endpoint,
  });

  console.log(`Reading embeddings from "${rdfFilePath}"...`);
  const embeddingsByNodeValue = await Deno.readTextFile(embeddingsJsonFilePath)
    .then(JSON.parse)
    .then(z.record(z.array(z.number())).parse);
  console.log(`Reading RDF file from "${rdfFilePath}"...`);
  const store = new N3.Store();
  const parser = new N3.Parser();
  const turtleString = await Deno.readTextFile(rdfFilePath);
  const _prefixes = (await new Promise<N3.Prefixes>((resolve, reject) => {
    parser.parse(turtleString, (error, quad, currentPrefixes) => {
      if (error) {
        reject(error);
      } else if (quad) {
        store.addQuad(quad);
      } else {
        // Parsing complete
        resolve(currentPrefixes ?? {});
      }
    });
  })) as N3.Prefixes;

  console.log(`Parsed ${store.size} triples.`);

  const embeddingsOrdered: { node: string; embedding: number[] }[] =
    Object.entries(embeddingsByNodeValue).map(([node, embedding]) => ({
      node,
      embedding,
    }));

  const [queryEmbedding] = await getEmbeddings(openai, config.model, [query]);

  const similarityResults = vec
    .similaritySearch(
      queryEmbedding,
      embeddingsOrdered.map(({ embedding }) => embedding),
      k
    )
    .map(({ originalIndex }) => embeddingsOrdered[originalIndex].node);
  console.log(similarityResults);

  const subgraph = getNHopSubgraph(store, similarityResults, r);
  const subgraphSubjects = subgraph.getSubjects(null, null, null);
  for (const subject of subgraphSubjects) {
    const quads = subgraph.getQuads(subject, null, null, null);
    console.log(
      `${getLocalNameFromUri(subject.id)}:\n${_.sortBy(
        quads,
        (it) => it.predicate.value
      )
        .filter(
          ({ predicate }) => predicate.value !== `${RDF_BASE_URI}hasEmbedding`
        )
        .map(
          ({ predicate, object }) =>
            `  - ${getLocalNameFromUri(predicate.value)}: ${getLocalNameFromUri(
              object.value
            )}`
        )
        .join("\n")}\n`
    );
  }
}

export async function giveMeEmbeddings(
  filePath: string,
  configPath: string = "embed.json",
  userQuery: string[] | string,
  {
    r = 1,
    k = 3,
  }: {
    r?: number;
    k?: number;
  } = {}
) {
  const config = await Deno.readTextFile(configPath)
    .then(JSON.parse)
    .then(configSchema.parse);
  const openai = new OpenAI({
    apiKey: config.apiKey ?? "",
    baseURL: config.endpoint,
  });

  const store = new N3.Store();
  const parser = new N3.Parser();
  const turtleString = await Deno.readTextFile(filePath);
  (await new Promise<N3.Prefixes>((resolve, reject) => {
    parser.parse(turtleString, (error, quad, currentPrefixes) => {
      if (error) {
        reject(error);
      } else if (quad) {
        store.addQuad(quad);
      } else {
        // Parsing complete
        resolve(currentPrefixes ?? {});
      }
    });
  })) as N3.Prefixes;

  const embeddings: { node: string; embedding: number[] }[] = [];
  for (const quad of store) {
    const { subject, predicate, object } = quad;
    if (predicate.value !== `${RDF_BASE_URI}hasEmbedding`) {
      continue;
    }
    embeddings.push({
      node: subject.value,
      embedding: JSON.parse(object.value),
    });
  }

  const [queryEmbedding] = await getEmbeddingsSilent(
    openai,
    config.model,
    userQuery instanceof Array ? userQuery : [userQuery],
    "search_query"
  );

  const similarityResults = vec
    .similaritySearch(
      queryEmbedding,
      embeddings.map(({ embedding }) => embedding),
      k
    )
    .map(({ originalIndex }) => embeddings[originalIndex].node);

  const stuff: { subject: string; predicate: string; object: string }[] = [];

  const subgraph = getNHopSubgraph(store, similarityResults, r);
  for (const quad of subgraph) {
    const { subject, predicate, object } = quad;
    if (
      predicate.value === `${RDF_BASE_URI}hasEmbedding` ||
      getLocalNameFromUri(predicate.value) === "type"
    ) {
      continue;
    }
    stuff.push({
      subject: getLocalNameFromUri(subject.value),
      predicate: getLocalNameFromUri(predicate.value),
      object: getLocalNameFromUri(object.value),
    });
  }

  return stuff;
}

async function getEmbeddingsSilent(
  client: OpenAI,
  model: string,
  texts: string[],
  task: "search_query" | "search_document"
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  // console.log(`Requesting embeddings for ${texts.length} text(s)...`);
  const TASK_PREFIX = `${task}: `;
  try {
    // Nomic requires input_type but standard OpenAI API doesn't.
    // Assume endpoint handles it based on model name or defaults correctly.
    // Use 'encoding_format: "float"' for numerical arrays.
    const response = await client.embeddings.create({
      model: model,
      input: texts.map((it) => TASK_PREFIX + it),
      encoding_format: "float",
      // If your endpoint *specifically* requires dimensions for Nomic v1.5:
      // dimensions: 768,
    });
    // console.log(
    //   `Received ${response.data.length} embedding(s).`,
    // );
    // Sort embeddings back into original order based on index
    response.data.sort((a, b) => a.index - b.index);
    return response.data.map((d) => d.embedding);
  } catch (error) {
    // console.error("Error getting embeddings:", error);
    throw error; // Re-throw to stop the process
  }
}

export async function getEmbeddings(
  client: OpenAI,
  model: string,
  texts: string[],
  task?: "search_query" | "search_document"
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  console.log(`Requesting embeddings for ${texts.length} text(s)...`);
  const TASK_PREFIX = task ? `${task}: ` : "";
  try {
    const response = await client.embeddings.create({
      model: model,
      input: texts.map((it) => TASK_PREFIX + it),
      encoding_format: "float",
    });
    console.log(`Received ${response.data.length} embedding(s).`);
    response.data.sort((a, b) => a.index - b.index);
    return response.data.map((d) => d.embedding);
  } catch (error) {
    console.error("Error getting embeddings:", error);
    throw error; // Re-throw to stop the process
  }
}

if (import.meta.main) {
  main();
}
