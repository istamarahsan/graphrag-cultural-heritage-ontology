import z from "zod";
import { parseArgs } from "@std/cli/parse-args";

async function main() {
  const { f } = parseArgs(Deno.args, {
    string: ["f"],
  });
  if (!f) {
    throw new Error("Specify file to read");
  }
  const fileContent = await Deno.readTextFile(f);
  const parsed = fileContent
    .split("\n")
    .filter((it) => it != "")
    .map((it) => JSON.parse(it));
  const markdown = parsed.map(formatLineToMarkdown).join("\n");
  await Deno.writeTextFile("output.md", markdown);
}

function formatLineToMarkdown(lineData) {
  let markdown = `## ${lineData.page.title}\n\n`;
  markdown += `Sumber: [${lineData.page.url}](${lineData.page.url})\n\n`;

  lineData.data.forEach((qa, index) => {
    markdown += `${index + 1}. ${qa.question}\n`;
    qa.choices.forEach((choice, choiceIndex) => {
      const isCorrect = choiceIndex === qa.answerIdx;
      markdown += `   - ${choice}${isCorrect ? " **(Jawaban Benar)**" : ""}\n`;
    });
    markdown += "\n"; // Add space after each question's choices
  });

  return markdown;
}

main();
