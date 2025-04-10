import { parseArgs } from "@std/cli/parse-args";
import { exists } from "@std/fs/exists";
import * as path from "@std/path";
import * as N3 from "n3"; // RDF handling library
import OpenAI from "@openai/openai"; // OpenAI client
import z from "zod"; // Schema validation
import _ from "lodash"; // Utility library
import { RDF_BASE_URI } from "./lib/rdf.ts";

// --- Configuration Schema ---

const configSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string(),
});

type Config = z.infer<typeof configSchema>;

// --- Main Script Logic ---

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["f", "c"], // -f for RDF file, -c for config file
    alias: { f: "file", c: "config" },
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

  const rdfFilePath = args.f;
  const outJsonFilePath = path.join(
    path.dirname(rdfFilePath),
    path.basename(rdfFilePath, path.extname(rdfFilePath)) + "_embeddings.json"
  );
  const configFilePath = args.c;

  if (!(await exists(rdfFilePath))) {
    console.error(`Error: RDF file not found at "${rdfFilePath}"`);
    Deno.exit(1);
  }
  if (!(await exists(configFilePath))) {
    console.error(`Error: Config file not found at "${configFilePath}"`);
    Deno.exit(1);
  }

  // 1. Load Config and Initialize OpenAI Client
  console.log(`Loading config from "${configFilePath}"...`);
  const config = await loadConfig(configFilePath);
  const openai = new OpenAI({
    apiKey: config.apiKey ?? "",
    baseURL: config.endpoint,
  });

  // 2. Read RDF Turtle File
  console.log(`Reading RDF file from "${rdfFilePath}"...`);
  const turtleString = await Deno.readTextFile(rdfFilePath);
  const cleanTurtleString = turtleString.replaceAll('\\"', "");

  const store = new N3.Store();
  const parser = new N3.Parser();
  const _prefixes = (await new Promise<N3.Prefixes>((resolve, reject) => {
    parser.parse(cleanTurtleString, (error, quad, currentPrefixes) => {
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
  const tixPrefixUri = RDF_BASE_URI;
  if (!tixPrefixUri) {
    console.error(
      "Error: 'tix' prefix not found in RDF file and no default specified."
    );
    Deno.exit(1);
  }
  console.log(`Using prefix 'tix:' mapped to <${tixPrefixUri}>`);

  // 3. Identify Target Nodes for Embedding
  const nodesToEmbed = new Map<string, N3.NamedNode>(); // Store URI string -> NamedNode object
  store.forEach((quad, _data) => {
    const subjectIsTarget =
      quad.subject.termType === "NamedNode" &&
      quad.subject.value.startsWith(tixPrefixUri);
    if (subjectIsTarget) {
      if (!nodesToEmbed.has(quad.subject.value)) {
        nodesToEmbed.set(quad.subject.value, quad.subject as any);
      }
    }
    // Also consider objects if they can be tix resources or literals
    const objectIsResource =
      quad.object.termType === "NamedNode" &&
      quad.object.value.startsWith(tixPrefixUri);
    if (
      objectIsResource ||
      (quad.object.termType === "Literal" && subjectIsTarget)
    ) {
      if (!nodesToEmbed.has(quad.object.value)) {
        nodesToEmbed.set(quad.object.value, quad.object as any);
      }
    }
  }); // Iterate through all quads

  const targetNodes = Array.from(nodesToEmbed.values());
  console.log(
    `Identified ${targetNodes.length} literals or unique nodes with prefix 'tix:' to embed.`
  );

  if (targetNodes.length === 0) {
    console.log("No matching nodes found to embed. Exiting.");
    return;
  }

  // 4. Generate Node Names for Embedding
  console.log("Extracting node names for embedding...");
  // Use the local part of the URI, replacing underscores with spaces
  const nodeNames = targetNodes.map((node) =>
    getLocalName(node.value, tixPrefixUri)
  );

  // --- Optional: Log names for debugging ---
  // nodeNames.forEach((name, i) => console.log(`Name ${i}: ${name}`));
  // ---

  // 5. Compute Embeddings (Batching)
  const BATCH_SIZE = 100; // Adjust based on API limits / performance
  let allEmbeddings: number[][] = [];
  for (let i = 0; i < nodeNames.length; i += BATCH_SIZE) {
    const batchTexts = nodeNames.slice(i, i + BATCH_SIZE);
    const batchEmbeddings = await getEmbeddings(
      openai,
      config.model,
      batchTexts
    );
    if (batchEmbeddings.length !== batchTexts.length) {
      throw new Error(
        `Mismatch in batch size: requested ${batchTexts.length}, received ${batchEmbeddings.length}`
      );
    }
    allEmbeddings = allEmbeddings.concat(batchEmbeddings);
  }

  if (allEmbeddings.length !== targetNodes.length) {
    throw new Error(
      `Embedding count mismatch: expected ${targetNodes.length}, got ${allEmbeddings.length}`
    );
  }

  // 6. Add Embeddings as Literals to the Store
  console.log("Adding embeddings as literals to the RDF store...");

  const embeddingsIndexed = Object.fromEntries(
    _.zip(
      targetNodes.map((it) => it.value),
      allEmbeddings
    )
  );
  await Deno.writeTextFile(
    outJsonFilePath,
    JSON.stringify(embeddingsIndexed, undefined, 2)
  );
  for (const [targetNode, embedding] of _.zip(targetNodes, allEmbeddings)) {
    if (!targetNode || !embedding) {
      continue;
    }
  }
}

async function loadConfig(filePath: string): Promise<Config> {
  try {
    const configContent = await Deno.readTextFile(filePath);
    const configJson = JSON.parse(configContent);
    return configSchema.parse(configJson); // Validate structure
  } catch (error) {
    console.error(`Error loading or validating config file "${filePath}":`);
    if (error instanceof z.ZodError) {
      console.error(error.errors);
    } else {
      console.error(error);
    }
    Deno.exit(1);
  }
}

// --- Utility Function ---

/** Extracts and cleans the local name from a prefixed URI */
function getLocalName(uri: string, prefixUri: string): string {
  if (uri.startsWith(prefixUri)) {
    const localName = uri.substring(prefixUri.length);
    // Simple cleaning: replace underscores with spaces
    return localName.replace(/_/g, " ");
  }
  // Fallback if somehow a non-prefixed URI gets through (shouldn't happen with filtering)
  const parts = uri.split(/[#/]/);
  return parts[parts.length - 1]?.replace(/_/g, " ") ?? uri;
}

// --- Embedding Function ---

async function getEmbeddings(
  client: OpenAI,
  model: string,
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  console.log(`Requesting embeddings for ${texts.length} text(s)...`);
  const TASK_PREFIX = "search_document: ";
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
    console.log(`Received ${response.data.length} embedding(s).`);
    // Sort embeddings back into original order based on index
    response.data.sort((a, b) => a.index - b.index);
    return response.data.map((d) => d.embedding);
  } catch (error) {
    console.error("Error getting embeddings:", error);
    throw error; // Re-throw to stop the process
  }
}

if (import.meta.main) {
  await main();
}
