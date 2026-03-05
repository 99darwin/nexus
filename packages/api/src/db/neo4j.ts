import neo4j, { type Driver, type Session } from "neo4j-driver";

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI ?? "bolt://localhost:7687";
    const neo4jAuth = process.env.NEO4J_AUTH;

    let auth;
    if (neo4jAuth === "none" || neo4jAuth === "") {
      auth = undefined;
    } else if (neo4jAuth && neo4jAuth.includes("/")) {
      const [user, ...rest] = neo4jAuth.split("/");
      auth = neo4j.auth.basic(user, rest.join("/"));
    } else {
      const user = process.env.NEO4J_USER ?? "neo4j";
      const password = process.env.NEO4J_PASSWORD ?? "nexus-dev-password";
      auth = neo4j.auth.basic(user, password);
    }

    driver = neo4j.driver(uri, auth);
  }
  return driver;
}

export function getSession(): Session {
  return getDriver().session();
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

export async function checkNeo4jHealth(): Promise<boolean> {
  try {
    const session = getSession();
    await session.run("RETURN 1");
    await session.close();
    return true;
  } catch {
    return false;
  }
}
