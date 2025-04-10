import N3 from "n3";

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
  const subgraphStore = new N3.Store();

  // --- Step 1: Identify all nodes within N hops using BFS ---
  const allNodesInSubgraph = new Set<string>(startNodeUris); // Use node URIs/IDs as keys
  let frontier = new Set<string>(startNodeUris); // Nodes to explore in the current hop

  for (let i = 0; i < hops; i++) {
    const nextFrontier = new Set<string>();
    if (frontier.size === 0) {
      console.debug(`BFS stopped early at hop ${i} as frontier became empty.`);
      break; // No new nodes found in the previous hop
    }

    for (const nodeId of frontier) {
      let nodeTerm: N3.NamedNode | N3.BlankNode | N3.Literal;
      try {
        if (nodeId.startsWith("https://tix.fyi/museum#")) {
          nodeTerm = namedNode(nodeId);
        } else {
          nodeTerm = literal(nodeId);
        }
      } catch (e) {
        console.warn(`Could not create term for node ID: ${nodeId}`, e);
        continue;
      }

      // Find neighbors via outgoing links (node -> object)
      for (const quad of store.getQuads(nodeTerm, null, null, null)) {
        if (
          quad.object.termType === "NamedNode" ||
          quad.object.termType === "BlankNode"
        ) {
          const neighborId = quad.object.id; // .id works for both NamedNode (value) and BlankNode (id)
          if (!allNodesInSubgraph.has(neighborId)) {
            allNodesInSubgraph.add(neighborId);
            nextFrontier.add(neighborId);
          }
        }
      }

      // Find neighbors via incoming links (subject -> node)
      for (const quad of store.getQuads(null, null, nodeTerm, null)) {
        if (
          quad.subject.termType === "NamedNode" ||
          quad.subject.termType === "BlankNode"
        ) {
          const neighborId = quad.subject.id;
          if (!allNodesInSubgraph.has(neighborId)) {
            allNodesInSubgraph.add(neighborId);
            nextFrontier.add(neighborId);
          }
        }
      }
    }
    frontier = nextFrontier; // Move to the next level
  }

  // --- Step 2: Add all quads involving identified nodes to the subgraph store ---
  let addedQuadsCount = 0;
  for (const quad of store.getQuads(null, null, null, null)) {
    // Check if subject OR object is one of the nodes identified within N hops
    // Note: .id returns the value for NamedNode and the id for BlankNode
    const subjectId = quad.subject.id;
    const objectId = quad.object.id; // Works even for Literals, just won't match Set keys

    // Add quad if subject is in the set OR (object is in the set AND object is not a literal)
    // Or more simply: Add quad if subject is in the set OR object is in the set
    // Let's refine: Add quad if subject is in the set. Also add quad if object is *a resource* in the set.
    // This prevents adding quads only connected via literals outside the core nodes.
    // Safest approach: add quad if subject is in set OR object is in set.
    // This grabs all properties of nodes within N hops, and potentially links *out* from them.

    // Let's try: Add quad if SUBJECT is in the set of nodes. This gets all outgoing properties.
    // And ALSO add quad if OBJECT is in the set of nodes. This gets all incoming properties.
    // This might duplicate quads if both S and O are in the set, but N3.Store handles duplicates.

    if (
      allNodesInSubgraph.has(subjectId) ||
      (quad.object.termType !== "Literal" && allNodesInSubgraph.has(objectId))
    ) {
      subgraphStore.addQuad(quad);
      addedQuadsCount++;
    }

    // Alternative Logic (more precise, only includes edges *between* subgraph nodes + literals attached to them):
    /*
       if (allNodesInSubgraph.has(subjectId)) {
           if (quad.object.termType === 'Literal' || allNodesInSubgraph.has(objectId)) {
               subgraphStore.addQuad(quad);
               addedQuadsCount++;
           }
       }
       */
  }
  // The alternative logic above is likely closer to a true subgraph definition. Let's use that.

  // Clear the store first before adding based on the stricter logic
  subgraphStore.removeQuads(subgraphStore.getQuads(null, null, null, null));
  addedQuadsCount = 0;

  for (const quad of store.getQuads(null, null, null, null)) {
    const subjectId = quad.subject.id;
    if (allNodesInSubgraph.has(subjectId)) {
      // If the subject is in our set, include the quad if the object is a Literal OR also in our set
      if (
        quad.object.termType === "Literal" ||
        allNodesInSubgraph.has(quad.object.id)
      ) {
        subgraphStore.addQuad(quad);
        addedQuadsCount++;
      }
    }
  }

  return subgraphStore;
}
