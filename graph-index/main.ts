import OpenAI from "@openai/openai";
import _ from "lodash";
import * as extract from "./extract.ts";
import Config from "./config.ts";

const stage1SystemPromptFilePath = "data/prompt-stage1.txt";
const stage2SystemPromptFilePath = "data/prompt-stage2.txt";
const dataFilePath = "data/chapters.json";
const configFilePath = "config.json";

if (import.meta.main) {
  const config = await Deno.readTextFile(configFilePath)
    .then(JSON.parse)
    .then(Config.parse);

  const stage1SystemPrompt = await Deno.readTextFile(
    stage1SystemPromptFilePath
  );
  const stage2SystemPrompt = await Deno.readTextFile(
    stage2SystemPromptFilePath
  );
  const client = extract.createClient({
    openai: new OpenAI({
      baseURL: config.endpoint,
      apiKey: config.apiKey ?? "",
    }),
    temperature: config.temperature,
    model: config.model,
    stage1SystemPrompt,
    stage2SystemPrompt,
  });

  const chapters = JSON.parse(await Deno.readTextFile(dataFilePath));
  const outFilePath = `out/${new Date()
    .toISOString()
    .replaceAll(":", ".")}.jsonl`;
  // deno-lint-ignore no-explicit-any
  for (const chapter of (chapters as any[]).flatMap(
    (chapter) => chapter["subChapters"]
  )) {
    const sentences = (chapter["subText"] as string).split(". ");
    const chunkMaxChars = 1000;
    const chunkSentenceMin = 2;
    const chunkSentenceMax = 10;
    const chunkSentenceOverlap = 1;
    const textChunks = sentences
      .reduce(
        (chunks, sentence) => {
          const latestChunk = chunks.at(-1)!;
          if (latestChunk.length < chunkSentenceMin) {
            latestChunk.push(sentence);
            return chunks;
          }
          const latestChunkCharacterLength =
            latestChunk.reduce((lengthSum, s) => lengthSum + s.length, 0) +
            sentence.length;
          const createNewChunk =
            latestChunkCharacterLength >= chunkMaxChars ||
            latestChunk.length >= chunkSentenceMax;
          if (createNewChunk) {
            return [
              ...chunks,
              [...latestChunk.slice(-chunkSentenceOverlap), sentence],
            ];
          }
          latestChunk.push(sentence);
          return chunks;
        },

        [[]] as string[][]
      )
      .map((sentences) => sentences.join(". "));

    console.log(
      `Extracting chapter: ${chapter["subChar"]}. ${chapter["subTitle"]} (${textChunks.length} chunks)`
    );
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      const tripletsResult = await extract.extractTripletsFromTextWithLLM(
        client,
        chunk,
        {
          promptAttempts: 3,
        }
      );
      if (!tripletsResult.ok) {
        console.error(`(${i + 1} / ${textChunks.length}): FAILED`);
        continue;
      }

      console.log(`(${i + 1} / ${textChunks.length}): SUCCESS`);
      await Deno.writeTextFile(
        outFilePath,
        JSON.stringify(tripletsResult.value) + "\n",
        { append: true }
      );
    }
  }
}
