import {
  chunkBySentence,
  ChunkingOptions,
  TextChunk,
} from "./lib/preprocess.ts";
import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";

type MuseumEntryMetadata = {
  type: "news" | "collection" | "publication";
  url: string;
  title: string;
};
export type TextChunkMuseum = TextChunk & {
  id: string;
  metadata: MuseumEntryMetadata;
};

const defaultChunkingOptions: ChunkingOptions = {
  maxCharLength: 10000,
  minSentences: 2,
  maxSentences: 100,
  sentenceOverlap: 2,
};

export default function preprocess(
  data: any[],
  options?: ChunkingOptions,
): TextChunkMuseum[] {
  return data
    .filter((it) => it.type === "collection")
    .flatMap((it, i) =>
      chunkBySentence(it.content, options ?? defaultChunkingOptions).map(
        (sentences) => ({
          id: `MN-${i + 1}`,
          metadata: {
            type: it.type,
            url: it.url,
            title: it.title,
          } as MuseumEntryMetadata,
          content: `Koleksi Museum Nasional - ${it.title}\n---\n` +
            sentences.join(". "),
        }),
      )
    );
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["f", "o"],
    default: { o: "out/data/museum.json" },
  });

  const filePath = args.f;
  const outputPath = args.o;

  if (!filePath) {
    console.error("Error: Missing required argument -f (input file path)");
    Deno.exit(1);
  }

  try {
    const fileContent = await Deno.readTextFile(filePath);
    const jsonData = JSON.parse(fileContent);
    const chunks = preprocess(jsonData);
    await Deno.mkdir(path.dirname(outputPath), { recursive: true });
    await Deno.writeTextFile(outputPath, JSON.stringify(chunks, null, 2));
    console.log(`Successfully wrote chunks to ${outputPath}`);
  } catch (error) {
    console.error(`Error processing file: ${error}`);
    Deno.exit(1);
  }
}
