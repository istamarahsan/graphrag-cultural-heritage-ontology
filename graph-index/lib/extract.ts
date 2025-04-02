import OpenAI from "@openai/openai";
import z from "zod";
import _ from "lodash";
import { error, ok, Result } from "./result.ts";

type LLMCLient = {
  openai: OpenAI;
  model: string;
  temperature: number;
  log: (obj: object) => Promise<void>;
};

export const entitySchema = z.object({
  class: z.string(),
  name: z.string(),
});
export const tripletSchema = z.object({
  domain: entitySchema,
  property: z.string(),
  range: entitySchema,
});

export type Entity = z.infer<typeof entitySchema>;
export type Triplet = z.infer<typeof tripletSchema>;

type ExtractTripletsWithLLMOptions = {
  promptAttempts: number;
};
type ExtractTripletsWithLLMOptionsMultiStage = {
  stage1SystemPrompt: string;
  stage2SystemPrompt: string;
} & ExtractTripletsWithLLMOptions;
export async function extractTripletsFromTextWithLLMMultiStage(
  client: LLMCLient,
  text: string,
  {
    promptAttempts,
    stage1SystemPrompt,
    stage2SystemPrompt,
  }: ExtractTripletsWithLLMOptionsMultiStage,
): Promise<Result<Triplet[]>> {
  const stage1Messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: stage1SystemPrompt,
    },
    {
      role: "user",
      content: text,
    },
  ];

  let entities: Entity[] | undefined;
  for (let i = 0; i < promptAttempts; i++) {
    try {
      const stage1Response = await prompt(client, {
        model: client.model,
        temperature: client.temperature,
        messages: stage1Messages,
      });
      const json = JSON.parse(stage1Response);
      entities = z.array(entitySchema).parse(json);
    } catch (_error) {
      continue;
    }
  }

  if (!entities) {
    return error(undefined);
  }

  const stage2Prompt = `Entities: ${
    JSON.stringify(
      entities.map(({ name, class: classId }) => "- " + classId + " " + name),
    )
  }\n--\n${text}`;
  const stage2Messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: stage2SystemPrompt,
    },
    {
      role: "user",
      content: stage2Prompt,
    },
  ];

  let triplets: Triplet[] | undefined;
  for (let i = 0; i < promptAttempts; i++) {
    try {
      const stage2Response = await prompt(client, {
        model: client.model,
        temperature: client.temperature,
        messages: stage2Messages,
      });
      const json = JSON.parse(stage2Response);
      triplets = z.array(tripletSchema).parse(json);
    } catch (_error) {
      continue;
    }
  }

  if (!triplets) {
    return error(undefined);
  }

  return ok(triplets);
}

type ExtractTripletsWithLLMOptionsSingleStage = {
  systemPrompt: string;
  fewShotExamples?: { prompt: string; response: string }[];
} & ExtractTripletsWithLLMOptions;
export async function extractTripletsFromTextWithLLMSingleStage(
  client: LLMCLient,
  text: string,
  { promptAttempts, systemPrompt, fewShotExamples = [] }:
    ExtractTripletsWithLLMOptionsSingleStage,
): Promise<Result<Triplet[]>> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    ...fewShotExamples.flatMap<
      OpenAI.Chat.Completions.ChatCompletionMessageParam
    >(({ prompt, response }) => [{
      role: "user",
      content: prompt,
    }, {
      role: "assistant",
      content: response,
    }]),
    {
      role: "user",
      content: text,
    },
  ];
  let triplets: Triplet[] | undefined;
  for (let i = 0; i < promptAttempts; i++) {
    try {
      const response = await prompt(client, {
        model: client.model,
        temperature: client.temperature,
        messages: messages,
      });
      const json = JSON.parse(response);
      triplets = z.array(tripletSchema).parse(json);
    } catch (_error) {
      if (_error instanceof Error) {
        console.error(_error.message);
      }
      continue;
    }
  }
  if (!triplets) {
    return error(undefined);
  }
  return ok(triplets);
}

async function prompt(
  client: LLMCLient,
  {
    messages,
    model,
    temperature,
  }: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    model: string;
    temperature: number;
  },
): Promise<string> {
  const response = await client.openai.chat.completions.create({
    messages,
    model,
    temperature,
    stream: false,
  });
  // deno-lint-ignore no-explicit-any
  const rawResponse = response.choices[0] as any;
  await client.log({ response: rawResponse.message });
  const content = rawResponse.message!.content!;
  const parsed = parseLLMResponse(
    z.string().parse(content),
  );
  return parsed;
}

function parseLLMResponse(responseStr: string): string {
  return _.trim(
    (responseStr.includes("</think>")
      ? responseStr.split("</think>")[1]
      : responseStr)
      .split("json")
      .filter((it) => it !== "")
      .join(""),
    "`\n ",
  );
}
