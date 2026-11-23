import fs from "node:fs";
import path from "node:path";

export type PrototypeMetadata = {
  title: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  hidden: boolean;
  public: boolean;
};

export type Prototype = PrototypeMetadata & { slug: string };

export function getPrototypes(): Prototype[] {
  const root = path.join(process.cwd(), "app", "prototypes");
  if (!fs.existsSync(root)) return [];

  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(root, entry.name, "metadata.json");
      if (!fs.existsSync(file)) return null;
      try {
        const metadata = JSON.parse(fs.readFileSync(file, "utf8")) as PrototypeMetadata;
        return { slug: entry.name, ...metadata };
      } catch {
        return null;
      }
    })
    .filter((item): item is Prototype => item !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getPrototype(slug: string): Prototype | undefined {
  return getPrototypes().find((prototype) => prototype.slug === slug);
}
