declare module "osm-pbf-parser" {
  import type { Duplex } from "node:stream";
  export type Element = {
    type: "node" | "way" | "relation"; id: number; tags: Record<string, string>;
    lat?: number; lon?: number; refs?: number[];
    members?: { type: string; id: number; role: string }[];
  };
  export default function parse(): Duplex;
}
