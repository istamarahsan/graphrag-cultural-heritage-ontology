import OpenAI from "@openai/openai";
import z from "zod";
import _ from "lodash";
import { error, ok, Result } from "./result.ts";

type LLMCLient = {
  openai: OpenAI;
  model: string;
  temperature: number;
};

const entitySchema = z.object({
  class: z.string(),
  name: z.string(),
});
const tripletSchema = z.object({
  domain: entitySchema,
  property: z.string(),
  range: entitySchema,
});

type Entity = z.infer<typeof entitySchema>;
type Triplet = z.infer<typeof tripletSchema>;

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
  }: ExtractTripletsWithLLMOptionsMultiStage
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
      const stage1Response = await prompt(client.openai, {
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

  const stage2Prompt = `Entities: ${JSON.stringify(
    entities.map(({ name, class: classId }) => "- " + classId + " " + name)
  )}\n--\n${text}`;
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
      const stage2Response = await prompt(client.openai, {
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
} & ExtractTripletsWithLLMOptions;
export async function extractTripletsFromTextWithLLMSingleStage(
  client: LLMCLient,
  text: string,
  { promptAttempts, systemPrompt }: ExtractTripletsWithLLMOptionsSingleStage
): Promise<Result<Triplet[]>> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: text,
    },
  ];
  let triplets: Triplet[] | undefined;
  for (let i = 0; i < promptAttempts; i++) {
    try {
      const response = await prompt(client.openai, {
        model: client.model,
        temperature: client.temperature,
        messages: messages,
      });
      const json = JSON.parse(response);
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

async function prompt(
  client: OpenAI,
  {
    messages,
    model,
    temperature,
  }: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    model: string;
    temperature: number;
  }
): Promise<string> {
  const response = await client.chat.completions.create({
    messages,
    model,
    temperature,
    stream: false,
  });
  const parsed = parseLLMResponse(
    z.string().parse(response.choices[0]!.message!.content!)
  );
  return parsed;
}

function parseLLMResponse(responseStr: string): string {
  // return _.trim(
  //   (responseStr.includes("</think>")
  //     ? responseStr.split("</think>")[1].replace("<｜end▁of▁sentence｜>", "")
  //     : responseStr
  //   )
  //     .split("json")
  //     .filter((it) => it !== "")
  //     .join(""),
  //   "`\n "
  // );
  return _.trim(
    responseStr
      .split("json")
      .filter((it) => it !== "")
      .join(""),
    "`\n "
  );
}
