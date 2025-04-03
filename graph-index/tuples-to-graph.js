import _ from "lodash";
import * as path from "@std/path";
import { parseArgs } from "@std/cli/parse-args";
import N3 from "n3";
import fs from "node:fs";
import z from "zod";
import { TextLineStream } from "@std/streams";
import { JsonParseStream } from "@std/json";
import * as extract from "./lib/extract.ts";

const rdfBaseURI = "https://tix.fyi/museum#";
const rdfPrefixes = {
  crm: "http://www.cidoc-crm.org/cidoc-crm/",
  tix: rdfBaseURI,
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
};

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
  const rdfWriter = new N3.Writer(rdfStream, { prefixes: rdfPrefixes });

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
  const subjectNode = namedNode(
    `${rdfPrefixes.tix}${subject.replace(/ /g, "_")}`
  );
  const predicateNode = namedNode(
    `${rdfPrefixes.tix}${predicate.replace(/ /g, "_")}`
  );
  const objectNode = namedNode(
    `${rdfPrefixes.tix}${object.replace(/ /g, "_")}`
  );
  return N3.DataFactory.quad(subjectNode, predicateNode, objectNode);
}
