import N3 from "n3";
import { RDF_PREFIXES } from "./rdf.ts";

/**
 * Retrieves a subgraph containing nodes within N hops of the starting nodes
 * and all triples connected to those nodes.
 *
 * @param store The full N3.Store containing the graph data.
 * @param startNodeUris An array of full URI strings for the starting nodes.
 * @param hops The maximum number of relationship hops (0 means only triples directly involving start nodes).
 * @returns A new N3.Store containing the subgraph.
 */
export function getNHopSubgraph(
  store: N3.Store,
  startNodeUris: string[],
  hops: number
): N3.Store {
  const { namedNode, literal } = N3.DataFactory;
  // --- Step 1: Identify all nodes within N hops using BFS ---
  const allNodesInSubgraph = new Set<string>(startNodeUris); // Use node URIs/IDs as keys
  let frontier = new Set<string>(startNodeUris); // Nodes to explore in the current hop
  for (let i = 0; i < hops; i++) {
    if (frontier.size === 0) {
      console.debug(`BFS stopped early at hop ${i} as frontier became empty.`);
      break; // No new nodes found in the previous hop
    }
    const nextFrontier = new Set<string>();
    for (const nodeId of frontier) {
      let nodeTerm: N3.NamedNode | N3.BlankNode | N3.Literal;
      try {
        if (nodeId.startsWith(RDF_PREFIXES.tix)) {
          nodeTerm = namedNode(nodeId);
        } else {
          nodeTerm = literal(nodeId);
        }
      } catch (e) {
        console.warn(`Could not create term for node ID: ${nodeId}`, e);
        continue;
      }
      const neighbors = new Set([
        ...store
          .getQuads(nodeTerm, null, null, null)
          .filter(
            (it) =>
              it.object.termType === "NamedNode" &&
              !it.predicate.value.startsWith(RDF_PREFIXES.rdfs)
          )
          .map((it) => it.object.id),
        ...store
          .getQuads(null, null, nodeTerm, null)
          .filter(
            (it) =>
              it.subject.termType === "NamedNode" &&
              !it.predicate.value.startsWith(RDF_PREFIXES.rdfs)
          )
          .map((it) => it.subject.id),
      ]);
      for (const neighborId of neighbors) {
        if (!allNodesInSubgraph.has(neighborId)) {
          allNodesInSubgraph.add(neighborId);
          nextFrontier.add(neighborId);
        }
      }
    }
    frontier = nextFrontier; // Move to the next level
  }

  const subgraphQuads = store.getQuads(null, null, null, null).filter(
    (it) =>
      allNodesInSubgraph.has(it.subject.id) &&
      (allNodesInSubgraph.has(it.object.id) || // subject and object are in the subgraph
        it.object.termType === "Literal" || // object is a literal
        it.predicate.id === `${RDF_PREFIXES.rdfs}type`) // is a type relation
  );
  const subgraphStore = new N3.Store();
  subgraphStore.addQuads(subgraphQuads);
  return subgraphStore;
}

/**
 * Extracts the local name part of a URI string.
 * It returns the substring after the last '#' or '/' character.
 * If neither character is found, it returns the original URI string.
 *
 * @param uri The full URI string (e.g., from NamedNode.value).
 * @returns The local name part of the URI.
 */
export function getLocalNameFromUri(uri: string): string {
  // Find the index of the last '#'
  const hashIndex = uri.lastIndexOf("#");
  // Find the index of the last '/'
  const slashIndex = uri.lastIndexOf("/");

  // Determine which separator appears later in the string
  const separatorIndex = Math.max(hashIndex, slashIndex);

  // If a separator was found (index is not -1)
  if (separatorIndex !== -1) {
    // Return the part of the string *after* the separator
    return uri.substring(separatorIndex + 1);
  }

  // If no separator ('#' or '/') was found, return the original string
  // (This might happen with URNs or other URI schemes)
  return uri;
}
