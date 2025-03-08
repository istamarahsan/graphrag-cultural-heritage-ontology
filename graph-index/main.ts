import OpenAI from "@openai/openai";
import _ from "lodash";
import z from "zod";

const stage1SystemPromptFilePath = "data/prompt-stage1.txt";
const stage2SystemPromptFilePath = "data/prompt-stage2.txt";
const dataFilePath = "data/chapters.json";
const outFilePath = "out/graph.csv";
const configFilePath = "config.json";

const configSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string(),
  temperature: z.number(),
});

if (import.meta.main) {
  const config = await Deno.readTextFile(configFilePath)
    .then(JSON.parse)
    .then(configSchema.parse);
  try {
    await Deno.remove(outFilePath, { recursive: true });
  } catch (_error) {
    // file does not exist
  }
  const stage1SystemPrompt = await Deno.readTextFile(
    stage1SystemPromptFilePath
  );
  const stage2SystemPrompt = await Deno.readTextFile(
    stage2SystemPromptFilePath
  );
  const chapters = JSON.parse(await Deno.readTextFile(dataFilePath));
  for (const chapter of (chapters as any[]).flatMap(
    (chapter) => chapter["subChapters"]
  )) {
    const openaiClient = new OpenAI({
      baseURL: config.endpoint,
      apiKey: config.apiKey,
    });
    const sentences = (chapter["subText"] as string).split(". ");
    const chunkMaxChars = 1000;
    const chunkSentenceMin = 2;
    const chunkSentenceMax = 5;
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
      const entityExtractionResponse =
        await openaiClient.chat.completions.create({
          messages: [
            {
              role: "system",
              content: stage1SystemPrompt,
            },
            {
              role: "user",
              content: chunk,
            },
          ],
          model: config.model,
          temperature: config.temperature,
          stream: false,
        });
      const entitiesResponseText = parseLLMResponse(
        entityExtractionResponse.choices[0]!.message!.content!
      );
      let entitiesParsed: string[] | undefined = undefined;
      let retries = 0;
      let latestErr: unknown = undefined;
      while (!entitiesParsed && retries < 3) {
        try {
          entitiesParsed = JSON.parse(entitiesResponseText) as string[];
        } catch (error) {
          latestErr = error;
          retries++;
        }
      }
      if (!entitiesParsed) {
        console.error(
          `Failed to extract chunk: ${latestErr}.\nResponse: ${entitiesResponseText}\nChunk: ${chunk}`
        );
        continue;
      }
      const stage2Prompt = `Entities: ${entitiesParsed
        .map((it) => "- " + it)
        .join("\n")}\n--\n${chunk}`;
      const tripletExtractionResponse =
        await openaiClient.chat.completions.create({
          messages: [
            {
              role: "system",
              content: stage2SystemPrompt,
            },
            {
              role: "user",
              content: stage2Prompt,
            },
          ],
          model: config.model,
          temperature: config.temperature,
          stream: false,
        });
      const tripletsResponseText = parseLLMResponse(
        tripletExtractionResponse.choices[0]!.message!.content!
      );
      const subFolder = `out/${chapter["subChar"]}.${chapter["subTitle"]}`;
      await Deno.mkdir(subFolder, { recursive: true });
      await Deno.writeTextFile(
        `${subFolder}/${i + 1}.json`,
        tripletsResponseText
      );
      console.log(`Processed chunk: ${i + 1}/${textChunks.length}`);
    }
  }
}

function parseLLMResponse(responseStr: string) {
  return _.trim(
    (responseStr.includes("</think>")
      ? responseStr.split("</think>")[1].replace("<｜end▁of▁sentence｜>", "")
      : responseStr
    )
      .split("json")
      .filter((it) => it !== "")
      .join(""),
    "`\n "
  );
}
