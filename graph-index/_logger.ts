// deno-lint-ignore-file no-unused-vars no-empty no-explicit-any no-inner-declarations
import OpenAI from "@openai/openai";
import _ from "lodash";
import z from "zod";
import * as preprocess from "./preprocess.ts";

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

async function askAI<T>(
  OpenAI: OpenAI,
  config: z.infer<typeof configSchema>,
  messages: any
): Promise<T | undefined> {
  for (let i = 0; i < 5; i++) {
    try {
      const ai_response = await OpenAI.chat.completions.create({
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
  const config = await Deno.readTextFile(configFilePath)
    .then(JSON.parse)
    .then(configSchema.parse);
  try {
    await Deno.remove(outFilePath, { recursive: true });
  } catch {}

  const openaiClient = new OpenAI({
    baseURL: config.endpoint,
    apiKey: config.apiKey ?? "",
  });

  const stage1SystemPrompt = await Deno.readTextFile(
    stage1SystemPromptFilePath
  );
  const stage2SystemPrompt = await Deno.readTextFile(
    stage2SystemPromptFilePath
  );

  // initializations
  const chapters: {
    chapterNum: string;
    chapterTitle: string;
    subChapters: {
      subChar: string;
      subTitle: string;
      subText: string;
    }[];
  }[] = JSON.parse(await Deno.readTextFile(dataFilePath));

  const to_process = [];

  for (const chapter of chapters) {
    const major = chapter.chapterNum;
    for (const sub of chapter.subChapters) {
      const minor = sub.subChar;
      const text = sub.subText;

      const chunks = preprocess.chunkBySentence(text, {
        maxCharLength: chunkMaxChars,
        minSentences: chunkSentenceMin,
        maxSentences: chunkSentenceMax,
        sentenceOverlap: chunkSentenceOverlap,
      });
      to_process.push({
        major,
        minor,
        sentences: chunks.map((sentences) => sentences.join(". ")),
      } as {
        major: string;
        minor: string;
        sentences: string[];
      });
    }
  }

  const subFolder = `out/${new Date().toISOString().replaceAll(":", ".")}`;
  await Deno.mkdir(subFolder, { recursive: true });

  // processing
  const total_n = to_process.reduce((n, d) => n + d.sentences.length, 0);

  const datas = [];
  let n = 0;
  let failed = 0;

  for (const d of to_process) {
    for (const chunk of d.sentences) {
      datas.push({
        major: d.major,
        minor: d.minor,
        index: n,
        chunk: chunk,
        entities: undefined,
        triplets: undefined,
        note: "Unknown.",
      } as {
        major: string;
        minor: string;
        index: number;
        chunk: string;
        entities: any | undefined;
        triplets: any | undefined;
        note: string | undefined;
      });
      n++;

      const ai_response = await askAI<string>(openaiClient, config, [
        {
          role: "system",
          content: stage1SystemPrompt,
        },
        {
          role: "user",
          content: chunk,
        },
      ]);
      if (!ai_response) {
        datas.at(-1)!.note = "AI failed to respond.";
        failed++;
        continue;
      }

      const entitySchema = z.object({
        type: z.string(),
        name: z.string(),
      });
      const firstPromptResponseSchema = z.array(entitySchema);
      let first_entities: z.infer<typeof firstPromptResponseSchema> | undefined;
      try {
        const json = JSON.parse(ai_response);
        first_entities = firstPromptResponseSchema.parse(json);
      } catch {}

      if (!first_entities) {
        datas.at(-1)!.note = "AI failed to give valid JSON.";
        failed++;
        continue;
      }

      const prompt2 = `Entities: ${JSON.stringify(
        first_entities.map(({ name, type }) => "- " + type + " " + name)
      )}\n--\n${chunk}`;
      const second_ai_response = await askAI<string>(openaiClient, config, [
        {
          role: "system",
          content: stage2SystemPrompt,
        },
        {
          role: "user",
          content: prompt2,
        },
      ]);

      if (!second_ai_response) {
        datas.at(-1)!.note = "AI failed to respond (2).";
        failed++;
        continue;
      }

      const secondResponseSchema = z.array(
        z.object({
          subject: entitySchema,
          relation: z.string(),
          object: entitySchema,
        })
      );

      let triplets: z.infer<typeof secondResponseSchema> | undefined;
      try {
        const json = await JSON.parse(second_ai_response);
        triplets = secondResponseSchema.parse(json);
      } catch {}

      if (!triplets) {
        datas.at(-1)!.note = "AI failed to give valid JSON (2).";
        failed++;
        continue;
      }

      datas.at(-1)!.triplets = triplets;
      datas.at(-1)!.entities = first_entities;
      datas.at(-1)!.note = "Success!";

      console.log(`Logged ${n} / ${total_n}`);
    }
  }

  console.log(`Failed chunks: ${failed}`);

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
