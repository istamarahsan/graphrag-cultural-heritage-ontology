import { parseArgs } from "@std/cli/parse-args";
import { exists } from "@std/fs/exists";
import OpenAI from "@openai/openai";
import z from "zod";
import N3 from "n3";
import { RDF_BASE_URI } from "./lib/rdf.ts";
import * as vec from "./lib/vec.ts";
import { getNHopSubgraph } from "./lib/graph.ts";

const configSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string(),
});

type Config = z.infer<typeof configSchema>;

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["f", "c", "q"],
    alias: { "f": "file", "c": "config" },
  });

  if (!args.f) {
    console.error(
      "Error: RDF Turtle file path must be specified with -f or --file",
    );
    Deno.exit(1);
  }
  if (!args.c) {
    console.error(
      "Error: Config file path must be specified with -c or --config",
    );
    Deno.exit(1);
  }

  if (!args.q) {
    console.error(
      "Error: Specify your query with -q",
    );
    Deno.exit(1);
  }

  const rdfFilePath = args.f;
  const configFilePath = args.c;
  const query = args.q;

  if (!(await exists(rdfFilePath))) {
    console.error(`Error: RDF file not found at "${rdfFilePath}"`);
    Deno.exit(1);
  }
  if (!(await exists(configFilePath))) {
    console.error(`Error: Config file not found at "${configFilePath}"`);
    Deno.exit(1);
  }

  console.log(`Loading config from "${configFilePath}"...`);
  const config = await Deno.readTextFile(configFilePath).then(JSON.parse).then(
    configSchema.parse,
  );
  const openai = new OpenAI({
    apiKey: config.apiKey ?? "",
    baseURL: config.endpoint,
  });

  console.log(`Reading RDF file from "${rdfFilePath}"...`);
  const store = new N3.Store();
  const parser = new N3.Parser();
  const turtleString = await Deno.readTextFile(rdfFilePath);
  const prefixes = (await new Promise<N3.Prefixes>((resolve, reject) => {
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
  })) as N3.Prefixes; // Cast needed as N3 types aren't perfect on completion

  console.log(`Parsed ${store.size} triples.`);

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

  const [queryEmbedding] = await getEmbeddings(
    openai,
    config.model,
    [query],
    "search_query",
  );

  const similarityResults = vec.similaritySearch(
    queryEmbedding,
    embeddings.map(({ embedding }) => embedding),
    1,
  ).map(({ originalIndex }) => embeddings[originalIndex].node);

  const subgraph = getNHopSubgraph(store, similarityResults, 1);
  for (const quad of subgraph) {
    const { subject, predicate, object } = quad;
    if (
      predicate.value === `${RDF_BASE_URI}hasEmbedding` ||
      getLocalNameFromUri(predicate.value) === "type"
    ) {
      continue;
    }
    console.log(
      `${getLocalNameFromUri(subject.value)} -> ${
        getLocalNameFromUri(predicate.value)
      } -> ${getLocalNameFromUri(object.value)}`,
    );
  }
}

async function getEmbeddings(
  client: OpenAI,
  model: string,
  texts: string[],
  task: "search_query" | "search_document",
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  console.log(`Requesting embeddings for ${texts.length} text(s)...`);
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
    console.log(
      `Received ${response.data.length} embedding(s).`,
    );
    // Sort embeddings back into original order based on index
    response.data.sort((a, b) => a.index - b.index);
    return response.data.map((d) => d.embedding);
  } catch (error) {
    console.error("Error getting embeddings:", error);
    throw error; // Re-throw to stop the process
  }
}

/**
 * Extracts the local name part of a URI string.
 * It returns the substring after the last '#' or '/' character.
 * If neither character is found, it returns the original URI string.
 *
 * @param uri The full URI string (e.g., from NamedNode.value).
 * @returns The local name part of the URI.
 */
function getLocalNameFromUri(uri: string): string {
  // Find the index of the last '#'
  const hashIndex = uri.lastIndexOf("#");
  // Find the index of the last '/'
  const slashIndex = uri.lastIndexOf("/");

  // Determine which separator appears later in the string
  const separatorIndex = Math.max(hashIndex, slashIndex);

  // If a separator was found (index is not -1)
  if (separatorIndex !== -1) {
    // Return the part of the string *after* the separator
    return uri.substring(separatorIndex + 1);
  }

  // If no separator ('#' or '/') was found, return the original string
  // (This might happen with URNs or other URI schemes)
  return uri;
}

if (import.meta.main) {
  main();
}
