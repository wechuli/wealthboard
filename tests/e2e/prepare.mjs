import fs from "node:fs";
import path from "node:path";

for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(path.resolve(`./data/e2e.db${suffix}`), { force: true });
}
fs.mkdirSync(path.resolve("./backups/e2e"), { recursive: true });
