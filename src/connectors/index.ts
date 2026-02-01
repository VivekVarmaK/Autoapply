import { BoardConnector } from "../types/boards";
import { createIndeedConnector } from "./indeed/indeedConnector";

export function createConnectorRegistry(): Map<string, BoardConnector> {
  const registry = new Map<string, BoardConnector>();
  const indeed = createIndeedConnector();
  registry.set(indeed.name, indeed);
  return registry;
}
