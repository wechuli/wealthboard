import fs from "node:fs";
import path from "node:path";

const databasePath = path.resolve(process.env.DATABASE_PATH || "./data/e2e.db");
if (databasePath === path.resolve("./data/wealthboard.db")) {
  throw new Error("End-to-end tests cannot reset the development database.");
}
for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${databasePath}${suffix}`, { force: true });
}
fs.mkdirSync(path.resolve(process.env.BACKUP_PATH || "./backups/e2e"), {
  recursive: true,
});
