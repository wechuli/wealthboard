import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const source = path.resolve("public/templates");
const destination = path.resolve("docs/public/templates");

rmSync(destination, { recursive: true, force: true });
mkdirSync(path.dirname(destination), { recursive: true });
cpSync(source, destination, { recursive: true });

console.log("Documentation import templates synchronized.");
