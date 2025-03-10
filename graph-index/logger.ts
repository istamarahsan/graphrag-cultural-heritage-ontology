// deno-lint-ignore-file no-unused-vars no-empty no-explicit-any
import OpenAI from "@openai/openai";
import _ from "lodash";
import z, { ostring } from "zod";
import neo4j from 'neo4j-driver';


// configs
const chunkMaxChars = 1000;
const chunkSentenceMin = 2;
const chunkSentenceMax = 5;
const chunkSentenceOverlap = 1;

const stage1SystemPromptFilePath = "data/prompt-stage1.txt";
const stage2SystemPromptFilePath = "data/prompt-stage2.txt";
const dataFilePath = "data/chapters.json";
const outFilePath = "out/graph.csv";
const configFilePath = "config.json";


//
const configSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string(),
  temperature: z.number(),
});

async function askAI<T>(OpenAI: OpenAI, config: z.infer<typeof configSchema>, messages: any): Promise<T | undefined> {
  for (let i = 0; i < 3; i++) {
    try {
      const ai_response =
        await OpenAI.chat.completions.create({
          messages,
          model: config.model,
          temperature: config.temperature,
          stream: false,
        });
      const parsed_ai_response = parseLLMResponse(
        ai_response.choices[0]!.message!.content!
      );
      return parsed_ai_response as T;
    } catch {}
  }
  return;
}

if (import.meta.main) {
  const config = await Deno.readTextFile(configFilePath).then(JSON.parse).then(configSchema.parse);
  try {
    await Deno.remove(outFilePath, { recursive: true });
  } catch {}

  const openaiClient = new OpenAI({
    baseURL: config.endpoint,
    apiKey: config.apiKey,
  });

  const stage1SystemPrompt = await Deno.readTextFile(
    stage1SystemPromptFilePath
  );
  const stage2SystemPrompt = await Deno.readTextFile(
    stage2SystemPromptFilePath
  );


  // initializations
  const chapters: {
    chapterNum: string,
    chapterTitle: string,
    subChapters: {
      subChar: string,
      subTitle: string,
      subText: string,
    }[]
  }[] = JSON.parse(await Deno.readTextFile(dataFilePath));

  const to_process = [];

  for (const chapter of chapters) {
    const major = chapter.chapterNum;
    for (const sub of chapter.subChapters) {
      const minor = sub.subChar;
      const text = sub.subText;

      const sentences = text.split(".").map(t => t.trim());
      const chunks = sentences.reduce(
        (chunks, sentence) => {
          const n_chunk = chunks.at(-1)!;
          if (n_chunk.length < chunkSentenceMin) {
            n_chunk.push(sentence);
            return chunks;
          }

          const n_chunk_length = n_chunk.reduce((length, text) => length + text.length, 0);

          const over_characters = (n_chunk_length + sentence.length) >= chunkMaxChars;
          const over_sentences = n_chunk.length >= chunkSentenceMax;

          const create_new_chunk = over_characters || over_sentences;
          if (create_new_chunk) {
            return [
              ...chunks,
              [...n_chunk.slice(-chunkSentenceOverlap), sentence]
            ];
          }

          return chunks;
        }, [[]] as string[][]
      );

      to_process.push({
        major,
        minor,
        sentences: chunks.map(array => array.join(". ")),
      } as {
        major: string,
        minor: string,
        sentences: string[],
      });
    }
  }

  const subFolder = `out/${new Date().toISOString().replaceAll(":", ".")}`;
  await Deno.mkdir(subFolder, { recursive: true });


  // processing
  const total_n = to_process.reduce((n, d) => n + d.sentences.length, 0);

  const datas = [];
  let n = 0;

  for (const d of to_process) {
    for (const sentence of d.sentences) {
      datas.push({
        major: d.major,
        minor: d.minor,
        index: n,
        // sentence: sentence,
        triplets: undefined,
        note: "Unknown.",
      } as {major: string, minor: string, index: number, triplets: any | undefined, note: string | undefined});
      n++;

      const ai_response = await askAI<string>(openaiClient, config, [
        {
          role: "system",
          content: stage1SystemPrompt,
        },
        {
          role: "user",
          content: sentence,
        },
      ]);
      if (!ai_response) {
        datas.at(-1)!.note = "AI failed to respond."
        continue;
      };

      let first_entities: string[] | undefined;
      try {
        first_entities = await JSON.parse(ai_response);
      } catch {}

      if (!first_entities) {
        datas.at(-1)!.note = "AI failed to give valid JSON."
        continue;
      }

      const second_ai_response = await askAI<string>(openaiClient, config, [
        {
          role: "system",
          content: stage2SystemPrompt,
        },
        {
          role: "user",
          content: `Entities: ${first_entities.map((it) => "- " + it).join("\n")}\n--\n${sentence}`,
        },
      ]);
      if (!second_ai_response) {
        datas.at(-1)!.note = "AI failed to respond (2)."
        continue;
      }

      datas.at(-1)!.triplets = second_ai_response;
      datas.at(-1)!.note = "Success!";

      console.log(`Logged ${n} / ${total_n}`);
    }
  }

  await Deno.writeTextFile(
    `${subFolder}/triplets_data.json`,
    JSON.stringify(datas, null, 4)
  );
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
