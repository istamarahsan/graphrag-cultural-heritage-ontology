package fyi.tix;

import org.semanticweb.owlapi.apibinding.OWLManager;
import org.semanticweb.owlapi.model.*;
import java.io.File;
import java.io.FileNotFoundException;

public class Main {
    public static void main(String[] args) {
        if (args.length != 1) {
            System.err.println("Must specify a KG file in OWL format");
            System.exit(1); // Exit with an error code
        }
        String kgFilePath = args[0]; // Get file path from command line
        String crmOntologyIRI = "http://erlangen-crm.org/240307/";

        // Create an OWLOntologyManager
        OWLOntologyManager manager = OWLManager.createOWLOntologyManager();

        // Load the CIDOC CRM Ontology
        OWLOntology crmOntology = manager.loadOntology(IRI.create(crmOntologyIRI));
        System.out.println("Loaded CIDOC CRM Ontology: " + crmOntology.getOntologyID());

        // Load knowledge graph data
        File dataFile = new File(kgFilePath);
    }
}