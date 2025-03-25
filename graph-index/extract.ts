import OpenAI from "@openai/openai";
import z from "zod";
import _ from "lodash";
import { error, ok, Result } from "./result.ts";

type LLMTripletExtractionClient = {
  llm: {
    openai: OpenAI;
    model: string;
    temperature: number;
  };
  stage1SystemPrompt: string;
  stage2SystemPrompt: string;
};

const entitySchema = z.object({
  classId: z.string(),
  name: z.string(),
});
const tripletSchema = z.object({
  subject: entitySchema,
  relationship: z.string(),
  object: entitySchema,
});

type Entity = z.infer<typeof entitySchema>;
type Triplet = z.infer<typeof tripletSchema>;

export function createClient({
  openai,
  model,
  temperature,
  stage1SystemPrompt,
  stage2SystemPrompt,
}: {
  openai: OpenAI;
  model: string;
  temperature: number;
  stage1SystemPrompt: string;
  stage2SystemPrompt: string;
}): LLMTripletExtractionClient {
  return {
    llm: {
      openai,
      model,
      temperature,
    },
    stage1SystemPrompt,
    stage2SystemPrompt,
  };
}

type ExtractTripletsWithLLMOptions = {
  promptAttempts: number;
};
export async function extractTripletsFromTextWithLLM(
  { llm, stage1SystemPrompt, stage2SystemPrompt }: LLMTripletExtractionClient,
  text: string,
  { promptAttempts }: ExtractTripletsWithLLMOptions
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
      const stage1Response = await prompt(llm.openai, {
        model: llm.model,
        temperature: llm.temperature,
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
    entities.map(({ name, classId }) => "- " + classId + " " + name)
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
      const stage2Response = await prompt(llm.openai, {
        model: llm.model,
        temperature: llm.temperature,
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
