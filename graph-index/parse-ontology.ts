// deno-lint-ignore-file no-explicit-any
import * as xmlParse from "@libs/xml/parse"
import _ from "lodash";
import { parseArgs } from "@std/cli/parse-args"

if (import.meta.main) {
    const { f, o } = parseArgs(Deno.args, {
        string: ["f", "o"],
        default: {"o": "prompt/prompt-ontology.txt"}
    })
    if (!f) {
        console.error("Specify an RDF file with --f")
        Deno.exit(-1);
    }
    using ontologyFile = await Deno.open(f)
    const content = xmlParse.parse(ontologyFile) as any
    const text = `## Ontology Concepts
${content["rdf:RDF"]["rdfs:Class"].map(fragmentClass).join("\n\n")}

## Ontology Relations
${content["rdf:RDF"]["rdf:Property"].map(fragmentProperty).join("\n\n")}
`
    await Deno.writeTextFile(o, text)
}

function fragmentClass(obj: any): string {
    return `### ${obj["@rdf:about"]}\nSubclass of: [${!("rdfs:subClassOf" in obj) ? "" : ( _.isArray(obj["rdfs:subClassOf"]) ? obj["rdfs:subClassOf"] : [obj["rdfs:subClassOf"]]).map(it => it["@rdf:resource"]).join(", ")}]\n${(obj["rdfs:comment"] ?? "").replaceAll("\n", "").replaceAll("\r", "")}`
}

function fragmentProperty(obj: any): string {
    return `### ${obj["@rdf:about"]}\nDomain: ${obj["rdfs:domain"]["@rdf:resource"]}\nRange: ${obj["rdfs:range"]["@rdf:resource"]}${"rdfs:comment" in obj ? "\n" + obj["rdfs:comment"].replaceAll("\n", "").replaceAll("\r", "") : ""}`
}
