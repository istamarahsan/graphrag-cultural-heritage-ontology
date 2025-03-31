import OpenAI from "@openai/openai";
import _ from "lodash";
import * as extract from "./lib/extract.ts";
import * as preprocess from "./lib/preprocess.ts";
import Config from "./lib/config.ts";

const stage1SystemPromptFilePath = "data/prompt-stage1.txt";
const stage2SystemPromptFilePath = "data/prompt-stage2.txt";
const singleStageSystemPromptFilePath = "data/prompt-singlestage.txt";
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
  const singleStageSystemPrompt = await Deno.readTextFile(
    singleStageSystemPromptFilePath
  );
  const client = {
    openai: new OpenAI({
      baseURL: config.endpoint,
      apiKey: config.apiKey ?? "",
    }),
    temperature: config.temperature,
    model: config.model,
  };

  const chapters = JSON.parse(await Deno.readTextFile(dataFilePath));
  const outFilePrefix = `out/${new Date().toISOString().replaceAll(":", ".")}`;
  const outFilePathLines = `${outFilePrefix}.jsonl`;
  const outFilePathMerged = `${outFilePrefix}.json`;
  // deno-lint-ignore no-explicit-any
  for (const chapter of (chapters as any[]).flatMap(
    (chapter) => chapter["subChapters"]
  )) {
    const chunkMaxChars = 500;
    const chunkSentenceMin = 2;
    const chunkSentenceMax = 5;
    const chunkSentenceOverlap = 1;
    const textChunks = preprocess
      .chunkBySentence(chapter["subText"] as string, {
        maxCharLength: chunkMaxChars,
        minSentences: chunkSentenceMin,
        maxSentences: chunkSentenceMax,
        sentenceOverlap: chunkSentenceOverlap,
      })
      .map((sentence) => sentence.join(". "));

    console.log(
      `Extracting chapter: ${chapter["subChar"]}. ${chapter["subTitle"]} (${textChunks.length} chunks)`
    );
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      const tripletsResult =
        await extract.extractTripletsFromTextWithLLMSingleStage(client, chunk, {
          promptAttempts: 1,
          systemPrompt: singleStageSystemPrompt,
        });
      if (!tripletsResult.ok) {
        console.error(`(${i + 1} / ${textChunks.length}): FAILED`);
        continue;
      }

      console.log(`(${i + 1} / ${textChunks.length}): SUCCESS`);
      await Deno.writeTextFile(
        outFilePathLines,
        JSON.stringify(tripletsResult.value) + "\n",
        { append: true }
      );
    }
  }
  const outLines = await Deno.readTextFile(outFilePathLines).then((it) =>
    it.split("\n").filter((it) => it != "")
  );
  const merged = outLines
    .map((it) => JSON.parse(it))
    .reduce<object[]>((merged, arr) => [...merged, ...arr], []);
  await Deno.writeTextFile(
    outFilePathMerged,
    JSON.stringify(merged, undefined, 2)
  );
}
