const neo4j = require("neo4j-driver");
const fs = require('fs');

async function insertDataToNeo4j(data) {
    const driver = neo4j.driver(
        "neo4j://localhost",
        neo4j.auth.basic("admin", "password")
    );

    const session = driver.session({
        // database: "neo4j"
    });

    try {
        const now = new Date();
        const id = now.toISOString();

        await session.run(
            `CREATE (when:When {createdAt:datetime('${now.toISOString()}'), id:$id});`,
            { id }
        );

        for (const item of data) {
            const { major, minor, index, triplets } = item;

            await session.run(
                `CREATE (major:Major {major: $major, id:$id});`,
                { id, major }
            );

            await session.run(
                `
                MATCH (when:When {id: $id}), (major:Major {major: $major, id: $id})
                CREATE (when)-[:HAS_MAJOR]->(major);
                `,
                { id, major }
            );

            await session.run(
                `CREATE (minor:Minor {minor: $minor, major: $major, id:$id});`,
                { id, major, minor }
            );

            await session.run(
                `
                MATCH (major:Major {major: $major, id: $id}), (minor:Minor {minor: $minor, major: $major, id: $id})
                CREATE (major)-[:HAS_MINOR]->(minor);
                `,
                { id, major, minor }
            );

            for (const triplet of triplets) {
                const { subject, relation, object } = triplet;

                await session.run(
                    `
                    MATCH (minor:Minor {minor: $minor, major: $major, id: $id})
                    CREATE (triplet:Triplet {subject: $subject, object: $object, relation: $relation})
                    CREATE (minor)-[:HAS_TRIPLET]->(triplet)
                    `,
                    { id, major, minor, object, subject, relation },
                );
            }
        }
        console.log("Data inserted successfully");
    } catch (error) {
        console.error("Error inserting data:", error);
    } finally {
        await session.close();
        await driver.close();
    }
}

fs.readFile('triplets_data.json', 'utf8', (err, data) => {
    if (err) {
        console.error("Error reading file:", err);
        return;
    }
    const jsonData = JSON.parse(data);
    insertDataToNeo4j(jsonData);
});