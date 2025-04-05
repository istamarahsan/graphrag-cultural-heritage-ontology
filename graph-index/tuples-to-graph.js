import _ from "lodash";
import * as path from "@std/path";
import { parseArgs } from "@std/cli/parse-args";
import N3 from "n3";
import fs from "node:fs";
import z from "zod";
import { TextLineStream } from "@std/streams";
import { JsonParseStream } from "@std/json";
import * as extract from "./lib/extract.ts";
import { RDF_PREFIXES } from "./lib/rdf.ts";

if (import.meta.main) {
  const { f, o, t } = parseArgs(Deno.args, {
    string: ["f", "o", "t"],
    default: { t: "simple" },
  });
  if (!f) {
    console.error("Specify a triplets file with -f");
    Deno.exit(-1);
  }
  if (t !== "simple" && t !== "ontology") {
    console.error('Unrecognized triplet type "', t, '"');
    Deno.exit(-1);
  }
  const rdfFilePath =
    o ?? path.join(path.dirname(f), path.basename(f, path.extname(f))) + ".ttl";
  await Deno.mkdir(path.dirname(rdfFilePath), { recursive: true });
  await Deno.writeTextFile(rdfFilePath, "");

  const tripletsFile = await Deno.open(f, { read: true });
  const rdfStream = fs.createWriteStream(rdfFilePath);
  const rdfWriter = new N3.Writer(rdfStream, { prefixes: RDF_PREFIXES });

  const chunksResults = tripletsFile.readable
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .pipeThrough(new JsonParseStream());

  for await (const { triplets } of chunksResults) {
    if (triplets === null) {
      continue;
    }

    if (t === "simple") {
      const parseSimple = z
        .array(extract.simpleTripletSchema)
        .safeParse(triplets);
      if (!parseSimple.success) {
        console.error(
          "Could not parse as simple triplets: ",
          JSON.stringify(triplets)
        );
        break;
      }
      rdfWriter.addQuads(parseSimple.data.map(quadFromSimpleTriplet));
    } else if (t === "ontology") {
      const parseOntology = z
        .array(extract.ontologyTripletSchema)
        .safeParse(triplets);
      if (!parseOntology.success) {
        console.error(
          "Could not parse as ontology triplets: ",
          JSON.stringify(triplets)
        );
        break;
      }
      rdfWriter.addQuads(parseOntology.data.flatMap(quadsFromOntologyTriplet));
    }
  }

  rdfStream.close();
}

/**
 *
 * @param {extract.SimpleTriplet} triplet
 * @returns {N3.Quad}
 */
function quadFromSimpleTriplet({ subject, predicate, object }) {
  const namedNode = N3.DataFactory.namedNode;
  const quad = N3.DataFactory.quad;

  const subjectNode = namedNode(
    `${RDF_PREFIXES.tix}${subject.replace(/ /g, "_")}`
  );
  const predicateNode = namedNode(
    `${RDF_PREFIXES.tix}${predicate.replace(/ /g, "_")}`
  );
  const objectNode = namedNode(
    `${RDF_PREFIXES.tix}${object.replace(/ /g, "_")}`
  );
  return quad(subjectNode, predicateNode, objectNode);
}

/**
 * @param {extract.OntologyTriplet} triplet
 * @returns {N3.Quad[]}
 */
function quadsFromOntologyTriplet({ domain, property, range }) {
  const namedNode = N3.DataFactory.namedNode;
  const quad = N3.DataFactory.quad;
  const literal = N3.DataFactory.literal;

  // --- Define Core Nodes ---
  // Use subject/object terminology for clarity, matching RDF roles
  const subjectNode = namedNode(
    `${RDF_PREFIXES.tix}${domain.name.replace(/ /g, "_")}`
  );
  const propertyNode = namedNode(
    `${RDF_PREFIXES.crm}${property.replace(/ /g, "_")}` // Assuming CRM property
  );
  const typeNode = namedNode(`${RDF_PREFIXES.rdfs}type`); // Standard rdf:type

  // --- Define Domain Type Assertion (always present) ---
  const domainClassNode = namedNode(
    `${RDF_PREFIXES.crm}${domain.class.replace(/ /g, "_")}` // Assuming CRM class
  );
  const domainTypeQuad = quad(subjectNode, typeNode, domainClassNode);

  // --- Define Object Term (Literal or NamedNode) ---
  const isRangeLiteral = range.class === "Literal";
  const objectTerm = isRangeLiteral
    ? literal(range.name) // Create literal if range.class is "Literal"
    : namedNode(
        // Otherwise, create named node
        `${RDF_PREFIXES.tix}${range.name.replace(/ /g, "_")}`
      );

  // --- Define Main Relationship Quad (always present) ---
  const mainQuad = quad(subjectNode, propertyNode, objectTerm);

  // --- Define Range Type Assertion (conditionally null) ---
  // Only create this quad if the range is NOT a literal
  const rangeTypeQuad = isRangeLiteral
    ? null
    : quad(
        objectTerm,
        typeNode,
        namedNode(`${RDF_PREFIXES.crm}${range.class.replace(/ /g, "_")}`)
      );

  return [mainQuad, domainTypeQuad, rangeTypeQuad].filter((q) => q !== null);
}
