import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { table } from "node:console";
import { walk } from "@std/fs/walk";
import * as CSV from "@std/csv";
import { head } from "lodash";

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["b", "n"],
    default: { b: "0", n: "default" },
  });

  const includeBlanks = args.b === "1" || args.b?.toLowerCase() === "true" ||
    args.b?.toLowerCase() === "t" || args.b?.toLowerCase() === "yes" ||
    args.b?.toLowerCase() === "y";
  const folderName = args.n;

  if (!folderName) {
    console.error("Error: Missing -n");
    Deno.exit(1);
  }

  try {
    const evals: {
      Name: string;
      Data: {
        summary: { correct: number; total: number };
        details: {
          question: string;
          choices: string[];
          answerIdx: number;
          modelAnswer: { raw: string; correct: boolean }[];
        }[];
      };
    }[] = [];
    const targets = ["ontology_eval.json", "simple_eval.json"];

    if (includeBlanks) {
      evals.push({
        Name: "blank.json",
        Data: await Deno.readTextFile("./out/eval_blank.json").then(JSON.parse),
      });
    }
    for await (const entry of walk(`./out/run/${folderName}`)) {
      if (
        entry.isFile && targets.some((suffix) => entry.name.endsWith(suffix))
      ) {
        evals.push({
          Name: entry.name,
          Data: await Deno.readTextFile(entry.path).then(JSON.parse),
        });
      }
    }

    const arr = [];
    const qs = evals[0].Data.details;
    for (let i = 0; i <= qs.length; i++) {
      const question = qs[i];
      if (!question) continue;

      const data = {
        question: question.question as string,
        answers: {} as { [x: string]: boolean },
      };
      for (const bruh of evals) {
        data.answers[bruh.Name] = bruh.Data.details[i].modelAnswer[0].correct;
      }
      arr.push(data);
    }

    const headers = ["Question", ...Object.keys(arr[0].answers)];

    // Flatten arr to CSV-ready
    const records = arr.map((item) => {
      const row: Record<string, string | boolean> = { Question: item.question };
      for (const key of Object.keys(item.answers)) {
        row[key] = item.answers[key];
      }
      return row;
    });

    await Deno.writeTextFile(`./out/RAAHHHH.csv`, CSV.stringify(records, {
      columns: [
        'Question',
        ...Object.keys(arr[0].answers)
      ]
    }));

  } catch (error) {
    console.error(`Error processing file: ${error}`);
    Deno.exit(1);
  }
}
