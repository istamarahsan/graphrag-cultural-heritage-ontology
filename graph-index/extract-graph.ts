import OpenAI from "@openai/openai";
import _ from "lodash";
import { z } from "zod";
import { DateTime } from "luxon";
import { parseArgs } from "@std/cli/parse-args";
import promiseLimit from "promise-limit";
import * as extract from "./lib/extract.ts";
import Config from "./lib/config.ts";

const singleStageSystemPromptFilePath = "prompt/prompt-singlestage.txt";

if (import.meta.main) {
  const { f, c } = parseArgs(Deno.args, {
    string: ["f", "c"],
  });
  if (!f) {
    console.error("Specify chunks file with -f");
    Deno.exit(-1);
  }
  const configFilePath = c ?? "config.json";
  const dumpFilePrefix = `out/dump/${DateTime.local()
    .toISO({ includeOffset: true, suppressMilliseconds: true })
    .replace(/:/g, "-")
    .replace(/\./g, "_")}`;
  const dumpFilePathLines = `${dumpFilePrefix}.jsonl`;
  const dumpFilePathMerged = `${dumpFilePrefix}.json`;

  const config = await Deno.readTextFile(configFilePath)
    .then(JSON.parse)
    .then(Config.parse);

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

  const textChunks = await Deno.readTextFile(f)
    .then(JSON.parse)
    .then(z.array(z.object({ content: z.string() })).parse);

  console.log(`Processing ${textChunks.length} chunks`);

  const concurrencyLimiter = promiseLimit(10);
  let finishedCount = 0;
  await Promise.all(
    textChunks.map((chunk) =>
      concurrencyLimiter(async () => {
        const result = await extract.extractTripletsFromTextWithLLMSingleStage(
          client,
          chunk.content,
          {
            promptAttempts: 2,
            systemPrompt: singleStageSystemPrompt,
          }
        );
        finishedCount += 1;
        const countStr = `(${finishedCount}/${textChunks.length})`;
        if (result.ok) {
          console.log(`✅ ${countStr} chunk processed successfully`);
          await Deno.writeTextFile(
            dumpFilePathLines,
            JSON.stringify(result.value) + "\n",
            { append: true }
          );
        } else {
          console.error(`❌ ${countStr} failed to process chunk `);
        }
      })
    )
  );

  const merged = await Deno.readTextFile(dumpFilePathLines).then((it) =>
    it
      .split("\n")
      .filter((it) => it != "")
      .map((it) => JSON.parse(it))
      .reduce<object[]>((merged, arr) => [...merged, ...arr], [])
  );
  await Deno.writeTextFile(
    dumpFilePathMerged,
    JSON.stringify(merged, undefined, 2)
  );
}
