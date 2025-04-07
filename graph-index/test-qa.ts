import OpenAI from "@openai/openai";
import z, { object } from "zod";

import { parseArgs } from "@std/cli/parse-args";
import { exists } from "@std/fs/exists";

import { giveMeEmbeddings } from "./qa.ts";

//
let globalTtlPath: string
let globalConfigPath: string;
const basicSystemPrompt = "Help the user as best as you can with minimal response and only JSON.";

const configSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string(),
});

type Config = z.infer<typeof configSchema>;

//
async function retryJSONFromAI<T>(
  ai: OpenAI,
  config: Config,
  question: string,
  choices: string,
  prompt: string,
): Promise<{response: T, keys: string[], embeddings: string[]} | null> {
  if (!globalConfigPath) return null;

  const max_attempts = 10;
  for (let i = 0; i < max_attempts; i++) {
    // console.log(`retryJSONFromAI: Attempt ${i + 1}/${max_attempts}`);

    // console.log(`generating key responses.`)
    const keyResponse = await ai.chat.completions.create({
      model: config.model,
      temperature: 1.0,
      messages: [
        {
          role: "system",
          content: basicSystemPrompt,
        },
        { role: "user", content: `Extract all key words from the question and choices to a JSON array form so it's just array of string or string[].\nQuestion:\n${question}\nChoices:\n${choices}` },
      ],
    });

    const keyMessage = keyResponse.choices[0].message.content;
    let keys: string[];
    try {
      keys = JSON.parse(keyMessage ?? "");
    } catch {
      continue;
    }

    let embeddings;
    try {
      // console.log(`generating embeddings.`)
      // embeddings = await giveMeEmbeddings('./out/run/default/simple/config_simple_embed.ttl', 'embed.json', keys.map(k => `What is ${k}`));
      // console.log(`got ${embeddings.length} embeddings`);

      const e: any[] = [];
      for (const key of keys.map(k => (`What is ${k}`))) {
        const em = await giveMeEmbeddings(globalTtlPath, 'embed.json', key);
        em.forEach(
          emb => 
            e.push(`${emb.subject.replaceAll("_", " ")} ${emb.predicate.replaceAll("_", " ")} ${emb.object.replaceAll("_", " ")}`)
        );
      }
      
      const ee: any[] = [];
      const d = new Map();
      for (const emb of e) {
        if (!d.has(emb)) {
          d.set(emb, true);
          ee.push(emb);
        }
      }
      embeddings = ee;
    } catch(err) {
      // console.error(err);
      continue;
    }

    // console.log(`answering prompt.`)
    const questionResponse = await ai.chat.completions.create({
      model: config.model,
      temperature: 1.0,
      messages: [
        {
          role: "system",
          content: `${basicSystemPrompt}.`,
        },
        { role: "user", content: `According to this emmbedings: \n${JSON.stringify(embeddings)}\n${prompt}` },
      ],
    });

    const questionMessage = questionResponse.choices[0].message.content;
    try {
      return {response: JSON.parse(questionMessage ?? ""), keys, embeddings};
    } catch {}
  }
  return null;
}

//
async function main() {
  const args = parseArgs(Deno.args, {
    string: ["c", "qa", "t"],
    alias: { "c": "config" },
  });

  if (!args.c) {
    console.error(
      "Error: Config file path must be specified with -c or --config",
    );
    Deno.exit(1);
  }
  if (!(await exists(args.c))) {
    console.error(`Error: Config file not found at "${args.c}"`);
    Deno.exit(1);
  }

  const qaPath = args.qa ?? "./data/qa.jsonl";
  if (!qaPath) {
    console.error(
      "Error: QA file path must be specified with -qa",
    );
    Deno.exit(1);
  }
  if (!(await exists(qaPath))) {
    console.error(`Error: QA file not found at "${qaPath}"`);
    Deno.exit(1);
  }

  if (!args.t) {
    console.error(
      "Using default Ttl file, please use -t to change.",
    );
    // Deno.exit(1);
  }
  globalTtlPath = args.t ?? './out/run/default/simple/config_simple_embed.ttl';

  if (!(await exists(globalTtlPath))) {
    console.error(`Error: Ttl file not found at "${globalTtlPath}"`);
    Deno.exit(1);
  }

  globalConfigPath = args.c;
  const config = await Deno.readTextFile(args.c).then(JSON.parse).then(
    configSchema.parse,
  );
  const openai = new OpenAI({
    apiKey: config.apiKey ?? "",
    baseURL: config.endpoint,
  });

  const qaRaw = await Deno.readTextFile(qaPath);
  const qas: { question: string; choices: string[]; answerIdx: number }[] =
    qaRaw.split("\n").filter((str) => str.trim() !== "").map((str) =>
      JSON.parse(str.trim())
    ).reduce((list, v) => {
      v?.data?.forEach((d: any) => {
        list.push(d);
      });
      return list;
    }, []);

  let questions = 0;
  let correct_amm = 0;

  const result = {
    total_questions: 0,
    correct_answers: 0,
    wrong_answers: 0,

    questions: [] as any[],
  };

  for (const question of qas) {
    questions++;
    result.total_questions++;

    const get = await retryJSONFromAI<{ answer: number }>(
      openai,
      config,
      question.question,
      question.choices.join("\n"),
      `Answer the following question by answering the index of the choices, e.g. A is index 0, B is index 1, C is index 2, and D is index 3 in JSON format like {"answer": index} where index is the answer index number, not the letter. Question:\n${question.question}\nChoices:\n${question.choices.join("\n")}`,
    );
    console.log(question.question);
    console.log(get?.response);
    console.log(question.answerIdx);

    if (get && get?.response?.answer === question.answerIdx) {
      correct_amm++;
      result.correct_answers++;
    } else {
      result.wrong_answers++;
    }

    result.questions.push({
      question: question.question,
      choices: question.choices,
      intended_answer: question.answerIdx,
      get_answer: get?.response?.answer,

      prompt: {
        keys: get?.keys,
        embeddings: get?.embeddings,
      },
    });
  }

  console.log(`correct/questions: ${correct_amm}/${questions}`);
  Deno.mkdir("out/qa", { recursive: true });
  Deno.writeTextFile(
    `out/qa/${new Date().toISOString().replaceAll(":", ".")}.json`,
    JSON.stringify(result),
    {
      // append: true,
      create: true,
    },
  );
}

if (import.meta.main) {
  main();
}
