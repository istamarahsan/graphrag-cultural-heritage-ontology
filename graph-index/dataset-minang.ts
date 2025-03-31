import {
  chunkBySentence,
  ChunkingOptions,
  TextChunk,
} from "./lib/preprocess.ts";
import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";

export type TextChunkMinangkabau = TextChunk;

const defaultChunkingOptions: ChunkingOptions = {
  maxCharLength: 500,
  minSentences: 2,
  maxSentences: 5,
  sentenceOverlap: 1,
};

export default function preprocess(
  // deno-lint-ignore no-explicit-any
  data: any[],
  options?: ChunkingOptions
): TextChunkMinangkabau[] {
  return data
    .flatMap((it) => it["subChapters"])
    .flatMap((subChapter) =>
      chunkBySentence(subChapter["subText"], options ?? defaultChunkingOptions)
    )
    .map((sentences) => ({ content: sentences.join(". ") }));
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["f", "o"],
    default: { o: "out/data/minang.json" },
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
