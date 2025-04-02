import * as xmlParse from "@libs/xml/parse";
import _ from "lodash";
import { parseArgs } from "@std/cli/parse-args";

if (import.meta.main) {
  const { f, o } = parseArgs(Deno.args, {
    string: ["f", "o"],
    default: { o: "prompt/prompt-ontology.txt" },
  });
  if (!f) {
    console.error("Specify an RDF file with -f");
    Deno.exit(-1);
  }
  const ontologyFile = await Deno.open(f);
  const content = xmlParse.parse(ontologyFile);
  ontologyFile.close();
  const subsetGuide = await Deno.readTextFile("data/onto-subset.json").then(
    JSON.parse
  );
  const subsetClassIds = new Set(subsetGuide["classes"].map(({ id }) => id));
  const classes = content["rdf:RDF"]["rdfs:Class"];
  const classesFiltered = classes.filter((it) =>
    subsetClassIds.has(it["@rdf:about"])
  );
  console.log(
    "original classes =",
    classes.length,
    "classes in subset =",
    subsetClassIds.size,
    "classes after filter = ",
    classesFiltered.length
  );

  const subsetPropertyIds = new Set(
    subsetGuide["properties"].flatMap(({ id, inverse_id }) =>
      [id, inverse_id].filter((it) => it !== undefined && it !== null)
    )
  );
  const properties = content["rdf:RDF"]["rdf:Property"];
  const propertiesFiltered = properties.filter((it) =>
    subsetPropertyIds.has(it["@rdf:about"])
  );
  console.log(
    "original properties =",
    properties.length,
    "properties in subset =",
    subsetPropertyIds.size,
    "properties after filter = ",
    propertiesFiltered.length
  );

  const text = `# Ontology Concepts
${classesFiltered.map(fragmentClass).join("\n\n")}

# Ontology Relations
${content["rdf:RDF"]["rdf:Property"].map(fragmentProperty).join("\n\n")}
`;
  await Deno.writeTextFile(o, text);
}

function fragmentClass(obj) {
  return `## ${obj["@rdf:about"]}\nSubclass of: [${
    !("rdfs:subClassOf" in obj)
      ? ""
      : (_.isArray(obj["rdfs:subClassOf"])
          ? obj["rdfs:subClassOf"]
          : [obj["rdfs:subClassOf"]]
        )
          .map((it) => it["@rdf:resource"])
          .join(", ")
  }]\n${(obj["rdfs:comment"] ?? "").replaceAll("\n", "").replaceAll("\r", "")}`;
}

function fragmentProperty(obj) {
  return `## ${obj["@rdf:about"]}\nDomain: ${
    obj["rdfs:domain"]["@rdf:resource"]
  }\nRange: ${obj["rdfs:range"]["@rdf:resource"]}${
    "rdfs:comment" in obj
      ? "\n" + obj["rdfs:comment"].replaceAll("\n", "").replaceAll("\r", "")
      : ""
  }`;
}
