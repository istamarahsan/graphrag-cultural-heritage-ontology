// deno-lint-ignore-file no-explicit-any
// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts"
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

async function readXLSX(filePath: string): Promise<any[]> {
  try {
    const file = await Deno.readFile(filePath);
    const workbook = XLSX.read(new Uint8Array(file), { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    return jsonData;
  } catch (error) {
    console.error("Error reading or parsing XLSX file:", error);
    return [];
  }
}

async function main() {
  const dataContent = await Deno.readTextFile(
    "./data/museum_nasional_scraped.json",
  );
  const scrapedData: {
    url: string;
    content: string;
    title: string;
  }[] = JSON.parse(dataContent);

  const filePath = "./excel.xlsx";
  const data = await readXLSX(filePath) as {
    Topic: string;
    Question: string;
  }[];

  if (data.length > 0) {
    const urls = data
      .reduce(
        (mep, d) => {
          const split = d.Topic.split(" ");
          let url = split.pop()!;
          let title = split.join(" ")!;

          if (!url.startsWith("https")) {
            url = d.Topic;
            title = d.Topic;
            return mep;
          }
          const question = d.Question;

          if (!mep.has(url)) {
            mep.set(url, {
              Title: title,
              Questions: [],
              Content: scrapedData.find((sd) => sd.url === url || sd.title === title)!.content,
            });
          }

          const holder = mep.get(url)!;
          holder.Questions.push(question);
          mep.set(url, holder);

          return mep;
        },
        new Map<
          string,
          { Title: string; Questions: string[]; Content: string }
        >(),
      );

    // console.log(JSON.stringify(Object.fromEntries(urls), null, 4));
    Deno.writeTextFile(
      `./data/teehee.json`,
      [
        "According to this text sources, which are these questions from each text source are impossible to answer, implying that the only text source is just that?",
        ...urls.values().map(d => {
            return [
                `--- Topic: ${d.Title} ---`,
                d.Content,
                `--- Questions of: ${d.Title} ---`,
                d.Questions.map((str, i) => `${i + 1}. ${str}`).join("\n"),
                '',
                // `--- End of ${d.Title} ---`,
            ].join("\n");
        })
      ].join("\n"),
      {
        create: true,
      },
    );
  } else {
    console.log("No data found or an error occurred.");
  }
}

if (import.meta.main) {
  main();
}
